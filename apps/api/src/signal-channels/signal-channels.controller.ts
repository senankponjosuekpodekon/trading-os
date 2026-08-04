import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SignalChannelsService } from './signal-channels.service';
import { CreateChannelDto, UpdateChannelDto } from './dto/signal-channel.dto';

@Controller('signal-channels')
@UseGuards(JwtAuthGuard)
export class SignalChannelsController {
  constructor(private readonly service: SignalChannelsService) {}

  @Get('public')
  listPublic(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.listPublic(parseInt(page || '1'), parseInt(limit || '20'));
  }

  @Get('owned')
  listOwned(@Request() req: any) {
    return this.service.listOwned(req.user.id);
  }

  @Get('subscribed')
  listSubscribed(@Request() req: any) {
    return this.service.listSubscribed(req.user.id);
  }

  @Post()
  create(@Request() req: any, @Body() dto: CreateChannelDto) {
    return this.service.create(req.user.id, dto);
  }

  @Patch(':id')
  update(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateChannelDto) {
    return this.service.update(req.user.id, id, dto);
  }

  @Delete(':id')
  delete(@Request() req: any, @Param('id') id: string) {
    return this.service.delete(req.user.id, id);
  }

  @Post(':id/subscribe')
  subscribe(@Request() req: any, @Param('id') id: string) {
    return this.service.subscribe(req.user.id, id);
  }

  @Delete(':id/subscribe')
  unsubscribe(@Request() req: any, @Param('id') id: string) {
    return this.service.unsubscribe(req.user.id, id);
  }

  @Get(':id/subscribers')
  getSubscribers(@Request() req: any, @Param('id') id: string) {
    return this.service.getSubscribers(id, req.user.id);
  }
}
