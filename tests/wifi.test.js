// WLAN: Access Point (PoE, SSID, VLAN), Controller (CAPWAP-Join), Clients (PSK), DHCP ueber WLAN
global.NL = require('../src/engine.js'); global.window = undefined;
const SB = require('../src/sandbox.js');
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const net = { devs: {}, links: [], seq: 1 }, api = SB.testApi(net), A = (m, h) => api.addDev(m, 0, 0, h), G = n => 'GigabitEthernet1/0/' + n;
const poe = A('C9200L-24P-4X', 'SW-POE'), nopoe = A('C1000-8T-2G-L', 'SW-NOPOE'), ap = A('C9120AXI', 'AP-1'), lap = A('Laptop', 'LAP-1'), ph = A('Smartphone', 'PH-1'), srv = A('HW-1288H-V5', 'SRV'), r = A('ISR4331', 'R-GW'), wlc = A('C9800-L', 'WLC');
const cu = (a, ap_, b, bp) => net.links.push({ a, ap: ap_, b, bp, cable: 'cu' });
cu(ap, 'GigabitEthernet0', poe, G(1)); cu(srv, 'eth0', poe, G(2)); cu(r, 'GigabitEthernet0/0/1', poe, G(24)); cu(wlc, 'GigabitEthernet0/0/0', poe, G(3));
const rs = NL.newSess(); ['enable', 'configure terminal', 'interface g0/0/1', 'ip address 10.0.0.1 255.255.255.0', 'no shutdown', 'end'].forEach(l => NL.exec(net, r, rs, l));
const H = (id, ip) => api.hostLine(net.devs[id], NL.newSess(), `ip ${ip}/24 10.0.0.1`);
H(srv, '10.0.0.10'); H(ap, '10.0.0.60'); H(wlc, '10.0.0.70');
const AP = net.devs[ap], L = net.devs[lap], P = net.devs[ph], W = net.devs[wlc], SRV = net.devs[srv];
ok(NL.apPower(net, AP).ok && /PoE/.test(NL.apPower(net, AP).via), 'AP am PoE-Switch hat Strom');
ok(NL.wifiScan(net).length === 0, 'ohne SSID sieht der Client kein WLAN');
ok(NL.wifiConnect(net, L, 'Gast', 'x').err, 'Verbinden ohne SSID scheitert');
NL.apState(AP).ssids.push({ name: 'Gast', sec: 'wpa2', psk: 'Geheim-2026', vlan: 0, on: true });
ok(NL.wifiConnect(net, L, 'Gast', 'falsch').err && /Schlüssel/.test(NL.wifiConnect(net, L, 'Gast', 'falsch').err), 'falscher WLAN-Schluessel wird abgelehnt');
const c1 = NL.wifiConnect(net, L, 'Gast', 'Geheim-2026'); ok(c1.ok && c1.ap === 'AP-1', 'richtiger Schluessel: verbunden mit AP-1');
H(lap, '10.0.0.20'); ok(NL.ping(net, lap, '10.0.0.10').ok, 'Notebook im WLAN erreicht den Server (gleiches VLAN, untagged)');
NL.apState(AP).ssids[0].psk = 'neu'; ok(!NL.ping(net, lap, '10.0.0.10').ok && /Authentifizierung/.test(NL.ping(net, lap, '10.0.0.10').reason + (NL.portStatus(net, lap, 'wlan0').reason)), 'Schluessel am AP geaendert: Client verliert die Verbindung');
NL.apState(AP).ssids[0].psk = 'Geheim-2026';
// VLAN-Zuordnung: SSID in VLAN 20 braucht Trunk zum AP
const rs2 = NL.newSess(); ['enable', 'configure terminal', 'vlan 20', 'exit', 'end'].forEach(l => NL.exec(net, poe, rs2, l)); NL.apState(AP).ssids[0].vlan = 20;
ok(!NL.ping(net, lap, '10.0.0.10').ok, 'SSID in VLAN 20, Switchport ist Access: keine Verbindung');
['enable', 'configure terminal', 'interface ' + G(1), 'switchport mode trunk', 'switchport trunk native vlan 1', 'switchport trunk allowed vlan 1,20', 'end'].forEach(l => NL.exec(net, poe, rs2, l));
ok(!NL.ping(net, lap, '10.0.0.10').ok, 'Trunk ok, aber Server liegt in VLAN 1: Notebook (VLAN 20) erreicht ihn nicht');
NL.apState(AP).ssids[0].vlan = 0; ok(NL.ping(net, lap, '10.0.0.10').ok, 'SSID untagged auf dem Trunk (nativ VLAN 1): erreichbar');
// PoE
NL.exec(net, poe, rs2, 'x'); const uplink = net.links.find(l => l.a === ap); uplink.b = nopoe; uplink.bp = G(1).replace('1/0/1', '1/0/1');
ok(!NL.apPower(net, AP).ok && !NL.ping(net, lap, '10.0.0.10').ok, 'Am Nicht-PoE-Switch ist der AP stromlos, WLAN weg');
NL.apState(AP).injector = true; ok(NL.apPower(net, AP).ok, 'PoE-Injector versorgt den AP'); uplink.b = poe; uplink.bp = G(1); NL.apState(AP).injector = false;
// Controller (lightweight)
NL.apState(AP).wlc = '10.0.0.70'; ok(NL.apSsids(net, AP).length === 0 && !NL.ping(net, lap, '10.0.0.10').ok, 'AP im Controller-Modus ohne Join: keine lokalen SSIDs');
NL.wlcState(W).ssids.push({ name: 'Firma', sec: 'wpa2', psk: 'Firma-2026', vlan: 0, on: true });
ok(NL.apJoined(net, AP).ok, 'AP joint den Controller'); ok(NL.wifiConnect(net, P, 'Firma', 'Firma-2026').ok, 'Smartphone verbindet sich mit der Controller-SSID');
H(ph, '10.0.0.21'); ok(NL.ping(net, ph, '10.0.0.10').ok, 'Smartphone erreicht den Server');
W.off = true; ok(!NL.apJoined(net, AP).ok && !NL.ping(net, ph, '10.0.0.10').ok, 'Controller aus: AP verliert Join, WLAN weg');
// DHCP ueber WLAN
W.off = false; NL.apState(AP).wlc = ''; NL.apState(AP).ssids[0].on = true; NL.wifiConnect(net, L, 'Gast', 'Geheim-2026');
SRV.svc = SRV.svc || {}; SRV.svc.dhcp = { on: true, start: '10.0.0.100', mask: '255.255.255.0', gw: '10.0.0.1', dns: '', max: 20, leases: {} };
L.cfg.dhcp = true; L.cfg.ip = null; const d1 = api.dhcp(L); ok(d1.ok && d1.ip === '10.0.0.100', 'Notebook bekommt per DHCP ueber das WLAN eine Adresse: ' + JSON.stringify(d1));
process.exit(bad ? 1 : 0);
