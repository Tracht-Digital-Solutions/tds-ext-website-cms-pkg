import { describe, expect, it } from "vitest";
import {
  OTHER_PAGE_ID,
  PAGES,
  SECTION_SCHEMAS,
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
    expect(home?.present).toContain("hero");
    expect(home?.present).toContain("tech");
    expect(home?.present).toContain("journal");
  });

  it("lists a shared section under every page that renders it", () => {
    const pages = resolvePages([]);
    expect(pages.find((p) => p.id === "startseite")?.present).toContain("pricing");
    expect(pages.find((p) => p.id === "preise")?.present).toContain("pricing");
    expect(pages.find((p) => p.id === "startseite")?.present).toContain("footer");
    expect(pages.find((p) => p.id === "preise")?.present).toContain("footer");
  });

  it("keeps an unmapped stored section reachable under Weitere Abschnitte", () => {
    const rest = resolvePages(["hero", "shop_teaser", "newsletter"]).find(
      (p) => p.id === OTHER_PAGE_ID,
    );
    expect(rest?.present).toEqual(["newsletter", "shop_teaser"]);
  });

  it("sorts leftovers and omits the bucket when there are none", () => {
    expect(resolvePages(["zeta", "alpha"]).at(-1)?.present).toEqual(["alpha", "zeta"]);
    expect(resolvePages(["hero"]).some((p) => p.id === OTHER_PAGE_ID)).toBe(false);
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
    expect(SECTION_SCHEMAS.tech).toBeDefined();
    expect(SECTION_SCHEMAS.journal).toBeDefined();
    expect(SECTION_SCHEMAS.cookie_banner).toBeDefined();
  });
});
