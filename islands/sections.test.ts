import { describe, expect, it } from "vitest";
import {
  OTHER_PAGE_ID,
  PAGES,
  SECTION_SCHEMAS,
  SERVICE_SECTION_KEYS,
  resolvePages,
  sectionLabel,
} from "./sections.js";

/** The page model is a map for known landing pages, never a content filter. */
describe("resolvePages", () => {
  it("always offers every known page, even before an override exists", () => {
    expect(resolvePages([]).map((p) => p.id)).toEqual(PAGES.map((p) => p.id));
  });

  it("always offers known sections so a new site can create its first block", () => {
    const home = resolvePages([]).find((p) => p.id === "startseite");
    expect(home?.present).toContain("home_hero");
    expect(home?.present).toContain("services_overview");
    expect(home?.present).toContain("journal");
  });

  it("lists a shared section under every page that renders it", () => {
    const pages = resolvePages([]);
    expect(pages.find((p) => p.id === "startseite")?.present).toContain("pricing_services");
    expect(pages.find((p) => p.id === "preise")?.present).toContain("pricing_services");
    expect(pages.find((p) => p.id === "startseite")?.present).toContain("footer");
    expect(pages.find((p) => p.id === "preise")?.present).toContain("footer");
  });

  it("maps the redesigned home and pricing pages without reviving legacy blocks", () => {
    const home = PAGES.find((p) => p.id === "startseite");
    expect(home?.sections).toEqual([
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
    ]);
    expect(home?.sections).not.toEqual(expect.arrayContaining(["hero", "about", "services", "tech", "consulting", "faq"]));
    expect(PAGES.find((p) => p.id === "preise")?.sections).toEqual([
      "pricing_services",
      ...SERVICE_SECTION_KEYS,
      "contact",
      "footer",
    ]);
  });

  it("maps each stable service block to its localized public route pair", () => {
    const expected = [
      ["service_consulting", "/leistungen/beratung-konzeption", "/en/services/consulting-planning"],
      ["service_process", "/leistungen/prozessoptimierung", "/en/services/process-optimization"],
      ["service_solutions", "/leistungen/individuelle-loesungen", "/en/services/tailored-solutions"],
      ["service_custom_development", "/leistungen/auftragsprogrammierung", "/en/services/contract-development"],
      ["service_web_presence", "/leistungen/webauftritt", "/en/services/web-presence"],
      ["service_complete_it", "/leistungen/komplette-it", "/en/services/complete-it"],
    ] as const;

    expect(SERVICE_SECTION_KEYS).toEqual(expected.map(([key]) => key));
    for (const [key, path, pathEn] of expected) {
      const page = PAGES.find((candidate) => candidate.sections[0] === key);
      expect(page, key).toMatchObject({ path, pathEn, sections: [key, "contact", "footer"] });
      expect(PAGES.find((candidate) => candidate.id === "startseite")?.sections, key).toContain(key);
      expect(PAGES.find((candidate) => candidate.id === "preise")?.sections, key).toContain(key);
    }
  });

  it("keeps an unmapped stored section reachable under Weitere Abschnitte", () => {
    const rest = resolvePages(["home_hero", "shop_teaser", "newsletter"]).find(
      (p) => p.id === OTHER_PAGE_ID,
    );
    expect(rest?.present).toEqual(["newsletter", "shop_teaser"]);
  });

  it("sorts leftovers and omits the bucket when there are none", () => {
    expect(resolvePages(["zeta", "alpha"]).at(-1)?.present).toEqual(["alpha", "zeta"]);
    expect(resolvePages(["home_hero"]).some((p) => p.id === OTHER_PAGE_ID)).toBe(false);
  });

  it("keeps legal texts off the home page", () => {
    const home = PAGES.find((p) => p.id === "startseite");
    expect(home?.sections).not.toContain("legal_impressum");
    expect(home?.sections).not.toContain("legal_datenschutz");
  });

  it("gives every real page a public path and the leftovers bucket none", () => {
    for (const page of PAGES) expect(page.path, page.id).not.toBe("");
    expect(resolvePages(["was_auch_immer"]).at(-1)?.path).toBe("");
  });
});

describe("section metadata", () => {
  it("names every structured section", () => {
    for (const key of Object.keys(SECTION_SCHEMAS)) {
      expect(sectionLabel(key), key).not.toBe(key);
    }
  });

  it("falls back to the raw key rather than hiding an unknown section", () => {
    expect(sectionLabel("shop_teaser")).toBe("shop_teaser");
  });

  it("covers the live landingpage additions", () => {
    expect(SECTION_SCHEMAS.home_hero).toBeDefined();
    expect(SECTION_SCHEMAS.why_me).toBeDefined();
    expect(SECTION_SCHEMAS.services_overview).toBeDefined();
    expect(SECTION_SCHEMAS.digital_responsibility).toBeDefined();
    expect(SECTION_SCHEMAS.pricing_services).toBeDefined();
    expect(SECTION_SCHEMAS.faq_v2).toEqual(SECTION_SCHEMAS.faq);
    expect(SECTION_SCHEMAS.journal).toBeDefined();
    expect(SECTION_SCHEMAS.cookie_banner).toBeDefined();
  });

  it("pins the service detail copy and anonymised-reference contract", () => {
    const detailKeys = [
      "label",
      "title",
      "summary",
      "intro",
      "situationsTitle",
      "situations",
      "responsibilitiesTitle",
      "responsibilities",
      "outcomesTitle",
      "outcomes",
      "boundariesTitle",
      "boundaries",
      "processTitle",
      "process",
      "priceLabel",
      "priceText",
      "referencesLabel",
      "referencesHeadline",
      "references",
      "ctaTitle",
      "ctaText",
      "ctaButton",
    ];

    for (const key of SERVICE_SECTION_KEYS) {
      const schema = SECTION_SCHEMAS[key]!;
      expect(schema.map((field) => field.key), key).toEqual(detailKeys);
      expect(schema.some((field) => ["id", "slug", "href", "url"].includes(field.key)), key).toBe(false);

      const references = schema.find((field) => field.key === "references");
      expect(references, key).toMatchObject({
        type: "list",
        itemLabel: "Referenz",
        itemFields: [
          { key: "title" },
          { key: "context" },
          { key: "challenge" },
          { key: "solution" },
          { key: "result" },
          { key: "metric" },
        ],
      });
    }
  });

  it("pins the flat service-pricing fields and keeps service content out of that block", () => {
    expect(SECTION_SCHEMAS.pricing_services?.map((field) => field.key)).toEqual([
      "label",
      "headline",
      "headlineAccent",
      "sub",
      "teaserHeadline",
      "teaserHeadlineAccent",
      "teaserSub",
      "teaserCta",
      "teaserFromLabel",
      "hourSuffix",
      "customRateLabel",
      "includesLabel",
      "rateConsulting",
      "rateProcess",
      "rateSolutions",
      "rateCustomDevelopment",
      "rateWebPresence",
      "notesTitle",
      "notes",
      "ctaTitle",
      "ctaSub",
      "ctaButton",
      "back",
    ]);
    expect(SECTION_SCHEMAS.pricing_services?.some((field) => field.key === "items")).toBe(false);
  });
});
