export default {
  boundaries: [
    { from: '@v/core', cannotDependOn: ['@v/ui'], severity: 'high', description: 'core must not depend on ui' },
  ],
};
