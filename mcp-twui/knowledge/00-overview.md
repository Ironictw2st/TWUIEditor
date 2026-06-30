# 00 — Overview

## What a `.twui.xml` file is

A TWUI file is a **UI layout** for a Total War game (here: Three Kingdoms / "3K"). It is XML, but with
strict, undocumented formatting that must be preserved (see `01-file-format.md`). One file = one
`<layout>` describing a tree of UI components (panels, buttons, icons, lists, text), their visual
**states**, their **images**, and **callbacks** that bind them to live game data.

Files live under the game's `ui/` tree, e.g. `games/3K/ui/campaign ui/units_panel.twui.xml`. Reusable
widgets live under `games/3K/ui/templates/`. We author new files into `output/3K/`.

## The two GUID-linked structures (the #1 thing to understand)

Every `<layout>` has **two** parallel sections that describe the same components and must stay consistent:

```xml
<layout version="136" comment="" precache_condition="">
  <hierarchy>            <!-- the NESTED tree: who contains whom -->
    <root this="GUID-R">
      <my_button this="GUID-B"/>
    </root>
  </hierarchy>
  <components>           <!-- the FLAT list: each component's full definition -->
    <root this="GUID-R" id="root" ...> ... </root>
    <my_button this="GUID-B" id="my_button" ...> ...images, states, callbacks... </my_button>
  </components>
  <localisation_changes/>
</layout>
```

- `<hierarchy>` is the **containment tree** (parent → children), each node carrying only `this="<GUID>"`.
- `<components>` is the **flat list of definitions** — each component's attributes, `<componentimages>`,
  `<states>`, `<callbackwithcontextlist>`, optional `<LayoutEngine>`/`<animations>`.
- A component's **GUID appears in BOTH** places and must match. Editing a component's attributes means
  editing the `<components>` entry (the `<hierarchy>` node only has the GUID).

## Components, states, images

- A **component** has a set of named **states** (`active`, `hover`, `down`, `inactive`, `selected`,
  `purchased`, …). `currentstate`/`defaultstate` point at the active state's GUID. The game switches
  states on hover/press/disable, driven by each state's `<transitionmap>` and/or callbacks.
- Each state lists `<imagemetrics>` — which `<component_image>`s to draw, at what size/dockpoint/shader.
- `<component_image>` entries hold the actual `imagepath` (a `.png` under `ui/skins/...`) and a GUID that
  the states reference.

## Callbacks bind UI to game data (the "Cco" system)

A component's `<callbackwithcontextlist>` holds `<callback_with_context>` entries. Each names a
`callback_id` (what it does — e.g. `Button`, `ContextImageSetter`, `ContextTooltipSetter`), a
`context_object_id` (the data/context type it reads, e.g. `CcoEffectBundle`, `CcoStaticObject`), and a
`context_function_id` (an expression in the game's "Cco" mini-language). This is how a button shows a live
icon, a tooltip, conditional visibility, list repetition, etc. See `04-callbacks-cco.md`.

## How to author a new file (the practical loop)

1. Pick a **base**: the simplest valid file is a `root` canvas + one component. For real widgets, **clone
   a game template** (e.g. `3k_btn_medium`) so you inherit correct images/states.
2. Add your component's **callbacks** (icon, tooltip, data binding).
3. Write with **exact byte conventions** (CRLF, tabs, attribute layout) — see `01-file-format.md` and the
   "splice method" there.
4. **Validate**: CR==LF count, no lone LF, well-formed XML.
5. **Verify in-game**: the editor can render geometry/images but NOT `{{tt:...}}` tooltips or live data —
   those must be checked by loading the file in the game.

## Quick-start: the absolute minimum valid v136 file

```xml
<?xml version="1.0"?>
<layout
	version="136"
	comment=""
	precache_condition="">
	<hierarchy>
		<root this="A1B2C3D4-1111-4001-9A0F1E2D3C4B5A60"/>
	</hierarchy>
	<components>
		<root
			this="A1B2C3D4-1111-4001-9A0F1E2D3C4B5A60"
			id="root"
			uniqueguid="A1B2C3D4-1111-4001-9A0F1E2D3C4B5A60"
			currentstate="A1B2C3D4-1111-4002-9A0F1E2D3C4B5A61"
			defaultstate="A1B2C3D4-1111-4002-9A0F1E2D3C4B5A61">
			<states>
				<newstate
					this="A1B2C3D4-1111-4002-9A0F1E2D3C4B5A61"
					name="NewState"
					width="1920"
					height="1080"
					interactive="true"
					uniqueguid="A1B2C3D4-1111-4002-9A0F1E2D3C4B5A61"/>
			</states>
		</root>
	</components>
	<localisation_changes/>
</layout>
```

(Indentation above is **tabs**, line endings must be **CRLF** — see next doc.)
