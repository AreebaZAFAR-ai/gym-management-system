import { randomBytes } from 'node:crypto';
import { compare, hash, hashSync } from 'bcryptjs';

/** §11: bcrypt with cost 10 or more. */
export const BCRYPT_COST = 10;

export const hashPassword = (password: string) => hash(password, BCRYPT_COST);
export const checkPassword = (password: string, passwordHash: string) => compare(password, passwordHash);

/**
 * A valid hash of a random value, compared against when the phone is unknown,
 * so a wrong phone and a wrong password take the same time (§11: one error).
 */
export const DUMMY_HASH = hashSync(randomBytes(16).toString('hex'), BCRYPT_COST);
