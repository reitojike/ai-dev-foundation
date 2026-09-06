export const CODEX_LOCAL_STARTUP_BUDGET_BYTES = 32_768;

export function codexLocalStartupBudgetAdvisory(generatedAgentsBytes) {
  if (generatedAgentsBytes <= CODEX_LOCAL_STARTUP_BUDGET_BYTES) return null;

  const budgetKiB = CODEX_LOCAL_STARTUP_BUDGET_BYTES / 1024;
  return (
    `Codex Local CLI / Desktop Local/Worktree advisory: generated AGENTS.md ` +
    `(${generatedAgentsBytes} bytes) exceeds the current default startup project-doc budget ` +
    `(${budgetKiB} KiB / ${CODEX_LOCAL_STARTUP_BUDGET_BYTES.toLocaleString("en-US")} bytes). ` +
    "Local startup instructions may be truncated unless the trusted consumer project sets a " +
    "sufficient project_doc_max_bytes."
  );
}
