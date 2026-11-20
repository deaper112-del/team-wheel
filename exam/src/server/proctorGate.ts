import { proctorPassphraseConfigured, proctorPassphraseMatches } from "./passphrase";
import { proctorAttemptsBlocked, recordProctorFailure } from "./proctorLimit";

export async function proctorGate(passphrase: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!proctorPassphraseConfigured()) return { ok: false, status: 503, error: "监考口令还没有配置。" };
  if (await proctorAttemptsBlocked()) return { ok: false, status: 429, error: "口令尝试过于频繁，请稍后再试。" };
  if (!proctorPassphraseMatches(passphrase)) {
    await recordProctorFailure();
    return { ok: false, status: 401, error: "口令不对。" };
  }
  return { ok: true };
}
