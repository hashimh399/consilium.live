import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.29.168"],
  experimental: {
    // The checked-in .next cache was built on macOS and panics Turbopack
    // on Windows with "conflicting effects for the same key".
    turbopackFileSystemCacheForDev: false,
  },
};

export default nextConfig;
