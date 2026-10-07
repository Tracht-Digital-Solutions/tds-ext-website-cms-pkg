# Architecture

## Model

- **Request-rendered content behind a page cache.** `cms_block` rows (one per site × section ×
  language, `value_json`) are read by the public site's **server** while rendering and merged
  over code defaults; a missing row falls back. Never fetch content from a visitor's browser.
- **1:n sites.** The `cms_site` registry scopes blocks. `cms_block.site_id` → `cms_site`
  (CASCADE). Unique `(site_id, section_key, lang)`.
- **Legal documents** are the same model with bytes: `cms_legal_doc` (one per site × `doc_key`
  × language) holds an uploaded PDF. See [public-api.md](public-api.md#legal-documents).
- Denormalised JSON on purpose (small, read once per render, shapes differ per section). The
  API validator owns shape correctness.
- Auth is the core `UserContext`: `website:read` / `website:write` (admins bypass). Blocks are
  upserted (`PUT`, `ON DUPLICATE KEY`). Routes resolve `UserContext` and `CmsRepository` at
  request time.

## Admin routes

| Area | Routes |
|---|---|
| Sites | `GET /cms/summary`, `GET` / `POST /cms/sites` |
| Connection | `GET` / `DELETE /cms/sites/{site}/connection`, `POST /cms/sites/{site}/connection/pairing` |
| Blocks | `GET /cms/{site}/blocks`, `GET` / `PUT` / `DELETE /cms/{site}/blocks/{key}` |
| Legal | `GET /cms/sites/{site}/legal`, `POST` / `DELETE /cms/sites/{site}/legal/{key}`, `GET /cms/sites/{site}/legal/{key}/file` (admin preview for any site) |
| Cache | `POST /cms/sites/{site}/cache/rebuild` |
| Translation | `POST /cms/sites/{site}/translations/backfill` (503 when DeepL is inactive) |

## Screens

- **Registration and configuration live only under *Einstellungen → Website-CMS***
  (`SiteRegistry`, mounted from `Settings.astro`).
- **`/website` is the daily content screen:** site → page → section → DE/EN. Known pages and
  sections and both languages stay selectable before a row exists, so an editor can create the
  first override ("Vorgabe"). Unknown stored sections stay editable under "Weitere Abschnitte".
- `LegalDocs` (inside the site editor) uploads PDFs.

## SWR reads

`useCachedJson` + `staleClass` show the previous result immediately, also when a refresh fails.
A failed refresh with cached data shows an error banner and stale styling, never an empty state.
Prop-to-editor sync may update an untouched form, but a **dirty guard** keeps an in-flight
response from clobbering unsaved input. Mutations call `invalidate()` for the affected cache
family while keeping a saved local seed.

## DeepL auto-translation

- On a block save, `Service\TranslationSync` extracts the human-copy leaves via
  `TranslatableJsonWalker` (skipping `href` / `url` / `icon` / `slug` / `id` / `email` keys and
  URL / path / email shapes), batch-translates them and writes the counterpart-language block
  with `machine_translated = 1`.
- Only when the counterpart is absent or itself machine-made. A manual save clears the row's own
  flag. Deleting cascades to a machine counterpart.
- Writes go through the repository, never the route, so sync can't ping-pong.
- `Service\DeeplTranslator` is plain curl (`:fx` key ⇒ free endpoint).
- **Legal documents are never machine-translated.** The EN document is a separate upload.
- UI: an "Auto" badge on machine blocks and a backfill button.

## Settings (core `SettingsStore`, namespace `website-cms`)

| Key | Secret | Env fallback |
|---|---|---|
| `deepl_api_key` | yes | `WEBSITE_DEEPL_API_KEY`, then `DEEPL_API_KEY` |
| `auto_translate` | no | `WEBSITE_AUTO_TRANSLATE` (`0` opts out) |
| `cache_token` | yes | `WEBSITE_CACHE_TOKEN` |

The settings slot (`islands/Settings.astro` → `WebsiteSettings`) uses the core
`/admin/settings/website-cms`: masked on read, **blank secret = keep**. Runtime GitHub rebuild
settings were removed by migration `20260727000006`; code and design deployments are CI-owned.

## Outcomes

Block saves, cache refreshes and the backfill report via toast (tds-shared ≥ 0.33.0).
Configuration problems (503 "DeepL not configured", 503 "no cache token", 422 "no origin") and
JSON / section-key validation stay in the in-flow `.tds-alert--danger` banner.

## Motion (peer ≥ 0.38.2)

Site and page chips carry a `TabIndicator`; a page's section list and the block editor
cross-fade with `Presence`, keyed by page and by **section** (a language switch inside one
section keeps the editor); status lines open with `Collapse`. The site editor is deliberately
not re-keyed per site. In tests, "ready" means the editor's "Speichern" is **enabled**, and a
row must come from the list that isn't `aria-hidden`.
