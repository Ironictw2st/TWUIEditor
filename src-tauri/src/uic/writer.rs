//! Little-endian byte emitters mirroring [`super::reader::Reader`].
//!
//! Ported from taw's etwng UI converter (https://github.com/taw/etwng), MIT License.

pub struct Writer {
    pub data: Vec<u8>,
}

impl Writer {
    pub fn new() -> Self {
        Writer { data: Vec::new() }
    }

    pub fn put_byte(&mut self, v: u8) {
        self.data.push(v);
    }

    pub fn put_bool(&mut self, v: bool) {
        self.data.push(if v { 1 } else { 0 });
    }

    pub fn put_u2(&mut self, v: u16) {
        self.data.extend_from_slice(&v.to_le_bytes());
    }

    pub fn put_u(&mut self, v: u32) {
        self.data.extend_from_slice(&v.to_le_bytes());
    }

    pub fn put_i(&mut self, v: i32) {
        self.data.extend_from_slice(&v.to_le_bytes());
    }

    pub fn put_flt(&mut self, v: f32) {
        self.data.extend_from_slice(&v.to_le_bytes());
    }

    /// u16 length-prefixed byte string (etwng `put_str`).
    pub fn put_s(&mut self, v: &[u8]) -> Result<(), String> {
        if v.len() > u16::MAX as usize {
            return Err(format!("string of {} bytes exceeds u16 length prefix", v.len()));
        }
        self.put_u2(v.len() as u16);
        self.data.extend_from_slice(v);
        Ok(())
    }

    /// u16 length-prefixed UTF-16LE string from raw code units (etwng `put_unicode`).
    pub fn put_unicode(&mut self, v: &[u16]) -> Result<(), String> {
        if v.len() > u16::MAX as usize {
            return Err(format!("unicode string of {} units exceeds u16 length prefix", v.len()));
        }
        self.put_u2(v.len() as u16);
        for unit in v {
            self.data.extend_from_slice(&unit.to_le_bytes());
        }
        Ok(())
    }

    /// The 10-byte ASCII `VersionNNN` magic.
    pub fn put_version(&mut self, v: u32) {
        self.data.extend_from_slice(format!("Version{v:03}").as_bytes());
    }
}
