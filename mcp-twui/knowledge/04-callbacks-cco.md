# 04 — Callbacks & the Cco expression system

Callbacks are how a component reads/writes **live game data** ("Cco" = the game's context-object system).
Source of truth: `src/twui/cco.ts`, `tooltip.ts`, `recordLoc.ts`; signatures in `games/3K/ui/metadata.json`;
shorthand macros in `games/3K/ui/cco/*.json`.

## Where callbacks live

```xml
<callbackwithcontextlist>                          <!-- inline components -->
	<callback_with_context callback_id="Button"/>
	<callback_with_context
		callback_id="ContextImageSetter"
		context_object_id="CcoEffectBundle"
		context_function_id="IconPath"/>
</callbackwithcontextlist>
```

Templated instances use `<callbacks_with_context>` instead of `<callbackwithcontextlist>` (same idea).

## Callback anatomy

- `callback_id` — **what it does** (the verb). Catalogue below.
- `context_object_id` — **the context/`this` the expression reads from** (a Cco type, e.g.
  `CcoEffectBundle`, `CcoCampaignFaction`, `CcoScriptTableNode`, or the universal `CcoStaticObject`). For a
  `ContextPropagator` this is the SOURCE, not the output type (the output type is whatever the function
  returns — easy to get wrong, see 05/gotchas).
- `context_function_id` — a **Cco expression** producing the value (image path, text, bool, list, …).
  Quotes inside it are **XML-escaped** (`&quot;`).
- Optional `<child_m_user_properties>` with `<property name=".." value=".."/>` — extra params (e.g. an
  image slot index, ordered state conditions, event triggers, propagator options).

## Callback catalogue (the ones used/understood here)

| callback_id | Purpose |
|-------------|---------|
| `Button` | makes the component a clickable button; press/hover handled by the state machine |
| `VSliderHandle`, `Checkbox`, … | other widget behaviours |
| `List` / `ContextList` | repeat a single template child once per item of a container; each row's **primary context** = the item type. Source via `context_function_id` (e.g. `TableValue.Value`, `CcoCampaignMilitaryForce.EffectBundleList`) |
| `ContextInitScriptObject` | bind a subtree to a Lua-published data pack; child property `script_id="<id>"` |
| `ContextImageSetter` | set the component's dynamic image (slot from `dynamic_image` userproperty, or `image_index` property) to a Cco-resolved path (e.g. `CcoEffectBundle` → `IconPath`) |
| `ContextColourSetter` | tint an image from a Cco value (e.g. `CcoEffectBundle` → `SupplementColour`, with `colour_index0`) |
| `ContextTextLabel` | set text from a record property (loc-prefix resolved via `RECORD_LOC`) |
| `ContextTooltipSetter` | **dynamically set the component's tooltip** (text OR a `{{tt:layout}}` ref) — see `05-tooltips.md` |
| `ContextPropagator` | compute a value from `context_object_id` and make it available to children (its result type flows down). Optional `only_target` property |
| `ContextObjectStore` | store the in-scope context object into the general StoredContext registry (read later via `StoredContext("Type")`) — NOT what feeds a CustomTooltip |
| `ContextCustomTooltipStore` | store a context object specifically for a `CustomTooltip` layout |
| `ContextVisibilitySetter` / `ContextTrashOnCondition` | show/hide (or remove) based on a bool expression |
| `ContextStateSetterConditional` | choose a **state** by evaluating ordered conditions (see below) |
| `ContextInactiveStateSetter` | force the disabled/inactive state when a condition is true |
| `ContextCommandLeftClick` | run Cco command(s) on click: `Do(...)`, `CampaignRoot.TriggerModelScriptNotificationEvent(ctx,"evt")` (fire intent to Lua, see `08-script-bridge.md`), `UiMsg("msg")` (ping the UI), `ScriptObjectContext("k").SetStringValue(v)` (store a value). Does NOT mutate the campaign model itself |
| `ContextSelectableItem`, `StatePropagatorCallback` | selection, state inheritance |

### `ContextStateSetterConditional` (used for the "purchased" lock)

```xml
<callback_with_context
	callback_id="ContextStateSetterConditional"
	context_object_id="CcoStaticObject">
	<child_m_user_properties>
		<property name="0.purchased" value="<bool expr>"/>   <!-- highest priority -->
		<property name="1.inactive"  value="<bool expr>"/>
		<property name="2.selected"  value="<bool expr>"/>
		<property name="fallback_state" value="active"/>     <!-- if none match -->
		<property name="ordered_states" value=""/>
		<property name="event0" value="<event>"/>            <!-- re-evaluate on these events -->
	</child_m_user_properties>
</callback_with_context>
```

- `N.<stateName>` = "if this condition is true, switch to the state named `<stateName>`". Tried in numeric
  order; first match wins; else `fallback_state`. The named states must exist in the component.
- Evaluates on **context-set** (load) and on each declared `eventK`. There's no event for "faction gained an
  effect bundle", but you can drive a live refresh off side-effects: `PooledResourceTransaction` /
  `PooledResourceValueChanged` (fire when a linked Lua spends a pooled resource), `ScriptObjectValueUpdated<id>`
  (a UI script value changed — e.g. selection), and a `UiMsg` name fired on the same click. See `07-gotchas.md`
  and `recipes/purchase-button.md`.

## The Cco expression mini-language (`context_function_id`)

- **Ref chains**: `TableValue.ValueForKey("key")`, `Internal.field`, `this.prop`, `self.Id`,
  `PlayersFaction.PooledResourceFactionSpecificContext.Total`.
- **Container accessors**: `.Size`, `.Filter(cond)`, `.FirstContext(cond)`, `.Any(Key == "x")`, `.At(i)`,
  `.Transform(<fn-of-Value>)`, `.Skip(n)`, `.HasValueForKey("k", default)`.
- **Factory functions** (global / free, callable from any `context_object_id`):
  `EffectBundleFromKey(String, Int?) -> CcoEffectBundle`, `Component("<id-or-GUID>")`,
  `ScriptObjectContext("<id>")`. `EffectBundleFromKey` is in `metadata.json` (~line 21551).
- **Record properties**: `.Name`, `.Description`, `.IconPath`, `.Key`, `.Target`, `.EffectList`,
  `.SupplementColour`. For loc-backed records, the editor resolves `.Name`/`.Description` via `RECORD_LOC`
  prefixes (e.g. `CcoEffectBundle.Name` → loc key `effect_bundles_localised_title_<key>`).
- **Built-in funcs**: `Loc(key)`, `ToUpper(s)`, `RoundFloat(x)`, `YearFormat(...)`, `Format("%S ...", ...)`,
  `GetIf(cond, a)`, `GetIfElse(cond, a, b)`, `IsContextValid(x)`, `IsStringEmpty(s)`, `DoIf(cond, action)`.
- **Let-bindings / lambdas**: `( x = <expr> ) => { <expr-using-x> }` (also `(args) => { ... }` for
  `Filter`/sort funcs). Multiple bindings comma-separated.
- **Operators**: `==`, `!=` / `~=`, `>=`, `<=`, `>`, `<`, `&&` (`and`), `||` (`or`), `+` (incl. string
  concat), parentheses. Remember XML-escaping: `&amp;&amp;`, `&gt;=`, `&quot;`.
- **String literals**: `"..."` (XML-escaped `&quot;...&quot;`). A `context_function_id` can be a **bare
  string literal**, e.g. `&quot;{{tt:ui/common ui/tooltip_context_effect_list}}&quot;` returns that string.

## Pooled resources & UI script objects (cross-state plumbing)

- **Pooled resource by key**: `PlayersFaction.PooledResourceContext( "<key>" )` → a `CcoCampaignPooledResource`.
  `PlayersFaction.PooledResourceFactionSpecificContext` is the faction's primary pool (no key). Read `.Total`
  (spendable amount) and `.IconPath` (resource icon — set it with a `ContextImageSetter` whose
  `context_object_id` is `CcoCampaignPooledResource`). Mutations raise `PooledResourceTransaction` /
  `PooledResourceValueChanged` (and `FactionSpecificPooledResourceTransaction`); list these as `event`s to
  re-evaluate a gate/state when the resource changes.
- **UI script objects**: `ScriptObjectContext( "<id>" )` is a UI-side string slot. Write it from a
  `ContextCommandLeftClick` with `.SetStringValue( <expr> )`; read it in an expression with `.StringValue`;
  campaign **Lua** reads it via `effect.get_context_value("CcoScriptObject", "<id>", "StringValue")`. Writing
  raises the `ScriptObjectValueUpdated<id>` event. This is the UI↔Lua data bridge — see `08-script-bridge.md`.
- **Numeric script objects**: the same slot also has a **numeric** pair — `.SetNumericValue( <number> )` /
  `.NumericValue` (Lua: `effect.get_context_value("CcoScriptObject", "<id>", "NumericValue")`). Use it to carry a
  number (e.g. a per-item cost) for arithmetic/comparison without string coercion. Cco has negative literals and
  `+` / `* (-1)`, so a **signed** cost gates cleanly as
  `PooledResource...Total + ScriptObjectContext( "<id>" ).NumericValue >= 0` (shipped in
  `3k_dlc07_schemes_panel.twui.xml`): a positive value always passes, a negative needs `Total >= |value|`.

## Inline tokens in `text` / tooltip strings

- `{{tt:<path>}}` — a tooltip **layout** reference (e.g. `{{tt:ui/common ui/tooltip_context_effect_list}}`;
  note the literal space in `common ui`, no `.twui.xml` extension). Stripped from display text.
- `{{CcoScriptObject:<expr>}}` / `{{CcoScriptTableNode:<expr>}}` — inline data tokens in `text`.
- `{{tr:<key>}}` — text replacement (e.g. `{{tr:map_province}}`).
- `[[col:<colour>]]…[[/col]]`, `[[b]]` — rich-text markup in tooltip/label strings.

## Scope & inheritance (how a context reaches a component)

Contexts flow **parent → child** down the hierarchy:
- **Script context**: `ContextInitScriptObject` (a Lua data pack) — universal to the subtree.
- **List rows**: `List`/`ContextList` set each repeated child's **primary context** to the item type.
- **Propagated vars**: `ContextPropagator` makes a computed value available to descendants.
- **State**: `StatePropagatorCallback` inherits parent state.

Key consequence (drives tooltips): a separate **tooltip layout** receives the triggering component's
**inherited/primary** context — NOT a context the component self-propagates to its own children. See
`05-tooltips.md`.
