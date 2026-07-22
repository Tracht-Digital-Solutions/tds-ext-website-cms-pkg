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
