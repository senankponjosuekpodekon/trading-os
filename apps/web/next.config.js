const { withSentryConfig } = require('@sentry/nextjs');

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@trading-os/shared'],
};

const sentryOptions = { silent: true, setCommits: false };
const sentryBase = { hideSourceMaps: true };

module.exports = process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(nextConfig, sentryOptions, sentryBase)
  : nextConfig;
