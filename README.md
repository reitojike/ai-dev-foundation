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

consumer は product-specific rule と reviewer capability record を次のパスに置きます。
どちらも consumer-owned であり、Foundation は生成・上書きしません。

```text
.ai-dev-foundation/product-rules.md
.ai-dev-foundation/reviewers.json
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

`check` は最後に、`policy/core.md`・`skills/*.md`・生成した `AGENTS.md` の byte 数を
advisory として標準出力へ出します。threshold は持たず、exit code にも影響しません。

同梱の reference consumer は `npm test` で検証できます。

## Reviewer capability record

`.ai-dev-foundation/reviewers.json` は、その repository で利用できる reviewer に関する
運用知識を機械可読にした consumer-owned な record です。Kernel（`policy/core.md` の
Selection Contract）は record の存在と Selection 時の参照を要求し、schema と check は
Foundation tooling（`tooling/reviewer-record-lib.mjs`、`tooling/check.mjs`）が持ちます。
provider 名は record の中にのみ現れます。

example を写して編集してください。この file は `sync` / `bootstrap` で自動配布されません。

```text
cp templates/reviewers.example.json <consumer>/.ai-dev-foundation/reviewers.json
```

reviewer ごとに表現するもの:

| field                                                                                    | 用途                                                                                                            |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `id` / `display_name` / `provider_family`                                                | 識別と、implementer と異なる family を選ぶための比較軸                                                          |
| `default_class`                                                                          | `required` / `expected` / `advisory`。portfolio 上の default であり Task 固有の obligation ではない             |
| `actors`                                                                                 | この reviewer が投稿する login。surface item の帰属に使う                                                       |
| `trigger`                                                                                | `kind` と、`comment_command` なら投稿する literal command。`target_argument` は `{target_sha}` を結果へ持ち込む |
| `completion_marker`                                                                      | `completed@target` と判定してよい positive evidence の文字列（**必須**）                                        |
| `non_participation_marker` / `rate_limit_marker` / `failure_marker` / `in_flight_marker` | `declined` / rate limit / `failed` / in-flight の evidence（いずれも省略可）                                    |
| `fallback_order`                                                                         | この reviewer が使えない場合に次に選ぶ reviewer の id                                                           |
| `observed_at`                                                                            | marker を最後に実測した日付。marker は observed evidence であり恒久仕様ではない                                 |

top-level には `required_selection`（required slot の数と埋め方、必須）と
`durable_record`（Selection / run / fence record の投稿形式）を置きます。後者は schema が
`new-comment-per-stage`（stage ごとに新規 comment を投稿し、最新を正とする）だけを
supported value としており、1 comment の in-place 編集は採用しません。

**record は「結果がどの surface に出るか」を宣言しません。** それは provider の応答形式の
決め打ちであり、`policy/core.md` の Review Adapter boundary が禁じる negative claim
（「この provider はこの surface に出ない」）そのものです。したがって `result_surfaces`、
marker の `surfaces`、marker の `target_field` はいずれも schema が reject します。

marker は agent が読みます。GitHub 上の surface を fresh 取得し、record が宣言した
marker と突き合わせて、その reviewer が freeze した target について完了しているかを
判定するのは agent の作業です。この判定を helper で機械化することは Phase 1 の範囲外
です（Issue #72 Phase 1b）。REST と GraphQL が同じ GitHub object を別表現で返すため、
機械化には surface を跨いだ canonical identity model が必要であり、Phase 1 はそれを
定義しません。

`check` は record の存在 / parse / 最小妥当性を検証し、いずれかを満たさない場合は
non-zero で終了します。record の内容（どの reviewer を required にするか等）は
consumer-owned のままです。

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

review completion / target Validity / finding triage / Resolution 等の
判定材料として使う fresh acquisition（formal acquisition）では `--json`
を使ってください。`--json` 無しの human-readable summary は surface ごとの
count と fetch state のみを表示し、判定に必要な actor / body / locator 等の
item detail を含みません。

**現在の coverage の既知の限界**（呼び出し側は、この範囲外の evidence が
必要な場合、Review Adapter boundary に従って追加で fresh acquisition する
必要があります）:

- `commit_status` / `check_runs` は、この snapshot が取得した時点の PR
  head（`pr_metadata.head_sha`）のみを対象とします。reviewer が ancestor
  SHA の status/check にのみ review participation や finding を残していた
  場合、そのevidenceはこの snapshot に含まれません。
- `check_runs` は GitHub API の既定 filter（`latest`）で取得するため、
  同一 check が再実行されている場合、最新 run 以外は snapshot に含まれ
  ません。また `name` / `status` / `conclusion` / `started_at` /
  `completed_at` / `locator`（`html_url`）のみを保持し、check run 本体の
  `output.summary` / `output.text` や line-level annotation、投稿元 App の
  識別情報は取得しません。
- `commit_status` は GitHub の combined-status endpoint（`context` ごとの
  最新 status のみを返す）を使います。同一 `(headSha, context)` に対して
  reviewer が finding を含む status を投稿した後、同じ context が別の
  status で上書きされた場合、その以前の status はこの snapshot から
  復元できません。この場合も `fetch_status` は `fetched`（成功）を報告する
  ため、`fetch_status` の値だけではこの欠落を検知できません。`commit_status`
  も投稿者（`creator`）を保持しません。

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
