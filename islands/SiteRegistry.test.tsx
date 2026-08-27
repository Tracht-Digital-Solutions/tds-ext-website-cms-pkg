// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { primeRuntimeConfig } from "@tracht-digital-solutions/tds-shared/api";
import { resetCache } from "@tracht-digital-solutions/tds-shared/data";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SiteRegistry from "./SiteRegistry";
import { TOAST_EVENT } from "@tracht-digital-solutions/tds-shared/toast";

/**
 * The managed-website registry, in Einstellungen.
 *
 * This is where a website is added and connected to the API. The tests pin the
 * immutable registry key, one-click pairing, explicit blog binding and
 * truthful cache outcomes.
 */

type Hit = { status?: number; body?: unknown };
let handlers: Array<(url: string, init?: RequestInit) => Hit | undefined> = [];
let calls: Array<{ url: string; method: string; body: unknown }> = [];

const pathOf = (url: string) => String(url).replace(/^https?:\/\/[^/]+/i, "");

function respond(match: RegExp, body: unknown, status = 200, method?: string) {
  handlers.unshift((url, init) => {
    if (!match.test(pathOf(url))) return undefined;
    if (method && (init?.method ?? "GET") !== method) return undefined;
    return { status, body };
  });
}

let toasts: Array<{ variant: string; message: string }> = [];
const collectToast = (e: Event) => {
  toasts.push((e as CustomEvent<{ variant: string; message: string }>).detail);
};

beforeEach(() => {
  resetCache();
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
  updated_at: "2026-01-01",
};

async function renderRegistry(
  sites: unknown[] = [SITE],
  blogs: unknown[] = [],
) {
  // Method-scoped: `respond` puts the newest matcher first, so an unscoped GET
  // handler registered here would also answer a POST a test set up earlier.
  respond(/\/cms\/sites$/, { sites }, 200, "GET");
  respond(/\/blogs$/, { blogs }, 200, "GET");
  respond(/\/cms\/sites\/[^/]+\/connection$/, {}, 404, "GET");
  render(<SiteRegistry />);
  await waitFor(() => expect(calls.some((c) => pathOf(c.url) === "/cms/sites")).toBe(true));
  return user();
}

const posts = () => calls.filter((c) => c.method === "POST");

describe("adding a website", () => {
  it("posts a valid kebab key and name", async () => {
    const u = await renderRegistry([]);
    await u.type(screen.getByLabelText("Schlüssel"), "shop");
    await u.type(screen.getByLabelText("Name"), "Shop");
    await u.click(screen.getByRole("button", { name: "Website hinzufügen" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(pathOf(posts()[0]!.url)).toBe("/cms/sites");
    expect(posts()[0]!.body).toMatchObject({ site_key: "shop", name: "Shop" });
  });

  it("refuses an invalid key before it reaches the API", async () => {
    // The key is the join between the content and the public site and cannot
    // be changed afterwards, so a typo is a site nobody can edit.
    const u = await renderRegistry([]);
    await u.type(screen.getByLabelText("Schlüssel"), "Shop Site");
    await u.type(screen.getByLabelText("Name"), "Shop");
    await u.click(screen.getByRole("button", { name: "Website hinzufügen" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(posts()).toHaveLength(0);
  });

  it("refuses a blank name", async () => {
    const u = await renderRegistry([]);
    await u.type(screen.getByLabelText("Schlüssel"), "shop");
    await u.click(screen.getByRole("button", { name: "Website hinzufügen" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(posts()).toHaveLength(0);
  });

  it("reports the HTTP status when the create fails", async () => {
    // 409 (already exists) and 403 (not allowed) need very different fixes.
    respond(/\/cms\/sites$/, {}, 409, "POST");
    const u = await renderRegistry([]);
    await u.type(screen.getByLabelText("Schlüssel"), "landing");
    await u.type(screen.getByLabelText("Name"), "Nochmal");
    await u.click(screen.getByRole("button", { name: "Website hinzufügen" }));
    await waitFor(() => expect(toasts.length).toBeGreaterThan(0));
    expect(toasts[toasts.length - 1]!.message).toContain("409");
  });

  it("clears the form after a successful create", async () => {
    const u = await renderRegistry([]);
    await u.type(screen.getByLabelText("Schlüssel"), "shop");
    await u.type(screen.getByLabelText("Name"), "Shop");
    await u.click(screen.getByRole("button", { name: "Website hinzufügen" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    await waitFor(() => expect((screen.getByLabelText("Schlüssel") as HTMLInputElement).value).toBe(""));
  });
});

describe("per-site API connection", () => {
  it("pairs the site and exposes a direct-install fallback only as a URL fragment", async () => {
    const fallback = "https://site.example/install#pairing_token=once-only-secret";
    respond(/\/cms\/sites\/landing\/connection\/pairing$/, {
      delivered: false,
      fallback_url: fallback,
    }, 201, "POST");
    const u = await renderRegistry();
    await u.type(await screen.findByLabelText("Adresse der öffentlichen Website"), "https://site.example");
    await u.click(screen.getByRole("button", { name: "Mit API verbinden" }));

    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(pathOf(posts()[0]!.url)).toBe("/cms/sites/landing/connection/pairing");
    expect(posts()[0]!.body).toEqual({ origin: "https://site.example", profile: "landingpage", bindings: {} });
    expect(JSON.stringify(posts()[0]!.body)).not.toContain("once-only-secret");
    expect((await screen.findByRole("link", { name: "Einrichtungslink öffnen" })).getAttribute("href")).toBe(fallback);
  });

  it("requires an explicit blog when more than one can provide journal content", async () => {
    respond(/\/cms\/sites\/landing\/connection\/pairing$/, { delivered: true }, 201, "POST");
    const u = await renderRegistry([SITE], [
      { blog_key: "haupt", name: "Hauptblog" },
      { blog_key: "journal", name: "Journal" },
    ]);
    await u.type(await screen.findByLabelText("Adresse der öffentlichen Website"), "https://site.example");
    const connect = screen.getByRole("button", { name: "Mit API verbinden" });
    expect((connect as HTMLButtonElement).disabled).toBe(true);
    await u.selectOptions(screen.getByLabelText(/Blog-Inhalte verwenden/), "journal");
    await u.click(connect);

    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toMatchObject({ bindings: { blog: "journal" } });
  });

  it("asks the cache to rebuild everything, not one page", async () => {
    // This button is the catch-up for when a save's targeted rebuild did not
    // land, so it must not be targeted itself.
    const u = await renderRegistry();
    await u.click(await screen.findByRole("button", { name: "Seiten-Cache neu bauen" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toMatchObject({ all: true });
  });

  it("keeps a remote cache failure in the flow", async () => {
    respond(/\/cms\/sites\/landing\/cache\/rebuild$/, {}, 502, "POST");
    const u = await renderRegistry();
    await u.click(await screen.findByRole("button", { name: "Seiten-Cache neu bauen" }));
    expect(await screen.findByText(/Cache-Neubau ist fehlgeschlagen/)).toBeTruthy();
  });

  it("keeps a missing connection in the flow", async () => {
    respond(/\/cms\/sites\/landing\/cache\/rebuild$/, {}, 503, "POST");
    const u = await renderRegistry();
    await u.click(await screen.findByRole("button", { name: "Seiten-Cache neu bauen" }));
    expect(await screen.findByText(/noch nicht vollständig mit der API verbunden/)).toBeTruthy();
  });
});

describe("the list itself", () => {
  it("reports the HTTP status instead of an empty registry", async () => {
    respond(/\/cms\/sites$/, {}, 403);
    render(<SiteRegistry />);
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("403"),
    );
  });

  it("says plainly when nothing is connected", async () => {
    await renderRegistry([]);
    expect(await screen.findByText(/Noch keine Website verbunden/)).toBeTruthy();
  });
});
