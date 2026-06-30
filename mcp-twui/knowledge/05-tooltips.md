# 05 — Tooltips (read this before wiring any tooltip)

Getting a tooltip to actually **appear** is the single trickiest part of TWUI authoring. This doc is the
distilled result of a long debugging session (see also the `.claude` memory `effect-bundle-tooltip-twui`).
The short version:

> **For a standalone widget, do NOT use the static `componentleveltooltip="{{tt:...}}"` attribute. Use a
> dynamic `ContextTooltipSetter` callback. To get a rich layout tooltip, have that setter RETURN the
> `"{{tt:layout}}"` string.**

## The two tooltip mechanisms

### Mechanism A — static layout tooltip (`componentleveltooltip`)
`componentleveltooltip="{{tt:ui/common ui/tooltip_context_effect_list}}"` points the tooltip at a layout
file. That layout's root is a **`CustomTooltip`** (it has `<callback_with_context callback_id="CustomTooltip"/>`)
and reads its data from `context_object_id="any"`.

**A `CustomTooltip` is handed the triggering component's PRIMARY/INHERITED context — not a context the
component generated for itself.** So Mechanism A works only when a **parent supplies** the needed context:
- `template_effect_bundle` (units_panel) gets `CcoEffectBundle` as its primary context from a parent
  `effect_bundle_list` doing `List CcoCampaignMilitaryForce.EffectBundleList`.
- `template_scheme` / `template_elite_icon` get a `CcoScriptTableNode` primary context from a parent
  `ContextInitScriptObject + List` (a Lua data pack), and the tooltip recomputes the bundle from it.

For a **standalone file with no parent data context**, Mechanism A silently fails — the tooltip never
triggers and never even appears on the in-game context viewer's `CurrentTooltip`. Things that do NOT fix
it (all tried, all failed): self-`ContextPropagator` of the bundle; `ContextObjectStore CcoEffectBundle`
(that's the general StoredContext registry, used by state setters, not the tooltip);
`ContextCustomTooltipStore CcoEffectBundle` (still needs the layout to capture a primary context).

### Mechanism B — dynamic tooltip via `ContextTooltipSetter` (use this)
`ContextTooltipSetter` **sets the component's tooltip string directly**. That string is exactly what
`CcoComponent.CurrentTooltip` returns (a `UniString`). It works with `context_object_id="CcoStaticObject"`
(no inherited context needed — proven in `new_content_popup.twui.xml:1170`) and can resolve
`EffectBundleFromKey(...)` **inline** (the same way a working icon `ContextImageSetter` does).

Two flavours:

**B1 — plain text tooltip** (simplest, guaranteed to fire):
```xml
<callback_with_context
	callback_id="ContextTooltipSetter"
	context_object_id="CcoStaticObject"
	context_function_id="EffectBundleFromKey(&quot;<key>&quot;).Name"/>
```
Also set `tooltipslocalised="false"` on the component so the returned text is shown as-is (with
`tooltipslocalised="true"` the engine would treat the string as a loc KEY and fail).

**B2 — full rich layout tooltip** (what we ship): have the setter **return the `{{tt:layout}}` ref string**;
the layout then receives the setter's `context_object_id`:
```xml
<callback_with_context
	callback_id="ContextTooltipSetter"
	context_object_id="CcoEffectBundle"
	context_function_id="&quot;{{tt:ui/common ui/tooltip_context_effect_list}}&quot;"/>
```
Here `CcoEffectBundle` must be resolvable on the component (we bring it into scope with a
`ContextPropagator CcoStaticObject EffectBundleFromKey("<key>")` — the icon `ContextImageSetter` reading
`CcoEffectBundle` proves it resolves). The function body is a **bare quoted string literal**.

Precedents for B2: `character_details.twui.xml:31441` returns `"{{tt:ui/common ui/tooltip_titles_effect_list}}"`;
`character_panel.twui.xml:5393` / `new_content_popup.twui.xml:5538` return `"{{tt:.../tooltip_character}}"`.

## Decision guide

- Bundle/data comes from a **real parent context** (a unit list, a Lua data pack)? → Mechanism A
  (`componentleveltooltip`) is fine and idiomatic; the tooltip reads the inherited primary context.
- **Standalone** widget, you only have a literal key? → Mechanism B. Use B2 to get the full effect list,
  B1 if you just want text.

## `EffectBundleFromKey` and effect-list tooltips specifically

- `EffectBundleFromKey("<bundle_key>")` → a `CcoEffectBundle`. `.Name`/`.Description` resolve to the
  localised title/body (loc prefixes `effect_bundles_localised_title_` / `_description_` in
  `games/3K/text/db/effect_bundles__.loc.tsv`). `.IconPath` is the bundle icon; `.EffectList` the effects.
- The shared effect-list tooltip layout is `ui/common ui/tooltip_context_effect_list` (a `CustomTooltip`
  reading `any` → `EffectList`). Returning `"{{tt:ui/common ui/tooltip_context_effect_list}}"` from a
  `ContextTooltipSetter` (B2) reuses it with no new file.

## Verifying tooltips

The **editor cannot render `{{tt:...}}` tooltips** (it strips `tt:` refs and has no live bundle data).
Tooltips must be confirmed **in-game**. The in-game **context viewer**'s `CurrentTooltip` field is the best
signal: a working text/dynamic tooltip shows there; if nothing appears there, the tooltip isn't triggering
(that's the symptom that told us Mechanism A was failing).

## See also

- Worked example end-to-end: `recipes/effect-bundle-button.md`.
- `.claude` memory `effect-bundle-tooltip-twui.md` (the same findings, with the failure history).
