# AGENTS.md — tds-ext-website-cms-pkg

Website-CMS extension, ported from `tds-content-api`'s content-block model. Read
`tds-frontend-contract-pkg` + `tds-core-frontend-api` AGENTS first.

## Model

- **Request-rendered content behind a file/page cache**, never a browser-side
  content fetch: `cms_block` rows (one per site × section × language,
  `value_json`) are read by the public site's server while rendering and merged
  over defaults; a missing row falls back. A mutation sends semantic
  `CacheEvent`s so that site can rebuild only the affected pages/partials.
- **Legal documents are the same model with bytes instead of JSON.**
  `cms_legal_doc` (one per site × `doc_key` × language) holds an uploaded PDF —
  the AGB today. There is no text to edit: the uploaded file *is* the managed
  document. The public server reads it while rendering; the landingpage may use
  a committed fallback when no upload exists. Upload/delete sends a targeted
  legal-document cache event, not a CI build.
- **1:n sites:** the `cms_site` registry scopes blocks. `cms_block.site_id` FK →
  `cms_site` (CASCADE). Unique `(site_id, section_key, lang)`.
- **Registration/configuration lives only under Einstellungen → Website-CMS.**
  `/website` is the daily content screen: choose site → page → section → DE/EN.
  Known pages/sections and both languages must remain selectable before a row
  exists, so an editor can create the first override (`Vorgabe`).
- **Auth via the core `UserContext`** — `website:read`/`website:write` (admins
  bypass). Blocks are upserted (PUT, `ON DUPLICATE KEY`).
- Denormalised JSON on purpose (small, read once per render/cache fill, shapes differ per
  section) — the API validator owns shape correctness.

## Gotchas

- **Never guard a container binding with `!$c->has(X::class)` — saving a content
  block 500'd for months because of it.** PHP-DI answers `has()` out of its
  definition sources, and *autowiring is one of them*: for any concrete,
  instantiable class the answer is always `true`, bound or not. So

  ```php
  if ($c !== null && !$c->has(TranslationSync::class)) { $c->set(…); }   // never runs
  ```

  skipped every binding it protected, and the container quietly autowired
  instead. For `CmsRepository` that is invisible — its only argument is the
  bound `PDO`, so the autowired object is identical. For `RebuildTrigger` and
  `TranslationSync` it is fatal, because their constructors take **strings**:

  ```
  Entry "…\Service\TranslationSync" cannot be resolved: Entry "…\Service\DeeplTranslator"
  cannot be resolved: Parameter $apiKey of __construct() has no value defined or guessable
  ```

  Reading the CMS worked; `PUT /cms/{site}/blocks/{key}`, the delete and the
  translation backfill answered **500**, and the settings-store factories (DeepL
  key, rebuild PAT) had never run once — so those panel settings were dead too.
  Nothing anywhere went red at the time: this repo's CI ran type-check + build,
  not tests;
  the composed API's `CompositionTest` only checks that routes are *mounted*; and
  a PHP-DI entry is built lazily, so a broken binding costs nothing until
  somebody saves. The module owns these classes and nothing else defines them,
  so **bind unconditionally**. Pinned by `ExtensionBindingsTest` in
  `tds-core-frontend-api`, which reads the `$c->set(…)` calls out of every
  composed module's source and resolves each one.

- **Call the API with `apiFetch` from `@tracht-digital-solutions/tds-shared/api`,
  never a relative `fetch`.** Every island used to define its own
  `const api = (path, init) => fetch(path, { credentials: "include", ...init })`
  with a RELATIVE path. In a product that resolves against the product's own
  static host (`management.`/`app.tracht-digital.de`), not the API — and the
  static host answers unknown paths with its SPA fallback, i.e. **200 + HTML**.
  So `res.ok` is `true`, `res.json()` throws, and the usual
  `.catch(() => setRows([]))` renders a calm, permanent empty state with no
  error and no console warning. `apiFetch` resolves the base from
  `<meta name="tds-api-base">` (written by the frontend host) and routes 401s
  through the host's confirm-against-`/me` backstop, which extension calls
  previously skipped entirely.
  The island tests match on the request PATH (`pathOf()`), which a relative
  fetch satisfies just as well — so one assertion per suite pins the **absolute
  host**. That is the line that fails if this ever regresses.


- **Public read surface (UNAUTHENTICATED).** Alongside the admin (`website:read`/
  `website:write`) routes, this module serves the successor to tds-content-api's
  open `GET /content/landing` that the public landingpage + blog servers read
  while rendering:
  it returns the **default site**'s (`defaultSite()`) content blocks for a language
  as a `{blocks: {section_key: value}}` map (landing sections + the blog's
  `cookie_banner`/`ads` config blocks). **Degrades to `{blocks:{}}` on any DB
  error** (render-time fail-safe) — keep it read-only and ungated.
- **A legal document's bytes live in the DB, not on disk** — deliberately
  different from `tds-ext-documents-pkg`, which stores customer documents under
  `DOCUMENT_ROOT_DIR`. These are a handful of small files (8 MB cap, the real
  AGB is ~90 KB) read only for a render/cache fill; a `MEDIUMBLOB` needs no new
  writable
  directory on the Plesk host, and host-side setup is this platform's chronic
  go-live blocker. Every metadata query therefore names its columns instead of
  `SELECT *`, so listing documents does not drag the blobs through PHP.
- **Trust the magic number, not the media type.** A multipart upload's
  `Content-Type` and filename are both attacker-supplied; the route sniffs
  `%PDF-` in the first KB and 415s otherwise. `LegalDocFile::sanitizeFilename()`
  is what makes the value safe to echo into a `Content-Disposition` — it is the
  only thing standing between a crafted filename and header injection, and the
  module test pins it.
- **`GET /content/legal*` is the second UNAUTHENTICATED surface** (alongside
  `/content/landing`) and answers for the **default site only**. That is why the
  admin preview route exists separately: an editor managing a second site cannot
  reach its documents through the public one.
- Migration class names are **module-prefixed** (`WebsiteCms*`) AND the numeric
  **version prefixes are globally unique** (this module owns the `20260727*`
  band) — every composed module's migrations share one `phinxlog`, so a reused
  class name OR version collides. Keep new migrations in this band.
- Routes are closures resolving `UserContext`/`CmsRepository` from the container
  at request time (UserContext is rebound per request by the core AuthMiddleware).
- DB-backed tests skip without `TDS_TEST_DB_DSN`; the committed test covers
  routes + RBAC + payload validation without a DB.
- **The structured form MUST spread, never replace.** `SECTION_SCHEMAS` lists a
  SUBSET of a block's keys; the public sites merge the whole block over their
  defaults. `StructuredForm`'s `setField` and `ListEditor`'s per-item update both
  spread (`{ ...value, [key]: v }`) so keys the schema does not know about
  survive an edit. Replacing instead of spreading silently blanks live landing
  page content on the next save — covered by two tests that fail on exactly that
  mutation.
- **SWR must stay visibly stale and must never erase usable data or typing.**
  `useCachedJson` + `staleClass` show the previous result immediately, including
  when a refresh fails. A cached-data refresh failure needs an error banner and
  stale styling; it is not an empty state. Prop-to-editor sync may update an
  untouched form, but a dirty guard must keep an in-flight response from
  clobbering unsaved input. Mutations call `invalidate()` for the affected cache
  family while keeping a saved local seed.
- **`cache_url` carries a secret-bearing request and is an origin, not an
  arbitrary URL.** `CacheOrigin::normalize()` accepts only `http`/`https` with
  no userinfo, path (apart from `/`), query or fragment. Validate both at config
  write time and again in `fireCache()` so legacy/manual DB rows cannot receive
  the token. The core `SiteCache` transport must not follow redirects with the
  secret. Do not weaken either boundary.
- **Cache outcomes are factual.** `fireCache()` returns whether a request was
  actually sent; mutation responses expose it as `cached`. Missing per-site URL
  is a 422 for the manual endpoint, missing shared token/service is a 503, and a
  content save still succeeds with `cached:false`. Never toast “neu gebaut” from
  `res.ok` alone.
- **Outcomes are toasts; configuration problems and validation are not.** Block
  saves, the rebuild trigger and the translation backfill report through `toast`
  (tds-shared `>=0.33.0`). The 503 "DeepL not configured" / 503 "no rebuild or
  cache token" / 422 "no repository/origin" replies stay in the in-flow banner — they name
  something an operator has to go and set — as does JSON/section-key validation.
  That banner is `.tds-alert--danger` now, since failures are all it carries.
  Never mount a `ToastHost` here; the frontend host owns the only one.

## Tests
- **CI runs `test:run` since 2026-08-25 — before that, none of these suites
  ever ran on a runner.** `_build.yml` had type-check, lint:primitives and
  build. That included the `ApiDocSource` parity test, whose entire job is to
  fail when a route gains or loses documentation.
- **The suites used to run against a tds-shared a dozen minors old, and the
  first honest run cost 30 failures across the twelve shipping extensions.**
  This package declares tds-shared as a **peer** with a `>=0.33.0` floor (needed
  for the `data` cache exports), after an older floor let a fresh install resolve
  an incompatible version while every product build composed the current
  one. Three separate behaviours had moved underneath the tests, and each is
  worth knowing because a new suite will hit them again:
  - `apiFetch` consults the host-side runtime config (`/tds-runtime.json`)
    before it resolves a URL, so `fetch.mock.calls[0]` is that probe, not the
    endpoint. Call **`primeRuntimeConfig(null)`** in `beforeEach` — the panel
    products never ship that file (they render `<meta name="tds-api-base">`),
    so "absent" is also what happens in production.
  - `apiFetch` is **async**: the request leaves on a later microtask than the
    render. Reading `mock.calls` on the line after `render(...)` yields
    `undefined`; `await waitFor(() => expect(fetch).toHaveBeenCalled())` first.
  - A multipart upload now carries an **empty** `headers` object rather than
    `undefined`. Identical to the browser — the boundary is still the
    browser's to set — so assert "no content-type header", never
    "headers is undefined".


`npm run test:run` (vitest; jsdom per-file via a `@vitest-environment` docblock).

- `islands/SitesList.test.tsx` — the site/block CRUD and, above all, the
  **structured-form ↔ raw-JSON bridge**: unknown keys survive a form edit,
  `currentValue()` refuses arrays/scalars/null so a block is always an object,
  typed fields round-trip (number stays a number, a cleared number becomes
  `null`, a checkbox stays boolean), and a hand-broken stored value (`null`,
  an array, a non-object) degrades instead of white-screening the editor.
- `islands/SiteRegistry.test.tsx` — registration/configuration under Settings,
  truthful manual-cache failures, and SWR prop synchronisation without losing
  edits.
- `islands/sections.test.ts` — known page/section ordering, first-block creation,
  DE/EN defaults, shared sections and preservation of unknown stored sections.
- `islands/WebsiteSettings.test.tsx` — the masked-secret contract: a secret
  never round-trips to the DOM, and a **blank** secret on save means *keep*, so
  toggling auto-translate cannot wipe the DeepL key.
- `islands/LegalDocs.test.tsx` — the PDF uploader. The upload is **multipart**,
  so the test pins that no JSON `Content-Type` is set (one would strip the
  boundary and the server would see no file); that 415/413 land in the flow
  while a transport failure toasts **with its status**; and that both the calls
  and the "Ansehen" link are absolute on the API host.
- `src/index.test.ts` + `tests/packaging.test.ts` — the manifest as a product
  build sees it, and that every specifier resolves to a real file that is both
  covered by `exports` and inside the published `files` list.
- `php/tests/WebsiteCmsCacheTest.php` — strict cache-origin validation, send-time
  revalidation/token containment, truthful no-token handling and `cache_url` in
  the site query contract.

Note: `userEvent.type()` parses `{` and `[` as key syntax, so the JSON textarea
is driven with `paste()` (see the `setJson` helper) — typing raw JSON silently
fails.

Verified by mutation: 16 deliberate breakages introduced, 16 caught.

## Checkpoint status

- **CP1:** `cms_site` + `cms_block` schema, `Domain\CmsRepository`, site + block
  CRUD (`/cms/*`) with RBAC and the sites widget.
- **CP2:** the per-site **block editor UI** (`SiteEditor` in `islands/SitesList.tsx`)
  — choose a site's page and section, edit a typed form or raw JSON, then save via
  PUT. Known pages/sections and DE/EN remain available without stored rows.
- **CP3:** explicit **manual CI rebuild**. `Service\RebuildTrigger` (plain
  ext-curl, best-effort, never throws) fires GitHub `workflow_dispatch` only from
  the manual endpoint. Per-site target lives on `cms_site` (`rebuild_repo` "owner/name"
  + `rebuild_workflow`, defaulting `dev.yml`), edited via `PUT /cms/sites/{site}/
  rebuild-config`; the shared PAT comes from `WEBSITE_REBUILD_TOKEN` (one PAT
  dispatches every site repo; unset ⇒ no-op). `POST /cms/sites/{site}/rebuild` is a
  manual "Jetzt neu bauen" (503 no token / 422 no repo). Sends `ref` only — the
  dispatches endpoint 422s on inputs a workflow doesn't declare. Content
  mutations never dispatch CI; this path is for code/design deployments.
- **CP4:** **DeepL auto-translation** of blocks (save-time sync, ported from
  tds-content-api). `cms_block.machine_translated` flags auto-generated rows. On a
  block save, `Service\TranslationSync` extracts the human-copy leaves via
  `TranslatableJsonWalker` (skips href/url/icon/slug/id/email keys + URL/path/email
  shapes), batch-translates them, and re-applies onto the counterpart-language block
  (`machine_translated=1`) — only when that counterpart is absent or itself machine-
  made; a manual save clears the row's own flag. Delete cascades onto a machine
  counterpart. `Service\DeeplTranslator` is a curl port (no Guzzle; `:fx` ⇒ free).
  Config: `WEBSITE_DEEPL_API_KEY` (+ `WEBSITE_AUTO_TRANSLATE=0` to opt out); unset ⇒
  no-op. `POST /cms/sites/{site}/translations/backfill` (website:write, 503 when
  inactive) catches up existing blocks. UI: an "Auto" badge on machine blocks + a
  backfill button. Writes go through the repo (never the route) so the sync can't
  ping-pong. Mirror of blog-cms CP4.
- **CP5:** **runtime settings store adoption** (mirror of blog-cms CP8). The DeepL
  key + auto-translate flag + rebuild token + page-cache token are read
  **DB-first with env fallback**
  via the core's `SettingsStore` (contract interface, resolved from the container;
  null in isolated tests ⇒ env-only). Namespace `website-cms`, keys
  `deepl_api_key`/`rebuild_token`/`cache_token` (secret, AES-GCM by the core) +
  `auto_translate`.
  The settings slot (`islands/Settings.astro` → `WebsiteSettings`) reads/writes the
  core admin API `/admin/settings/website-cms` (masked; blank secret = keep). Env
  vars (`WEBSITE_DEEPL_API_KEY`/`DEEPL_API_KEY`, `WEBSITE_AUTO_TRANSLATE`,
  `WEBSITE_REBUILD_TOKEN`, `WEBSITE_CACHE_TOKEN`) remain the fallback.
- **CP6:** **per-section structured forms.** Known section keys (`hero`, `about`,
  `services`, `faq` — extend `SECTION_SCHEMAS` in `islands/sections.ts`) render
  typed fields (text/textarea + repeatable object lists like faq `items:[{q,a}]`)
  instead of raw JSON; unknown sections fall back to the JSON editor. A **Form/JSON
  toggle** is always available (known sections open in Form). The editor keeps a
  parsed `value` object as source of truth in Form mode and the JSON text in JSON
  mode; switching seeds one from the other, and save resolves the active mode
  (invalid JSON blocks the save). Purely frontend — the block API + shape validation
  are unchanged.
- **CP7:** corrected + widened `SECTION_SCHEMAS` to match the **actual
  tds-landingpage-frontend section defaults** (CP6's hero/about/services keys were guessed
  and wrong — they'd show empty fields for real content). Now accurate for `hero`
  (headline/headlineAccent/headlineSuffix/tagline/sub/cta1/cta2/scrollHint),
  `about` (label/headline/headlineAccent/lead/p1/p2/stat{1,2,3}{Value,Label}),
  `services` (label/headline/headlineAccent + items `{number,title,description}`;
  the array `tags` key survives via the spread but isn't form-edited), `faq`
  (label/headline + items `{q,a}`), `contact` (label/headline/headlineAccent/sub/
  email/phone/location), and `process` (label/headline/headlineAccent/body + steps
  `{number,title,duration,description,detail,outcome}`). Partial schemas stay safe —
  unlisted keys are preserved. When adding a section, copy its shape from the
  landingpage component's `cmsFor("<key>", …, {…default…})` call.
- **CP8:** added `consulting`, `footer`, `pricing`, `tech`, `journal`, `portfolio`
  and `cookie_banner` schemas. `pricing` needed richer field types, so the
  form system grew `number` + `checkbox` leaf types and a `stringlist` field (array
  of plain strings, e.g. pricing `includes`/`notes`) — usable both top-level and as
  an item field inside an object list (pricing `items[].includes`). `LeafInput` now
  emits the correctly-typed value (string/number/bool) and `blank()` seeds new list
  items per field type. Shapes verified against tds-shared-pkg `translations.ts`
  (`t.pricing`/`t.consulting`/`t.footer`).
- **CP9:** **legal documents (PDF upload).** `cms_legal_doc` +
  `Support\LegalDocFile` + admin CRUD + the public `GET /content/legal` and
  `GET /content/legal/{key}.pdf`, driven by `islands/LegalDocs.tsx` in the site
  editor. Built for the landingpage's AGB page (`/legal/agb` +
  `/legal/agb.pdf`, DE and EN), which reads the document while rendering and
  falls back to a committed copy so the link is never dead. Legal text is **not**
  machine-translated — unlike blocks, the EN document is a separate upload, and
  `TranslationSync` does not see these rows at all.
- **CP10:** **settings-only registry, semantic page model and targeted page
  cache.** `SiteRegistry` is mounted only from `Settings.astro`; the content
  screen resolves known pages/sections via `islands/sections.ts`. `cache_url`
  plus the `SiteCache` contract sends `CacheEvent('block', …)` /
  `CacheEvent('legal', …)` on mutations; API responses carry `cached` for honest
  UI status. Reads use shared SWR with visible stale/error state and dirty-editor
  guards. The contract dependency is `^1.10.0`; the shared data peer floor is
  `>=0.33.0`.
- **CP11:** the landingpage repositioning has isolated content namespaces rather
  than reusing overrides written for the old copy: `home_hero`, `why_me`,
  `services_overview`, `digital_responsibility`, `pricing_services` and
  `faq_v2`. Six code-owned service block keys (`service_consulting`,
  `service_process`, `service_solutions`, `service_custom_development`,
  `service_web_presence`, `service_complete_it`) share one shallow structured
  shape for detail copy, string lists, price copy and repeatable anonymised
  references. IDs/slugs/hrefs are deliberately absent: public route metadata
  lives in the landingpage code. `references: []` is valid and means no
  reference section. The service blocks are shared by the home-page cards, the
  pricing page and their matching detail page, so `PAGES` lists each wherever
  it is rendered. Legacy schemas remain available for stored rows under
  “Weitere Abschnitte”; the current `PAGES` map no longer assigns them to the
  home or pricing page.
- **TODO:** extend `SECTION_SCHEMAS` and `PAGES` together if a site introduces a
  new known section or page. Unknown stored sections remain editable under
  “Weitere Abschnitte”.

## After a change

Update the docs and commit them with the code. **Do not touch `version` in
`package.json` / `composer.json`** — `release.yml` → `_build.yml` runs
`npm version <bump>` on top of what is committed and writes `composer.json` in
lockstep, so a hand-bump double-bumps. A `0.x` caret is minor-locked, so a
double-bump can land outside the product's pin and silently ship nothing. Pick
the bump on the Release button instead; keep it inside the `0.2.x` line
`tds-admin-frontend` pins.

## Mobile layout

This package ships **no CSS**, so every layout decision is a shared class or a
Tailwind utility, and neither is checked by anything at runtime. Two rules:

- **A row of more than two things — or any row holding a full-width field —
  goes on `.tds-row`, `.tds-list__row` or `.tds-toolbar`.** All three wrap.
  A hand-rolled `flex` does not, and on a 375px screen the overflow is not
  even visible: `body { overflow-x: hidden }` clips it, so the content simply
  is not there.
- **A `<table>` needs `tds-table` and nothing else.** The primitive turns
  itself into a horizontal scroller below 40rem; an extra `overflow-x`
  wrapper or an inline style is redundant. A table with no focusable cell
  also needs `tabindex="0"` + `role="region"` + a label, or its scrollport
  cannot be reached by keyboard.

`npm run lint:primitives` enforces the class part of this (including a
`<table>` without `tds-table` and a flex/grid table cell, which silently
drops the cell out of the column algorithm). It is a **regex scan**, so a tag
name written inside a comment counts as markup — name elements in prose.

## API-Referenz (`php/docs/api.php`)

This module implements the contract's optional `ApiDocSource`: `php/docs/api.php`
returns one entry per route (summary, params, responses, required permission),
and the admin frontend's API reference joins it onto the introspected Slim routes
by `"<METHOD> <pattern>"`. Two things to know before editing a route:

- **`pattern` must be the Slim pattern verbatim**, inline regex included
  (`/cms/{site:[a-z0-9-]+}/blocks/{key:[a-z0-9_-]+}`). A prettified path silently produces an orphan doc *and* an
  undocumented route rather than an error.
- **`php/tests/WebsiteCmsApiDocsTest.php` asserts both directions** — the documented
  set and the registered set must be the same set, every path placeholder must
  be described, and a named permission must exist in `permissions()`. Adding or
  renaming a route without touching `docs/api.php` fails there. That is the
  point: prose next to code rots, and a reference full of confident, wrong
  detail is worse than the bare route list it replaced.

## Site keys (`SiteKeyProtected`)

This module implements the contract's optional `SiteKeyProtected` and declares
`/content/landing`, `/content/legal` — what the public landingpage reads at
**server render/cache-fill time**, and the only routes the base's site-key
middleware may gate.

- `/content/legal` covers `/content/legal/{key}.pdf` too, deliberately: the same
  server integration fetches both, and the landingpage keeps a committed
  fallback PDF for exactly the case where it cannot be reached.
- **Never widen to `/content`.** That would swallow blog-cms's routes as well —
  one module gating another's surface, and silently ceasing to the day blog-cms
  renames a path.
- **Never list a route a visitor's browser calls.** A browser has no key and
  never will; the first such entry turns `enforce` into an outage on the public
  site.
- `php/tests/WebsiteCmsApiDocsTest.php` asserts every declared prefix still
  covers a mounted route and reaches no `/admin` route. An orphaned prefix does
  not leave a blank row — it leaves an **unprotected route** that looks
  deliberate.
