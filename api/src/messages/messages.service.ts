import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { addDays, pkToday, type Announcement, type WhatsAppMessage } from '@gym/shared';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Principal } from '../auth/auth.decorators';
import { parse, uuidParam } from '../common/validation';
import { DB, type Database } from '../db/db.module';
import { announcements, gyms, users, whatsappMessages } from '../db/schema';
import { isActiveMember, selectMembers, toListItem } from '../members/member-view';
import { queueWhatsapp, reminderText, toWhatsAppMessage } from '../whatsapp/whatsapp';

export const MESSAGE_NOT_FOUND = 'Message not found.';
export const ANNOUNCEMENT_NOT_FOUND = 'Announcement not found.';
/** §7: fee reminders go to overdue members and those due within 3 days, at most once in 7 days per member. */
export const REMINDER_DUE_WITHIN_DAYS = 3;
export const REMINDER_GAP_DAYS = 7;

const listQuery = z.object({
  status: z.enum(['to_send', 'sent', 'all', 'queued', 'failed'], { error: 'Unknown status filter.' }).optional(),
});
const patchBody = z.object({ status: z.enum(['queued', 'sent', 'failed'], { error: 'Status must be queued, sent or failed.' }) });
const announcementBody = z.object({
  title: z.string({ error: 'Enter a title.' }).trim().min(1, 'Enter a title.').max(200, 'Keep the title under 200 characters.'),
  body: z.string({ error: 'Enter the message.' }).trim().min(1, 'Enter the message.').max(4000, 'Keep the message under 4,000 characters.'),
  sendWhatsApp: z.boolean().optional(),
});

/** §6 WhatsApp and Announcements; §7 WhatsApp log. */
@Injectable()
export class MessagesService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** GET whatsapp?status — To send (queued) / Sent / All. Newest first. */
  async list(staff: Principal, query: unknown): Promise<WhatsAppMessage[]> {
    const { status = 'all' } = parse(listQuery, query);
    const s = status === 'to_send' ? 'queued' : status;
    const rows = await this.db
      .select({ m: whatsappMessages, name: users.name })
      .from(whatsappMessages)
      .leftJoin(users, and(eq(users.gymId, whatsappMessages.gymId), eq(users.id, whatsappMessages.memberId)))
      .where(and(eq(whatsappMessages.gymId, staff.gymId), s === 'all' ? undefined : eq(whatsappMessages.status, s)))
      .orderBy(desc(whatsappMessages.createdAt));
    return rows.map(({ m, name }) => toWhatsAppMessage(m, name));
  }

  /** PATCH whatsapp/:id {status} — "Mark sent". */
  async setStatus(staff: Principal, id: string, body: unknown): Promise<WhatsAppMessage> {
    const { status } = parse(patchBody, body);
    if (!uuidParam.safeParse(id).success) throw new NotFoundException(MESSAGE_NOT_FOUND);
    const [m] = await this.db.update(whatsappMessages).set({ status })
      .where(and(eq(whatsappMessages.gymId, staff.gymId), eq(whatsappMessages.id, id))).returning();
    if (!m) throw new NotFoundException(MESSAGE_NOT_FOUND);
    const [u] = m.memberId ? await this.db.select({ name: users.name }).from(users).where(eq(users.id, m.memberId)) : [];
    return toWhatsAppMessage(m, u?.name ?? null);
  }

  /**
   * POST whatsapp/reminders — "Add fee reminders" (§6, §7): queues reminders for
   * overdue members and those due within 3 days, skipping anyone reminded in the
   * last 7 days. Disabled accounts are skipped.
   */
  async queueReminders(staff: Principal): Promise<{ queued: number }> {
    const today = pkToday();
    const [gym] = await this.db.select({ name: gyms.name }).from(gyms).where(eq(gyms.id, staff.gymId));
    const due = (await selectMembers(this.db, staff.gymId))
      .filter((m) => m.active && m.dueOn <= addDays(today, REMINDER_DUE_WITHIN_DAYS));
    if (!due.length) return { queued: 0 };

    const recent = await this.db
      .selectDistinct({ memberId: whatsappMessages.memberId })
      .from(whatsappMessages)
      .where(and(
        eq(whatsappMessages.gymId, staff.gymId),
        eq(whatsappMessages.kind, 'reminder'),
        inArray(whatsappMessages.memberId, due.map((m) => m.memberId)),
        gte(whatsappMessages.createdAt, new Date(Date.now() - REMINDER_GAP_DAYS * 86_400_000)),
      ));
    const skip = new Set(recent.map((r) => r.memberId));
    const toRemind = due.filter((m) => !skip.has(m.memberId));
    await this.db.transaction(async (tx) => {
      for (const m of toRemind) {
        await queueWhatsapp(tx, {
          gymId: staff.gymId, memberId: m.memberId, toPhone: m.phone, kind: 'reminder',
          body: reminderText(m.name, gym!.name, m.feePkr, m.dueOn, today),
        });
      }
    });
    return { queued: toRemind.length };
  }

  /** GET announcements — any signed-in user of the gym (§10 Shared). */
  async announcements(user: Principal): Promise<Announcement[]> {
    const rows = await this.db.select().from(announcements).where(eq(announcements.gymId, user.gymId)).orderBy(desc(announcements.createdAt));
    return rows.map((a) => ({ id: a.id, title: a.title, body: a.body, createdAt: a.createdAt.toISOString() }));
  }

  /** POST announcements {title, body, sendWhatsApp} — optional WhatsApp copy to all active members (§6). */
  async createAnnouncement(staff: Principal, body: unknown): Promise<Announcement & { whatsappQueued: number }> {
    const input = parse(announcementBody, body);
    return this.db.transaction(async (tx) => {
      const [a] = await tx.insert(announcements)
        .values({ gymId: staff.gymId, title: input.title, body: input.body, createdBy: staff.id }).returning();
      let whatsappQueued = 0;
      if (input.sendWhatsApp) {
        const today = pkToday();
        const recipients = (await selectMembers(tx, staff.gymId)).filter((m) => isActiveMember(toListItem(m, today)));
        for (const m of recipients) {
          await queueWhatsapp(tx, { gymId: staff.gymId, memberId: m.memberId, toPhone: m.phone, kind: 'announcement', body: `${input.title}\n\n${input.body}` });
        }
        whatsappQueued = recipients.length;
      }
      return { id: a!.id, title: a!.title, body: a!.body, createdAt: a!.createdAt.toISOString(), whatsappQueued };
    });
  }

  /** DELETE announcements/:id */
  async deleteAnnouncement(staff: Principal, id: string): Promise<void> {
    if (!uuidParam.safeParse(id).success) throw new NotFoundException(ANNOUNCEMENT_NOT_FOUND);
    const deleted = await this.db.delete(announcements)
      .where(and(eq(announcements.gymId, staff.gymId), eq(announcements.id, id))).returning({ id: announcements.id });
    if (!deleted.length) throw new NotFoundException(ANNOUNCEMENT_NOT_FOUND);
  }
}
