// Spanning Tree und EtherChannel
global.NL = require('../src/engine.js'); global.window = undefined;
const SB = require('../src/sandbox.js');
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const net = { devs: {}, links: [], seq: 1 }, api = SB.testApi(net), A = (m, h) => api.addDev(m, 0, 0, h), G = n => 'GigabitEthernet1/0/' + n;
const s1 = A('C9200L-24T-4G', 'SW1'), s2 = A('C9200L-24T-4G', 'SW2'), s3 = A('C9200L-24T-4G', 'SW3'), h1 = A('HW-1288H-V5', 'H1'), h2 = A('HW-1288H-V5', 'H2');
const cu = (a, ap, b, bp) => net.links.push({ a, ap, b, bp, cable: 'cu' });
const X = (id, lines) => { const s = NL.newSess(); ['enable', 'configure terminal', ...lines, 'end'].forEach(l => NL.exec(net, id, s, l)); };
// Dreieck SW1-SW2-SW3, Hosts an SW1 und SW3
cu(s1, G(1), s2, G(1)); cu(s2, G(2), s3, G(1)); cu(s3, G(2), s1, G(2)); cu(h1, 'eth0', s1, G(10)); cu(h2, 'eth0', s3, G(10));
[s1, s2, s3].forEach(i => ['1', '2'].forEach(p => X(i, ['interface ' + G(p), 'switchport mode trunk'])));
api.hostLine(net.devs[h1], NL.newSess(), 'ip 10.0.0.1/24'); api.hostLine(net.devs[h2], NL.newSess(), 'ip 10.0.0.2/24');
const st = NL.stp(net, 1), roots = Object.values(st.sw).filter(x => x.root).length;
ok(roots === 1, 'genau eine Root Bridge im Dreieck');
const blocked = Object.entries(st.sw).flatMap(([id, x]) => Object.entries(x.ports).filter(([p, q]) => q.sts === 'BLK').map(([p]) => id + '/' + p));
ok(blocked.length === 1, 'genau ein Port blockiert die Schleife: ' + blocked.join(','));
ok(NL.ping(net, h1, '10.0.0.2').ok, 'Ping ueber das Dreieck funktioniert (Schleife aufgeloest)');
// Root per Prioritaet festlegen
X(s2, ['spanning-tree vlan 1 priority 4096']); const st2 = NL.stp(net, 1); ok(st2.sw[s2].root, 'Prioritaet 4096 macht SW2 zur Root');
ok(/This switch|Dieser Switch ist die Root/.test(api.iosShow('SW2', 'show spanning-tree vlan 1')), 'show spanning-tree auf der Root');
ok(/Altn\s+BLK/.test(api.iosShow('SW1', 'show spanning-tree') + api.iosShow('SW3', 'show spanning-tree')), 'show spanning-tree zeigt Altn/BLK');
X(s1, ['spanning-tree vlan 1 root primary']); ok(NL.stp(net, 1).sw[s1].root, 'root primary uebernimmt die Root');
// Link faellt aus: blockierter Port wird aktiv
const blk0 = Object.entries(NL.stp(net, 1).sw).flatMap(([id, x]) => Object.entries(x.ports).filter(([p, q]) => q.sts === 'BLK').map(([p]) => [id, p]))[0];
net.links.find(l => (l.a === s1 && l.ap === G(1)) || (l.b === s1 && l.bp === G(1))).cut = true;
ok(NL.ping(net, h1, '10.0.0.2').ok && !Object.values(NL.stp(net, 1).sw).some(x => Object.values(x.ports).some(p => p.sts === 'BLK')), 'Kabel gezogen: blockierter Port uebernimmt, kein Port mehr blockiert');
net.links.forEach(l => { l.cut = false; });
// ohne STP: Sturm
X(s1, ['no spanning-tree vlan 1']); X(s2, ['no spanning-tree vlan 1']); X(s3, ['no spanning-tree vlan 1']);
ok(NL.stp(net, 1).storm.size > 0 && !NL.ping(net, h1, '10.0.0.2').ok && /Sturm/.test(NL.ping(net, h1, '10.0.0.2').notes.join(' ')), 'ohne Spanning Tree: Broadcast-Sturm legt das Netz lahm');
['SW1', 'SW2', 'SW3'].forEach((n, k) => X([s1, s2, s3][k], ['spanning-tree vlan 1']));
ok(NL.ping(net, h1, '10.0.0.2').ok, 'STP wieder an: Netz laeuft');
// EtherChannel: zwei parallele Links SW1-SW2
cu(s1, G(5), s2, G(5)); cu(s1, G(6), s2, G(6));
[s1, s2].forEach(i => ['5', '6'].forEach(p => X(i, ['interface ' + G(p), 'switchport mode trunk'])));
const sts = () => { const r = NL.stp(net, 1); return [s1, s2].flatMap(i => [G(5), G(6)].map(p => (r.sw[i].ports[p] || {}).sts)); };
const b0 = sts(); ok(b0.includes('BLK') && b0.includes('FWD'), 'parallele Links ohne Bundle: STP blockiert einen davon: ' + b0.join(','));
[s1, s2].forEach(i => X(i, ['interface range ' + G(5) + ' - 6', 'channel-group 1 mode active']));
ok(/Po1\(SU\)/.test(api.iosShow('SW1', 'show etherchannel summary')), 'show etherchannel summary: Po1 SU');
const b1 = sts(); ok(new Set(b1.slice(0, 2)).size === 1 && new Set(b1.slice(2)).size === 1, 'mit EtherChannel haben beide Mitglieder denselben Zustand (ein logischer Link): ' + b1.join(','));
X(s2, ['interface range ' + G(5) + ' - 6', 'no channel-group', 'channel-group 1 mode passive']); X(s1, ['interface range ' + G(5) + ' - 6', 'no channel-group', 'channel-group 1 mode passive']);
ok(/SD/.test(api.iosShow('SW1', 'show etherchannel summary')) && /passiv|passive/.test(api.iosShow('SW1', 'show etherchannel summary')), 'passiv-passiv bildet kein Bundle');
X(s1, ['interface range ' + G(5) + ' - 6', 'no channel-group', 'channel-group 1 mode on']); X(s2, ['interface range ' + G(5) + ' - 6', 'no channel-group', 'channel-group 1 mode active']);
ok(/Modus passt nicht|LACP/.test(api.iosShow('SW1', 'show etherchannel summary')), 'on gegen active: Bundle ausgesetzt mit Begruendung');
process.exit(bad ? 1 : 0);
