global.NL = require('../src/engine.js'); global.window = undefined;
const SB = require('../src/sandbox.js');
const net = SB.example();
const api = SB.testApi(net);
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const ids = Object.keys(net.devs), nL = net.links.length, nD = ids.length;

// Duplizieren: Geräte samt interner Kabel, neue Hostnamen, keine doppelten IPs
const sw = ids.filter(i => net.devs[i].type === 'switch').slice(0, 2);
const internal = net.links.filter(l => sw.includes(l.a) && sw.includes(l.b)).length;
const nids = api.clone(sw);
ok(nids.length === 2 && Object.keys(net.devs).length === nD + 2, 'duplicate: 2 neue Geraete');
const names = Object.values(net.devs).map(d => d.cfg.hostname);
ok(new Set(names).size === names.length, 'duplicate: Hostnamen eindeutig (' + nids.map(i => net.devs[i].cfg.hostname).join(', ') + ')');
ok(net.links.length === nL + internal, 'duplicate: nur interne Kabel kopiert (' + internal + ')');
ok(nids.every(i => Object.values(net.devs[i].cfg.ifs).every(f => !f.ip)), 'duplicate: IP-Adressen geleert');
ok(net.links.every(l => net.devs[l.a] && net.devs[l.b]), 'duplicate: keine Kabel zu fehlenden Geraeten');

// Notizen/Zonen werden mitkopiert und ueberleben JSON
net.notes.push({ id: 'n900', kind: 'zone', x: 10, y: 10, w: 200, h: 100, text: 'Serverraum', color: 'grün' });
const c2 = api.clone(['n900']);
ok(net.notes.length === 2 && net.notes[1].text === 'Serverraum' && net.notes[1].x === 58, 'duplicate: Zone kopiert und versetzt');
ok(JSON.parse(JSON.stringify(net)).notes.length === 2, 'notes: JSON-Roundtrip');

// Suche
const first = net.devs[ids[0]].cfg.hostname;
ok(api.search(first.slice(0, 3)).some(r => r.id === ids[0]), 'search: Hostname-Teil findet Geraet');
ok(api.search('vlan 20').length > 0, 'search: VLAN gefunden');
ok(api.search('serverraum').some(r => r.note), 'search: Notiz gefunden');
ok(api.search('10.30.0.10').length > 0, 'search: IP gefunden');
ok(api.search('').length === 0, 'search: leere Suche liefert nichts');
process.exit(bad ? 1 : 0);
