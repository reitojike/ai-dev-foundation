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
   range、target artifact set、reviewer / capability を確定します。
3. **Execution & Semantic discovery（1 round）** — Execution Contract に従い
   reviewer を起動し、trigger 方法と required context を記録した上で、独立
   reviewer による意味的な discovery を 1 回行います。round 数の扱いは
   Artifact classification / Review stopping rules（`policy/core.md`）に従います。
4. **Acquisition & Validity 確認** — Acquisition & Validity Contract
   （`policy/core.md`）に従い、target SHA / range、target artifact set、
   completion、acquisition、validity を確認します。
   valid な run の finding だけを triage へ進めます。
   invalid / unknown / failure な run の finding は triage に使用しません。
5. **Triage** — 出た finding を Resolution Contract のカテゴリ（fix /
   false-positive / needs-verification / technical-dispute / intent-question）へ
   仕分けます。
6. **Fix** — Resolution Contract に従い、accepted finding を batch でまとめて
   fix します。
7. **Closure** — 原則として、triage した finding に対応する範囲の targeted
   closure verification を行います。追加 discovery の要否は Review stopping
   rules（`policy/core.md`）に従います。
   closure verification 自体の completion / acquisition / validity も
   Acquisition & Validity Contract に従って確認します。

## 停止条件

同種の finding が複数の文書や round にまたがって繰り返し出る場合は、review loop
を増やすのではなく、上流の policy / document 自体に defect がある兆候として扱い、
escalate します。round 数の扱いは Review stopping rules（`policy/core.md`）に
従います。
