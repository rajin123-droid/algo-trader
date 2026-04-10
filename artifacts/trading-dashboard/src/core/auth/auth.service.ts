import { api } from "@/core/api/client";
import {
  setUser,
  setAccessToken,
  clearUser,
  getToken,
  getRefreshToken,
  type AuthUser,
} from "@/core/auth";

interface LoginResponse {
  msg: string;
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  token: string;
}

interface RefreshResponse {
  accessToken:  string;
  refreshToken: string;
  expiresIn:    number;
}

interface MeResponse {
  user: AuthUser;
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const res = await api.post<LoginResponse>("/auth/login", { email, password });
  const { user, accessToken, refreshToken } = res.data;
  setUser(user, accessToken, refreshToken);
  return res.data;
}

export async function register(email: string, password: string): Promise<LoginResponse> {
  const res = await api.post<LoginResponse>("/auth/register", { email, password });
  const { user, accessToken, refreshToken } = res.data;
  setUser(user, accessToken, refreshToken);
  return res.data;
}

export async function getMe(): Promise<AuthUser> {
  const res = await api.get<MeResponse>("/auth/me");
  return res.data.user;
}

/**
 * Silently exchange the stored refresh token for a new token pair.
 * Stores the new access token (and new refresh token) automatically.
 *
 * Returns the new access token string on success.
 * Throws if the refresh token is missing, expired, or has been revoked.
 */
export async function refreshTokens(): Promise<string> {
  const storedRefreshToken = getRefreshToken();
  if (!storedRefreshToken) {
    throw new Error("No refresh token available");
  }

  const res = await api.post<RefreshResponse>(
    "/auth/refresh",
    { refreshToken: storedRefreshToken },
    { _skipRefresh: true } as never   // tell interceptor not to retry this call
  );

  const { accessToken, refreshToken: newRefreshToken } = res.data;

  setAccessToken(accessToken);
  if (newRefreshToken) {
    localStorage.setItem("algo_refresh_token", newRefreshToken);
  }

  return accessToken;
}

export async function logout(): Promise<void> {
  try {
    const accessToken    = getToken();
    const storedRefresh  = getRefreshToken();

    await api.post(
      "/auth/logout",
      storedRefresh ? { refreshToken: storedRefresh } : {},
      {
        headers:        accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        _skipRefresh:   true,
      } as never
    );
  } catch {
    // Swallow — we still clear local state even if the server call fails
  } finally {
    clearUser();
  }
}
