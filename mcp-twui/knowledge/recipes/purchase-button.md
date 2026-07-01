# Recipe — Purchase button (select-then-buy an effect bundle)

**Goal:** a panel of effect-bundle nodes plus one **Apply/Purchase** button — click a node to select it,
then click Purchase to spend **1 pooled resource** and grant that node's effect bundle. The bought node
flips to `purchased`, and the button goes inactive until another, unowned node is selected. Modeled on Yuan
Shao's captain armoury (`games/3K/ui/campaign ui/3k_dlc07_yuan_shao_panel.twui.xml`, `button_apply`).

**Shipped files:** `output/3K/ironic_acupunture.twui.xml` (the panel, v136) +
`output/3K/ironic_acupunture_purchase.lua` (the campaign-side link). Resource: `ironic_unit_upgrades`. The
nodes are effect-bundle toggles (`effect-bundle-toggle.md`) and the Lua half is `08-script-bridge.md` — read
both first.

## The model (what the XML can and can't do)

TWUI XML **cannot** spend a resource or grant a bundle. It can only track a selection, display a cost, gate a
button, and **fire a script event**. The real spend + grant (and the cost value) live in **Lua/DB** — see
`08-script-bridge.md`. So the button is "display + intent"; cost = 1 is enforced in Lua, the XML only shows
`1` and gates on `>= 1`.

## How it's built

1. **Nodes** = effect-bundle toggles, one per purchasable bundle.
2. **Selection** is stored in two UI script objects on node click (no list parent needed).
3. One **Apply button** reads the selection, shows the resource icon + cost, gates itself, and fires the
   purchase event.
4. A **Lua listener** does the actual spend + grant; the panel refreshes off the resource-change events.

## Selection — store it on each node

Each node gets one extra `ContextCommandLeftClick`. `ironic_selected_id` (the node's own GUID, always unique)
drives the highlight; `ironic_selected_key` (the bundle key) is what Lua grants. Both set in one `Do(...)`:

```xml
<callback_with_context
	callback_id="ContextCommandLeftClick"
	context_object_id="CcoStaticObject"
	context_function_id="Do( ScriptObjectContext(&quot;ironic_selected_id&quot;).SetStringValue(&quot;FF5707EC-5C2E-15A0-0DF2CAABD819B560&quot;), ScriptObjectContext(&quot;ironic_selected_key&quot;).SetStringValue(&quot;<bundle key>&quot;) )"/>
```

Then extend each node's `ContextStateSetterConditional` (from the toggle recipe) with a `selected` highlight —
reusing the toggle's existing `selected` art, **don't add a new state** — and the refresh events:

```xml
<property name="0.purchased" value="PlayersFaction.EffectBundleList( true ).Any( Key == &quot;<bundle key>&quot; )"/>
<property name="1.selected"  value="ScriptObjectContext(&quot;ironic_selected_id&quot;).StringValue == &quot;<this node GUID>&quot;"/>
<property name="event0" value="ScriptObjectValueUpdatedironic_selected_id"/>   <!-- selection changed -->
<property name="event1" value="item_purchased"/>                                <!-- the button's UiMsg -->
<property name="event2" value="PooledResourceTransaction"/>                     <!-- fired when Lua spends -->
<property name="event3" value="PooledResourceValueChanged"/>
<property name="fallback_state" value="active"/>
<property name="ordered_states" value=""/>
```

`0.purchased` outranks `1.selected`, so once bought a node shows `purchased`, not `selected`.

## The Apply button

A cloned text button (Yuan Shao's `button_apply`). Its on-button content is a row — `button_content`
(`LayoutEngine type="HorizontalList"`) holding `button_txt` ("Purchase"), `pooled_icon` (the resource icon),
and `purchase_amount` ("1"). The icon brings the resource into scope, then sets its image to the resource's
`IconPath`:

```xml
<callback_with_context
	callback_id="ContextPropagator"
	context_object_id="CcoStaticObject"
	context_function_id="PlayersFaction.PooledResourceContext( &quot;ironic_unit_upgrades&quot; )"/>
<callback_with_context
	callback_id="ContextImageSetter"
	context_object_id="CcoCampaignPooledResource"
	context_function_id="IconPath"/>
```

The button's own callbacks — gate + click:

```xml
<callback_with_context callback_id="TextButton"/>
<callback_with_context
	callback_id="ContextInactiveStateSetter"
	context_object_id="CcoStaticObject"
	context_function_id="ScriptObjectContext(&quot;ironic_selected_id&quot;).StringValue != &quot;&quot; &amp;&amp; PlayersFaction.PooledResourceContext( &quot;ironic_unit_upgrades&quot; ).Total &gt;= 1 &amp;&amp; PlayersFaction.EffectBundleList( true ).Any( Key == ScriptObjectContext(&quot;ironic_selected_key&quot;).StringValue ) == false">
	<child_m_user_properties>
		<property name="event0" value="ScriptObjectValueUpdatedironic_selected_id"/>
		<property name="event1" value="PooledResourceTransaction"/>
		<property name="event2" value="PooledResourceValueChanged"/>
	</child_m_user_properties>
</callback_with_context>
<callback_with_context
	callback_id="ContextCommandLeftClick"
	context_object_id="CcoStaticObject"
	context_function_id="Do( CampaignRoot.TriggerModelScriptNotificationEvent( PlayersFaction, &quot;ironic_acupunture_item_purchased&quot; ), UiMsg(&quot;item_purchased&quot;) )"/>
```

## Why each callback

- **Node `ContextCommandLeftClick`** — writes the selection into two `ScriptObjectContext` values Lua can read
  (`08-script-bridge.md`).
- **`pooled_icon` `ContextPropagator` → `ContextImageSetter`** — `PlayersFaction.PooledResourceContext("<key>")`
  returns a `CcoCampaignPooledResource`; `IconPath` is its icon. (`.PooledResourceFactionSpecificContext` is
  the keyless by-faction shortcut; prefer the by-key form so the gate and the icon name the same resource.)
- **`ContextInactiveStateSetter`** — enabled only when (a) something is selected, (b) you can afford it
  (`.Total >= 1`), and (c) the selected bundle is **not already owned**
  (`...Any( Key == <selected key> ) == false`). After a buy, (c) flips false → button greys; pick a different
  unowned node → it re-enables. Note the `== false` negation idiom (Cco has no clean `!`).
- **`ContextCommandLeftClick`** — fires the script event for Lua + a `UiMsg("item_purchased")` that re-pings
  the UI. It does NOT spend anything itself.

## Refresh (why the bought node updates)

There's no "faction gained a bundle" UI event, so refresh rides the **pooled-resource** events: the nodes and
the button list `PooledResourceTransaction` / `PooledResourceValueChanged`, which fire when the Lua spends the
point. For that to land with ownership already true, the Lua **applies the bundle before deducting**
(`08-script-bridge.md`). Sequence: click → event → Lua applies bundle → Lua deducts 1 → resource events fire →
nodes re-check `0.purchased` (bought node → `purchased`) and the button re-gates.

## Variable prices (positive and negative)

The cost above is a hardcoded `1`. To give each node its **own** price — and let some bundles *refund* the
resource instead of costing it — carry a **signed** price in a third script object, read by the button *and*
the Lua. Convention used here: **negative = a purchase (spend), positive = a refund (gain).**

1. **Set the price on the node click** with the **numeric** accessor `SetNumericValue` (not the string one):

```xml
context_function_id="Do( ScriptObjectContext(&quot;ironic_selected_id&quot;).SetStringValue(&quot;<GUID>&quot;), ScriptObjectContext(&quot;ironic_selected_key&quot;).SetStringValue(&quot;<bundle key>&quot;), ScriptObjectContext(&quot;ironic_selected_cost&quot;).SetNumericValue( -3 ) )"
```

2. **Gate on the signed price** instead of `>= 1` — the shipped idiom (`3k_dlc07_schemes_panel.twui.xml`):

```xml
context_function_id="ScriptObjectContext(&quot;ironic_selected_id&quot;).StringValue != &quot;&quot; &amp;&amp; PlayersFaction.PooledResourceContext( &quot;ironic_unit_upgrades&quot; ).Total + ScriptObjectContext( &quot;ironic_selected_cost&quot; ).NumericValue &gt;= 0"
```

`Total + price >= 0`: a refund (price > 0) always passes; a purchase (price < 0) needs `Total >= |price|`. At
`price = -1` this is exactly the old `Total >= 1`, so the placeholder changes no behaviour.

3. **Display the signed amount** — magnitude for a buy, `+N` for a refund — and refresh it on each selection:

```xml
<callback_with_context
	callback_id="ContextTextLabel"
	context_object_id="CcoStaticObject"
	context_function_id="( c = ScriptObjectContext( &quot;ironic_selected_cost&quot; ).NumericValue ) =&gt; { GetIfElse( c &lt; 0, RoundFloat( c * (-1) ), &quot;+&quot; + RoundFloat( c ) ) }">
	<child_m_user_properties>
		<property name="event0" value="ScriptObjectValueUpdatedironic_selected_cost"/>
	</child_m_user_properties>
</callback_with_context>
```

4. **Lua applies the signed price directly** — `apply_transaction_to_factor(factor, price)`, no negation (a
   negative value decreases the pool, positive increases); `price == 0` needs a `+1`/`-1` nudge or no refresh
   fires. See `08-script-bridge.md`.

Script objects expose `SetNumericValue` / `NumericValue` alongside the string pair (`04-callbacks-cco.md`), and
Cco has negative literals and `*`, so `c * (-1)` and `Total + price` are valid. **Per-node vs per-key:** look
the price up by whatever identifies the node — if every node shares one bundle key, key by the node **GUID**
(unique); once each node has its own real bundle key, key by that.

## What did NOT work / watch out

- **Don't clear the selection in the same click that fires the event.** The event reaches Lua *after* the
  click's UI callbacks, so a clear callback blanks `ironic_selected_key` before Lua reads it. Let it persist
  (Yuan Shao's `item_target_key` persists too); the not-owned gate + Lua's `has_effect_bundle` guard handle
  re-clicks. (`07-gotchas.md`)
- **The `purchased` state blanks the dynamic icon** unless you drop its full brighten — `07-gotchas.md`.
- **One placeholder bundle key on every node** ⇒ buying any one marks them all owned. Give each node a unique
  `EffectBundleFromKey(...)` / `0.purchased` key for per-node behaviour (and so each can carry its own price —
  see Variable prices above).

## Verify

- Format: CRLF (CR==LF), well-formed; nodes carry the four `event*`s; the button gate has the three clauses.
- **In-game**: select an unowned node → it highlights and Purchase enables; click → resource −1, node flips to
  `purchased`, button greys; select another unowned node → button re-enables. Watch the script log for the
  `[ironic_acupunture]` lines from the Lua link.
