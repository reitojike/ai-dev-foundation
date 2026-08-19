# review-doc skill

このファイルは `policy/core.md` の Review Protocol（Artifact classification の
Normative、Review contracts、Review stopping rules）を使った実行手順です。規範的な
ルールはここで再定義せず、`policy/core.md` を参照します。本 skill と policy が
矛盾する場合は policy が優先します。

## 対象

Normative artifact（AGENTS / Skill / PRODUCT / ARCHITECTURE / ADR 等、後続 agent や
実装を拘束する文書）の review。

## 手順

1. **Mechanical check** — markdown の形式チェック（lint / format / link 切れ等、
   repository が持つ機械的な check）を実行します。
2. **Selection** — Selection Contract（`policy/core.md`）に従い、target SHA /
   range、target artifact set、reviewer / capability、required review 数を
   確定します。
   valid な semantic discovery（手順 3）の後、手順 6 の accepted finding
   batch fix 以外の理由で target SHA / range が変わった場合（並行作業や
   scope 追加、finding 対応ではない文書変更、無関係な commit 等）は、
   旧 review target / run を現在 target の evidence として扱いません。
   新しい target に対して手順 1 の mechanical check を再実行し、成功したら
   re-freeze して手順 2（Selection）からやり直し、手順 3 の semantic
   discovery を新しい target に対して行います。
3. **Execution & Semantic discovery（1 round）** — Execution Contract に従い
   reviewer を起動し、trigger 方法と required context を記録した上で、独立
   reviewer による意味的な discovery を 1 回行います。round 数の扱いは
   Artifact classification / Review stopping rules（`policy/core.md`）に従います。
4. **Acquisition & Validity 確認** — Acquisition & Validity Contract
   （`policy/core.md`）に従い、target SHA / range、target artifact set、
   completion、acquisition、validity を確認します。
   Selection Contract で required とした review 数ぶんの `validity: valid`
   な run が揃うまで triage へ進みません。
   揃わない run（invalid / unknown / failure）の扱いは Failure / retry
   （`policy/core.md`）に従います。
   valid な run の finding だけを triage へ進めます。
   invalid / unknown / failure な run の finding は triage に使用しません。
5. **Triage** — 出た finding を Resolution Contract のカテゴリ（fix /
   false-positive / needs-verification / technical-dispute / intent-question）へ
   仕分けます。
6. **Fix** — Resolution Contract に従い、accepted finding を batch でまとめて
   fix します。
7. **Closure** — accepted finding の fix によって target SHA / range が変わった
   場合のみ行います。修正後の target に対して手順 1 の mechanical check を
   再実行し、成功したらその SHA / range を closure target として re-freeze
   し、Selection / Execution Contract（`policy/core.md`）を closure review
   run に適用します。
   その上で、triage した finding に対応しているかの closure verification
   のみを行い、full な再 discovery はしません。
   closure verification 自体の completion / acquisition / validity も、
   この closure target を expected target として Acquisition & Validity
   Contract に従って確認します。
   accepted finding の fix が無く target も変更されていない場合（例えば
   0 findings の場合や、finding を false-positive 等として Resolution
   した場合）は、required review 数の valid semantic discovery と
   Resolution が完了した時点で review procedure を完了とし、新たな
   closure run を要求しません。

## 停止条件

同種の finding が複数の文書や round にまたがって繰り返し出る場合は、review loop
を増やすのではなく、上流の policy / document 自体に defect がある兆候として扱い、
escalate します。round 数の扱いは Review stopping rules（`policy/core.md`）に
従います。
