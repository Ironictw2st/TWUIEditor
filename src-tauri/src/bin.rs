//! Decode binary Total War db tables and `.loc` files via `rpfm_lib`, adapting the output to the
//! shapes the loaders consume: db -> (field names, rows of strings) like the RPFM TSV export, loc ->
//! key->text. (Replaces the former hand-rolled PFH binary readers.)

use rpfm_lib::files::{DecodeableExtraData, FileType, RFile, RFileDecoded};
use rpfm_lib::schema::Schema;
use std::collections::HashMap;

/// Decode a binary db table to (field names, rows of strings) — the same shape as the RPFM TSV
/// export the folder-mode loaders parse. `None` if the table has no schema definition or the bytes
/// don't decode. Cells are stringified exactly as RPFM renders them (bools as `true`/`false`, etc.).
pub fn decode_db(
    bytes: &[u8],
    schema: &Schema,
    table: &str,
) -> Option<(Vec<String>, Vec<Vec<String>>)> {
    // Wrap the raw bytes as an RFile whose path names the table (db/<table>/data__) so rpfm derives
    // the table name; the schema + table name go in via the decode extra data.
    let mut rfile = RFile::new_from_vec(bytes, FileType::DB, 0, &format!("db/{table}/data__"));
    let mut extra = DecodeableExtraData::default();
    extra.set_schema(Some(schema));
    extra.set_table_name(Some(table));
    let decoded = rfile.decode(&Some(extra), false, true).ok()??;
    let RFileDecoded::DB(db) = decoded else { return None };
    // Rows correspond to the definition's processed fields (ColourRGB split, patches applied), so the
    // header must use the same list to line up with the cells.
    let header: Vec<String> = db
        .definition()
        .fields_processed()
        .iter()
        .map(|f| f.name().to_string())
        .collect();
    let rows: Vec<Vec<String>> = db
        .data()
        .iter()
        .map(|row| row.iter().map(|c| c.data_to_string().into_owned()).collect())
        .collect();
    Some((header, rows))
}

/// Decode a binary `.loc` file, inserting each key->text pair into `out` (later sources override).
pub fn decode_loc(bytes: &[u8], out: &mut HashMap<String, String>) {
    let mut rfile = RFile::new_from_vec(bytes, FileType::Loc, 0, "loc/data__.loc");
    // Loc has a fixed definition and ignores the extra data.
    let Ok(Some(RFileDecoded::Loc(loc))) = rfile.decode(&None, false, true) else {
        return;
    };
    // Loc columns are [key, text, tooltip]; keep key -> text.
    for row in loc.data().iter() {
        if let (Some(k), Some(v)) = (row.first(), row.get(1)) {
            out.insert(k.data_to_string().into_owned(), v.data_to_string().into_owned());
        }
    }
}
