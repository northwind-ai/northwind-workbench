import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { scanWorkspace } from "../scanner";
import { analyzePackageIntelligence } from "./analyze";
import { extractExports, extractImports } from "./source";
import { findDuplicateVersions, bareModuleName } from "./deps";

/**
 * Fixtures (the required set): a private package with an unused export, a public
 * package with unknown external usage, a re-export chain, duplicate dependency
 * versions, and a large fake dist file. Built on disk in a temp workspace —
 * deterministic, offline, no build/install required.
 */

type Tree = Record<string, string>;
async function writeTree(tree: Tree): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pw-intel-"));
  for (const [rel, content] of Object.entries(tree)) {
    const abs = join(root, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
  }
  return root;
}

const sf = (rel: string, content: string) => ({
  rel,
  abs: rel,
  content,
  isTest: /\.(test|spec)\./.test(rel),
});

// ---- source parsing ----------------------------------------------------------

describe("source parsing", () => {
  it("extracts named, default, re-export, star, and type exports", () => {
    const names = extractExports(
      sf(
        "index.ts",
        `export const a = 1;
         export function b() {}
         export default function () {}
         export { c, d as e } from './x';
         export * from './y';
         export type T = string;
         export interface I {}
         export { type U } from './z';`,
      ),
    );
    const byName = (n: string) => names.find((s) => s.name === n);
    expect(byName("a")?.kind).toBe("named");
    expect(byName("b")?.kind).toBe("named");
    expect(byName("default")?.kind).toBe("default");
    expect(byName("c")?.kind).toBe("re-export");
    expect(byName("e")?.kind).toBe("re-export"); // renamed export
    expect(names.some((s) => s.kind === "star-re-export")).toBe(true);
    expect(byName("T")?.typeOnly).toBe(true);
    expect(byName("U")?.typeOnly).toBe(true);
  });

  it("extracts named/default/namespace imports and require", () => {
    const refs = extractImports(
      sf(
        "m.ts",
        `import def, { x, y as z } from 'a';\nimport * as ns from 'b';\nconst r = require('c');\nexport { w } from 'd';`,
      ),
    );
    const a = refs.find((r) => r.specifier === "a")!;
    expect(a.names).toEqual(expect.arrayContaining(["default", "x", "y"]));
    expect(refs.find((r) => r.specifier === "b")!.names).toEqual(["*"]);
    expect(refs.find((r) => r.specifier === "c")).toBeTruthy();
    expect(refs.find((r) => r.specifier === "d")!.names).toEqual(["*"]);
  });

  it("bareModuleName strips subpaths and ignores relatives/builtins", () => {
    expect(bareModuleName("lodash/fp")).toBe("lodash");
    expect(bareModuleName("@scope/pkg/sub")).toBe("@scope/pkg");
    expect(bareModuleName("./local")).toBeNull();
    expect(bareModuleName("node:fs")).toBeNull();
  });
});

// ---- workspace analysis ------------------------------------------------------

const BIG = `export const data = "${"x".repeat(60 * 1024)}";\n`;

function fixture(): Tree {
  return {
    "package.json": JSON.stringify({
      name: "root",
      private: true,
      workspaces: ["packages/*", "apps/*"],
    }),
    "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n  - 'apps/*'\n",
    // private lib: one used export, one dead export; a deps mix for weight checks
    "packages/lib/package.json": JSON.stringify({
      name: "@nw/lib",
      version: "1.0.0",
      private: true,
      main: "dist/index.js",
      dependencies: { react: "^17.0.0", "left-pad": "^1.0.0", chalk: "^5.0.0" },
    }),
    "packages/lib/src/index.ts": `export const used = 1;\nexport function alsoUsed() {}\nexport const deadSymbol = 2;\n`,
    "packages/lib/src/index.test.ts": `import chalk from 'chalk';\nimport { used } from './index';\n`,
    "packages/lib/dist/index.js": BIG,
    // public lib: an export unused internally → must stay "public-api-unknown"
    "packages/pub/package.json": JSON.stringify({
      name: "@nw/pub",
      version: "1.0.0",
      private: false,
      main: "index.js",
    }),
    "packages/pub/src/index.ts": `export const publicApiThing = 1;\n`,
    // barrel: a re-export chain (private)
    "packages/barrel/package.json": JSON.stringify({
      name: "@nw/barrel",
      version: "1.0.0",
      private: true,
    }),
    "packages/barrel/src/index.ts": `export * from './impl';\nexport { reexported } from './impl';\n`,
    "packages/barrel/src/impl.ts": `export const reexported = 1;\nexport const implOnly = 2;\n`,
    // app: consumes only `used` + `alsoUsed` from @nw/lib; pins react at a different version
    "apps/app/package.json": JSON.stringify({
      name: "@nw/app",
      version: "1.0.0",
      private: true,
      dependencies: { react: "^18.0.0" },
    }),
    "apps/app/src/main.ts": `import { used, alsoUsed } from '@nw/lib';\nconsole.log(used, alsoUsed());\n`,
  };
}

describe("analyzePackageIntelligence", () => {
  it("classifies a private package's unused export as definitely-dead", async () => {
    const { packages } = await scanWorkspace(await writeTree(fixture()));
    const report = await analyzePackageIntelligence(packages, {
      gzip: false,
      now: () => "T",
    });
    const lib = report.usage.find((u) => u.packageName === "@nw/lib")!;
    const dead = lib.exports.find((e) => e.symbol.name === "deadSymbol")!;
    expect(dead.usageClass).toBe("definitely-dead");
    expect(dead.confidence).toBeGreaterThan(0.8);
    expect(lib.exports.find((e) => e.symbol.name === "used")!.usageClass).toBe(
      "used",
    );
    expect(
      lib.exports.find((e) => e.symbol.name === "alsoUsed")!.consumers,
    ).toContain("@nw/app");
  });

  it("never marks a public package's export deletable", async () => {
    const { packages } = await scanWorkspace(await writeTree(fixture()));
    const report = await analyzePackageIntelligence(packages, { gzip: false });
    const pub = report.usage.find((u) => u.packageName === "@nw/pub")!;
    const api = pub.exports.find((e) => e.symbol.name === "publicApiThing")!;
    expect(api.usageClass).toBe("public-api-unknown"); // unused internally but NOT deletable
    expect(
      report.usage.some((u) =>
        u.exports.some((e) => !u.private && e.usageClass === "definitely-dead"),
      ),
    ).toBe(false);
  });

  it("flags a stale re-export chain (private barrel) as likely-dead, not definitely", async () => {
    const { packages } = await scanWorkspace(await writeTree(fixture()));
    const report = await analyzePackageIntelligence(packages, { gzip: false });
    const barrel = report.usage.find((u) => u.packageName === "@nw/barrel")!;
    expect(barrel.staleReExports.length).toBeGreaterThan(0);
    // star re-export present → ambiguous → likely-dead, never definitely-dead
    expect(
      barrel.exports.every((e) => e.usageClass !== "definitely-dead"),
    ).toBe(true);
  });

  it("detects duplicate dependency versions across the workspace", async () => {
    const { packages } = await scanWorkspace(await writeTree(fixture()));
    const report = await analyzePackageIntelligence(packages, { gzip: false });
    const react = report.duplicateVersions.find(
      (d) => d.dependency === "react",
    );
    expect(react?.versions).toEqual(
      expect.arrayContaining(["^17.0.0", "^18.0.0"]),
    );
  });

  it("flags unused + test-only runtime dependencies", async () => {
    const { packages } = await scanWorkspace(await writeTree(fixture()));
    const report = await analyzePackageIntelligence(packages, { gzip: false });
    const lib = report.dependencyWeight.find(
      (d) => d.packageName === "@nw/lib",
    )!;
    expect(lib.issues.find((i) => i.dependency === "left-pad")?.kind).toBe(
      "unused",
    );
    expect(lib.issues.find((i) => i.dependency === "chalk")?.kind).toBe(
      "test-only-runtime",
    );
  });

  it("measures a large dist file and lists it among the largest", async () => {
    const { packages } = await scanWorkspace(await writeTree(fixture()));
    const report = await analyzePackageIntelligence(packages, { gzip: true });
    const lib = report.sizes.find((s) => s.packageName === "@nw/lib")!;
    expect(lib.measured).toBe(true);
    expect(lib.totalBytes).toBeGreaterThan(50 * 1024);
    expect(lib.largestFiles[0]!.file).toContain("index.js");
    expect(lib.largestFiles[0]!.gzipBytes).toBeGreaterThan(0);
  });

  it("reports not-measured (never errors) when a package has no build output", async () => {
    const { packages } = await scanWorkspace(await writeTree(fixture()));
    const report = await analyzePackageIntelligence(packages, { gzip: false });
    const pub = report.sizes.find((s) => s.packageName === "@nw/pub")!;
    expect(pub.measured).toBe(false);
  });
});

describe("findDuplicateVersions", () => {
  it("ignores workspace: protocol and identical ranges", async () => {
    const { packages } = await scanWorkspace(await writeTree(fixture()));
    const dups = findDuplicateVersions(packages);
    expect(
      dups.every((d) => d.versions.every((v) => !v.startsWith("workspace:"))),
    ).toBe(true);
  });
});
