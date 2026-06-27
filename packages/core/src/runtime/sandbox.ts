import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  ImportExecutionResult,
  ImportFailureClass,
  PackageInfo,
  RuntimeTarget,
} from "@package-workbench/plugin-sdk";
import { resolvePrimaryEntry } from "./resolve";

/**
 * Import-execution sandbox. Actually loads a package's entry in a *fresh child
 * Node process* and reports what happened — resolution failures, missing deps,
 * ESM/CJS mismatches, syntax errors, or runtime exceptions. No `eval`, no `vm`
 * hacks: a tiny generated harness `require()`s / `import()`s the entry and prints
 * a structured result, which we parse back.
 *
 * Caveat (documented): importing a module runs its top-level code. This is the
 * point — but it means the target package is trusted at v1, exactly like the
 * in-process plugin model. The child process + timeout contain the blast radius.
 */

const execFileAsync = promisify(execFile);

/** Sentinel-wrapped JSON so we can recover the result even if the module logs to stdout. */
const MARK = "PW";

const CJS_HARNESS = `
const target = process.argv[2];
const out = (o) => process.stdout.write(${JSON.stringify(MARK)} + JSON.stringify(o) + ${JSON.stringify(MARK)});
try {
  const mod = require(target);
  out({ ok: true, keys: mod && typeof mod === 'object' ? Object.keys(mod) : [] });
} catch (e) {
  out({ ok: false, name: e && e.name, code: e && e.code, message: e && e.message, stack: e && e.stack });
}
`;

const ESM_HARNESS = `
import { pathToFileURL } from 'node:url';
const target = process.argv[2];
const out = (o) => process.stdout.write(${JSON.stringify(MARK)} + JSON.stringify(o) + ${JSON.stringify(MARK)});
try {
  const mod = await import(pathToFileURL(target).href);
  out({ ok: true, keys: mod ? Object.keys(mod) : [] });
} catch (e) {
  out({ ok: false, name: e && e.name, code: e && e.code, message: e && e.message, stack: e && e.stack });
}
`;

interface HarnessResult {
  ok: boolean;
  keys?: string[];
  name?: string;
  code?: string;
  message?: string;
  stack?: string;
}

export interface ExecuteImportOptions {
  timeoutMs?: number;
  /** Override the entry file (otherwise resolved from the manifest). */
  entry?: string;
  /** Cap the child's heap (V8 --max-old-space-size). Default 1024 MB. */
  maxMemoryMb?: number;
  /** Strip the environment to a minimal safe set (PATH only). Default false. */
  restrictEnv?: boolean;
  /** Abort the import (kills the child) when this signal fires. */
  signal?: AbortSignal;
}

/** A minimal environment for the sandboxed child — no inherited secrets/config. */
function restrictedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_OPTIONS: "" };
  for (const key of [
    "PATH",
    "Path",
    "SystemRoot",
    "TEMP",
    "TMP",
    "HOME",
    "USERPROFILE",
  ]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

const MISSING_RE = /Cannot find (?:module|package) ['"]([^'"]+)['"]/;

/** Map a raw child error into a stable {@link ImportFailureClass} + missing-module hint. */
export function classifyImportError(r: HarnessResult): {
  failureClass: ImportFailureClass;
  missingModule?: string;
} {
  const msg = r.message ?? "";
  const code = r.code ?? "";

  if (
    code === "ERR_REQUIRE_ESM" ||
    /require\(\) of ES Module/.test(msg) ||
    /Cannot use import statement outside a module/.test(msg) ||
    /module is not defined in ES module scope/.test(msg) ||
    /exports is not defined in ES module scope/.test(msg)
  ) {
    return { failureClass: "ESM_CJS_MISMATCH" };
  }
  if (
    code === "ERR_PACKAGE_PATH_NOT_EXPORTED" ||
    code === "ERR_UNSUPPORTED_DIR_IMPORT" ||
    code === "ERR_PACKAGE_IMPORT_NOT_DEFINED"
  ) {
    return { failureClass: "EXPORT_RESOLUTION_FAILURE" };
  }
  if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
    const found = MISSING_RE.exec(msg);
    const mod = found?.[1];
    // A bare specifier (not a path) means a real dependency is missing.
    if (
      mod &&
      !mod.startsWith(".") &&
      !mod.startsWith("/") &&
      !/^[A-Za-z]:[\\/]/.test(mod)
    ) {
      return {
        failureClass: "MISSING_DEPENDENCY",
        missingModule: mod.replace(/^node:/, ""),
      };
    }
    return { failureClass: "IMPORT_RESOLUTION_FAILURE" };
  }
  if (r.name === "SyntaxError") return { failureClass: "SYNTAX_FAILURE" };
  return { failureClass: "RUNTIME_EXCEPTION" };
}

/** Best-effort: first stack frame that lives inside the package root, else first frame. */
function offendingFrom(
  stack: string | undefined,
  root: string,
): string | undefined {
  if (!stack) return undefined;
  const re = /(?:\(|\s)((?:[A-Za-z]:[\\/]|\/)[^\s():]+):\d+:\d+/g;
  const frames: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(stack)) !== null) frames.push(m[1]!);
  return frames.find((f) => f.startsWith(root)) ?? frames[0];
}

function parseHarnessOutput(stdout: string): HarnessResult | null {
  const start = stdout.indexOf(MARK);
  const end = stdout.lastIndexOf(MARK);
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(stdout.slice(start + MARK.length, end)) as HarnessResult;
  } catch {
    return null;
  }
}

/**
 * Import a package's primary entry for the given module system and report the
 * outcome. `system` selects the harness: 'esm' uses dynamic `import()`, 'cjs'
 * uses `require()`. Never throws — failures become a structured result.
 */
export async function executeImport(
  pkg: PackageInfo,
  system: "esm" | "cjs",
  opts: ExecuteImportOptions = {},
): Promise<ImportExecutionResult> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const target: RuntimeTarget = system === "esm" ? "node_esm" : "node_cjs";
  const started = Date.now();

  const entry = opts.entry ?? (await resolvePrimaryEntry(pkg, system));
  if (!entry) {
    return {
      target,
      entry: pkg.root,
      ok: false,
      durationMs: Date.now() - started,
      failureClass: "IMPORT_RESOLUTION_FAILURE",
      errorType: "ResolutionError",
      message: `No ${system.toUpperCase()} entry point could be resolved for this package`,
    };
  }

  let dir: string | undefined;
  try {
    dir = await mkdtemp(join(tmpdir(), "pw-sandbox-"));
    const harnessFile = join(
      dir,
      system === "esm" ? "harness.mjs" : "harness.cjs",
    );
    await writeFile(
      harnessFile,
      system === "esm" ? ESM_HARNESS : CJS_HARNESS,
      "utf8",
    );

    const maxMemoryMb = opts.maxMemoryMb ?? 1024;
    const nodeArgs = [
      `--max-old-space-size=${maxMemoryMb}`,
      "--no-warnings",
      harnessFile,
      entry,
    ];

    let stdout = "";
    try {
      const result = await execFileAsync(process.execPath, nodeArgs, {
        cwd: pkg.root,
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        signal: opts.signal,
        env: opts.restrictEnv
          ? restrictedEnv()
          : { ...process.env, NODE_OPTIONS: "" },
      });
      stdout = result.stdout;
    } catch (err) {
      const e = err as {
        killed?: boolean;
        signal?: string;
        stdout?: string;
        name?: string;
      };
      stdout = e.stdout ?? "";
      // Aborted via the cancellation signal.
      if (e.name === "AbortError" || opts.signal?.aborted) {
        return {
          target,
          entry,
          ok: false,
          durationMs: Date.now() - started,
          timedOut: false,
          failureClass: "RUNTIME_EXCEPTION",
          errorType: "CancelledError",
          message: "Import was cancelled",
        };
      }
      if (e.killed || e.signal === "SIGTERM") {
        return {
          target,
          entry,
          ok: false,
          durationMs: Date.now() - started,
          timedOut: true,
          failureClass: "RUNTIME_EXCEPTION",
          errorType: "TimeoutError",
          message: `Import did not complete within ${timeoutMs}ms (possible top-level hang or infinite loop)`,
        };
      }
      // Non-zero exit without our sentinel — fall through to parse what we have.
    }

    const parsed = parseHarnessOutput(stdout);
    if (!parsed) {
      return {
        target,
        entry,
        ok: false,
        durationMs: Date.now() - started,
        failureClass: "RUNTIME_EXCEPTION",
        errorType: "HarnessError",
        message:
          "The import harness produced no parseable result (the process may have crashed)",
      };
    }

    if (parsed.ok) {
      return {
        target,
        entry,
        ok: true,
        durationMs: Date.now() - started,
        exportedKeys: parsed.keys ?? [],
      };
    }

    const { failureClass, missingModule } = classifyImportError(parsed);
    return {
      target,
      entry,
      ok: false,
      durationMs: Date.now() - started,
      failureClass,
      errorType: parsed.name ?? "Error",
      message: parsed.message ?? "Unknown import error",
      stack: parsed.stack,
      offendingFile: offendingFrom(parsed.stack, pkg.root),
      missingModule,
    };
  } catch (err) {
    return {
      target,
      entry,
      ok: false,
      durationMs: Date.now() - started,
      failureClass: "RUNTIME_EXCEPTION",
      errorType: "SandboxError",
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
