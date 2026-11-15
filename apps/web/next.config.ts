import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import type { NextConfig } from 'next';

// Gemeinsame .env im Projektwurzelverzeichnis laden (nur für lokale Entwicklung/Build)
const rootEnv = resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) loadDotenv({ path: rootEnv, quiet: true });

const monorepoRoot = resolve(process.cwd(), '../..');
const apiUrl = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/$/, '');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: monorepoRoot,
  turbopack: { root: monorepoRoot },
  transpilePackages: ['@chfree/shared'],
  poweredByHeader: false,
  reactStrictMode: true,
  env: {
    // Nicht-geheime Werte, die im Browser gebraucht werden
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? process.env.APP_URL ?? 'http://localhost:3000',
  },
  async redirects() {
    // Alte Pfade aus der ersten Version
    return [
      { source: '/register', destination: '/start', permanent: true },
      { source: '/free-hosting', destination: '/#pakete', permanent: true },
      { source: '/features', destination: '/#ablauf', permanent: true },
      { source: '/dashboard/:path*', destination: '/meine-server', permanent: false },
      { source: '/verify-email', destination: '/verify', permanent: true },
    ];
  },
  async rewrites() {
    // Entwicklung & einfache Setups: /api wird an die eigene API weitergereicht.
    // In Produktion kann der Reverse Proxy /api direkt an die API routen.
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
