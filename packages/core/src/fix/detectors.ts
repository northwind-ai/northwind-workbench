import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PackageInfo } from "@package-workbench/plugin-sdk";
import type { PackageHealthReport, WorkbenchRun } from "../types";
import type { PackageIntelligenceReport } from "../intel/types";
import type { FixCandidate, FixPatch } from "./types";

/**
 * Fix detectors: turn detected problems into concrete, conservative patches.
 * Every patch is built from the *exact* bytes currently on disk (so the engine's
 * pre-flight check matches) and re-serialised preserving the file's indentation.
 *
 * Safe fixes are deterministic and reversible (package.json edits). Anything
 * opinionated (export maps, scripts, source rewrites) is `review_required`;
 * structural change is `dangerous` and only ever suggested.
 */

interface ManifestFile {
  raw: string;
  json: Record<string, unknown>;
  indent: string;
  trailingNewline: boolean;
  eol: string;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readManifestFile(
  pkgJsonPath: string,
): Promise<ManifestFile | null> {
  let raw: string;
  try {
    raw = await readFile(pkgJsonPath, "utf8");
  } catch {
    return null;
  }
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null; // never edit a malformed manifest
  }
  const indentMatch = raw.match(/\n([ \t]+)\S/);
  return {
    raw,
    json,
    indent: indentMatch?.[1] ?? "  ",
    trailingNewline: raw.endsWith("\n"),
    eol: raw.includes("\r\n") ? "\r\n" : "\n",
  };
}

/** Serialise a manifest preserving the original indentation + trailing newline. */
function serialize(file: ManifestFile, json: Record<string, unknown>): string {
  let out = JSON.stringify(json, null, file.indent);
  if (file.eol === "\r\n") out = out.replace(/\n/g, "\r\n");
  if (file.trailingNewline) out += file.eol;
  return out;
}

function manifestPatch(
  file: ManifestFile,
  path: string,
  next: Record<string, unknown>,
): FixPatch {
  return { path, before: file.raw, after: serialize(file, next) };
}

/** Resolve an installed version of `dep` by walking up node_modules. `^x.y.z`. */
async function resolveInstalledVersion(
  startDir: string,
  dep: string,
): Promise<string | null> {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "node_modules", dep, "package.json");
    if (await pathExists(candidate)) {
      try {
        const v = (
          JSON.parse(await readFile(candidate, "utf8")) as { version?: string }
        ).version;
        if (v) return `^${v}`;
      } catch {
        /* ignore */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const candidate = (
  partial: Omit<FixCandidate, "evidence" | "patches"> & {
    evidence?: string[];
    patches?: FixPatch[];
  },
): FixCandidate => ({ evidence: [], patches: [], ...partial });

interface DetectContext {
  workspaceRoot: string;
  intel?: PackageIntelligenceReport;
}

/** Extract a missing module name from a failing runtime/import check. */
function missingModuleOf(report: PackageHealthReport): string | null {
  const c = report.checks.find(
    (c) => c.checkId === "runtime_import_check" && c.status === "fail",
  );
  if (!c) return null;
  const text = [c.summary, c.details ?? "", ...(c.evidence ?? [])].join("\n");
  const m =
    text.match(/Missing module:\s*([^\s'"]+)/) ??
    text.match(/Cannot find (?:package|module) ['"]([^'"]+)['"]/);
  const name = m?.[1];
  if (!name) return null;
  const at = name.lastIndexOf("@");
  return at > 0 ? name.slice(0, at) : name;
}

// ---- per-package detectors --------------------------------------------------

async function detectForPackage(
  report: PackageHealthReport,
  ctx: DetectContext,
): Promise<FixCandidate[]> {
  const pkg = report.package;
  const out: FixCandidate[] = [];
  const file = await readManifestFile(pkg.packageJsonPath);
  if (!file) return out; // malformed/unreadable — never touch

  // 1) Add missing dependency.
  const missing = missingModuleOf(report);
  if (missing && !(pkg.dependencies[missing] || pkg.devDependencies[missing])) {
    const version =
      (await resolveInstalledVersion(dirname(pkg.packageJsonPath), missing)) ??
      null;
    const next = withDependency(
      file.json,
      "dependencies",
      missing,
      version ?? "latest",
    );
    out.push(
      candidate({
        id: `add_dep:${pkg.id}:${missing}`,
        kind: "add_missing_dependency",
        safety: version ? "safe" : "review_required",
        title: "Add dependency to package.json",
        problem: `Missing dependency: ${missing}`,
        description: `Add "${missing}": "${version ?? "latest"}" to dependencies`,
        packageId: pkg.id,
        patches: [manifestPatch(file, pkg.packageJsonPath, next)],
        evidence: [
          version
            ? `Resolved installed version ${version}`
            : "Version not resolvable from node_modules — confirm before applying",
        ],
      }),
    );
  }

  // 2) Add missing peer dependencies.
  const peerCheck = report.checks.find(
    (c) =>
      c.checkId === "missing_peer_dependencies" &&
      (c.status === "fail" || c.status === "warn"),
  );
  for (const ev of peerCheck?.evidence ?? []) {
    const [name, range] = splitSpec(ev);
    if (!name || pkg.peerDependencies[name]) continue;
    const next = withDependency(
      file.json,
      "peerDependencies",
      name,
      range ?? "*",
    );
    out.push(
      candidate({
        id: `add_peer:${pkg.id}:${name}`,
        kind: "add_missing_peer_dependency",
        safety: "safe",
        title: "Add missing peer dependency",
        problem: `Missing peer dependency: ${name}`,
        description: `Add "${name}": "${range ?? "*"}" to peerDependencies`,
        packageId: pkg.id,
        patches: [manifestPatch(file, pkg.packageJsonPath, next)],
        evidence: [`Unmet peer: ${ev}`],
      }),
    );
  }

  // 3) Remove unused dependencies (from package intelligence).
  const weight = ctx.intel?.dependencyWeight.find(
    (w) => w.packageId === pkg.id,
  );
  for (const issue of weight?.issues ?? []) {
    if (issue.kind !== "unused" || !pkg.dependencies[issue.dependency])
      continue;
    const next = withoutDependency(file.json, "dependencies", issue.dependency);
    out.push(
      candidate({
        id: `rm_dep:${pkg.id}:${issue.dependency}`,
        kind: "remove_unused_dependency",
        safety: "safe",
        title: "Remove unused dependency",
        problem: `Unused dependency: ${issue.dependency}`,
        description: `Remove "${issue.dependency}" from dependencies`,
        packageId: pkg.id,
        patches: [manifestPatch(file, pkg.packageJsonPath, next)],
        evidence: [issue.detail],
      }),
    );
  }

  // 4) Add a missing "main" pointing at an existing build artifact.
  if (!pkg.manifest.main && !pkg.manifest.module && !pkg.manifest.exports) {
    const entry = await firstExisting(pkg.root, [
      "dist/index.js",
      "index.js",
      "lib/index.js",
    ]);
    if (entry) {
      const next = { ...file.json, main: entry };
      out.push(
        candidate({
          id: `add_main:${pkg.id}`,
          kind: "add_missing_main",
          safety: "safe",
          title: 'Set missing "main" field',
          problem: 'No "main" entry point declared',
          description: `Set "main": "${entry}"`,
          packageId: pkg.id,
          patches: [manifestPatch(file, pkg.packageJsonPath, next)],
          evidence: [`Found build output at ${entry}`],
        }),
      );
    }
  }

  // 5) Add missing "types" pointing at an existing declaration file.
  if (!pkg.manifest.types && !pkg.manifest.typings) {
    const dts = await firstExisting(pkg.root, [
      "dist/index.d.ts",
      "index.d.ts",
      "lib/index.d.ts",
    ]);
    if (dts) {
      const next = { ...file.json, types: dts };
      out.push(
        candidate({
          id: `add_types:${pkg.id}`,
          kind: "add_missing_types",
          safety: "safe",
          title: 'Set missing "types" field',
          problem: 'No "types" entry declared',
          description: `Set "types": "${dts}"`,
          packageId: pkg.id,
          patches: [manifestPatch(file, pkg.packageJsonPath, next)],
          evidence: [`Found declarations at ${dts}`],
        }),
      );
    }
  }

  // 6) Add a missing "version" field (metadata).
  if (typeof file.json.version !== "string") {
    const next = { ...file.json, version: "0.0.0" };
    out.push(
      candidate({
        id: `add_version:${pkg.id}`,
        kind: "add_missing_field",
        safety: "safe",
        title: 'Add missing "version" field',
        problem: 'package.json has no "version"',
        description: 'Set "version": "0.0.0"',
        packageId: pkg.id,
        patches: [manifestPatch(file, pkg.packageJsonPath, next)],
        evidence: ["A version is required to publish or resolve the package"],
      }),
    );
  }

  // 7) Add a missing "exports" map (review-required — opinionated).
  if (
    !pkg.manifest.exports &&
    (pkg.manifest.main || (file.json.main as string))
  ) {
    const main = (pkg.manifest.main ?? (file.json.main as string)) as string;
    const types =
      pkg.manifest.types ??
      (file.json.types as string | undefined) ??
      undefined;
    const exportsMap: Record<string, unknown> = {
      ".": types ? { types, default: main } : main,
    };
    const next = { ...file.json, exports: exportsMap };
    out.push(
      candidate({
        id: `add_exports:${pkg.id}`,
        kind: "add_missing_exports",
        safety: "review_required",
        title: 'Add an "exports" map',
        problem: 'No "exports" map declared',
        description: "Add an exports map derived from main/types",
        packageId: pkg.id,
        patches: [manifestPatch(file, pkg.packageJsonPath, next)],
        evidence: [
          "Derived from existing main/types — review for subpath needs",
        ],
      }),
    );
  }

  return out;
}

// ---- workspace-level detectors ----------------------------------------------

/** Stale re-exports → review-required source edits removing the dead line. */
async function detectStaleReexports(
  ctx: DetectContext,
  packagesById: Map<string, PackageInfo>,
): Promise<FixCandidate[]> {
  const out: FixCandidate[] = [];
  for (const usage of ctx.intel?.usage ?? []) {
    const pkg = packagesById.get(usage.packageId);
    if (!pkg) continue;
    for (const stale of usage.staleReExports) {
      const abs = join(pkg.root, stale.file);
      let raw: string;
      try {
        raw = await readFile(abs, "utf8");
      } catch {
        continue;
      }
      const lines = raw.split("\n");
      const idx = lines.findIndex(
        (l) => l.includes(stale.from) && /export\s+/.test(l),
      );
      if (idx < 0) continue;
      const after = [...lines.slice(0, idx), ...lines.slice(idx + 1)].join(
        "\n",
      );
      out.push(
        candidate({
          id: `stale_reexport:${usage.packageId}:${stale.file}:${idx}`,
          kind: "fix_stale_reexport",
          safety: "review_required",
          title: "Remove stale re-export",
          problem: `Stale re-export in ${stale.file}`,
          description: `Remove the unused re-export from "${stale.from}"`,
          packageId: usage.packageId,
          patches: [{ path: abs, before: raw, after }],
          evidence: [stale.note],
        }),
      );
    }
  }
  return out;
}

// ---- public API -------------------------------------------------------------

export interface DetectFixesInput {
  run: WorkbenchRun;
  intel?: PackageIntelligenceReport;
}

/** Detect every fix candidate for a run. Conservative; never edits malformed files. */
export async function detectFixes(
  input: DetectFixesInput,
): Promise<FixCandidate[]> {
  const ctx: DetectContext = {
    workspaceRoot: input.run.workspace.root,
    intel: input.intel,
  };
  const packagesById = new Map(
    input.run.reports.map((r) => [r.package.id, r.package]),
  );
  const out: FixCandidate[] = [];
  for (const report of input.run.reports)
    out.push(...(await detectForPackage(report, ctx)));
  out.push(...(await detectStaleReexports(ctx, packagesById)));
  return out;
}

// ---- helpers ----------------------------------------------------------------

function withDependency(
  json: Record<string, unknown>,
  field: string,
  name: string,
  range: string,
): Record<string, unknown> {
  const existing = (json[field] as Record<string, string> | undefined) ?? {};
  const sorted = Object.fromEntries(
    Object.entries({ ...existing, [name]: range }).sort(([a], [b]) =>
      a.localeCompare(b),
    ),
  );
  return { ...json, [field]: sorted };
}

function withoutDependency(
  json: Record<string, unknown>,
  field: string,
  name: string,
): Record<string, unknown> {
  const existing = {
    ...((json[field] as Record<string, string> | undefined) ?? {}),
  };
  delete existing[name];
  return { ...json, [field]: existing };
}

function splitSpec(spec: string): [string | null, string | null] {
  const trimmed = spec.trim();
  const at = trimmed.lastIndexOf("@");
  if (at > 0) return [trimmed.slice(0, at), trimmed.slice(at + 1)];
  return [trimmed || null, null];
}

async function firstExisting(
  root: string,
  candidates: string[],
): Promise<string | null> {
  for (const rel of candidates) {
    if (await pathExists(join(root, rel))) return rel;
  }
  return null;
}
