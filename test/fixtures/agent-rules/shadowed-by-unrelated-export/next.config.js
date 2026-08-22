// Codex P2 finding on this PR: an unrelated top-level object that happens to
// set agentRules: false must not satisfy the checker when the object that is
// actually exported leaves agentRules enabled.
const metadata = { agentRules: false };
const nextConfig = { agentRules: true };
module.exports = nextConfig;
