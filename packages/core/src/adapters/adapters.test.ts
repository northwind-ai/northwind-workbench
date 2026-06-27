import { describe, expect, it, beforeAll } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { assemblePackageInfo } from "@package-workbench/plugin-sdk";
import { detectWorkspaceStack, scanWithAdapters } from "./registry";
import {
  parseTurboConfig,
  classifyTurboPackage,
  classifyPackages,
} from "./turbo";

/**
 * Fixtures are written to temp directories so detection runs against a real
 * filesystem — cross-platform, deterministic, no network, no installs. Each
 * shape exercises a different adapter (and the conflict case exercises
 * precedence + combination).
 */

type Tree = Record<string, string>;

async function writeTree(tree: Tree): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pw-ws-"));
  for (const [rel, content] of Object.entries(tree)) {
    const abs = join(root, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
  }
  return root;
}

const pkgJson = (name: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ name, version: "1.0.0", ...extra });

// ---- fixtures ----------------------------------------------------------------

const FIXTURES = {
  turboPnpm: (): Tree => ({
    "package.json": pkgJson("root", {
      packageManager: "pnpm@9.1.0",
      private: true,
    }),
    "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n",
    "pnpm-lock.yaml": "lockfileVersion: 9.0\n",
    "turbo.json": JSON.stringify({ tasks: { build: {}, test: {}, lint: {} } }),
    "packages/ui/package.json": pkgJson("@nw/ui", { main: "index.js" }),
  }),
  npmWorkspace: (): Tree => ({
    "package.json": pkgJson("root", {
      workspaces: ["packages/*"],
      private: true,
    }),
    "package-lock.json": "{}",
    "packages/a/package.json": pkgJson("@nw/a", { main: "index.js" }),
  }),
  yarnWorkspace: (): Tree => ({
    "package.json": pkgJson("root", {
      workspaces: { packages: ["packages/*"] },
      private: true,
    }),
    "yarn.lock": "# yarn lockfile v1\n",
    "packages/a/package.json": pkgJson("@nw/a"),
  }),
  bunWorkspace: (): Tree => ({
    "package.json": pkgJson("root", {
      workspaces: ["packages/*"],
      packageManager: "bun@1.1.0",
      private: true,
    }),
    "bun.lock": "{}",
    "packages/a/package.json": pkgJson("@nw/a"),
  }),
  single: (): Tree => ({
    "package.json": pkgJson("just-me", { main: "index.js" }),
  }),
  nxTurboConflict: (): Tree => ({
    "package.json": pkgJson("root", {
      packageManager: "pnpm@9.1.0",
      devDependencies: { nx: "19.0.0", turbo: "2.0.0" },
    }),
    "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n",
    "nx.json": JSON.stringify({ npmScope: "nw" }),
    "turbo.json": JSON.stringify({ pipeline: { build: {} } }),
    "packages/a/package.json": pkgJson("@nw/a"),
  }),
  malformed: (): Tree => ({
    "package.json": "{ this is not json",
    "turbo.json": "{ also broken",
    "pnpm-workspace.yaml": "packages:\n  - packages/*\n",
  }),
};

// ---- detection ---------------------------------------------------------------

describe("detectWorkspaceStack", () => {
  it("turbo + pnpm: primary turbo, package list from pnpm, combined capabilities", async () => {
    const stack = await detectWorkspaceStack(
      await writeTree(FIXTURES.turboPnpm()),
    );
    const ids = stack.detected.map((d) => d.adapter);
    expect(ids).toContain("turbo");
    expect(ids).toContain("pnpm");
    expect(stack.primary).toBe("turbo"); // precedence 80 > pnpm 70
    expect(stack.packageManager).toBe("pnpm");
    expect(stack.capabilities["task-pipeline"]).toContain("turbo");
    expect(stack.capabilities["package-list"]).toContain("pnpm");
    expect(stack.isSinglePackage).toBe(false);
  });

  it("npm workspace: primary npm with a package list", async () => {
    const stack = await detectWorkspaceStack(
      await writeTree(FIXTURES.npmWorkspace()),
    );
    expect(stack.primary).toBe("npm");
    expect(stack.packageManager).toBe("npm");
    expect(stack.capabilities["package-list"]).toContain("npm");
  });

  it("yarn workspace: primary yarn", async () => {
    const stack = await detectWorkspaceStack(
      await writeTree(FIXTURES.yarnWorkspace()),
    );
    expect(stack.primary).toBe("yarn");
    expect(stack.packageManager).toBe("yarn");
  });

  it("bun workspace (text bun.lock): detects bun", async () => {
    const stack = await detectWorkspaceStack(
      await writeTree(FIXTURES.bunWorkspace()),
    );
    expect(stack.detected.map((d) => d.adapter)).toContain("bun");
    expect(stack.packageManager).toBe("bun");
  });

  it("single package: isSinglePackage, primary single-package", async () => {
    const stack = await detectWorkspaceStack(
      await writeTree(FIXTURES.single()),
    );
    expect(stack.isSinglePackage).toBe(true);
    expect(stack.primary).toBe("single-package");
    expect(stack.notes.some((n) => /single-package mode/i.test(n))).toBe(true);
  });

  it("nx + turbo conflict: primary nx (highest precedence), project graph from nx", async () => {
    const stack = await detectWorkspaceStack(
      await writeTree(FIXTURES.nxTurboConflict()),
    );
    const ids = stack.detected.map((d) => d.adapter);
    expect(ids).toContain("nx");
    expect(ids).toContain("turbo");
    expect(ids).toContain("pnpm");
    expect(stack.primary).toBe("nx"); // 90 > turbo 80 > pnpm 70
    expect(stack.capabilities["project-graph"]).toContain("nx");
    expect(stack.capabilities["task-pipeline"]).toEqual(
      expect.arrayContaining(["nx", "turbo"]),
    );
  });

  it("never crashes on malformed workspace files", async () => {
    const stack = await detectWorkspaceStack(
      await writeTree(FIXTURES.malformed()),
    );
    // Still detects pnpm from the workspace yaml + turbo from the file's presence.
    expect(stack.detected.map((d) => d.adapter)).toEqual(
      expect.arrayContaining(["pnpm", "turbo"]),
    );
  });

  it("reports a package manager even with low confidence, never throws on empty dir", async () => {
    const stack = await detectWorkspaceStack(
      await mkdtemp(join(tmpdir(), "pw-empty-")),
    );
    expect(stack.primary).toBeDefined();
    expect(stack.packageManager).toBe("unknown");
  });
});

// ---- scanning ----------------------------------------------------------------

describe("scanWithAdapters", () => {
  it("lists workspace packages for a turbo+pnpm repo", async () => {
    const { workspace, packages } = await scanWithAdapters(
      await writeTree(FIXTURES.turboPnpm()),
    );
    expect(workspace.packageManager).toBe("pnpm");
    expect(packages.map((p) => p.name)).toContain("@nw/ui");
  });

  it("treats a single-package repo as one package", async () => {
    const { packages } = await scanWithAdapters(
      await writeTree(FIXTURES.single()),
    );
    expect(packages).toHaveLength(1);
    expect(packages[0]!.name).toBe("just-me");
  });
});

// ---- turbo parsing + classification -----------------------------------------

describe("turbo helpers", () => {
  it("parses the modern tasks key and the legacy pipeline key", () => {
    expect(parseTurboConfig({ tasks: { build: {}, test: {} } })).toMatchObject({
      tasks: ["build", "test"],
      modern: true,
    });
    expect(parseTurboConfig({ pipeline: { lint: {} } })).toMatchObject({
      tasks: ["lint"],
      modern: false,
    });
    expect(parseTurboConfig("garbage")).toEqual({
      tasks: [],
      globalDependencies: [],
      modern: false,
    });
  });

  it("classifies packages app/package/tool/config", () => {
    const make = (
      name: string,
      dir: string,
      manifest: Record<string, unknown> = {},
    ) =>
      assemblePackageInfo({
        root: join("/repo", dir),
        packageJsonPath: join("/repo", dir, "package.json"),
        manifest: { name, version: "1.0.0", ...manifest },
      });
    expect(
      classifyTurboPackage(
        make("@nw/web", "apps/web", {
          private: true,
          scripts: { dev: "vite" },
        }),
      ),
    ).toBe("app");
    expect(
      classifyTurboPackage(
        make("@nw/cli", "tools/cli", { bin: { cli: "index.js" } }),
      ),
    ).toBe("tool");
    expect(
      classifyTurboPackage(make("eslint-config-nw", "packages/eslint-config")),
    ).toBe("config");
    expect(
      classifyTurboPackage(
        make("@nw/lib", "packages/lib", { main: "index.js" }),
      ),
    ).toBe("package");

    const tally = classifyPackages([
      make("@nw/web", "apps/web", { private: true, scripts: { dev: "x" } }),
      make("@nw/lib", "packages/lib", { main: "i.js" }),
    ]);
    expect(tally).toMatchObject({ app: 1, package: 1 });
  });
});
