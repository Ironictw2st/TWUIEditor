//! Parse the user's local RPFM `.ron` schema (e.g. `schema_3k.ron`) just enough
//! to decode binary db tables: per table, an ordered field list (name + type)
//! for each table version. Extra per-field keys in the RON are ignored by serde.

use serde::de::{self, EnumAccess, SeqAccess, VariantAccess, Visitor};
use serde::Deserialize;
use std::collections::HashMap;
use std::fmt;

/// Field storage type, mirroring RPFM's `FieldType`. The scalar variants are the
/// ones we decode; the nested-sequence variants (present in e.g. the WH3 schema)
/// must be declared so the whole `.ron` parses — we don't decode them, so a table
/// using one bails to its TSV. `#[serde(other)] Unknown` only catches unknown
/// *unit* variants.
#[derive(Deserialize, Clone)]
pub enum FieldType {
    StringU8,
    OptionalStringU8,
    StringU16,
    OptionalStringU16,
    I16,
    I32,
    I64,
    F32,
    F64,
    Boolean,
    ColourRGB,
    /// Nested sub-table (RPFM `SequenceU16/U32`); carries a boxed definition. We
    /// can't flatten these into rows, so decoding bails for such tables.
    SequenceU16(Box<Definition>),
    SequenceU32(Box<Definition>),
    #[serde(other)]
    Unknown,
}

#[derive(Deserialize, Clone)]
pub struct Field {
    pub name: String,
    pub field_type: FieldType,
}

#[derive(Deserialize, Clone)]
pub struct Definition {
    pub version: i32,
    pub fields: Vec<Field>,
}

/// One entry of the schema's `versioned_files` list. RPFM has many variants
/// (DB, Loc, DepManager, AnimFragment, AnimTable, MatchedCombat, …) that differ
/// per game and grow over time; we only consume `DB("name", [defs])` and skip
/// the rest, so a custom Deserialize tolerates any (single-payload) variant
/// instead of enumerating them.
enum VersionedFile {
    Db(String, Vec<Definition>),
    Other,
}

/// The enum variant name, read via `deserialize_identifier` (RON variant tags are
/// bare identifiers, not quoted strings).
struct Tag(String);
impl<'de> Deserialize<'de> for Tag {
    fn deserialize<D>(d: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        struct TagV;
        impl Visitor<'_> for TagV {
            type Value = String;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a variant identifier")
            }
            fn visit_str<E: de::Error>(self, v: &str) -> Result<String, E> {
                Ok(v.to_string())
            }
            fn visit_string<E: de::Error>(self, v: String) -> Result<String, E> {
                Ok(v)
            }
        }
        d.deserialize_identifier(TagV).map(Tag)
    }
}

impl<'de> Deserialize<'de> for VersionedFile {
    fn deserialize<D>(d: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        struct VfVisitor;
        impl<'de> Visitor<'de> for VfVisitor {
            type Value = VersionedFile;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a versioned-file enum entry")
            }
            fn visit_enum<A>(self, data: A) -> Result<VersionedFile, A::Error>
            where
                A: EnumAccess<'de>,
            {
                let (tag, va): (Tag, A::Variant) = data.variant()?;
                if tag.0 == "DB" {
                    // DB(String, Vec<Definition>) — a 2-element tuple variant.
                    struct DbBody;
                    impl<'de> Visitor<'de> for DbBody {
                        type Value = (String, Vec<Definition>);
                        fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                            f.write_str("DB(name, definitions)")
                        }
                        fn visit_seq<S>(self, mut seq: S) -> Result<Self::Value, S::Error>
                        where
                            S: SeqAccess<'de>,
                        {
                            let name = seq
                                .next_element::<String>()?
                                .ok_or_else(|| de::Error::invalid_length(0, &self))?;
                            let defs = seq
                                .next_element::<Vec<Definition>>()?
                                .ok_or_else(|| de::Error::invalid_length(1, &self))?;
                            Ok((name, defs))
                        }
                    }
                    let (name, defs) = va.tuple_variant(2, DbBody)?;
                    Ok(VersionedFile::Db(name, defs))
                } else {
                    // Any other variant (single payload) — consume + ignore.
                    va.newtype_variant::<de::IgnoredAny>()?;
                    Ok(VersionedFile::Other)
                }
            }
        }
        d.deserialize_enum("VersionedFile", &[], VfVisitor)
    }
}

#[derive(Deserialize)]
struct SchemaFile {
    versioned_files: Vec<VersionedFile>,
}

/// Parsed schema: table name -> its versioned definitions.
pub struct Schema {
    tables: HashMap<String, Vec<Definition>>,
}

impl Schema {
    pub fn parse(text: &str) -> Result<Schema, String> {
        let raw: SchemaFile = ron::from_str(text).map_err(|e| format!("schema parse: {e}"))?;
        let mut tables = HashMap::new();
        for vf in raw.versioned_files {
            if let VersionedFile::Db(name, defs) = vf {
                tables.insert(name, defs);
            }
        }
        Ok(Schema { tables })
    }

    /// Ordered fields for `table` at `version`, falling back to the highest
    /// available version when the exact one is absent.
    pub fn fields_for(&self, table: &str, version: i32) -> Option<&[Field]> {
        let defs = self.tables.get(table)?;
        defs.iter()
            .find(|d| d.version == version)
            .or_else(|| defs.iter().max_by_key(|d| d.version))
            .map(|d| d.fields.as_slice())
    }
}
