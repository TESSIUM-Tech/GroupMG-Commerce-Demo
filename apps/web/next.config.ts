import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    const apiTarget =
      process.env.INTERNAL_API_URL ||
      process.env.API_URL ||
      (process.env.NODE_ENV === "production"
        ? "http://api:3001"
        : "http://127.0.0.1:3001");
    return [
      {
        source: "/api/:path*",
        destination: `${apiTarget}/api/:path*`,
      },
    ];
  },
};
export default config;
