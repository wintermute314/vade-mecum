// Oude reisbestanden blijven altijd laden.
//
// - Minor-versies (1.0 → 1.1 → 1.2) voegen alleen toe. Een 1.0-bestand is ook een geldig 1.5-bestand: geen migratie nodig.
// - Een major-versie (2.0) mag iets hernoemen of herstructureren. Dan komt hier een migratie bij die oudere bestanden
//   automatisch omzet, zowel bij het importeren als voor reizen die al op de gsm staan.
// - Migraties staan als keten: migrations[1] zet 1.x om naar 2.0, migrations[2] zet 2.x om naar 3.0, enzovoort.
//   Een 1.x-bestand op een 3.x-app doorloopt dus 1 → 2 → 3. Verwijder nooit een oude migratie.
//
// Voorbeeld:
//   migrations[1] = (d) => {
//     for (const e of d.entities) if (e.type === 'locatie') e.type = 'plek';   // hernoemd type
//     d.schemaVersion = '2.0';
//     return d;
//   };
export const migrations = {};

export const majorOf = (v) => parseInt(String(v ?? '1.0'), 10) || 1;

// Geeft { data, from, changed }. Past het object niet ter plekke aan.
export function migrate(input, targetMajor, table = migrations) {
  let data = JSON.parse(JSON.stringify(input));
  if (!data.schemaVersion) data.schemaVersion = '1.0';      // heel oude of handgemaakte bestanden
  const from = String(data.schemaVersion);
  let major = majorOf(from);
  while (major < targetMajor) {
    const step = table[major];
    if (!step) break;
    data = step(data);
    major = majorOf(data.schemaVersion);
  }
  if (major !== majorOf(from)) data.migratedFrom = from;
  return { data, from, changed: major !== majorOf(from) };
}
