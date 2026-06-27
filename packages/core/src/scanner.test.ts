import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanWorkspace } from "./scanner";
import { createRunner } from "./runner";

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "test",
  "fixtures",
);
const fixture = (name: string) => join(FIXTURES, name);

describe("scanWorkspace", () => {
  it("detects a simple single npm package", async () => {
    const { workspace, packages } = await scanWorkspace(fixture("simple-npm"));
    expect(packages).toHaveLength(1);
    expect(packages[0]!.name).toBe("simple-pkg");
    expect(packages[0]!.version).toBe("1.2.3");
    expect(packages[0]!.packageType).toBe("library");
    expect(packages[0]!.manifestValid).toBe(true);
    expect(workspace.tooling.packageJson).toBe(true);
    expect(workspace.isMonorepo).toBe(false);
  });

  it("discovers packages from a pnpm workspace", async () => {
    const { workspace, packages } = await scanWorkspace(fixture("pnpm-ws"));
    const names = packages.map((p) => p.name).sort();
    expect(names).toEqual(["@fixture/alpha", "@fixture/beta"]);
    expect(workspace.packageManager).toBe("pnpm");
    expect(workspace.isMonorepo).toBe(true);
    expect(workspace.tooling.pnpmWorkspace).toBe(true);
  });

  it("discovers Nx projects from apps/ and libs/", async () => {
    const { workspace, packages } = await scanWorkspace(fixture("nx-ws"));
    const names = packages.map((p) => p.name).sort();
    expect(names).toEqual(["@fixture/util", "@fixture/web"]);
    expect(workspace.tooling.nx).toBe(true);
    expect(workspace.isMonorepo).toBe(true);
    // runtime inference: web depends on react, util is a plain lib
    expect(packages.find((p) => p.name === "@fixture/web")!.runtime).toBe(
      "browser",
    );
  });

  it("never crashes on a malformed package.json and reports a warning", async () => {
    const { packages } = await scanWorkspace(fixture("malformed"));
    expect(packages).toHaveLength(1);
    expect(packages[0]!.manifestValid).toBe(false);
    expect(packages[0]!.warnings.length).toBeGreaterThan(0);
    expect(packages[0]!.warnings[0]).toMatch(/Invalid JSON/i);
  });
});

describe("createRunner (integration)", () => {
  it("scans + runs all checks against a real fixture workspace", async () => {
    const runner = createRunner({
      cwd: fixture("pnpm-ws"),
      clock: () => "2020-01-01T00:00:00.000Z",
    });
    const run = await runner.run();

    expect(run.reports).toHaveLength(2);
    expect(run.summary.totalPackages).toBe(2);
    for (const report of run.reports) {
      expect(report.checks.length).toBeGreaterThanOrEqual(9);
      expect(report.score).toBeGreaterThanOrEqual(0);
      expect(report.score).toBeLessThanOrEqual(100);
      // package_json_valid + name present should pass for these fixtures
      expect(
        report.checks.find((c) => c.checkId === "package_json_valid")!.status,
      ).toBe("pass");
    }
    // deterministic id from injected clock
    expect(run.id).toBe("run-2020-01-01T00:00:00.000Z");
  });
});
