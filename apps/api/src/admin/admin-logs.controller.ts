import { Controller, Get, Query, UseGuards, BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  meta?: Record<string, any>;
}

@Controller('admin/logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class AdminLogsController {
  private readonly logDir = path.join(process.cwd(), 'logs');

  @Get('files')
  async listFiles() {
    if (!fs.existsSync(this.logDir)) {
      return { files: [] };
    }
    const files = fs.readdirSync(this.logDir).filter(f => f.endsWith('.log'));
    return { files };
  }

  @Get()
  async readLogs(
    @Query('file') fileName?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('level') level?: string,
  ) {
    const name = (fileName || 'app').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!name) throw new BadRequestException('Invalid file name');

    const filePath = path.join(this.logDir, `${name}.log`);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException(`Log file not found: ${name}.log`);
    }

    const limitNum = limit ? Math.min(1000, Math.max(1, parseInt(limit, 10))) : 100;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split('\n').filter(Boolean).reverse();

    let entries: LogEntry[] = [];
    for (const line of lines.slice(0, limitNum)) {
      try {
        const parsed = JSON.parse(line) as LogEntry;
        entries.push(parsed);
      } catch {
        entries.push({ timestamp: '', level: 'raw', message: line, meta: undefined });
      }
    }

    if (level) {
      entries = entries.filter(e => e.level === level);
    }

    if (search) {
      const lower = search.toLowerCase();
      entries = entries.filter(
        e =>
          e.message.toLowerCase().includes(lower) ||
          (e.meta && JSON.stringify(e.meta).toLowerCase().includes(lower)),
      );
    }

    const stats = fs.statSync(filePath);
    return {
      file: `${name}.log`,
      path: filePath,
      size: stats.size,
      lastModified: stats.mtime.toISOString(),
      limit: limitNum,
      count: entries.length,
      entries: entries.slice(0, limitNum),
    };
  }
}
