import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '@gym/shared';

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';

/** The signed-in user, loaded fresh from the database on every request. */
export interface Principal {
  id: string;
  gymId: string;
  role: Role;
  name: string;
  phone: string;
}

/** No bearer token needed (§10: login, gym brand, door device; plus /health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Roles allowed on a route (§2, §10). The owner may call every staff route;
 * members never may (403).
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): Principal => {
  return ctx.switchToHttp().getRequest<{ user: Principal }>().user;
});
