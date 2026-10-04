/** Thin fetch wrapper: JSON in/out, Italian error messages carrying the server's reason. */
export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly detail?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Identifies this window to the server, so live-collaboration events of its own saves can be ignored. */
export const CLIENT_ID: string = (() => {
  try { return crypto.randomUUID().slice(0, 18); } catch { return `c-${Math.random().toString(36).slice(2, 14)}`; }
})();

async function request<T>(method: string, url: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined && !(body instanceof FormData) && !(body instanceof Blob) ? { 'Content-Type': 'application/json', 'X-Drip-Client': CLIENT_ID } : { 'X-Drip-Client': CLIENT_ID },
      body: body === undefined ? undefined : body instanceof FormData || body instanceof Blob ? body : JSON.stringify(body),
      ...init,
    });
  } catch {
    throw new ApiError(0, 'Server DRIP Urban non raggiungibile. Verifica che il programma sia avviato.');
  }
  if (!res.ok) {
    let detail: unknown = null;
    let message = `Errore ${res.status}`;
    try {
      const j = await res.json();
      detail = j?.detail ?? j;
      const d = j?.detail;
      message = typeof d === 'string' ? d : d?.message ?? j?.error ?? message;
    } catch { /* non-JSON error body */ }
    const code = (detail as { code?: string } | null)?.code;
    if (res.status === 401 && code === 'auth_required') window.dispatchEvent(new CustomEvent('drip:auth', { detail: 'required' }));
    if (res.status === 403 && code === 'must_change_password') window.dispatchEvent(new CustomEvent('drip:auth', { detail: 'password' }));
    throw new ApiError(res.status, message, detail);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  return (ct.includes('json') ? res.json() : res.blob()) as Promise<T>;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
};
