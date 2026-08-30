// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { primeRuntimeConfig } from "@tracht-digital-solutions/tds-shared/api";
import { put, resetCache } from "@tracht-digital-solutions/tds-shared/data";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SitesList from "./SitesList";
import { TOAST_EVENT } from "@tracht-digital-solutions/tds-shared/toast";

/**
 * The website-CMS CONTENT screen: pick a website, pick a page, edit a section.
 *
 * Three things here are worth a test and the rest is plumbing:
 *
 *  - **Adding a site is gone from this screen.** It moved to Einstellungen, and
 *    the empty state has to SAY so — an empty screen with no way forward is
 *    worse than the form it replaced.
 *  - **The form ↔ JSON bridge must never silently drop keys** the schema does
 *    not list. A block is merged over the public site's defaults, so a dropped
 *    key blanks part of the live landing page with nothing red anywhere.
 *  - **The save message must not claim a rebuild that did not happen.** The API
 *    reports `cached`; inferring it from `ok` is the cheerful-success-for-a-
 *    request-nobody-sent failure.
 */

type Hit = { status?: number; body?: unknown };
let handlers: Array<(url: string, init?: RequestInit) => Hit | undefined> = [];
let calls: Array<{ url: string; method: string; body: unknown }> = [];

/**
 * Path + query of a request. The island calls an ABSOLUTE URL (via `apiFetch`);
 * a relative one would hit the product's own host and come back as SPA-fallback
 * HTML with a 200. Matching on the path keeps the route matchers anchored.
 */
const pathOf = (url: string) => String(url).replace(/^https?:\/\/[^/]+/i, "");

function respond(match: RegExp, body: unknown, status = 200, method?: string) {
  handlers.unshift((url, init) => {
    if (!match.test(pathOf(url))) return undefined;
    if (method && (init?.method ?? "GET") !== method) return undefined;
    return { status, body };
  });
}

/** Outcomes are toasts — collected off the `tds:toast` bus. */
let toasts: Array<{ variant: string; message: string }> = [];
const collectToast = (e: Event) => {
  toasts.push((e as CustomEvent<{ variant: string; message: string }>).detail);
};

beforeEach(() => {
  // The data cache is module-level and survives between tests by design; a
  // leaked entry would let one test paint another's fixture.
  resetCache();
  // apiFetch consults the host-side runtime config (/tds-runtime.json) before
  // it resolves a URL, so without this the first fetch call is that probe. The
  // panel products never ship the file — they render <meta name="tds-api-base">
  // — so "absent" is also what happens in production.
  primeRuntimeConfig(null);
  toasts = [];
  window.addEventListener(TOAST_EVENT, collectToast);
  handlers = [];
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      for (const h of handlers) {
        const hit = h(url, init);
        if (hit) {
          const status = hit.status ?? 200;
          return { ok: status >= 200 && status < 300, status, json: async () => hit.body ?? {} } as Response;
        }
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }),
  );
});

afterEach(() => {
  window.removeEventListener(TOAST_EVENT, collectToast);
  cleanup();
  resetCache();
});

const user = () => userEvent.setup({ delay: null });

const SITE = {
  id: 1,
  site_key: "landing",
  name: "Landingpage",
  cache_url: "https://tracht-digital.de",
  updated_at: "2026-01-01",
};

const block = (section_key: string, lang = "de", machine_translated = 0) => ({
  section_key,
  lang,
  machine_translated,
  updated_at: "2026-01-01",
});

/** Render with a site list and a block list already answering. */
async function open(blocks: unknown[], sites: unknown[] = [SITE]) {
  respond(/\/cms\/sites$/, { sites });
  respond(/\/cms\/landing\/blocks$/, { blocks });
  render(<SitesList />);
  if (sites.length > 0 && blocks.length > 0) {
    await screen.findByRole("navigation", { name: "Seite wählen" });
  }
  return user();
}

const jsonBox = () => screen.queryByLabelText("JSON") as HTMLTextAreaElement | null;
const puts = () => calls.filter((c) => c.method === "PUT");

/** userEvent.type() reads { and [ as key syntax, so JSON must be pasted. */
async function setJson(u: ReturnType<typeof user>, text: string) {
  const box = jsonBox() as HTMLTextAreaElement;
  await u.clear(box);
  await u.click(box);
  await u.paste(text);
}

describe("the empty state", () => {
  it("sends the operator to Einstellungen instead of offering a form", async () => {
    // Adding a site moved out of this screen. Without this pointer the panel
    // would show an empty page with no way forward at all.
    respond(/\/cms\/sites$/, { sites: [] });
    render(<SitesList />);
    const empty = await screen.findByText(/Noch keine Website verbunden/);
    expect(empty).toBeTruthy();
    const link = screen.getByRole("link", { name: /Einstellungen/ });
    expect(link.getAttribute("href")).toBe("/einstellungen");
  });

  it("offers no create form anywhere on the content screen", async () => {
    respond(/\/cms\/sites$/, { sites: [] });
    render(<SitesList />);
    await screen.findByText(/Noch keine Website verbunden/);
    expect(screen.queryByRole("button", { name: /hinzufügen/i })).toBeNull();
  });

  it("says the public site is unedited, not broken, when a site has no blocks", async () => {
    await open([]);
    expect(await screen.findByText(/Noch keine eigenen Inhalte gespeichert/)).toBeTruthy();
    expect(screen.getByText(/eingebauten Vorgaben/)).toBeTruthy();
  });

  it("still offers pages and sections so a new site can create its first override", async () => {
    respond(/\/cms\/landing\/blocks\/home_hero\?/, { value: null, lang: "de" });
    const u = await open([]);
    const nav = await screen.findByRole("navigation", { name: "Seite wählen" });
    expect(within(nav).getByRole("button", { name: "Startseite" })).toBeTruthy();
    const heroRow = (await screen.findByText("Startseite: Titelbereich")).closest("li")!;
    await u.click(within(heroRow).getByRole("button", { name: "DE · Vorgabe" }));
    expect(await screen.findByText(/noch kein eigener Inhalt gespeichert/)).toBeTruthy();
    expect(await screen.findByLabelText("Überschrift")).toBeTruthy();
  });

  it("reports the HTTP status when the site list fails", async () => {
    respond(/\/cms\/sites$/, {}, 403);
    render(<SitesList />);
    // A calm empty state here would be indistinguishable from "no sites yet".
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("403"));
  });
});

describe("choosing a site", () => {
  it("hides the picker when there is only one site", async () => {
    await open([block("home_hero")]);
    expect(screen.queryByRole("group", { name: "Website wählen" })).toBeNull();
  });

  it("offers a picker once there is a choice", async () => {
    const second = { id: 2, site_key: "shop", name: "Shop", updated_at: "2026-01-01" };
    await open([block("home_hero")], [SITE, second]);
    const picker = await screen.findByRole("group", { name: "Website wählen" });
    expect(within(picker).getByRole("button", { name: "Shop" })).toBeTruthy();
  });
});

describe("choosing a page", () => {
  it("groups sections into the pages a visitor sees", async () => {
    await open([block("home_hero"), block("pricing_services"), block("legal_impressum")]);
    const nav = await screen.findByRole("navigation", { name: "Seite wählen" });
    expect(within(nav).getByRole("button", { name: "Startseite" })).toBeTruthy();
    expect(within(nav).getByRole("button", { name: "Preise" })).toBeTruthy();
    expect(within(nav).getByRole("button", { name: "Impressum" })).toBeTruthy();
  });

  it("shows the public path of the selected page", async () => {
    // So nobody has to guess which page they are editing.
    await open([block("home_hero")]);
    expect(await screen.findByText("/")).toBeTruthy();
  });

  it("shows both localized paths for a service page", async () => {
    const u = await open([block("service_consulting")]);
    await u.click(screen.getByRole("button", { name: "Leistung: Beratung & Konzeption" }));
    expect(await screen.findByText("DE /leistungen/beratung-konzeption")).toBeTruthy();
    expect(screen.getByText("EN /en/services/consulting-planning")).toBeTruthy();
  });

  it("names a section in German and keeps its key visible", async () => {
    // The key is what the API, the cache event and every log line call it, so
    // hiding it would make a support conversation impossible.
    await open([block("home_hero")]);
    expect(await screen.findByText("Startseite: Titelbereich")).toBeTruthy();
    expect(screen.getByText("home_hero")).toBeTruthy();
  });

  it("marks a machine-translated language", async () => {
    await open([block("home_hero", "de"), block("home_hero", "en", 1)]);
    expect(await screen.findByRole("button", { name: /EN · auto/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^DE$/ })).toBeTruthy();
  });

  it("offers a missing language as Vorgabe instead of making it impossible to author", async () => {
    await open([block("home_hero", "de")]);
    const heroRow = (await screen.findByText("Startseite: Titelbereich")).closest("li")!;
    expect(within(heroRow).getByRole("button", { name: "EN · Vorgabe" })).toBeTruthy();
  });

  it("switches the section list when another page is chosen", async () => {
    const u = await open([block("home_hero"), block("legal_impressum")]);
    await u.click(screen.getByRole("button", { name: "Impressum" }));
    expect(await screen.findByText("Impressum (Text)")).toBeTruthy();
    expect(screen.queryByText("Titelbereich")).toBeNull();
  });
});

describe("editing a section", () => {
  /** Open the current home-page hero block in the structured form. */
  async function openHero(value: unknown = { headline: "Hallo" }) {
    respond(/\/cms\/landing\/blocks\/home_hero\?/, { value, lang: "de" });
    const u = await open([block("home_hero")]);
    await u.click(await screen.findByRole("button", { name: /^DE$/ }));
    await screen.findByRole("button", { name: "Speichern" });
    return u;
  }

  it("opens a known section in the structured form", async () => {
    await openHero();
    expect(await screen.findByLabelText("Überschrift")).toBeTruthy();
    expect(jsonBox()).toBeNull();
  });

  it("keeps an unknown section on the raw JSON editor", async () => {
    respond(/\/cms\/landing\/blocks\/shop_teaser\?/, { value: { a: 1 }, lang: "de" });
    const u = await open([block("shop_teaser")]);
    await u.click(await screen.findByRole("button", { name: "Weitere Abschnitte" }));
    const row = (await screen.findByText("shop_teaser", { selector: "strong" })).closest("li")!;
    await u.click(within(row).getByRole("button", { name: /^DE$/ }));
    expect(await screen.findByLabelText("JSON")).toBeTruthy();
    // …and no toggle, because there is no form to toggle to.
    expect(screen.queryByRole("button", { name: "JSON bearbeiten" })).toBeNull();
  });

  it("keeps keys the schema does not list", async () => {
    // THE invariant. A block is merged over the public site's defaults, so a
    // key dropped here blanks part of the live page and nothing goes red.
    const u = await openHero({ headline: "Hallo", unbekannt: { tief: true } });
    await u.clear(screen.getByLabelText("Überschrift"));
    await u.type(screen.getByLabelText("Überschrift"), "Neu");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]?.body).toMatchObject({
      value: { headline: "Neu", unbekannt: { tief: true } },
      lang: "de",
    });
  });

  it("refuses to save invalid JSON", async () => {
    const u = await openHero();
    await u.click(screen.getByRole("button", { name: "JSON bearbeiten" }));
    await setJson(u, "{ kaputt");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(puts()).toHaveLength(0);
  });

  it("refuses a JSON array — a block must be an object", async () => {
    const u = await openHero();
    await u.click(screen.getByRole("button", { name: "JSON bearbeiten" }));
    await setJson(u, "[1, 2]");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(puts()).toHaveLength(0);
  });

  it("PUTs to the section's own route", async () => {
    const u = await openHero();
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(pathOf(puts()[0]!.url)).toBe("/cms/landing/blocks/home_hero");
  });

  it("coerces a malformed stored array to an empty object instead of crashing", async () => {
    await openHero(["kaputt"]);
    expect((await screen.findByLabelText("Überschrift") as HTMLInputElement).value).toBe("");
  });

  it("keeps typed list fields and unknown item keys intact", async () => {
    respond(/\/cms\/landing\/blocks\/pricing\?/, {
      value: {
        items: [{ title: "Basis", rate: 50, description: "", includes: [], highlight: false, custom: "keep" }],
      },
      lang: "de",
    });
    const u = await open([block("pricing")]);
    await u.click(screen.getByRole("button", { name: "Weitere Abschnitte" }));
    const pricingRow = (await screen.findByText("pricing")).closest("li")!;
    await u.click(within(pricingRow).getByRole("button", { name: /^DE$/ }));
    const rate = (await screen.findByText(/Stundensatz/)).querySelector("input")!;
    await u.clear(rate);
    await u.type(rate, "95");
    await u.click(screen.getByRole("checkbox", { name: "Hervorheben" }));
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    const value = (puts()[0]!.body as { value: { items: Array<Record<string, unknown>> } }).value;
    expect(value.items[0]).toMatchObject({ rate: 95, highlight: true, custom: "keep" });
  });

  it("edits a service detail without inventing a reference placeholder", async () => {
    respond(/\/cms\/landing\/blocks\/service_consulting\?/, {
      value: { title: "Beratung & Konzeption", references: [] },
      lang: "de",
    });
    const u = await open([block("service_consulting")]);
    await u.click(screen.getByRole("button", { name: "Leistung: Beratung & Konzeption" }));
    const row = (await screen.findByText("service_consulting")).closest("li")!;
    await u.click(within(row).getByRole("button", { name: /^DE$/ }));

    expect(await screen.findByText("Anonymisierte Referenzen")).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ Referenz" })).toBeTruthy();
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]?.body).toMatchObject({
      value: { title: "Beratung & Konzeption", references: [] },
      lang: "de",
    });
  });
});

describe("what the save says afterwards", () => {
  async function saveWith(response: Record<string, unknown>, status = 200) {
    respond(/\/cms\/landing\/blocks\/home_hero\?/, { value: { headline: "x" }, lang: "de" });
    respond(/\/cms\/landing\/blocks\/home_hero$/, response, status, "PUT");
    const u = await open([block("home_hero")]);
    await u.click(await screen.findByRole("button", { name: /^DE$/ }));
    await u.click(await screen.findByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(toasts.length).toBeGreaterThan(0));
    return toasts[toasts.length - 1]!;
  }

  it("reports the targeted cache request without guessing a single page", async () => {
    const toast = await saveWith({ ok: true, cached: true });
    expect(toast.variant).toBe("success");
    expect(toast.message).toContain("betroffenen Seiten");
  });

  it("does not claim a rebuild the API says did not happen", async () => {
    // `cached: false` means the URL/token/service was incomplete and no call
    // went out. Either way, saying "wird neu gebaut"
    // would be a success message for a request nobody sent.
    const toast = await saveWith({ ok: true, cached: false });
    expect(toast.message).not.toContain("wird neu gebaut");
  });

  it("paints cached sites as stale while a background refresh is pending", async () => {
    const now = Date.now();
    put("/cms/sites", { sites: [SITE] });
    vi.spyOn(Date, "now").mockReturnValue(now + 31_000);
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));

    render(<SitesList />);
    await waitFor(() => {
      const root = document.querySelector(".cms-sites");
      expect(root?.classList.contains("tds-stale")).toBe(true);
      expect(root?.getAttribute("aria-busy")).toBe("true");
    });
  });

  it("does not overwrite typed content when a stale block refresh finishes", async () => {
    const now = Date.now();
    put("/cms/sites", { sites: [SITE] });
    put("/cms/landing/blocks", { blocks: [block("home_hero")] });
    put("/cms/landing/blocks/home_hero?lang=de", { value: { headline: "Alt" } });
    vi.spyOn(Date, "now").mockReturnValue(now + 31_000);

    let finishBlock!: () => void;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const path = pathOf(url);
        if (path === "/cms/landing/blocks/home_hero?lang=de") {
          return new Promise<Response>((resolve) => {
            finishBlock = () => resolve({
              ok: true,
              status: 200,
              json: async () => ({ value: { headline: "Neu vom Server" } }),
            } as Response);
          });
        }
        const body = path === "/cms/sites" ? { sites: [SITE] } : { blocks: [block("home_hero")] };
        return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
      }),
    );

    render(<SitesList />);
    const heroRow = (await screen.findByText("Startseite: Titelbereich")).closest("li")!;
    const u = user();
    await u.click(within(heroRow).getByRole("button", { name: /^DE$/ }));
    const headline = (await screen.findByLabelText("Überschrift")) as HTMLInputElement;
    await u.clear(headline);
    await u.type(headline, "Mein Entwurf");

    await act(async () => finishBlock());
    await waitFor(() => expect(headline.value).toBe("Mein Entwurf"));
  });

  it("reports the HTTP status when the save itself fails", async () => {
    // The status is what separates "session expired" from "service down" in a
    // bug report.
    const toast = await saveWith({}, 403);
    expect(toast.variant).toBe("danger");
    expect(toast.message).toContain("403");
  });
});
