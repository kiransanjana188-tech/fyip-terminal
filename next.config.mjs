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
        "./node_modules/@netlify/database/**/*",
        "./node_modules/@netlify/runtime-utils/**/*",
        "./node_modules/@neondatabase/serverless/**/*",
        "./node_modules/pg/**/*",
        "./node_modules/pg-*/**/*",
        "./node_modules/waddler/**/*",
        "./node_modules/ws/**/*",
      ],
    },
  },
  // Provider secrets must never leak into the client bundle. These env vars are
  // explicitly NOT exposed via NEXT_PUBLIC_*, so they remain server-only.
  env: {},
};

export default nextConfig;