import { describe, expect, it } from 'vitest';
import {
  assemblePackageInfo,
  type HealthCheckResult,
  type HealthCheckSeverity,
  type HealthCheckStatus,
  type PackageInfo,
} from '@package-workbench/plugin-sdk';
import { computeConfidence, computeScore, computeStatus, summarize, buildReport } from './scoring';
import type { PackageHealthReport } from './types';

function check(status: HealthCheckStatus, severity: HealthCheckSeverity = 'info'): HealthCheckResult {
  return { checkId: `c-${status}-${severity}`, label: 't', status, severity, summary: 's' };
}

function fakePkg(id: string): PackageInfo {
  return assemblePackageInfo({
    root: `/${id}`,
    packageJsonPath: `/${id}/package.json`,
    manifest: { name: id, version: '1.0.0' },
  });
}

describe('computeScore', () => {
  it('returns 100 when everything passes', () => {
    expect(computeScore([check('pass'), check('pass'), check('pass')])).toBe(100);
  });

  it('subtracts heavily for a critical failure', () => {
    expect(computeScore([check('fail', 'critical'), check('pass')])).toBe(50);
  });

  it('subtracts moderately for a warning', () => {
    expect(computeScore([check('warn', 'medium'), check('pass'), check('pass')])).toBe(92);
  });

  it('penalizes by severity: critical > high > medium > low', () => {
    expect(computeScore([check('fail', 'high')])).toBe(70);
    expect(computeScore([check('fail', 'medium')])).toBe(85);
    expect(computeScore([check('fail', 'low')])).toBe(93);
  });

  it('does not penalize skip or unknown', () => {
    expect(computeScore([check('skip'), check('unknown'), check('pass')])).toBe(100);
  });

  it('clamps at 0 for many critical failures', () => {
    expect(computeScore([check('fail', 'critical'), check('fail', 'critical'), check('fail', 'critical')])).toBe(0);
  });
});

describe('computeConfidence', () => {
  it('is low with no checks', () => {
    expect(computeConfidence([])).toBe('low');
  });

  it('is high when nearly all checks are conclusive', () => {
    expect(computeConfidence([check('pass'), check('pass'), check('fail', 'low'), check('warn', 'low')])).toBe('high');
  });

  it('is low when mostly skipped', () => {
    expect(computeConfidence([check('pass'), check('skip'), check('skip'), check('skip')])).toBe('low');
  });

  it('caps at medium when any check is unknown, even with a high conclusive ratio', () => {
    expect(computeConfidence([check('pass'), check('pass'), check('pass'), check('unknown')])).toBe('medium');
  });
});

describe('computeStatus', () => {
  it('fails if any check fails', () => {
    expect(computeStatus([check('pass'), check('fail', 'low')])).toBe('fail');
  });
  it('warns if any check warns and none fail', () => {
    expect(computeStatus([check('pass'), check('warn', 'medium')])).toBe('warn');
  });
  it('passes when only pass/skip/unknown', () => {
    expect(computeStatus([check('pass'), check('skip'), check('unknown')])).toBe('pass');
  });
});

describe('buildReport', () => {
  it('assembles score, confidence and status together', () => {
    const report = buildReport(fakePkg('p'), [check('pass'), check('fail', 'critical')], '2020-01-01T00:00:00.000Z');
    expect(report.score).toBe(50);
    expect(report.status).toBe('fail');
    expect(report.confidence).toBe('high');
  });
});

describe('summarize', () => {
  const mk = (id: string, score: number, status: PackageHealthReport['status'], confidence: PackageHealthReport['confidence']): PackageHealthReport => ({
    package: fakePkg(id),
    checks: [],
    score,
    status,
    confidence,
    generatedAt: '2020-01-01T00:00:00.000Z',
  });

  it('counts statuses, averages score and finds the worst package', () => {
    const s = summarize([mk('a', 100, 'pass', 'high'), mk('b', 40, 'fail', 'low'), mk('c', 80, 'warn', 'medium')]);
    expect(s.totalPackages).toBe(3);
    expect(s.passed).toBe(1);
    expect(s.warned).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.averageScore).toBe(73);
    expect(s.lowConfidence).toBe(1);
    expect(s.worstPackageId).toBe('b');
  });

  it('handles the empty case', () => {
    expect(summarize([])).toMatchObject({ totalPackages: 0, averageScore: 0, worstPackageId: null });
  });
});
