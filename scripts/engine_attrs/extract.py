# Build the TWUI attribute schema straight from Three_Kingdoms.exe 1.7.2.0: every serializer that
# turns a member name into an attribute name, with the value type (from the helper / pugixml call it
# uses) and the field offset in the engine object. Output: twui_engine_schema.json next to this file.
#   python twui_engine_schema.py
import json
import os
import re
import struct
from capstone import Cs, CS_ARCH_X86, CS_MODE_64

EXE = r"C:\Program Files (x86)\Steam\steamapps\common\Total War THREE KINGDOMS\Three_Kingdoms.exe"
BASE = 0x140000000
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "engine_attrs.json")

# serializer -> object kind (names match the TWUI Editor's AttrKind where one exists)
SERIALIZERS = {
    0x140631530: "component",
    0x140634080: "template_link",
    0x140639580: "state",
    0x140636300: "image",            # image metric inside a state (<imagemetrics> child)
    0x140635be0: "component_image",
    0x1406345c0: "animation",
    0x140634a10: "animation_frame",
    0x14063c020: "layoutEngine",          # type="HorizontalList" (wrapper FUN_14063d160)
    0x14063d1e0: "layoutEngine",          # type="List" (wrapper FUN_14063e320)
    0x14063e3a0: "layoutEngine_RadialList",   # reads only its own 6 properties
    0x14063ea50: "layoutEngine_Table",        # cells / width / height only
    0x14063ef60: "trigger",
    0x140637aa0: "model",
    0x1406382b0: "component_model_view",
    0x140631110: "component_animations",
    0x1405fa470: "transition",
    0x140625f60: "transition",
}
# typed helpers: helper(node, attr, field*, default*, .., mode) -- mode 0 = save (only if != default)
HELPERS = {
    0x1405f5720: "string",
    0x1405f5830: "unistring",
    0x1405f5620: "pooled_string",
    0x1405f52a0: "vec2",
    0x1405f5130: "guid",
}
SET_BOOL = 0x1431636a0

d = open(EXE, "rb").read()
pe = struct.unpack_from("<I", d, 0x3c)[0]
nsec = struct.unpack_from("<H", d, pe + 6)[0]
opt = struct.unpack_from("<H", d, pe + 20)[0]
secs = []
for i in range(nsec):
    o = pe + 24 + opt + i * 40
    secs.append((d[o:o + 8].rstrip(b"\0").decode(),) + struct.unpack_from("<IIII", d, o + 8))
sec = {s[0]: s for s in secs}


def rva2off(rva):
    for n, vs, va, rs, raw in secs:
        if va <= rva < va + rs:
            return raw + rva - va


def s_at(rva):
    o = rva2off(rva)
    if o is None:
        return None
    e = d.find(b"\0", o, o + 96)
    s = d[o:e]
    return s.decode() if s and all(32 <= c < 127 for c in s) else None


_, pvs, pva, prs, praw = sec[".pdata"]
pdata = [struct.unpack_from("<III", d, praw + i * 12)[:2] for i in range(prs // 12)]


def bounds(rva):
    lo, hi = 0, len(pdata) - 1
    while lo <= hi:
        m = (lo + hi) // 2
        b, e = pdata[m]
        if rva < b:
            hi = m - 1
        elif rva >= e:
            lo = m + 1
        else:
            return b, e


def attr_name(member):
    out = []
    for c in member[2:] if member.startswith("m_") else member:
        lc = c.lower()
        if lc.isdigit() or ("a" <= lc <= "z"):
            out.append(lc)
        elif not out or out[-1] != "_":
            out.append("_")
    return "".join(out)


md = Cs(CS_ARCH_X86, CS_MODE_64)

# inline number readers: std::from_chars wrappers called with (out, first, last, field*, ..)
PARSE = {0x140530770: "float", 0x14064e650: "int", 0x14040bde0: "uint"}
# enum helpers: helper(node, attr, field*, default*, ..); the value table is the first rip-relative
# lea inside the helper, its length is the `cmp r9d, N` loop bound + 1
ENUM_HELPERS = {0x1405f5c20: "dock_point", 0x1405f5e20: "text_align", 0x1405f5d20: "horizontal_alignment",
                0x1405f5f20: "vertical_alignment"}
# value helpers that are not enums
VALUE_HELPERS = {
    0x1405f5010: "colour",       # parsed by FUN_1405fc0c0
    0x1405f4da0: "vec3",         # 3 floats, ','-separated (ambient cube / light colours)
    0x1405f5a60: "vec3",         # 3 floats (rotation_axis, camera_target)
    0x1405f5410: "vec4",         # 4 floats (margin, shader vars)
    0x1405f6310: "guid_ref",     # GUID of another object in the layout (component image)
    0x1405f66a0: "guid_ref",     # GUID of another object in the layout (state)
}
# child-list helpers (the attribute is an element/list, not a scalar value)
LIST_HELPERS = {0x1405f6db0, 0x1405f7930, 0x1405e7ad0, 0x1405f8000, 0x1405f8660, 0x1405f7110, 0x1405fad30,
                0x1405faf30, 0x1405f9a80, 0x1405f7b60, 0x1405fbb80, 0x1405fbe70, 0x1405f7330, 0x1405f4570,
                0x1405f2f50}
# pugixml xml_attribute::set_value overloads (save path)
SETTERS = {0x1431635f0: "int", 0x143163610: "uint", 0x143163630: "float", 0x143163650: "string"}
ATTR_EMPTY = 0x141a636f0     # pugixml: attribute is null (missing)
APPEND_CHILD = 0x143163590    # child element written in place of an attribute
STRCHR = 0x142b8e75c          # inline multi-float ("x,y" / "x,y,z") parse


def call_target(x):
    if x.mnemonic != "call":
        return None
    try:
        return int(x.op_str, 16)
    except ValueError:
        return None


def disasm_fn(va):
    b, e = bounds(va - BASE)
    return list(md.disasm(d[rva2off(b):rva2off(b) + (e - b)], BASE + b))


def rip_target(x):
    m = re.search(r"\[rip ([+-]) (0x[0-9a-f]+)\]", x.op_str)
    if not m:
        return None
    v = int(m.group(2), 16)
    return x.address + x.size + (v if m.group(1) == "+" else -v)


def read_at(va, n):
    o = rva2off(va - BASE)
    return d[o:o + n] if o is not None else None


def str_table(va, count):
    out = []
    for i in range(count):
        p = struct.unpack_from("<Q", read_at(va + 8 * i, 8))[0]
        out.append(s_at(p - BASE) if 0x140000000 < p < 0x150000000 else None)
    return out


_enum_cache = {}


def enum_values(helper):
    if helper not in _enum_cache:
        tbl, n = None, None
        for x in disasm_fn(helper):
            if x.mnemonic == "lea" and x.op_str.startswith("r10,") and tbl is None:
                tbl = rip_target(x)
            m = re.match(r"r9d, (0x[0-9a-f]+|\d+)$", x.op_str) if x.mnemonic == "cmp" else None
            if m and n is None:
                n = int(m.group(1), 0) + 1
        _enum_cache[helper] = str_table(tbl, n) if tbl and n else None
    return _enum_cache[helper]


REG32 = {"eax": "rax", "ecx": "rcx", "edx": "rdx", "ebx": "rbx", "esi": "rsi", "edi": "rdi", "al": "rax",
         "cl": "rcx", "dl": "rdx", "bl": "rbx", "sil": "rsi", "dil": "rdi"}


def full_reg(r):
    if r in REG32:
        return REG32[r]
    m = re.match(r"(r\d+)[dbw]?$", r)
    return m.group(1) if m else r


def resolve(reg, fn, idx, kind="int"):
    """Value of `reg` just before fn[idx], from the nearest earlier write (straight-line back-scan)."""
    want = full_reg(reg)
    for j in range(idx - 1, -1, -1):
        x = fn[j]
        ops = [o.strip() for o in x.op_str.split(",")]
        if not ops or full_reg(ops[0]) != want:
            continue
        if x.mnemonic in ("xor", "xorps", "pxor") and len(ops) == 2 and full_reg(ops[1]) == want:
            return 0.0 if kind == "float" else 0
        if x.mnemonic == "mov" and len(ops) == 2:
            try:
                return int(ops[1], 0)
            except ValueError:
                if re.match(r"^[a-z0-9]+$", ops[1]):
                    return resolve(ops[1], fn, j, kind)
                return None
        if x.mnemonic in ("movss", "movd") and rip_target(x):
            return round(struct.unpack("<f", read_at(rip_target(x), 4))[0], 6)
        if x.mnemonic in ("movaps", "movups") and len(ops) == 2 and ops[1].startswith("xmm"):
            return resolve(ops[1], fn, j, kind)
        return None
    return None


def as_type(v, typ):
    if v is None:
        return None
    if typ == "float":
        if isinstance(v, int):
            v = struct.unpack("<f", struct.pack("<I", v & 0xffffffff))[0]
        return round(v, 6)
    if typ == "int" and isinstance(v, int):
        return struct.unpack("<i", struct.pack("<I", v & 0xffffffff))[0]
    if typ == "bool":
        return bool(v)
    return v


def store_default(fn, start, stop, off):
    """Default stored into [reg + off] on the 'attribute missing' branch fn[start:stop]."""
    for j in range(start, stop):
        x = fn[j]
        if x.mnemonic in ("jmp", "ret"):
            break
        m = re.match(r"(?:dword|byte) ptr \[\w+ \+ (0x[0-9a-f]+)\], (\w+)$", x.op_str) \
            if x.mnemonic in ("mov", "movss") else None
        if m and int(m.group(1), 16) == off:
            try:
                return int(m.group(2), 0)
            except ValueError:
                return resolve(m.group(2), fn, j, "float" if m.group(2).startswith("xmm") else "int")
    return None


def classify(fn, i0, i1):
    """Type, offset, default and enum values of one serializer property block fn[i0:i1]."""
    block = fn[i0:i1]
    r = {"type": None, "offset": None, "default": None, "values": None}
    lea_r8 = lea_r9 = None
    idx = {x.address: i0 + k for k, x in enumerate(block)}
    for k, x in enumerate(block):
        j = i0 + k
        if x.mnemonic == "lea":
            m = re.match(r"(r8|r9), \[(\w+) ([+-]) (0x[0-9a-f]+)\]$", x.op_str)
            if m:
                v = (m.group(2), m.group(3), int(m.group(4), 16))
                if m.group(1) == "r8":
                    lea_r8 = (v[0], v[2] if v[1] == "+" else -v[2])
                else:
                    lea_r9 = v
        t = call_target(x)
        if t is None:
            if x.mnemonic == "cmp" and x.op_str.endswith(", 0x74") and r["type"] is None:
                r["type"] = "bool"
            if r["type"] == "bool" and r["offset"] is None and x.mnemonic == "mov":
                m = re.search(r"byte ptr \[\w+ \+ (0x[0-9a-f]+)\], al", x.op_str)
                if m:
                    r["offset"] = int(m.group(1), 16)
            continue
        if r["type"] is not None and r["type"] != "bool":
            continue
        if t in HELPERS or t in VALUE_HELPERS or t in ENUM_HELPERS:
            r["type"] = HELPERS.get(t) or VALUE_HELPERS.get(t) or "enum"
            r["offset"] = lea_r8[1] if lea_r8 and lea_r8[0] not in ("rsp", "rbp") else None
            if t in ENUM_HELPERS:
                r["values"] = enum_values(t)
                if lea_r9 and lea_r9[0] in ("rbp", "rsp"):      # default = stack slot set just before
                    for y in block[:k]:
                        m = re.match(r"dword ptr \[%s \%s 0x%x\], (\w+)$" % lea_r9, y.op_str)
                        if m:
                            try:
                                r["default"] = int(m.group(1), 0)
                            except ValueError:
                                r["default"] = resolve(m.group(1), fn, idx[y.address])
        elif t in PARSE:
            r["type"] = PARSE[t]
            if lea_r9 and lea_r9[0] not in ("rsp", "rbp") and lea_r9[1] == "+":
                r["offset"] = lea_r9[2]
        elif t in LIST_HELPERS or t in SERIALIZERS:
            r["type"] = "list"
        elif t == APPEND_CHILD and r["type"] is None:
            r["type"] = "list"
        elif t == SET_BOOL and r["type"] is None:
            r["type"] = "bool"
    # inline string enum: lea r10, table + `cmp r9d, N`
    if r["type"] is None:
        tbl = n = None
        for x in block:
            if x.mnemonic == "lea" and x.op_str.startswith("r10,") and tbl is None:
                tbl = rip_target(x)
            m = re.match(r"r9d, (0x[0-9a-f]+|\d+)$", x.op_str) if x.mnemonic == "cmp" else None
            if m and n is None:
                n = int(m.group(1), 0) + 1
            m = re.match(r"dword ptr \[\w+ \+ (0x[0-9a-f]+)\], r9d$", x.op_str) if x.mnemonic == "mov" else None
            if m and r["offset"] is None:
                r["offset"] = int(m.group(1), 16)
        if tbl and n:
            r["type"], r["values"], r["default"] = "enum", str_table(tbl, n), 0
    # inline "x,y" / "x,y,z" floats (pivot_point, light direction): float parses split on ','
    n = sum(1 for x in block if call_target(x) == STRCHR)
    if n and r["type"] in (None, "float"):
        r["type"], r["offset"] = "vec%d" % (n + 1), None
    # interned string looked up by key (font name, colour preset key)
    if r["type"] is None and any(call_target(x) == 0x1406a86a0 for x in block):
        r["type"] = "pooled_string"
    # remaining: the save-side pugixml setter tells the type (load parses inline)
    if r["type"] is None:
        setters = [SETTERS[t] for t in map(call_target, block) if t in SETTERS]
        if setters:
            r["type"] = setters[-1]
    # default of an inline scalar: the store on the 'attribute missing' branch (after ATTR_EMPTY: jne L)
    if r["type"] in ("bool", "int", "uint", "float") and r["offset"] is not None and r["default"] is None:
        for k, x in enumerate(block):
            if call_target(x) == ATTR_EMPTY and k + 2 < len(block) and block[k + 2].mnemonic == "jne":
                tgt = int(block[k + 2].op_str, 16)
                if tgt in idx:
                    v = store_default(fn, idx[tgt], i1, r["offset"])
                    r["default"] = as_type(v, r["type"])
                break
    return r


schema = []
for fva, kind in SERIALIZERS.items():
    ins = disasm_fn(fva)
    loops = []
    for i, x in enumerate(ins):
        if x.mnemonic == "movsx":
            m = re.search(r"byte ptr \[r\w+ \+ r\w+ \+ (0x[0-9a-f]+)\]", x.op_str)
            if m and s_at(int(m.group(1), 16)):
                loops.append((i, s_at(int(m.group(1), 16))))
    # layout-version gates: `cmp <version>, N` + jb/jae over a range of property blocks
    gates = []
    for g, x in enumerate(ins[:-1]):
        m = re.search(r", (0x[0-9a-f]+|\d+)$", x.op_str) if x.mnemonic == "cmp" else None
        j = ins[g + 1]
        if not m or "byte ptr" in x.op_str or j.mnemonic not in ("jb", "jae"):
            continue
        n = int(m.group(1), 0)
        if not 100 <= n <= 160:
            continue
        tgt = int(j.op_str, 16)
        if tgt > j.address:   # jb skip = read only from version n; jae skip = read only below n
            gates.append((j.address, tgt, ("min_version", n) if j.mnemonic == "jb" else ("max_version", n - 1)))
            for y in ins[g + 2:]:
                if y.address >= tgt:
                    break
                if y.mnemonic == "lea" and rip_target(y) and s_at(rip_target(y) - BASE) == "this"                         and not any(r["kind"] == kind and r["attr"] == "this" for r in schema):
                    schema.append({"kind": kind, "attr": "this", "member": None, "type": "guid", "offset": None,
                                   "serializer": "FUN_%x" % fva, gates[-1][2][0]: gates[-1][2][1]})

    def gate_of(addr):
        return [v for lo, hi, v in gates if lo < addr < hi]

    for k, (i, member) in enumerate(loops):
        end = loops[k + 1][0] if k + 1 < len(loops) else len(ins)
        c = classify(ins, i, end)
        row = {
            "kind": kind,
            "attr": attr_name(member),
            "member": member,
            "type": c["type"] or "other",
            "offset": ("0x%x" % c["offset"]) if c["offset"] is not None else None,
            "serializer": "FUN_%x" % fva,
        }
        if row["type"] == "other" and any(a["kind"] == kind and a["member"] == member and a["type"] == "list"
                                          for a in schema):
            row["type"] = "list"     # second pass over the same child list (load and save are split)
        if c["default"] is not None:
            row["default"] = c["default"]
        if c["values"]:
            row["values"] = c["values"]
        for key, n in gate_of(ins[i].address):
            row[key] = n
        schema.append(row)

# second reader: template-instance overrides (snake_case), read for components created from a template
template_override = [n for n in ["component_image_uniqueguids", "callbacks_with_context", "dimensions", "dock_point",
                                 "is_visible", "tooltips_localised", "layout_transition", "offset", "priority",
                                 "sound_category", "user_properties", "localised_texts", "override_images"]
                     if (n.encode() + b"\0") in d]
for n in template_override:
    schema.append({"kind": "template_override", "attr": n, "member": None, "type": "other", "offset": None,
                   "serializer": "template-instance reader"})
# LayoutEngine `type` (factory FUN_14060f4b0: exact memcmp; any other value = no layout engine)
schema.append({"kind": "layoutEngine_any", "attr": "type", "member": None, "type": "enum", "offset": None,
               "serializer": "FUN_14060f4b0", "values": ["Table", "List", "HorizontalList", "RadialList"],
               "unknown": "no layout engine"})
# plain-string readers (callbacks, localised text)
for kind, attrs in (("callback_with_context", ["callback_id", "context_object_id", "context_function_id"]),
                    ("localised_text", ["text_label", "tooltip_label", "tooltip_text", "is_text_localised"])):
    for a in attrs:
        if (a.encode() + b"\0") in d:
            schema.append({"kind": kind, "attr": a, "member": None, "type": "string", "offset": None,
                           "serializer": "plain-string reader"})

json.dump({"exe": "Three_Kingdoms.exe 1.7.2.0", "notes": [
    "attr = engine transform of the member name: drop 'm_', lower-case, [0-9a-z] kept, any other run -> '_'",
    "attribute lookup is pugixml xml_node::attribute(): exact, case-sensitive",
    "load: a missing attribute takes the default; save: written only when it differs from the default",
    "template_override: snake_case names read for components created from a template",
    "bool: true only when the value starts with a lower-case 't' (True / 1 / yes read as false)",
    "int / uint / float: std::from_chars (no leading '+', no spaces); uint rejects a minus sign",
    "enum: exact, case-sensitive name match; missing = the default, an unknown name = values[0]",
    "default: the value stored on the 'attribute missing' branch of the reader",
], "attributes": schema}, open(OUT, "w"), indent=1)
by = {}
for a in schema:
    by.setdefault(a["kind"], 0)
    by[a["kind"]] += 1
print("wrote %s: %d attributes" % (OUT, len(schema)))
for k, n in by.items():
    print("  %-22s %d" % (k, n))
untyped = [a for a in schema if a["type"] == "other" and a["kind"] not in ("template_override",)]
print("untyped: %d  e.g. %s" % (len(untyped), ", ".join(a["kind"] + "." + a["attr"] for a in untyped[:12])))
