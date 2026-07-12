import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { ApiError } from "../../../shared/api/client";
import { useAuth } from "../../../shared/auth/useAuth";

export function LoginPage() {
  const { usuario, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (usuario) return <Navigate to="/" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo iniciar sesión");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-brand-vanilla px-4 dark:bg-brand-green-900">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-xl border border-brand-vanilla-dark bg-white/60 p-6 shadow-sm dark:border-brand-green-700 dark:bg-brand-green-900"
      >
        <h1 className="mb-1 text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">
          Con Sentido / El Rinconcito del Migao
        </h1>
        <p className="mb-6 text-sm text-brand-ink/70 dark:text-brand-vanilla/70">Ingresa con tu cuenta de rol.</p>

        <label className="mb-1 block text-sm font-medium">Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-4 w-full rounded-md border border-brand-vanilla-dark bg-transparent px-3 py-2 outline-none focus:border-brand-green-600 dark:border-brand-green-700"
        />

        <label className="mb-1 block text-sm font-medium">Contraseña</label>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-4 w-full rounded-md border border-brand-vanilla-dark bg-transparent px-3 py-2 outline-none focus:border-brand-green-600 dark:border-brand-green-700"
        />

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-brand-green-700 px-3 py-2 font-medium text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
        >
          {submitting ? "Ingresando..." : "Ingresar"}
        </button>
      </form>
    </div>
  );
}
