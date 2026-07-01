// The rule registry. Adding a future diagnostic = append one Rule here; the engine
// and panel need no changes ("general not bespoke" — one for-all engine).

import type { Rule } from "../types";
import { attrValueRule } from "./attrValue";
import { attrVersionRule } from "./attrVersion";
import { duplicateGuidsRule } from "./duplicateGuids";
import { hierarchyComponentsRule } from "./hierarchyComponents";
import { imageRefsRule } from "./imageRefs";
import { requiredAttrsRule } from "./requiredAttrs";
import { stateRefsRule } from "./stateRefs";

export const RULES: Rule[] = [
  hierarchyComponentsRule,
  stateRefsRule,
  imageRefsRule,
  duplicateGuidsRule,
  requiredAttrsRule,
  attrValueRule,
  attrVersionRule,
];
