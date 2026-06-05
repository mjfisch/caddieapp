/** @type {import('next').NextConfig} */
const nextConfig = {
  // Compile the workspace TS packages directly (no separate build step at Phase 0).
  transpilePackages: ["@gai/api", "@gai/sg-engine", "@gai/caddie-context", "@gai/shared"],
  // The migration runner (services/api/src/db.ts) reads its .sql files from disk at
  // runtime. Next's tracer can't follow a readdirSync, so without this the files are
  // absent in the serverless bundle and a fresh DB couldn't self-migrate. Trace them
  // into every server function that may call runMigrations. (db.ts also skips
  // gracefully if they're still missing — the DB is migrated out-of-band from dev.)
  outputFileTracingIncludes: {
    "/api/**": ["../../services/api/src/migrations/**"],
    "/play/**": ["../../services/api/src/migrations/**"],
  },
};
export default nextConfig;
