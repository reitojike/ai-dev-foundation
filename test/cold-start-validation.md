# Cold-start validation record

この記録は Task Protocol の canonical source ではありません。規範的な定義は
`policy/core.md` を参照します。

## Representative task

- Canonical context: GitHub Issue #8
- Validation target: worktree based on `70adc6774548d20f33f2142ad157ba412412be38`。
- Repository rules: repository root の `AGENTS.md`、および生成された consumer の
  `AGENTS.md` / `CLAUDE.md`
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
| Codex | この Issue の実装 session で実施。Issue #8 と root `AGENTS.md` のみから、Task Protocol を `High` と判定し、Task field の全機械必須化・provider 固有 rule・orchestrator の追加を未確定判断として保持した。`npm test` と consumer `npm run verify` を verification として特定した。 | pass |
| Claude | `claude -p --no-session-persistence` を2回実行したが、認証済みのCLIが120秒以内に応答を返さなかった。sandbox外での再試行では weekly limit に到達したと返された。`--bare` は OAuth 認証を使えず、fresh validationには利用できなかった。成功出力は記録していない。 | runtime pending |

Claude の記録が未完了の場合、Task Protocol の変更ではなく provider runtime がこの実行環境で
利用可能かどうかの検証待ちとして扱います。
