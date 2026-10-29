//! The iOS side of NyaMark's documents: the Swift plugin in `ios/` does the
//! work; Rust reaches it for the reads and writes of the open document.

use std::path::Path;

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_documents);

/// Why a read or write failed, as the Swift side reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ErrorKind {
    Missing,
    Forbidden,
    TooLarge,
    Io,
}

#[derive(Debug, Clone)]
pub struct Error {
    pub kind: ErrorKind,
    pub message: String,
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for Error {}

#[cfg(target_os = "ios")]
impl From<tauri::plugin::mobile::PluginInvokeError> for Error {
    fn from(error: tauri::plugin::mobile::PluginInvokeError) -> Self {
        use tauri::plugin::mobile::PluginInvokeError;
        match error {
            PluginInvokeError::InvokeRejected(response) => Self {
                kind: match response.code.as_deref() {
                    Some("missing") => ErrorKind::Missing,
                    Some("forbidden") => ErrorKind::Forbidden,
                    Some("too-large") => ErrorKind::TooLarge,
                    _ => ErrorKind::Io,
                },
                message: response.message.unwrap_or_default(),
            },
            other => Self {
                kind: ErrorKind::Io,
                message: other.to_string(),
            },
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadRequest<'a> {
    path: &'a str,
    limit: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WriteRequest<'a> {
    path: &'a str,
    data: String,
}

#[derive(Deserialize)]
struct Contents {
    data: String,
}

/// Coordinated file access, so iCloud and other providers see every change.
pub struct Documents<R: Runtime> {
    #[cfg(target_os = "ios")]
    handle: tauri::plugin::PluginHandle<R>,
    #[cfg(not(target_os = "ios"))]
    _runtime: std::marker::PhantomData<fn() -> R>,
}

impl<R: Runtime> Documents<R> {
    /// The file's bytes, downloading it first when iCloud holds it alone.
    pub fn read(&self, path: &Path, limit: u64) -> Result<Vec<u8>, Error> {
        let path = path_str(path)?;
        let contents: Contents = self.run("read", ReadRequest { path, limit })?;
        STANDARD.decode(contents.data).map_err(|error| Error {
            kind: ErrorKind::Io,
            message: error.to_string(),
        })
    }

    /// Replaces the file's contents in one step, or creates it.
    pub fn write(&self, path: &Path, bytes: &[u8]) -> Result<(), Error> {
        let path = path_str(path)?;
        let data = STANDARD.encode(bytes);
        self.run::<serde::de::IgnoredAny>("write", WriteRequest { path, data })
            .map(|_| ())
    }

    #[cfg(target_os = "ios")]
    fn run<T: serde::de::DeserializeOwned>(
        &self,
        command: &str,
        payload: impl Serialize,
    ) -> Result<T, Error> {
        Ok(self.handle.run_mobile_plugin(command, payload)?)
    }

    #[cfg(not(target_os = "ios"))]
    fn run<T: serde::de::DeserializeOwned>(
        &self,
        _command: &str,
        _payload: impl Serialize,
    ) -> Result<T, Error> {
        Err(Error {
            kind: ErrorKind::Io,
            message: "Document access through the documents plugin needs iOS".into(),
        })
    }
}

fn path_str(path: &Path) -> Result<&str, Error> {
    path.to_str().ok_or_else(|| Error {
        kind: ErrorKind::Io,
        message: format!("Not a UTF-8 path: {}", path.display()),
    })
}

pub trait DocumentsExt<R: Runtime> {
    fn documents(&self) -> &Documents<R>;
}

impl<R: Runtime, T: Manager<R>> DocumentsExt<R> for T {
    fn documents(&self) -> &Documents<R> {
        self.state::<Documents<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("documents")
        .setup(|app, _api| {
            #[cfg(target_os = "ios")]
            let documents = Documents {
                handle: _api.register_ios_plugin(init_plugin_documents)?,
            };
            #[cfg(not(target_os = "ios"))]
            let documents = Documents::<R> {
                _runtime: std::marker::PhantomData,
            };
            app.manage(documents);
            Ok(())
        })
        .build()
}
