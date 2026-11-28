import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { addDays, pkToday, type Announcement, type FeeRemindersResponse, type WhatsAppMessage } from '@gym/shared';
import { and, desc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';
import type { Principal } from '../auth/auth.decorators';
import { parse, uuidParam } from '../common/validation';
import { DB, type Database } from '../db/db.module';
import { announcements, gyms, users, whatsappMessages } from '../db/schema';
import { selectMembers, toListItem } from '../members/member-view';
import { queueWhatsapp, reminderText, toWhatsAppMessage } from '../whatsapp/whatsapp';

/** §7: "Fee reminders go to overdue members and those due within 3 days, at most once in 7 days per member." */
export const REMINDER_DUE_WITHIN_DAYS = 3;
export const REMINDER_EVERY_DAYS = 7;

export const MESSAGE_NOT_FOUND = 'Message not found.';
export const ANNOUNCEMENT_NOT_FOUND = 'Announcement not found.';

const listQuery = z.object({
  status: z.enum(['to_send', 'sent', 'all', 'queued', 'failed'], { error: 'Unknown status filter.' }).optional(),
});
const patchBody = z.object({ status: z.enum(['queued', 'sent', 'failed'], { error: 'Status must be queued, sent or failed.' }) });
const announcementBody = z.object({
  title: z.string({ error: 'Enter a title.' }).trim().min(1, 'Enter a title.'),
  body: z.string({ error: 'Enter the message.' }).trim().min(1, 'Enter the message.'),
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
   * POST whatsapp/reminders — §6 "Add fee reminders", §7 WhatsApp log.
   * Queues a reminder for every member whose §7 status is Overdue or whose due date is
   * within the next 3 days, skipping frozen members and anyone sent (queued) a reminder
   * in the last 7 days.
   */
  async queueReminders(staff: Principal): Promise<FeeRemindersResponse> {
    return this.db.transaction(async (tx) => {
      const today = pkToday();
      const [gym] = await tx.select({ name: gyms.name }).from(gyms).where(eq(gyms.id, staff.gymId));
      const since = new Date(Date.now() - REMINDER_EVERY_DAYS * 24 * 60 * 60 * 1000);
      const recent = await tx.select({ memberId: whatsappMessages.memberId }).from(whatsappMessages)
        .where(and(eq(whatsappMessages.gymId, staff.gymId), eq(whatsappMessages.kind, 'reminder'), gte(whatsappMessages.createdAt, since)));
      const remindedRecently = new Set(recent.map((r) => r.memberId));
      const dueBy = addDays(today, REMINDER_DUE_WITHIN_DAYS);

      let queued = 0;
      for (const m of await selectMembers(tx, staff.gymId)) {
        if (remindedRecently.has(m.memberId)) continue;
        // Frozen members get no reminder (§7 status order checks Frozen first).
        const status = toListItem(m, today).status;
        if (status === 'frozen') continue;
        const overdue = status === 'overdue';
        const dueSoon = m.dueOn >= today && m.dueOn <= dueBy;
        if (!overdue && !dueSoon) continue;
        await queueWhatsapp(tx, {
          gymId: staff.gymId, memberId: m.memberId, toPhone: m.phone, kind: 'reminder',
          body: reminderText(m.name, gym!.name, m.feePkr, m.dueOn, overdue),
        });
        queued++;
      }
      return { queued };
    });
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
        // §6 "all active members", read as the §7 status "Active".
        const recipients = (await selectMembers(tx, staff.gymId)).filter((m) => toListItem(m, today).status === 'active');
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
