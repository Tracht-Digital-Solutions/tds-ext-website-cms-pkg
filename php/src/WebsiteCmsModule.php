<?php
declare(strict_types=1);

namespace Tds\Ext\WebsiteCms;

use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\App;
use Tds\Ext\WebsiteCms\Domain\CmsRepository;
use Tds\Ext\WebsiteCms\Service\DeeplTranslator;
use Tds\Ext\WebsiteCms\Service\RebuildTrigger;
use Tds\Ext\WebsiteCms\Service\TranslatableJsonWalker;
use Tds\Ext\WebsiteCms\Service\TranslationSync;
use Tds\Frontend\Contract\AbstractModule;
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
final class WebsiteCmsModule extends AbstractModule
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
}
