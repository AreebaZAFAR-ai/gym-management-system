/**
 * Pakistani mobile numbers. Stored as 10 digits starting with 3 ("3001234567").
 * Accepts 0300-1234567, +92 300 1234567, 92 300…, 3001234567.
 */
export function normalizePhone(input: string): string | null {
  let digits = input.replace(/\D/g, '');
  if (digits.startsWith('0092')) digits = digits.slice(4);
  else if (digits.startsWith('92') && digits.length === 12) digits = digits.slice(2);
  else if (digits.startsWith('0') && digits.length === 11) digits = digits.slice(1);
  return /^3\d{9}$/.test(digits) ? digits : null;
}

export function isValidPhone(input: string): boolean {
  return normalizePhone(input) !== null;
}

/** "3001234567" -> "0300 1234567" */
export function formatPhone(phone: string): string {
  const n = normalizePhone(phone) ?? phone;
  return n.length === 10 ? `0${n.slice(0, 3)} ${n.slice(3)}` : phone;
}

/** International digits for wa.me links: "923001234567". */
export function whatsappNumber(phone: string): string {
  const n = normalizePhone(phone);
  return n ? `92${n}` : phone.replace(/\D/g, '');
}

/** Default member password: last 6 digits of the mobile number. */
export function defaultPassword(phone: string): string {
  const n = normalizePhone(phone) ?? phone.replace(/\D/g, '');
  return n.slice(-6);
}
