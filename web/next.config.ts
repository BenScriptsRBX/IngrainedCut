import fs from 'node:fs';
import path from 'node:path';
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
    // only the current helper is hosted (scripts/pack-helper.mjs writes lib/helper.json first): an older version's
    // link, as in an old `npx` command, gets the current one
    const { file } = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'lib', 'helper.json'), 'utf8'));
    return {
      beforeFiles: [],
      afterFiles: [{ source: '/editor', destination: '/editor/index.html' }],
      fallback: [{ source: '/helper/:name(ingrainedcut-.+\\.tgz)', destination: file }],
    };
  },
  // the site moved to www.ingrainedcut.com: send pages there, but keep /api (webhooks) and /helper (old npx commands) working
  async redirects() {
    const from = [{ type: 'host' as const, value: 'ingrainedcut.vercel.app' }];
    return [
      { source: '/', has: from, destination: 'https://www.ingrainedcut.com/', permanent: true },
      { source: '/:path((?!api/|helper/).+)', has: from, destination: 'https://www.ingrainedcut.com/:path', permanent: true },
    ];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  serverExternalPackages: ['pg'],
};

export default nextConfig;
