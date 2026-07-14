<?php
declare(strict_types=1);

namespace Tds\Ext\WebsiteCms\Domain;

use PDO;

/**
 * Website-CMS data access: the site registry + the per-(site, section, lang)
 * JSON content blocks. Blocks are upserted (one row per section/lang/site); the
 * static sites read them at build time. Ported from tds-content-api's
 * ContentBlockRepository, extended for the multi-site model.
 */
final class CmsRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    // --- sites ----------------------------------------------------------------

    /** @return list<array<string,mixed>> */
    public function sites(): array
    {
        return $this->pdo->query(
            'SELECT id, site_key, name, rebuild_repo, rebuild_workflow, updated_at
             FROM cms_site ORDER BY name, id'
        )->fetchAll();
    }

    public function siteCount(): int
    {
        return (int) $this->pdo->query('SELECT COUNT(*) FROM cms_site')->fetchColumn();
    }

    /** @return array<string,mixed>|null */
    public function findSite(string $siteKey): ?array
    {
        $stmt = $this->pdo->prepare('SELECT id, site_key, name FROM cms_site WHERE site_key = :k LIMIT 1');
        $stmt->execute([':k' => $siteKey]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    public function siteKeyExists(string $siteKey): bool
    {
        $stmt = $this->pdo->prepare('SELECT 1 FROM cms_site WHERE site_key = :k LIMIT 1');
        $stmt->execute([':k' => $siteKey]);
        return $stmt->fetchColumn() !== false;
    }

    public function createSite(string $siteKey, string $name): int
    {
        $stmt = $this->pdo->prepare('INSERT INTO cms_site (site_key, name) VALUES (:k, :n)');
        $stmt->execute([':k' => $siteKey, ':n' => $name]);
        return (int) $this->pdo->lastInsertId();
    }

    // --- blocks ---------------------------------------------------------------

    /** Section/lang metadata for a site (not the values). @return list<array<string,mixed>> */
    public function blocks(int $siteId): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT section_key, lang, updated_at FROM cms_block WHERE site_id = :s
             ORDER BY section_key, lang'
        );
        $stmt->execute([':s' => $siteId]);
        return $stmt->fetchAll();
    }

    /** @return mixed the decoded value_json, or null when absent */
    public function getBlock(int $siteId, string $sectionKey, string $lang): mixed
    {
        $stmt = $this->pdo->prepare(
            'SELECT value_json FROM cms_block WHERE site_id = :s AND section_key = :k AND lang = :l LIMIT 1'
        );
        $stmt->execute([':s' => $siteId, ':k' => $sectionKey, ':l' => $lang]);
        $json = $stmt->fetchColumn();
        return $json === false ? null : json_decode((string) $json, true);
    }

    public function putBlock(int $siteId, string $sectionKey, string $lang, string $valueJson): void
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO cms_block (site_id, section_key, lang, value_json)
             VALUES (:s, :k, :l, :v)
             ON DUPLICATE KEY UPDATE value_json = :v2'
        );
        $stmt->execute([':s' => $siteId, ':k' => $sectionKey, ':l' => $lang, ':v' => $valueJson, ':v2' => $valueJson]);
    }

    public function deleteBlock(int $siteId, string $sectionKey, string $lang): void
    {
        $stmt = $this->pdo->prepare(
            'DELETE FROM cms_block WHERE site_id = :s AND section_key = :k AND lang = :l'
        );
        $stmt->execute([':s' => $siteId, ':k' => $sectionKey, ':l' => $lang]);
    }
}
