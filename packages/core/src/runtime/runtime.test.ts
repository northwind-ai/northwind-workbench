import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assemblePackageInfo,
  type PackageInfo,
  type PackageManifest,
} from "@package-workbench/plugin-sdk";
import { detectRuntime } from "./detect";
import { analyzeBrowserCompat } from "./browser-compat";
import { validateExports } from "./exports";
import { resolvePrimaryEntry } from "./resolve";
import { classifyImportError, executeImport } from "./sandbox";
import { buildRuntimeReport } from "./matrix";

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../test/fixtures/runtime",
);
const EXEC_TIMEOUT = 25_000;

function fixture(name: string): PackageInfo {
  const root = join(FIXTURES, name);
  const manifest = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  ) as PackageManifest;
  return assemblePackageInfo({
    root,
    packageJsonPath: join(root, "package.json"),
    manifest,
  });
}

function syntheticPkg(manifest: PackageManifest): PackageInfo {
  return assemblePackageInfo({
    root: "/synthetic",
    packageJsonPath: "/synthetic/package.json",
    manifest: { name: "x", version: "1.0.0", ...manifest },
  });
}

describe("detectRuntime", () => {
  it("detects a Node package from a server framework", () => {
    const d = detectRuntime(syntheticPkg({ dependencies: { express: "^4" } }));
    expect(d.primary).toBe("node");
    expect(d.intended).toContain("node_cjs");
  });

  it("detects a browser package from a UI framework", () => {
    const d = detectRuntime(
      syntheticPkg({ dependencies: { react: "^18" }, type: "module" }),
    );
    expect(d.primary).toBe("browser");
    expect(d.intended).toContain("browser");
  });

  it("detects an Electron package and intends both electron targets", () => {
    const d = detectRuntime(
      syntheticPkg({ dependencies: { electron: "^30" } }),
    );
    expect(d.primary).toBe("electron");
    expect(d.intended).toEqual(
      expect.arrayContaining(["electron_main", "electron_renderer"]),
    );
  });

  it("reports low confidence when there are no signals", () => {
    const d = detectRuntime(syntheticPkg({}));
    expect(d.confidence).toBeLessThan(0.5);
  });

  it("treats Node built-in usage as a Node signal", () => {
    const d = detectRuntime(syntheticPkg({ dependencies: {} }), [
      "fs",
      "child_process",
    ]);
    expect(d.signals.some((s) => s.source === "imports")).toBe(true);
  });
});

describe("analyzeBrowserCompat", () => {
  it("flags hard Node built-ins as a browser failure", async () => {
    const r = await analyzeBrowserCompat(fixture("browser-incompatible"));
    expect(r.status).toBe("fail");
    expect(r.hardBreakers).toEqual(
      expect.arrayContaining(["fs", "child_process"]),
    );
  });

  it("passes a package with no Node built-ins", async () => {
    const r = await analyzeBrowserCompat(fixture("healthy-esm"));
    expect(r.status).toBe("pass");
    expect(r.usages).toHaveLength(0);
  });
});

describe("validateExports", () => {
  it("accepts a well-formed exports map", async () => {
    const v = await validateExports(fixture("healthy-esm"));
    expect(v.valid).toBe(true);
    expect(v.resolution.every((r) => r.resolved)).toBe(true);
  });

  it("rejects a mixed-key map with missing targets", async () => {
    const v = await validateExports(fixture("broken-exports"));
    expect(v.valid).toBe(false);
    expect(v.issues.some((i) => /mixes subpath/.test(i.message))).toBe(true);
    expect(v.resolution.some((r) => !r.resolved)).toBe(true);
  });
});

describe("resolvePrimaryEntry", () => {
  it("resolves the ESM entry of a healthy package", async () => {
    const entry = await resolvePrimaryEntry(fixture("healthy-esm"), "esm");
    expect(entry).toMatch(/index\.js$/);
  });

  it("returns null when the entry does not exist", async () => {
    const entry = await resolvePrimaryEntry(fixture("broken-exports"), "esm");
    expect(entry).toBeNull();
  });
});

describe("classifyImportError", () => {
  it("maps require-of-ESM to a mismatch", () => {
    expect(
      classifyImportError({ ok: false, code: "ERR_REQUIRE_ESM" }).failureClass,
    ).toBe("ESM_CJS_MISMATCH");
  });
  it("extracts the missing module name", () => {
    const r = classifyImportError({
      ok: false,
      code: "ERR_MODULE_NOT_FOUND",
      message: "Cannot find package 'left-pad'",
    });
    expect(r.failureClass).toBe("MISSING_DEPENDENCY");
    expect(r.missingModule).toBe("left-pad");
  });
  it("treats a relative missing path as a resolution failure", () => {
    const r = classifyImportError({
      ok: false,
      code: "ERR_MODULE_NOT_FOUND",
      message: "Cannot find module './nope.js'",
    });
    expect(r.failureClass).toBe("IMPORT_RESOLUTION_FAILURE");
  });
  it("maps SyntaxError to a syntax failure", () => {
    expect(
      classifyImportError({ ok: false, name: "SyntaxError", message: "bad" })
        .failureClass,
    ).toBe("SYNTAX_FAILURE");
  });
  it("falls back to a runtime exception", () => {
    expect(
      classifyImportError({ ok: false, name: "TypeError", message: "boom" })
        .failureClass,
    ).toBe("RUNTIME_EXCEPTION");
  });
});

describe("executeImport (sandboxed)", () => {
  it(
    "imports a healthy ESM package",
    async () => {
      const r = await executeImport(fixture("healthy-esm"), "esm");
      expect(r.ok).toBe(true);
      expect(r.exportedKeys).toEqual(
        expect.arrayContaining(["add", "greet", "default"]),
      );
    },
    EXEC_TIMEOUT,
  );

  it(
    "imports a healthy CJS package",
    async () => {
      const r = await executeImport(fixture("healthy-cjs"), "cjs");
      expect(r.ok).toBe(true);
      expect(r.exportedKeys).toContain("add");
    },
    EXEC_TIMEOUT,
  );

  it(
    "fails to resolve a package with a missing entry",
    async () => {
      const r = await executeImport(fixture("broken-exports"), "esm");
      expect(r.ok).toBe(false);
      expect(r.failureClass).toBe("IMPORT_RESOLUTION_FAILURE");
    },
    EXEC_TIMEOUT,
  );

  it(
    "reports a missing dependency by name",
    async () => {
      const r = await executeImport(fixture("missing-dep"), "esm");
      expect(r.ok).toBe(false);
      expect(r.failureClass).toBe("MISSING_DEPENDENCY");
      expect(r.missingModule).toBe("definitely-missing-package-xyz");
    },
    EXEC_TIMEOUT,
  );

  it(
    "detects an ESM/CJS mismatch",
    async () => {
      const r = await executeImport(fixture("mixed-esm-cjs"), "esm");
      expect(r.ok).toBe(false);
      expect(r.failureClass).toBe("ESM_CJS_MISMATCH");
    },
    EXEC_TIMEOUT,
  );
});

describe("buildRuntimeReport", () => {
  it(
    "builds a passing matrix for a healthy ESM package",
    async () => {
      const report = await buildRuntimeReport(fixture("healthy-esm"), {
        now: () => "T",
      });
      expect(report.matrix.node_esm).toBe("pass");
      expect(report.matrix.browser).toBe("pass");
    },
    EXEC_TIMEOUT,
  );

  it(
    "marks the browser cell failed for a browser-incompatible package",
    async () => {
      const report = await buildRuntimeReport(fixture("browser-incompatible"), {
        now: () => "T",
      });
      expect(report.matrix.browser).toBe("fail");
      expect(report.nodeBuiltinsUsed).toEqual(
        expect.arrayContaining(["fs", "child_process"]),
      );
    },
    EXEC_TIMEOUT,
  );

  it(
    "does not execute when execute:false (static mode)",
    async () => {
      const report = await buildRuntimeReport(fixture("missing-dep"), {
        execute: false,
        now: () => "T",
      });
      // Static mode can't run the import, so the node cell is pass (entry resolves) — no MISSING_DEPENDENCY.
      expect(
        report.targets.find((t) => t.target === "node_esm")?.execution,
      ).toBeUndefined();
    },
    EXEC_TIMEOUT,
  );
});
