import type { GradeReport } from "./types";

export function toCandidateReport(report: GradeReport, released: boolean): GradeReport | null {
  return released ? report : null;
}

export function candidatePayload(name: string, released: boolean, report: GradeReport | null): { name: string; released: boolean; submitted: true } | { name: string; released: true; report: GradeReport } {
  if (released && report) return { name, released: true, report };
  return { name, released: false, submitted: true };
}
