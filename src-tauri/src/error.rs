use serde::ser::{Serialize, SerializeStruct, Serializer};

/// One app-wide error type for the crypto / filesystem commands.
/// Serialized to the frontend as `{ kind, message }` (see BUILD §6 "Errors").
#[derive(Debug, thiserror::Error)]
pub enum KeyGenError {
    #[error("Project / merchant name is empty after sanitization.")]
    InvalidSlug,

    #[error("Key length must be 2048, 3072 or 4096 bits.")]
    InvalidBits,

    #[error("The chosen folder does not exist or is not writable: {0}")]
    FolderNotWritable(String),

    #[error("Secure random number generator failed: {0}")]
    RngFailure(String),

    #[error("Failed to encode the key: {0}")]
    EncodingFailure(String),

    #[error("Failed to write a key file: {0}")]
    WriteFailure(String),
}

impl KeyGenError {
    fn kind(&self) -> &'static str {
        match self {
            KeyGenError::InvalidSlug => "InvalidSlug",
            KeyGenError::InvalidBits => "InvalidBits",
            KeyGenError::FolderNotWritable(_) => "FolderNotWritable",
            KeyGenError::RngFailure(_) => "RngFailure",
            KeyGenError::EncodingFailure(_) => "EncodingFailure",
            KeyGenError::WriteFailure(_) => "WriteFailure",
        }
    }
}

impl Serialize for KeyGenError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut s = serializer.serialize_struct("KeyGenError", 2)?;
        s.serialize_field("kind", self.kind())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

impl From<std::io::Error> for KeyGenError {
    fn from(e: std::io::Error) -> Self {
        KeyGenError::WriteFailure(e.to_string())
    }
}
