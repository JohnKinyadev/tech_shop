import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { currentUser, login } from "../api/client";
import type { CurrentUser } from "../api/types";

type AuthState = {
  token: string | null;
  refreshToken: string | null;
  user: CurrentUser | null;
  isPreview: boolean;
};

type AuthContextValue = AuthState & {
  signIn: (username: string, password: string) => Promise<void>;
  previewAsCashier: () => void;
  signOut: () => void;
};

const STORAGE_KEY = "crystal-shop-auth";

const previewUser: CurrentUser = {
  id: "preview-user",
  full_name: "Cashier 1",
  username: "cashier1",
  email: "cashier1@example.com",
  branch_id: "preview-branch",
  role_code: "cashier",
  role_name: "Cashier",
  permissions: ["catalog.view", "inventory.view", "sales.process", "tills.own.view"],
  must_change_password: false,
};

const AuthContext = createContext<AuthContextValue | null>(null);

function loadInitialState(): AuthState {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return { token: null, refreshToken: null, user: null, isPreview: false };
    }
    return JSON.parse(stored) as AuthState;
  } catch {
    return { token: null, refreshToken: null, user: null, isPreview: false };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(loadInitialState);

  const persist = useCallback((next: AuthState) => {
    setState(next);
    if (next.token || next.isPreview) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const signIn = useCallback(
    async (username: string, password: string) => {
      const tokens = await login(username, password);
      const user = await currentUser(tokens.access_token);
      persist({
        token: tokens.access_token,
        refreshToken: tokens.refresh_token,
        user,
        isPreview: false,
      });
    },
    [persist],
  );

  const previewAsCashier = useCallback(() => {
    persist({
      token: null,
      refreshToken: null,
      user: previewUser,
      isPreview: true,
    });
  }, [persist]);

  const signOut = useCallback(() => {
    persist({ token: null, refreshToken: null, user: null, isPreview: false });
  }, [persist]);

  useEffect(() => {
    if (!state.token || state.isPreview) return;

    let active = true;
    currentUser(state.token)
      .then((user) => {
        if (!active) return;
        persist({ ...state, user });
      })
      .catch(() => {
        if (!active) return;
        persist({ token: null, refreshToken: null, user: null, isPreview: false });
      });

    return () => {
      active = false;
    };
  }, [persist, state.isPreview, state.token]);

  const value = useMemo(
    () => ({ ...state, signIn, previewAsCashier, signOut }),
    [previewAsCashier, signIn, signOut, state],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
