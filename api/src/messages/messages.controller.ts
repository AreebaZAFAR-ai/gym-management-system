import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import type { Announcement, FeeRemindersResponse, WhatsAppMessage } from '@gym/shared';
import { CurrentUser, type Principal, Roles } from '../auth/auth.decorators';
import { MessagesService } from './messages.service';

/**
 * §10 Messages — reception, owner: GET whatsapp?status · PATCH whatsapp/:id ·
 * POST whatsapp/reminders · POST/DELETE announcements.
 * §10 Shared — any role: GET announcements.
 */
@Controller()
export class MessagesController {
  constructor(@Inject(MessagesService) private readonly messages: MessagesService) {}

  @Roles('reception')
  @Get('whatsapp')
  list(@CurrentUser() user: Principal, @Query() query: unknown): Promise<WhatsAppMessage[]> {
    return this.messages.list(user, query);
  }

  @Roles('reception')
  @Patch('whatsapp/:id')
  setStatus(@CurrentUser() user: Principal, @Param('id') id: string, @Body() body: unknown): Promise<WhatsAppMessage> {
    return this.messages.setStatus(user, id, body);
  }

  @Roles('reception')
  @Post('whatsapp/reminders')
  @HttpCode(200)
  reminders(@CurrentUser() user: Principal): Promise<FeeRemindersResponse> {
    return this.messages.queueReminders(user);
  }

  @Get('announcements')
  announcements(@CurrentUser() user: Principal): Promise<Announcement[]> {
    return this.messages.announcements(user);
  }

  @Roles('reception')
  @Post('announcements')
  create(@CurrentUser() user: Principal, @Body() body: unknown): Promise<Announcement & { whatsappQueued: number }> {
    return this.messages.createAnnouncement(user, body);
  }

  @Roles('reception')
  @Delete('announcements/:id')
  @HttpCode(204)
  remove(@CurrentUser() user: Principal, @Param('id') id: string): Promise<void> {
    return this.messages.deleteAnnouncement(user, id);
  }
}
