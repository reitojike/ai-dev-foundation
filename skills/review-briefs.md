# Per-run review brief

このファイルは `policy/core.md` の Review Protocol を使って reviewer を起動する際に渡す、
per-run の thin instruction です。`skills/review-code.md`（Executable）と
`skills/review-doc.md`（Normative）の両方から参照され、規範的なルールをここへ複製しません。
brief と policy が矛盾する場合は policy が優先します。

このファイルは canonical Foundation rule ではありません。Discovery / Closure の目的だけを
reviewer へ伝える per-run instruction であり、reviewer ごとの追加観点・強みを禁止しません。

## 使い方

各 review run を起動する際、Selection Contract で確定した expected target
（SHA / commit range）と target artifact set を brief 内の `...` へ埋めてから reviewer へ渡します。
target を埋めずに起動しない、または起動後に target を黙って変更しないことは
`policy/core.md` の Review contracts / Review stopping rules に従います。

## Discovery brief

```text
Review mode: Discovery

Expected review target:
- SHA / range: ...
- artifacts: ...

Use repository rules and existing canonical contracts as constraints.

Find material defects affecting correctness, safety, invariants,
Task Contract / AC compliance, or verification adequacy.

Do not expand the task scope.
Adjacent hardening, unrelated refactors, style improvements,
or process proposals should not be promoted to blockers.
```

## Closure brief

```text
Review mode: Closure

Verify whether the accepted findings are correctly resolved on
the current review target.

Promote a new blocker only when it is:
- an incomplete accepted fix
- a regression introduced by the fix
- a direct contradiction between changed paths and existing contract
- a safety/correctness defect making the fix unmergeable

Do not continue until findings reach zero.
Stop when the closure contract is satisfied.
```
