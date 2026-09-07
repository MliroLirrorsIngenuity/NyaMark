//! Graceful quit.
//!
//! Every path that ends the process is funnelled through the per-window
//! close-request flow: the webview listens for `tauri://close-requested`,
//! prompts for unsaved changes and destroys the window itself. Once the last
//! window is gone the runtime raises `ExitRequested { code: None }`, which is
//! where an updater restart is completed.
//!
//! Paths covered:
//! - titlebar close / Alt+F4 / Cmd+W: native `CloseRequested`, nothing to do here;
//! - the app menu "Quit" item and `Cmd+Q`: [`request_quit`];
//! - dock "Quit", logout and shutdown on macOS: `applicationShouldTerminate:`
//!   hook installed by [`install_macos_terminate_hook`];
//! - updater restart: `request_app_restart` command in `lib.rs`.

use tauri::{AppHandle, Manager, Runtime};

use crate::sessions;

/// Ask every window to close; dirty ones prompt on the webview side.
pub fn close_all_windows<R: Runtime>(app: &AppHandle<R>) {
    for (label, window) in app.webview_windows() {
        if let Err(error) = window.close() {
            eprintln!("Failed to request close for window {label}: {error}");
        }
    }
}

/// Quit requested by the user (menu item / Cmd+Q).
pub fn request_quit<R: Runtime>(app: &AppHandle<R>) {
    if sessions::any_window_dirty(app) {
        close_all_windows(app);
    } else {
        app.exit(0);
    }
}

/// `RunEvent::ExitRequested` guard.
///
/// `code: None` means the runtime wants to exit on its own (last window
/// destroyed, or a platform quit tao forwards as an exit request). `Some(_)`
/// comes from `app.exit` / `app.restart`, which only run after the prompt.
pub fn handle_exit_requested<R: Runtime>(
    app: &AppHandle<R>,
    code: Option<i32>,
    api: &tauri::ExitRequestApi,
) {
    if code.is_some() {
        return;
    }

    if sessions::any_window_dirty(app) {
        api.prevent_exit();
        close_all_windows(app);
        return;
    }

    if sessions::is_restart_pending(app) {
        app.restart();
    }
}

#[cfg(target_os = "macos")]
pub use macos::install_terminate_hook as install_macos_terminate_hook;

#[cfg(target_os = "macos")]
mod macos {
    use std::{ffi::CString, sync::OnceLock};

    use objc2::{
        encode::Encode,
        runtime::{AnyClass, AnyObject, Imp, Sel},
        sel, MainThreadMarker,
    };
    use objc2_app_kit::{NSApplication, NSApplicationTerminateReply};
    use tauri::AppHandle;

    static APP: OnceLock<AppHandle> = OnceLock::new();

    /// tao only implements `applicationWillTerminate:`, so `terminate:` (dock
    /// Quit, logout, shutdown, the predefined Quit menu item) kills the process
    /// without any chance to prompt. Answer `NSTerminateCancel` when something is
    /// dirty and run the close flow instead; the process exits by itself once
    /// every window has been closed.
    unsafe extern "C-unwind" fn application_should_terminate(
        _this: *mut AnyObject,
        _cmd: Sel,
        _sender: *mut AnyObject,
    ) -> NSApplicationTerminateReply {
        let Some(app) = APP.get() else {
            return NSApplicationTerminateReply::TerminateNow;
        };
        if !crate::sessions::any_window_dirty(app) {
            return NSApplicationTerminateReply::TerminateNow;
        }
        super::close_all_windows(app);
        NSApplicationTerminateReply::TerminateCancel
    }

    /// Must run on the main thread after the event loop created its delegate
    /// (i.e. from `setup`).
    pub fn install_terminate_hook(app: &AppHandle) {
        let _ = APP.set(app.clone());

        let Some(mtm) = MainThreadMarker::new() else {
            eprintln!("Terminate hook must be installed from the main thread");
            return;
        };
        let ns_app = NSApplication::sharedApplication(mtm);
        let Some(delegate) = ns_app.delegate() else {
            eprintln!("NSApplication has no delegate; terminate hook not installed");
            return;
        };
        let object: &AnyObject = delegate.as_ref();
        let class: &AnyClass = object.class();

        // Method signature: `NSApplicationTerminateReply (id self, SEL _cmd, NSApplication *sender)`.
        let types = CString::new(format!("{}@:@", NSApplicationTerminateReply::ENCODING))
            .expect("static encoding has no interior NUL");
        let imp: Imp = unsafe {
            std::mem::transmute::<
                unsafe extern "C-unwind" fn(
                    *mut AnyObject,
                    Sel,
                    *mut AnyObject,
                ) -> NSApplicationTerminateReply,
                Imp,
            >(application_should_terminate)
        };

        let added = unsafe {
            objc2::ffi::class_addMethod(
                class as *const AnyClass as *mut AnyClass,
                sel!(applicationShouldTerminate:),
                imp,
                types.as_ptr(),
            )
        };
        if !added.as_bool() {
            // The delegate already implements the selector (a newer tao); in that
            // case the quit goes through `ExitRequested` and is guarded there.
            eprintln!("applicationShouldTerminate: already defined; relying on ExitRequested");
        }
    }
}
