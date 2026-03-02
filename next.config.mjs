/** @type {import('next').NextConfig} */
const outputMode = String(process.env.NEXT_OUTPUT_MODE ?? "")
  .trim()
  .toLowerCase()
const useStaticExport = outputMode === "export"
const pageExtensions = useStaticExport
  ? ["tsx", "ts", "jsx", "js"]
  : ["tsx", "ts", "jsx", "js", "web.ts", "web.tsx"]

const nextConfig = {
  ...(useStaticExport ? { output: "export" } : {}),
  pageExtensions,
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
