function prep(value: string): string {
  return value.normalize("NFKC").replace(/\u3000/g, " ");
}

/** Trim and ignore case. Spaces inside the answer stay, matching the blank rule. */
export function normalizeBlankToken(value: string): string {
  return prep(value).trim().toLowerCase();
}

/** Short-answer comparison: width, case, and whitespace. */
export function normalizeExact(value: string): string {
  return prep(value).replace(/\s+/g, "").toLowerCase();
}

export function splitList(value: string): string[] {
  return value
    .split(/[,，、;；]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}
