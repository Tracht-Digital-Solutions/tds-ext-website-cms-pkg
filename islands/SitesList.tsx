import { useEffect, useState } from "react";

interface Site {
  id: number;
  site_key: string;
  name: string;
  updated_at: string;
}

const api = (path: string, init?: RequestInit) =>
  fetch(path, { credentials: "include", ...init });

/**
 * Website-CMS managed-sites list + add-site form (checkpoint-1). The per-section
 * block editor (list a site's blocks, edit the JSON via structured forms, save +
 * trigger a rebuild) lands in the next frontend checkpoint.
 */
export default function SitesList() {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () =>
    api("/cms/sites")
      .then((r) => (r.ok ? r.json() : { sites: [] }))
      .then((d) => setSites(d.sites ?? []))
      .catch(() => setSites([]));

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    if (!/^[a-z0-9-]{2,64}$/.test(key) || name.trim() === "") return;
    setSaving(true);
    const res = await api("/cms/sites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site_key: key, name }),
    });
    setSaving(false);
    if (res.ok) {
      setKey("");
      setName("");
      load();
    }
  };

  return (
    <div className="cms-sites">
      <form
        className="cms-sites__form"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="site-key (kebab)" required />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required />
        <button type="submit" disabled={saving}>
          Website hinzufügen
        </button>
      </form>

      {sites === null ? (
        <p>Wird geladen …</p>
      ) : sites.length === 0 ? (
        <p>Noch keine Websites angelegt.</p>
      ) : (
        <ul className="cms-sites__list">
          {sites.map((s) => (
            <li key={s.id}>
              <strong>{s.name}</strong> <code>{s.site_key}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
