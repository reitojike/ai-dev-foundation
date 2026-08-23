// A stale/leftover config Next.js never loads while next.config.js exists
// — disables agentRules, but this is not the file `next dev` reads.
const nextConfig = {
  agentRules: false,
};

export default nextConfig;
