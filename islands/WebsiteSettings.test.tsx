// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WebsiteSettings from "./WebsiteSettings";
import { TOAST_EVENT } from "@tracht-digital-solutions/tds-shared/toast";

/**
 * The settings section talks to the core's runtime settings store
 * (`/admin/settings/website-cms`). Two invariants matter more than the rest:
 *
 *  - a secret NEVER round-trips to the UI — the store returns only
 *    `configured` + `last4`, and the inputs stay empty,
 *  - a BLANK secret on save means "keep the existing value", so an admin who
 *    only flips the auto-translate checkbox must not wipe the DeepL key.
 */

let calls: Array<{ url: string; method: string; body: unknown }> = [];
let getResponse: { status: number; body: unknown } = { status: 200, body: { settings: [] } };
let putStatus = 200;

/** Outcomes are toasts now — collected off the `tds:toast` bus. */
let toasts: Array<{ variant: string; message: string }> = [];
const collectToast = (e: Event) => {
  toasts.push((e as CustomEvent<{ variant: string; message: string }>).detail);
};

beforeEach(() => {
  toasts = [];
  window.addEventListener(TOAST_EVENT, collectToast);
  calls = [];
  getResponse = { status: 200, body: { settings: [] } };
  putStatus = 200;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      if (method === "PUT") {
        return { ok: putStatus < 300, status: putStatus, json: async () => ({}) } as Response;
      }
      return {
        ok: getResponse.status < 300,
        status: getResponse.status,
        json: async () => getResponse.body,
      } as Response;
    }),
  );
});

afterEach(() => {
  window.removeEventListener(TOAST_EVENT, collectToast);
  cleanup();
});

const user = () => userEvent.setup({ delay: null });
const NS = "/admin/settings/website-cms";

const CONFIGURED = {
  settings: [
    { key: "deepl_api_key", secret: true, configured: true, last4: "cd34" },
    { key: "rebuild_token", secret: true, configured: true, last4: "ef56" },
    { key: "auto_translate", secret: false, value: "1" },
  ],
};

/** Render and wait for the mount fetch to resolve. */
async function renderSettings() {
  render(<WebsiteSettings />);
  await waitFor(() => expect(calls.some((c) => pathOf(c.url) === NS && c.method === "GET")).toBe(true));
}

const put = () => calls.find((c) => c.method === "PUT");

/**
 * Path + query of a request. The island calls an ABSOLUTE URL now (via
 * `apiFetch`); a relative one would hit the product's own static host and come
 * back as SPA-fallback HTML with a 200. Matching on the path keeps the route
 * matchers below anchored.
 */
const pathOf = (url: string) => String(url).replace(/^https?:\/\/[^/]+/i, "");

const sent = () => (put()!.body as { settings: Array<{ key: string; value: string; secret: boolean }> }).settings;
const valueOf = (key: string) => sent().find((s) => s.key === key)!.value;

describe("loading", () => {
  it("reads the website-cms namespace with credentials", async () => {
    await renderSettings();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(pathOf(fetchMock.mock.calls[0]![0] as string)).toBe(NS);
    // Absolute, on the API host. Every other assertion here matches the PATH,
    // which a relative fetch satisfies too — so this is the one that fails if
    // the call ever goes back to the product's own origin (whose SPA fallback
    // answers 200 + HTML and turns into a silent empty state).
    expect(String(fetchMock.mock.calls[0]![0]).startsWith("https://api.tracht-digital.de/")).toBe(true);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: "include" });
  });

  it("shows which secrets are configured, by last4 only", async () => {
    getResponse = { status: 200, body: CONFIGURED };
    await renderSettings();
    expect(await screen.findByText(/konfiguriert \(…cd34\)/)).toBeTruthy();
    expect(screen.getByText(/konfiguriert \(…ef56\)/)).toBeTruthy();
  });

  it("leaves the secret inputs empty even when a secret is configured", async () => {
    // The raw key must never reach the DOM.
    getResponse = { status: 200, body: CONFIGURED };
    await renderSettings();
    await screen.findByText(/…cd34/);
    for (const input of screen.getAllByPlaceholderText(/leer = behalten/)) {
      expect((input as HTMLInputElement).value).toBe("");
    }
  });

  it("masks the secret inputs as password fields", async () => {
    await renderSettings();
    const inputs = await screen.findAllByPlaceholderText(/leer = behalten/);
    for (const input of inputs) expect((input as HTMLInputElement).type).toBe("password");
  });

  it("reports an unconfigured secret plainly", async () => {
    await renderSettings();
    expect(await screen.findAllByText(/nicht konfiguriert/)).toHaveLength(2);
  });

  it("falls back to ???? when a configured secret has no last4", async () => {
    getResponse = { status: 200, body: { settings: [{ key: "deepl_api_key", secret: true, configured: true }] } };
    await renderSettings();
    expect(await screen.findByText(/konfiguriert \(…\?\?\?\?\)/)).toBeTruthy();
  });

  it("explains a 403 as an admin-only section", async () => {
    getResponse = { status: 403, body: {} };
    await renderSettings();
    expect(await screen.findByText("Nur für Administratoren.")).toBeTruthy();
  });

  it("explains a 401 the same way", async () => {
    getResponse = { status: 401, body: {} };
    await renderSettings();
    expect(await screen.findByText("Nur für Administratoren.")).toBeTruthy();
  });

  it("reports any other failure with its status", async () => {
    getResponse = { status: 500, body: {} };
    await renderSettings();
    expect(await screen.findByText("Fehler (HTTP 500).")).toBeTruthy();
  });

  it("leaves the loading branch even when the request fails", async () => {
    // Otherwise the section renders a permanent spinner.
    getResponse = { status: 500, body: {} };
    await renderSettings();
    await waitFor(() => expect(screen.queryByLabelText("Wird geladen")).toBeNull());
  });
});

describe("auto-translate", () => {
  it("defaults to on when the store has no value", async () => {
    await renderSettings();
    expect(((await screen.findByRole("checkbox")) as HTMLInputElement).checked).toBe(true);
  });

  it('treats the stored "0" as off', async () => {
    getResponse = { status: 200, body: { settings: [{ key: "auto_translate", secret: false, value: "0" }] } };
    await renderSettings();
    expect(((await screen.findByRole("checkbox")) as HTMLInputElement).checked).toBe(false);
  });

  it('treats the stored "1" as on', async () => {
    getResponse = { status: 200, body: { settings: [{ key: "auto_translate", secret: false, value: "1" }] } };
    await renderSettings();
    expect(((await screen.findByRole("checkbox")) as HTMLInputElement).checked).toBe(true);
  });

  it('persists as "1" / "0", the shape the PHP module reads', async () => {
    await renderSettings();
    const u = user();
    await u.click(await screen.findByRole("checkbox"));
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(put()).toBeDefined());
    expect(valueOf("auto_translate")).toBe("0");
  });
});

describe("saving", () => {
  it("PUTs all three keys to the namespace", async () => {
    await renderSettings();
    await user().click(await screen.findByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(put()).toBeDefined());
    expect(pathOf(put()!.url)).toBe(NS);
    expect(sent().map((s) => s.key).sort()).toEqual(["auto_translate", "deepl_api_key", "rebuild_token"]);
  });

  it("sends a blank secret when the admin did not retype one — meaning KEEP", async () => {
    // The regression that matters: a non-blank placeholder here would
    // overwrite a working DeepL key with junk on every unrelated save.
    getResponse = { status: 200, body: CONFIGURED };
    await renderSettings();
    await screen.findByText(/…cd34/);
    await user().click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(put()).toBeDefined());
    expect(valueOf("deepl_api_key")).toBe("");
    expect(valueOf("rebuild_token")).toBe("");
  });

  it("marks the secrets as secret and the flag as not secret", async () => {
    await renderSettings();
    await user().click(await screen.findByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(put()).toBeDefined());
    const bySecret = Object.fromEntries(sent().map((s) => [s.key, s.secret]));
    expect(bySecret).toEqual({ deepl_api_key: true, rebuild_token: true, auto_translate: false });
  });

  it("trims a pasted key so a stray newline cannot break the API call", async () => {
    await renderSettings();
    const u = user();
    const [deepl] = await screen.findAllByPlaceholderText(/leer = behalten/);
    await u.type(deepl!, "  abc123  ");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(put()).toBeDefined());
    expect(valueOf("deepl_api_key")).toBe("abc123");
  });

  it("clears the inputs and re-reads the masked state after a save", async () => {
    await renderSettings();
    const u = user();
    const [deepl] = await screen.findAllByPlaceholderText(/leer = behalten/);
    await u.type(deepl!, "secret");
    await u.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(toasts.some((t) => t.variant === "success" && t.message.includes("Gespeichert"))).toBe(true));
    expect((deepl as HTMLInputElement).value).toBe("");
    await waitFor(() => expect(calls.filter((c) => c.method === "GET")).toHaveLength(2));
  });

  it("keeps a typed secret in the box when the save fails", async () => {
    putStatus = 500;
    await renderSettings();
    const u = user();
    const [deepl] = await screen.findAllByPlaceholderText(/leer = behalten/);
    await u.type(deepl!, "secret");
    await u.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(toasts.some((t) => t.variant === "danger" && t.message.includes("500"))).toBe(true));
    expect((deepl as HTMLInputElement).value).toBe("secret");
  });

  it("does not re-read the store after a failed save", async () => {
    putStatus = 500;
    await renderSettings();
    await user().click(await screen.findByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(toasts.some((t) => t.variant === "danger" && t.message.includes("500"))).toBe(true));
    expect(calls.filter((c) => c.method === "GET")).toHaveLength(1);
  });

  it("sends JSON with the content type the API expects", async () => {
    await renderSettings();
    await user().click(await screen.findByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(put()).toBeDefined());
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const putCall = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === "PUT")!;
    expect((putCall[1] as RequestInit).headers).toMatchObject({ "Content-Type": "application/json" });
  });
});
