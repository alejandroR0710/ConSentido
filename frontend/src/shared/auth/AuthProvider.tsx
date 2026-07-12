import { createContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiFetch, bindTokenHandlers, setAccessToken } from "../api/client";
import type { AuthState, UsuarioSesion } from "./types";

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<UsuarioSesion | null>(null);
  const [accessToken, setAccessTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    bindTokenHandlers(
      () => accessToken,
      (token) => {
        setAccessTokenState(token);
        setAccessToken(token);
      },
    );
  }, [accessToken]);

  useEffect(() => {
    // Intento de sesión silenciosa: si hay una cookie de refresh válida, restaura la sesión sin pedir login.
    apiFetch<{ accessToken: string }>("/auth/refresh", { method: "POST" })
      .then(async ({ accessToken: token }) => {
        setAccessToken(token);
        setAccessTokenState(token);
        const perfil = await apiFetch<UsuarioSesion>("/auth/me");
        setUsuario(perfil);
      })
      .catch(() => {
        /* sin sesión previa: se queda en pantalla de login */
      })
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const result = await apiFetch<{ accessToken: string; usuario: UsuarioSesion }>("/auth/login", {
      method: "POST",
      body: { email, password },
    });
    setAccessToken(result.accessToken);
    setAccessTokenState(result.accessToken);
    setUsuario(result.usuario);
  }

  async function logout() {
    await apiFetch("/auth/logout", { method: "POST" }).catch(() => {});
    setAccessToken(null);
    setAccessTokenState(null);
    setUsuario(null);
  }

  const value = useMemo(
    () => ({ usuario, accessToken, loading, login, logout }),
    [usuario, accessToken, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
