// The FastAPI backend's base URL, overridable via VITE_API_BASE_URL (see .env.example)
// so dev/prod can point elsewhere. The room organizer's fetch helpers are in
// ../legacy/api/client.ts.
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

// Absolute URL for a backend path.
export const apiUrl = (path: string) => `${BASE_URL}${path}`;
