import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { LoginLimiter } from './login-limiter';

/** §11: JWT signed with a secret from the environment, 60-day expiry. */
export const TOKEN_EXPIRY = '60d';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({ secret: env.JWT_SECRET, signOptions: { expiresIn: TOKEN_EXPIRY } }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, LoginLimiter, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AuthModule {}
