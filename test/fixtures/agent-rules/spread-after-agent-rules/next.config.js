const shared = { agentRules: true };

const nextConfig = {
  agentRules: false,
  ...shared,
};

module.exports = nextConfig;
