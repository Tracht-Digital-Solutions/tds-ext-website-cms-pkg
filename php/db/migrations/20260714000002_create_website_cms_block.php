<?php
declare(strict_types=1);

use Phinx\Db\Adapter\MysqlAdapter;
use Phinx\Migration\AbstractMigration;

/**
 * Editable website content, one row per (site, section, language). `value_json`
 * holds the section's content object, shaped per `section_key` (e.g. "faq" →
 * {label, headline, items:[{q,a}]}). The static sites fetch these at build time
 * and merge over their tds-shared / local defaults; a missing row falls back to
 * the default, so a site never depends on a row existing.
 *
 * Denormalised JSON on purpose (small, read once per build, shapes differ per
 * section). Ported from tds-content-api's content_block, extended with site_id
 * for the multi-site model. Module-prefixed class name.
 */
final class CreateWebsiteCmsBlock extends AbstractMigration
{
    public function change(): void
    {
        $this->table('cms_block', [
            'id' => true,
            'engine' => 'InnoDB',
            'collation' => 'utf8mb4_unicode_ci',
        ])
            ->addColumn('site_id', 'integer', ['signed' => false])
            ->addColumn('section_key', 'string', ['limit' => 64])
            ->addColumn('lang', 'string', ['limit' => 2, 'default' => 'de'])
            ->addColumn('value_json', 'text', ['limit' => MysqlAdapter::TEXT_MEDIUM])
            ->addColumn('created_at', 'datetime', ['default' => 'CURRENT_TIMESTAMP'])
            ->addColumn('updated_at', 'datetime', ['default' => 'CURRENT_TIMESTAMP', 'update' => 'CURRENT_TIMESTAMP'])
            ->addIndex(['site_id', 'section_key', 'lang'], ['unique' => true, 'name' => 'uniq_cms_block'])
            ->addForeignKey('site_id', 'cms_site', 'id', ['delete' => 'CASCADE'])
            ->create();
    }
}
