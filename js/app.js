// Vade Mecum — raamwerk. Hash-routes, geen build-stap, geen externe afhankelijkheden.
import * as db from './db.js';
import { Graph, fold, yearOf, dateOf, timeOf } from './graph.js';
import { renderText, inline, esc } from './text.js';
import { validateTrip } from './validate.js';
import { migrate } from './migrate.js';

export const APP_VERSION = '0.3.0';
const LS_ACTIVE = 'reisapp.active', LS_TODAY = 'reisapp.today', LS_SIZE = 'reisapp.size';
let installPrompt = null;
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
window.addEventListener('beforeinstallprompt', (ev) => { ev.preventDefault(); installPrompt = ev; if (/start|reizen|^$/.test(parseHash().name)) render(); });
window.addEventListener('appinstalled', () => { installPrompt = null; toast('Vade Mecum staat op je startscherm.'); render(); });
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

let schema = null, graph = null;
let notes = new Map();   // entityId → notitie van de actieve reis
const $main = document.getElementById('main');
const $title = document.getElementById('trip-title');
const scrollMem = new Map();

// ---------- hulpfuncties ----------
const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const MONTHS_LONG = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
const DAYS = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
const parseDate = (d) => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd); };
const isoLocal = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
const longDate = (d) => { const x = parseDate(d); return `${DAYS[x.getDay()]} ${x.getDate()} ${MONTHS_LONG[x.getMonth()]}`; };
const shortDate = (d) => { const x = parseDate(d); return `${DAYS[x.getDay()].slice(0, 2)} ${x.getDate()} ${MONTHS[x.getMonth()]}`; };
const today = () => ls.get(LS_TODAY) || isoLocal(new Date());
const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);

function fmtIso(iso) {
  if (iso == null) return '';
  const s = String(iso);
  if (/^-?\d{1,4}$/.test(s)) { const y = +s; return y < 0 ? `${-y} v.C.` : String(y); }
  if (/^\d{4}-\d{2}$/.test(s)) { const [y, m] = s.split('-'); return `${MONTHS_LONG[+m - 1]} ${y}`; }
  const d = dateOf(s), t = timeOf(s);
  if (d) { const x = parseDate(d); return `${DAYS[x.getDay()].slice(0, 2)} ${x.getDate()} ${MONTHS[x.getMonth()]} ${x.getFullYear()}${t ? ' · ' + t : ''}`; }
  return s;
}
function fmtWhen(e) {
  if (!e.when || e.when.start == null) return '';
  const c = e.circa ? 'ca. ' : '';
  const a = fmtIso(e.when.start), b = e.when.end != null ? fmtIso(e.when.end) : '';
  if (!b || a === b) return c + a;
  const da = dateOf(e.when.start), dbb = dateOf(e.when.end);
  if (da && dbb && da === dbb) return `${a} – ${timeOf(e.when.end) || ''}`;
  return `${c}${a} – ${b}`;
}
const icon = (e) => graph.typeDef(e.type).icon || '•';
function mapsUrl(e) {
  if (e.maps) return e.maps;
  if (e.geo) return `https://www.google.com/maps/search/?api=1&query=${e.geo.lat},${e.geo.lng}`;
  if (e.address) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.name + ', ' + e.address)}`;
  return null;
}
const link = (e, extra = '') => `<a class="row" href="#/e/${encodeURIComponent(e.id)}">
  <span class="ic">${icon(e)}</span>
  <span class="rt"><span class="nm">${esc(e.name)}</span>${extra || (e.summary ? `<span class="sm">${esc(e.summary)}</span>` : '')}</span>
  <span class="chev">›</span></a>`;
const section = (title, body) => body ? `<section class="sec"><h2>${esc(title)}</h2>${body}</section>` : '';
const empty = (msg) => `<p class="muted">${msg}</p>`;

function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------- routes ----------
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '') || 'start';
  const [path, qs] = h.split('?');
  const parts = path.split('/').map(decodeURIComponent);
  return { name: parts[0], arg: parts[1], q: new URLSearchParams(qs || '') };
}

async function render() {
  const r = parseHash();
  const key = location.hash;
  document.querySelectorAll('.tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === tabFor(r.name)));
  if (!graph && !['reizen'].includes(r.name)) { $main.innerHTML = viewWelcome(); bindWelcome(); return; }
  let html = '';
  switch (r.name) {
    case 'start': case 'vandaag': html = viewHome(); break;
    case 'schema': html = viewSchedule(); break;
    case 'dag': html = viewDay(r.arg); break;
    case 'gids': html = viewGuide(r.q); break;
    case 'praktisch': html = viewPractical(); break;
    case 'e': html = viewEntity(r.arg); break;
    case 'zoek': html = viewSearch(r.q.get('q') || ''); break;
    case 'reizen': html = await viewTrips(); break;
    default: html = viewHome();
  }
  $main.innerHTML = html;
  bindCommon();
  if (r.name === 'zoek') bindSearch();
  if (r.name === 'reizen') bindTrips();
  if (r.name === 'gids') bindGuide();
  window.scrollTo(0, scrollMem.get(key) || 0);
}
const tabFor = (n) => ({ start: 'start', vandaag: 'start', dag: 'schema', schema: 'schema', gids: 'gids', e: 'gids', praktisch: 'praktisch', zoek: 'zoek', reizen: '' }[n] ?? '');

// ---------- Welkom ----------
function viewWelcome() {
  return `<div class="welcome">
    <h1>Vade Mecum</h1>
    <p>Nog geen reis op dit toestel. Importeer een reisbestand (<code>.reis.json</code>), bijvoorbeeld vanuit Drive. Het bestand blijft enkel op deze telefoon.</p>
    <button class="btn primary" data-act="import">Reis importeren</button>
    <button class="btn" data-act="sample">Voorbeeldreis bekijken</button>
    ${installBox(true)}
  </div>`;
}
function bindWelcome() { bindCommon(); }

// ---------- Installeren ----------
function installBox(always) {
  if (isStandalone()) return '';
  if (installPrompt) return `<div class="install"><span class="ic">📲</span><span class="rt"><span class="nm">Zet Vade Mecum op je startscherm</span><span class="sm">Dan opent hij als een gewone app, ook offline.</span></span><button class="btn primary sm" data-act="install">Installeren</button></div>`;
  if (!always) return '';
  return `<div class="install"><span class="ic">📲</span><span class="rt"><span class="nm">Op je startscherm zetten</span><span class="sm">Tik in Chrome rechtsboven op ⋮ en kies <b>App installeren</b> of <b>Toevoegen aan startscherm</b>. Zie je dat niet, herlaad dan de pagina eenmaal en kijk opnieuw.</span></span></div>`;
}

// ---------- Start ----------
function currentDay() {
  const days = graph.days();
  if (!days.length) return { day: null, note: '' };
  const t = today(), { start, end } = graph.trip;
  let day = graph.dayFor(t), note = '';
  if (!day) {
    if (t < start) { day = days[0]; const n = daysBetween(t, start); note = `Nog ${n} ${n === 1 ? 'dag' : 'dagen'} tot vertrek`; }
    else if (t > end) { day = days[days.length - 1]; note = 'De reis is voorbij'; }
    else { day = days.filter(d => d.when.start <= t).pop() || days[0]; note = 'Geen programma voor vandaag'; }
  }
  return { day, note };
}
function viewHome() {
  const { day, note } = currentDay();
  const days = graph.days();
  let dayCard = '';
  if (day) {
    const i = days.findIndex(d => d.id === day.id), prog = graph.program(day), isToday = day.when.start === today();
    dayCard = `<a class="todaycard" href="#/dag/${encodeURIComponent(day.id)}">
      <div class="tc-k">${isToday ? 'Vandaag' : esc(note)} · Dag ${i + 1} · ${longDate(day.when.start)}</div>
      <div class="tc-t">${esc(day.name)}</div>
      ${prog.length ? `<ul class="tc-p">${prog.slice(0, 6).map(p => `<li><b>${esc(p.tijd || '·')}</b> ${icon(p.entity)} ${esc(p.entity.name)}</li>`).join('')}${prog.length > 6 ? `<li class="tc-x">+ ${prog.length - 6} meer</li>` : ''}</ul>` : ''}
      <div class="tc-more">Open de dag ›</div></a>`;
  }
  const byPrio = (a, b) => (a.priority || 9) - (b.priority || 9) || a.name.localeCompare(b.name);
  const sights = graph.entities.filter(e => ['museum', 'gebouw'].includes(e.type)).sort(byPrio);
  const stays = graph.ofType('verblijf');
  const tiles = [
    ['📅', 'Dagen', '#/schema'], ['🧭', 'Gids', '#/gids'], ['🎫', 'Boekingen', '#/praktisch'], ['🔎', 'Zoeken', '#/zoek'],
  ].map(([ic, l, h]) => `<a class="tile" href="${h}"><span>${ic}</span>${l}</a>`).join('');
  const quick = (list) => `<div class="qgrid">${list.map(e => `<a class="qitem" href="#/e/${encodeURIComponent(e.id)}"><span class="ic">${icon(e)}</span><span class="nm">${esc(e.name)}</span>${e.priority === 1 ? '<span class="must">★</span>' : ''}</a>`).join('')}</div>`;
  return `${installBox(false)}${dayCard}
    <div class="tiles">${tiles}</div>
    ${stays.length ? section('Verblijf', stays.map(s => link(s, `<span class="sm">${esc([fmtWhen(s), s.address].filter(Boolean).join(' · '))}</span>`)).join('')) : ''}
    ${sights.length ? section('Musea en gebouwen', quick(sights)) : ''}`;
}

// ---------- Schema ----------
function viewSchedule() {
  const t = today();
  const intro = graph.trip.intro ? `<div class="card prose">${renderText(graph.trip.intro, graph)}</div>` : '';
  return `<h1 class="pt">${esc(graph.trip.title)}</h1>
    <p class="muted">${fmtIso(graph.trip.start)} – ${fmtIso(graph.trip.end)}${graph.trip.subtitle ? ' · ' + esc(graph.trip.subtitle) : ''}</p>
    ${intro}
    <div class="days">${graph.days().map((d, i) => {
      const prog = graph.program(d);
      return `<a class="daycard ${d.when.start === t ? 'today' : ''}" href="#/dag/${encodeURIComponent(d.id)}">
        <div class="dc-h"><span class="dc-d">${shortDate(d.when.start)}</span><span class="dc-n">Dag ${i + 1}</span></div>
        <div class="dc-t">${esc(d.name)}</div>
        ${prog.length ? `<div class="dc-p">${prog.slice(0, 4).map(p => `<span>${p.tijd ? `<b>${esc(p.tijd)}</b> ` : ''}${esc(p.entity.name)}</span>`).join('')}${prog.length > 4 ? `<span class="muted">+ ${prog.length - 4} meer</span>` : ''}</div>` : ''}
      </a>`;
    }).join('')}</div>`;
}

// ---------- Dag ----------
function viewDay(id) {
  const d = graph.get(id);
  if (!d || d.type !== 'dag') return empty('Deze dag bestaat niet.');
  return dayBody(d, false);
}
function dayBody(d, isToday) {
  const days = graph.days(), i = days.findIndex(x => x.id === d.id);
  const prev = days[i - 1], next = days[i + 1];
  const prog = graph.program(d), stay = graph.stayFor(d);
  const items = prog.map(p => {
    const e = p.entity, m = mapsUrl(e);
    const extra = [p.rel?.attrs?.duur, p.rel?.note].filter(Boolean).map(esc).join(' · ');
    return `<li class="pi"><div class="pt-t">${esc(p.tijd) || ''}</div>
      <a class="pi-b" href="#/e/${encodeURIComponent(e.id)}"><span class="nm">${icon(e)} ${esc(e.name)}</span>${e.summary ? `<span class="sm">${esc(e.summary)}</span>` : ''}${extra ? `<span class="sm">${extra}</span>` : ''}</a>
      ${m ? `<a class="mapbtn" href="${esc(m)}" target="_blank" rel="noopener" aria-label="Kaart">🧭</a>` : ''}</li>`;
  }).join('');
  return `<div class="day" data-prev="${prev ? esc(prev.id) : ''}" data-next="${next ? esc(next.id) : ''}">
    <div class="dayhead">
      ${prev ? `<a class="nav" href="#/dag/${encodeURIComponent(prev.id)}" aria-label="Vorige dag">‹</a>` : '<span class="nav off">‹</span>'}
      <div class="dh-c"><div class="dh-d">${isToday && d.when.start === today() ? 'Vandaag · ' : ''}Dag ${i + 1} · ${longDate(d.when.start)}</div><h1>${esc(d.name)}</h1></div>
      ${next ? `<a class="nav" href="#/dag/${encodeURIComponent(next.id)}" aria-label="Volgende dag">›</a>` : '<span class="nav off">›</span>'}
    </div>
    ${d.summary ? `<p class="lead">${esc(d.summary)}</p>` : ''}
    ${items ? `<ol class="prog">${items}</ol>` : empty('Nog geen programma voor deze dag.')}
    ${d.text ? `<div class="prose">${renderText(d.text, graph, d.id)}</div>` : ''}
    ${stay ? section('Overnachting', link(stay)) : ''}
    ${attachList(d)}
    ${noteBlock(d.id)}
    <p class="hint">Veeg links of rechts voor een andere dag.</p>
  </div>`;
}

// ---------- Gids ----------
function guideFilters(q) {
  return { types: (q.get('type') || '').split(',').filter(Boolean), periode: q.get('periode') || '', buurt: q.get('buurt') || '', dag: q.get('dag') || '', view: q.get('view') || 'lijst' };
}
function matchesFilters(e, f) {
  if (f.types.length && !f.types.includes(e.type)) return false;
  if (f.periode) {
    const p = graph.get(f.periode), pr = p && graph.yearRange(p);
    const direct = graph.related(e.id, 'behoort-tot').some(x => x.entity.id === f.periode) || e.id === f.periode;
    const er = graph.yearRange(e);
    const overlap = pr && er && er[0] <= pr[1] && er[1] >= pr[0];
    if (!direct && !overlap) return false;
  }
  if (f.buurt && !graph.containers(e.id).has(f.buurt) && e.id !== f.buurt) return false;
  if (f.dag && !graph.daysOf(e.id).some(d => d.id === f.dag) && !graph.program(graph.get(f.dag)).some(p => p.entity.id === e.id)) return false;
  return true;
}
function viewGuide(q) {
  const f = guideFilters(q);
  const guideEntities = graph.entities.filter(e => graph.typeDef(e.type).group === 'gids' || !graph.entityTypes[e.type]);
  const presentTypes = [...new Set(guideEntities.map(e => e.type))];
  const order = Object.keys(graph.entityTypes);
  presentTypes.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  const periods = graph.ofType('periode').sort((a, b) => (graph.yearRange(a)?.[0] ?? 0) - (graph.yearRange(b)?.[0] ?? 0));
  const areas = graph.ofType('plaats');
  const days = graph.days();
  const list = guideEntities.filter(e => matchesFilters(e, f));
  const qs = (patch) => { const o = { type: f.types.join(','), periode: f.periode, buurt: f.buurt, dag: f.dag, view: f.view, ...patch }; return '#/gids?' + new URLSearchParams(Object.entries(o).filter(([, v]) => v && v !== 'lijst')).toString(); };
  const chips = presentTypes.map(t => {
    const on = f.types.includes(t);
    const next = on ? f.types.filter(x => x !== t) : [...f.types, t];
    return `<a class="chip ${on ? 'on' : ''}" href="${qs({ type: next.join(',') })}">${graph.typeDef(t).icon || ''} ${esc(graph.typeDef(t).plural || t)}</a>`;
  }).join('');
  const sel = (name, label, opts, val) => `<label class="sel"><span>${label}</span><select data-filter="${name}"><option value="">alle</option>${opts.map(o => `<option value="${esc(o.id)}" ${o.id === val ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`;
  const filters = `<div class="filters">
    <div class="chips">${chips}</div>
    <div class="sels">
      ${periods.length ? sel('periode', 'Periode', periods.map(p => ({ id: p.id, label: `${p.name} (${fmtWhen(p)})` })), f.periode) : ''}
      ${areas.length ? sel('buurt', 'Plaats', areas.map(p => ({ id: p.id, label: p.name })), f.buurt) : ''}
      ${days.length ? sel('dag', 'Dag', days.map((d, i) => ({ id: d.id, label: `Dag ${i + 1} · ${shortDate(d.when.start)}` })), f.dag) : ''}
    </div>
    <div class="seg"><a class="${f.view === 'lijst' ? 'on' : ''}" href="${qs({ view: 'lijst' })}">Lijst</a><a class="${f.view === 'tijdlijn' ? 'on' : ''}" href="${qs({ view: 'tijdlijn' })}">Tijdlijn</a></div>
  </div>`;
  let body;
  if (f.view === 'tijdlijn') {
    const dated = list.filter(e => graph.yearRange(e) && e.type !== 'dag').sort((a, b) => graph.yearRange(a)[0] - graph.yearRange(b)[0] || graph.yearRange(b)[1] - graph.yearRange(a)[1]);
    let lastCent = null;
    body = dated.length ? '<div class="timeline">' + dated.map(e => {
      const y = graph.yearRange(e)[0], c = Math.floor(y / 100);
      const mark = c !== lastCent ? `<div class="tl-c">${c + 1}e eeuw</div>` : '';
      lastCent = c;
      return mark + `<a class="tl-i" href="#/e/${encodeURIComponent(e.id)}"><span class="tl-y">${esc(fmtWhen(e))}</span><span class="nm">${icon(e)} ${esc(e.name)}</span></a>`;
    }).join('') + '</div>' : empty('Niets gedateerd binnen deze filters.');
  } else {
    const byType = new Map();
    for (const e of list) { if (!byType.has(e.type)) byType.set(e.type, []); byType.get(e.type).push(e); }
    body = [...byType].sort((a, b) => presentTypes.indexOf(a[0]) - presentTypes.indexOf(b[0]))
      .map(([t, es]) => section(graph.typeDef(t).plural || t, `<div class="list">${es.sort((a, b) => a.name.localeCompare(b.name)).map(e => link(e)).join('')}</div>`)).join('') || empty('Geen resultaten binnen deze filters.');
  }
  const active = f.types.length || f.periode || f.buurt || f.dag;
  return `<h1 class="pt">Gids</h1>${filters}${active ? `<p class="muted">${list.length} resultaten · <a href="#/gids${f.view !== 'lijst' ? '?view=' + f.view : ''}">filters wissen</a></p>` : ''}${body}`;
}
function bindGuide() {
  $main.querySelectorAll('select[data-filter]').forEach(s => s.addEventListener('change', () => {
    const q = parseHash().q; s.value ? q.set(s.dataset.filter, s.value) : q.delete(s.dataset.filter);
    location.hash = '#/gids?' + q.toString();
  }));
}

// ---------- Praktisch ----------
function viewPractical() {
  const stays = graph.ofType('verblijf');
  const bookings = graph.ofType('boeking').sort((a, b) => String(a.when?.start || '9').localeCompare(String(b.when?.start || '9')));
  const contacts = graph.ofType('persoon').filter(p => /contact|gastheer|gastvrouw|gids|host/i.test(p.attrs?.rol || '') || graph.related(p.id, 'contact-van').length);
  const noteEntities = graph.ofType('notitie');
  const referenced = new Set(graph.entities.flatMap(e => [...(e.attachments || []), e.image].filter(Boolean)));
  const docs = [...graph.attachments.values()];
  return `<h1 class="pt">Praktisch</h1>
    ${section('Verblijf', stays.map(s => link(s, `<span class="sm">${esc([fmtWhen(s), s.address].filter(Boolean).join(' · '))}</span>`)).join(''))}
    ${section('Boekingen', bookings.map(b => link(b, `<span class="sm">${esc([fmtIso(b.when?.start), b.attrs?.soort, b.attrs?.status].filter(Boolean).join(' · '))}</span>`)).join(''))}
    ${section('Documenten', docs.map(a => attButton(a, !referenced.has(a.id) ? '' : ownerOf(a.id))).join(''))}
    ${section('Contacten', contacts.map(p => link(p, `<span class="sm">${esc(p.attrs?.rol || '')}${p.attrs?.telefoon ? ' · ' + esc(p.attrs.telefoon) : ''}</span>`)).join(''))}
    ${section('Notities', noteEntities.map(n => link(n)).join(''))}
    ${section('Mijn notities', [...notes.values()].sort((a, b) => b.updated.localeCompare(a.updated)).map(n => {
      const e = graph.get(n.entityId);
      const sub = `<span class="sm">${esc(n.text)}</span>`;
      return e ? link(e, sub) : `<div class="row"><span class="ic">📝</span><span class="rt"><span class="nm">${esc(n.name)}</span>${sub}<span class="sm">fiche niet meer in deze versie van de reis</span></span></div>`;
    }).join(''))}`;
}
const ownerOf = (attId) => { const e = graph.entities.find(x => (x.attachments || []).includes(attId)); return e ? e.name : ''; };

// ---------- Vraag Claude / Gemini ----------
// Bouwt een korte context van de fiche (zonder gevoelige gegevens, codes of bijlagen) voor een AI-assistent.
function aiContext(e) {
  const t = graph.trip, lines = [];
  const def = graph.typeDef(e.type);
  lines.push(`Ik ben op reis: ${t.title} (${fmtIso(t.start)} – ${fmtIso(t.end)}).`);
  lines.push('Ik bekijk in mijn reisgids de fiche hieronder en wil er meer over weten. Zoek op het web wat nuttig is en antwoord in het Nederlands, kort en goed leesbaar op een gsm.');
  lines.push('', `--- ${e.name} (${def.label || e.type}) ---`);
  if (e.summary) lines.push(e.summary);
  const plain = (html) => html.replace(/<br>/g, '; ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  for (const [k, v] of facts(e)) lines.push(`${k}: ${plain(v)}`);
  const sens = new Set(e.sensitive || []);
  for (const [k, v] of Object.entries(e.attrs || {})) if (!sens.has(k) && v !== '' && v != null) lines.push(`${cap(k)}: ${Array.isArray(v) ? v.join(', ') : v}`);
  if (e.why) lines.push(`Waarom in de reis: ${e.why}`);
  if (e.text) {
    let txt = e.text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, (_, id) => graph.get(id.trim())?.name || id).replace(/[*#]/g, '');
    if (txt.length > 1200) txt = txt.slice(0, 1200) + '…';
    lines.push('', txt);
  }
  const rel = graph.neighbours(e.id).filter(g => g.label !== 'programma').slice(0, 6)
    .map(g => `${cap(g.label)}: ${g.items.slice(0, 6).map(i => i.entity.name).join(', ')}`);
  if (rel.length) lines.push('', ...rel);
  const n = notes.get(e.id);
  if (n && n.text) lines.push('', `Mijn eigen notitie: ${n.text.slice(0, 400)}`);
  lines.push('', 'Mijn vraag: ');
  return lines.join('\n');
}
const claudeUrl = (e) => 'https://claude.ai/new?q=' + encodeURIComponent(aiContext(e));

// ---------- Notities ----------
function noteBlock(id) {
  const n = notes.get(id);
  return section('Mijn notities', `<textarea class="note" data-note="${esc(id)}" rows="${n && n.text ? 4 : 2}" placeholder="Bv. een telefoonnummer, een naam, een tip…">${esc(n ? n.text : '')}</textarea>
    <div class="note-st muted small" data-note-st="${esc(id)}">${n ? 'Bewaard op deze gsm · ' + new Date(n.updated).toLocaleString('nl-BE', { dateStyle: 'short', timeStyle: 'short' }) : 'Blijft bewaard, ook als je de reis opnieuw importeert.'}</div>`);
}
async function saveNote(id, text) {
  const e = graph.get(id);
  const note = { key: graph.trip.id + '/' + id, tripId: graph.trip.id, entityId: id, name: e ? e.name : (notes.get(id)?.name || id), text: text.trim(), updated: new Date().toISOString() };
  await db.putNote(note);
  if (note.text) notes.set(id, note); else notes.delete(id);
  const st = $main.querySelector(`[data-note-st="${CSS.escape(id)}"]`);
  if (st) st.textContent = note.text ? 'Bewaard ✓' : 'Notitie gewist';
}
function bindNotes() {
  $main.querySelectorAll('textarea[data-note]').forEach(t => {
    let timer = null;
    const save = () => { clearTimeout(timer); saveNote(t.dataset.note, t.value); };
    t.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(save, 700); const st = $main.querySelector(`[data-note-st="${CSS.escape(t.dataset.note)}"]`); if (st) st.textContent = 'Bezig met bewaren…'; });
    t.addEventListener('blur', save);
  });
}
async function exportNotes() {
  const list = [...notes.values()];
  if (!list.length) { toast('Er zijn nog geen notities voor deze reis.'); return; }
  const data = { format: 'vademecum-notities', version: 1, tripId: graph.trip.id, tripTitle: graph.trip.title, exported: new Date().toISOString(),
    notes: list.map(({ entityId, name, text, updated }) => ({ entityId, name, text, updated })) };
  const name = `${graph.trip.id}-notities.json`;
  const file = new File([JSON.stringify(data, null, 1)], name, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: `Notities ${graph.trip.title}` }); return; }
  } catch (err) { if (err && err.name === 'AbortError') return; }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  toast('Notities bewaard in Downloads.');
}
async function importNotes(text) {
  let data;
  try { data = JSON.parse(text); } catch { toast('Dit is geen notitiebestand.'); return; }
  if (data.format !== 'vademecum-notities' || !Array.isArray(data.notes)) { toast('Dit is geen notitiebestand van Vade Mecum.'); return; }
  const tripId = data.tripId;
  const existing = new Map((await db.getNotes(tripId)).map(n => [n.entityId, n]));
  let added = 0;
  for (const n of data.notes) {
    if (!n.entityId || !n.text) continue;
    const cur = existing.get(n.entityId);
    if (cur && cur.text === n.text) continue;
    if (cur && cur.updated > n.updated) continue;          // de nieuwste versie wint
    await db.putNote({ key: tripId + '/' + n.entityId, tripId, entityId: n.entityId, name: n.name || n.entityId, text: n.text, updated: n.updated || new Date().toISOString() });
    added++;
  }
  if (graph && graph.trip.id === tripId) notes = new Map((await db.getNotes(tripId)).map(n => [n.entityId, n]));
  toast(`${added} ${added === 1 ? 'notitie' : 'notities'} ingelezen${graph && graph.trip.id !== tripId ? ` voor reis “${data.tripTitle || tripId}”` : ''}.`);
  render();
}

// ---------- Fiche ----------
const PRIO = { 1: '★ Moet je zien', 2: 'Graag zien', 3: 'Als er tijd is' };
const names = (list) => list.map(x => `<a class="ref" href="#/e/${encodeURIComponent(x.entity.id)}">${esc(x.entity.name)}</a>`).join(', ');
// Kerngegevens: afgeleid uit velden én relaties, zodat een werk meteen titel, maker, datering en plaats toont.
function facts(e) {
  const rows = [];
  const add = (k, v) => { if (v) rows.push([k, v]); };
  const makers = graph.related(e.id, 'maakte', 'in');
  if (makers.length) add(e.type === 'gebouw' ? 'Ontwerp' : 'Maker', makers.map(m => `<a class="ref" href="#/e/${encodeURIComponent(m.entity.id)}">${esc(m.entity.name)}</a>${m.rel.attrs?.rol ? ` <span class="muted">(${esc(m.rel.attrs.rol)})</span>` : ''}`).join(', '));
  add(['verblijf', 'boeking', 'restaurant', 'notitie'].includes(e.type) ? 'Wanneer' : 'Datering', e.type !== 'dag' && esc(fmtWhen(e)));
  const where = graph.related(e.id, 'hangt-in');
  if (where.length) add('Te zien in', where.map(w => `<a class="ref" href="#/e/${encodeURIComponent(w.entity.id)}">${esc(w.entity.name)}</a>${w.rel.attrs?.zaal ? ` · ${esc(w.rel.attrs.zaal)}` : ''}`).join('<br>'));
  const inn = graph.related(e.id, 'ligt-in');
  if (inn.length) add('Ligt in', names(inn));
  const patron = graph.related(e.id, 'opdrachtgever-van', 'in');
  if (patron.length) add('Opdrachtgever', names(patron));
  const belongs = graph.related(e.id, 'behoort-tot');
  if (belongs.length) add('Behoort tot', names(belongs));
  add('Adres', e.address && esc(e.address));
  return rows;
}
const SHOWN_IN_FACTS = new Set(['maakte:in', 'hangt-in:out', 'ligt-in:out', 'opdrachtgever-van:in', 'behoort-tot:out', 'gepland-op:out', 'gepland-op:in', 'hangt-in:in']);

function codeBlock(e) {
  const codes = e.codes || [];
  if (!codes.length) return '';
  return section('Codes', codes.map((c, i) => `<button class="code" data-code="${i}" data-eid="${esc(e.id)}">
    ${(c.format || 'qr') === 'qr' ? `<span class="qr">${qrSvg(c.value)}</span>` : `<span class="codetext">${esc(c.value)}</span>`}
    <span class="rt"><span class="nm">${esc(c.label || 'Code')}</span><span class="sm">Tik om groot te tonen</span></span></button>`).join(''));
}
function qrSvg(value) {
  try {
    const qr = window.qrcode(0, 'M');
    qr.stringToBytes = window.qrcode.stringToBytesFuncs['UTF-8'];
    qr.addData(String(value)); qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } catch { return '<span class="muted">QR kon niet gemaakt worden</span>'; }
}

function workCard(entity, rel) {
  const makers = graph.related(entity.id, 'maakte', 'in').map(m => m.entity.name).join(', ');
  const sub = [makers, fmtWhen(entity), rel?.attrs?.zaal || entity.attrs?.zaal].filter(Boolean).join(' · ');
  return `<a class="work" href="#/e/${encodeURIComponent(entity.id)}">
    <div class="w-h"><span class="nm">${icon(entity)} ${esc(entity.name)}</span>${entity.priority ? `<span class="prio p${entity.priority}">${PRIO[entity.priority] || ''}</span>` : ''}</div>
    ${sub ? `<div class="sm">${esc(sub)}</div>` : ''}
    ${entity.why ? `<div class="why">${inline(entity.why, null)}</div>` : entity.summary ? `<div class="sm">${esc(entity.summary)}</div>` : ''}
  </a>`;
}

function viewEntity(id) {
  const e = graph.get(id);
  if (!e) return empty('Deze fiche bestaat niet (meer).');
  const def = graph.typeDef(e.type);
  const m = mapsUrl(e);
  const days = graph.daysOf(e.id);
  const sens = new Set(e.sensitive || []);
  const attrs = Object.entries(e.attrs || {}).filter(([k, v]) => v !== '' && v != null && k !== 'soort' && k !== 'website');
  const actions = [
    m && `<a class="btn sm" href="${esc(m)}" target="_blank" rel="noopener">🧭 Kaart</a>`,
    e.attrs?.website && `<a class="btn sm" href="${esc(e.attrs.website)}" target="_blank" rel="noopener">🌐 Website</a>`,
    e.attrs?.telefoon && `<a class="btn sm" href="tel:${esc(String(e.attrs.telefoon).replace(/[^\d+]/g, ''))}">📞 Bellen</a>`,
  ].filter(Boolean).join('');
  const askAi = `<div class="ask"><a class="btn sm ai" data-claude="${esc(e.id)}" href="${esc(claudeUrl(e))}" target="_blank" rel="noopener">💬 Vraag Claude</a><button class="btn sm ghost" data-gemini="${esc(e.id)}">✨ Gemini</button></div>`;
  const factRows = facts(e).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`);
  const attrRows = attrs.map(([k, v]) => {
    const val = Array.isArray(v) ? v.join(', ') : String(v);
    const shown = sens.has(k) ? `<button class="reveal" data-val="${esc(val)}">tik om te tonen</button>` : inline(val, graph, e.id);
    return `<tr><th>${esc(cap(k))}</th><td>${shown}</td></tr>`;
  });
  // "Te zien": werken in dit museum/gebouw, op prioriteit
  const works = graph.related(e.id, 'hangt-in', 'in').sort((a, b) => (a.entity.priority || 9) - (b.entity.priority || 9));
  const worksHtml = works.length ? section(`Te zien (${works.length})`, works.map(w => workCard(w.entity, w.rel)).join('')) : '';
  // Werken van een persoon
  const made = graph.related(e.id, 'maakte').sort((a, b) => (a.entity.priority || 9) - (b.entity.priority || 9));
  const madeHtml = made.length ? section('Werken', made.map(w => workCard(w.entity, graph.related(w.entity.id, 'hangt-in')[0]?.rel)).join('')) : '';
  const handled = (r, dir) => SHOWN_IN_FACTS.has(r.type + ':' + dir) || (r.type === 'maakte' && dir === 'out');
  const groups = graph.neighbours(e.id).map(g => ({ ...g, items: g.items.filter(it => !handled(it.rel, it.dir)) })).filter(g => g.items.length);
  const relHtml = groups.map(g => section(cap(g.label), `<div class="list">${g.items.map(({ entity, rel }) => {
    const bits = [rel.attrs && Object.entries(rel.attrs).filter(([k]) => k !== 'volgorde').map(([k, v]) => `${k}: ${v}`).join(', '), rel.note].filter(Boolean);
    const sub = [graph.typeDef(entity.type).label, fmtWhen(entity), ...bits].filter(Boolean).join(' · ');
    return link(entity, `<span class="sm">${esc(sub)}</span>`);
  }).join('')}</div>`)).join('');
  let inPeriod = '';
  if (e.type === 'periode' && graph.yearRange(e)) {
    const [a, b] = graph.yearRange(e), direct = new Set(graph.related(e.id, 'behoort-tot', 'in').map(x => x.entity.id));
    const ov = graph.entities.filter(x => x.id !== e.id && !['dag', 'boeking', 'verblijf'].includes(x.type) && !direct.has(x.id) && graph.yearRange(x) && graph.yearRange(x)[0] <= b && graph.yearRange(x)[1] >= a)
      .sort((x, y) => graph.yearRange(x)[0] - graph.yearRange(y)[0]);
    inPeriod = section('Ook in deze periode', ov.map(x => link(x, `<span class="sm">${esc(fmtWhen(x))}</span>`)).join(''));
  }
  const relatedIds = new Set(graph.neighbours(e.id).flatMap(g => g.items.map(it => it.entity.id)));
  const mentioned = [...(graph.mentions.get(e.id) || [])].map(i => graph.get(i)).filter(x => x && !relatedIds.has(x.id));
  return `<article class="fiche">
    <div class="f-type">${def.icon || ''} ${esc(def.label || e.type)}${e.attrs?.soort ? ' · ' + esc(e.attrs.soort) : ''}${e.priority ? ` <span class="prio p${e.priority}">${PRIO[e.priority] || ''}</span>` : ''}</div>
    <h1>${esc(e.name)}</h1>
    ${e.summary ? `<p class="lead">${esc(e.summary)}</p>` : ''}
    ${days.length ? `<div class="chips">${days.map(d => `<a class="chip on" href="#/dag/${encodeURIComponent(d.id)}">📅 ${shortDate(d.when.start)}</a>`).join('')}</div>` : ''}
    ${e.why ? `<div class="whybox"><b>Waarom?</b> ${inline(e.why, graph, e.id)}</div>` : ''}
    ${e.image ? `<img class="hero" data-att="${esc(e.image)}" alt="">` : ''}
    ${actions ? `<div class="actions">${actions}</div>` : ''}
    ${askAi}
    ${factRows.length || attrRows.length ? `<table class="attrs">${[...factRows, ...attrRows].join('')}</table>` : ''}
    ${codeBlock(e)}
    ${attachList(e)}
    ${worksHtml}
    ${e.text ? `<div class="prose">${renderText(e.text, graph, e.id)}</div>` : ''}
    ${madeHtml}
    ${relHtml}
    ${inPeriod}
    ${mentioned.length ? section('Vermeld bij', mentioned.map(x => link(x)).join('')) : ''}
    ${noteBlock(e.id)}
    ${(e.tags || []).length ? `<div class="chips tags">${e.tags.map(t => `<a class="chip" href="#/zoek?q=${encodeURIComponent(t)}">#${esc(t)}</a>`).join('')}</div>` : ''}
  </article>`;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function attachList(e) {
  const ids = e.attachments || [];
  if (!ids.length) return '';
  return section('Documenten', ids.map(id => graph.attachments.get(id)).filter(Boolean).map(a => attButton(a)).join(''));
}
function attButton(a, sub = '') {
  const kind = a.mime === 'application/pdf' ? 'PDF' : a.mime.startsWith('image/') ? 'Afbeelding' : 'Bestand';
  return `<div class="att"><span class="ic">${kind === 'PDF' ? '📄' : kind === 'Afbeelding' ? '🖼️' : '📎'}</span>
    <span class="rt"><span class="nm">${esc(a.title)}</span><span class="sm">${kind}${sub ? ' · ' + esc(sub) : ''}</span></span>
    <button class="btn sm" data-open="${esc(a.id)}">Openen</button>
    <button class="btn sm ghost" data-save="${esc(a.id)}" aria-label="Bewaren">⬇︎</button></div>`;
}

// ---------- Zoeken ----------
function viewSearch(q) {
  return `<div class="searchbox"><input id="q" type="search" placeholder="Zoek in de hele reis…" value="${esc(q)}" autocomplete="off" enterkeyhint="search"></div>
    <div id="results">${searchResults(q)}</div>`;
}
function searchResults(q) {
  if (!q.trim()) return `<p class="muted">Zoek op naam, werk, plaats, trefwoord of een woord uit een tekst. Accenten en hoofdletters maken niet uit.</p>`;
  const res = graph.search(q);
  const fq = fold(q), seen = new Set(res.map(e => e.id));
  for (const n of notes.values()) if (fold(n.text).includes(fq) && graph.get(n.entityId) && !seen.has(n.entityId)) res.push(graph.get(n.entityId));
  if (!res.length) return empty(`Niets gevonden voor “${esc(q)}”.`);
  return `<p class="muted">${res.length} ${res.length === 1 ? 'resultaat' : 'resultaten'}</p><div class="list">` + res.slice(0, 80).map(e => {
    const sn = graph.snippet(e, q);
    return link(e, `<span class="sm"><b>${esc(graph.typeDef(e.type).label)}</b>${sn ? ' · ' + esc(sn) : ''}</span>`);
  }).join('') + '</div>';
}
function bindSearch() {
  const inp = document.getElementById('q'), out = document.getElementById('results');
  if (!parseHash().q.get('q')) inp.focus();
  inp.addEventListener('input', () => {
    out.innerHTML = searchResults(inp.value);
    history.replaceState(null, '', '#/zoek?q=' + encodeURIComponent(inp.value));
  });
}

// ---------- Reizen ----------
async function viewTrips() {
  const trips = await db.listTrips();
  const active = ls.get(LS_ACTIVE);
  const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted().catch(() => false) : false;
  return `<h1 class="pt">Reizen</h1>
    <p class="muted">Je kunt meerdere reizen bewaren. Tik op een reis om ze actief te maken; bovenaan staat altijd de actieve reis.</p>
    ${trips.length ? `<div class="list">${trips.map(t => `<div class="trip ${t.id === active ? 'on' : ''}">
      <button class="rt" data-activate="${esc(t.id)}"><span class="nm">${t.id === active ? '✓ ' : ''}${esc(t.title)}</span><span class="sm">${fmtIso(t.start)} – ${fmtIso(t.end)}</span></button>
      <button class="btn sm ghost" data-delete="${esc(t.id)}" aria-label="Verwijderen">🗑️</button></div>`).join('')}</div>` : empty('Nog geen reizen op dit toestel.')}
    <div class="actions col">
      <button class="btn primary" data-act="import">Reis importeren</button>
      <button class="btn" data-act="sample">Voorbeeldreis laden</button>
    </div>
    ${graph ? section('Mijn notities', `<p class="muted">Je notities staan los van het reisbestand: ze blijven bewaard als je de reis opnieuw importeert. Maak af en toe een back-up, bv. naar Drive.</p>
      <div class="actions"><button class="btn sm" data-act="notes-export">⬆︎ Notities exporteren (${notes.size})</button><button class="btn sm" data-act="notes-import">⬇︎ Notities importeren</button></div>`) : ''}
    ${section('Lettergrootte', `<div class="sizes">${[['normaal', 'Normaal'], ['groot', 'Groot'], ['extra', 'Extra groot']].map(([k, l]) => `<button class="btn ${(ls.get(LS_SIZE) || 'groot') === k ? 'on' : ''}" data-size="${k}">${l}</button>`).join('')}</div>`)}
    ${section('Installeren', installBox(true) || '<p class="muted">Vade Mecum is geïnstalleerd.</p>')}
    ${section('Datum', `<p class="muted">“Vandaag” gebruikt de datum van de telefoon. Om een reis vooraf te testen kun je een datum instellen.</p>
      <div class="row2"><input type="date" id="fake-today" value="${esc(ls.get(LS_TODAY) || '')}"><button class="btn sm" data-act="clear-today">Echte datum</button></div>`)}
    ${section('Opslag', `<p class="muted">Reizen staan alleen in de browseropslag van dit toestel${db.isMemoryOnly() ? ' (nu alleen tijdelijk in het geheugen: deze browser laat geen opslag toe)' : ''}. ${persisted ? 'De browser heeft beloofd ze niet zelf op te ruimen.' : 'Als je de browsergegevens wist, moet je de reis opnieuw importeren.'}</p>`)}
    <p class="muted small">Vade Mecum ${APP_VERSION} · schema ${schema.schemaVersion} (${Object.keys(schema.modules).join(', ')})</p>`;
}
function bindTrips() {
  $main.querySelectorAll('[data-activate]').forEach(b => b.addEventListener('click', async () => { await activate(b.dataset.activate); location.hash = '#/start'; }));
  $main.querySelectorAll('[data-delete]').forEach(b => b.addEventListener('click', () => confirmBox(`Reis verwijderen van dit toestel? Ook je notities bij deze reis worden gewist; exporteer ze eerst als je ze wilt bewaren.`, async () => {
    await db.deleteTrip(b.dataset.delete);
    if (ls.get(LS_ACTIVE) === b.dataset.delete) { ls.set(LS_ACTIVE, null); graph = null; setTitle(); }
    render();
  })));
  $main.querySelectorAll('[data-size]').forEach(b => b.addEventListener('click', () => {
    ls.set(LS_SIZE, b.dataset.size); document.documentElement.dataset.size = b.dataset.size; render();
  }));
  const ft = document.getElementById('fake-today');
  ft && ft.addEventListener('change', () => { ls.set(LS_TODAY, ft.value || null); toast(ft.value ? `Vandaag = ${ft.value}` : 'Echte datum'); });
}

// ---------- gedeelde acties ----------
function bindCommon() {
  $main.querySelectorAll('[data-act="import"]').forEach(b => b.addEventListener('click', () => document.getElementById('file').click()));
  $main.querySelectorAll('[data-act="install"]').forEach(b => b.addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt(); await installPrompt.userChoice.catch(() => null); installPrompt = null; render();
  }));
  $main.querySelectorAll('[data-act="sample"]').forEach(b => b.addEventListener('click', loadSample));
  $main.querySelectorAll('[data-act="notes-export"]').forEach(b => b.addEventListener('click', exportNotes));
  $main.querySelectorAll('[data-act="notes-import"]').forEach(b => b.addEventListener('click', () => document.getElementById('notesfile').click()));
  $main.querySelectorAll('[data-gemini]').forEach(b => b.addEventListener('click', async () => {
    const e = graph.get(b.dataset.gemini);
    try { await navigator.clipboard.writeText(aiContext(e)); toast('Gekopieerd. Plak het in Gemini en typ je vraag.', 3500); } catch { toast('Kopiëren lukte niet.'); }
    window.open('https://gemini.google.com/app', '_blank', 'noopener');
  }));
  // Link pas bij het tikken opbouwen, zodat een net getypte notitie mee gaat.
  $main.querySelectorAll('a[data-claude]').forEach(a => a.addEventListener('click', () => { a.href = claudeUrl(graph.get(a.dataset.claude)); }));
  bindNotes();
  $main.querySelectorAll('[data-act="clear-today"]').forEach(b => b.addEventListener('click', () => { ls.set(LS_TODAY, null); render(); toast('Echte datum'); }));
  $main.querySelectorAll('.reveal').forEach(b => b.addEventListener('click', async () => {
    b.replaceWith(Object.assign(document.createElement('span'), { className: 'revealed', textContent: b.dataset.val }));
    try { await navigator.clipboard.writeText(b.dataset.val); toast('Getoond en gekopieerd'); } catch {}
  }));
  $main.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openAttachment(b.dataset.open, false)));
  $main.querySelectorAll('[data-save]').forEach(b => b.addEventListener('click', () => openAttachment(b.dataset.save, true)));
  $main.querySelectorAll('[data-code]').forEach(b => b.addEventListener('click', () => {
    const c = graph.get(b.dataset.eid).codes[+b.dataset.code];
    const v = document.getElementById('codeview');
    v.querySelector('.cv-label').textContent = c.label || 'Code';
    v.querySelector('.cv-code').innerHTML = (c.format || 'qr') === 'qr' ? qrSvg(c.value) : `<div class="codetext big">${esc(c.value)}</div>`;
    v.querySelector('.cv-value').textContent = (c.format || 'qr') === 'qr' ? c.value : '';
    v.hidden = false;
  }));
  $main.querySelectorAll('img[data-att]').forEach(async img => { const blob = await db.getFile(graph.trip.id, img.dataset.att); if (blob) img.src = URL.createObjectURL(blob); });
}

async function openAttachment(id, download) {
  const a = graph.attachments.get(id);
  const blob = await db.getFile(graph.trip.id, id);
  if (!blob) { toast('Bijlage niet gevonden. Importeer de reis opnieuw.'); return; }
  const url = URL.createObjectURL(blob);
  if (!download && a.mime.startsWith('image/')) {
    const v = document.getElementById('viewer');
    v.querySelector('img').src = url; v.hidden = false; return;
  }
  if (!download) { const w = window.open(url, '_blank'); if (w) return; }
  const el = Object.assign(document.createElement('a'), { href: url, download: a.filename || (a.title + (a.mime === 'application/pdf' ? '.pdf' : '')) });
  document.body.appendChild(el); el.click(); el.remove();
}

function confirmBox(msg, onYes) {
  const d = document.getElementById('confirm');
  d.querySelector('p').textContent = msg; d.hidden = false;
  const yes = d.querySelector('[data-yes]'), no = d.querySelector('[data-no]');
  const close = () => { d.hidden = true; yes.onclick = no.onclick = null; };
  yes.onclick = () => { close(); onYes(); }; no.onclick = close;
}

// ---------- import ----------
function b64ToBlob(b64, mime) {
  const bin = atob(b64.replace(/^data:[^,]*,/, '').replace(/\s/g, ''));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type: mime });
}
async function importData(raw, sourceName) {
  let data;
  try { data = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { showReport([`${sourceName} is geen geldige JSON (${e.message}).`], []); return false; }
  data = migrate(data, parseInt(schema.schemaVersion, 10)).data;
  const { errors, warnings } = validateTrip(data, schema);
  if (errors.length) { showReport(errors, warnings); return false; }
  const files = [];
  for (const a of data.attachments || []) { files.push([a.id, b64ToBlob(a.data, a.mime)]); }
  const stored = { ...data, attachments: (data.attachments || []).map(({ data: _d, ...rest }) => rest), importedAt: new Date().toISOString() };
  const existed = !!(await db.getTrip(data.trip.id));
  await db.saveTrip(stored, files);
  db.persist();
  await activate(data.trip.id);
  if (warnings.length) showReport([], warnings, `“${data.trip.title}” is ${existed ? 'bijgewerkt' : 'geïmporteerd'}, met opmerkingen:`);
  else toast(`“${data.trip.title}” is ${existed ? 'bijgewerkt' : 'geïmporteerd'}.`);
  location.hash = '#/start'; render();
  return true;
}
function showReport(errors, warnings, head) {
  const d = document.getElementById('report');
  d.querySelector('h2').textContent = head || 'Import mislukt';
  d.querySelector('.body').innerHTML = (errors.length ? `<ul class="err">${errors.slice(0, 30).map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : '') +
    (warnings.length ? `<ul class="warn">${warnings.slice(0, 30).map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : '');
  d.hidden = false;
}
async function loadSample() {
  try { const r = await fetch('voorbeeld/voorbeeldreis.reis.json'); await importData(await r.text(), 'De voorbeeldreis'); }
  catch (e) { toast('Voorbeeldreis kon niet geladen worden.'); }
}

async function activate(id) {
  let data = await db.getTrip(id);
  if (!data) { graph = null; ls.set(LS_ACTIVE, null); setTitle(); return; }
  // Reizen die al op de gsm staan, mee omzetten na een app-update met een nieuw schema (alleen bij een major-versie).
  const m = migrate(data, parseInt(schema.schemaVersion, 10));
  if (m.changed) { data = m.data; await db.updateTrip(data); }
  graph = new Graph(data, schema);
  notes = new Map((await db.getNotes(id)).map(n => [n.entityId, n]));
  ls.set(LS_ACTIVE, id); setTitle();
}
function setTitle() { $title.textContent = graph ? graph.trip.title : 'Vade Mecum'; document.title = graph ? graph.trip.title + ' · Vade Mecum' : 'Vade Mecum'; }

// ---------- vegen tussen dagen ----------
let touch = null;
$main.addEventListener('touchstart', (ev) => { const t = ev.touches[0]; touch = { x: t.clientX, y: t.clientY, t: Date.now() }; }, { passive: true });
$main.addEventListener('touchend', (ev) => {
  if (!touch) return;
  const t = ev.changedTouches[0], dx = t.clientX - touch.x, dy = t.clientY - touch.y, dt = Date.now() - touch.t;
  touch = null;
  const day = $main.querySelector('.day');
  if (!day || Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6 || dt > 800) return;
  const target = dx < 0 ? day.dataset.next : day.dataset.prev;
  if (target) { day.classList.add(dx < 0 ? 'out-l' : 'out-r'); setTimeout(() => { location.hash = '#/dag/' + encodeURIComponent(target); }, 120); }
}, { passive: true });

// ---------- opstart ----------
async function start() {
  schema = await (await fetch('schema/schema.json')).json();
  document.getElementById('notesfile').addEventListener('change', async (ev) => {
    const f = ev.target.files[0]; ev.target.value = '';
    if (f) await importNotes(await f.text());
  });
  document.getElementById('file').addEventListener('change', async (ev) => {
    const f = ev.target.files[0]; ev.target.value = '';
    if (f) await importData(await f.text(), f.name);
  });
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { b.closest('.overlay').hidden = true; }));
  window.addEventListener('hashchange', render);
  window.addEventListener('scroll', () => scrollMem.set(location.hash, window.scrollY), { passive: true });
  const active = ls.get(LS_ACTIVE);
  if (active) await activate(active);
  if (!graph) { const trips = await db.listTrips(); if (trips.length) await activate(trips[0].id); }
  render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // Is er een nieuwe versie geïnstalleerd, herlaad dan één keer zodat ze meteen zichtbaar is.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      reloaded = true; location.reload();
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then(reg => { reg.update().catch(() => {}); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); }); })
      .catch(() => {});
  }
}
start();
