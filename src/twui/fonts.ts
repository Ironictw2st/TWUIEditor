// Map a TWUI `font_m_font_name` to a canvas/CSS `font` string. The real game fonts
// (Iskra-Bold, Numbers, …) aren't in the data, so each stack PREFERS the named font
// (auto-exact if the user has the game fonts installed) then falls back to the free
// equivalents the game itself uses — Fira Sans + Noto Sans TC (bundled via @fontsource).
// Used for both drawing and measuring text, so layout widths match what's rendered.

/** Build a canvas font string: `[style] [weight] [size]px [family stack]`. */
export function fontSpec(fontName: string | undefined, sizePx: number): string {
  const name = fontName ?? "";
  const lower = name.toLowerCase();
  const weight = /bold|black|heavy/.test(lower) ? "700" : "400";
  const style = /italic|oblique/.test(lower) ? "italic" : "normal";

  let stack: string;
  if (/iskra/.test(lower)) {
    stack = `"${name}","Iskra","Fira Sans","Noto Sans TC",sans-serif`;
  } else if (/fira/.test(lower)) {
    stack = `"${name}","Fira Sans",sans-serif`;
  } else if (/noto|cjk/.test(lower)) {
    stack = `"${name}","Noto Sans TC","Fira Sans",sans-serif`;
  } else if (/numbers/.test(lower)) {
    stack = `"${name}","Fira Sans",sans-serif`;
  } else if (/dev_font|mono/.test(lower)) {
    stack = `"${name}",monospace`;
  } else if (name) {
    stack = `"${name}","Fira Sans",system-ui,sans-serif`;
  } else {
    stack = `"Fira Sans",system-ui,sans-serif`;
  }
  return `${style} ${weight} ${Math.max(1, Math.round(sizePx))}px ${stack}`;
}
