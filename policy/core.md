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

## Human-facing output language

human-facing output（人間が読むために agent が作成・編集する成果物）の
既定言語は、その project が持つ既定言語に従います。少なくとも次を対象と
します。

- Issue / PR の title・body・comment
- review finding / triage / Resolution / closure の durable evidence comment
- planning checkpoint、handoff、completion report
- セッション中の人間向け progress report・final report
- agent が生成・編集する Markdown / documentation

一方、次は human-facing output の既定言語に関わらず、無理に翻訳せず原語
（多くの場合英語）のまま保持します。

- source code / identifier / symbol / API / library / framework name
- file path / command / script name
- schema / enum / protocol field 等の machine-facing text
- error / log / provider-native output の引用
- externally defined technical term / proper noun

human-facing な地の文の中に、上記の technical vocabulary を原語のまま
混在させることは許容します。検索性や意味精度を落とす過剰な翻訳はしません。

project が既定言語を明示していない場合、agent は言語を仮定せず、その
project の既存 human-facing artifact や communication から観測できる
言語に合わせます。

project 自身の既定言語が何であるかは Foundation Kernel が固定する対象
ではありません。技術非依存な Foundation policy はこの節の reusable な
原則までとし、特定の project がどの言語を既定とするかは、その project
の Consumer product rules、または Foundation 自身のように project が
自らを consumer として扱う場合は project 自身の repo-local instructions
へ記録します。Technology profile は technology/provider 向けの具体化に
限定し、project の既定言語を持ちません。

Review Protocol の Selection Contract / Execution Contract / Acquisition
& Validity Contract / Resolution Contract、および `target_sha` /
`finding_count` 等の record schema field 名は、この節の対象外の
machine-facing structure として英語のまま保持します。これらの contract
を説明する human-facing な本文は、この節の既定言語に従います。
provider-native bot 自身が固定言語で出力する内容は、この節に対する
Foundation violation として扱いません。agent が自ら作成する durable な
summary / resolution comment は、この節の既定言語に従います。

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

### Thin invocation over a canonical Task Contract

Task の canonical context は Issue 本文です（本節冒頭）。この canonical
Task Contract が既に Issue 本文へ存在する場合、agent invocation はその
内容を原則として再掲せず、Issue を参照します。長い session-local prompt
がなければ Task を再開できないことを目指すのではなく、durable な Issue
本文から新しい agent/session が作業を再開できることを目指します。

canonical Task Contract が存在する場合、invocation / handoff prompt へ
含めるのは原則として次に限定します。

- canonical Task Contract の locator
- handoff 値を current と仮定せず、current state を再取得する指示
- Task Contract へまだ materialize されていない session 固有の追加
  decision / constraint
- execution authority
- stopping condition
- 必要な review / verification への pointer（詳細が canonical guidance に
  ある場合は再掲しない）

canonical Task Contract に既に存在する background / scope / Acceptance
Criteria / design constraint 等を、理由なく invocation prompt へ複製しま
せん。

material な追加 decision が session を跨いで継続的に必要になる場合は、
可能な限り durable な Issue 本文へ materialize した上で、invocation
からはそれを参照します。invocation prompt 自体を追加 decision の正本に
しません。

短い prompt 自体を目的にしません。canonical Task Contract が不十分な場合
や、緊急の session-local constraint がある場合は、必要な情報を invocation
へ含めてよく、機械的な短文化のために欠落させてはいけません。canonical
Task Contract の不足に気付いた場合は、省略ではなく Task Contract 自体の
更新を優先します。

thin invocation は、受け手の agent/session が Issue 本文へアクセスできる
ことを前提とします。この access 可否は available tools 等の Execution
Envelope に属し、Semantic Contract の充足度とは独立です。受け手が Issue
本文へアクセスできることを保証できない場合、locator の提示だけで済ませ
ず、必要な Task Contract の内容を invocation へ直接含めます。

この convention は provider-neutral です。特定の CLI、agent runtime、
または model 向けの invocation format を Kernel に固定しません。新しい
prompt schema / DSL / generator の導入を要求しません。

### Issue closure and Acceptance Criteria completion

Task Contract の completion は、Review Protocol の merge-readiness（Merge readiness
and merge authority）とは別の contract です。merge-ready の成立、または実際の merge
は、canonical Issue 上の Acceptance Criteria が満たされたことの証跡にはなりません。
Review が完了していても、Issue Task Contract 上の Acceptance Criteria 確認を省略して
よいことにはなりません。canonical Issue を completed として close する判断は、この
節に従います。

canonical Issue を completed として close する前に、少なくとも次を行います。

1. **canonical context の再取得** — close しようとする session 自身の記憶や過去の
   長文 handoff をそのまま正としてはいけません。close 直前に、current Issue 本文
   （canonical Task Contract）と、merge 済み current main または applicable branch
   の状態を再取得します。
2. **Acceptance Criteria evidence 照合** — Acceptance Criteria を 1 項目ずつ、
   実装・test・PR・review・merge 後の状態等の evidence と個別に照合します。「実装が
   完了したように見える」という印象だけでは充足の根拠にしません。
3. **checkbox 更新** — evidence で明確に充足を確認できた項目だけ checkbox を更新
   します。checkbox 更新は見た目上の cleanup ではなく、Task Contract completion
   evidence の一部として扱います。
4. **未達・判断不能な項目の扱い** — evidence 不足または未達で判断できない Acceptance
   Criteria が 1 件でも残る場合、その項目を勝手に check せず、Issue も close しません。
   Issue に Acceptance Criteria が存在しない場合、close のために新たな Acceptance
   Criteria を捏造しません。
5. **completion comment** — final SHA、verification 結果、review evidence
   （Review Protocol の Acquisition & Validity Contract に従う record / result
   locator を含む）、および未解決事項を、Issue 上の completion comment として
   記録します。

推奨する sequence は次のとおりです。

`merge/current main 確認 -> Acceptance Criteria evidence 照合 -> checkbox 更新 ->
completion comment -> Issue close`

Issue close の execution authority は、Merge readiness and merge authority と同じ
分離に従います。current Task、Execution Envelope、または explicit な authority が
close の実行を許可している場合に限り、agent は Issue を close してよいです。authority
が明示されていない場合、または別 authority の承認が必要な場合、agent は Issue 本文の
編集や close を実行せず、どの Acceptance Criteria がどの evidence で満たされているか
（または未達か）を手順 5 の completion comment として明示的に残した上で停止し、
authority escalation / handoff します。

auto-close keyword（例: PR 本文の "Closes #N"）によって Acceptance Criteria 確認前に
Issue が自動 close される運用を、標準運用にしません。

この protocol は、GitHub Issue checkbox 専用 bot、generalized project-management
workflow engine、または新しい orchestrator を要求しません。

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
- **Normative**: AGENTS / Skill / PRODUCT / PRD / ROADMAP / UX-UI / ARCHITECTURE / ADR 等、
  後続 agent や実装を拘束する文書。mechanical markdown check の後、semantic discovery は
  原則 1 round とし、triage / fix の後は closure verification のみを行います。重要な
  normative contract は独立 reviewer を 2 系統使ってよいですが、各 reviewer の discovery
  は 1 回を基本とします。
- **Informational**: README / research note / log 等。mechanical check を中心とし、
  open-ended AI review を通常の merge gate にしません。PNG / JPEG 等の raster image asset
  も、product asset か documentation image かを問わずここに含みます（open-ended AI review
  が読む text semantics を持たず、この性質は用途で変わらないため）。text であり実行され得る
  内容を持ち得る SVG は raster image ではなく、ここに含みません。

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
- expected review set（下記）
- target artifact set
- expected target SHA / commit range

**expected review set は、agent が選択した reviewer だけでは閉じません。** agent が
選択していなくても、その repository / review target に対して review を行う reviewer が
存在し得ます。Selection では次の和集合を expected review set として確定します。

1. **required** — Selection Contract で明示的に required とした reviewer。
   required review 数を満たす対象であり、その review obligation は merge /
   review completion の blocker です。
2. **expected** — required ではないが、次のいずれかに該当する reviewer。
   required review 数には算入しませんが、その review obligation は merge /
   review completion の blocker です。
   - consumer が configured automatic reviewer として明示している
   - 取得済み evidence が、その actor による review 行為をその review target 上で
     識別させる。**この判定は current target に限りません。** 同じ review flow の
     中で、ancestor target を含むいずれかの target 上で review 行為を識別できた
     actor は、以降の target でも expected member として残ります。target が移動
     しただけで member から外してはいけません
3. **optional / advisory** — consumer が advisory と宣言した reviewer。target
   completion state が `unknown` であること自体は blocker にしません。ただし actual
   finding が観測された場合、その finding は Resolution Contract の対象です。

一つの actor が複数の class の条件を満たす場合、**consumer による明示的な宣言が
observed evidence に優先します**。consumer が advisory と宣言した reviewer は、実際に
review 行為を行っても optional のままです（その finding は Resolution Contract の対象
です）。consumer が required と宣言した reviewer は、他の条件にかかわらず required です。

consumer が reviewer を required / configured automatic / advisory のいずれとして宣言
するかは、consumer-owned な **reviewer capability record** に置きます。Kernel はこの
record が存在すること、および Selection がそれを参照することを要求します。record の
schema / template と、その存在 / parse / 最小妥当性の check は Foundation tooling /
profile 側が提供し、record の内容は consumer-owned のままです。record は portfolio 上の
default を表すものであり、当該 Task の required / expected obligation の正本ではありません。
それは従来どおり Selection Contract が確定します。

2 の後者について、actor を expected member とする根拠は、その surface item 自体が
**review participation として識別できる**ことです。review target 上に presence が
あるだけでは足りず、次は単独では expected member 化の根拠になりません。

- 通常の human comment（議論・質問・進捗報告等）
- CI actor（workflow / status / check の author であること）
- review 以外の目的で投稿する bot

どの surface item が review participation を構成するかの識別は Review Adapter
boundary の責務です。Kernel は上記の membership 境界と、**その actor を expected
member とした根拠を記録すること**のみを要求し、provider 名や surface 名の固定列挙を
持ちません。

reviewer が非参加を positive に宣言している場合、その状態を `unknown` と区別して
表現してよく、**expected / optional の member については、その reviewer の target
completion state を理由に blocker としません**。

**非参加の宣言は、その reviewer が既に出した finding の Resolution obligation を
discharge しません。** ancestor target で出した finding についても同じです。非参加の
宣言が免除するのは、その target について新たな completion evidence を得ることだけです。

**required member は非参加の宣言によって blocker から外れません。** required とした
reviewer が非参加を宣言した場合、その required review obligation は消えず、valid な
代替 run を得るか、Selection Contract を明示的に変更して required 構成を確定し直す
まで、merge / review completion へ進みません。非参加の宣言を、required review 数の
gate を迂回する経路にしてはいけません。

expected review set は、consumer が明示しておらず、かつ**この review flow のいずれの
target 上にも**まだ review participation evidence を出していない reviewer を含め
られません。ancestor target で participation evidence を出している reviewer は、
上記の carry-over により member です。この residual
limitation を、reviewer の不在を `0 findings` とみなす根拠にしてはいけません。
configured automatic reviewer を明示するかどうかは consumer-owned な選択です。

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

reviewed target をどの field / surface から確定するか、複数表現の間でどの binding を
優先するか、および確定した reviewed target を expected target と照合する手順は、
Foundation-owned な deterministic evaluator が所有します。その手順を本節に置きません。
本節が定めるのは次の invariant です。

- **reviewed target を Validity 判定に必要な精度で確認できない場合、その binding は
  成立しておらず、判定結果は `unknown` です。** review target の移動に追随して値が
  変化する field / surface を binding の根拠にしてはいけません。
- 確定した reviewed target が expected target と一致しない場合、completion していても
  invalid です。この場合、record は `status: completed` かつ `validity: invalid` として
  表現します。intended artifact set が review されていない場合も invalid です。

**acquisition の record は、後続 session から独立に recoverable な場所へ
persist されて初めて durable evidence です。** review を行った
agent/session が終了した後、別の後続 session が session の記憶に頼らず、
本 Contract が定義する Completion と Validity の要求事項を独立に判定
できるだけの情報が、その後続 session からアクセス可能な場所（PR/Issue
上の comment 等）に存在しない限り、その run を merge / review completion
の根拠として扱いません。reviewer mechanism が外部から確認可能な surface
へ残す結果に、その判定に必要な情報が既に含まれていれば、その surface
自体をこの record の recoverable な representation として扱ってよく、
別途 record を post し直す必要はありません。含まれていない場合
（reviewer mechanism 自身がそのような surface へ結果を残さない場合、
例えば実装 session 内で動く subagent review を含む）は、上記の record
schema の各 field に加え、Completion と Validity の要求事項を独立に判定できる
情報を、そのような場所へ明示的に persist しない限り、session 終了後には
recoverable な evidence として扱いません。record schema 自体（特に
`validity` field）は判定結果の要約であり、その根拠情報の代わりには
なりません。

**0 findings は positive evidence を必要とします。** reaction なし、comment なし、
parser 0 件、status success のみを `no findings` へ変換してはいけません。positive
completion evidence のない empty output は `unknown` として扱います。

**run record state と target completion state は別の対象です。** 上記の record schema の
`status` / `validity` は、**個々の review run** の状態を表します。これとは別に、
**ある reviewer が、確定した review target について現在どこまで完了しているか**を
**target completion state** と呼びます。両者は同じ語で呼ばず、混同してはいけません。
ancestor target に対する run は、run record としては `status: completed` かつ
`validity: invalid` であり、同時にその reviewer の current target に対する target
completion state は `not-bound` です。この 2 つは矛盾しません。

**positive completion evidence は target-bound です。** ある reviewer の target
completion state を「current target について完了した」とできるのは、取得済み surface
item のうち、その target への resolvable な参照を持つ positive completion evidence が
存在する場合に限ります。そのような evidence が無い場合、その state は `unknown`
（または、reviewed target を確定できた上で一致しない場合は `not-bound`）であり、
`0 findings` へ変換してはいけません。

**triage した review result の revision は、判断の対象です。** review result は
in-place で編集され得ます。completion evidence を保ったまま内容だけが変わった場合、
その reviewer の target completion state は変わりません。したがって、ある run を
merge / review completion の根拠とするには、triage / Resolution の対象とした result の
revision が、判断時点の current revision と同一であることを確認します。この確認は
deterministic な同一性の照合であり、finding の意味を読み直すことを要求しません。
current revision が異なる場合、その result はまだ triage されていない result として
扱います。

本 Contract および Selection Contract が「記録すること」を要求する事項——各 actor の
membership class とその根拠、target completion state とその binding の根拠、triage の
対象とした result の revision、および current target の clean / discovery evidence として
採用した run——は、個々の run record schema ではなく、その review stage の Selection /
fence 記録として persist します。これらは run 単位ではなく reviewer 単位・stage 単位の
情報であるためです。

target completion state が `not-bound` である reviewer（reviewed target が expected
target と一致しない completed run を持つ reviewer）は、次の 2 軸で扱いを分けます。
両者を混同してはいけません。

- **evidence 軸**: その run を、current target の `0 findings` 主張や discovery
  evidence の根拠として使えません。
- **finding 軸**: その run で既に発見された finding は Resolution obligation として
  残ります。review target が移動したことだけを理由に discharge されません。

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
- 確定した review target より前の target（ancestor）で発見された finding も
  Resolution Contract の対象である。review target が移動したことだけを理由に
  discharge されない

### Merge readiness and merge authority

本節における review completion（Resolution Contract の完了を含む）が
成立した状態を **merge-ready** と呼びます。Review contracts、Review stopping
rules、および Skill routing contract が指す review skill の手順で `merge` と
記述する到達点は、merge-ready の成立を指し、merge を実行してよいという判断
そのものとは同義ではありません。

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

#### Merge-ready completion fence

merge-ready を宣言する前に、次の fence を最後の action として評価します。この fence は
Review stopping rules を置き換えず、参照します。fence は 2 つの部分からなります。

**1. machine-checkable な precondition。** 確定した target / base / target artifact set
が現在も同じであること、required reviewer の target completion state、acquisition の
coverage、triage した review result の revision が現在も同じであること、review surface 上に
未解決として残っている review conversation の有無、deterministic verification target との
一致、changed artifact set が要求する skill routing、および merge 前に機械判定できる
repository hygiene。これらは Foundation-owned な deterministic checker が
**1 回の fresh acquisition** に対して評価します。どの surface がこれらを表すかの識別は
Review Adapter boundary の責務であり、Kernel は provider 固有の surface 名を持ちません。
判定手順は checker が canonical source であり、本節には置きません。checker は finding の
意味、Resolution の完了、merge authority を判断しません。

**2. semantic judgment。** finding の意味と triage、Resolution の完了、および expected
review set の各 member の review obligation が満たされたかどうか。これは agent が
所有します。

**checker の pass は merge-ready の成立ではありません。** checker が述べるのは
machine-checkable な precondition が成立していることだけです。merge-ready は、それに
加えて **expected review set の各 member（optional / advisory を含む）の review
obligation が satisfied している**ことをもって成立します。checker が `pass` 以外
（`fail` / `unknown` のいずれか）を返す間は merge-ready ではありません。`unknown` を
`pass` として扱ってはいけません。

**review obligation** は、member の class ごとに次を指します。

- **required member**: Selection Contract の required review 数を満たす valid な run が
  揃っていること、およびその finding の Resolution が完了していること。ここでの
  `validity` は、**その run が属する review stage の expected target** に対して判定
  します。必ずしも final target に対して判定するのではありません。非参加の宣言では
  この obligation は解除されません（Selection Contract 参照）。
- **expected member**: 次の両方。
  1. その member が既に出した finding の Resolution が完了していること（target
     completion state が `not-bound` / `declined` でも同じ）。
  2. target completion state が `completed@target` または `declined` であること。
     **ただし、次をすべて満たす場合に限り、この条件を要求しません。**
     - その member が、この review flow のいずれかの target で `completed@target`
       になっている
     - その completion 以降の target 移動がすべて accepted fix によるものであり、
       いずれも Review stopping rules に従い targeted closure で十分と判定されて
       いる（連続する targeted closure を跨いでこの条件を辿れます）
     - その member について、current target に対する run が in-flight でない
- **optional / advisory member**: その member が既に出した finding の Resolution が
  完了していること。target completion state は blocker ではありません。

この例外が免除するのは、その member から**新たな** completion evidence を取得しに行く
義務だけです。**既に走っている run の終端を待つ義務と、その member の初回 completion
義務は免除しません。** current target に対する run が observed で in-flight なら、
その run が terminate するまで待ちます。ここで待つ対象は run record state であり、
target completion state ではありません。run が終端した結果 `validity: invalid` で
あっても、待機義務としては充足です。一度も `completed@target` になっていない member へ
この例外を適用してはいけません。この例外に依拠する場合、上記 3 点の充足を記録します。

expected member の条件 2 を、agent の内心の申告（「この member の沈黙には依拠して
いない」等）で満たしたことにしてはいけません。判定は observable な target completion
state と、上記の記録された stopping rules 判断に基づきます。

expected member の target completion state が `failed`、または Failure / retry の
bounded retry でも解消しない恒久的な `unknown` である場合、条件 2 の成立を無期限に
待ちません。Failure / retry に従って escalate するか、Selection Contract を明示的に
変更してその member の class を確定し直し、その判断と根拠を記録します。いずれの場合
も、条件 1（既に出した finding の Resolution）は残ります。
この route を、条件 2 の gate を迂回する経路にしてはいけません。bounded retry を
形だけ行って恒久 failure と宣言したり、待機を避けるために class を再宣言したりする
ことは、この route の用途ではありません。

merge-ready は、accepted fix による target 変更のたびに、全 member へ final target の
full re-review を新たに要求するものではありません。どこまで再 review が必要かは
Review stopping rules に従い、上記の例外がその範囲を定めます。

この fence の評価後、merge-ready を宣言する前に **review-relevant な state 変化**が
あった場合、その fence 評価は無効となり、再評価します。review-relevant な state 変化
とは、review target の変化、および expected review set の membership・target completion
state・finding・Resolution 状態のいずれかを変えうる surface の変化です。review 意味を
持たない surface の変化（通常の human comment 等）や、**agent 自身が Review Protocol の
各 Contract および本 fence に従って persist する durable evidence（acquisition record、
triage / Resolution の記録、merge-ready report を含む）の記録そのもの**は、
review-relevant な変化に当たらず、fence を無効化しません。

この再評価は無制限に繰り返しません。review-relevant な変化が繰り返し発生して fence が
収束しない場合、その繰り返し自体を停止条件として扱い、Review stopping rules と同様に
upstream task/design の不安定さを疑い、必要に応じて escalate します。

この fence は merge-ready の成立条件であり、merge を実行してよいという判断とは同義では
ありません。merge execution authority は本節冒頭の分離に従います。

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

次の 2 つの識別も adapter の責務です。Kernel は要求だけを定め、判定材料を持ちません。

- どの surface item が **review participation** を構成するか（Selection Contract の
  expected review set 参照）
- どの field / surface が **reviewed target を安定して表す**か、および、どれが review
  target の移動に追随して値が変化するか（Acquisition & Validity Contract 参照）

これらの判定材料は、恒久仕様ではなく再検証可能な observed evidence として
capability/profile 側に置きます。

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

この節における review target は、Selection Contract で確定した expected target
SHA / commit range と target artifact set の組を指します。**どれか 1 つでも変われば
review target の変更です。**
head SHA が不変でも commit range の endpoint が変わった場合、また expected target
SHA / commit range が不変でも target artifact set が変わった場合も、review target の
変更として同じ scope です。
precondition evidence、discovery evidence、closure
evidence はいずれも target-specific であり、確定した target と一致しない evidence を
review / closure / merge の根拠にしません。
target / range / artifact set の drift と、precondition evidence が確定した target SHA
を指しているかは deterministic であり、Merge-ready completion fence が参照する checker
が機械判定します。照合手順を本節に置きません。

checker が判定しないのは、precondition check がどの artifact scope を対象としたかです。
これは check ごとに異なるため、Selection で確定した target artifact set がその scope に
含まれることの確認は agent が行います。precondition check を Selection より前に実行した
場合は、Selection 後にこの binding を確認します。selected artifact set を precondition
evidence がカバーしていると確認できない場合は、確定した target に対して precondition
check を再実行してから先へ進みます。

valid な discovery の後、accepted-fix による closure target の変更以外の理由で review
target が変わった場合、その discovery を新しい target の merge / completion evidence
として使いません。新しい target について precondition check を再成立させ、Selection /
Execution を再確立した上で、その target に必要な discovery を行います。accepted fix に
よる target 変更は、既存の targeted closure（Executable）/ closure verification
（Normative）の扱いに従います。

closure Resolution で accepted fix が生じ、その fix を closure review で確認する
cycle（Executable の targeted closure、Normative の closure verification のいずれも）が
繰り返し発生する場合、無制限に継続せず、upstream task/design または policy/document
自体の instability を疑い、必要に応じて escalate します。これは Failure / retry の
retry count とは別の stopping semantics です。

full discovery は原則 1 round です。fix が behavior / blast radius を materially
変えた場合のみ 2 round 目を許容します。それ以上必要な場合は review loop を増やさず、
upstream task/design の不安定さを疑います。
2nd discovery の accepted finding を fix した後も、その fix が behavior /
blast radius をさらに materially 変えた場合は、3rd full discovery を起動
せず、targeted closure だけで merge へ進まず、upstream task/design の
不安定さを疑い、必要に応じて escalate します。

本節が定める stopping semantics（evidence の target 束縛、round / cycle の上限と
escalate 判断）を、artifact classification ごとの具体的な review 手順のどこで評価
するかは、その手順自体に属します。この review 手順の canonical source は
Foundation-owned な review skill であり、本節には置きません。該当する review 手順
へ入る前に、Skill routing contract に従って対応する skill を load します。

### Observed evidence is not a permanent provider rule

Review Protocol の contract は実測された failure mode を反映しますが、observed な
provider 挙動を Kernel の恒久 rule にはしません。expected trigger behavior は
completion evidence と同義ではありません。expected trigger behavior に反して
completion evidence が得られない場合は、trigger 前提を疑い、Acquisition & Validity
Contract に従って `unknown` として扱います。特定 provider が常に特定の trigger 方法を
要求するという恒久仕様は Kernel に置かず、observed evidence として capability/profile
側で再検証可能な形にします。

### Skill routing contract

Review を開始する前に、artifact classification に対応する skill を load することを
Kernel の provider-neutral な routing contract として表現します。この contract は
provider 名や provider 固有の skill 機構（特定 CLI の skill directory 等）を含みません。

| artifact classification | load する skill                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Executable              | `.ai-dev-foundation/skills/review-code.md`                                                                                 |
| Normative               | `.ai-dev-foundation/skills/review-doc.md`                                                                                  |
| Informational           | mandatory review skill なし（Artifact classification の定義に従い、open-ended AI review を通常の merge gate にしないため） |

該当する artifact classification の review 手順に入る前に、対応する skill を load
することは **MUST** です。skill は本節の規範的なルールを複製せず、手順を説明します。
skill を load せずに review 手順を進めることは、この routing contract への違反です。

1 つの review target が、mandatory review skill を持つ classification（Executable と
Normative）を複数含む場合（mixed-classification review target）、**該当する
classification すべてに対応する skill を load することを MUST とします。** いずれか
1 つの classification の skill だけを load し、他の classification に属する artifact も
それで代替したことにしてはいけません。各 classification の手続き的 obligation
（stopping rule、discovery round 数、required review 数、closure / verification 手順）
は、その classification に属する artifact subset にのみ適用し、他の classification へ
流用しません。複数の skill を load した場合、各 skill の discovery / closure /
stopping semantics は classification ごとに独立した review flow として並行に適用して
よく、単一の flow へ統合することを要求しません。

target に Informational な artifact が同時に含まれていても、Informational に mandatory
review skill が無いという Artifact classification の定義は変わりません。

**changed artifact set から required skill を導出する判定は、agent の自己申告だけで
決めません。** Foundation-owned な deterministic checker が changed artifact set から
required skill を導出し、Selection が宣言した routing がそれを満たしているかを照合
します。path から class を確実に導出できない artifact を、checker が勝手に特定の class
へ分類することはありません。その場合の扱いは checker の出力に従い、classification の
確定そのものは Selection Contract が所有します。

`.ai-dev-foundation/skills/` は Foundation-owned な配布物です。consumer はこの path
を編集しません。canonical source は Foundation リポジトリの `skills/` であり、
consumer 側の内容がこれと一致しない場合は drift として検知されます。

この routing contract を含む Foundation policy の canonical source は Foundation
リポジトリの `policy/core.md` です。consumer にはこの規範的なルールが generated
`AGENTS.md` の `## Foundation policy` section として配布されます。distributed skill
本文が `policy/core.md` を参照する箇所は、consumer context ではこの生成された
`AGENTS.md` の `## Foundation policy` section を指すものとして解決します。
consumer リポジトリに `policy/core.md` という path が存在することを前提にしません。

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

この 3 条件は、Foundation 自身の Normative artifact に対する review finding を accept
して条項を足すかどうかの判定にも、そのまま適用します。文言の曖昧さや網羅性の不足を
指摘する finding は、実運用で misjudgment が観測された場合に限り accept します。

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
