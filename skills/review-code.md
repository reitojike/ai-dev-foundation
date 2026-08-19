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
5. **Acquisition & Validity** — reviewer の run ごとに Acquisition & Validity
   Contract（`policy/core.md`）に従って record schema を埋めます。
   completion と validity は独立した判定とし、completed な run についてのみ
   validity を判定します（target SHA / artifact set 等が一致しない completed run
   は invalid として表現できます）。
   `none` / `unknown` / `failure` は completion / validity と混同せず、Contract
   の定義に従って記録します。
6. **Required review gate & aggregate / triage** — Selection Contract で
   required とした review 数ぶんの `validity: valid` な run が揃うまで triage
   へ進みません。
   揃わない run（invalid / unknown / failure）の扱いは Failure / retry
   （`policy/core.md`）に従います。
   required 数の valid run が揃ったら、valid な run から finding を集約し、
   Resolution Contract（`policy/core.md`）のカテゴリ（fix / false-positive /
   needs-verification / technical-dispute / intent-question）へ仕分けます。
   human escalation と technical dispute の扱い、重大 finding を dismiss する
   際の確認要否は Resolution Contract に従います。
7. **Batch fix + root-cause** — Resolution Contract に従い、accepted finding が
   あれば root-cause ごとにまとめて fix します。
   accepted finding が無ければ candidate SHA は変更されません。
8. **Deterministic verify** — 手順 7 で candidate SHA が変更された場合のみ、
   fix 後に手順 1 の verify を再実行します。
9. **Targeted closure** — candidate SHA が変更された場合のみ、Review stopping
   rules（`policy/core.md`）に従い、fix した箇所に対応する範囲のみ再確認します。
   追加 discovery の要否も同 stopping rules に従います。
10. **Closure Acquisition & Validity** — candidate SHA が変更された場合のみ、
    targeted closure の review run も手順 5 と同じ Acquisition & Validity
    Contract に従って completion / acquisition / validity を確認します。
    確認できなければ merge せず、その後の扱いは Failure / retry
    （`policy/core.md`）に従います。
11. **Merge** — candidate SHA が変更されていなければ、required review 数の
    valid discovery と Resolution が完了した時点で merge します。
    変更されていれば、Closure Acquisition & Validity が確認できた時点で
    merge します。

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
