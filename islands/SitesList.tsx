import { useEffect, useState } from "react";

interface Site {
  id: number;
  site_key: string;
  name: string;
  rebuild_repo?: string | null;
  rebuild_workflow?: string | null;
  updated_at: string;
}

interface BlockMeta {
  section_key: string;
  lang: string;
  machine_translated?: number | boolean;
  updated_at: string;
}

const api = (path: string, init?: RequestInit) => fetch(path, { credentials: "include", ...init });

/**
 * Website-CMS: managed-sites list + add-site form (CP1) and the per-site content
 * block editor (CP2) — list a site's section blocks and edit each block's JSON
 * (one object per section × language), saved via PUT. A save-triggered static-
 * site rebuild lands in a later checkpoint.
 */
export default function SitesList() {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Site | null>(null);

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
    const res = await api("/cms/sites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site_key: key, name }),
    });
    if (res.ok) {
      setKey("");
      setName("");
      load();
    }
  };

  if (selected) {
    return <SiteEditor site={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="cms-sites">
      <form className="cms-sites__form" onSubmit={(e) => { e.preventDefault(); create(); }}>
        <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="site-key (kebab)" required />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required />
        <button type="submit">Website hinzufügen</button>
      </form>

      {sites === null ? (
        <p>Wird geladen …</p>
      ) : sites.length === 0 ? (
        <p>Noch keine Websites angelegt.</p>
      ) : (
        <ul className="cms-sites__list">
          {sites.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => setSelected(s)}>
                <strong>{s.name}</strong> <code>{s.site_key}</code>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- structured section forms ----------------------------------------------
// Known section shapes render typed fields (text/textarea/number/checkbox,
// repeatable object lists, and string lists) instead of raw JSON. Anything not
// here falls back to the JSON editor, and a Form/JSON toggle is always available.
// Add a section here to give it a structured form.
type LeafType = "text" | "textarea" | "number" | "checkbox";
type LeafField = { key: string; label: string; type: LeafType };
type StringListField = { key: string; label: string; type: "stringlist"; itemLabel: string };
type ObjectListField = { key: string; label: string; type: "list"; itemLabel: string; itemFields: (LeafField | StringListField)[] };
type Field = LeafField | StringListField | ObjectListField;

// Shapes match the tds-landingpage section defaults (the primary consumer). A
// structured form only renders the fields listed here; any other keys in the
// block survive untouched (the form spreads them), so a partial schema is safe.
const SECTION_SCHEMAS: Record<string, Field[]> = {
  hero: [
    { key: "headline", label: "Überschrift", type: "text" },
    { key: "headlineAccent", label: "Überschrift (Akzent)", type: "text" },
    { key: "headlineSuffix", label: "Überschrift (Suffix)", type: "text" },
    { key: "tagline", label: "Tagline", type: "text" },
    { key: "sub", label: "Untertext", type: "textarea" },
    { key: "cta1", label: "Button 1", type: "text" },
    { key: "cta2", label: "Button 2", type: "text" },
    { key: "scrollHint", label: "Scroll-Hinweis", type: "text" },
  ],
  about: [
    { key: "label", label: "Label", type: "text" },
    { key: "headline", label: "Überschrift", type: "text" },
    { key: "headlineAccent", label: "Überschrift (Akzent)", type: "text" },
    { key: "lead", label: "Lead", type: "textarea" },
    { key: "p1", label: "Absatz 1", type: "textarea" },
    { key: "p2", label: "Absatz 2", type: "textarea" },
    { key: "stat1Value", label: "Statistik 1 – Wert", type: "text" },
    { key: "stat1Label", label: "Statistik 1 – Label", type: "text" },
    { key: "stat2Value", label: "Statistik 2 – Wert", type: "text" },
    { key: "stat2Label", label: "Statistik 2 – Label", type: "text" },
    { key: "stat3Value", label: "Statistik 3 – Wert", type: "text" },
    { key: "stat3Label", label: "Statistik 3 – Label", type: "text" },
  ],
  services: [
    { key: "label", label: "Label", type: "text" },
    { key: "headline", label: "Überschrift", type: "text" },
    { key: "headlineAccent", label: "Überschrift (Akzent)", type: "text" },
    { key: "items", label: "Leistungen", type: "list", itemLabel: "Leistung", itemFields: [
      { key: "number", label: "Nummer", type: "text" },
      { key: "title", label: "Titel", type: "text" },
      { key: "description", label: "Beschreibung", type: "textarea" },
    ] },
  ],
  faq: [
    { key: "label", label: "Label", type: "text" },
    { key: "headline", label: "Überschrift", type: "text" },
    { key: "items", label: "Fragen", type: "list", itemLabel: "Frage", itemFields: [
      { key: "q", label: "Frage", type: "text" },
      { key: "a", label: "Antwort", type: "textarea" },
    ] },
  ],
  contact: [
    { key: "label", label: "Label", type: "text" },
    { key: "headline", label: "Überschrift", type: "text" },
    { key: "headlineAccent", label: "Überschrift (Akzent)", type: "text" },
    { key: "sub", label: "Untertext", type: "textarea" },
    { key: "email", label: "E-Mail", type: "text" },
    { key: "phone", label: "Telefon", type: "text" },
    { key: "location", label: "Ort", type: "text" },
  ],
  process: [
    { key: "label", label: "Label", type: "text" },
    { key: "headline", label: "Überschrift", type: "text" },
    { key: "headlineAccent", label: "Überschrift (Akzent)", type: "text" },
    { key: "body", label: "Text", type: "textarea" },
    { key: "steps", label: "Schritte", type: "list", itemLabel: "Schritt", itemFields: [
      { key: "number", label: "Nummer", type: "text" },
      { key: "title", label: "Titel", type: "text" },
      { key: "duration", label: "Dauer", type: "text" },
      { key: "description", label: "Beschreibung", type: "textarea" },
      { key: "detail", label: "Detail", type: "textarea" },
      { key: "outcome", label: "Ergebnis", type: "textarea" },
    ] },
  ],
  consulting: [
    { key: "label", label: "Label", type: "text" },
    { key: "headline", label: "Überschrift", type: "text" },
    { key: "headlineAccent", label: "Überschrift (Akzent)", type: "text" },
    { key: "body", label: "Text", type: "textarea" },
    { key: "primaryCta", label: "Button (primär)", type: "text" },
    { key: "secondaryCta", label: "Button (sekundär)", type: "text" },
  ],
  footer: [
    { key: "slogan", label: "Slogan", type: "text" },
    { key: "tagline", label: "Tagline", type: "text" },
    { key: "nav", label: "Navigation-Titel", type: "text" },
    { key: "contactTitle", label: "Kontakt-Titel", type: "text" },
    { key: "copyright", label: "Copyright", type: "text" },
    { key: "impressum", label: "Impressum-Label", type: "text" },
    { key: "datenschutz", label: "Datenschutz-Label", type: "text" },
    { key: "pricing", label: "Preise-Label", type: "text" },
  ],
  pricing: [
    { key: "label", label: "Label", type: "text" },
    { key: "headline", label: "Überschrift", type: "text" },
    { key: "headlineAccent", label: "Überschrift (Akzent)", type: "text" },
    { key: "sub", label: "Untertext", type: "textarea" },
    { key: "teaserLabel", label: "Teaser-Label", type: "text" },
    { key: "teaserHeadline", label: "Teaser-Überschrift", type: "text" },
    { key: "teaserHeadlineAccent", label: "Teaser-Überschrift (Akzent)", type: "text" },
    { key: "teaserSub", label: "Teaser-Untertext", type: "textarea" },
    { key: "teaserCta", label: "Teaser-Button", type: "text" },
    { key: "teaserFromLabel", label: "„ab“-Label", type: "text" },
    { key: "hourSuffix", label: "Stunden-Suffix", type: "text" },
    { key: "includesLabel", label: "„Beinhaltet“-Label", type: "text" },
    { key: "items", label: "Pakete", type: "list", itemLabel: "Paket", itemFields: [
      { key: "title", label: "Titel", type: "text" },
      { key: "rate", label: "Stundensatz (€)", type: "number" },
      { key: "description", label: "Beschreibung", type: "textarea" },
      { key: "includes", label: "Beinhaltet", type: "stringlist", itemLabel: "Punkt" },
      { key: "highlight", label: "Hervorheben", type: "checkbox" },
    ] },
    { key: "notesTitle", label: "Hinweise-Titel", type: "text" },
    { key: "notes", label: "Hinweise", type: "stringlist", itemLabel: "Hinweis" },
    { key: "ctaTitle", label: "CTA-Titel", type: "text" },
    { key: "ctaSub", label: "CTA-Untertext", type: "textarea" },
    { key: "ctaButton", label: "CTA-Button", type: "text" },
    { key: "back", label: "Zurück-Label", type: "text" },
  ],
};

type Obj = Record<string, unknown>;

/** A single typed leaf input; emits the correctly-typed value (string/number/bool). */
function LeafInput({ field, value, onChange }: { field: LeafField; value: unknown; onChange: (v: unknown) => void }) {
  if (field.type === "checkbox") {
    return <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />;
  }
  if (field.type === "number") {
    return (
      <input
        type="number"
        value={value === undefined || value === null || value === "" ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      />
    );
  }
  if (field.type === "textarea") {
    return <textarea value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} rows={3} />;
  }
  return <input value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
}

/** Editor for an array of plain strings (e.g. pricing `includes` / `notes`). */
function StringListEditor({ field, items, onChange }: { field: StringListField; items: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="cms-form__stringlist">
      <div className="flex items-center justify-between">
        <span className="text-sm">{field.label}</span>
        <button type="button" className="text-xs" onClick={() => onChange([...items, ""])}>+ {field.itemLabel}</button>
      </div>
      {items.map((s, i) => (
        <div key={i} className="flex gap-2">
          <input value={s} onChange={(e) => onChange(items.map((v, idx) => (idx === i ? e.target.value : v)))} />
          <button type="button" className="danger text-xs" onClick={() => onChange(items.filter((_, idx) => idx !== i))}>×</button>
        </div>
      ))}
    </div>
  );
}

/** Render one field (leaf / string-list / object-list) bound to `value[field.key]`. */
function FieldEditor({ field, value, onChange }: { field: LeafField | StringListField; value: unknown; onChange: (v: unknown) => void }) {
  if (field.type === "stringlist") {
    return (
      <StringListEditor
        field={field}
        items={Array.isArray(value) ? (value as unknown[]).map((v) => String(v ?? "")) : []}
        onChange={(items) => onChange(items)}
      />
    );
  }
  return (
    <label className="block text-sm">
      {field.label}
      <LeafInput field={field} value={value} onChange={onChange} />
    </label>
  );
}

function ListEditor({ field, items, onChange }: { field: ObjectListField; items: Obj[]; onChange: (items: Obj[]) => void }) {
  const update = (i: number, key: string, v: unknown) =>
    onChange(items.map((it, idx) => (idx === i ? { ...it, [key]: v } : it)));
  const blank = (): Obj =>
    Object.fromEntries(field.itemFields.map((f) => [f.key, f.type === "stringlist" ? [] : f.type === "checkbox" ? false : ""]));
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));

  return (
    <div className="cms-form__list">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{field.label}</span>
        <button type="button" className="text-xs" onClick={() => onChange([...items, blank()])}>+ {field.itemLabel}</button>
      </div>
      {items.length === 0 ? <p className="text-xs opacity-60">Noch keine Einträge.</p> : null}
      {items.map((it, i) => (
        <div key={i} className="cms-form__item rounded-lg border border-[color:var(--color-border)] p-3 space-y-2">
          {field.itemFields.map((f) => (
            <FieldEditor key={f.key} field={f} value={it[f.key]} onChange={(v) => update(i, f.key, v)} />
          ))}
          <button type="button" className="danger text-xs" onClick={() => remove(i)}>Eintrag entfernen</button>
        </div>
      ))}
    </div>
  );
}

function StructuredForm({ schema, value, onChange }: { schema: Field[]; value: Obj; onChange: (v: Obj) => void }) {
  const setField = (key: string, v: unknown) => onChange({ ...value, [key]: v });
  return (
    <div className="cms-form space-y-3">
      {schema.map((f) =>
        f.type === "list" ? (
          <ListEditor
            key={f.key}
            field={f}
            items={Array.isArray(value[f.key]) ? (value[f.key] as Obj[]) : []}
            onChange={(items) => setField(f.key, items)}
          />
        ) : (
          <FieldEditor key={f.key} field={f} value={value[f.key]} onChange={(v) => setField(f.key, v)} />
        ),
      )}
    </div>
  );
}

function SiteEditor({ site, onBack }: { site: Site; onBack: () => void }) {
  const [blocks, setBlocks] = useState<BlockMeta[] | null>(null);
  const [sectionKey, setSectionKey] = useState("");
  const [lang, setLang] = useState("de");
  const [json, setJson] = useState("{}");
  const [value, setValue] = useState<Obj>({});
  const [mode, setMode] = useState<"form" | "json">("json");
  const [status, setStatus] = useState<string | null>(null);
  const [rebuildRepo, setRebuildRepo] = useState(site.rebuild_repo ?? "");
  const [rebuildWorkflow, setRebuildWorkflow] = useState(site.rebuild_workflow ?? "dev.yml");
  const [rebuildStatus, setRebuildStatus] = useState<string | null>(null);
  const [backfillStatus, setBackfillStatus] = useState<string | null>(null);

  const backfill = async () => {
    setBackfillStatus("Übersetzungen werden erzeugt …");
    const res = await api(`/cms/sites/${site.site_key}/translations/backfill`, { method: "POST" });
    if (res.ok) {
      const d = await res.json().catch(() => ({}));
      setBackfillStatus(`Fertig: ${d.created ?? 0} erstellt, ${d.skipped ?? 0} übersprungen.`);
      loadBlocks();
    } else if (res.status === 503) {
      setBackfillStatus("Automatische Übersetzung ist nicht konfiguriert (WEBSITE_DEEPL_API_KEY).");
    } else {
      setBackfillStatus(`Fehler (HTTP ${res.status}).`);
    }
  };

  const loadBlocks = () =>
    api(`/cms/${site.site_key}/blocks`)
      .then((r) => (r.ok ? r.json() : { blocks: [] }))
      .then((d) => setBlocks(d.blocks ?? []))
      .catch(() => setBlocks([]));

  useEffect(() => {
    loadBlocks();
  }, []);

  const setSection = (key: string) => {
    setSectionKey(key);
    // A known section opens in the structured form; others in raw JSON.
    setMode(SECTION_SCHEMAS[key] ? "form" : "json");
  };

  const openBlock = async (key: string, l: string) => {
    setSectionKey(key);
    setLang(l);
    setStatus(null);
    const res = await api(`/cms/${site.site_key}/blocks/${key}?lang=${l}`);
    const d = res.ok ? await res.json() : { value: null };
    const obj: Obj = d.value && typeof d.value === "object" && !Array.isArray(d.value) ? d.value : {};
    setValue(obj);
    setJson(JSON.stringify(obj, null, 2));
    setMode(SECTION_SCHEMAS[key] ? "form" : "json");
  };

  /** Resolve the object to save from whichever mode is active. */
  const currentValue = (): Obj | null => {
    if (mode === "form") return value;
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return null;
    }
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Obj) : null;
  };

  const toForm = () => {
    // Entering the form: seed it from the JSON text (best-effort).
    const v = currentValue();
    if (v === null) {
      setStatus("Ungültiges JSON — Formular nicht verfügbar.");
      return;
    }
    setValue(v);
    setStatus(null);
    setMode("form");
  };

  const toJson = () => {
    setJson(JSON.stringify(value, null, 2));
    setMode("json");
  };

  const save = async () => {
    if (!/^[a-z0-9_-]{1,64}$/.test(sectionKey)) {
      setStatus("Ungültiger Section-Key.");
      return;
    }
    const v = currentValue();
    if (v === null) {
      setStatus("Wert muss ein gültiges JSON-Objekt sein.");
      return;
    }
    const res = await api(`/cms/${site.site_key}/blocks/${sectionKey}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: v, lang }),
    });
    setStatus(res.ok ? "Gespeichert (Rebuild ausgelöst, falls konfiguriert)." : `Fehler (HTTP ${res.status}).`);
    if (res.ok) loadBlocks();
  };

  const saveRebuildConfig = async () => {
    const res = await api(`/cms/sites/${site.site_key}/rebuild-config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rebuild_repo: rebuildRepo.trim(), rebuild_workflow: rebuildWorkflow.trim() }),
    });
    setRebuildStatus(res.ok ? "Rebuild-Konfiguration gespeichert." : `Fehler (HTTP ${res.status}).`);
  };

  const rebuildNow = async () => {
    setRebuildStatus("Rebuild wird ausgelöst …");
    const res = await api(`/cms/sites/${site.site_key}/rebuild`, { method: "POST" });
    if (res.ok) {
      setRebuildStatus("Rebuild ausgelöst.");
    } else if (res.status === 503) {
      setRebuildStatus("Kein Rebuild-Token konfiguriert (WEBSITE_REBUILD_TOKEN).");
    } else if (res.status === 422) {
      setRebuildStatus("Für diese Website ist kein Repository hinterlegt.");
    } else {
      setRebuildStatus(`Fehler (HTTP ${res.status}).`);
    }
  };

  return (
    <div className="cms-editor">
      <button type="button" onClick={onBack}>← Websites</button>
      <h2>{site.name}</h2>

      <div className="cms-editor__blocks">
        <h3>Sektionen</h3>
        {blocks === null ? (
          <p>Wird geladen …</p>
        ) : blocks.length === 0 ? (
          <p>Noch keine Blöcke.</p>
        ) : (
          <ul>
            {blocks.map((b) => (
              <li key={`${b.section_key}-${b.lang}`}>
                <button type="button" onClick={() => openBlock(b.section_key, b.lang)}>
                  <code>{b.section_key}</code> <span className="chip chip--neutral">{b.lang}</span>
                  {b.machine_translated ? (
                    <span className="chip chip--info" title="Automatisch übersetzt">Auto</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="cms-editor__form">
        <div className="flex items-center justify-between">
          <h3>Block bearbeiten</h3>
          {SECTION_SCHEMAS[sectionKey] ? (
            <button type="button" className="text-xs" onClick={() => (mode === "form" ? toJson() : toForm())}>
              {mode === "form" ? "JSON bearbeiten" : "Formular"}
            </button>
          ) : null}
        </div>
        <div className="flex gap-2">
          <input value={sectionKey} onChange={(e) => setSection(e.target.value)} placeholder="section-key (z. B. faq)" />
          <select value={lang} onChange={(e) => setLang(e.target.value)}>
            <option value="de">de</option>
            <option value="en">en</option>
          </select>
        </div>
        {mode === "form" && SECTION_SCHEMAS[sectionKey] ? (
          <StructuredForm schema={SECTION_SCHEMAS[sectionKey]!} value={value} onChange={setValue} />
        ) : (
          <textarea
            className="cms-editor__json"
            value={json}
            onChange={(e) => setJson(e.target.value)}
            rows={14}
            spellCheck={false}
          />
        )}
        {status ? <p className="status-pill status-pill--info">{status}</p> : null}
        <button type="button" onClick={save}>Speichern</button>
      </div>

      <div className="cms-editor__translate">
        <h3>Automatische Übersetzung</h3>
        <p className="cms-editor__hint">
          Beim Speichern eines Blocks wird die Gegensprache per DeepL erzeugt (Schlüssel
          serverseitig via <code>WEBSITE_DEEPL_API_KEY</code>). Vorhandene Blöcke lassen
          sich hier nachziehen.
        </p>
        {backfillStatus ? <p className="status-pill status-pill--info">{backfillStatus}</p> : null}
        <button type="button" onClick={backfill}>Übersetzungen nachziehen</button>
      </div>

      <div className="cms-editor__rebuild">
        <h3>Rebuild-Konfiguration</h3>
        <p className="cms-editor__hint">
          Repository (<code>owner/name</code>) und Workflow-Datei, die ein Speichern neu baut.
          Der Token wird serverseitig über <code>WEBSITE_REBUILD_TOKEN</code> bereitgestellt.
        </p>
        <div className="flex gap-2">
          <input
            value={rebuildRepo}
            onChange={(e) => setRebuildRepo(e.target.value)}
            placeholder="Tracht-Digital-Solutions/tds-landingpage"
          />
          <input
            value={rebuildWorkflow}
            onChange={(e) => setRebuildWorkflow(e.target.value)}
            placeholder="dev.yml"
          />
        </div>
        {rebuildStatus ? <p className="status-pill status-pill--info">{rebuildStatus}</p> : null}
        <div className="flex gap-2">
          <button type="button" onClick={saveRebuildConfig}>Konfiguration speichern</button>
          <button type="button" onClick={rebuildNow}>Jetzt neu bauen</button>
        </div>
      </div>
    </div>
  );
}
