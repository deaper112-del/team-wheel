import type { GradeReport } from "./types";

export function toCandidateReport(report: GradeReport, released: boolean): GradeReport {
  if (released) return report;
  return {
    total: report.total,
    gradedMax: report.gradedMax,
    paperMax: report.paperMax,
    items: [],
    missingIds: [],
    invalidIds: [],
  };
}
