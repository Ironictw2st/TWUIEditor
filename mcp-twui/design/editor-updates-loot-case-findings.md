# Editor updates from the loot-case session (findings -> program changes)

Distilled from the session that built the CS-style case-opening panel. Evidence files for every claim:

- `output/3K/loot_case_panel.twui.xml` (the panel: Loc()-driven text, keyframe sounds, script-object
  events, the isrelativeresize docking bug and its fix)
- `output/3K/loot_case.lua` (staged timer sequence, `paper:Visible()` state derivation, weighted roll)
- `output/3K/ironic_loot_case__.loc.tsv` (the TSV format and the metadata-row path in question)
- `games/3K/ui/*.twui.xml` shipped panels (dockpoint vocabulary corpus; grep results reproduced below)

Each finding has three parts: (a) the engine-level fact, (b) where it merges into
`mcp-twui/knowledge/` (merge notes only — the knowledge files are NOT edited by this doc), (c) the
XMLViewer change it motivates. Rule ids/severities follow the registry philosophy in
`src/twui/diagnostics/` (error = broken reference that breaks the layout; warning = real smell that
still loads; info = advisory / opt-in hint). Nothing here is implemented yet; a later session should
re-verify each claim against the evidence files before coding.

---

## 1. The localisation pipeline (Loc(), ContextTextLabel, TSV format)

### (a) Fact

- `Loc("x")` in any Cco expression resolves the `text` column of the row keyed
  `campaign_localised_strings_string_x` from the game's merged loc tables. Mod `.loc` files merge by
  key at load, so a mod can add or override individual rows.
- Static-looking UI text is idiomatically runtime-driven: the callback triple
  `ContextTextLabel` / `context_object_id="CcoStaticObject"` / `context_function_id="Loc(&quot;key&quot;)"`
  sets the display text, while the state's `text=` attribute remains a design-time placeholder
  (`textlocalised` absent). The placeholder is never what the player sees.
- `Loc()` composes over dynamic values: `Loc( L.FirstContext.FindValueForKey(&quot;name&quot;) )` and
  `ToUpper(Loc(...))` both work. Consequence: script-published tables (Lua data packs) should carry
  loc-key SUFFIXES, never English strings — the XML wraps the suffix in `Loc()` at display time.
- TSV source format: tab-delimited, header row `key<TAB>text<TAB>tooltip`, row 2 is the metadata line
  `#Loc;1;text/db/<name>__.loc<TAB><TAB>`, and every data row ends with a literal `false` in the
  tooltip column. (Verified byte-for-byte in `output/3K/ironic_loot_case__.loc.tsv`.)

### (b) Knowledge merges

- `04-callbacks-cco.md` — expand the `Loc(key)` builtin entry: the `campaign_localised_strings_string_`
  key prefix, composition over dynamic values (`Loc(FindValueForKey(...))`, `ToUpper(Loc(...))`), and
  the ContextTextLabel + CcoStaticObject + Loc() static-text triple as the idiom for "static" text.
- `06-templates-and-data.md` — extend the Localisation section with the full TSV byte format (metadata
  row, `false` terminator) and the merge-by-key load behaviour for mod loc files.
- `07-gotchas.md` — one bullet: `text=` on a state is a design-time placeholder whenever a
  ContextTextLabel is present; and script-published tables must carry loc-key suffixes, not English.
- `08-script-bridge.md` — one line in the data-pack guidance: publish loc-key suffixes from Lua, wrap
  in `Loc()` on the XML side.

### (c) Program changes

1. **Diagnostic `loc-key-unresolved` (warning, expensive)** — new rule file
   `src/twui/diagnostics/rules/locKeys.ts`. Scan every `context_function_id` (and `text` /
   `child_m_user_properties` values) for `Loc(&quot;<literal>&quot;)` calls with a literal-string
   argument; flag keys for which `campaign_localised_strings_string_<literal>` resolves to no row in
   any loc TSV visible to the workspace/pack. Dynamic arguments (non-literal) are skipped by
   construction. Backend support already exists: `src-tauri/src/loc.rs` loads
   `<data_root>/text/db/*.loc.tsv` (and already strips the campaign-strings prefix for bare-key
   lookups); the rule needs the loc key set exposed to the frontend and threaded into `DiagContext`
   (`src/twui/diagnostics/types.ts` / `engine.ts` — a small, deliberate extension: today the context
   is doc-only). Severity warning, not error: an unresolved key still loads, it just renders blank or
   raw. Cost expensive (needs the workspace loc index; run in the full panel pass only).
2. **Inspector affordance: "runtime-driven text" badge** — in `src/panels/InspectorPanel.tsx`, when a
   component carries a `ContextTextLabel` callback, badge the state `text` field as runtime-driven
   (placeholder), so the design-time string is not mistaken for display text. Purely presentational.
3. **Opt-in lint `static-text-unlocalised` (info, expensive, default off)** — same new rule file.
   Flag states with a non-empty `text=`, no ContextTextLabel on the owning component, and text that is
   not an obvious placeholder (heuristics to settle at implementation time: skip pure punctuation /
   numbers / `{{...}}` tokens). This is a loc-extraction hint for authors, not an integrity problem —
   info severity and off by default, consistent with the advisory tier.

---

## 2. Loc TSV pack-path discrepancy (text/db vs text/ui) — OPEN QUESTION

### (a) Fact

This session's `output/3K/ironic_loot_case__.loc.tsv` declares
`#Loc;1;text/db/ironic_loot_case__.loc` in its metadata row and was packed to `text/db/`, and it
loaded in-game. An earlier session concluded 3K mod loc files belong in `text/ui/` (memory
`loc-files-pack-to-text-ui`), and files packed that way also loaded. Both paths apparently work; it is
NOT established whether the engine reads the metadata row's declared path, the actual pack path, both,
or neither (merge may be pack-wide for `*.loc`). Do not guess — **verify in-game** which of the four
combinations (path x metadata) load, before encoding any normalization.

### (b) Knowledge merges

- `06-templates-and-data.md` — add a "mod loc pack path" note under Localisation stating both observed
  variants and marking the canonical path as unverified. (The file currently documents only the
  extracted vanilla location `games/3K/text/db/*.loc.tsv`, which is a different question from where a
  MOD packs them.)
- `07-gotchas.md` — one bullet flagging the discrepancy so future sessions don't "correct" one form to
  the other silently.

### (c) Program change

**Pack-time consistency check `loc-metadata-path-mismatch` (warning)** — this is not a twui-document
diagnostic (the rule registry in `src/twui/diagnostics/` only sees the open layout), so it lands in
the pack-editing path instead: when a `*.loc.tsv` / `*.loc` file is added or saved into a pack
(`src/panels/PackEditorPanel.tsx` / `PackFilesPanel.tsx`, backend `src-tauri/src/source/pack.rs`),
compare the `#Loc;1;<path>` metadata row against the file's actual pack path and warn on mismatch.
Until the in-game verification above is done, the check must only require *internal consistency*
(metadata == actual path) and must NOT prefer `text/db/` over `text/ui/` or rewrite anything. Once
verified, a normalize-on-save option can be considered.

---

## 3. `isrelativeresize` on an image breaks dockpoint positioning

### (a) Fact

An `<image>` inside `<imagemetrics>` with `isrelativeresize="true"`, in a component whose state size
differs from the image size, is silently rescaled/repositioned by the engine so that dockpoint
centering fails. Observed: a 72x72 icon docked `Top Center` in a 400px-wide component rendered far
left of center; removing the flag fixed it. The working idiom — used by every correctly-centered slot
in the same file — is: size the component to the image, `dockpoint="Center"`, and no
`isrelativeresize`. (Evidence: `output/3K/loot_case_panel.twui.xml`, which now contains 4 remaining
`isrelativeresize` occurrences in contexts where sizes match.)

### (b) Knowledge merges

- `07-gotchas.md` — new Positioning bullet: isrelativeresize + size mismatch defeats dockpoint;
  state the working idiom.
- `03-attributes.md` — annotate the `isrelativeresize` line in the Image section with the interaction
  warning (the current `schema.ts` description "Resize relative to the parent rather than to an
  absolute size" describes the mechanism but not the trap).

### (c) Program changes

1. **Diagnostic `image-relative-resize-dock` (info, cheap) — IMPLEMENTED** — rule file
   `src/twui/diagnostics/rules/imageResizeDock.ts` (+ `.test.ts`). For each non-templated component:
   if a state image has `isrelativeresize="true"`, a `dockpoint` other than `Top Left`/`None`/absent,
   and the image's effective size (image metric w/h, falling back to the referenced `component_image`
   w/h) differs from the owning state's `width`/`height`, emit an advisory.
   SEVERITY REVISED DOWN from the originally proposed warning: corpus calibration (2026-07-22, the
   same predicate run over `games/3K/ui` + `output/3K`) found 214 hits across 48 shipping CA files
   (hud_battle, city_info_bar, army_id, building_browser_panel, ...) and hits in our own
   verified-good panels (rewards.twui.xml, and 2 benign cases remaining in loot_case_panel itself) —
   all rendering correctly in-game. The predicate therefore cannot separate broken from intentional
   usage; the combination is standard CA authoring practice that only SOMETIMES misplaces the image.
   It is an advisory pointer for "my image is not where its dockpoint says", not a defect signal, so
   it ships at info with a "may override" message. This also revises finding (a): the flag CAN defeat
   the dockpoint (proven in the loot-case), but does not always.
2. **Visualizer fidelity item** — `src/layout/compute.ts` honors `dockpoint` (via `dockFrac`, ~line
   608) but contains no handling of `isrelativeresize` at all (verified: zero matches in the file).
   That is exactly why this bug was invisible headlessly: the editor drew the intended centered
   layout while the game drew the broken one. Two-step remedy, in order of risk:
   - Cheap and safe first: surface the new diagnostic and/or an overlay marker in
     `src/panels/VisualizerPanel.tsx` on images carrying the flag, so the preview declares its
     infidelity instead of silently diverging.
   - Only then, optionally, implement the actual relative-resize behaviour in `compute.ts` — and per
     the standing layout-engine caution, keep the change narrow (one code path, flag-gated if
     possible) and have the user re-render real panels before trusting it. compute.ts changes have
     silently broken unrelated panels before.

---

## 4. dockpoint vocabulary — ALREADY COVERED (verification recorded)

### (a) Fact

Shipped 3K panels use the multi-word dockpoint tokens `Center`, `Top Center`, `Bottom Center`,
`Center Left`, `Center Right`, `Center Right External`, and more. Full corpus grep over
`games/3K/ui/**/*.twui.xml` (this session) found exactly 19 distinct tokens:
`None`, the 9 non-external positions, and all 9 `... External` variants (`Center External` occurs
once). An unknown token is likely a silent engine fallback to top-left.

### (b) Knowledge merges

- `03-attributes.md` — the Docking enum list already enumerates this vocabulary; optionally add the
  note that the set was verified against the full shipped-3K corpus (19/19 observed tokens match).

### (c) Program change

**None needed — already covered.** `src/twui/schema.ts` `DOCKING_VALUES` contains exactly the 19
observed tokens, and the existing `attr-value` rule (`src/twui/diagnostics/rules/attrValue.ts`,
warning, expensive) already validates `dockpoint` (an enum attr, `schema.ts` ~line 202) against it.
Warning is the right severity per the philosophy (the file loads; rendering silently falls back).
Record only: the corpus verification above is the evidence that the enum is complete for 3K; if a
future game's corpus adds tokens, extend `DOCKING_VALUES`, not the rule.

---

## 5. Phantom-element triage -> two editor features

### (a) Fact (the method, engine-level)

When the game shows an element the source file should not produce, the decisive elimination sequence
is: (1) full component inventory from `<hierarchy>` — it is the complete list, nothing renders that
is not in it (or engine-cloned from it); (2) programmatic geometry scan of every image/state for
line-like shapes (width >= 400 and height <= 12, plus solid-colour fills); (3) grep for line idioms
(`1x1_white.png` stretched, black colour presets); (4) opening the referenced art assets to rule out
baked-in decoration; (5) cross-checking Lua visibility toggles against what each view actually shows.
When all five come up empty, the packed copy is stale — the `.pack` layout predates the on-disk file.

### (b) Knowledge merges

- `07-gotchas.md` — new "Debugging in-game vs source" bullet: the five-step phantom-element triage,
  ending with "if all clear, suspect a stale pack".
- `00-overview.md` — one line in the practical loop: after repacking, confirm the pack actually
  contains the current bytes (stale packs are a real failure mode).

### (c) Program changes (features, not rules)

1. **Element finder / "what renders here" query** — in `src/panels/VisualizerPanel.tsx` backed by
   `src/layout/compute.ts` (which already produces per-image draw rects): given a click or an entered
   x/y (or a shape query such as "line-like: w >= N, h <= M, solid colour"), list every component /
   state image whose draw rect covers it, with GUIDs for jump-to-inspector. This mechanizes steps
   (1)-(3) of the triage in one query and is fully general (pure geometry, no panel knowledge).
2. **Stale pack detector (pack-vs-workspace diff)** — using the existing pack-reading DataSource seam
   (`src-tauri/src/source/pack.rs`, `workspace.rs`, `overlay.rs`): for a layout that exists both
   inside a selected `.pack` and on disk under the workspace/output tree, compare bytes (or parsed
   docs) and surface "pack copy differs from on-disk copy" with a jump into the existing Merge Mode
   (`src/twui/merge/`) for the structural diff. Surfacing point: `src/panels/PackFilesPanel.tsx`
   (badge on the file row) and/or a command in `src/panels/MergeDialog.tsx`.

---

## 6. Miscellaneous engine facts (one merge note each)

### 6.1 Keyframe sounds are raw Wwise event names; loops pair Start/Stop

(a) A keyframe `<frame>`'s `soundcategory` attribute takes a raw Wwise EVENT name; looping events use
the pair `soundcategory` (the `..._Start` event) / `soundcategoryend` (the `..._Stop` event).
Evidence: `output/3K/loot_case_panel.twui.xml` lines ~1059-1060
(`UI_CAM_ANI_PostBattle_Loot_Ticker_Start` / `..._Stop`) and one-shot frames elsewhere in the file.

(b) Merge: `03-attributes.md` (add `soundcategory`/`soundcategoryend` to the animation-frame attrs
with the raw-Wwise-event note) and `07-gotchas.md` (looping events need the end event or they play
forever).

(c) Program change: none automatable (the editor cannot know which Wwise events loop). At most an
inspector description string on the two attrs in `src/twui/schema.ts`. No diagnostic proposed.

### 6.2 Two script-object event name forms: `ScriptObjectUpdate_<name>` vs `ScriptObjectValueUpdated<name>`

(a) `ScriptObjectUpdate_<name>` (WITH underscore) fires for Lua-published script objects
(`common.set_context_value` side), while `ScriptObjectValueUpdated<name>` (NO underscore) fires for
XML-set values (`ScriptObjectContext("<name>").Set*Value`). A callback that must re-evaluate when the
value changes from either side needs BOTH listed (event0/event1). Evidence:
`output/3K/loot_case_panel.twui.xml` lines ~1437-1453 and ~1919-1925 list both forms for the same
name; `04-callbacks-cco.md`/`08-script-bridge.md` currently document only the no-underscore form.

(b) Merge: `08-script-bridge.md` (the naming rule and which side raises which) and `04-callbacks-cco.md`
(the eventK guidance: list both forms when the writer side is unknown or mixed).

(c) Program change: **Diagnostic `script-object-event-form` (info, cheap)** — candidate for a new
rule file `src/twui/diagnostics/rules/scriptObjectEvents.ts`: within `child_m_user_properties`, when
an `eventK` value matches `^ScriptObjectValueUpdated(.+)` or `^ScriptObjectUpdate_(.+)` and no sibling
`eventK` on the same callback carries the other form for the same `<name>`, emit info ("only one of
the two script-object event forms is listed; add the other if the value can also be set from
Lua/XML"). Info, not warning: single-form is correct whenever the author knows the single writer —
this is a hint, per the advisory tier. Implementation should verify the exact Lua-side event name
against a live test before coding (the underscore form is from one session's observation).

### 6.3 Derive UI state from live component properties, not Lua flags

(a) With `dont_cache`, panels are destroyed on close and rebuilt on open, so Lua-side "is the panel
open / which view is showing" flags go stale. Reading a live component property instead (e.g.
`paper:Visible()` on a component the panel itself toggles) is always correct. Evidence:
`output/3K/loot_case.lua` ~line 667.

(b) Merge: `08-script-bridge.md` (a "reading UI state from Lua" note).

(c) Program change: none (Lua-side practice; the editor does not lint Lua). Knowledge-only.

### 6.4 Staged Lua sequences: one shared timer name for all cm:callback stages

(a) A multi-stage timed sequence should register every `cm:callback` under ONE shared timer name so a
single `cm:remove_callback(name)` tears the whole sequence down (skip/close/interrupt). Evidence:
`output/3K/loot_case.lua` — all stages use `CFG.timer_name` (~lines 758-788).

(b) Merge: `08-script-bridge.md` (sequencing pattern note).

(c) Program change: none (Lua-side practice). Knowledge-only.

---

## Pre-existing coverage and contradictions noticed while surveying

- **Finding 4 is already implemented** — `attrValue.ts` + `DOCKING_VALUES` cover dockpoint token
  validation; this doc only records the corpus verification.
- **Finding 2 vs `06-templates-and-data.md`** — the knowledge file documents vanilla loc under
  `text/db/` only; the mod-pack path question (text/db vs text/ui) is not covered anywhere in
  `mcp-twui/knowledge/` and contradicting session evidence exists on both sides. Kept open above.
- **Unrelated but found**: `08-script-bridge.md` (line ~38) shows
  `string.find(e:event_id(), "...", 1, true)` — the 4-arg form. Per the later-established fact
  (memory `tw3k-lua-string-find-2-args`) this game's Lua takes the 2-arg form only; that example
  should be corrected in a knowledge-file editing session (out of scope here).
- **Diagnostics engine assumption to extend carefully**: `src/twui/diagnostics/types.ts` states the
  registry derives everything from the in-memory doc. The `loc-key-unresolved` rule (finding 1) is
  the first to need external data (the workspace loc index) in `DiagContext`; that extension should
  keep the doc-only rules unaffected and degrade to silence when no workspace is loaded (mirroring
  `attr-version`'s "silent when version unknown" precedent).
