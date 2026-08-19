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
semantic contract です。

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

- **planned handoff** は、固定済みの semantic contract を次の工程または agent に渡すことです。
- **capability escalation** は、必要な技術的能力、tool、または専門的な adjudication を得ることです。
- **authority escalation** は、product intent、権限、または受容不能な trade-off を決める
  authority に判断を求めることです。

未確定の product または architecture decision に遭遇した実装 agent は、silent decision を
してはいけません。pure technical dispute は原則として technical adjudication で解決し、
人間を message bus にしません。人間への escalation は、product intent、authority、権限、
または受容不能な trade-off に限ります。
