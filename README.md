# Vade Mecum

Vade Mecum is een persoonlijke reisgids voor de gsm (Android, Chrome). Per reis laad je één databestand in; de app toont dagschema, fiches, gids, documenten en codes, volledig offline. Het raamwerk bevat geen persoonlijke gegevens en kan publiek online staan (bv. GitHub Pages). Reisbestanden blijven op de telefoon.

## Gebruiken

1. Open de app-URL in Chrome op de gsm en kies **Toevoegen aan startscherm**.
2. Tik op de reisnaam bovenaan › **Reis importeren** en kies het `.reis.json`-bestand (bv. uit Drive).
3. Daarna werkt alles offline. Opnieuw importeren met dezelfde `trip.id` vervangt de reis.

Schermen: **Start** (vandaag + snel naar musea, verblijf, boekingen), **Dagen** (schema, veeg tussen dagen), **Gids** (alle fiches met filters op type, periode, plaats en dag, plus een tijdlijn), **Praktisch** (verblijf, boekingen, documenten, contacten), en zoeken over alle tekst.

## Architectuur

```
index.html              app-schil, tabbalk, overlays
css/app.css             mobiele opmaak, licht en donker
js/app.js               routes (#/start, #/dag/…, #/e/…, #/gids, #/zoek, #/reizen) en schermen
js/graph.js             de reis als graph in het geheugen: knopen, relaties in beide richtingen, zoekindex, naamherkenning
js/text.js              tekstopmaak met [[id]]-links en automatische naamlinks
js/db.js                IndexedDB: reizen, bijlagen, notities en foto's (Blob), lokaal op het toestel
js/validate.js          controle van een reisbestand (browser én Node)
js/migrate.js           migraties bij een toekomstige major-versie van het schema
sw.js                   service worker: app offline
vendor/qrcode.js        QR-codes tekenen (qrcode-generator, MIT, Kazuhiko Arase)
schema/                 schemabeschrijving: SCHEMA.md (mens), schema.json (machine), reisdb.schema.json (JSON Schema)
voorbeeld/              fictieve voorbeeldreis (Siena), zonder persoonlijke gegevens
tools/validate.mjs      `node tools/validate.mjs reis.reis.json`
```

Geen build-stap en geen frameworks: de bestanden zoals ze zijn, zijn de app. Dat houdt GitHub Pages en een latere Capacitor-verpakking eenvoudig (de map is dan de `webDir`).

### Waarom geen bestaande database-tool

Het datamodel is een graph, maar er is geen graph-database nodig. Een reis heeft enkele honderden knopen; die passen ruim in het geheugen, en `js/graph.js` bouwt bij het openen de index (relaties in beide richtingen, zoekindex, namen) in enkele milliseconden. Een echte graph-database (Neo4j e.d.) vraagt een server, en dat botst met "offline en gegevens enkel op de telefoon".

- **Opslag**: rechtstreeks IndexedDB met twee stores. Dexie zou de code wat korter maken, maar voor twee stores weegt een extra afhankelijkheid niet op. Wordt de opslag complexer (bv. eigen notities tijdens de reis), dan is Dexie de logische stap.
- **Zoeken**: een eigen index, ongevoelig voor accenten en hoofdletters, met voorrang voor treffers in namen. MiniSearch voegt vooral tikfout-tolerantie toe; als dat onderweg mist, kan het zonder schemawijziging worden ingeplugd in `Graph.search`.

## Schema en versies

Zie [schema/SCHEMA.md](schema/SCHEMA.md). Kort: `schemaVersion` 1.x is altijd achterwaarts compatibel; een nieuwe module (zoals Route) komt erbij als 1.2. Schema 1.1 voegde foto's van het web toe (zie "Foto's" in SCHEMA.md). De app toont onbekende types en relaties algemeen in plaats van te weigeren.

## Lokaal draaien

```
python3 -m http.server 8000     # en open http://localhost:8000
```

Een service worker werkt alleen via `http://localhost` of `https://`. Bij een nieuwe versie: verhoog `CACHE` in `sw.js` (en `APP_VERSION` in `js/app.js`).
