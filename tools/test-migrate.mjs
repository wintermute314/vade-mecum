// Test: oude bestanden laden via de migratieketen. Gebruik: node tools/test-migrate.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { migrate } from '../js/migrate.js';
import { validateTrip } from '../js/validate.js';

const schema = JSON.parse(readFileSync(new URL('../schema/schema.json', import.meta.url)));
const sample = JSON.parse(readFileSync(new URL('../voorbeeld/voorbeeldreis.reis.json', import.meta.url)));

// 1. Huidig bestand: niets te doen.
let r = migrate(sample, 1);
assert.equal(r.changed, false);
assert.equal(validateTrip(r.data, schema).errors.length, 0);

// 2. Bestand zonder schemaVersion wordt als 1.0 gelezen.
const { schemaVersion, ...noVersion } = sample;
r = migrate(noVersion, 1);
assert.equal(r.data.schemaVersion, '1.0');
assert.equal(validateTrip(r.data, schema).errors.length, 0);

// 3. Keten 1 → 2 → 3 met een fictieve migratietabel.
const table = {
  1: (d) => { for (const e of d.entities) if (e.type === 'locatie') e.type = 'plek'; d.schemaVersion = '2.0'; return d; },
  2: (d) => { d.trip.titel = d.trip.title; d.schemaVersion = '3.0'; return d; },
};
r = migrate(sample, 3, table);
assert.equal(r.changed, true);
assert.equal(r.from, '1.0');
assert.equal(r.data.schemaVersion, '3.0');
assert.equal(r.data.migratedFrom, '1.0');
assert.equal(r.data.trip.titel, sample.trip.title);
assert.equal(sample.schemaVersion, '1.0', 'origineel blijft ongewijzigd');

// 4. Een minor-versie (1.3) migreert niet en laadt in een 1.0-app met hooguit een waarschuwing.
r = migrate({ ...sample, schemaVersion: '1.3' }, 1);
assert.equal(r.changed, false);
const v = validateTrip(r.data, schema);
assert.equal(v.errors.length, 0);
assert.ok(v.warnings.some(w => w.includes('nieuwer')));

console.log('migratietests: alles ok');
