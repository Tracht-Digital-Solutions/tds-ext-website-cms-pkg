import { useEffect, useState } from "react";
import { Alert, ConfirmDialog, Spinner, toast } from "@tracht-digital-solutions/tds-shared/components";
import { usePairing } from "@tracht-digital-solutions/tds-shared/admin";
import { apiFetch, sendJson } from "@tracht-digital-solutions/tds-shared/api";
import { invalidate, staleClass, useCachedJson } from "@tracht-digital-solutions/tds-shared/data";

interface Site {
  id: number;
  site_key: string;
  name: string;
  updated_at: string;
}

interface Connection {
  origin?: string;
  profile?: string;
  status?: string;
  connected_at?: string | null;
  last_seen_at?: string | null;
}

interface BlogCandidate {
  blog_key: string;
  name: string;
}

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
  const blogsQuery = useCachedJson<{ blogs: BlogCandidate[] }>("/blogs");
  const sites = sitesQuery.data?.sites ?? [];
  const blogs = blogsQuery.data?.blogs ?? [];
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
      res = await sendJson("/cms/sites", "POST", { site_key: siteKey, name: name.trim() });
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
          <Alert>
            {formError}
          </Alert>
        ) : null}
        <button className="btn btn-primary" type="submit" disabled={creating}>
          {creating ? <Spinner size="sm" /> : "Website hinzufügen"}
        </button>
      </form>

      {sitesQuery.error && sites.length > 0 ? (
        <Alert>
          Websites konnten nicht aktualisiert werden ({sitesQuery.error.message}). Die angezeigten
          Daten sind möglicherweise veraltet.
        </Alert>
      ) : null}

      {sitesQuery.loading ? (
        <p>
          <Spinner />
        </p>
      ) : sitesQuery.error && sites.length === 0 ? (
        <Alert>
          Websites konnten nicht geladen werden ({sitesQuery.error.message}).
        </Alert>
      ) : sites.length === 0 ? (
        <p className="tds-empty">Noch keine Website verbunden.</p>
      ) : (
        <div className={staleClass(sitesVisiblyStale, "tds-stack")} aria-busy={sitesVisiblyStale}>
          {sites.map((site) => (
            <SiteCard key={site.id} site={site} blogs={blogs} />
          ))}
        </div>
      )}
    </div>
  );
}

/** One-click API connection and targeted page-cache refresh for one site. */
function SiteCard({ site, blogs }: { site: Site; blogs: BlogCandidate[] }) {
  const pairing = usePairing({
    base: `/cms/sites/${site.site_key}`,
    profile: "landingpage",
    subject: "Die Website",
    rebuildBody: { all: true },
    rebuildSuccess: "Cache-Neubau für die Website wurde angestoßen.",
    ambiguousHint: "Bitte eine reine HTTPS-Adresse und bei mehreren Blogs den passenden Blog-Schlüssel angeben.",
  });
  const connection = pairing.connection as Connection | null;
  const [origin, setOrigin] = useState("");
  const [blog, setBlog] = useState("");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const candidateKeys = pairing.candidates ?? blogs.map((item) => item.blog_key);

  useEffect(() => {
    if (connection?.origin) setOrigin(connection.origin);
  }, [connection?.origin]);

  useEffect(() => {
    if (blogs.length === 1) setBlog(blogs[0]!.blog_key);
  }, [blogs]);

  const connect = () => void pairing.connect(origin, blog.trim() === "" ? {} : { blog: blog.trim() });

  const disconnect = async () => {
    setDisconnecting(true);
    await pairing.disconnect();
    setDisconnecting(false);
    setConfirmDisconnect(false);
  };

  const rebuildCache = async () => {
    setRebuilding(true);
    await pairing.rebuildCache();
    setRebuilding(false);
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
          value={origin}
          onChange={(e) => setOrigin(e.target.value)}
          placeholder="https://tracht-digital.de"
        />
      </label>
      <p className="marginalia">
        Die Website übernimmt API-Schlüssel und Cache-Zugang automatisch. Nur die HTTPS-Adresse
        ohne Pfad eingeben.
      </p>

      {candidateKeys.length > 0 ? (
        <label className="block text-sm">
          Blog-Inhalte verwenden {candidateKeys.length > 1 ? <span>(erforderlich)</span> : null}
          <select className="field-boxed" value={blog} onChange={(e) => setBlog(e.target.value)}>
            {candidateKeys.length > 1 ? <option value="">Blog auswählen …</option> : null}
            {candidateKeys.map((key) => {
              const label = blogs.find((item) => item.blog_key === key)?.name;
              return <option key={key} value={key}>{label ? `${label} (${key})` : key}</option>;
            })}
          </select>
        </label>
      ) : null}

      {pairing.loading ? <p><Spinner size="sm" /> Verbindungsstatus wird geladen …</p> : connection ? (
        <Alert tone="success">Verbunden mit {connection.origin ?? origin}</Alert>
      ) : <Alert tone="neutral">Noch nicht mit der API verbunden.</Alert>}
      <Alert>{pairing.status}</Alert>
      {pairing.installUrl ? <p><a className="btn btn-ghost" href={pairing.installUrl}>Einrichtungslink öffnen</a></p> : null}

      <div className="tds-toolbar">
        <button className="btn btn-primary" type="button" onClick={connect} disabled={pairing.connecting || origin.trim() === "" || (candidateKeys.length > 1 && blog === "")}>
          {pairing.connecting ? <Spinner size="sm" /> : connection ? "Neu verbinden" : "Mit API verbinden"}
        </button>
        <button className="btn btn-accent" type="button" onClick={() => void rebuildCache()} disabled={rebuilding} aria-busy={rebuilding}>
          {rebuilding ? <Spinner size="sm" /> : null}
          Seiten-Cache neu bauen
        </button>
        {connection ? <button className="btn btn-ghost" type="button" onClick={() => setConfirmDisconnect(true)}>Verbindung trennen</button> : null}
      </div>
      <ConfirmDialog
        open={confirmDisconnect}
        title="Verbindung trennen?"
        message={`Die Website „${site.name}" verliert ihren API-Zugang, bis sie neu verbunden wird.`}
        confirmLabel="Trennen"
        busy={disconnecting}
        onConfirm={() => void disconnect()}
        onCancel={() => setConfirmDisconnect(false)}
      />
    </section>
  );
}
