import assert from 'node:assert/strict';
import test from 'node:test';
import { tableName } from '../src/app.ts';

test('consumer tableName returns the configured table', () => {
  assert.equal(tableName(), 'todos');
});
