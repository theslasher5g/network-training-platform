// Backup und Restore, Retention, Quota, Restore-Test, Snapshots
global.NL = require('../src/engine.js'); global.window = undefined;
const SB = require('../src/sandbox.js'), BKP = require('../src/backup.js'), LXm = require('../src/linux.js'), ST = require('../src/storage.js');
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const net = { devs: {}, links: [], seq: 1 }, api = SB.testApi(net), A = (m, h) => api.addDev(m, 0, 0, h), G = n => 'GigabitEthernet1/0/' + n;
const bk = A('HW-1288H-V5', 'SRV-BKP'), web = A('HW-1288H-V5', 'SRV-WEB'), sw = A('C9200L-24T-4G', 'SW'), rt = A('ISR4321', 'R-GW');
const cu = (a, ap, b, bp) => net.links.push({ a, ap, b, bp, cable: 'cu' }); cu(bk, 'eth0', sw, G(1)); cu(web, 'eth0', sw, G(2)); cu(rt, 'GigabitEthernet0/0/0', sw, G(24));
{ const s = NL.newSess(); ['enable', 'configure terminal', 'interface g0/0/0', 'ip address 10.0.0.1 255.255.255.0', 'no shutdown', 'end'].forEach(l => NL.exec(net, rt, s, l)); }
api.hostLine(net.devs[bk], NL.newSess(), 'ip 10.0.0.5/24 10.0.0.1'); api.hostLine(net.devs[web], NL.newSess(), 'ip 10.0.0.10/24 10.0.0.1'); api.ios('SW', ['interface vlan 1', 'ip address 10.0.0.2 255.255.255.0', 'no shutdown']);
const SRV = net.devs[bk], WEB = net.devs[web], H = api.bkH();
ok(!BKP.isBackup(net, SRV), 'ohne Paket kein Backup-Server');
api.lx('SRV-BKP', 'sudo apt install backup-server'); api.lx('SRV-BKP', 'sudo systemctl enable --now backup-server'); ok(BKP.isBackup(net, SRV), 'backup-server installiert und gestartet');
ok(BKP.addJob(net, SRV, { name: 'J-SW', src: sw, keep: 3 }).ok && BKP.addJob(net, SRV, { name: 'J-WEB', src: web, keep: 2 }).ok && BKP.addJob(net, SRV, { name: 'J-R', src: rt, keep: 3 }).ok, 'drei Jobs angelegt');
const jobs = BKP.st(SRV).jobs, J = n => jobs.find(j => j.name === n);
let r = BKP.runJob(net, SRV, J('J-SW'), H); ok(r.err && /Benutzer/.test(r.err), 'Switch ohne Backup-Benutzer: ' + r.err);
api.ios('SW', ['username backup privilege 15 secret Backup#2026']); r = BKP.runJob(net, SRV, J('J-SW'), H); ok(r.err && /SSH/.test(r.err), 'Benutzer da, aber kein SSH-Schluessel: ' + r.err);
api.ios('SW', ['ip domain-name lab.local', 'crypto key generate rsa modulus 2048']); r = BKP.runJob(net, SRV, J('J-SW'), H); ok(r.ok, 'Switch gesichert');
const w = LXm.init(WEB); w.ufw.on = true; r = BKP.runJob(net, SRV, J('J-WEB'), H); ok(r.err && /ufw/.test(r.err), 'ufw blockt SSH: ' + r.err);
w.ufw.allow.push('22'); r = BKP.runJob(net, SRV, J('J-WEB'), H); ok(r.ok, 'Linux-Server gesichert (' + r.size + ' MB)');
// Wiederherstellung einer Datei
LXm.saveFile(WEB, '/etc/nginx/nginx.conf', 'server { listen 80; server_name _; root /var/www/html; }\n'); api.advanceDays(1);
const good = BKP.st(SRV).store.filter(b => b.job === J('J-WEB').id).slice(-1)[0]; LXm.saveFile(WEB, '/etc/nginx/nginx.conf', 'KAPUTT {{{'); api.advanceDays(1);
ok(LXm.readFile(LXm.init(WEB), '/etc/nginx/nginx.conf') === 'KAPUTT {{{', 'Konfiguration wurde kaputt gemacht');
r = BKP.restore(net, SRV, good.id, H); ok(r.ok && /listen 80/.test(LXm.readFile(LXm.init(WEB), '/etc/nginx/nginx.conf')), 'Restore stellt die alte nginx.conf wieder her');
// Retention
api.advanceDays(5); ok(BKP.st(SRV).store.filter(b => b.job === J('J-WEB').id).length === 2, 'Retention: nur 2 Sicherungen bleiben');
// Restore-Test
ok(J('J-SW').tested === null, 'noch kein Restore-Test'); const sb = BKP.st(SRV).store.find(b => b.job === J('J-SW').id); ok(BKP.testRestore(net, SRV, sb.id, H).ok && J('J-SW').tested !== null, 'Restore-Test bestanden und vermerkt');
// Konfiguration des Switches zurueckholen
api.ios('SW', ['hostname FALSCH']); const sbk = BKP.st(SRV).store.filter(b => b.job === J('J-SW').id).slice(-1)[0]; ok(BKP.restore(net, SRV, sbk.id, H).ok && net.devs[sw].cfg.hostname === 'SW', 'Switch-Konfiguration wiederhergestellt');
// Quota
BKP.st(SRV).quotaMb = BKP.usedMb(SRV); r = BKP.runJob(net, SRV, J('J-SW'), H); ok(r.err && /Speicherplatz/.test(r.err), 'Quota voll: ' + (r.err || 'ok'));
BKP.st(SRV).quotaMb = 5; BKP.st(SRV).store.length && api.advanceDays(1); ok(BKP.st(SRV).log.some(l => !l.ok && /Speicherplatz/.test(l.msg)), 'Speicher voll: Job schlaegt fehl, steht im Protokoll');
// Snapshots
const sto = A('HW-Dorado-5000V6', 'STO'), T = net.devs[sto];
ST.createPool(T, { name: 'P', raid: 'raid5', disks: 4, diskGb: 600 }); ST.createLun(T, { name: 'L1', pool: 'P', gb: 400 });
const f0 = ST.poolInfo(T, ST.st(T).pools[0]).free; ok(ST.snapCreate(T, 0, 'vor-update', 3).ok && ST.poolInfo(T, ST.st(T).pools[0]).free === f0 - 20, 'Snapshot reserviert 5 % der LUN (20 GB)');
ST.snapCreate(T, 0, 'zwei', 4); ST.snapCreate(T, 0, 'drei', 5); const rb = ST.snapRollback(T, 0, 'vor-update'); ok(rb.ok && rb.dropped === 2 && ST.st(T).luns[0].snaps.length === 1, 'Rollback verwirft neuere Snapshots');
ST.snapPolicy(T, 0, 2); api.advanceDays(3); ok(ST.st(T).luns[0].snaps.filter(s => /^auto-/.test(s.name)).length === 2, 'Richtlinie: täglich ein Snapshot, 2 bleiben');
ST.createLun(T, { name: 'L2', pool: 'P', gb: 1200 }); ST.snapPolicy(T, 1, 5); const before = (ST.st(T).events || []).length; api.advanceDays(10); ok((ST.st(T).events || []).length > before, 'Pool voll: Snapshot-Richtlinie meldet Fehler');
process.exit(bad ? 1 : 0);
