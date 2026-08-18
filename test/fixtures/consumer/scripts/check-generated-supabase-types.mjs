import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const schema = JSON.parse(await readFile('supabase/schema.json', 'utf8'));
const types = await readFile('src/database.types.ts', 'utf8');

assert.match(types, new RegExp(`\\b${schema.table}:`));
assert.match(types, /Generated from supabase\/schema\.json/);
