import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import type { PackageInfo } from "@package-workbench/plugin-sdk";

/**
 * Static source scanning: walk a package's own source files and pull out the
 * module specifiers it imports/requires. Purely lexical (regex) — no parsing, no
 * execution — so it is fast, safe on broken code, and works before `pnpm
 * install`. False positives from specifiers inside comments/strings are possible
 * and accepted; this feeds heuristics, not hard guarantees.
 */

const SOURCE_EXT = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
]);
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".cache",
  "coverage",
  ".next",
  ".turbo",
  "__tests__",
  "__mocks__",
  "test",
  "tests",
]);
/** Files that aren't part of the shipped runtime surface (tests, scenarios, configs). */
const SKIP_FILE =
  /(\.(test|spec|scenario|bench|stories)\.[cm]?[jt]sx?$)|(\.config\.[cm]?[jt]s$)/i;

/** Bounds so a giant package can never stall or blow up memory. */
const MAX_FILES = 300;
const MAX_DEPTH = 6;
const MAX_BYTES = 512 * 1024;

export interface ImportRef {
  /** Path relative to the package root, POSIX-normalised. */
  file: string;
  specifier: string;
  /** How the specifier was written. */
  kind: "import" | "require" | "dynamic-import" | "export-from";
}

const PATTERNS: Array<{ re: RegExp; kind: ImportRef["kind"] }> = [
  // import x from 'y'  /  import 'y'  /  import * as x from 'y'
  { re: /\bimport\s+(?:[^;'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g, kind: "import" },
  // export { x } from 'y'  /  export * from 'y'
  {
    re: /\bexport\s+(?:[^;'"]*?\s)?from\s+['"]([^'"]+)['"]/g,
    kind: "export-from",
  },
  // import('y')
  { re: /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, kind: "dynamic-import" },
  // require('y')
  { re: /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g, kind: "require" },
];

/** Extract every module specifier from a single source string. */
export function extractSpecifiers(file: string, source: string): ImportRef[] {
  const refs: ImportRef[] = [];
  const seen = new Set<string>();
  for (const { re, kind } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const specifier = m[1]!;
      const key = `${kind}:${specifier}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push({ file, specifier, kind });
    }
  }
  return refs;
}

async function collectFiles(
  root: string,
  dir: string,
  depth: number,
  out: string[],
): Promise<void> {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      await collectFiles(root, abs, depth + 1, out);
    } else if (
      entry.isFile() &&
      SOURCE_EXT.has(extname(entry.name)) &&
      !SKIP_FILE.test(entry.name)
    ) {
      out.push(abs);
    }
  }
}

/**
 * Scan a package's source tree for import/require specifiers. Returns every
 * reference found, capped at {@link MAX_FILES} files. Never throws — unreadable
 * files are skipped.
 */
export async function scanPackageImports(
  pkg: PackageInfo,
): Promise<{ refs: ImportRef[]; filesScanned: number; truncated: boolean }> {
  const files: string[] = [];
  await collectFiles(pkg.root, pkg.root, 0, files);

  const refs: ImportRef[] = [];
  for (const abs of files) {
    let source: string;
    try {
      const info = await stat(abs);
      if (info.size > MAX_BYTES) continue;
      source = await readFile(abs, "utf8");
    } catch {
      continue;
    }
    const rel = relative(pkg.root, abs).split("\\").join("/");
    refs.push(...extractSpecifiers(rel, source));
  }

  return {
    refs,
    filesScanned: files.length,
    truncated: files.length >= MAX_FILES,
  };
}
