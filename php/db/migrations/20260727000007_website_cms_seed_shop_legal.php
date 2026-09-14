<?php
declare(strict_types=1);

use Phinx\Migration\AbstractMigration;

/**
 * Retired: this migration used to seed draft legal texts for TDShop into
 * `cms_block`. It now does nothing, on purpose, and must stay in place.
 *
 * ### Why it cannot simply be fixed
 *
 * It quoted its values through `$this->getAdapter()->quoteValue()`. In Phinx
 * 0.16 that method is protected on `PdoAdapter`, and the adapter a migration
 * receives is wrapped in `TimedOutputAdapter`, which has no such method at all.
 * Every run died with "Call to undefined method TimedOutputAdapter::quoteValue()".
 *
 * Because every composed module shares ONE `phinxlog` and the in-process runner
 * applies pending migrations in version order, that one error stopped every
 * migration still pending behind it. Added on 2026-09-08 with an old version
 * number, it blocked what came after: the shop's order, cart, shipping,
 * invoice and category tables never reached production, and the shop panel
 * answered HTTP 500 for its products and categories. The runner logs and
 * swallows the failure by design, so nothing turned red — the gateway's
 * MySQL 8 check even reported "applies cleanly", counting 25 applied migrations
 * without comparing them to the set.
 *
 * Repairing the quoting would have been the wrong fix. The seeded texts are
 * early drafts with a visible "Entwurf" notice and without shipping, PayPal or
 * accessibility sections. The shop reads the CMS FIRST and falls back to its
 * committed texts (`tds-shop-frontend/src/content/legal/*.md`), so running the
 * seed now would have replaced the reviewed-in-git legal pages of a live shop
 * with stale drafts, as a side effect of a schema run.
 *
 * ### Why it is not deleted
 *
 * The run never succeeded, so no database records it as applied — but keeping
 * the version and class in place is what guarantees that. A deleted file that
 * some environment had managed to apply would show up as a missing migration;
 * an empty one is recorded and forgotten. Publish reviewed legal texts through
 * the Website-CMS instead, where an operator decides when they go live.
 */
final class WebsiteCmsSeedShopLegal extends AbstractMigration
{
    public function up(): void
    {
    }

    public function down(): void
    {
    }
}
