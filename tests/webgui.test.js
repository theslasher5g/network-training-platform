// Seitenaufbau aller Web-GUIs ohne DOM: jede Seite jedes Geraetetyps muss ohne Fehler rendern
global.NL = require('../src/engine.js'); global.window = undefined;
const SB = require('../src/sandbox.js'), GUI = require('../src/webgui.js');
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const probe = SB.testApi(SB.example()); let pages = 0, kinds = new Set();
for (const id of ['sc-lx-web', 'sc-st-lun', 'sc-win-ad', 'sc-win-dhcp', 'sc-vm-ha', 'sc-vm-migrate', 'sc-st-zone']) {
  const net = probe.buildScen(id); const api = SB.testApi(net);
  for (const d of Object.values(net.devs)) {
    if (!GUI.hasGui(d)) continue; kinds.add(GUI.kindOf(d));
    for (const p of GUI.pages(d.id)) { try { const h = GUI.renderPage(d.id, p); if (typeof h !== 'string' || /Fehler beim Laden/.test(h) || /undefined|\[object/.test(h)) throw new Error('Inhalt unplausibel: ' + String(h).slice(0, 80)); pages++; } catch (e) { ok(false, `${id} ${d.cfg.hostname} Seite ${p}: ${e.message}`); } }
  }
}
ok(['linux', 'hypervisor', 'windows', 'storage', 'fabric'].every(k => kinds.has(k)), 'alle fuenf Oberflaechen-Arten getestet: ' + [...kinds].join(', '));
ok(pages > 80, pages + ' Seiten gerendert');
process.exit(bad ? 1 : 0);
