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

このcheckerは`next.config.js` / `next.config.mjs` / `next.config.ts`
（Next.js自身のCONFIG_FILES優先順位と同じ順で検索し、複数が共存する場合は
Next.jsが実際に読むfileを検証します）をfilesystemだけで検査し、
comment除去後・brace-depth 1（exportされる config
object直下）に限定した`agentRules: false`（quoted keyを含む）が見つからない
場合（fileが存在しない場合を含む）はnon-zeroで失敗します。`false`は完全な
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

```json
{
  "scripts": {
    "verify:profile": "npm run agent-rules:check && npm run supabase:migrations:check && npm run supabase:types:check && npm run test:rls",
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
