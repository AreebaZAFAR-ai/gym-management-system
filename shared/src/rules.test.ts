import { describe, expect, it } from 'vitest';
import {
  addMonths,
  applyFreeze,
  barbellTotal,
  buildCheckinQr,
  deriveMemberKey,
  entryDecision,
  estimatedOneRepMax,
  formatPhone,
  formatPKR,
  formatShortDate,
  fromBase64Url,
  heaviestSet,
  kgFromPct,
  machineTotal,
  memberCode,
  membershipStatus,
  normalizePhone,
  paymentPeriod,
  firstPaymentPeriod,
  pkToday,
  platesFor,
  sessionVolume,
  toBase64Url,
  verifyCheckinQr,
  warmupSets,
} from './index';

describe('phone validation', () => {
  it.each(['0300-1234567', '+92 300 1234567', '3001234567', '923001234567', '0092 300 1234567', '0300 1234567'])(
    'accepts %s',
    (input) => expect(normalizePhone(input)).toBe('3001234567'),
  );
  it.each(['', '12345', '0200-1234567', '300123456', '30012345678', '4001234567'])('rejects %s', (input) =>
    expect(normalizePhone(input)).toBeNull(),
  );
  it('formats for display', () => expect(formatPhone('3001234567')).toBe('0300 1234567'));
});

describe('plate maths', () => {
  it('empty bar is 20 kg', () => expect(barbellTotal([])).toBe(20));
  it('adds plates on both sides', () => expect(barbellTotal([20, 10])).toBe(80));
  it('finds plates for a total', () => {
    expect(platesFor(100)).toEqual([25, 15]);
    expect(barbellTotal(platesFor(140))).toBe(140);
    expect(platesFor(20)).toEqual([]);
  });
  it('machine stack sums blocks', () => expect(machineTotal([10, 5, 5])).toBe(20));
});

describe('strength maths', () => {
  it('Epley 1-rep max', () => {
    expect(estimatedOneRepMax(100, 5)).toBeCloseTo(116.7, 1);
    expect(estimatedOneRepMax(100, 1)).toBe(100);
    expect(estimatedOneRepMax(0, 5)).toBe(0);
  });
  it('warm-ups are 50% x 8 and 70% x 5, rounded to 2.5', () => {
    expect(warmupSets(100)).toEqual([
      { kg: 50, reps: 8 },
      { kg: 70, reps: 5 },
    ]);
    expect(warmupSets(85)).toEqual([
      { kg: 42.5, reps: 8 },
      { kg: 60, reps: 5 },
    ]);
  });
  it('% of best rounds to 2.5 kg', () => expect(kgFromPct(116.7, 75)).toBe(87.5));
  it('ignores warm-ups for bests and volume', () => {
    const sets = [
      { kg: 140, reps: 1, warmup: true },
      { kg: 100, reps: 5, warmup: false },
      { kg: 100, reps: 6, warmup: false },
    ];
    expect(heaviestSet(sets)).toMatchObject({ kg: 100, reps: 6 });
    expect(sessionVolume(sets)).toBe(1100);
  });
});

describe('dates', () => {
  it('31 Jan + 1 month = end of Feb', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-25', 1)).toBe('2026-12-25');
  });
  it('uses Pakistan time', () => {
    // 20:00 UTC on 24 Nov is 01:00 on 25 Nov in Karachi
    expect(pkToday(Date.UTC(2026, 10, 24, 20, 0))).toBe('2026-11-25');
  });
  it('short format', () => expect(formatShortDate('2026-11-25')).toBe('25 Nov'));
  it('money format', () => expect(formatPKR(4000)).toBe('PKR 4,000'));
});

describe('membership status', () => {
  const today = '2026-11-24';
  it('frozen wins', () => expect(membershipStatus('2026-10-01', '2026-11-24', today)).toBe('frozen'));
  it('overdue when due date passed', () => expect(membershipStatus('2026-11-23', null, today)).toBe('overdue'));
  it('due soon within 5 days', () => expect(membershipStatus('2026-11-29', null, today)).toBe('due_soon'));
  it('active otherwise', () => expect(membershipStatus('2026-11-30', null, today)).toBe('active'));
});

describe('entry at the door', () => {
  it('allows within grace days', () =>
    expect(entryDecision({ dueOn: '2026-11-21', frozenUntil: null }, '2026-11-24', 3).allowed).toBe(true));
  it('blocks 4+ days overdue with grace 3', () => {
    const d = entryDecision({ dueOn: '2026-11-07', frozenUntil: null }, '2026-11-24', 3);
    expect(d).toMatchObject({ allowed: false, reason: 'overdue', message: 'Fee overdue since 7 Nov' });
  });
  it('blocks while frozen', () =>
    expect(entryDecision({ dueOn: '2026-12-30', frozenUntil: '2026-12-02' }, '2026-11-24')).toMatchObject({
      allowed: false,
      message: 'Membership frozen until 2 Dec',
    }));
});

describe('payments and freeze', () => {
  it('early payment extends from due date', () =>
    expect(paymentPeriod('2026-11-30', 1, '2026-11-24')).toEqual({ periodFrom: '2026-11-30', periodTo: '2026-12-30' }));
  it('late payment starts today', () =>
    expect(paymentPeriod('2026-11-07', 1, '2026-11-25')).toEqual({ periodFrom: '2026-11-25', periodTo: '2026-12-25' }));
  it('first payment starts on the payment date and runs for the plan months', () => {
    expect(firstPaymentPeriod(1, '2026-11-25')).toEqual({ periodFrom: '2026-11-25', periodTo: '2026-12-25' });
    expect(firstPaymentPeriod(3, '2026-11-25')).toEqual({ periodFrom: '2026-11-25', periodTo: '2027-02-25' });
  });
  it('first payment uses month-end clamping', () => {
    expect(firstPaymentPeriod(1, '2026-01-31')).toEqual({ periodFrom: '2026-01-31', periodTo: '2026-02-28' });
    expect(firstPaymentPeriod(1, '2028-01-31')).toEqual({ periodFrom: '2028-01-31', periodTo: '2028-02-29' });
  });
  it('7-day freeze moves due date 7 days', () =>
    expect(applyFreeze('2026-12-10', 7, '2026-11-24')).toEqual({ dueOn: '2026-12-17', frozenUntil: '2026-11-30' }));
  it('member codes', () => expect(memberCode('IH', 419)).toBe('IH-0419'));
});

describe('check-in QR signing', () => {
  const secret = 'test-gym-secret';
  const key = deriveMemberKey(secret, 'IH-0412');
  const t = Date.UTC(2026, 10, 24, 12, 0, 0);

  it('base64url round-trips', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253]);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
  });
  it('has the spec format', () =>
    expect(buildCheckinQr('ironhouse', 'IH-0412', key, t)).toMatch(/^GYM1\.ironhouse\.IH-0412\.\d+\.[A-Za-z0-9_-]{16}$/));
  it('accepts the current, previous and next window', () => {
    const qr = buildCheckinQr('ironhouse', 'IH-0412', key, t);
    expect(verifyCheckinQr(qr, 'ironhouse', secret, t).ok).toBe(true);
    expect(verifyCheckinQr(qr, 'ironhouse', secret, t + 30_000).ok).toBe(true);
    expect(verifyCheckinQr(qr, 'ironhouse', secret, t - 30_000).ok).toBe(true);
  });
  it('refuses a screenshot after 90 seconds', () => {
    const qr = buildCheckinQr('ironhouse', 'IH-0412', key, t);
    expect(verifyCheckinQr(qr, 'ironhouse', secret, t + 90_000)).toMatchObject({ ok: false, reason: 'expired' });
  });
  it('refuses a forged code', () => {
    const qr = buildCheckinQr('ironhouse', 'IH-0412', key, t).replace('IH-0412', 'IH-0413');
    expect(verifyCheckinQr(qr, 'ironhouse', secret, t)).toMatchObject({ ok: false, reason: 'forged' });
    const wrongKey = deriveMemberKey('other-secret', 'IH-0412');
    expect(verifyCheckinQr(buildCheckinQr('ironhouse', 'IH-0412', wrongKey, t), 'ironhouse', secret, t).ok).toBe(false);
  });
  it('refuses other gyms', () => {
    const qr = buildCheckinQr('fitzone', 'IH-0412', key, t);
    expect(verifyCheckinQr(qr, 'ironhouse', secret, t)).toMatchObject({ ok: false, reason: 'other_gym' });
  });
});
