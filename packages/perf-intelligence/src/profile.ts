import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  PackageInfo,
  PackageManager,
  WorkspaceInfo,
} from "@package-workbench/plugin-sdk";
import type { BuildSample } from "./collect";

/**
 * Optional live build profiler. Runs each package's `build` script with accurate
 * per-package attribution and times it, detecting cache hits from the build
 * tool's output. This EXECUTES builds, so it is strictly opt-in (`perf --profile`)
 * and never runs in tests; the command derivation is pure and tested.
 *
 * Attribution: Nx / Turborepo / pnpm / npm / yarn / bun each get the right
 * filtered build invocation so the timing is for that package only.
 */

const run = promisify(execFile);

export interface BuildCommandContext {
  packageName: string;
  hasBuildScript: boolean;
  packageManager: PackageManager;
  nx: boolean;
  turbo: boolean;
}

/** Derive the per-package build command. Returns null when there's nothing to build. */
export function deriveBuildCommand(
  ctx: BuildCommandContext,
): { cmd: string; args: string[] } | null {
  const short = ctx.packageName.split("/").pop() ?? ctx.packageName;
  if (ctx.nx) return { cmd: "npx", args: ["nx", "build", short] };
  if (ctx.turbo)
    return {
      cmd: "npx",
      args: ["turbo", "run", "build", "--filter", ctx.packageName],
    };
  if (!ctx.hasBuildScript) return null;
  switch (ctx.packageManager) {
    case "pnpm":
      return {
        cmd: "pnpm",
        args: ["--filter", ctx.packageName, "run", "build"],
      };
    case "yarn":
      return { cmd: "yarn", args: ["workspace", ctx.packageName, "build"] };
    case "bun":
      return { cmd: "bun", args: ["run", "build"] };
    default:
      return { cmd: "npm", args: ["run", "build", "-w", ctx.packageName] };
  }
}

const CACHE_HIT_RE =
  /cache hit|FULL TURBO|>>> cache|existing outputs|nx:cache|read the output from cache/i;

export interface ProfileOptions {
  /** Per-build timeout, ms. */
  timeoutMs?: number;
  onProgress?: (packageName: string) => void;
}

/** Run + time each package's build. Executes builds — opt-in only. */
export async function profileBuilds(
  cwd: string,
  packages: PackageInfo[],
  workspace: WorkspaceInfo,
  opts: ProfileOptions = {},
): Promise<BuildSample[]> {
  const samples: BuildSample[] = [];
  for (const pkg of packages) {
    const command = deriveBuildCommand({
      packageName: pkg.name,
      hasBuildScript: Boolean(pkg.scripts.build),
      packageManager: workspace.packageManager,
      nx: workspace.tooling.nx,
      turbo: workspace.tooling.turbo,
    });
    if (!command) continue;
    opts.onProgress?.(pkg.name);
    const start = Date.now();
    try {
      const { stdout, stderr } = await run(command.cmd, command.args, {
        cwd,
        timeout: opts.timeoutMs ?? 600_000,
        maxBuffer: 16 * 1024 * 1024,
      });
      samples.push({
        packageId: pkg.id,
        durationMs: Date.now() - start,
        cacheHit: CACHE_HIT_RE.test(stdout + stderr),
        failed: false,
      });
    } catch {
      samples.push({
        packageId: pkg.id,
        durationMs: Date.now() - start,
        failed: true,
      });
    }
  }
  return samples;
}
