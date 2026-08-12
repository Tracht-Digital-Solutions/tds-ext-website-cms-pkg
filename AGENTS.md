# AGENTS.md — tds-ext-website-cms-pkg

Website-CMS extension, ported from `tds-content-api`'s content-block model. Read
`tds-frontend-contract-pkg` + `tds-core-frontend-api` AGENTS first.

## Model

- **Build-time content**, not runtime: `cms_block` rows (one per site × section ×
  language, `value_json`) are read by the static sites at build time and merged
  over defaults; a missing row falls back. Never fetch this from the client at
  runtime (same rule as content-api).
- **1:n sites:** the `cms_site` registry scopes blocks. `cms_block.site_id` FK →
  `cms_site` (CASCADE). Unique `(site_id, section_key, lang)`.
- **Auth via the core `UserContext`** — `website:read`/`website:write` (admins
  bypass). Blocks are upserted (PUT, `ON DUPLICATE KEY`).
- Denormalised JSON on purpose (small, read once per build, shapes differ per
  section) — the API validator owns shape correctness.

## Gotchas

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
  open `GET /content/landing` that the public landingpage + blog SSG builds fetch:
  it returns the **default site**'s (`defaultSite()`) content blocks for a language
  as a `{blocks: {section_key: value}}` map (landing sections + the blog's
  `cookie_banner`/`ads` config blocks). **Degrades to `{blocks:{}}` on any DB
  error** (build-fetch fail-safe) — keep it read-only and ungated.
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
- **Outcomes are toasts; configuration problems and validation are not.** Block
  saves, the rebuild trigger and the translation backfill report through `toast`
  (tds-shared `>=0.16.0`). The 503 "DeepL not configured" / 503 "no rebuild
  token" / 422 "no repository" replies stay in the in-flow banner — they name
  something an operator has to go and set — as does JSON/section-key validation.
  That banner is `.tds-alert--danger` now, since failures are all it carries.
  Never mount a `ToastHost` here; the frontend host owns the only one.

## Tests

`npm run test:run` (vitest; jsdom per-file via a `@vitest-environment` docblock).

- `islands/SitesList.test.tsx` — the site/block CRUD and, above all, the
  **structured-form ↔ raw-JSON bridge**: unknown keys survive a form edit,
  `currentValue()` refuses arrays/scalars/null so a block is always an object,
  typed fields round-trip (number stays a number, a cleared number becomes
  `null`, a checkbox stays boolean), and a hand-broken stored value (`null`,
  an array, a non-object) degrades instead of white-screening the editor.
- `islands/WebsiteSettings.test.tsx` — the masked-secret contract: a secret
  never round-trips to the DOM, and a **blank** secret on save means *keep*, so
  toggling auto-translate cannot wipe the DeepL key.
- `src/index.test.ts` + `tests/packaging.test.ts` — the manifest as a product
  build sees it, and that every specifier resolves to a real file that is both
  covered by `exports` and inside the published `files` list.

Note: `userEvent.type()` parses `{` and `[` as key syntax, so the JSON textarea
is driven with `paste()` (see the `setJson` helper) — typing raw JSON silently
fails.

Verified by mutation: 16 deliberate breakages introduced, 16 caught.

## Checkpoint status

- **CP1:** `cms_site` + `cms_block` schema, `Domain\CmsRepository`, site + block
  CRUD (`/cms/*`) with RBAC, the sites widget + list/add-site UI.
- **CP2:** the per-site **block editor UI** (`SiteEditor` in `islands/SitesList.tsx`)
  — list a site's blocks, open one (section-key + lang → GET), edit its JSON in a
  textarea with parse + object validation, save via PUT.
- **CP3:** save-triggered **static-site rebuild**. `Service\RebuildTrigger` (plain
  ext-curl, best-effort, never throws) fires a GitHub `workflow_dispatch` after a
  block save/delete. Per-site target lives on `cms_site` (`rebuild_repo` "owner/name"
  + `rebuild_workflow`, defaulting `dev.yml`), edited via `PUT /cms/sites/{site}/
  rebuild-config`; the shared PAT comes from `WEBSITE_REBUILD_TOKEN` (one PAT
  dispatches every site repo; unset ⇒ no-op). `POST /cms/sites/{site}/rebuild` is a
  manual "Jetzt neu bauen" (503 no token / 422 no repo). Sends `ref` only — the
  dispatches endpoint 422s on inputs a workflow doesn't declare. UI: a
  Rebuild-Konfiguration block in the SiteEditor.
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
  key + auto-translate flag + rebuild token are read **DB-first with env fallback**
  via the core's `SettingsStore` (contract interface, resolved from the container;
  null in isolated tests ⇒ env-only). Namespace `website-cms`, keys
  `deepl_api_key`/`rebuild_token` (secret, AES-GCM by the core) + `auto_translate`.
  The settings slot (`islands/Settings.astro` → `WebsiteSettings`) reads/writes the
  core admin API `/admin/settings/website-cms` (masked; blank secret = keep). Env
  vars (`WEBSITE_DEEPL_API_KEY`/`DEEPL_API_KEY`, `WEBSITE_AUTO_TRANSLATE`,
  `WEBSITE_REBUILD_TOKEN`) remain the fallback.
- **CP6:** **per-section structured forms.** Known section keys (`hero`, `about`,
  `services`, `faq` — extend `SECTION_SCHEMAS` in `islands/SitesList.tsx`) render
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
- **CP8:** added `consulting`, `footer`, and `pricing` schemas — **all landingpage
  sections now have structured forms.** `pricing` needed richer field types, so the
  form system grew `number` + `checkbox` leaf types and a `stringlist` field (array
  of plain strings, e.g. pricing `includes`/`notes`) — usable both top-level and as
  an item field inside an object list (pricing `items[].includes`). `LeafInput` now
  emits the correctly-typed value (string/number/bool) and `blank()` seeds new list
  items per field type. Shapes verified against tds-shared-pkg `translations.ts`
  (`t.pricing`/`t.consulting`/`t.footer`).
- **TODO (next):** nothing outstanding for the structured forms — extend
  `SECTION_SCHEMAS` if a site introduces a new section shape.

## After a change

Bump `version` in `package.json` + `composer.json` (lockstep), update docs,
commit together.

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
