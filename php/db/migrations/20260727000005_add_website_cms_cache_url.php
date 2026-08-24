<?php
declare(strict_types=1);

use Phinx\Migration\AbstractMigration;

/**
 * Where a managed site's page cache lives.
 *
 * The public sites render on demand now and store each rendered page as a file
 * the web server hands out directly, so a saved block is invisible until its
 * page is rendered again. This column is the origin the save calls to ask for
 * that — `https://tracht-digital.de`, alongside the existing rebuild hook.
 *
 * **Deliberately NOT the same thing as `rebuild_repo`/`rebuild_workflow`.**
 * Those dispatch a CI build and ship *code*; this re-renders pages from content
 * that is already stored, in seconds. Both exist because both jobs exist, and
 * collapsing them would mean every typo correction went through a full build
 * again.
 *
 * The matching token is a SECRET and therefore lives in the settings store
 * (namespace `website-cms`, key `cache_token`), which encrypts at rest. It has
 * no business in a plain column beside a URL.
 *
 * Module-prefixed class name and a version in this module's band: the
 * in-process auto-migrator loads every module's migrations into one process
 * and one phinxlog.
 */
final class AddWebsiteCmsCacheUrl extends AbstractMigration
{
    public function change(): void
    {
        $this->table('cms_site')
            ->addColumn('cache_url', 'string', [
                'limit' => 255,
                'null' => true,
                'after' => 'rebuild_workflow',
                'comment' => 'Origin of the public site whose page cache a save rebuilds.',
            ])
            ->update();
    }
}
