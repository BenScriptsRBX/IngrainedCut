import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // the repo root has its own package.json (the editor/helper); this app lives in web/
  turbopack: { root: process.cwd() },
  // the editor is a static app built into public/editor (see package.json "build:editor")
  async rewrites() {
    return [{ source: '/editor', destination: '/editor/index.html' }];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  serverExternalPackages: ['pg'],
};

export default nextConfig;
