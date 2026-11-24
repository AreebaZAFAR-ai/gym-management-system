import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * Signed rotating check-in QR (spec §7).
 *
 *   member key = HMAC-SHA256(gym secret, "member:" + memberCode)
 *   window     = floor(unixSeconds / 30)
 *   signature  = first 16 chars of base64url(HMAC-SHA256(member key, "<code>.<window>"))
 *   QR         = GYM1.<gymId>.<memberCode>.<window>.<signature>
 *
 * The gym secret stays on the server; the phone only holds its member key.
 */

export const QR_PREFIX = 'GYM1';
export const QR_WINDOW_SECONDS = 30;
const SIG_LENGTH = 16;

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63] + B64URL[(n >> 6) & 63] + B64URL[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63];
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63] + B64URL[(n >> 6) & 63];
  }
  return out;
}

export function fromBase64Url(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '');
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = B64URL.indexOf(ch);
    if (v < 0) throw new Error('Invalid base64url');
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/** Server side: derive a member's key from the gym secret. Returns base64url. */
export function deriveMemberKey(gymSecret: string, memberCode: string): string {
  return toBase64Url(hmac(sha256, utf8ToBytes(gymSecret), utf8ToBytes(`member:${memberCode}`)));
}

export function qrWindow(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / QR_WINDOW_SECONDS);
}

/** Seconds left in the current window (1–30). */
export function secondsLeftInWindow(nowMs: number = Date.now()): number {
  return QR_WINDOW_SECONDS - (Math.floor(nowMs / 1000) % QR_WINDOW_SECONDS);
}

export function signWindow(memberKey: string, memberCode: string, window: number): string {
  const mac = hmac(sha256, fromBase64Url(memberKey), utf8ToBytes(`${memberCode}.${window}`));
  return toBase64Url(mac).slice(0, SIG_LENGTH);
}

/** Phone side: the payload to draw as a QR right now. */
export function buildCheckinQr(
  gymId: string,
  memberCode: string,
  memberKey: string,
  nowMs: number = Date.now(),
): string {
  const w = qrWindow(nowMs);
  return [QR_PREFIX, gymId, memberCode, w, signWindow(memberKey, memberCode, w)].join('.');
}

export type QrVerifyResult =
  | { ok: true; gymId: string; memberCode: string }
  | { ok: false; reason: 'not_qr' | 'other_gym' | 'expired' | 'forged'; message: string };

export function isCheckinQr(code: string): boolean {
  return code.startsWith(`${QR_PREFIX}.`);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Server side. Accepts only the previous, current or next window (~90 s),
 * so a screenshot stops working.
 */
export function verifyCheckinQr(
  code: string,
  expectedGymId: string,
  gymSecret: string,
  nowMs: number = Date.now(),
): QrVerifyResult {
  const parts = code.trim().split('.');
  if (parts.length !== 5 || parts[0] !== QR_PREFIX) {
    return { ok: false, reason: 'not_qr', message: 'This is not a member check-in code.' };
  }
  const [, gymId, memberCode, windowStr, sig] = parts;
  if (gymId !== expectedGymId) {
    return { ok: false, reason: 'other_gym', message: 'This code belongs to another gym.' };
  }
  const window = Number(windowStr);
  if (!Number.isInteger(window)) {
    return { ok: false, reason: 'forged', message: 'This code is not valid. Ask the member to open the app again.' };
  }
  const key = deriveMemberKey(gymSecret, memberCode);
  if (!constantTimeEqual(signWindow(key, memberCode, window), sig)) {
    return { ok: false, reason: 'forged', message: 'This code is not valid. Ask the member to open the app again.' };
  }
  if (Math.abs(qrWindow(nowMs) - window) > 1) {
    return { ok: false, reason: 'expired', message: 'This code has expired. Ask the member to open the app again.' };
  }
  return { ok: true, gymId, memberCode };
}
