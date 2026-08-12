<?php
declare(strict_types=1);

use Phinx\Db\Adapter\MysqlAdapter;
use Phinx\Migration\AbstractMigration;

/**
 * Uploadable legal documents (AGB, and any future `doc_key`) — one row per
 * (site, doc_key, language). The public landingpage build fetches these and
 * bakes the bytes into its static `dist/`, exactly like `cms_block` content:
 * the document is edited in the panel, and a rebuild carries it to the site.
 *
 * **The bytes live in the DB, not on disk** — deliberately, and unlike
 * `tds-ext-documents-pkg`, which stores customer documents under
 * `DOCUMENT_ROOT_DIR`. Three reasons: these are a handful of small files
 * (a PDF cap of 8 MB, and the real AGB is ~90 KB) read once per build, not an
 * unbounded customer store; a BLOB needs no new writable directory on the
 * Plesk host, and host-side setup is this platform's chronic go-live blocker;
 * and the row cannot drift out of sync with a deploy that resets the
 * filesystem. `MEDIUMBLOB` (16 MB) comfortably clears the cap.
 *
 * Module-prefixed class name AND the `20260727*` version band this module owns
 * — every composed module shares one `phinxlog`, so both must be unique.
 */
final class CreateWebsiteCmsLegalDoc extends AbstractMigration
{
    public function change(): void
    {
        $this->table('cms_legal_doc', [
            'id' => true,
            'engine' => 'InnoDB',
            'collation' => 'utf8mb4_unicode_ci',
        ])
            ->addColumn('site_id', 'integer', ['signed' => false])
            ->addColumn('doc_key', 'string', ['limit' => 64])
            ->addColumn('lang', 'string', ['limit' => 2, 'default' => 'de'])
            ->addColumn('filename', 'string', ['limit' => 255])
            ->addColumn('mime_type', 'string', ['limit' => 128, 'default' => 'application/pdf'])
            ->addColumn('size_bytes', 'integer', ['signed' => false, 'default' => 0])
            // Free-text "Stand: 09/2025" shown next to the download; optional.
            ->addColumn('version_label', 'string', ['limit' => 128, 'null' => true])
            ->addColumn('content', 'blob', ['limit' => MysqlAdapter::BLOB_MEDIUM])
            ->addColumn('created_at', 'datetime', ['default' => 'CURRENT_TIMESTAMP'])
            ->addColumn('updated_at', 'datetime', ['default' => 'CURRENT_TIMESTAMP', 'update' => 'CURRENT_TIMESTAMP'])
            ->addIndex(['site_id', 'doc_key', 'lang'], ['unique' => true, 'name' => 'uniq_cms_legal_doc'])
            ->addForeignKey('site_id', 'cms_site', 'id', ['delete' => 'CASCADE'])
            ->create();
    }
}
