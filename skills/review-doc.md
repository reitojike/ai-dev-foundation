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
2. **Semantic discovery（1 round）** — 独立 reviewer による意味的な discovery を
   1 回行います。Foundation の重要な normative contract では、独立した 2 系統の
   reviewer を使ってよいですが、各 reviewer の discovery はそれぞれ 1 回のままとし、
   同じ reviewer に discovery を繰り返させて網羅性を上げようとしません。
3. **Acquisition & Validity 確認** — `policy/core.md` の Acquisition & Validity
   Contract に従い、target SHA / range、target artifact set、completion、
   acquisition、validity を確認します。
   確認できない run の finding は triage へ進めず、
   `unknown` / `failure` として扱います。
4. **Triage** — 出た finding を Resolution Contract のカテゴリ（fix /
   false-positive / needs-verification / technical-dispute / intent-question）へ
   仕分けます。
5. **Fix** — accepted finding を batch でまとめて fix します。1 件ずつの drip fix は
   しません。
6. **Closure** — triage した finding に対応しているかの closure verification のみを
   行い、full な再 discovery はしません。

## 停止条件

reviewer の不確実性を補うために 2 回目の full discovery を追加しません。同種の
finding が複数の文書や round にまたがって繰り返し出る場合は、review loop を増やす
のではなく、上流の policy / document 自体に defect がある兆候として扱い、escalate
します。
