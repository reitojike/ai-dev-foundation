# Fixture: missing next.config

This fixture directory intentionally ships no `next.config.{ts,js,mjs}`, so
`check-agent-rules-disabled.mjs` must fail with a missing-config diagnostic
rather than silently passing.
