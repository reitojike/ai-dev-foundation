# Reviewer capability smoke probe（temporary, Issue #12）

このfileはIssue #12のcontrolled smoke専用のtemporary fixtureです。
canonical ruleではなく、`main`へmergeしません。目的は、PR #14 branch上
でreviewerが要求されたrepository contextを実際に読めるかを実測する
ことです。

## Artifact classification（要検証）

このfileは `policy/core.md` のArtifact classificationにおける
**Normative**（AGENTS / Skill / PRODUCT / ARCHITECTURE / ADR等、後続
agentや実装を拘束する文書）に該当すると想定します。この想定が正しい
場合、適用されるreview procedureは `skills/review-doc.md` の
mechanical check → semantic discovery（1 round）→ triage / fix →
（target変更時のみ）closure verificationです。

## 検証してほしい内容（要cross-reference）

以下はこのfileの著者が正しいと考えている要約です。diffだけでなく、
`policy/core.md` を実際に読んで正確性を確認してください。

1. Review は4つのprovider-neutralなcontractで構成される: Selection /
   Execution / Acquisition & Validity / Resolution。
2. Selection Contractは次の5項目で構成される: artifact classification、
   reviewer / capabilityの選択、required review数、target artifact
   set、expected target SHA / commit range。
3. 「0 findings」を確定するにはpositive evidenceが必要であり、
   reaction単独・comment無し・parser 0件・status successのみからは
   推定できない。
4. Review target が変更された場合、accepted fixによる変更以外の理由
   では、旧targetのdiscovery / closure evidenceを新targetのevidence
   として使わない。

## 言語規約（要cross-reference）

このfileは日本語で記述しています。これは root `AGENTS.md` の
「このリポジトリ内のMarkdown文書とMarkdown templateは、原則として
日本語で記述します」という規約に従ったものです。コード / コマンド /
識別子 / ファイル名 / 正式な技術用語は必要に応じて英語のまま
記述しています。

## Reviewerへの期待

この内容が `policy/core.md` および root `AGENTS.md` と矛盾していない
かを確認してください。diffだけで判断できる内容ではありません。
新しいcanonical ruleの提案や、このfile自体の恒久化の提案は不要です
（このfileはmergeされません）。
