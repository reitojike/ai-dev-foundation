# review-code skill

このファイルは `policy/core.md` の Review Protocol（Artifact classification の
Executable、Review contracts、Review Adapter boundary、Failure / retry、Review
stopping rules）を使った実行手順です。規範的なルールはここで再定義せず、
`policy/core.md` を参照します。本 skill と policy が矛盾する場合は policy が優先します。

この skill の canonical source は Foundation リポジトリの `policy/core.md` および
`skills/review-code.md` です。consumer には `.ai-dev-foundation/skills/review-code.md`
として本ファイルが配布され、`policy/core.md` の規範的なルールは generated `AGENTS.md`
の `## Foundation policy` section として配布されます。以降 `policy/core.md` への
参照は、consumer context ではこの `AGENTS.md` の `## Foundation policy` section を
指します。consumer リポジトリに `policy/core.md` という path が存在することは
前提にしません。

## 対象

Executable artifact（TS / TSX / SQL / workflow / config 等）の review。
review target は Selection Contract に従い、candidate SHA、applicable な
場合は commit range、および target artifact set を含みます。以降の手順で
SHA について述べる箇所は、commit range や target artifact set を使う
review でも同じ意味で適用します。

## 手順

1. **Deterministic verify** — AI review を要求する前に、その時点の candidate SHA
   と、その verify が対象とした artifact / package / repository scope を
   必要な精度で記録した上で、repository が定義する verify（`npm test` / `npm
run check:fixture` / consumer `verify` / `git diff --check` 等、Task に
   応じたもの）を実行します。repository 全体を対象とする verify であれば
   repo-wide として記録すれば十分です。
2. **Freeze candidate SHA** — review 対象の commit SHA を確定します。
   commit range を review target として使う場合は、対象となる range も
   同時に freeze し、以降 SHA について述べる target mutation semantics を
   range にも同じ意味で適用します。
   手順 1 で記録した verify 対象の SHA と、ここで freeze する SHA が一致する
   ことを確認します。一致しない場合は、freeze した SHA に対して手順 1 の
   deterministic verify を再実行し、成功してから先へ進みます。
   discovery の completion / validity が確定する前にこの SHA が変わった場合、
   その旧 review target / run を現在 target の evidence として扱いません。
   新しい SHA に対して手順 1 の deterministic verify を再実行し、成功したら
   re-freeze して必要な discovery をやり直します。
   valid な discovery の後、手順 7 の batch fix によって SHA が変わった場合は、
   re-freeze はしますが手順を最初からやり直さず、
   手順 8〜13（deterministic verify -> targeted closure -> merge）に進みます。
   手順 7 の batch fix 以外の理由で candidate SHA が変わった場合（並行作業や
   scope 追加、fix と無関係な commit 等）は、valid な discovery の後であっても
   その旧 review target / run を現在 target の evidence として扱いません。
   新しい SHA に対して手順 1 の deterministic verify を再実行し、成功したら
   re-freeze して必要な discovery をやり直します。
3. **Selection** — Selection Contract に従い、artifact classification、reviewer /
   capability、required review 数、target artifact set、expected target
   SHA / applicable な commit range を決めます。commit range を使う場合は、
   対象範囲が曖昧にならない形で確定します。
   target artifact set を確定した時点から、その artifact set も review
   target の一部として扱い、手順 2 の target mutation semantics を
   artifact set にも同じ意味で適用します。
   target artifact set を確定したら、直近の successful deterministic
   verify evidence が、確定した SHA / range と target artifact set の
   両方をカバーしているかを確認します。selected artifact set をその
   verify evidence がカバーしていると確認できない場合は、確定した
   target に対して手順 1 の deterministic verify を再実行し、成功して
   から手順 4（Execution）へ進みます。
   Executable artifact では原則として独立 reviewer を使います。
   あわせて expected review set を確定します。自分が trigger した reviewer だけを
   set に入れて終わりにしません。membership の境界（何が member になり、presence
   だけでは何が member にならないか）と class ごとの扱いは Selection Contract
   （`policy/core.md`）が定めます。
   この skill で行う実務は次です。review target 上の actor を fresh acquisition で
   列挙し、各 actor をどの class としたか、および member とした場合はその根拠（どの
   surface item を review participation とみなしたか）を記録します。
4. **Execution** — Execution Contract に従い、Selection で確定した expected
   target SHA / applicable な commit range と target artifact set を各
   reviewer の trigger へ渡して起動します。trigger 方法、実際に渡した
   target と artifact set、required context を記録します。
5. **Acquisition & Validity** — reviewer の run ごとに Acquisition & Validity
   Contract（`policy/core.md`）に従って record schema を埋めます。
   completion と validity は独立した判定とし、completed な run についてのみ
   validity を判定します（target SHA / artifact set 等が一致しない completed run
   は invalid として表現できます）。
   `none` / `unknown` / `failure` は completion / validity と混同せず、Contract
   の定義に従って記録します。
   run record の `status` / `validity` とは別に、各 reviewer の target completion
   state を Acquisition & Validity Contract に従って判定します。判定に使う positive
   completion evidence の target-bound 要件、binding へ使う field / surface の安定性
   要件、binding が成立しない場合の扱い、および `not-bound` な reviewer の evidence 軸 /
   finding 軸の分離は、いずれも `policy/core.md` が定めます。
   この skill で行う実務は次です。どの surface item を positive completion evidence と
   したか、どの field / surface を安定と判断して binding の根拠にしたか、そしてその
   判断を確認できたかどうかを記録します。安定性を必要な精度で確認できないまま binding が
   成立したものとして扱わないでください。
6. **Required review gate & aggregate / triage** — Selection Contract で
   required とした review 数ぶんの `validity: valid` な run が揃うまで triage
   へ進みません。
   揃わない run（invalid / unknown / failure）の扱いは Failure / retry
   （`policy/core.md`）に従います。
   required 数の valid run が揃ったら finding を集約し、
   Resolution Contract（`policy/core.md`）のカテゴリ（fix / false-positive /
   needs-verification / technical-dispute / intent-question）へ仕分けます。
   human escalation と technical dispute の扱い、重大 finding を dismiss する
   際の確認要否は Resolution Contract に従います。
   finding の集約対象は valid な run に限りません。ancestor target に対する run の
   ように `validity: valid` でない run であっても、そこで既に発見された finding は
   Resolution Contract の対象です。`validity` は evidence 軸の判定であり、finding を
   捨ててよい根拠ではありません。review target が移動したことだけを理由に、既存の
   finding を discharge しません。
7. **Batch fix + root-cause** — Resolution Contract に従い、accepted finding が
   あれば root-cause ごとにまとめて fix します。
   accepted finding が無ければ candidate SHA は変更されません。
   fix による変更を超えて target が動いた場合（例えば commit range の
   一方の endpoint や target artifact set が accepted fix と無関係に
   変わった場合）、その独立した変更分は手順 2 の non-fix target mutation
   semantics に従い、targeted closure だけでは扱いません。
8. **Deterministic verify** — 手順 7 の batch fix によって candidate SHA が
   変更された場合のみ、fix 後に手順 1 の verify を再実行します。
9. **Second full discovery（条件付き）** — Review stopping rules
   （`policy/core.md`）に従って 2nd full discovery が必要と判断された
   場合のみ、targeted closure の前に行います。
   1. 現在の post-fix SHA を second discovery target として re-freeze
      し、直近の successful deterministic verify target との
      consistency を確認します。一致しない場合は、その verify evidence
      を使わず、確定した second discovery target に対して
      deterministic verify を行い、成功したら re-freeze して
      Selection / Execution へ進みます。
   2. Selection Contract をこの second discovery stage へ適用し、確定
      した target artifact set まで直近の successful deterministic
      verify evidence がカバーしているかを確認します。カバーしていると
      確認できない場合は、確定した second discovery target に対して
      deterministic verify を再実行し、成功してから Execution へ
      進みます。
   3. Execution Contract に従って full discovery（独立 reviewer）を
      起動します。
   4. Acquisition & Validity Contract をこの discovery run に適用します。
   5. Selection で required とした review 数ぶんの valid run が揃うまで
      triage へ進みません。揃わない run の扱いは Failure / retry
      （`policy/core.md`）に従います。
   6. finding を Resolution Contract で triage します。手順 6 と同じく、
      集約対象は valid な run に限りません。`validity: valid` でない run で
      既に発見された finding も Resolution Contract の対象です。
   7. accepted finding があれば、手順 7 と同じ batch fix semantics で
      まとめて fix します。
   8. その fix によって target が変わった場合、手順 8 と同じ
      deterministic verify を行います。

   second discovery の実行中、または completion / validity 確定前後に
   accepted fix 以外の理由で target が変わった場合は、手順 2 と同じ
   target-specific evidence の扱いに従います。
   この second discovery の accepted finding の fix について、さらに
   追加の discovery round が必要と判断される場合、3rd full discovery は
   起動せず merge もせず、Review stopping rules（`policy/core.md`）に
   従って upstream task/design の不安定さを疑い、必要に応じて escalate
   します。

10. **Targeted closure** — この review flow で accepted finding の fix
    によって target が変更された場合のみ（手順 9 の second full
    discovery を挟んだ場合を含む）行います。最終的な post-fix SHA を
    closure target として re-freeze し、直近の successful deterministic
    verify target との consistency を確認します。一致しない場合は、その
    verify evidence を使わず、確定した closure target に対して
    deterministic verify を行い、成功したら re-freeze します。
    Selection Contract に従ってこの closure target を expected target
    として確定し、確定した closure artifact set まで直近の successful
    deterministic verify evidence がカバーしているかを確認します。
    カバーしていると確認できない場合は、確定した closure target に対
    して deterministic verify を再実行し、成功してから Execution
    Contract に従って closure run を起動します。
    Review stopping rules（`policy/core.md`）に従い、fix した箇所に対応
    する範囲のみ再確認します。
11. **Closure Acquisition & Validity** — この review flow で accepted
    finding の fix によって target が変更された場合のみ（手順 9 を
    挟んだ場合を含む）、この closure target を expected target として、
    targeted closure の review run に手順 5 と同じ Acquisition &
    Validity Contract を適用し、completion / acquisition / validity を
    確認します。
    確認できなければ merge せず、その後の扱いは Failure / retry
    （`policy/core.md`）に従います。
    closure 用 Selection Contract で required とした review 数ぶんの valid
    な closure run が揃うまで Closure Resolution へ進みません。不足する
    run の扱いは Failure / retry（`policy/core.md`）に従います。
12. **Closure Resolution** — targeted closure の finding を Resolution
    Contract（`policy/core.md`）に従って triage します。unresolved の
    finding がある間は merge しません。
    accepted な closure finding があれば、手順 7 と同じ batch fix
    semantics でまとめて fix し、手順 8 と同じ deterministic verify を
    行います。
    その上で Review stopping rules（`policy/core.md`）を再評価します。
    - この review flow で手順 9 をまだ使っておらず、2nd full discovery
      が必要と判断される場合は、手順 9 へ進み、完了後に手順 10 へ
      進みます。
    - 手順 9 を既に使っており、なお追加の full discovery が必要と
      判断される場合は、3rd full discovery は起動せず merge もせず、
      upstream task/design の不安定さを疑い、必要に応じて escalate
      します。
    - 追加の full discovery が不要な場合は、手順 10 へ進みます。

    この cycle が繰り返し発生する場合は無制限に続けず、Review stopping
    rules（`policy/core.md`）に従って upstream task/design の不安定さを
    疑い、必要に応じて escalate します。

13. **Merge-ready** — 以下の条件が成立するのは merge-ready であり、merge
    の実行そのものではありません。merge の実行は `policy/core.md` の
    Merge readiness and merge authority に従い、current Task / Execution
    Envelope / explicit authority が merge execution を許可している場合
    のみ行います。authority が明示されていない、または別 authority の
    承認が必要な場合は merge を実行せず、merge-ready の状態を報告して
    停止し、authority escalation / handoff します。
    この review flow で accepted finding の fix による
    target 変更が一度も発生していなければ、required review 数の valid
    discovery と Resolution（手順 6）が完了した時点で merge-ready と
    判定します。
    target 変更が発生していれば（手順 9 を挟んだ場合を含む）、手順 6 の
    discovery Resolution（手順 9 を使った場合はその Resolution も含む）
    と、Closure Acquisition & Validity・Closure Resolution が完了した
    時点で merge-ready と判定します。discovery Resolution と closure の
    完了順序は
    問いません。

    そのうえで、merge-ready を宣言する直前の最後の action として、
    `policy/core.md` の Merge-ready completion fence を評価します。
    merge-ready の成立条件、review obligation の定義、および
    review-relevant な state 変化による fence の無効化は `policy/core.md`
    が定めます。
    この skill で行う実務は次です。宣言の直前に expected review set を
    fresh acquisition で閉じ直し、各 member の target completion state を
    fresh に判定し、finding を安定 evidence 由来の reviewed target へ
    帰属させ、triage されていない finding が review surface 上に残って
    いないことを確認します。会話内で既に見た snapshot をこの判定の根拠に
    しません。provider が thread の resolution 状態を持つ場合は、その
    surface も未 triage finding の確認に使えます。

## Adapter boundary（manual pilot）

provider 固有 adapter がまだ無い間は、`trigger()` / `pollCompletion()` /
`collectOutputs()` / `normalizeFindings()` を人手で埋めます。

- `trigger()`: reviewer をどう起動したか（PR 更新での automatic trigger、
  `@reviewer review` のような明示的な command 等）を記録します。
- `pollCompletion()`: completion をどう確認したか（status の変化、comment の投稿、
  run の所要時間等）を記録します。CI/status のみでの判断はしません。completion 判定に
  使う comment / review submission は、判定するその時点で ID を指定して fresh に
  再取得した state / body を使います。会話内で既に見た comment の内容や、以前取得した
  snapshot をそのまま completion 判定の根拠にせず、pending 継続の理由にもしません。
- `collectOutputs()`: この provider で確認できる surface（top-level PR comment、
  inline/thread comment、review submission/summary、status/check、必要なら
  workflow log、edited comment）を確認し、内容の有無にかかわらず「どの surface を
  確認したか」を記録します。この surface から `policy/core.md` の
  Acquisition & Validity Contract が定義する Completion と Validity の
  要求事項を後続 session が独立に判定できれば、その surface 自体を同
  Contract の record の recoverable な representation として result
  locator に使えます（別途 record を post し直す必要はありません）。
  それらの要求事項のいずれかを surface から判定できない場合は、
  reviewer mechanism 自身がそのような外部から確認可能な surface へ結果を
  残さない場合（例: 実装 session 内で動く subagent review）と同様に扱い、
  `collectOutputs()` に相当する手段として、`policy/core.md` の record
  schema の各 field に加え、上記の Completion / Validity 要求事項を独立に
  判定できる情報（`validity` 等の判定結果の要約だけでなく、その根拠と
  なる情報）を PR/Issue 上の comment 等へ明示的に persist し、それを
  result locator とします。
- `normalizeFindings()`: 集めた出力を record schema と triage category へ変換し、
  finding ごとに出典 surface と locator を残します。

### Observed example（provider 固有の恒久 rule ではない）

ある PR では、Draft -> Ready の automatic review trigger が確認できず、明示的な
manual trigger command を送って初めて review completion の evidence が得られたことが
あります。これは「expected trigger behavior は completion evidence と同義ではない」
という一般原則の実測例として扱い、特定 provider が常に manual trigger を要求すると
いう恒久仕様には昇格させません。同種の provider を扱う際は、automatic trigger を
仮定せず、completion evidence が得られるまで `unknown` として扱ってください。

別の観測として、ある reviewer は PR 上の明示的な mention コメントを trigger と
する GitHub-native workflow を経由した場合、result（target 参照・finding・
completion 状態）が PR の comment として繰り返し durable に残ることを確認して
います。この観測は、in-session/subagent 実行のみに依存するより、reviewer が
そのような GitHub-native trigger 経路を持つならそれを優先する方が
Acquisition & Validity Contract の recoverability 要件を満たしやすい、という
運用上の判断材料になります。ただしこれも特定 provider の恒久仕様ではなく、
capability record 側で再検証可能な observed evidence として扱ってください。
GitHub-native 経路を使わず in-session/subagent review を選ぶ場合は、上記の
`collectOutputs()` の persist 手順を必ず行います。

さらに別の観測として、GitHub Actions 経由で PR comment を投稿・編集する reviewer では、
その reviewer を起動した Actions job/step 自身の conclusion（success/failure）が、同じ
job が編集した comment 本文の completion 状態と一致しないことが実測されています。
具体的には、job/step の conclusion が `failure` であっても、対応する comment の body には
completion を示す marker（例: 全項目 checked の todo list、明示的な complete 文言）と
実質的な review 内容が既に存在していたケースがありました。この種の reviewer では、
wrapping job/step の conclusion 単独を completion または failure の根拠にせず、
comment 本文の completion marker を fresh 再取得した上で直接確認してください。これも
特定 provider の恒久仕様ではなく、observed evidence として capability/profile 側で
再検証可能な形で扱います。

さらに別の観測として、inline/thread comment を持つ reviewer では、その comment が
「実際に review された target」を表す field と、「現在の head」に追随して値が更新される
field の両方を持つことがあります。実測では、同一 finding について前者は投稿時の target を
保持し続けた一方、後者は PR の head 移動後に新しい head の値へ変化していました。後者を
binding の根拠にすると、ancestor target に対する review を current target の completion
evidence と誤認します。この observation は、どちらの field を binding の根拠にしてよいかを
判断するための材料です。binding の安定性要件と、安定性を確認できない場合の扱いは
Acquisition & Validity Contract（`policy/core.md`）に従ってください。

同じ実測で、次の 2 点も確認しています。いずれも provider の恒久仕様ではなく、
capability/profile 側で再検証可能な observed evidence として扱います。

- ある automatic reviewer は、review 結果を comment 系 surface にのみ残し、
  check/status surface を一切生成しませんでした。この reviewer について
  check/status の有無を completion の根拠にはできません。
- 別の reviewer は、`success` の commit status を出しながら、その description が
  「automatic review は無効化されているため review をスキップした」ことを表して
  いました。green な status が review 完了ではなく **review 未実施**を意味する
  実例です。status の state だけを見て completion へ変換してはいけません。一方、
  これは非参加を positive に宣言している evidence でもあるため、`unknown` とは
  区別して扱えます。

## Manual review pilot

次の manual pilot では、Claude / Codex / CodeRabbit のそれぞれについて、本 skill と
同じ Review Contract を使って Selection / Completion / Acquisition / Validity /
Resolution を人手で判定できることを確認します。この skill の範囲では pilot 自体を
実施・拡張せず、contract を適用できる準備を整えるところまでとします。
