import { Controller, Get, Patch, Body, Param, Query, UseGuards, Request, BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Controller('users')
export class UsersController {
  constructor(private prisma: PrismaService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMe(@Request() req: any) {
    return req.user;
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  async updateMe(@Request() req: any, @Body() body: { timezone?: string }) {
    const data: Record<string, any> = {};
    if (body.timezone) data.timezone = body.timezone;
    if (Object.keys(data).length === 0) return req.user;
    return this.prisma.user.update({
      where: { id: req.user.id },
      data,
      select: { id: true, email: true, name: true, role: true, isActive: true, timezone: true, createdAt: true },
    });
  }

  // ── SUPER_ADMIN: user management ──────────────────────────────

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Get()
  async listUsers(@Query('page') page?: string, @Query('limit') limit?: string, @Query('search') search?: string) {
    const pageNum = page ? Number(page) : 1;
    const limitNum = limit ? Number(limit) : 50;
    const where: any = {};
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: { id: true, email: true, name: true, role: true, isActive: true, timezone: true, createdAt: true, totpEnabled: true },
        orderBy: { createdAt: 'desc' },
        skip: (Math.max(pageNum, 1) - 1) * Math.min(limitNum, 100),
        take: Math.min(limitNum, 100),
      }),
      this.prisma.user.count({ where }),
    ]);
    return { users, total, page: Math.max(pageNum, 1), limit: Math.min(limitNum, 100) };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Patch(':id/role')
  async updateRole(@Param('id') id: string, @Body() body: { role: UserRole }, @Request() req: any) {
    const validRoles: UserRole[] = ['TRADER', 'INVESTOR', 'ADMIN', 'SUPER_ADMIN'];
    if (!validRoles.includes(body.role)) {
      throw new BadRequestException(`Invalid role. Must be one of: ${validRoles.join(', ')}`);
    }
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('User not found');
    if (target.id === req.user.id) {
      throw new BadRequestException('Cannot change your own role');
    }
    return this.prisma.user.update({
      where: { id },
      data: { role: body.role },
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Patch(':id/status')
  async updateStatus(@Param('id') id: string, @Body() body: { isActive: boolean }, @Request() req: any) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('User not found');
    if (target.id === req.user.id) {
      throw new BadRequestException('Cannot deactivate your own account');
    }
    return this.prisma.user.update({
      where: { id },
      data: { isActive: body.isActive },
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });
  }
}
