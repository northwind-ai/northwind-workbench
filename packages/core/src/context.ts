import { exec as nodeExec } from 'node:child_process';
import { readFile, access, readdir } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { ExecOptions, ExecResult, Logger, PluginContext } from '@package-workbench/plugin-sdk';

const execAsync = promisify(nodeExec);

export function createConsoleLogger(prefix = 'workbench'): Logger {
  const tag = `[${prefix}]`;
  return {
    debug: (m, ...a) => process.env.PW_DEBUG && console.debug(tag, m, ...a),
    info: (m, ...a) => console.info(tag, m, ...a),
    warn: (m, ...a) => console.warn(tag, m, ...a),
    error: (m, ...a) => console.error(tag, m, ...a),
  };
}

/** Default Node-backed context. The only place the engine touches the OS. */
export function createNodeContext(cwd: string, logger: Logger = createConsoleLogger()): PluginContext {
  return {
    cwd,
    logger,

    async exec(command: string, opts: ExecOptions): Promise<ExecResult> {
      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: opts.cwd,
          timeout: opts.timeoutMs ?? 120_000,
          env: { ...process.env, ...opts.env },
          maxBuffer: 16 * 1024 * 1024,
          windowsHide: true,
        });
        return { code: 0, stdout, stderr, timedOut: false };
      } catch (err) {
        const e = err as { code?: number; killed?: boolean; signal?: string; stdout?: string; stderr?: string };
        return {
          code: typeof e.code === 'number' ? e.code : 1,
          stdout: e.stdout ?? '',
          stderr: e.stderr ?? String(err),
          timedOut: Boolean(e.killed) || e.signal === 'SIGTERM',
        };
      }
    },

    async readJson<T = unknown>(absPath: string): Promise<T | null> {
      try {
        return JSON.parse(await readFile(absPath, 'utf8')) as T;
      } catch {
        return null;
      }
    },

    async fileExists(absPath: string): Promise<boolean> {
      try {
        await access(absPath);
        return true;
      } catch {
        return false;
      }
    },

    async readDir(absPath: string): Promise<string[]> {
      try {
        const entries = await readdir(absPath, { withFileTypes: true });
        return entries.filter((e) => e.isDirectory()).map((e) => e.name);
      } catch {
        return [];
      }
    },
  };
}
