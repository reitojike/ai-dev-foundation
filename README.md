# ai-dev-foundation

`ai-dev-foundation` keeps normative development rules in one canonical source,
then generates the small provider-facing files a consumer repository needs.

## Layout

- `policy/` defines Foundation-wide normative rules.
- `profiles/` adds technology-specific rules without product-domain rules.
- `templates/` contains the generated-file shells.
- `tooling/` composes and validates consumer adapters.
- `test/fixtures/consumer/` is the minimal reference consumer.

## Consumer contract

A consumer supplies its product-specific rules at:

```text
.ai-dev-foundation/product-rules.md
```

Generate its adapters with:

```text
node tooling/sync.mjs --consumer path/to/consumer
```

Validate them without changing files with:

```text
node tooling/check.mjs --consumer path/to/consumer
```

`check` exits non-zero when either generated file is missing or differs from
the current canonical inputs. Regenerate after changing a policy, profile, or
consumer product rule.

The bundled reference consumer can be exercised with `npm test`.
