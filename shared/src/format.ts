import type { PaymentMethod } from './types';

/** 4000 -> "PKR 4,000" */
export function formatPKR(amount: number): string {
  return `PKR ${Math.round(amount).toLocaleString('en-US')}`;
}

/** 102.5 -> "102.5", 100 -> "100" */
export function formatKg(kg: number): string {
  return Number.isInteger(kg) ? String(kg) : kg.toFixed(1).replace(/\.0$/, '');
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  jazzcash: 'JazzCash',
  easypaisa: 'Easypaisa',
  bank: 'Bank transfer',
};

export function whatsappLink(phoneIntl: string, text: string): string {
  return `https://wa.me/${phoneIntl}?text=${encodeURIComponent(text)}`;
}
