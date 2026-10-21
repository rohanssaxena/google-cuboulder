import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

export default function config(phase: string): NextConfig {
  // Dev server stays a normal Next app; relative asset paths break it.
  if (phase !== PHASE_PRODUCTION_BUILD) return {};

  return {
    // Static export for GitHub Pages. Relative asset paths let the single page
    // work from any subpath (https://<user>.github.io/<repo>/) without a basePath.
    output: "export",
    assetPrefix: "./",
    images: { unoptimized: true },
  };
}
