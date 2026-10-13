// DHCP: Cisco-Pool am Switch, Ausschluss, Relay (ip helper-address) und ASA-dhcpd
global.NL = require('../src/engine.js'); global.window = undefined;
const SB = require('../src/sandbox.js');
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const net = SB.example(), api = SB.testApi(net), by = h => Object.values(net.devs).find(d => d.cfg.hostname === h);
const pc = by('PC-101'), core = by('SW-CORE'), srv = by('SRV-HW01');
pc.cfg.dhcp = true; pc.cfg.ip = null; pc.cfg.mask = null;
const r0 = api.dhcp(pc); ok(r0.err && /DHCP/.test(r0.err), 'ohne DHCP-Dienst: Fehler mit Hinweis');
api.ios('SW-CORE', ['ip dhcp excluded-address 10.30.0.1 10.30.0.20', 'ip dhcp pool CLIENTS', 'network 10.30.0.0 255.255.255.0', 'default-router 10.30.0.1', 'dns-server 10.10.0.53', 'exit']);
const r1 = api.dhcp(pc); ok(r1.ok && r1.ip === '10.30.0.21' && r1.gw === '10.30.0.1' && r1.dns === '10.10.0.53', 'Cisco-Pool vergibt erste freie Adresse nach dem Ausschluss: ' + JSON.stringify(r1));
ok(/10\.30\.0\.21/.test(api.iosShow('SW-CORE', 'show ip dhcp binding')), 'show ip dhcp binding zeigt die Vergabe');
ok(/ip dhcp excluded-address/.test(api.iosShow('SW-CORE', 'show running-config')) && /ip dhcp pool CLIENTS/.test(api.iosShow('SW-CORE', 'show running-config')), 'Running-Config enthaelt Pool und Ausschluss');
ok(/% Syntax/.test(api.ios('SW-CORE', ['ip dhcp pool X', 'network 1.2.3.4', 'exit'])), 'network ohne Maske wird abgelehnt');
api.ios('SW-CORE', ['no ip dhcp pool CLIENTS']); pc.cfg.ip = null; pc.cfg.mask = null; if (pc.dhcpLease) pc.dhcpLease = null;
ok(!api.dhcp(pc).ok, 'Pool geloescht: keine Vergabe mehr');
// Relay zu einem Linux-DHCP-Server
const sv = by('SRV-HW01'); sv.svc.dhcp = { on: true, start: '10.30.0.100', mask: '255.255.255.0', gw: '10.30.0.1', dns: '10.10.0.53', max: 20, leases: {} };
api.ios('SW-CORE', ['interface vlan 30', 'ip helper-address 10.10.0.99', 'exit']);
const r2 = api.dhcp(pc); ok(r2.err && /Relay/.test(r2.err), 'Relay mit falscher Server-IP: Hinweis auf den Relay');
api.ios('SW-CORE', ['interface vlan 30', 'ip helper-address 10.10.0.11', 'exit']);
const r3 = api.dhcp(pc); ok(r3.ok && r3.ip === '10.30.0.100' && r3.server === 'SRV-HW01', 'Relay: Linux-Server vergibt Adresse aus seinem Pool: ' + JSON.stringify(r3));
sv.svc.dhcp.start = '10.50.0.100'; pc.cfg.ip = null; sv.svc.dhcp.leases = {};
const r4 = api.dhcp(pc); ok(r4.err && /liegt nicht im Subnetz/.test(r4.err), 'Pool passt nicht zum Relay-Subnetz: klare Meldung');
ok(/ip helper-address 10\.10\.0\.11/.test(api.iosShow('SW-CORE', 'show running-config')), 'helper-address steht in der Running-Config');
process.exit(bad ? 1 : 0);
