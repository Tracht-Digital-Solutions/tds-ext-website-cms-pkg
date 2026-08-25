// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { primeRuntimeConfig } from "@tracht-digital-solutions/tds-shared/api";
import { resetCache } from "@tracht-digital-solutions/tds-shared/data";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LegalDocs from "./LegalDocs";
import { TOAST_EVENT } from "@tracht-digital-solutions/tds-shared/toast";

/**
 * The legal-document (AGB) uploader. What can actually go wrong here:
 *
 *  - the upload is **multipart**, so it must NOT carry a JSON Content-Type —
 *    setting one strips the boundary and the server sees no file at all,
 *  - a rejected upload must say why *in the flow* (415/413 name something the
 *    editor has to fix) while a transport failure is a toast carrying the
 *    status — and neither may look like a success,
 *  - the "Ansehen" link and every call must be ABSOLUTE, on the API host: the
 *    panel is served from a static host whose SPA fallback answers 200 + HTML.
 */

type Hit = { status?: number; body?: unknown };
let handlers: Array<(url: string, init?: RequestInit) => Hit | undefined> = [];
let calls: Array<{ url: string; method: string; init?: RequestInit }> = [];

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
  toasts = [];
  window.addEventListener(TOAST_EVENT, collectToast);
  handlers = [];
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", init });
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

const DOC = {
  docKey: "agb",
  lang: "de",
  filename: "AGB_2026.pdf",
  sizeBytes: 92_160,
  versionLabel: "Stand: 09/2025",
  updatedAt: "2026-08-12 10:00:00",
};

async function renderDocs(docs: unknown[] = []) {
  respond(/\/cms\/sites\/landing\/legal$/, { docs });
  render(<LegalDocs siteKey="landing" />);
  await waitFor(() => expect(calls.some((c) => pathOf(c.url) === "/cms/sites/landing/legal")).toBe(true));
}

const pdf = (name = "agb.pdf") => new File(["%PDF-1.7 ..."], name, { type: "application/pdf" });

/** Put a file into the file input, which userEvent.upload drives properly. */
async function pick(u: ReturnType<typeof user>, file = pdf()) {
  await u.upload(screen.getByLabelText("PDF-Datei") as HTMLInputElement, file);
}

const uploadCall = () => calls.find((c) => c.method === "POST");

// apiFetch consults the host-side runtime config (/tds-runtime.json) before it
// resolves a URL, so without this the first entry in fetch.mock.calls is that
// probe rather than the endpoint under test. The panel products never ship the
// file — they render <meta name="tds-api-base"> instead — so "absent" is also
// what actually happens in production.
beforeEach(() => primeRuntimeConfig(null));

describe("listing", () => {
  it("reads the site's documents from the API host, with credentials", async () => {
    await renderDocs();
    // Every other assertion here matches the PATH, which a relative fetch
    // satisfies just as well — this is the one that fails if the call ever
    // goes back to the product's own origin.
    expect(calls[0]!.url.startsWith("https://api.tracht-digital.de/")).toBe(true);
    expect(calls[0]!.init).toMatchObject({ credentials: "include" });
  });

  it("shows an empty state when nothing is uploaded yet", async () => {
    await renderDocs();
    expect(await screen.findByText(/Noch keine Dokumente/)).toBeTruthy();
  });

  it("lists a document with its size and Stand", async () => {
    await renderDocs([DOC]);
    expect(await screen.findByText("agb")).toBeTruthy();
    expect(screen.getByText(/AGB_2026\.pdf/)).toBeTruthy();
    expect(screen.getByText(/90 KB/)).toBeTruthy();
    expect(screen.getByText("Stand: 09/2025")).toBeTruthy();
  });

  it("links the preview at an absolute API URL", async () => {
    await renderDocs([DOC]);
    const link = (await screen.findByRole("link", { name: "Ansehen" })) as HTMLAnchorElement;
    expect(link.href).toBe("https://api.tracht-digital.de/cms/sites/landing/legal/agb/file?lang=de");
    expect(link.rel).toContain("noopener");
  });

  it("shows the failure instead of pretending the document list is empty", async () => {
    respond(/\/cms\/sites\/landing\/legal$/, { error: "boom" }, 500);
    render(<LegalDocs siteKey="landing" />);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("500"));
    expect(screen.queryByText(/Noch keine Dokumente/)).toBeNull();
  });
});

describe("upload", () => {
  it("posts multipart WITHOUT a JSON content-type", async () => {
    await renderDocs();
    const u = user();
    await pick(u);
    await u.click(screen.getByRole("button", { name: "Hochladen" }));

    await waitFor(() => expect(uploadCall()).toBeTruthy());
    const call = uploadCall()!;
    expect(pathOf(call.url)).toBe("/cms/sites/landing/legal/agb");
    // A hand-set Content-Type would strip the multipart boundary and the
    // server would find no file — the browser must set it. Asserted as "no
    // such header" rather than "headers is undefined": apiFetch passes an empty
    // object now, which is the same thing to the browser, and the boundary is
    // what actually matters here.
    const headers = new Headers((call.init?.headers ?? {}) as HeadersInit);
    expect(headers.get("content-type")).toBeNull();
    expect(call.init?.body).toBeInstanceOf(FormData);
  });

  it("sends the chosen language and Stand alongside the file", async () => {
    await renderDocs();
    const u = user();
    await u.selectOptions(screen.getByLabelText("Sprache"), "en");
    await u.type(screen.getByLabelText("Stand (optional)"), "Version 2.0");
    await pick(u);
    await u.click(screen.getByRole("button", { name: "Hochladen" }));

    await waitFor(() => expect(uploadCall()).toBeTruthy());
    const body = uploadCall()!.init!.body as FormData;
    expect(body.get("lang")).toBe("en");
    expect(body.get("version_label")).toBe("Version 2.0");
    expect((body.get("file") as File).name).toBe("agb.pdf");
  });

  it("refuses to submit with no file chosen, and does not call the API", async () => {
    await renderDocs();
    await user().click(screen.getByRole("button", { name: "Hochladen" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Bitte eine PDF-Datei auswählen.");
    expect(uploadCall()).toBeUndefined();
  });

  it("reports a rejected non-PDF in the flow, not as a success", async () => {
    await renderDocs();
    respond(/\/legal\/agb$/, { error: "no" }, 415, "POST");
    const u = user();
    await pick(u);
    await u.click(screen.getByRole("button", { name: "Hochladen" }));

    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Nur PDF-Dateien werden akzeptiert.");
    expect(toasts.some((t) => t.variant === "success")).toBe(false);
  });

  it("reports an oversize file in the flow", async () => {
    await renderDocs();
    respond(/\/legal\/agb$/, { error: "no" }, 413, "POST");
    const u = user();
    await pick(u);
    await u.click(screen.getByRole("button", { name: "Hochladen" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Die Datei ist größer als 8 MB.");
  });

  it("toasts an unexpected failure WITH its status", async () => {
    await renderDocs();
    respond(/\/legal\/agb$/, { error: "no" }, 403, "POST");
    const u = user();
    await pick(u);
    await u.click(screen.getByRole("button", { name: "Hochladen" }));

    // The status is what separates "session expired" from "service down" in a
    // bug report — never drop it.
    await waitFor(() => expect(toasts.some((t) => t.variant === "danger" && /403/.test(t.message))).toBe(true));
    expect(toasts.some((t) => t.variant === "success")).toBe(false);
  });

  it("reloads the list after a successful upload", async () => {
    await renderDocs();
    respond(/\/legal\/agb$/, { ok: true }, 201, "POST");
    const u = user();
    await pick(u);
    await u.click(screen.getByRole("button", { name: "Hochladen" }));

    await waitFor(() =>
      expect(calls.filter((c) => pathOf(c.url) === "/cms/sites/landing/legal" && c.method === "GET")).toHaveLength(2),
    );
    expect(toasts.some((t) => t.variant === "success")).toBe(true);
  });

  it("rejects an invalid document key before calling the API", async () => {
    await renderDocs();
    const u = user();
    const key = screen.getByLabelText("Dokument");
    await u.clear(key);
    await u.type(key, "x");
    await pick(u);
    await u.click(screen.getByRole("button", { name: "Hochladen" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(uploadCall()).toBeUndefined();
  });
});

describe("delete", () => {
  it("deletes the right language and reloads", async () => {
    await renderDocs([DOC, { ...DOC, lang: "en" }]);
    respond(/\/legal\/agb\?lang=en$/, { ok: true }, 200, "DELETE");
    await user().click((await screen.findAllByRole("button", { name: "Entfernen" }))[1]!);

    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
    expect(pathOf(calls.find((c) => c.method === "DELETE")!.url)).toBe("/cms/sites/landing/legal/agb?lang=en");
  });

  it("toasts a failed delete with its status and does not claim success", async () => {
    await renderDocs([DOC]);
    respond(/\/legal\/agb\?lang=de$/, { error: "no" }, 500, "DELETE");
    await user().click(await screen.findByRole("button", { name: "Entfernen" }));

    await waitFor(() => expect(toasts.some((t) => t.variant === "danger" && /500/.test(t.message))).toBe(true));
    expect(toasts.some((t) => t.variant === "success")).toBe(false);
  });
});
