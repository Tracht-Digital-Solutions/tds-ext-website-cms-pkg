# Public read API, legal documents, site keys and page cache

## Public reads (no authentication)

| Route | Returns |
|---|---|
| `GET /content/landing` | `{blocks: {section_key: value}}` for the **default site** (`defaultSite()`) and a language: landing sections plus the blog's `cookie_banner` / `ads` blocks |
| `GET /content/legal` | Legal-document metadata for the default site |
| `GET /content/legal/{key:[a-z0-9-]+}.pdf` | The PDF bytes |

- Read by the landing page and blog **servers** while rendering or filling the cache.
- They **degrade to an empty payload** (`{blocks:{}}`) on any DB error. Keep them read-only and
  free of permission checks.
- They answer for the default site only. Editors managing a second site use the admin preview
  route `/cms/sites/{site}/legal/{key}/file`.

## Legal documents

`cms_legal_doc` holds an uploaded PDF per site × `doc_key` × language (the AGB today). The file
**is** the managed document; there is no text to edit. The landing page (`/legal/agb`,
`/legal/agb.pdf`, DE and EN) reads it while rendering and falls back to a committed copy, so the
link is never dead.

- **Bytes live in the DB (`MEDIUMBLOB`), not on disk**, unlike `tds-ext-documents-pkg`. These are
  a few small files (8 MB cap; the AGB is ~90 KB), and a DB column needs no writable directory on
  the Plesk host. Every metadata query names its columns instead of `SELECT *`, so listings don't
  drag blobs through PHP.
- **Trust the magic number, not the media type.** Content-Type and filename are attacker-supplied.
  The route sniffs `%PDF-` in the first KB and answers 415 otherwise; oversize is 413.
- `LegalDocFile::sanitizeFilename()` makes the name safe for `Content-Disposition`; it is the only
  barrier against header injection, and the module test pins it.
- Upload and delete send a targeted `legal` cache event, never a CI build.

## Site keys (`SiteKeyProtected`)

`siteKeyRoutes()` declares `/content/landing` and `/content/legal`.

- `/content/legal` also covers `/content/legal/{key}.pdf`, deliberately; the same server
  integration fetches both.
- **Never widen to `/content`.** That would gate blog-cms's routes too.
- **Never list a route a visitor's browser calls**; a browser has no key, so `enforce` would become
  an outage.
- `php/tests/WebsiteCmsApiDocsTest.php` asserts every declared prefix covers a mounted route and
  reaches no `/admin` route.

## Page cache

- Mutations send semantic `CacheEvent`s (`block` / `legal`) through a paired site connection
  (`ConnectedSiteCache`) or the core `SiteCache`, so the site rebuilds only affected pages.
- **`cache_url` is an origin, not an arbitrary URL**, because the token is sent there.
  `CacheOrigin::normalize()` accepts only `http` / `https` without userinfo, path (apart from `/`),
  query or fragment. Validate at config write **and** again in `fireCache()`, so legacy or manual
  rows can't receive the token. The core transport must not follow redirects with the secret.
- **Cache outcomes are factual.** `fireCache()` returns whether a request was sent; responses
  expose it as `cached`. Manual refresh: missing per-site URL → 422, missing token/service → 503.
  A content save still succeeds with `cached: false`. Never toast "neu gebaut" from `res.ok`.
