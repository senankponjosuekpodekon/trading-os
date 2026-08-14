import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { SystemHealthService } from '../system-health/system-health.service';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

@Controller('admin/ops')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class AdminOpsController {
  constructor(
    private prisma: PrismaService,
    private healthService: SystemHealthService,
    private config: ConfigService,
  ) {}

  @Get('health')
  async health() {
    return this.healthService.getCronStatus();
  }

  @Get('db-stats')
  async dbStats() {
    const [
      users, assets, strategies, signals, positions,
      signalLogs, features, portfolios,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.asset.count(),
      this.prisma.strategy.count(),
      this.prisma.signal.count(),
      this.prisma.position.count(),
      this.prisma.signalLog.count(),
      this.prisma.signalFeature.count(),
      this.prisma.portfolio.count(),
    ]);

    return {
      users,
      assets,
      strategies,
      signals,
      positions,
      signalLogs,
      features,
      portfolios,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('signals-24h')
  async signals24h() {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [total, byDirection, byStatus] = await Promise.all([
      this.prisma.signal.count({
        where: { createdAt: { gte: yesterday } },
      }),
      this.prisma.signal.groupBy({
        by: ['signal'],
        where: { createdAt: { gte: yesterday } },
        _count: true,
      }),
      this.prisma.signal.groupBy({
        by: ['status'],
        where: { createdAt: { gte: yesterday } },
        _count: true,
      }),
    ]);

    return {
      total,
      byDirection: byDirection.reduce((acc, r) => {
        acc[r.signal] = r._count;
        return acc;
      }, {} as Record<string, number>),
      byStatus: byStatus.reduce((acc, r) => {
        acc[r.status] = r._count;
        return acc;
      }, {} as Record<string, number>),
    };
  }

  @Get('containers')
  async containers() {
    const mem = process.memoryUsage();
    const apiInfo = {
      name: 'api',
      pid: process.pid,
      uptime: Math.floor(process.uptime()),
      memory: {
        rss: Math.round(mem.rss / 1024 / 1024),
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
        external: Math.round(mem.external / 1024 / 1024),
      },
      oomRisk: mem.rss > 400 * 1024 * 1024 ? 'high' : mem.rss > 250 * 1024 * 1024 ? 'medium' : 'low',
    };

    let engineInfo: any = null;
    try {
      const engineUrl = this.config.get<string>('ENGINE_URL', 'http://engine:8000');
      const engineKey = this.config.get<string>('ENGINE_API_KEY', '');
      const { default: axios } = await import('axios');
      const resp = await axios.get(`${engineUrl}/health`, {
        headers: { 'X-Engine-Key': engineKey },
        timeout: 3000,
      });
      engineInfo = resp.data;
    } catch {
      engineInfo = { error: 'unreachable' };
    }

    let dockerStats: any[] = [];
    try {
      const { stdout } = await execAsync(
        'docker stats --no-stream --format "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}" 2>/dev/null | grep -E "trading-os|netdata|nginx|redis|postgres|uptime"',
        { timeout: 5000 },
      );
      dockerStats = stdout.trim().split('\n').filter(Boolean).map(line => {
        const [name, cpuPerc, memUsage, memPerc] = line.split('\t');
        return { name, cpuPerc: cpuPerc?.trim(), memUsage: memUsage?.trim(), memPerc: memPerc?.trim() };
      });
    } catch {
      // docker command not available or no containers
    }

    // Host CPU overview — try /proc/stat first (works on all Linux), fallback to top
    let hostCpu: any = null;
    try {
      const { readFileSync } = await import('fs');
      const stat = readFileSync('/proc/stat', 'utf-8');
      const cpuLine = stat.split('\n')[0];
      // format: cpu  user nice system idle iowait irq softirq
      const parts = cpuLine.split(/\s+/).slice(1).map(Number);
      const total = parts.reduce((a, b) => a + b, 0);
      const idle = parts[3] || 0;
      const user = parts[0] || 0;
      const system = parts[2] || 0;
      if (total > 0) {
        hostCpu = {
          user: ((user / total) * 100).toFixed(1),
          system: ((system / total) * 100).toFixed(1),
          idle: ((idle / total) * 100).toFixed(1),
        };
      }
      // Load average from /proc/loadavg
      try {
        const loadavg = readFileSync('/proc/loadavg', 'utf-8').trim().split(' ');
        hostCpu = { ...hostCpu, load1: loadavg[0], load5: loadavg[1], load15: loadavg[2] };
      } catch {}
    } catch {
      // Fallback to top command
      try {
        const { stdout } = await execAsync('top -bn1 | head -5', { timeout: 3000, shell: '/bin/sh' });
        const lines = stdout.trim().split('\n');
        const busyMatch = lines.find(l => l.includes('CPU:') || l.match(/\d+%\s+usr/));
        if (busyMatch) {
          const m = busyMatch.match(/([\d.]+)%\s+usr.*?([\d.]+)%\s+sys.*?([\d.]+)%\s+idle/);
          if (m) hostCpu = { user: m[1], system: m[2], idle: m[3] };
        }
        if (!hostCpu) {
          const cpuLine = lines.find(l => l.includes('%Cpu(s)') || l.includes('Cpu(s)'));
          if (cpuLine) {
            const match = cpuLine.match(/([\d.]+)\s+us.*?([\d.]+)\s+sy.*?([\d.]+)\s+id/);
            if (match) hostCpu = { user: match[1], system: match[2], idle: match[3] };
          }
        }
        const loadLine = lines.find(l => l.includes('load average') || l.includes('Load average'));
        if (loadLine) {
          const loadMatch = loadLine.match(/load average:\s+([\d.]+),\s+([\d.]+),\s+([\d.]+)/i);
          if (loadMatch) hostCpu = { ...hostCpu, load1: loadMatch[1], load5: loadMatch[2], load15: loadMatch[3] };
        }
      } catch {}
    }

    // Top 5 processes by CPU — use BusyBox-compatible ps
    let topProcesses: any[] = [];
    try {
      let psOut = '';
      try {
        const { stdout } = await execAsync('ps aux --sort=-%cpu | head -n 6', { timeout: 3000 });
        psOut = stdout?.trim() || '';
      } catch {
        psOut = '';
      }
      if (!psOut) {
        // BusyBox: use top output for process list
        try {
          const { stdout } = await execAsync('top -bn1 2>&1 | tail -n +6 | head -5', { timeout: 3000 });
          psOut = stdout?.trim() || '';
        } catch {}
      }
      topProcesses = psOut.split('\n').filter(Boolean).map(line => {
        const parts = line.trim().split(/\s+/);
        // Standard ps: USER PID %CPU %MEM ... COMMAND (parts.slice(10))
        // BusyBox top: PID PPID USER STAT VSZ %VSZ CPU %CPU COMMAND
        if (parts.length >= 4 && parts[0] === 'PID') return null; // header
        if (parts.length >= 8) {
          const isBusyBox = parts[0].match(/^\d+$/) && parts[2].match(/^[a-zA-Z]+$/);
          if (isBusyBox) {
            return { user: parts[2], pid: parts[0], cpu: parts[7] || '0', mem: parts[5] || '0', command: (parts.slice(8).join(' ') || '').substring(0, 80) };
          }
        }
        return { user: parts[0], pid: parts[1], cpu: parts[2], mem: parts[3], command: parts.slice(10).join(' ').substring(0, 80) };
      }).filter(Boolean).slice(0, 5);
    } catch {
      // ps not available
    }

    return { api: apiInfo, engine: engineInfo, containers: dockerStats, hostCpu, topProcesses };
  }
}
