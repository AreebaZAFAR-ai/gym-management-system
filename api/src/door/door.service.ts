import { createHash, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  addDays,
  entryDecision,
  isCheckinQr,
  pkToday,
  verifyCheckinQr,
  type CheckinLogItem,
  type CheckinSource,
  type ScanResult,
} from '@gym/shared';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Principal } from '../auth/auth.decorators';
import { pkDayStart } from '../common/db-errors';
import { isoDate, parse } from '../common/validation';
import { DB, type Database } from '../db/db.module';
import { checkins, gyms, members, users } from '../db/schema';
import { selectMembers, toScanMember, type MemberRow } from '../members/member-view';

export const DEVICE_NOT_RECOGNISED = 'Device not recognised.';
export const ENTRY_ALLOWED = 'Entry allowed';
export const unknownMemberCode = (code: string) => `No member with ID ${code} at this gym.`;

type DoorGym = { id: string; graceDays: number };

const scanBody = z.object({
  code: z.string({ error: 'Enter a member ID or scan a code.' }).trim().min(1, 'Enter a member ID or scan a code.'),
});
const listQuery = z.object({ date: isoDate('"date" must be a date like 2026-11-25.').optional() });

/**
 * The door (§5.1, §6 Check-ins, §7 Entry at the door). Every scan is saved as a
 * check-in, allowed or blocked, with its source (App QR, typed ID, thumbprint)
 * and who scanned it, including scans that identified no member.
 */
@Injectable()
export class DoorService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** POST checkins/scan {code}: a QR payload (GYM1.…) or a typed member ID (IH-0412). */
  async scan(staff: Principal, body: unknown): Promise<ScanResult> {
    const { code } = parse(scanBody, body);
    const [gym] = await this.db
      .select({ id: gyms.id, graceDays: gyms.graceDays, secret: gyms.checkinSecret })
      .from(gyms)
      .where(eq(gyms.id, staff.gymId));
    if (!gym) throw new UnauthorizedException();

    if (isCheckinQr(code)) {
      const v = verifyCheckinQr(code, gym.id, gym.secret);
      if (!v.ok) {
        // Never store the QR payload itself; the reason is enough.
        await this.save(gym.id, null, false, v.message, 'qr', staff.id);
        return { ok: false, message: v.message };
      }
      const [m] = await selectMembers(this.db, gym.id, eq(members.code, v.memberCode));
      return this.decide(gym, m, unknownMemberCode(v.memberCode), 'qr', staff.id);
    }

    const typed = code.toUpperCase();
    const [m] = await selectMembers(this.db, gym.id, sql`upper(${members.code}) = ${typed}`);
    return this.decide(gym, m, unknownMemberCode(typed), 'manual', staff.id);
  }

  /** GET checkins?date= — the day log in Pakistan time, newest first (default today). */
  async list(staff: Principal, query: unknown): Promise<CheckinLogItem[]> {
    const { date = pkToday() } = parse(listQuery, query);
    const rows = await this.db
      .select({ c: checkins, memberCode: members.code, memberName: users.name })
      .from(checkins)
      .leftJoin(members, and(eq(members.gymId, checkins.gymId), eq(members.userId, checkins.memberId)))
      .leftJoin(users, and(eq(users.gymId, checkins.gymId), eq(users.id, checkins.memberId)))
      .where(and(eq(checkins.gymId, staff.gymId), gte(checkins.createdAt, pkDayStart(date)), lt(checkins.createdAt, pkDayStart(addDays(date, 1)))))
      .orderBy(desc(checkins.createdAt));
    return rows.map(({ c, memberCode, memberName }) => toLogItem(c, memberCode, memberName));
  }

  /** §10: the door device sends its key in x-device-key. Same answer for unknown gym and wrong key. */
  async authenticateDevice(gymId: string, deviceKey: string | undefined): Promise<DoorGym> {
    const [gym] = await this.db
      .select({ id: gyms.id, graceDays: gyms.graceDays, deviceKey: gyms.deviceKey })
      .from(gyms)
      .where(eq(gyms.id, gymId));
    if (!gym || !gym.deviceKey || !deviceKey || !sameSecret(gym.deviceKey, deviceKey)) {
      throw new UnauthorizedException(DEVICE_NOT_RECOGNISED);
    }
    return { id: gym.id, graceDays: gym.graceDays };
  }

  /** A fingerprint ID from the gym's device: looked up only within that gym. */
  async fingerprintCheckin(gym: DoorGym, fingerprintId: string): Promise<ScanResult> {
    const [m] = await selectMembers(this.db, gym.id, eq(members.fingerprintId, fingerprintId));
    // Unresolved: the PDF gives no message for an unknown fingerprint ID. The scan
    // is saved (§7 "every scan is saved") with no reason and an empty message.
    return this.decide(gym, m, null, 'fingerprint', null);
  }

  private async decide(
    gym: DoorGym,
    m: MemberRow | undefined,
    notFound: string | null,
    source: CheckinSource,
    scannedBy: string | null,
  ): Promise<ScanResult> {
    if (!m) {
      await this.save(gym.id, null, false, notFound, source, scannedBy);
      return { ok: false, message: notFound ?? '' };
    }
    const today = pkToday();
    const member = toScanMember(m, today);
    const decision = entryDecision(m, today, gym.graceDays);
    if (decision.allowed) {
      await this.save(gym.id, m.memberId, true, null, source, scannedBy);
      return { ok: true, allowed: true, member, message: ENTRY_ALLOWED };
    }
    await this.save(gym.id, m.memberId, false, decision.message, source, scannedBy);
    return {
      ok: true,
      allowed: false,
      member,
      message: decision.message,
      // §7: "with the plan fee as the amount due".
      amountDue: decision.reason === 'overdue' ? m.feePkr : null,
    };
  }

  private async save(
    gymId: string,
    memberId: string | null,
    allowed: boolean,
    reason: string | null,
    source: CheckinSource,
    scannedBy: string | null,
  ) {
    await this.db.insert(checkins).values({ gymId, memberId, allowed, reason, source, scannedBy });
  }
}

export function toLogItem(c: typeof checkins.$inferSelect, memberCode: string | null, memberName: string | null): CheckinLogItem {
  return {
    id: c.id, memberId: c.memberId, memberCode, memberName, allowed: c.allowed, reason: c.reason,
    source: c.source, scannedBy: c.scannedBy, createdAt: c.createdAt.toISOString(),
  };
}

/** Constant-time comparison that does not leak the stored key's length. */
function sameSecret(stored: string, given: string): boolean {
  const a = createHash('sha256').update(stored).digest();
  const b = createHash('sha256').update(given).digest();
  return timingSafeEqual(a, b);
}
