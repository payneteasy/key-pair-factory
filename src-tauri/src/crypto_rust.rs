//! Off-Apple crypto backend — pure-Rust RSA + PBES2 via RustCrypto.
//!
//! Compiled on every platform EXCEPT macOS (selected by the `path` attribute on
//! `mod crypto` in `keygen.rs`, with `rsa`/`rand` gated to non-macOS in
//! `Cargo.toml`). On macOS, `crypto_apple.rs` is used instead so the build
//! contains no bundled cryptographic algorithm.
//!
//! The public surface mirrors `crypto_apple.rs` exactly:
//! `generate` / `public_spki_pem` / `private_pkcs8_pem` / `private_pkcs1_pem`.
//! The encrypted PKCS#8 uses the SAME scheme as the Apple backend —
//! PBES2(PBKDF2-HMAC-SHA256, AES-256-CBC) — so the output format is identical
//! across platforms and is readable by OpenSSL everywhere. (We build the PBES2
//! parameters explicitly rather than using `to_pkcs8_encrypted_pem`, whose
//! default is scrypt — which some OpenSSL builds refuse to decrypt.)

use der::EncodePem;
use pkcs5::pbes2;
use pkcs5::EncryptionScheme;
use pkcs8::EncryptedPrivateKeyInfo;
use rand::rngs::OsRng;
use rand::RngCore;
use rsa::pkcs1::EncodeRsaPrivateKey;
use rsa::pkcs8::{EncodePrivateKey, EncodePublicKey, LineEnding};
use rsa::{RsaPrivateKey, RsaPublicKey};
use zeroize::Zeroizing;

use crate::error::KeyGenError;

/// Must match `crypto_apple.rs` so encrypted keys look identical on every OS.
const PBKDF2_ITERATIONS: u32 = 600_000;
const SALT_LEN: usize = 16;
const AES_BLOCK: usize = 16;

/// Opaque key handle — wraps the generated RSA private key.
pub struct Key {
    private: RsaPrivateKey,
}

/// Generate an RSA private key of `bits` length using the OS CSPRNG.
pub fn generate(bits: u32) -> Result<Key, KeyGenError> {
    let mut rng = OsRng;
    let private = RsaPrivateKey::new(&mut rng, bits as usize)
        .map_err(|e| KeyGenError::RngFailure(e.to_string()))?;
    Ok(Key { private })
}

/// Public key as SPKI (`PUBLIC KEY`) PEM.
pub fn public_spki_pem(key: &Key) -> Result<String, KeyGenError> {
    RsaPublicKey::from(&key.private)
        .to_public_key_pem(LineEnding::LF)
        .map_err(|e| KeyGenError::EncodingFailure(e.to_string()))
}

/// Private key as PKCS#8 (`PRIVATE KEY`) PEM, or PBES2-encrypted
/// (`ENCRYPTED PRIVATE KEY`) when a non-empty password is supplied.
pub fn private_pkcs8_pem(
    key: &Key,
    password: Option<&str>,
) -> Result<Zeroizing<String>, KeyGenError> {
    match password {
        Some(pw) if !pw.is_empty() => {
            // Plain PKCS#8 DER is the plaintext that gets encrypted.
            let plaintext = key
                .private
                .to_pkcs8_der()
                .map_err(|e| KeyGenError::EncodingFailure(e.to_string()))?;

            let mut salt = [0u8; SALT_LEN];
            let mut iv = [0u8; AES_BLOCK];
            OsRng.fill_bytes(&mut salt);
            OsRng.fill_bytes(&mut iv);

            let params = pbes2::Parameters::pbkdf2_sha256_aes256cbc(PBKDF2_ITERATIONS, &salt, &iv)
                .map_err(|e| KeyGenError::EncodingFailure(e.to_string()))?;
            let ciphertext = params
                .encrypt(pw.as_bytes(), plaintext.as_bytes())
                .map_err(|e| KeyGenError::EncodingFailure(e.to_string()))?;

            let epki = EncryptedPrivateKeyInfo {
                encryption_algorithm: EncryptionScheme::Pbes2(params),
                encrypted_data: &ciphertext,
            };
            epki.to_pem(LineEnding::LF)
                .map(Zeroizing::new)
                .map_err(|e| KeyGenError::EncodingFailure(e.to_string()))
        }
        _ => key
            .private
            .to_pkcs8_pem(LineEnding::LF)
            .map_err(|e| KeyGenError::EncodingFailure(e.to_string())),
    }
}

/// Private key as PKCS#1 (`RSA PRIVATE KEY`) PEM — always unencrypted.
pub fn private_pkcs1_pem(key: &Key) -> Result<Zeroizing<String>, KeyGenError> {
    key.private
        .to_pkcs1_pem(LineEnding::LF)
        .map_err(|e| KeyGenError::EncodingFailure(e.to_string()))
}
