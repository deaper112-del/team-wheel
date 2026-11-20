import type { GradeReport, ResponseValue } from "./types";

const LEGACY_DB = "online-exam";
const PROGRESS_KEY = "exam-progress-v2";

export interface ProgressRecord {
  version: 2;
  updatedAt: string;
  phase: "exam" | "result";
  name: string;
  attemptToken: string;
  responses: Record<string, ResponseValue>;
  startedAt: number | null;
  report: GradeReport | null;
  autoSubmitted: boolean;
}

export function wipeLegacyStore(): void {
  if (typeof indexedDB === "undefined") return;
  indexedDB.deleteDatabase(LEGACY_DB);
}

export function loadProgress(): ProgressRecord | null {
  try {
    const raw = sessionStorage.getItem(PROGRESS_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as ProgressRecord;
    if (value.version !== 2 || (value.phase !== "exam" && value.phase !== "result")) return null;
    if (typeof value.attemptToken !== "string" || value.attemptToken === "") return null;
    return value;
  } catch {
    return null;
  }
}

export function saveProgress(record: ProgressRecord): void {
  sessionStorage.setItem(PROGRESS_KEY, JSON.stringify(record));
}

export function clearProgress(): void {
  sessionStorage.removeItem(PROGRESS_KEY);
}
