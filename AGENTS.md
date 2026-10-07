# AGENTS.md — tds-ext-website-cms-pkg

Frontend extension for the **website CMS**: per-site, per-section JSON content blocks (DE/EN)
with structured editing forms, DeepL auto-translation, uploaded legal PDFs (AGB), targeted
page-cache refresh, and the public read API the landing page and blog render from. Ported
from `tds-content-api`'s content-block model. It contributes a PHP `Module` to
`tds-core-frontend-api` and the `/website` editor, a settings registry and a widget to the
admin product.

Read `tds-frontend-contract-pkg/AGENTS.md` and `tds-core-frontend-api/AGENTS.md` first.

## Commands

```bash
npm install --no-package-lock   # never npm ci
npm run type-check
npm run lint:primitives
npm run test:run                # vitest
npm run build                   # tsup
composer install && composer test   # phpunit; DB-backed tests need TDS_TEST_DB_DSN
```

## Hard rules

- **The structured form spreads, never replaces.** Unknown keys in a block must survive an edit.
- **Bind container entries unconditionally.** Never guard with `!$c->has(X::class)`.
- Public `/content/landing` and `/content/legal*` stay read-only, ungated, default-site only, and fail soft.
- Never widen `siteKeyRoutes()` to `/content`; never list a route a visitor's browser calls.
- Legal uploads are checked by magic number (`%PDF-`); filenames go through `LegalDocFile::sanitizeFilename()`.
- `cache_url` is an origin only; validate it on write **and** before sending the token.
- Report cache outcomes from the API's `cached` flag, never from `res.ok`.
- SWR stays visibly stale and never clobbers unsaved input.
- Extend `SECTION_SCHEMAS` and `PAGES` together, with shapes copied from the landing page.
- Migrations stay in the `20260727*` band; never delete one. Don't touch `version`; stay in `0.5.x`.

## Topic files

| File | Read before |
|---|---|
| [docs/agents/architecture.md](docs/agents/architecture.md) | Changing the model, routes, translation, settings or the editor screens |
| [docs/agents/content-model.md](docs/agents/content-model.md) | Changing sections, pages, `SECTION_SCHEMAS` or the structured form |
| [docs/agents/public-api.md](docs/agents/public-api.md) | Touching `/content/*`, legal documents, site keys or the page cache |
| [docs/agents/backend.md](docs/agents/backend.md) | Touching PHP, DI bindings, migrations or `php/docs/api.php` |
| [docs/agents/frontend-conventions.md](docs/agents/frontend-conventions.md) | Touching any island, page or widget markup |
| [docs/agents/testing.md](docs/agents/testing.md) | Writing or changing tests |
| [docs/agents/release.md](docs/agents/release.md) | Releasing or changing CI |

Workspace rules: `../CLAUDE.md`. Cross-repo state: `../MIGRATION-STATUS.md`.
