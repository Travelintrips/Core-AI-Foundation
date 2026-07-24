import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch, wsBase } from '@/lib/api';

const TOKEN_KEY = 'workspace_token';
const CLIENT_NAME_KEY = 'client_name';

type AuthContextValue = {
  token: string | null;
  clientName: string | null;
  isLoading: boolean;
  login: (token: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  token: null,
  clientName: null,
  isLoading: true,
  login: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [clientName, setClientName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [storedToken, storedName] = await Promise.all([
          AsyncStorage.getItem(TOKEN_KEY),
          AsyncStorage.getItem(CLIENT_NAME_KEY),
        ]);
        if (storedToken) {
          setToken(storedToken);
          setClientName(storedName);
        }
      } catch {
        // ignore
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (inputToken: string) => {
    const trimmed = inputToken.trim();
    // Validate by fetching workspace summary
    const summary = await apiFetch<{ clientName: string; activeProjects: number }>(
      `${wsBase(trimmed)}/summary`,
    );
    const name = summary.clientName ?? null;
    await Promise.all([
      AsyncStorage.setItem(TOKEN_KEY, trimmed),
      name ? AsyncStorage.setItem(CLIENT_NAME_KEY, name) : AsyncStorage.removeItem(CLIENT_NAME_KEY),
    ]);
    setToken(trimmed);
    setClientName(name);
  }, []);

  const logout = useCallback(async () => {
    await Promise.all([
      AsyncStorage.removeItem(TOKEN_KEY),
      AsyncStorage.removeItem(CLIENT_NAME_KEY),
    ]);
    setToken(null);
    setClientName(null);
  }, []);

  return (
    <AuthContext.Provider value={{ token, clientName, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
