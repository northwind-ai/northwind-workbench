import { mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { PerformanceSnapshot } from "./types";

/**
 * Persistence for performance snapshots — a directory of JSON files under
 * `<workspace>/.package-workbench/perf`, one per run, so regressions can be
 * compared over time. Mirrors the history store; never throws on read.
 */

export interface PerfStore {
  save(snapshot: PerformanceSnapshot): Promise<void>;
  all(): Promise<PerformanceSnapshot[]>;
  latest(): Promise<PerformanceSnapshot | null>;
  prune(max: number): Promise<void>;
}

export function defaultPerfDir(workspacePath: string): string {
  return join(workspacePath, ".package-workbench", "perf");
}

const safe = (id: string): string => id.replace(/[^a-zA-Z0-9._-]/g, "_");

export function createPerfStore(baseDir: string): PerfStore {
  async function all(): Promise<PerformanceSnapshot[]> {
    let files: string[];
    try {
      files = (await readdir(baseDir)).filter((f) => f.endsWith(".json"));
    } catch {
      return [];
    }
    const snaps = await Promise.all(
      files.map(async (f) => {
        try {
          return JSON.parse(
            await readFile(join(baseDir, f), "utf8"),
          ) as PerformanceSnapshot;
        } catch {
          return null;
        }
      }),
    );
    return snaps
      .filter((s): s is PerformanceSnapshot => s !== null)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  return {
    async save(snapshot) {
      await mkdir(baseDir, { recursive: true });
      await writeFile(
        join(baseDir, `${safe(snapshot.id)}.json`),
        JSON.stringify(snapshot, null, 2),
        "utf8",
      );
    },
    all,
    async latest() {
      return (await all())[0] ?? null;
    },
    async prune(max) {
      const snaps = await all();
      for (const old of snaps.slice(max))
        await rm(join(baseDir, `${safe(old.id)}.json`), { force: true }).catch(
          () => {},
        );
    },
  };
}
