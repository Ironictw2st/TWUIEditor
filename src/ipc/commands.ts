import { invoke } from "@tauri-apps/api/core";
import { ContextDb, ImageStatus, RawElement, RoundtripReport, TwuiDocument } from "../types/twui";

export function loadContextDb(): Promise<ContextDb> {
  return invoke("load_context_db");
}

export function loadTemplates(ids: string[]): Promise<Record<string, TwuiDocument>> {
  return invoke("load_templates", { ids });
}

/** Localised UI strings keyed by bare record key (campaign_localised_strings). */
export function loadLoc(): Promise<Record<string, string>> {
  return invoke("load_loc");
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
