/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { webpack }) => {
    // tronweb reaches for Node globals (Buffer, process) that don't exist in the
    // browser. Provide them in the client bundle — the direct equivalent of the Vite
    // vite-plugin-node-polyfills globals shim we're replacing. The dashboard is
    // client-only (ssr:false), so this only affects the client build.
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
    return config
  },
}

export default nextConfig
