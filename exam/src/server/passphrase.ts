import { timingSafeEqual } from "node:crypto";

export function proctorPassphraseConfigured(): boolean {
  return (process.env.PROCTOR_PASSPHRASE ?? "").trim() !== "";
}

export function proctorPassphraseMatches(given: string): boolean {
  const expected = (process.env.PROCTOR_PASSPHRASE ?? "").trim();
  if (!expected || !given) return false;
  const left = Buffer.from(given);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
