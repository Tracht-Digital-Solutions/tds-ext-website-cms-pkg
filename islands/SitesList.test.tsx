// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SitesList from "./SitesList";
import { TOAST_EVENT } from "@tracht-digital-solutions/tds-shared/toast";

/**
 * The website-CMS island. Its risky part is the structured form ↔ raw JSON
 * bridge: a block is one JSON object per site × section × language, the form
 * only knows the fields in `SECTION_SCHEMAS`, and the public sites merge the
 * saved block over their defaults. So the invariant that matters is that
 * editing through the form never SILENTLY DROPS keys the schema does not list —
 * that would blank parts of the live landing page.
 */

type Hit = { status?: number; body?: unknown };
let handlers: Array<(url: string, init?: RequestInit) => Hit | undefined> = [];
let calls: Array<{ url: string; method: string; body: unknown }> = [];


/**
 * Path + query of a request. The island calls an ABSOLUTE URL now (via
 * `apiFetch`); a relative one would hit the product's own static host and come
 * back as SPA-fallback HTML with a 200. Matching on the path keeps the route
 * matchers below anchored.
 */
const pathOf = (url: string) => String(url).replace(/^https?:\/\/[^/]+/i, "");

function respond(match: RegExp, body: unknown, status = 200, method?: string) {
  handlers.unshift((url, init) => {
    if (!match.test(pathOf(url))) return undefined;
    if (method && (init?.method ?? "GET") !== method) return undefined;
    return { status, body };
  });
}

/** Outcomes are toasts now — collected off the `tds:toast` bus. */
let toasts: Array<{ variant: string; message: string }> = [];
const collectToast = (e: Event) => {
  toasts.push((e as CustomEvent<{ variant: string; message: string }>).detail);
};

beforeEach(() => {
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
});

const user = () => userEvent.setup({ delay: null });
const SITE = { id: 1, site_key: "landing", name: "Landingpage", updated_at: "2026-01-01" };

async function renderSites(sites: unknown[] = [SITE]) {
  respond(/\/cms\/sites$/, { sites });
  render(<SitesList />);
  await waitFor(() => expect(calls.some((c) => pathOf(c.url) === "/cms/sites")).toBe(true));
}

/** Open the site editor for `landing`. */
async function openSite(blocks: unknown[] = []) {
  await renderSites();
  respond(/\/cms\/landing\/blocks$/, { blocks });
  const u = user();
  await u.click(await screen.findByRole("button", { name: /Landingpage/ }));
  await screen.findByRole("heading", { name: "Block bearbeiten" });
  return u;
}

// `query`, not `get`: one test asserts the raw editor is ABSENT while the
// structured form is showing, and getBy* throws rather than returning null.
const jsonBox = () => screen.queryByLabelText("JSON") as HTMLTextAreaElement;

/** userEvent.type() reads { and [ as key syntax, so JSON must be pasted. */
async function setJson(u: ReturnType<typeof user>, text: string) {
  const box = jsonBox();
  await u.clear(box);
  await u.click(box);
  await u.paste(text);
}
const puts = () => calls.filter((c) => c.method === "PUT");

describe("the site list", () => {
  it("loads sites on mount with credentials", async () => {
    await renderSites();
    expect(await screen.findByText("Landingpage")).toBeTruthy();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: "include" });
  });

  it("shows the empty state when there are none", async () => {
    await renderSites([]);
    expect(await screen.findByText("Noch keine Websites angelegt.")).toBeTruthy();
  });

  it("degrades to empty rather than hanging when the request fails", async () => {
    respond(/\/cms\/sites$/, {}, 500);
    render(<SitesList />);
    expect(await screen.findByText("Noch keine Websites angelegt.")).toBeTruthy();
  });

  it("degrades to empty when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    render(<SitesList />);
    expect(await screen.findByText("Noch keine Websites angelegt.")).toBeTruthy();
  });

  it("creates a site with a valid kebab key", async () => {
    await renderSites([]);
    const u = user();
    await u.type(screen.getByPlaceholderText("site-key (kebab)"), "neue-seite");
    await u.type(screen.getByPlaceholderText("Name"), "Neue Seite");
    await u.click(screen.getByRole("button", { name: "Website hinzufügen" }));
    await waitFor(() => {
      const post = calls.find((c) => c.method === "POST");
      expect(post?.body).toEqual({ site_key: "neue-seite", name: "Neue Seite" });
    });
  });

  it("refuses an invalid key before hitting the API", async () => {
    await renderSites([]);
    const u = user();
    await u.type(screen.getByPlaceholderText("site-key (kebab)"), "Nicht Kebab");
    await u.type(screen.getByPlaceholderText("Name"), "X");
    await u.click(screen.getByRole("button", { name: "Website hinzufügen" }));
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("refuses a blank name", async () => {
    await renderSites([]);
    const u = user();
    await u.type(screen.getByPlaceholderText("site-key (kebab)"), "gueltig");
    await u.type(screen.getByPlaceholderText("Name"), "   ");
    await u.click(screen.getByRole("button", { name: "Website hinzufügen" }));
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("clears the form and reloads after a successful create", async () => {
    await renderSites([]);
    const u = user();
    await u.type(screen.getByPlaceholderText("site-key (kebab)"), "neu");
    await u.type(screen.getByPlaceholderText("Name"), "Neu");
    await u.click(screen.getByRole("button", { name: "Website hinzufügen" }));
    await waitFor(() => expect(calls.filter((c) => pathOf(c.url) === "/cms/sites" && c.method === "GET")).toHaveLength(2));
    expect((screen.getByPlaceholderText("site-key (kebab)") as HTMLInputElement).value).toBe("");
  });
});

describe("the block list", () => {
  it("scopes the block request to the selected site", async () => {
    await openSite();
    expect(calls.some((c) => pathOf(c.url) === "/cms/landing/blocks")).toBe(true);
  });

  it("lists a block with its language", async () => {
    await openSite([{ section_key: "hero", lang: "de", updated_at: "x" }]);
    expect(await screen.findByText("hero")).toBeTruthy();
    expect(within(screen.getByRole("list")).getByText("de")).toBeTruthy();
  });

  it("marks a machine-translated block", async () => {
    // The Auto chip is how an editor knows DeepL wrote it and a manual edit
    // will claim the row.
    await openSite([{ section_key: "hero", lang: "en", machine_translated: 1, updated_at: "x" }]);
    expect(await screen.findByText("Auto")).toBeTruthy();
  });

  it("does not mark a hand-written block", async () => {
    await openSite([{ section_key: "hero", lang: "de", machine_translated: 0, updated_at: "x" }]);
    await screen.findByText("hero");
    expect(screen.queryByText("Auto")).toBeNull();
  });

  it("returns to the site list", async () => {
    const u = await openSite();
    await u.click(screen.getByRole("button", { name: "← Websites" }));
    expect(await screen.findByPlaceholderText("site-key (kebab)")).toBeTruthy();
  });
});

describe("saving a block", () => {
  it("rejects an empty section key", async () => {
    const u = await openSite();
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText("Ungültiger Section-Key.")).toBeTruthy();
    expect(puts()).toHaveLength(0);
  });

  it("rejects a section key with illegal characters", async () => {
    const u = await openSite();
    await u.type(screen.getByPlaceholderText(/section-key/), "Nicht Gut!");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText("Ungültiger Section-Key.")).toBeTruthy();
  });

  it("accepts underscores in a section key", async () => {
    const u = await openSite();
    await u.type(screen.getByPlaceholderText(/section-key/), "cookie_banner");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(pathOf(puts()[0]!.url)).toBe("/cms/landing/blocks/cookie_banner");
  });

  it("refuses to save invalid JSON", async () => {
    const u = await openSite();
    await u.type(screen.getByPlaceholderText(/section-key/), "unbekannt");
    await setJson(u, "{nicht json");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText(/gültiges JSON-Objekt/)).toBeTruthy();
    expect(puts()).toHaveLength(0);
  });

  it("refuses a JSON array — a block must be an object", async () => {
    // The public sites spread the block over their defaults; an array would
    // produce numeric keys.
    const u = await openSite();
    await u.type(screen.getByPlaceholderText(/section-key/), "unbekannt");
    await setJson(u, "[1,2]");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText(/gültiges JSON-Objekt/)).toBeTruthy();
    expect(puts()).toHaveLength(0);
  });

  it("refuses a bare JSON scalar", async () => {
    const u = await openSite();
    await u.type(screen.getByPlaceholderText(/section-key/), "unbekannt");
    await setJson(u, "42");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText(/gültiges JSON-Objekt/)).toBeTruthy();
  });

  it("refuses JSON null", async () => {
    const u = await openSite();
    await u.type(screen.getByPlaceholderText(/section-key/), "unbekannt");
    await setJson(u, "null");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText(/gültiges JSON-Objekt/)).toBeTruthy();
  });

  it("PUTs the parsed object with the chosen language", async () => {
    const u = await openSite();
    await u.type(screen.getByPlaceholderText(/section-key/), "unbekannt");
    await setJson(u, '{"a":1}');
    // By name, not by role alone — the editor also carries the legal-document
    // uploader, which has a language select of its own.
    await u.selectOptions(screen.getByLabelText("Sprache des Blocks"), "en");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]!.body).toEqual({ value: { a: 1 }, lang: "en" });
  });

  it("confirms a save and reloads the block list", async () => {
    const u = await openSite();
    await u.type(screen.getByPlaceholderText(/section-key/), "unbekannt");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
await waitFor(() => expect(toasts.some((t) => t.variant === "success" && t.message.includes("Gespeichert"))).toBe(true));
    await waitFor(() => expect(calls.filter((c) => pathOf(c.url) === "/cms/landing/blocks")).toHaveLength(2));
  });

  it("reports the status when a save fails", async () => {
    const u = await openSite();
    respond(/\/blocks\/unbekannt$/, {}, 403, "PUT");
    await u.type(screen.getByPlaceholderText(/section-key/), "unbekannt");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
await waitFor(() => expect(toasts.some((t) => t.variant === "danger" && t.message.includes("403"))).toBe(true));
  });

  it("does not reload the block list after a failed save", async () => {
    const u = await openSite();
    respond(/\/blocks\/unbekannt$/, {}, 500, "PUT");
    await u.type(screen.getByPlaceholderText(/section-key/), "unbekannt");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
await waitFor(() => expect(toasts.some((t) => t.variant === "danger" && t.message.includes("500"))).toBe(true));
    expect(calls.filter((c) => pathOf(c.url) === "/cms/landing/blocks")).toHaveLength(1);
  });
});

describe("structured form vs raw JSON", () => {
  it("opens a known section in the structured form", async () => {
    const u = await openSite();
    await u.type(screen.getByPlaceholderText(/section-key/), "hero");
    // The hero schema renders labelled fields instead of a JSON textarea.
    expect(await screen.findByText("Überschrift")).toBeTruthy();
    expect(jsonBox()).toBeNull();
  });

  it("keeps an unknown section on the raw JSON editor", async () => {
    const u = await openSite();
    await u.type(screen.getByPlaceholderText(/section-key/), "voellig-unbekannt");
    expect(jsonBox()).toBeTruthy();
    expect(screen.queryByRole("button", { name: "JSON bearbeiten" })).toBeNull();
  });

  it("offers the Form/JSON toggle only for a known section", async () => {
    const u = await openSite();
    await u.type(screen.getByPlaceholderText(/section-key/), "faq");
    expect(await screen.findByRole("button", { name: "JSON bearbeiten" })).toBeTruthy();
  });

  it("edits a text field through the form and saves it", async () => {
    const u = await openSite();
    await u.type(screen.getByPlaceholderText(/section-key/), "hero");
    const headline = (await screen.findByText("Überschrift")).querySelector("input")!;
    await u.type(headline, "Digitalisierung");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect((puts()[0]!.body as { value: Record<string, unknown> }).value.headline).toBe("Digitalisierung");
  });

  it("PRESERVES keys the schema does not know about", async () => {
    // The core invariant: the form lists a subset of the block's keys. If it
    // replaced the object instead of spreading it, every unlisted key — and
    // the live section that reads it — would silently blank on the next save.
    const u = await openSite([{ section_key: "hero", lang: "de", updated_at: "x" }]);
    respond(/\/blocks\/hero\?lang=de$/, { value: { headline: "Alt", customKey: "behalten", nested: { a: 1 } } });
    await u.click(await screen.findByRole("button", { name: /hero/ }));

    const headline = await waitFor(() => {
      const el = screen.getByText("Überschrift").querySelector("input") as HTMLInputElement;
      expect(el.value).toBe("Alt");
      return el;
    });
    await u.clear(headline);
    await u.type(headline, "Neu");
    await u.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(puts()).toHaveLength(1));
    expect((puts()[0]!.body as { value: Record<string, unknown> }).value).toEqual({
      headline: "Neu",
      customKey: "behalten",
      nested: { a: 1 },
    });
  });

  it("round-trips form → JSON without losing a field", async () => {
    const u = await openSite();
    await u.type(screen.getByPlaceholderText(/section-key/), "hero");
    const headline = (await screen.findByText("Überschrift")).querySelector("input")!;
    await u.type(headline, "Wert");
    await u.click(screen.getByRole("button", { name: "JSON bearbeiten" }));
    expect(JSON.parse(jsonBox().value)).toMatchObject({ headline: "Wert" });
  });

  it("round-trips JSON → form", async () => {
    const u = await openSite();
    await u.type(screen.getByPlaceholderText(/section-key/), "hero");
    await u.click(await screen.findByRole("button", { name: "JSON bearbeiten" }));
    await setJson(u, '{"tagline":"Aus JSON"}');
    await u.click(screen.getByRole("button", { name: "Formular" }));
    const tagline = (await screen.findByText("Tagline")).querySelector("input") as HTMLInputElement;
    expect(tagline.value).toBe("Aus JSON");
  });

  it("refuses to enter the form from invalid JSON, and says why", async () => {
    const u = await openSite();
    await u.type(screen.getByPlaceholderText(/section-key/), "hero");
    await u.click(await screen.findByRole("button", { name: "JSON bearbeiten" }));
    await setJson(u, "{kaputt");
    await u.click(screen.getByRole("button", { name: "Formular" }));
    expect(await screen.findByText(/Formular nicht verfügbar/)).toBeTruthy();
    expect(jsonBox()).toBeTruthy();
  });
});

describe("typed fields in the structured form", () => {
  /** Open the pricing section, which carries every field type. */
  async function pricing() {
    const u = await openSite();
    await u.type(screen.getByPlaceholderText(/section-key/), "pricing");
    await screen.findByText("Pakete");
    return u;
  }

  const savedValue = async (u: ReturnType<typeof user>) => {
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    return (puts()[0]!.body as { value: Record<string, unknown> }).value;
  };

  it("adds a list entry with correctly typed blank fields", async () => {
    // A blank entry must not seed "" into a number or a checkbox.
    const u = await pricing();
    await u.click(screen.getByRole("button", { name: "+ Paket" }));
    const value = await savedValue(u);
    expect((value.items as unknown[])[0]).toEqual({
      title: "",
      rate: "",
      description: "",
      includes: [],
      highlight: false,
    });
  });

  it("stores a number field as a number, not a string", async () => {
    const u = await pricing();
    await u.click(screen.getByRole("button", { name: "+ Paket" }));
    const rate = (await screen.findByText(/Stundensatz/)).querySelector("input")!;
    await u.type(rate, "95");
    const value = await savedValue(u);
    expect((value.items as Array<{ rate: unknown }>)[0]!.rate).toBe(95);
  });

  it("stores a cleared number field as null rather than an empty string", async () => {
    const u = await pricing();
    await u.click(screen.getByRole("button", { name: "+ Paket" }));
    const rate = (await screen.findByText(/Stundensatz/)).querySelector("input")!;
    await u.type(rate, "95");
    await u.clear(rate);
    const value = await savedValue(u);
    expect((value.items as Array<{ rate: unknown }>)[0]!.rate).toBeNull();
  });

  it("stores a checkbox as a boolean", async () => {
    const u = await pricing();
    await u.click(screen.getByRole("button", { name: "+ Paket" }));
    const highlight = (await screen.findByText("Hervorheben")).querySelector("input")!;
    await u.click(highlight);
    const value = await savedValue(u);
    expect((value.items as Array<{ highlight: unknown }>)[0]!.highlight).toBe(true);
  });

  it("adds and fills a string-list entry", async () => {
    const u = await pricing();
    await u.click(screen.getByRole("button", { name: "+ Hinweis" }));
    const notes = screen.getByText("Hinweise").closest(".cms-form__stringlist")!;
    await u.type(within(notes).getAllByRole("textbox")[0]!, "Alle Preise netto");
    const value = await savedValue(u);
    expect(value.notes).toEqual(["Alle Preise netto"]);
  });

  it("removes a string-list entry", async () => {
    const u = await pricing();
    await u.click(screen.getByRole("button", { name: "+ Hinweis" }));
    await u.click(screen.getByRole("button", { name: "×" }));
    const value = await savedValue(u);
    expect(value.notes).toEqual([]);
  });

  it("removes a list entry", async () => {
    const u = await pricing();
    await u.click(screen.getByRole("button", { name: "+ Paket" }));
    await u.click(screen.getByRole("button", { name: "Eintrag entfernen" }));
    const value = await savedValue(u);
    expect(value.items).toEqual([]);
  });

  it("keeps list entries independent when one is edited", async () => {
    // A shared-reference bug here would write the same title into both.
    const u = await pricing();
    await u.click(screen.getByRole("button", { name: "+ Paket" }));
    await u.click(screen.getByRole("button", { name: "+ Paket" }));
    const titles = screen.getAllByText("Titel").map((l) => l.querySelector("input")!);
    await u.type(titles[0]!, "Basis");
    await u.type(titles[1]!, "Premium");
    const value = await savedValue(u);
    expect((value.items as Array<{ title: string }>).map((i) => i.title)).toEqual(["Basis", "Premium"]);
  });

  it("keeps an entry's OTHER fields when one of its fields is edited", async () => {
    // Editing a list item must merge into it, not replace it — otherwise
    // typing a title silently discards that package's rate and includes.
    const u = await pricing();
    await u.click(screen.getByRole("button", { name: "+ Paket" }));
    await u.type((await screen.findByText(/Stundensatz/)).querySelector("input")!, "95");
    await u.click(screen.getByRole("checkbox"));
    await u.type(screen.getByText("Titel").querySelector("input")!, "Basis");

    const value = await savedValue(u);
    expect((value.items as unknown[])[0]).toEqual({
      title: "Basis",
      rate: 95,
      description: "",
      includes: [],
      highlight: true,
    });
  });

  it("shows an empty-list hint until an entry is added", async () => {
    const u = await pricing();
    expect(screen.getAllByText("Noch keine Einträge.").length).toBeGreaterThan(0);
    await u.click(screen.getByRole("button", { name: "+ Paket" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Eintrag entfernen" })).toBeTruthy());
  });

  it("tolerates a stored list field that is not an array", async () => {
    // Hand-edited JSON can put anything here; the form must not crash.
    const u = await openSite([{ section_key: "pricing", lang: "de", updated_at: "x" }]);
    respond(/\/blocks\/pricing\?lang=de$/, { value: { items: "kaputt" } });
    await u.click(await screen.findByRole("button", { name: /pricing/ }));
    expect(await screen.findByText("Pakete")).toBeTruthy();
  });

  it("tolerates a block whose stored value is not an object", async () => {
    const u = await openSite([{ section_key: "hero", lang: "de", updated_at: "x" }]);
    respond(/\/blocks\/hero\?lang=de$/, { value: "kaputt" });
    await u.click(await screen.findByRole("button", { name: /hero/ }));
    const headline = (await screen.findByText("Überschrift")).querySelector("input") as HTMLInputElement;
    expect(headline.value).toBe("");
  });

  it("coerces a null stored value to an empty object rather than crashing", async () => {
    // A block row can legitimately hold null. Without the coercion the
    // structured form dereferences null and the whole editor white-screens.
    const u = await openSite([{ section_key: "hero", lang: "de", updated_at: "x" }]);
    respond(/\/blocks\/hero\?lang=de$/, { value: null });
    await u.click(await screen.findByRole("button", { name: /hero/ }));
    const headline = (await screen.findByText("Überschrift")).querySelector("input") as HTMLInputElement;
    expect(headline.value).toBe("");
  });

  it("coerces a stored array to an empty object", async () => {
    // Arrays would otherwise reach the form and save back numeric keys.
    const u = await openSite([{ section_key: "hero", lang: "de", updated_at: "x" }]);
    respond(/\/blocks\/hero\?lang=de$/, { value: ["a", "b"] });
    await u.click(await screen.findByRole("button", { name: /hero/ }));
    await u.type((await screen.findByText("Überschrift")).querySelector("input")!, "X");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect((puts()[0]!.body as { value: unknown }).value).toEqual({ headline: "X" });
  });
});

describe("rebuild and translation controls", () => {
  it("saves the rebuild configuration trimmed", async () => {
    const u = await openSite();
    await u.type(screen.getByPlaceholderText(/tds-landingpage-frontend/), "  o/r  ");
    await u.click(screen.getByRole("button", { name: "Konfiguration speichern" }));
    await waitFor(() => {
      const put = puts().find((c) => pathOf(c.url).includes("rebuild-config"));
      expect(put?.body).toMatchObject({ rebuild_repo: "o/r", rebuild_workflow: "dev.yml" });
    });
  });

  it("explains a 503 rebuild as a missing token", async () => {
    const u = await openSite();
    respond(/\/rebuild$/, {}, 503, "POST");
    await u.click(screen.getByRole("button", { name: "Jetzt neu bauen" }));
    expect(await screen.findByText(/Kein Rebuild-Token konfiguriert/)).toBeTruthy();
  });

  it("explains a 422 rebuild as a missing repository", async () => {
    const u = await openSite();
    respond(/\/rebuild$/, {}, 422, "POST");
    await u.click(screen.getByRole("button", { name: "Jetzt neu bauen" }));
    expect(await screen.findByText(/kein Repository hinterlegt/)).toBeTruthy();
  });

  it("reports an unexpected rebuild failure with its status", async () => {
    const u = await openSite();
    respond(/\/rebuild$/, {}, 500, "POST");
    await u.click(screen.getByRole("button", { name: "Jetzt neu bauen" }));
await waitFor(() => expect(toasts.some((t) => t.variant === "danger" && t.message.includes("500"))).toBe(true));
  });

  it("reports the counts from a translation backfill", async () => {
    const u = await openSite();
    respond(/\/translations\/backfill$/, { created: 2, skipped: 5 }, 200, "POST");
    await u.click(screen.getByRole("button", { name: "Übersetzungen nachziehen" }));
await waitFor(() => expect(toasts.some((t) => t.variant === "success" && /2 erstellt, 5 übersprungen/.test(t.message))).toBe(true));
  });

  it("explains a 503 backfill as DeepL not configured", async () => {
    const u = await openSite();
    respond(/\/translations\/backfill$/, {}, 503, "POST");
    await u.click(screen.getByRole("button", { name: "Übersetzungen nachziehen" }));
    expect(await screen.findByText(/nicht konfiguriert/)).toBeTruthy();
  });

  it("pre-fills the rebuild fields from the site record", async () => {
    await renderSites([{ ...SITE, rebuild_repo: "o/r", rebuild_workflow: "release.yml" }]);
    respond(/\/cms\/landing\/blocks$/, { blocks: [] });
    await user().click(await screen.findByRole("button", { name: /Landingpage/ }));
    expect((await screen.findByPlaceholderText(/tds-landingpage-frontend/) as HTMLInputElement).value).toBe("o/r");
    expect((screen.getByPlaceholderText("dev.yml") as HTMLInputElement).value).toBe("release.yml");
  });
});
