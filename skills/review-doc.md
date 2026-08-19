# review-doc skill

このファイルは `policy/core.md` の Review Protocol（Artifact classification の
Normative、Review contracts、Review stopping rules）を使った実行手順です。規範的な
ルールはここで再定義せず、`policy/core.md` を参照します。本 skill と policy が
矛盾する場合は policy が優先します。

## 対象

Normative artifact（AGENTS / Skill / PRODUCT / ARCHITECTURE / ADR 等、後続 agent や
実装を拘束する文書）の review。

## 手順

1. **Mechanical check** — その時点の target SHA / range を記録した上で、
   markdown の形式チェック（lint / format / link 切れ等、repository が持つ
   機械的な check）を実行します。
2. **Selection** — Selection Contract（`policy/core.md`）に従い、target SHA /
   range、target artifact set、reviewer / capability、required review 数を
   確定します。
   手順 1 で記録した mechanical check 対象の target と、ここで確定する
   target が一致することを確認します。一致しない場合は、確定した target に
   対して手順 1 の mechanical check を再実行してから先へ進みます。
   手順 3 の semantic discovery の completion / validity が確定する前に
   target SHA / range または target artifact set が変わった場合、その
   review target / run を現在 target の evidence として扱いません。
   新しい target に対して手順 1 の mechanical check を再実行し、成功したら
   Selection をやり直し、手順 3 の semantic discovery を新しい target に
   対して行います。
   valid な semantic discovery（手順 3）の後、手順 6 の accepted finding
   batch fix 以外の理由で target SHA / range または target artifact set が
   変わった場合（並行作業や scope 追加、finding 対応ではない文書変更、
   無関係な commit 等）は、
   旧 review target / run を現在 target の evidence として扱いません。
   新しい target に対して手順 1 の mechanical check を再実行し、成功したら
   re-freeze して手順 2（Selection）からやり直し、手順 3 の semantic
   discovery を新しい target に対して行います。
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
   closure 用 Selection Contract で required とした review 数ぶんの valid
   な closure run が揃うまで Closure Resolution へ進みません。不足する
   run の扱いは Failure / retry（`policy/core.md`）に従います。
   accepted finding の fix が無く target も変更されていない場合（例えば
   0 findings の場合や、finding を false-positive 等として Resolution
   した場合）は、required review 数の valid semantic discovery と
   Resolution が完了した時点で review procedure を完了とし、新たな
   closure run を要求しません。
8. **Closure Resolution** — closure verification（手順 7）の finding を
   Resolution Contract（`policy/core.md`）に従って triage します。
   unresolved の finding がある間は review procedure を完了としません。
   accepted な closure finding があれば、手順 6〜7 と同じ procedure（fix ->
   mechanical check -> closure verification -> closure Acquisition &
   Validity）に従って解決します。
   この cycle が繰り返し発生する場合は、本 skill の停止条件および Review
   stopping rules（`policy/core.md`）に従います。
   手順 7 の closure が行われなかった場合（accepted fix が無く target も
   変更されていない場合）、この手順は不要です。

## 停止条件

同種の finding が複数の文書や round にまたがって繰り返し出る場合は、review loop
を増やすのではなく、上流の policy / document 自体に defect がある兆候として扱い、
escalate します。round 数の扱いは Review stopping rules（`policy/core.md`）に
従います。
