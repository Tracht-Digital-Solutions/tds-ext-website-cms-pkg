import { useEffect, useMemo, useState } from "react";
import { Spinner, toast } from "@tracht-digital-solutions/tds-shared/components";
import { apiFetch } from "@tracht-digital-solutions/tds-shared/api";
import { invalidate, staleClass, useCachedJson } from "@tracht-digital-solutions/tds-shared/data";
import LegalDocs from "./LegalDocs.tsx";
import {
  SECTION_SCHEMAS,
  resolvePages,
  sectionLabel,
  type Field,
  type LeafField,
  type ResolvedPage,
  type StringListField,
} from "./sections.js";

interface Site {
  id: number;
  site_key: string;
  name: string;
  /**
   * Origin of the public site whose page cache a save rebuilds.
   *
   * Separate from the rebuild pair above and not interchangeable with it: those
   * dispatch a CI build and ship code, this re-renders pages from content that
   * is already stored. Configured under Einstellungen → Website-CMS.
   */
  cache_url?: string | null;
  updated_at: string;
}

interface BlockMeta {
  section_key: string;
  lang: string;
  machine_translated?: number | boolean;
  updated_at: string;
}

const api = apiFetch;

/**
 * Website-CMS — the CONTENT screen: pick a website, pick a page, edit its
 * sections.
 *
 * ### What is deliberately NOT here any more
 *
 * Adding a website, and configuring where its rebuild and its page cache point,
 * moved to **Einstellungen → Website-CMS** (`SiteRegistry.tsx`). Those are
 * things you do once when a site is connected; they were sitting on the daily
 * editing screen, above the content, where connection fields are noise at best
 * and an invitation to break a working site at
 * worst. This screen now answers exactly one question: which words go on which
 * page.
 *
 * ### Stale-while-revalidate
 *
 * Every read goes through `useCachedJson`, so coming back to this screen paints
 * the site list and the page list instantly from the last visit and refreshes
 * them behind the user. While that refresh is in flight the affected list wears
 * `tds-stale` — dimmed and pulsing — because data that may already be wrong
 * must never be presented as current.
 */
export default function SitesList() {
  const sitesQuery = useCachedJson<{ sites: Site[] }>("/cms/sites");
  const sites = sitesQuery.data?.sites ?? [];
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const sitesVisiblyStale =
    sitesQuery.stale || (sitesQuery.error !== null && sitesQuery.data !== undefined);

  // Follow the registry: a site that disappears (or the very first one to
  // arrive) must not leave the screen pointing at nothing.
  useEffect(() => {
    if (sites.length === 0) {
      if (selectedKey !== null) setSelectedKey(null);
      return;
    }
    if (selectedKey === null || !sites.some((s) => s.site_key === selectedKey)) {
      setSelectedKey(sites[0]?.site_key ?? null);
    }
  }, [sites, selectedKey]);

  const selected = sites.find((s) => s.site_key === selectedKey) ?? null;

  if (sitesQuery.loading) {
    return (
      <p>
        <Spinner />
      </p>
    );
  }

  if (sitesQuery.error && sites.length === 0) {
    return (
      <p className="tds-alert tds-alert--danger" role="alert">
        Websites konnten nicht geladen werden ({sitesQuery.error.message}).
      </p>
    );
  }

  if (sites.length === 0) {
    return (
      <div className="tds-empty">
        <p>Noch keine Website verbunden.</p>
        <p className="marginalia">
          Websites werden unter <a className="link-underline" href="/einstellungen">Einstellungen → Website-CMS</a>{" "}
          hinzugefügt. Dort liegt auch, wohin ein Speichern den Seiten-Cache schickt.
        </p>
      </div>
    );
  }

  return (
    <div
      className={staleClass(sitesVisiblyStale, "cms-sites tds-stack")}
      aria-busy={sitesVisiblyStale}
    >
      {sitesQuery.error ? (
        <p className="tds-alert tds-alert--danger" role="alert">
          Websites konnten nicht aktualisiert werden ({sitesQuery.error.message}). Die angezeigten
          Daten sind möglicherweise veraltet.
        </p>
      ) : null}
      {/* One site is the overwhelmingly common case, so the picker only earns
          its space when there is a choice to make. */}
      {sites.length > 1 ? (
        <div
          className="tds-toolbar"
          role="group"
          aria-label="Website wählen"
        >
          {sites.map((s) => (
            <button
              key={s.id}
              type="button"
              className={s.site_key === selectedKey ? "chip chip--info" : "chip chip--neutral"}
              aria-pressed={s.site_key === selectedKey}
              onClick={() => setSelectedKey(s.site_key)}
            >
              {s.name}
            </button>
          ))}
        </div>
      ) : null}

      {selected ? <SiteEditor site={selected} /> : null}
    </div>
  );
}

// --- structured section forms ----------------------------------------------
// Known section shapes render typed fields (text/textarea/number/checkbox,
// repeatable object lists, and string lists) instead of raw JSON. Anything not
// in SECTION_SCHEMAS falls back to the JSON editor, and a Form/JSON toggle is
// always available. The schemas themselves live in `sections.ts`, next to the
// page model that decides where each section is shown.

type Obj = Record<string, unknown>;

/** A single typed leaf input; emits the correctly-typed value (string/number/bool). */
function LeafInput({
  field,
  value,
  onChange,
}: {
  field: LeafField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (field.type === "checkbox") {
    return (
      <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
    );
  }
  if (field.type === "number") {
    return (
      <input
        className="field-boxed"
        type="number"
        value={value === undefined || value === null || value === "" ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      />
    );
  }
  if (field.type === "textarea") {
    return (
      <textarea
        className="field-boxed"
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
      />
    );
  }
  return (
    <input className="field-boxed" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
  );
}

/** Editor for an array of plain strings (e.g. pricing `includes` / `notes`). */
function StringListEditor({
  field,
  items,
  onChange,
}: {
  field: StringListField;
  items: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="cms-form__stringlist">
      <div className="flex items-center justify-between">
        <span className="text-sm">{field.label}</span>
        <button
          type="button"
          className="btn btn-ghost text-xs"
          onClick={() => onChange([...items, ""])}
        >
          + {field.itemLabel}
        </button>
      </div>
      {items.map((s, i) => (
        <div key={i} className="flex flex-wrap gap-2">
          <input
            className="field-boxed"
            value={s}
            onChange={(e) => onChange(items.map((v, idx) => (idx === i ? e.target.value : v)))}
          />
          <button
            type="button"
            className="btn btn-danger text-xs"
            onClick={() => onChange(items.filter((_, idx) => idx !== i))}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

/** Render one field (leaf / string-list / object-list) bound to `value[field.key]`. */
function FieldEditor({
  field,
  value,
  onChange,
}: {
  field: LeafField | StringListField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
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

function ListEditor({
  field,
  items,
  onChange,
}: {
  field: Extract<Field, { type: "list" }>;
  items: Obj[];
  onChange: (items: Obj[]) => void;
}) {
  const update = (i: number, key: string, v: unknown) =>
    onChange(items.map((it, idx) => (idx === i ? { ...it, [key]: v } : it)));
  const blank = (): Obj =>
    Object.fromEntries(
      field.itemFields.map((f) => [
        f.key,
        f.type === "stringlist" ? [] : f.type === "checkbox" ? false : f.type === "number" ? null : "",
      ]),
    );
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));

  return (
    <div className="tds-stack">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{field.label}</span>
        <button
          type="button"
          className="btn btn-ghost text-xs"
          onClick={() => onChange([...items, blank()])}
        >
          + {field.itemLabel}
        </button>
      </div>
      {items.length === 0 ? <p className="text-xs opacity-60">Noch keine Einträge.</p> : null}
      {items.map((it, i) => (
        <div key={i} className="tds-card tds-stack tds-stack--tight p-3">
          {field.itemFields.map((f) => (
            <FieldEditor key={f.key} field={f} value={it[f.key]} onChange={(v) => update(i, f.key, v)} />
          ))}
          <button type="button" className="btn btn-danger text-xs" onClick={() => remove(i)}>
            Eintrag entfernen
          </button>
        </div>
      ))}
    </div>
  );
}

function StructuredForm({
  schema,
  value,
  onChange,
}: {
  schema: Field[];
  value: Obj;
  onChange: (v: Obj) => void;
}) {
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

/** The pages and sections of one site, plus the editor for the chosen section. */
function SiteEditor({ site }: { site: Site }) {
  const blocksQuery = useCachedJson<{ blocks: BlockMeta[] }>(`/cms/${site.site_key}/blocks`);
  const blocks = useMemo(() => blocksQuery.data?.blocks ?? [], [blocksQuery.data]);

  const [pageId, setPageId] = useState<string | null>(null);
  const [sectionKey, setSectionKey] = useState<string | null>(null);
  const [lang, setLang] = useState<"de" | "en">("de");
  const [backfillStatus, setBackfillStatus] = useState<string | null>(null);
  const blocksVisiblyStale =
    blocksQuery.stale || (blocksQuery.error !== null && blocksQuery.data !== undefined);

  // Which section keys this site actually has, in a stable order.
  const sectionKeys = useMemo(
    () => [...new Set(blocks.map((b) => b.section_key))],
    [blocks],
  );
  const pages = useMemo(() => resolvePages(sectionKeys), [sectionKeys]);

  useEffect(() => {
    if (pages.length === 0) {
      if (pageId !== null) setPageId(null);
      return;
    }
    if (pageId === null || !pages.some((p) => p.id === pageId)) {
      setPageId(pages[0]?.id ?? null);
    }
  }, [pages, pageId]);

  const page = pages.find((p) => p.id === pageId) ?? null;

  const isMachine = (key: string, l: string): boolean =>
    Boolean(blocks.find((b) => b.section_key === key && b.lang === l)?.machine_translated);

  const isStored = (key: string, l: string): boolean =>
    blocks.some((b) => b.section_key === key && b.lang === l);

  const backfill = async () => {
    setBackfillStatus("Übersetzungen werden erzeugt …");
    let res: Response;
    try {
      res = await api(`/cms/sites/${site.site_key}/translations/backfill`, { method: "POST" });
    } catch {
      setBackfillStatus(null);
      toast.danger("Übersetzungslauf fehlgeschlagen (Netzwerkfehler).");
      return;
    }
    if (res.ok) {
      const d = (await res.json().catch(() => ({}))) as {
        created?: number;
        skipped?: number;
        cached?: boolean;
      };
      setBackfillStatus(null);
      const created = d.created ?? 0;
      const cacheResult =
        created === 0
          ? ""
          : d.cached === true
            ? " Cache-Neubau für die betroffenen Seiten wurde angestoßen."
            : " Der Seiten-Cache konnte nicht angestoßen werden.";
      toast.success(`Fertig: ${created} erstellt, ${d.skipped ?? 0} übersprungen.${cacheResult}`);
      invalidate(`/cms/${site.site_key}/`);
    } else if (res.status === 503) {
      setBackfillStatus("Automatische Übersetzung ist nicht konfiguriert (Einstellungen → Website-CMS).");
    } else {
      setBackfillStatus(null);
      toast.danger(`Übersetzungslauf fehlgeschlagen (HTTP ${res.status}).`);
    }
  };

  return (
    <div className="cms-editor tds-stack">
      {blocksQuery.error ? (
        <p className="tds-alert tds-alert--danger" role="alert">
          Inhalte konnten nicht aktualisiert werden ({blocksQuery.error.message}).
          {blocks.length > 0 ? " Die angezeigten Daten sind möglicherweise veraltet." : ""}
        </p>
      ) : null}

      {blocksQuery.loading ? (
        <p>
          <Spinner />
        </p>
      ) : (
        <>
          {blocks.length === 0 && !blocksQuery.error ? (
            <p className="tds-alert">
              Noch keine eigenen Inhalte gespeichert. Die öffentliche Website verwendet ihre
              eingebauten Vorgaben; jeder Abschnitt kann hier erstmals angelegt werden.
            </p>
          ) : null}
          <nav
            className={staleClass(blocksVisiblyStale, "tds-toolbar")}
            aria-busy={blocksVisiblyStale}
            aria-label="Seite wählen"
          >
            {pages.map((p) => (
              <button
                key={p.id}
                type="button"
                className={p.id === pageId ? "chip chip--info" : "chip chip--neutral"}
                aria-pressed={p.id === pageId}
                onClick={() => {
                  setPageId(p.id);
                  setSectionKey(null);
                }}
              >
                {p.label}
              </button>
            ))}
          </nav>

          {page ? (
            <PageSections
              page={page}
              stale={blocksVisiblyStale}
              activeSection={sectionKey}
              activeLang={lang}
              isMachine={isMachine}
              isStored={isStored}
              onPick={(key, l) => {
                setSectionKey(key);
                setLang(l);
              }}
            />
          ) : null}

          {page && sectionKey ? (
            <BlockEditor
              siteKey={site.site_key}
              sectionKey={sectionKey}
              lang={lang}
              onLangChange={setLang}
              cacheConfigured={Boolean((site.cache_url ?? "").trim())}
            />
          ) : (
            <p className="marginalia">Einen Abschnitt wählen, um ihn zu bearbeiten.</p>
          )}
        </>
      )}

      {/* The legal PDFs belong to the same site and are edited here rather than
          in Einstellungen: an uploaded AGB is content, not configuration. */}
      <LegalDocs siteKey={site.site_key} />

      <div className="cms-editor__translate">
        <h3>Automatische Übersetzung</h3>
        <p className="marginalia">
          Beim Speichern eines Abschnitts wird die Gegensprache per DeepL erzeugt (Schlüssel
          unter Einstellungen → Website-CMS). Vorhandene Abschnitte lassen sich hier nachziehen.
        </p>
        {backfillStatus ? (
          <p className="tds-alert" role="status">
            {backfillStatus}
          </p>
        ) : null}
        <button className="btn btn-primary" type="button" onClick={backfill}>
          Übersetzungen nachziehen
        </button>
      </div>
    </div>
  );
}

/** The sections of one page, each with the languages it exists in. */
function PageSections({
  page,
  stale,
  activeSection,
  activeLang,
  isMachine,
  isStored,
  onPick,
}: {
  page: ResolvedPage;
  stale: boolean;
  activeSection: string | null;
  activeLang: "de" | "en";
  isMachine: (key: string, lang: string) => boolean;
  isStored: (key: string, lang: string) => boolean;
  onPick: (key: string, lang: "de" | "en") => void;
}) {
  return (
    <div className={staleClass(stale, "tds-card tds-stack")} aria-busy={stale}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3>{page.label}</h3>
        {/* Public paths, so nobody has to guess which localized page they are
            editing. Blank for the leftovers bucket, which is not a page. */}
        {page.path ? (
          page.pathEn ? (
            <span className="flex flex-wrap items-center justify-end gap-2">
              <code className="text-xs opacity-70">DE {page.path}</code>
              <code className="text-xs opacity-70">EN {page.pathEn}</code>
            </span>
          ) : (
            <code className="text-xs opacity-70">{page.path}</code>
          )
        ) : null}
      </div>
      <ul className="tds-list">
        {page.present.map((key) => (
          <li key={key} className="tds-list__row">
            <span className="flex flex-wrap items-center gap-2">
              <strong>{sectionLabel(key)}</strong>
              <code className="text-xs opacity-70">{key}</code>
            </span>
            <span className="flex flex-wrap items-center gap-1">
              {(["de", "en"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  className={
                    activeSection === key && activeLang === l
                      ? "btn btn-primary text-xs"
                      : "btn btn-ghost text-xs"
                  }
                  onClick={() => onPick(key, l === "en" ? "en" : "de")}
                >
                  {l.toUpperCase()}
                  {isMachine(key, l) ? " · auto" : !isStored(key, l) ? " · Vorgabe" : ""}
                </button>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Load, edit and save one block; a save re-renders only the pages it affects. */
function BlockEditor({
  siteKey,
  sectionKey,
  lang,
  onLangChange,
  cacheConfigured,
}: {
  siteKey: string;
  sectionKey: string;
  lang: "de" | "en";
  onLangChange: (lang: "de" | "en") => void;
  cacheConfigured: boolean;
}) {
  const path = `/cms/${siteKey}/blocks/${sectionKey}?lang=${lang}`;
  const blockQuery = useCachedJson<{ value: unknown }>(path);

  const [value, setValue] = useState<Obj>({});
  const [json, setJson] = useState("{}");
  const [mode, setMode] = useState<"form" | "json">("form");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [seededPath, setSeededPath] = useState<string | null>(null);
  // Which loaded document the form was seeded from. A background SWR answer
  // may refresh an untouched form, but it must never discard half-typed edits.
  const [seededFrom, setSeededFrom] = useState<string | null>(null);

  const schema = SECTION_SCHEMAS[sectionKey];
  const blockVisiblyStale =
    blockQuery.stale || (blockQuery.error !== null && blockQuery.data !== undefined);

  useEffect(() => {
    if (blockQuery.data === undefined) return;
    const raw = blockQuery.data.value;
    const obj: Obj = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Obj) : {};
    const signature = `${path}::${JSON.stringify(obj)}`;
    const pathChanged = seededPath !== path;
    if (!pathChanged && (dirty || signature === seededFrom)) return;
    setValue(obj);
    setJson(JSON.stringify(obj, null, 2));
    setMode(schema ? "form" : "json");
    setStatus(null);
    setDirty(false);
    setSeededPath(path);
    setSeededFrom(signature);
  }, [blockQuery.data, dirty, path, schema, seededFrom, seededPath]);

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
    const v = currentValue();
    if (v === null) {
      setStatus("Wert muss ein gültiges JSON-Objekt sein.");
      return;
    }
    setBusy(true);
    let res: Response;
    try {
      res = await api(`/cms/${siteKey}/blocks/${sectionKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: v, lang }),
      });
    } catch {
      setBusy(false);
      toast.danger("Speichern fehlgeschlagen (Netzwerkfehler). Der Inhalt wurde nicht bestätigt.");
      return;
    }
    setBusy(false);
    if (!res.ok) {
      // Never swallow the status: it is what tells "session expired" from
      // "service down" apart in a bug report.
      toast.danger(`Speichern fehlgeschlagen (HTTP ${res.status}).`);
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { cached?: boolean };
    // The API reports whether a page-cache rebuild really went out. Saying
    // "wird neu gebaut" on a site with no cache URL would be a success message
    // for a request nobody sent.
    toast.success(
      body.cached === true
        ? "Gespeichert. Der Cache-Neubau für die betroffenen Seiten wurde angestoßen."
        : cacheConfigured
          ? "Gespeichert. Der Seiten-Cache konnte nicht angestoßen werden."
          : "Gespeichert. Für diese Website ist kein Seiten-Cache hinterlegt.",
    );
    // Drop this site's cached reads so the section list picks up the new
    // timestamp and the auto-translation flag.
    invalidate(`/cms/${siteKey}/`);
    setValue(v);
    setJson(JSON.stringify(v, null, 2));
    setDirty(false);
    setSeededPath(path);
    setSeededFrom(`${path}::${JSON.stringify(v)}`);
  };

  return (
    <div className="tds-card tds-stack">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3>
          {sectionLabel(sectionKey)} <code className="text-xs opacity-70">{sectionKey}</code>
        </h3>
        <span className="flex flex-wrap items-center gap-2">
          <select
            className="field-boxed"
            aria-label="Sprache des Abschnitts"
            value={lang}
            onChange={(e) => onLangChange(e.target.value === "en" ? "en" : "de")}
          >
            <option value="de">de</option>
            <option value="en">en</option>
          </select>
          {schema ? (
            <button
              type="button"
              className="btn btn-ghost text-xs"
              onClick={() => (mode === "form" ? toJson() : toForm())}
            >
              {mode === "form" ? "JSON bearbeiten" : "Formular"}
            </button>
          ) : null}
        </span>
      </div>

      {blockQuery.loading ? (
        <p>
          <Spinner />
        </p>
      ) : (
        <div className={staleClass(blockVisiblyStale)} aria-busy={blockVisiblyStale}>
          {blockQuery.data?.value === null ? (
            <p className="marginalia">
              Für {lang.toUpperCase()} ist noch kein eigener Inhalt gespeichert; die Website
              verwendet ihre eingebaute Vorgabe.
            </p>
          ) : null}
          {mode === "form" && schema ? (
            <StructuredForm
              schema={schema}
              value={value}
              onChange={(next) => {
                setValue(next);
                setDirty(true);
              }}
            />
          ) : (
            <textarea
              className="field-boxed"
              aria-label="JSON"
              value={json}
              onChange={(e) => {
                setJson(e.target.value);
                setDirty(true);
              }}
              rows={14}
              spellCheck={false}
            />
          )}
        </div>
      )}

      {blockQuery.error ? (
        <p className="tds-alert tds-alert--danger" role="alert">
          Abschnitt konnte nicht geladen werden ({blockQuery.error.message}).
        </p>
      ) : null}
      {/* Validation only here — outcomes are toasts. */}
      {status ? (
        <p className="tds-alert tds-alert--danger" role="alert">
          {status}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn btn-primary"
          type="button"
          onClick={save}
          disabled={busy || blockQuery.loading || blockQuery.data === undefined}
        >
          {busy ? <Spinner size="sm" /> : "Speichern"}
        </button>
        <span className="marginalia">
          Speichern baut nur die betroffenen Seiten neu, nicht die ganze Website.
        </span>
      </div>
    </div>
  );
}
