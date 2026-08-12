import { useEffect, useRef, useState } from "react";
import { Spinner, toast } from "@tracht-digital-solutions/tds-shared/components";
import { apiFetch, apiUrl } from "@tracht-digital-solutions/tds-shared/api";

export interface LegalDoc {
  docKey: string;
  lang: string;
  filename: string;
  sizeBytes: number;
  versionLabel: string | null;
  updatedAt: string;
}

const api = apiFetch;

/** The documents a site is expected to carry, so the editor is not a blank slate. */
const KNOWN_KEYS: { key: string; label: string }[] = [{ key: "agb", label: "AGB" }];

const LANGS = ["de", "en"] as const;

const formatSize = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Legal-document manager for one site — the upload surface behind the
 * landingpage's AGB page.
 *
 * The uploaded PDF is the source of truth: the public landingpage build
 * downloads it from `GET /content/legal/{key}.pdf` and bakes it into its
 * static `dist/`, so a document only reaches visitors after a rebuild. The
 * upload fires that rebuild the same way a block save does — which is why the
 * success toast says so rather than implying the site is already updated.
 */
export default function LegalDocs({ siteKey }: { siteKey: string }) {
  const [docs, setDocs] = useState<LegalDoc[] | null>(null);
  const [docKey, setDocKey] = useState("agb");
  const [lang, setLang] = useState<string>("de");
  const [versionLabel, setVersionLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () =>
    api(`/cms/sites/${siteKey}/legal`)
      .then((r) => (r.ok ? r.json() : { docs: [] }))
      .then((d) => setDocs(d.docs ?? []))
      .catch(() => setDocs([]));

  useEffect(() => {
    load();
  }, [siteKey]);

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Bitte eine PDF-Datei auswählen.");
      return;
    }
    if (!/^[a-z0-9-]{2,64}$/.test(docKey)) {
      setError("Dokument-Schlüssel: 2–64 Zeichen, nur a–z, 0–9 und Bindestrich.");
      return;
    }
    setError(null);
    setBusy(true);
    const body = new FormData();
    // No Content-Type header — the browser has to set the multipart boundary.
    body.append("file", file);
    body.append("lang", lang);
    body.append("version_label", versionLabel.trim());
    const res = await api(`/cms/sites/${siteKey}/legal/${docKey}`, { method: "POST", body });
    setBusy(false);
    if (res.ok) {
      if (fileRef.current) fileRef.current.value = "";
      toast.success("Dokument hochgeladen (Rebuild ausgelöst, falls konfiguriert).");
      load();
      return;
    }
    // Named causes stay in the flow; a transport failure is a toast. Both carry
    // the status — that is what separates "session abgelaufen" from "Dienst weg".
    if (res.status === 415) setError("Nur PDF-Dateien werden akzeptiert.");
    else if (res.status === 413) setError("Die Datei ist größer als 8 MB.");
    else toast.danger(`Upload fehlgeschlagen (HTTP ${res.status}).`);
  };

  const remove = async (doc: LegalDoc) => {
    const res = await api(`/cms/sites/${siteKey}/legal/${doc.docKey}?lang=${doc.lang}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Dokument entfernt (Rebuild ausgelöst, falls konfiguriert).");
      load();
    } else {
      toast.danger(`Entfernen fehlgeschlagen (HTTP ${res.status}).`);
    }
  };

  return (
    <div className="cms-editor__legal">
      <h3>Rechtsdokumente (PDF)</h3>
      <p className="marginalia">
        Hochgeladene PDFs — z. B. die AGB — werden von der öffentlichen Website beim
        nächsten Build übernommen und dort als Seite mit Vorschau und Download
        eingebunden. Pro Sprache eine Datei; maximal 8 MB.
      </p>

      {docs === null ? (
        <p>
          <Spinner />
        </p>
      ) : docs.length === 0 ? (
        <p className="tds-empty">Noch keine Dokumente hochgeladen.</p>
      ) : (
        <table className="tds-table" tabIndex={0} role="region" aria-label="Hochgeladene Rechtsdokumente">
          <caption className="sr-only">Hochgeladene Rechtsdokumente</caption>
          <thead>
            <tr>
              <th scope="col">Dokument</th>
              <th scope="col">Sprache</th>
              <th scope="col">Datei</th>
              <th scope="col">Stand</th>
              <th scope="col">Aktion</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={`${d.docKey}-${d.lang}`}>
                <td>
                  <code>{d.docKey}</code>
                </td>
                <td>
                  <span className="chip chip--neutral">{d.lang}</span>
                </td>
                <td>
                  {d.filename} <span className="marginalia">({formatSize(d.sizeBytes)})</span>
                </td>
                <td>{d.versionLabel ?? "—"}</td>
                <td>
                  <div className="tds-toolbar">
                    {/* apiUrl, not a relative href: the panel is served from
                        management.tracht-digital.de and this path only exists
                        on the API host — relatively it would hit the product's
                        SPA fallback and open a copy of the panel. */}
                    <a
                      className="btn btn-ghost"
                      href={apiUrl(`/cms/sites/${siteKey}/legal/${d.docKey}/file?lang=${d.lang}`)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Ansehen
                    </a>
                    <button className="btn btn-ghost" type="button" onClick={() => remove(d)}>
                      Entfernen
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form
        className="tds-stack"
        onSubmit={(e) => {
          e.preventDefault();
          upload();
        }}
      >
        <div className="tds-row">
          <label>
            <span className="marginalia">Dokument</span>
            <input
              className="field-boxed"
              list="cms-legal-keys"
              value={docKey}
              onChange={(e) => setDocKey(e.target.value.toLowerCase())}
              placeholder="agb"
              required
            />
          </label>
          <datalist id="cms-legal-keys">
            {KNOWN_KEYS.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </datalist>
          <label>
            <span className="marginalia">Sprache</span>
            <select className="field-boxed" value={lang} onChange={(e) => setLang(e.target.value)}>
              {LANGS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="marginalia">Stand (optional)</span>
            <input
              className="field-boxed"
              value={versionLabel}
              onChange={(e) => setVersionLabel(e.target.value)}
              placeholder="Stand: 09/2025"
            />
          </label>
        </div>
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" aria-label="PDF-Datei" />
        {error ? (
          <p className="tds-alert tds-alert--danger" role="alert">
            {error}
          </p>
        ) : null}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? <Spinner size="sm" /> : "Hochladen"}
        </button>
      </form>
    </div>
  );
}
