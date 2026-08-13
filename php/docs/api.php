<?php
/**
 * API documentation for this module's routes — consumed through `ApiDocSource`
 * and rendered in the admin frontend's API reference (`GET /wiki.json`).
 *
 * `pattern` must match the Slim pattern in `register()` VERBATIM, inline regex
 * included: it is the join key for the route introspection.
 * `php/tests/WebsiteCmsApiDocsTest.php` fails the build if the documented set
 * and the registered set drift apart in either direction.
 */

declare(strict_types=1);

$site = ['in' => 'path', 'name' => 'site', 'type' => 'slug', 'required' => true, 'description' => 'Site-Schlüssel (Kebab), z. B. `landingpage`.'];
$docKey = ['in' => 'path', 'name' => 'key', 'type' => 'slug', 'required' => true, 'description' => 'Dokumentschlüssel (Kebab, 2–64 Zeichen), z. B. `agb`.'];
$blockKey = ['in' => 'path', 'name' => 'key', 'type' => 'slug', 'required' => true, 'description' => 'Section-Schlüssel, Muster `[a-z0-9_-]+`.'];
$langQuery = ['in' => 'query', 'name' => 'lang', 'type' => 'de|en', 'description' => 'Sprache; Vorgabe `de`.'];

return [
    [
        'method' => 'GET',
        'pattern' => '/content/landing',
        'tag' => 'Öffentlich',
        'summary' => 'Redaktionelle Blöcke der Standard-Site (Build-Quelle der öffentlichen Seiten)',
        'description' => 'Die Nachfolgerin von `tds-content-api`s offener `/content/landing`, '
            . 'unter demselben Pfad, damit Landingpage und Blog **unverändert** '
            . 'weiterlesen. Unauthentifiziert und lesend. **Ein Datenbankproblem gibt '
            . 'leere Blöcke zurück, niemals 500** — der statische Build fällt dann auf '
            . 'seine eingebauten Vorgaben zurück, statt zu scheitern. Die Kehrseite: '
            . 'eine kaputte Datenbank sieht wie „kein Inhalt gepflegt" aus.',
        'auth' => 'public',
        'params' => [$langQuery],
        'responses' => [
            ['status' => 200, 'description' => '`{blocks: {<section_key>: <value>}}` — Objekt, auch wenn leer.'],
        ],
    ],
    [
        'method' => 'GET',
        'pattern' => '/content/legal',
        'tag' => 'Öffentlich',
        'summary' => 'Welche Rechtsdokumente für die Standard-Site hinterlegt sind',
        'description' => 'Nur Metadaten (Dateiname, Größe, Stand), keine Bytes. Der '
            . 'Landingpage-Build entscheidet damit, ob er die hochgeladene AGB einbackt '
            . 'oder die mitcommittete Rückfalldatei, und rendert das „Stand: …"-Label. '
            . 'Gleiche Ausfallsicherheit wie `/content/landing`.',
        'auth' => 'public',
        'responses' => [
            ['status' => 200, 'description' => '`{docs: {<key>: {<lang>: {filename, size, updated_at}}}}` — verschachtelte Objekte, auch wenn leer.'],
        ],
    ],
    [
        'method' => 'GET',
        'pattern' => '/content/legal/{key:[a-z0-9-]+}.pdf',
        'tag' => 'Öffentlich',
        'summary' => 'Ein Rechtsdokument der Standard-Site herunterladen',
        'description' => 'Die Bytes selbst — das, was der Landingpage-Build zieht und was '
            . 'ein Besucher direkt aufrufen kann. Immer die Standard-Site; für eine '
            . 'zweite Site gibt es die Vorschau-Route auf der Verwaltungsseite.',
        'auth' => 'public',
        'params' => [
            $docKey,
            ['in' => 'query', 'name' => 'lang', 'type' => 'de|en', 'description' => 'Sprachfassung. Rechtstexte werden **nie** maschinell übersetzt — die englische Fassung ist ein eigener Upload.'],
        ],
        'responses' => [
            ['status' => 200, 'description' => 'Das PDF als `application/pdf`.'],
            ['status' => 404, 'description' => 'Kein Dokument für diesen Schlüssel und diese Sprache — auch bei einem Datenbankfehler.'],
        ],
    ],
    [
        'method' => 'GET',
        'pattern' => '/cms/sites/{site:[a-z0-9-]+}/legal',
        'tag' => 'Rechtsdokumente',
        'summary' => 'Hinterlegte Rechtsdokumente einer Site auflisten',
        'permission' => 'website:read',
        'params' => [$site],
        'responses' => [
            ['status' => 200, 'description' => '`{docs: [{docKey, lang, filename, size, updated_at}]}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `website:read`.'],
            ['status' => 404, 'description' => 'Unbekannte Site.'],
        ],
    ],
    [
        'method' => 'POST',
        'pattern' => '/cms/sites/{site:[a-z0-9-]+}/legal/{key:[a-z0-9-]+}',
        'tag' => 'Rechtsdokumente',
        'summary' => 'Rechtsdokument hochladen (ersetzt die Fassung dieser Sprache)',
        'description' => 'Multipart-Feld **`file`**. Es gibt genau ein Dokument je '
            . '(Site × Schlüssel × Sprache); ein Upload ersetzt das vorhandene. Der '
            . 'Dateityp wird an der **Magic Number** geprüft, nicht am gemeldeten '
            . 'Media-Type — die Angabe des Clients ist kein Beweis. Die Bytes landen in '
            . 'einem `MEDIUMBLOB`, deshalb die 8-MB-Grenze und deshalb braucht der Host '
            . 'kein beschreibbares Verzeichnis.',
        'permission' => 'website:write',
        'params' => [
            $site,
            $docKey,
            ['in' => 'body', 'name' => 'file', 'type' => 'multipart', 'required' => true, 'description' => 'Das PDF, höchstens 8 MB.'],
            ['in' => 'body', 'name' => 'lang', 'type' => 'de|en', 'description' => 'Sprachfassung; Vorgabe `de`.'],
        ],
        'responses' => [
            ['status' => 200, 'description' => 'Die Metadaten des gespeicherten Dokuments.'],
            ['status' => 400, 'description' => 'Kein gültiges Feld `file` im Upload.'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `website:write`.'],
            ['status' => 404, 'description' => 'Unbekannte Site.'],
            ['status' => 413, 'description' => 'Datei größer als 8 MB.'],
            ['status' => 415, 'description' => 'Die Datei ist kein PDF (Magic Number geprüft).'],
            ['status' => 422, 'description' => 'Dokumentschlüssel entspricht nicht `[a-z0-9-]{2,64}`.'],
        ],
    ],
    [
        'method' => 'DELETE',
        'pattern' => '/cms/sites/{site:[a-z0-9-]+}/legal/{key:[a-z0-9-]+}',
        'tag' => 'Rechtsdokumente',
        'summary' => 'Rechtsdokument entfernen',
        'description' => 'Die öffentliche Seite fällt danach auf ihre mitcommittete '
            . 'Rückfalldatei zurück — der Link ist also nie tot.',
        'permission' => 'website:write',
        'params' => [$site, $docKey, ['in' => 'query', 'name' => 'lang', 'type' => 'de|en', 'description' => 'Sprachfassung; Vorgabe `de`.']],
        'responses' => [
            ['status' => 200, 'description' => '`{ok: true}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `website:write`.'],
            ['status' => 404, 'description' => 'Unbekannte Site oder kein Dokument für diese Sprache.'],
        ],
    ],
    [
        'method' => 'GET',
        'pattern' => '/cms/sites/{site:[a-z0-9-]+}/legal/{key:[a-z0-9-]+}/file',
        'tag' => 'Rechtsdokumente',
        'summary' => 'Gespeichertes Dokument in der Verwaltung ansehen',
        'description' => 'Nötig, weil die öffentliche Route immer nur die **Standard-Site** '
            . 'ausliefert — wer eine zweite Site pflegt, käme sonst nicht an die eigene '
            . 'Fassung heran.',
        'permission' => 'website:read',
        'params' => [$site, $docKey, ['in' => 'query', 'name' => 'lang', 'type' => 'de|en', 'description' => 'Sprachfassung; Vorgabe `de`.']],
        'responses' => [
            ['status' => 200, 'description' => 'Das PDF als `application/pdf`.'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `website:read`.'],
            ['status' => 404, 'description' => 'Unbekannte Site oder kein Dokument.'],
        ],
    ],
    [
        'method' => 'GET',
        'pattern' => '/cms/summary',
        'tag' => 'Sites',
        'summary' => 'Anzahl gepflegter Sites',
        'description' => 'Die `dataEndpoint`-Route des Dashboard-Widgets.',
        'permission' => 'website:read',
        'responses' => [
            ['status' => 200, 'description' => '`{sites: <Anzahl>}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `website:read`.'],
        ],
    ],
    [
        'method' => 'GET',
        'pattern' => '/cms/sites',
        'tag' => 'Sites',
        'summary' => 'Alle Sites mit ihrer Rebuild-Konfiguration',
        'permission' => 'website:read',
        'responses' => [
            ['status' => 200, 'description' => '`{sites: [{id, site_key, name, rebuild_repo, rebuild_workflow, is_default}]}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `website:read`.'],
        ],
    ],
    [
        'method' => 'POST',
        'pattern' => '/cms/sites',
        'tag' => 'Sites',
        'summary' => 'Site anlegen',
        'permission' => 'website:write',
        'params' => [
            ['in' => 'body', 'name' => 'site_key', 'type' => 'slug', 'required' => true, 'description' => 'Kebab-Schlüssel, eindeutig.'],
            ['in' => 'body', 'name' => 'name', 'type' => 'string', 'required' => true, 'description' => 'Anzeigename.'],
        ],
        'responses' => [
            ['status' => 201, 'description' => '`{id}` der Site.'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `website:write`.'],
            ['status' => 409, 'description' => '`site_key` ist bereits vergeben.'],
            ['status' => 422, 'description' => '`site_key` ist kein Kebab-Slug, oder `name` fehlt.'],
        ],
    ],
    [
        'method' => 'GET',
        'pattern' => '/cms/{site:[a-z0-9-]+}/blocks',
        'tag' => 'Inhalte',
        'summary' => 'Alle Inhaltsblöcke einer Site in einer Sprache',
        'permission' => 'website:read',
        'params' => [$site, $langQuery],
        'responses' => [
            ['status' => 200, 'description' => '`{blocks: {...}}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `website:read`.'],
            ['status' => 404, 'description' => 'Unbekannte Site.'],
        ],
    ],
    [
        'method' => 'GET',
        'pattern' => '/cms/{site:[a-z0-9-]+}/blocks/{key:[a-z0-9_-]+}',
        'tag' => 'Inhalte',
        'summary' => 'Einen Inhaltsblock lesen',
        'permission' => 'website:read',
        'params' => [$site, $blockKey, $langQuery],
        'responses' => [
            ['status' => 200, 'description' => '`{value, lang}` — `value` ist ein strukturiertes Objekt, kein Text.'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `website:read`.'],
            ['status' => 404, 'description' => 'Unbekannte Site.'],
        ],
    ],
    [
        'method' => 'PUT',
        'pattern' => '/cms/{site:[a-z0-9-]+}/blocks/{key:[a-z0-9_-]+}',
        'tag' => 'Inhalte',
        'summary' => 'Inhaltsblock speichern',
        'description' => 'Zwei Seiteneffekte, die man kennen muss: das Speichern **löscht '
            . 'das `machine_translated`-Kennzeichen** (was hier gespeichert wird, ist '
            . 'redaktioneller Text), und es **legt die Gegensprache maschinell an oder '
            . 'frischt sie auf** (DeepL, best effort) — eine von Hand übersetzte Fassung '
            . 'wird dabei nie überschrieben. Anschließend wird der Rebuild der Site '
            . 'ausgelöst, sofern konfiguriert.',
        'permission' => 'website:write',
        'params' => [
            $site,
            $blockKey,
            ['in' => 'body', 'name' => 'value', 'type' => 'object', 'required' => true, 'description' => 'Der strukturierte Blockinhalt.'],
            ['in' => 'body', 'name' => 'lang', 'type' => 'de|en', 'description' => 'Sprache des gespeicherten Inhalts; Vorgabe `de`.'],
        ],
        'responses' => [
            ['status' => 200, 'description' => '`{ok: true}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `website:write`.'],
            ['status' => 404, 'description' => 'Unbekannte Site.'],
            ['status' => 422, 'description' => '`value` fehlt oder ist kein Objekt.'],
        ],
    ],
    [
        'method' => 'DELETE',
        'pattern' => '/cms/{site:[a-z0-9-]+}/blocks/{key:[a-z0-9_-]+}',
        'tag' => 'Inhalte',
        'summary' => 'Inhaltsblock löschen',
        'description' => 'Die öffentliche Seite fällt danach auf ihre Vorgabe zurück — '
            . 'unauffällig, deshalb ist Löschen hier keine sichtbare Änderung.',
        'permission' => 'website:write',
        'params' => [$site, $blockKey, $langQuery],
        'responses' => [
            ['status' => 200, 'description' => '`{ok: true}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `website:write`.'],
            ['status' => 404, 'description' => 'Unbekannte Site.'],
        ],
    ],
    [
        'method' => 'PUT',
        'pattern' => '/cms/sites/{site:[a-z0-9-]+}/rebuild-config',
        'tag' => 'Rebuild',
        'summary' => 'Rebuild-Ziel einer Site setzen',
        'description' => 'Welches Repository und welcher Workflow nach einer Inhaltsänderung '
            . 'gebaut werden. Leere Werte löschen die Konfiguration.',
        'permission' => 'website:write',
        'params' => [
            $site,
            ['in' => 'body', 'name' => 'rebuild_repo', 'type' => 'string', 'description' => 'Muss `owner/name` sein. Leer löscht.'],
            ['in' => 'body', 'name' => 'rebuild_workflow', 'type' => 'string', 'description' => 'Dateiname des Workflows.'],
        ],
        'responses' => [
            ['status' => 200, 'description' => '`{ok: true}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `website:write`.'],
            ['status' => 404, 'description' => 'Unbekannte Site.'],
            ['status' => 422, 'description' => '`rebuild_repo` ist nicht `owner/name`.'],
        ],
    ],
    [
        'method' => 'POST',
        'pattern' => '/cms/sites/{site:[a-z0-9-]+}/translations/backfill',
        'tag' => 'Inhalte',
        'summary' => 'Fehlende Übersetzungen für alle Blöcke einer Site nachziehen',
        'description' => 'Läuft über jeden von Hand gepflegten Block und legt die '
            . 'Gegensprache maschinell an. **Maschinelle Zeilen sind Ziele, keine '
            . 'Quellen** — sie werden übersprungen, sonst würde eine Übersetzung eine '
            . 'Übersetzung übersetzen. `skipped` zählt beides zusammen: bereits '
            . 'vorhandene Übersetzungen und maschinelle Zeilen. Nur wenn wirklich etwas '
            . 'entstanden ist, wird der Rebuild ausgelöst.',
        'permission' => 'website:write',
        'params' => [$site],
        'responses' => [
            ['status' => 200, 'description' => '`{created, skipped}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `website:write`.'],
            ['status' => 404, 'description' => 'Unbekannte Site.'],
            ['status' => 503, 'description' => 'Kein DeepL-Schlüssel hinterlegt oder Auto-Übersetzung abgeschaltet.'],
        ],
    ],
    [
        'method' => 'POST',
        'pattern' => '/cms/sites/{site:[a-z0-9-]+}/rebuild',
        'tag' => 'Rebuild',
        'summary' => 'Rebuild einer Site von Hand auslösen',
        'description' => 'Das „Jetzt neu bauen" der Oberfläche. Zwei getrennte Gründe für '
            . 'ein Nein: gar kein Rebuild-Token hinterlegt (503, betrifft alle Sites) '
            . 'oder kein Repository an dieser Site (422, betrifft nur diese).',
        'permission' => 'website:write',
        'params' => [$site],
        'responses' => [
            ['status' => 200, 'description' => '`{ok: true}` — der Workflow wurde angestoßen.'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `website:write`.'],
            ['status' => 404, 'description' => 'Unbekannte Site.'],
            ['status' => 422, 'description' => 'Für diese Site ist kein Rebuild-Repository konfiguriert.'],
            ['status' => 503, 'description' => 'Kein Rebuild-Token konfiguriert.'],
        ],
    ],
];
