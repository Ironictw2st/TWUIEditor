import { invoke, isBrowserMode } from "./invoke";
import { CcoDocs, CcoShorthand, CharacterDb, ContextDb, ImageStatus, RawElement, RoundtripReport, TwuiDocument } from "../types/twui";

export function loadContextDb(): Promise<ContextDb> {
  return invoke("load_context_db");
}

/** Character generation templates + resolved portrait folders (Characters panel). */
export function loadCharacterDb(): Promise<CharacterDb> {
  return invoke("load_character_db");
}

/** CCO symbol table parsed from the game's UI documentation (Inspector hints). */
export function loadCcoDocs(): Promise<CcoDocs> {
  return invoke("load_cco_docs");
}

/** Content-defined CCO shorthand macros (`ui/cco/*.json`), keyed by CCO type. */
export function loadCcoShorthand(): Promise<CcoShorthand> {
  return invoke("load_cco_shorthand");
}

export function loadTemplates(ids: string[]): Promise<Record<string, TwuiDocument>> {
  return invoke("load_templates", { ids });
}

/** Load layouts referenced by ComponentCreator (arbitrary data-root-relative paths). */
export function loadLayouts(paths: string[]): Promise<Record<string, TwuiDocument>> {
  return invoke("load_layouts", { paths });
}

/** Localised UI strings keyed by bare record key (campaign_localised_strings). */
export function loadLoc(): Promise<Record<string, string>> {
  return invoke("load_loc");
}

export interface ScriptHit {
  /** Path relative to the data root, forward-slashed. */
  path: string;
  text: string;
}

/** Locate the Lua script that backs a panel's script_id (set_context_value). */
export function findScript(scriptId: string): Promise<ScriptHit | null> {
  return invoke("find_script", { scriptId });
}

/** Read a .lua script file (sandboxed to the data root). */
export function readScript(path: string): Promise<string> {
  return invoke("read_script", { path });
}

export function serializeElement(element: RawElement): Promise<string> {
  return invoke("serialize_element", { element });
}

export function parseElement(text: string): Promise<RawElement> {
  return invoke("parse_element", { text });
}

export function listBackgrounds(): Promise<string[]> {
  return invoke("list_backgrounds");
}

export function getDataRoot(): Promise<string | null> {
  return invoke("get_data_root");
}

export function setDataRoot(path: string): Promise<void> {
  return invoke("set_data_root", { path });
}

/** Names of the games under the `games/` directory (3K, WH3, …). */
export function listGames(): Promise<string[]> {
  return invoke("list_games");
}

/** The active game name (data root folder under `games/`), or null for a custom root. */
export function currentGame(): Promise<string | null> {
  return invoke("current_game");
}

/** Switch the active game by name (a subfolder of `games/`). */
export function setGame(name: string): Promise<void> {
  return invoke("set_game", { name });
}

/** Switch to pack mode: read `.pack` files under `gameDir` (read-only).
 *  `includeMods=false` loads only vanilla (non-Mod-type) packs. */
export function setPackSource(gameDir: string, includeMods: boolean): Promise<void> {
  return invoke("set_pack_source", { gameDir, includeMods });
}

/** True when the active source is `.pack` archives (vs a loose folder). */
export function isPackMode(): Promise<boolean> {
  return invoke("is_pack_mode");
}

/** Every `.twui.xml` reachable from the active source (pack content browser). */
export function listLayouts(): Promise<string[]> {
  return invoke("list_layouts");
}

/** Every image (png/dds/tga/jpg) in the active source — backs the image finder. */
export function listImages(): Promise<string[]> {
  return invoke("list_images");
}

/** Overlay a single `.pack` (absolute path) over the active source. */
export function setOverlayPack(path: string): Promise<void> {
  return invoke("set_overlay_pack", { path });
}

/** Remove the single-pack overlay, restoring the base source. */
export function clearOverlayPack(): Promise<void> {
  return invoke("clear_overlay_pack");
}

/** The configured RPFM `.ron` schema path (decodes binary db tables), or null. */
export function getSchemaPath(): Promise<string | null> {
  return invoke("get_schema_path");
}

/** Point at the user's local RPFM `.ron` schema file (e.g. schema_3k.ron). */
export function setSchemaPath(path: string): Promise<void> {
  return invoke("set_schema_path", { path });
}

/** Read+parse a layout by source-relative path (open from the pack browser). */
export function readLayoutRel(rel: string): Promise<TwuiDocument> {
  return invoke("read_layout_rel", { rel });
}

export function readLayout(path: string): Promise<TwuiDocument> {
  return invoke("read_layout", { path });
}

export function saveLayout(path: string, doc: TwuiDocument): Promise<void> {
  return invoke("save_layout", { path, doc });
}

export function roundtripCheck(path: string): Promise<RoundtripReport> {
  return invoke("roundtrip_check", { path });
}

export function imageStatus(imagePath: string): Promise<ImageStatus> {
  return invoke("image_status", { imagePath });
}

/** An image passed inline to the bug-report webhook (program shot / visualizer render).
 *  `b64` may be a bare base64 string or a full `data:image/png;base64,...` data URL. */
export interface InlineImage {
  name: string;
  b64: string;
}

/** A bug report submitted from the in-app menu; mirrors the Rust `BugReport` struct. */
export interface BugReport {
  description: string;
  contact?: string;
  /** Diagnostic key/values (app version, OS, game, file, resolution) shown as embed fields. */
  meta: Record<string, string | number | null>;
  inlineImages: InlineImage[];
  /** Absolute paths to user-picked images, read by the backend at submit time. */
  filePaths: string[];
}

/** Capture the whole app window; returns a `data:image/png;base64,...` URL. */
export function captureAppWindow(): Promise<string> {
  return invoke("capture_app_window");
}

/** Deliver a bug report (description + images) to the author's configured Discord webhook. */
export function submitBugReport(report: BugReport): Promise<void> {
  return invoke("submit_bug_report", { report });
}

// On Windows (and Android) Tauri serves custom URI schemes as
// `http://<scheme>.localhost/...`; on macOS/Linux as `<scheme>://localhost/...`.
const IS_WINDOWS = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);

/** Build a URL for a TWUI imagepath. In the Tauri webview this uses the twuiimg:// protocol;
 *  in the web client it uses the same-origin `/img/{rel}` HTTP route. `bust` (an image epoch) is
 *  appended as a `?v=` query so a source change defeats the HTTP cache; the backend resolves
 *  images from the URI path only and ignores the query. */
export function imageUrl(relPath: string, bust?: string | number): string {
  // encodeURI keeps '/' but encodes spaces etc.; backend percent-decodes.
  const enc = encodeURI(relPath);
  const q = bust !== undefined ? `?v=${encodeURIComponent(String(bust))}` : "";
  if (isBrowserMode()) {
    return `/img/${enc}${q}`;
  }
  return IS_WINDOWS
    ? `http://twuiimg.localhost/${enc}${q}`
    : `twuiimg://localhost/${enc}${q}`;
}

// --- Host file browser (web client uses this in place of native OS dialogs) ---

/** One entry in a host directory listing. Field names mirror the Rust `DirEntry`. */
export interface HostDirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

/** A host directory listing (or the drive/root list when `path` is null). */
export interface HostDirListing {
  path: string | null;
  parent: string | null;
  entries: HostDirEntry[];
}

/** Suggested starting directories for the host file browser. */
export interface HostPaths {
  data_root: string | null;
  games_dir: string | null;
}

/** List a host directory; pass null/undefined to list filesystem roots (drives). */
export function hostListDir(path?: string | null): Promise<HostDirListing> {
  return invoke("host_list_dir", { path: path ?? null });
}

export function hostDefaultPaths(): Promise<HostPaths> {
  return invoke("host_default_paths");
}

// --- Web access point control (desktop only; experimental) ---

export type WebBind = "loopback" | "lan" | "custom";

export interface WebOpts {
  bind: WebBind;
  port: number;
  customIp?: string | null;
  password: string;
}

export interface WebInfo {
  url: string;
  bind: WebBind;
  host: string;
  port: number;
}

/** Start the web access server; returns a share URL. Errors (e.g. port in use) reject. */
export function startWebServer(opts: WebOpts): Promise<WebInfo> {
  return invoke("start_web_server", { opts });
}

export function stopWebServer(): Promise<void> {
  return invoke("stop_web_server");
}

/** Current web server info, or null when stopped. */
export function webServerStatus(): Promise<WebInfo | null> {
  return invoke("web_server_status");
}
