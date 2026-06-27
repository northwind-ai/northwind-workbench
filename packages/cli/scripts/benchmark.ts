/**
 * Engine performance benchmark. Generates synthetic monorepos of 10 / 100 / 500
 * packages and measures the scan + dependency-graph cost (wall time + memory).
 *
 *   pnpm --filter @package-workbench/cli exec tsx scripts/benchmark.ts
 *
 * Runtime import execution is disabled here (PW_NO_RUNTIME=1) so the benchmark
 * measures the static analysis + graph engine deterministically rather than the
 * cost of spawning N child Node processes (which is bounded separately by the
 * per-import timeout).
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRunner } from '@package-workbench/core';

process.env.PW_NO_RUNTIME = '1';

async function generateRepo(root: string, n: number): Promise<void> {
  await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
  for (let i = 0; i < n; i++) {
    const dir = join(root, 'packages', `p${i}`);
    await mkdir(dir, { recursive: true });
    const deps = i > 0 ? { [`@bench/p${i - 1}`]: 'workspace:*' } : {};
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ name: `@bench/p${i}`, version: '1.0.0', type: 'module', main: './index.js', dependencies: deps }, null, 2),
    );
    const importLine = i > 0 ? `import { v${i - 1} } from '@bench/p${i - 1}';\n` : '';
    await writeFile(join(dir, 'index.js'), `${importLine}export const v${i} = ${i};\n`);
  }
}

interface Result {
  packages: number;
  scanMs: number;
  graphMs: number;
  totalMs: number;
  heapMb: number;
  rssMb: number;
}

async function benchmark(n: number): Promise<Result> {
  const root = await mkdtemp(join(tmpdir(), `pw-bench-${n}-`));
  try {
    await generateRepo(root, n);
    if (global.gc) global.gc();
    const heapBefore = process.memoryUsage().heapUsed;

    const runner = createRunner({ cwd: root });
    const t0 = performance.now();
    const run = await runner.run(); // inspect + all health checks (static)
    const t1 = performance.now();
    await runner.analyzeGraph();
    const t2 = performance.now();

    const mem = process.memoryUsage();
    if (run.summary.totalPackages !== n) throw new Error(`expected ${n} packages, got ${run.summary.totalPackages}`);
    return {
      packages: n,
      scanMs: Math.round(t1 - t0),
      graphMs: Math.round(t2 - t1),
      totalMs: Math.round(t2 - t0),
      heapMb: Math.round((mem.heapUsed - heapBefore) / 1024 / 1024),
      rssMb: Math.round(mem.rss / 1024 / 1024),
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const sizes = [10, 100, 500];
  const results: Result[] = [];
  for (const n of sizes) {
    process.stderr.write(`· benchmarking ${n} packages…\n`);
    results.push(await benchmark(n));
  }

  console.log(`\nNode ${process.version} · ${process.platform}/${process.arch}\n`);
  console.log('| Packages | Scan (ms) | Graph (ms) | Total (ms) | Heap Δ (MB) | RSS (MB) |');
  console.log('| -------: | --------: | ---------: | ---------: | ----------: | -------: |');
  for (const r of results) {
    console.log(`| ${r.packages} | ${r.scanMs} | ${r.graphMs} | ${r.totalMs} | ${r.heapMb} | ${r.rssMb} |`);
  }
}

void main();
