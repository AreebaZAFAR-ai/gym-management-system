import { Inject, Injectable } from '@nestjs/common';
import { addDays, addMonths, daysBetween, DUE_SOON_DAYS, pkToday, type DashboardSummary, type PaymentMethod, type ReportsSummary } from '@gym/shared';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { Principal } from '../auth/auth.decorators';
import { pkDayStart } from '../common/db-errors';
import { DB, type Database } from '../db/db.module';
import { checkins, freezeRequests, members, paymentProofs } from '../db/schema';
import { isActiveMember, selectMembers, toListItem } from '../members/member-view';
import { effectivePayments } from '../payments/payments.service';

const PK = sql.raw(`'Asia/Karachi'`);
const METHODS: PaymentMethod[] = ['cash', 'jazzcash', 'easypaisa', 'bank'];

/**
 * §6 Overview and Reports. Money totals count each payment once, using its
 * latest correction (corrections never double-count).
 */
@Injectable()
export class DashboardService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** GET dashboard — reception, owner. */
  async dashboard(staff: Principal): Promise<DashboardSummary> {
    const today = pkToday();
    const monthStart = `${today.slice(0, 7)}-01`;
    const list = (await selectMembers(this.db, staff.gymId)).map((m) => toListItem(m, today));
    const enabled = list.filter((m) => m.active);
    const overdue = enabled.filter((m) => m.status === 'overdue').sort((a, b) => a.dueOn.localeCompare(b.dueOn));
    const dueSoon = enabled
      .filter((m) => m.dueOn >= today && daysBetween(today, m.dueOn) <= DUE_SOON_DAYS && m.status !== 'frozen')
      .sort((a, b) => a.dueOn.localeCompare(b.dueOn));

    const [joined] = await this.db.select({ n: sql<number>`count(*)::int` }).from(members)
      .where(and(eq(members.gymId, staff.gymId), gte(members.joinedOn, monthStart)));
    const [todayCheckins] = await this.db.select({ n: sql<number>`count(*)::int` }).from(checkins)
      .where(and(eq(checkins.gymId, staff.gymId), eq(checkins.allowed, true), gte(checkins.createdAt, pkDayStart(today)), lt(checkins.createdAt, pkDayStart(addDays(today, 1)))));
    const [proofs] = await this.db.select({ n: sql<number>`count(*)::int` }).from(paymentProofs)
      .where(and(eq(paymentProofs.gymId, staff.gymId), eq(paymentProofs.status, 'pending')));
    const [freezes] = await this.db.select({ n: sql<number>`count(*)::int` }).from(freezeRequests)
      .where(and(eq(freezeRequests.gymId, staff.gymId), eq(freezeRequests.status, 'pending')));
    const fees = await effectivePayments(this.db, staff.gymId, pkDayStart(monthStart), pkDayStart(addMonths(monthStart, 1)));

    return {
      activeMembers: list.filter(isActiveMember).length,
      joinedThisMonth: Number(joined?.n ?? 0),
      checkinsToday: Number(todayCheckins?.n ?? 0),
      feesThisMonthPkr: fees.reduce((s, p) => s + p.amountPkr, 0),
      overdueCount: overdue.length,
      // "PKR to collect": the plan fee of each overdue member (§7 uses the plan fee as the amount due).
      overduePkr: overdue.reduce((s, m) => s + m.feePkr, 0),
      pendingProofs: Number(proofs?.n ?? 0),
      pendingFreezes: Number(freezes?.n ?? 0),
      overdue,
      dueSoon,
    };
  }

  /** GET reports — owner (§6 Reports). */
  async reports(staff: Principal): Promise<ReportsSummary> {
    const today = pkToday();
    const monthStart = `${today.slice(0, 7)}-01`;
    const sixMonthsStart = addMonths(monthStart, -5);

    const fees = await effectivePayments(this.db, staff.gymId, pkDayStart(sixMonthsStart), pkDayStart(addMonths(monthStart, 1)));
    const pkMonth = (d: Date) => new Date(d.getTime() + 5 * 3600_000).toISOString().slice(0, 7);
    const feesByMonth = Array.from({ length: 6 }, (_, i) => addMonths(sixMonthsStart, i).slice(0, 7)).map((month) => ({
      month,
      totalPkr: fees.filter((p) => pkMonth(p.createdAt) === month).reduce((s, p) => s + p.amountPkr, 0),
    }));
    const thisMonth = fees.filter((p) => pkMonth(p.createdAt) === monthStart.slice(0, 7));
    const thisMonthByMethod = METHODS.map((method) => ({
      method,
      totalPkr: thisMonth.filter((p) => p.method === method).reduce((s, p) => s + p.amountPkr, 0),
    }));

    // Allowed check-ins in the last 30 days (Pakistan time).
    const since = pkDayStart(addDays(today, -29));
    const where = and(eq(checkins.gymId, staff.gymId), eq(checkins.allowed, true), gte(checkins.createdAt, since));
    const byHour = await this.db
      .select({ hour: sql<number>`extract(hour from ${checkins.createdAt} at time zone ${PK})::int`, n: sql<number>`count(*)::int` })
      .from(checkins).where(where).groupBy(sql`1`);
    const byDay = await this.db
      .select({ day: sql<string>`to_char(${checkins.createdAt} at time zone ${PK}, 'YYYY-MM-DD')`, n: sql<number>`count(*)::int` })
      .from(checkins).where(where).groupBy(sql`1`);
    const hourMap = new Map(byHour.map((r) => [Number(r.hour), Number(r.n)]));
    const dayMap = new Map(byDay.map((r) => [r.day, Number(r.n)]));

    // "Might quit": paid-up members with no visit in 14 days.
    const recent = await this.db
      .selectDistinct({ memberId: checkins.memberId })
      .from(checkins)
      .where(and(eq(checkins.gymId, staff.gymId), eq(checkins.allowed, true), gte(checkins.createdAt, pkDayStart(addDays(today, -13)))));
    const visited = new Set(recent.map((r) => r.memberId));
    const mightQuit = (await selectMembers(this.db, staff.gymId))
      .map((m) => toListItem(m, today))
      .filter((m) => m.active && (m.status === 'active' || m.status === 'due_soon') && !visited.has(m.memberId))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      feesByMonth,
      checkinsByHour: Array.from({ length: 24 }, (_, hour) => ({ hour, count: hourMap.get(hour) ?? 0 })),
      dailyCheckins: Array.from({ length: 30 }, (_, i) => addDays(today, i - 29)).map((date) => ({ date, count: dayMap.get(date) ?? 0 })),
      thisMonthByMethod,
      mightQuit,
    };
  }
}
