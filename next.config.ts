import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Default output (Vercel automatically handles optimization)

  // Don't expose the framework in response headers
  poweredByHeader: false,
};

export default nextConfig;
