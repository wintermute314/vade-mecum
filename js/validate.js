// Controle van een reisbestand. Werkt in de browser én in Node (tools/validate.mjs).
// Geeft { errors: [...], warnings: [...] }. Fouten blokkeren de import, waarschuwingen niet.

export function typeRegistry(schema) {
  const entityTypes = {}, relationTypes = {};
  for (const [modId, mod] of Object.entries(schema.modules)) {
    for (const [k, v] of Object.entries(mod.entityTypes || {})) entityTypes[k] = { ...v, module: modId };
    for (const [k, v] of Object.entries(mod.relationTypes || {})) relationTypes[k] = { ...v, module: modId };
  }
  return { entityTypes, relationTypes };
}

const ISO = /^-?\d{1,4}(-\d{2}(-\d{2}(T\d{2}:\d{2}(:\d{2})?)?)?)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateTrip(data, schema) {
  const errors = [], warnings = [];
  const err = (m) => errors.push(m), warn = (m) => warnings.push(m);
  if (!data || typeof data !== 'object') { err('Het bestand is geen JSON-object.'); return { errors, warnings }; }
  if (data.format !== 'reisdb') err('Veld "format" moet "reisdb" zijn.');
  const [maj, min] = String(data.schemaVersion || '').split('.').map(Number);
  const [appMaj, appMin] = schema.schemaVersion.split('.').map(Number);
  if (!Number.isInteger(maj)) err('Veld "schemaVersion" ontbreekt of is ongeldig.');
  else if (maj > appMaj) err(`Schemaversie ${data.schemaVersion} is nieuwer dan deze app (${schema.schemaVersion}). Werk de app bij.`);
  else if (maj === appMaj && min > appMin) warn(`Schemaversie ${data.schemaVersion} is nieuwer dan deze app (${schema.schemaVersion}); onbekende onderdelen worden algemeen getoond.`);

  const t = data.trip || {};
  if (!data.trip) err('Veld "trip" ontbreekt.');
  else {
    if (!t.id || !/^[a-z0-9][a-z0-9-]*$/.test(t.id)) err('trip.id ontbreekt of bevat andere tekens dan a-z, 0-9 en -.');
    if (!t.title) err('trip.title ontbreekt.');
    if (!DATE.test(t.start || '')) err('trip.start moet een datum JJJJ-MM-DD zijn.');
    if (!DATE.test(t.end || '')) err('trip.end moet een datum JJJJ-MM-DD zijn.');
    if (t.start && t.end && t.start > t.end) err('trip.start ligt na trip.end.');
  }

  const known = Object.keys(schema.modules);
  for (const m of data.modules || []) if (!known.includes(m)) warn(`Module "${m}" kent deze app nog niet.`);

  const { entityTypes, relationTypes } = typeRegistry(schema);
  const ids = new Set();
  const attIds = new Set((data.attachments || []).map(a => a.id));
  if (!Array.isArray(data.entities)) err('Veld "entities" moet een lijst zijn.');
  for (const [i, e] of (data.entities || []).entries()) {
    const where = e && e.id ? `Entiteit "${e.id}"` : `Entiteit #${i + 1}`;
    if (!e || typeof e !== 'object') { err(`${where} is geen object.`); continue; }
    if (!e.id) err(`${where}: id ontbreekt.`);
    else if (ids.has(e.id)) err(`${where}: id komt meer dan één keer voor.`);
    else ids.add(e.id);
    if (!e.name) err(`${where}: name ontbreekt.`);
    if (!e.type) err(`${where}: type ontbreekt.`);
    else if (!entityTypes[e.type]) warn(`${where}: onbekend type "${e.type}".`);
    if (e.when) for (const k of ['start', 'end']) if (e.when[k] != null && !ISO.test(String(e.when[k]))) err(`${where}: when.${k} "${e.when[k]}" is geen ISO-datum of jaartal.`);
    if (e.type === 'dag') {
      if (!e.when || !DATE.test(e.when.start || '')) err(`${where}: een dag heeft when.start als JJJJ-MM-DD nodig.`);
      else if (t.start && t.end && (e.when.start < t.start || e.when.start > t.end)) warn(`${where}: datum ${e.when.start} valt buiten de reis.`);
    }
    if (e.geo && (typeof e.geo.lat !== 'number' || typeof e.geo.lng !== 'number')) err(`${where}: geo heeft numerieke lat en lng nodig.`);
    if (e.priority != null && ![1, 2, 3].includes(e.priority)) err(`${where}: priority moet 1, 2 of 3 zijn.`);
    for (const c of e.codes || []) if (!c || !c.value) err(`${where}: elke code heeft een value nodig.`);
    for (const a of e.attachments || []) if (!attIds.has(a)) err(`${where}: bijlage "${a}" bestaat niet.`);
    if (e.image && !attIds.has(e.image)) err(`${where}: afbeelding "${e.image}" bestaat niet.`);
    for (const m of String(e.text || '').matchAll(/\[\[([^\]|]+)(\|[^\]]*)?\]\]/g)) {
      if (!(data.entities || []).some(x => x && x.id === m[1].trim())) warn(`${where}: link [[${m[1]}]] verwijst naar een onbekende id.`);
    }
  }
  for (const [i, r] of (data.relations || []).entries()) {
    const where = `Relatie #${i + 1} (${r && r.from} → ${r && r.type} → ${r && r.to})`;
    if (!r || !r.from || !r.to || !r.type) { err(`${where}: from, type en to zijn verplicht.`); continue; }
    if (!ids.has(r.from)) err(`${where}: "${r.from}" bestaat niet.`);
    if (!ids.has(r.to)) err(`${where}: "${r.to}" bestaat niet.`);
    if (!relationTypes[r.type]) warn(`${where}: onbekend relatietype "${r.type}".`);
  }
  const seenAtt = new Set();
  for (const a of data.attachments || []) {
    if (!a.id || seenAtt.has(a.id)) err(`Bijlage "${a.id}": id ontbreekt of is dubbel.`);
    seenAtt.add(a.id);
    if (!a.mime || !a.data) err(`Bijlage "${a.id}": mime en data zijn verplicht.`);
  }
  return { errors, warnings };
}
