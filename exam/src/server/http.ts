export function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function readFileEntry(value: FormDataEntryValue | null): Promise<File | null> {
  if (!(value instanceof File) || value.size === 0) return null;
  return value;
}
