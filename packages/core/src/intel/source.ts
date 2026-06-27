import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type { PackageInfo } from "@package-workbench/plugin-sdk";
import type { ExportSymbol } from "./types";

/**
 * Lightweight, dependency-free source scanning. Walks a package's source tree
 * and extracts exports + imports with regexes rather than a full TS parser —
 * deliberately conservative and fast enough for large monorepos. It can miss
 * exotic syntax; downstream classification accounts for that uncertainty (it
 * never claims false certainty about deletion safety).
 *
 * Uses node:fs directly, like the other built-in analysis modules.
 */

const SOURCE_EXT = /\.(?:m|c)?[jt]sx?$/;
const IGNORE_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  ".git",
  "coverage",
  ".turbo",
  ".next",
]);
const TEST_FILE = /(?:\.(?:test|spec)\.[jt]sx?$|(?:^|\/)__tests__\/)/;
const MAX_FILES = 2000;
const MAX_FILE_BYTES = 512 * 1024;

export interface SourceFile {
  /** Package-relative path (forward slashes). */
  rel: string;
  abs: string;
  content: string;
  isTest: boolean;
}

async function listSourceFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    if (out.length >= MAX_FILES) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= MAX_FILES) return;
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name) || e.name.startsWith(".")) continue;
        await walk(join(dir, e.name));
      } else if (SOURCE_EXT.test(e.name) && !e.name.endsWith(".d.ts")) {
        out.push(join(dir, e.name));
      }
    }
  }
  await walk(root);
  return out;
}

/** Read a package's source files (capped). Never throws. */
export async function readSourceFiles(pkg: PackageInfo): Promise<SourceFile[]> {
  const files = await listSourceFiles(pkg.root);
  const out: SourceFile[] = [];
  for (const abs of files) {
    try {
      const info = await stat(abs);
      if (info.size > MAX_FILE_BYTES) continue;
      const content = await readFile(abs, "utf8");
      const rel = relative(pkg.root, abs).replace(/\\/g, "/");
      out.push({ rel, abs, content, isTest: TEST_FILE.test(rel) });
    } catch {
      /* skip unreadable file */
    }
  }
  return out;
}

// ---- Export extraction -------------------------------------------------------

/** Extract export symbols from one source file. Heuristic, conservative. */
export function extractExports(file: SourceFile): ExportSymbol[] {
  const src = stripComments(file.content);
  const symbols: ExportSymbol[] = [];
  const add = (
    name: string,
    kind: ExportSymbol["kind"],
    typeOnly: boolean,
    from?: string,
  ) => {
    if (name) symbols.push({ name, kind, typeOnly, file: file.rel, from });
  };

  // export default …
  if (/(^|\n)\s*export\s+default\b/.test(src)) add("default", "default", false);

  // export * from './x'  /  export * as ns from './x'
  for (const m of src.matchAll(
    /(^|\n)\s*export\s+\*\s*(?:as\s+(\w+)\s+)?from\s*['"]([^'"]+)['"]/g,
  )) {
    add(m[2] ?? "*", "star-re-export", false, m[3]);
  }

  // export { a, b as c, type T } [from './x']
  for (const m of src.matchAll(
    /(^|\n)\s*export\s+(type\s+)?\{([^}]*)\}\s*(?:from\s*['"]([^'"]+)['"])?/g,
  )) {
    const groupTypeOnly = Boolean(m[2]);
    const from = m[4];
    for (const part of m[3]!.split(",")) {
      const seg = part.trim();
      if (!seg) continue;
      const typeOnly = groupTypeOnly || /^type\s+/.test(seg);
      const cleaned = seg.replace(/^type\s+/, "");
      const exportedName = (cleaned.split(/\s+as\s+/).pop() ?? cleaned).trim();
      const kind = from ? "re-export" : typeOnly ? "type" : "named";
      add(exportedName, kind, typeOnly, from);
    }
  }

  // export const/let/var/function/class/async function NAME
  for (const m of src.matchAll(
    /(^|\n)\s*export\s+(?:async\s+)?(const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    add(m[3]!, "named", false);
  }

  // export type/interface/enum NAME
  for (const m of src.matchAll(
    /(^|\n)\s*export\s+(?:declare\s+)?(type|interface|enum)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    add(m[3]!, "type", m[2] !== "enum");
  }

  return dedupeSymbols(symbols);
}

function dedupeSymbols(symbols: ExportSymbol[]): ExportSymbol[] {
  const seen = new Map<string, ExportSymbol>();
  for (const s of symbols) {
    const key = `${s.name}:${s.kind}:${s.from ?? ""}`;
    if (!seen.has(key)) seen.set(key, s);
  }
  return [...seen.values()];
}

// ---- Import extraction -------------------------------------------------------

export interface ImportRef {
  /** The module specifier imported from. */
  specifier: string;
  /** Named bindings imported (`default` for a default import, `*` for namespace). */
  names: string[];
  /** True when the import appeared in a test file. */
  fromTest: boolean;
}

/** Extract imports (and require + re-export sources) from one file. */
export function extractImports(file: SourceFile): ImportRef[] {
  const src = stripComments(file.content);
  const refs: ImportRef[] = [];

  // import … from 'x'  /  import 'x'  /  import type … from 'x'
  for (const m of src.matchAll(
    /import\s+(?:type\s+)?(?:([^'"]+?)\s+from\s+)?['"]([^'"]+)['"]/g,
  )) {
    refs.push({
      specifier: m[2]!,
      names: parseImportClause(m[1]),
      fromTest: file.isTest,
    });
  }
  // export { x } from 'y' / export * from 'y'  (these consume y's exports)
  for (const m of src.matchAll(
    /export\s+(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g,
  )) {
    refs.push({ specifier: m[1]!, names: ["*"], fromTest: file.isTest });
  }
  // require('x')
  for (const m of src.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    refs.push({ specifier: m[1]!, names: ["*"], fromTest: file.isTest });
  }
  // dynamic import('x')
  for (const m of src.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    refs.push({ specifier: m[1]!, names: ["*"], fromTest: file.isTest });
  }
  return refs;
}

function parseImportClause(clause: string | undefined): string[] {
  if (!clause) return [];
  const names: string[] = [];
  const trimmed = clause.trim();
  // namespace: * as ns
  if (/^\*\s+as\s+\w+/.test(trimmed)) return ["*"];
  // default import (leading identifier before a comma or brace)
  const defaultMatch = trimmed.match(/^([A-Za-z_$][\w$]*)\s*(?:,|$)/);
  if (defaultMatch && !trimmed.startsWith("{")) names.push("default");
  // named: { a, b as c }
  const brace = trimmed.match(/\{([^}]*)\}/);
  if (brace) {
    for (const part of brace[1]!.split(",")) {
      const seg = part.trim().replace(/^type\s+/, "");
      if (!seg) continue;
      names.push(seg.split(/\s+as\s+/)[0]!.trim());
    }
  }
  return names;
}

/** Strip // line and block comments (cheap; good enough for export/import scanning). */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

export { TEST_FILE };
