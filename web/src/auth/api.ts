// Thin client for the ADR-0018 auth endpoints. Kept free of SolidJS so the
// router/guard and pages can share one contract.

export interface SessionUser {
  id: string;
  username: string;
  name: string;
  email: string;
  isInitial: boolean;
}

export interface Session {
  user: SessionUser;
}

/** ApiError carries the server's Chinese error message. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let message = `请求失败（${res.status}）`;
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) message = body.error;
  } catch {
    // Non-JSON error bodies keep the status-based message.
  }
  return new ApiError(message, res.status);
}

/** fetchSession returns the logged-in session, or null when anonymous. */
export async function fetchSession(): Promise<Session | null> {
  const res = await fetch("/api/auth/session");
  if (!res.ok) throw await parseError(res);
  const body = (await res.json()) as { user?: SessionUser | null };
  return body?.user ? { user: body.user } : null;
}

/** fetchIsInitial mirrors GET /api/auth/is-initial (shape unchanged). */
export async function fetchIsInitial(): Promise<boolean> {
  const res = await fetch("/api/auth/is-initial");
  if (!res.ok) throw await parseError(res);
  const body = (await res.json()) as { isInitial?: boolean };
  return body.isInitial === true;
}

/** login posts credentials and returns the new session. */
export async function login(
  username: string,
  password: string
): Promise<Session> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw await parseError(res);
  const body = (await res.json()) as { user: SessionUser };
  return { user: body.user };
}

/** logout clears the session cookie server-side. */
export async function logout(): Promise<void> {
  const res = await fetch("/api/auth/logout", { method: "POST" });
  if (!res.ok) throw await parseError(res);
}

/**
 * changePassword posts the shape-unchanged old-stack endpoint. The server
 * kills every pre-change session and reissues the caller's cookie.
 */
export async function changePassword(
  oldPassword: string,
  newPassword: string
): Promise<void> {
  const res = await fetch("/api/auth/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ oldPassword, newPassword }),
  });
  if (!res.ok) throw await parseError(res);
}
