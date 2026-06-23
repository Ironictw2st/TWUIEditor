import { useMemo } from "react";
import { useStore } from "./store";
import { ContextTokens, deriveTokens } from "../twui/context";
import { extractDataPack, LuaValue } from "../twui/lua";
import { buildPlayersContext } from "../twui/players";
import { CcoShorthand, FactionContext } from "../types/twui";

/** The derived inputs the layout/visibility engine needs from the store: the connected
 *  script's data pack, the DB-record contexts (PlayersFaction etc.), perspective tokens,
 *  and the CCO shorthand table. Shared by the Visualizer (canvas) and the Tree (hierarchy
 *  visibility) so the two never disagree about what's visible. */
export interface LayoutInputs {
  dataPack: LuaValue | null;
  staticVars: Record<string, LuaValue>;
  tokens: ContextTokens;
  context: FactionContext;
  ccoShorthand: CcoShorthand | null;
}

export function useLayoutInputs(): LayoutInputs {
  const context = useStore((s) => s.context);
  const contextDb = useStore((s) => s.contextDb);
  const loc = useStore((s) => s.loc);
  const characters = useStore((s) => s.characters);
  const characterDb = useStore((s) => s.characterDb);
  const scriptText = useStore((s) => s.scriptConn.text);
  const scriptId = useStore((s) => s.scriptConn.id);
  const dataPackOverride = useStore((s) => s.dataPackOverride);
  const ccoShorthand = useStore((s) => s.ccoShorthand);

  const tokens = useMemo(() => deriveTokens(contextDb), [contextDb]);
  const dataPack = useMemo(
    () =>
      (dataPackOverride as LuaValue | null) ??
      (scriptText && scriptId ? extractDataPack(scriptText, scriptId) : null),
    [dataPackOverride, scriptText, scriptId]
  );
  const staticVars = useMemo(
    () => buildPlayersContext(context, contextDb, loc, characters, characterDb),
    [context, contextDb, loc, characters, characterDb]
  );

  return { dataPack, staticVars, tokens, context, ccoShorthand };
}
