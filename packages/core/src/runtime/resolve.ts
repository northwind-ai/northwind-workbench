import { access } from "node:fs/promises";
import { extname, isAbsolute, join, normalize } from "node:path";
import type {
  PackageInfo,
  PackageManifest,
} from "@package-workbench/plugin-sdk";

/** Shared, dependency-free resolution helpers for the runtime engine. */

export async function pathExists(absPath: string): Promise<boolean> {
  try {
    await access(absPath);
    return true;
  } catch {
    return false;
  }
}

/** How Node would interpret a file, given the file and the owning manifest. */
export function classifyFormat(
  file: string,
  manifest: PackageManifest,
): "esm" | "cjs" | "json" | "unknown" {
  const ext = extname(file).toLowerCase();
  if (ext === ".mjs" || ext === ".mts") return "esm";
  if (ext === ".cjs" || ext === ".cts") return "cjs";
  if (ext === ".json") return "json";
  if (ext === ".js" || ext === ".ts" || ext === ".jsx" || ext === ".tsx") {
    return manifest.type === "module" ? "esm" : "cjs";
  }
  if (ext === ".node") return "cjs";
  return "unknown";
}

/** Resolve a package-relative target (`./dist/x.js`) to an absolute path, or null if it escapes the root. */
export function resolveTarget(pkg: PackageInfo, target: string): string | null {
  const clean = target.replace(/^\.\//, "");
  if (isAbsolute(clean)) return null;
  const abs = normalize(join(pkg.root, clean));
  // Reject path traversal outside the package root.
  if (!abs.startsWith(normalize(pkg.root))) return null;
  return abs;
}

const CJS_INDEXES = ["index.js", "index.cjs", "index.node"];
const ESM_INDEXES = ["index.mjs", "index.js"];

/**
 * Best-effort resolution of a package's *primary* entry file for a given module
 * system, mirroring how Node would pick it. Returns an absolute path that exists
 * on disk, or null. Honours `exports["."]`, then `module`/`main`, then index
 * fallbacks — without installing anything.
 */
export async function resolvePrimaryEntry(
  pkg: PackageInfo,
  system: "esm" | "cjs",
): Promise<string | null> {
  const m = pkg.manifest;
  const candidates: string[] = [];

  const dot = exportsDotConditions(m.exports);
  if (dot) {
    if (system === "esm") {
      if (dot.import) candidates.push(dot.import);
      if (dot.default) candidates.push(dot.default);
      if (dot.require) candidates.push(dot.require);
    } else {
      if (dot.require) candidates.push(dot.require);
      if (dot.node) candidates.push(dot.node);
      if (dot.default) candidates.push(dot.default);
    }
  }

  if (system === "esm") {
    if (typeof m.module === "string") candidates.push(m.module);
    if (typeof m.main === "string") candidates.push(m.main);
  } else {
    if (typeof m.main === "string") candidates.push(m.main);
  }

  for (const rel of candidates) {
    if (rel.includes("*")) continue;
    const abs = resolveTarget(pkg, rel);
    if (abs && (await pathExists(abs))) return abs;
  }

  // Index fallbacks (Node's directory resolution).
  for (const idx of system === "esm" ? ESM_INDEXES : CJS_INDEXES) {
    const abs = join(pkg.root, idx);
    if (await pathExists(abs)) return abs;
  }
  return null;
}

/** Pull the condition map for the `.` subpath out of an `exports` field, if present. */
export function exportsDotConditions(
  exportsField: unknown,
): {
  import?: string;
  require?: string;
  node?: string;
  browser?: string;
  default?: string;
  types?: string;
} | null {
  if (typeof exportsField === "string") return { default: exportsField };
  if (!exportsField || typeof exportsField !== "object") return null;
  const obj = exportsField as Record<string, unknown>;

  // Sugar form: `{ ".": ... }` vs bare condition form `{ import, require }`.
  const dot = "." in obj ? obj["."] : obj;
  if (typeof dot === "string") return { default: dot };
  if (!dot || typeof dot !== "object") return null;

  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(dot as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
    else if (v && typeof v === "object") {
      // Nested conditions (e.g. node: { import, require }) — take a default-ish leaf.
      const nested = v as Record<string, unknown>;
      const leaf = nested.default ?? nested.import ?? nested.require;
      if (typeof leaf === "string") out[k] = leaf;
    }
  }
  return out;
}
