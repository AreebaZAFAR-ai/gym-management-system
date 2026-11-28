/**
 * Gym self-registration rules, shared by the API (which enforces them) and the
 * web admin's form (which shows the same messages before sending).
 */

/** bcrypt only uses the first 72 bytes of a password. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

/** Gym codes (gyms.id) are lowercase slugs; this keeps them short enough to type. */
export const GYM_CODE_MAX_LENGTH = 30;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(input: string): boolean {
  const v = input.trim();
  return v.length <= 254 && EMAIL_RE.test(v);
}

/** A contact phone (landline or mobile): digits with optional +, spaces, dashes, brackets; 7 to 15 digits. */
export function isValidContactPhone(input: string): boolean {
  const v = input.trim();
  if (!/^\+?[0-9\s()-]+$/.test(v)) return false;
  const digits = v.replace(/\D/g, '').length;
  return digits >= 7 && digits <= 15;
}

/** The first problem with a new password, or null when it is acceptable. */
export function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_LENGTH) return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'Password must contain at least one letter and one number.';
  if (password !== confirm) return 'Passwords do not match.';
  return null;
}

/**
 * Gym code from the gym name, following the existing gym ID convention (a
 * lowercase slug such as "ironhouse"): "Iron House Fitness" -> "iron-house-fitness".
 * Falls back to "gym" when the name has no Latin letters or digits.
 */
export function gymCodeFromName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, GYM_CODE_MAX_LENGTH)
    .replace(/-+$/g, '');
  return slug || 'gym';
}

/**
 * Member ID prefix (and short letters) from the gym name: initials of up to
 * three words, or the first two letters of a one-word name.
 * "Iron House Fitness" -> "IHF", "Powerhouse" -> "PO".
 */
export function prefixFromName(name: string): string {
  const words = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) return 'GYM';
  if (words.length === 1) return words[0]!.slice(0, 2).padEnd(2, 'X');
  return words.slice(0, 3).map((w) => w[0]).join('');
}
