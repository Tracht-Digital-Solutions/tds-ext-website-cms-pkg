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
use Tds\Ext\WebsiteCms\Service\RebuildTrigger;
use Tds\Ext\WebsiteCms\Service\TranslatableJsonWalker;
use Tds\Ext\WebsiteCms\Service\TranslationSync;
use Tds\Ext\WebsiteCms\Support\LegalDocFile;
use Tds\Frontend\Contract\AbstractModule;
use Tds\Frontend\Contract\ApiDocSource;
use Tds\Frontend\Contract\PermissionDef;
use Tds\Frontend\Contract\SettingsStore;
use Tds\Frontend\Contract\UserContext;

/**
 * Backend Module for the Website-CMS (checkpoint-1: site registry + per-(site,
 * section, lang) JSON content-block CRUD + the sites widget summary). Auth via
 * the core UserContext (`website:read`/`website:write`, admins bypass); data via
 * the core PDO. A save triggering a static-site rebuild (workflow_dispatch) lands
 * in a later checkpoint.
 */
final class WebsiteCmsModule extends AbstractModule implements ApiDocSource
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
        if ($c !== null && !$c->has(CmsRepository::class)) {
            $c->set(CmsRepository::class, static fn ($c) => new CmsRepository($c->get(PDO::class)));
        }
        if ($c !== null && !$c->has(RebuildTrigger::class)) {
            $c->set(RebuildTrigger::class, static function ($c): RebuildTrigger {
                // DB-first (settings store), env fallback for the rebuild PAT.
                $token = self::setting($c)?->getSecret('website-cms', 'rebuild_token');
                if ($token === null || $token === '') {
                    $token = (string) (getenv('WEBSITE_REBUILD_TOKEN') ?: '');
                }
                $ref = (string) (getenv('WEBSITE_REBUILD_REF') ?: 'main');
                return new RebuildTrigger($token, $ref !== '' ? $ref : 'main');
            });
        }
        if ($c !== null && !$c->has(TranslationSync::class)) {
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
        // The successor to tds-content-api's open `GET /content/landing` that the
        // public landingpage + blog SSG builds fetch at build time (landing
        // sections, plus the blog's cookie_banner + ads config blocks). Serves
        // the single default site's blocks for a language as a section→value map.
        // The ONLY ungated route in this module; keep it read-only.
        $app->get('/content/landing', function (Request $req, Response $res) use ($c): Response {
            // Graceful for a build-fetch: any DB hiccup returns no blocks so the
            // public build falls back to its baked defaults, never a 500.
            try {
                $repo = $c->get(CmsRepository::class);
                $site = $repo->defaultSite();
                $lang = self::lang($req->getQueryParams()['lang'] ?? null);
                $blocks = $site === null ? [] : $repo->publicBlocks((int) $site['id'], $lang);
                return self::json($res, ['blocks' => (object) $blocks]);
            } catch (\Throwable) {
                return self::json($res, ['blocks' => (object) []]);
            }
        });

        // Public legal-document metadata: which uploaded PDFs exist for the
        // default site, per key and language. The landingpage build reads this
        // to decide whether to bake the uploaded AGB or its committed fallback,
        // and to render the "Stand: …" label. Same fail-safe as /content/landing.
        $app->get('/content/legal', function (Request $req, Response $res) use ($c): Response {
            try {
                $repo = $c->get(CmsRepository::class);
                $site = $repo->defaultSite();
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

        // Public document bytes — what the landingpage build downloads and what
        // a visitor's browser would hit directly. Read-only and ungated, like
        // /content/landing; a missing document is a 404, never a 500.
        $app->get('/content/legal/{key:[a-z0-9-]+}.pdf', function (Request $req, Response $res, array $args) use ($c): Response {
            try {
                $repo = $c->get(CmsRepository::class);
                $site = $repo->defaultSite();
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
            self::fireRebuild($c->get(RebuildTrigger::class), $site, 'legal doc ' . $key . ' (' . $lang . ') uploaded');
            return self::json($res, ['ok' => true], 201);
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
            self::fireRebuild($c->get(RebuildTrigger::class), $site, 'legal doc ' . $key . ' (' . $lang . ') deleted');
            return self::json($res, ['ok' => true]);
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
            self::fireRebuild($c->get(RebuildTrigger::class), $site, 'block ' . (string) $args['key'] . ' saved');
            return self::json($res, ['ok' => true, 'translated' => $translated]);
        });

        // Set a site's rebuild target (repo/workflow); blank clears it.
        $app->put('/cms/sites/{site:[a-z0-9-]+}/rebuild-config', function (Request $req, Response $res, array $args) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'website:write', $res)) !== null) {
                return $deny;
            }
            $repo = $c->get(CmsRepository::class);
            $site = $repo->findSite((string) $args['site']);
            if ($site === null) {
                return self::json($res, ['error' => 'Site not found'], 404);
            }
            $body = (array) $req->getParsedBody();
            $repoName = trim((string) ($body['rebuild_repo'] ?? ''));
            $workflow = trim((string) ($body['rebuild_workflow'] ?? ''));
            if ($repoName !== '' && preg_match('#^[\w.-]+/[\w.-]+$#', $repoName) !== 1) {
                return self::json($res, ['error' => 'rebuild_repo must be "owner/name"'], 422);
            }
            $repo->updateSiteRebuild((int) $site['id'], $repoName !== '' ? $repoName : null, $workflow !== '' ? $workflow : null);
            return self::json($res, ['ok' => true]);
        });

        // Manually fire a site's rebuild ("Jetzt neu bauen").
        $app->post('/cms/sites/{site:[a-z0-9-]+}/rebuild', function (Request $req, Response $res, array $args) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'website:write', $res)) !== null) {
                return $deny;
            }
            $repo = $c->get(CmsRepository::class);
            $site = $repo->findSite((string) $args['site']);
            if ($site === null) {
                return self::json($res, ['error' => 'Site not found'], 404);
            }
            $trigger = $c->get(RebuildTrigger::class);
            if (!$trigger->isConfigured()) {
                return self::json($res, ['error' => 'Rebuild token not configured'], 503);
            }
            if (trim((string) ($site['rebuild_repo'] ?? '')) === '') {
                return self::json($res, ['error' => 'No rebuild repo configured for this site'], 422);
            }
            self::fireRebuild($trigger, $site, 'manual rebuild');
            return self::json($res, ['ok' => true], 202);
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
            self::fireRebuild($c->get(RebuildTrigger::class), $site, 'block ' . (string) $args['key'] . ' deleted');
            return self::json($res, ['ok' => true]);
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
            if ($created > 0) {
                self::fireRebuild($c->get(RebuildTrigger::class), $site, 'translation backfill');
            }
            return self::json($res, ['created' => $created, 'skipped' => $skipped]);
        });
    }

    // --- helpers ---------------------------------------------------------------

    /** @param array<string,mixed> $site */
    private static function fireRebuild(RebuildTrigger $trigger, array $site, string $reason): void
    {
        $trigger->trigger(
            isset($site['rebuild_repo']) ? (string) $site['rebuild_repo'] : null,
            isset($site['rebuild_workflow']) ? (string) $site['rebuild_workflow'] : null,
            $reason,
        );
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
}
