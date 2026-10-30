// Headless render bootstrap (`twui-editor.exe --render <layout> --out <png> ...`).
//
// The Rust side parses the arguments (src-tauri/src/render_job.rs) and hides the main window;
// this module runs once after the store's `init()` resolves (App.tsx), drives the normal store
// actions (open file, preset, preview flags), waits until the Visualizer has every image it asked
// for, captures the scene at native resolution (the same path as right-click "Take screenshot")
// and exits the process. Nothing here is panel-specific.

import { useStore } from "../state/store";
import { invoke } from "../ipc/invoke";
import { savePng } from "../ipc/commands";
import { captureVisualizer, pendingImages } from "../panels/visualizerCapture";
import { componentMap, getAttr, removeAttr, setAttr } from "../twui/doc";

interface RenderJob {
  layout: string;
  out: string;
  data_root?: string | null;
  game?: string | null;
  overlay?: string | null;
  preset?: string | null;
  timeout: number;
  show: boolean;
}

interface Preset {
  /** Script data pack the panel's `ScriptObjectContext(...).TableValue` reads resolve against. */
  dataPack?: unknown;
  /** Component ids to force hidden (visible="false") before drawing. */
  hide?: string[];
  /** Component ids to force shown (visible flags removed) before drawing. */
  show?: string[];
  /** Draw the template row of DB/CCO-driven lists once (default true). */
  emptyLists?: boolean;
  /** Canvas background image name (see Settings), or null for none. */
  background?: string | null;
  /** Extra loc rows (key -> text) laid over the data root's, e.g. a mod's `*.loc.tsv` read by the caller. */
  loc?: Record<string, string>;
  error?: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Returns false at once when the process was not started with `--render`. */
export async function runHeadlessRender(): Promise<boolean> {
  let job: RenderJob | null = null;
  try {
    await invoke("render_log", { text: "js: bootstrap start" });
    job = await invoke<RenderJob | null>("get_render_job");
  } catch (e) {
    try {
      await invoke("render_log", { text: `js: get_render_job failed: ${e}` });
    } catch {
      /* not a render session */
    }
    return false;
  }
  if (!job) return false;

  const log = async (step: string) => {
    try {
      await invoke("render_log", { text: `${new Date().toISOString()} js: ${step}` });
    } catch {
      /* logging is best effort */
    }
  };
  const fail = async (msg: string) => {
    await log(`FAIL ${msg}`);
    const text = `twui-editor --render failed: ${msg}\n`;
    try {
      if (job?.out) await invoke("write_text_file", { path: `${job.out}.err.txt`, text });
    } catch {
      /* nothing else to report to */
    }
    await invoke("exit_app", { code: 1 });
  };

  try {
    if (!job.layout || !job.out) {
      await fail("both --render <layout> and --out <png> are required");
      return true;
    }
    let preset: Preset = {};
    if (job.preset) {
      try {
        preset = JSON.parse(job.preset) as Preset;
      } catch (e) {
        await fail(`preset is not valid JSON: ${e}`);
        return true;
      }
      if (preset.error) {
        await fail(preset.error);
        return true;
      }
    }
    const st = useStore.getState;
    await log(`job ${JSON.stringify(job)}`);
    if (job.game) await st().setGame(job.game);
    if (job.data_root) await st().setDataRoot(job.data_root);
    if (job.overlay) await st().setOverlayPack(job.overlay);

    await log("opening layout");
    await st().openFile(job.layout);
    await log(`opened: doc=${!!st().doc} status=${st().status}`);
    if (!st().doc) {
      await fail(`could not open ${job.layout}: ${st().status}`);
      return true;
    }

    st().setPreviewEmptyLists(preset.emptyLists ?? true);
    if (preset.dataPack !== undefined) st().setDataPackOverride(preset.dataPack as never);
    if (preset.background !== undefined) useStore.setState({ background: preset.background });
    if (preset.loc) {
      // rows come as TSV keys; campaign strings are looked up bare (loc.rs strips the prefix)
      const CAMPAIGN = "campaign_localised_strings_string_";
      const extra: Record<string, string> = {};
      for (const [k, v] of Object.entries(preset.loc)) extra[k.startsWith(CAMPAIGN) ? k.slice(CAMPAIGN.length) : k] = v;
      useStore.setState({ loc: { ...st().loc, ...extra } });
    }
    const hide = new Set(preset.hide ?? []);
    const show = new Set(preset.show ?? []);
    if (hide.size || show.size) {
      st().mutate((doc) => {
        for (const el of componentMap(doc).values()) {
          const id = getAttr(el, "id") ?? "";
          if (hide.has(id)) setAttr(el, "visible", "false");
          if (show.has(id)) {
            removeAttr(el, "visible");
            removeAttr(el, "is_visible");
          }
        }
      });
    }

    // Wait for the fonts, then for the Visualizer to have every image it requested (loaded or
    // failed), stable across a few ticks so late-requested images (templates, nested lists) count.
    try {
      await (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready;
    } catch {
      /* no font API */
    }
    await log("preset applied; waiting for images");
    const deadline = Date.now() + Math.max(1, job.timeout) * 1000;
    let quiet = 0;
    while (Date.now() < deadline) {
      await sleep(150);
      const n = pendingImages();
      quiet = n === 0 ? quiet + 1 : 0;
      if (quiet >= 4) break;
    }
    await sleep(150);
    await log(`capturing (pending images ${pendingImages()})`);
    const url = captureVisualizer();
    if (!url) {
      await fail("nothing to capture (is the Visualizer panel mounted?)");
      return true;
    }
    await savePng(job.out, url);
    await log("saved");
    await invoke("exit_app", { code: 0 });
  } catch (e) {
    await fail(`${e}`);
  }
  return true;
}
