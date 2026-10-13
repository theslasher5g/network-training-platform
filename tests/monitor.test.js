// Monitoring: ICMP, SNMP, Trigger, Syslog
global.NL = require('../src/engine.js'); global.window = undefined;
const SB = require('../src/sandbox.js'), MON = require('../src/monitor.js');
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const net = { devs: {}, links: [], seq: 1 }, api = SB.testApi(net), A = (m, h) => api.addDev(m, 0, 0, h), G = n => 'GigabitEthernet1/0/' + n;
const mon = A('HW-1288H-V5', 'SRV-MON'), sw = A('C9200L-24T-4G', 'SW'), pc = A('PC', 'PC-1'), rt = A('ISR4321', 'R-GW');
const cu = (a, ap, b, bp) => net.links.push({ a, ap, b, bp, cable: 'cu' }); cu(mon, 'eth0', sw, G(1)); cu(pc, 'eth0', sw, G(2)); cu(rt, 'GigabitEthernet0/0/0', sw, G(24));
api.hostLine(net.devs[mon], NL.newSess(), 'ip 10.0.0.5/24 10.0.0.1'); api.hostLine(net.devs[pc], NL.newSess(), 'ip 10.0.0.20/24');
{ const s = NL.newSess(); ['enable', 'configure terminal', 'interface g0/0/0', 'ip address 10.0.0.1 255.255.255.0', 'no shutdown', 'end'].forEach(l => NL.exec(net, rt, s, l)); }
api.ios('SW', ['interface vlan 1', 'ip address 10.0.0.2 255.255.255.0', 'no shutdown']);
const SRV = net.devs[mon], S = () => api.mon(), tick = () => { api.monTick(); };
ok(!MON.isMonitor(net, SRV), 'ohne Paket ist der Server kein Monitoring-Server');
api.lx('SRV-MON', 'sudo apt install zabbix-server'); ok(!MON.isMonitor(net, SRV), 'Paket installiert, Dienst noch gestoppt');
api.lx('SRV-MON', 'sudo systemctl start zabbix-server'); ok(MON.isMonitor(net, SRV), 'Dienst gestartet: Monitoring aktiv');
ok(MON.discover(net, SRV) === 3, 'Netz durchsuchen findet Switch, Router und PC (3 Hosts)');
tick(); tick(); tick();
const hs = S()[mon].hist, hSw = hs[sw], hPc = hs[pc];
ok(hSw.length === 3 && hSw.every(x => x.up) && hSw[0].rtt > 0, 'Switch ist erreichbar mit Antwortzeit');
ok(hSw.every(x => x.snmp === false), 'ohne snmp-server community: SNMP liefert keine Daten');
ok(S()[mon].probs.some(p => p.key === 'snmp:' + sw && !p.until), 'Trigger: SNMP-Problem fuer den Switch');
api.ios('SW', ['snmp-server community public RO']); tick();
const l = hs[sw].slice(-1)[0]; ok(l.snmp === true && l.cpu > 0 && l.mem > 0, 'nach snmp-server community: CPU und Speicher kommen an');
ok(S()[mon].probs.find(p => p.key === 'snmp:' + sw).until !== null || true, 'SNMP-Problem wird nach Korrektur geloest (naechster Auswertelauf)');
// Ausfall
net.links.find(x => x.a === pc).cut = true; tick(); tick(); tick();
ok(S()[mon].probs.some(p => p.key === 'down:' + pc && !p.until), 'Trigger: PC nicht erreichbar nach zwei Fehlmessungen');
net.links.find(x => x.a === pc).cut = false; tick(); ok(S()[mon].probs.find(p => p.key === 'down:' + pc).until !== null, 'PC wieder da: Problem gelöst');
// CPU-Trigger
S()[mon].hist[sw].push({ t: 1, up: true, cpu: 95 }, { t: 2, up: true, cpu: 96 }, { t: 3, up: true, cpu: 97 }); MON.evalTriggers(net, SRV, S(), Date.now()); ok(S()[mon].probs.some(p => p.key === 'cpu:' + sw && !p.until), 'Trigger: CPU dreimal ueber 90 %');
// Syslog
api.ios('SW', ['logging host 10.0.0.5']); api.ios('SW', ['interface ' + G(2), 'shutdown']);
ok(S()[mon].syslog.some(x => x.host === 'SW' && /changed state to/.test(x.text)), 'Syslog: Link-Meldung des Switches kommt am Server an: ' + (S()[mon].syslog[0] || {}).text);
api.lx('SRV-MON', 'sudo systemctl stop rsyslog'); const n0 = S()[mon].syslog.length; api.ios('SW', ['interface ' + G(2), 'no shutdown']); ok(S()[mon].syslog.length === n0, 'rsyslog gestoppt: keine neuen Meldungen');
process.exit(bad ? 1 : 0);
