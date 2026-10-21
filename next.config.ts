import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export for GitHub Pages. Relative asset paths let the single page
  // work from any subpath (https://<user>.github.io/<repo>/) without a basePath.
  output: "export",
  assetPrefix: "./",
  images: { unoptimized: true },
};

export default nextConfig;
