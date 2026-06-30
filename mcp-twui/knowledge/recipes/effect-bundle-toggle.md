# Recipe — Effect-bundle TOGGLE button + "purchased" lock

**Goal:** like the effect-bundle button, but (a) press toggles the button on/off, and (b) a distinct
**`purchased`** state locks it (disabled, non-clickable) when the **player's faction already owns** the
effect bundle.

**Shipped file:** `output/3K/effect_bundle_button_toggle.twui.xml` (v136). Builds on
`recipes/effect-bundle-button.md` — read that first.

## How it's built

1. **Clone `3k_btn_medium_toggle`** instead of `3k_btn_medium`. It adds the toggle states
   (`selected`, `selected_down`, `selected_down_off`, `selected_hover`, `selected_inactive`) and a glow
   `<animations>` block. Press toggles `active`↔`selected` purely via the cloned `<transitionmap>`s + the
   `Button` callback (there is no special "toggle" callback). Splice its `<userproperties>` +
   `<componentimages>` (8) + all 10 `<states>` + `<animations>` verbatim; rename to
   `effect_bundle_button_toggle`.
2. **Same effect-bundle callbacks** as the button recipe: `Button`, `ContextPropagator` (CcoStaticObject →
   `EffectBundleFromKey("…")`), `ContextImageSetter` (CcoEffectBundle → `IconPath`), `ContextTooltipSetter`
   (CcoEffectBundle → `"{{tt:…tooltip_context_effect_list}}"`).
3. **Add the `purchased` state and the state-setter** (below).

## The new parts

### 1) A `purchased` state (new GUID, disabled, "owned/locked" look)
Modeled on the template's `selected_inactive` (on-backplate + selected frame + greyed icon `#818181FF`),
with `disabled="true"` and no `<transitionmap>` (it's only reachable via the state setter):

```xml
<purchased
	this="F1E2D3C4-5555-4001-A1B2C3D4E5F60718"
	name="purchased"
	width="38"
	height="38"
	soundcategory="UI_GBL_TMP_Round_Medium_Button_Locked_Medium"
	font_m_font_name="Iskra-Bold"
	font_m_size="15"
	font_m_colour="#FFFFFFFF"
	fontcat_name="item_header"
	interactive="true"
	disabled="true"
	uniqueguid="F1E2D3C4-5555-4001-A1B2C3D4E5F60718">
	<imagemetrics>
		<!-- on-backplate (B1F11B55), greyed icon (346765E4 #818181FF), on-highlight (809FD1EB),
		     frame (568809DD), selected frame (86C09C4B) — same component_image GUIDs as the clone -->
	</imagemetrics>
</purchased>
```

Insert it into the spliced `<states>` block (at 4-tab depth, like the other states) before `</states>`.

### 2) `ContextStateSetterConditional` — force `purchased` when owned
Add this callback to the component's `<callbackwithcontextlist>`:

```xml
<callback_with_context
	callback_id="ContextStateSetterConditional"
	context_object_id="CcoStaticObject">
	<child_m_user_properties>
		<property
			name="0.purchased"
			value="PlayersFaction.EffectBundleList( true ).Any( Key == &quot;3k_main_effect_bundle_public_order_outraged_outlaws&quot; )"/>
		<property
			name="fallback_state"
			value="active"/>
		<property
			name="ordered_states"
			value=""/>
	</child_m_user_properties>
</callback_with_context>
```

- `0.purchased` = "if the player's faction owns this bundle, switch to the state named `purchased`".
- `fallback_state="active"` = otherwise the toggle's off state; the toggle then runs freely.
- Evaluates on **context-set (load)**: the button loads locked if the faction already owns the bundle.
  (No clean faction-effect event exists for live re-lock — `../07-gotchas.md`.)
- Pattern lifted from Yuan Shao's `template_elite_icon` (`3k_dlc07_yuan_shao_panel.twui.xml:5023`).

## Verify

- Format: CRLF (CR==LF), well-formed; 11 states present (10 toggle + `purchased`).
- Editor: round toggle button renders; Inspector shows the callbacks + the `purchased` state.
- **In-game**: hover → the effect-list tooltip; click → toggles on/off (selected glow); when the faction
  owns the bundle, it loads in `purchased` (disabled) and can't be clicked.
- **Testing the lock**: "Outraged" is a province bundle, not normally faction-owned, so the lock won't
  visibly trigger with that key. To see it, point the `0.purchased` check (and ideally the icon/tooltip)
  at a bundle the faction actually has (a faction-trait/rank bundle).
