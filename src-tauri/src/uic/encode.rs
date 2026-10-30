//! Element tree -> binary UIC encoder, the exact mirror of [`super::decode`].
//!
//! Walks the decoded dialect in the same order the decoder emitted it:
//! promoted attributes are written at their fixed binary positions and
//! positional typed children are consumed through a cursor that skips
//! comments. Array counts are recomputed from actual child counts, so
//! structural edits stay consistent. Errors carry an element path.
//!
//! Ported from taw's etwng UI converter (https://github.com/taw/etwng), MIT License.

use super::dialect::*;
use super::writer::Writer;
use crate::model::{Document, Element, Node};

pub fn encode(doc: &Document) -> Result<Vec<u8>, String> {
    if doc.root.tag != "ui" {
        return Err(format!(
            "not a decoded binary UI layout (root <{}>, expected <ui>)",
            doc.root.tag
        ));
    }
    let vs = req(&doc.root, "version", "ui")?;
    let version: u32 = vs
        .parse()
        .map_err(|_| format!("ui: bad version attribute {vs:?}"))?;
    if !super::decode::supported_version(version) {
        return Err(format!(
            "binary UI layout Version{version:03} is not supported (supported: 055-099)"
        ));
    }
    let entries: Vec<&Element> = elements(&doc.root);
    if entries.len() != 1 || entries[0].tag != "uientry" {
        return Err("ui: expected exactly one <uientry> child".to_string());
    }
    let mut enc = Encoder {
        w: Writer::new(),
        version,
    };
    enc.w.put_version(version);
    enc.uientry(entries[0], "ui>uientry")?;
    Ok(enc.w.data)
}

fn elements(e: &Element) -> Vec<&Element> {
    e.children
        .iter()
        .filter_map(|n| match n {
            Node::Element(el) => Some(el),
            Node::Comment { .. } => None,
        })
        .collect()
}

/// Cursor over an element's positional children (comments skipped).
struct Kids<'a> {
    items: Vec<&'a Element>,
    pos: usize,
    path: &'a str,
}

impl<'a> Kids<'a> {
    fn new(e: &'a Element, path: &'a str) -> Self {
        Kids {
            items: elements(e),
            pos: 0,
            path,
        }
    }

    fn next(&mut self, expected: &str) -> Result<&'a Element, String> {
        match self.items.get(self.pos) {
            Some(el) if el.tag == expected => {
                self.pos += 1;
                Ok(el)
            }
            Some(el) => Err(format!(
                "{}: expected <{expected}> at child {} but found <{}>",
                self.path, self.pos, el.tag
            )),
            None => Err(format!(
                "{}: expected <{expected}> at child {} but ran out of children",
                self.path, self.pos
            )),
        }
    }

    fn next_bool(&mut self) -> Result<bool, String> {
        match self.items.get(self.pos) {
            Some(el) if el.tag == "yes" => {
                self.pos += 1;
                Ok(true)
            }
            Some(el) if el.tag == "no" => {
                self.pos += 1;
                Ok(false)
            }
            Some(el) => Err(format!(
                "{}: expected <yes/> or <no/> at child {} but found <{}>",
                self.path, self.pos, el.tag
            )),
            None => Err(format!(
                "{}: expected <yes/> or <no/> at child {} but ran out of children",
                self.path, self.pos
            )),
        }
    }

    /// Consume the container tag if it is next (for presence-gated sections).
    fn take_opt(&mut self, tag: &str) -> Option<&'a Element> {
        match self.items.get(self.pos) {
            Some(el) if el.tag == tag => {
                self.pos += 1;
                Some(el)
            }
            _ => None,
        }
    }

    fn done(&self) -> Result<(), String> {
        if self.pos != self.items.len() {
            let extra = &self.items[self.pos];
            return Err(format!(
                "{}: unexpected extra child <{}> at position {}",
                self.path, extra.tag, self.pos
            ));
        }
        Ok(())
    }
}

struct Encoder {
    w: Writer,
    version: u32,
}

impl Encoder {
    // ---- typed-child consumers ----

    fn put_i_child(&mut self, k: &mut Kids, path: &str) -> Result<(), String> {
        let c = k.next("i")?;
        let v = req(c, "v", path)?;
        let n: i32 = v
            .parse()
            .map_err(|_| format!("{path}: bad <i> value {v:?}"))?;
        self.w.put_i(n);
        Ok(())
    }

    fn put_byte_child(&mut self, k: &mut Kids, path: &str) -> Result<(), String> {
        let c = k.next("byte")?;
        let v = req(c, "v", path)?;
        let n: u8 = v
            .parse()
            .map_err(|_| format!("{path}: bad <byte> value {v:?}"))?;
        self.w.put_byte(n);
        Ok(())
    }

    fn put_bool_child(&mut self, k: &mut Kids) -> Result<(), String> {
        let v = k.next_bool()?;
        self.w.put_bool(v);
        Ok(())
    }

    fn put_flt_child(&mut self, k: &mut Kids, path: &str) -> Result<(), String> {
        let c = k.next("flt")?;
        let v = flt_value(c, path)?;
        self.w.put_flt(v);
        Ok(())
    }

    fn put_s_child(&mut self, k: &mut Kids, path: &str) -> Result<(), String> {
        let c = k.next("s")?;
        let bytes = if let Some(h) = get(c, "hex") {
            from_hex(h)?
        } else {
            unescape_attr(req(c, "v", path)?)?.into_bytes()
        };
        self.w.put_s(&bytes)
    }

    fn put_color_child(&mut self, k: &mut Kids, path: &str) -> Result<(), String> {
        let c = k.next("color")?;
        for key in ["b", "g", "r", "a"] {
            let v = req(c, key, path)?;
            let n: u8 = v
                .parse()
                .map_err(|_| format!("{path}: bad <color> {key} value {v:?}"))?;
            self.w.put_byte(n);
        }
        Ok(())
    }

    fn put_data_child(
        &mut self,
        k: &mut Kids,
        path: &str,
        expected_size: usize,
    ) -> Result<(), String> {
        let c = k.next("data")?;
        let bytes = from_hex(req(c, "v", path)?)?;
        if bytes.len() != expected_size {
            return Err(format!(
                "{path}: <data> must hold exactly {expected_size} bytes, found {}",
                bytes.len()
            ));
        }
        self.w.data.extend_from_slice(&bytes);
        Ok(())
    }

    // ---- promoted-attribute emitters ----

    fn put_i_attr(&mut self, e: &Element, key: &str, path: &str) -> Result<(), String> {
        self.w.put_i(req_i(e, key, path)?);
        Ok(())
    }

    fn put_u_attr(&mut self, e: &Element, key: &str, path: &str) -> Result<(), String> {
        self.w.put_u(req_u(e, key, path)?);
        Ok(())
    }

    fn put_s_attr(&mut self, e: &Element, key: &str, path: &str) -> Result<(), String> {
        let bytes = attr_s_bytes(e, key, path)?;
        self.w.put_s(&bytes)
    }

    fn put_uni_attr(&mut self, e: &Element, key: &str, path: &str) -> Result<(), String> {
        let units = attr_uni_units(e, key, path)?;
        self.w.put_unicode(&units)
    }

    fn count_of(&mut self, n: usize, what: &str, path: &str) -> Result<(), String> {
        if n > 0xffff {
            return Err(format!("{path}: {what} count {n} is impossibly high"));
        }
        self.w.put_u(n as u32);
        Ok(())
    }

    // ---- structure emitters, mirroring decode.rs exactly ----

    fn images(&mut self, list: &Element, path: &str) -> Result<(), String> {
        let imgs = elements(list);
        self.count_of(imgs.len(), "images", path)?;
        for (i, img) in imgs.iter().enumerate() {
            let p = format!("{path}>image[{i}]");
            if img.tag != "image" {
                return Err(format!("{p}: expected <image>, found <{}>", img.tag));
            }
            self.put_u_attr(img, "id", &p)?;
            self.put_s_attr(img, "path", &p)?;
            self.put_i_attr(img, "w", &p)?;
            self.put_i_attr(img, "h", &p)?;
            let mut k = Kids::new(img, &p);
            if self.version < 74 {
                self.put_color_child(&mut k, &p)?;
            }
            if self.version >= 78 {
                self.put_bool_child(&mut k)?;
            }
            k.done()?;
        }
        Ok(())
    }

    fn states(&mut self, list: &Element, path: &str) -> Result<(), String> {
        let sts = elements(list);
        self.count_of(sts.len(), "states", path)?;
        for (i, st) in sts.iter().enumerate() {
            let p = format!("{path}>state[{i}]");
            if st.tag != "state" {
                return Err(format!("{p}: expected <state>, found <{}>", st.tag));
            }
            self.state(st, &p)?;
        }
        Ok(())
    }

    fn state(&mut self, st: &Element, path: &str) -> Result<(), String> {
        self.put_u_attr(st, "id", path)?;
        self.put_s_attr(st, "title", path)?;
        self.put_i_attr(st, "w", path)?;
        self.put_i_attr(st, "h", path)?;
        self.put_uni_attr(st, "text", path)?;
        self.put_uni_attr(st, "tooltip", path)?;
        self.put_i_attr(st, "text_w", path)?;
        self.put_i_attr(st, "text_h", path)?;
        self.put_i_attr(st, "text_halign", path)?;
        self.put_i_attr(st, "text_valign", path)?;

        let mut k = Kids::new(st, path);
        self.put_bool_child(&mut k)?; // text behavior?
        self.put_uni_attr(st, "text_label", path)?;

        // version < 116 branch
        self.w.put_bool(false); // "state stuff 3" constant
        self.put_bool_child(&mut k)?; // state stuff 4?
        self.put_uni_attr(st, "loc_id", path)?;
        self.put_uni_attr(st, "tooltip_id", path)?;
        if self.version >= 90 {
            self.put_s_child(&mut k, path)?; // state stuff before font?
        }

        self.put_s_attr(st, "font", path)?;
        self.put_i_attr(st, "font_size", path)?;
        self.put_i_attr(st, "font_leading", path)?;
        self.put_i_attr(st, "font_tracking", path)?;

        if self.version >= 74 {
            self.put_color_child(&mut k, path)?;
        }
        self.put_s_attr(st, "font_cat", path)?;

        let side_ints = if self.version >= 86 { 4 } else { 2 };
        for _ in 0..side_ints {
            self.put_i_child(&mut k, path)?;
        }

        self.put_i_child(&mut k, path)?;
        if self.version >= 90 {
            // no flags
        } else if self.version >= 83 {
            for _ in 0..4 {
                self.put_bool_child(&mut k)?;
            }
        } else {
            for _ in 0..3 {
                self.put_bool_child(&mut k)?;
            }
        }

        self.put_s_attr(st, "shader", path)?;
        for _ in 0..4 {
            self.put_flt_child(&mut k, path)?;
        }
        if self.version >= 77 {
            self.put_s_attr(st, "text_shader", path)?;
            for _ in 0..4 {
                self.put_flt_child(&mut k, path)?;
            }
        }

        if self.version < 74 {
            self.put_s_child(&mut k, path)?;
            self.put_s_child(&mut k, path)?;
        }

        let uses = k.next("image_uses")?;
        self.image_uses(uses, path)?;

        self.put_i_child(&mut k, path)?; // mouse related?
        self.put_i_child(&mut k, path)?;

        if self.version < 74 {
            let t = k.next("transitions")?;
            self.transitions(t, path)?;
        } else {
            let m = k.next("mouse_states")?;
            self.mouse_states(m, path)?;
        }
        k.done()
    }

    fn transitions(&mut self, list: &Element, path: &str) -> Result<(), String> {
        let ts = elements(list);
        self.count_of(ts.len(), "transitions", path)?;
        for (i, t) in ts.iter().enumerate() {
            let p = format!("{path}>transition[{i}]");
            if t.tag != "transition" {
                return Err(format!("{p}: expected <transition>, found <{}>", t.tag));
            }
            self.put_i_attr(t, "type", &p)?;
            self.put_u_attr(t, "id", &p)?;
            let mut k = Kids::new(t, &p);
            self.put_s_attr(t, "s1", &p)?;
            self.put_i_child(&mut k, &p)?;
            self.put_i_child(&mut k, &p)?;
            self.put_s_attr(t, "s2", &p)?;
            self.put_i_child(&mut k, &p)?;
            k.done()?;
        }
        Ok(())
    }

    fn mouse_states(&mut self, list: &Element, path: &str) -> Result<(), String> {
        let ms = elements(list);
        self.count_of(ms.len(), "mouse_states", path)?;
        for (i, m) in ms.iter().enumerate() {
            let p = format!("{path}>mouse_state[{i}]");
            if m.tag != "mouse_state" {
                return Err(format!("{p}: expected <mouse_state>, found <{}>", m.tag));
            }
            self.put_i_attr(m, "type", &p)?;
            self.put_u_attr(m, "id", &p)?;
            let mut k = Kids::new(m, &p);
            self.put_i_child(&mut k, &p)?;
            self.put_i_child(&mut k, &p)?;
            let data = k.next("mouse_state_data")?;
            let points = elements(data);
            self.count_of(points.len(), "mouse_state_data", &p)?;
            for (j, pt) in points.iter().enumerate() {
                let pp = format!("{p}>datapoint[{j}]");
                if pt.tag != "datapoint" {
                    return Err(format!("{pp}: expected <datapoint>, found <{}>", pt.tag));
                }
                self.put_u_attr(pt, "id", &pp)?;
                let mut pk = Kids::new(pt, &pp);
                self.put_s_child(&mut pk, &pp)?;
                self.put_s_child(&mut pk, &pp)?;
                self.put_s_child(&mut pk, &pp)?;
                pk.done()?;
            }
            k.done()?;
        }
        Ok(())
    }

    fn image_uses(&mut self, list: &Element, path: &str) -> Result<(), String> {
        let uses = elements(list);
        self.count_of(uses.len(), "image_uses", path)?;
        for (i, u) in uses.iter().enumerate() {
            let p = format!("{path}>image_use[{i}]");
            if u.tag != "image_use" {
                return Err(format!("{p}: expected <image_use>, found <{}>", u.tag));
            }
            self.put_u_attr(u, "image_id", &p)?;
            self.put_u_attr(u, "x", &p)?;
            self.put_u_attr(u, "y", &p)?;
            self.put_u_attr(u, "w", &p)?;
            self.put_u_attr(u, "h", &p)?;
            let mut k = Kids::new(u, &p);
            self.put_color_child(&mut k, &p)?;

            self.put_bool_child(&mut k)?; // tiled?
            self.put_bool_child(&mut k)?; // flipped x?
            self.put_bool_child(&mut k)?; // flipped y?
            self.put_i_attr(u, "dock", &p)?;
            if self.version >= 77 {
                self.put_i_attr(u, "dock_x", &p)?;
                self.put_i_attr(u, "dock_y", &p)?;
            }
            self.put_bool_child(&mut k)?; // stretch x?
            self.put_bool_child(&mut k)?; // stretch y?
            self.put_flt_child(&mut k, &p)?; // rotation angle
            self.put_flt_child(&mut k, &p)?; // pivot x
            self.put_flt_child(&mut k, &p)?; // pivot y
            if self.version >= 74 {
                self.put_s_attr(u, "shader", &p)?;
                self.put_flt_child(&mut k, &p)?; // axis x
                self.put_flt_child(&mut k, &p)?; // axis y
                self.put_flt_child(&mut k, &p)?; // axis z
                self.w.put_i(0); // constant (validated at decode)

                if self.version <= 77 {
                    self.put_bool_child(&mut k)?;
                }
                let margins = if self.version >= 92 { 4 } else { 2 };
                for _ in 0..margins {
                    self.put_flt_child(&mut k, &p)?;
                }
            } else if self.version >= 51 {
                self.put_bool_child(&mut k)?;
            }
            k.done()?;
        }
        Ok(())
    }

    fn anims(&mut self, list: &Element, path: &str) -> Result<(), String> {
        let anims = elements(list);
        self.count_of(anims.len(), "anims", path)?;
        for (i, a) in anims.iter().enumerate() {
            let p = format!("{path}>anim[{i}]");
            if a.tag != "anim" {
                return Err(format!("{p}: expected <anim>, found <{}>", a.tag));
            }
            let mut k = Kids::new(a, &p);
            self.put_flt_child(&mut k, &p)?; // x offset
            self.put_flt_child(&mut k, &p)?; // y offset
            self.put_i_child(&mut k, &p)?; // x size
            self.put_i_child(&mut k, &p)?; // y size
            self.put_color_child(&mut k, &p)?;
            for _ in 0..4 {
                self.put_flt_child(&mut k, &p)?; // shader vars
            }
            self.put_flt_child(&mut k, &p)?; // rotation angle
            self.put_i_child(&mut k, &p)?; // image index 1
            self.put_i_child(&mut k, &p)?; // image index 2
            self.put_i_child(&mut k, &p)?; // interpolation time
            self.put_i_child(&mut k, &p)?; // interpolation property mask
            self.put_flt_child(&mut k, &p)?; // easing weight
            self.put_s_attr(a, "curve", &p)?;
            let attrs = k.next("anim_attrs")?;
            let items = elements(attrs);
            self.count_of(items.len(), "anim_attrs", &p)?;
            for (j, aa) in items.iter().enumerate() {
                let pp = format!("{p}>anim_attr[{j}]");
                if aa.tag != "anim_attr" {
                    return Err(format!("{pp}: expected <anim_attr>, found <{}>", aa.tag));
                }
                self.put_u_attr(aa, "id", &pp)?;
                self.put_s_attr(aa, "anim", &pp)?;
                self.put_s_attr(aa, "state", &pp)?;
                self.put_s_attr(aa, "property", &pp)?;
            }
            if self.version >= 90 {
                self.put_bool_child(&mut k)?; // is movement absolute?
            }
            k.done()?;
        }
        Ok(())
    }

    fn funcs(&mut self, list: &Element, path: &str) -> Result<(), String> {
        let fns = elements(list);
        self.count_of(fns.len(), "funcs", path)?;
        for (i, f) in fns.iter().enumerate() {
            let p = format!("{path}>func[{i}]");
            if f.tag != "func" {
                return Err(format!("{p}: expected <func>, found <{}>", f.tag));
            }
            self.put_s_attr(f, "name", &p)?;
            let mut k = Kids::new(f, &p);
            self.put_bool_child(&mut k)?; // propagate?
            self.put_bool_child(&mut k)?; // make noninteractive?
            let anims = k.next("anims")?;
            self.anims(anims, &p)?;
            if self.version >= 91 {
                self.put_s_child(&mut k, &p)?;
            }
            k.done()?;
        }
        Ok(())
    }

    fn properties(&mut self, list: &Element, path: &str) -> Result<(), String> {
        let props = elements(list);
        self.count_of(props.len(), "properties", path)?;
        for (i, pr) in props.iter().enumerate() {
            let p = format!("{path}>property[{i}]");
            if pr.tag != "property" {
                return Err(format!("{p}: expected <property>, found <{}>", pr.tag));
            }
            self.put_s_attr(pr, "key", &p)?;
            self.put_s_attr(pr, "value", &p)?;
        }
        Ok(())
    }

    fn models(&mut self, ms: &Element, path: &str) -> Result<(), String> {
        let mut k = Kids::new(ms, path);
        self.put_s_child(&mut k, path)?;
        let header_size = if self.version == 74 {
            37
        } else if (84..=86).contains(&self.version) {
            50
        } else {
            74
        };
        self.put_data_child(&mut k, path, header_size)?;
        let models: Vec<&Element> = k.items[k.pos..].to_vec();
        self.w.put_i(models.len() as i32);
        for (i, m) in models.iter().enumerate() {
            let p = format!("{path}>model[{i}]");
            if m.tag != "model" {
                return Err(format!("{p}: expected <model>, found <{}>", m.tag));
            }
            self.put_s_attr(m, "mesh_path", &p)?;
            self.put_s_attr(m, "mesh_name", &p)?;
            let data_size = if self.version <= 77 {
                21
            } else if (84..=86).contains(&self.version) {
                29
            } else {
                1
            };
            let mut mk = Kids::new(m, &p);
            self.put_data_child(&mut mk, &p, data_size)?;
            self.put_i_child(&mut mk, &p)?;
            self.put_s_attr(m, "anim_name", &p)?;
            self.put_s_attr(m, "anim_path", &p)?;
            self.put_data_child(&mut mk, &p, 4)?;
            mk.done()?;
        }
        Ok(())
    }

    fn additional_data(&mut self, ad: &Element, path: &str) -> Result<(), String> {
        let ty = unescape_attr(req(ad, "type", path)?)?;
        if ty == "none" {
            self.w.put_bool(false);
            return Ok(());
        }
        self.w.put_bool(true);
        self.w.put_s(ty.as_bytes())?;
        let mut k = Kids::new(ad, path);
        match ty.as_str() {
            "List" | "HorizontalList" => {
                // Leading <flt> children are the data points; count is recomputed.
                let points = k.items[k.pos..]
                    .iter()
                    .take_while(|c| c.tag == "flt")
                    .count();
                self.count_of(points, "additional_data points", path)?;
                for _ in 0..points {
                    self.put_flt_child(&mut k, path)?;
                }
                self.put_i_child(&mut k, path)?; // mystery1
                self.put_i_child(&mut k, path)?; // mystery2
                self.put_bool_child(&mut k)?; // mystery3
                self.put_i_child(&mut k, path)?; // mystery4
                if self.version >= 54 && self.version != 77 {
                    self.put_bool_child(&mut k)?; // mystery5
                }
                if self.version >= 96 {
                    self.put_bool_child(&mut k)?; // mystery6
                    self.put_i_child(&mut k, path)?; // mystery7
                }
            }
            "Table" => {
                let table = k.next("table")?;
                let rows = elements(table);
                self.count_of(rows.len(), "table", path)?;
                for (i, row) in rows.iter().enumerate() {
                    let p = format!("{path}>row[{i}]");
                    if row.tag != "row" {
                        return Err(format!("{p}: expected <row>, found <{}>", row.tag));
                    }
                    let cols = elements(row);
                    self.count_of(cols.len(), "row", &p)?;
                    for (j, col) in cols.iter().enumerate() {
                        let pp = format!("{p}>col[{j}]");
                        if col.tag != "col" {
                            return Err(format!("{pp}: expected <col>, found <{}>", col.tag));
                        }
                        let mut ck = Kids::new(col, &pp);
                        for _ in 0..5 {
                            self.put_flt_child(&mut ck, &pp)?;
                        }
                        ck.done()?;
                    }
                }
            }
            "RadialList" => {
                for _ in 0..4 {
                    self.put_flt_child(&mut k, path)?;
                }
                self.put_bool_child(&mut k)?;
            }
            other => return Err(format!("{path}: unknown additional data type {other:?}")),
        }
        k.done()
    }

    fn uientry(&mut self, e: &Element, path: &str) -> Result<(), String> {
        self.put_u_attr(e, "id", path)?;
        self.put_s_attr(e, "title", path)?;
        self.put_s_attr(e, "title2", path)?;
        self.put_i_attr(e, "x", path)?;
        self.put_i_attr(e, "y", path)?;

        let mut k = Kids::new(e, path);
        for i in 1..=12 {
            if i == 3 {
                self.put_byte_child(&mut k, path)?;
            } else {
                self.put_bool_child(&mut k)?;
            }
        }
        if self.version < 90 {
            self.put_bool_child(&mut k)?;
        }

        self.put_uni_attr(e, "tooltip", path)?;
        self.put_uni_attr(e, "tooltip_id", path)?;

        self.put_i_attr(e, "dock", path)?;
        if self.version >= 77 {
            self.put_i_attr(e, "dock_x", path)?;
            self.put_i_attr(e, "dock_y", path)?;
        }

        self.put_bool_child(&mut k)?;
        self.put_i_attr(e, "default_state", path)?;

        let images = k.next("images")?;
        self.images(images, path)?;

        self.put_i_attr(e, "mask_image", path)?;
        self.put_i_child(&mut k, path)?; // version < 110 int

        let states = k.next("states")?;
        self.states(states, path)?;

        let props = k.next("properties")?;
        self.properties(props, path)?;
        self.put_i_attr(e, "priority", path)?;

        let funcs = k.next("funcs")?;
        self.funcs(funcs, path)?;

        let children = k.next("children")?;
        let kids: Vec<&Element> = elements(children);
        self.count_of(kids.len(), "children", path)?;
        for (i, c) in kids.iter().enumerate() {
            let p = format!("{path}>uientry[{i}]");
            if c.tag != "uientry" {
                return Err(format!("{p}: expected <uientry>, found <{}>", c.tag));
            }
            self.uientry(c, &p)?;
        }

        let ad = k.next("additional_data")?;
        self.additional_data(ad, path)?;

        self.put_s_child(&mut k, path)?; // end of uientry 1
        self.put_s_child(&mut k, path)?; // end of uientry 2

        if let Some(fa) = k.take_opt("float_array") {
            self.w.put_bool(true);
            let mut fk = Kids::new(fa, path);
            let n = fk.items.len();
            self.count_of(n, "float array", path)?;
            for _ in 0..n {
                self.put_flt_child(&mut fk, path)?;
            }
            fk.done()?;
        } else {
            self.w.put_bool(false);
        }

        if self.version == 97 {
            if let Some(ex) = k.take_opt("extra97") {
                self.w.put_bool(true);
                self.put_i_attr(ex, "first", path)?;
                let mut ek = Kids::new(ex, path);
                let n = ek.items.len();
                self.count_of(n, "extra97 array", path)?;
                for _ in 0..n {
                    self.put_i_child(&mut ek, path)?;
                }
                ek.done()?;
            } else {
                self.w.put_bool(false);
            }
            self.put_i_attr(e, "ref97", path)?;
        }

        if let Some(ms) = k.take_opt("models") {
            self.w.put_bool(true);
            self.models(ms, path)?;
        } else {
            self.w.put_bool(false);
        }

        if self.version <= 84 && self.version != 77 && self.version != 78 {
            self.put_bool_child(&mut k)?;
        } else {
            self.put_bool_child(&mut k)?;
            self.put_bool_child(&mut k)?;
        }

        if self.version >= 94 {
            self.put_bool_child(&mut k)?;
        }
        k.done()
    }
}
