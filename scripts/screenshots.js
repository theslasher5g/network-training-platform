// Erzeugt die Screenshots für die README: node scripts/screenshots.js
// Braucht Playwright (playwright-core) und einen Chromium. Pfade lassen sich per Umgebungsvariable anpassen.
const { chromium } = require(process.env.PLAYWRIGHT_CORE || '/opt/node-tools/node_modules/playwright-core');
const path = require('path'), out = path.join(__dirname, '..', 'docs', 'screenshots'), url = 'file://' + path.join(__dirname, '..', 'dist', 'netlab.html');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const shot = async n => { await p.waitForTimeout(250); await p.screenshot({ path: path.join(out, n + '.png') }); console.log(n); };
  const fresh = async (hash, wipe) => { await p.goto(url + hash); if (wipe) { await p.evaluate(() => localStorage.clear()); await p.goto(url + hash); await p.reload(); } await p.waitForTimeout(500); };
  const click = async n => { const bx = await (await p.$(`.dev[aria-label^="${n}"]`)).boundingBox(); await p.mouse.click(bx.x + bx.width / 2, bx.y + bx.height / 2 - 6); await p.waitForTimeout(300); };
  const login = async root => { if (!(await p.$(root + ' .wg-lc, ' + root + ' .as-lb'))) return; await p.click(root + ' .wg-lc button[type=submit], ' + root + ' .as-lb button[type=submit]'); await p.waitForTimeout(250); };

  await fresh('', true); await shot('01-start');
  await fresh('#lab/1'); await shot('02-lab');
  await fresh('#sandbox', true); await shot('03-netzplaner');
  await click('SW-CORE'); await shot('04-details');
  await p.click('.rb.add'); await p.waitForTimeout(250); await shot('05-geraetekatalog'); await p.click('#flyX');
  await p.click('#segv [data-v=sys]'); await p.waitForTimeout(400); await p.click('.sysi:has-text("SW-CORE")'); await p.waitForTimeout(300); await login('.sysmount'); await p.click('.sysmount .wg-nav button:has-text("Schnittstellen")'); await shot('06-systeme-switch');
  await p.click('.sysi:has-text("FW-01")'); await p.waitForTimeout(300); await login('.sysmount'); await p.click('.sysmount .as-tab:has-text("Konfiguration")'); await p.click('.sysmount .as-nav button:has-text("Zugriffsregeln")'); await shot('07-firewall-asdm');
  await p.click('.sysi:has-text("STO-01")'); await p.waitForTimeout(300); await login('.sysmount'); await p.click('.sysmount .wg-nav button:has-text("Speicherpools")'); await shot('08-storage');
  await p.click('.sysi:has-text("PC-101")'); await p.waitForTimeout(500);
  for (const n of ['Eingabeaufforderung', 'Webbrowser']) { await p.click('.dk-start'); await p.click(`#dk-menu button:has-text("${n}")`); await p.waitForTimeout(150); }
  await p.fill('.dk-win:last-child .dk-url input', 'https://10.10.0.1/'); await p.press('.dk-win:last-child .dk-url input', 'Enter'); await p.waitForTimeout(300);
  if (await p.$('.dk-win:last-child .wg-lc')) await p.click('.dk-win:last-child .wg-lc button[type=submit]'); await p.waitForTimeout(250); await p.click('.dk-win:last-child .dk-wt button[data-w=max]'); await shot('09-pc-desktop');
  // HyperMetro-Szenario
  await fresh('#sandbox'); await p.click('#segv [data-v=plan]'); await p.click('.rb[data-s=scen]'); await p.click('.sci:has-text("HyperMetro mit Quorum")'); await p.waitForTimeout(400);
  await p.click('#segv [data-v=sys]'); await p.waitForTimeout(300);
  await p.click('.sysi:has-text("QSRV")'); await p.waitForTimeout(300); await login('.sysmount'); await p.click('.sysmount .wg-nav button:has-text("Software")'); await p.click('.sysmount button[data-c="sudo apt install quorum-server"]'); await p.waitForTimeout(200);
  await p.click('.sysmount .wg-nav button:has-text("Dienste")'); await p.click('.sysmount button[data-u="quorum-server"][data-c="start"]'); await p.waitForTimeout(200);
  await p.click('.sysi:has-text("STO-01")'); await p.waitForTimeout(300); await login('.sysmount');
  await p.click('.sysmount .wg-nav button:has-text("HyperMetro")'); await p.click('button:has-text("Domäne erstellen")'); await p.waitForTimeout(150);
  const qs = await p.$$eval('#wf-q option', o => o.map(x => [x.value, x.textContent])); const q = qs.find(x => /QSRV/.test(x[1])); if (q) await p.selectOption('#wf-q', q[0]);
  await p.click('.wg-dlg button[type=submit]'); await p.waitForTimeout(200); await p.click('button:has-text("Replikationszonen anlegen")'); await p.click('button:has-text("Paar erstellen")'); await p.click('.wg-dlg button[type=submit]'); await p.waitForTimeout(250);
  await p.evaluate(() => document.querySelector('.sysmount .wg-main').scrollTo(0, 0)); await shot('10-hypermetro');
  // WLAN-Szenario
  await fresh('#sandbox'); await p.click('#segv [data-v=plan]'); await p.click('.rb[data-s=scen]'); await p.click('.sci:has-text("Zwei Access Points am Controller")'); await p.waitForTimeout(400);
  await p.click('#segv [data-v=sys]'); await p.waitForTimeout(300); await p.click('.sysi:has-text("WLC")'); await p.waitForTimeout(300); await login('.sysmount');
  await p.click('.sysmount .wg-nav button:has-text("WLANs")'); await p.click('button:has-text("WLAN hinzufügen")'); await p.fill('#wf-n', 'Firma'); await p.fill('#wf-psk', 'Firma-2026'); await p.click('.wg-dlg button[type=submit]'); await p.waitForTimeout(200);
  for (const ap of ['AP-1', 'AP-2']) { await p.click(`.sysi:has-text("${ap}")`); await p.waitForTimeout(300); await login('.sysmount'); await p.click('.sysmount .wg-nav button:has-text("Controller")'); await p.fill('#wf-wlc', '10.0.0.70'); await p.click('button:has-text("Speichern")'); await p.waitForTimeout(200); }
  await p.click('.sysi:has-text("WLC")'); await p.waitForTimeout(300); await p.click('.sysmount .wg-nav button:has-text("Access Points")'); await shot('12-wlan');
  // Spanning Tree, Zertifikate, Kubernetes, Backup (jeweils Ausgangslage des Szenarios)
  const scen = async t => { await fresh('#sandbox'); await p.click('#segv [data-v=plan]'); await p.click('.rb[data-s=scen]'); await p.click(`.sci:has-text("${t}")`); await p.waitForTimeout(500); };
  await scen('Falsche Root Bridge'); await shot('13-spanning-tree');
  await scen('Die Webseite zeigt eine Warnung'); await p.click('#segv [data-v=sys]'); await p.waitForTimeout(300);
  await p.click('.sysi:has-text("SRV-WEB")'); await p.waitForTimeout(300); await login('.sysmount'); await p.click('.sysmount .wg-nav button:has-text("Zertifikate")'); await shot('14-zertifikate');
  await scen('Pods starten nicht'); await p.click('#segv [data-v=sys]'); await p.waitForTimeout(300); await p.click('.sysi:has-text("SRV-CT")'); await p.waitForTimeout(300); await login('.sysmount'); await p.click('.sysmount .wg-nav button:has-text("Container")'); await shot('15-kubernetes');
  await scen('Webserver-Konfiguration ist kaputt'); await p.click('#segv [data-v=sys]'); await p.waitForTimeout(300); await p.click('.sysi:has-text("SRV-BKP")'); await p.waitForTimeout(300); await login('.sysmount'); await p.click('.sysmount .wg-nav button:has-text("Backup")'); await p.click('.sysmount button[data-v=store]'); await shot('16-backup');
  await fresh('#wiki'); await shot('11-wiki');
  await b.close();
})();
