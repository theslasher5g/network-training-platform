// ===================== NetLab Backup und Restore =====================
// Ein Linux-Server mit dem Paket backup-server sichert Konfigurationen und Dateien anderer Geräte.
// Aufbewahrung (Retention), Speicherplatz, Zugriffsvoraussetzungen und Restore-Test sind simuliert.
// Die Simulationszeit zählt in Tagen (net.day); der erste Tag ist der 13.10.2026.
const BKP = (function () {
  const N = typeof NL !== 'undefined' ? NL : require('./engine.js');
  const BASE = Date.UTC(2026, 9, 13);
  const dateOf = day => new Date(BASE + (day || 0) * 86400000).toISOString().slice(0, 10);
  const st = d => d.bkp || (d.bkp = { jobs: [], store: [], log: [], seq: 1, quotaMb: 200 });
  const unitOn = (d, u) => !!(d.lx && d.lx.pkgs && d.lx.pkgs.includes(u) && d.lx.units[u] && d.lx.units[u].active);
  const isBackup = (net, d) => !!d && d.type === 'server' && !N.isDown(d) && unitOn(d, 'backup-server');
  const ipOf = d => { if (N.isHost(d)) { for (const p of d.ports) { const h = N.hip(d, p); if (h && h.ip) return h.ip; } return null; } const n = Object.keys(d.cfg.ifs).find(k => d.cfg.ifs[k].ip && !k.startsWith('Tunnel')); return n ? d.cfg.ifs[n].ip : null; };
  const kindOf = d => d.type === 'switch' || d.type === 'router' ? 'net' : d.type === 'wlc' ? 'wlc' : d.type === 'storage' ? 'storage' : d.type === 'server' ? (d.os === 'windows' ? 'windows' : 'linux') : 'other';
  const KIND = { net: 'Konfiguration (running-config)', wlc: 'Controller-Konfiguration', storage: 'Array-Konfiguration', linux: 'Dateien (/etc, /var/www, /home)', windows: 'Dateien (Benutzer, Inetpub, Freigaben)', other: '–' };
  const PATHS = ['/etc', '/var/www', '/home', '/srv'];
  const usedMb = srv => st(srv).store.reduce((s, b) => s + b.size, 0);

  // Zugriff: Erreichbarkeit und die Voraussetzungen des Gerätetyps
  function access(net, srv, src, H) {
    if (!src) return { ok: false, why: 'Die Quelle existiert nicht mehr.' }; if (N.isDown(src)) return { ok: false, why: `${src.cfg.hostname} ist ausgeschaltet.` };
    const ip = ipOf(src); if (!ip) return { ok: false, why: `${src.cfg.hostname} hat keine IP-Adresse.` };
    const r = N.ping(net, srv.id, ip); if (!r.ok) return { ok: false, why: `Keine Verbindung zu ${src.cfg.hostname} (${ip}): ${r.reason}` };
    const k = kindOf(src);
    if (k === 'net') {
      if (!src.cfg.lines.some(l => /^username \S+/i.test(l))) return { ok: false, why: `${src.cfg.hostname}: Kein Benutzer für den Zugriff (username backup privilege 15 secret …).` };
      if (!src.cfg.rsa) return { ok: false, why: `${src.cfg.hostname}: SSH ist nicht aktiv (ip domain-name und crypto key generate rsa fehlen).` };
    }
    if (k === 'linux') {
      const L = H.LX.init(src); if (!L.pkgs.includes('openssh-server') || !(L.units.ssh && L.units.ssh.active)) return { ok: false, why: `${src.cfg.hostname}: SSH-Dienst läuft nicht.` };
      if (L.ufw.on && !L.ufw.allow.some(a => String(a).split('/')[0] === '22')) return { ok: false, why: `${src.cfg.hostname}: Die Firewall (ufw) blockt Port 22.` };
    }
    if (k === 'other') return { ok: false, why: `${src.cfg.hostname}: Dieser Gerätetyp lässt sich nicht sichern.` };
    return { ok: true };
  }
  function snapshot(net, src, H) {
    const k = kindOf(src);
    if (k === 'net' || k === 'wlc') return { size: 1, data: { cfg: JSON.stringify(src.cfg), text: H.cfgOf ? H.cfgOf(net, src) : '' } };
    if (k === 'linux') { const fs = H.LX.init(src).fs, sub = {}; let bytes = 0; for (const p of Object.keys(fs)) { if (!PATHS.some(x => p === x || p.startsWith(x + '/'))) continue; sub[p] = JSON.parse(JSON.stringify(fs[p])); bytes += (fs[p].t || '').length; } return { size: 5 + Math.round(bytes / 500), data: { fs: sub } }; }
    if (k === 'windows') { const f = H.WIN.init(src).files, sub = {}; let bytes = 0; for (const p of Object.keys(f)) { if (/^C:\\(Users|inetpub)/.test(p) || /^D:/.test(p)) { sub[p] = JSON.parse(JSON.stringify(f[p])); bytes += (f[p].t || '').length; } } return { size: 10 + Math.round(bytes / 500), data: { files: sub } }; }
    if (k === 'storage') return { size: 2, data: { stor: JSON.stringify(src.stor || null) } };
    return { size: 1, data: {} };
  }
  function prune(srv, job) { const S = st(srv), mine = S.store.filter(b => b.job === job.id).sort((a, b) => a.day - b.day || a.id - b.id); while (mine.length > job.keep) { const o = mine.shift(); S.store = S.store.filter(b => b !== o); } }
  function log(srv, day, job, ok, msg) { const S = st(srv); S.log.push({ day, job: job ? job.name : '–', ok, msg }); if (S.log.length > 200) S.log.splice(0, 50); }
  function runJob(net, srv, job, H) {
    const S = st(srv), day = net.day || 0;
    if (!isBackup(net, srv)) { log(srv, day, job, false, 'Der Backup-Dienst läuft nicht.'); return { err: 'Der Dienst backup-server läuft nicht.' }; }
    const src = net.devs[job.src], ac = access(net, srv, src, H); if (!ac.ok) { job.last = { day, ok: false, msg: ac.why }; log(srv, day, job, false, ac.why); return { err: ac.why }; }
    const sn = snapshot(net, src, H); if (usedMb(srv) + sn.size > S.quotaMb) { const m = `Speicherplatz auf dem Backup-Server erschöpft (${usedMb(srv)} von ${S.quotaMb} MB belegt, die Sicherung braucht ${sn.size} MB). Retention senken oder alte Sicherungen löschen.`; job.last = { day, ok: false, msg: m }; log(srv, day, job, false, m); return { err: m }; }
    S.store = S.store.filter(b => !(b.job === job.id && b.day === day)); S.store.push({ id: S.seq++, job: job.id, src: job.src, day, size: sn.size, data: sn.data, kind: kindOf(src) });
    prune(srv, job); job.last = { day, ok: true, msg: `${sn.size} MB gesichert` }; log(srv, day, job, true, `${src.cfg.hostname}: ${sn.size} MB gesichert`); return { ok: true, size: sn.size };
  }
  function addJob(net, srv, o) {
    const S = st(srv), name = String(o.name || '').trim(), src = net.devs[o.src], keep = Math.round(+o.keep);
    if (!/^[A-Za-z0-9][\w-]{0,30}$/.test(name)) return { err: 'Jobname: Buchstaben, Ziffern, - und _ .' }; if (S.jobs.some(j => j.name === name)) return { err: `Einen Job „${name}“ gibt es schon.` };
    if (!src) return { err: 'Wähle ein Gerät als Quelle.' }; if (kindOf(src) === 'other') return { err: 'Dieser Gerätetyp lässt sich nicht sichern.' };
    if (!(keep >= 1 && keep <= 60)) return { err: 'Aufbewahrung: 1 bis 60 Sicherungen.' };
    S.jobs.push({ id: S.seq++, name, src: o.src, keep, tested: null, last: null }); return { ok: true };
  }
  function delJob(srv, id) { const S = st(srv); S.jobs = S.jobs.filter(j => j.id !== id); S.store = S.store.filter(b => b.job !== id); return { ok: true }; }
  function delBackup(srv, id) { const S = st(srv); S.store = S.store.filter(b => b.id !== id); return { ok: true }; }
  // Wiederherstellung auf das Quellgerät
  function restore(net, srv, bid, H) {
    const S = st(srv), b = S.store.find(x => x.id === bid); if (!b) return { err: 'Sicherung nicht gefunden.' };
    const src = net.devs[b.src]; const ac = access(net, srv, src, H); if (!ac.ok) return { err: 'Wiederherstellung nicht möglich: ' + ac.why };
    if (b.kind === 'net' || b.kind === 'wlc') { src.cfg = JSON.parse(b.data.cfg); src.saved = true; if (src.type === 'switch' || src.type === 'router') src.startup = b.data.cfg; }
    else if (b.kind === 'linux') { const fs = H.LX.init(src).fs; Object.keys(fs).forEach(p => { if (PATHS.some(x => p === x || p.startsWith(x + '/')) && !b.data.fs[p]) delete fs[p]; }); Object.assign(fs, JSON.parse(JSON.stringify(b.data.fs))); }
    else if (b.kind === 'windows') { const f = H.WIN.init(src).files; Object.keys(f).forEach(p => { if ((/^C:\\(Users|inetpub)/.test(p) || /^D:/.test(p)) && !b.data.files[p]) delete f[p]; }); Object.assign(f, JSON.parse(JSON.stringify(b.data.files))); if (H.WIN.sync && H.ctx) H.WIN.sync(H.ctx, src); }
    else if (b.kind === 'storage') { src.stor = JSON.parse(b.data.stor); }
    log(srv, net.day || 0, S.jobs.find(j => j.id === b.job), true, `Wiederhergestellt: ${src.cfg.hostname} auf Stand ${dateOf(b.day)}`); return { ok: true, dev: src.cfg.hostname, day: b.day };
  }
  // Restore-Test: prüft, ob sich die Sicherung lesen und zuordnen lässt, ohne das Gerät zu verändern
  function testRestore(net, srv, bid, H) {
    const S = st(srv), b = S.store.find(x => x.id === bid); if (!b) return { err: 'Sicherung nicht gefunden.' }; const job = S.jobs.find(j => j.id === b.job);
    const src = net.devs[b.src]; if (!src) return { err: 'Die Quelle existiert nicht mehr.' }; const ac = access(net, srv, src, H); if (!ac.ok) return { err: 'Restore-Test fehlgeschlagen: ' + ac.why };
    const okData = b.kind === 'net' || b.kind === 'wlc' ? (() => { try { return !!JSON.parse(b.data.cfg).hostname; } catch (e) { return false; } })() : b.kind === 'linux' ? Object.keys(b.data.fs).length > 0 : b.kind === 'windows' ? Object.keys(b.data.files).length > 0 : true;
    if (!okData) return { err: 'Die Sicherung ist leer oder beschädigt.' }; if (job) job.tested = net.day || 0; log(srv, net.day || 0, job, true, `Restore-Test bestanden (Sicherung vom ${dateOf(b.day)})`); return { ok: true };
  }
  // Ein Tag vergeht: alle Jobs laufen (Zeitplan täglich)
  function advance(net, H) { const out = []; for (const srv of Object.values(net.devs)) { if (srv.type !== 'server' || !srv.bkp || !srv.bkp.jobs.length) continue; for (const j of srv.bkp.jobs) { const r = runJob(net, srv, j, H); out.push({ srv: srv.cfg.hostname, job: j.name, ok: !!r.ok, msg: r.err || '' }); } } return out; }
  return { st, dateOf, isBackup, addJob, delJob, delBackup, runJob, restore, testRestore, advance, access, kindOf, KIND, usedMb, ipOf };
})();
if (typeof module !== 'undefined') module.exports = BKP;
