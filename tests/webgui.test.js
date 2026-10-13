// Seitenaufbau aller Web-GUIs ohne DOM: jede Seite jedes Geraetetyps muss ohne Fehler rendern
global.NL = require('../src/engine.js'); global.window = undefined;
const SB = require('../src/sandbox.js'), GUI = require('../src/webgui.js');
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const probe = SB.testApi(SB.example()); let pages = 0, kinds = new Set();
for (const id of ['sc-lx-web', 'sc-st-lun', 'sc-win-ad', 'sc-win-dhcp', 'sc-vm-ha', 'sc-vm-migrate', 'sc-st-zone', 'sc-fw']) {
  const net = probe.buildScen(id); const api = SB.testApi(net);
  for (const d of Object.values(net.devs)) {
    if (!GUI.hasGui(d)) continue; kinds.add(GUI.kindOf(d));
    for (const p of GUI.pages(d.id)) { try { const h = GUI.renderPage(d.id, p); if (typeof h !== 'string' || /Fehler beim Laden/.test(h) || /undefined|\[object/.test(h)) throw new Error('Inhalt unplausibel: ' + String(h).slice(0, 80)); pages++; } catch (e) { ok(false, `${id} ${d.cfg.hostname} Seite ${p}: ${e.message}`); } }
  }
}
ok(['linux', 'hypervisor', 'windows', 'storage', 'fabric', 'switch', 'firewall'].every(k => kinds.has(k)), 'alle fuenf Oberflaechen-Arten getestet: ' + [...kinds].join(', '));
ok(pages > 80, pages + ' Seiten gerendert');

// Cisco-Switch-GUI: Erreichbarkeit vom PC und Konfiguration ueber IOS-Befehle
{
  const net = SB.example(), api = SB.testApi(net), pc = Object.values(net.devs).find(d => d.cfg.hostname === 'PC-101'), sw = Object.values(net.devs).find(d => d.cfg.hostname === 'SW-CORE');
  const g = api.gui('PC-101', 'https://10.10.0.1/'); ok(g && g.id === sw.id, 'PC erreicht die Switch-Weboberflaeche per https://<IP>/');
  ok(api.gui('PC-101', 'https://10.10.0.1:8443/').err, 'Switch hat auf Port 8443 keine Weboberflaeche');
  ok(api.gui('PC-101', 'http://web.lab.local') === null, 'normale Webseiten bleiben unberuehrt');
  ok(GUI.portOf(sw) === 443 && GUI.hasGui(sw) && GUI.kindOf(sw) === 'switch', 'Switch: Port 443, Art switch');
  const out = api.ios('SW-CORE', ['vlan 77', 'name Test', 'exit', 'interface ' + sw.ports[8], 'switchport access vlan 77', 'exit']);
  ok(!/^%/m.test(out.replace(/% Access VLAN does not exist.*/, '')) && sw.cfg.vlans[77] === 'Test', 'VLAN ueber IOS-Befehle angelegt');
  ok(/vlan 77/.test(api.iosShow('SW-CORE', 'show running-config')), 'show running-config zeigt VLAN 77');
  const h = GUI.renderPage(sw.id, 'vlans'); ok(/77/.test(h) && /Test/.test(h), 'VLAN-Seite listet das neue VLAN');
  ok(/ACL/.test(GUI.renderPage(sw.id, 'acl')), 'ACL-Seite rendert');
  const bad = api.ios('SW-CORE', ['interface vlan 1', 'ip address 999.1.1.1 255.0.0.0', 'exit']); ok(/^%/m.test(bad), 'ungueltige IP liefert %-Fehler');
}
{
  const net = SB.example(), api = SB.testApi(net), fw = Object.values(net.devs).find(d => d.cfg.hostname === 'FW-01');
  ok(GUI.kindOf(fw) === 'firewall' && GUI.portOf(fw) === 443, 'ASA hat Firewall-Oberflaeche auf Port 443');
  const o = api.ios('FW-01', ['access-list GAST_IN extended permit tcp any any eq www', 'access-group GAST_IN in interface ' + Object.values(fw.cfg.ifs).find(i => i.nameif).nameif]);
  ok(!/^%/m.test(o) && fw.cfg.acls.GAST_IN.length === 1, 'Firewall-Regel ueber ASA-Befehle angelegt und gebunden: ' + o);
  ok(/GAST_IN/.test(GUI.renderPage(fw.id, 'rules')), 'Regelseite zeigt die neue Liste');
  const o2 = api.ios('FW-01', ['no access-group x in interface ' + Object.values(fw.cfg.ifs).find(i => i.nameif).nameif]); ok(!/^%/m.test(o2), 'Bindung loesen funktioniert');
}
process.exit(bad ? 1 : 0);
