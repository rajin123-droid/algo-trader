import { create } from "zustand";
import { getUser, subscribeAuth, type AuthUser } from "@/core/auth";

interface AuthState {
  user: AuthUser | null;
  setUser: (user: AuthUser | null) => void;
}

export const useAuthStore = create<AuthState>((set) => {
  subscribeAuth((user) => set({ user }));

  return {
    user: getUser(),
    setUser: (user) => set({ user }),
  };
});
