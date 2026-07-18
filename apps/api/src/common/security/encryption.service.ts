import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

/**
 * Encryption service for sensitive secrets (API keys, tokens).
 *
 * Uses AES-256-GCM with a 32-byte key derived from ENCRYPTION_KEY.
 * Encrypted values are stored as `enc:<base64>` and can be safely kept in env vars or DB.
 *
 * Example:
 *   encrypted = encryption.encrypt('sk-xxx')
 *   process.env.OPENAI_API_KEY = 'enc:' + encrypted
 *   decrypted = encryption.decryptIfNeeded(process.env.OPENAI_API_KEY)
 */
@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly key: Buffer | null = null;

  constructor(private config: ConfigService) {
    const raw = this.config.get<string>('ENCRYPTION_KEY');
    if (raw) {
      try {
        // Accept either a 64-char hex key or a passphrase that we derive to 32 bytes.
        this.key = raw.length === 64 ? Buffer.from(raw, 'hex') : scryptSync(raw, 'trading-os-salt', 32);
        if (this.key.length !== 32) {
          this.logger.error('ENCRYPTION_KEY must resolve to exactly 32 bytes');
          this.key = null;
        }
      } catch (e: any) {
        this.logger.error(`ENCRYPTION_KEY derivation failed: ${e?.message}`);
      }
    } else {
      this.logger.warn('ENCRYPTION_KEY not set — API secrets will not be encrypted at rest');
    }
  }

  isEncrypted(value: string | undefined): boolean {
    return typeof value === 'string' && value.startsWith('enc:');
  }

  encrypt(plain: string): string {
    if (!this.key) throw new Error('ENCRYPTION_KEY not configured');
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
  }

  decrypt(encryptedBase64: string): string {
    if (!this.key) throw new Error('ENCRYPTION_KEY not configured');
    const data = Buffer.from(encryptedBase64, 'base64');
    if (data.length < 32) throw new Error('Invalid encrypted payload');
    const iv = data.subarray(0, 16);
    const authTag = data.subarray(16, 32);
    const ciphertext = data.subarray(32);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  decryptIfNeeded(value: string | undefined): string | undefined {
    if (!value) return value;
    if (!this.isEncrypted(value)) return value;
    try {
      return this.decrypt(value.slice(4));
    } catch (e: any) {
      this.logger.error(`Failed to decrypt secret: ${e?.message}`);
      return undefined;
    }
  }
}
