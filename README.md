# tds-ext-website-cms-pkg

The **Website-CMS** as a frontend extension, ported from `tds-content-api`'s
`/landing` content-block model. It edits the **editable sections of the public
sites**, stored as one JSON block per **site × section × language**; the static
sites fetch these at build time and merge them over their tds-shared-pkg / local
defaults (a missing block falls back to the default).

**1:n sites:** a `cms_site` registry lets one frontend manage several websites;
blocks are scoped to a site.

## Surface (checkpoint-1)

- **Sites:** `GET /cms/sites`, `POST /cms/sites` (`{site_key, name}`),
  `GET /cms/summary` (the "Websites" widget count).
- **Blocks:** `GET /cms/{site}/blocks` (section/lang list),
  `GET /cms/{site}/blocks/{key}?lang=de`, `PUT /cms/{site}/blocks/{key}`
  (`{value, lang}`), `DELETE …`.
- **Frontend:** nav "Website-CMS" → `/website`, the sites list + add-site form,
  the sites dashboard widget, DE/EN i18n.
- **Public read (UNAUTHENTICATED)** — the successor to tds-content-api's open
  `GET /content/landing?lang=` the public landingpage/blog SSG builds fetch: returns
  the default site's content blocks for a language as `{blocks: {section_key: value}}`
  (landing sections + the blog's `cookie_banner`/`ads` config blocks). Degrades to
  `{blocks:{}}` on a DB error (build-fetch fail-safe).

## Legal documents (PDF)

Uploadable PDFs — the **AGB** today, any `doc_key` tomorrow — one per
**site × doc_key × language**. Unlike a content block there is no text to edit:
the uploaded PDF *is* the document, and the public site bakes its bytes into
`dist/` at build time. An upload fires the site's rebuild, so the flow is
upload → rebuild → live.

- **Admin:** `GET /cms/sites/{site}/legal` (`website:read`),
  `POST /cms/sites/{site}/legal/{key}` (`website:write`, multipart `file` +
  `lang` + optional `version_label`), `DELETE /cms/sites/{site}/legal/{key}?lang=`,
  `GET /cms/sites/{site}/legal/{key}/file?lang=` (preview).
- **Public (UNAUTHENTICATED):** `GET /content/legal` → metadata map
  `{docs: {agb: {de: {filename, sizeBytes, versionLabel, updatedAt}}}}`, and
  `GET /content/legal/{key}.pdf?lang=de` → the bytes. Both degrade to an empty
  map / a 404 rather than a 500.
- **PDF only, 8 MB max**, and the check is the `%PDF-` magic number, not the
  client-declared media type. The bytes live in the `cms_legal_doc` row
  (`MEDIUMBLOB`) rather than on disk — see the migration for why.
- **UI:** a *Rechtsdokumente* section in the site editor (`islands/LegalDocs.tsx`).

Auth: the admin routes need `website:read`/`website:write` from the core `UserContext`
(admins bypass); the `/content/*` public reads are ungated. Data via the core `PDO`.

## Still to port (later checkpoints)

The per-section structured block editor UI, a save-triggered static-site rebuild
(workflow_dispatch, per-site repo/workflow config), section-shape validation, and
DeepL auto-translation of blocks (as content-api's TranslationSync does).

## Develop

```bash
npm install        # pulls tds-frontend-contract from GitHub Packages (needs NPM_TOKEN)
npm run build && npm run type-check
composer install   # resolves tds-frontend-contract from its public VCS repo
composer test      # phpunit — route/RBAC coverage; DB-backed tests skip without TDS_TEST_DB_DSN
```

## Enable it

Host `astro.config.mjs`: add the manifest to `frontendHost({ extensions: [...] })`.
Base API: add `new WebsiteCmsModule()` to `Modules::enabled()`.
