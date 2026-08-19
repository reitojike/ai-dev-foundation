# Reviewer capability record

この記録は Task Protocol / Review Protocol の canonical source ではありません。規範的な
定義は `policy/core.md` を参照します。この記録は Issue #12 の Bootstrap observation /
runtime profile であり、provider capability の恒久的な台帳ではありません。negative
capability claim（「このprovider はこの surface に出ない」等）は、capability/profile の
更新時に再検証可能なものとして扱います。

## Controlled smoke PR

- Repository: `reitojike/ai-dev-foundation`
- PR: TBD（この PR 自身。Selection Contract の expected target として、PR 作成時点の
  candidate SHA と対象 artifact set を Execution 時に確定・記録する）
- 対象 artifact: `.github/workflows/claude-review.yml`（Executable）、
  `skills/review-briefs.md` / `skills/review-code.md` / `skills/review-doc.md`
  （Normative）、本ファイル（Informational）
- 目的: diff だけでは正しさを判定できない review case を含める。例えば
  `skills/review-code.md` / `skills/review-doc.md` への追記が `policy/core.md` の
  既存 Review Protocol と矛盾していないか、`skills/review-briefs.md` の内容が
  Resolution Contract 等の規範的ルールを複製していないかは、変更していない
  `policy/core.md` と root `AGENTS.md` を読まないと判断できない。

## Capability smoke matrix（Work item 1）

Selection で要求した required context を読めなければ、そのcapabilityは `no` として
記録し、そのreview typeではvalid reviewerに算入しない。

| Capability | Claude | Codex | CodeRabbit | Copilot |
| --- | --- | --- | --- | --- |
| PR diff | TBD | TBD | TBD | TBD |
| changed file full content | TBD | TBD | TBD | TBD |
| unchanged repository files | TBD | TBD | TBD | TBD |
| AGENTS / repository instructions | TBD | TBD | TBD | TBD |
| canonical policy / related docs | TBD | TBD | TBD | TBD |
| Issue / PR context | TBD | TBD | TBD | TBD |
| current SHA / range | TBD | TBD | TBD | TBD |
| target artifact set | TBD | TBD | TBD | TBD |
| review result surface | TBD | TBD | TBD | TBD |
| zero-findings evidence | TBD | TBD | TBD | TBD |

## Capability record（Work item 2）

| Field | Claude | Codex | CodeRabbit | Copilot |
| --- | --- | --- | --- | --- |
| authentication | TBD | TBD | TBD | TBD |
| trigger | TBD | TBD | TBD | TBD |
| usable stage | TBD | TBD | TBD | TBD |
| repository access | TBD | TBD | TBD | TBD |
| target binding | TBD | TBD | TBD | TBD |
| completion evidence | TBD | TBD | TBD | TBD |
| zero-findings evidence | TBD | TBD | TBD | TBD |
| output surfaces | TBD | TBD | TBD | TBD |
| retry / failure surface | TBD | TBD | TBD | TBD |
| customization | TBD | TBD | TBD | TBD |
| observed limitation | TBD | TBD | TBD | TBD |

## Observations to carry into first consumer

TBD — smoke 実行後に、Quality / Convergence / Runtime / Cost・complexity の各観点で
`policy/core.md` の Review Protocol と整合する範囲の観測のみを記録する。

## Handoff

TBD — reviewer pool、verified capability、Selection に使える review stage / context
条件、trigger 方法、Completion / Validity / 0-findings evidence、result acquisition
surface、Discovery / Closure review brief（`skills/review-briefs.md` を参照）、
observed operational caveat を first real consumer Issue へ渡す。
