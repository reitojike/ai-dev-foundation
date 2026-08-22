function helper() {
  // Indented, function-scoped shadow — never the exported binding.
  const nextConfig = { agentRules: false };
  return nextConfig;
}

const nextConfig = { agentRules: true };
module.exports = nextConfig;
