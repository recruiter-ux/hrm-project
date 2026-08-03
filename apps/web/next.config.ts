import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Surfaces type and lint errors during `next build` rather than letting a
  // broken build ship. Both default to false in Next, but stating them makes
  // the intent explicit for anyone reading this later.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },
};

export default nextConfig;
