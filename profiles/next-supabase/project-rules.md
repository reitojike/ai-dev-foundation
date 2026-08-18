# Next.js + Supabase profile

This profile is intentionally limited to technology-level guidance. Product
behavior, domain terminology, and product-specific security decisions belong
in the consumer product rules.

- Keep application code compatible with the consumer's supported Next.js and
  Supabase versions.
- Treat generated Supabase types as the source of truth for database types.
- Put stack-specific deterministic quality checks in this profile or its
  associated tooling, not in Foundation core policy.
