global.NL = require('../src/engine.js'); global.window = undefined;
const S = require('../src/storage.js');
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const net = { devs: {}, links: [], seq: 1 };
const mk = (id, type, model, host) => { net.devs[id] = NL.mkDev(id, type, 0, 0, 0, { model, host }); return net.devs[id]; };
const srv = mk('s1', 'server', 'HW-2288H-V5', 'SRV-DB'), srv2 = mk('s2', 'server', 'HW-2288H-V5', 'SRV-B'), mds = mk('m1', 'fc', 'MDS-9132T', 'MDS-A'), sto = mk('t1', 'storage', 'HW-Dorado-5000V6', 'STO-01');
NL.setCard(net, 's1', 1, 'HBA-2x32G-FC'); NL.setCard(net, 's2', 1, 'HBA-2x32G-FC'); NL.setCard(net, 't1', 1, 'IO-4x32G-FC');
const X = 'DS-SFP-FC32G-SW', cab = (a, ap, b, bp) => { net.links.push({ a, ap, b, bp, cable: 'mmf' }); net.devs[a].xcvr[ap] = X; net.devs[b].xcvr[bp] = X; };
cab('s1', 'slot2/1', 'm1', 'fc1/1'); cab('s1', 'slot2/2', 'm1', 'fc1/2'); cab('s2', 'slot2/1', 'm1', 'fc1/3'); cab('t1', 'A-slot2/1', 'm1', 'fc1/9'); cab('t1', 'B-slot2/1', 'm1', 'fc1/10');

// Pools
ok(S.createPool(sto, { name: 'POOL1', raid: 'raid5', disks: 2, diskGb: 600 }).err, 'RAID5 mit 2 Platten abgelehnt');
ok(S.createPool(sto, { name: 'POOL1', raid: 'raid10', disks: 5, diskGb: 600 }).err, 'RAID10 mit ungerader Plattenzahl abgelehnt');
ok(S.createPool(sto, { name: 'POOL1', raid: 'raid5', disks: 6, diskGb: 600 }).ok, 'RAID5 6x600 angelegt');
ok(S.poolInfo(sto, sto.stor.pools[0]).usable === 3000, 'RAID5 6x600 = 3000 GB nutzbar');
ok(S.createPool(sto, { name: 'POOL1', raid: 'raid6', disks: 6, diskGb: 600 }).err, 'doppelter Poolname abgelehnt');
ok(S.RAID.raid6.usable(12) * 600 === 6000 && S.RAID.raid10.usable(12) * 600 === 3600, 'RAID6/10 Kapazitaet');

// LUNs
ok(S.createLun(sto, { name: 'DB01', pool: 'POOL1', gb: 3500 }).err, 'LUN groesser als Pool abgelehnt');
ok(S.createLun(sto, { name: 'DB01', pool: 'POOL1', gb: 200 }).ok, 'LUN DB01 200 GB');
ok(S.poolInfo(sto, sto.stor.pools[0]).free === 2800, 'Pool-frei nach LUN');
ok(S.createLun(sto, { name: 'THIN1', pool: 'POOL1', gb: 5000, thin: true }).ok && S.poolInfo(sto, sto.stor.pools[0]).over, 'Thin-LUN darf ueberprovisionieren, Pool meldet over');
ok(S.createLun(sto, { name: 'DB01', pool: 'POOL1', gb: 10 }).err, 'doppelter LUN-Name abgelehnt');
ok(S.deletePool(sto, 'POOL1').err, 'Pool mit LUNs nicht loeschbar');
S.deleteLun(sto, 1); ok(sto.stor.luns.length === 1, 'LUN geloescht');

// Pfade: ohne Zoning keine Sicht
S.maskLun(sto, 0, 's1', true);
ok(S.paths(net, srv).length === 0 && S.hostLuns(net, srv).length === 0, 'ohne aktives Zoneset: keine Pfade');
ok(/Zoning/.test(S.why(net, srv, sto, 0)), 'why(): nennt Zoning');
// Auto-Zoning
const a = S.autoZones(net, mds); ok(a.n === 6, 'Auto-Zoning: 3 Initiatoren-Ports x 2 Targets = 6 Zonen (ist ' + a.n + ')');
ok(S.zoneActive(mds, true).ok && S.zs(mds).active, 'Zoneset aktivieren');
ok(S.paths(net, srv).length === 4, 'SRV-DB: 2 HBA-Ports x 2 Controller = 4 Pfade (ist ' + S.paths(net, srv).length + ')');
ok(S.hostLuns(net, srv).length === 1 && S.hostLuns(net, srv)[0].paths.length === 4, 'LUN DB01 sichtbar ueber 4 Pfade');
ok(S.hostLuns(net, srv2).length === 0 && /Masking/.test(S.why(net, srv2, sto, 0)), 'SRV-B sieht LUN nicht (Masking) und why() nennt es');
S.maskLun(sto, 0, 's2', true); ok(S.hostLuns(net, srv2).length === 1 && S.hostLuns(net, srv2)[0].paths.length === 2, 'SRV-B nach Masking: 2 Pfade');
// Zone ohne Storage-Port
S.zs(mds).zones = S.zs(mds).zones.filter(z => !z.name.includes('slot2_2__STO-01_B')); 
ok(S.paths(net, srv).length === 3, 'Zone entfernt -> 3 Pfade');
// Kabel ziehen
net.links = net.links.filter(l => !(l.a === 't1' && l.ap === 'B-slot2/1')); ok(S.paths(net, srv).every(p => p.ctl === 'A'), 'Controller-B-Kabel gezogen -> nur noch Controller A');
// manuelle Zone
const w1 = NL.wwpn(srv, 'slot2/1'), w2 = NL.wwpn(sto, 'A-slot2/1');
ok(S.zoneAdd(mds, 'Z_X', [w1]).err, 'Zone mit 1 Mitglied abgelehnt'); ok(S.zoneAdd(mds, 'Z_X', [w1, w2]).ok, 'manuelle Zone');
ok(S.zoneActive(mds, false).ok && S.paths(net, srv).length === 0, 'Zoneset deaktiviert -> keine Pfade (Default-Zone deny)');
process.exit(bad ? 1 : 0);
