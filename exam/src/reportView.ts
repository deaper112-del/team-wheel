import type { GradeReport } from "./types";

export function toCandidateReport(report: GradeReport, released: boolean): GradeReport {
  if (released) return report;
  return {
    ...report,
    items: report.items.map((item) => ({ ...item, reference: "", note: "" })),
  };
}
