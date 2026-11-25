// Vade Mecum — raamwerk. Hash-routes, geen build-stap, geen externe afhankelijkheden.
import * as db from './db.js';
import { Graph, fold, yearOf, dateOf, timeOf } from './graph.js';
import { renderText, inline, esc } from './text.js';
import { validateTrip } from './validate.js';
import { migrate } from './migrate.js';

export const APP_VERSION = '0.4.1';
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
let myPhotos = new Map(); // entityId → eigen foto van de actieve reis
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
  const ua = navigator.userAgent;
  const box = (nm, sm) => `<div class="install"><span class="ic">📲</span><span class="rt"><span class="nm">${nm}</span><span class="sm">${sm}</span></span></div>`;
  // Ingebouwde browser van een andere app (WhatsApp, Gmail, Facebook…): daar kun je niet installeren en niets blijvend bewaren.
  if (/; wv\)|FBAN|FBAV|Instagram|WhatsApp|GSA\//.test(ua))
    return box('Eerst openen in Chrome', `Je bekijkt Vade Mecum in de browser van een andere app. Tik rechtsboven op ⋮ en kies <b>Openen in Chrome</b> (of kopieer het adres <b>${esc(location.origin + location.pathname)}</b> naar Chrome). Installeer de app daar.`);
  if (/SamsungBrowser/.test(ua))
    return box('Op je startscherm zetten', 'Tik onderaan op ☰ (drie streepjes) › <b>Pagina toevoegen aan</b> › <b>Startscherm</b>. Of open dit adres in Chrome en kies daar ⋮ › <b>App installeren</b>.');
  if (/Firefox/.test(ua))
    return box('Op je startscherm zetten', 'Tik op ⋮ › <b>Installeren</b> of <b>Toevoegen aan startscherm</b>. In Chrome werkt Vade Mecum het best.');
  return box('Op je startscherm zetten', 'Tik in Chrome rechtsboven op ⋮ en kies <b>App installeren</b> of <b>Toevoegen aan startscherm</b>. Zie je dat niet, herlaad dan de pagina eenmaal en kijk opnieuw. Lukt het nog niet: kijk of er een standaard startscherm-app ingesteld is (Instellingen › Apps › Standaard-apps › Startscherm).');
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
    return `<li class="pi${m ? ' has-map' : ''}">
      <a class="pi-b" href="#/e/${encodeURIComponent(e.id)}">${p.tijd ? `<span class="pt-t">🕐 ${esc(p.tijd)}</span>` : ''}<span class="nm">${icon(e)} ${esc(e.name)}</span>${e.summary ? `<span class="sm">${esc(e.summary)}</span>` : ''}${extra ? `<span class="sm">${extra}</span>` : ''}</a>
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
    ${noteBlock(d.id, false)}
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
  const referenced = new Set(graph.entities.flatMap(e => [...(e.attachments || []), typeof e.image === 'string' ? e.image : null].filter(Boolean)));
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
// Eenvoudige herkenbare iconen (geen officiële logobestanden).
const ICON_CLAUDE = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><g stroke="#D97757" stroke-width="2.6" stroke-linecap="round">' +
  [0, 22.5, 45, 67.5, 90, 112.5, 135, 157.5].map(a => `<line x1="12" y1="2.5" x2="12" y2="21.5" transform="rotate(${a} 12 12)"/>`).join('') + '</g></svg>';
const ICON_GEMINI = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><defs><linearGradient id="gm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4285F4"/><stop offset="1" stop-color="#9B72CB"/></linearGradient></defs>' +
  '<path fill="url(#gm)" d="M12 1.5C12.6 7.2 16.8 11.4 22.5 12C16.8 12.6 12.6 16.8 12 22.5C11.4 16.8 7.2 12.6 1.5 12C7.2 11.4 11.4 7.2 12 1.5Z"/></svg>';
const claudeUrl = (e) => 'https://claude.ai/new?q=' + encodeURIComponent(aiContext(e));

// ---------- Notities ----------
function noteBlock(id, withPhoto = true) {
  const n = notes.get(id), has = myPhotos.has(id);
  const photo = withPhoto ? `<div class="actions"><button class="btn sm" data-myphoto="${esc(id)}">📷 ${has ? 'Andere foto' : 'Eigen foto toevoegen'}</button>${has ? `<button class="btn sm ghost" data-myphoto-del="${esc(id)}">Foto verwijderen</button>` : ''}</div>` : '';
  return section('Mijn notities', `<textarea class="note" data-note="${esc(id)}" rows="${n && n.text ? 4 : 2}" placeholder="Bv. een telefoonnummer, een naam, een tip…">${esc(n ? n.text : '')}</textarea>
    <div class="note-st muted small" data-note-st="${esc(id)}">${n ? 'Bewaard op deze gsm · ' + new Date(n.updated).toLocaleString('nl-BE', { dateStyle: 'short', timeStyle: 'short' }) : 'Blijft bewaard, ook als je de reis opnieuw importeert.'}</div>${photo}`);
}

// ---------- Foto's ----------
// Drie bronnen, in deze volgorde: een eigen foto (op de gsm), een foto van het web (image als object, sinds schema 1.1,
// na import opgehaald en bewaard in IndexedDB), of een bijlage uit het reisbestand (image als bijlage-id).
const objUrls = new Map();
const objUrl = (key, blob) => { if (!objUrls.has(key)) objUrls.set(key, URL.createObjectURL(blob)); return objUrls.get(key); };
const remoteImage = (e) => (e && e.image && typeof e.image === 'object' && e.image.url) ? e.image : null;
const commonsUrl = (file) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(String(file).replace(/^File:/, '').replace(/ /g, '_'))}?width=960`;
function photoAttrs(e) {
  if (myPhotos.has(e.id)) return `data-my="${esc(e.id)}"`;
  const r = remoteImage(e);
  if (r) return `data-photo="${esc(r.url)}"${r.file ? ` data-file="${esc(r.file)}"` : ''}`;
  if (typeof e.image === 'string' && e.image) return `data-att="${esc(e.image)}"`;
  return '';
}
function credit(r) {
  const lic = r.license ? (r.licenseUrl ? `<a href="${esc(r.licenseUrl)}" target="_blank" rel="noopener">${esc(r.license)}</a>` : esc(r.license)) : '';
  const src = r.page ? `<a href="${esc(r.page)}" target="_blank" rel="noopener">${esc(r.source || 'bron')}</a>` : esc(r.source || '');
  return [r.author ? 'Foto: ' + esc(r.author) : '', lic, src].filter(Boolean).join(' · ');
}
function heroBlock(e) {
  const a = photoAttrs(e);
  if (!a) return '';
  const r = !myPhotos.has(e.id) && remoteImage(e);
  const cap = myPhotos.has(e.id) ? 'Eigen foto' : r ? [r.caption ? esc(r.caption) : '', credit(r)].filter(Boolean).join('<br>') : '';
  return `<figure class="hero${e.type === 'persoon' ? ' portrait' : ''}"><img ${a} alt="${esc((r && r.caption) || e.name)}" data-zoom>${cap ? `<figcaption>${cap}</figcaption>` : ''}</figure>`;
}
async function loadImg(img) {
  const holder = img.closest('figure');
  const fail = () => { if (holder) holder.remove(); else img.remove(); };
  let blob = null, key = '';
  if (img.dataset.my) { const r = myPhotos.get(img.dataset.my); blob = r && r.blob; key = 'my:' + img.dataset.my + ':' + (r && r.updated); }
  else if (img.dataset.att) { blob = await db.getFile(graph.trip.id, img.dataset.att); key = 'att:' + graph.trip.id + '/' + img.dataset.att; }
  else if (img.dataset.photo) { blob = await db.getPhoto(img.dataset.photo); key = 'ph:' + img.dataset.photo; }
  if (blob) { img.src = objUrl(key, blob); return; }
  if (img.dataset.photo && navigator.onLine) {
    // Nog niet op de gsm (bv. ophalen bezig of mislukt): rechtstreeks van het web tonen.
    img.onerror = () => { if (img.dataset.file && !img.dataset.tried) { img.dataset.tried = '1'; img.src = commonsUrl(img.dataset.file); } else fail(); };
    img.src = img.dataset.photo; return;
  }
  fail();
}
function remoteList(g = graph) {
  const m = new Map();
  for (const e of g.entities) { const r = remoteImage(e); if (r && !m.has(r.url)) m.set(r.url, r); }
  return [...m.values()];
}
async function fetchPhoto(r) {
  for (const u of [r.url, r.file && commonsUrl(r.file)].filter(Boolean)) {
    try {
      const res = await fetch(u, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) continue;
      const b = await res.blob();
      if (!b.size || (b.type && !b.type.startsWith('image/'))) continue;
      await db.putPhoto(r.url, b);
      return true;
    } catch {}
  }
  return false;
}
let syncing = null;
// Haalt de foto's van de actieve reis op die nog niet op de gsm staan, drie tegelijk.
function syncPhotos(manual = false) {
  if (!graph || syncing) return syncing;
  const tripId = graph.trip.id;
  syncing = (async () => {
    const have = new Set(await db.photoKeys());
    const todo = remoteList().filter(r => !have.has(r.url));
    if (!todo.length) { if (manual) toast("Alle foto's staan al op de gsm."); return; }
    if (!navigator.onLine) { if (manual) toast("Geen internet. De foto's worden opgehaald zodra er verbinding is."); return; }
    let done = 0, ok = 0, i = 0;
    const worker = async () => {
      while (i < todo.length) {
        const r = todo[i++];
        if (await fetchPhoto(r)) ok++;
        done++;
        if (todo.length > 3 && done < todo.length && done % 5 === 0) toast(`Foto's ophalen: ${done} van ${todo.length}…`, 5000);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    const bad = todo.length - ok;
    toast(bad ? `${ok} ${ok === 1 ? 'foto' : "foto's"} bewaard voor offline, ${bad} lukten niet.` : `${ok} ${ok === 1 ? 'foto' : "foto's"} bewaard voor offline gebruik.`, 3500);
    if (graph && graph.trip.id === tripId && parseHash().name === 'reizen') render();
  })().finally(() => { syncing = null; });
  return syncing;
}
// Foto's van het web die geen enkele reis nog gebruikt, opruimen.
async function cleanPhotos() {
  try {
    const used = new Set();
    for (const t of await db.listTrips()) { const d = await db.getTrip(t.id); for (const e of (d && d.entities) || []) { const r = remoteImage(e); if (r) used.add(r.url); } }
    const unused = (await db.photoKeys()).filter(k => !used.has(k));
    if (unused.length) await db.deletePhotos(unused);
  } catch {}
}
// Eigen foto via camera of galerij, verkleind tot 1600 px.
function addMyPhoto(id) {
  const inp = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
  inp.addEventListener('change', async () => {
    const f = inp.files[0];
    if (!f) return;
    const blob = await shrink(f, 1600);
    const e = graph.get(id);
    const rec = { key: graph.trip.id + '/' + id, tripId: graph.trip.id, entityId: id, name: e ? e.name : id, blob, updated: new Date().toISOString() };
    await db.putMyPhoto(rec);
    myPhotos.set(id, rec);
    toast('Foto bewaard op deze gsm.');
    render();
  });
  inp.click();
}
async function shrink(file, max) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(res => c.toBlob(b => res(b || file), 'image/jpeg', 0.85));
  } catch { return file; }
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
  const pa = photoAttrs(entity);
  return `<a class="work${pa ? ' has-thumb' : ''}" href="#/e/${encodeURIComponent(entity.id)}">${pa ? `<img class="thumb" ${pa} alt="" loading="lazy">` : ''}<div class="w-b">
    <div class="w-h"><span class="nm">${icon(entity)} ${esc(entity.name)}</span>${entity.priority ? `<span class="prio p${entity.priority}">${PRIO[entity.priority] || ''}</span>` : ''}</div>
    ${sub ? `<div class="sm">${esc(sub)}</div>` : ''}
    ${entity.why ? `<div class="why">${inline(entity.why, null)}</div>` : entity.summary ? `<div class="sm">${esc(entity.summary)}</div>` : ''}
  </div></a>`;
}

function viewEntity(id) {
  const e = graph.get(id);
  if (!e) return empty('Deze fiche bestaat niet (meer).');
  const def = graph.typeDef(e.type);
  const m = mapsUrl(e);
  const days = graph.daysOf(e.id);
  const sens = new Set(e.sensitive || []);
  const attrs = Object.entries(e.attrs || {}).filter(([k, v]) => v !== '' && v != null && k !== 'soort' && k !== 'website');
  // Eén knoppenrij: dagen, kaart, bellen, website, Claude, Gemini. Ronde knoppen van 48 px, groot genoeg om aan te tikken.
  const tel = e.attrs?.telefoon && String(e.attrs.telefoon).replace(/[^\d+]/g, '');
  const tools = [
    ...days.map(d => `<a class="chip on" href="#/dag/${encodeURIComponent(d.id)}">📅 ${shortDate(d.when.start)}</a>`),
    m && `<a class="btn sm tb" href="${esc(m)}" target="_blank" rel="noopener" aria-label="Kaart">🧭<span class="lbl"> Kaart</span></a>`,
    tel && `<a class="btn sm tb" href="tel:${esc(tel)}" aria-label="Bellen">📞<span class="lbl"> Bellen</span></a>`,
    e.attrs?.website && `<a class="ibtn" href="${esc(e.attrs.website)}" target="_blank" rel="noopener" aria-label="Website" title="Website">🌐</a>`,
    `<a class="ibtn" data-claude="${esc(e.id)}" href="${esc(claudeUrl(e))}" target="_blank" rel="noopener" aria-label="Vraag Claude" title="Vraag Claude">${ICON_CLAUDE}</a>`,
    `<button class="ibtn" data-gemini="${esc(e.id)}" aria-label="Vraag Gemini" title="Vraag Gemini">${ICON_GEMINI}</button>`,
  ].filter(Boolean).join('');
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
    <div class="toolbar">${tools}</div>
    ${e.why ? `<div class="whybox"><b>Waarom?</b> ${inline(e.why, graph, e.id)}</div>` : ''}
    ${heroBlock(e)}
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
  let photoInfo = '';
  if (graph) {
    const want = remoteList(), have = new Set(await db.photoKeys()), n = want.filter(r => have.has(r.url)).length;
    if (want.length || myPhotos.size) photoInfo = section("Foto's", `<p class="muted">${want.length ? `${n} van ${want.length} foto's uit het reisbestand staan op deze gsm${n < want.length ? '; de rest wordt opgehaald zodra er internet is' : ' en zijn ook offline te zien'}.` : ''}${myPhotos.size ? ` Eigen foto's: ${myPhotos.size}.` : ''}</p>
      ${want.length ? `<div class="actions"><button class="btn sm" data-act="photos-sync">🖼️ Foto's ophalen</button></div>` : ''}`);
  }
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
    ${photoInfo}
    ${section('Lettergrootte', `<div class="sizes">${[['normaal', 'Normaal'], ['groot', 'Groot'], ['extra', 'Extra groot']].map(([k, l]) => `<button class="btn ${(ls.get(LS_SIZE) || 'groot') === k ? 'on' : ''}" data-size="${k}">${l}</button>`).join('')}</div>`)}
    ${section('Installeren', installBox(true) || '<p class="muted">Vade Mecum is geïnstalleerd.</p>')}
    ${section('Datum', `<p class="muted">“Vandaag” gebruikt de datum van de telefoon. Om een reis vooraf te testen kun je een datum instellen.</p>
      <div class="row2"><input type="date" id="fake-today" value="${esc(ls.get(LS_TODAY) || '')}"><button class="btn sm" data-act="clear-today">Echte datum</button></div>`)}
    ${section('Opslag', `<p class="muted">Reizen staan alleen in de browseropslag van dit toestel${db.isMemoryOnly() ? ' (nu alleen tijdelijk in het geheugen: deze browser laat geen opslag toe)' : ''}. ${persisted ? 'De browser heeft beloofd ze niet zelf op te ruimen.' : 'Als je de browsergegevens wist, moet je de reis opnieuw importeren.'}</p>`)}
    <p class="muted small">Vade Mecum ${APP_VERSION} · schema ${schema.schemaVersion} (${Object.keys(schema.modules).join(', ')})</p>`;
}
function bindTrips() {
  $main.querySelectorAll('[data-activate]').forEach(b => b.addEventListener('click', async () => { await activate(b.dataset.activate); location.hash = '#/start'; }));
  $main.querySelectorAll('[data-delete]').forEach(b => b.addEventListener('click', () => confirmBox(`Reis verwijderen van dit toestel? Ook je notities en eigen foto's bij deze reis worden gewist; exporteer de notities eerst als je ze wilt bewaren.`, async () => {
    await db.deleteTrip(b.dataset.delete);
    await cleanPhotos();
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
  // Past de knoppenrij niet op één lijn, toon Kaart en Bellen dan alleen als icoon.
  $main.querySelectorAll('.toolbar').forEach(tb => {
    const top = (el) => Math.round(el.getBoundingClientRect().top);
    const kids = [...tb.children];
    if (kids.length && kids.some(k => top(k) > top(kids[0]) + 4)) tb.classList.add('compact');
  });
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
  $main.querySelectorAll('img[data-att], img[data-photo], img[data-my]').forEach(loadImg);
  $main.querySelectorAll('img[data-zoom]').forEach(img => img.addEventListener('click', () => {
    if (!img.src) return;
    const v = document.getElementById('viewer'); v.querySelector('img').src = img.src; v.hidden = false;
  }));
  $main.querySelectorAll('[data-act="photos-sync"]').forEach(b => b.addEventListener('click', () => syncPhotos(true)));
  $main.querySelectorAll('[data-myphoto]').forEach(b => b.addEventListener('click', () => addMyPhoto(b.dataset.myphoto)));
  $main.querySelectorAll('[data-myphoto-del]').forEach(b => b.addEventListener('click', () => confirmBox('Je eigen foto van deze fiche verwijderen?', async () => {
    const id = b.dataset.myphotoDel;
    await db.deleteMyPhoto(graph.trip.id + '/' + id); myPhotos.delete(id); render();
  })));
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
const MB = (n) => (n / 1048576).toLocaleString('nl-BE', { maximumFractionDigits: 1 }) + ' MB';
// Korte uitleg bij een fout, zodat Bart of Claude kan zien waar het misliep (ook als schermafdruk).
function diag(e) {
  const ua = navigator.userAgent;
  const br = /SamsungBrowser\/[\d.]+/.exec(ua)?.[0] || /Firefox\/[\d.]+/.exec(ua)?.[0] || /EdgA?\/[\d.]+/.exec(ua)?.[0] || /Chrome\/\d+/.exec(ua)?.[0] || 'browser?';
  const andr = /Android [\d.]+/.exec(ua)?.[0] || '';
  return `Vade Mecum ${APP_VERSION} · ${br}${andr ? ' · ' + andr : ''}${isStandalone() ? ' · app' : ' · browser'}${e ? ' · ' + (e.name || 'Error') + ': ' + (e.message || e) : ''}`;
}
async function readFile(f) {
  if (f.text) return await f.text();
  return await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsText(f); });
}
// Een gekozen of gedeeld bestand importeren. Elke stap geeft bij een fout een duidelijke melding in plaats van niets te doen.
async function importFile(f) {
  if (!f) return false;
  const name = f.name || 'Het bestand';
  if (!f.size) { showReport([`${name} is leeg (0 bytes). Vaak is het bestand nog niet helemaal gedownload, bv. uit Drive of WhatsApp. Open het eerst eens, of download het opnieuw, en probeer dan nog eens.`], [], 'Import mislukt', diag()); return false; }
  if (/\.(zip|pdf|docx?|jpe?g|png|heic)$/i.test(name)) { showReport([`${name} is geen reisbestand. Kies het bestand dat eindigt op .reis.json.`], [], 'Import mislukt', diag()); return false; }
  toast(`${name} wordt gelezen…`, 8000);
  let text;
  try { text = await readFile(f); }
  catch (e) { showReport([`${name} kon niet gelezen worden. Staat het bestand nog in de cloud (Drive, OneDrive)? Download het dan eerst naar de gsm, of open het vanuit de app Bestanden.`], [], 'Import mislukt', diag(e)); return false; }
  return importData(text, name);
}
async function importData(raw, sourceName) {
  let data;
  if (typeof raw === 'string') {
    const head = raw.replace(/^﻿/, '').trimStart().slice(0, 200);
    if (/^</.test(head)) { showReport([`${sourceName} is een webpagina en geen reisbestand. Dat gebeurt als je een Drive- of mailvoorbeeld bewaart in plaats van het bestand zelf. Kies in Drive ⋮ › Downloaden, en importeer dan het gedownloade bestand.`], [], 'Import mislukt', diag()); return false; }
    if (/^PK/.test(head)) { showReport([`${sourceName} is een zip-bestand. Pak het eerst uit en kies dan het .reis.json-bestand.`], [], 'Import mislukt', diag()); return false; }
    try { data = JSON.parse(raw.replace(/^﻿/, '')); }
    catch (e) { showReport([`${sourceName} is geen geldige JSON. Misschien is het bestand afgebroken of beschadigd bij het doorsturen; download het opnieuw.`, e.message], [], 'Import mislukt', diag()); return false; }
  } else data = raw;
  if (data && data.format === 'vademecum-notities') { await importNotes(JSON.stringify(data)); return true; }
  if (!data || data.format !== 'reisdb') { showReport([`${sourceName} is geen reisbestand van Vade Mecum (het veld "format" is niet "reisdb").`], [], 'Import mislukt', diag()); return false; }
  data = migrate(data, parseInt(schema.schemaVersion, 10)).data;
  const { errors, warnings } = validateTrip(data, schema);
  if (errors.length) { showReport(errors, warnings, 'Import mislukt', diag()); return false; }
  const files = [];
  for (const a of data.attachments || []) {
    try { files.push([a.id, b64ToBlob(a.data || '', a.mime)]); }
    catch (e) { warnings.push(`Bijlage “${a.title || a.id}” is beschadigd en werd overgeslagen.`); }
  }
  const stored = { ...data, attachments: (data.attachments || []).map(({ data: _d, ...rest }) => rest), importedAt: new Date().toISOString() };
  let existed = false;
  try {
    existed = !!(await db.getTrip(data.trip.id));
    await db.saveTrip(stored, files);
  } catch (e) {
    const est = await db.estimate();
    const full = e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message || ''));
    showReport([full
      ? `De gsm geeft de app niet genoeg opslagruimte${est ? ` (${MB(est.usage)} van ${MB(est.quota)} in gebruik)` : ''}. Maak ruimte vrij op de gsm, of verwijder een oude reis in 🧳, en probeer opnieuw.`
      : `De reis kon niet bewaard worden op dit toestel. Sluit de app helemaal af (ook uit de lijst met recente apps), open ze opnieuw en probeer nog eens.`], [], 'Import mislukt', diag(e));
    return false;
  }
  db.persist();
  await activate(data.trip.id);
  cleanPhotos();
  if (db.isMemoryOnly()) warnings.unshift('Deze browser laat geen blijvende opslag toe (privévenster of een app-browser zoals die van WhatsApp of Gmail). De reis verdwijnt zodra je de app sluit. Open Vade Mecum in Chrome of via het icoon op je startscherm.');
  if (warnings.length) showReport([], warnings, `“${data.trip.title}” is ${existed ? 'bijgewerkt' : 'geïmporteerd'}, met opmerkingen:`);
  else toast(`“${data.trip.title}” is ${existed ? 'bijgewerkt' : 'geïmporteerd'}.`);
  location.hash = '#/start'; render();
  return true;
}
function showReport(errors, warnings, head, info) {
  const d = document.getElementById('report');
  document.getElementById('toast').hidden = true;
  d.querySelector('h2').textContent = head || 'Import mislukt';
  d.querySelector('.body').innerHTML = (errors.length ? `<ul class="err">${errors.slice(0, 30).map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : '') +
    (warnings.length ? `<ul class="warn">${warnings.slice(0, 30).map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : '') +
    (info ? `<p class="muted small diag">${esc(info)}</p>` : '');
  d.hidden = false;
}
async function loadSample() {
  try { const r = await fetch('voorbeeld/voorbeeldreis.reis.json'); await importData(await r.text(), 'De voorbeeldreis'); }
  catch (e) { showReport(['De voorbeeldreis kon niet geladen worden. Is er internet?'], [], 'Import mislukt', diag(e)); }
}

// Een bestand dat via "Delen › Vade Mecum" binnenkwam (zie share_target in het manifest en sw.js).
async function takeShared() {
  if (!/[?&]gedeeld=1/.test(location.search) || !('caches' in window)) return;
  history.replaceState(null, '', location.pathname + (location.hash || '#/start'));
  try {
    const c = await caches.open('vademecum-share');
    const r = await c.match('gedeeld-bestand');
    if (!r) { showReport(['Er kwam geen bestand mee bij het delen. Deel het .reis.json-bestand zelf, niet een link ernaar.'], [], 'Import mislukt', diag()); return; }
    const name = decodeURIComponent(r.headers.get('x-name') || 'gedeeld-bestand.reis.json');
    const blob = await r.blob();
    await c.delete('gedeeld-bestand');
    await importFile(new File([blob], name, { type: blob.type }));
  } catch (e) { showReport(['Het gedeelde bestand kon niet gelezen worden.'], [], 'Import mislukt', diag(e)); }
}

async function activate(id) {
  let data = await db.getTrip(id);
  if (!data) { graph = null; ls.set(LS_ACTIVE, null); setTitle(); return; }
  // Reizen die al op de gsm staan, mee omzetten na een app-update met een nieuw schema (alleen bij een major-versie).
  const m = migrate(data, parseInt(schema.schemaVersion, 10));
  if (m.changed) { data = m.data; await db.updateTrip(data); }
  graph = new Graph(data, schema);
  notes = new Map((await db.getNotes(id)).map(n => [n.entityId, n]));
  myPhotos = new Map((await db.getMyPhotos(id)).map(p => [p.entityId, p]));
  for (const u of objUrls.values()) URL.revokeObjectURL(u);
  objUrls.clear();
  ls.set(LS_ACTIVE, id); setTitle();
  setTimeout(() => syncPhotos(), 1500);   // ontbrekende foto's op de achtergrond ophalen
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
    try { if (f) await importNotes(await readFile(f)); } catch (e) { showReport(['Het notitiebestand kon niet gelezen worden.'], [], 'Import mislukt', diag(e)); }
  });
  document.getElementById('file').addEventListener('change', async (ev) => {
    const f = ev.target.files[0]; ev.target.value = '';
    try { await importFile(f); } catch (e) { showReport(['Er liep iets onverwachts mis bij het importeren.'], [], 'Import mislukt', diag(e)); }
  });
  await takeShared();
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { b.closest('.overlay').hidden = true; }));
  window.addEventListener('hashchange', render);
  window.addEventListener('online', () => syncPhotos());
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
