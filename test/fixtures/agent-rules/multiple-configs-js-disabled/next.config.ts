// A stale/leftover config Next.js never loads while next.config.js exists
// — leaves agentRules enabled, but this is not the file `next dev` reads.
const nextConfig = {
  agentRules: true,
};

export default nextConfig;
