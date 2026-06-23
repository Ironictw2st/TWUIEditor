// Parse a TWUI image `colour` attribute into an RGB tint + alpha for the visualizer.
// TWUI colours are `#RRGGBBAA` (alpha = the last two hex digits) or `#RRGGBB` (opaque).
// Images are drawn tinted = (texture RGB) x (colour RGB), with the colour's alpha and the
// texture's own per-pixel alpha both preserved.

export interface ParsedColour {
  /** `#RRGGBB` tint, or null when absent or pure white (the no-tint fast path). */
  rgb: string | null;
  /** 0..1 opacity from the colour's alpha byte (1 when none/opaque). */
  alpha: number;
}

export function parseColour(colour?: string): ParsedColour {
  if (!colour || colour[0] !== "#") return { rgb: null, alpha: 1 };
  const hex = colour.slice(1).toLowerCase();
  if (hex.length >= 8) {
    const rgb = "#" + hex.slice(0, 6);
    const a = parseInt(hex.slice(6, 8), 16);
    return { rgb: rgb === "#ffffff" ? null : rgb, alpha: isNaN(a) ? 1 : a / 255 };
  }
  if (hex.length === 6) {
    const rgb = "#" + hex;
    return { rgb: rgb === "#ffffff" ? null : rgb, alpha: 1 };
  }
  return { rgb: null, alpha: 1 };
}
