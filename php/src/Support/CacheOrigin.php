<?php
declare(strict_types=1);

namespace Tds\Ext\WebsiteCms\Support;

/** Validation and canonicalisation for a managed site's page-cache origin. */
final class CacheOrigin
{
    /**
     * Return a pure http(s) origin, or null for anything unsafe/unusable.
     *
     * The cache token is sent to this address. Userinfo, a path, a query or a
     * fragment therefore are not harmless paste mistakes: they either target
     * the wrong endpoint or make it much easier to disclose the token. A lone
     * trailing slash is accepted because browsers display origins that way.
     */
    public static function normalize(string $value): ?string
    {
        $value = trim($value);
        if ($value === '' || filter_var($value, FILTER_VALIDATE_URL) === false) {
            return null;
        }

        $parts = parse_url($value);
        if (!is_array($parts)) {
            return null;
        }
        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        $host = strtolower((string) ($parts['host'] ?? ''));
        $path = (string) ($parts['path'] ?? '');
        if (
            !in_array($scheme, ['http', 'https'], true)
            || $host === ''
            || isset($parts['user'])
            || isset($parts['pass'])
            || isset($parts['query'])
            || isset($parts['fragment'])
            || ($path !== '' && $path !== '/')
        ) {
            return null;
        }

        // parse_url keeps the brackets around an IPv6 literal. Reconstructing
        // from parsed pieces also removes a harmless trailing slash and makes
        // scheme/host comparisons deterministic.
        $port = isset($parts['port']) ? ':' . (int) $parts['port'] : '';
        return $scheme . '://' . $host . $port;
    }
}
