// Migraties tussen major-versies. Minor-versies zijn altijd achterwaarts compatibel en hebben geen migratie nodig.
// Voorbeeld voor later:  migrations[1] = (d) => { /* zet 1.x om naar 2.0 */ d.schemaVersion = '2.0'; return d; };
const migrations = {};

export function migrate(data, targetMajor) {
  let major = parseInt(String(data.schemaVersion || '1.0'), 10);
  while (major < targetMajor && migrations[major]) { data = migrations[major](data); major++; }
  return data;
}
