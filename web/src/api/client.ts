// Thin fetch wrapper for the FastAPI backend. Base URL is overridable via
// VITE_API_BASE_URL (see .env.example) so dev/prod can point elsewhere.
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

// Absolute URL for things the browser fetches itself (e.g. the 3D viewer's GLB).
export const apiUrl = (path: string) => `${BASE_URL}${path}`;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T,>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
};

export async function uploadFile<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE_URL}${path}`, { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// Multiple files under the repeated "files" field -- for endpoints that take
// a batch (e.g. phone-scan reconstruction), as opposed to uploadFile's single
// "file" field.
export async function uploadFiles<T>(path: string, files: File[]): Promise<T> {
  const form = new FormData();
  for (const file of files) form.append("files", file);
  const res = await fetch(`${BASE_URL}${path}`, { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
}
