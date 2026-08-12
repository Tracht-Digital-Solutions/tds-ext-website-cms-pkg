<?php
declare(strict_types=1);

namespace Tds\Ext\WebsiteCms\Support;

/**
 * Validation rules for an uploaded legal document (`cms_legal_doc`).
 *
 * PDF-only and small on purpose: these are read into memory by the route (the
 * bytes go into a `MEDIUMBLOB`, see the migration) and fetched whole by a
 * static-site build. Pure functions with no PDO/PSR dependency so the module
 * test can exercise them without a database.
 */
final class LegalDocFile
{
    /** Comfortably above a real AGB (~90 KB) and well inside MEDIUMBLOB (16 MB). */
    public const MAX_BYTES = 8 * 1024 * 1024;

    public const MIME = 'application/pdf';

    /** Document keys are kebab slugs — they appear in the public URL. */
    public static function keyValid(string $key): bool
    {
        return preg_match('/^[a-z0-9-]{2,64}$/', $key) === 1;
    }

    /**
     * A filename safe to echo back in a `Content-Disposition`. Everything
     * outside `[A-Za-z0-9._-]` collapses to `_`, so no quote, newline or path
     * separator can survive into the header.
     */
    public static function sanitizeFilename(string $name): string
    {
        $safe = preg_replace('/[^A-Za-z0-9._-]+/', '_', $name) ?? '';
        $safe = trim($safe, '._-');
        if ($safe === '') {
            $safe = 'dokument.pdf';
        }
        if (!str_ends_with(strtolower($safe), '.pdf')) {
            $safe .= '.pdf';
        }
        return substr($safe, -255);
    }

    /**
     * Sniff the PDF magic number rather than trusting the client's media type,
     * which is attacker-controlled on a multipart upload. The header may be
     * preceded by junk in the wild, so allow a small offset (the same slack
     * `file(1)` gives it).
     */
    public static function looksLikePdf(string $bytes): bool
    {
        return strpos(substr($bytes, 0, 1024), '%PDF-') !== false;
    }
}
