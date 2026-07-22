<?php
declare(strict_types=1);

namespace Tds\Ext\WebsiteCms\Tests;

use DI\Container;
use PHPUnit\Framework\TestCase;
use Slim\Factory\AppFactory;
use Slim\Psr7\Factory\ServerRequestFactory;
use Tds\Ext\WebsiteCms\WebsiteCmsModule;
use Tds\Frontend\Contract\UserContext;

/** Configurable UserContext double. */
final class FakeUser implements UserContext
{
    /** @param string[] $perms */
    public function __construct(
        private bool $auth = true,
        private bool $admin = false,
        private array $perms = [],
    ) {
    }

    public function isAuthenticated(): bool
    {
        return $this->auth;
    }

    public function userId(): ?int
    {
        return 1;
    }

    public function email(): ?string
    {
        return null;
    }

    public function isAdmin(): bool
    {
        return $this->admin;
    }

    /** @return string[] */
    public function permissions(): array
    {
        return $this->perms;
    }

    public function has(string $permission): bool
    {
        return $this->admin || in_array($permission, $this->perms, true);
    }

    public function activeCompanyId(): ?int
    {
        return null;
    }
}

/**
 * Route + RBAC coverage without a DB: the auth checks (and payload validation)
 * short-circuit before any repository access.
 */
final class WebsiteCmsModuleTest extends TestCase
{
    private function appWith(UserContext $user): \Slim\App
    {
        $container = new Container();
        $container->set(UserContext::class, $user);
        AppFactory::setContainer($container);
        $app = AppFactory::create();
        $app->addBodyParsingMiddleware();
        $app->addRoutingMiddleware();
        (new WebsiteCmsModule())->register($app);
        return $app;
    }

    private function get(\Slim\App $app, string $path): \Psr\Http\Message\ResponseInterface
    {
        return $app->handle((new ServerRequestFactory())->createServerRequest('GET', $path));
    }

    /** @param array<string,mixed> $body */
    private function post(\Slim\App $app, string $path, array $body): \Psr\Http\Message\ResponseInterface
    {
        return $app->handle(
            (new ServerRequestFactory())->createServerRequest('POST', $path)->withParsedBody($body)
        );
    }

    /** @param array<string,mixed> $body */
    private function put(\Slim\App $app, string $path, array $body): \Psr\Http\Message\ResponseInterface
    {
        return $app->handle(
            (new ServerRequestFactory())->createServerRequest('PUT', $path)->withParsedBody($body)
        );
    }

    public function testMetadata(): void
    {
        $module = new WebsiteCmsModule();
        self::assertSame('website-cms', $module->id());
        $ids = array_map(static fn ($p): string => $p->id, $module->permissions());
        self::assertSame(['website:read', 'website:write'], $ids);
        self::assertDirectoryExists($module->migrations()[0]);
    }

    public function testSummaryRequiresAuth(): void
    {
        self::assertSame(401, $this->get($this->appWith(new FakeUser(auth: false)), '/cms/summary')->getStatusCode());
    }

    public function testSummaryForbiddenWithoutPermission(): void
    {
        self::assertSame(403, $this->get($this->appWith(new FakeUser(perms: [])), '/cms/summary')->getStatusCode());
    }

    public function testCreateSiteRequiresWrite(): void
    {
        $res = $this->post($this->appWith(new FakeUser(perms: ['website:read'])), '/cms/sites', ['site_key' => 'x', 'name' => 'X']);
        self::assertSame(403, $res->getStatusCode());
    }

    public function testCreateSiteValidatesKey(): void
    {
        $res = $this->post($this->appWith(new FakeUser(perms: ['website:write'])), '/cms/sites', ['site_key' => 'Bad Key!', 'name' => 'X']);
        self::assertSame(422, $res->getStatusCode());
    }

    public function testRebuildConfigRequiresWrite(): void
    {
        // read-only → 403, before the repo/rebuild trigger.
        $res = $this->put($this->appWith(new FakeUser(perms: ['website:read'])), '/cms/sites/demo/rebuild-config', ['rebuild_repo' => 'a/b']);
        self::assertSame(403, $res->getStatusCode());
    }

    public function testManualRebuildRequiresWrite(): void
    {
        $res = $this->post($this->appWith(new FakeUser(perms: ['website:read'])), '/cms/sites/demo/rebuild', []);
        self::assertSame(403, $res->getStatusCode());
    }

    public function testBackfillRequiresWrite(): void
    {
        $res = $this->post($this->appWith(new FakeUser(perms: ['website:read'])), '/cms/sites/demo/translations/backfill', []);
        self::assertSame(403, $res->getStatusCode());
    }

    public function testJsonWalkerCollectsCopyAndSkipsNonCopy(): void
    {
        $walker = new \Tds\Ext\WebsiteCms\Service\TranslatableJsonWalker();
        $value = [
            'headline' => 'Willkommen',
            'href' => '/kontakt',              // skip-key
            'cta' => 'https://example.com',    // looks non-copy
            'email' => 'a@b.de',               // skip-key + shape
            'items' => [['q' => 'Frage?', 'a' => 'Antwort.']],
        ];
        // Copy leaves collected depth-first, non-copy skipped.
        self::assertSame(['Willkommen', 'Frage?', 'Antwort.'], $walker->collect($value));

        // apply() maps a same-length translations array back 1:1, leaving structure intact.
        $applied = $walker->apply($value, ['Welcome', 'Question?', 'Answer.']);
        self::assertSame('Welcome', $applied['headline']);
        self::assertSame('/kontakt', $applied['href']);
        self::assertSame('Question?', $applied['items'][0]['q']);
        self::assertSame('Answer.', $applied['items'][0]['a']);
    }
}
