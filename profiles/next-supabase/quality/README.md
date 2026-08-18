# Next.js + Supabase quality profile

Run `node tooling/bootstrap-next-supabase.mjs --consumer <path>` from the
Foundation checkout. It copies these files to
`<consumer>/.ai-dev-foundation/quality/`; the copied files are owned by
Foundation and must not contain product-domain rules.

In the consumer, extend the strict TypeScript options:

```json
{ "extends": "./.ai-dev-foundation/quality/tsconfig.quality.json" }
```

Create `eslint.config.mjs` in the consumer:

```js
import {
  architectureImportBoundary,
  nextSupabaseQualityProfile,
} from './.ai-dev-foundation/quality/eslint.config.mjs';

export default [
  ...nextSupabaseQualityProfile(),
  // Consumer-owned example: choose paths and directions for this product.
  architectureImportBoundary({
    files: ['src/domain/**/*.ts'],
    restrictedPatterns: ['../ui/**', '../infrastructure/**'],
    message: 'Domain code must not import UI or infrastructure.',
  }),
];
```

Run blocking checks in CI:

```text
prettier --config .ai-dev-foundation/quality/prettier.config.mjs --check .
eslint .
tsc --noEmit
```

The profile provides `architectureImportBoundary` as a deterministic import
boundary mechanism, but defines no default layers or import directions. The
consumer owns its architecture and supplies the paths and prohibited import
patterns. The guardrail fixture uses `app/features/shared` solely as a small
example for testing this mechanism; it is not a profile convention.

Supabase generated database types remain the source of truth. The consumer must
define a `supabase:types` script with its own project ID and generated-file
path, then add a blocking `supabase:types:check` step which runs that script
and fails on a diff of that generated file. This is deliberately an entry point,
not a profile-owned Supabase project decision. Run the blocking checks afterward;
generated-type drift must fail at generation or type-check time, never be
accepted as an unknown result.

Unit/component and DB/RLS tests are intentionally test-runner agnostic. Add
their commands to the consumer's blocking CI whenever those tests exist.

Checks such as `jscpd` and `knip` are advisory: run them separately and do not
make their current output part of this profile's blocking contract.
