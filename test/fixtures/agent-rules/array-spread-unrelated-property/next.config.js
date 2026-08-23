const defaultExtensions = ['tsx', 'ts', 'jsx', 'js'];

const nextConfig = {
  agentRules: false,
  pageExtensions: [...defaultExtensions, 'mdx'],
};

module.exports = nextConfig;
