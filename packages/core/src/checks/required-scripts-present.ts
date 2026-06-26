import { defineCheck, pass, warn, type HealthCheckOutcome } from '@package-workbench/plugin-sdk';
import { CheckId } from '../check-ids';

const COMMON = ['build', 'test', 'typecheck', 'lint'] as const;

/**
 * Detect which common scripts exist. We do NOT run them here (build execution is
 * a later prompt) — this purely reports presence so the UI can show coverage.
 */
export const requiredScriptsPresent = defineCheck({
  id: CheckId.requiredScriptsPresent,
  label: 'Common scripts present',
  description: 'Reports which of build/test/typecheck/lint scripts are defined (does not run them).',
  severity: 'low',
  weight: 1,

  async run({ package: pkg }): Promise<HealthCheckOutcome> {
    const scripts = pkg.scripts;
    const present = COMMON.filter((s) => typeof scripts[s] === 'string' && scripts[s].trim().length > 0);
    const absent = COMMON.filter((s) => !present.includes(s));
    const detail = `present: ${present.join(', ') || 'none'} · absent: ${absent.join(', ') || 'none'}`;

    // Libraries really ought to have build + test; apps/tools are looser.
    const wantsBuildTest = pkg.packageType === 'library';
    const missingImportant = wantsBuildTest && (!present.includes('build') || !present.includes('test'));

    if (missingImportant) {
      return warn('low', 'Library is missing build and/or test script', { details: detail });
    }
    if (present.length === 0) {
      return warn('low', 'No common scripts defined', { details: detail });
    }
    return pass(`${present.length}/${COMMON.length} common scripts present`, { details: detail });
  },
});
