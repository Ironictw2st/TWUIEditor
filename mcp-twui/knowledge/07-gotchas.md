# 07 — Gotchas (the traps, consolidated)

The non-obvious things that cost time. Most map to a `.claude` memory or a source comment.

## Format / round-trip
- **Round-trip must stay byte-identical.** Don't "normalize" output: keep CRLF, tabs, the 0/1-inline vs
  2+-one-per-line rule, self-closing empties, and attributes in original order with original escaping.
  The editor verifies this (`cargo test roundtrip`); a hand-authored file should follow the same rules.
- **Escape expressions.** `context_function_id` values with quotes/`&&`/`>=` must be XML-escaped
  (`&quot;`, `&amp;&amp;`, `&gt;=`). Forgetting this is a frequent silent break.
- **The `Write` tool emits LF.** Always do the LF→CRLF normalization step and re-verify `CR==LF` after any
  edit (even a one-line edit can re-save as LF depending on the tool).
- **GUIDs are 8-4-4-16 uppercase**, not standard UUIDs. `this`==`uniqueguid`. Keep them unique per file.
- **If a hand-tuned file has diverged from the script that generated it, edit it in place — don't regenerate.**
  Re-running the generator silently reverts editor tweaks (a moved button `offset`, a changed gate). Diff the
  generator's output against the live file before trusting a regenerate.

## Positioning / layout
- **`offset` already bakes docking/anchor.** It is the component's top-left relative to the parent and
  already includes the docking term. Do NOT re-apply docking on top of an offset (double-counts, shifts
  the component off-spot).
- **Never author/apply `dock_offset`** — it's a stale editor cache (e.g. a top-bar with
  `dock_offset="-426"` that actually belongs at the top-left).
- **LayoutEngine children ignore their own `offset`.** Inside a `<LayoutEngine>`, a child's `offset` is the
  editor's cached computed position, not a nudge. Re-adding it makes children fly off. The engine cursor
  places them.
- **Sizeless icons**: image size precedence is image-metric w/h → component_image w/h → natural pixel size.
  Do NOT fall back to the parent rect (it stretches sizeless icons huge).
- **Layout-engine/measure changes are high-regression-risk and unverifiable headlessly** — keep them
  narrow and have a human re-render; one fix has silently broken other panels before.

## Tooltips (see `05-tooltips.md` for the full story)
- **`componentleveltooltip="{{tt:layout}}"` is a `CustomTooltip`** that needs the bundle as the component's
  **primary inherited context from a parent**. It will NOT fire for a standalone literal — and won't even
  show on the in-game `CurrentTooltip`. Use `ContextTooltipSetter` instead.
- **`ContextObjectStore` ≠ `ContextCustomTooltipStore` ≠ what a `ContextTooltipSetter` does.** Don't reach
  for the stores to "feed" a standalone tooltip; they didn't work. The setter is the answer.
- **`ContextPropagator`'s `context_object_id` is the SOURCE, not the output type.** For a literal
  `EffectBundleFromKey("key")` use `CcoStaticObject` (the universal static context), not `CcoEffectBundle`
  (nothing of that type is in scope to read from).
- **Set `tooltipslocalised="false"`** when a `ContextTooltipSetter` returns literal display text, or the
  engine treats the string as a loc key and shows nothing.
- **The editor can't render `{{tt:...}}` tooltips** (strips `tt:` refs, no live data) — verify in-game.

## Data / context
- **Effect-bundle tooltips are inherently context-driven.** In shipping panels the bundle rides in as the
  component's primary context (a unit's `EffectBundleList`, or a Lua script-data node). A standalone file
  fakes this with the `ContextTooltipSetter` inline-`EffectBundleFromKey` trick.
- **"Outraged" (`3k_main_effect_bundle_public_order_outraged_outlaws`) is a province public-order bundle**,
  not normally faction-owned. So a `purchased` check `PlayersFaction.EffectBundleList(true).Any(Key==...)`
  using that key won't trigger in normal play. To demonstrate the lock, use a bundle the faction actually
  has (a faction-trait/rank bundle).
- **No "faction effect bundle changed" event** exists, but you CAN live-refresh by riding a side-effect: if a
  linked Lua spends a pooled resource on the same action, the nodes/button re-evaluate on
  `PooledResourceTransaction` / `PooledResourceValueChanged`. The catch: make the Lua **apply the bundle before
  deducting** so ownership is already true when the resource event fires. See `08-script-bridge.md` and
  `recipes/purchase-button.md`. (`ContextStateSetterConditional` still also evaluates on load.)

## Interactive / purchase widgets (see `recipes/purchase-button.md`, `08-script-bridge.md`)
- **The XML can't spend or grant.** It fires a script event; the real change is in Lua/DB. A "cost" shown in
  the UI is cosmetic unless the Lua enforces it.
- **Don't clear a selection script value in the same click that fires the event.** The event reaches Lua
  *after* the click's UI callbacks, so the clear blanks the value before Lua reads it. Let it persist and gate
  re-clicks instead (a not-already-owned check + the Lua `has_effect_bundle` guard).
- **Apply-before-deduct** in the Lua, so the deduction's `PooledResource*` refresh sees the bundle already
  applied — otherwise the node won't flip to `purchased`.
- **The `purchased` state blanks a dynamic icon.** Its icon image carries `shader_name="brighten_t0"` with
  `shadertechnique_vars="1.00,0.00,0.00,0.00"`, which washes a dynamically-set (`ContextImageSetter`) icon out
  to nothing. Drop that one attribute *inside `<purchased>` only* (keep the grey `#818181FF`); leave the
  `selected*` states' brighten (that's their highlight glow).
- **Cco has no clean `!`.** Negate with `(expr) == false`, e.g. `...Any( Key == k ) == false`.
- **A shared placeholder bundle key** on every node makes them all read as owned after the first buy — give
  each node a unique key for per-node behaviour. (A price keyed by bundle key also can't differentiate nodes
  that share a key — key it by the node GUID until each node has its own bundle key.)
- **Variable/signed costs go in a NUMERIC script object, not a string one.** Carry a per-node price with
  `ScriptObjectContext("<id>").SetNumericValue(n)` / `.NumericValue` and gate with `Total + n >= 0` (positive =
  a refund, always affordable; negative = a purchase needing `Total >= |n|`). The engine's
  `apply_transaction_to_factor(factor, n)` takes the signed value directly (negative decreases the pool,
  positive increases) — pick one sign convention, keep UI + Lua agreed, and don't double-negate.
- **A zero-cost transaction fires no refresh.** `apply_transaction_to_factor(factor, 0)` doesn't change the pool,
  so no `PooledResource*` event fires and the bought node won't flip — nudge `+1` then `-1` (Yuan Shao does this).

## Editor vs game
- The editor renders **geometry, images, states, docking** and lets you inspect/edit. It does **not** run
  live Cco data, `{{tt:...}}` tooltips, 3D model renders, or procedural ink shaders. Treat the editor as
  the geometry/round-trip check and the **game** as the behaviour check.
