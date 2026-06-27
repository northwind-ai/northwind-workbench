// Declared as ESM ("type": "module") but written as CommonJS — `module` is not
// defined in an ES module scope, so importing this throws ESM_CJS_MISMATCH.
module.exports = { value: 42 };
