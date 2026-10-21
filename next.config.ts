import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // unpdf ships its own pdf.js build; let Node load it as-is instead of bundling it.
  serverExternalPackages: ["unpdf"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // The teacher listens through the mic; nothing else needs device access.
          { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
