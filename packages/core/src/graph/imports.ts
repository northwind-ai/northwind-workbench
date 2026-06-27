import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import type { PackageInfo } from "@package-workbench/plugin-sdk";
import { builtinName } from "../runtime/builtins";

/**
 * Resolves module specifiers found in source to *internal* workspace packages,
 * external packages, or neither. Handles bare names, subpath imports
 * (`@scope/pkg/sub`), and TS path aliases (tsconfig `compilerOptions.paths`).
 */

export type ResolvedSpecifier =
  | { kind: "internal"; id: string; via: "name" | "alias" }
  | { kind: "external"; name: string }
  | { kind: "relative" }
  | { kind: "builtin" }
  | { kind: "unresolved" };

interface AliasEntry {
  /** Alias prefix without a trailing `*` (e.g. `@app/`). */
  prefix: string;
  /** Absolute on-disk target prefix the alias maps to. */
  targetAbs: string;
}

export class InternalIndex {
  /** Exact package names → id. */
  private readonly byName = new Map<string, string>();
  /** Package roots (normalised), longest first, for alias prefix matching. */
  private readonly rootsByLength: Array<{ root: string; id: string }>;
  private readonly aliases: AliasEntry[];

  constructor(packages: PackageInfo[], aliases: AliasEntry[]) {
    for (const p of packages) this.byName.set(p.name, p.id);
    this.rootsByLength = packages
      .map((p) => ({ root: normalize(p.root), id: p.id }))
      .sort((a, b) => b.root.length - a.root.length);
    this.aliases = aliases;
  }

  /** Classify one specifier. */
  resolve(spec: string): ResolvedSpecifier {
    if (spec.startsWith(".") || spec.startsWith("/"))
      return { kind: "relative" };
    if (builtinName(spec)) return { kind: "builtin" };

    // Exact or subpath match against a workspace package name.
    const name = bareName(spec);
    const directId = this.byName.get(name);
    if (directId) return { kind: "internal", id: directId, via: "name" };

    // Path-alias match → resolve to the owning package root.
    for (const alias of this.aliases) {
      if (
        spec === alias.prefix.replace(/\/$/, "") ||
        spec.startsWith(alias.prefix)
      ) {
        const rest = spec.slice(alias.prefix.length);
        const resolvedAbs = normalize(join(alias.targetAbs, rest));
        const owner = this.rootsByLength.find(
          (r) =>
            resolvedAbs === r.root ||
            resolvedAbs.startsWith(r.root + sep(r.root)),
        );
        if (owner) return { kind: "internal", id: owner.id, via: "alias" };
      }
    }

    return { kind: "external", name };
  }
}

function sep(p: string): string {
  return p.includes("\\") ? "\\" : "/";
}

/** Reduce a specifier to its package name: `@scope/pkg/sub` → `@scope/pkg`, `lodash/fp` → `lodash`. */
export function bareName(spec: string): string {
  const parts = spec.split("/");
  if (spec.startsWith("@")) return parts.slice(0, 2).join("/");
  return parts[0] ?? spec;
}

/** Read tsconfig `paths` at the workspace root and turn them into alias entries. */
export async function loadTsconfigAliases(
  workspaceRoot: string,
): Promise<AliasEntry[]> {
  for (const file of ["tsconfig.base.json", "tsconfig.json"]) {
    const aliases = await tryReadAliases(
      join(workspaceRoot, file),
      workspaceRoot,
    );
    if (aliases) return aliases;
  }
  return [];
}

async function tryReadAliases(
  tsconfigPath: string,
  workspaceRoot: string,
): Promise<AliasEntry[] | null> {
  let raw: string;
  try {
    raw = await readFile(tsconfigPath, "utf8");
  } catch {
    return null;
  }
  let cfg: {
    compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
  };
  try {
    cfg = JSON.parse(stripJsonComments(raw)) as typeof cfg;
  } catch {
    return null;
  }
  const paths = cfg.compilerOptions?.paths;
  if (!paths) return null;
  const baseUrl = cfg.compilerOptions?.baseUrl ?? ".";
  const baseAbs = normalize(join(workspaceRoot, baseUrl));

  const entries: AliasEntry[] = [];
  for (const [pattern, targets] of Object.entries(paths)) {
    const target = targets[0];
    if (!target) continue;
    entries.push({
      prefix: pattern.replace(/\*$/, ""),
      targetAbs: normalize(join(baseAbs, target.replace(/\*$/, ""))),
    });
  }
  // Longest prefix first so the most specific alias wins.
  return entries.sort((a, b) => b.prefix.length - a.prefix.length);
}

/** Minimal JSON-with-comments stripper (tsconfig allows `//` and `/* *\/`). */
function stripJsonComments(input: string): string {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"])\/\/.*$/gm, "$1")
    .replace(/,(\s*[}\]])/g, "$1");
}
