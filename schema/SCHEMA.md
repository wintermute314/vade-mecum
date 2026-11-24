# Reisdatabase (reisdb) — schema 1.1

Eén reis = één JSON-bestand (`*.reis.json`). De app leest het in, bewaart het lokaal op de telefoon en bouwt er een graph van: **entiteiten** (knopen) en **relaties** (pijlen). Dit document is de bron voor wie (of welke skill) een reisbestand maakt. De machineleesbare versie staat in [`schema.json`](schema.json), de structuurcontrole in [`reisdb.schema.json`](reisdb.schema.json).

## Bestand in één oogopslag

```json
{
  "format": "reisdb",
  "schemaVersion": "1.1",
  "modules": ["kern", "cultuur"],
  "trip": { "id": "siena-2027", "title": "Siena", "start": "2027-04-12", "end": "2027-04-14" },
  "entities": [ { "id": "duccio", "type": "persoon", "name": "Duccio di Buoninsegna" } ],
  "relations": [ { "from": "duccio", "type": "maakte", "to": "maesta-duccio" } ],
  "attachments": [ { "id": "pdf-appartement", "title": "Bevestiging", "mime": "application/pdf", "data": "<base64>" } ]
}
```

## `trip`

| veld | verplicht | betekenis |
|---|---|---|
| `id` | ja | vaste sleutel (kleine letters, cijfers, `-`). Opnieuw importeren met dezelfde id vervangt de reis. |
| `title` | ja | naam van de reis |
| `subtitle` | nee | korte ondertitel |
| `start`, `end` | ja | eerste en laatste dag, `JJJJ-MM-DD` |
| `timezone` | nee | bv. `Europe/Rome` (informatief) |
| `intro` | nee | tekst voor het startscherm (zelfde opmaak als `text`) |

## Entiteit

| veld | verplicht | betekenis |
|---|---|---|
| `id` | ja | uniek en stabiel, bv. `duccio`, `maesta-duccio`. Relaties en links verwijzen hiernaar. |
| `type` | ja | een entiteitstype uit een module (zie onder) |
| `name` | ja | weergavenaam |
| `aliases` | nee | andere namen waaronder ze gezocht en herkend wordt, bv. `["Duccio"]` |
| `summary` | nee | één regel, getoond in lijsten |
| `text` | nee | uitleg, met lichte opmaak (zie onder) |
| `attrs` | nee | kenmerken als `{ "sleutel": "waarde" }`. Bekende sleutels per type staan in `schema.json`; andere sleutels mogen en worden gewoon getoond. |
| `when` | nee | `{ "start": "...", "end": "..." }` in ISO-vorm, zo precies als je weet: `"1308"`, `"1504-01"`, `"2027-04-12"`, `"2027-04-12T09:30"`. Voor een dag: de datum. Voor een werk: datering. Voor een boeking: vertrek en aankomst. |
| `circa` | nee | `true` als de datering bij benadering is |
| `geo` | nee | `{ "lat": 43.31, "lng": 11.33 }` |
| `address` | nee | adres als tekst |
| `maps` | nee | Google Maps-link. Ontbreekt die, dan maakt de app er een uit `geo`, of uit naam + adres. |
| `tags` | nee | vrije trefwoorden, doorzoekbaar |
| `attachments` | nee | lijst bijlage-id's die bij deze entiteit horen |
| `image` | nee | foto bovenaan de fiche: de id van een bijlage (afbeelding), of sinds 1.1 een foto van het web als object (zie **Foto's** hieronder) |
| `why` | nee | **waarom** dit in de reis zit: waarom je dit werk wil zien, waarom dit restaurant. Komt in een opvallend kader op de fiche en bij elk werk in de lijst "Te zien" van een museum. |
| `priority` | nee | `1` = moet je zien, `2` = graag, `3` = als er tijd is. Sorteert "Te zien" en het startscherm. |
| `codes` | nee | lijst `{ "label": "Toegangsticket", "value": "…", "format": "qr" }`. De app tekent de QR-code zelf (offline) en toont hem schermvullend om aan een balie te scannen. `format` is `qr` (standaard) of `tekst`. Heb je enkel een afbeelding van de QR, zet die dan als bijlage. |
| `sensitive` | nee | lijst attribuutsleutels die de app maskeert tot je erop tikt, bv. `["referentie"]` |

### Tekstopmaak in `text` en `intro`

- Lege regel = nieuwe alinea. `## Kop` voor een tussenkop. Regels die met `- ` beginnen vormen een lijst.
- `**vet**` en `*cursief*`.
- `[[id]]` of `[[id|eigen tekst]]` is een expliciete link naar een entiteit.
- **Namen worden automatisch link.** Komt de `name` of een `alias` van een andere entiteit letterlijk voor, dan wordt de eerste vermelding per alinea klikbaar. Expliciete links zijn alleen nodig bij twijfel (bv. twee werken met dezelfde naam).
- Een kale `https://...` wordt een gewone link.

## Foto's (sinds 1.1)

Een kunstwerk, gebouw of kunstenaar herken je sneller met een foto. Daarvoor zet je in `image` een object met de link naar een vrije foto, meestal van Wikimedia Commons. De foto zelf zit niet in het bestand: de app haalt hem op na het importeren en bewaart hem op de gsm, zodat hij ook offline te zien is.

```json
"image": {
  "url": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Voorbeeld.jpg/960px-Voorbeeld.jpg",
  "file": "Voorbeeld.jpg",
  "page": "https://commons.wikimedia.org/wiki/File:Voorbeeld.jpg",
  "author": "Naam van de fotograaf",
  "license": "CC BY-SA 4.0",
  "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
  "source": "Wikimedia Commons",
  "caption": "Gevel aan de Piazza del Duomo"
}
```

| veld | verplicht | betekenis |
|---|---|---|
| `url` | ja | rechtstreekse `https://`-link naar de afbeelding. Gebruik een verkleinde versie van **960 px** breed (een standaardmaat van Wikimedia). Is het origineel smaller, neem dan het origineel. |
| `file` | nee | bestandsnaam op Wikimedia Commons, zonder `File:`. Lukt `url` niet, dan probeert de app het via die naam. |
| `page` | nee | pagina van de foto (licentie en details); de bronvermelding linkt ernaar |
| `author` | nee* | maker van de foto, zoals de bron die vermeldt |
| `license` | nee* | korte licentienaam: `CC BY-SA 4.0`, `CC BY 2.0`, `Publiek domein`, ... |
| `licenseUrl` | nee | link naar de licentietekst |
| `source` | nee | bv. `Wikimedia Commons` |
| `caption` | nee | korte beschrijving onder de foto |

\* Vrije licenties vragen een naamsvermelding. De app toont `author`, `license` en `source` onder de foto; zonder `author` of `license` geeft de controle een waarschuwing.

Welke foto kies je?

- **Werk**: een vooraanzicht van het hele werk, zonder lijst of museumzaal.
- **Gebouw, museum, plein**: de gevel of het geheel **vanaf straatniveau**, zoals je het ziet als je ernaartoe wandelt. Geen luchtfoto, geen interieur.
- **Persoon**: voor kunstenaars en historische figuren een portret of zelfportret. Voor mensen van de reis zelf (gids, gastheer, reisgenoot) geen foto van het web; die kun je in de app zelf toevoegen.
- Liever geen foto dan een foto van iets anders (een detail, een ander werk met dezelfde naam).

**Eigen foto's.** Op elke fiche kun je onder "Mijn notities" zelf een foto toevoegen (camera of galerij). Die staat enkel op de gsm, los van het reisbestand, en blijft bewaard als je de reis opnieuw importeert. Een eigen foto komt in de plaats van de foto uit het bestand.

## Relatie

```json
{ "from": "maesta-duccio", "type": "hangt-in", "to": "museo-opera", "attrs": { "zaal": "Sala di Duccio" }, "note": "sinds 1878" }
```

Een relatie heeft een richting en twee leesrichtingen: op de fiche van *from* staat het `label` ("hangt in"), op de fiche van *to* het `inverse`-label ("collectie"). Je schrijft elke relatie dus maar één keer. Symmetrische relaties (`zie-ook`, `familie-van`, `dichtbij`) lezen in beide richtingen hetzelfde.

Het dagprogramma is gewoon een relatie `gepland-op` naar een `dag`, met `attrs.tijd` (bv. `"10:00"`) en/of `attrs.volgorde`. Een boeking met een datum in `when.start` verschijnt ook vanzelf op die dag.

## Bijlage

| veld | verplicht | betekenis |
|---|---|---|
| `id` | ja | uniek |
| `title` | ja | bv. "Vlucht heen – boardingpass" |
| `mime` | ja | `application/pdf`, `image/jpeg`, `image/png`, ... |
| `filename` | nee | bestandsnaam bij openen/downloaden |
| `data` | ja | inhoud als base64 (zonder `data:`-voorvoegsel) |

Bijlagen staan in het bestand zelf, zodat één import alles meeneemt. Een entiteit verwijst ernaar via `attachments`; bijlagen zonder verwijzing verschijnen onder Praktisch › Documenten.

## Modules en types

### Kern (altijd aanwezig)

| type | waarvoor | nuttige `attrs` |
|---|---|---|
| `dag` | een reisdag; `when.start` = datum | |
| `plaats` | land, stad, buurt, plein, straat | `soort` |
| `locatie` | elk ander punt: station, winkel, park, uitzicht | `soort`, `openingsuren`, `prijs`, `website` |
| `verblijf` | hotel, appartement | `inchecken`, `uitchecken`, `telefoon`, `code` |
| `boeking` | vlucht, trein, ticket, rondleiding, reservatie | `soort`, `referentie`, `status`, `van`, `naar` |
| `restaurant` | eten en drinken | `keuken`, `prijsklasse`, `reserveren` |
| `persoon` | iedereen: kunstenaar, opdrachtgever, contactpersoon | `rol`, `telefoon`, `email` |
| `notitie` | losse praktische info (paklijst, tips) | |

Relaties: `ligt-in`, `gepland-op`, `overnachting` (dag → verblijf), `hoort-bij` (boeking → wat dan ook), `contact-van`, `familie-van`, `dichtbij`, `zie-ook`.

### Cultuur

| type | waarvoor |
|---|---|
| `werk` | schilderij, fresco, beeld, boek, ... |
| `gebouw` | kerk, palazzo, toren, fontein (gedraagt zich als `locatie`) |
| `museum` | museum of collectie (gedraagt zich als `locatie`) |
| `stroming` | stroming, school, stijl of idee (`attrs.soort`) |
| `periode` | tijdvak met `when.start` en `when.end`; voedt de tijdlijnfilter |
| `gebeurtenis` | bv. een pestepidemie, een verkiezing, een brand |

Relaties: `maakte` (persoon → werk/gebouw, `attrs.rol`), `opdrachtgever-van`, `hangt-in` (werk → museum/gebouw), `leerling-van`, `beinvloed-door`, `illustreert` (werk → idee/stroming), `behoort-tot` (→ stroming/periode), `beeldt-af`, `tijdens` (gebeurtenis → periode), `werkte-in`.

### Route (gepland, nog niet in 1.1)

Voor bv. een fietstocht: types `etappe` en `track` (GPX als bijlage), relaties `start-in`, `eindigt-in`, `volgt-op`, en een kaart- en hoogteprofielweergave. Komt als schema 1.2.

## Versies en compatibiliteit

- `schemaVersion` is `MAJOR.MINOR`. Een **minor**-versie (1.0 → 1.1) voegt alleen dingen toe: nieuwe modules, types, relaties of optionele velden. Elk 1.x-bestand blijft dus werken in elke nieuwere 1.y-app.
- De app is ook **vooruit tolerant**: onbekende velden blijven bewaard, een onbekend type krijgt een algemene fiche, een onbekende relatie wordt met haar id als label getoond. Een nieuw bestand op een oudere app geeft dus een waarschuwing, geen fout.
- Een **major**-versie (2.0) mag iets hernoemen of herstructureren, maar alleen samen met een migratie in de app (`js/migrate.js`) die oudere bestanden bij het importeren omzet.
- `modules` somt op welke modules het bestand gebruikt. `kern` is altijd impliciet aanwezig.

## Hoe de app dit toont

- **Start**: de reisdag van vandaag (of de eerstvolgende) als compact overzicht, snelknoppen, het verblijf en alle musea en gebouwen (★ = `priority: 1`).
- **Fiche**: bovenaan de kerngegevens die de app uit velden én relaties samenstelt (maker, datering, te zien in + zaal, ligt in, opdrachtgever, stroming), dan "Waarom?", codes, documenten, en bij een museum of gebouw de lijst **Te zien** met per werk maker, datering, zaal en waarom.
- **Verblijf of boeking**: alle kenmerken, gemaskeerde referenties, QR-codes en de PDF-bevestigingen.

## Voor wie een reisbestand maakt (bv. een skill)

1. Lees `schema.json` voor de toegelaten types, relaties en bekende `attrs`; dit document voor de betekenis.
2. Kies stabiele, leesbare id's (`kleine-letters-met-streepjes`), zodat een nieuwe versie van hetzelfde bestand de oude netjes vervangt.
3. Schrijf elke relatie één keer, in de richting van de tabel. Gebruik `name` en `aliases` zorgvuldig: daarop steunt de automatische linking in teksten.
4. Zet de reden van opname in `why` en de belangrijkheid in `priority`.
5. Voeg PDF's en afbeeldingen toe als `attachments` (base64) en verwijs ernaar vanuit de juiste entiteit.
6. Geef werken, gebouwen, musea en kunstenaars waar mogelijk een foto van het web in `image` (zie **Foto's**), met maker en licentie.
7. Controleer met `node tools/validate.mjs`. Fouten moeten weg; waarschuwingen mogen.

### Oude reisbestanden

Een reisbestand moet je nooit opnieuw laten maken omdat de app veranderd is:

- **Een app-update** (nieuwe schermen, grotere letters, ...) raakt de reizen op de gsm niet. Ze blijven gewoon staan.
- **Een schema-uitbreiding** (1.0 → 1.1, zoals de foto's) is achterwaarts compatibel: oude bestanden laden zoals ze zijn.
- **Een schemawijziging** (1.x → 2.0) komt altijd samen met een migratie in `js/migrate.js`. Die zet oude bestanden om bij het importeren, en ook de reizen die al op de gsm staan. Migraties vormen een keten (1→2→3) en worden nooit verwijderd. `tools/test-migrate.mjs` test dat.
- Een bestand zonder `schemaVersion` wordt als 1.0 gelezen.
- Bewaar het originele `.reis.json` (bv. in Drive): dat is je archief, en het blijft altijd importeerbaar.

## Controle

- De app controleert bij import: unieke id's, bestaande relatie-uiteinden, bekende types en relaties (anders een waarschuwing), datums van dagen.
- Vanaf de opdrachtregel: `node tools/validate.mjs mijnreis.reis.json` (zelfde regels, ook bruikbaar door een skill).

## Privacy

Foto's van het web worden opgehaald bij hun bron (bv. upload.wikimedia.org); verder praat de app met geen enkele server. Het reisbestand kan boekingsnummers en documenten bevatten. Het wordt niet in de repository gezet en niet online geplaatst; de app bewaart het enkel in de browseropslag van de telefoon. Zet gevoelige sleutels in `sensitive`, dan worden ze gemaskeerd tot je erop tikt.
