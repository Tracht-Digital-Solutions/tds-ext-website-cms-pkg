<?php
declare(strict_types=1);

namespace Tds\Ext\WebsiteCms\Tests;

use PHPUnit\Framework\TestCase;
use Tds\Ext\WebsiteCms\WebsiteCmsModule;

/**
 * The migration files, checked without a database.
 *
 * Every enabled extension's migrations run in ONE process against ONE
 * `phinxlog`. A mistake here is therefore not this module's problem alone: the
 * core's `MigrationRunner` pre-flights filename/class/version collisions and
 * aborts migrations for EVERY module when it finds one — on the first request
 * after a deploy, with nothing in this repository having failed.
 *
 * Written when the shop's legal-text seed was added, because that was the first
 * migration here in months and nothing would have caught a typo in its name.
 */
final class WebsiteCmsMigrationsTest extends TestCase
{
    /** The version band this module owns. */
    private const OUR_BAND = '20260727';

    /** Bands other modules on this platform have claimed. */
    private const CLAIMED_BANDS = [
        '20260713', '20260719', '20260720', '20260722', '20260725',
        '20260726', '20260728', '20260801', '20260826', '20260901',
        '20260907', '20260908',
    ];

    /** @return list<string> */
    private static function files(): array
    {
        $files = glob((new WebsiteCmsModule())->migrations()[0] . '/*.php');
        return $files === false ? [] : array_values($files);
    }

    public function testEveryFileNameMapsToItsClassName(): void
    {
        // Phinx derives the class from the file name. A mismatch does not skip
        // one migration — it aborts the scan for every module sharing the run.
        $problems = [];
        foreach (self::files() as $file) {
            $base = basename($file, '.php');
            [, $snake] = explode('_', $base, 2);
            $expected = str_replace(' ', '', ucwords(str_replace('_', ' ', $snake)));

            $source = (string) file_get_contents($file);
            if (!preg_match('/final class (\w+) extends AbstractMigration/', $source, $m)) {
                $problems[] = "{$base}: keine Migrationsklasse gefunden";
                continue;
            }
            if ($m[1] !== $expected) {
                $problems[] = "{$base}: Klasse {$m[1]}, erwartet {$expected}";
            }
        }
        self::assertSame([], $problems);
    }

    public function testEveryClassIsModulePrefixed(): void
    {
        // One shared ledger means one shared class namespace.
        foreach (self::files() as $file) {
            $source = (string) file_get_contents($file);
            preg_match('/final class (\w+) extends AbstractMigration/', $source, $m);
            self::assertMatchesRegularExpression(
                '/^(WebsiteCms|CreateWebsiteCms|AddWebsiteCms)/',
                $m[1] ?? '',
                basename($file),
            );
        }
    }

    public function testEveryVersionIsInOurBandAndUnique(): void
    {
        $versions = [];
        foreach (self::files() as $file) {
            $version = explode('_', basename($file), 2)[0];
            $band = substr($version, 0, 8);
            self::assertSame(self::OUR_BAND, $band, basename($file));
            self::assertNotContains($band, self::CLAIMED_BANDS, basename($file));
            $versions[] = $version;
        }
        self::assertSame(count($versions), count(array_unique($versions)), 'Doppelte Versionsnummer');
    }

    public function testForeignKeysAreUnsignedToSurviveMysql8(): void
    {
        // Production is MySQL 8; local is often MariaDB, which silently
        // corrects the signedness mismatch MySQL 8 rejects outright. Only
        // INTEGER `*_id` columns — a string id has no signedness.
        $problems = [];
        foreach (self::files() as $file) {
            foreach (file($file) ?: [] as $n => $line) {
                if (!preg_match("/->addColumn\('(\w+_id)', 'integer'/", $line, $m)) {
                    continue;
                }
                if (!str_contains($line, "'signed' => false")) {
                    $problems[] = basename($file) . ':' . ($n + 1) . " {$m[1]}";
                }
            }
        }
        self::assertSame([], $problems, 'FK-Spalten ohne signed => false');
    }

    /**
     * The seeded legal texts must announce themselves as drafts.
     *
     * They have not been through legal review, and a legal text that reads as
     * finished is one somebody publishes without reading it. The notice lives
     * inside the seeded markdown so it travels with a copy-paste into the
     * editor — removing it has to be a decision, not an accident.
     */
    public function testTheSeededLegalTextsAreMarkedAsDrafts(): void
    {
        $seed = null;
        foreach (self::files() as $file) {
            if (str_contains($file, 'seed_shop_legal')) {
                $seed = (string) file_get_contents($file);
            }
        }
        self::assertNotNull($seed, 'Seed-Migration nicht gefunden');
        self::assertStringContainsString('Entwurf — noch nicht geprüft', $seed);
        self::assertStringContainsString('Draft — not reviewed', $seed);

        // Insert-only. A seed that overwrote would discard whatever the
        // operator edited the last time the ledger was rebuilt — and being
        // edited is the entire point of these rows.
        self::assertStringContainsString('ON DUPLICATE KEY UPDATE id = id', $seed);
        self::assertStringNotContainsString('ON DUPLICATE KEY UPDATE value_json', $seed);
    }
}
