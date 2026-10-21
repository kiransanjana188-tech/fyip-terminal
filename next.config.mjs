/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // `node:sqlite`, `node:crypto` etc. are Node builtins; keep them external so
  // webpack does not try to bundle the runtime.
  experimental: {
    serverComponentsExternalPackages: ["node:sqlite"],
    // The Postgres bridge loads `@netlify/database` from inside an eval
    // worker, so webpack cannot discover it. Force the packages into every
    // function bundle that Netlify traces.
    outputFileTracingIncludes: {
      "/*": [
        "./node_modules/pg/**/*",
        "./node_modules/pg-*/**/*",
        "./node_modules/split2/**/*",
        "./node_modules/postgres-array/**/*",
        "./node_modules/postgres-bytea/**/*",
        "./node_modules/postgres-date/**/*",
        "./node_modules/postgres-interval/**/*",
        "./node_modules/xtend/**/*",
      ],
    },
  },
  // Provider secrets must never leak into the client bundle. These env vars are
  // explicitly NOT exposed via NEXT_PUBLIC_*, so they remain server-only.
  env: {},
};

export default nextConfig;