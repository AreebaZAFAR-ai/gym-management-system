import { createHmac } from 'node:crypto';
import { buildCheckinQr, deriveMemberKey, verifyCheckinQr } from '@gym/shared';
import { describe, expect, it } from 'vitest';

/**
 * §7 Check-in QR, checked against the PDF text with an independent
 * implementation (Node crypto), not the shared code:
 *   member key = HMAC-SHA256(gym secret, "member:" + member ID)
 *   window     = Unix seconds ÷ 30, rounded down
 *   signature  = first 16 characters of base64url(HMAC-SHA256(member key, "<member ID>.<window>"))
 *   QR         = GYM1.<gym id>.<member ID>.<window>.<signature>
 *   accepted   = previous, current or next window (about 90 seconds)
 */
const SECRET = 'gym-secret';
const GYM = 'ironhouse';
const CODE = 'IH-0412';

function pdfQr(nowMs: number): string {
  const memberKey = createHmac('sha256', SECRET).update(`member:${CODE}`).digest();
  const window = Math.floor(nowMs / 1000 / 30);
  const signature = createHmac('sha256', memberKey).update(`${CODE}.${window}`).digest('base64url').slice(0, 16);
  return `GYM1.${GYM}.${CODE}.${window}.${signature}`;
}

describe('§7 check-in QR timing', () => {
  const windowStart = Date.UTC(2026, 10, 25, 12, 0, 0); // divisible by 30 s
  const key = deriveMemberKey(SECRET, CODE);

  it('the app builds exactly the QR the PDF formula produces', () => {
    for (const t of [windowStart, windowStart + 1_000, windowStart + 29_999, windowStart + 30_000]) {
      expect(buildCheckinQr(GYM, CODE, key, t)).toBe(pdfQr(t));
    }
  });

  it('the code changes every 30 seconds', () => {
    expect(pdfQr(windowStart + 29_999)).toBe(pdfQr(windowStart));
    expect(pdfQr(windowStart + 30_000)).not.toBe(pdfQr(windowStart));
  });

  it('the server accepts only the previous, current and next window', () => {
    const qr = pdfQr(windowStart); // window w
    const at = (offsetWindows: number, intoWindowMs = 0) =>
      verifyCheckinQr(qr, GYM, SECRET, windowStart + offsetWindows * 30_000 + intoWindowMs);

    expect(at(-2, 29_999)).toMatchObject({ ok: false, reason: 'expired' }); // w-2
    expect(at(-1).ok).toBe(true); // w-1
    expect(at(0).ok).toBe(true); // w
    expect(at(0, 29_999).ok).toBe(true);
    expect(at(1).ok).toBe(true); // w+1
    expect(at(1, 29_999).ok).toBe(true); // last moment of w+1
    expect(at(2)).toMatchObject({ ok: false, reason: 'expired' }); // w+2
  });

  it('three accepted windows span 90 seconds', () => {
    const qr = pdfQr(windowStart);
    let accepted = 0;
    for (let s = -120; s < 120; s++) if (verifyCheckinQr(qr, GYM, SECRET, windowStart + s * 1000).ok) accepted++;
    expect(accepted).toBe(90);
  });

  it('a screenshot of a QR stops working within 90 seconds', () => {
    for (const shownAt of [windowStart, windowStart + 15_000, windowStart + 29_999]) {
      const qr = pdfQr(shownAt);
      expect(verifyCheckinQr(qr, GYM, SECRET, shownAt + 90_000)).toMatchObject({ ok: false, reason: 'expired' });
    }
  });

  it('a forged signature is refused', () => {
    const qr = pdfQr(windowStart);
    const forged = qr.slice(0, -1) + (qr.endsWith('A') ? 'B' : 'A');
    expect(verifyCheckinQr(forged, GYM, SECRET, windowStart)).toMatchObject({ ok: false, reason: 'forged' });
  });
});
