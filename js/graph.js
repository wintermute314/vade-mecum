// De reis als graph in het geheugen: knopen (entiteiten), pijlen (relaties), zoekindex en naamherkenning.
import { typeRegistry } from './validate.js';

export const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "1308" → 1308, "-44" → -44, "2027-04-12T09:30" → 2027
export const yearOf = (iso) => { const m = /^(-?\d{1,4})/.exec(String(iso ?? '')); return m ? parseInt(m[1], 10) : null; };
export const dateOf = (iso) => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(iso ?? '')); return m ? m[1] : null; };
export const timeOf = (iso) => { const m = /T(\d{2}:\d{2})/.exec(String(iso ?? '')); return m ? m[1] : null; };

export class Graph {
  constructor(data, schema) {
    this.data = data;
    this.trip = data.trip;
    this.schema = schema;
    const reg = typeRegistry(schema);
    this.entityTypes = reg.entityTypes;
    this.relationTypes = reg.relationTypes;
    this.byId = new Map();
    this.out = new Map(); this.inc = new Map();
    this.mentions = new Map(); // id → Set van entiteiten waarvan de tekst deze id vermeldt
    for (const e of data.entities) { this.byId.set(e.id, e); this.out.set(e.id, []); this.inc.set(e.id, []); }
    for (const r of data.relations || []) {
      if (!this.byId.has(r.from) || !this.byId.has(r.to)) continue;
      this.out.get(r.from).push(r); this.inc.get(r.to).push(r);
    }
    this.attachments = new Map((data.attachments || []).map(a => [a.id, a]));
    this.buildLinker();
    this.buildSearch();
  }

  get entities() { return this.data.entities; }
  get(id) { return this.byId.get(id); }
  ofType(...types) { return this.entities.filter(e => types.includes(e.type)); }
  typeDef(type) { return this.entityTypes[type] || { label: type, plural: type, icon: '•', group: 'gids' }; }
  isLocationLike(e) { const d = this.typeDef(e.type); return e.type === 'locatie' || d.extends === 'locatie' || e.type === 'plaats'; }

  // Alle buren, gegroepeerd per leesrichting-label. Geeft [{label, items:[{entity, rel, dir}]}].
  neighbours(id) {
    const groups = new Map();
    const add = (label, entity, rel, dir) => {
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push({ entity, rel, dir });
    };
    for (const r of this.out.get(id) || []) {
      const def = this.relationTypes[r.type];
      add(def ? def.label : r.type, this.get(r.to), r, 'out');
    }
    for (const r of this.inc.get(id) || []) {
      const def = this.relationTypes[r.type];
      add(def ? (def.inverse || def.label) : r.type + ' (omgekeerd)', this.get(r.from), r, 'in');
    }
    return [...groups].map(([label, items]) => ({ label, items }));
  }
  related(id, relType, dir = 'out') {
    const list = dir === 'out' ? this.out.get(id) : this.inc.get(id);
    return (list || []).filter(r => r.type === relType).map(r => ({ entity: this.get(dir === 'out' ? r.to : r.from), rel: r }));
  }
  // Transitief "ligt in": alle plaatsen waarin iets (onrechtstreeks) ligt.
  containers(id, seen = new Set()) {
    for (const { entity } of this.related(id, 'ligt-in')) if (!seen.has(entity.id)) { seen.add(entity.id); this.containers(entity.id, seen); }
    for (const { entity } of this.related(id, 'hangt-in')) if (!seen.has(entity.id)) { seen.add(entity.id); this.containers(entity.id, seen); }
    return seen;
  }

  // Jaren-bereik van een entiteit, eventueel afgeleid van periode/stroming waartoe ze behoort.
  yearRange(e) {
    if (e.when && yearOf(e.when.start) != null) {
      const a = yearOf(e.when.start), b = yearOf(e.when.end) ?? a;
      return [a, b];
    }
    return null;
  }

  // Dagen en hun programma
  days() { return this.ofType('dag').filter(d => dateOf(d.when?.start)).sort((a, b) => a.when.start.localeCompare(b.when.start)); }
  dayFor(date) { return this.days().find(d => d.when.start === date) || null; }
  program(day) {
    const items = this.related(day.id, 'gepland-op', 'in').map(({ entity, rel }) => ({ entity, rel, tijd: rel.attrs?.tijd || '', volgorde: rel.attrs?.volgorde ?? 999 }));
    const date = day.when.start, seen = new Set(items.map(i => i.entity.id));
    for (const e of this.entities) {
      if (e.type === 'dag' || seen.has(e.id)) continue;
      if (dateOf(e.when?.start) === date && (e.type === 'boeking' || timeOf(e.when.start))) items.push({ entity: e, rel: null, tijd: timeOf(e.when.start) || '', volgorde: 500 });
    }
    return items.sort((a, b) => (a.tijd && b.tijd ? a.tijd.localeCompare(b.tijd) : 0) || (a.tijd ? -1 : b.tijd ? 1 : 0) || a.volgorde - b.volgorde);
  }
  stayFor(day) {
    const r = this.related(day.id, 'overnachting');
    if (r.length) return r[0].entity;
    return null;
  }
  daysOf(id) { return this.related(id, 'gepland-op').map(x => x.entity).filter(d => d.type === 'dag'); }

  // --- naamherkenning ---
  buildLinker() {
    const names = [];
    for (const e of this.entities) {
      for (const n of [e.name, ...(e.aliases || [])]) if (n && n.trim().length >= 3) names.push([n.trim(), e.id]);
    }
    // Dubbele namen (zelfde tekst, andere id) niet automatisch linken: te dubbelzinnig.
    const owners = new Map();
    for (const [n, id] of names) { if (!owners.has(n)) owners.set(n, new Set()); owners.get(n).add(id); }
    this.nameToId = new Map();
    for (const [n, ids] of owners) if (ids.size === 1) this.nameToId.set(n, [...ids][0]);
    const sorted = [...this.nameToId.keys()].sort((a, b) => b.length - a.length);
    this.nameRe = sorted.length ? new RegExp('(?<![\\p{L}\\p{N}])(' + sorted.map(escRe).join('|') + ')(?![\\p{L}\\p{N}])', 'gu') : null;
    // vermeldingen voor "vermeld in"
    for (const e of this.entities) {
      const t = e.text || '';
      for (const m of t.matchAll(/\[\[([^\]|]+)/g)) this.addMention(m[1].trim(), e.id);
      if (this.nameRe) for (const m of t.matchAll(this.nameRe)) this.addMention(this.nameToId.get(m[1]), e.id);
    }
  }
  addMention(target, source) {
    if (!target || target === source || !this.byId.has(target)) return;
    if (!this.mentions.has(target)) this.mentions.set(target, new Set());
    this.mentions.get(target).add(source);
  }

  // --- zoeken ---
  buildSearch() {
    this.index = this.entities.map(e => {
      const attrs = Object.entries(e.attrs || {}).filter(([k]) => !(e.sensitive || []).includes(k)).map(([, v]) => v).join(' ');
      return {
        e,
        name: fold([e.name, ...(e.aliases || [])].join(' | ')),
        body: fold([e.summary, e.why, e.text, attrs, (e.tags || []).join(' '), e.address, this.typeDef(e.type).label].join(' ')),
      };
    });
  }
  search(q) {
    const terms = fold(q).split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const res = [];
    for (const it of this.index) {
      let score = 0, ok = true;
      for (const t of terms) {
        const inName = it.name.indexOf(t), inBody = it.body.indexOf(t);
        if (inName < 0 && inBody < 0) { ok = false; break; }
        if (inName >= 0) score += (inName === 0 || /[\s|(-]/.test(it.name[inName - 1]) ? 10 : 6);
        if (inBody >= 0) score += 1;
      }
      if (ok) res.push({ e: it.e, score: score + (fold(it.e.name) === fold(q) ? 20 : 0) });
    }
    return res.sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name)).map(r => r.e);
  }
  snippet(e, q) {
    const terms = fold(q).split(/\s+/).filter(Boolean);
    const text = (e.text || '').replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, (_, id) => this.get(id.trim())?.name || id).replace(/[*#]/g, '');
    const f = fold(text);
    for (const t of terms) {
      const i = f.indexOf(t);
      if (i >= 0) { const a = Math.max(0, i - 40); return (a ? '…' : '') + text.slice(a, i + t.length + 60).replace(/\s+/g, ' ') + '…'; }
    }
    return e.summary || '';
  }
}
