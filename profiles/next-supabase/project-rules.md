# Next.js + Supabase profile

この profile は technology-level guidance に意図的に限定します。product behavior、
domain terminology、product-specific security decision は consumer product rule に置きます。

- application code は consumer が support する Next.js と Supabase の version に
  互換な状態を保ちます。
- generated Supabase types を database type の source of truth として扱います。
- stack-specific deterministic quality check は Foundation core policy ではなく、
  この profile または関連 tooling に置きます。
- quality profile の適用方法とblocking/advisoryの区別は `quality/README.md` を
  正本とします。product-domain rule はそこへ追加しません。
