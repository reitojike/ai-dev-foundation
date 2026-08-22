/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Coincidentally named nested property unrelated to the top-level
    // NextConfig `agentRules` option — must not satisfy the checker.
    agentRules: false,
  },
};

module.exports = nextConfig;
