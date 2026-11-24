import { Body, Controller, Get, HttpCode, Inject, Post, Query } from '@nestjs/common';
import type { CheckinLogItem, ScanResult } from '@gym/shared';
import { CurrentUser, type Principal, Roles } from '../auth/auth.decorators';
import { DoorService } from './door.service';

/** §10 Door: POST checkins/scan {code} (QR or typed ID) · GET checkins?date= — reception, owner. */
@Roles('reception')
@Controller('checkins')
export class CheckinsController {
  constructor(@Inject(DoorService) private readonly door: DoorService) {}

  @Post('scan')
  @HttpCode(200)
  scan(@CurrentUser() user: Principal, @Body() body: unknown): Promise<ScanResult> {
    return this.door.scan(user, body);
  }

  @Get()
  list(@CurrentUser() user: Principal, @Query() query: unknown): Promise<CheckinLogItem[]> {
    return this.door.list(user, query);
  }
}
