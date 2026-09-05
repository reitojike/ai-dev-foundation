## Selection Contract record (discovery stage)

Issue #83 / PR #85 の formal review の Selection です。
`policy/core.md` の Review Protocol、`skills/review-code.md`、
`skills/review-doc.md` に従います。

### Artifact classification

**Mixed（Executable + Normative）**

| artifact | class |
| --- | --- |
| `tooling/merge-ready-fence-lib.mjs` | Executable |
| `test/merge-ready-fence-lib.test.mjs` | Executable |
| `policy/core.md` | Normative |
| `test/fixtures/consumer/AGENTS.md` | Normative（generated adapter） |

Mixed のため、required review skill として `review-code` と `review-doc` の
**両方**を宣言します。

### Target

- expected target SHA（frozen）: `7aefcac8e93e1ba0ac0686993bc26195631f3b50`
- base SHA（frozen）: `4db87c5e3b559717c0ba35dd991f36cc425a8f99`
- commit range: `4db87c5..7aefcac`（single commit）
- target artifact set: 上表の 4 file（PR の changed file 全体と一致）

### Reviewer / capability

reviewer capability record（`.ai-dev-foundation/reviewers.json`,
`required_selection.count = 1`,
`prefer = different-provider-family-from-implementer`）に従います。

- **required（1）**: `codex`（`provider_family: openai`）。実装した agent は
  `anthropic` family のため、prefer に従い第一候補として選択します。
  trigger は `comment_command` = `@codex review`、`target_argument` で
  frozen target を渡し、結果に `Reviewed commit:` を含めるよう要求します。
- **fallback order**: `codex` → `claude`。codex が unavailable /
  rate-limited / failed の場合は Selection amendment を記録して required
  slot を `claude` の run へ移します。
- **advisory**: `coderabbitai`。`.coderabbit.yaml` で
  `auto_review.enabled: false` のため自動起動せず、本 Selection では明示
  trigger しません。advisory は required 数に算入せず blocker にもしません。
  ただし merge-ready 判定までに review surface へ到着した finding は、class に
  関係なく triage / Resolution の対象として扱います。

### Expected review set

Selection 時点で PR #85 の conversation comment / review submission /
inline comment を fresh 取得し、actor は **0 件**でした
（`gh api .../issues/85/comments`、`.../pulls/85/reviews` いずれも空）。

したがって現時点の expected review set は required の `codex` のみです。
Acquisition 時に再度 fresh 列挙し、この review flow のいずれかの target 上に
review 行為を識別できる actor が現れた場合は expected member として追加し、
Selection amendment を記録します。

### Mechanical check / deterministic verify

frozen target `7aefcac` に対して実行し、すべて成功しています。

- `npm test` — 257 pass / 0 fail / 1 skipped
- `npm run test:guardrails` — Verified 8 guardrail fixtures
- `npm run check:fixture` — generated adapters / quality profile / skill bundle /
  reviewer capability record すべて current
- markdown mechanical check: `npx prettier --check policy/core.md
  test/fixtures/consumer/AGENTS.md` — All matched files use Prettier code style
- `git diff --check 4db87c5..HEAD` — clean

scope: repo-wide（`npm test` / guardrails / check:fixture）。markdown check は
本 target の Normative artifact 2 file を明示的にカバーしています。
したがって直近の successful verify / mechanical check evidence は、確定した
target SHA と target artifact set の両方をカバーしています。

### Required review 数

**1**（record の `required_selection.count`）。
`validity: valid` な run が 1 件揃うまで triage へ進みません。
