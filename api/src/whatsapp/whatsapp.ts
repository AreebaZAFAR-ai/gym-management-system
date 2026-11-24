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

/**
 * §7 WhatsApp log: fee reminder. The PDF gives no wording; this placeholder
 * names the amount, the due date and where to pay.
 */
export function reminderText(memberName: string, gymName: string, feePkr: number, dueOn: string, today: string): string {
  const first = memberName.trim().split(/\s+/)[0] ?? memberName;
  const when = dueOn < today ? `was due on ${formatShortDate(dueOn)}` : `is due on ${formatShortDate(dueOn)}`;
  return `Assalam o Alaikum ${first}, your ${gymName} membership fee of ${formatPKR(feePkr)} ${when}. Please pay at reception or send it from the app. Thank you!`;
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
 * §7 Registration: the default password is "sent in the welcome WhatsApp with a
 * request to change it". The PDF gives no exact wording; this text is a placeholder
 * that carries exactly those items.
 */
export function welcomeText(memberName: string, gymName: string, memberCode: string, password: string): string {
  const first = memberName.trim().split(/\s+/)[0] ?? memberName;
  return (
    `Assalam o Alaikum ${first}, welcome to ${gymName}! Your member ID is ${memberCode}. ` +
    `Log in to the app with your mobile number and password ${password}, then please change your password.`
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
