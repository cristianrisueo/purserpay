/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // tronweb (via axios → https-proxy-agent → agent-base) breaks when webpack bundles
  // it for the SERVER target — SSR eval throws "Cannot read properties of undefined
  // (reading 'fd')". It runs fine under a native Node require, so keep it OUT of every
  // server bundle: Next require()s it at runtime instead of webpack-transforming it.
  // This makes the SSR crash impossible regardless of which module pulls tronweb in.
  // Server-only — the client bundle (Buffer/process polyfills below) is unaffected.
  serverExternalPackages: ["tronweb"],
  // The Flex Card (1C) renders with next/og + a VENDORED static Inter Tight woff read
  // from src/lib/affiliate/fonts. Trace those files into the /api/affiliate/flex
  // serverless function so process.cwd()-relative readFileSync resolves in production
  // (they aren't imported as modules, so Next wouldn't bundle them otherwise).
  outputFileTracingIncludes: {
    "/api/affiliate/flex": ["./src/lib/affiliate/fonts/*.woff"],
  },
  // Baseline security headers on every route (clickjacking, MIME-sniffing, referrer
  // leakage, and HTTPS enforcement). Applied at the framework level so they cover the
  // landing, the gated dashboard, and static assets alike.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains; preload",
          },
        ],
      },
    ]
  },
  webpack: (config, { webpack, isServer }) => {
    // tronweb reaches for Node globals (Buffer, process) that don't exist in the
    // browser. Provide them in the CLIENT bundle only — the direct equivalent of the
    // Vite vite-plugin-node-polyfills globals shim we're replacing.
    //
    // CRITICAL: this MUST be client-only. On the server, `process` is a real Node
    // global; shimming it with `process/browser` gives server modules an EMPTY
    // process.env, which breaks Server Actions that read secrets dynamically
    // (e.g. compliance.ts `process.env[name]` → WALLET_SALT/PII_ENCRYPTION_KEY).
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        buffer: "buffer",
        process: "process/browser",
      }
      config.plugins.push(
        new webpack.ProvidePlugin({
          Buffer: ["buffer", "Buffer"],
          process: "process/browser",
        })
      )
    }
    return config
  },
}

export default nextConfig
