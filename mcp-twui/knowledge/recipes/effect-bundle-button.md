# Recipe — Effect-bundle button (icon + full effect-list tooltip)

**Goal:** a standalone, clickable round button that (a) shows a specific effect bundle's icon and (b) on
hover shows that bundle's full effect-list tooltip. No parent panel/data context required.

**Shipped file:** `output/3K/effect_bundle_button.twui.xml` (v136). Bundle used:
`3k_main_effect_bundle_public_order_outraged_outlaws` ("Outraged").

## How it's built

1. **Clone `3k_btn_medium`** (round 50×50 button) via the splice method (`../01-file-format.md`): take its
   `<userproperties>` + `<componentimages>` (8 images) + `<states>` (`active`/`down`/`down_off`/`hover`/
   `inactive`/`script_locked`) verbatim. Rename id/tag to `effect_bundle_button`.
2. **Host it on a transparent `root` canvas** (1920×1080) and centre it (`offset="935.00,515.00"`).
3. **Add the effect-bundle callbacks** (below).
4. `tooltipslocalised="false"` so the tooltip string isn't treated as a loc key.

## The wiring (the only part that differs from the plain template)

Component header + callbacks:

```xml
<effect_bundle_button
	this="B2C3D4E5-2222-4001-8B1E2D3C4A5F6071"
	id="effect_bundle_button"
	offset="935.00,515.00"
	component_anchor_point="0.50,0.50"
	tooltipslocalised="false"
	soundcategory="UI_GBL_TMP_Round_Medium_Button"
	uniqueguid="B2C3D4E5-2222-4001-8B1E2D3C4A5F6071"
	isaspectratiolocked="true"
	currentstate="7247FC19-F2AB-4971-9F4732E760C97959"
	defaultstate="7247FC19-F2AB-4971-9F4732E760C97959">
	<callbackwithcontextlist>
		<callback_with_context callback_id="Button"/>
		<callback_with_context
			callback_id="ContextPropagator"
			context_object_id="CcoStaticObject"
			context_function_id="EffectBundleFromKey(&quot;3k_main_effect_bundle_public_order_outraged_outlaws&quot;)"/>
		<callback_with_context
			callback_id="ContextImageSetter"
			context_object_id="CcoEffectBundle"
			context_function_id="IconPath"/>
		<callback_with_context
			callback_id="ContextTooltipSetter"
			context_object_id="CcoEffectBundle"
			context_function_id="&quot;{{tt:ui/common ui/tooltip_context_effect_list}}&quot;"/>
	</callbackwithcontextlist>
	<!-- ...spliced verbatim from 3k_btn_medium: <userproperties>, <componentimages>, <states>... -->
</effect_bundle_button>
```

(`currentstate`/`defaultstate` point at the template's `active` state GUID — use the template's GUIDs
as-is when you splice.)

## Why each callback

- **`Button`** — makes it a clickable button; hover/press handled by the cloned state machine.
- **`ContextPropagator` (CcoStaticObject → `EffectBundleFromKey("…")`)** — brings a `CcoEffectBundle` into
  the component's scope from the literal key. Source is `CcoStaticObject` (the universal static context),
  NOT `CcoEffectBundle` (nothing of that type is in scope to read).
- **`ContextImageSetter` (CcoEffectBundle → `IconPath`)** — sets the dynamic image (slot 0 via
  `dynamic_image=0`) to the bundle's icon. This resolving in-game is the proof the bundle is in scope.
- **`ContextTooltipSetter` (CcoEffectBundle → `"{{tt:…tooltip_context_effect_list}}"`)** — the tooltip.
  It returns the effect-list **layout** ref string; the layout receives the setter's `context_object_id`
  (`CcoEffectBundle`) → full effect list. This is **Mechanism B2** in `../05-tooltips.md`. (For text-only,
  return `EffectBundleFromKey("…").Name` with `context_object_id="CcoStaticObject"` instead.)

## What did NOT work (so you don't repeat it)

- Static `componentleveltooltip="{{tt:…tooltip_context_effect_list}}"` — never fired standalone (the
  `CustomTooltip` layout needs a primary inherited context this file doesn't have).
- `ContextObjectStore` / `ContextCustomTooltipStore` to "feed" the tooltip — didn't trigger it.
- `ContextPropagator` with `context_object_id="CcoEffectBundle"` — no-op (wrong source type).

See `../05-tooltips.md` for the full reasoning.

## Verify

- Format: CRLF (CR==LF), well-formed, `<layout version="136">`, tail `</localisation_changes/>`/`</layout>`.
- Editor: opens; the round button renders (frame + placeholder icon — the live bundle icon won't resolve
  in the editor); Inspector shows the four callbacks.
- **In-game**: hover → the "Outraged" effect-list tooltip (title + effect rows + description); the button
  icon becomes the bundle's icon; the button is clickable.
