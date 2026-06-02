mod error;
mod filesystem;
mod keygen;

use std::path::{Path, PathBuf};
use tauri::Emitter;

/// Long-running RSA generation. Runs on a blocking worker thread (never the UI
/// thread) and emits `keygen-progress` (a phase index) at the start of each
/// phase so the Generate screen can advance its log.
#[tauri::command]
async fn generate_key_pair(
    window: tauri::Window,
    input: keygen::GenerateInput,
) -> Result<keygen::GenerateOutput, error::KeyGenError> {
    tauri::async_runtime::spawn_blocking(move || {
        keygen::generate(input, move |idx| {
            let _ = window.emit("keygen-progress", idx);
        })
    })
    .await
    .map_err(|e| error::KeyGenError::RngFailure(format!("worker thread failed: {e}")))?
}

/// Absolute paths of target files that already exist for these inputs, so the
/// UI can warn before overwriting them.
#[tauri::command]
fn existing_target_files(input: keygen::GenerateInput) -> Vec<String> {
    keygen::existing_target_files(&input)
        .into_iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect()
}

/// Platform default save folder: `<Documents>/Payneteasy Keys`.
#[tauri::command]
fn default_documents_dir() -> String {
    let base = dirs::document_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join("Documents")))
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("Payneteasy Keys").to_string_lossy().to_string()
}

/// Write arbitrary text to a path chosen via the "Save as…" dialog, using the
/// same atomic + restrictive-permission writer as the generated key files.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), error::KeyGenError> {
    filesystem::write_secure(Path::new(&path), contents.as_bytes())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            generate_key_pair,
            existing_target_files,
            default_documents_dir,
            write_text_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
