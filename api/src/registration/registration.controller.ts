import { Body, Controller, Inject, Post, Req } from '@nestjs/common';
import type { RegisterGymResponse } from '@gym/shared';
import type { Request } from 'express';
import { Public } from '../auth/auth.decorators';
import { RegistrationService } from './registration.service';

/**
 * POST gyms/register (public): a gym owner registers their gym from the web admin.
 * Returns the generated Gym Code; no token, no password hash, no check-in secret.
 * The owner then signs in on the normal login page (gym code, mobile, password).
 */
@Controller('gyms')
export class RegistrationController {
  constructor(@Inject(RegistrationService) private readonly registration: RegistrationService) {}

  @Public()
  @Post('register')
  register(@Body() body: unknown, @Req() req: Request): Promise<RegisterGymResponse> {
    return this.registration.register(body, req.ip ?? 'unknown');
  }
}
