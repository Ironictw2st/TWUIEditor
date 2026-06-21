// A small parser for Lua table literals — enough to read a panel's "data pack"
// (the table a script publishes via `effect.set_context_value(script_id, …)`).
// Handles strings, numbers, booleans/nil, nested tables, and the three field
// forms: `["k"] = v`, `k = v`, and positional `v`.

export type LuaValue = string | number | boolean | null | LuaValue[] | { [k: string]: LuaValue };

class Cursor {
  i = 0;
  constructor(readonly s: string) {}

  /** Skip whitespace and `--` / `--[[ ]]` comments. */
  ws() {
    const s = this.s;
    for (;;) {
      while (this.i < s.length && /\s/.test(s[this.i])) this.i++;
      if (s.startsWith("--", this.i)) {
        if (s.startsWith("--[[", this.i)) {
          const end = s.indexOf("]]", this.i + 4);
          this.i = end < 0 ? s.length : end + 2;
        } else {
          const nl = s.indexOf("\n", this.i);
          this.i = nl < 0 ? s.length : nl + 1;
        }
        continue;
      }
      break;
    }
  }
}

function parseString(c: Cursor): string {
  const quote = c.s[c.i++];
  let out = "";
  while (c.i < c.s.length) {
    const ch = c.s[c.i++];
    if (ch === "\\") {
      const n = c.s[c.i++];
      out += n === "n" ? "\n" : n === "t" ? "\t" : n;
    } else if (ch === quote) {
      break;
    } else {
      out += ch;
    }
  }
  return out;
}

function parseValue(c: Cursor): LuaValue {
  c.ws();
  const ch = c.s[c.i];
  if (ch === '"' || ch === "'") return parseString(c);
  if (ch === "{") return parseTable(c);
  // bareword / number
  const start = c.i;
  while (c.i < c.s.length && !/[\s,;}\]]/.test(c.s[c.i])) c.i++;
  const tok = c.s.slice(start, c.i);
  if (tok === "true") return true;
  if (tok === "false") return false;
  if (tok === "nil") return null;
  const num = Number(tok);
  return isNaN(num) ? tok : num;
}

function parseTable(c: Cursor): LuaValue {
  c.i++; // consume "{"
  const obj: { [k: string]: LuaValue } = {};
  const arr: LuaValue[] = [];
  let isArray = true;
  for (;;) {
    c.ws();
    if (c.s[c.i] === "}") {
      c.i++;
      break;
    }
    if (c.i >= c.s.length) break;

    let key: string | null = null;
    if (c.s[c.i] === "[") {
      // ["key"] = v  (or [1] = v)
      c.i++;
      c.ws();
      const k = parseValue(c);
      c.ws();
      if (c.s[c.i] === "]") c.i++;
      c.ws();
      if (c.s[c.i] === "=") c.i++;
      key = String(k);
    } else {
      // could be `name = v` or a positional value. Look ahead for `name =`.
      const save = c.i;
      const m = /^[A-Za-z_]\w*/.exec(c.s.slice(c.i));
      if (m) {
        c.i += m[0].length;
        c.ws();
        if (c.s[c.i] === "=" && c.s[c.i + 1] !== "=") {
          c.i++;
          key = m[0];
        } else {
          c.i = save; // positional value
        }
      }
    }

    const val = parseValue(c);
    if (key !== null) {
      obj[key] = val;
      isArray = false;
    } else {
      arr.push(val);
    }

    c.ws();
    if (c.s[c.i] === "," || c.s[c.i] === ";") c.i++;
  }
  return isArray ? arr : obj;
}

/** Parse a Lua table literal (the text from the first `{` onward). */
export function parseLuaTable(text: string): LuaValue | null {
  const open = text.indexOf("{");
  if (open < 0) return null;
  const c = new Cursor(text);
  c.i = open;
  try {
    return parseTable(c);
  } catch {
    return null;
  }
}

/**
 * Extract the data pack a script publishes for `scriptId`. Finds
 * `set_context_value("<scriptId>", <expr>)`, takes the table variable name from
 * `<expr>` (e.g. `self.ambition_panel_data_pack`), and parses its `<name> = { … }`
 * literal. Falls back to the first `*_data_pack = {` table.
 */
export function extractDataPack(text: string, scriptId: string): LuaValue | null {
  const call = new RegExp(
    `set_context_value\\(\\s*"${scriptId}"\\s*,\\s*([\\w.]+)`
  ).exec(text);
  let name = call ? call[1].split(".").pop() : undefined;
  if (!name) {
    const m = /(\w*data_pack)\s*=\s*\{/.exec(text);
    name = m ? m[1] : undefined;
  }
  if (!name) return null;
  const assign = new RegExp(`(?:^|[^\\w.])${name}\\s*=\\s*\\{`, "m").exec(text);
  if (!assign) return null;
  return parseLuaTable(text.slice(assign.index));
}
