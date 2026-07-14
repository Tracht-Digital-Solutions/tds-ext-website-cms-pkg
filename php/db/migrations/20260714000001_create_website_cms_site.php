<?php
declare(strict_types=1);

use Phinx\Migration\AbstractMigration;

/**
 * The registry of managed websites (the "1:n" of Website-CMS). Each site has a
 * stable `site_key` (used in URLs + block scoping) and an optional rebuild hook
 * (repo/workflow) a save can trigger. Module-prefixed class name (in-process
 * auto-migrator loads every module's migrations into one process).
 */
final class CreateWebsiteCmsSite extends AbstractMigration
{
    public function change(): void
    {
        $this->table('cms_site', [
            'id' => true,
            'engine' => 'InnoDB',
            'collation' => 'utf8mb4_unicode_ci',
        ])
            ->addColumn('site_key', 'string', ['limit' => 64])
            ->addColumn('name', 'string', ['limit' => 150])
            ->addColumn('rebuild_repo', 'string', ['limit' => 150, 'null' => true])
            ->addColumn('rebuild_workflow', 'string', ['limit' => 100, 'null' => true])
            ->addColumn('created_at', 'datetime', ['default' => 'CURRENT_TIMESTAMP'])
            ->addColumn('updated_at', 'datetime', ['default' => 'CURRENT_TIMESTAMP', 'update' => 'CURRENT_TIMESTAMP'])
            ->addIndex(['site_key'], ['unique' => true, 'name' => 'uniq_cms_site_key'])
            ->create();
    }
}
