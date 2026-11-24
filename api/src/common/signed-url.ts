import { createHmac, timingSafeEqual } from 'node:crypto';

/** §11: "Screenshots are not public URLs in production (signed links)". Links expire after 15 minutes. */
export const SIGNED_URL_TTL_SECONDS = 15 * 60;

const signature = (secret: string, path: string, exp: number) =>
  createHmac('sha256', secret).update(`${path}.${exp}`).digest('base64url');

/** A link like `/v1/files/proofs/<id>?exp=…&sig=…`, valid for 15 minutes. */
export function signPath(secret: string, path: string, nowMs = Date.now()): string {
  const exp = Math.floor(nowMs / 1000) + SIGNED_URL_TTL_SECONDS;
  return `${path}?exp=${exp}&sig=${signature(secret, path, exp)}`;
}

export function verifySignedPath(secret: string, path: string, exp: unknown, sig: unknown, nowMs = Date.now()): boolean {
  const expNum = Number(exp);
  if (!Number.isInteger(expNum) || typeof sig !== 'string' || expNum < Math.floor(nowMs / 1000)) return false;
  const expected = Buffer.from(signature(secret, path, expNum));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
