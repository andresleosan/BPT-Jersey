import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  output: "export",
  poweredByHeader: false,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
