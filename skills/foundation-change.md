# foundation-change skill

このファイルは `policy/core.md` の Foundation Change Protocol を使った
classification / recording / proposal 手順です。`policy/core.md` が保持する
minimum safety boundary（Observation trigger 5 条件、Observation は自動的に
Foundation Issue や work item にならないこと、Task closure と Observation の
fail-closed hook、Foundation Change の正当化 3 条件、単発の friction / style /
prompt nicety / 効率改善のみで mandatory 化しないこと、ledger / dashboard /
自動 Issue 生成等の mandatory 化の禁止）はここで再定義せず、`policy/core.md`
を参照します。本 skill と policy が矛盾する場合は policy が優先します。

Observation classification の 4 分類、Observation recording の procedure・
field、Change Proposal が表現すべき field 定義、および Observation から
Change Proposal への昇格 signal の detail の canonical source は本 skill
であり、`policy/core.md` には置きません。

## いつ load するか

`policy/core.md` の Foundation Change Protocol に従い、Task 実行中に
Observation trigger が発火した場合、または発火したかどうか判断がつかない
場合は本 skill を **MUST load** します。判断がつかない場合を「trigger
なし」と解釈して silent skip してはいけません。

この skill の canonical source は Foundation リポジトリの `policy/core.md`
および `skills/foundation-change.md` です。consumer には
`.ai-dev-foundation/skills/foundation-change.md` として本ファイルが配布され、
`policy/core.md` の規範的なルールは generated `AGENTS.md` の `## Foundation
policy` section として配布されます。以降 `policy/core.md` への参照は、
consumer context ではこの `AGENTS.md` の `## Foundation policy` section を
指します。consumer リポジトリに `policy/core.md` という path が存在することは
前提にしません。

## Observation classification

Observation trigger が発火したら、症状の重大度ではなく root cause /
ownership を軸に、次の 4 分類のいずれかへ分類します。

- `consumer-local`: product / domain / consumer 固有で自然に閉じる
- `provider/runtime`: 外部 provider / runtime の挙動で、Foundation
  contract 自体の欠陥ではない
- `Foundation candidate`: shared problem / improvement candidate に
  なり得るが、Foundation-owned な rule / profile / tooling / artifact
  自体が誤った挙動を要求・生成・許容していると確認されたわけではない
  （Foundation-owned だと分かっていても、確認された defect ではない
  改善余地を含む）
- `canonical defect candidate`: Foundation-owned な rule / profile /
  tooling / artifact 自体が誤った挙動を要求・生成・許容していると
  確認できる場合に限る（正しく機能している manual step を自動化・
  簡略化できるという改善余地だけでは、この分類に含めない）

`provider/runtime` に分類した Observation でも、Foundation がその挙動を
誤って恒久前提として固定している場合は、Foundation 側の candidate として
再評価します。

## Observation recording

Observation が自動的に Foundation Issue や work item にならないこと、および
専用の ledger / dashboard 等の mandatory 化を Observation handling の一部に
しないことは `policy/core.md` の minimum safety boundary です。本 skill では
複製しません。

将来の Foundation 判断へ再利用する価値がある場合、発生した consumer Task
の canonical Issue へ、少なくとも次を短く記録します。

- Observed / evidence locator
- Classification
- Impact
- Local handling
- Foundation action: `none` / `observe` / `change proposal candidate`
- Promotion signal（何が起きれば再評価するか）

consumer-local で完結し、将来参照価値もない軽微な事象は、この記録義務の
対象にしません。

Task closure との関係、および記録義務の対象にしない軽微な事象でも
classification の完了は省略しないという fail-closed hook は
`policy/core.md` の Task closure と Observation に従います。本 skill では
複製しません。

## Change Proposal

Change Proposal は、少なくとも次を表現できるものとします。

- Problem
- Evidence
- Proposed Change
- Expected Effect
- Trade-off
- Scope
- Success Criterion

Change Proposal の accept 可否は `policy/core.md` の Foundation Change の
正当化条件（3 条件）に従います。本 skill はこの 3 条件を複製しません。

## Observation から Change Proposal への昇格

Observation classification は、`policy/core.md` の 3 つの Foundation
Change 正当化条件を置き換えず、緩和しません。特に次は強い promotion
signal になり得ます。

- Foundation 自身の material defect が実証された
- material defect を deterministically 防止できる
- 同一 root cause が recurring / escaped failure になった
- correctness のための mandatory manual ritual が定着した
- consumer-local workaround では canonical semantics の fork が必要に
  なる

change class や review 強度を固定の provider 名へ結びつけないこと、および
単発の friction、style、prompt nicety、効率改善のみを理由に自動的に
mandatory 化しないことは `policy/core.md` の minimum safety boundary です。
本 skill では複製しません。
