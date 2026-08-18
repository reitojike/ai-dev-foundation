# ai-dev-foundation

`ai-dev-foundation` は、規範的な開発ルールを一つの正本で管理し、
consumer repository が必要とする provider 向けの小さなファイルを生成します。

## 構成

- `policy/` は Foundation 全体に適用する規範的なルールを定義します。
- `profiles/` は product-domain rule を含めず、技術固有のルールを追加します。
- `templates/` は生成ファイルの雛形を保持します。
- `tooling/` は consumer adapter の合成と検証を担います。
- `test/fixtures/consumer/` は最小の reference consumer です。
- `profiles/next-supabase/quality/` は Next.js + Supabase のblocking quality profileを保持します。
- `test/fixtures/guardrails/` はprofileのeffective behaviorを確認するguardrail fixtureを保持します。

## Consumer contract

consumer は product-specific rule を次のパスに置きます。

```text
.ai-dev-foundation/product-rules.md
```

adapter を生成するには、次を実行します。

```text
node tooling/sync.mjs --consumer path/to/consumer
```

ファイルを変更せずに検証するには、次を実行します。

```text
node tooling/check.mjs --consumer path/to/consumer
```

生成ファイルが存在しない、または現在の canonical input と異なる場合、`check`
は non-zero で終了します。policy、profile、consumer product rule を変更した後は
再生成してください。

同梱の reference consumer は `npm test` で検証できます。

consumer fixture自身の一括verifyは次で実行できます。
実行にはNode.js 22.6.0以上が必要です。

```text
cd test/fixtures/consumer
npm run verify
```

fixtureの`supabase/schema.json`はoffline検証用のsource of truthであり、そこから期待する
`database.types.ts`を決定的に比較します。これはproduction Supabase接続を模倣するものでは
ありません。実consumerでは実際のSupabase schemaからtypesを生成し、その生成結果のdriftを
blocking checkで検知します。

## Next.js + Supabase quality profile

consumerへprofileを展開するには、Foundation checkoutから次を実行します。

```text
node tooling/bootstrap-next-supabase.mjs --consumer path/to/consumer
```

展開後の設定方法とblocking/advisory checksは
`profiles/next-supabase/quality/README.md` を参照してください。Foundation自身の
failure fixtureは `npm run test:guardrails`（または `npm test`）で一括検証します。
