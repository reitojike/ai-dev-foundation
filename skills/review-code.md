# review-code skill

このファイルは `policy/core.md` の Review Protocol（Artifact classification の
Executable、Review contracts、Review Adapter boundary、Failure / retry、Review
stopping rules）を使った実行手順です。規範的なルールはここで再定義せず、
`policy/core.md` を参照します。本 skill と policy が矛盾する場合は policy が優先します。

## 対象

Executable artifact（TS / TSX / SQL / workflow / config 等）の review。

## 手順

1. **Deterministic verify** — AI review を要求する前に、repository が定義する verify
   （`npm test` / `npm run check:fixture` / consumer `verify` / `git diff --check` 等、
   Task に応じたもの）を実行します。
2. **Freeze candidate SHA** — review 対象の commit SHA を確定します。
   discovery の completion / validity が確定する前にこの SHA が変わった場合、
   その review target / run を invalid として扱い、新しい SHA で re-freeze して
   必要な discovery をやり直します。
   valid な discovery の後、手順 7 の batch fix によって SHA が変わった場合は、
   re-freeze はしますが手順を最初からやり直さず、
   手順 8〜9（deterministic verify -> targeted closure）に進みます。
3. **Selection** — Selection Contract に従い、artifact classification、reviewer /
   capability、required review 数、target artifact set、expected target SHA を決めます。
   Executable artifact では原則として独立 reviewer を使います。
4. **Execution** — Execution Contract に従い、各 reviewer をそれぞれの trigger 方法で
   起動します。trigger 方法と target SHA、渡した required context を記録します。
5. **Acquisition & Validity** — reviewer の run ごとに `policy/core.md` の record
   schema を埋めます。
   CI green を review completion の代わりにしない、
   コメントが無いことを positive evidence なしに `0 findings` と扱わない、
   completed（success を含む）と混同せず未開始・判定不能・失敗をそれぞれ
   `none` / `unknown` / `failure` として区別する、を徹底します。
6. **Aggregate & triage** — valid な run から finding を集約し、Resolution Contract の
   カテゴリ（fix / false-positive / needs-verification / technical-dispute /
   intent-question）へ仕分けます。human escalation は product intent / authority の
   論点に限り、pure technical dispute は技術的な adjudication（別 reviewer の意見等）
   で解決します。
7. **Batch fix + root-cause** — accepted finding を root-cause ごとにまとめ、
   1 件ずつの drip fix にしません。
8. **Deterministic verify** — fix 後に手順 1 の verify を再実行します。
9. **Targeted closure** — fix した箇所に対応する範囲のみ再確認します。fix が
   behavior / blast radius を materially 変えた場合のみ、追加で 1 round の discovery
   を許容します。それ以上 round が必要に見える場合は review を増やさず、upstream の
   task/design が不安定である可能性を疑い、escalate します。
10. **Merge** — targeted closure が通った時点で merge します。

## Adapter boundary（manual pilot）

provider 固有 adapter がまだ無い間は、`trigger()` / `pollCompletion()` /
`collectOutputs()` / `normalizeFindings()` を人手で埋めます。

- `trigger()`: reviewer をどう起動したか（PR 更新での automatic trigger、
  `@reviewer review` のような明示的な command 等）を記録します。
- `pollCompletion()`: completion をどう確認したか（status の変化、comment の投稿、
  run の所要時間等）を記録します。CI/status のみでの判断はしません。
- `collectOutputs()`: この provider で確認できる surface（top-level PR comment、
  inline/thread comment、review submission/summary、status/check、必要なら
  workflow log、edited comment）を確認し、内容の有無にかかわらず「どの surface を
  確認したか」を記録します。
- `normalizeFindings()`: 集めた出力を record schema と triage category へ変換し、
  finding ごとに出典 surface と locator を残します。

### Observed example（provider 固有の恒久 rule ではない）

ある PR では、Draft -> Ready の automatic review trigger が確認できず、明示的な
manual trigger command を送って初めて review completion の evidence が得られたことが
あります。これは「expected trigger behavior は completion evidence と同義ではない」
という一般原則の実測例として扱い、特定 provider が常に manual trigger を要求すると
いう恒久仕様には昇格させません。同種の provider を扱う際は、automatic trigger を
仮定せず、completion evidence が得られるまで `unknown` として扱ってください。

## Manual review pilot

次の manual pilot では、Claude / Codex / CodeRabbit のそれぞれについて、本 skill と
同じ Review Contract を使って Selection / Completion / Acquisition / Validity /
Resolution を人手で判定できることを確認します。この skill の範囲では pilot 自体を
実施・拡張せず、contract を適用できる準備を整えるところまでとします。
