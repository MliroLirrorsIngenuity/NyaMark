use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    thread,
    time::{Duration, Instant},
};

use anyhow::{anyhow, Context, Result};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

const UPDATER_FLAG: &str = "--nyamark-updater";
const EVENT_STATUS: &str = "nyamark-updater://status";

#[derive(Clone)]
#[cfg_attr(not(any(target_os = "windows", target_os = "macos")), allow(dead_code))]
struct UpdatePayload {
    asset_url: String,
    asset_name: String,
    app_exe: PathBuf,
    parent_pid: Option<u32>,
}

#[derive(Clone, Serialize)]
struct UpdaterStatus {
    phase: &'static str,
    message: String,
    error: bool,
}

pub fn is_updater_mode() -> bool {
    env::args().any(|arg| arg == UPDATER_FLAG)
}

#[tauri::command]
pub fn start_update(app: AppHandle, asset_url: String, asset_name: String) -> Result<(), String> {
    launch_update_helper(&asset_url, &asset_name).map_err(|error| error.to_string())?;

    thread::spawn(move || {
        thread::sleep(Duration::from_millis(250));
        app.exit(0);
    });

    Ok(())
}

pub fn run_updater() {
    let payload = match parse_payload() {
        Ok(payload) => payload,
        Err(error) => {
            eprintln!("Invalid updater payload: {error}");
            return;
        }
    };

    tauri::Builder::default()
        .setup(move |app| {
            let handle = app.handle().clone();
            let payload = payload.clone();
            thread::spawn(move || run_update_task(handle, payload));
            Ok(())
        })
        .build(tauri::generate_context!("tauri.updater.conf.json"))
        .expect("error while building updater")
        .run(|_app, _event| {});
}

fn launch_update_helper(asset_url: &str, asset_name: &str) -> Result<()> {
    if !is_supported_update_asset(asset_name) {
        return Err(anyhow!("Unsupported updater asset: {asset_name}"));
    }

    let current_exe = env::current_exe().context("failed to resolve current executable")?;
    let helper_path = helper_path()?;
    if let Some(parent) = helper_path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create updater directory {}", parent.display()))?;
    }

    fs::copy(&current_exe, &helper_path).with_context(|| {
        format!(
            "failed to copy updater helper from {} to {}",
            current_exe.display(),
            helper_path.display()
        )
    })?;
    set_executable_permissions(&helper_path)?;

    Command::new(&helper_path)
        .arg(UPDATER_FLAG)
        .arg("--asset-url")
        .arg(asset_url)
        .arg("--asset-name")
        .arg(asset_name)
        .arg("--app-exe")
        .arg(current_exe)
        .arg("--parent-pid")
        .arg(std::process::id().to_string())
        .spawn()
        .with_context(|| format!("failed to launch updater {}", helper_path.display()))?;

    Ok(())
}

fn helper_path() -> Result<PathBuf> {
    let extension = env::consts::EXE_EXTENSION;
    let file_name = if extension.is_empty() {
        format!("NyaMark-Updater-{}", std::process::id())
    } else {
        format!("NyaMark-Updater-{}.{}", std::process::id(), extension)
    };
    Ok(env::temp_dir().join("nyamark-updater").join(file_name))
}

#[cfg(unix)]
fn set_executable_permissions(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;

    let mut permissions = fs::metadata(path)
        .with_context(|| format!("failed to inspect {}", path.display()))?
        .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions)
        .with_context(|| format!("failed to make {} executable", path.display()))
}

#[cfg(not(unix))]
fn set_executable_permissions(_path: &Path) -> Result<()> {
    Ok(())
}

fn is_supported_update_asset(asset_name: &str) -> bool {
    let lower = asset_name.to_ascii_lowercase();
    if cfg!(target_os = "windows") {
        return lower.ends_with(".msi") || lower.ends_with(".exe");
    }
    if cfg!(target_os = "macos") {
        return lower.ends_with(".dmg");
    }
    false
}

fn parse_payload() -> Result<UpdatePayload> {
    let args: Vec<String> = env::args().collect();
    let asset_url = required_arg(&args, "--asset-url")?;
    let asset_name = required_arg(&args, "--asset-name")?;
    let app_exe = PathBuf::from(required_arg(&args, "--app-exe")?);
    let parent_pid =
        optional_arg(&args, "--parent-pid").and_then(|value| value.parse::<u32>().ok());

    Ok(UpdatePayload {
        asset_url,
        asset_name,
        app_exe,
        parent_pid,
    })
}

fn required_arg(args: &[String], name: &str) -> Result<String> {
    optional_arg(args, name).ok_or_else(|| anyhow!("missing required argument {name}"))
}

fn optional_arg(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|arg| arg == name)
        .and_then(|index| args.get(index + 1))
        .cloned()
}

fn run_update_task(app: AppHandle, payload: UpdatePayload) {
    let result = run_update_flow(&app, &payload);
    match result {
        Ok(()) => {
            emit_status(&app, "done", "Update complete. Reopening NyaMark...", false);
            thread::sleep(Duration::from_millis(900));
            app.exit(0);
        }
        Err(error) => {
            emit_status(&app, "error", &format!("Update failed: {error}"), true);
        }
    }
}

fn run_update_flow(app: &AppHandle, payload: &UpdatePayload) -> Result<()> {
    emit_status(app, "waiting", "Closing NyaMark...", false);
    wait_for_parent_exit(payload.parent_pid);

    emit_status(app, "downloading", "Downloading update package...", false);
    let installer_path = download_asset(payload)?;

    emit_status(app, "installing", "Installing update...", false);
    install_update(payload, &installer_path)?;

    emit_status(app, "launching", "Opening NyaMark...", false);
    relaunch_app(payload)?;

    Ok(())
}

fn emit_status(app: &AppHandle, phase: &'static str, message: &str, error: bool) {
    let _ = app.emit(
        EVENT_STATUS,
        UpdaterStatus {
            phase,
            message: message.to_string(),
            error,
        },
    );
}

fn wait_for_parent_exit(parent_pid: Option<u32>) {
    let Some(pid) = parent_pid else {
        thread::sleep(Duration::from_secs(2));
        return;
    };

    let deadline = Instant::now() + Duration::from_secs(20);
    while Instant::now() < deadline {
        if !process_is_running(pid) {
            return;
        }
        thread::sleep(Duration::from_millis(250));
    }
}

#[cfg(target_os = "windows")]
fn process_is_running(pid: u32) -> bool {
    let output = Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/NH"])
        .output();
    output
        .map(|output| String::from_utf8_lossy(&output.stdout).contains(&pid.to_string()))
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn process_is_running(pid: u32) -> bool {
    Command::new("/bin/kill")
        .args(["-0", &pid.to_string()])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn process_is_running(_pid: u32) -> bool {
    false
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn download_asset(payload: &UpdatePayload) -> Result<PathBuf> {
    let installer_dir = env::temp_dir().join("nyamark-update-package");
    fs::create_dir_all(&installer_dir).with_context(|| {
        format!(
            "failed to create update package directory {}",
            installer_dir.display()
        )
    })?;
    let installer_path = installer_dir.join(safe_file_name(&payload.asset_name));

    #[cfg(target_os = "windows")]
    {
        let script = concat!(
            "$ProgressPreference='SilentlyContinue';",
            "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;",
            "Invoke-WebRequest -Uri $args[0] -OutFile $args[1] -UseBasicParsing"
        );
        run_command(
            Command::new("powershell")
                .args([
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-Command",
                    script,
                ])
                .arg(&payload.asset_url)
                .arg(&installer_path),
            "download update with PowerShell",
        )?;
    }

    #[cfg(target_os = "macos")]
    {
        run_command(
            Command::new("/usr/bin/curl")
                .args(["-L", "--fail", "--show-error", "--output"])
                .arg(&installer_path)
                .arg(&payload.asset_url),
            "download update with curl",
        )?;
    }

    Ok(installer_path)
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn download_asset(_payload: &UpdatePayload) -> Result<PathBuf> {
    Err(anyhow!(
        "automatic updater is not supported on this platform"
    ))
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn safe_file_name(file_name: &str) -> String {
    file_name
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

#[cfg(target_os = "windows")]
fn install_update(_payload: &UpdatePayload, installer_path: &Path) -> Result<()> {
    let lower = installer_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if lower.ends_with(".msi") {
        run_command(
            Command::new("msiexec")
                .arg("/i")
                .arg(installer_path)
                .args(["/qn", "/norestart"]),
            "run MSI installer",
        )
    } else if lower.ends_with(".exe") {
        run_command(Command::new(installer_path).arg("/S"), "run NSIS installer")
    } else {
        Err(anyhow!(
            "unsupported Windows installer {}",
            installer_path.display()
        ))
    }
}

#[cfg(target_os = "macos")]
fn install_update(payload: &UpdatePayload, installer_path: &Path) -> Result<()> {
    let app_bundle = app_bundle_from_exe(&payload.app_exe).ok_or_else(|| {
        anyhow!(
            "could not resolve NyaMark.app from {}",
            payload.app_exe.display()
        )
    })?;
    let mount_dir = env::temp_dir().join(format!("nyamark-update-mount-{}", std::process::id()));
    let _ = fs::remove_dir_all(&mount_dir);
    fs::create_dir_all(&mount_dir)
        .with_context(|| format!("failed to create mount directory {}", mount_dir.display()))?;

    run_command(
        Command::new("/usr/bin/hdiutil")
            .args(["attach", "-nobrowse", "-quiet", "-mountpoint"])
            .arg(&mount_dir)
            .arg(installer_path),
        "mount DMG",
    )?;

    let result = (|| {
        let new_app = find_app_bundle(&mount_dir)
            .ok_or_else(|| anyhow!("no .app bundle found inside {}", installer_path.display()))?;
        if app_bundle.exists() {
            fs::remove_dir_all(&app_bundle)
                .with_context(|| format!("failed to remove {}", app_bundle.display()))?;
        }
        run_command(
            Command::new("/usr/bin/ditto")
                .arg(&new_app)
                .arg(&app_bundle),
            "copy app bundle from DMG",
        )
    })();

    let _ = Command::new("/usr/bin/hdiutil")
        .args(["detach", "-quiet"])
        .arg(&mount_dir)
        .status();

    if let Err(error) = result {
        let _ = Command::new("/usr/bin/open").arg(installer_path).spawn();
        return Err(error.context("opened DMG for manual installation"));
    }

    Ok(())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn install_update(_payload: &UpdatePayload, _installer_path: &Path) -> Result<()> {
    Err(anyhow!(
        "automatic updater is not supported on this platform"
    ))
}

#[cfg(target_os = "macos")]
fn app_bundle_from_exe(exe: &Path) -> Option<PathBuf> {
    let macos_dir = exe.parent()?;
    if macos_dir.file_name()?.to_str()? != "MacOS" {
        return None;
    }
    let contents_dir = macos_dir.parent()?;
    if contents_dir.file_name()?.to_str()? != "Contents" {
        return None;
    }
    let app_bundle = contents_dir.parent()?.to_path_buf();
    if app_bundle.extension()?.to_str()? == "app" {
        Some(app_bundle)
    } else {
        None
    }
}

#[cfg(target_os = "macos")]
fn find_app_bundle(dir: &Path) -> Option<PathBuf> {
    for entry in fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) == Some("app") {
            return Some(path);
        }
        if path.is_dir() {
            if let Some(app) = find_app_bundle(&path) {
                return Some(app);
            }
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn relaunch_app(payload: &UpdatePayload) -> Result<()> {
    Command::new(&payload.app_exe)
        .spawn()
        .with_context(|| format!("failed to relaunch {}", payload.app_exe.display()))?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn relaunch_app(payload: &UpdatePayload) -> Result<()> {
    if let Some(app_bundle) = app_bundle_from_exe(&payload.app_exe) {
        Command::new("/usr/bin/open")
            .arg(&app_bundle)
            .spawn()
            .with_context(|| format!("failed to open {}", app_bundle.display()))?;
        return Ok(());
    }

    Command::new(&payload.app_exe)
        .spawn()
        .with_context(|| format!("failed to relaunch {}", payload.app_exe.display()))?;
    Ok(())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn relaunch_app(_payload: &UpdatePayload) -> Result<()> {
    Ok(())
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn run_command(command: &mut Command, description: &str) -> Result<()> {
    let status = command
        .status()
        .with_context(|| format!("failed to {description}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(anyhow!("{description} exited with status {status}"))
    }
}
