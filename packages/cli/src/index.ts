#!/usr/bin/env node
import { resolve } from 'node:path';
import { createMockRun, createRunner, type RunnerEvent, type WorkbenchRun } from '@package-workbench/core';

interface Flags {
  pretty: boolean;
  quiet: boolean;
  mock: boolean;
}

function parseFlags(argv: string[]): { positionals: string[]; flags: Flags } {
  const positionals: string[] = [];
  const flags: Flags = { pretty: false, quiet: false, mock: false };
  for (const a of argv) {
    if (a === '--pretty') flags.pretty = true;
    else if (a === '--quiet' || a === '-q') flags.quiet = true;
    else if (a === '--mock') flags.mock = true;
    else if (!a.startsWith('-')) positionals.push(a);
  }
  return { positionals, flags };
}

function printHelp(): void {
  console.log(`package-workbench — verify that packages actually work

Usage:
  package-workbench scan <path>        Scan a workspace and run health checks
  package-workbench scan . --pretty    Human-readable output instead of JSON
  package-workbench scan --mock        Print the built-in mock run (no FS access)

Options:
  --pretty     Pretty table output (default is JSON)
  --quiet, -q  Suppress progress logging on stderr
  -h, --help   Show this help
`);
}

const ICON: Record<string, string> = { pass: '✓', warn: '!', fail: '✗' };

function printPretty(run: WorkbenchRun): void {
  const w = run.workspace;
  console.log(`Workspace: ${w.name ?? w.root}  [${w.packageManager}${w.isMonorepo ? ', monorepo' : ''}]`);
  console.log(`Packages: ${w.packageCount}  ·  avg score ${run.summary.averageScore}/100`);
  for (const warning of w.warnings) console.log(`  ! ${warning}`);

  for (const r of run.reports) {
    console.log(`\n${ICON[r.status] ?? '?'} ${r.package.name}@${r.package.version}  ${r.score}/100  (${r.confidence} confidence, ${r.package.packageType}/${r.package.runtime})`);
    for (const c of r.checks) {
      const mark = ICON[c.status] ?? (c.status === 'skip' ? '·' : '?');
      console.log(`   ${mark} ${c.checkId.padEnd(26)} ${c.summary}`);
    }
  }
  console.log(`\n${run.summary.passed} passed · ${run.summary.warned} warned · ${run.summary.failed} failed`);
}

/** A compact JSON summary suitable for CI consumption. */
function toJsonSummary(run: WorkbenchRun) {
  return {
    workspace: run.workspace,
    summary: run.summary,
    packages: run.reports.map((r) => ({
      name: r.package.name,
      version: r.package.version,
      packageType: r.package.packageType,
      runtime: r.package.runtime,
      score: r.score,
      confidence: r.confidence,
      status: r.status,
      checks: r.checks.map((c) => ({ id: c.checkId, status: c.status, severity: c.severity, summary: c.summary })),
    })),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  const [command, ...rest] = argv;
  if (command !== 'scan') {
    console.error(`Unknown command: ${command}\n`);
    printHelp();
    process.exit(2);
  }

  const { positionals, flags } = parseFlags(rest);

  let run: WorkbenchRun;
  if (flags.mock) {
    run = createMockRun();
  } else {
    const cwd = resolve(positionals[0] ?? process.cwd());
    const runner = createRunner({ cwd });
    if (!flags.quiet) {
      runner.on((e: RunnerEvent) => {
        if (e.type === 'workspace:detected') process.stderr.write(`· ${e.workspace.packageCount} package(s) in ${e.workspace.packageManager} workspace\n`);
        else if (e.type === 'package:start') process.stderr.write(`· checking ${e.packageId}\n`);
      });
    }
    run = await runner.run();
  }

  if (flags.pretty) printPretty(run);
  else process.stdout.write(JSON.stringify(toJsonSummary(run), null, 2) + '\n');

  process.exit(run.summary.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
