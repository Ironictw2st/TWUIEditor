# 01 — File format & byte conventions

TWUI files were produced by CA's "UIEd" editor and the game round-trips them. The editor in this repo
preserves them **byte-for-byte** on an unedited load→save. If you author a file, match these conventions
exactly or the file will look "wrong" (and diffs/round-trip checks will fail).

Source of truth: `src-tauri/src/model/serialize.rs`, `parse.rs`, `mod.rs` (round-trip tests).

## Byte-level rules

1. **Line endings: CRLF (`\r\n`)** on every line, including the last.
2. **Indentation: TAB characters**, one per nesting depth. Never spaces.
3. **Attribute layout depends on count:**
   - **0 or 1 attribute** → inline on the tag's own line: `<root this="GUID"/>` or
     `<callback_with_context callback_id="Button"/>`.
   - **2 or more attributes** → tag name alone, then **each attribute on its own line indented one tab
     deeper**, and the closing `>` or `/>` sits at the end of the last attribute's line:
     ```
     <component_image
     	this="GUID"
     	uniqueguid="GUID"
     	width="38"
     	height="38"/>
     ```
4. **Empty elements self-close** (`<foo/>`), non-empty elements use `<foo> ... </foo>`.
5. **Prolog**: first line is `<?xml version="1.0"?>`. Game/UIEd files often have a second line
   `<!--Layout created with UIEd.  Hand edit at your peril!-->`, but **v136 game files frequently omit
   it** (e.g. `templates/template_treaty_listview_left.twui.xml`). For hand-authored files, omitting the
   comment is fine and is what we do.
6. **Root element & tail**: `<layout version="N" comment="" precache_condition="">` … then in order
   `<hierarchy>…</hierarchy>`, `<components>…</components>`, `<localisation_changes/>`, `</layout>`, and a
   trailing CRLF after `</layout>`. (`<localisation_changes/>` exists in ≤136 and is **removed in v142** —
   see `02-versions.md`.)
7. **Attribute values are kept escaped exactly as written** for round-trip: `&quot;` for `"`, `&amp;` for
   `&`, `&lt;`/`&gt;`. The parser does NOT unescape into the stored model. When you write an expression
   with quotes (common in `context_function_id`), escape them: `EffectBundleFromKey(&quot;key&quot;)`.

## GUIDs

- Format is **uppercase hex grouped 8-4-4-16**: `7247FC19-F2AB-4971-9F33271E13E6C929`. This is **not** a
  standard UUID (the last group is 16 hex chars, not 4-12).
- On each component / state / component_image, `this` and `uniqueguid` are the **same** GUID.
- A component's `currentstate`/`defaultstate` point at its **active state's** GUID.
- Every GUID in a file should be **unique within that file**. When cloning a template into a new file, its
  internal GUIDs are already self-consistent; just make sure they don't collide with GUIDs you add.
- There is no semantic meaning to the bits — generate random valid 8-4-4-16 hex. (Pattern we used for
  hand-authored anchors: `A1B2C3D4-1111-400N-...` for the root, distinct prefixes per component.)

## The minimal valid v136 skeleton

See `00-overview.md` "Quick-start". Minimum = `<?xml>` + `<layout version="136" comment="" precache_condition="">`
+ a `<hierarchy>` with a `<root>` + a `<components>` `root` definition with at least one state +
`<localisation_changes/>` + `</layout>`.

## The "splice" authoring method (recommended for real widgets)

Hand-typing hundreds of lines of states/images is error-prone (especially tabs). Instead, **reuse a
shipped template verbatim** and only hand-write the parts that change. This is how
`effect_bundle_button.twui.xml` was built from `3k_btn_medium`:

1. **Write a "head" part** (LF is fine for now): the `<?xml>`/`<layout>`/`<hierarchy>`, the `root` canvas
   component, and your component's opening tag + `<callbackwithcontextlist>` (your callbacks). End it just
   before the template's `<userproperties>`.
2. **Write a "tail" part**: your component's closing tag, `</components>`, `<localisation_changes/>`,
   `</layout>`.
3. **Splice the template's middle verbatim**: extract the template component's
   `<userproperties>` + `<componentimages>` + `<states>` (+ `<animations>` if present) line-range from the
   shipped `.twui.xml` and drop it between head and tail. Because those sit at the same nesting depth in
   your file (component at 2 tabs), the tabs line up.
4. **Convert LF → CRLF** for the whole assembled file.
5. **Verify** (see below).

Concretely (bash), assembling head + template lines + tail and normalizing to CRLF:

```bash
tpl='.../templates/3k_btn_medium.twui.xml'
{ tr -d '\r' < head.tmp
  tail -n +61 "$tpl" | head -n 323 | tr -d '\r'   # the template's userprops+componentimages+states
  tr -d '\r' < tail.tmp
} > combined.tmp
awk 'BEGIN{ORS="\r\n"}{sub(/\r$/,"");print}' combined.tmp > out.twui.xml
```

To **insert a new state** (e.g. a `purchased` state) into a cloned `<states>` block, splice the template
up to the last existing state's close, append your hand-authored state (at 4-tab depth, matching the
others), then `</states>`, then any trailing `<animations>` and the closing tags.

> Tip: the `Write` tool writes LF; author the parts with literal tabs, then do the LF→CRLF step.

## Validation checklist

After writing, verify:

- **CRLF integrity**: count `0d` and `0a` bytes — they must be **equal**, with **no lone LF** (every `0a`
  preceded by `0d`) and **no doubled CR** (`0d 0d`).
  ```bash
  cr=$(od -An -tx1 f | tr ' ' '\n' | grep -c '^0d$'); lf=$(od -An -tx1 f | tr ' ' '\n' | grep -c '^0a$')
  echo "CR=$cr LF=$lf"   # must be equal
  ```
- **Tabs present** (`\r\n\t` appears), no leading spaces.
- **Head/tail bytes**: starts `<?xml version="1.0"?>\r\n<layout\r\n\t...`; ends `</layout>\r\n`.
- **Well-formed XML**: `python -c "import xml.dom.minidom as m; m.parseString(open('f','rb').read())"`.
  (The `&quot;`/`&amp;` entities and `{{tt:...}}` tokens inside attribute values parse fine.)
- **GUID consistency**: each `<hierarchy>` node GUID has a matching `<components>` definition;
  `currentstate`/`defaultstate` resolve to a state in the component.

What validation can NOT catch: whether the layout *renders* correctly or whether *tooltips/data bindings*
work — those need the editor (geometry/images) and ultimately the **game** (tooltips, live data). See
`07-gotchas.md`.
