use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::error::KeyGenError;

/// Atomically write `contents` to `path` (temp file in the same dir → rename),
/// with owner-only permissions (`0o600`) on Unix. On Windows the file inherits
/// the user-profile ACL, which is already user-scoped.
pub fn write_secure(path: &Path, contents: &[u8]) -> Result<(), KeyGenError> {
    let dir = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));

    fs::create_dir_all(&dir)?;

    let mut tmp = tempfile::NamedTempFile::new_in(&dir)?;
    tmp.write_all(contents)?;
    tmp.flush()?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tmp.as_file()
            .set_permissions(fs::Permissions::from_mode(0o600))?;
    }

    tmp.persist(path)
        .map_err(|e| KeyGenError::WriteFailure(e.error.to_string()))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }

    Ok(())
}

/// RAII guard that deletes already-written files if generation fails or panics
/// partway through, so we never leave a half-written key set behind.
pub struct CleanupGuard {
    paths: Vec<PathBuf>,
    committed: bool,
}

impl CleanupGuard {
    pub fn new() -> Self {
        CleanupGuard {
            paths: Vec::new(),
            committed: false,
        }
    }

    pub fn track(&mut self, path: PathBuf) {
        self.paths.push(path);
    }

    pub fn commit(&mut self) {
        self.committed = true;
    }
}

impl Drop for CleanupGuard {
    fn drop(&mut self) {
        if !self.committed {
            for p in &self.paths {
                let _ = fs::remove_file(p);
            }
        }
    }
}
