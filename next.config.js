/** @type {import('next').NextConfig} */
const nextConfig = {
  // Docker builds set NEXT_OUTPUT=standalone to emit .next/standalone
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  experimental: {
    instrumentationHook: true,
  },
};

module.exports = nextConfig;
