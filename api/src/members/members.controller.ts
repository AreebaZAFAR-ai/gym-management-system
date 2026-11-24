import { Body, Controller, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import type { MemberDetail, MemberListItem, RegisterMemberResponse } from '@gym/shared';
import { CurrentUser, type Principal, Roles } from '../auth/auth.decorators';
import { MembersService } from './members.service';

/**
 * §10 Members — reception, owner (due-date edit: owner):
 *   GET members?q&status · POST members · GET/PATCH members/:code
 *   (POST members/:code/reset-password is pending: the PDF does not say what the new password is.)
 * "A member account is created only by reception at registration" (§2); the owner may do everything reception can.
 */
@Roles('reception')
@Controller('members')
export class MembersController {
  constructor(@Inject(MembersService) private readonly members: MembersService) {}

  @Get()
  list(@CurrentUser() user: Principal, @Query() query: unknown): Promise<MemberListItem[]> {
    return this.members.list(user, query);
  }

  @Post()
  register(@CurrentUser() user: Principal, @Body() body: unknown): Promise<RegisterMemberResponse> {
    return this.members.register(user, body);
  }

  @Get(':code')
  detail(@CurrentUser() user: Principal, @Param('code') code: string): Promise<MemberDetail> {
    return this.members.detail(user, code);
  }

  @Patch(':code')
  update(@CurrentUser() user: Principal, @Param('code') code: string, @Body() body: unknown): Promise<MemberDetail> {
    return this.members.update(user, code, body);
  }
}
