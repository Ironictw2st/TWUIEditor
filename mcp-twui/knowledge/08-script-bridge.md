# 08 — Script bridge: UI ↔ Lua (events, script objects, campaign API)

A `.twui.xml` widget can display data, gate on it, and **fire intent** — but it cannot change the campaign
model (spend a resource, grant an effect bundle, move an army). Anything stateful is done by **campaign Lua**
that listens for an event the UI fires. This doc is that round trip. Worked example:
`output/3K/ironic_acupunture_purchase.lua` (the purchase recipe's other half), patterned on the shipping
`games/3K/script/campaign/_shared/dlc07_faction_yuan_shao_captain_armoury.lua`.

## UI → script (from a `context_function_id`)

`ContextCommandLeftClick` runs **Cco commands** on click. The ones that talk to Lua / the UI:

- `CampaignRoot.TriggerModelScriptNotificationEvent( <context>, "<event_id>" )` — fires a script event Lua can
  listen for. The `<context>` (e.g. `PlayersFaction`) rides along; `<event_id>` is the name Lua matches.
- `UiMsg( "<msg>" )` — a UI-internal message; components re-evaluate the callbacks whose `event` matches
  `<msg>`. Pings the panel; it does NOT reach Lua's `core:add_listener`.
- `ScriptObjectContext( "<name>" ).SetStringValue( <expr> )` — write a UI **script object** string (readable in
  expressions via `.StringValue`, and in Lua via the bridge below). This is how you hand data (which item was
  clicked) to the Lua that handles the event.
- `Do( a, b, … )` — run several commands in one callback.

```xml
<callback_with_context
	callback_id="ContextCommandLeftClick"
	context_object_id="CcoStaticObject"
	context_function_id="Do( CampaignRoot.TriggerModelScriptNotificationEvent( PlayersFaction, &quot;ironic_acupunture_item_purchased&quot; ), UiMsg(&quot;item_purchased&quot;) )"/>
```

Naming: writing `ScriptObjectContext("foo")` makes the event `ScriptObjectValueUpdatedfoo` available — any
component can list it as an `event` on a state setter to re-evaluate when `foo` changes.

## Script → read the event + the UI's values

```lua
core:add_listener(
	"ironic_acupunture_purchase_listener",
	"ModelScriptNotificationEvent",                                   -- the event class
	function(e) return string.find(e:event_id(), "ironic_acupunture_item_purchased", 1, true) ~= nil end,
	function(e)
		-- read what the UI stored: ScriptObjectContext("X")  <->  CcoScriptObject "X"
		local bundle_key = effect.get_context_value("CcoScriptObject", "ironic_selected_key", "StringValue")
		local node_id    = effect.get_context_value("CcoScriptObject", "ironic_selected_id",  "StringValue")
		-- ... act on it ...
	end,
	true   -- persistent
)
```

- The event class is **`ModelScriptNotificationEvent`**; match the specific name with `e:event_id()`
  (`string.find(..., 1, true)` = plain substring, no Lua patterns).
- `effect.get_context_value("CcoScriptObject", "<name>", "StringValue")` reads a value the UI wrote with
  `ScriptObjectContext("<name>").SetStringValue(...)`. Strings are the simple, reliable typing.

## Campaign API used by the purchase link

```lua
local fk = cm:get_local_faction(true)                         -- player's faction key (string)
local fac = cm:query_faction(fk)
if fac:has_effect_bundle(bundle_key) then return end           -- guard double-buy

-- grant first (turns = -1 => permanent)
cm:modify_faction(fk):apply_effect_bundle(bundle_key, -1)

-- then spend a pooled resource (positive amount = deduct)
local pr = cm:query_faction(fk):pooled_resources():resource("ironic_unit_upgrades")
if not pr:is_null_interface() then
	cm:modify_model():get_modify_pooled_resource(pr):apply_transaction_to_factor("ironic_unit_upgrades_factor", -1)
end
-- read the current amount with pr:value()
```

`modify_*` calls mutate the model; `query_*` calls read it. The factor key must be a real
`pooled_resource_factors` row for that resource, or `apply_transaction_to_factor` silently no-ops (a common
"nothing got deducted" cause).

## Signed costs (spend or refund)

For per-item prices — some that spend, some that refund — carry a **signed** number from the UI in a numeric
script object (set there with `SetNumericValue`, `04-callbacks-cco.md`) and apply it **directly**:

```lua
local price = tonumber(effect.get_context_value("CcoScriptObject", "ironic_selected_cost", "NumericValue")) or 0

-- apply_transaction_to_factor takes the signed value as-is:
--   price < 0 -> decreases the pool (a purchase)    price > 0 -> increases it (a refund)
if price == 0 then
	-- a zero transaction fires no PooledResource* refresh; nudge +1 then -1 (nets zero)
	cm:modify_model():get_modify_pooled_resource(pr):apply_transaction_to_factor(factor, 1)
	cm:modify_model():get_modify_pooled_resource(pr):apply_transaction_to_factor(factor, -1)
else
	cm:modify_model():get_modify_pooled_resource(pr):apply_transaction_to_factor(factor, price)
end
```

Affordability applies only to purchases: `if price < 0 and pr:value() < -price then return end`. Read the
number with `"NumericValue"` (not `"StringValue"`). The UI gates the same way with `Total + price >= 0`
(`recipes/purchase-button.md`) — keep the UI and Lua agreed on the sign convention.

## Ordering rule (drives the UI refresh)

There's no UI event for "faction gained an effect bundle", so the panel refreshes off the **pooled-resource**
events (`PooledResourceTransaction` / `PooledResourceValueChanged`), which fire on the deduction. So **apply
the effect bundle BEFORE deducting** — then when the deduction fires the refresh, ownership is already true and
the bought node flips to `purchased`. Deduct-first re-evaluates before the bundle exists and the node stays
unpurchased. (Yuan Shao's armoury applies-then-deducts for exactly this reason.)

## Deploy

Register the listener in a first-tick callback so it loads each campaign:
`cm:add_first_tick_callback(function() ... end)`. Place the script under your mod's `script/campaign/...` (or
`require` it from a campaign loader). The `.twui.xml` ships separately in the pack. See
`recipes/purchase-button.md` for the UI half.
