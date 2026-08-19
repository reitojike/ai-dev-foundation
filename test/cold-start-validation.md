# Cold-start validation record

この記録は Task Protocol の canonical source ではありません。規範的な定義は
`policy/core.md` を参照します。

## Representative task

- Canonical context: GitHub Issue #8
- Validation target: `6a9155216c2784f555935f1e69ebb0de9b603ed3`。
- Repository rules: validation target上のrepository root `AGENTS.md` と
  `policy/core.md`
- Execution Envelope: repository root を cwd とした新規 CLI process。既存 session の
  resume、長文 handoff、provider 固有の model 指定は使わない。

## Procedure

各 provider で新規 session を起動し、Issue #8 と repository rules だけを読ませ、次を
短く回答させる。

1. Goal、scope、invariants
2. 選ぶ Role と routing の根拠
3. 勝手に決めてはいけない未確定 decision
4. verification と escalation 条件

回答を Issue の canonical context と照合し、必要な semantic contract を復元でき、provider
固有の contract を追加していないことを確認する。

## Result

| Provider | Fresh-session result | Status |
| --- | --- | --- |
| Codex | `--ephemeral` の新規CLI processで実施。Issue #8とtarget上のrulesをread-onlyで取得し、6項目すべてを復元した。Roleは、主要decisionが固定済みで局所設計の裁量が残るという根拠で`Balanced`と判断した。planned handoffでSemantic Contractに加えAllowed Discretion / Escalate WhenとExecution Stateを失わず、Issueを短く参照することを復元し、provider固有contractやsilent decisionは追加しなかった。 | final pass |
| Claude | `--no-session-persistence` の新規CLI processで実施。Issue #8とtarget上のrulesを取得し、6項目すべてを復元した。Roleは、主要decisionが固定済みで残りのcorrectnessに解釈裁量が残るという根拠で`Balanced`と判断した。planned handoffでSemantic Contractに加えAllowed Discretion / Escalate WhenとExecution Stateを失わず、Issueを短く参照することを復元し、provider固有contractやsilent decisionは追加しなかった。 | final pass |

両sessionは既存sessionをresumeせず、Issue #8とvalidation target上のrepository rulesだけを
canonical contextとして使用した。Roleの判断はいずれもIssueのrouting heuristicに基づくもので、
このheuristicは数値スコアや絶対的な不変条件ではない。
