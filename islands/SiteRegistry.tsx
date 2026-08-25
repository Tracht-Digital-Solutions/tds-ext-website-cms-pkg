import { useEffect, useState } from "react";
import { Spinner, toast } from "@tracht-digital-solutions/tds-shared/components";
import { apiFetch } from "@tracht-digital-solutions/tds-shared/api";
import { invalidate, staleClass, useCachedJson } from "@tracht-digital-solutions/tds-shared/data";

interface Site {
  id: number;
  site_key: string;
  name: string;
  rebuild_repo?: string | null;
  rebuild_workflow?: string | null;
  cache_url?: string | null;
  updated_at: string;
}

const api = apiFetch;

/**
 * The managed-website registry — **this is where a website is added**, and the
 * only place its rebuild target and page-cache address are set.
 *
 * All of it used to sit on the Website-CMS content screen, above the text
 * somebody had come to edit: a repository name, a GitHub workflow filename and
 * a deploy button, on the page an operator opens to fix a typo. Connecting a
 * site is a once-per-site act by whoever runs the platform; editing its words
 * is a daily act by whoever writes them. They are now two screens.
 *
 * ### Two buttons that sound alike and are not
 *
 * *Jetzt neu bauen* dispatches a CI workflow: it ships **code**, takes minutes
 * and is for a design or template change. *Seiten-Cache neu bauen* re-renders
 * pages from content already in the database: it takes seconds and is what a
 * save does automatically. The copy says so at every call site, because the
 * pair has been confused before and the expensive one is the wrong guess.
 */
export default function SiteRegistry() {
  const sitesQuery = useCachedJson<{ sites: Site[] }>("/cms/sites");
  const sites = sitesQuery.data?.sites ?? [];
  const sitesVisiblyStale =
    sitesQuery.stale || (sitesQuery.error !== null && sitesQuery.data !== undefined);

  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    const siteKey = key.trim();
    if (!/^[a-z0-9-]{2,64}$/.test(siteKey)) {
      setFormError("Der Schlüssel darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten (2–64 Zeichen).");
      return;
    }
    if (name.trim() === "") {
      setFormError("Ein Name ist erforderlich.");
      return;
    }
    setFormError(null);
    setCreating(true);
    let res: Response;
    try {
      res = await api("/cms/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site_key: siteKey, name: name.trim() }),
      });
    } catch {
      setCreating(false);
      toast.danger("Anlegen fehlgeschlagen (Netzwerkfehler).");
      return;
    }
    setCreating(false);
    if (res.ok) {
      setKey("");
      setName("");
      toast.success("Website angelegt.");
      invalidate("/cms/");
    } else {
      // Never swallow the status — it separates "already exists" from
      // "not allowed" from "service down".
      toast.danger(`Anlegen fehlgeschlagen (HTTP ${res.status}).`);
    }
  };

  return (
    <div className="tds-stack">
      {/* noValidate on purpose: the browser's own `required` bubble says
          "Please fill in this field" and stops the submit before our handler
          runs, so the operator never sees the message that actually explains
          the key format — which is the one thing that cannot be corrected
          afterwards. */}
      <form className="tds-stack tds-stack--tight" onSubmit={create} noValidate>
        <p className="marginalia">
          Der Schlüssel verbindet die Inhalte mit der öffentlichen Website und lässt sich
          später nicht ändern — <code>landingpage</code>, <code>blog</code>, …
        </p>
        <div className="tds-row">
          <label className="block text-sm">
            Schlüssel
            <input
              className="field-boxed"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="landingpage"
              autoComplete="off"
            />
          </label>
          <label className="block text-sm">
            Name
            <input
              className="field-boxed"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Startseite tracht-digital.de"
            />
          </label>
        </div>
        {/* Validation is persistent state and stays in the flow; the outcome of
            the save is a toast. */}
        {formError ? (
          <p className="tds-alert tds-alert--danger" role="alert">
            {formError}
          </p>
        ) : null}
        <button className="btn btn-primary" type="submit" disabled={creating}>
          {creating ? <Spinner size="sm" /> : "Website hinzufügen"}
        </button>
      </form>

      {sitesQuery.error && sites.length > 0 ? (
        <p className="tds-alert tds-alert--danger" role="alert">
          Websites konnten nicht aktualisiert werden ({sitesQuery.error.message}). Die angezeigten
          Daten sind möglicherweise veraltet.
        </p>
      ) : null}

      {sitesQuery.loading ? (
        <p>
          <Spinner />
        </p>
      ) : sitesQuery.error && sites.length === 0 ? (
        <p className="tds-alert tds-alert--danger" role="alert">
          Websites konnten nicht geladen werden ({sitesQuery.error.message}).
        </p>
      ) : sites.length === 0 ? (
        <p className="tds-empty">Noch keine Website verbunden.</p>
      ) : (
        <div className={staleClass(sitesVisiblyStale, "tds-stack")} aria-busy={sitesVisiblyStale}>
          {sites.map((site) => (
            <SiteCard key={site.id} site={site} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Rebuild target and page-cache address for one site, plus the two buttons. */
function SiteCard({ site }: { site: Site }) {
  const [repo, setRepo] = useState(site.rebuild_repo ?? "");
  const [workflow, setWorkflow] = useState(site.rebuild_workflow ?? "dev.yml");
  const [cacheUrl, setCacheUrl] = useState(site.cache_url ?? "");
  const [dirty, setDirty] = useState(false);
  const incomingSignature = JSON.stringify([
    site.rebuild_repo ?? "",
    site.rebuild_workflow ?? "dev.yml",
    site.cache_url ?? "",
  ]);
  const [seededFrom, setSeededFrom] = useState(incomingSignature);
  const [saving, setSaving] = useState(false);
  const [cacheStatus, setCacheStatus] = useState<string | null>(null);
  const [rebuildStatus, setRebuildStatus] = useState<string | null>(null);

  // SWR can replace the site row while this card stays mounted. Refresh an
  // untouched form, but never overwrite an operator who started typing while
  // the stale row was on screen.
  useEffect(() => {
    if (incomingSignature === seededFrom) return;
    const currentSignature = JSON.stringify([repo, workflow, cacheUrl]);
    if (!dirty || currentSignature === incomingSignature) {
      setRepo(site.rebuild_repo ?? "");
      setWorkflow(site.rebuild_workflow ?? "dev.yml");
      setCacheUrl(site.cache_url ?? "");
      setDirty(false);
    }
    setSeededFrom(incomingSignature);
  }, [cacheUrl, dirty, incomingSignature, repo, seededFrom, site, workflow]);

  const saveConfig = async () => {
    setSaving(true);
    let res: Response;
    try {
      res = await api(`/cms/sites/${site.site_key}/rebuild-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rebuild_repo: repo.trim(),
          rebuild_workflow: workflow.trim(),
          cache_url: cacheUrl.trim(),
        }),
      });
    } catch {
      setSaving(false);
      toast.danger("Speichern fehlgeschlagen (Netzwerkfehler).");
      return;
    }
    setSaving(false);
    if (res.ok) {
      // Let the following SWR refresh adopt the server's canonical origin
      // (lower-cased host, trailing slash removed). Keeping `dirty` here would
      // make the protection against clobbering edits also reject our own save.
      setDirty(false);
      toast.success("Konfiguration gespeichert.");
      invalidate("/cms/sites");
    } else {
      toast.danger(`Speichern fehlgeschlagen (HTTP ${res.status}).`);
    }
  };

  const rebuildRepository = async () => {
    setRebuildStatus("Build wird ausgelöst …");
    let res: Response;
    try {
      res = await api(`/cms/sites/${site.site_key}/rebuild`, { method: "POST" });
    } catch {
      setRebuildStatus(null);
      toast.danger("Build fehlgeschlagen (Netzwerkfehler).");
      return;
    }
    if (res.ok) {
      setRebuildStatus(null);
      toast.success("Build ausgelöst.");
    } else if (res.status === 503) {
      // In the flow, not as a toast: a missing token is a persistent
      // configuration gap, and a vanishing message would leave the operator
      // pressing a button that can never work.
      setRebuildStatus("Kein Rebuild-Token hinterlegt (weiter oben in diesem Abschnitt).");
    } else if (res.status === 422) {
      setRebuildStatus("Für diese Website ist kein Repository hinterlegt.");
    } else {
      setRebuildStatus(null);
      toast.danger(`Build fehlgeschlagen (HTTP ${res.status}).`);
    }
  };

  const rebuildCache = async () => {
    setCacheStatus("Seiten-Cache wird neu gebaut …");
    let res: Response;
    try {
      res = await api(`/cms/sites/${site.site_key}/cache/rebuild`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
    } catch {
      setCacheStatus(null);
      toast.danger("Cache-Neubau fehlgeschlagen (Netzwerkfehler).");
      return;
    }
    if (res.ok) {
      setCacheStatus(null);
      toast.success("Cache-Neubau für die Website wurde angestoßen.");
    } else if (res.status === 422) {
      setCacheStatus("Für diese Website ist keine Adresse hinterlegt.");
    } else if (res.status === 503) {
      setCacheStatus("Kein Seiten-Cache-Token hinterlegt (weiter oben in diesem Abschnitt).");
    } else {
      setCacheStatus(null);
      toast.danger(`Cache-Neubau fehlgeschlagen (HTTP ${res.status}).`);
    }
  };

  return (
    <section className="tds-card tds-stack">
      <div className="flex flex-wrap items-baseline gap-2">
        <h4>{site.name}</h4>
        <code className="text-xs opacity-70">{site.site_key}</code>
      </div>

      <label className="block text-sm">
        Adresse der öffentlichen Website
        <input
          className="field-boxed"
          value={cacheUrl}
          onChange={(e) => {
            setCacheUrl(e.target.value);
            setDirty(true);
          }}
          placeholder="https://tracht-digital.de"
        />
      </label>
      <p className="marginalia">
        Reine http(s)-Adresse ohne Zugangsdaten, Pfad, Query oder Fragment. Ohne sie wird gespeichert,
        aber die öffentliche Seite zeigt weiter die alte Fassung, bis sie von selbst neu
        rendert.
      </p>

      <div className="tds-row">
        <label className="block text-sm">
          Repository
          <input
            className="field-boxed"
            value={repo}
            onChange={(e) => {
              setRepo(e.target.value);
              setDirty(true);
            }}
            placeholder="Tracht-Digital-Solutions/tds-landingpage-frontend"
          />
        </label>
        <label className="block text-sm">
          Workflow
          <input
            className="field-boxed"
            value={workflow}
            onChange={(e) => {
              setWorkflow(e.target.value);
              setDirty(true);
            }}
            placeholder="dev.yml"
          />
        </label>
      </div>
      <p className="marginalia">
        Nur für Code- und Design-Änderungen. Der Token liegt weiter oben in diesem Abschnitt.
      </p>

      {rebuildStatus ? (
        <p className="tds-alert" role="status">
          {rebuildStatus}
        </p>
      ) : null}
      {cacheStatus ? (
        <p className="tds-alert" role="status">
          {cacheStatus}
        </p>
      ) : null}

      <div className="tds-toolbar">
        <button className="btn btn-primary" type="button" onClick={saveConfig} disabled={saving}>
          {saving ? <Spinner size="sm" /> : "Konfiguration speichern"}
        </button>
        <button className="btn btn-accent" type="button" onClick={rebuildCache}>
          Seiten-Cache neu bauen
        </button>
        <button className="btn btn-ghost" type="button" onClick={rebuildRepository}>
          Jetzt neu bauen (CI)
        </button>
      </div>
    </section>
  );
}
