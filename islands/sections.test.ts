import { describe, expect, it } from "vitest";
import {
  OTHER_PAGE_ID,
  PAGES,
  SECTION_SCHEMAS,
  SERVICE_SECTION_KEYS,
  resolvePages,
  sectionLabel,
} from "./sections.js";

const keysOf = (section: string) => SECTION_SCHEMAS[section]?.map((field) => field.key);

/** The page model is a map for known landing pages, never a content filter. */
describe("resolvePages", () => {
  it("always offers every known page, even before an override exists", () => {
    expect(resolvePages([]).map((p) => p.id)).toEqual(PAGES.map((p) => p.id));
  });

  it("always offers known sections so a new site can create its first block", () => {
    const home = resolvePages([]).find((p) => p.id === "startseite");
    expect(home?.present).toContain("home_hero");
    expect(home?.present).toContain("home_trust");
    expect(home?.present).toContain("services_overview");
    expect(home?.present).toContain("journal");
  });

  it("lists a shared section under every page that renders it", () => {
    const pages = resolvePages([]);
    const servicePages = pages.filter((p) => SERVICE_SECTION_KEYS.includes(p.sections[0] as never));
    expect(servicePages).toHaveLength(SERVICE_SECTION_KEYS.length);
    for (const page of [pages.find((p) => p.id === "startseite")!, ...servicePages]) {
      expect(page.present, page.id).toContain("first_call");
      expect(page.present, page.id).toContain("contact");
      expect(page.present, page.id).toContain("footer");
    }
  });

  it("maps the redesigned home page in render order, without legacy blocks", () => {
    const home = PAGES.find((p) => p.id === "startseite");
    expect(home?.sections).toEqual([
      "home_hero",
      "home_trust",
      "why_me",
      "services_overview",
      ...SERVICE_SECTION_KEYS,
      "references_home",
      "process",
      "first_call",
      "website_demos",
      "journal",
      "pricing_services",
      "pricing_logic",
      "faq_v2",
      "contact",
      "cookie_banner",
      "footer",
    ]);
    expect(home?.sections).not.toEqual(
      expect.arrayContaining(["hero", "about", "services", "tech", "consulting", "faq"]),
    );
    // Not rendered since 2026-09; a stored row still lands under "Weitere Abschnitte".
    expect(home?.sections).not.toContain("digital_responsibility");
  });

  it("has no pricing page: /preise only redirects to the home page's section", () => {
    expect(PAGES.find((p) => p.id === "preise")).toBeUndefined();
    expect(PAGES.some((p) => p.path === "/preise")).toBe(false);
    expect(resolvePages(["digital_responsibility"]).at(-1)?.present).toEqual(["digital_responsibility"]);
  });

  it("maps each stable service block to its localized public route pair", () => {
    const expected = [
      ["service_consulting", "/leistungen/beratung-konzeption", "/en/services/consulting-planning"],
      ["service_process", "/leistungen/prozessoptimierung", "/en/services/process-optimization"],
      ["service_solutions", "/leistungen/individuelle-loesungen", "/en/services/tailored-solutions"],
      ["service_web_presence", "/leistungen/webauftritt", "/en/services/web-presence"],
    ] as const;

    expect(SERVICE_SECTION_KEYS).toEqual(expected.map(([key]) => key));
    for (const [key, path, pathEn] of expected) {
      const page = PAGES.find((candidate) => candidate.sections[0] === key);
      const sections =
        key === "service_web_presence"
          ? [key, "website_demos", "first_call", "contact", "footer"]
          : [key, "first_call", "contact", "footer"];
      expect(page, key).toMatchObject({ path, pathEn, sections });
      expect(PAGES.find((candidate) => candidate.id === "startseite")?.sections, key).toContain(key);
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

  it("gives every section a page shows a form", () => {
    for (const page of PAGES) {
      for (const key of page.sections) expect(SECTION_SCHEMAS[key], `${page.id}: ${key}`).toBeDefined();
    }
  });

  it("falls back to the raw key rather than hiding an unknown section", () => {
    expect(sectionLabel("shop_teaser")).toBe("shop_teaser");
  });

  it("covers the live landingpage sections", () => {
    for (const key of [
      "home_hero",
      "home_trust",
      "why_me",
      "services_overview",
      "references_home",
      "first_call",
      "website_demos",
      "pricing_services",
      "pricing_logic",
      "journal",
      "cookie_banner",
    ]) {
      expect(SECTION_SCHEMAS[key], key).toBeDefined();
    }
    expect(SECTION_SCHEMAS.faq_v2).toEqual(SECTION_SCHEMAS.faq);
  });

  it("matches the redesigned blocks' shapes", () => {
    // Copied from the landingpage's `cmsFor()` defaults (src/lib/homeContent.ts).
    expect(keysOf("home_hero")).toEqual(["eyebrow", "headline", "headlineAccent", "headlineSuffix", "sub", "cta1", "cta2"]);
    expect(keysOf("home_trust")).toEqual(["title", "facts"]);
    expect(SECTION_SCHEMAS.home_trust?.find((field) => field.key === "facts")).toMatchObject({
      type: "list",
      itemFields: [{ key: "title" }, { key: "text" }, { key: "linkLabel" }],
    });
    expect(keysOf("first_call")).toEqual(["title", "nextStepsTitle", "items", "cta"]);
    expect(keysOf("pricing_logic")).toEqual(["title", "steps", "note"]);
    expect(keysOf("references_home")).toEqual(["headline", "headlineAccent", "intro", "label"]);
    expect(keysOf("website_demos")).toEqual([
      "headline",
      "headlineAccent",
      "intro",
      "serviceIntro",
      "headlineSingle",
      "introSingle",
      "serviceIntroSingle",
    ]);
    expect(keysOf("faq")).toEqual(["label", "headline", "headlineAccent", "items"]);
  });

  it("leaves fields the site stopped rendering out of the forms", () => {
    expect(keysOf("home_hero")).not.toContain("scrollHint");
    expect(keysOf("why_me")).not.toContain("reasons");
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

  it("pins the pricing section's fields and keeps service content out of that block", () => {
    expect(keysOf("pricing_services")).toEqual([
      "headline",
      "headlineAccent",
      "sub",
      "hourSuffix",
      "includesLabel",
      "rateConsulting",
      "rateProcess",
      "rateSolutions",
      "rateWebPresence",
      "packages",
      "notes",
      "ctaTitle",
      "ctaSub",
      "ctaButton",
    ]);
    expect(SECTION_SCHEMAS.pricing_services?.some((field) => field.key === "items")).toBe(false);
  });

  it("lets the fixed-price packages be edited item by item", () => {
    const packages = SECTION_SCHEMAS.pricing_services?.find((field) => field.key === "packages");
    expect(packages?.type).toBe("list");
    const itemFields = packages && "itemFields" in packages ? packages.itemFields : [];
    expect(itemFields.map((field) => field.key)).toEqual([
      "title",
      "price",
      "description",
      "includes",
    ]);
    // A price is a number, not prose: the site renders it as currency and puts
    // it into structured data.
    expect(itemFields.find((field) => field.key === "price")?.type).toBe("number");
    expect(itemFields.find((field) => field.key === "includes")?.type).toBe("stringlist");
  });

  it("offers the contact reasons as an editable list", () => {
    const reasons = SECTION_SCHEMAS.contact?.find((field) => field.key === "reasons");
    expect(reasons?.type).toBe("stringlist");
    // Named `reasons` on purpose. TranslatableJsonWalker skips `kind`, `id`,
    // `variant` and friends, so a reason list under one of those names would
    // never reach the English block.
    expect(["kind", "id", "variant", "slug"]).not.toContain(reasons?.key);
  });
});
