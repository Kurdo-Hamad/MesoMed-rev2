import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@mesomed/contracts", "@mesomed/i18n", "@mesomed/ui-tokens"],
};

export default nextConfig;
