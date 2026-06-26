// Runtime smoke scenario picked up by the `smoke` validator.
// Import the package for real and assert it actually works.
import { add, greet } from './index.js';
import assert from 'node:assert/strict';

assert.equal(add(2, 3), 5);
assert.equal(greet('Workbench'), 'Hello, Workbench!');

console.log('good-lib smoke scenario OK');
