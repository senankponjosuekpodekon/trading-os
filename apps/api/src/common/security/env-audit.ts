import { Logger } from '@nestjs/common';

interface SecretCheck {
  key: string;
  required?: boolean;
  encrypted?: boolean;
}

/**
 * Audit environment variables for security issues.
 *
 * Flags:
 * - required secrets missing
 * - secrets not prefixed with `enc:` when ENCRYPTION_KEY is set
 * - known weak / placeholder values
 */
export function auditEnv(logger: Logger, checks: SecretCheck[] = DEFAULT_SECRET_CHECKS) {
  const encryptionEnabled = !!process.env.ENCRYPTION_KEY;
  const issues: string[] = [];

  for (const check of checks) {
    const value = process.env[check.key];
    if (check.required && !value) {
      issues.push(`Missing required secret: ${check.key}`);
      continue;
    }
    if (!value) continue;

    if (check.encrypted && encryptionEnabled && !value.startsWith('enc:')) {
      issues.push(`Secret ${check.key} should be encrypted (enc:...) because ENCRYPTION_KEY is set`);
    }

    if (value.toLowerCase().includes('changeme') || value.toLowerCase().includes('placeholder')) {
      issues.push(`Secret ${check.key} looks like a placeholder`);
    }
  }

  if (process.env.NODE_ENV === 'production' && !process.env.ALLOWED_ORIGINS) {
    issues.push('ALLOWED_ORIGINS should be set in production');
  }

  if (issues.length) {
    logger.warn('Security env audit issues:');
    issues.forEach(i => logger.warn(` - ${i}`));
  } else {
    logger.log('Security env audit: OK');
  }

  return issues;
}

export const DEFAULT_SECRET_CHECKS: SecretCheck[] = [
  { key: 'DATABASE_URL', required: true, encrypted: false },
  { key: 'JWT_SECRET', required: true, encrypted: true },
  { key: 'OPENAI_API_KEY', encrypted: true },
  { key: 'TWELVE_DATA_API_KEY', encrypted: true },
  { key: 'NEWS_API_KEY', encrypted: true },
  { key: 'DERIV_TOKEN', encrypted: true },
  { key: 'COINGLASS_API_KEY', encrypted: true },
  { key: 'LUNARCRUSH_API_KEY', encrypted: true },
  { key: 'CRYPTOQUANT_API_KEY', encrypted: true },
  { key: 'GLASSNODE_API_KEY', encrypted: true },
  { key: 'RESEND_API_KEY', encrypted: true },
  { key: 'TELEGRAM_BOT_TOKEN', encrypted: true },
];
