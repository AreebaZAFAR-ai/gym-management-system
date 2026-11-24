import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { pkToday, type Announcement, type WhatsAppMessage } from '@gym/shared';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Principal } from '../auth/auth.decorators';
import { parse, uuidParam } from '../common/validation';
import { DB, type Database } from '../db/db.module';
import { announcements, users, whatsappMessages } from '../db/schema';
import { selectMembers, toListItem } from '../members/member-view';
import { queueWhatsapp, toWhatsAppMessage } from '../whatsapp/whatsapp';

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

/**
 * §6 WhatsApp and Announcements; §7 WhatsApp log.
 * Unresolved: POST whatsapp/reminders ("Add fee reminders") is not implemented
 * because the PDF gives no reminder wording.
 */
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
