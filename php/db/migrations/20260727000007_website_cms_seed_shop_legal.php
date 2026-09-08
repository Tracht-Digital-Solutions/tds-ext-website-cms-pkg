<?php
declare(strict_types=1);

use Phinx\Migration\AbstractMigration;

/**
 * Draft legal texts for TDShop (`shop.tracht-digital.de`).
 *
 * ### These are DRAFTS, and the code says so
 *
 * Every document opens with a visible draft notice. That is deliberate: a legal
 * text that reads as finished is one somebody publishes without reading, and
 * these have not been reviewed by a lawyer. The notice is part of the seeded
 * markdown rather than a flag elsewhere, so it cannot be lost by a copy-paste
 * into the editor — removing it is an explicit act by whoever decides the text
 * is ready.
 *
 * ### Insert-only, never overwrite
 *
 * `ON DUPLICATE KEY UPDATE id = id` is a deliberate no-op. A seed that
 * overwrote would silently discard whatever the operator had edited the last
 * time the migration ledger was rebuilt — and the whole point of these rows is
 * that they get edited. Re-running this migration on a database that already
 * has them changes nothing.
 *
 * ### Why blocks rather than `cms_legal_doc`
 *
 * `cms_legal_doc` stores uploaded **PDF bytes** — right for an AGB that is
 * handed over as a document, wrong for a shop. A consumer has to be able to
 * read the terms before ordering, on the page, in text form (§ 312i BGB), and
 * a search engine and a screen reader have to get at them too. So these are
 * `cms_block` rows carrying markdown, the same mechanism the landing page's
 * Impressum and Datenschutzerklärung already use.
 *
 * ### The keys are per-site
 *
 * `uniq_cms_block` is `(site_id, section_key, lang)`, so TDShop reuses the same
 * `legal_*` keys under its own site row rather than inventing shop-prefixed
 * ones. The shop's site key must be bound to this `cms_site` row for
 * `requestSite()` to serve them.
 *
 * Version `20260727000007` — inside the `20260727*` band this module already
 * owns. Every composed module shares one `phinxlog`, so the band matters.
 */
final class WebsiteCmsSeedShopLegal extends AbstractMigration
{
    private const SITE_KEY = 'shop';

    private const DRAFT_DE = "> **Entwurf — noch nicht geprüft.** Dieser Text wurde als Ausgangspunkt "
        . "erstellt und ist **nicht** anwaltlich geprüft. Vor der Veröffentlichung prüfen, "
        . "die mit ⚠️ markierten Stellen ausfüllen und diesen Hinweis entfernen.\n\n";

    public function up(): void
    {
        $siteId = $this->siteId();
        if ($siteId === null) {
            return;
        }

        foreach (self::documents() as $key => $byLang) {
            foreach ($byLang as $lang => $markdown) {
                $this->execute(sprintf(
                    'INSERT INTO cms_block (site_id, section_key, lang, value_json)'
                    . " VALUES (%d, %s, %s, %s)"
                    // No-op on conflict: never discard an edited text.
                    . ' ON DUPLICATE KEY UPDATE id = id',
                    $siteId,
                    $this->quote($key),
                    $this->quote($lang),
                    $this->quote(json_encode(
                        ['markdown' => $markdown],
                        JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES,
                    )),
                ));
            }
        }
    }

    public function down(): void
    {
        $siteId = $this->siteId();
        if ($siteId === null) {
            return;
        }
        $keys = implode(',', array_map([$this, 'quote'], array_keys(self::documents())));
        $this->execute("DELETE FROM cms_block WHERE site_id = {$siteId} AND section_key IN ({$keys})");
    }

    /** The shop's site row, created if it does not exist yet. */
    private function siteId(): ?int
    {
        $key = $this->quote(self::SITE_KEY);
        $row = $this->fetchRow("SELECT id FROM cms_site WHERE site_key = {$key} LIMIT 1");
        if (is_array($row) && isset($row['id'])) {
            return (int) $row['id'];
        }

        $this->execute(
            "INSERT INTO cms_site (site_key, name) VALUES ({$key}, 'TDShop')"
            . ' ON DUPLICATE KEY UPDATE id = id',
        );
        $row = $this->fetchRow("SELECT id FROM cms_site WHERE site_key = {$key} LIMIT 1");
        return is_array($row) && isset($row['id']) ? (int) $row['id'] : null;
    }

    private function quote(string $value): string
    {
        return $this->getAdapter()->quoteValue($value);
    }

    /**
     * The seeded documents.
     *
     * German is the binding version — the shop sells to Germany only, so the
     * English texts are a courtesy translation that says as much rather than a
     * second set of terms. Two sets of terms in two languages is two things
     * that can disagree.
     *
     * @return array<string, array<string, string>>
     */
    private static function documents(): array
    {
        return [
            'legal_impressum' => ['de' => self::impressumDe(), 'en' => self::impressumEn()],
            'legal_agb' => ['de' => self::agbDe(), 'en' => self::foreignNoticeEn('Terms and Conditions', 'AGB')],
            'legal_widerruf' => ['de' => self::widerrufDe(), 'en' => self::foreignNoticeEn('Right of withdrawal', 'Widerruf')],
            'legal_zahlung' => ['de' => self::zahlungDe(), 'en' => self::foreignNoticeEn('Payment and delivery', 'Zahlung und Lieferung')],
            'legal_affiliate' => ['de' => self::affiliateDe(), 'en' => self::affiliateEn()],
            'legal_datenschutz' => ['de' => self::datenschutzDe(), 'en' => self::foreignNoticeEn('Privacy policy', 'Datenschutz')],
        ];
    }

    private static function impressumDe(): string
    {
        return self::DRAFT_DE . <<<'MD'
# Impressum

Angaben gemäß § 5 DDG (vormals § 5 TMG).

**Julian Tracht**
Tracht Digital Solutions
Elbinger Straße 19
21493 Schwarzenbek
Deutschland

**Kontakt**
E-Mail: kontakt@tracht-digital.de
Telefon: +49 178 8224022

**Umsatzsteuer-Identifikationsnummer** gemäß § 27a UStG
DE450639725

**Verantwortlich für den Inhalt** nach § 18 Abs. 2 MStV
Julian Tracht, Anschrift wie oben.

## Verbraucherstreitbeilegung

Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung
bereit: <https://ec.europa.eu/consumers/odr/>

Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor
einer Verbraucherschlichtungsstelle teilzunehmen.

⚠️ Prüfen: Falls eine Berufshaftpflichtversicherung besteht oder eine
Aufsichtsbehörde zuständig ist, müssen diese Angaben hier ergänzt werden.
MD;
    }

    private static function impressumEn(): string
    {
        return <<<'MD'
> **Draft — not reviewed.** This text is a starting point and has **not** been
> checked by a lawyer. Review before publishing and remove this notice.

# Legal notice

Information pursuant to § 5 DDG (German Digital Services Act).

**Julian Tracht**
Tracht Digital Solutions
Elbinger Straße 19
21493 Schwarzenbek
Germany

**Contact**
Email: kontakt@tracht-digital.de
Phone: +49 178 8224022

**VAT identification number** pursuant to § 27a UStG
DE450639725

**Responsible for content** pursuant to § 18 (2) MStV
Julian Tracht, address as above.

## Consumer dispute resolution

The European Commission provides a platform for online dispute resolution:
<https://ec.europa.eu/consumers/odr/>

We are neither willing nor obliged to participate in dispute resolution
proceedings before a consumer arbitration board.
MD;
    }

    private static function agbDe(): string
    {
        return self::DRAFT_DE . <<<'MD'
# Allgemeine Geschäftsbedingungen

Stand: ⚠️ Datum eintragen

## 1. Geltungsbereich und Anbieter

(1) Diese Allgemeinen Geschäftsbedingungen gelten für alle Verträge über
digitale Dienstleistungen, die über `shop.tracht-digital.de` („TDShop")
zwischen Julian Tracht, Tracht Digital Solutions, Elbinger Straße 19,
21493 Schwarzenbek (nachfolgend „wir") und Ihnen geschlossen werden.

(2) Wir verkaufen ausschließlich an Kundinnen und Kunden mit Lieferanschrift in
Deutschland. Bestellungen aus anderen Ländern können wir derzeit nicht
annehmen.

(3) Abweichende Bedingungen der Kundin oder des Kunden werden nicht
Vertragsbestandteil, es sei denn, wir stimmen ihrer Geltung ausdrücklich in
Textform zu.

## 2. Gegenstand des Vertrags

(1) Gegenstand sind **digitale Dienstleistungen** — etwa Einrichtungs- und
Beratungspakete rund um Digitalisierung und Technik. Der Umfang der jeweiligen
Leistung ergibt sich aus der Beschreibung auf der Produktseite zum Zeitpunkt
der Bestellung.

(2) Es handelt sich **nicht** um den Verkauf körperlicher Waren. Es erfolgt
kein Versand.

(3) Auf TDShop werden daneben Produkte Dritter vorgestellt und mit
Partnerlinks verlinkt. Ein Kauf über einen solchen Link kommt ausschließlich
zwischen Ihnen und dem jeweiligen Anbieter zustande; wir werden dabei nicht
Vertragspartei. Näheres im **Affiliate-Hinweis**.

## 3. Vertragsschluss

(1) Die Darstellung der Leistungen auf TDShop ist kein bindendes Angebot,
sondern eine Aufforderung zur Bestellung.

(2) Mit dem Anklicken der Schaltfläche „Zahlungspflichtig bestellen" geben Sie
ein verbindliches Angebot ab. Unmittelbar davor werden Ihnen die wesentlichen
Merkmale der Leistung, der Gesamtpreis einschließlich Umsatzsteuer und die
Art der Erbringung angezeigt.

(3) Der Vertrag kommt zustande, sobald wir Ihnen den Zugang der Bestellung
bestätigen oder mit der Leistung beginnen.

(4) Der Vertragstext wird von uns gespeichert. Sie erhalten die Bestelldaten
sowie diese AGB per E-Mail auf einem dauerhaften Datenträger.

## 4. Preise und Zahlung

(1) Alle Preise sind Gesamtpreise in Euro und enthalten die gesetzliche
Umsatzsteuer von derzeit 19 %. Weitere Kosten fallen nicht an; es entstehen
keine Versandkosten.

(2) Die Zahlung erfolgt über unseren Zahlungsdienstleister Stripe. Welche
Zahlungsarten zur Verfügung stehen, wird Ihnen vor Abgabe der Bestellung
angezeigt.

(3) Die Zahlung ist mit Vertragsschluss sofort fällig.

## 5. Erbringung der Leistung

(1) Wir beginnen mit der Leistung nach Zahlungseingang, sofern Sie der
vorzeitigen Ausführung zugestimmt haben (siehe Widerrufsbelehrung).

(2) ⚠️ Prüfen und konkretisieren: übliche Bearbeitungsdauer bzw. Frist, innerhalb
derer wir mit der Leistung beginnen.

(3) Soweit für die Erbringung eine Mitwirkung Ihrerseits erforderlich ist
(Zugänge, Informationen, Terminabstimmung), verlängert sich der Zeitraum um die
Dauer, in der die Mitwirkung aussteht.

## 6. Widerrufsrecht

Verbraucherinnen und Verbrauchern steht ein Widerrufsrecht zu. Einzelheiten
und die Bedingungen, unter denen es vorzeitig erlischt, ergeben sich aus der
gesonderten **Widerrufsbelehrung**.

## 7. Gewährleistung und Haftung

(1) Es gelten die gesetzlichen Regelungen zur Mängelhaftung.

(2) Wir haften unbeschränkt bei Vorsatz und grober Fahrlässigkeit, bei
Verletzung von Leben, Körper oder Gesundheit sowie nach dem
Produkthaftungsgesetz.

(3) Bei einfacher Fahrlässigkeit haften wir nur bei Verletzung einer
wesentlichen Vertragspflicht — also einer Pflicht, deren Erfüllung die
ordnungsgemäße Durchführung des Vertrags überhaupt erst ermöglicht und auf
deren Einhaltung Sie regelmäßig vertrauen dürfen. In diesem Fall ist die
Haftung auf den vertragstypischen, vorhersehbaren Schaden begrenzt.

(4) Eine weitergehende Haftung ist ausgeschlossen.

## 8. Schlussbestimmungen

(1) Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss des
UN-Kaufrechts. Zwingende Verbraucherschutzvorschriften des Staates, in dem Sie
Ihren gewöhnlichen Aufenthalt haben, bleiben unberührt.

(2) Sollte eine Bestimmung unwirksam sein, bleibt die Wirksamkeit der übrigen
Bestimmungen unberührt.
MD;
    }

    private static function widerrufDe(): string
    {
        return self::DRAFT_DE . <<<'MD'
# Widerrufsbelehrung

Diese Belehrung gilt für Verbraucherinnen und Verbraucher — also für jede
natürliche Person, die ein Rechtsgeschäft zu Zwecken abschließt, die
überwiegend weder ihrer gewerblichen noch ihrer selbständigen beruflichen
Tätigkeit zugerechnet werden können.

## Widerrufsrecht

Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen
Vertrag zu widerrufen. Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des
Vertragsabschlusses.

Um Ihr Widerrufsrecht auszuüben, müssen Sie uns

**Julian Tracht, Tracht Digital Solutions**
Elbinger Straße 19, 21493 Schwarzenbek
E-Mail: kontakt@tracht-digital.de
Telefon: +49 178 8224022

mittels einer eindeutigen Erklärung (z. B. ein mit der Post versandter Brief
oder eine E-Mail) über Ihren Entschluss, diesen Vertrag zu widerrufen,
informieren. Sie können dafür das unten stehende Muster-Widerrufsformular
verwenden, das jedoch nicht vorgeschrieben ist.

Zur Wahrung der Widerrufsfrist reicht es aus, dass Sie die Mitteilung über die
Ausübung des Widerrufsrechts vor Ablauf der Widerrufsfrist absenden.

## Folgen des Widerrufs

Wenn Sie diesen Vertrag widerrufen, haben wir Ihnen alle Zahlungen, die wir von
Ihnen erhalten haben, unverzüglich und spätestens binnen vierzehn Tagen ab dem
Tag zurückzuzahlen, an dem die Mitteilung über Ihren Widerruf dieses Vertrags
bei uns eingegangen ist. Für diese Rückzahlung verwenden wir dasselbe
Zahlungsmittel, das Sie bei der ursprünglichen Transaktion eingesetzt haben, es
sei denn, mit Ihnen wurde ausdrücklich etwas anderes vereinbart; in keinem Fall
werden Ihnen wegen dieser Rückzahlung Entgelte berechnet.

Haben Sie verlangt, dass die Dienstleistung während der Widerrufsfrist beginnen
soll, so haben Sie uns einen angemessenen Betrag zu zahlen, der dem Anteil der
bis zu dem Zeitpunkt, zu dem Sie uns von der Ausübung des Widerrufsrechts
hinsichtlich dieses Vertrags unterrichten, bereits erbrachten Dienstleistungen
im Vergleich zum Gesamtumfang der im Vertrag vorgesehenen Dienstleistungen
entspricht.

## Vorzeitiges Erlöschen des Widerrufsrechts

Das Widerrufsrecht erlischt bei einem Vertrag über die Erbringung von
Dienstleistungen, wenn wir die Dienstleistung vollständig erbracht haben und
mit der Ausführung der Dienstleistung erst begonnen haben, nachdem Sie dazu
Ihre ausdrückliche Zustimmung gegeben haben und gleichzeitig Ihre Kenntnis
davon bestätigt haben, dass Sie Ihr Widerrufsrecht bei vollständiger
Vertragserfüllung durch uns verlieren.

Diese Zustimmung holen wir im Bestellvorgang ausdrücklich ein; ohne sie kann
die Bestellung nicht abgeschlossen werden. Den genauen Wortlaut, dem Sie
zugestimmt haben, führen wir mit Ihrer Bestellung und finden Sie auf Ihrer
Bestellseite wieder.

---

## Muster-Widerrufsformular

*(Wenn Sie den Vertrag widerrufen wollen, füllen Sie bitte dieses Formular aus
und senden Sie es zurück.)*

An
Julian Tracht, Tracht Digital Solutions,
Elbinger Straße 19, 21493 Schwarzenbek,
E-Mail: kontakt@tracht-digital.de

Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*) abgeschlossenen Vertrag
über den Kauf der folgenden Waren (*) / die Erbringung der folgenden
Dienstleistung (*)

— Bestellt am (*) / erhalten am (*)
— Name des/der Verbraucher(s)
— Anschrift des/der Verbraucher(s)
— Unterschrift des/der Verbraucher(s) (nur bei Mitteilung auf Papier)
— Datum

*(*) Unzutreffendes streichen.*
MD;
    }

    private static function zahlungDe(): string
    {
        return self::DRAFT_DE . <<<'MD'
# Zahlung und Lieferung

## Preise

Alle angegebenen Preise sind Gesamtpreise in Euro und enthalten die gesetzliche
Umsatzsteuer von derzeit 19 %. Weitere Kosten entstehen nicht.

## Zahlungsarten

Die Zahlung wickeln wir über **Stripe Payments Europe, Ltd.** ab. Welche
Zahlungsarten Ihnen zur Verfügung stehen, sehen Sie im Bestellvorgang, bevor
Sie die Bestellung abschließen. Die Zahlung ist sofort mit Vertragsschluss
fällig.

## Erbringung

Wir bieten **digitale Dienstleistungen** an. Es gibt keinen Versand und keine
Versandkosten. Nach Zahlungseingang melden wir uns per E-Mail und beginnen mit
der Leistung.

⚠️ Prüfen und konkretisieren: übliche Bearbeitungsdauer.

## Bestellbestätigung

Sie erhalten die Bestätigung Ihrer Bestellung an die im Bestellvorgang
angegebene E-Mail-Adresse. Ihre Bestellung können Sie außerdem jederzeit über
den Link in dieser E-Mail einsehen.

## Preise verlinkter Fremdprodukte

Preise, die wir zu Produkten anderer Anbieter anzeigen, stammen von den
jeweiligen Anbietern und sind eine Momentaufnahme mit dem angegebenen
Zeitstempel. Maßgeblich ist stets der Preis, der zum Zeitpunkt des Kaufs auf
der Seite des Anbieters ausgewiesen ist. Ist eine Angabe älter als 24 Stunden,
zeigen wir sie nicht mehr an.
MD;
    }

    private static function affiliateDe(): string
    {
        return self::DRAFT_DE . <<<'MD'
# Hinweis zu Partnerlinks (Werbung)

## Was Partnerlinks sind

Auf TDShop, im Journal und im Kundenportal stellen wir Produkte anderer
Anbieter vor. Ein Teil dieser Verlinkungen sind **Partnerlinks** (auch
Affiliate-Links). Kaufen Sie über einen solchen Link, erhalten wir vom Anbieter
eine Provision. **Für Sie ändert sich der Preis dadurch nicht.**

Solche Inhalte kennzeichnen wir sichtbar mit **„Anzeige"**. Die Kennzeichnung
ist fest eingebaut und lässt sich nicht abschalten.

## Wer Ihr Vertragspartner wird

Ein Kauf über einen Partnerlink kommt ausschließlich zwischen Ihnen und dem
jeweiligen Anbieter zustande. Für dessen Angebot, Preise, Lieferung,
Gewährleistung und Datenverarbeitung ist allein er verantwortlich. Wir werden
nicht Vertragspartei.

## Amazon

Als Amazon-Partner verdienen wir an qualifizierten Verkäufen.

Preise und Verfügbarkeiten zu Amazon-Produkten beziehen wir über die Amazon
Product Advertising API. Sie sind eine Momentaufnahme zum angegebenen
Zeitpunkt und können sich zwischenzeitlich geändert haben. Maßgeblich ist der
Preis, der zum Kaufzeitpunkt auf der Amazon-Produktseite steht. Angaben, die
älter als 24 Stunden sind, zeigen wir nicht mehr an.

⚠️ Prüfen: Amazon gibt den Wortlaut des Partnerhinweises und des
Preis-Disclaimers vor. Aktuellen Wortlaut aus den Teilnahmebedingungen des
PartnerNet übernehmen.

## Wie wir auswählen

Wir nehmen Produkte auf, die wir für den Einsatz in kleinen Betrieben für
sinnvoll halten. Eine Provision beeinflusst weder die Aufnahme noch unsere
Einschätzung.
MD;
    }

    private static function affiliateEn(): string
    {
        return <<<'MD'
> **Draft — not reviewed.** This text is a starting point and has **not** been
> checked by a lawyer. Review before publishing and remove this notice.

# About affiliate links (advertising)

Some of the product links on TDShop, in the journal and in the customer portal
are **affiliate links**. If you buy through one, we receive a commission from
the merchant. **The price is the same for you.**

Such content is visibly labelled **"Advertisement"**. The labelling is built in
and cannot be switched off.

A purchase made through an affiliate link is a contract solely between you and
that merchant. They alone are responsible for their offer, prices, delivery,
warranty and data processing. We do not become a party to it.

## Amazon

As an Amazon Associate we earn from qualifying purchases.

Prices and availability for Amazon products are retrieved through the Amazon
Product Advertising API. They are a snapshot taken at the time shown and may
have changed since. The price displayed on the Amazon product page at the time
of purchase is the one that applies. We stop showing any figure older than 24
hours.

## How we choose

We list products we consider useful in a small business. A commission
influences neither the listing nor our assessment.
MD;
    }

    private static function datenschutzDe(): string
    {
        return self::DRAFT_DE . <<<'MD'
# Datenschutzerklärung

## 1. Verantwortlicher

Julian Tracht, Tracht Digital Solutions
Elbinger Straße 19, 21493 Schwarzenbek
E-Mail: kontakt@tracht-digital.de

⚠️ Prüfen: Ob ein Datenschutzbeauftragter zu benennen ist, richtet sich nach
§ 38 BDSG. In der Regel besteht bei dieser Betriebsgröße keine Pflicht.

## 2. Aufruf der Website

Beim Aufruf von `shop.tracht-digital.de` verarbeitet unser Hoster
Server-Logdaten (IP-Adresse, Zeitpunkt, abgerufene Seite, User-Agent).
Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO; unser berechtigtes Interesse
liegt im sicheren und störungsfreien Betrieb.

⚠️ Prüfen: Hoster benennen und Auftragsverarbeitungsvertrag angeben.

## 3. Bestellung und Zahlung

Bestellen Sie eine unserer Leistungen, verarbeiten wir Ihre E-Mail-Adresse,
gegebenenfalls Ihren Namen, das Bestell- und Zahlungsdatum sowie die
Rechnungsangaben. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO
(Vertragserfüllung), für die Aufbewahrung zusätzlich Art. 6 Abs. 1 lit. c DSGVO
in Verbindung mit den handels- und steuerrechtlichen Aufbewahrungsfristen
(§ 147 AO, § 257 HGB) — regelmäßig zehn Jahre.

Die Zahlung wickeln wir über **Stripe Payments Europe, Ltd.**, 1 Grand Canal
Street Lower, Dublin, Irland, ab. Stripe verarbeitet Ihre Zahlungsdaten in
eigener Verantwortung; wir erhalten keine vollständigen Kartendaten.
Datenschutzhinweise: <https://stripe.com/de/privacy>

## 4. Partnerlinks

Klicken Sie auf einen Partnerlink, leiten wir Sie über unsere eigene Adresse
(`/go/…`) zum Anbieter weiter. Dabei zählen wir den Klick **ausschließlich als
Tagessumme** je Angebot. Wir speichern dabei **keine IP-Adresse, kein Cookie
und keine Kennung**, die Sie identifizieren könnte. Eine Einwilligung ist dafür
nicht erforderlich, weil keine personenbezogenen Daten verarbeitet werden.

Nach der Weiterleitung gilt die Datenschutzerklärung des jeweiligen Anbieters.
Bei Amazon kann dies eine Übermittlung in Drittländer einschließen; Einzelheiten
regelt Amazon.

⚠️ Prüfen: Falls später Partnernetzwerke mit Cookie-Tracking hinzukommen, ist
dafür eine Einwilligung nach § 25 TDDDG erforderlich und dieser Abschnitt zu
ergänzen.

## 5. Produktbilder von Amazon

Produktbilder zu Amazon-Angeboten werden von Amazons Servern geladen. Dabei
erhält Amazon technisch bedingt Ihre IP-Adresse. Das ist Vorgabe der
Nutzungsbedingungen der Product Advertising API; ein Spiegeln der Bilder ist
uns nicht gestattet.

## 6. Kontaktaufnahme

Nehmen Sie per E-Mail Kontakt auf, verarbeiten wir Ihre Angaben zur Bearbeitung
der Anfrage (Art. 6 Abs. 1 lit. b bzw. lit. f DSGVO).

## 7. Ihre Rechte

Sie haben das Recht auf Auskunft (Art. 15), Berichtigung (Art. 16), Löschung
(Art. 17), Einschränkung der Verarbeitung (Art. 18), Datenübertragbarkeit
(Art. 20) und Widerspruch (Art. 21 DSGVO). Außerdem können Sie sich bei einer
Aufsichtsbehörde beschweren — zuständig ist für uns das Unabhängige
Landeszentrum für Datenschutz Schleswig-Holstein.

## 8. Änderungen

Wir passen diese Erklärung an, wenn sich die Verarbeitung ändert. Es gilt die
jeweils hier veröffentlichte Fassung.
MD;
    }

    /**
     * The English placeholder for a document that only exists in German.
     *
     * Deliberately NOT a translation. Two sets of terms in two languages are
     * two things that can disagree, and the shop sells to Germany only — so the
     * honest English page says which text governs and links to it, rather than
     * offering a second version somebody might rely on.
     */
    private static function foreignNoticeEn(string $title, string $anchor): string
    {
        return <<<MD
> **Draft — not reviewed.** This text is a starting point and has **not** been
> checked by a lawyer. Review before publishing and remove this notice.

# {$title}

TDShop sells its own digital services **to customers in Germany only**, and the
contract is governed by German law.

The binding version of this document is therefore the German one. We do not
publish a second English version, because two sets of terms in two languages
are two things that can disagree — and only one of them would be the one you
actually agreed to.

Please refer to the German text: **{$anchor}**.

If anything is unclear, write to kontakt@tracht-digital.de and we will explain
it in English.
MD;
    }
}
