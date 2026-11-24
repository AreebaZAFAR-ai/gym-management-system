import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import type { AuthUser, LoginResponse } from '@gym/shared';
import { CurrentUser, type Principal, Public } from './auth.decorators';
import { AuthService } from './auth.service';

/** §10 Auth: POST auth/login (public) · GET auth/me · POST auth/change-password (any role). */
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: unknown): Promise<LoginResponse> {
    return this.auth.login(body);
  }

  @Get('me')
  me(@CurrentUser() user: Principal): Promise<AuthUser> {
    return this.auth.me(user);
  }

  @Post('change-password')
  @HttpCode(204)
  changePassword(@CurrentUser() user: Principal, @Body() body: unknown): Promise<void> {
    return this.auth.changePassword(user, body);
  }
}
