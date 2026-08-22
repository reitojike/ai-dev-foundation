# Next.js + Supabase profile

この profile は technology-level guidance に意図的に限定します。product behavior、
domain terminology、product-specific security decision は consumer product rule に置きます。

- application code は consumer が support する Next.js と Supabase の version に
  互換な状態を保ちます。
- generated Supabase types を database type の source of truth として扱います。
- stack-specific deterministic quality check は Foundation core policy ではなく、
  この profile または関連 tooling に置きます。
- Foundation-generated `AGENTS.md` は generated artifact であり、Next.js
  runtime が書き換える対象ではありません。Next.js 16.3 以降を使う consumer は
  `next.config` で `agentRules: false` を設定し、`next dev` による generated
  `AGENTS.md` への silent mutation を防ぎます（16.3 未満は該当する自動生成
  挙動も `agentRules` option も持たないため対象外です）。`next.config` 自体は
  consumer-owned であり、Foundation はこの設定を代わりに書き込みません。
  deterministic な検証方法は consumer の `.ai-dev-foundation/quality/README.md`
  （Foundation リポジトリでは `profiles/next-supabase/quality/README.md`）を
  参照してください。
- quality profile の適用方法とblocking/advisoryの区別は consumer の
  `.ai-dev-foundation/quality/README.md`（Foundation リポジトリでは
  `profiles/next-supabase/quality/README.md`）を正本とします。product-domain
  rule はそこへ追加しません。
