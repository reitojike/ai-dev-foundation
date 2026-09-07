# task-closure skill

このファイルは `policy/core.md` の Issue closure and Acceptance Criteria
completion protocol を使った Task closure 手順です。`policy/core.md` が保持する
minimum safety boundary（Task Contract completion と merge-readiness の分離、
evidence 不足・未達・判断不能な Acceptance Criteria がある場合の no-check /
no-close、Acceptance Criteria が存在しない Issue へ close のために新たな
Acceptance Criteria を捏造しないこと、Issue close execution authority の分離、
auto-close keyword による標準 close の禁止）はここで再定義せず、`policy/core.md`
を参照します。本 skill と policy が矛盾する場合は policy が優先します。

5-step closure procedure の detail、推奨する sequence、close authority が無い
場合の completion-comment / handoff procedure detail、および closure-specific
no-new-machinery detail の canonical source は本 skill であり、`policy/core.md`
には置きません。

## いつ load するか

`policy/core.md` の Issue closure and Acceptance Criteria completion protocol に
従い、canonical Issue を completed として close しようとする場合、または close
手順の適用要否が判断つかない場合は本 skill を **MUST load** します。判断がつかない
場合を「適用不要」と解釈して silent skip してはいけません。

この skill の canonical source は Foundation リポジトリの `policy/core.md` および
`skills/task-closure.md` です。consumer には
`.ai-dev-foundation/skills/task-closure.md` として本ファイルが配布され、
`policy/core.md` の規範的なルールは generated `AGENTS.md` の `## Foundation
policy` section として配布されます。以降 `policy/core.md` への参照は、consumer
context ではこの `AGENTS.md` の `## Foundation policy` section を指します。
consumer リポジトリに `policy/core.md` という path が存在することは前提にしません。

## Closure procedure

canonical Issue を completed として close する前に、少なくとも次を行います。

1. **canonical context の再取得** — close しようとする session 自身の記憶や過去の
   長文 handoff をそのまま正としてはいけません。close 直前に、current Issue 本文
   （canonical Task Contract）と、merge 済み current main または applicable branch
   の状態を再取得します。
2. **Acceptance Criteria evidence 照合** — Acceptance Criteria を 1 項目ずつ、
   実装・test・PR・review・merge 後の状態等の evidence と個別に照合します。「実装が
   完了したように見える」という印象だけでは充足の根拠にしません。
3. **checkbox 更新** — evidence で明確に充足を確認できた項目だけ checkbox を更新
   します。checkbox 更新は見た目上の cleanup ではなく、Task Contract completion
   evidence の一部として扱います。
4. **未達・判断不能な項目の扱い** — evidence 不足または未達で判断できない
   Acceptance Criteria が 1 件でも残る場合に check/close しないこと、および
   Acceptance Criteria が存在しない Issue へ close のために新たな Acceptance
   Criteria を捏造しないことは `policy/core.md` の minimum safety boundary です。
   本 skill では複製しません。判断できない理由が明確な場合は、その理由を手順 5 の
   completion comment に記録します。
5. **completion comment** — final SHA、verification 結果、review evidence
   （Review Protocol の Acquisition & Validity Contract に従う record / result
   locator を含む）、および未解決事項を、Issue 上の completion comment として
   記録します。

推奨する sequence は次のとおりです。

`merge/current main 確認 -> Acceptance Criteria evidence 照合 -> checkbox 更新 ->
completion comment -> Issue close`

## Close authority が無い場合

Issue close の execution authority separation、および authority が無い場合に
close を実行しないことは `policy/core.md` の minimum safety boundary です。本
skill では複製しません。

authority が明示されていない場合、または別 authority の承認が必要な場合、agent は
Issue 本文の編集や close を実行せず、どの Acceptance Criteria がどの evidence で
満たされているか（または未達か）を、手順 5 の completion comment として明示的に
残した上で停止し、authority escalation / handoff します。

## No new machinery

この protocol は、GitHub Issue checkbox 専用 bot、generalized project-management
workflow engine、または新しい orchestrator を要求しません。

auto-close keyword（例: PR 本文の "Closes #N"）によって Acceptance Criteria 確認前
に Issue が自動 close される運用を標準運用にしないことは `policy/core.md` の
minimum safety boundary です。本 skill では複製しません。
