# review-doc skill

このファイルは `policy/core.md` の Review Protocol（Artifact classification の
Normative、Review contracts、Review stopping rules）を使った実行手順です。規範的な
ルールはここで再定義せず、`policy/core.md` を参照します。本 skill と policy が
矛盾する場合は policy が優先します。
Normative artifact の review 手順（`## 手順` と `## 停止条件` の finite flow）の
canonical source は本 skill であり、`policy/core.md` には置きません。

この skill の canonical source は Foundation リポジトリの `policy/core.md` および
`skills/review-doc.md` です。consumer には `.ai-dev-foundation/skills/review-doc.md`
として本ファイルが配布され、`policy/core.md` の規範的なルールは generated `AGENTS.md`
の `## Foundation policy` section として配布されます。以降 `policy/core.md` への
参照は、consumer context ではこの `AGENTS.md` の `## Foundation policy` section を
指します。consumer リポジトリに `policy/core.md` という path が存在することは
前提にしません。

## 対象

Normative artifact（AGENTS / Skill / PRODUCT / ARCHITECTURE / ADR 等、後続 agent や
実装を拘束する文書）の review。

## Formal review と preflight/local 利用の境界（Issue #49）

実装 session 中に Claude Code 本体や subagent を使った critique / self-check /
design sanity check は自由に行ってよく、この skill の対象外です。これらは
Selection Contract で reviewer / capability として selection されたものではなく、
Acquisition & Validity Contract の record も持たないため、required review 数にも
expected review set にも算入しません。selection されていない preflight/local
利用を、事後的に「review を実施した」として required/expected review の消化根拠に
してはいけません。この区別は Claude に限らず、他 provider の local/preflight
利用にも同様に適用します。

利用可能な reviewer、trigger、completion / 非参加 / rate-limit / failure の
marker、fallback order は、consumer-owned な reviewer capability record
（`.ai-dev-foundation/reviewers.json`）が持ちます。record の参照義務、
acquisition routing（preferred route と fallback 時の durable evidence 要件）は
artifact classification に関わらず共通であり、Foundation リポジトリの
`skills/review-code.md`（consumer には
`.ai-dev-foundation/skills/review-code.md` として配布）の「reviewer capability
record」節および「Adapter boundary」節に従います。この skill では重複定義しません。

## 手順

1. **Mechanical check** — その時点の target SHA / range と、その mechanical
   check が対象とした document / artifact scope を必要な精度で記録した
   上で、markdown の形式チェック（lint / format / link 切れ等、repository
   が持つ機械的な check）を実行します。
2. **Selection** — Selection Contract（`policy/core.md`）に従い、target SHA /
   range、target artifact set、reviewer / capability、required review 数、
   および expected review set を確定します。expected review set は自分が
   trigger した reviewer だけでは閉じません。閉じ方と、member とした根拠の
   記録は Selection Contract（`policy/core.md`）に従います。
   **Mixed classification の場合は、required な review skill をすべて宣言します。**
   手順 1 の mechanical check 対象と確定した target の一致、および宣言した routing と
   changed artifact set の整合は、手順 9 の fence が機械判定します。手順の各所で
   手作業の照合を繰り返しません。target が動いたら mechanical check をやり直し、
   記録した check SHA を更新します。
   check evidence がどの artifact scope をカバーしたかは fence の対象外です。
   target artifact set を確定したら、直近の successful mechanical-check evidence が、
   確定した target SHA / range と target artifact set の両方をカバーしているかを
   確認します。selected artifact set をその mechanical check evidence がカバーして
   いると確認できない場合は、確定した target に対して手順 1 の mechanical check を
   再実行してから手順 3（semantic discovery）へ進みます。
   target が動いたときにどう扱うかは、その動いた理由で決まります。手順 3 の semantic
   discovery の completion / validity が確定する前に動いた場合、または手順 6 の accepted
   finding batch fix 以外の理由で target SHA / range または target artifact set が
   変わった場合（並行作業、scope 追加、finding 対応ではない文書変更、無関係な commit
   等）は、旧 review target / run を現在 target の evidence として扱いません。新しい
   target に対して手順 1 の mechanical check を再実行し、Selection をやり直して、
   手順 3 の semantic discovery を新しい target に対して行います。
3. **Execution & Semantic discovery（1 round）** — Execution Contract に従い、
   Selection で確定した target SHA / range と target artifact set を
   reviewer の trigger へ渡して起動します。trigger 方法、実際に渡した
   target と artifact set、required context を記録した上で、独立
   reviewer による意味的な discovery を 1 回行います。round 数の扱いは
   Artifact classification / Review stopping rules（`policy/core.md`）に従います。
4. **Acquisition & Validity 確認** — Acquisition & Validity Contract
   （`policy/core.md`）に従い、target SHA / range、target artifact set、
   completion、acquisition、validity を確認します。
   Selection Contract で required とした review 数ぶんの `validity: valid`
   な run が揃うまで triage へ進みません。
   揃わない run（invalid / unknown / failure）の扱いは Failure / retry
   （`policy/core.md`）に従います。
   required 数の valid run が揃うことは triage へ進むための gate ですが、
   finding の集約対象は valid な run に限りません。ancestor target に対する run の
   ように `validity: valid` でない run であっても、そこで既に発見された finding は
   Resolution Contract（`policy/core.md`）の対象です。`validity` は evidence 軸の
   判定であり、finding を捨ててよい根拠ではありません。
   run record の `status` / `validity` とは別に、各 reviewer の target completion
   state を判定します。positive completion evidence の target-bound 要件、binding へ
   使う field / surface の安定性要件、および binding が成立しない場合の扱いは、
   いずれも Acquisition & Validity Contract（`policy/core.md`）が定めます。
   この skill で行う実務は、どの surface item を positive completion evidence とし、
   どの field / surface を安定と判断して binding の根拠にしたかを記録することです。
   **あわせて、triage の対象にする result の `canonical_id` と
   `evidence[].revision.body_digest` を記録します。** review result は in-place で編集
   され得るため、この revision は手順 9 の fence が current revision と照合します。
   GitHub 上の durable review surface の取得は、Foundation リポジトリの
   `skills/review-code.md`（consumer には
   `.ai-dev-foundation/skills/review-code.md` として配布）の Adapter
   boundary（`collectOutputs()`）に従います。
5. **Triage** — 出た finding を Resolution Contract のカテゴリ（fix /
   false-positive / needs-verification / technical-dispute / intent-question）へ
   仕分けます。
6. **Fix** — Resolution Contract に従い、accepted finding を batch でまとめて
   fix します。
7. **Closure** — accepted finding の fix によって target SHA / range または
   target artifact set が変わった場合のみ行います。修正後の target に
   対して手順 1 の mechanical check を再実行し、成功したらその SHA / range を
   closure target として re-freeze し、Selection Contract（`policy/core.md`）を
   この closure review run に適用します。
   確定した closure artifact set を、直近の mechanical-check evidence が
   カバーしていることを確認します。確認できない場合は、確定した closure target に
   対して mechanical check を再実行してから、Execution Contract（`policy/core.md`）を
   closure review run に適用します。
   その上で、triage した finding に対応しているかの closure verification
   のみを行い、full な再 discovery はしません。
   closure verification 自体の completion / acquisition / validity も、
   この closure target を expected target として Acquisition & Validity
   Contract に従って確認します。
   closure 用 Selection Contract で required とした review 数ぶんの valid
   な closure run が揃うまで Closure Resolution へ進みません。不足する
   run の扱いは Failure / retry（`policy/core.md`）に従います。
   accepted finding の fix が無く target SHA / range も target artifact
   set も変更されていない場合（例えば 0 findings の場合や、finding を
   false-positive 等として Resolution した場合）は、required review 数の
   valid semantic discovery と Resolution が完了した時点で review
   procedure を完了とし、新たな closure run を要求しません。
8. **Closure Resolution** — closure verification（手順 7）の finding を
   Resolution Contract（`policy/core.md`）に従って triage します。
   unresolved の finding がある間は review procedure を完了としません。
   accepted な closure finding があれば、手順 6〜7 と同じ procedure（fix ->
   mechanical check -> closure verification -> closure Acquisition &
   Validity）に従って解決します。
   closure Resolution に加えて、手順 5 の semantic discovery Resolution
   も完了していることが review procedure 完了の条件です。完了順序は
   問いません。
   この cycle が繰り返し発生する場合は、本 skill の停止条件および Review
   stopping rules（`policy/core.md`）に従います。
   手順 7 の closure が行われなかった場合（accepted fix が無く target
   SHA / range も target artifact set も変更されていない場合）、この
   手順は不要です。
9. **Merge-ready fence** — この review 対象を含む変更について merge-ready を
   宣言する場合は、宣言の直前の最後の action として merge-ready fence を実行します。

   ```text
   node tooling/merge-ready-fence.mjs --repo <owner/repo> --pr <number> \
     --target-sha <frozen target> --base-sha <frozen base> \
     --artifacts-file <frozen artifact set> --verify-sha <手順 1 の check SHA> \
     --required <reviewer-id> --declared-skill review-doc \
     --acknowledged-file <手順 4 で記録した canonical_id=body_digest>
   ```

   Mixed classification の target では、`--declared-skill` に該当する skill を
   すべて渡します。`pass`（exit 0）の場合にのみ merge-ready を宣言できます。
   `fail`（exit 1）と `unknown`（exit 2）はどちらも merge-ready ではありません。
   merge-ready の成立条件と、review-relevant な state 変化による fence の無効化は
   `policy/core.md` の Merge-ready completion fence に従います。

## 停止条件

同種の finding が複数の文書や round にまたがって繰り返し出る場合は、review loop
を増やすのではなく、上流の policy / document 自体に defect がある兆候として扱い、
escalate します。round 数の扱いは Review stopping rules（`policy/core.md`）に
従います。

Normative artifact の review flow を、`policy/core.md` の Review stopping rules が
定める stopping semantics（evidence の target 束縛、round / cycle の上限と escalate
判断）を評価する分岐として表現した finite flow です。`## 手順` の各 step と同じ
手続きを分岐構造として示したものであり、規範的なルール自体は `policy/core.md` が
持ちます。

```text
mechanical check
  -> semantic discovery（1 round）
  -> triage / fix
  -> accepted finding の fix で review target が変更された場合:
       mechanical check
       -> closure target の Selection / Execution
       -> closure verification
       -> closure completion / acquisition / validity 確認
       -> closure finding の Resolution
       -> semantic discovery の Resolution 完了
       -> merge-ready fence（merge-ready を宣言する場合）
       -> 完了
  -> accepted fix が無く review target が変更されていない場合:
       required review 数の valid semantic discovery と Resolution の完了
       -> 完了
```
