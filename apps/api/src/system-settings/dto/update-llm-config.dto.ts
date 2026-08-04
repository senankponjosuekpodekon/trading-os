import { IsBoolean, IsIn, IsOptional } from 'class-validator';

export class UpdateLlmConfigDto {
  @IsBoolean()
  @IsOptional()
  ollamaEnabled?: boolean;

  @IsBoolean()
  @IsOptional()
  openaiEnabled?: boolean;

  @IsIn(['ollama', 'openai'])
  @IsOptional()
  preferred?: 'ollama' | 'openai';
}
