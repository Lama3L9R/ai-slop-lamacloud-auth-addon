export class ApiError extends Error {
  readonly status: number;
  /** the server says the login flow is gone; go back to the first step */
  readonly restart: boolean;

  constructor(status: number, message: string, restart = false) {
    super(message);
    this.status = status;
    this.restart = restart;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const body = res.headers.get('content-type')?.includes('application/json')
    ? await res.json()
    : await res.text();
  if (!res.ok) {
    const error = typeof body === 'object' && body ? (body as Record<string, unknown>) : {};
    throw new ApiError(
      res.status,
      typeof error.error === 'string' ? error.error : `request failed (${res.status})`,
      error.restart === true,
    );
  }
  return body as T;
}

export const post = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const errorText = (err: unknown) =>
  err instanceof ApiError ? err.message : 'cannot reach the server';

/** Result of a login step: either another step follows, or the browser leaves for the app. */
export type StepResult = { next: 'otp' } | { redirect: string };
