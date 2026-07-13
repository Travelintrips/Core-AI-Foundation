/**
 * passwordService.ts — bcrypt hashing for internal_users passwords.
 *
 * Never store, log, or return plaintext passwords anywhere.
 */
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Minimum bar for any new/changed internal password. */
export function isPasswordStrongEnough(plain: string): boolean {
  return typeof plain === "string" && plain.length >= 10;
}
