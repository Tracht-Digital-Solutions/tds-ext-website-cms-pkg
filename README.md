# tds-ext-website-cms

The **Website-CMS** as a panel extension, ported from `tds-content-api`'s
`/landing` content-block model. It edits the **editable sections of the public
sites**, stored as one JSON block per **site × section × language**; the static
sites fetch these at build time and merge them over their tds-shared / local
defaults (a missing block falls back to the default).

**1:n sites:** a `cms_site` registry lets one panel manage several websites;
blocks are scoped to a site.

## Surface (checkpoint-1)

- **Sites:** `GET /cms/sites`, `POST /cms/sites` (`{site_key, name}`),
  `GET /cms/summary` (the "Websites" widget count).
- **Blocks:** `GET /cms/{site}/blocks` (section/lang list),
  `GET /cms/{site}/blocks/{key}?lang=de`, `PUT /cms/{site}/blocks/{key}`
  (`{value, lang}`), `DELETE …`.
- **Frontend:** nav "Website-CMS" → `/website`, the sites list + add-site form,
  the sites dashboard widget, DE/EN i18n.

Auth: `website:read`/`website:write` from the core `UserContext` (admins bypass);
data via the core `PDO`.

## Still to port (later checkpoints)

The per-section structured block editor UI, a save-triggered static-site rebuild
(workflow_dispatch, per-site repo/workflow config), section-shape validation, and
DeepL auto-translation of blocks (as content-api's TranslationSync does).

## Develop

```bash
npm install        # pulls tds-panel-contract from GitHub Packages (needs NPM_TOKEN)
npm run build && npm run type-check
composer install   # resolves tds-panel-contract from its public VCS repo
composer test      # phpunit — route/RBAC coverage; DB-backed tests skip without TDS_TEST_DB_DSN
```

## Enable it

Host `astro.config.mjs`: add the manifest to `panelHost({ extensions: [...] })`.
Base API: add `new WebsiteCmsModule()` to `Modules::enabled()`.
