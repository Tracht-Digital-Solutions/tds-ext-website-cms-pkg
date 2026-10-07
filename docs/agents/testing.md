# Testing

```bash
npm run test:run   # vitest; islands opt into jsdom per file via a @vitest-environment docblock
composer test      # phpunit
```

CI (`_build.yml`) runs both suites, plus type-check, `lint:primitives` and build, on
every run.

## Test environment against the current tds-shared

tds-shared is a **peer** dependency, so a fresh standalone install may resolve an old
version while every product build composes the current one. Keep these in mind:

- `apiFetch` first consults the host runtime config (`/tds-runtime.json`), so
  `fetch.mock.calls[0]` is that probe. Call **`primeRuntimeConfig(null)`** in
  `beforeEach`; panel products never ship that file, so "absent" matches production.
- `apiFetch` is **async**. `await waitFor(() => expect(fetch).toHaveBeenCalled())`
  before reading `mock.calls`.
- A multipart upload carries an **empty** `headers` object. Assert "no content-type
  header", never "headers is undefined".
- Error-path tests answer with a **populated** body and a non-OK status. Against an
  empty error body the ok-check is unobservable.
- At least one assertion per suite pins the **absolute API host** (see
  [frontend-conventions.md](frontend-conventions.md#api-calls-apifetch-never-a-relative-fetch)).

## Suites

| Suite | Covers |
|---|---|
| `islands/SitesList.test.tsx` | Site/block CRUD and the form ↔ JSON bridge: unknown keys survive, `currentValue()` refuses non-objects, typed fields round-trip, broken stored values degrade |
| `islands/SiteRegistry.test.tsx` | Registration under Settings, truthful manual-cache failures, SWR prop sync without losing edits |
| `islands/sections.test.ts` | Page/section ordering, first-block creation, DE/EN defaults, shared sections, unknown sections preserved |
| `islands/WebsiteSettings.test.tsx` | Masked secrets never reach the DOM; blank secret = keep |
| `islands/LegalDocs.test.tsx` | Multipart upload without JSON content type; 415/413 in-flow, transport failure toasts with status; absolute API host for calls and the "Ansehen" link |
| `src/index.test.ts` + `tests/packaging.test.ts` | Specifiers resolve, are exported and in `files`; version stays in the `0.5.x` line the host pins |
| `php/tests/WebsiteCmsModuleTest.php` | Routes, RBAC, payload validation, filename sanitising, without a DB |
| `php/tests/WebsiteCmsCacheTest.php` | Strict origin validation, send-time revalidation, token containment, `cache_url` in the site query |
| `php/tests/WebsiteCmsMigrationsTest.php` | Migration files without a DB |
| `php/tests/WebsiteCmsApiDocsTest.php` | API-doc parity and site-key prefixes |

`userEvent.type()` parses `{` and `[` as key syntax, so the JSON textarea is driven with `paste()`
(the `setJson` helper). Typing raw JSON silently fails.

Mutation check: 16 breakages, 16 caught.
