// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { primeRuntimeConfig } from "@tracht-digital-solutions/tds-shared/api";
import { put, resetCache } from "@tracht-digital-solutions/tds-shared/data";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SiteRegistry from "./SiteRegistry";
import { TOAST_EVENT } from "@tracht-digital-solutions/tds-shared/toast";

/**
 * The managed-website registry, in Einstellungen.
 *
 * This is where a website is ADDED — it used to sit on the content screen,
 * above the text somebody had come to edit, next to a GitHub repository field
 * and a deploy button. The tests below are about the two things that move
 * money: the key can never be corrected later, and the two rebuild buttons do
 * completely different things while sounding alike.
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
  rebuild_repo: "Tracht-Digital-Solutions/tds-landingpage-frontend",
  rebuild_workflow: "dev.yml",
  cache_url: "https://tracht-digital.de",
  updated_at: "2026-01-01",
};

async function renderRegistry(sites: unknown[] = [SITE]) {
  // Method-scoped: `respond` puts the newest matcher first, so an unscoped GET
  // handler registered here would also answer a POST a test set up earlier.
  respond(/\/cms\/sites$/, { sites }, 200, "GET");
  render(<SiteRegistry />);
  await waitFor(() => expect(calls.some((c) => pathOf(c.url) === "/cms/sites")).toBe(true));
  return user();
}

const posts = () => calls.filter((c) => c.method === "POST");
const puts = () => calls.filter((c) => c.method === "PUT");

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

describe("per-site configuration", () => {
  it("saves the cache address and the rebuild target together", async () => {
    const u = await renderRegistry();
    const url = await screen.findByLabelText("Adresse der öffentlichen Website");
    await u.clear(url);
    await u.type(url, "https://neu.example");
    await u.click(screen.getByRole("button", { name: "Konfiguration speichern" }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(pathOf(puts()[0]!.url)).toBe("/cms/sites/landing/rebuild-config");
    expect(puts()[0]!.body).toMatchObject({
      cache_url: "https://neu.example",
      rebuild_repo: "Tracht-Digital-Solutions/tds-landingpage-frontend",
      rebuild_workflow: "dev.yml",
    });
  });

  it("keeps the two rebuild buttons on separate routes", async () => {
    // They sound alike and are not: one dispatches a CI build that ships code,
    // the other re-renders pages from content already stored. Confusing them
    // costs minutes and a deploy.
    const u = await renderRegistry();
    await u.click(await screen.findByRole("button", { name: "Seiten-Cache neu bauen" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(pathOf(posts()[0]!.url)).toBe("/cms/sites/landing/cache/rebuild");

    await u.click(screen.getByRole("button", { name: "Jetzt neu bauen (CI)" }));
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(pathOf(posts()[1]!.url)).toBe("/cms/sites/landing/rebuild");
  });

  it("asks the cache to rebuild everything, not one page", async () => {
    // This button is the catch-up for when a save's targeted rebuild did not
    // land, so it must not be targeted itself.
    const u = await renderRegistry();
    await u.click(await screen.findByRole("button", { name: "Seiten-Cache neu bauen" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toMatchObject({ all: true });
  });

  it("keeps a missing configuration in the flow rather than as a toast", async () => {
    // A vanishing message would leave the operator pressing a button that can
    // never work.
    respond(/\/cms\/sites\/landing\/rebuild$/, {}, 422, "POST");
    const u = await renderRegistry();
    await u.click(await screen.findByRole("button", { name: "Jetzt neu bauen (CI)" }));
    expect(await screen.findByRole("status")).toHaveProperty(
      "textContent",
      expect.stringContaining("kein Repository"),
    );
  });

  it("reports the status when the cache rebuild fails outright", async () => {
    respond(/\/cms\/sites\/landing\/cache\/rebuild$/, {}, 500, "POST");
    const u = await renderRegistry();
    await u.click(await screen.findByRole("button", { name: "Seiten-Cache neu bauen" }));
    await waitFor(() => expect(toasts.length).toBeGreaterThan(0));
    expect(toasts[toasts.length - 1]!.message).toContain("500");
  });

  it("keeps a missing cache token in the flow", async () => {
    respond(/\/cms\/sites\/landing\/cache\/rebuild$/, {}, 503, "POST");
    const u = await renderRegistry();
    await u.click(await screen.findByRole("button", { name: "Seiten-Cache neu bauen" }));
    expect(await screen.findByRole("status")).toHaveProperty(
      "textContent",
      expect.stringContaining("Seiten-Cache-Token"),
    );
  });

  it("refreshes untouched fields when SWR returns a newer site row", async () => {
    const now = Date.now();
    put("/cms/sites", { sites: [SITE] });
    vi.spyOn(Date, "now").mockReturnValue(now + 31_000);
    respond(/\/cms\/sites$/, { sites: [{ ...SITE, cache_url: "https://neu.example" }] }, 200, "GET");
    render(<SiteRegistry />);
    await waitFor(() =>
      expect((screen.getByLabelText("Adresse der öffentlichen Website") as HTMLInputElement).value).toBe(
        "https://neu.example",
      ),
    );
  });

  it("does not overwrite a configuration edit when the SWR refresh finishes", async () => {
    const now = Date.now();
    put("/cms/sites", { sites: [SITE] });
    vi.spyOn(Date, "now").mockReturnValue(now + 31_000);
    let finish!: () => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => {
        finish = () => resolve({
          ok: true,
          status: 200,
          json: async () => ({ sites: [{ ...SITE, cache_url: "https://neu-vom-server.example" }] }),
        } as Response);
      })),
    );

    render(<SiteRegistry />);
    const input = (await screen.findByLabelText("Adresse der öffentlichen Website")) as HTMLInputElement;
    const u = user();
    await u.clear(input);
    await u.type(input, "https://mein-entwurf.example");
    await act(async () => finish());
    await waitFor(() => expect(input.value).toBe("https://mein-entwurf.example"));
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
