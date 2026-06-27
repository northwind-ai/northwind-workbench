import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assemblePackageInfo,
  type PackageManifest,
  type WorkspaceInfo,
} from "@package-workbench/plugin-sdk";
import type { PackageHealthReport, WorkbenchRun } from "../types";
import { applyPatches, atomicWrite, rollback, undoLast } from "./patch";
import { detectFixes } from "./detectors";
import { buildFixPlan, applyFixPlan } from "./plan";
import { diffLines, renderPatchDiff } from "./diff";
import type { FixPatch } from "./types";

/**
 * Coverage targets the engine's safety guarantees: patch generation, atomic
 * writes, rollback, and failed-patch recovery. Everything runs against real temp
 * directories — cross-platform, offline, no installs.
 */

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pw-fix-"));
}
const read = (p: string) => readFile(p, "utf8");
async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

// ---- atomic writes -----------------------------------------------------------

describe("atomicWrite", () => {
  it("writes content and creates parent directories", async () => {
    const dir = await tmp();
    const file = join(dir, "a", "b", "c.txt");
    await atomicWrite(file, "hello");
    expect(await read(file)).toBe("hello");
  });

  it("overwrites an existing file atomically", async () => {
    const dir = await tmp();
    const file = join(dir, "x.txt");
    await writeFile(file, "old", "utf8");
    await atomicWrite(file, "new");
    expect(await read(file)).toBe("new");
  });
});

// ---- patch group: apply + backup --------------------------------------------

describe("applyPatches", () => {
  it("applies a group, writes backups, and reports the files", async () => {
    const dir = await tmp();
    const f1 = join(dir, "one.json");
    const f2 = join(dir, "two.json");
    await writeFile(f1, '{"a":1}', "utf8");
    const patches: FixPatch[] = [
      { path: f1, before: '{"a":1}', after: '{"a":2}' },
      { path: f2, before: null, after: "created" }, // new file
    ];
    const out = await applyPatches(patches, {
      backupDir: join(dir, ".bak"),
      backupId: "g1",
      now: () => "T",
    });
    expect(out.ok).toBe(true);
    expect(await read(f1)).toBe('{"a":2}');
    expect(await read(f2)).toBe("created");
    expect(await exists(join(dir, ".bak", "g1", "manifest.json"))).toBe(true);
  });

  it("aborts untouched on a pre-flight conflict", async () => {
    const dir = await tmp();
    const f1 = join(dir, "one.txt");
    await writeFile(f1, "ACTUAL", "utf8");
    const out = await applyPatches(
      [{ path: f1, before: "EXPECTED", after: "NEW" }],
      { backupDir: join(dir, ".bak"), backupId: "g", now: () => "T" },
    );
    expect(out.ok).toBe(false);
    if (!out.ok && "conflicts" in out)
      expect(out.conflicts[0]!.reason).toMatch(/changed/);
    expect(await read(f1)).toBe("ACTUAL"); // untouched
  });

  it("refuses to create a file that already exists", async () => {
    const dir = await tmp();
    const f1 = join(dir, "exists.txt");
    await writeFile(f1, "here", "utf8");
    const out = await applyPatches([{ path: f1, before: null, after: "x" }], {
      backupDir: join(dir, ".bak"),
      backupId: "g",
      now: () => "T",
    });
    expect(out.ok).toBe(false);
    expect(await read(f1)).toBe("here");
  });
});

// ---- failed-patch recovery ---------------------------------------------------

describe("failed-patch recovery", () => {
  it("rolls back already-applied files when a later write fails", async () => {
    const dir = await tmp();
    const f1 = join(dir, "good.txt");
    await writeFile(f1, "ORIGINAL", "utf8");
    // f2 is a *directory* — writing a file there fails, forcing recovery.
    const f2 = join(dir, "blocked");
    await mkdir(f2, { recursive: true });

    const out = await applyPatches(
      [
        { path: f1, before: "ORIGINAL", after: "CHANGED" },
        { path: f2, before: null, after: "cannot-write" },
      ],
      { backupDir: join(dir, ".bak"), backupId: "g", now: () => "T" },
    );

    expect(out.ok).toBe(false);
    if (!out.ok && "rolledBack" in out) expect(out.rolledBack).toBe(true);
    // The first file must be restored to its original content (never corrupted).
    expect(await read(f1)).toBe("ORIGINAL");
  });
});

// ---- rollback ----------------------------------------------------------------

describe("rollback", () => {
  it("restores modified files and deletes created files", async () => {
    const dir = await tmp();
    const f1 = join(dir, "mod.txt");
    const f2 = join(dir, "new.txt");
    await writeFile(f1, "before", "utf8");
    const backupDir = join(dir, ".bak");
    await applyPatches(
      [
        { path: f1, before: "before", after: "after" },
        { path: f2, before: null, after: "created" },
      ],
      { backupDir, backupId: "g1", now: () => "T" },
    );

    expect(await rollback(backupDir, "g1")).toBe(true);
    expect(await read(f1)).toBe("before"); // restored
    expect(await exists(f2)).toBe(false); // created file removed
    // Idempotent.
    expect(await rollback(backupDir, "g1")).toBe(true);
  });

  it("undoLast rolls back the most recent group", async () => {
    const dir = await tmp();
    const f = join(dir, "v.txt");
    await writeFile(f, "v0", "utf8");
    const backupDir = join(dir, ".bak");
    await applyPatches([{ path: f, before: "v0", after: "v1" }], {
      backupDir,
      backupId: "a",
      now: () => "2026-01-01T00:00:00Z",
    });
    await applyPatches([{ path: f, before: "v1", after: "v2" }], {
      backupDir,
      backupId: "b",
      now: () => "2026-01-02T00:00:00Z",
    });
    const undone = await undoLast(backupDir);
    expect(undone).toBe("b");
    expect(await read(f)).toBe("v1"); // back to the previous version, not v0
  });
});

// ---- diff --------------------------------------------------------------------

describe("diff", () => {
  it("shows removed and added lines", () => {
    const lines = diffLines('{\n  "a": 1\n}', '{\n  "a": 1,\n  "b": 2\n}');
    expect(lines.some((l) => l.kind === "add" && l.text.includes('"b"'))).toBe(
      true,
    );
  });
  it("renders a new-file patch header", () => {
    expect(
      renderPatchDiff({ path: "/x.json", before: null, after: "hi" }),
    ).toContain("(new file)");
  });
});

// ---- detectors + end-to-end --------------------------------------------------

const workspace: WorkspaceInfo = {
  root: "/ws",
  name: "ws",
  packageManager: "pnpm",
  isMonorepo: false,
  packageCount: 1,
  tooling: {
    packageJson: true,
    pnpmWorkspace: false,
    nx: false,
    turbo: false,
    tsconfigBase: false,
  },
  warnings: [],
};

async function makeRun(
  pkgRoot: string,
  manifest: PackageManifest,
  checks: PackageHealthReport["checks"],
): Promise<WorkbenchRun> {
  const pkg = assemblePackageInfo({
    root: pkgRoot,
    packageJsonPath: join(pkgRoot, "package.json"),
    manifest,
  });
  const report: PackageHealthReport = {
    package: pkg,
    checks,
    score: 50,
    confidence: "high",
    status: "fail",
    generatedAt: "T",
  };
  return {
    id: "run",
    workspace: { ...workspace, root: pkgRoot },
    reports: [report],
    summary: {
      totalPackages: 1,
      passed: 0,
      warned: 0,
      failed: 1,
      averageScore: 50,
      lowConfidence: 0,
      worstPackageId: pkg.id,
    },
    startedAt: "T",
    finishedAt: "T",
  };
}

describe("detectFixes + applyFixPlan", () => {
  it("adds a missing dependency with the installed version, then applies it atomically", async () => {
    const dir = await tmp();
    const manifest = { name: "@nw/app", version: "1.0.0", dependencies: {} };
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify(manifest, null, 2) + "\n",
      "utf8",
    );
    // zod is "installed" so the version resolves → safe fix.
    await mkdir(join(dir, "node_modules", "zod"), { recursive: true });
    await writeFile(
      join(dir, "node_modules", "zod", "package.json"),
      JSON.stringify({ name: "zod", version: "3.22.4" }),
      "utf8",
    );

    const run = await makeRun(dir, manifest, [
      {
        checkId: "runtime_import_check",
        label: "import",
        status: "fail",
        severity: "high",
        summary: "MISSING_DEPENDENCY: import failed",
        details: "Missing module: zod",
      },
    ]);

    const candidates = await detectFixes({ run });
    const addDep = candidates.find((c) => c.kind === "add_missing_dependency");
    expect(addDep?.safety).toBe("safe");
    expect(addDep?.patches[0]!.after).toContain('"zod": "^3.22.4"');

    const plan = buildFixPlan(candidates, () => "T");
    const result = await applyFixPlan(plan, {
      backupDir: join(dir, ".bak"),
      sessionId: "s1",
      now: () => "T",
    });
    expect(result.appliedCount).toBeGreaterThanOrEqual(1);
    const updated = JSON.parse(await read(join(dir, "package.json")));
    expect(updated.dependencies.zod).toBe("^3.22.4");
  });

  it("partitions by safety and never auto-applies review-required or dangerous", async () => {
    const dir = await tmp();
    // No main/types/exports, missing version → safe fixes; no node_modules.
    const manifest = { name: "@nw/lib" };
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify(manifest, null, 2) + "\n",
      "utf8",
    );
    await writeFile(join(dir, "index.js"), "module.exports = {}", "utf8");

    const run = await makeRun(dir, manifest, []);
    const candidates = await detectFixes({ run });
    const plan = buildFixPlan(candidates, () => "T");
    expect(plan.summary.safe).toBeGreaterThan(0);

    // Apply only safe — review-required ones are skipped.
    const result = await applyFixPlan(plan, {
      backupDir: join(dir, ".bak"),
      sessionId: "s",
      level: "safe",
      now: () => "T",
    });
    const reviewItems = plan.candidates
      .filter((c) => c.safety === "review_required")
      .map((c) => c.id);
    for (const id of reviewItems)
      expect(
        result.results.find((r) => r.candidateId === id)?.applied,
      ).not.toBe(true);
  });
});
