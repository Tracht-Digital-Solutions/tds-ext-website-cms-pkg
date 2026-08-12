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
        $stmt = $this->pdo->prepare(
            'SELECT id, site_key, name, rebuild_repo, rebuild_workflow FROM cms_site WHERE site_key = :k LIMIT 1'
        );
        $stmt->execute([':k' => $siteKey]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    public function updateSiteRebuild(int $siteId, ?string $repo, ?string $workflow): void
    {
        $stmt = $this->pdo->prepare(
            'UPDATE cms_site SET rebuild_repo = :r, rebuild_workflow = :w WHERE id = :id'
        );
        $stmt->execute([':r' => $repo, ':w' => $workflow, ':id' => $siteId]);
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
            'SELECT section_key, lang, machine_translated, updated_at FROM cms_block WHERE site_id = :s
             ORDER BY section_key, lang'
        );
        $stmt->execute([':s' => $siteId]);
        return $stmt->fetchAll();
    }

    // --- Public (unauthenticated) read surface ------------------------------
    // Serves the editable content blocks the public landingpage/blog SSG builds
    // fetch (the successor to tds-content-api's open `GET /content/landing`).

    /** The site the public landingpage maps to (single-site): first by name/id. */
    public function defaultSite(): ?array
    {
        $row = $this->pdo->query(
            'SELECT id, site_key, name FROM cms_site ORDER BY name, id LIMIT 1'
        )->fetch();
        return $row === false ? null : $row;
    }

    /**
     * All of a site's blocks for one language as a `section_key => value` map
     * (value = the decoded `value_json` content object) — the shape the public
     * landingpage/blog expect from `GET /content/landing`.
     *
     * @return array<string,mixed>
     */
    public function publicBlocks(int $siteId, string $lang): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT section_key, value_json FROM cms_block WHERE site_id = :s AND lang = :l'
        );
        $stmt->execute([':s' => $siteId, ':l' => $lang]);
        $out = [];
        foreach ($stmt->fetchAll() as $row) {
            $out[(string) $row['section_key']] = json_decode((string) $row['value_json'], true);
        }
        return $out;
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

    /** The decoded value + machine_translated flag, or null when absent. @return array{value:mixed,machine_translated:int}|null */
    public function getBlockRow(int $siteId, string $sectionKey, string $lang): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT value_json, machine_translated FROM cms_block WHERE site_id = :s AND section_key = :k AND lang = :l LIMIT 1'
        );
        $stmt->execute([':s' => $siteId, ':k' => $sectionKey, ':l' => $lang]);
        $row = $stmt->fetch();
        if ($row === false) {
            return null;
        }
        return [
            'value' => json_decode((string) $row['value_json'], true),
            'machine_translated' => (int) $row['machine_translated'],
        ];
    }

    public function putBlock(int $siteId, string $sectionKey, string $lang, string $valueJson, bool $machineTranslated = false): void
    {
        $mt = $machineTranslated ? 1 : 0;
        $stmt = $this->pdo->prepare(
            'INSERT INTO cms_block (site_id, section_key, lang, value_json, machine_translated)
             VALUES (:s, :k, :l, :v, :mt)
             ON DUPLICATE KEY UPDATE value_json = :v2, machine_translated = :mt2'
        );
        $stmt->execute([':s' => $siteId, ':k' => $sectionKey, ':l' => $lang, ':v' => $valueJson, ':mt' => $mt, ':v2' => $valueJson, ':mt2' => $mt]);
    }

    public function deleteBlock(int $siteId, string $sectionKey, string $lang): void
    {
        $stmt = $this->pdo->prepare(
            'DELETE FROM cms_block WHERE site_id = :s AND section_key = :k AND lang = :l'
        );
        $stmt->execute([':s' => $siteId, ':k' => $sectionKey, ':l' => $lang]);
    }

    // --- legal documents ------------------------------------------------------
    // Uploadable PDFs (AGB & co), one row per (site, doc_key, lang). The bytes
    // live in the row (see the migration for why); every metadata query below
    // therefore selects columns explicitly and never `*`, so listing documents
    // does not drag megabytes through PHP.

    private const LEGAL_META = 'id, doc_key, lang, filename, mime_type, size_bytes, version_label, updated_at';

    /** Metadata for a site's documents, newest key first. @return list<array<string,mixed>> */
    public function legalDocs(int $siteId): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT ' . self::LEGAL_META . ' FROM cms_legal_doc WHERE site_id = :s ORDER BY doc_key, lang'
        );
        $stmt->execute([':s' => $siteId]);
        return $stmt->fetchAll();
    }

    /** @return array<string,mixed>|null metadata only */
    public function legalDocMeta(int $siteId, string $docKey, string $lang): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT ' . self::LEGAL_META . ' FROM cms_legal_doc
             WHERE site_id = :s AND doc_key = :k AND lang = :l LIMIT 1'
        );
        $stmt->execute([':s' => $siteId, ':k' => $docKey, ':l' => $lang]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    /** Metadata **plus** the bytes under `content`. @return array<string,mixed>|null */
    public function legalDocWithContent(int $siteId, string $docKey, string $lang): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT ' . self::LEGAL_META . ', content FROM cms_legal_doc
             WHERE site_id = :s AND doc_key = :k AND lang = :l LIMIT 1'
        );
        $stmt->execute([':s' => $siteId, ':k' => $docKey, ':l' => $lang]);
        $row = $stmt->fetch();
        if ($row === false) {
            return null;
        }
        // PDO returns a BLOB as a stream on some drivers and a string on others.
        $content = $row['content'];
        $row['content'] = is_resource($content) ? (string) stream_get_contents($content) : (string) $content;
        return $row;
    }

    /** Upsert a document's bytes + metadata for one (site, key, language). */
    public function putLegalDoc(
        int $siteId,
        string $docKey,
        string $lang,
        string $filename,
        string $mimeType,
        string $content,
        ?string $versionLabel,
    ): void {
        $stmt = $this->pdo->prepare(
            'INSERT INTO cms_legal_doc (site_id, doc_key, lang, filename, mime_type, size_bytes, version_label, content)
             VALUES (:s, :k, :l, :f, :m, :sz, :v, :c)
             ON DUPLICATE KEY UPDATE
               filename = :f2, mime_type = :m2, size_bytes = :sz2, version_label = :v2, content = :c2'
        );
        $stmt->bindValue(':s', $siteId, PDO::PARAM_INT);
        $stmt->bindValue(':k', $docKey);
        $stmt->bindValue(':l', $lang);
        $stmt->bindValue(':f', $filename);
        $stmt->bindValue(':f2', $filename);
        $stmt->bindValue(':m', $mimeType);
        $stmt->bindValue(':m2', $mimeType);
        $stmt->bindValue(':sz', strlen($content), PDO::PARAM_INT);
        $stmt->bindValue(':sz2', strlen($content), PDO::PARAM_INT);
        $stmt->bindValue(':v', $versionLabel);
        $stmt->bindValue(':v2', $versionLabel);
        $stmt->bindValue(':c', $content, PDO::PARAM_LOB);
        $stmt->bindValue(':c2', $content, PDO::PARAM_LOB);
        $stmt->execute();
    }

    public function deleteLegalDoc(int $siteId, string $docKey, string $lang): bool
    {
        $stmt = $this->pdo->prepare(
            'DELETE FROM cms_legal_doc WHERE site_id = :s AND doc_key = :k AND lang = :l'
        );
        $stmt->execute([':s' => $siteId, ':k' => $docKey, ':l' => $lang]);
        return $stmt->rowCount() > 0;
    }
}
