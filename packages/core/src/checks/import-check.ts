import { defineCheck, skip } from '@package-workbench/plugin-sdk';
import { CheckId } from '../check-ids';

/**
 * Placeholder. Actually importing the package means executing its code, which
 * needs an isolated process and installed dependencies — that arrives in a later
 * prompt. For now this is explicitly skipped with a clear reason so it shows up
 * in the UI as "pending" rather than silently missing.
 */
export const importCheck = defineCheck({
  id: CheckId.import,
  label: 'Module can be imported',
  description: 'Executes the package entry to confirm it loads. Not yet implemented.',
  severity: 'high',
  weight: 2,

  async run() {
    return skip('Runtime import execution will be added in a later prompt.');
  },
});
