//! Little-endian cursor reader over a binary UI layout file.
//!
//! Ported from taw's etwng UI converter (https://github.com/taw/etwng), MIT License.

/// Cursor over the raw bytes. All getters advance the offset and return an
/// error naming the offset on truncation, mirroring etwng's `get`.
pub struct Reader<'a> {
    data: &'a [u8],
    pub ofs: usize,
}

impl<'a> Reader<'a> {
    pub fn new(data: &'a [u8]) -> Self {
        Reader { data, ofs: 0 }
    }

    pub fn bytes_left(&self) -> usize {
        self.data.len() - self.ofs
    }

    pub fn at_eof(&self) -> bool {
        self.ofs == self.data.len()
    }

    pub fn take(&mut self, n: usize) -> Result<&'a [u8], String> {
        if self.ofs + n > self.data.len() {
            return Err(format!(
                "read past end of file at offset {} (wanted {n} bytes, {} left)",
                self.ofs,
                self.bytes_left()
            ));
        }
        let rv = &self.data[self.ofs..self.ofs + n];
        self.ofs += n;
        Ok(rv)
    }

    pub fn get_byte(&mut self) -> Result<u8, String> {
        Ok(self.take(1)?[0])
    }

    pub fn get_bool(&mut self) -> Result<bool, String> {
        let ofs = self.ofs;
        let v = self.get_byte()?;
        if v > 1 {
            return Err(format!("invalid boolean value {v} at offset {ofs}"));
        }
        Ok(v == 1)
    }

    pub fn get_u2(&mut self) -> Result<u16, String> {
        let b = self.take(2)?;
        Ok(u16::from_le_bytes([b[0], b[1]]))
    }

    pub fn get_u(&mut self) -> Result<u32, String> {
        let b = self.take(4)?;
        Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }

    pub fn get_i(&mut self) -> Result<i32, String> {
        let b = self.take(4)?;
        Ok(i32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }

    pub fn get_flt(&mut self) -> Result<f32, String> {
        let b = self.take(4)?;
        Ok(f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }

    /// u16 length-prefixed byte string (etwng `get_s`).
    pub fn get_s(&mut self) -> Result<&'a [u8], String> {
        let len = self.get_u2()? as usize;
        self.take(len)
    }

    /// u16 length-prefixed UTF-16LE string as raw code units (etwng `get_unicode`).
    pub fn get_unicode(&mut self) -> Result<Vec<u16>, String> {
        let len = self.get_u2()? as usize;
        let b = self.take(len * 2)?;
        Ok(b.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect())
    }
}
