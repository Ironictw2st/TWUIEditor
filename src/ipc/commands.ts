import { invoke } from "@tauri-apps/api/core";
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

/** Build a webview URL for a TWUI imagepath served by the twuiimg:// protocol. */
export function imageUrl(relPath: string): string {
  // encodeURI keeps '/' but encodes spaces etc.; backend percent-decodes.
  const enc = encodeURI(relPath);
  return IS_WINDOWS
    ? `http://twuiimg.localhost/${enc}`
    : `twuiimg://localhost/${enc}`;
}
