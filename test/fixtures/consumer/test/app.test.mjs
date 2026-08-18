import assert from 'node:assert/strict';
import test from 'node:test';

test('consumer fixture has a unit-test command', () => {
  assert.equal('todos'.startsWith('todo'), true);
});
