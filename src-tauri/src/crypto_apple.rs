//! macOS crypto backend — ALL cryptography is performed by Apple's OS.
//!
//! * RSA key generation → Security.framework (`SecKeyCreateRandomKey`).
//! * PBKDF2 + AES-256-CBC (PBES2 private-key encryption) → CommonCrypto.
//! * Randomness (salt / IV) → `SecRandomCopyBytes`.
//!
//! This module links those system libraries but implements **no** cryptographic
//! algorithm of its own, which is what lets the macOS / App Store build claim
//! the "uses only encryption within Apple's operating system" export exemption.
//! The RustCrypto `der` / `pkcs8` / `pkcs1` / `spki` / `pkcs5` crates are used
//! ONLY to serialize the ASN.1 / PEM containers — they encode bytes, they do
//! not encrypt. The public surface mirrors `crypto_rust.rs` exactly.

use core_foundation::data::CFData;
use security_framework::key::{GenerateKeyOptions, KeyType, SecKey};

use der::asn1::BitStringRef;
use der::pem::LineEnding;
use der::{Decode, Document, Encode, EncodePem};
use pkcs5::pbes2;
use pkcs5::EncryptionScheme;
use pkcs8::{EncryptedPrivateKeyInfo, PrivateKeyInfo};
use spki::SubjectPublicKeyInfoRef;
use zeroize::Zeroizing;

use crate::error::KeyGenError;

// ── CommonCrypto / Security.framework FFI — the algorithms live in the OS ────
const KCC_PBKDF2: u32 = 2; // CCPBKDFAlgorithm::kCCPBKDF2
const KCC_PRF_HMAC_SHA256: u32 = 3; // CCPseudoRandomAlgorithm::kCCPRFHmacAlgSHA256
const KCC_ENCRYPT: u32 = 0; // CCOperation::kCCEncrypt
const KCC_ALGORITHM_AES: u32 = 0; // CCAlgorithm::kCCAlgorithmAES
const KCC_OPTION_PKCS7_PADDING: u32 = 0x0001;
const KCC_SUCCESS: i32 = 0;

const AES256_KEY_LEN: usize = 32;
const AES_BLOCK: usize = 16;
const SALT_LEN: usize = 16;
/// PBKDF2-HMAC-SHA256 work factor embedded in the PBES2 params (OWASP-tier).
const PBKDF2_ITERATIONS: u32 = 600_000;

extern "C" {
    fn CCKeyDerivationPBKDF(
        algorithm: u32,
        password: *const u8,
        password_len: usize,
        salt: *const u8,
        salt_len: usize,
        prf: u32,
        rounds: u32,
        derived_key: *mut u8,
        derived_key_len: usize,
    ) -> i32;

    fn CCCrypt(
        op: u32,
        alg: u32,
        options: u32,
        key: *const u8,
        key_len: usize,
        iv: *const u8,
        data_in: *const u8,
        data_in_len: usize,
        data_out: *mut u8,
        data_out_avail: usize,
        data_out_moved: *mut usize,
    ) -> i32;

    /// Apple's CSPRNG. `rnd = NULL` selects `kSecRandomDefault`.
    fn SecRandomCopyBytes(rnd: *const core::ffi::c_void, count: usize, bytes: *mut u8) -> i32;
}

fn os_random(buf: &mut [u8]) -> Result<(), KeyGenError> {
    let rc = unsafe { SecRandomCopyBytes(core::ptr::null(), buf.len(), buf.as_mut_ptr()) };
    if rc == 0 {
        Ok(())
    } else {
        Err(KeyGenError::RngFailure(format!(
            "SecRandomCopyBytes failed ({rc})"
        )))
    }
}

fn pbkdf2_sha256(
    password: &[u8],
    salt: &[u8],
    rounds: u32,
) -> Result<Zeroizing<[u8; AES256_KEY_LEN]>, KeyGenError> {
    let mut key = Zeroizing::new([0u8; AES256_KEY_LEN]);
    let rc = unsafe {
        CCKeyDerivationPBKDF(
            KCC_PBKDF2,
            password.as_ptr(),
            password.len(),
            salt.as_ptr(),
            salt.len(),
            KCC_PRF_HMAC_SHA256,
            rounds,
            key.as_mut_ptr(),
            key.len(),
        )
    };
    if rc == KCC_SUCCESS {
        Ok(key)
    } else {
        Err(KeyGenError::EncodingFailure(format!(
            "CCKeyDerivationPBKDF failed ({rc})"
        )))
    }
}

fn aes256_cbc_encrypt(key: &[u8], iv: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, KeyGenError> {
    // PKCS#7 padding can add up to one extra block.
    let mut out = vec![0u8; plaintext.len() + AES_BLOCK];
    let mut moved = 0usize;
    let rc = unsafe {
        CCCrypt(
            KCC_ENCRYPT,
            KCC_ALGORITHM_AES,
            KCC_OPTION_PKCS7_PADDING,
            key.as_ptr(),
            key.len(),
            iv.as_ptr(),
            plaintext.as_ptr(),
            plaintext.len(),
            out.as_mut_ptr(),
            out.len(),
            &mut moved,
        )
    };
    if rc == KCC_SUCCESS {
        out.truncate(moved);
        Ok(out)
    } else {
        Err(KeyGenError::EncodingFailure(format!(
            "CCCrypt(AES-256-CBC) failed ({rc})"
        )))
    }
}

// ── Key handle ───────────────────────────────────────────────────────────────

/// Opaque key handle — holds the OS key plus its exported PKCS#1 DER so we can
/// emit every container form without re-exporting. The DER is zeroized on drop.
pub struct Key {
    sec_key: SecKey,
    private_pkcs1_der: Zeroizing<Vec<u8>>,
}

fn export(key: &SecKey) -> Result<CFData, KeyGenError> {
    key.external_representation()
        .ok_or_else(|| KeyGenError::EncodingFailure("key is not exportable".into()))
}

/// Generate a transient (non-keychain) RSA key of `bits` length via the OS.
pub fn generate(bits: u32) -> Result<Key, KeyGenError> {
    let mut opts = GenerateKeyOptions::default();
    opts.set_key_type(KeyType::rsa()).set_size_in_bits(bits);
    // No `location` is set → `kSecAttrIsPermanent = false`: the key is not
    // stored in the keychain, it lives only for the lifetime of this handle.
    let sec_key = SecKey::new(&opts)
        .map_err(|e| KeyGenError::RngFailure(format!("SecKeyCreateRandomKey: {e}")))?;
    let der = export(&sec_key)?;
    Ok(Key {
        sec_key,
        private_pkcs1_der: Zeroizing::new(der.bytes().to_vec()),
    })
}

/// Public key as SPKI (`PUBLIC KEY`) PEM. The OS exports the public key as
/// PKCS#1 `RSAPublicKey`; we wrap it in a SubjectPublicKeyInfo.
pub fn public_spki_pem(key: &Key) -> Result<String, KeyGenError> {
    let public = key
        .sec_key
        .public_key()
        .ok_or_else(|| KeyGenError::EncodingFailure("cannot derive public key".into()))?;
    let der = export(&public)?;
    let spki = SubjectPublicKeyInfoRef {
        algorithm: pkcs1::ALGORITHM_ID,
        subject_public_key: BitStringRef::from_bytes(der.bytes())
            .map_err(|e| KeyGenError::EncodingFailure(e.to_string()))?,
    };
    spki.to_pem(LineEnding::LF)
        .map_err(|e| KeyGenError::EncodingFailure(e.to_string()))
}

/// Plain PKCS#8 `PrivateKeyInfo` DER (rsaEncryption + the PKCS#1 body).
fn private_pkcs8_der(key: &Key) -> Result<Zeroizing<Vec<u8>>, KeyGenError> {
    PrivateKeyInfo::new(pkcs1::ALGORITHM_ID, key.private_pkcs1_der.as_slice())
        .to_der()
        .map(Zeroizing::new)
        .map_err(|e| KeyGenError::EncodingFailure(e.to_string()))
}

/// Private key as PKCS#8 (`PRIVATE KEY`) PEM, or PBES2-encrypted
/// (`ENCRYPTED PRIVATE KEY`) when a non-empty password is supplied. The KDF and
/// cipher run in the OS (CommonCrypto); the `pkcs5`/`pkcs8` crates only encode
/// the resulting bytes into the standard EncryptedPrivateKeyInfo structure.
pub fn private_pkcs8_pem(
    key: &Key,
    password: Option<&str>,
) -> Result<Zeroizing<String>, KeyGenError> {
    match password {
        Some(pw) if !pw.is_empty() => {
            let plaintext = private_pkcs8_der(key)?;

            let mut salt = [0u8; SALT_LEN];
            let mut iv = [0u8; AES_BLOCK];
            os_random(&mut salt)?;
            os_random(&mut iv)?;

            let derived = pbkdf2_sha256(pw.as_bytes(), &salt, PBKDF2_ITERATIONS)?;
            let ciphertext = aes256_cbc_encrypt(&derived[..], &iv, &plaintext)?;

            let params = pbes2::Parameters::pbkdf2_sha256_aes256cbc(PBKDF2_ITERATIONS, &salt, &iv)
                .map_err(|e| KeyGenError::EncodingFailure(e.to_string()))?;
            let epki = EncryptedPrivateKeyInfo {
                encryption_algorithm: EncryptionScheme::Pbes2(params),
                encrypted_data: &ciphertext,
            };
            epki.to_pem(LineEnding::LF)
                .map(Zeroizing::new)
                .map_err(|e| KeyGenError::EncodingFailure(e.to_string()))
        }
        _ => PrivateKeyInfo::new(pkcs1::ALGORITHM_ID, key.private_pkcs1_der.as_slice())
            .to_pem(LineEnding::LF)
            .map(Zeroizing::new)
            .map_err(|e| KeyGenError::EncodingFailure(e.to_string())),
    }
}

/// Private key as PKCS#1 (`RSA PRIVATE KEY`) PEM — the OS export, PEM-wrapped.
pub fn private_pkcs1_pem(key: &Key) -> Result<Zeroizing<String>, KeyGenError> {
    Document::from_der(&key.private_pkcs1_der)
        .and_then(|doc| doc.to_pem("RSA PRIVATE KEY", LineEnding::LF))
        .map(Zeroizing::new)
        .map_err(|e| KeyGenError::EncodingFailure(e.to_string()))
}
