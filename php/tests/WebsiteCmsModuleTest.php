<?php
declare(strict_types=1);

namespace Tds\Ext\WebsiteCms\Tests;

use DI\Container;
use PHPUnit\Framework\TestCase;
use Slim\Factory\AppFactory;
use Slim\Psr7\Factory\ServerRequestFactory;
use Tds\Ext\WebsiteCms\Support\LegalDocFile;
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

    public function testConnectionStatusRequiresRead(): void
    {
        self::assertSame(401, $this->get($this->appWith(new FakeUser(auth: false)), '/cms/sites/demo/connection')->getStatusCode());
        self::assertSame(403, $this->get($this->appWith(new FakeUser(perms: [])), '/cms/sites/demo/connection')->getStatusCode());
    }

    public function testPairingRequiresWrite(): void
    {
        $res = $this->post($this->appWith(new FakeUser(perms: ['website:read'])), '/cms/sites/demo/connection/pairing', [
            'origin' => 'https://site.example',
        ]);
        self::assertSame(403, $res->getStatusCode());
    }

    public function testBackfillRequiresWrite(): void
    {
        $res = $this->post($this->appWith(new FakeUser(perms: ['website:read'])), '/cms/sites/demo/translations/backfill', []);
        self::assertSame(403, $res->getStatusCode());
    }

    // --- legal documents -----------------------------------------------------

    public function testLegalDocListRequiresRead(): void
    {
        $res = $this->get($this->appWith(new FakeUser(perms: [])), '/cms/sites/demo/legal');
        self::assertSame(403, $res->getStatusCode());
    }

    public function testLegalDocUploadRequiresWrite(): void
    {
        // read-only → 403, before the upload is even inspected.
        $res = $this->post($this->appWith(new FakeUser(perms: ['website:read'])), '/cms/sites/demo/legal/agb', []);
        self::assertSame(403, $res->getStatusCode());
    }

    public function testLegalDocUploadRejectsMissingFile(): void
    {
        // Writer, but no multipart part named "file" → 400 before any DB access.
        $res = $this->post($this->appWith(new FakeUser(perms: ['website:write'])), '/cms/sites/demo/legal/agb', ['lang' => 'de']);
        self::assertSame(400, $res->getStatusCode());
    }

    public function testLegalDocUploadRejectsNonPdf(): void
    {
        // A .pdf filename and an application/pdf media type are both client-
        // supplied; only the magic number decides. 415, and never a stored row.
        $app = $this->appWith(new FakeUser(perms: ['website:write']));
        $req = (new ServerRequestFactory())
            ->createServerRequest('POST', '/cms/sites/demo/legal/agb')
            ->withParsedBody(['lang' => 'de'])
            ->withUploadedFiles(['file' => $this->upload('<html>nope</html>', 'agb.pdf')]);
        self::assertSame(415, $app->handle($req)->getStatusCode());
    }

    public function testLegalDocUploadRejectsOversizeBeforeReadingIt(): void
    {
        $app = $this->appWith(new FakeUser(perms: ['website:write']));
        $req = (new ServerRequestFactory())
            ->createServerRequest('POST', '/cms/sites/demo/legal/agb')
            ->withParsedBody(['lang' => 'de'])
            // Declared size over the cap — rejected on the declaration, so an
            // oversize upload is never pulled into memory.
            ->withUploadedFiles(['file' => $this->upload('%PDF-1.7', 'agb.pdf', LegalDocFile::MAX_BYTES + 1)]);
        self::assertSame(413, $app->handle($req)->getStatusCode());
    }

    public function testLegalDocDeleteRequiresWrite(): void
    {
        $app = $this->appWith(new FakeUser(perms: ['website:read']));
        $res = $app->handle((new ServerRequestFactory())->createServerRequest('DELETE', '/cms/sites/demo/legal/agb'));
        self::assertSame(403, $res->getStatusCode());
    }

    public function testLegalDocFilenameSanitisationCannotEscapeTheHeader(): void
    {
        // Content-Disposition is built from this, so a quote, newline or path
        // separator surviving would be a header-injection hole.
        self::assertSame('a_b.pdf', LegalDocFile::sanitizeFilename('a"b.pdf'));
        self::assertSame('etc_passwd.pdf', LegalDocFile::sanitizeFilename('../../etc/passwd'));
        self::assertSame('a_b.pdf', LegalDocFile::sanitizeFilename("a\r\nb.pdf"));
        self::assertSame('dokument.pdf', LegalDocFile::sanitizeFilename(''));
        // An already-clean name keeps its extension rather than gaining a second one.
        self::assertSame('AGB_2026.pdf', LegalDocFile::sanitizeFilename('AGB_2026.pdf'));
    }

    public function testLegalDocKeyValidation(): void
    {
        self::assertTrue(LegalDocFile::keyValid('agb'));
        self::assertTrue(LegalDocFile::keyValid('widerrufs-belehrung'));
        self::assertFalse(LegalDocFile::keyValid('a'));
        self::assertFalse(LegalDocFile::keyValid('AGB'));
        self::assertFalse(LegalDocFile::keyValid('../etc'));
    }

    public function testPdfSniffing(): void
    {
        self::assertTrue(LegalDocFile::looksLikePdf('%PDF-1.7 …'));
        // Some producers emit a preamble before the header; file(1) allows the
        // same slack, so a real-world PDF is not rejected for it.
        self::assertTrue(LegalDocFile::looksLikePdf(str_repeat(' ', 100) . '%PDF-1.4'));
        self::assertFalse(LegalDocFile::looksLikePdf('PK' . "\x03\x04"));
        self::assertFalse(LegalDocFile::looksLikePdf(str_repeat('x', 2000) . '%PDF-1.4'));
    }

    /** An UploadedFile whose declared size can differ from its actual bytes. */
    private function upload(string $bytes, string $name, ?int $declaredSize = null): \Slim\Psr7\UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'tds-legal');
        file_put_contents($path, $bytes);
        return new \Slim\Psr7\UploadedFile($path, $name, 'application/pdf', $declaredSize ?? strlen($bytes), UPLOAD_ERR_OK);
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
