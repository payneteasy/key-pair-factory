use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::KeyGenError;
use crate::filesystem::{write_secure, CleanupGuard};

// Platform-selected crypto backend. macOS performs all cryptography via Apple's
// OS (no bundled algorithm — see `crypto_apple.rs`); every other platform uses
// the pure-Rust RustCrypto implementation. Both expose the same four functions.
#[cfg_attr(target_os = "macos", path = "crypto_apple.rs")]
#[cfg_attr(not(target_os = "macos"), path = "crypto_rust.rs")]
mod crypto;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateInput {
    pub merchant_slug: String,
    pub password: Option<String>,
    pub bits: u32,
    pub also_pkcs1: bool,
    pub production: bool,
    pub folder: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateOutput {
    pub private_pem: String,
    pub private_pkcs1_pem: Option<String>,
    pub public_pem: String,
    pub files: Vec<PathBuf>,
}

/// Compute the (private PKCS#8, public, private PKCS#1) target file names.
fn target_names(slug: &str, production: bool) -> (String, String, String) {
    let prod = if production { "_prod" } else { "" };
    (
        format!("{slug}{prod}_private.pem"),
        format!("{slug}{prod}_public.pem"),
        format!("{slug}{prod}_private_pkcs1.pem"),
    )
}

/// Absolute paths of the files this input would write that already exist on
/// disk — so the UI can warn before overwriting. Empty slug → no files.
pub fn existing_target_files(input: &GenerateInput) -> Vec<PathBuf> {
    let slug = input.merchant_slug.trim();
    if slug.is_empty() {
        return Vec::new();
    }
    let (private_name, public_name, pkcs1_name) = target_names(slug, input.production);
    let folder = PathBuf::from(&input.folder);
    let mut candidates = vec![folder.join(private_name), folder.join(public_name)];
    if input.also_pkcs1 {
        candidates.push(folder.join(pkcs1_name));
    }
    candidates.into_iter().filter(|p| p.exists()).collect()
}

/// Run the full generate-and-write flow. `progress(index)` is invoked at the
/// start of each visual phase; the indices line up with the frontend's phase
/// list (which omits the PKCS#1 phase when `also_pkcs1` is false).
pub fn generate(
    input: GenerateInput,
    progress: impl Fn(u32),
) -> Result<GenerateOutput, KeyGenError> {
    // 1. Validate.
    let slug = input.merchant_slug.trim().to_string();
    if slug.is_empty() {
        return Err(KeyGenError::InvalidSlug);
    }
    if !matches!(input.bits, 2048 | 3072 | 4096) {
        return Err(KeyGenError::InvalidBits);
    }
    let folder = PathBuf::from(&input.folder);
    std::fs::create_dir_all(&folder)
        .map_err(|e| KeyGenError::FolderNotWritable(format!("{}: {e}", folder.display())))?;

    let (private_name, public_name, pkcs1_name) = target_names(&slug, input.production);

    // Phase 0 — entropy pool.
    progress(0);

    // 2. Generate the private key (phase 1 — the long one).
    progress(1);
    let key = crypto::generate(input.bits)?;

    // 3. Derive + encode the public key (phase 2).
    progress(2);
    let public_pem = crypto::public_spki_pem(&key)?;

    // 4. Encode PKCS#8 PEM (phase 3) — encrypted if a password was supplied.
    progress(3);
    let password = input.password.as_deref().filter(|p| !p.is_empty());
    let private_pkcs8 = crypto::private_pkcs8_pem(&key, password)?;

    // 5. Optional PKCS#1 container (phase 4 when enabled). PKCS#1 is always
    //    unencrypted — it's intended for the documentation request builders.
    let private_pkcs1 = if input.also_pkcs1 {
        progress(4);
        Some(crypto::private_pkcs1_pem(&key)?)
    } else {
        None
    };

    // 7 + 8. Write files atomically with restrictive permissions (final phase).
    let write_phase = if input.also_pkcs1 { 5 } else { 4 };
    progress(write_phase);

    let mut guard = CleanupGuard::new();
    let mut files: Vec<PathBuf> = Vec::new();

    let private_path = folder.join(&private_name);
    write_secure(&private_path, private_pkcs8.as_bytes())?;
    guard.track(private_path.clone());
    files.push(private_path);

    if let Some(pkcs1) = &private_pkcs1 {
        let pkcs1_path = folder.join(&pkcs1_name);
        write_secure(&pkcs1_path, pkcs1.as_bytes())?;
        guard.track(pkcs1_path.clone());
        files.push(pkcs1_path);
    }

    let public_path = folder.join(&public_name);
    write_secure(&public_path, public_pem.as_bytes())?;
    guard.track(public_path.clone());
    files.push(public_path);

    guard.commit();

    // Copy out plain strings for the UI. The backend returns `Zeroizing<String>`
    // for the secret PEMs, so the source buffers are wiped when they drop at the
    // end of this function.
    let private_pem_out = private_pkcs8.to_string();
    let private_pkcs1_out = private_pkcs1.as_ref().map(|p| p.to_string());

    Ok(GenerateOutput {
        private_pem: private_pem_out,
        private_pkcs1_pem: private_pkcs1_out,
        public_pem,
        files,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    /// Run `openssl` against a key file. Returns `None` if the `openssl` binary
    /// is unavailable (so the assertion is skipped on hosts without it), else
    /// `Some(success)`. This is a backend-agnostic correctness oracle: it proves
    /// the output is readable by OpenSSL — which is what Payneteasy consumes.
    fn openssl_ok(args: &[&str]) -> Option<bool> {
        match Command::new("openssl").args(args).output() {
            Ok(out) => Some(out.status.success()),
            Err(_) => None,
        }
    }

    /// Capture `openssl`'s stdout, or `None` if the binary is unavailable.
    fn openssl_out(args: &[&str]) -> Option<String> {
        match Command::new("openssl").args(args).output() {
            Ok(out) if out.status.success() => Some(String::from_utf8_lossy(&out.stdout).into()),
            _ => None,
        }
    }

    fn input(
        folder: &std::path::Path,
        password: Option<&str>,
        also_pkcs1: bool,
        production: bool,
    ) -> GenerateInput {
        GenerateInput {
            merchant_slug: "acme_payments".into(),
            password: password.map(|s| s.to_string()),
            bits: 2048, // smaller than the 4096 default to keep tests fast
            also_pkcs1,
            production,
            folder: folder.to_string_lossy().to_string(),
        }
    }

    #[test]
    fn plain_pkcs8_and_public_headers() {
        let dir = tempfile::tempdir().unwrap();
        let out = generate(input(dir.path(), None, false, false), |_| {}).unwrap();

        assert!(out.private_pem.starts_with("-----BEGIN PRIVATE KEY-----"));
        assert!(out.public_pem.starts_with("-----BEGIN PUBLIC KEY-----"));
        assert!(out.private_pkcs1_pem.is_none());
        assert_eq!(out.files.len(), 2);

        // Files actually exist on disk with the expected names.
        assert!(dir.path().join("acme_payments_private.pem").exists());
        assert!(dir.path().join("acme_payments_public.pem").exists());
    }

    #[test]
    fn pkcs1_container_has_rsa_header() {
        let dir = tempfile::tempdir().unwrap();
        let out = generate(input(dir.path(), None, true, false), |_| {}).unwrap();

        let pkcs1 = out.private_pkcs1_pem.expect("pkcs1 requested");
        assert!(pkcs1.starts_with("-----BEGIN RSA PRIVATE KEY-----"));
        assert_eq!(out.files.len(), 3);
        assert!(dir.path().join("acme_payments_private_pkcs1.pem").exists());
    }

    #[test]
    fn production_suffix_applied() {
        let dir = tempfile::tempdir().unwrap();
        let out = generate(input(dir.path(), None, false, true), |_| {}).unwrap();
        assert!(dir.path().join("acme_payments_prod_private.pem").exists());
        assert!(dir.path().join("acme_payments_prod_public.pem").exists());
        assert!(out.private_pem.starts_with("-----BEGIN PRIVATE KEY-----"));
    }

    #[test]
    fn encrypted_pkcs8_round_trips_with_password() {
        let dir = tempfile::tempdir().unwrap();
        let out = generate(
            input(dir.path(), Some("hunter2-strong"), false, false),
            |_| {},
        )
        .unwrap();

        assert!(out
            .private_pem
            .starts_with("-----BEGIN ENCRYPTED PRIVATE KEY-----"));

        // The encrypted key must decrypt with the supplied password — and fail
        // with the wrong one — when read by OpenSSL.
        let path = dir.path().join("acme_payments_private.pem");
        let p = path.to_str().unwrap();
        if let Some(ok) =
            openssl_ok(&["pkey", "-in", p, "-passin", "pass:hunter2-strong", "-noout"])
        {
            assert!(ok, "encrypted PEM should decrypt with the right password");
            let bad = openssl_ok(&["pkey", "-in", p, "-passin", "pass:wrong", "-noout"]).unwrap();
            assert!(!bad, "wrong password must not decrypt");
        }
    }

    #[test]
    fn public_key_corresponds_to_private() {
        // Catches any ASN.1-assembly bug that would emit a public key not
        // matching the private one: derive the public from the private via
        // OpenSSL and compare it to what we wrote.
        let dir = tempfile::tempdir().unwrap();
        let out = generate(input(dir.path(), None, false, false), |_| {}).unwrap();
        let priv_path = dir.path().join("acme_payments_private.pem");

        if let Some(derived) = openssl_out(&["pkey", "-in", priv_path.to_str().unwrap(), "-pubout"])
        {
            assert_eq!(
                derived.trim(),
                out.public_pem.trim(),
                "emitted public key must match the one derived from the private key"
            );
        }
    }

    #[test]
    fn plain_outputs_are_openssl_readable() {
        let dir = tempfile::tempdir().unwrap();
        generate(input(dir.path(), None, true, false), |_| {}).unwrap();
        let priv8 = dir.path().join("acme_payments_private.pem");
        let public = dir.path().join("acme_payments_public.pem");
        let pkcs1 = dir.path().join("acme_payments_private_pkcs1.pem");

        if let Some(ok) = openssl_ok(&["pkey", "-in", priv8.to_str().unwrap(), "-noout"]) {
            assert!(ok, "plain PKCS#8 should parse with openssl");
            assert!(
                openssl_ok(&["pkey", "-pubin", "-in", public.to_str().unwrap(), "-noout"]).unwrap(),
                "SPKI public should parse with openssl"
            );
            assert!(
                openssl_ok(&["rsa", "-in", pkcs1.to_str().unwrap(), "-noout"]).unwrap(),
                "PKCS#1 should parse with openssl"
            );
        }
    }

    #[test]
    fn rejects_invalid_bits_and_empty_slug() {
        let dir = tempfile::tempdir().unwrap();

        let mut bad_bits = input(dir.path(), None, false, false);
        bad_bits.bits = 1234;
        assert!(matches!(
            generate(bad_bits, |_| {}),
            Err(KeyGenError::InvalidBits)
        ));

        let mut empty = input(dir.path(), None, false, false);
        empty.merchant_slug = "   ".into();
        assert!(matches!(
            generate(empty, |_| {}),
            Err(KeyGenError::InvalidSlug)
        ));
    }

    #[test]
    fn existing_target_files_reports_written_keys() {
        let dir = tempfile::tempdir().unwrap();
        // Nothing written yet.
        assert!(existing_target_files(&input(dir.path(), None, true, false)).is_empty());
        // After generating (with PKCS#1), all three targets are reported.
        generate(input(dir.path(), None, true, false), |_| {}).unwrap();
        assert_eq!(
            existing_target_files(&input(dir.path(), None, true, false)).len(),
            3
        );
        // A different slug shares no files.
        let mut other = input(dir.path(), None, true, false);
        other.merchant_slug = "other_merchant".into();
        assert!(existing_target_files(&other).is_empty());
    }
}
