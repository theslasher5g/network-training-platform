// Routing-Protokolle: OSPF, EIGRP, BGP, Admin Distance
global.NL = require('../src/engine.js'); global.window = undefined;
const SB = require('../src/sandbox.js');
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const net = { devs: {}, links: [], seq: 1 }, api = SB.testApi(net), A = (m, h) => api.addDev(m, 0, 0, h), G = n => 'GigabitEthernet0/0/' + n;
const R1 = A('ISR4321', 'R1'), R2 = A('ISR4321', 'R2'), R3 = A('ISR4321', 'R3'), h1 = A('HW-1288H-V5', 'H1'), h3 = A('HW-1288H-V5', 'H3'), s1 = A('C9200L-24T-4G', 'S1'), s3 = A('C9200L-24T-4G', 'S3');
const cu = (a, ap, b, bp) => net.links.push({ a, ap, b, bp, cable: 'cu' });
const X = (id, lines) => { const s = NL.newSess(); const out = []; ['enable', 'configure terminal', ...lines, 'end'].forEach(l => { const r = NL.exec(net, id, s, l); if (r && /^%/.test(r)) out.push(r); }); return out; };
const ip = (id, i, a, m) => X(id, ['interface ' + i, `ip address ${a} ${m || '255.255.255.0'}`, 'no shutdown']);
// R1 -- R2 -- R3 ; LANs an R1 und R3
cu(R1, G(0), R2, G(0)); cu(R2, G(1), R3, G(0)); cu(R1, G(1), s1, 'GigabitEthernet1/0/1'); cu(h1, 'eth0', s1, 'GigabitEthernet1/0/2'); cu(R3, G(1), s3, 'GigabitEthernet1/0/1'); cu(h3, 'eth0', s3, 'GigabitEthernet1/0/2');
ip(R1, 'g0/0/0', '10.12.0.1'); ip(R2, 'g0/0/0', '10.12.0.2'); ip(R2, 'g0/0/1', '10.23.0.2'); ip(R3, 'g0/0/0', '10.23.0.3'); ip(R1, 'g0/0/1', '10.1.0.1'); ip(R3, 'g0/0/1', '10.3.0.1');
api.hostLine(net.devs[h1], NL.newSess(), 'ip 10.1.0.10/24 10.1.0.1'); api.hostLine(net.devs[h3], NL.newSess(), 'ip 10.3.0.10/24 10.3.0.1');
ok(!NL.ping(net, h1, '10.3.0.10').ok, 'ohne Routing: keine Verbindung zwischen den LANs');
// OSPF
const ospf = (id, nets, extra = []) => X(id, ['router ospf 1', ...nets.map(n => `network ${n} area 0`), ...extra]);
ok(ospf(R1, ['10.12.0.0 0.0.0.255', '10.1.0.0 0.0.0.255'], ['passive-interface g0/0/1']).length === 0, 'router ospf wird akzeptiert');
ospf(R2, ['10.12.0.0 0.0.0.255', '10.23.0.0 0.0.0.255']); ospf(R3, ['10.23.0.0 0.0.0.255', '10.3.0.0 0.0.0.255'], ['passive-interface g0/0/1']);
ok(/FULL/.test(api.iosShow('R2', 'show ip ospf neighbor')) && (api.iosShow('R2', 'show ip ospf neighbor').match(/FULL/g) || []).length === 2, 'R2 hat zwei OSPF-Nachbarn in FULL');
ok(/O\s+10\.3\.0\.0\/24/.test(api.iosShow('R1', 'show ip route')), 'R1 lernt 10.3.0.0/24 per OSPF');
ok(NL.ping(net, h1, '10.3.0.10').ok, 'Hosts in den LANs erreichen sich ueber OSPF');
// Fehler: Area-Mismatch
X(R3, ['router ospf 1', 'no network 10.23.0.0 0.0.0.255 area 0', 'network 10.23.0.0 0.0.0.255 area 1']);
ok(!NL.ping(net, h1, '10.3.0.10').ok && /Area/.test(api.iosShow('R2', 'show ip ospf neighbor')), 'Area-Mismatch: keine Nachbarschaft, Begruendung in show ip ospf neighbor');
X(R3, ['router ospf 1', 'no network 10.23.0.0 0.0.0.255 area 1', 'network 10.23.0.0 0.0.0.255 area 0']);
// Fehler: passive-interface auf dem Transit
X(R2, ['router ospf 1', 'passive-interface g0/0/1']); ok(!NL.ping(net, h1, '10.3.0.10').ok && /passive/.test(api.iosShow('R3', 'show ip ospf neighbor')), 'passive-interface auf dem Transit-Link: keine Nachbarschaft');
X(R2, ['router ospf 1', 'no passive-interface g0/0/1']); ok(NL.ping(net, h1, '10.3.0.10').ok, 'passive-interface entfernt: wieder erreichbar');
// Kosten und Admin Distance
X(R1, ['ip route 10.3.0.0 255.255.255.0 10.12.0.2 200']); ok(/O\s+10\.3\.0\.0/.test(api.iosShow('R1', 'show ip route')), 'Floating Static (AD 200) schlaegt OSPF (110) nicht');
X(R1, ['ip route 10.3.0.0 255.255.255.0 10.12.0.2']); ok(/\[110\//.test(api.iosShow('R1', 'show ip route')) && NL.ping(net, h1, '10.3.0.10').ok, 'normale Static (AD 1) bleibt in der Tabelle, Verbindung steht');
X(R1, ['no ip route 10.3.0.0 255.255.255.0 10.12.0.2', 'no ip route 10.3.0.0 255.255.255.0 10.12.0.2 200']);
// default-information originate
X(R3, ['ip route 0.0.0.0 0.0.0.0 10.3.0.99', 'router ospf 1', 'default-information originate']); ok(/O E2\s+0\.0\.0\.0\/0/.test(api.iosShow('R1', 'show ip route')), 'default-information originate: R1 lernt 0.0.0.0/0 (E2)');
X(R3, ['no ip route 0.0.0.0 0.0.0.0 10.3.0.99']);
// EIGRP statt OSPF
['R1', 'R2', 'R3'].forEach(n => X(net.devs[{ R1, R2, R3 }[n]].id, ['no router ospf 1']));
ok(!NL.ping(net, h1, '10.3.0.10').ok, 'OSPF entfernt: wieder getrennt');
const eig = (id, nets, as = 100, extra = []) => X(id, ['router eigrp ' + as, ...nets.map(n => 'network ' + n), ...extra]);
eig(R1, ['10.12.0.0 0.0.0.255', '10.1.0.0 0.0.0.255'], 100, ['passive-interface g0/0/1']); eig(R2, ['10.12.0.0 0.0.0.255', '10.23.0.0 0.0.0.255']); eig(R3, ['10.23.0.0 0.0.0.255', '10.3.0.0 0.0.0.255'], 200, ['passive-interface g0/0/1']);
ok(/AS-Nummer/.test(api.iosShow('R2', 'show ip eigrp neighbors')) && !NL.ping(net, h1, '10.3.0.10').ok, 'AS-Nummer passt nicht: keine EIGRP-Nachbarschaft');
X(R3, ['no router eigrp 200']); eig(R3, ['10.23.0.0 0.0.0.255', '10.3.0.0 0.0.0.255'], 100, ['passive-interface g0/0/1']);
ok(/D\s+10\.3\.0\.0\/24/.test(api.iosShow('R1', 'show ip route')) && NL.ping(net, h1, '10.3.0.10').ok, 'EIGRP: R1 lernt 10.3.0.0/24 (D), Hosts erreichen sich');
ok(/\[90\/\d+\]/.test(api.iosShow('R1', 'show ip route')), 'EIGRP-Route mit Admin Distance 90 und Metrik');
['R1', 'R2', 'R3'].forEach(n => X({ R1, R2, R3 }[n], ['no router eigrp 100']));
// BGP: R1 (AS 65001) -- R2 (AS 65000, ISP) -- R3 (AS 65003); eBGP; R2 verteilt
const bgp = (id, as, nbrs, nets = []) => X(id, ['router bgp ' + as, ...nbrs.map(([i, a]) => `neighbor ${i} remote-as ${a}`), ...nets.map(n => `network ${n}`)]);
bgp(R1, 65001, [['10.12.0.2', 65000]], ['10.1.0.0 mask 255.255.255.0']); bgp(R2, 65000, [['10.12.0.1', 65001], ['10.23.0.3', 65003]]); bgp(R3, 65003, [['10.23.0.2', 65000]], ['10.3.0.0 mask 255.255.255.0']);
ok(/Established|^10\.12\.0\.2\s+65000\s+\d/m.test(api.iosShow('R1', 'show ip bgp summary')) && !/Active|Idle/.test(api.iosShow('R1', 'show ip bgp summary').split('\n').slice(2).join('\n')), 'eBGP-Sitzung R1 - R2 steht');
ok(/B\s+10\.3\.0\.0\/24 \[20\//.test(api.iosShow('R1', 'show ip route')), 'R1 lernt 10.3.0.0/24 per eBGP (AD 20)');
ok(NL.ping(net, h1, '10.3.0.10').ok, 'Hosts erreichen sich ueber BGP');
ok(/65000 65003/.test(api.iosShow('R1', 'show ip bgp')), 'AS-Pfad 65000 65003 in der BGP-Tabelle');
X(R3, ['router bgp 65003', 'no neighbor 10.23.0.2 remote-as 65000', 'neighbor 10.23.0.2 remote-as 65999']); ok(/remote-as stimmt nicht|erwartet/.test(api.iosShow('R3', 'show ip bgp summary') + api.iosShow('R2', 'show ip bgp summary')) && !NL.ping(net, h1, '10.3.0.10').ok, 'falsche remote-as: Sitzung steht nicht, Begruendung sichtbar');
X(R3, ['router bgp 65003', 'no neighbor 10.23.0.2 remote-as 65999', 'neighbor 10.23.0.2 remote-as 65000']);
X(R3, ['router bgp 65003', 'no network 10.3.0.0 mask 255.255.255.0']); ok(!NL.ping(net, h1, '10.3.0.10').ok, 'network-Anweisung entfernt: Praefix wird nicht mehr angekuendigt');
// iBGP: R2 und R3 in AS 65000, R1 in AS 65001
['R1', 'R2', 'R3'].forEach(n => X({ R1, R2, R3 }[n], ['no router bgp ' + { R1: 65001, R2: 65000, R3: 65003 }[n]]));
bgp(R1, 65001, [['10.12.0.2', 65000]], ['10.1.0.0 mask 255.255.255.0']); bgp(R2, 65000, [['10.12.0.1', 65001], ['10.23.0.3', 65000]]); bgp(R3, 65000, [['10.23.0.2', 65000]], ['10.3.0.0 mask 255.255.255.0']);
ok(/B\s+10\.3\.0\.0\/24 \[20\//.test(api.iosShow('R1', 'show ip route')) && /\[200\//.test(api.iosShow('R2', 'show ip route')), 'iBGP: R2 lernt von R3 (AD 200), gibt per eBGP an R1 weiter (AD 20)');
ok(!NL.ping(net, h1, '10.3.0.10').ok, 'ohne next-hop-self kennt R3 den Rueckweg nicht (Next Hop 10.12.0.1 unerreichbar)');
X(R2, ['router bgp 65000', 'neighbor 10.23.0.3 next-hop-self']); ok(NL.ping(net, h1, '10.3.0.10').ok, 'mit next-hop-self erreichen sich die Hosts ueber eBGP und iBGP');
process.exit(bad ? 1 : 0);
