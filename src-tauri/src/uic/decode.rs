//! Binary UIC -> Element tree decoder for the "gen2" uientry format
//! (Version055-099: Rome 2 / Attila / Thrones era; Attila ships 077-097).
//!
//! This is a line-by-line port of etwng's `convert_uientry_gen2!` path in
//! `ui/lib/ui_file.rb`. Version conditionals are kept literally, in source
//! order, so the decode sequence is provably the same as the proven Ruby one.
//! Fields with a confidently deciphered meaning are promoted to attributes;
//! everything else is emitted as positional typed children which the encoder
//! consumes in the identical order.
//!
//! Ported from taw's etwng UI converter (https://github.com/taw/etwng), MIT License.

use super::dialect::*;
use super::reader::Reader;
use crate::model::{Document, Element, Node};

/// Highest count accepted for any array (etwng uses 0xffff too); guards
/// against misparses running away.
const MAX_COUNT: u32 = 0xffff;

pub struct Decoder<'a> {
    r: Reader<'a>,
    version: u32,
    next_guid: u32,
}

/// Versions the gen2 decoder handles. Attila uses 077-097; the whole gen2
/// range is ported since the conditionals come straight from etwng.
pub fn supported_version(v: u32) -> bool {
    (55..=99).contains(&v)
}

pub fn decode(bytes: &[u8]) -> Result<Document, String> {
    let version = super::sniff_version(bytes)
        .ok_or_else(|| "not a binary UI layout (no Version magic)".to_string())?;
    if !supported_version(version) {
        return Err(format!(
            "binary UI layout Version{version:03} is not supported (supported: 055-099)"
        ));
    }
    let mut d = Decoder {
        r: Reader::new(&bytes[10..]),
        version,
        next_guid: 0,
    };
    let entry = d
        .uientry()
        .map_err(|e| format!("Version{version:03} decode failed: {e}"))?;
    if !d.r.at_eof() {
        return Err(format!(
            "Version{version:03} decode incomplete: {} bytes left at offset {}",
            d.r.bytes_left(),
            d.r.ofs + 10
        ));
    }
    let mut root = el("ui");
    attr(&mut root, "version", format!("{version:03}"));
    root.children.push(Node::Element(entry));
    Ok(Document { prolog: Vec::new(), root })
}

impl<'a> Decoder<'a> {
    fn guid(&mut self) -> String {
        self.next_guid += 1;
        format!("uic-{}", self.next_guid)
    }

    // ---- typed-child emitters (positional, undeciphered fields) ----

    fn child_i(&mut self, parent: &mut Element) -> Result<(), String> {
        let v = self.r.get_i()?;
        let mut c = leaf("i");
        attr(&mut c, "v", v.to_string());
        parent.children.push(Node::Element(c));
        Ok(())
    }

    fn child_byte(&mut self, parent: &mut Element) -> Result<(), String> {
        let v = self.r.get_byte()?;
        let mut c = leaf("byte");
        attr(&mut c, "v", v.to_string());
        parent.children.push(Node::Element(c));
        Ok(())
    }

    fn child_bool(&mut self, parent: &mut Element) -> Result<(), String> {
        let v = self.r.get_bool()?;
        parent
            .children
            .push(Node::Element(leaf(if v { "yes" } else { "no" })));
        Ok(())
    }

    /// etwng `convert_bool_false!`: must be false in the corpus; validated and
    /// NOT stored (the encoder re-emits the constant 0).
    fn expect_false(&mut self, what: &str) -> Result<(), String> {
        let ofs = self.r.ofs;
        if self.r.get_bool()? {
            return Err(format!("expected false ({what}) at offset {ofs}"));
        }
        Ok(())
    }

    /// etwng `convert_i_zero!`: must be 0; validated and NOT stored.
    fn expect_zero_i(&mut self, what: &str) -> Result<(), String> {
        let ofs = self.r.ofs;
        let v = self.r.get_i()?;
        if v != 0 {
            return Err(format!("expected zero ({what}) at offset {ofs}, got {v}"));
        }
        Ok(())
    }

    fn child_flt(&mut self, parent: &mut Element) -> Result<(), String> {
        let v = self.r.get_flt()?;
        parent.children.push(Node::Element(flt_leaf(v)));
        Ok(())
    }

    fn child_s(&mut self, parent: &mut Element) -> Result<(), String> {
        let bytes = self.r.get_s()?;
        let mut c = leaf("s");
        attr_s(&mut c, "v", bytes);
        // attr_s writes either v or v_hex; normalize the fallback key to "hex".
        rename_v_hex(&mut c);
        parent.children.push(Node::Element(c));
        Ok(())
    }

    /// `<color b g r a/>` (etwng emits BGRA byte order).
    fn child_color(&mut self, parent: &mut Element) -> Result<(), String> {
        let mut c = leaf("color");
        for key in ["b", "g", "r", "a"] {
            let v = self.r.get_byte()?;
            attr(&mut c, key, v.to_string());
        }
        parent.children.push(Node::Element(c));
        Ok(())
    }

    fn child_data(&mut self, parent: &mut Element, size: usize) -> Result<(), String> {
        let bytes = self.r.take(size)?;
        let mut c = leaf("data");
        attr(&mut c, "v", to_hex(bytes));
        parent.children.push(Node::Element(c));
        Ok(())
    }

    fn count(&mut self, what: &str) -> Result<u32, String> {
        let ofs = self.r.ofs;
        let n = self.r.get_u()?;
        if n > MAX_COUNT {
            return Err(format!(
                "{what} count {n} at offset {ofs} is impossibly high"
            ));
        }
        Ok(n)
    }

    // ---- structure converters, in ui_file.rb source order ----

    /// `convert_image_list!`
    fn images(&mut self) -> Result<Element, String> {
        let n = self.count("images")?;
        let mut list = el("images");
        for _ in 0..n {
            let mut img = el("image");
            attr(&mut img, "this", self.guid());
            attr(&mut img, "id", self.r.get_u()?.to_string());
            attr_s(&mut img, "path", self.r.get_s()?);
            attr(&mut img, "w", self.r.get_i()?.to_string());
            attr(&mut img, "h", self.r.get_i()?.to_string());
            if self.version < 74 {
                self.child_color(&mut img)?;
            }
            if self.version >= 78 {
                self.child_bool(&mut img)?;
            }
            list.children.push(Node::Element(img));
        }
        Ok(list)
    }

    /// `convert_state_list!`
    fn states(&mut self) -> Result<Element, String> {
        let n = self.count("states")?;
        let mut list = el("states");
        for _ in 0..n {
            let s = self.state()?;
            list.children.push(Node::Element(s));
        }
        Ok(list)
    }

    fn state(&mut self) -> Result<Element, String> {
        let mut st = el("state");
        attr(&mut st, "this", self.guid());
        attr(&mut st, "id", self.r.get_u()?.to_string());
        attr_s(&mut st, "title", self.r.get_s()?);
        attr(&mut st, "w", self.r.get_i()?.to_string());
        attr(&mut st, "h", self.r.get_i()?.to_string());

        let text = self.r.get_unicode()?;
        attr_uni(&mut st, "text", &text);
        let tooltip = self.r.get_unicode()?;
        attr_uni(&mut st, "tooltip", &tooltip);
        attr(&mut st, "text_w", self.r.get_i()?.to_string());
        attr(&mut st, "text_h", self.r.get_i()?.to_string());
        attr(&mut st, "text_halign", self.r.get_i()?.to_string());
        attr(&mut st, "text_valign", self.r.get_i()?.to_string());

        self.child_bool(&mut st)?; // "text behavior?"
        let label = self.r.get_unicode()?;
        attr_uni(&mut st, "text_label", &label);

        // version < 116 branch only (gen2 tops out at 99)
        self.expect_false("state stuff 3")?;
        self.child_bool(&mut st)?; // "state stuff 4?"
        let loc_id = self.r.get_unicode()?;
        attr_uni(&mut st, "loc_id", &loc_id);
        let tooltip_id = self.r.get_unicode()?;
        attr_uni(&mut st, "tooltip_id", &tooltip_id);
        if self.version >= 90 {
            self.child_s(&mut st)?; // "state stuff before font?"
        }

        // version >= 27 always true here
        attr_s(&mut st, "font", self.r.get_s()?);
        attr(&mut st, "font_size", self.r.get_i()?.to_string());
        attr(&mut st, "font_leading", self.r.get_i()?.to_string());
        attr(&mut st, "font_tracking", self.r.get_i()?.to_string());

        if self.version >= 74 {
            self.child_color(&mut st)?;
        }
        // version >= 43 always true here
        attr_s(&mut st, "font_cat", self.r.get_s()?);

        if self.version >= 86 {
            for _ in 0..4 {
                self.child_i(&mut st)?; // left / right / top / bottom ?
            }
        } else {
            for _ in 0..2 {
                self.child_i(&mut st)?; // x? / y?
            }
        }

        self.child_i(&mut st)?;
        if self.version >= 90 {
            // no more flags
        } else if self.version >= 83 {
            for _ in 0..4 {
                self.child_bool(&mut st)?;
            }
        } else {
            // version >= 29 branch (always in gen2 range)
            for _ in 0..3 {
                self.child_bool(&mut st)?;
            }
        }

        attr_s(&mut st, "shader", self.r.get_s()?);
        for _ in 0..4 {
            self.child_flt(&mut st)?; // shader vars
        }
        if self.version >= 77 {
            attr_s(&mut st, "text_shader", self.r.get_s()?);
            for _ in 0..4 {
                self.child_flt(&mut st)?; // text shader vars
            }
        }

        if self.version < 74 {
            self.child_s(&mut st)?; // state description
            self.child_s(&mut st)?; // event text
        }

        let uses = self.image_uses()?;
        st.children.push(Node::Element(uses));

        self.child_i(&mut st)?; // mouse related?
        self.child_i(&mut st)?;

        if self.version < 74 {
            let t = self.transitions()?;
            st.children.push(Node::Element(t));
        } else {
            let m = self.mouse_states()?;
            st.children.push(Node::Element(m));
        }
        // version >= 124 material: out of gen2 range
        Ok(st)
    }

    /// `convert_transitions!` (only reached below version 74)
    fn transitions(&mut self) -> Result<Element, String> {
        let n = self.count("transitions")?;
        let mut list = el("transitions");
        for _ in 0..n {
            let mut t = el("transition");
            attr(&mut t, "type", self.r.get_i()?.to_string());
            attr(&mut t, "id", self.r.get_u()?.to_string());
            // version >= 39 and >= 43: always true in gen2 range
            attr_s(&mut t, "s1", self.r.get_s()?);
            self.child_i(&mut t)?;
            self.child_i(&mut t)?;
            attr_s(&mut t, "s2", self.r.get_s()?);
            self.child_i(&mut t)?;
            list.children.push(Node::Element(t));
        }
        Ok(list)
    }

    /// `convert_mouse_states!`
    fn mouse_states(&mut self) -> Result<Element, String> {
        let n = self.count("mouse_states")?;
        let mut list = el("mouse_states");
        for _ in 0..n {
            let mut m = el("mouse_state");
            attr(&mut m, "type", self.r.get_i()?.to_string());
            attr(&mut m, "id", self.r.get_u()?.to_string());
            self.child_i(&mut m)?;
            self.child_i(&mut m)?;
            let dn = self.count("mouse_state_data")?;
            let mut data = el("mouse_state_data");
            for _ in 0..dn {
                let mut p = el("datapoint");
                attr(&mut p, "id", self.r.get_u()?.to_string());
                self.child_s(&mut p)?;
                self.child_s(&mut p)?;
                self.child_s(&mut p)?;
                data.children.push(Node::Element(p));
            }
            m.children.push(Node::Element(data));
            list.children.push(Node::Element(m));
        }
        Ok(list)
    }

    /// `convert_image_uses!`
    fn image_uses(&mut self) -> Result<Element, String> {
        let n = self.count("image_uses")?;
        let mut list = el("image_uses");
        for _ in 0..n {
            let mut u = el("image_use");
            attr(&mut u, "image_id", self.r.get_u()?.to_string());
            attr(&mut u, "x", self.r.get_u()?.to_string());
            attr(&mut u, "y", self.r.get_u()?.to_string());
            attr(&mut u, "w", self.r.get_u()?.to_string());
            attr(&mut u, "h", self.r.get_u()?.to_string());
            self.child_color(&mut u)?;
            // version >= 119: out of range

            self.child_bool(&mut u)?; // tiled?
            self.child_bool(&mut u)?; // flipped x?
            self.child_bool(&mut u)?; // flipped y?
            attr(&mut u, "dock", self.r.get_i()?.to_string());
            if self.version >= 77 {
                attr(&mut u, "dock_x", self.r.get_i()?.to_string());
                attr(&mut u, "dock_y", self.r.get_i()?.to_string());
            }
            self.child_bool(&mut u)?; // stretch x?
            self.child_bool(&mut u)?; // stretch y?
            self.child_flt(&mut u)?; // rotation angle
            self.child_flt(&mut u)?; // rotation pivot x?
            self.child_flt(&mut u)?; // rotation pivot y?
            if self.version >= 74 {
                // version < 103 branch in gen2 range
                attr_s(&mut u, "shader", self.r.get_s()?);
                self.child_flt(&mut u)?; // rotation axis x?
                self.child_flt(&mut u)?; // rotation axis y?
                self.child_flt(&mut u)?; // rotation axis z?
                self.expect_zero_i("image_use tail")?;

                if self.version <= 77 {
                    self.child_bool(&mut u)?; // extra image use stuff?
                }
                if self.version >= 92 {
                    for _ in 0..4 {
                        self.child_flt(&mut u)?; // margins t/r/b/l
                    }
                } else {
                    for _ in 0..2 {
                        self.child_flt(&mut u)?; // margins tb/lr
                    }
                }
                // version >= 125: out of range
            } else {
                if self.version >= 51 {
                    self.child_bool(&mut u)?;
                }
                // version == 31 / 30: out of gen2 range
            }
            list.children.push(Node::Element(u));
        }
        Ok(list)
    }

    /// `convert_anim_attrs!`
    fn anim_attrs(&mut self) -> Result<Element, String> {
        let n = self.count("anim_attrs")?;
        let mut list = el("anim_attrs");
        for _ in 0..n {
            let mut a = el("anim_attr");
            attr(&mut a, "id", self.r.get_u()?.to_string());
            attr_s(&mut a, "anim", self.r.get_s()?);
            attr_s(&mut a, "state", self.r.get_s()?);
            attr_s(&mut a, "property", self.r.get_s()?);
            list.children.push(Node::Element(a));
        }
        Ok(list)
    }

    /// `convert_anims!`
    fn anims(&mut self) -> Result<Element, String> {
        let n = self.count("anims")?;
        let mut list = el("anims");
        for _ in 0..n {
            let mut a = el("anim");
            // version >= 113 sound: out of range
            self.child_flt(&mut a)?; // x offset?
            self.child_flt(&mut a)?; // y offset?
            self.child_i(&mut a)?; // x size?
            self.child_i(&mut a)?; // y size?
            self.child_color(&mut a)?;
            for _ in 0..4 {
                self.child_flt(&mut a)?; // shader vars?
            }
            self.child_flt(&mut a)?; // rotation angle?
            self.child_i(&mut a)?; // image index 1?
            self.child_i(&mut a)?; // image index 2?
            self.child_i(&mut a)?; // interpolation time?
            self.child_i(&mut a)?; // interpolation property mask?
            self.child_flt(&mut a)?; // easing weight?
            attr_s(&mut a, "curve", self.r.get_s()?); // easing curve
            let attrs = self.anim_attrs()?;
            a.children.push(Node::Element(attrs));
            if self.version >= 90 {
                self.child_bool(&mut a)?; // is movement absolute?
            }
            // version >= 100/104/124 tails: out of range
            list.children.push(Node::Element(a));
        }
        Ok(list)
    }

    /// `convert_funcs!`
    fn funcs(&mut self) -> Result<Element, String> {
        let n = self.count("funcs")?;
        let mut list = el("funcs");
        for _ in 0..n {
            let mut f = el("func");
            attr_s(&mut f, "name", self.r.get_s()?);
            self.child_bool(&mut f)?; // propagate?
            self.child_bool(&mut f)?; // make noninteractive?
            let anims = self.anims()?;
            f.children.push(Node::Element(anims));
            if self.version >= 91 {
                // && < 100, always true in gen2 range
                self.child_s(&mut f)?;
            }
            // version >= 113: out of range
            list.children.push(Node::Element(f));
        }
        Ok(list)
    }

    /// `convert_properties!`
    fn properties(&mut self) -> Result<Element, String> {
        let n = self.count("properties")?;
        let mut list = el("properties");
        for _ in 0..n {
            let mut p = el("property");
            attr_s(&mut p, "key", self.r.get_s()?);
            attr_s(&mut p, "value", self.r.get_s()?);
            list.children.push(Node::Element(p));
        }
        Ok(list)
    }

    /// `convert_model!` (the "very poorly decoded part")
    fn models(&mut self) -> Result<Element, String> {
        let mut ms = el("models");
        self.child_s(&mut ms)?;
        let header_size = if self.version == 74 {
            37
        } else if (84..=86).contains(&self.version) {
            50
        } else {
            74
        };
        self.child_data(&mut ms, header_size)?;
        let count = self.r.get_i()?;
        if count < 0 || count as u32 > MAX_COUNT {
            return Err(format!("model count {count} is impossibly high"));
        }
        for _ in 0..count {
            let mut m = el("model");
            attr_s(&mut m, "mesh_path", self.r.get_s()?);
            attr_s(&mut m, "mesh_name", self.r.get_s()?);
            let data_size = if self.version <= 77 {
                21
            } else if (84..=86).contains(&self.version) {
                29
            } else {
                1
            };
            self.child_data(&mut m, data_size)?;
            self.child_i(&mut m)?; // anim count or something?
            attr_s(&mut m, "anim_name", self.r.get_s()?);
            attr_s(&mut m, "anim_path", self.r.get_s()?);
            self.child_data(&mut m, 4)?; // rest of anim stuff
            ms.children.push(Node::Element(m));
        }
        Ok(ms)
    }

    /// `convert_additional_data!`
    fn additional_data(&mut self) -> Result<Element, String> {
        if !self.r.get_bool()? {
            let mut none = leaf("additional_data");
            attr(&mut none, "type", "none".to_string());
            return Ok(none);
        }
        let type_bytes = self.r.get_s()?.to_vec();
        let ty = String::from_utf8(type_bytes)
            .map_err(|_| "additional_data type is not UTF-8".to_string())?;
        let mut ad = el("additional_data");
        attr(&mut ad, "type", escape_attr(&ty));
        match ty.as_str() {
            "List" | "HorizontalList" => {
                let n = self.count("additional_data points")?;
                for _ in 0..n {
                    self.child_flt(&mut ad)?; // data point
                }
                self.child_i(&mut ad)?; // mystery1
                self.child_i(&mut ad)?; // mystery2
                self.child_bool(&mut ad)?; // mystery3
                self.child_i(&mut ad)?; // mystery4
                if self.version >= 54 && self.version != 77 {
                    self.child_bool(&mut ad)?; // mystery5
                }
                if self.version >= 96 {
                    self.child_bool(&mut ad)?; // mystery6
                    self.child_i(&mut ad)?; // mystery7
                }
                // version >= 101 tails: out of gen2 range
            }
            "Table" => {
                let rows = self.count("table")?;
                let mut table = el("table");
                for _ in 0..rows {
                    let cols = self.count("row")?;
                    let mut row = el("row");
                    for _ in 0..cols {
                        let mut col = el("col");
                        for _ in 0..5 {
                            self.child_flt(&mut col)?;
                        }
                        row.children.push(Node::Element(col));
                    }
                    table.children.push(Node::Element(row));
                }
                ad.children.push(Node::Element(table));
            }
            "RadialList" => {
                for _ in 0..3 {
                    self.child_flt(&mut ad)?; // angles
                }
                self.child_flt(&mut ad)?;
                self.child_bool(&mut ad)?;
                // version == 121: out of range
            }
            other => return Err(format!("unknown additional data section {other:?}")),
        }
        Ok(ad)
    }

    /// `convert_children!` (gen2 range: recursion into gen2 uientry)
    fn children(&mut self) -> Result<Element, String> {
        let n = self.count("children")?;
        let mut list = el("children");
        for _ in 0..n {
            let c = self.uientry()?;
            list.children.push(Node::Element(c));
        }
        Ok(list)
    }

    /// `convert_uientry_gen2!`
    pub fn uientry(&mut self) -> Result<Element, String> {
        let mut e = el("uientry");
        attr(&mut e, "this", self.guid());
        attr(&mut e, "id", self.r.get_u()?.to_string());
        attr_s(&mut e, "title", self.r.get_s()?);
        // version >= 43: always true in gen2 range
        attr_s(&mut e, "title2", self.r.get_s()?);
        // version >= 100 event branches: out of gen2 range

        attr(&mut e, "x", self.r.get_i()?.to_string());
        attr(&mut e, "y", self.r.get_i()?.to_string());

        for i in 1..=12 {
            if i == 3 {
                self.child_byte(&mut e)?; // uientry flag 3 (byte)
            } else {
                self.child_bool(&mut e)?; // uientry flags (bool)
            }
        }
        if self.version < 90 {
            self.child_bool(&mut e)?;
        }

        let tooltip = self.r.get_unicode()?;
        attr_uni(&mut e, "tooltip", &tooltip);
        let tooltip_id = self.r.get_unicode()?;
        attr_uni(&mut e, "tooltip_id", &tooltip_id);

        attr(&mut e, "dock", self.r.get_i()?.to_string());
        if self.version >= 77 {
            attr(&mut e, "dock_x", self.r.get_i()?.to_string());
            attr(&mut e, "dock_y", self.r.get_i()?.to_string());
        }

        self.child_bool(&mut e)?;
        attr(&mut e, "default_state", self.r.get_i()?.to_string());

        let images = self.images()?;
        e.children.push(Node::Element(images));

        attr(&mut e, "mask_image", self.r.get_i()?.to_string());

        // version < 110: always true in gen2 range
        self.child_i(&mut e)?;
        // version >= 126 uuid: out of range

        let states = self.states()?;
        e.children.push(Node::Element(states));

        let props = self.properties()?;
        e.children.push(Node::Element(props));
        attr(&mut e, "priority", self.r.get_i()?.to_string());

        let funcs = self.funcs()?;
        e.children.push(Node::Element(funcs));

        let children = self.children()?;
        e.children.push(Node::Element(children));

        let ad = self.additional_data()?;
        e.children.push(Node::Element(ad));

        self.child_s(&mut e)?; // end of uientry 1?
        self.child_s(&mut e)?; // end of uientry 2?

        if self.r.get_bool()? {
            let n = self.count("float array")?;
            let mut fa = el("float_array");
            for _ in 0..n {
                self.child_flt(&mut fa)?;
            }
            e.children.push(Node::Element(fa));
        }

        if self.version == 97 {
            if self.r.get_bool()? {
                let mut ex = el("extra97");
                attr(&mut ex, "first", self.r.get_i()?.to_string());
                let n = self.count("extra97 array")?;
                for _ in 0..n {
                    self.child_i(&mut ex)?;
                }
                e.children.push(Node::Element(ex));
            }
            attr(&mut e, "ref97", self.r.get_i()?.to_string()); // uientry id reference maybe?
        }

        if self.r.get_bool()? {
            let ms = self.models()?;
            e.children.push(Node::Element(ms));
        }

        // "This version mix..."
        if self.version <= 84 && self.version != 77 && self.version != 78 {
            self.child_bool(&mut e)?; // end of uientry flag 5A?
        } else {
            self.child_bool(&mut e)?; // end of uientry flag 5B?
            self.child_bool(&mut e)?; // end of uientry flag 6B?
        }

        if self.version >= 94 {
            self.child_bool(&mut e)?;
        }
        // version >= 113 floats: out of range
        Ok(e)
    }
}

/// `attr_s` on a leaf writes "v" or "v_hex"; the typed-child convention uses
/// plain "hex" for the fallback key.
fn rename_v_hex(e: &mut Element) {
    for (k, _) in e.attrs.iter_mut() {
        if k == "v_hex" {
            *k = "hex".to_string();
        }
    }
}
