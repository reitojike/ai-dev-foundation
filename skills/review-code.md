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

1. repository が定義する deterministic verify（`npm test` 等）を実行し、**どの SHA に
   対して実行したかを記録する**。
2. review 対象の commit SHA と target artifact set を freeze する。
3. reviewer capability record（`.ai-dev-foundation/reviewers.json`）を読む。無ければ
   Selection へ進まず停止して escalate する。
4. record の `required_selection` に従って required slot を埋め、expected review set と
   required review skill を確定して Selection を記録する。
5. record の `trigger.kind` に従って reviewer を起動する（分岐の詳細は手順 4）。
   起動した時点で run anchor（起動直前の ISO-8601 timestamp）を記録する。
   `--run-anchor-id` はこの時点では値を持たない（reviewer の result 自身の ID が
   必要なため）ので使わない。
6. 状態は会話内の記憶ではなく、fresh 取得で確認する。手順 5 で記録した run anchor を
   `--run-after` として渡す。

   ```text
   node tooling/review-evidence.mjs --repo <owner/repo> --pr <number> --state \
     --target-sha <sha> --run-after <手順 5 で記録した run anchor> --json
   ```

7. fresh snapshot を state evaluator へ渡して target completion state を読み、
   **triage の対象にした result の `canonical_id` と `body_digest` を記録する**。
   `completed@target` は current target に binding があり、coverage が complete な場合
   だけです。`not-bound` は別 target の完了です。`unknown` と `in-flight` は terminal
   failure ではなく、沈黙、preamble、acknowledgement、fetch incomplete、marker 不明を
   positive/negative に変換しません。finding の意味付け、Resolution、fallback の policy
   は `policy/core.md` に従います。
8. accepted finding を batch で fix し、target が動いたら targeted closure を回す
   （closure でも同じく起動時点で run anchor（timestamp）を記録し直し、triage 対象の
   `canonical_id` と `body_digest` を再取得する）。
9. merge-ready fence を実行し、`pass` の場合だけ merge-ready を宣言する。merge の実行は
   authority に従う。run anchor は手順 5（closure を回した場合は手順 8）で、
   acknowledged revision は手順 7（closure を回した場合はその closure 時の再取得分）で
   記録したものを再利用する。

   ```text
   node tooling/merge-ready-fence.mjs --repo <owner/repo> --pr <number> \
     --target-sha <sha> --base-sha <sha> --artifacts-file <path> \
     --verify-sha <sha> --required <reviewer-id> --declared-skill review-code \
     --acknowledged-file <path> \
     --run-after <手順 5（または closure 時は手順 8）で記録した run anchor>
   ```

## reviewer capability record

利用可能な reviewer、その trigger、completion / 非参加 / rate-limit /
failure の marker、fallback order は、consumer-owned な reviewer capability record
（`.ai-dev-foundation/reviewers.json`）が持ちます。本 skill は provider 名も marker も
持ちません。

- record の schema と、その存在 / parse / 最小妥当性の check は Foundation tooling
  （`tooling/reviewer-record-lib.mjs`、`tooling/check.mjs`）が所有します。durable
  record（Selection / run / fence record）の投稿形式も schema 側が定めます。
- record に宣言されていない reviewer は formal acquisition になりません。selection されて
  いない in-session / local review（`/code-review` 等）も同様です。record で selection した
  reviewer の宣言 route が unavailable / unsuitable な場合に限り、in-session / subagent
  review を代替 route として使えます。その場合は下記 `collectOutputs()` の persist 手順を
  完了して初めて formal acquisition になります（`## Adapter boundary` 参照）。
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

1. **Deterministic verify** — AI review を要求する前に、その時点の candidate SHA と、
   その verify が対象とした artifact / package / repository scope を必要な精度で記録した上で、
   repository が定義する verify（`npm test` / `npm run check:fixture` / consumer
   `verify` / `git diff --check` 等、Task に応じたもの）を実行します。repository 全体を
   対象とする verify であれば repo-wide として記録すれば十分です。
   記録した SHA と freeze した target の一致は手順 13 の fence が機械判定するため、
   手順の各所で手作業の SHA 照合を繰り返しません。scope が selected artifact set を
   カバーしているかは fence の対象外で、手順 3 で確認します。target が動いたら verify を
   やり直し、記録した SHA と scope を更新します。
2. **Freeze candidate SHA** — review 対象の commit SHA を確定します。commit range を
   review target として使う場合は対象 range も、target artifact set も同時に freeze し、
   以降 SHA について述べる target mutation semantics を range と artifact set にも同じ
   意味で適用します。
   target が動いたときにどう扱うかは、その動いた理由で決まります。
   - discovery の completion / validity が確定する前に動いた場合、または **手順 7 の
     batch fix 以外**の理由で動いた場合（並行作業、scope 追加、fix と無関係な commit
     等）は、旧 review target / run を現在 target の evidence として扱いません。新しい
     SHA に対して手順 1 の verify をやり直し、re-freeze して必要な discovery をやり直
     します。
   - valid な discovery の後、**手順 7 の batch fix によって**動いた場合は、re-freeze は
     しますが手順を最初からやり直さず、手順 8〜13 へ進みます。
3. **Selection** — 最初に reviewer capability record を読みます。record が存在しない、
   または parse / 最小妥当性 check を通らない場合は、Selection へ進まず停止して
   escalate します。record の `required_selection` に従って required slot を埋め、
   各 reviewer の `default_class` を portfolio 上の default として扱います。
   その上で Selection Contract に従い、artifact classification、reviewer /
   capability、required review 数、target artifact set、expected target
   SHA / applicable な commit range を決めます。commit range を使う場合は、
   対象範囲が曖昧にならない形で確定します。
   target artifact set を確定したら、直近の successful deterministic
   verify evidence が、確定した SHA / range と target artifact set の
   両方をカバーしているかを確認します。selected artifact set をその
   verify evidence がカバーしていると確認できない場合は、確定した
   target に対して手順 1 の deterministic verify を再実行し、成功して
   から手順 4（Execution）へ進みます。
   Executable artifact では原則として独立 reviewer を使います。
   **Mixed classification の場合は、required な review skill をすべて宣言します。**
   宣言した skill と changed artifact set の整合は手順 13 の fence が照合します。
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
   reviewer の trigger へ渡して起動します。起動方法は record の `trigger.kind`
   で分岐します。
   - `comment_command`: `trigger.value` を PR へ comment として投稿します。
     `trigger.target_argument` がある場合は `{target_sha}` を freeze した target
     へ置換して同じ comment に含め、reviewer の結果自体が reviewed target を
     持つようにします。
   - `automatic`: 明示的な起動は行わず、observed な participation evidence を
     待ちます。expected trigger behavior は completion evidence と同義では
     ないため、evidence が得られなければ `unknown` として扱います。
   - `operator_configured`: repository code の外側の設定に依存します。
     設定変更を repository code から完了したものとして扱わず、unavailable
     なら fallback order に従います。
     record に宣言されていない reviewer は formal acquisition になりません。
     trigger 方法、実際に渡した target と artifact set、required context を記録します。

   起動した時点で、その run を後から一意に特定できる run anchor として、起動直前の
   ISO-8601 timestamp を記録します。`--run-anchor-id` はこの時点では値を持ちません
   （state evaluator は reviewer の result 自身の `sources[].surface_id` と照合するため、
   その result が届く前の trigger comment の ID 等を渡しても一致しません）。この
   timestamp anchor は手順 5 の state evaluator と手順 13 の merge-ready fence の両方で
   `--run-after` として同じ値を再利用します。session の記憶や再計算ではなく、この時点で
   記録した値をそのまま運びます。手順 9 の second full discovery、手順 10 の targeted
   closure も同様に、それぞれの起動時点で新しい run anchor（timestamp）を記録し、その
   ラウンド自身の Acquisition & Validity 確認に使います。closure を経由した場合、手順 13
   の merge-ready fence が使う run anchor は手順 4 のものではなく、手順 10 で記録した
   closure run の anchor です。

5. **Acquisition & state** — reviewer の run ごとに `tooling/review-evidence.mjs` を
   fresh に実行し、`--state --target-sha <sha>` に加えて手順 4 で記録した run anchor を
   `--run-after <timestamp>` として渡し、state evaluator を実行します。
   state output の `state`、`coverage_complete`、`evidence`、`reason_codes` を記録します。
   **あわせて、triage の対象にする result の `canonical_id` と
   `evidence[].revision.body_digest` を記録します。** review result は in-place で編集
   され得るため、この revision は手順 13 の fence が current revision と照合します
   （`policy/core.md` の Acquisition & Validity Contract）。
   target-bound completion、run state、coverage、および binding の規範的な扱いは、いずれも
   `policy/core.md` が定めます。`completed@target` は current target に target-bound
   evidence があり、coverage が complete な場合だけです。draft / pending ownership、
   actor attribution 不明、binding 不明、または fetch incomplete は positive completion に
   使いません。`not-bound` は別 target の完了です。`rate-limited` / `failed` / `declined` は
   explicit signal と complete coverage が必要です。`in-flight` と `unknown` は
   terminal failure ではありません。preamble、acknowledgement、silence、空の snapshot
   を 0 findings や failure に変換しません。
6. **Required review gate & aggregate / triage** — state と run record を
   `policy/core.md` の Acquisition & Validity Contract に照合します。state は finding
   の有無を表しません。required run が揃った後の finding の集約と Resolution は同
   Contract に従います。ancestor target の finding も target 移動だけでは discharge
   しません。Selection Contract で required とした review 数ぶんの `validity: valid` な
   run が揃うまで triage へ進みません。揃わない run（invalid / unknown / failure）の
   扱いは Failure / retry（`policy/core.md`）に従います。finding の集約対象は valid な
   run に限りません。`validity` は evidence 軸の判定であり、finding を捨ててよい根拠
   ではありません。重大 finding を dismiss する際の確認要否は Resolution Contract に
   従います。
   rate-limit marker を観測したら復帰を待ちません。record の `fallback_order` で次の
   reviewer へ進み、Selection amendment を記録します。待つのは in-flight な run の終端
   だけです。advisory member の completion は待たず、blocker にしません。ただし
   merge-ready 判定までに review surface へ到着した finding は、class に関係なく
   triage / Resolution の対象です。
7. **Batch fix + root-cause** — Resolution Contract に従い、accepted finding が
   あれば root-cause ごとにまとめて fix します。fix 後は candidate SHA を re-freeze
   し、必要な deterministic verify と targeted closure を行います。state evaluator
   は fallback を実行せず、fallback policy は `policy/core.md` に委ねます。
8. **Deterministic verify** — 手順 7 の batch fix によって candidate SHA が
   変更された場合のみ、fix 後に手順 1 の verify を再実行し、記録した verify SHA を
   更新します。
9. **Second full discovery（条件付き）** — Review stopping rules
   （`policy/core.md`）に従って 2nd full discovery が必要と判断された
   場合のみ、targeted closure の前に行います。現在の post-fix SHA を second discovery
   target として re-freeze し、Selection Contract をこの second discovery stage へ適用し、
   確定した target artifact set まで直近の successful deterministic verify evidence が
   カバーしているかを確認します。カバーしていると確認できない場合は、確定した
   second discovery target に対して deterministic verify を再実行し、成功してから
   Execution へ進みます。その上で Execution Contract に従って full discovery
   （独立 reviewer）を起動します。
   Acquisition & Validity Contract をこの discovery run に適用します。Selection で required
   とした review 数ぶんの valid run が揃うまで triage へ進みません。揃わない run の
   扱いは Failure / retry（`policy/core.md`）に従います。finding は Resolution Contract で
   triage し、手順 6 と同じく集約対象は valid な run に限りません。accepted finding が
   あれば、手順 7 と同じ batch fix semantics でまとめて fix し、その fix によって
   target が変わった場合、手順 8 と同じ deterministic verify を行います。
   fix による変更を超えて target が動いた場合（例えば commit range の一方の endpoint や
   target artifact set が accepted fix と無関係に変わった場合）、その独立した変更分は
   手順 2 の non-fix target mutation semantics に従い、targeted closure だけでは扱いません。
   second discovery の実行中、または completion / validity 確定前後に accepted fix 以外の
   理由で target が変わった場合も同じ扱いです。
   この second discovery の accepted finding の fix について、さらに追加の discovery
   round が必要と判断される場合、3rd full discovery は起動せず merge もせず、Review
   stopping rules（`policy/core.md`）に従って upstream task/design の不安定さを疑い、
   必要に応じて escalate します。
10. **Targeted closure** — この review flow で accepted finding の fix
    によって target が変更された場合のみ（手順 9 の second full
    discovery を挟んだ場合を含む）行います。最終的な post-fix SHA を
    closure target として re-freeze し、Selection Contract に従ってこの closure target
    を expected target として確定し、確定した closure artifact set まで直近の
    successful deterministic verify evidence がカバーしているかを確認します。
    カバーしていると確認できない場合は、確定した closure target に対して
    deterministic verify を再実行し、成功してから Execution Contract に従って
    closure run を起動します。起動した時点で、この closure run 専用の run anchor を
    新たに記録します（手順 4 の anchor をそのまま使い回しません）。
    Review stopping rules（`policy/core.md`）に従い、fix した箇所に対応
    する範囲のみ再確認します。
11. **Closure Acquisition & Validity** — この review flow で accepted
    finding の fix によって target が変更された場合のみ（手順 9 を
    挟んだ場合を含む）、この closure target を expected target として、
    targeted closure の review run に手順 5 と同じ Acquisition & Validity
    Contract を適用し、completion / acquisition / validity を確認します。
    手順 10 で記録した run anchor を使います。手順 5 と同様に、triage の対象に
    する result の `canonical_id` と `evidence[].revision.body_digest` を
    記録します。
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
    この review flow で accepted finding の fix による target 変更が一度も発生して
    いなければ、required review 数の valid discovery と Resolution（手順 6）が完了した
    時点で semantic な条件が揃います。target 変更が発生していれば（手順 9 を挟んだ
    場合を含む）、手順 6 の discovery Resolution（手順 9 を使った場合はその Resolution も
    含む）と、Closure Acquisition & Validity・Closure Resolution の完了が必要です。
    discovery Resolution と closure の完了順序は問いません。

    そのうえで、宣言の直前の最後の action として merge-ready fence を実行します。
    run anchor は、この review flow で最後に起動した run の trigger 時点
    （closure を経由していなければ手順 4、経由していれば手順 10）で記録した
    timestamp を再利用します。acknowledged revision は、対応する Acquisition &
    Validity 確認（closure を経由していなければ手順 5、経由していれば手順 11）で
    記録したものを再利用します。

    ```text
    node tooling/merge-ready-fence.mjs --repo <owner/repo> --pr <number> \
      --target-sha <frozen target> --base-sha <frozen base> \
      --artifacts-file <frozen artifact set> --verify-sha <手順 1/8 の verify SHA> \
      --required <reviewer-id> --declared-skill review-code \
      --acknowledged-file <手順 5（または closure 時は手順 11）で記録した canonical_id=body_digest> \
      --run-after <手順 4（または closure 時は手順 10）で記録した run anchor>
    ```

    fence は machine-checkable な precondition だけを評価します。`pass`（exit 0）の
    場合にのみ merge-ready を宣言できます。`fail`（exit 1）と `unknown`（exit 2）は
    どちらも merge-ready ではありません。`unknown` を `pass` として扱わないでください。
    fence output はそのまま durable evidence として記録します。
    fence が pass しても、それは merge-ready の成立そのものではありません。expected /
    optional member を含む review obligation の充足と Resolution の完了は semantic な
    判断であり、`policy/core.md` の Merge-ready completion fence が定めます。
    review-relevant な state 変化があった場合の fence 無効化も同節が定めます。

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
       -> merge-ready fence
       -> merge
  -> accepted fix が無く review target が変更されていない場合:
       required review 数の valid discovery と Resolution の完了
       -> merge-ready fence
       -> merge
```

## Adapter boundary（manual pilot）

provider 固有 adapter がまだ無い間は、`trigger()` / `pollCompletion()` /
`collectOutputs()` / `normalizeFindings()` を人手で埋めます。

- `trigger()`: record の `trigger` に従って起動し、どう起動したかを記録します。
- `pollCompletion()`: `tooling/review-evidence.mjs --state` を fresh target と
  run anchor 付きで実行し、reduced state output と canonical object の sources /
  current revision を記録します。`completed@target` だけを target-bound completion
  として扱い、`unknown` / `in-flight` を terminal failure にしません。
- `collectOutputs()`: 同じ helper の `--json` output を durable evidence として保存
  します。reviewer mechanism 自身が外部から確認可能な surface へ結果を残さない場合
  （例: 実装 session 内で動く subagent review）は、`policy/core.md` の Acquisition &
  Validity Contract が定める durable evidence の要求を、その手段で満たします。何を
  persist すれば足りるかは同 Contract が定めます。
- `normalizeFindings()`: finding の意味付けと Resolution はこの skill の機械判定へ
  複製せず、`policy/core.md` の Resolution Contract に従います。

record が、結果を durable な GitHub surface へ残す trigger 経路を宣言している場合は、
その経路を preferred route として使います。宣言された経路が unavailable / unsuitable で、
in-session / subagent review を formal acquisition として使う場合は、上記
`collectOutputs()` の persist を完了することがその条件です。persist を完了するまで
その run は formal acquisition になりません。この fallback は durable evidence
requirement を免除しません。
