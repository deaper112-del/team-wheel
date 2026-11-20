const BLANK_SOURCE = "_{3,}|＿{2,}|（\\s*）|\\(\\s*\\)";

export function countBlankMarkers(stem: string): number {
  return stem.match(new RegExp(BLANK_SOURCE, "g"))?.length ?? 0;
}

/** Split a stem into text around blank markers when the count matches. */
export function splitBlankStem(stem: string, blanks: number): string[] | null {
  const parts = stem.split(new RegExp(BLANK_SOURCE, "g"));
  return parts.length === blanks + 1 ? parts : null;
}
