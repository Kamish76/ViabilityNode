import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Optimised for Vercel serverless deployment
  output: "standalone",

  // Don't expose the framework in response headers
  poweredByHeader: false,
};

export default nextConfig;
