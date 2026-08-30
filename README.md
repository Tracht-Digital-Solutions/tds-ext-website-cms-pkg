# tds-ext-website-cms-pkg

The **Website-CMS** manages editable sections and legal PDFs for one or more
public sites. Content is stored as one JSON block per **site × section ×
language**. Public sites read it while rendering and merge it over their local
defaults, so an absent block remains a deliberate, working default rather than
an empty page.

## Editing model

- **Einstellungen → Website-CMS** is the site registry. This is the only place
  to add a website or configure its public cache origin and optional manual CI
  target. It also stores the DeepL, GitHub rebuild and page-cache tokens; secrets
  are returned masked and a blank save keeps the current value.
- **Website-CMS → `/website`** is exclusively for content. Choose a site, then
  a page and section, and edit DE or EN. Known sections use typed forms; the JSON
  view remains available and unknown keys are preserved.
- The page model always exposes the known pages, sections and both languages,
  even before a database row exists. `Vorgabe` means the public site's local
  default is currently in use; saving creates the first override.
- The redesigned landing page uses separate structured blocks for its home
  sections, service-based pricing and six service detail pages. Service IDs and
  localized slugs stay in the public site's code; editors manage only visible
  copy, flat lists and optional anonymised references. An empty reference list
  is valid and lets the public page omit that area entirely.
- Lists use stale-while-revalidate. Previously loaded data appears immediately
  with the `tds-stale` state while it refreshes, and a failed refresh is shown as
  an error without discarding the last usable data. A background response never
  overwrites unsaved editor input.

## Cache refresh and CI rebuilds

Saving or deleting a block, backfilling translations, or changing a legal PDF
sends a targeted `CacheEvent` to the affected public site. The public site maps
block/document IDs to its own routes and rebuilds only the relevant page or
partial cache entries. The API returns `cached: bool`, so the UI reports whether
a request was actually sent instead of claiming success when configuration is
missing.

Each registered site needs a pure http(s) **origin** in `cache_url` — no
credentials, path, query or fragment — and the shared `cache_token`. The token is
stored under the `website-cms` settings namespace and may fall back to
`WEBSITE_CACHE_TOKEN`. A manual `POST /cms/sites/{site}/cache/rebuild` returns
422 without an origin and 503 without a cache token/service.

GitHub `workflow_dispatch` is separate. Content saves do **not** start CI. The
optional repository/workflow plus `rebuild_token` (or
`WEBSITE_REBUILD_TOKEN`) are used only by the explicit manual
`POST /cms/sites/{site}/rebuild`, intended for code or design deployments.

## API surface

- Registry: `GET/POST /cms/sites`, `GET /cms/summary`,
  `PUT /cms/sites/{site}/rebuild-config`.
- Blocks: `GET /cms/{site}/blocks`,
  `GET/PUT/DELETE /cms/{site}/blocks/{key}`.
- Translation: `POST /cms/sites/{site}/translations/backfill`.
- Legal PDFs: `GET /cms/sites/{site}/legal`,
  `POST/DELETE /cms/sites/{site}/legal/{key}` and
  `GET /cms/sites/{site}/legal/{key}/file`.
- Public, unauthenticated reads: `GET /content/landing`,
  `GET /content/legal` and `GET /content/legal/{key}.pdf`. Database failures
  degrade to empty content/metadata or 404 so the public site can use its local
  defaults.

Admin routes require `website:read` or `website:write` through the core
`UserContext` (admins bypass). PDFs are limited to 8 MB, validated by the
`%PDF-` magic number and stored in `cms_legal_doc` as a `MEDIUMBLOB`. Legal text
is never machine-translated; DE and EN are separate uploads.

## Develop

```bash
npm install
npm run test:run
npm run lint:primitives
npm run type-check
npm run build
composer install
composer test
```

DB-backed PHP tests skip without `TDS_TEST_DB_DSN`.

## Enable it

Add the manifest to the frontend host's `frontendHost({ extensions: [...] })`
configuration and add `new WebsiteCmsModule()` to the base API's enabled
modules. The host must provide `SiteCache` and use the same page-cache token as
the public sites for targeted refreshes.
