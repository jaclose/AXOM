import { canonicalJson } from "../compressedText";
import type { CloudSnapshot } from "./cloudSnapshot";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type WorkspaceChange = { op: "set" | "append"; path: string[]; value: Json } | { op: "remove"; path: string[] };

/** A transport adapter around the canonical revision writer. Array positions
 * are safe only against the exact acknowledged revision, never a moving head. */
export function workspaceDelta(before: CloudSnapshot, after: CloudSnapshot): WorkspaceChange[] {
  const changes: WorkspaceChange[] = [];
  const walk = (left: Json, right: Json, path: string[]) => {
    if (left === right || canonicalJson(left) === canonicalJson(right)) return;
    if (path.length >= 15) { changes.push({ op: "set", path, value: right }); return; }
    if (Array.isArray(left) && Array.isArray(right)) {
      const shared = Math.min(left.length, right.length);
      for (let index = 0; index < shared; index++) walk(left[index], right[index], [...path, String(index)]);
      if (right.length > left.length) changes.push({ op: "append", path, value: right.slice(left.length) });
      // Removing from the tail keeps every preceding index stable.
      for (let index = left.length - 1; index >= right.length; index--) changes.push({ op: "remove", path: [...path, String(index)] });
    } else if (left && right && typeof left === "object" && typeof right === "object" && !Array.isArray(left) && !Array.isArray(right) && path.length < 15) {
      for (const key of Object.keys(left)) if (!Object.hasOwn(right, key)) changes.push({ op: "remove", path: [...path, key] });
      for (const key of Object.keys(right)) {
        if (!Object.hasOwn(left, key)) changes.push({ op: "set", path: [...path, key], value: right[key] });
        else walk(left[key], right[key], [...path, key]);
      }
    } else changes.push({ op: "set", path, value: right });
  };
  for (const key of ["workspace", "sources", "media"] as const) {
    const left = key === "workspace" ? JSON.parse(before.content) : before[key];
    const right = key === "workspace" ? JSON.parse(after.content) : after[key];
    walk(left, right, [key]);
  }
  return changes;
}
