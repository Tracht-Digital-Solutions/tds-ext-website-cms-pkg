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
        'summary' => 'Redaktionelle Blöcke der gebundenen Site für die öffentlichen Seiten',
        'description' => 'Die Nachfolgerin von `tds-content-api`s offener `/content/landing`, '
            . 'unter demselben Pfad, damit Landingpage und Blog **unverändert** '
            . 'weiterlesen. Unauthentifiziert und lesend. **Ein Datenbankproblem gibt '
            . 'leere Blöcke zurück, niemals 500** — die öffentliche Seite fällt dann auf '
            . 'ihre eingebauten Vorgaben zurück, statt zu scheitern. Die Kehrseite: '
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
        'summary' => 'Welche Rechtsdokumente für die gebundene Site hinterlegt sind',
        'description' => 'Nur Metadaten (Dateiname, Größe, Stand), keine Bytes. Die '
            . 'Landingpage entscheidet damit beim Rendern, ob sie die hochgeladene AGB '
            . 'oder die mitcommittete Rückfalldatei ausliefert, und rendert das „Stand: …"-Label. '
            . 'Gleiche Ausfallsicherheit wie `/content/landing`.',
        'auth' => 'public',
        'responses' => [
            ['status' => 200, 'description' => '`{docs: {<key>: {<lang>: {filename, sizeBytes, versionLabel, updatedAt}}}}` — verschachtelte Objekte, auch wenn leer.'],
        ],
    ],
    [
        'method' => 'GET',
        'pattern' => '/content/legal/{key:[a-z0-9-]+}.pdf',
        'tag' => 'Öffentlich',
        'summary' => 'Ein Rechtsdokument der gebundenen Site herunterladen',
        'description' => 'Die Bytes selbst — das, was die Landingpage beim Rendern lädt und was '
            . 'ein Besucher direkt aufrufen kann. Die Ressourcenbindung des Site-Keys '
            . 'wählt die Site eindeutig; ohne Bindung gilt für die Übergangsrelease die '
            . 'bisherige Standard-Site.',
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
            ['status' => 200, 'description' => '`{docs: [{docKey, lang, filename, sizeBytes, versionLabel, updatedAt}]}`'],
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
            ['status' => 201, 'description' => '`{ok: true, cache_status, cached, rebuilt, skipped, failed, unknownEvents}`'],
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
            ['status' => 200, 'description' => '`{ok: true, cache_status, cached, rebuilt, skipped, failed, unknownEvents}`'],
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
        'summary' => 'Alle registrierten Sites',
        'permission' => 'website:read',
        'responses' => [
            ['status' => 200, 'description' => '`{sites: [{id, site_key, name, cache_url, updated_at}]}` — `cache_url` ist nur der Übergangs-Fallback; neue Verbindungen stehen in der Verbindungsressource.'],
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
        'pattern' => '/cms/sites/{site:[a-z0-9-]+}/connection',
        'tag' => 'Verbindungen',
        'summary' => 'API-Verbindung einer Site lesen',
        'description' => 'Liefert ausschließlich die öffentliche Identität und echte '
            . 'Statuszeitpunkte. Site-Key und Cache-Token werden nie ausgegeben.',
        'permission' => 'website:read',
        'params' => [$site],
        'responses' => [
            ['status' => 200, 'description' => '`{connection: {resource_type, resource_id, origin, profile, bindings, scopes, status, paired_at, last_seen_at}}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `website:read`.'],
            ['status' => 404, 'description' => 'Unbekannte Site oder noch keine Verbindung.'],
            ['status' => 503, 'description' => 'Der zentrale Verbindungsdienst ist nicht verfügbar.'],
        ],
    ],
    [
        'method' => 'DELETE',
        'pattern' => '/cms/sites/{site:[a-z0-9-]+}/connection',
        'tag' => 'Verbindungen',
        'summary' => 'API-Verbindung einer Site trennen',
        'permission' => 'website:write',
        'params' => [$site],
        'responses' => [
            ['status' => 200, 'description' => '`{ok: true, deleted: bool}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `website:write`.'],
            ['status' => 404, 'description' => 'Unbekannte Site.'],
            ['status' => 503, 'description' => 'Der zentrale Verbindungsdienst ist nicht verfügbar.'],
        ],
    ],
    [
        'method' => 'POST',
        'pattern' => '/cms/sites/{site:[a-z0-9-]+}/connection/pairing',
        'tag' => 'Verbindungen',
        'summary' => 'Site mit der API verbinden oder neu verbinden',
        'description' => 'Erzeugt eine zehn Minuten gültige, einmal verwendbare Freigabe '
            . 'und liefert sie serverseitig direkt an die HTTPS-Origin. Schlägt das fehl, '
            . 'enthält `fallback_url` den Einrichtungslink; das Geheimnis steht nur im '
            . 'URL-Fragment. Eine bestehende Verbindung bleibt bis zur Finalisierung aktiv.',
        'permission' => 'website:write',
        'params' => [
            $site,
            ['in' => 'body', 'name' => 'origin', 'type' => 'https-origin', 'required' => true, 'description' => 'Reine HTTPS-Origin der Site, ohne Zugangsdaten, Pfad, Query oder Fragment.'],
            ['in' => 'body', 'name' => 'bindings', 'type' => 'object', 'description' => 'Optional `{blog: "<blog_key>"}`. Bei genau einem Blog wird automatisch gebunden; bei mehreren ist die Auswahl Pflicht.'],
        ],
        'responses' => [
            ['status' => 201, 'description' => 'Geheimnisfreier Lieferstatus mit optionaler `connection` oder `fallback_url`.'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `website:write`.'],
            ['status' => 404, 'description' => 'Unbekannte Site.'],
            ['status' => 422, 'description' => 'Ungültige Origin, fehlende Auswahl bei mehreren Blogs oder unbekannter Blog-Schlüssel.'],
            ['status' => 429, 'description' => 'Zu viele Pairing-Versuche.'],
            ['status' => 503, 'description' => 'Pairing- oder Verbindungsdienst ist nicht verfügbar.'],
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
            . 'wird dabei nie überschrieben.'
            . "\n\n" . 'Anschließend wird **nur der betroffene Seiten-Cache** neu gebaut: '
            . 'gemeldet wird der Abschnitt (`{type:"block", id:"<key>"}`), und welche '
            . 'Seiten das sind, entscheidet die öffentliche Website anhand ihrer eigenen '
            . 'Routen-Tabelle. Wurde die Gegensprache im selben Aufruf maschinell '
            . 'übersetzt, entfällt die Sprachangabe, damit auch die englische Seite neu '
            . 'gerendert wird.',
        'permission' => 'website:write',
        'params' => [
            $site,
            $blockKey,
            ['in' => 'body', 'name' => 'value', 'type' => 'object', 'required' => true, 'description' => 'Der strukturierte Blockinhalt.'],
            ['in' => 'body', 'name' => 'lang', 'type' => 'de|en', 'description' => 'Sprache des gespeicherten Inhalts; Vorgabe `de`.'],
        ],
        'responses' => [
            ['status' => 200, 'description' => '`{ok: true, translated: bool, cache_status, cached, rebuilt, skipped, failed, unknownEvents}` — '
                . '`cached` sagt, ob wirklich ein Cache-Neubau rausgegangen ist (Cache-URL '
                . 'und Token vorhanden). Ohne dieses Feld müsste die Oberfläche einen Erfolg '
                . 'für eine Anfrage melden, die niemand abgeschickt hat.'],
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
            ['status' => 200, 'description' => '`{ok: true, cache_status, cached, rebuilt, skipped, failed, unknownEvents}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `website:write`.'],
            ['status' => 404, 'description' => 'Unbekannte Site.'],
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
            . 'Übersetzung übersetzen. `translation_skipped` zählt beides zusammen: bereits '
            . 'vorhandene Übersetzungen und maschinelle Zeilen. Nur wenn wirklich etwas '
            . 'entstanden ist, wird der Seiten-Cache der Site neu gebaut.',
        'permission' => 'website:write',
        'params' => [$site],
        'responses' => [
            ['status' => 200, 'description' => '`{created, translation_skipped, cache_status, cached, rebuilt, skipped, failed, unknownEvents}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `website:write`.'],
            ['status' => 404, 'description' => 'Unbekannte Site.'],
            ['status' => 503, 'description' => 'Kein DeepL-Schlüssel hinterlegt oder Auto-Übersetzung abgeschaltet.'],
        ],
    ],
    [
        'method' => 'POST',
        'pattern' => '/cms/sites/{site:[a-z0-9-]+}/cache/rebuild',
        'tag' => 'Verbindungen',
        'summary' => 'Seiten-Cache einer Site neu bauen',
        'description' => 'Rendert Seiten aus bereits gespeichertem Inhalt neu, ohne Build '
            . 'oder Deployment. Ohne `all` wird nur der Inhaltsteil erfasst, mit `all` zusätzlich '
            . 'die Rechtsdokumente.',
        'permission' => 'website:write',
        'params' => [
            $site,
            ['in' => 'body', 'name' => 'all', 'type' => 'bool', 'description' => 'Alles erfassen statt nur die Inhaltsblöcke.'],
        ],
        'responses' => [
            ['status' => 202, 'description' => '`{ok: true, cache_status: "refreshed", cached: true, rebuilt, skipped, failed, unknownEvents}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `website:write`.'],
            ['status' => 404, 'description' => 'Unbekannte Site.'],
            ['status' => 422, 'description' => 'Die gespeicherte Übergangs-Origin ist ungültig.'],
            ['status' => 503, 'description' => 'Die Site ist nicht verbunden oder die Cache-Anbindung ist nicht vollständig konfiguriert.'],
            ['status' => 502, 'description' => 'Die öffentliche Site meldete einen Fehler oder nur einen Teilerfolg.'],
        ],
    ],
];
