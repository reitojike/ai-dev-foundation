# ai-dev-foundation

`ai-dev-foundation` は、規範的な開発ルールを一つの正本で管理し、
consumer repository が必要とする provider 向けの小さなファイルを生成します。

## 構成

- `policy/` は Foundation 全体に適用する規範的なルールを定義します。
- `skills/` は policy を使った作業手順を保持し、規範的なルールを複製しません。
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

`sync` は同時に、Foundation-owned skill bundle（`skills/`）を consumer の
`.ai-dev-foundation/skills/` へ exact-match で展開します。これは quality profile の
`bootstrap-next-supabase.mjs` と異なり、独立した追加コマンドを必要としません。
consumer が通常実行する `sync` から漏れなく展開されるため、repin 後に skill bundle
だけ古いまま残る経路はありません。`check` はこの skill bundle の drift（missing /
content mismatch / stale extra、nested subdirectory を含む）も検証し、drift があれば
non-zero で終了して `node tooling/sync.mjs --consumer <path>` による再展開を促します。
`.ai-dev-foundation/skills/` は Foundation-owned な path であり、consumer は編集しません。
consumer 自身の guidance / skill は、この path および `.ai-dev-foundation/quality/`
の外側の別 namespace に置きます。Foundation の sync / check / bootstrap は、この
2 つの exact-match directory 以外の `.ai-dev-foundation/` 配下を読み書き・削除しません。

`check` は、bootstrap 済みの `.ai-dev-foundation/quality/` が、参照している
Foundation checkout の `profiles/next-supabase/quality/` と一致しているかも
検証します。file の missing / extra / content mismatch のいずれかがあれば
non-zero で終了し、`node tooling/bootstrap-next-supabase.mjs --consumer <path>`
による再展開を促します。Foundation を repin しても quality profile の再展開を
忘れると、この quality profile の drift 検知だけが non-zero になります。

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

## Review evidence helper

`tooling/review-evidence.mjs` は、指定した GitHub PR について durable review
surface（PR metadata / head SHA、Conversation comments、review submissions、
inline review comments、review thread の resolved/unresolved 状態、combined
commit status、check runs）を fresh に取得し、pagination を完了した上で
human-readable summary または `--json` machine-readable output を返す
snapshot tool です。

```text
node tooling/review-evidence.mjs --repo <owner/repo> --pr <number> [--json]
```

GitHub token は `--token`、`GH_TOKEN`、`GITHUB_TOKEN`、`gh auth token` の順で
解決します。surface ごとに `fetch_status`（`fetched` / `partial` / `failed` /
`not_applicable`）と count を独立に報告し、あるsurfaceのfetch failureを他
surfaceの `0` へ変換しません。paginationが途中で失敗した場合は `partial`
として明示し、取得できたitemsはpartialなcountのまま返します。

この helper は GitHub durable surface の mechanical acquisition に限定され、
review completion / target Validity / finding triage / merge-readiness の
判定は行いません。それらは `policy/core.md` の Review Protocol と
`skills/review-code.md` / `skills/review-doc.md` が引き続き所有します
（Issue #62）。

## Next.js + Supabase quality profile

consumerへprofileを展開するには、Foundation checkoutから次を実行します。

```text
node tooling/bootstrap-next-supabase.mjs --consumer path/to/consumer
```

展開後の設定方法とblocking/advisory checksは
`profiles/next-supabase/quality/README.md` を参照してください。Foundation自身の
failure fixtureは `npm run test:guardrails`（または `npm test`）で一括検証します。
