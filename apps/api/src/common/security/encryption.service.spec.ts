import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from './encryption.service';

describe('EncryptionService', () => {
  let service: EncryptionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EncryptionService,
        { provide: ConfigService, useValue: { get: () => 'a'.repeat(64) } },
      ],
    }).compile();

    service = module.get<EncryptionService>(EncryptionService);
  });

  it('should encrypt and decrypt a secret', () => {
    const secret = 'sk-live-12345';
    const encrypted = service.encrypt(secret);
    const decrypted = service.decrypt(encrypted);
    expect(decrypted).toBe(secret);
  });

  it('should detect encrypted values', () => {
    expect(service.isEncrypted('enc:abc')).toBe(true);
    expect(service.isEncrypted('plain')).toBe(false);
  });

  it('should return plain value with decryptIfNeeded when not encrypted', () => {
    expect(service.decryptIfNeeded('plain')).toBe('plain');
  });

  it('should decrypt prefixed values with decryptIfNeeded', () => {
    const secret = 'secret-value';
    const encrypted = `enc:${service.encrypt(secret)}`;
    expect(service.decryptIfNeeded(encrypted)).toBe(secret);
  });

  it('should throw when key is missing', () => {
    const noKeyService = new EncryptionService({ get: () => undefined } as any);
    expect(() => noKeyService.encrypt('x')).toThrow('ENCRYPTION_KEY not configured');
  });
});
