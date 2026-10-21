/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // `node:sqlite`, `node:crypto` etc. are Node builtins; keep them external so
  // webpack does not try to bundle the runtime.
  experimental: {
    serverComponentsExternalPackages: ["node:sqlite"],
  },
  // Provider secrets must never leak into the client bundle. These env vars are
  // explicitly NOT exposed via NEXT_PUBLIC_*, so they remain server-only.
  env: {},
};

export default nextConfig;