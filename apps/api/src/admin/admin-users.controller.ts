import { Controller, Get, Patch, Body, Param, UseGuards, Query } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, UserRole } from '@prisma/client';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class AdminUsersController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    const pageNum = page ? Math.max(1, parseInt(page, 10)) : 1;
    const limitNum = limit ? Math.min(100, Math.max(1, parseInt(limit, 10))) : 20;
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          timezone: true,
          createdAt: true,
          lastLoginAt: true,
          notificationPreference: {
            select: {
              pushEnabled: true,
              telegramEnabled: true,
              emailEnabled: true,
              minConfidence: true,
            },
          },
          _count: {
            select: {
              portfolios: true,
              strategies: true,
            },
          },
        },
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data,
      meta: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { role?: string; isActive?: boolean },
  ) {
    const data: any = {};
    if (body.role) data.role = body.role;
    if (typeof body.isActive === 'boolean') data.isActive = body.isActive;

    return this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
      },
    });
  }

  /**
   * PATCH /admin/users/:id/notifications — contrôle admin des canaux de
   * notification d'un user (ex. couper le push d'un compte inactif).
   * Upsert la préférence : elle est créée si absente.
   */
  @Patch(':id/notifications')
  async updateNotifications(
    @Param('id') id: string,
    @Body() body: {
      pushEnabled?: boolean;
      telegramEnabled?: boolean;
      emailEnabled?: boolean;
      discordEnabled?: boolean;
      minConfidence?: number;
    },
  ) {
    const data: any = {};
    for (const k of ['pushEnabled', 'telegramEnabled', 'emailEnabled', 'discordEnabled'] as const) {
      if (typeof body[k] === 'boolean') data[k] = body[k];
    }
    if (typeof body.minConfidence === 'number') {
      data.minConfidence = Math.max(0, Math.min(100, Math.round(body.minConfidence)));
    }
    if (Object.keys(data).length === 0) {
      return { updated: false, reason: 'empty body' };
    }
    // Couper le push invalide aussi la subscription — évite qu'une sub
    // fantôme reste ciblable si on réactive pushEnabled plus tard.
    if (data.pushEnabled === false) data.pushSubscription = Prisma.DbNull;
    const pref = await this.prisma.notificationPreference.upsert({
      where: { userId: id },
      update: data,
      create: { userId: id, ...data },
    });
    return { updated: true, userId: id, preferences: pref };
  }

  @Get('stats')
  async stats() {
    const [total, active, byRole] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.user.groupBy({
        by: ['role'],
        _count: true,
      }),
    ]);

    return {
      total,
      active,
      inactive: total - active,
      byRole: byRole.reduce((acc, r) => {
        acc[r.role] = r._count;
        return acc;
      }, {} as Record<string, number>),
    };
  }
}
