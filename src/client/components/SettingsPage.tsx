import { useEffect, useState } from "react";

import type { AnalyticsPreferences, PeriodGoal } from "../../shared/contracts";
import { api } from "../lib/api";

interface GoalDraft {
  distanceKm: string;
  durationHours: string;
  elevationM: string;
  rides: string;
}

const emptyGoal: GoalDraft = { distanceKm: "", durationHours: "", elevationM: "", rides: "" };

function toDraft(goal: PeriodGoal): GoalDraft {
  return {
    distanceKm: goal.distanceM === null ? "" : String(goal.distanceM / 1000),
    durationHours: goal.durationS === null ? "" : String(goal.durationS / 3600),
    elevationM: goal.elevationGainM === null ? "" : String(goal.elevationGainM),
    rides: goal.rides === null ? "" : String(goal.rides),
  };
}

function toGoal(period: string, draft: GoalDraft): PeriodGoal {
  const number = (value: string, multiplier = 1) => value === "" ? null : Number(value) * multiplier;
  return {
    period,
    distanceM: number(draft.distanceKm, 1000),
    durationS: number(draft.durationHours, 3600),
    elevationGainM: number(draft.elevationM),
    rides: number(draft.rides),
  };
}

function GoalForm({ title, period, value, onChange }: { title: string; period: string; value: GoalDraft; onChange: (value: GoalDraft) => void }) {
  const field = (key: keyof GoalDraft, label: string, suffix: string) => <label><span>{label}</span><div><input type="number" min="0" step={key === "rides" ? "1" : "any"} value={value[key]} onChange={(event) => onChange({ ...value, [key]: event.target.value })} /><small>{suffix}</small></div></label>;
  return <fieldset className="goal-form"><legend><span>{title}</span><strong>{period}</strong></legend>{field("distanceKm", "Distancia", "km")}{field("durationHours", "Tiempo", "h")}{field("elevationM", "Desnivel", "m")}{field("rides", "Salidas", "uds")}</fieldset>;
}

export function SettingsPage({ recoverySession, onAddPasskey, onLogout, onSaved }: { recoverySession: boolean; onAddPasskey: () => void; onLogout: () => void; onSaved: () => void }) {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = `${year}-${(now.getMonth() + 1).toString().padStart(2, "0")}`;
  const [preferences, setPreferences] = useState<AnalyticsPreferences>({ timezone: "Europe/Madrid", maximumHeartRateBpm: null, restingHeartRateBpm: null });
  const [yearGoal, setYearGoal] = useState<GoalDraft>(emptyGoal);
  const [monthGoal, setMonthGoal] = useState<GoalDraft>(emptyGoal);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      api<AnalyticsPreferences>("/api/analytics/preferences"),
      api<PeriodGoal>(`/api/analytics/goals/${year}`),
      api<PeriodGoal>(`/api/analytics/goals/${month}`),
    ]).then(([nextPreferences, nextYear, nextMonth]) => {
      setPreferences(nextPreferences);
      setYearGoal(toDraft(nextYear));
      setMonthGoal(toDraft(nextMonth));
    });
  }, [month, year]);

  async function save() {
    setSaving(true);
    setStatus("");
    try {
      await Promise.all([
        api("/api/analytics/preferences", { method: "PUT", body: JSON.stringify(preferences) }),
        api(`/api/analytics/goals/${year}`, { method: "PUT", body: JSON.stringify(toGoal(year, yearGoal)) }),
        api(`/api/analytics/goals/${month}`, { method: "PUT", body: JSON.stringify(toGoal(month, monthGoal)) }),
      ]);
      setStatus("Preferencias y objetivos guardados.");
      onSaved();
    } catch {
      setStatus("Revisa los valores. La FC máxima debe superar a la FC en reposo.");
    } finally {
      setSaving(false);
    }
  }

  return <section className="settings-page">
    <header className="page-heading"><p className="eyebrow">Ajustes personales</p><h1>Tu referencia</h1><p>Estos valores solo sirven para interpretar tu propio historial. No se comparten ni modifican los datos importados.</p></header>
    <div className="settings-layout">
      <section className="settings-section heart-settings">
        <header><div><p className="eyebrow">Zonas de pulso</p><h2>Reserva cardiaca</h2></div><span>Karvonen · 5 zonas</span></header>
        <p>Introduce valores medidos. Hasta entonces el análisis ocultará las zonas y la carga.</p>
        <div className="settings-fields">
          <label><span>FC máxima</span><div><input type="number" min="100" max="230" value={preferences.maximumHeartRateBpm ?? ""} onChange={(event) => setPreferences({ ...preferences, maximumHeartRateBpm: event.target.value ? Number(event.target.value) : null })} /><small>ppm</small></div></label>
          <label><span>FC en reposo</span><div><input type="number" min="30" max="100" value={preferences.restingHeartRateBpm ?? ""} onChange={(event) => setPreferences({ ...preferences, restingHeartRateBpm: event.target.value ? Number(event.target.value) : null })} /><small>ppm</small></div></label>
        </div>
      </section>

      <section className="settings-section goals-settings">
        <header><div><p className="eyebrow">Ritmo previsto</p><h2>Objetivos</h2></div><span>Mensual + anual</span></header>
        <div className="goal-forms"><GoalForm title="Este mes" period={month} value={monthGoal} onChange={setMonthGoal} /><GoalForm title="Este año" period={year} value={yearGoal} onChange={setYearGoal} /></div>
      </section>

      <div className="settings-save"><button className="button button--primary" disabled={saving} onClick={save}>{saving ? "Guardando…" : "Guardar análisis"}</button>{status && <p className="notice">{status}</p>}</div>

      <section className="settings-section account-settings">
        <header><div><p className="eyebrow">Acceso y privacidad</p><h2>Tu cuenta</h2></div><span>Passkey</span></header>
        <p>Una única cuenta protegida con passkey. Los ZIP de Salud nunca se guardan.</p>
        <div className="settings-actions"><button className="button button--dark" onClick={onAddPasskey}>Registrar otra passkey</button><button className="button button--quiet" onClick={onLogout}>Cerrar sesión</button></div>
        {recoverySession && <p className="notice notice--error">Has entrado con recuperación. Registra una nueva passkey antes de cerrar sesión.</p>}
      </section>
    </div>
  </section>;
}
