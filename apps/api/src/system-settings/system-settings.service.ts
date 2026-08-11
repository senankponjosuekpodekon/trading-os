import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface LlmConfig {
  ollamaEnabled: boolean;
  openaiEnabled: boolean;
  preferred: 'ollama' | 'openai';
}

export interface PollingConfig {
  scanPollingEnabled: boolean;
  scanPollingInterval: number;
}

const LLM_CONFIG_KEY = 'llm_config';
const POLLING_CONFIG_KEY = 'polling_config';

const DEFAULT_LLM_CONFIG: LlmConfig = {
  ollamaEnabled: true,
  openaiEnabled: true,
  preferred: 'ollama',
};

const DEFAULT_POLLING_CONFIG: PollingConfig = {
  scanPollingEnabled: true,
  scanPollingInterval: 5_000,
};

@Injectable()
export class SystemSettingsService {
  constructor(private prisma: PrismaService) {}

  async getLlmConfig(): Promise<LlmConfig> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: LLM_CONFIG_KEY } });
    if (!row) return DEFAULT_LLM_CONFIG;
    return { ...DEFAULT_LLM_CONFIG, ...(row.value as Partial<LlmConfig>) };
  }

  async setLlmConfig(patch: Partial<LlmConfig>, updatedBy: string): Promise<LlmConfig> {
    const current = await this.getLlmConfig();
    const next: LlmConfig = { ...current, ...patch };

    await this.prisma.systemSetting.upsert({
      where: { key: LLM_CONFIG_KEY },
      create: { key: LLM_CONFIG_KEY, value: next as any, updatedBy },
      update: { value: next as any, updatedBy },
    });

    return next;
  }

  async getPollingConfig(): Promise<PollingConfig> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: POLLING_CONFIG_KEY } });
    if (!row) return DEFAULT_POLLING_CONFIG;
    return { ...DEFAULT_POLLING_CONFIG, ...(row.value as Partial<PollingConfig>) };
  }

  async setPollingConfig(patch: Partial<PollingConfig>, updatedBy: string): Promise<PollingConfig> {
    const current = await this.getPollingConfig();
    const next: PollingConfig = { ...current, ...patch };

    await this.prisma.systemSetting.upsert({
      where: { key: POLLING_CONFIG_KEY },
      create: { key: POLLING_CONFIG_KEY, value: next as any, updatedBy },
      update: { value: next as any, updatedBy },
    });

    return next;
  }
}
