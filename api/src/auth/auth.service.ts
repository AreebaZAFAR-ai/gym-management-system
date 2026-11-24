import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { normalizePhone, type AuthUser, type LoginResponse } from '@gym/shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { parse } from '../common/validation';
import { DB, type Database } from '../db/db.module';
import { members, users } from '../db/schema';
import type { Principal } from './auth.decorators';
import type { TokenPayload } from './auth.guard';
import { LoginLimiter } from './login-limiter';
import { checkPassword, DUMMY_HASH, hashPassword } from './passwords';

/** §4.1 and §11: one error for a wrong phone number or a wrong password. */
export const WRONG_LOGIN = 'Wrong phone number or password.';
export const TOO_MANY_TRIES = 'Too many login attempts. Please try again in 15 minutes.';

const loginBody = z.object({
  gymId: z.string({ error: 'Gym is required.' }).trim().min(1, 'Gym is required.'),
  phone: z.string({ error: 'Phone number is required.' }),
  password: z.string({ error: 'Password is required.' }).min(1, 'Password is required.'),
});

const changePasswordBody = z.object({
  currentPassword: z.string({ error: 'Enter your current password.' }).min(1, 'Enter your current password.'),
  newPassword: z.string({ error: 'Enter a new password.' }).min(1, 'Enter a new password.'),
});

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(LoginLimiter) private readonly limiter: LoginLimiter,
  ) {}

  /** POST auth/login {gymId, phone, password} -> {token, user} (§10). */
  async login(body: unknown): Promise<LoginResponse> {
    const { gymId, phone: rawPhone, password } = parse(loginBody, body);
    const phone = normalizePhone(rawPhone);

    if (!this.limiter.attempt(gymId, phone ?? rawPhone.replace(/\D/g, ''))) {
      throw new HttpException(TOO_MANY_TRIES, HttpStatus.TOO_MANY_REQUESTS);
    }

    const [user] = phone
      ? await this.db
          .select({ id: users.id, passwordHash: users.passwordHash, active: users.active })
          .from(users)
          .where(and(eq(users.gymId, gymId), eq(users.phone, phone)))
      : [];
    const passwordOk = await checkPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !passwordOk || !user.active) throw new UnauthorizedException(WRONG_LOGIN);

    const payload: TokenPayload = { sub: user.id, gym: gymId };
    const token = await this.jwt.signAsync(payload);
    return { token, user: await this.authUser(user.id, gymId) };
  }

  /** GET auth/me */
  me(principal: Principal): Promise<AuthUser> {
    return this.authUser(principal.id, principal.gymId);
  }

  /** POST auth/change-password {currentPassword, newPassword} */
  async changePassword(principal: Principal, body: unknown): Promise<void> {
    const { currentPassword, newPassword } = parse(changePasswordBody, body);
    const [user] = await this.db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(and(eq(users.id, principal.id), eq(users.gymId, principal.gymId)));
    if (!user || !(await checkPassword(currentPassword, user.passwordHash))) {
      throw new BadRequestException('Your current password is wrong.');
    }
    await this.db
      .update(users)
      .set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() })
      .where(and(eq(users.id, principal.id), eq(users.gymId, principal.gymId)));
  }

  private async authUser(id: string, gymId: string): Promise<AuthUser> {
    const [row] = await this.db
      .select({ id: users.id, gymId: users.gymId, name: users.name, phone: users.phone, role: users.role, memberCode: members.code })
      .from(users)
      .leftJoin(members, and(eq(members.gymId, users.gymId), eq(members.userId, users.id)))
      .where(and(eq(users.id, id), eq(users.gymId, gymId)));
    if (!row) throw new UnauthorizedException(WRONG_LOGIN);
    const user: AuthUser = { id: row.id, gymId: row.gymId, name: row.name, phone: row.phone, role: row.role };
    if (row.role === 'member' && row.memberCode) user.memberCode = row.memberCode;
    return user;
  }
}
