# Next.js + Supabase quality profile

Foundation checkoutで次を実行すると、profileの設定ファイルをconsumerの
`<consumer>/.ai-dev-foundation/quality/` へ展開します。

```text
node tooling/bootstrap-next-supabase.mjs --consumer <path>
```

展開先のファイルはFoundationが所有します。product-domain ruleは追加しません。

## 配置

quality profileの生成元は`profiles/next-supabase/quality/`です。guardrailのeffective
behaviorを検証するfailure fixtureは`test/fixtures/guardrails/`に置きます。profileの
設定ファイルと検証fixtureは、用途と配置先を分離して管理します。

## 必要な依存関係

consumerは次の開発依存を自らの`package.json`へ追加します。bootstrapは
`package.json`を変更しません。

```text
eslint
typescript-eslint
eslint-config-prettier
prettier
typescript
```

Supabaseを使い、`client-role-privileges:check`（後述）を`verify:profile`から呼び出す
consumerは、これに加えて`pg`を追加します。

## 適用方法

consumerの`tsconfig.json`でstrict TypeScript設定を継承します。

```json
{ "extends": "./.ai-dev-foundation/quality/tsconfig.quality.json" }
```

consumerの`eslint.config.mjs`でquality profileを読み込みます。import boundaryは
consumer自身が、対象パスと禁止方向を定義して追加します。

```js
import {
  architectureImportBoundary,
  nextSupabaseQualityProfile,
} from './.ai-dev-foundation/quality/eslint.config.mjs';

export default [
  ...nextSupabaseQualityProfile(),
  architectureImportBoundary({
    files: ['src/domain/**/*.ts'],
    // Depth-independent, anchored patterns: "../**/ui" (and "/**") matches
    // "../ui", "../../ui", "../ui/x", "../../ui/x", ... regardless of how
    // deep the importing domain file is nested, without also matching an
    // unrelated external package such as "@vendor/ui/button" the way a bare
    // "**/ui/**" pattern would.
    restrictedPatterns: [
      '../**/ui',
      '../**/ui/**',
      '../**/infrastructure',
      '../**/infrastructure/**',
      '@/ui',
      '@/ui/**',
      '@/infrastructure',
      '@/infrastructure/**',
    ],
    message: 'Domain code must not import UI or infrastructure.',
  }),
];
```

`architectureImportBoundary`はdeterministicな強制mechanismだけを提供します。
Foundation profileはlayer構造、対象パス、禁止import方向を定義しません。
guardrail fixture内の`app/features/shared`は、このmechanismを検証する小さな例に
限定され、profileの規約ではありません。

通常の型アサーション（`value as SomeType`、`<SomeType>value`）は禁止します。
一方、literal型を正確に保持する`as const`と、型適合を検査する`satisfies`は許可します。

## Blocking checks

consumerのCIでは次をblocking checkとして実行します。

```text
prettier --config .ai-dev-foundation/quality/prettier.config.mjs --check .
eslint .
tsc --noEmit
```

generated Supabase typesはdatabase typeのsource of truthです。consumerは自らの
project IDと生成先パスを使う`supabase:types`を定義し、それを実行後に生成ファイルの
diffを失敗させる`supabase:types:check`をblocking checkへ追加します。これはdrift/error
検知への入口であり、FoundationはSupabase project設定や生成先を決めません。

`supabase/migrations`内のmigration version prefix重複はDB / Docker / Supabase local
stackを起動する前にfilesystemだけでdeterministicに検知します。consumerは
`.ai-dev-foundation/quality/check-migration-version-collision.mjs`を
`supabase:migrations:check`として実行し、DB/Dockerを起動する他のcheckより前の
blocking checkへ追加します。詳細は「Migration version prefix collision detection」
を参照してください。

`next.config`がNext.js 16.3+の生成AGENTS.md agent rulesを無効化しているかも、DB /
Docker / Supabase local stackを起動する前にfilesystemだけでdeterministicに検知
します。Next.js 16.3以降を使うconsumerは`.ai-dev-foundation/quality/check-agent-rules-disabled.mjs`を
`agent-rules:check`として実行し、blocking checkへ追加します（16.3未満のconsumerは
`agentRules` optionも自動生成挙動も持たないため、このcheckを追加しません）。詳細は
「Next.js agent-rules (generated AGENTS.md) drift prevention」を参照してください。

unit/component testとDB/RLS testはtest runnerを固定しません。consumerで該当testが
存在する場合は、そのcommandをblocking CIへ追加します。

## Migration version prefix collision detection

parallel branch / worktreeでmigrationを追加すると、異なるfilename（例:
`20260822120000_add_feature_a.sql`と`20260822120000_add_feature_b.sql`）が
Git上は競合せず共存できます。しかしSupabaseはfilenameの`_`より前の数字列を
migration versionとして扱うため、これは同一version identityを持つhidden
collisionです。Git text conflictでは検出できず、実際のDB migrationまで
表面化しません。

`check-migration-version-collision.mjs`は`supabase/migrations`をfilesystem
だけで検査し、同一version prefixを持つ異なるfilenameがあればduplicate
versionと該当filenameすべてを診断してnon-zeroで失敗します。local Supabase
runtime、Docker、DB接続のいずれも必要としません。`supabase/migrations`
直下の`<digits>_name.sql`ファイルだけを対象とし、サブディレクトリは
再帰的に走査しません（Supabase CLI自身の`ListLocalMigrations`と同じ
scopeです）。

このcheckerはmigration番号のallocationやreservationを行いません。
collisionを未然に防ぐ機構ではなく、DB / Docker / Supabase local stackを
起動する前に安価に検出するguardrailです。

```text
node .ai-dev-foundation/quality/check-migration-version-collision.mjs
```

## Client-role table privilege guardrail

RLS policyが正しく定義されていても、table-level grantとして`anon` / `authenticated` /
`PUBLIC`に意図しないprivilegeが残ると、RLSだけを検証してもsecurity boundaryが成立し
ません。特に`TRUNCATE`はRLSを完全に迂回するため、RLS testsがgreenでもclient roleが
tableをtruncateできる状態を見逃し得ます（confirmed defect:
`reitojike/stage-tracker#42` / `reitojike/stage-tracker#49`。多くの場合、原因は
schema-wide `ALTER DEFAULT PRIVILEGES`が新規tableへ既定でこれらのprivilegeを
付与することです — migrationがgrantを追加するだけでは、この既存の残存ACLには一切
触れません）。

`check-client-role-table-privileges.mjs`は、actual local/CI PostgreSQL上の`public`
schema全table（動的に列挙、`pg_tables`基準）を対象に、`anon` / `authenticated` /
`PUBLIC`（PostgreSQLのpseudo-role。`has_table_privilege('public', ...)`で判定）が
次のいずれかを保持していないかをdeterministicに検査します。

```text
TRUNCATE
REFERENCES
TRIGGER
MAINTAIN  (PostgreSQL 17+のみ。has_table_privilegeは17未満のserverでは
           "unrecognized privilege type"を送出するため、server_version_num
           で判定しexplicitにskipします — 例外を握りつぶすのではなく、
           checkしたprivilege集合をpositiveに報告します)
```

### Foundation-owned safety boundaryとconsumer-owned permission matrixの境界

このcheckerはSELECT / INSERT / UPDATE / DELETE（table-levelおよびcolumn-level）を
一切検査しません。それらはproduct固有のpermission matrixであり、consumer-ownedの
ままです。上記4つのprivilegeが対象になるのは、PostgREST-styleのclient roleが
意図的なCRUD permission matrixの一部としてこれらを持つ正当な理由が構造的に存在
しないためです。TRUNCATEはRLSを迂回し、REFERENCESはforeign key制約違反エラー経由の
covert channel（PostgreSQL自身のrow security documentationが明記する既知の
制約）になり得ます。TRIGGER/MAINTAINも同様にclient roleに不要な特権です。

evidence上、これら4つのprivilegeについてconsumer側で正当な例外が必要になった実例は
ないため（stage-trackerの現行grant matrixはどのtableにもこれらを一切持ちません）、
本checkerはunconditional denyとして実装され、consumer向けのexception/override機構は
持ちません。将来具体的な必要が生じた場合は、先行してexception機構を用意するのでは
なく、その時点でFoundation ObservationまたはChange Proposalとして扱います。
`service_role`等のadministrative roleはこの検査対象に含めません。

### 使い方

```text
node .ai-dev-foundation/quality/check-client-role-table-privileges.mjs
```

既定では、consumerのDB/RLS testと同じ方法（`supabase status -o json`）でlocal
Supabaseの接続先を自動検出します。実行には稼働中のlocal Supabase stackが必要です
（DB / Docker / Supabase local stackを起動する他のcheckより後に実行します）。
`SUPABASE_DB_URL`を設定すると、この自動検出をbypassして直接その接続先を検査します。

failure診断にはrole / table / privilegeの組が一覧表示され、remediationとして
`revoke all ... from public, anon, authenticated`した上で意図するSELECT/INSERT/
UPDATE/DELETEのみを再grantする例を示します。

## Next.js agent-rules (generated AGENTS.md) drift prevention

`AGENTS.md`はFoundation canonical inputsから生成されるgenerated artifactです
（`tooling/sync.mjs`）。consumer/runtimeが実行時に書き換える対象ではありません。

Next.js 16.3以降の`next dev`は、実行環境内にAI coding agent（`CLAUDECODE`、
`CURSOR_TRACE_ID`、`CODEX_*`、`GEMINI_CLI`等の環境変数で検出）を検出すると、
`next.config`で`agentRules`が明示的に`false`でない限り、生成済みの`AGENTS.md`へ
`<!-- BEGIN:nextjs-agent-rules -->`で始まるmanaged blockをupsertします
（Next.js 16.3.2の`node_modules/next/dist/server/lib/start-server.js`および
`generate-agent-files.js`で確認済み）。これはFoundation-generated `AGENTS.md`への
silent mutationであり、通常の`next dev`実行だけでconsumerのworking treeが
dirtyになります。Next.js 16.3未満はこの自動生成挙動も`agentRules` optionも
持たないため、この節および次のcheckerの対象外です。

`next.config`自体はconsumer-owned application configであり、Foundationは
代わりにこのfileを書き込みません。consumerが`next.config`で明示的に
`agentRules: false`を設定し、そのことを次のcheckerでdeterministicに
担保します。

```text
node .ai-dev-foundation/quality/check-agent-rules-disabled.mjs
```

このcheckerは`next.config.js` / `next.config.mjs` / `next.config.ts`、および
実行中のNode runtimeがnative TypeScript supportを持つ場合
（`process.features.typescript`がtruthyな場合）は`next.config.mts`も対象に
含めます（Next.js自身のCONFIG_FILES優先順位と同じ順で検索し、複数が共存する
場合はNext.jsが実際に読むfileを検証します）。Next.js自身が`.mts`を受理する
条件と同じ条件をcheckerが評価するため、`.cjs`/`.cts`等の他の拡張子（Next.js
自身がconfigとして受理しないため引き続きこのcheckerの対象外）とは異なる
扱いです。これらの候補fileをfilesystemだけで検査し、comment除去後・
brace-depth 1（exportされる config object直下）に限定した`agentRules:
false`（quoted keyを含む）が見つからない場合（fileが存在しない場合を含む）
はnon-zeroで失敗します。`false`は完全な
property valueである場合だけ有効とします（`agentRules: false || true`は
実際にはtrueとして評価されるため無効）。次はfalseとして扱いません:
comment内の記述（`// agentRules: false`）、ネストしたobject内の同名property
（`{ experimental: { agentRules: false } }`）、および完全な値でないもの
（`agentRules: false || true`）。
next dev、network、ブラウザのいずれも必要としません。consumer configを
実行・評価しないtext matchのため、`agentRules`を間接的な変数経由で設定する
config（例: `agentRules: SOME_FLAG`）は検出できません（直接記述された
opt-out だけを対象にした bounded guardrail です。既知の制約はcheckerの
code commentを参照してください）。`{ agentRules: false, ...shared }`の
ようにexplicit propertyの後にspreadがある場合は、実行時にspread側が
上書きし得るため、effective valueを検証不能としてnon-zeroで失敗します
（`{ ...shared, agentRules: false }`のようにspreadが先であれば、後続の
explicit propertyが確実に勝つため引き続き検証できます）。

このcheckerはNext.jsのupstream agent-rules block本文をFoundation canonical
policyへコピーしません。`next.config`の設定有無だけを検証します。

### 二層contract（proactive + reactive）

`agent-rules:check`は、supportされた直接記述の`next.config`形式をfilesystemだけで
deterministicに検証するbounded text matcherです。任意のJavaScript/TypeScript
config semanticsを評価する約束はしません。上記の既知の制約（間接的な変数経由の
設定、string literal内の紛らわしいtext、spread、shorthand/method/accessor形式の
duplicate keyなど）は、parser/tokenizer/generalized config evaluatorへ発展させる
ことでは解消しません。

その代わり、`agent-rules:check`が見逃す exotic な`next.config`形式であっても、
`next dev`が実際に`AGENTS.md`をmutationすれば、既存の`foundation:check`
（`tooling/check.mjs`）がFoundationの合成結果と実file を exact比較し
`Generated adapter drift detected`としてdeterministicに検出し、`tooling/sync.mjs`
によるremediationを提供します。generated adapterのsilent mutationを防ぐ、または
安全なremediationをdeterministically提供するという要件は、`agent-rules:check`
単体ではなく、この proactive blocking layer（`agent-rules:check`）と reactive exact
layer（`foundation:check`）を合わせたsystem levelで満たします。

## `verify` への集約

consumerはrequired checkを通常のnpm scriptsとして固定し、`verify` から順番に実行します。
profile固有の追加は`verify:profile`に置きます。これはextension pointであり、pluginの
登録機構ではありません。consumerがSupabaseを使う場合、`supabase:migrations:check`
（DB / Docker / Supabase local stackを起動する他のcheckより前）に続けて
`supabase:types:check`を`verify:profile`から呼び出し、typesの再生成後に生成ファイルの
driftをnon-zeroで検知するcommandにします。DB/RLS testがあるconsumerは同じ
`verify:profile`からそのtest commandを呼び出します。Next.js 16.3以降を使うconsumerは
同じ`verify:profile`から`agent-rules:check`を呼び出します（16.3未満では対象外のため
呼び出しません。本節冒頭の「該当しないcommandは含めない」原則の具体例です）。
local Supabase stackを起動するconsumerは、同じ`verify:profile`から
`client-role-privileges:check`（DB / Docker / Supabase local stackを起動する他の
checkより後）も呼び出し、残存privilegeの回帰をblockingで検知します。

```json
{
  "scripts": {
    "client-role-privileges:check": "node .ai-dev-foundation/quality/check-client-role-table-privileges.mjs",
    "verify:profile": "npm run agent-rules:check && npm run supabase:migrations:check && npm run supabase:types:check && npm run test:rls && npm run client-role-privileges:check",
    "verify": "npm run format:check && npm run lint && npm run typecheck && npm run test:unit && npm run build && npm run foundation:check && npm run verify:profile"
  }
}
```

上記のうちconsumerに該当しないcommandは`verify:profile`に含めません。空の成功commandを
置かず、必要になった時点で実行可能なcheckとして追加します。

`jscpd`や`knip`などのノイズを含み得るcheckはadvisoryです。blocking quality floorには
含めません。

## Worktree/checkoutをまたぐlocal Supabase stack

複数のcheckout（worktreeを含む）が同一のlocal Supabase runtime / DB stateを
共有する構成と、checkoutごとに完全に分離された構成のどちらもあり得ます。
Foundationは特定のisolation implementationを強制しません。この節は、DB stateに
依存するverificationが何をevidenceとして扱ってよいかを規定します。

### Shared local stack

複数checkoutが同一のlocal Supabase project（同じproject identifier / ports /
containers / volumes等）を共有する場合、そのstackはshared local stackです。
次を**exclusive resource**として扱います。

- `supabase start` / `supabase stop`
- `supabase db reset`
- migration apply / rollback相当のoperation
- DB / RLS / auth integration test
- schema由来のgenerated types生成、およびdrift verification
- `client-role-privileges:check`（client-role table privilege guardrail）
- 上記のいずれかを内包する`verify:profile`
- 上記のいずれかを内包するfull `verify`

shared local stackに対して上記を実行するagentは、少なくとも次を満たします。

1. 上記でexclusive resourceとして列挙したoperation（destructive /
   statefulなDB operationだけでなく、read-only寄りのDB / RLS / auth
   integration testやgenerated types drift verificationを含む）の前に、
   そのstackに対するexclusive ownershipを確認し、そのownershipを
   operation完了まで排他的に維持する。一時点のcheck（time-of-check）
   だけでoperationの実行（time-of-use）中の排他性を保証しない方法は、
   この要件を満たしません。ほぼ同時に開始した複数checkoutが互いを
   「利用中でない」と判定してしまうgapを許容しない方法を用います。
2. 他checkoutが同じstackをactiveに利用中であれば、並行して実行しない。
3. verification対象のcheckout自身のmigration / configから、その
   verification用のclean target stateを作る。
4. 既に起動しているshared stackの現在stateを、それだけを根拠に自checkoutの
   verification evidenceとして扱わない。DB stateがどのcheckoutのmigrationに
   由来するか確認できない場合、そこから得た結果は当該checkoutのverification
   evidenceとして使わない。
5. operationの完了後はownershipをreleaseし、他checkoutがそのstackを利用
   できる状態に戻す。

**exit code 0やCI greenであっても、参照したDB stateがverification対象の
checkout由来でなければ、その結果はverification evidenceとしてinvalidです。**
これはcommandが同時に実行されたかどうかとは独立したfailure modeであり、
逐次実行しただけでは防げません。

exclusive ownershipの確認方法（lockfile、mutex、scheduler、
`pg_stat_activity`の確認、process inspection、runtime固有のlocking等）は
Foundationが特定の実装を指定しません。consumer / runtimeに合った合理的な
mechanismを選びますが、選んだmechanismはitem 1のtime-of-check/time-of-use
gapを許容しないことを満たす必要があります（例えば`pg_stat_activity`や
process inspectionのみを単発の時点確認として使う場合、それ単独では
operation完了までの排他性を保証しないため、lockfile/mutex等の排他制御と
組み合わせるか、そのgapを埋める他の方法を併用します）。

### Isolated local stack

checkoutごとにproject identifier / ports / containers / volume等が十分に
分離され、互いのDB stateを変更できないことが確認できる場合、そのcheckoutは
isolated local stackです。isolated local stackでは上記のexclusive
serializationを要求しません。

local Supabaseを使うconsumerが常にshared local stackである、という前提は
置きません。
