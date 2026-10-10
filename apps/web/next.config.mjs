import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // @tilo/core ships TypeScript source
  transpilePackages: ["@tilo/core"],
  // Monorepo root, where the hoisted node_modules live
  turbopack: {
    root: resolve(here, "../.."),
  },
}

export default nextConfig
