// The API client throws "<status> <text>: <body>". Pull the FastAPI `detail`
// out of that so pages can show a readable message.
export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const body = raw.replace(/^\d+ [^:]*: /, "");
  try {
    const detail = (JSON.parse(body) as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
  } catch {
    /* not JSON */
  }
  return raw;
}
