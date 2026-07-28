const { withSentryConfig } = require('@sentry/nextjs');

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@trading-os/shared'],
};

module.exports = withSentryConfig(nextConfig, { silent: true }, { hideSourceMaps: true });
