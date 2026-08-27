<?php
declare(strict_types=1);

namespace Tds\Ext\WebsiteCms;

use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Psr\Http\Message\UploadedFileInterface;
use Slim\App;
use Tds\Ext\WebsiteCms\Domain\CmsRepository;
use Tds\Ext\WebsiteCms\Service\DeeplTranslator;
use Tds\Ext\WebsiteCms\Service\TranslatableJsonWalker;
use Tds\Ext\WebsiteCms\Service\TranslationSync;
use Tds\Ext\WebsiteCms\Support\CacheOrigin;
use Tds\Ext\WebsiteCms\Support\LegalDocFile;
use Psr\Container\ContainerInterface;
use Tds\Frontend\Contract\AbstractModule;
use Tds\Frontend\Contract\ApiDocSource;
use Tds\Frontend\Contract\CacheEvent;
use Tds\Frontend\Contract\ConnectedSiteCache;
use Tds\Frontend\Contract\PermissionDef;
use Tds\Frontend\Contract\ReportingSiteCache;
use Tds\Frontend\Contract\SettingsStore;
use Tds\Frontend\Contract\SiteCache;
use Tds\Frontend\Contract\SiteConnectionException;
use Tds\Frontend\Contract\SiteConnectionIdentity;
use Tds\Frontend\Contract\SiteConnections;
use Tds\Frontend\Contract\SiteKeyProtected;
use Tds\Frontend\Contract\UserContext;

/**
 * Backend module for the Website-CMS: site registry, structured per-site content,
 * legal documents and targeted page-cache refreshes. Auth uses the core
 * UserContext (`website:read`/`website:write`, admins bypass); data uses core PDO.
 */
final class WebsiteCmsModule extends AbstractModule implements ApiDocSource, SiteKeyProtected
{
    private const LANGS = ['de', 'en'];

    public function id(): string
    {
        return 'website-cms';
    }

    /** @return PermissionDef[] */
    public function permissions(): array
    {
        return [
            new PermissionDef('website:read', 'Website-Inhalte ansehen', 'website-cms'),
            new PermissionDef('website:write', 'Website-Inhalte bearbeiten', 'website-cms'),
        ];
    }

    /** @return string[] */
    public function migrations(): array
    {
        return [__DIR__ . '/../db/migrations'];
    }

    public function register(App $app): void
    {
        $c = $app->getContainer();
        // NEVER guard these with `!$c->has(X)`. PHP-DI answers `has()` from its
        // definition sources, and autowiring is one of them: for any *concrete,
        // instantiable* class the answer is always true, whether or not anyone
        // ever bound it. So the guard skipped every one of these bindings and the
        // container silently autowired instead — invisible for the repository
        // (its only argument is the bound PDO, so the object is identical), fatal
        // for the two services below, whose constructors take strings PHP-DI
        // cannot guess. Saving a block 500'd with `Parameter $apiKey of
        // __construct() has no value defined or guessable` and the settings-store
        // factories here never ran at all. The module owns these classes; nothing
        // else defines them, so binding unconditionally is the correct shape.
        $c?->set(CmsRepository::class, static fn ($c) => new CmsRepository($c->get(PDO::class)));
        if ($c !== null) {
            $c->set(TranslationSync::class, static function ($c): TranslationSync {
                $store = self::setting($c);
                // DeepL key: settings store → WEBSITE_DEEPL_API_KEY → DEEPL_API_KEY.
                $key = $store?->getSecret('website-cms', 'deepl_api_key');
                if ($key === null || $key === '') {
                    $key = (string) (getenv('WEBSITE_DEEPL_API_KEY') ?: getenv('DEEPL_API_KEY') ?: '');
                }
                // Auto-translate flag: settings store ("0" disables) → env → default on.
                $flag = $store?->get('website-cms', 'auto_translate');
                if ($flag === null) {
                    $envFlag = getenv('WEBSITE_AUTO_TRANSLATE');
                    $flag = $envFlag === false ? '1' : (string) $envFlag;
                }
                $enabled = !in_array(strtolower($flag), ['0', 'false', 'no', 'off'], true);
                return new TranslationSync($c->get(CmsRepository::class), new DeeplTranslator($key), new TranslatableJsonWalker(), $enabled);
            });
        }

        // --- Public read surface (UNAUTHENTICATED) --------------------------
        // The successor to tds-content-api's open `GET /content/landing`, read by
        // the public landingpage and blog while rendering (landing sections plus
        // the blog's cookie_banner + ads config blocks). Serves the single default
        // site's blocks for a language as a section→value map. Keep it read-only.
        $app->get('/content/landing', function (Request $req, Response $res) use ($c): Response {
            // Graceful request-time fallback: any DB hiccup returns no blocks so
            // the public site uses its in-code defaults, never a 500.
            try {
                $repo = $c->get(CmsRepository::class);
                $site = self::requestSite($c, $repo);
                $lang = self::lang($req->getQueryParams()['lang'] ?? null);
                $blocks = $site === null ? [] : $repo->publicBlocks((int) $site['id'], $lang);
                return self::json($res, ['blocks' => (object) $blocks]);
            } catch (\Throwable) {
                return self::json($res, ['blocks' => (object) []]);
            }
        });

        // Public legal-document metadata: which uploaded PDFs exist for the
        // default site, per key and language. The landingpage reads this while
        // rendering to select the uploaded AGB or its committed fallback and to
        // render the "Stand: …" label. Same fail-safe as /content/landing.
        $app->get('/content/legal', function (Request $req, Response $res) use ($c): Response {
            try {
                $repo = $c->get(CmsRepository::class);
                $site = self::requestSite($c, $repo);
                $docs = [];
                foreach ($site === null ? [] : $repo->legalDocs((int) $site['id']) as $row) {
                    $docs[(string) $row['doc_key']][(string) $row['lang']] = self::legalMeta($row);
                }
                // Nested maps must be objects in JSON even when empty.
                foreach ($docs as $key => $langs) {
                    $docs[$key] = (object) $langs;
                }
                return self::json($res, ['docs' => (object) $docs]);
            } catch (\Throwable) {
                return self::json($res, ['docs' => (object) []]);
            }
        });

        // Public document bytes — what the landingpage loads while rendering and what
        // a visitor's browser would hit directly. Read-only and ungated, like
        // /content/landing; a missing document is a 404, never a 500.
        $app->get('/content/legal/{key:[a-z0-9-]+}.pdf', function (Request $req, Response $res, array $args) use ($c): Response {
            try {
                $repo = $c->get(CmsRepository::class);
                $site = self::requestSite($c, $repo);
                $lang = self::lang($req->getQueryParams()['lang'] ?? null);
                $doc = $site === null ? null : $repo->legalDocWithContent((int) $site['id'], (string) $args['key'], $lang);
                if ($doc === null) {
                    return self::json($res, ['error' => 'Not found'], 404);
                }
                return self::pdf($res, $doc);
            } catch (\Throwable) {
                return self::json($res, ['error' => 'Not found'], 404);
            }
        });

        // --- legal documents, admin side ------------------------------------

        $app->get('/cms/sites/{site:[a-z0-9-]+}/legal', function (Request $req, Response $res, array $args) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'website:read', $res)) !== null) {
                return $deny;
            }
            $repo = $c->get(CmsRepository::class);
            $site = $repo->findSite((string) $args['site']);
            if ($site === null) {
                return self::json($res, ['error' => 'Site not found'], 404);
            }
            $docs = array_map(
                static fn (array $row): array => self::legalMeta($row) + ['docKey' => (string) $row['doc_key'], 'lang' => (string) $row['lang']],
                $repo->legalDocs((int) $site['id']),
            );
            return self::json($res, ['docs' => $docs]);
        });

        // Multipart upload (field "file") — replaces the document for one
        // (site, key, language). Rejects anything that is not really a PDF.
        $app->post('/cms/sites/{site:[a-z0-9-]+}/legal/{key:[a-z0-9-]+}', function (Request $req, Response $res, array $args) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'website:write', $res)) !== null) {
                return $deny;
            }
            $key = (string) $args['key'];
            if (!LegalDocFile::keyValid($key)) {
                return self::json($res, ['error' => 'Invalid document key'], 422);
            }
            $file = $req->getUploadedFiles()['file'] ?? null;
            if (!$file instanceof UploadedFileInterface || $file->getError() !== UPLOAD_ERR_OK) {
                return self::json($res, ['error' => 'No valid file uploaded under "file"'], 400);
            }
            if ((int) $file->getSize() > LegalDocFile::MAX_BYTES) {
                return self::json($res, ['error' => 'File exceeds 8 MB'], 413);
            }
            $bytes = (string) $file->getStream();
            // Sniff the magic number — the client-declared media type is not evidence.
            if (!LegalDocFile::looksLikePdf($bytes)) {
                return self::json($res, ['error' => 'Only PDF documents are accepted'], 415);
            }
            $repo = $c->get(CmsRepository::class);
            $site = $repo->findSite((string) $args['site']);
            if ($site === null) {
                return self::json($res, ['error' => 'Site not found'], 404);
            }
            $body = (array) $req->getParsedBody();
            $lang = self::lang($body['lang'] ?? null);
            $label = trim((string) ($body['version_label'] ?? ''));
            $repo->putLegalDoc(
                (int) $site['id'],
                $key,
                $lang,
                LegalDocFile::sanitizeFilename((string) $file->getClientFilename()),
                LegalDocFile::MIME,
                $bytes,
                $label !== '' ? substr($label, 0, 128) : null,
            );
            $cache = self::fireCache($c, $site, [new CacheEvent('legal', $key, $lang)]);
            return self::json($res, array_merge(['ok' => true], $cache), 201);
        });

        $app->delete('/cms/sites/{site:[a-z0-9-]+}/legal/{key:[a-z0-9-]+}', function (Request $req, Response $res, array $args) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'website:write', $res)) !== null) {
                return $deny;
            }
            $repo = $c->get(CmsRepository::class);
            $site = $repo->findSite((string) $args['site']);
            if ($site === null) {
                return self::json($res, ['error' => 'Site not found'], 404);
            }
            $lang = self::lang($req->getQueryParams()['lang'] ?? null);
            $key = (string) $args['key'];
            if (!$repo->deleteLegalDoc((int) $site['id'], $key, $lang)) {
                return self::json($res, ['error' => 'Not found'], 404);
            }
            $cache = self::fireCache($c, $site, [new CacheEvent('legal', $key, $lang)]);
            return self::json($res, array_merge(['ok' => true], $cache));
        });

        // Admin preview of the stored bytes (the public route only ever serves
        // the DEFAULT site, so an editor managing a second site needs this one).
        $app->get('/cms/sites/{site:[a-z0-9-]+}/legal/{key:[a-z0-9-]+}/file', function (Request $req, Response $res, array $args) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'website:read', $res)) !== null) {
                return $deny;
            }
            $repo = $c->get(CmsRepository::class);
            $site = $repo->findSite((string) $args['site']);
            if ($site === null) {
                return self::json($res, ['error' => 'Site not found'], 404);
            }
            $lang = self::lang($req->getQueryParams()['lang'] ?? null);
            $doc = $repo->legalDocWithContent((int) $site['id'], (string) $args['key'], $lang);
            if ($doc === null) {
                return self::json($res, ['error' => 'Not found'], 404);
            }
            return self::pdf($res, $doc);
        });

        $app->get('/cms/summary', function (Request $req, Response $res) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'website:read', $res)) !== null) {
                return $deny;
            }
            return self::json($res, ['sites' => $c->get(CmsRepository::class)->siteCount()]);
        });

        $app->get('/cms/sites', function (Request $req, Response $res) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'website:read', $res)) !== null) {
                return $deny;
            }
            return self::json($res, ['sites' => $c->get(CmsRepository::class)->sites()]);
        });

        $app->post('/cms/sites', function (Request $req, Response $res) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'website:write', $res)) !== null) {
                return $deny;
            }
            $body = (array) $req->getParsedBody();
            $key = strtolower(trim((string) ($body['site_key'] ?? '')));
            $name = trim((string) ($body['name'] ?? ''));
            if (preg_match('/^[a-z0-9-]{2,64}$/', $key) !== 1 || $name === '') {
                return self::json($res, ['error' => 'site_key (kebab) and name are required'], 422);
            }
            $repo = $c->get(CmsRepository::class);
            if ($repo->siteKeyExists($key)) {
                return self::json($res, ['error' => 'site_key already exists'], 409);
            }
            return self::json($res, ['id' => $repo->createSite($key, $name)], 201);
        });

        $app->get('/cms/sites/{site:[a-z0-9-]+}/connection', function (Request $req, Response $res, array $args) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'website:read', $res)) !== null) {
                return $deny;
            }
            if ($c->get(CmsRepository::class)->findSite((string) $args['site']) === null) {
                return self::json($res, ['error' => 'Site not found'], 404);
            }
            $connections = self::connections($c);
            if ($connections === null) {
                return self::json($res, ['error' => 'Site connection service is not available'], 503);
            }
            $connection = $connections->get('website', (string) $args['site']);
            return $connection === null
                ? self::json($res, ['error' => 'Connection not found'], 404)
                : self::json($res, ['connection' => $connection->toArray()]);
        });

        $app->delete('/cms/sites/{site:[a-z0-9-]+}/connection', function (Request $req, Response $res, array $args) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'website:write', $res)) !== null) {
                return $deny;
            }
            if ($c->get(CmsRepository::class)->findSite((string) $args['site']) === null) {
                return self::json($res, ['error' => 'Site not found'], 404);
            }
            $connections = self::connections($c);
            if ($connections === null) {
                return self::json($res, ['error' => 'Site connection service is not available'], 503);
            }
            return self::json($res, ['ok' => true, 'deleted' => $connections->delete('website', (string) $args['site'])]);
        });

        $app->post('/cms/sites/{site:[a-z0-9-]+}/connection/pairing', function (Request $req, Response $res, array $args) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'website:write', $res)) !== null) {
                return $deny;
            }
            if ($c->get(CmsRepository::class)->findSite((string) $args['site']) === null) {
                return self::json($res, ['error' => 'Site not found'], 404);
            }
            $connections = self::connections($c);
            if ($connections === null) {
                return self::json($res, ['error' => 'Site connection service is not available'], 503);
            }
            $body = (array) $req->getParsedBody();
            $origin = trim((string) ($body['origin'] ?? ''));
            $provided = is_array($body['bindings'] ?? null) ? $body['bindings'] : [];
            $bindings = ['website' => (string) $args['site']];
            $candidates = self::bindingKeys($c, 'blog', 'blog_key');
            $blog = trim((string) ($provided['blog'] ?? ''));
            if ($blog !== '') {
                if (!in_array($blog, $candidates, true)) {
                    return self::json($res, [
                        'error' => 'Der gewählte Blog-Schlüssel existiert nicht.',
                        'candidates' => $candidates,
                    ], 422);
                }
                $bindings['blog'] = $blog;
            } else {
                if (count($candidates) === 1) {
                    $bindings['blog'] = $candidates[0];
                } elseif (count($candidates) > 1) {
                    return self::json($res, [
                        'error' => 'Bei mehreren Blogs muss der Blog-Schlüssel gewählt werden.',
                        'candidates' => $candidates,
                    ], 422);
                }
            }
            $scopes = ['/content/landing', '/content/legal'];
            if (isset($bindings['blog'])) {
                $scopes = array_merge($scopes, ['/content/blog', '/content/topics', '/content/snippets']);
            }
            try {
                $pairing = $connections->createPairing(
                    'website',
                    (string) $args['site'],
                    $origin,
                    'landingpage',
                    $bindings,
                    $scopes,
                );
                return self::json($res, $connections->deliverPairing($pairing, self::apiBase($req))->toArray(), 201);
            } catch (SiteConnectionException $e) {
                return self::json($res, ['error' => $e->getMessage(), 'code' => $e->errorCode], $e->httpStatus);
            } catch (\Throwable $e) {
                error_log('[website-cms] pairing failed: ' . $e->getMessage());
                return self::json($res, ['error' => 'Pairing could not be created'], 503);
            }
        });

        $app->get('/cms/{site:[a-z0-9-]+}/blocks', function (Request $req, Response $res, array $args) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'website:read', $res)) !== null) {
                return $deny;
            }
            $repo = $c->get(CmsRepository::class);
            $site = $repo->findSite((string) $args['site']);
            if ($site === null) {
                return self::json($res, ['error' => 'Site not found'], 404);
            }
            return self::json($res, ['blocks' => $repo->blocks((int) $site['id'])]);
        });

        $app->get('/cms/{site:[a-z0-9-]+}/blocks/{key:[a-z0-9_-]+}', function (Request $req, Response $res, array $args) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'website:read', $res)) !== null) {
                return $deny;
            }
            $repo = $c->get(CmsRepository::class);
            $site = $repo->findSite((string) $args['site']);
            if ($site === null) {
                return self::json($res, ['error' => 'Site not found'], 404);
            }
            $lang = self::lang($req->getQueryParams()['lang'] ?? 'de');
            return self::json($res, ['value' => $repo->getBlock((int) $site['id'], (string) $args['key'], $lang), 'lang' => $lang]);
        });

        $app->put('/cms/{site:[a-z0-9-]+}/blocks/{key:[a-z0-9_-]+}', function (Request $req, Response $res, array $args) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'website:write', $res)) !== null) {
                return $deny;
            }
            $repo = $c->get(CmsRepository::class);
            $site = $repo->findSite((string) $args['site']);
            if ($site === null) {
                return self::json($res, ['error' => 'Site not found'], 404);
            }
            $body = (array) $req->getParsedBody();
            if (!array_key_exists('value', $body) || !is_array($body['value'])) {
                return self::json($res, ['error' => 'value (object) is required'], 422);
            }
            $lang = self::lang($body['lang'] ?? 'de');
            // A manual save is authored content — machine_translated=false clears the flag.
            $repo->putBlock((int) $site['id'], (string) $args['key'], $lang, json_encode($body['value'], JSON_THROW_ON_ERROR), false);
            // Auto-translate the counterpart language (best-effort).
            $translated = $c->get(TranslationSync::class)->afterSave((int) $site['id'], (string) $args['key'], $lang, $body['value']);
            // Both languages when the counterpart was machine-translated in the
            // same call: the English page changed too, and rebuilding only the
            // saved language leaves it showing the previous translation.
            $cache = self::fireCache($c, $site, $translated
                ? [new CacheEvent('block', (string) $args['key'])]
                : [new CacheEvent('block', (string) $args['key'], $lang)]);
            return self::json($res, array_merge(['ok' => true, 'translated' => $translated], $cache));
        });

        // Rebuild a site's PAGE CACHE ("Seiten-Cache neu bauen").
        //
        // Re-renders pages from content that is already saved; it never deploys.
        $app->post('/cms/sites/{site:[a-z0-9-]+}/cache/rebuild', function (Request $req, Response $res, array $args) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'website:write', $res)) !== null) {
                return $deny;
            }
            $repo = $c->get(CmsRepository::class);
            $site = $repo->findSite((string) $args['site']);
            if ($site === null) {
                return self::json($res, ['error' => 'Site not found'], 404);
            }
            if (self::connection($c, 'website', (string) $args['site']) === null) {
                $legacyOrigin = trim((string) ($site['cache_url'] ?? ''));
                if ($legacyOrigin === '') {
                    return self::json($res, ['error' => 'This site is not connected'], 503);
                }
                if (CacheOrigin::normalize($legacyOrigin) === null) {
                    return self::json($res, ['error' => 'The configured legacy cache origin is invalid'], 422);
                }
            }
            $body = (array) $req->getParsedBody();
            $all = !empty($body['all']);
            $cache = self::fireCache($c, $site, $all ? [] : [new CacheEvent('block')], $all);
            return self::json($res, array_merge(['ok' => $cache['cached']], $cache), self::manualCacheStatus($cache));
        });

        $app->delete('/cms/{site:[a-z0-9-]+}/blocks/{key:[a-z0-9_-]+}', function (Request $req, Response $res, array $args) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'website:write', $res)) !== null) {
                return $deny;
            }
            $repo = $c->get(CmsRepository::class);
            $site = $repo->findSite((string) $args['site']);
            if ($site === null) {
                return self::json($res, ['error' => 'Site not found'], 404);
            }
            $lang = self::lang($req->getQueryParams()['lang'] ?? 'de');
            $repo->deleteBlock((int) $site['id'], (string) $args['key'], $lang);
            // A machine-translated counterpart was derived from this block — drop it too.
            $c->get(TranslationSync::class)->afterDelete((int) $site['id'], (string) $args['key'], $lang);
            $cache = self::fireCache($c, $site, [new CacheEvent('block', (string) $args['key'])]);
            return self::json($res, array_merge(['ok' => true], $cache));
        });

        // Catch up translations for a site's existing blocks (button in tds-admin).
        $app->post('/cms/sites/{site:[a-z0-9-]+}/translations/backfill', function (Request $req, Response $res, array $args) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'website:write', $res)) !== null) {
                return $deny;
            }
            $repo = $c->get(CmsRepository::class);
            $site = $repo->findSite((string) $args['site']);
            if ($site === null) {
                return self::json($res, ['error' => 'Site not found'], 404);
            }
            $sync = $c->get(TranslationSync::class);
            if (!$sync->active()) {
                return self::json($res, ['error' => 'Auto-translation is not configured'], 503);
            }
            $created = 0;
            $skipped = 0;
            foreach ($repo->blocks((int) $site['id']) as $meta) {
                // Machine rows are targets, not sources.
                if ((int) ($meta['machine_translated'] ?? 0) === 1) {
                    $skipped++;
                    continue;
                }
                $value = $repo->getBlock((int) $site['id'], (string) $meta['section_key'], (string) $meta['lang']);
                $wrote = $sync->afterSave((int) $site['id'], (string) $meta['section_key'], (string) $meta['lang'], $value);
                $wrote ? $created++ : $skipped++;
            }
            $cache = $created > 0
                ? self::fireCache($c, $site, [new CacheEvent('block')])
                : self::emptyCacheReport('skipped');
            return self::json($res, array_merge(['created' => $created, 'translation_skipped' => $skipped], $cache));
        });
    }

    // --- helpers ---------------------------------------------------------------

    /**
     * Ask a site to re-render the pages a content change affects.
     *
     * Never throws and never fails the save: a site that is down, moved or not
     * configured yet must not turn "save this block" into an error. The block
     * is stored either way and the panel has a rebuild button to catch up.
     *
     * `has()` is legitimate here because SiteCache is an INTERFACE — the base
     * either bound an implementation or it did not. On a concrete class the
     * same check always answers true (PHP-DI autowires), which is the trap
     * this module's own binding comment documents.
     *
     * Returns whether a request actually went out, so a caller can tell the
     * operator the truth. Saying "Seiten-Cache wird neu gebaut" on a site with
     * no cache URL is the cheerful-success-for-a-request-nobody-sent failure
     * this codebase keeps re-learning; the boolean is what lets the panel say
     * "gespeichert, aber kein Seiten-Cache hinterlegt" instead.
     *
     * @param array<string,mixed> $site
     * @param CacheEvent[] $events
     * @return array{cache_status:string,cached:bool,rebuilt:array,skipped:array,failed:array,unknownEvents:array}
     */
    private static function fireCache(ContainerInterface $c, array $site, array $events, bool $all = false): array
    {
        try {
            // "Everything" is expressed as one event per type with no id, which the
            // site expands into its own entry points. The alternative — sending a
            // path list — would put this module's idea of another repo's URLs into
            // the payload, which is exactly what CacheEvent exists to avoid.
            $payload = $all
                ? [new CacheEvent('block'), new CacheEvent('legal')]
                : $events;

            if ($payload === []) {
                return self::emptyCacheReport('skipped');
            }
            $connection = self::connection($c, 'website', (string) $site['site_key']);
            if ($connection !== null && $c->has(ConnectedSiteCache::class)) {
                $cache = $c->get(ConnectedSiteCache::class);
                $reports = [];
                foreach ($payload as $event) {
                    $reports[] = $cache->refresh('website', (string) $site['site_key'], $event)->toArray();
                }
                return self::mergeCacheReports($reports);
            }
            if ($connection !== null) {
                return self::emptyCacheReport('not_configured');
            }
            if (!$c->has(SiteCache::class)) {
                return self::emptyCacheReport('not_configured');
            }
            $url = CacheOrigin::normalize((string) ($site['cache_url'] ?? ''));
            if ($url === null) {
                return self::emptyCacheReport('not_configured');
            }
            $token = self::setting($c)?->getSecret('website-cms', 'cache_token');
            if ($token === null || $token === '') {
                $token = (string) (getenv('WEBSITE_CACHE_TOKEN') ?: '');
            }

            $cache = $c->get(SiteCache::class);
            // Ask before sending: `rebuild()` is a documented no-op without a
            // token, and a no-op reported as a rebuild is the same lie as above.
            if (!$cache->isConfigured($url, $token)) {
                return self::emptyCacheReport('not_configured');
            }
            if ($cache instanceof ReportingSiteCache) {
                return $cache->rebuildWithResult($url, $token, $payload)->toArray();
            }
            $cache->rebuild($url, $token, $payload);
            $report = self::emptyCacheReport('skipped');
            $report['unknownEvents'][] = ['reason' => 'legacy_transport_has_no_result'];
            return $report;
        } catch (\Throwable $e) {
            // Cache refresh is best-effort and must never turn an already-saved
            // content mutation into a 500. Never include the token in this log.
            error_log('[website-cms] page-cache request failed: ' . $e->getMessage());
            $report = self::emptyCacheReport('failed');
            $report['failed'][] = ['reason' => 'transport_error'];
            return $report;
        }
    }

    private static function connections(ContainerInterface $c): ?SiteConnections
    {
        try {
            return $c->has(SiteConnections::class) ? $c->get(SiteConnections::class) : null;
        } catch (\Throwable) {
            return null;
        }
    }

    private static function connection(ContainerInterface $c, string $type, string $id): mixed
    {
        try {
            return self::connections($c)?->get($type, $id);
        } catch (\Throwable) {
            return null;
        }
    }

    /** A keyed request must resolve its explicit site; only a keyless request may use the legacy default. */
    private static function requestSite(ContainerInterface $c, CmsRepository $repo): ?array
    {
        try {
            if (!$c->has(SiteConnectionIdentity::class)) {
                return $repo->defaultSite();
            }
            $identity = $c->get(SiteConnectionIdentity::class);
            if (!$identity->isConnected()) {
                return $repo->defaultSite();
            }
            $key = $identity->resourceType === 'website'
                ? $identity->resourceId
                : $identity->binding('website');
            if (!is_string($key) || trim($key) === '') {
                return null;
            }
            return ctype_digit($key) ? $repo->findSiteById((int) $key) : $repo->findSite($key);
        } catch (\Throwable) {
            return null;
        }
    }

    /** @return list<string> */
    private static function bindingKeys(ContainerInterface $c, string $table, string $column): array
    {
        try {
            $rows = $c->get(PDO::class)->query("SELECT {$column} FROM {$table} ORDER BY {$column}")->fetchAll(PDO::FETCH_COLUMN);
            return array_values(array_filter(array_map('strval', $rows), static fn (string $v): bool => $v !== ''));
        } catch (\Throwable) {
            return [];
        }
    }

    private static function apiBase(Request $req): string
    {
        $uri = $req->getUri();
        return $uri->getScheme() . '://' . $uri->getAuthority();
    }

    /** @return array{cache_status:string,cached:bool,rebuilt:array,skipped:array,failed:array,unknownEvents:array} */
    private static function emptyCacheReport(string $status): array
    {
        return [
            'cache_status' => $status,
            'cached' => false,
            'rebuilt' => [],
            'skipped' => [],
            'failed' => [],
            'unknownEvents' => [],
        ];
    }

    /** @param list<array<string,mixed>> $reports */
    private static function mergeCacheReports(array $reports): array
    {
        if ($reports === []) {
            return self::emptyCacheReport('skipped');
        }
        $merged = self::emptyCacheReport('refreshed');
        $merged['cached'] = true;
        $statuses = [];
        foreach ($reports as $report) {
            $statuses[] = (string) ($report['cache_status'] ?? 'failed');
            $merged['cached'] = $merged['cached'] && (bool) ($report['cached'] ?? false);
            foreach (['rebuilt', 'skipped', 'failed', 'unknownEvents'] as $key) {
                $values = $report[$key] ?? [];
                if (is_array($values)) {
                    $merged[$key] = array_merge($merged[$key], $values);
                }
            }
        }
        if (in_array('failed', $statuses, true)) {
            $merged['cache_status'] = 'failed';
        } elseif (in_array('not_configured', $statuses, true)) {
            $merged['cache_status'] = count(array_unique($statuses)) === 1 ? 'not_configured' : 'failed';
        } elseif (!$merged['cached'] || in_array('skipped', $statuses, true)) {
            $merged['cache_status'] = 'skipped';
        }
        return $merged;
    }

    /** @param array{cache_status:string,cached:bool} $report */
    private static function manualCacheStatus(array $report): int
    {
        return match ($report['cache_status']) {
            'refreshed' => 202,
            'not_configured' => 503,
            default => 502,
        };
    }

    private static function require(UserContext $user, string $permission, Response $res): ?Response
    {
        if (!$user->isAuthenticated()) {
            return self::json($res, ['error' => 'Unauthorized'], 401);
        }
        if (!$user->has($permission)) {
            return self::json($res, ['error' => 'Forbidden'], 403);
        }
        return null;
    }

    /**
     * A legal document row as the API exposes it — metadata only, never the
     * bytes (a listing must not ship megabytes of base64).
     *
     * @param array<string,mixed> $row
     * @return array<string,mixed>
     */
    private static function legalMeta(array $row): array
    {
        return [
            'filename' => (string) $row['filename'],
            'sizeBytes' => (int) $row['size_bytes'],
            'versionLabel' => $row['version_label'] !== null ? (string) $row['version_label'] : null,
            'updatedAt' => (string) $row['updated_at'],
        ];
    }

    /**
     * Stream a stored document. `inline` so a browser opening the URL shows the
     * PDF rather than downloading it — the landingpage's own download button
     * sets the `download` attribute when it wants the other behaviour.
     *
     * @param array<string,mixed> $doc
     */
    private static function pdf(Response $res, array $doc): Response
    {
        $res->getBody()->write((string) $doc['content']);
        return $res
            ->withHeader('Content-Type', LegalDocFile::MIME)
            ->withHeader('Content-Length', (string) strlen((string) $doc['content']))
            ->withHeader('Content-Disposition', 'inline; filename="' . LegalDocFile::sanitizeFilename((string) $doc['filename']) . '"');
    }

    private static function lang(mixed $value): string
    {
        $v = is_string($value) ? strtolower($value) : '';
        return in_array($v, self::LANGS, true) ? $v : 'de';
    }

    /**
     * The core's settings store if the base bound it (it resolves the contract
     * interface), else null — so an isolated unit test (no core) falls back to env.
     */
    private static function setting(\Psr\Container\ContainerInterface $c): ?SettingsStore
    {
        return $c->has(SettingsStore::class) ? $c->get(SettingsStore::class) : null;
    }

    private static function json(Response $res, mixed $data, int $status = 200): Response
    {
        $res->getBody()->write(json_encode($data, JSON_THROW_ON_ERROR));
        return $res->withStatus($status)->withHeader('Content-Type', 'application/json');
    }

    /**
     * Route documentation for the admin frontend's API reference. Kept in its
     * own file so the prose does not sit in the middle of the wiring.
     *
     * @return list<array<string, mixed>>
     */
    public function apiDocs(): array
    {
        return require __DIR__ . '/../docs/api.php';
    }

    /**
     * The routes the public landingpage reads while rendering.
     *
     * `/content/legal` covers the PDF endpoint under it as well
     * (`/content/legal/{key}.pdf`), and that is deliberate: it is fetched by the
     * same request-time integration that fetches the listing, and the
     * landingpage keeps a committed fallback PDF for exactly the case where it
     * cannot be reached.
     *
     * Only this module's routes are listed. `/content` as a prefix would also
     * swallow blog-cms's, i.e. one module gating another's surface — and it
     * would stop doing so the day blog-cms renamed a path, with nothing to
     * notice.
     *
     * @return list<string>
     */
    public function siteKeyRoutes(): array
    {
        return ['/content/landing', '/content/legal'];
    }
}
