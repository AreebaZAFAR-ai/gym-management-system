import {
  formatPKR,
  formatShortDate,
  PAYMENT_METHOD_LABELS,
  whatsappLink,
  whatsappNumber,
  type PaymentMethod,
  type WhatsAppKind,
  type WhatsAppMessage,
} from '@gym/shared';
import type { Database } from '../db/db.module';
import { whatsappMessages } from '../db/schema';

export function toWhatsAppMessage(m: typeof whatsappMessages.$inferSelect, memberName: string | null): WhatsAppMessage {
  return {
    id: m.id, memberId: m.memberId, memberName, toPhone: m.toPhone, kind: m.kind, body: m.body, status: m.status,
    createdAt: m.createdAt.toISOString(), link: whatsappLink(whatsappNumber(m.toPhone), m.body),
  };
}

/** A database or an open transaction. */
export type Executor = Pick<Database, 'insert' | 'select' | 'update'>;

/**
 * §7 receipt, word for word:
 * "Assalam o Alaikum Ali, we received PKR 4,000 by JazzCash at Iron House Fitness.
 *  Your membership is paid till 25 Dec. Thank you!"
 * The example greets by first name, as the app's demo does.
 */
export function receiptText(memberName: string, amountPkr: number, method: PaymentMethod, gymName: string, paidTill: string): string {
  const first = memberName.trim().split(/\s+/)[0] ?? memberName;
  return (
    `Assalam o Alaikum ${first}, we received ${formatPKR(amountPkr)} by ${PAYMENT_METHOD_LABELS[method]} at ${gymName}. ` +
    `Your membership is paid till ${formatShortDate(paidTill)}. Thank you!`
  );
}

/**
 * Welcome WhatsApp queued at registration (§6, §7 Registration): the default password is
 * "sent in the welcome WhatsApp with a request to change it". The password goes only into
 * this queued message (and the one-time result shown to reception), never into logs.
 */
export function welcomeText(w: { memberName: string; gymName: string; gymShort: string; code: string; password: string }): string {
  const first = w.memberName.trim().split(/\s+/)[0] ?? w.memberName;
  return (
    `Assalam o Alaikum ${first}, welcome to ${w.gymName}! Your member ID is ${w.code}. ` +
    `Log in to the ${w.gymShort} app with your mobile number and temporary password ${w.password}. ` +
    'Please change your password from Profile after logging in.'
  );
}

/**
 * Fee reminder (§6 "Add fee reminders", §7 WhatsApp log). Wording approved by the gym owner:
 * "Assalam o Alaikum [Name], your [Gym Name] fee of PKR [fee] is due on [25 Nov]. Please pay to
 *  keep your membership active. Thank you!" — "was due on" for overdue members.
 * Greets by first name, as the §7 receipt does.
 */
export function reminderText(memberName: string, gymName: string, feePkr: number, dueOn: string, overdue: boolean): string {
  const first = memberName.trim().split(/\s+/)[0] ?? memberName;
  return (
    `Assalam o Alaikum ${first}, your ${gymName} fee of ${formatPKR(feePkr)} ${overdue ? 'was' : 'is'} due on ${formatShortDate(dueOn)}. ` +
    'Please pay to keep your membership active. Thank you!'
  );
}

/** §5.1: "Renewed to 25 Dec. Receipt queued for WhatsApp" */
export const renewedMessage = (dueOn: string) => `Renewed to ${formatShortDate(dueOn)}. Receipt queued for WhatsApp`;

/** §7 WhatsApp log: every message the system wants sent is saved with status To send (queued). */
export async function queueWhatsapp(
  db: Executor,
  m: { gymId: string; memberId: string | null; toPhone: string; kind: WhatsAppKind; body: string },
): Promise<void> {
  await db.insert(whatsappMessages).values({ ...m, status: 'queued' });
}
