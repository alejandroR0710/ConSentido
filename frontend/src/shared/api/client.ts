// VITE_API_URL="auto" (o vacío) calcula la URL del backend a partir del host con el
// que se cargó la página (window.location.hostname), en vez de una IP fija: así el
// mismo build funciona sin tocar nada sin importar la red Wi-Fi a la que te conectes
// (la de casa, la del cliente, un hotspot...). Para producción (frontend y backend en
// dominios distintos) se sigue usando una URL explícita en VITE_API_URL.
const VITE_API_URL = import.meta.env.VITE_API_URL;
const API_URL =
  !VITE_API_URL || VITE_API_URL === "auto" ? `${window.location.protocol}//${window.location.hostname}:4000/api/v1` : VITE_API_URL;
// El backend sirve /uploads fuera de /api/v1, así que las URLs de imágenes que
// devuelve la API (ej. "/uploads/productos/x.jpg") necesitan el origen sin ese sufijo.
const API_ORIGIN = API_URL.replace(/\/api\/v1\/?$/, "");

export function resolveImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `${API_ORIGIN}${path}`;
}

export interface ApiEnvelope<T> {
  data: T | null;
  error: { code: string; message: string } | null;
  meta: unknown;
}

export class ApiError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

let currentAccessToken: string | null = null;
let onTokenRefreshed: ((token: string | null) => void) | null = null;

/** El AuthProvider registra aquí cómo debe actualizarse el token cuando el cliente lo renueva solo. */
export function bindTokenHandlers(getToken: () => string | null, setToken: (t: string | null) => void) {
  currentAccessToken = getToken();
  onTokenRefreshed = setToken;
}

export function setAccessToken(token: string | null) {
  currentAccessToken = token;
}

async function refreshAccessToken(): Promise<string | null> {
  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) return null;
  const body: ApiEnvelope<{ accessToken: string }> = await res.json();
  const token = body.data?.accessToken ?? null;
  onTokenRefreshed?.(token);
  return token;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}, isRetry = false): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(currentAccessToken ? { Authorization: `Bearer ${currentAccessToken}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401 && !isRetry) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      return apiFetch<T>(path, options, true);
    }
  }

  const body: ApiEnvelope<T> = await res.json();
  if (!res.ok || body.error) {
    throw new ApiError(body.error?.code ?? "UNKNOWN", body.error?.message ?? "Error inesperado");
  }
  return body.data as T;
}

/** Sube un archivo como multipart/form-data. No se usa apiFetch porque este
 *  nunca debe fijar Content-Type: application/json (el navegador arma el
 *  boundary del multipart solo). Reintenta una vez con refresh, igual que apiFetch. */
export async function apiUpload<T>(path: string, file: File, campo = "imagen", isRetry = false): Promise<T> {
  const formData = new FormData();
  formData.append(campo, file);

  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    credentials: "include",
    headers: currentAccessToken ? { Authorization: `Bearer ${currentAccessToken}` } : undefined,
    body: formData,
  });

  if (res.status === 401 && !isRetry) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      return apiUpload<T>(path, file, campo, true);
    }
  }

  const body: ApiEnvelope<T> = await res.json();
  if (!res.ok || body.error) {
    throw new ApiError(body.error?.code ?? "UNKNOWN", body.error?.message ?? "Error inesperado");
  }
  return body.data as T;
}
