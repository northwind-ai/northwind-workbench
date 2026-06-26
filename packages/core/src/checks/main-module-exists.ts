import { join } from 'node:path';
import { defineCheck, fail, pass, skip } from '@package-workbench/plugin-sdk';
import { CheckId } from '../check-ids';

export const mainModuleExists = defineCheck({
  id: CheckId.mainModuleExists,
  label: '"main"/"module" file exists',
  description: 'The CommonJS "main" and ESM "module" targets resolve to real files.',
  severity: 'high',
  weight: 1,

  async run({ package: pkg, host }) {
    const targets: Array<[string, string]> = [];
    if (typeof pkg.manifest.main === 'string') targets.push(['main', pkg.manifest.main]);
    if (typeof pkg.manifest.module === 'string') targets.push(['module', pkg.manifest.module]);

    if (targets.length === 0) return skip('No "main" or "module" field declared');

    const missing = [];
    for (const [field, rel] of targets) {
      if (!(await host.fileExists(join(pkg.root, rel)))) missing.push(`${field}: ${rel}`);
    }
    if (missing.length === 0) return pass(`${targets.length} module target(s) resolve`);
    return fail('high', `${missing.length}/${targets.length} module target(s) missing`, { evidence: missing });
  },
});
