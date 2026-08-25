import { useCallback, useEffect, useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";

import type {
  ActivitySummary,
  AuthStatus,
  DashboardSummary,
  NormalizedCyclingActivityV1,
} from "../shared/contracts";
import { api } from "./lib/api";
import { ActivityDetail } from "./components/ActivityDetail";
import { AnalyticsPage } from "./components/AnalyticsPage";
import { AuthScreen } from "./components/AuthScreen";
import { Dashboard } from "./components/Dashboard";
import { ImportPanel } from "./components/ImportPanel";
import { RoutesView } from "./components/RoutesView";
import { RoadBikeMark } from "./components/RoadBikeMark";
import { SettingsPage } from "./components/SettingsPage";

type View = "dashboard" | "analytics" | "routes" | "import" | "settings";

const emptySummary: DashboardSummary = {
  from: null,
  to: null,
  rides: 0,
  distanceM: 0,
  durationS: 0,
  movingTimeS: 0,
  elevationGainM: 0,
  energyKcal: 0,
  maximumSpeedMps: null,
  granularity: "week",
  series: [],
};

export default function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [summary, setSummary] = useState(emptySummary);
  const [activities, setActivities] = useState<ActivitySummary[]>([]);
  const [selected, setSelected] = useState<NormalizedCyclingActivityV1 | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDashboard = useCallback(async () => {
    const [nextSummary, nextActivities] = await Promise.all([
      api<DashboardSummary>("/api/dashboard/summary"),
      api<ActivitySummary[]>("/api/activities"),
    ]);
    setSummary(nextSummary);
    setActivities(nextActivities);
  }, []);

  useEffect(() => {
    api<AuthStatus>("/api/auth/status")
      .then(async (status) => {
        setAuth(status);
        if (status.authenticated) await loadDashboard();
      })
      .finally(() => setLoading(false));
  }, [loadDashboard]);

  async function authenticated(codes?: string[]) {
    const status = await api<AuthStatus>("/api/auth/status");
    setAuth(status);
    if (codes) setRecoveryCodes(codes);
    await loadDashboard();
  }

  async function selectActivity(id: string) {
    setLoading(true);
    try {
      setSelected(await api<NormalizedCyclingActivityV1>(`/api/activities/${id}`));
    } finally {
      setLoading(false);
    }
  }

  async function addPasskey() {
    const optionsJSON = await api<PublicKeyCredentialCreationOptionsJSON>(
      "/api/auth/register/options",
      { method: "POST", body: "{}" },
    );
    const response = await startRegistration({ optionsJSON });
    await api("/api/auth/register/verify", { method: "POST", body: JSON.stringify({ response }) });
    setAuth(await api<AuthStatus>("/api/auth/status"));
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST", body: "{}" });
    setAuth({ authenticated: false, setupRequired: false });
    setActivities([]);
  }

  if (loading && !auth) return <div className="app-loading"><span /><p>Preparando tu ruta…</p></div>;
  if (!auth?.authenticated) return <AuthScreen setupRequired={auth?.setupRequired ?? false} onAuthenticated={authenticated} />;

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="wordmark" onClick={() => { setView("dashboard"); setSelected(null); }}><span>BD</span><RoadBikeMark /><strong>Bike Dashboard</strong></button>
        <nav aria-label="Principal">
          <button className={view === "dashboard" && !selected ? "active" : ""} onClick={() => { setView("dashboard"); setSelected(null); }}>Resumen</button>
          <button className={view === "analytics" && !selected ? "active" : ""} onClick={() => { setView("analytics"); setSelected(null); }}>Análisis</button>
          <button className={view === "routes" ? "active" : ""} onClick={() => { setView("routes"); setSelected(null); }}>Rutas</button>
          <button className={view === "import" ? "active" : ""} onClick={() => { setView("import"); setSelected(null); }}>Importar</button>
        </nav>
        <button className="profile-button" onClick={() => { setView("settings"); setSelected(null); }} aria-label="Ajustes">P</button>
      </header>

      <main className="main-content">
        {selected ? (
          <ActivityDetail activity={selected} onBack={() => setSelected(null)} />
        ) : view === "dashboard" ? (
          <Dashboard summary={summary} activities={activities} onSelect={selectActivity} onImport={() => setView("import")} />
        ) : view === "analytics" ? (
          <AnalyticsPage activities={activities} onSelect={selectActivity} onConfigure={() => setView("settings")} />
        ) : view === "routes" ? (
          <RoutesView activities={activities} onSelect={selectActivity} />
        ) : view === "import" ? (
          <ImportPanel onImported={async () => { await loadDashboard(); setView("dashboard"); }} />
        ) : <SettingsPage recoverySession={Boolean(auth.recoverySession)} onAddPasskey={addPasskey} onLogout={logout} onSaved={loadDashboard} />}
      </main>

      {recoveryCodes.length > 0 && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
          <section className="recovery-modal">
            <p className="eyebrow">Solo se mostrarán una vez</p>
            <h2 id="recovery-title">Guarda tus códigos de recuperación</h2>
            <p>Conserva estos códigos fuera del VPS. Cada uno funciona una sola vez.</p>
            <div className="recovery-grid">{recoveryCodes.map((code) => <code key={code}>{code}</code>)}</div>
            <button className="button button--primary" onClick={() => setRecoveryCodes([])}>Ya los he guardado</button>
          </section>
        </div>
      )}
      {loading && <div className="loading-line" />}
    </div>
  );
}
