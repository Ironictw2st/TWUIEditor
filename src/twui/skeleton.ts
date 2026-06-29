// Build a fresh, minimal-but-valid TWUI document in memory (the "New file" action).

import { genGuid } from "./mutate";
import { parseElement } from "../ipc/commands";
import { TwuiDocument } from "../types/twui";

/** The two prolog lines every UIEd-authored layout carries, emitted verbatim by the serializer
 *  (see src-tauri/src/model/serialize.rs). */
const PROLOG = ['<?xml version="1.0"?>', "<!--Layout created with UIEd.  Hand edit at your peril!-->"];

export interface BlankOpts {
  /** <layout version="…"> (129 / 135 / 136 / 142). */
  version: number | string;
  /** Root component size in world pixels (usually the render resolution). */
  width: number;
  height: number;
}

/** The `<layout>…</layout>` source for a blank layout: an empty hierarchy under a single
 *  transparent `root` component sized to the canvas. GUIDs are caller-supplied so the hierarchy
 *  node and the component definition reference the same ids. Whitespace between tags is dropped by
 *  the parser; the serializer reformats from the tree, so indentation here is cosmetic. */
function blankLayoutXml(o: BlankOpts & { rootGuid: string; stateGuid: string; imgGuid: string }): string {
  const { version, width, height, rootGuid, stateGuid, imgGuid } = o;
  return `<layout version="${version}" comment="" precache_condition="">
	<hierarchy>
		<root this="${rootGuid}"/>
	</hierarchy>
	<components>
		<root this="${rootGuid}" id="root" tooltipslocalised="true" uniqueguid="${rootGuid}" currentstate="${stateGuid}" defaultstate="${stateGuid}">
			<componentimages>
				<component_image this="${imgGuid}" uniqueguid="${imgGuid}" width="${width}" height="${height}"/>
			</componentimages>
			<states>
				<newstate this="${stateGuid}" name="NewState" width="${width}" height="${height}" texthbehaviour="Never split" uniqueguid="${stateGuid}">
					<imagemetrics>
						<image componentimage="${imgGuid}" width="${width}" height="${height}" colour="#00000000"/>
					</imagemetrics>
				</newstate>
			</states>
		</root>
	</components>
	<localisation_changes/>
</layout>`;
}

/** Construct a brand-new in-memory layout: one transparent root component, empty hierarchy. Parsed
 *  through the real backend parser so the tree matches exactly what the serializer round-trips. */
export async function buildBlankDocument(opts: BlankOpts): Promise<TwuiDocument> {
  const xml = blankLayoutXml({
    ...opts,
    rootGuid: genGuid(),
    stateGuid: genGuid(),
    imgGuid: genGuid(),
  });
  const root = await parseElement(xml);
  return { prolog: [...PROLOG], root };
}
