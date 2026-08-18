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
    restrictedPatterns: ['../ui/**', '../infrastructure/**'],
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

`jscpd`や`knip`などのノイズを含み得るcheckはadvisoryです。blocking quality floorには
含めません。
