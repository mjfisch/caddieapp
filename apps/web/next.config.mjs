/** @type {import('next').NextConfig} */
const nextConfig = {
  // Compile the workspace TS packages directly (no separate build step at Phase 0).
  transpilePackages: ["@gai/api", "@gai/sg-engine", "@gai/caddie-context", "@gai/shared"],
};
export default nextConfig;
