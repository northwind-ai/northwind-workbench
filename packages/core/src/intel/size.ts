import { readdir, readFile, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { join, relative } from "node:path";
import type { PackageInfo } from "@package-workbench/plugin-sdk";
import type { FileSize, SizeReport } from "./types";

/**
 * Bundle-size analysis for packages that already have a build output. No bundler
 * is run — we measure the on-disk `dist` (or equivalent), optionally gzip the
 * files, surface the largest ones, and flag dependencies likely to weigh on a
 * browser bundle. "Works without building if dist already exists" is the rule;
 * if there's no output, we report `measured: false`, never an error.
 */

const OUTPUT_DIRS = ["dist", "build", "lib", "out", "es", "esm"];
const MEASURE_EXT = /\.(?:m|c)?[jt]sx?$|\.css$|\.json$|\.wasm$|\.map$/;
const IGNORE = new Set(["node_modules", ".git"]);

/** Dependencies that materially inflate a client bundle (heuristic shortlist). */
const HEAVY_CLIENT_DEPS = new Set([
  "moment",
  "lodash",
  "rxjs",
  "core-js",
  "three",
  "chart.js",
  "@mui/material",
  "@mui/icons-material",
  "antd",
  "aws-sdk",
  "@aws-sdk/client-s3",
  "firebase",
  "highlight.js",
  "pdfjs-dist",
  "monaco-editor",
  "d3",
]);

export interface SizeOptions {
  gzip?: boolean;
  /** Previous total bytes for this package, to compute a delta. */
  previousBytes?: number;
  /** Cap on number of largest files reported. */
  topN?: number;
}

async function findOutputDir(pkg: PackageInfo): Promise<string | null> {
  // Prefer the directory the manifest's main/module/exports actually point at.
  const targets = [
    pkg.manifest.main,
    pkg.manifest.module,
    pkg.manifest.types,
  ].filter((t): t is string => typeof t === "string");
  for (const t of targets) {
    const top = t.replace(/^\.\//, "").split("/")[0];
    if (top && OUTPUT_DIRS.includes(top) && (await isDir(join(pkg.root, top))))
      return top;
  }
  for (const d of OUTPUT_DIRS) {
    if (await isDir(join(pkg.root, d))) return d;
  }
  return null;
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function measureDir(
  absDir: string,
  rootForRel: string,
  gzip: boolean,
): Promise<FileSize[]> {
  const out: FileSize[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) {
        if (!IGNORE.has(e.name)) await walk(abs);
      } else if (MEASURE_EXT.test(e.name)) {
        try {
          const info = await stat(abs);
          const fs: FileSize = {
            file: relative(rootForRel, abs).replace(/\\/g, "/"),
            bytes: info.size,
          };
          if (
            gzip &&
            info.size <= 4 * 1024 * 1024 &&
            !e.name.endsWith(".map")
          ) {
            try {
              fs.gzipBytes = gzipSync(await readFile(abs)).length;
            } catch {
              /* skip gzip on failure */
            }
          }
          out.push(fs);
        } catch {
          /* skip unreadable file */
        }
      }
    }
  }
  await walk(absDir);
  return out;
}

/** Measure a package's build output. Never throws. */
export async function analyzeSize(
  pkg: PackageInfo,
  opts: SizeOptions = {},
): Promise<SizeReport> {
  const gzip = opts.gzip ?? true;
  const topN = opts.topN ?? 5;
  const outputDir = await findOutputDir(pkg);
  const heavyClientDeps =
    pkg.runtime === "browser" || pkg.runtime === "universal"
      ? heavyDepsOf(pkg)
      : [];

  if (!outputDir) {
    return {
      packageId: pkg.id,
      packageName: pkg.name,
      measured: false,
      totalBytes: 0,
      fileCount: 0,
      largestFiles: [],
      heavyClientDeps,
      note: "No build output found — build the package, then re-measure.",
    };
  }

  const files = await measureDir(join(pkg.root, outputDir), pkg.root, gzip);
  const totalBytes = files.reduce((n, f) => n + f.bytes, 0);
  const gzipBytes = gzip
    ? files.reduce((n, f) => n + (f.gzipBytes ?? 0), 0)
    : undefined;
  const largestFiles = [...files]
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, topN);

  return {
    packageId: pkg.id,
    packageName: pkg.name,
    measured: true,
    outputDir,
    totalBytes,
    gzipBytes,
    fileCount: files.length,
    largestFiles,
    heavyClientDeps,
    delta:
      opts.previousBytes != null
        ? {
            previousBytes: opts.previousBytes,
            deltaBytes: totalBytes - opts.previousBytes,
          }
        : undefined,
  };
}

function heavyDepsOf(pkg: PackageInfo): string[] {
  return Object.keys(pkg.dependencies).filter((d) => HEAVY_CLIENT_DEPS.has(d));
}

export { HEAVY_CLIENT_DEPS };
