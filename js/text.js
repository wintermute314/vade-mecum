// Lichte opmaak → HTML. Expliciete [[id]]-links, automatische naamlinks, **vet**, *cursief*, lijsten, koppen.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderText(text, graph, selfId) {
  if (!text) return '';
  const blocks = String(text).replace(/\r/g, '').split(/\n\s*\n/);
  return blocks.map(b => {
    const lines = b.split('\n');
    if (/^##\s/.test(lines[0]) && lines.length === 1) return `<h3>${inline(lines[0].replace(/^##\s+/, ''), graph, selfId)}</h3>`;
    if (lines.every(l => /^\s*[-•]\s/.test(l))) {
      const linked = new Set();
      return '<ul>' + lines.map(l => `<li>${inline(l.replace(/^\s*[-•]\s+/, ''), graph, selfId, linked)}</li>`).join('') + '</ul>';
    }
    let head = '';
    if (/^##\s/.test(lines[0])) { head = `<h3>${inline(lines.shift().replace(/^##\s+/, ''), graph, selfId)}</h3>`; }
    return head + `<p>${inline(lines.join('\n'), graph, selfId).replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

export function inline(str, graph, selfId, linked = new Set()) {
  const tokens = [];
  const tok = (html) => `\u0001${tokens.push(html) - 1}\u0002`;
  let s = String(str);
  // expliciete links
  s = s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, id, label) => {
    id = id.trim();
    const e = graph && graph.get(id);
    if (!e) return tok(esc(label || id));
    linked.add(id);
    return tok(`<a class="ref" href="#/e/${encodeURIComponent(id)}">${esc(label || e.name)}</a>`);
  });
  // urls
  s = s.replace(/https?:\/\/[^\s)<>\]]+/g, (u) => tok(`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40))}</a>`));
  // automatische naamlinks op de ruwe tekst (vóór escapen)
  if (graph && graph.nameRe) {
    s = s.replace(graph.nameRe, (m) => {
      const id = graph.nameToId.get(m);
      if (!id || id === selfId || linked.has(id)) return m;
      linked.add(id);
      return tok(`<a class="ref" href="#/e/${encodeURIComponent(id)}">${esc(m)}</a>`);
    });
  }
  s = esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return s.replace(/\u0001(\d+)\u0002/g, (_, i) => tokens[+i]);
}
