import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class FileLogger {
  private readonly logDir = path.join(process.cwd(), 'logs');
  private readonly logFile = path.join(this.logDir, 'app.log');
  private readonly errorFile = path.join(this.logDir, 'error.log');

  constructor() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  private write(file: string, level: string, message: string, meta?: Record<string, any>) {
    const timestamp = new Date().toISOString();
    const entry = JSON.stringify({
      timestamp,
      level,
      message,
      ...(meta ? { meta } : {}),
    }) + '\n';

    fs.appendFileSync(file, entry, { encoding: 'utf8' });
  }

  log(message: string, meta?: Record<string, any>) {
    this.write(this.logFile, 'log', message, meta);
    new Logger(FileLogger.name).log(message, meta);
  }

  error(message: string, meta?: Record<string, any>) {
    this.write(this.errorFile, 'error', message, meta);
    new Logger(FileLogger.name).error(message, meta);
  }

  warn(message: string, meta?: Record<string, any>) {
    this.write(this.logFile, 'warn', message, meta);
    new Logger(FileLogger.name).warn(message, meta);
  }
}
