import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const schema = JSON.parse(await readFile('supabase/schema.json', 'utf8'));
const types = await readFile('src/database.types.ts', 'utf8');

const fields = Object.entries(schema.row)
  .map(([name, type]) => `          ${name}: ${type};`)
  .join('\n');
const expected = `// Generated from supabase/schema.json. Do not edit.
export type Database = {
  public: {
    Tables: {
      ${schema.table}: {
        Row: {
${fields}
        };
      };
    };
  };
};
`;

assert.equal(types, expected, 'Generated Supabase types drifted from supabase/schema.json.');
