#!/usr/bin/env node
// Gebruik: node tools/validate.mjs pad/naar/reis.reis.json
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateTrip } from '../js/validate.js';

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(join(here, '..', 'schema', 'schema.json'), 'utf8'));
const file = process.argv[2];
if (!file) { console.error('Gebruik: node tools/validate.mjs <reisbestand.json>'); process.exit(2); }
let data;
try { data = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { console.error('Geen geldige JSON: ' + e.message); process.exit(1); }
const { errors, warnings } = validateTrip(data, schema);
for (const w of warnings) console.log('waarschuwing: ' + w);
for (const e of errors) console.log('FOUT: ' + e);
console.log(`${(data.entities || []).length} entiteiten, ${(data.relations || []).length} relaties, ${(data.attachments || []).length} bijlagen. ${errors.length} fouten, ${warnings.length} waarschuwingen.`);
process.exit(errors.length ? 1 : 0);
