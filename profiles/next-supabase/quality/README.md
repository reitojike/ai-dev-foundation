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

unit/component testとDB/RLS testはtest runnerを固定しません。consumerで該当testが
存在する場合は、そのcommandをblocking CIへ追加します。

## `verify` への集約

consumerはrequired checkを通常のnpm scriptsとして固定し、`verify` から順番に実行します。
profile固有の追加は`verify:profile`に置きます。これはextension pointであり、pluginの
登録機構ではありません。consumerがSupabaseを使う場合、`supabase:types:check`は
`verify:profile`から呼び出し、typesの再生成後に生成ファイルのdriftをnon-zeroで検知する
commandにします。DB/RLS testがあるconsumerは同じ`verify:profile`からそのtest commandを
呼び出します。

```json
{
  "scripts": {
    "verify:profile": "npm run supabase:types:check && npm run test:rls",
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

1. destructive / statefulなDB operationの前に、そのstackに対するexclusive
   ownershipを合理的な方法で確認する。
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
mechanismを選びます。

### Isolated local stack

checkoutごとにproject identifier / ports / containers / volume等が十分に
分離され、互いのDB stateを変更できないことが確認できる場合、そのcheckoutは
isolated local stackです。isolated local stackでは上記のexclusive
serializationを要求しません。

local Supabaseを使うconsumerが常にshared local stackである、という前提は
置きません。
