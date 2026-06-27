// Boundary rules + CI policy for the broken demo workspace.
export default {
  boundaries: [{ from: '@broken/core', cannotDependOn: ['@broken/ui'], description: 'core must not depend on ui' }],
  ci: { maxScoreDrop: 5, failOnNewCycle: true, failOnCritical: true },
};
