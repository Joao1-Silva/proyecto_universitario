/** @type {import('next').NextConfig} */
const outputMode = String(process.env.NEXT_OUTPUT_MODE ?? "")
  .trim()
  .toLowerCase()
const useStaticExport = outputMode === "export"

const nextConfig = {
  ...(useStaticExport ? { output: "export" } : {}),
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
