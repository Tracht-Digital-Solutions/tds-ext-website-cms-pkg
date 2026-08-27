import { useEffect, useState } from "react";
import { Spinner, toast } from "@tracht-digital-solutions/tds-shared/components";
import { apiFetch } from "@tracht-digital-solutions/tds-shared/api";

interface Masked {
  key: string;
  secret: boolean;
  configured?: boolean;
  last4?: string | null;
  value?: string;
}

const api = apiFetch;
const NS = "/admin/settings/website-cms";

/**
 * Website-CMS settings section — DeepL key and auto-translate flag.
 * persisted in the core's runtime settings store (`/admin/settings/website-cms`,
 * admin-only). Secrets come back masked (configured + last4) and a blank secret
 * on save keeps the existing value. The extension backend reads these DB-first
 * with an env fallback. Mirror of blog-cms's BlogSettings.
 */
export default function WebsiteSettings() {
  const [loaded, setLoaded] = useState(false);
  const [deeplState, setDeeplState] = useState<Masked | null>(null);
  const [autoTranslate, setAutoTranslate] = useState(true);
  const [deeplInput, setDeeplInput] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setStatus(null);
    let res: Response;
    try {
      res = await api(NS);
    } catch {
      setStatus("Einstellungen konnten nicht geladen werden (Netzwerkfehler).");
      setLoaded(true);
      return;
    }
    if (!res.ok) {
      setStatus(res.status === 403 || res.status === 401 ? "Nur für Administratoren." : `Fehler (HTTP ${res.status}).`);
      setLoaded(true);
      return;
    }
    let d: { settings?: Masked[] };
    try {
      d = (await res.json()) as { settings?: Masked[] };
    } catch {
      setStatus("Einstellungen konnten nicht gelesen werden (ungültige Serverantwort).");
      setLoaded(true);
      return;
    }
    const map = new Map<string, Masked>((d.settings ?? []).map((s: Masked) => [s.key, s]));
    setDeeplState(map.get("deepl_api_key") ?? null);
    const at = map.get("auto_translate");
    setAutoTranslate(at?.value !== "0");
    setLoaded(true);
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    setBusy(true);
    setStatus(null);
    const settings: Masked[] = [
      { key: "deepl_api_key", secret: true, value: deeplInput.trim() },
      { key: "auto_translate", secret: false, value: autoTranslate ? "1" : "0" },
    ];
    let res: Response;
    try {
      res = await api(NS, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
    } catch {
      setBusy(false);
      toast.danger("Speichern fehlgeschlagen (Netzwerkfehler).");
      return;
    }
    setBusy(false);
    if (res.ok) {
      setDeeplInput("");
      toast.success("Gespeichert.");
      void load();
    } else {
      toast.danger(`Speichern fehlgeschlagen (HTTP ${res.status}).`);
    }
  };

  const secretHint = (s: Masked | null) =>
    s?.configured ? `konfiguriert (…${s.last4 ?? "????"})` : "nicht konfiguriert";

  if (!loaded) return <p><Spinner /></p>;

  return (
    <div className="website-settings space-y-4">
      <label className="block">
        <span className="text-sm">DeepL API-Key <em className="opacity-60">({secretHint(deeplState)})</em></span>
        <input className="field-boxed"
          type="password"
          value={deeplInput}
          onChange={(e) => setDeeplInput(e.target.value)}
          placeholder="Neuen Schlüssel setzen (leer = behalten)"
          autoComplete="off"
        />
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={autoTranslate} onChange={(e) => setAutoTranslate(e.target.checked)} />
        <span>Automatische Übersetzung (DeepL) aktiv</span>
      </label>

      <p className="marginalia">
        Die API- und Cache-Verbindung wird direkt bei der jeweiligen Website eingerichtet.
        Zugangsdaten werden hier nicht angezeigt.
      </p>

      {/* The load failure stays in-flow (persistent state); the save outcome
          is a toast. Failures only, hence the danger hue. */}
      {status ? <p className="tds-alert tds-alert--danger" role="alert">{status}</p> : null}
      <button className="btn btn-primary" type="button" onClick={save} disabled={busy}>Speichern</button>
    </div>
  );
}
