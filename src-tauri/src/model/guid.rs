//! TWUI GUID generation.
//!
//! TWUI uses uppercase hex grouped 8-4-4-16 (three hyphens, 16-char final
//! group), e.g. `5BA533E1-A6E4-4513-B5D9D5E2FE9AFF99`. This is NOT a standard
//! UUID grouping, so we hand-format 16 random bytes.

use rand::RngCore;

// Backend GUID generator, exercised by the test below; retained for backend-side mutations.
#[allow(dead_code)]
pub fn new_guid() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    let hex: String = bytes.iter().map(|b| format!("{:02X}", b)).collect();
    format!(
        "{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..32]
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guid_shape() {
        let g = new_guid();
        let parts: Vec<&str> = g.split('-').collect();
        assert_eq!(parts.len(), 4);
        assert_eq!(parts[0].len(), 8);
        assert_eq!(parts[1].len(), 4);
        assert_eq!(parts[2].len(), 4);
        assert_eq!(parts[3].len(), 16);
        assert!(g.chars().all(|c| c.is_ascii_hexdigit() || c == '-'));
    }
}
