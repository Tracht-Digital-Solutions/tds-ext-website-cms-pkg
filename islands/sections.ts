/**
 * The editable shape of a managed website: which PAGES it has, which sections
 * each page shows, and what a section's fields are called.
 *
 * ### Why a page model exists at all
 *
 * The database knows only `(site, section_key, lang)` — a flat list of blocks.
 * That is the right storage shape and a hopeless editing surface: an operator
 * asked to fix a sentence on the pricing page has to know that the sentence
 * lives in a block called `pricing`, and nothing anywhere told them so. The
 * CMS screen therefore groups blocks into the pages a visitor actually sees.
 *
 * ### A section may appear on more than one page, and that is not a bug
 *
 * `footer` and `contact` are rendered on every page; `pricing` is rendered by
 * `/preise` *and* by the teaser on the home page. Listing a section under each
 * page it appears on is the honest presentation — there is still exactly one
 * block behind it, so editing it from either place edits the same row. The
 * public site's own cache route table makes the same over-approximation for
 * the same reason (`tds-landingpage-frontend/src/lib/cache.ts`).
 *
 * ### It is a description of the primary consumer, not a schema
 *
 * `cms_site` is a 1:n registry and a second site will not have these pages.
 * So this is a *map*, never a *filter*: any section key the API returns that
 * no page claims is still listed and still editable, under "Weitere
 * Abschnitte". Adding a site must never make its content unreachable because
 * nobody updated a table in a frontend package.
 */

export type LeafType = "text" | "textarea" | "number" | "checkbox";
export type LeafField = { key: string; label: string; type: LeafType };
export type StringListField = {
  key: string;
  label: string;
  type: "stringlist";
  itemLabel: string;
};
export type ObjectListField = {
  key: string;
  label: string;
  type: "list";
  itemLabel: string;
  itemFields: (LeafField | StringListField)[];
};
export type Field = LeafField | StringListField | ObjectListField;

/**
 * Stable content-block keys for the six landing-page services.
 *
 * The public site owns service IDs, slugs and route lookup. Keeping those
 * values out of the editable schema means an editorial change can never break
 * a public URL; only visitor-facing copy belongs in these blocks.
 */
export const SERVICE_SECTION_KEYS = [
  "service_consulting",
  "service_process",
  "service_solutions",
  "service_custom_development",
  "service_web_presence",
  "service_complete_it",
] as const;

export type ServiceSectionKey = (typeof SERVICE_SECTION_KEYS)[number];

/** Every service page has the same deliberately shallow editing contract. */
function serviceDetailSchema(): Field[] {
  return [
    { key: "label", label: "Label", type: "text" },
    { key: "title", label: "Leistungsname", type: "text" },
    { key: "summary", label: "Kurzbeschreibung", type: "textarea" },
    { key: "intro", label: "Einleitung", type: "textarea" },
    { key: "situationsTitle", label: "Ausgangslagen – Überschrift", type: "text" },
    {
      key: "situations",
      label: "Typische Ausgangslagen",
      type: "stringlist",
      itemLabel: "Ausgangslage",
    },
    { key: "responsibilitiesTitle", label: "Leistungsumfang – Überschrift", type: "text" },
    {
      key: "responsibilities",
      label: "Was übernommen wird",
      type: "stringlist",
      itemLabel: "Aufgabe",
    },
    { key: "outcomesTitle", label: "Ergebnisse – Überschrift", type: "text" },
    {
      key: "outcomes",
      label: "Erwartbare Ergebnisse",
      type: "stringlist",
      itemLabel: "Ergebnis",
    },
    { key: "boundariesTitle", label: "Abgrenzung – Überschrift", type: "text" },
    {
      key: "boundaries",
      label: "Abgrenzungen und Grenzen",
      type: "stringlist",
      itemLabel: "Abgrenzung",
    },
    { key: "processTitle", label: "Vorgehen – Überschrift", type: "text" },
    {
      key: "process",
      label: "Vorgehen",
      type: "stringlist",
      itemLabel: "Schritt",
    },
    { key: "priceLabel", label: "Preis-Label", type: "text" },
    { key: "priceText", label: "Preiserklärung", type: "textarea" },
    { key: "referencesLabel", label: "Referenzen – Label", type: "text" },
    { key: "referencesHeadline", label: "Referenzen – Überschrift", type: "text" },
    {
      key: "references",
      label: "Anonymisierte Referenzen",
      type: "list",
      itemLabel: "Referenz",
      itemFields: [
        { key: "title", label: "Neutraler Titel", type: "text" },
        { key: "context", label: "Branche oder Unternehmenskontext", type: "textarea" },
        { key: "challenge", label: "Ausgangslage", type: "textarea" },
        { key: "solution", label: "Lösungsweg", type: "textarea" },
        { key: "result", label: "Ergebnis", type: "textarea" },
        { key: "metric", label: "Belegbare Kennzahl (optional)", type: "text" },
      ],
    },
    { key: "ctaTitle", label: "CTA – Überschrift", type: "text" },
    { key: "ctaText", label: "CTA – Text", type: "textarea" },
    { key: "ctaButton", label: "CTA – Button", type: "text" },
  ];
}

/** FAQ v2 changes its content namespace, not the editor contract. */
function faqSchema(): Field[] {
  return [
    { key: "label", label: "Label", type: "text" },
    { key: "headline", label: "Überschrift", type: "text" },
    {
      key: "items",
      label: "Fragen",
      type: "list",
      itemLabel: "Frage",
      itemFields: [
        { key: "q", label: "Frage", type: "text" },
        { key: "a", label: "Antwort", type: "textarea" },
      ],
    },
  ];
}

// Shapes match the tds-landingpage section defaults (the primary consumer). A
// structured form only renders the fields listed here; any other keys in the
// block survive untouched (the form spreads them), so a partial schema is safe.
export const SECTION_SCHEMAS: Record<string, Field[]> = {
  home_hero: [
    { key: "headline", label: "Überschrift", type: "text" },
    { key: "headlineAccent", label: "Überschrift (Akzent)", type: "text" },
    { key: "headlineSuffix", label: "Überschrift (Suffix)", type: "text" },
    { key: "sub", label: "Untertext", type: "textarea" },
    { key: "cta1", label: "Button 1", type: "text" },
    { key: "cta2", label: "Button 2", type: "text" },
    { key: "scrollHint", label: "Scroll-Hinweis", type: "text" },
  ],
  why_me: [
    { key: "headline", label: "Überschrift", type: "text" },
    { key: "headlineAccent", label: "Überschrift (Akzent)", type: "text" },
    { key: "lead", label: "Lead", type: "textarea" },
    { key: "p1", label: "Absatz 1", type: "textarea" },
    { key: "p2", label: "Absatz 2", type: "textarea" },
    {
      key: "reasons",
      label: "Gründe",
      type: "list",
      itemLabel: "Grund",
      itemFields: [
        { key: "title", label: "Titel", type: "text" },
        { key: "description", label: "Beschreibung", type: "textarea" },
      ],
    },
  ],
  services_overview: [
    { key: "headline", label: "Überschrift", type: "text" },
    { key: "headlineAccent", label: "Überschrift (Akzent)", type: "text" },
    { key: "intro", label: "Einleitung", type: "textarea" },
  ],
  digital_responsibility: [
    { key: "headline", label: "Überschrift", type: "text" },
    { key: "headlineAccent", label: "Überschrift (Akzent)", type: "text" },
    { key: "body", label: "Text", type: "textarea" },
    {
      key: "points",
      label: "Verantwortungsbereiche",
      type: "stringlist",
      itemLabel: "Punkt",
    },
    { key: "primaryCta", label: "Button (primär)", type: "text" },
    { key: "secondaryCta", label: "Button (sekundär)", type: "text" },
  ],
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
    {
      key: "items",
      label: "Leistungen",
      type: "list",
      itemLabel: "Leistung",
      itemFields: [
        { key: "number", label: "Nummer", type: "text" },
        { key: "title", label: "Titel", type: "text" },
        { key: "description", label: "Beschreibung", type: "textarea" },
      ],
    },
  ],
  service_consulting: serviceDetailSchema(),
  service_process: serviceDetailSchema(),
  service_solutions: serviceDetailSchema(),
  service_custom_development: serviceDetailSchema(),
  service_web_presence: serviceDetailSchema(),
  service_complete_it: serviceDetailSchema(),
  faq: faqSchema(),
  faq_v2: faqSchema(),
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
    {
      key: "steps",
      label: "Schritte",
      type: "list",
      itemLabel: "Schritt",
      itemFields: [
        { key: "number", label: "Nummer", type: "text" },
        { key: "title", label: "Titel", type: "text" },
        { key: "duration", label: "Dauer", type: "text" },
        { key: "description", label: "Beschreibung", type: "textarea" },
        { key: "detail", label: "Detail", type: "textarea" },
        { key: "outcome", label: "Ergebnis", type: "textarea" },
      ],
    },
  ],
  consulting: [
    { key: "label", label: "Label", type: "text" },
    { key: "headline", label: "Überschrift", type: "text" },
    { key: "headlineAccent", label: "Überschrift (Akzent)", type: "text" },
    { key: "body", label: "Text", type: "textarea" },
    { key: "primaryCta", label: "Button (primär)", type: "text" },
    { key: "secondaryCta", label: "Button (sekundär)", type: "text" },
  ],
  journal: [
    {
      key: "slugs",
      label: "Ausgewählte Blogbeiträge",
      type: "stringlist",
      itemLabel: "Slug",
    },
  ],
  cookie_banner: [
    { key: "enabled", label: "Cookie-Hinweis anzeigen", type: "checkbox" },
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
    {
      key: "items",
      label: "Pakete",
      type: "list",
      itemLabel: "Paket",
      itemFields: [
        { key: "title", label: "Titel", type: "text" },
        { key: "rate", label: "Stundensatz (€)", type: "number" },
        { key: "description", label: "Beschreibung", type: "textarea" },
        { key: "includes", label: "Beinhaltet", type: "stringlist", itemLabel: "Punkt" },
        { key: "highlight", label: "Hervorheben", type: "checkbox" },
      ],
    },
    { key: "notesTitle", label: "Hinweise-Titel", type: "text" },
    { key: "notes", label: "Hinweise", type: "stringlist", itemLabel: "Hinweis" },
    { key: "ctaTitle", label: "CTA-Titel", type: "text" },
    { key: "ctaSub", label: "CTA-Untertext", type: "textarea" },
    { key: "ctaButton", label: "CTA-Button", type: "text" },
    { key: "back", label: "Zurück-Label", type: "text" },
  ],
  pricing_services: [
    { key: "label", label: "Label", type: "text" },
    { key: "headline", label: "Überschrift", type: "text" },
    { key: "headlineAccent", label: "Überschrift (Akzent)", type: "text" },
    { key: "sub", label: "Untertext", type: "textarea" },
    { key: "teaserHeadline", label: "Teaser-Überschrift", type: "text" },
    { key: "teaserHeadlineAccent", label: "Teaser-Überschrift (Akzent)", type: "text" },
    { key: "teaserSub", label: "Teaser-Untertext", type: "textarea" },
    { key: "teaserCta", label: "Teaser-Button", type: "text" },
    { key: "teaserFromLabel", label: "„ab“-Label", type: "text" },
    { key: "hourSuffix", label: "Stunden-Suffix", type: "text" },
    { key: "customRateLabel", label: "Individueller Preis – Label", type: "text" },
    { key: "includesLabel", label: "„Beinhaltet“-Label", type: "text" },
    { key: "rateConsulting", label: "Beratung & Konzeption – Stundensatz (€)", type: "number" },
    { key: "rateProcess", label: "Prozessoptimierung – Stundensatz (€)", type: "number" },
    { key: "rateSolutions", label: "Individuelle Lösungen – Stundensatz (€)", type: "number" },
    {
      key: "rateCustomDevelopment",
      label: "Auftragsprogrammierung – Stundensatz (€)",
      type: "number",
    },
    { key: "rateWebPresence", label: "Webauftritt – Stundensatz (€)", type: "number" },
    { key: "notesTitle", label: "Hinweise-Titel", type: "text" },
    { key: "notes", label: "Hinweise", type: "stringlist", itemLabel: "Hinweis" },
    { key: "ctaTitle", label: "CTA-Titel", type: "text" },
    { key: "ctaSub", label: "CTA-Untertext", type: "textarea" },
    { key: "ctaButton", label: "CTA-Button", type: "text" },
    { key: "back", label: "Zurück-Label", type: "text" },
  ],
  // The legal pages. One markdown field rather than a structured schema:
  // headings and lists are part of the text here, not a form somebody should
  // have to fill in section by section. Leaving a block empty keeps the version
  // committed in the site's repository — for a legal page that fallback is the
  // point, since a silently blank privacy notice is worse than a stale one.
  legal_impressum: [{ key: "markdown", label: "Impressum (Markdown)", type: "textarea" }],
  legal_datenschutz: [{ key: "markdown", label: "Datenschutzerklärung (Markdown)", type: "textarea" }],
};

/**
 * German names for the section keys.
 *
 * The key itself is shown alongside, not replaced by, the label: it is what the
 * API, the cache event and every log line call the thing, so hiding it would
 * make a support conversation impossible.
 */
export const SECTION_LABELS: Record<string, string> = {
  home_hero: "Startseite: Titelbereich",
  why_me: "Wieso ich?",
  services_overview: "Was ich anbiete?",
  digital_responsibility: "Digitalisierungsverantwortung",
  hero: "Titelbereich",
  about: "Über mich",
  services: "Leistungen",
  service_consulting: "Leistung: Beratung & Konzeption",
  service_process: "Leistung: Prozessoptimierung",
  service_solutions: "Leistung: Individuelle Lösungen",
  service_custom_development: "Leistung: Auftragsprogrammierung",
  service_web_presence: "Leistung: Webauftritt",
  service_complete_it: "Leistung: Komplette IT",
  process: "Ablauf",
  consulting: "Beratung",
  journal: "Journal-Auswahl",
  faq: "Häufige Fragen",
  faq_v2: "Häufige Fragen",
  contact: "Kontakt",
  footer: "Fußzeile",
  pricing: "Preise",
  pricing_services: "Preise nach Leistung",
  cookie_banner: "Cookie-Hinweis",
  legal_impressum: "Impressum (Text)",
  legal_datenschutz: "Datenschutzerklärung (Text)",
};

/** One page of a managed website, as the editor presents it. */
export interface PageDef {
  id: string;
  label: string;
  /** The German public path, shown so an operator can check what they are editing. */
  path: string;
  /** The English path when it differs structurally from the German one. */
  pathEn?: string;
  /** Sections this page renders, in the order they appear on it. */
  sections: string[];
}

/**
 * The pages of the primary consumer (`tracht-digital.de`).
 *
 * Ordered as a visitor meets them. `legal_*` sit on their own pages rather than
 * on the home page — the same split the site's cache route table makes, and for
 * the same reason: saving the Impressum must not re-render the whole site.
 */
export const PAGES: PageDef[] = [
  {
    id: "startseite",
    label: "Startseite",
    path: "/",
    sections: [
      "home_hero",
      "why_me",
      "services_overview",
      ...SERVICE_SECTION_KEYS,
      "digital_responsibility",
      "process",
      "pricing_services",
      "journal",
      "faq_v2",
      "contact",
      "cookie_banner",
      "footer",
    ],
  },
  {
    id: "preise",
    label: "Preise",
    path: "/preise",
    sections: ["pricing_services", ...SERVICE_SECTION_KEYS, "contact", "footer"],
  },
  {
    id: "leistung_beratung_konzeption",
    label: "Leistung: Beratung & Konzeption",
    path: "/leistungen/beratung-konzeption",
    pathEn: "/en/services/consulting-planning",
    sections: ["service_consulting", "contact", "footer"],
  },
  {
    id: "leistung_prozessoptimierung",
    label: "Leistung: Prozessoptimierung",
    path: "/leistungen/prozessoptimierung",
    pathEn: "/en/services/process-optimization",
    sections: ["service_process", "contact", "footer"],
  },
  {
    id: "leistung_individuelle_loesungen",
    label: "Leistung: Individuelle Lösungen",
    path: "/leistungen/individuelle-loesungen",
    pathEn: "/en/services/tailored-solutions",
    sections: ["service_solutions", "contact", "footer"],
  },
  {
    id: "leistung_auftragsprogrammierung",
    label: "Leistung: Auftragsprogrammierung",
    path: "/leistungen/auftragsprogrammierung",
    pathEn: "/en/services/contract-development",
    sections: ["service_custom_development", "contact", "footer"],
  },
  {
    id: "leistung_webauftritt",
    label: "Leistung: Webauftritt",
    path: "/leistungen/webauftritt",
    pathEn: "/en/services/web-presence",
    sections: ["service_web_presence", "contact", "footer"],
  },
  {
    id: "leistung_komplette_it",
    label: "Leistung: Komplette IT",
    path: "/leistungen/komplette-it",
    pathEn: "/en/services/complete-it",
    sections: ["service_complete_it", "contact", "footer"],
  },
  { id: "impressum", label: "Impressum", path: "/legal/impressum", sections: ["legal_impressum"] },
  {
    id: "datenschutz",
    label: "Datenschutz",
    path: "/legal/datenschutz",
    sections: ["legal_datenschutz"],
  },
];

/** The bucket every unmapped section falls into. */
export const OTHER_PAGE_ID = "weitere";

/** A page as the editor renders it, including not-yet-overridden sections. */
export interface ResolvedPage extends PageDef {
  /** Section keys offered on this page, in render order. */
  present: string[];
}

/**
 * Group a site's section keys into pages.
 *
 * Two rules, both of which exist to keep content reachable:
 *
 *  - known pages and sections are always offered, even before an override row
 *    exists — otherwise a newly registered site could never create its first
 *    block, and a missing language could never be authored by hand;
 *  - a stored section no page claims lands in "Weitere Abschnitte", so a second
 *    managed site's content is editable on day one without anyone editing this
 *    file. That is the difference between a map and a filter.
 */
export function resolvePages(sectionKeys: readonly string[]): ResolvedPage[] {
  const available = new Set(sectionKeys);
  const claimed = new Set<string>();
  const pages: ResolvedPage[] = PAGES.map((page) => {
    for (const key of page.sections) claimed.add(key);
    return { ...page, present: [...page.sections] };
  });

  // Deterministic order for the leftovers: they have no page to inherit one
  // from, and a list that reshuffles between loads is unusable.
  const rest = [...available].filter((key) => !claimed.has(key)).sort();
  if (rest.length > 0) {
    pages.push({
      id: OTHER_PAGE_ID,
      label: "Weitere Abschnitte",
      path: "",
      sections: rest,
      present: rest,
    });
  }

  return pages;
}

/** Display name for a section key, falling back to the key itself. */
export function sectionLabel(key: string): string {
  return SECTION_LABELS[key] ?? key;
}
