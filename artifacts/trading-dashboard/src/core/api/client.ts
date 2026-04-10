/**
 * Axios client with silent token-refresh interceptor.
 *
 * Flow on 401:
 *   1. Skip retry if the failed request is itself a refresh/logout call
 *      (prevents infinite loops and pointless retries on expired sessions).
 *   2. If a refresh is already in-flight, queue this request — all queued
 *      requests resolve together when the single refresh resolves.
 *   3. Call POST /auth/refresh with the stored refresh token.
 *   4. Store the new tokens and retry the original request with the new access token.
 *   5. If refresh fails → clearUser() (force re-login), reject all queued requests.
 */

import axios, {
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from "axios";
import { getToken, getRefreshToken, setAccessToken, clearUser } from "@/core/auth";

/* ── Extend Axios config to carry our private flag ─────────────────────────── */

declare module "axios" {
  interface AxiosRequestConfig {
    /** When true, a 401 on this request will NOT trigger a token refresh attempt. */
    _skipRefresh?: boolean;
  }
}

/* ── Client instance ─────────────────────────────────────────────────────── */

export const api = axios.create({
  baseURL: "/api",
  headers: { "Content-Type": "application/json" },
});

/* ── Request interceptor — attach access token ───────────────────────────── */

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/* ── Response interceptor — silent refresh on 401 ───────────────────────── */

let isRefreshing      = false;
let refreshPromise:   Promise<string> | null = null;

type QueueEntry = { resolve: (token: string) => void; reject: (err: unknown) => void };
const queue: QueueEntry[] = [];

function drainQueue(token: string) {
  queue.splice(0).forEach(({ resolve }) => resolve(token));
}

function rejectQueue(err: unknown) {
  queue.splice(0).forEach(({ reject }) => reject(err));
}

api.interceptors.response.use(
  (response) => response,

  async (error) => {
    const original: AxiosRequestConfig = error.config ?? {};

    // Not a 401, or caller opted out — propagate immediately
    if (error.response?.status !== 401 || original._skipRefresh) {
      return Promise.reject(error);
    }

    const storedRefresh = getRefreshToken();

    // No refresh token stored — nothing we can do
    if (!storedRefresh) {
      clearUser();
      return Promise.reject(error);
    }

    // A refresh call is already in-flight — queue this request until it resolves
    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        queue.push({ resolve, reject });
      }).then((newAccessToken) => {
        const retryConfig = { ...original, _skipRefresh: true };
        if (retryConfig.headers) {
          (retryConfig.headers as Record<string, string>)["Authorization"] = `Bearer ${newAccessToken}`;
        }
        return api(retryConfig);
      });
    }

    isRefreshing   = true;
    refreshPromise = null;

    try {
      // Call refresh endpoint — mark _skipRefresh so a 401 here doesn't recurse
      const res = await api.post<{ accessToken: string; refreshToken: string }>(
        "/auth/refresh",
        { refreshToken: storedRefresh },
        { _skipRefresh: true }
      );

      const { accessToken, refreshToken: newRefreshToken } = res.data;

      setAccessToken(accessToken);
      if (newRefreshToken) {
        localStorage.setItem("algo_refresh_token", newRefreshToken);
      }

      drainQueue(accessToken);

      // Retry the original failed request with the new token
      const retryConfig = { ...original, _skipRefresh: true };
      if (retryConfig.headers) {
        (retryConfig.headers as Record<string, string>)["Authorization"] = `Bearer ${accessToken}`;
      }
      return api(retryConfig);

    } catch (refreshError) {
      rejectQueue(refreshError);
      clearUser();
      return Promise.reject(refreshError);

    } finally {
      isRefreshing   = false;
      refreshPromise = null;
    }
  }
);
