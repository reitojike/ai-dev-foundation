# review-code skill

このファイルは `policy/core.md` の Review Protocol（Artifact classification の
Executable、Review contracts、Review Adapter boundary、Failure / retry、Review
stopping rules）を使った実行手順です。規範的なルールはここで再定義せず、
`policy/core.md` を参照します。本 skill と policy が矛盾する場合は policy が優先します。
Executable artifact の review 手順（`## 手順` と `## 停止条件` の finite flow）の
canonical source は本 skill であり、`policy/core.md` には置きません。

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

## Happy path

迷ったらこの順に進めます。各 step の詳細・分岐・例外は `## 手順` にあります。

1. repository が定義する deterministic verify（`npm test` 等）を実行する。
2. review 対象の commit SHA を freeze する。
3. reviewer capability record（`.ai-dev-foundation/reviewers.json`）を読む。無ければ
   Selection へ進まず停止して escalate する。
4. record の `required_selection` に従って required slot を埋め、expected review set を
   確定して Selection を記録する。
5. 選んだ reviewer の `trigger.value` を PR へ comment として投稿する。
   `trigger.target_argument` があれば `{target_sha}` を freeze した SHA へ置換し、同じ
   comment に含める。
6. state は会話内の記憶ではなく、次の fresh 取得で機械的に確認する。

   ```text
   node tooling/review-evidence.mjs --repo <owner/repo> --pr <number> --json \
     --reviewers <consumer>/.ai-dev-foundation/reviewers.json --target-sha <freeze した SHA>
   ```

7. 出力の `target_completion_state` / `operational_signal` で次を決める。
   - `completed@target` — finding を triage する（手順 6 以降）
   - `rate-limited` — 復帰を待たない。record の `fallback_order` の次の reviewer へ進み、
     Selection amendment を記録する
   - `in-flight` — その run の終端だけを待つ
   - `declined` / `failed` / `not-bound` / `unknown` — `0 findings` へ変換せず、
     Failure / retry（`policy/core.md`）に従う
   - advisory member — completion を待たず blocker にしない。ただし到着済みの finding は
     class に関係なく triage / Resolution の対象
8. accepted finding を batch で fix し、target が動いたら targeted closure を回す。
9. merge-ready fence を評価してから merge-ready を宣言する。merge の実行は authority に従う。

## reviewer capability record

利用可能な reviewer、その trigger、結果が出る surface、completion / 非参加 / rate-limit /
failure の marker、fallback order は、consumer-owned な reviewer capability record
（`.ai-dev-foundation/reviewers.json`）が持ちます。本 skill は provider 名も marker も
持ちません。

- record の schema と、その存在 / parse / 最小妥当性の check は Foundation tooling
  （`tooling/reviewer-record-lib.mjs`、`tooling/check.mjs`）が所有します。durable
  record（Selection / run / fence record）の投稿形式も schema 側が定めます。
- record に宣言されていない reviewer、および in-session / local review（`/code-review`
  等）は formal acquisition になりません。
- record の marker は observed evidence であり恒久仕様ではありません（`policy/core.md`
  の Observed evidence is not a permanent provider rule）。実挙動が record と食い違った
  場合は待ち続けず、record と `observed_at` を更新します。
- record の trigger が repository code の外側（operator / account 設定、review 対象
  repository が個別に用意する GitHub workflow 等）に依存する場合、その設定変更を
  repository code から完了したものとして扱いません。unavailable なら fallback order に
  従います。

## Formal review と preflight/local 利用の境界（Issue #49）

実装 session 中に Claude Code 本体や subagent を使った critique / self-check /
design sanity check は自由に行ってよく、この skill の対象外です。これらは
Selection Contract で reviewer / capability として selection されたものではなく、
Acquisition & Validity Contract の record も持たないため、required review 数にも
expected review set にも算入しません。

直後の `## 手順`（Deterministic verify 以降）は、reviewer / capability の選択に
かかわらず共通に適用します。provider ごとの trigger / marker / acquisition
routing は、上記の reviewer capability record が持ちます。selection されていない
preflight/local 利用を、事後的に「Claude review を実施した」として
required/expected review の消化根拠にしてはいけません。この区別は Claude に
限らず、他 provider の local/preflight 利用にも同様に適用します。

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
3. **Selection** — 最初に reviewer capability record を読みます。record が存在しない、
   または parse / 最小妥当性 check を通らない場合は、Selection へ進まず停止して
   escalate します。record の `required_selection` に従って required slot を埋め、
   各 reviewer の `default_class` を portfolio 上の default として扱います。
   その上で Selection Contract に従い、artifact classification、reviewer /
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
   この skill で行う実務は次です。この review flow のいずれかの target 上に現れた
   actor を fresh acquisition で列挙し（current target に限らず、ancestor target で
   参加した actor も対象です）、各 actor をどの class としたか、および member と
   した場合はその根拠（どの surface item を review participation とみなしたか）を
   記録します。
4. **Execution** — Execution Contract に従い、Selection で確定した expected
   target SHA / applicable な commit range と target artifact set を各
   reviewer の trigger へ渡して起動します。trigger は record の `trigger.value`
   を PR へ comment として投稿することです。`trigger.target_argument` がある
   場合は `{target_sha}` を freeze した target へ置換して同じ comment に含め、
   reviewer の結果自体が reviewed target を持つようにします。record に宣言され
   ていない reviewer、および in-session / local review（`/code-review` 等）は
   formal acquisition になりません。
   trigger 方法、実際に渡した target と artifact set、required context を記録します。
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
   この skill で行う実務は次です。completion 判定は record の completion marker を、
   comment ID を指定した fresh 取得で確認します。in-place 編集される surface では、
   新着 comment ではなく既存 comment の本文変化を見ます。
   `node tooling/review-evidence.mjs --reviewers <record> --target-sha <SHA> --json` は、
   この判定を marker と locator つきで機械的に出力します。
   どの surface item を positive completion evidence とし、どの field / surface を安定と
   判断して binding の根拠にしたかを記録します。安定性を必要な精度で確認できないまま
   binding が成立したものとして扱わないでください。
   rate-limit marker を観測したら復帰を待ちません。record の `fallback_order` で次の
   reviewer へ進み、Selection amendment を記録します。待つのは in-flight な run の
   終端だけです。
   advisory member の completion は待たず、blocker にしません。ただし merge-ready 判定
   までに review surface へ到着した finding は、class に関係なく triage / Resolution の
   対象です。
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

## 停止条件

Executable artifact の review flow を、`policy/core.md` の Review stopping rules が
定める stopping semantics（evidence の target 束縛、round / cycle の上限と escalate
判断）を評価する分岐として表現した finite flow です。`## 手順` の各 step と同じ
手続きを分岐構造として示したものであり、規範的なルール自体は `policy/core.md` が
持ちます。round / cycle の上限判断そのものは Review stopping rules
（`policy/core.md`）に従います。

```text
deterministic verify
  -> freeze candidate SHA
  -> verify target と freeze target の consistency 確認
  -> discovery（独立 reviewer）
  -> completion / acquisition / validity 確認
  -> aggregate / triage
  -> accepted finding の batch fix で review target が変更された場合:
       batch fix + root-cause sweep
       -> deterministic verify
       -> Review stopping rules に従い 2nd full discovery が必要な場合のみ:
            second discovery target の Selection / Execution
            -> full discovery（2nd round、独立 reviewer）
            -> completion / acquisition / validity 確認
            -> required review 数の valid run 確認
            -> aggregate / triage
            -> accepted finding があれば batch fix
            -> target が変われば deterministic verify
            -> この fix でさらに追加の full discovery が必要と判断される
               場合: 3rd full discovery は起動せず、merge もせず、
               upstream task/design の不安定さを疑い、必要に応じて
               escalate する
       -> closure target の Selection / Execution
       -> targeted closure
       -> closure completion / acquisition / validity 確認
       -> closure finding の Resolution
       -> accepted closure finding があれば:
            batch fix
            -> deterministic verify
            -> Review stopping rules の再評価
            -> 2nd full discovery 未使用かつ必要な場合:
                 second discovery target の Selection / Execution から
                 上記の full discovery route へ進み、完了後 targeted
                 closure を再実行する
            -> 2nd full discovery 使用済みでなお必要な場合:
                 3rd full discovery は起動せず、merge もせず、
                 upstream task/design の不安定さを疑い、必要に応じて
                 escalate する
            -> 追加の full discovery が不要な場合:
                 targeted closure を再実行する
       -> required discovery stage(s) の Resolution 完了
       -> merge
  -> accepted fix が無く review target が変更されていない場合:
       required review 数の valid discovery と Resolution の完了
       -> merge
```

accepted finding の batch fix によって review target が変更された場合のみ
targeted closure を行い、その review run も Acquisition & Validity Contract
に従って completion / acquisition / validity を確認します。targeted closure
の finding も Resolution Contract の対象とし、Resolution が完了するまで
merge しません。
targeted closure の Resolution に加えて、この review flow で実行した
discovery stage（2nd full discovery を含む）すべての Resolution が
完了していることも merge の条件です。完了順序は問いません。
targeted closure の finding に accepted fix がある場合も、fix 後の
deterministic verify を経て Review stopping rules を再評価します。2nd
full discovery が未使用でなお必要なら 2nd discovery route へ進み、完了後
に targeted closure を再実行します。2nd full discovery を使用済みでなお
full discovery が必要なら、3rd full discovery は起動せず、merge もせず、
upstream task/design の不安定さを疑い、必要に応じて escalate します。
追加の full discovery が不要なら、targeted closure を再実行します。
accepted fix が無く review target が変更されていない場合は、
required review 数の valid discovery と Resolution の完了をもって、
新たな closure run を要求せずに merge できます。

## Adapter boundary（manual pilot）

provider 固有 adapter がまだ無い間は、`trigger()` / `pollCompletion()` /
`collectOutputs()` / `normalizeFindings()` を人手で埋めます。

- `trigger()`: record の `trigger` に従って起動し、どう起動したかを記録します。
- `pollCompletion()`: completion をどう確認したか（record のどの marker を、どの
  surface item で観測したか）を記録します。CI/status のみでの判断はしません。判定に
  使う comment / review submission は、判定するその時点で ID を指定して fresh に
  再取得した state / body を使います。会話内で既に見た comment の内容や、以前取得した
  snapshot をそのまま completion 判定の根拠にせず、pending 継続の理由にもしません。
- `collectOutputs()`: GitHub 上の durable review surface の mechanical
  acquisition は、ai-dev-foundation checkout を利用できる場合、
  `tooling/review-evidence.mjs --json`（Issue #62、使い方・現在の
  coverage は同 tool の README 参照）に置き換えます。`--reviewers` /
  `--target-sha` を付けると、record の marker に基づく reviewer ごとの
  target completion state も同じ snapshot から出力されます。fetch が failed /
  partial な場合、または snapshot が review target に必要な evidence を
  カバーしない場合は、Review Adapter boundary（`policy/core.md`）に
  従い不足分を fresh acquisition します。empty や success への変換は
  しません。Completion / Validity / Resolution / triage の semantic
  judgment は helper ではなく本 Contract に従い agent が行います。
  helper を利用できない場合は、この provider で確認できる surface を
  確認し、内容の有無にかかわらず「どの surface を確認したか」を
  記録します。この surface から `policy/core.md` の
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

record が、結果を durable な GitHub surface へ残す trigger 経路を宣言している場合は、
その経路を preferred route として使います。宣言された経路が unavailable / unsuitable で、
in-session / subagent review を formal acquisition として使う場合は、上記
`collectOutputs()` の persist 手順に従います。この fallback は durable evidence
requirement を免除しません。
