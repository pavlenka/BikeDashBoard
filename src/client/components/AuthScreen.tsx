import { useState } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";

import { api, ApiError } from "../lib/api";

export function AuthScreen({ setupRequired, onAuthenticated }: { setupRequired: boolean; onAuthenticated: (codes?: string[]) => void }) {
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [showRecovery, setShowRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function register() {
    setBusy(true);
    setError("");
    try {
      const optionsJSON = await api<PublicKeyCredentialCreationOptionsJSON>(
        "/api/auth/register/options",
        { method: "POST", body: JSON.stringify({ bootstrapToken }) },
      );
      const response = await startRegistration({ optionsJSON });
      const result = await api<{ verified: true; recoveryCodes?: string[] }>(
        "/api/auth/register/verify",
        { method: "POST", body: JSON.stringify({ response }) },
      );
      onAuthenticated(result.recoveryCodes);
    } catch (caught) {
      setError(caught instanceof ApiError && caught.code === "invalid_bootstrap_token" ? "El token de activación no es válido." : "No se pudo registrar la passkey. Vuelve a intentarlo.");
    } finally {
      setBusy(false);
    }
  }

  async function login() {
    setBusy(true);
    setError("");
    try {
      const optionsJSON = await api<PublicKeyCredentialRequestOptionsJSON>(
        "/api/auth/login/options",
        { method: "POST", body: "{}" },
      );
      const response = await startAuthentication({ optionsJSON });
      await api("/api/auth/login/verify", { method: "POST", body: JSON.stringify({ response }) });
      onAuthenticated();
    } catch {
      setError("No se pudo verificar la passkey.");
    } finally {
      setBusy(false);
    }
  }

  async function recover() {
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/recover", { method: "POST", body: JSON.stringify({ code: recoveryCode }) });
      onAuthenticated();
    } catch {
      setError("El código de recuperación no es válido o ya fue utilizado.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
        <p className="eyebrow">Bike Dashboard · privado</p>
        <h1>{setupRequired ? "Activa tu cuaderno de ruta" : "Vuelve a la carretera"}</h1>
        <p className="auth-copy">
          {setupRequired
            ? "Registra una passkey con Touch ID. Este será el único acceso al dashboard."
            : "Usa Touch ID o la passkey guardada en tus dispositivos."}
        </p>
        {setupRequired ? (
          <label className="field">
            <span>Token de activación</span>
            <input type="password" value={bootstrapToken} onChange={(event) => setBootstrapToken(event.target.value)} autoComplete="one-time-code" />
          </label>
        ) : showRecovery ? (
          <label className="field">
            <span>Código de recuperación</span>
            <input value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} placeholder="XXXXXX-XXXXXX" autoComplete="one-time-code" />
          </label>
        ) : null}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button--primary" disabled={busy || (setupRequired && !bootstrapToken)} onClick={setupRequired ? register : showRecovery ? recover : login}>
          {busy ? "Verificando…" : setupRequired ? "Registrar passkey" : showRecovery ? "Usar código" : "Entrar con passkey"}
        </button>
        {!setupRequired && (
          <button className="text-button" onClick={() => setShowRecovery((value) => !value)}>
            {showRecovery ? "Usar passkey" : "Usar código de recuperación"}
          </button>
        )}
      </section>
      <aside className="auth-route" aria-label="Ilustración de ruta ciclista">
        <svg viewBox="0 0 640 800" role="img" aria-label="Trazado abstracto de una ruta">
          <path d="M64 728C152 624 88 540 196 474C298 412 248 312 358 270C468 228 420 124 578 70" />
          <circle cx="64" cy="728" r="9" /><circle cx="578" cy="70" r="9" />
        </svg>
        <p><span>100%</span> local antes de sincronizar</p>
      </aside>
    </main>
  );
}
