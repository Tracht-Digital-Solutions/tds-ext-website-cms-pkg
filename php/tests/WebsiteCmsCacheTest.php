<?php
declare(strict_types=1);

namespace Tds\Ext\WebsiteCms\Tests;

use DI\Container;
use PHPUnit\Framework\TestCase;
use ReflectionMethod;
use Tds\Ext\WebsiteCms\Support\CacheOrigin;
use Tds\Ext\WebsiteCms\WebsiteCmsModule;
use Tds\Frontend\Contract\CacheEvent;
use Tds\Frontend\Contract\SettingsStore;
use Tds\Frontend\Contract\SiteCache;

final class CacheSettings implements SettingsStore
{
    public function __construct(private ?string $token)
    {
    }

    public function get(string $namespace, string $key, ?string $default = null): ?string { return $default; }
    public function getSecret(string $namespace, string $key): ?string { return $key === 'cache_token' ? $this->token : null; }
    public function set(string $namespace, string $key, string $value, bool $secret): void {}
    public function delete(string $namespace, string $key): void {}
    public function allMasked(string $namespace): array { return []; }
}

final class RecordingSiteCache implements SiteCache
{
    /** @var array{url:string,token:?string,events:array}|null */
    public ?array $call = null;

    public function isConfigured(string $baseUrl, ?string $token): bool
    {
        return $baseUrl !== '' && $token !== null && $token !== '';
    }

    public function rebuild(string $baseUrl, ?string $token, array $events): void
    {
        $this->call = ['url' => $baseUrl, 'token' => $token, 'events' => $events];
    }
}

final class ThrowingCacheSettings implements SettingsStore
{
    public function get(string $namespace, string $key, ?string $default = null): ?string { return $default; }
    public function getSecret(string $namespace, string $key): ?string { throw new \RuntimeException('settings unavailable'); }
    public function set(string $namespace, string $key, string $value, bool $secret): void {}
    public function delete(string $namespace, string $key): void {}
    public function allMasked(string $namespace): array { return []; }
}

/** Cache configuration, dispatch truthfulness and the repository row contract. */
final class WebsiteCmsCacheTest extends TestCase
{
    public function testCacheOriginAcceptsOnlyAnOrigin(): void
    {
        self::assertSame('https://example.com', CacheOrigin::normalize(' HTTPS://Example.COM/ '));
        self::assertSame('http://localhost:4321', CacheOrigin::normalize('http://LOCALHOST:4321'));
        self::assertNull(CacheOrigin::normalize('https://user:pass@example.com'));
        self::assertNull(CacheOrigin::normalize('https://example.com/a/path'));
        self::assertNull(CacheOrigin::normalize('https://example.com?next=evil'));
        self::assertNull(CacheOrigin::normalize('https://example.com#fragment'));
        self::assertNull(CacheOrigin::normalize('javascript:alert(1)'));
    }

    public function testConfiguredCacheReportsThatARequestWentOut(): void
    {
        $cache = new RecordingSiteCache();
        $container = new Container();
        $container->set(SettingsStore::class, new CacheSettings('secret'));
        $container->set(SiteCache::class, $cache);

        $report = $this->fire($container);

        self::assertSame('skipped', $report['cache_status']);
        self::assertFalse($report['cached']);
        self::assertSame([['reason' => 'legacy_transport_has_no_result']], $report['unknownEvents']);
        self::assertSame('https://example.com', $cache->call['url'] ?? null);
        self::assertSame('secret', $cache->call['token'] ?? null);
        self::assertInstanceOf(CacheEvent::class, $cache->call['events'][0] ?? null);
    }

    public function testMissingTokenCannotBeReportedAsARebuild(): void
    {
        $cache = new RecordingSiteCache();
        $container = new Container();
        $container->set(SettingsStore::class, new CacheSettings(null));
        $container->set(SiteCache::class, $cache);

        $report = $this->fire($container);
        self::assertSame('not_configured', $report['cache_status']);
        self::assertFalse($report['cached']);
        self::assertNull($cache->call);
    }

    public function testUnsafeStoredOriginCannotReceiveTheCacheToken(): void
    {
        $cache = new RecordingSiteCache();
        $container = new Container();
        $container->set(SettingsStore::class, new CacheSettings('secret'));
        $container->set(SiteCache::class, $cache);

        $report = $this->fire($container, 'https://attacker:password@example.com/path?token=steal');
        self::assertSame('not_configured', $report['cache_status']);
        self::assertFalse($report['cached']);
        self::assertNull($cache->call);
    }

    public function testCacheFailureCannotTurnAnAlreadySavedMutationIntoAnError(): void
    {
        $cache = new RecordingSiteCache();
        $container = new Container();
        $container->set(SettingsStore::class, new ThrowingCacheSettings());
        $container->set(SiteCache::class, $cache);

        $report = $this->fire($container);
        self::assertSame('failed', $report['cache_status']);
        self::assertFalse($report['cached']);
        self::assertSame([['reason' => 'transport_error']], $report['failed']);
        self::assertNull($cache->call);
    }

    public function testSiteQueriesCarryTheCacheUrlUsedByTheUiAndDispatcher(): void
    {
        $source = (string) file_get_contents(__DIR__ . '/../src/Domain/CmsRepository.php');
        self::assertMatchesRegularExpression('/function sites\(\).*?SELECT[^;]+cache_url/s', $source);
        self::assertMatchesRegularExpression('/function findSite\(.*?SELECT[^;]+cache_url/s', $source);
    }

    /** @return array{cache_status:string,cached:bool,rebuilt:array,skipped:array,failed:array,unknownEvents:array} */
    private function fire(Container $container, string $url = 'https://example.com'): array
    {
        $method = new ReflectionMethod(WebsiteCmsModule::class, 'fireCache');
        /** @var array{cache_status:string,cached:bool,rebuilt:array,skipped:array,failed:array,unknownEvents:array} $report */
        $report = $method->invoke(
            null,
            $container,
            ['site_key' => 'landing', 'cache_url' => $url],
            [new CacheEvent('block', 'hero', 'de')],
        );
        return $report;
    }
}
