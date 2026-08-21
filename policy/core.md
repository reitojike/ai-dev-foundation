# Foundation core policy

## 正本

この directory は Foundation 全体に適用する規範的なルールの canonical source
です。consumer は生成された adapter を受け取り、生成ファイルは編集対象ではありません。

ルールは次の順序で合成します。

1. Foundation policy: すべての consumer に適用するルール
2. Technology profile: 選択した stack に適用するルール
3. Consumer product rules: 一つの product に固有のルール

## 責務の分離

- **policy** は、必須事項または禁止事項を定義します。
- **skill** は policy を使った作業方法を説明し、規範的なルールを複製しません。
- **profile** は technology または provider 向けに policy を具体化し、
  product-domain rule を含めません。
- **generated adapter** は、合成されたルールを consumer へ配布します。

同じ規範的なルールを Skill、Profile、generated adapter の source に再記述せず、
所有するルールを参照してください。

## Generated adapters

`AGENTS.md` は三つの composition input から生成されます。直接編集しないでください。
`CLAUDE.md` は `AGENTS.md` を参照する thin adapter であり、canonical rule を複製しません。

## Task Protocol

Task の canonical context は Issue 本文です。downstream agent への handoff は Issue を短く
参照し、別の長文 handoff を正本として増やしません。Task Contract は、次の内容を表現できる
contract です。

- Goal
- Acceptance Criteria
- In Scope / Out of Scope
- Decisions / Invariants
- Verification
- Allowed Discretion / Escalate When
- Execution State（Phase: `design` / `implementation` / `review` / `closure`、Role: `high` /
  `balanced` / `fast`）

すべての Task に全項目を機械的に必須化するのではなく、downstream agent が product または
architecture の判断を推測せずに着手できることを目的とします。

Semantic Contract は何を成立させるかを表し、Goal、Acceptance Criteria、Scope、Decisions、
Invariants、Verification で構成します。repository、branch、cwd、sandbox、permission、
available tools、runtime constraints は Execution Envelope として別に扱います。Execution
Envelope の制約や事故を semantic decision として吸収してはいけません。

Task Contract は Semantic Contract と同義ではありません。Allowed Discretion / Escalate When
と Execution State は Task Contract の handoff/control context です。

### Role routing

Role は provider-neutral な意味で選びます。

- **High**: product、architecture、protocol の判断、曖昧性解消、または複数の妥当解からの
  選択が残る。
- **Balanced**: intent と主要 decision は固定済みだが、実装上の裁量または局所設計が残る。
- **Fast**: correctness をほぼ機械的に判定でき、semantic choice が小さい。

Task 開始時には次を診断します。

1. Goal と Acceptance Criteria を一意に解釈できるか。
2. 必要な product、architecture、policy の decision は固定済みか。
3. 残りの correctness を主に機械的に判定できるか。

1 または 2 が No なら High、1 と 2 が Yes で 3 が No なら Balanced、1 から 3 が Yes
で裁量が小さければ Fast とします。これは数値スコアや絶対的な不変条件ではない diagnostic
heuristic です。

### Handoff and escalation

Task boundary と agent/session boundary は一致しません。一つの Task を複数の agent で
処理してよく、一つの agent が複数工程を継続しても構いません。High から Balanced への
handoff を毎 Task で義務化しませんが、High role を終える時点では、次の agent が product
または architecture choice をせず実装できる状態にします。

- **planned handoff** は、Issue を canonical context として短く参照し、Semantic Contract に
  加えて Allowed Discretion / Escalate When と Execution State の handoff/control context を
  失わず次の工程または agent に渡すことです。これは長文 handoff への複製を要求しません。
- **capability escalation** は、必要な技術的能力、tool、または専門的な adjudication を得ることです。
- **authority escalation** は、product intent、権限、または受容不能な trade-off を決める
  authority に判断を求めることです。

未確定の product または architecture decision に遭遇した実装 agent は、silent decision を
してはいけません。pure technical dispute は原則として technical adjudication で解決し、
人間を message bus にしません。人間への escalation は、product intent、authority、権限、
または受容不能な trade-off に限ります。

## Review Protocol

Review の canonical context は本節です。
本節は generated adapter として配布される自己完結した規範的内容であり、
実行手順（review skill）は Foundation リポジトリ側に別途保持し、
本節の規範的なルールを複製しません。
Review Protocol は provider 名や model 名を Kernel に固定しません。

### Artifact classification

Review 強度と停止条件は artifact の種類で分けます。

- **Executable**: TS/TSX/SQL/workflow/config 等、実行される、または実行に影響するコード。
  deterministic verify を先に実行し、candidate SHA を freeze した上で、原則として独立
  AI reviewer による discovery -> triage -> batch fix -> verify -> targeted closure を行います。
- **Normative**: AGENTS / Skill / PRODUCT / ARCHITECTURE / ADR 等、後続 agent や実装を
  拘束する文書。mechanical markdown check の後、semantic discovery は原則 1 round とし、
  triage / fix の後は closure verification のみを行います。重要な normative contract は
  独立 reviewer を 2 系統使ってよいですが、各 reviewer の discovery は 1 回を基本とします。
- **Informational**: README / research note / log 等。mechanical check を中心とし、
  open-ended AI review を通常の merge gate にしません。

### Review contracts

Review は次の 4 つの provider-neutral な contract で表現します。provider 差分は Review
Adapter boundary へ閉じ込め、Kernel に固定しません。

各 Contract は discovery だけでなく、同じ Contract を使って起動する closure review run
にも適用されます。closure target も Selection Contract で expected target として確定し、
Execution Contract に従って起動します。Selection Contract が required review 数を
定めた review stage では、discovery か closure かを問わず、その required 数の
completed かつ valid な run が揃うまで triage / Resolution / merge / review
completion へ進みません。不足する run の扱いは Failure / retry に従います。

Selection Contract で required とした review stage（discovery、2nd full
discovery を含む）の finding は、その stage で accepted fix があったか
どうかに関係なく、Resolution Contract に従って Resolution が完了するまで
merge / review completion へ進みません。同じ review flow で複数の
discovery stage を行った場合は、実行した discovery stage すべての
Resolution が完了している必要があります。discovery Resolution を closure
より先に完了させる順序を強制するものではなく、merge / review completion
の時点で揃っていれば十分です。

#### Selection Contract

- artifact classification
- reviewer / capability の選択
- required review 数
- target artifact set
- expected target SHA / commit range

#### Execution Contract

- trigger 方法
- Selection で確定した expected target SHA / commit range
- Selection で確定した target artifact set
- required context
- timeout / retry policy

Selection Contract で確定した expected target（SHA / commit range）と
target artifact set は、Execution で reviewer の trigger へ渡し、実際に
渡した target と artifact set を記録します。commit range を選択した場合に
head SHA だけへ黙って縮退させないのと同様に、target artifact set も途中で
黙って縮小・変更しません。

provider 固有の surface や capability は adapter/profile 側へ置き、Kernel に固定しません。

#### Acquisition & Validity Contract

**CI status は review completion と同義ではありません。** status/check の green 化のみを
review 完了の証跡にしてはいけません。

review run ごとに少なくとも次を記録可能にします。

```json
{
  "reviewer": "...",
  "target_sha": "...",
  "status": "completed",
  "validity": "valid",
  "finding_count": 0,
  "result_locator": "...",
  "started_at": "...",
  "completed_at": "...",
  "failure": null
}
```

record の `target_sha` は、Selection Contract の expected target（SHA / commit
range）ではなく、実際に reviewed された SHA / range（observed target）を表します。
`validity` は少なくとも `valid` / `invalid` / `unknown` を表現します。

Completion は少なくとも次を要求します。

- run が terminate している
- required surface を取得済み
- finding count が known
- quota / timeout / structural な execution / acquisition failure がない

Validity はさらに次を要求します。

- reviewed SHA / range が intended target と一致している
- intended artifact set が review 対象になっている
- required context へアクセスできた
- execution / acquisition が途中で欠落していない

Validity の判定は、reviewed target を確定させた上で、Selection Contract の
expected target と比較して行います。reviewed target は次のように確定します。

- record の `target_sha` と acquired evidence 上の reviewed target が
  両方存在する場合、両者は一致していなければなりません。
  一致しない場合は invalid です。
- reviewed target を Validity 判定に必要な精度で確認できない場合は unknown
  です。

確定した reviewed target が expected target と一致しない場合、
completion していても invalid です。この場合、record は `status: completed`
かつ `validity: invalid` として表現します。
intended artifact set が review されていない場合も invalid です。

**acquisition の record は、後続 session から独立に recoverable な場所へ
persist されて初めて durable evidence です。** review を行った
agent/session が終了した後、別の後続 session がその session の記憶に
頼らず参照できる場所（PR/Issue 上の comment 等）に record が存在しない
限り、その run を merge / review completion の根拠として扱いません。
reviewer mechanism 自身がそのような外部から確認可能な surface へ結果を
残さない場合（例: 実装 session 内で動く subagent review）は、その run の
record を上記の record schema に沿った内容で、そのような場所へ明示的に
persist しない限り、session 終了後には recoverable な evidence として
扱いません。reviewer mechanism が残す surface に、reviewed target・
finding 内容・completion 状態を後続 session が独立に判定できる形で
含んでいる場合は、その surface 自体をこの record の recoverable な
representation として扱ってよく、別途 record を post し直す必要は
ありません。

**0 findings は positive evidence を必要とします。** reaction なし、comment なし、
parser 0 件、status success のみを `no findings` へ変換してはいけません。positive
completion evidence のない empty output は `unknown` として扱います。

review run の状態は少なくとも `none` / `unknown` / `failure` を区別し、混同してはいけません。

#### Resolution Contract

- finding を fix / false-positive / needs-verification / technical-dispute /
  intent-question へ triage する
- human を raw finding の message bus にしない
- pure technical dispute は technical adjudication で解決する
- human escalation は product intent / authority に限る
- P0/P1 相当の重大 finding を dismiss する場合は、
  必要に応じて独立 reviewer の確認を要求する
- accepted finding は drip fix せず、root-cause を確認した上で batch で fix する
- fix 後は全 discovery をやり直さず、targeted closure を基本とする
- review を新しい scope の探索に使わない
- discovery（2nd full discovery を含む）と targeted closure / closure
  verification のいずれの finding も Resolution Contract の対象であり、
  triage category を付けただけでは Resolution 完了ではない。unresolved
  の finding（未解決の needs-verification / technical-dispute /
  intent-question 等を含む）が残る間は、その review stage の Resolution
  は完了せず、merge / review completion の根拠にしない

### Merge readiness and merge authority

本節における review completion（Resolution Contract の完了を含む）が
成立した状態を **merge-ready** と呼びます。Review contracts および
Review stopping rules で `merge` と記述する到達点は、merge-ready の
成立を指し、merge を実行してよいという判断そのものとは同義ではありません。

merge execution authority は、Review Protocol とは別の contract /
context として扱います。current Task、Execution Envelope、または
explicit な authority が merge の実行を許可している場合に限り、agent は
merge を実行してよいです。

merge authority が明示されていない場合、または別 authority の承認が
必要な場合、agent は merge を実行せず、merge-ready の状態を報告した
上で停止し、authority escalation / handoff します。

この分離は、すべての PR で Human diff approval を mandatory にする
ことを意味しません。GitHub の required approval 数を増やす rule でも
ありません。provider や model 固有の rule にもしません。

### Review Adapter boundary

provider 差分は次の 4 つの責務として扱います。Kernel はこの boundary の**形**のみを
定義し、provider 固有の実装や恒久的な capability 台帳を持ちません。

```text
trigger()
pollCompletion()
collectOutputs()
normalizeFindings()
```

収集対象の surface（top-level comment、inline/thread、review submission、status/check、
workflow log、edited comment 等）は provider capability として扱います。「この provider は
この surface に出ない」という negative claim を恒久仕様にしてはいけません。
capability/profile の更新時に再検証可能にします。

収集した evidence は、comment ID / review ID / run ID / timestamp / target SHA
または commit range を可能な範囲で保持します。

### Failure / retry

- transient failure: bounded retry
- quota / rate limit: `unknown` または `failure` として明示し、success に潰さない
- structural capability mismatch: 同じ trigger を無限 retry せず、alternate reviewer /
  escalation
- empty output: positive completion evidence がなければ `unknown`

### Review stopping rules

target が変更された場合、その新しい target に対する mechanical / deterministic
precondition の evidence は自動的に持ち越しません。target 変更後にその target を
review / closure / merge の根拠とする前に、artifact classification が要求する
precondition check（Executable の deterministic verify、Normative の mechanical
check）を新しい target に対して再成立させます。
review / closure / merge の根拠として使う precondition evidence は、review 対象
として確定した（freeze / Selection された）target と一致していなければなりません。
一致しない場合はその evidence を根拠にせず、確定した target に対して precondition
check を再実行します。

この一致確認は SHA / range だけでなく、selected target artifact set にも
及びます。Selection で確定した target artifact set が、その precondition
check の対象 scope に含まれることを確認します。precondition check を
Selection より前に実行した場合は、Selection 後にこの binding を確認し
ます。selected artifact set を precondition evidence がカバーしていると
確認できない場合は、確定した target に対して precondition check を
再実行してから先へ進みます。

precondition evidence だけでなく、discovery / closure evidence も target-specific
です。valid な discovery の後、accepted-fix による closure target の変更以外の
理由で review target が変わった場合、その discovery を新しい target の
merge / completion evidence として使いません。新しい target について artifact
classification が要求する precondition check を再成立させ、Selection / Execution
を再確立した上で、その target に必要な discovery を行います。accepted fix による
target 変更は、既存の targeted closure（Executable）/ closure verification
（Normative）の扱いに従います。

この節における review target は、Selection Contract で確定した expected
target SHA / commit range と target artifact set の組を指します。どちらか
一方でも変われば review target の変更です。head SHA が不変でも commit
range の endpoint が変わった場合、また expected target SHA / commit range
が不変でも target artifact set が変わった場合も、review target の変更と
して同じ scope です。この場合も、old discovery / closure evidence を
新しい target の merge / completion evidence として使いません。

closure Resolution で accepted fix が生じ、その fix を closure review で
確認する cycle（Executable の targeted closure、Normative の closure
verification のいずれも）が繰り返し発生する場合、無制限に継続せず、
upstream task/design または policy/document 自体の instability を疑い、
必要に応じて escalate します。これは Failure / retry の retry count とは
別の stopping semantics です。

Code review:

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
       -> fix が behavior / blast radius を materially 変えた場合のみ:
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
に targeted closure をやり直します。2nd full discovery を使用済みでなお
full discovery が必要なら、3rd full discovery は起動せず、merge もせず、
upstream task/design の不安定さを疑い、必要に応じて escalate します。
追加の full discovery が不要なら、targeted closure をやり直します。
accepted fix が無く review target が変更されていない場合は、
required review 数の valid discovery と Resolution の完了をもって、
新たな closure run を要求せずに merge できます。

full discovery は原則 1 round です。fix が behavior / blast radius を materially
変えた場合のみ 2 round 目を許容します。それ以上必要な場合は review loop を増やさず、
upstream task/design の不安定さを疑います。
2nd discovery の accepted finding を fix した後も、その fix が behavior /
blast radius をさらに materially 変えた場合は、3rd full discovery を起動
せず、targeted closure だけで merge へ進まず、upstream task/design の
不安定さを疑い、必要に応じて escalate します。

Normative document review:

```text
mechanical check
  -> mechanical check target と Selection target の consistency 確認
  -> semantic discovery（1 round）
  -> triage / fix
  -> accepted finding の fix で review target が変更された場合:
       mechanical check
       -> closure target の Selection / Execution
       -> closure verification
       -> closure completion / acquisition / validity 確認
       -> closure finding の Resolution
       -> semantic discovery の Resolution 完了
       -> 完了
  -> accepted fix が無く review target が変更されていない場合:
       required review 数の valid semantic discovery と Resolution の完了
       -> 完了
```

accepted finding の fix によって review target が変更された場合のみ、
新しい target に対して mechanical check を再実行してから closure
verification を行い、その review run も Acquisition & Validity Contract
に従って completion / acquisition / validity を確認します。closure
verification の finding も Resolution Contract の対象とし、Resolution が
完了するまで review を完了しません。
closure verification の Resolution に加えて、semantic discovery（手順 3）
の Resolution が完了していることも review completion の条件です。完了
順序は問いません。
accepted fix が無く review target が変更されていない場合は、
required review 数の valid semantic discovery と Resolution の完了をもって、
新たな closure run を要求せずに review を完了できます。

### Observed evidence is not a permanent provider rule

Review Protocol の contract は実測された failure mode を反映しますが、observed な
provider 挙動を Kernel の恒久 rule にはしません。expected trigger behavior は
completion evidence と同義ではありません。expected trigger behavior に反して
completion evidence が得られない場合は、trigger 前提を疑い、Acquisition & Validity
Contract に従って `unknown` として扱います。特定 provider が常に特定の trigger 方法を
要求するという恒久仕様は Kernel に置かず、observed evidence として capability/profile
側で再検証可能な形にします。

## Foundation Change Protocol

Foundation 自身の canonical rule を変更する場合の、provider-neutral な
最小 contract です。この protocol は Skill / Profile へ複製せず、変更を
検討する際は本節を参照します。

Observation は、そのままでは Issue や mandatory rule へ自動的に昇格しません。

### Observation trigger

Task 実行中に少なくとも次のいずれかを観測した場合、Foundation Observation
候補として扱います。これらが発火しない限り、Task ごとに Foundation
改善点を探索する追加工程は要求しません。

1. Foundation の rule / profile / tooling に従っても material correctness
   が成立しない
2. Task 完了のため Foundation の迂回・上書き・補完 workaround が必要になる
3. correctness / security / authority のため、Foundation が定義していない
   manual step が必要になる
4. provider / runtime の実挙動が、Task で依拠した前提と食い違う
5. 同一 root cause と思われる friction / workaround を以前にも観測している

### Observation classification

Observation trigger が発火したら、症状の重大度ではなく root cause /
ownership を軸に、次の 4 分類のいずれかへ分類します。

- `consumer-local`: product / domain / consumer 固有で自然に閉じる
- `provider/runtime`: 外部 provider / runtime の挙動で、Foundation
  contract 自体の欠陥ではない
- `Foundation candidate`: shared problem / improvement candidate に
  なり得るが、Foundation-owned な rule / profile / tooling / artifact
  自体が誤った挙動を要求・生成・許容していると確認されたわけではない
  （Foundation-owned だと分かっていても、確認された defect ではない
  改善余地を含む）
- `canonical defect candidate`: Foundation-owned な rule / profile /
  tooling / artifact 自体が誤った挙動を要求・生成・許容していると
  確認できる場合に限る（正しく機能している manual step を自動化・
  簡略化できるという改善余地だけでは、この分類に含めない）

`provider/runtime` に分類した Observation でも、Foundation がその挙動を
誤って恒久前提として固定している場合は、Foundation 側の candidate として
再評価します。

### Observation recording

Observation trigger の発火は、自動的に Foundation Issue を作りません。
Observation は work item ではありません。

将来の Foundation 判断へ再利用する価値がある場合、発生した consumer Task
の canonical Issue へ、少なくとも次を短く記録します。

- Observed / evidence locator
- Classification
- Impact
- Local handling
- Foundation action: `none` / `observe` / `change proposal candidate`
- Promotion signal（何が起きれば再評価するか）

consumer-local で完結し、将来参照価値もない軽微な事象は、この記録義務の
対象にしません。専用の ledger / database / schema、GitHub label 体系、
bot / collector / dashboard / statistics、自動 Issue 生成、定期棚卸しの
mandatory 化は Observation handling の一部にしません。

### Task closure と Observation

Task closure は新しい Foundation 改善点を探索する工程ではありません。
Task 中に Observation trigger が発火していた場合、未分類のものは必ず
classification を完了します。加えて、上記の記録義務があるのに未記録の
ものがあれば記録してから Task を完了します。記録義務の対象にしない
軽微な事象について省略できるのは記録だけであり、classification の
完了は省略しません。

### Foundation Change の正当化条件

mandatory な Foundation change は、原則として次のいずれかで正当化します。

1. 既存の mandatory / manual step を置き換える
2. material defect を deterministically 防止する
3. demonstrated recurring / escaped failure へ対処する

Change Proposal は、少なくとも次を表現できるものとします。

- Problem
- Evidence
- Proposed Change
- Expected Effect
- Trade-off
- Scope
- Success Criterion

### Observation から Change Proposal への昇格

Observation classification は、本節の 3 つの Foundation Change 正当化
条件を置き換えず、緩和しません。特に次は強い promotion signal になり
得ます。

- Foundation 自身の material defect が実証された
- material defect を deterministically 防止できる
- 同一 root cause が recurring / escaped failure になった
- correctness のための mandatory manual ritual が定着した
- consumer-local workaround では canonical semantics の fork が必要に
  なる

change class や review 強度は、固定の provider 名へ結びつけません。単発の
friction、style、prompt nicety、効率改善のみを理由に、自動的に mandatory
化しません。
