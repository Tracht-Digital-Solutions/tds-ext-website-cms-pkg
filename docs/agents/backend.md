# Backend

The PHP half is a `Module` (`php/src/WebsiteCmsModule.php`, extends `AbstractModule`) that the
composed `tds-core-frontend-api` mounts in one process with every other extension.

Classes: `Domain\CmsRepository`, `Service\TranslationSync`, `Service\TranslatableJsonWalker`,
`Service\DeeplTranslator`, `Support\CacheOrigin`, `Support\LegalDocFile`. Migrations are
`WebsiteCms*`-style names in the `20260727*` band.

## Bind container entries unconditionally

Never guard a binding with `!$c->has(X::class)`:

```php
if ($c !== null && !$c->has(TranslationSync::class)) { $c->set(…); }   // never runs
```

PHP-DI answers `has()` from its definition sources, and **autowiring is one of them**. For
`CmsRepository` that is invisible; for `TranslationSync` it is fatal, because `DeeplTranslator`
takes a string (`Parameter $apiKey of __construct() has no value defined or guessable`). Saving,
deleting and the backfill answered 500 while reads worked. `ExtensionBindingsTest` in
`tds-core-frontend-api` resolves every `$c->set(…)` of every composed module.

## Never delete a migration; retire it

`20260727000007_website_cms_seed_shop_legal.php` is retired and does nothing, on purpose. It used
`$this->getAdapter()->quoteValue()`, which is protected on `PdoAdapter` and missing on the
`TimedOutputAdapter` a migration receives. Every run died, and because all modules share one
`phinxlog` applied in version order, it blocked every migration behind it (the shop's tables never
reached production). The runner logs and swallows the failure, so nothing turned red.

- Never call adapter internals in a migration.
- A migration that has been in the tree stays; empty its `up()` instead of deleting it.
- `php/tests/WebsiteCmsMigrationsTest.php` checks the migration files without a database
  (file name ↔ class, unique versions, band), because the core's `MigrationRunner` aborts
  migrations for **every** module on a collision.

## Migrations (Phinx)

All composed extensions share **one** `phinxlog`, so:

- The migration **class name** and the **numeric version prefix** must be unique across
  every extension. Put the module id in the class name.
- The **file name must map to the class** (`<version>_<snake_case_class>.php`). A
  mismatch throws `Could not find class …` during the scan and aborts **every**
  extension's migrations, not just this one.
- Migrations must survive MySQL 8 (production): no nullable primary-key columns, and
  unsigned ids where the other side is unsigned.

## API reference (`php/docs/api.php`)

The module implements the contract's optional `ApiDocSource`. `php/docs/api.php` returns
one entry per route (summary, params, responses, required permission). The admin
frontend's API reference joins it onto the introspected Slim routes by
`"<METHOD> <pattern>"`.

- **`pattern` must be the Slim pattern verbatim**, inline regex included. A prettified
  path silently produces an orphan doc and an undocumented route.
- **`php/tests/WebsiteCmsApiDocsTest.php` asserts both directions:** documented and registered
  routes are the same set, every path placeholder is described, and a named permission
  exists in `permissions()`. Adding or renaming a route without touching `docs/api.php`
  fails there.

## Contract dependency

The published `tds-frontend-contract` is consumed VCS-only on the Composer side
(`type: vcs`) and from GitHub Packages on the npm side. Never use a `path` repository;
Composer fails on a missing path repo in CI.
