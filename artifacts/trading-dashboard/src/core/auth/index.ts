export interface AuthUser {
  id: number;
  email: string;
  plan: string;
}

type AuthListener = (user: AuthUser | null) => void;

const USER_KEY          = "algo_user";
const TOKEN_KEY         = "algo_token";
const REFRESH_TOKEN_KEY = "algo_refresh_token";

let current: AuthUser | null = (() => {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
})();

const listeners = new Set<AuthListener>();

function notify() {
  listeners.forEach((fn) => fn(current));
}

export function getUser(): AuthUser | null {
  return current;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

/**
 * Persist user + both tokens.
 * refreshToken is optional for backward-compat call sites that only have the
 * access token at hand (e.g. silent-refresh retry path).
 */
export function setUser(user: AuthUser, accessToken: string, refreshToken?: string): void {
  current = user;
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  localStorage.setItem(TOKEN_KEY, accessToken);
  if (refreshToken) {
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  }
  notify();
}

/** Update only the access token (called after a silent token refresh). */
export function setAccessToken(accessToken: string): void {
  localStorage.setItem(TOKEN_KEY, accessToken);
}

export function clearUser(): void {
  current = null;
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  notify();
}

export function subscribeAuth(fn: AuthListener): () => void {
  listeners.add(fn);
  fn(current);
  return () => listeners.delete(fn);
}
