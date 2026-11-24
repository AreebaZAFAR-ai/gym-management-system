import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Role } from '@gym/shared';
import { and, eq } from 'drizzle-orm';
import type { Request } from 'express';
import { DB, type Database } from '../db/db.module';
import { users } from '../db/schema';
import { IS_PUBLIC, type Principal, ROLES } from './auth.decorators';

export const LOGIN_AGAIN = 'Please log in again.';
export const NO_ACCESS = 'You do not have access to this.';

export interface TokenPayload {
  sub: string;
  gym: string;
}

/** True if this role may call a route open to `allowed` (§10: the owner may call every staff route). */
export function roleAllowed(role: Role, allowed: readonly Role[]): boolean {
  if (allowed.includes(role)) return true;
  return role === 'owner' && allowed.some((r) => r !== 'member');
}

/**
 * Runs on every route (registered as APP_GUARD). Verifies the bearer token,
 * reloads the user scoped to the token's gym, then checks the route's roles.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(DB) private readonly db: Database,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: Principal }>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException(LOGIN_AGAIN);

    let payload: TokenPayload;
    try {
      payload = await this.jwt.verifyAsync<TokenPayload>(token);
    } catch {
      throw new UnauthorizedException(LOGIN_AGAIN);
    }
    if (typeof payload.sub !== 'string' || typeof payload.gym !== 'string') throw new UnauthorizedException(LOGIN_AGAIN);

    const [user] = await this.db
      .select({ id: users.id, gymId: users.gymId, role: users.role, name: users.name, phone: users.phone })
      .from(users)
      .where(and(eq(users.id, payload.sub), eq(users.gymId, payload.gym)));
    if (!user) throw new UnauthorizedException(LOGIN_AGAIN);

    const allowed = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (allowed && !roleAllowed(user.role, allowed)) throw new ForbiddenException(NO_ACCESS);

    req.user = { id: user.id, gymId: user.gymId, role: user.role, name: user.name, phone: user.phone };
    return true;
  }
}
