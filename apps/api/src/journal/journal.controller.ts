import { Controller, Get, Post, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JournalService, CreateJournalDto } from './journal.service';

@Controller('journal')
@UseGuards(JwtAuthGuard)
export class JournalController {
  constructor(private journalService: JournalService) {}

  @Post()
  create(@Request() req: any, @Body() dto: CreateJournalDto) {
    return this.journalService.create(req.user.id, dto);
  }

  @Get()
  findAll(@Request() req: any, @Query('limit') limit?: string) {
    return this.journalService.findAll(req.user.id, limit ? parseInt(limit) : 30);
  }

  @Get('stats')
  getStats(@Request() req: any) {
    return this.journalService.getStats(req.user.id);
  }

  @Get(':id')
  findOne(@Request() req: any, @Param('id') id: string) {
    return this.journalService.findOne(req.user.id, id);
  }
}
