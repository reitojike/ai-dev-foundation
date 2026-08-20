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
