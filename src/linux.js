// ===================== NetLab Linux-Terminal (Server) =====================
// Vereinfachtes Ubuntu: Dateisystem, systemd-Dienste, apt, Benutzer, Netzwerkbefehle.
// Zustand liegt in d.lx (reines JSON). Dienste nginx, bind9 und isc-dhcp-server steuern d.svc.
const LX = (function () {
  const TOTAL = 20 * 1024 ** 3, BASE_USED = 5.8 * 1024 ** 3;
  const PKGS = {
    nginx: { d: 'Webserver', units: ['nginx'], bins: ['nginx'] }, bind9: { d: 'DNS-Server', units: ['bind9'], bins: ['named', 'rndc'] },
    'isc-dhcp-server': { d: 'DHCP-Server', units: ['isc-dhcp-server'], bins: ['dhcpd'] }, 'openssh-server': { d: 'SSH-Server', units: ['ssh'], bins: ['sshd'] },
    curl: { d: 'URL-Werkzeug', bins: ['curl'] }, nano: { d: 'Editor', bins: ['nano'] }, ufw: { d: 'Firewall-Frontend', bins: ['ufw'] },
    htop: { d: 'Prozessanzeige', bins: ['htop'] }, vim: { d: 'Editor', bins: ['vim'] }, tree: { d: 'Verzeichnisbaum', bins: ['tree'] },
    'net-tools': { d: 'ifconfig, netstat', bins: ['ifconfig', 'netstat', 'route', 'arp'] }, dnsutils: { d: 'dig', bins: ['dig'] }, tcpdump: { d: 'Paketmitschnitt', bins: ['tcpdump'] },
    'multipath-tools': { d: 'Multipathing für SAN-LUNs', bins: ['multipath', 'multipathd'] }
  };
  const PRE = ['curl', 'nano', 'ufw', 'openssh-server'];
  const UNITS = {
    nginx: { d: 'A high performance web server and a reverse proxy server', svc: 'http', port: '80', proto: 'tcp', proc: 'nginx' },
    bind9: { d: 'BIND Domain Name Server', svc: 'dns', port: '53', proto: 'udp', proc: 'named' },
    'isc-dhcp-server': { d: 'ISC DHCP IPv4 server', svc: 'dhcp', port: '67', proto: 'udp', proc: 'dhcpd' },
    ssh: { d: 'OpenBSD Secure Shell server', port: '22', proto: 'tcp', proc: 'sshd' }, cron: { d: 'Regular background program processing daemon', proc: 'cron' }, rsyslog: { d: 'System Logging Service', proc: 'rsyslogd' }
  };
  const ALIAS = { sshd: 'ssh', named: 'bind9', dhcpd: 'isc-dhcp-server', 'isc-dhcp': 'isc-dhcp-server' };
  const NGINX_CONF = 'server {\n    listen 80;\n    server_name _;\n    root /var/www/html;\n    index index.html;\n}\n';
  const DHCP_SAMPLE = '# Beispiel:\n# subnet 10.0.0.0 netmask 255.255.255.0 {\n#   range 10.0.0.100 10.0.0.150;\n#   option routers 10.0.0.1;\n#   option domain-name-servers 10.0.0.10;\n# }\n';
  const DB_SAMPLE = '$ORIGIN lab.local.\n$TTL 3600\n@   IN SOA ns.lab.local. admin.lab.local. ( 1 3600 600 86400 3600 )\n@   IN NS  ns.lab.local.\n';
  const DATE = 'Oct 12 09:00';
  const html2t = h => String(h).replace(/<title>[\s\S]*?<\/title>/i, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

  // ---------- Zustand ----------
  function init(d) {
    if (d.lx) return d.lx;
    const sv = d.svc || {}, name = d.cfg.hostname, fs = {};
    const dir = (p, o) => { fs[p] = { d: 1, o: o || 'root' }; }, file = (p, t, o, m) => { fs[p] = { t, o: o || 'root', m: m || '644' }; };
    ['/', '/bin', '/sys', '/sys/class', '/sys/class/scsi_host', '/sys/class/scsi_host/host0', '/sys/class/scsi_host/host1', '/etc', '/etc/nginx', '/etc/bind', '/etc/dhcp', '/home', '/root', '/tmp', '/usr', '/usr/bin', '/var', '/var/log', '/var/log/nginx', '/var/www', '/var/www/html', '/opt', '/srv', '/dev', '/proc'].forEach(p => dir(p));
    dir('/home/admin', 'admin'); dir('/tmp'); fs['/tmp'].m = '777';
    const pk = new Set(PRE); if (sv.http && sv.http.on) pk.add('nginx'); if (sv.dns && sv.dns.on) pk.add('bind9'); if (sv.dhcp && sv.dhcp.on) pk.add('isc-dhcp-server');
    file('/sys/class/scsi_host/host0/scan', '', 'root', '200'); file('/sys/class/scsi_host/host1/scan', '', 'root', '200');
    file('/etc/hostname', name + '\n'); file('/etc/hosts', `127.0.0.1 localhost\n127.0.1.1 ${name}\n`);
    file('/etc/os-release', 'PRETTY_NAME="Ubuntu 22.04.4 LTS"\nNAME="Ubuntu"\nVERSION_ID="22.04"\n'); file('/etc/shadow', 'root:*:19000:0:99999:7:::\n', 'root', '640');
    file('/var/log/syslog', `${DATE} ${name} systemd[1]: Started Daily apt download activities.\n`, 'syslog', '640'); file('/var/log/auth.log', `${DATE} ${name} sshd[701]: Server listening on 0.0.0.0 port 22.\n`, 'syslog', '640');
    file('/home/admin/notizen.txt', 'Hier kannst du Dateien anlegen und bearbeiten.\n', 'admin');
    if (pk.has('nginx')) { file('/etc/nginx/nginx.conf', NGINX_CONF); file('/var/www/html/index.html', `<html><head><title>${esc2(sv.http && sv.http.title || name)}</title></head><body>${esc2(sv.http && sv.http.body || 'Der Webserver läuft.')}</body></html>\n`, 'www-data'); file('/var/log/nginx/error.log', '', 'www-data'); file('/var/log/nginx/access.log', '', 'www-data'); }
    if (pk.has('bind9')) file('/etc/bind/db.lab', DB_SAMPLE + (sv.dns && sv.dns.records || []).map(r => `${r.name}. IN A ${r.ip === '@' ? (d.cfg.ip || '0.0.0.0') : r.ip}`).join('\n') + '\n');
    if (pk.has('isc-dhcp-server')) { const p = sv.dhcp || {}; file('/etc/dhcp/dhcpd.conf', p.start && p.mask ? dhcpText(d, p) : DHCP_SAMPLE); }
    const units = {}; Object.keys(UNITS).forEach(u => { units[u] = { enabled: true, active: !UNITS[u].svc, seen: null }; });
    Object.keys(UNITS).forEach(u => { const s = UNITS[u].svc; if (s) { units[u].active = !!(sv[s] && sv[s].on); units[u].seen = units[u].active; units[u].enabled = units[u].active; } });
    d.lx = { user: 'admin', root: false, cwd: '/home/admin', fs, pkgs: [...pk], units, users: ['root', 'admin'], fail: {}, log: [], ufw: { on: false, allow: [] }, pid: 600, scsi: null, fmt: {}, mounts: {} };
    return d.lx;
  }
  const esc2 = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  function dhcpText(d, p) { const m = p.mask, n = ipn(d.cfg.ip || p.start) & ipn(m), net = n2ip(n >>> 0), last = n2ip(ipn(p.start) + Math.max(0, (p.max || 1) - 1)); return `subnet ${net} netmask ${m} {\n  range ${p.start} ${last};\n${p.gw ? `  option routers ${p.gw};\n` : ''}${p.dns ? `  option domain-name-servers ${p.dns};\n` : ''}}\n`; }
  const ipn = ip => String(ip).split('.').reduce((a, b) => ((a << 8) + (+b)) >>> 0, 0), n2ip = n => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  const isIp = s => /^\d{1,3}(\.\d{1,3}){3}$/.test(s) && s.split('.').every(x => +x < 256);
  const maskLen = m => isIp(m) ? ipn(m).toString(2).replace(/0/g, '').length : null;

  // ---------- Dateisystem ----------
  const dirOf = p => p === '/' ? '/' : p.replace(/\/[^/]*$/, '') || '/', baseOf = p => p.replace(/^.*\//, '');
  function resolvePath(L, p) { if (p === '~' || p.startsWith('~/')) p = (L.root ? '/root' : '/home/' + L.user) + p.slice(1); const out = []; (p.startsWith('/') ? p : L.cwd + '/' + p).split('/').forEach(x => { if (!x || x === '.') return; if (x === '..') out.pop(); else out.push(x); }); return '/' + out.join('/'); }
  const kids = (L, dir) => Object.keys(L.fs).filter(k => k !== '/' && dirOf(k) === dir).sort();
  const sizeOf = e => e.d ? 4096 : e.s != null ? e.s : (e.t || '').length;
  const total = (L) => Object.values(L.fs).reduce((s, e) => s + (e.d ? 0 : sizeOf(e)), 0);
  const used = L => BASE_USED + total(L), diskFull = L => used(L) >= TOTAL;
  function hs(n) { const u = ['B', 'K', 'M', 'G']; let i = 0; while (n >= 1024 && i < 3) { n /= 1024; i++; } return (i === 0 || n >= 10 ? Math.round(n) : n.toFixed(1)) + (i ? u[i] : ''); }
  const modeStr = (e) => { const m = e.m || (e.d ? '755' : '644'); return (e.d ? 'd' : '-') + [...m].map(c => ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'][+c]).join(''); };
  function canWrite(L, st, p) { return st.root || p.startsWith('/home/' + L.user + '/') || p === '/home/' + L.user || p === '/tmp' || p.startsWith('/tmp/'); }
  function canRead(L, st, p) { return st.root || !(p === '/etc/shadow' || p === '/root' || p.startsWith('/root/')); }
  function writeFile(L, st, p, text, append) {
    if (!canWrite(L, st, p)) return `bash: ${p}: Permission denied`; const par = L.fs[dirOf(p)]; if (!par || !par.d) return `bash: ${p}: No such file or directory`;
    const e = L.fs[p]; if (e && e.d) return `bash: ${p}: Is a directory`;
    if (diskFull(L) && text) return `bash: echo: write error: No space left on device`;
    L.fs[p] = { t: (append && e ? (e.t || '') : '') + text, o: e ? e.o : (st.root ? 'root' : L.user), m: e ? e.m : '644' }; if (e && e.s != null && append) L.fs[p].s = e.s + text.length; return '';
  }
  const readFile = (L, p) => { const e = L.fs[p]; return e && !e.d ? (e.t || '') : null; };

  // ---------- Dienste ----------
  function jl(d, L, u, msg) { const line = `${DATE}:${String(L.log.length % 60).padStart(2, '0')} ${d.cfg.hostname} ${u}[${L.pid++}]: ${msg}`; L.log.push({ u, t: line }); if (L.log.length > 200) L.log.shift(); const e = L.fs['/var/log/syslog']; if (e) e.t = (e.t + line + '\n').split('\n').slice(-80).join('\n'); }
  function reconcile(d, L) { for (const u in UNITS) { const s = UNITS[u].svc, x = L.units[u]; if (!s || !d.svc) continue; if (x.seen !== d.svc[s].on) { if (x.seen !== null) x.active = d.svc[s].on; x.seen = d.svc[s].on; } } }
  const setSvc = (d, L, u, on) => { const s = UNITS[u].svc; if (s && d.svc) { d.svc[s].on = on; L.units[u].seen = on; } };
  function nginxCheck(L) {
    const t = readFile(L, '/etc/nginx/nginx.conf'); if (t === null) return { err: 'nginx: [emerg] open() "/etc/nginx/nginx.conf" failed (2: No such file or directory)' };
    const lines = t.split('\n'); let depth = 0, port = null;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim(); if (!l || l.startsWith('#')) continue;
      if (!/[;{}]$/.test(l)) return { err: `nginx: [emerg] directive "${l.split(/\s+/)[0]}" is not terminated by ";" in /etc/nginx/nginx.conf:${i + 1}` };
      depth += (l.match(/\{/g) || []).length - (l.match(/\}/g) || []).length; if (depth < 0) return { err: `nginx: [emerg] unexpected "}" in /etc/nginx/nginx.conf:${i + 1}` };
      const m = l.match(/^listen\s+(\d+)\s*;/); if (m && port === null) port = +m[1];
    }
    if (depth > 0) return { err: 'nginx: [emerg] unexpected end of file, expecting "}" in /etc/nginx/nginx.conf:' + lines.length };
    return { ok: true, port: port || 80 };
  }
  function applyConf(d, L, u) {
    if (u === 'nginx') {
      const c = nginxCheck(L); if (c.err) return c; const idx = readFile(L, '/var/www/html/index.html'), sv = d.svc;
      if (sv) { const m = idx && idx.match(/<title>([\s\S]*?)<\/title>/i); sv.http.title = m ? m[1] : d.cfg.hostname; sv.http.body = idx === null ? '404 Not Found (nginx)' : html2t(idx); }
      L.listen = L.listen || {}; L.listen.nginx = c.port; return { ok: true, on: c.port === 80 };
    }
    if (u === 'bind9') {
      const t = readFile(L, '/etc/bind/db.lab'); const recs = []; let origin = 'lab.local';
      if (t !== null) { const ls = t.split('\n'); for (let i = 0; i < ls.length; i++) { const l = ls[i].replace(/;.*$/, '').trim(); if (!l) continue; let m = l.match(/^\$ORIGIN\s+(\S+)/i); if (m) { origin = m[1].replace(/\.$/, ''); continue; } m = l.match(/^(\S+)\s+(?:\d+\s+)?IN\s+A\s+(\S+)$/i); if (m) { if (!isIp(m[2])) return { err: `zone ${origin}/IN: loading from master file /etc/bind/db.lab failed: db.lab:${i + 1}: bad dotted quad "${m[2]}"` }; const nm = m[1] === '@' ? origin : m[1].endsWith('.') ? m[1].slice(0, -1) : m[1] + '.' + origin; recs.push({ name: nm, ip: m[2] }); } } }
      if (d.svc) d.svc.dns.records = recs; return { ok: true, on: true };
    }
    if (u === 'isc-dhcp-server') {
      const t = (readFile(L, '/etc/dhcp/dhcpd.conf') || '').split('\n').filter(l => !l.trim().startsWith('#')).join('\n'), sub = t.match(/subnet\s+(\S+)\s+netmask\s+(\S+)\s*\{/), rg = t.match(/range\s+(\S+)\s+(\S+)\s*;/);
      const bad = 'Not configured to listen on any interfaces! (kein passendes subnet in /etc/dhcp/dhcpd.conf)';
      if (!sub || !rg || !isIp(sub[1]) || maskLen(sub[2]) === null || !isIp(rg[1]) || !isIp(rg[2])) return { err: bad };
      if (!d.cfg.ip || ((ipn(d.cfg.ip) & ipn(sub[2])) >>> 0) !== ((ipn(sub[1]) & ipn(sub[2])) >>> 0)) return { err: `${bad}: Die Server-IP ${d.cfg.ip || '(keine)'} liegt nicht im subnet ${sub[1]}/${maskLen(sub[2])}` };
      const rt = t.match(/option\s+routers\s+(\S+?)\s*;/), dn = t.match(/option\s+domain-name-servers\s+(\S+?)\s*[,;]/);
      if (d.svc) { Object.assign(d.svc.dhcp, { start: rg[1], max: Math.max(1, ipn(rg[2]) - ipn(rg[1]) + 1), mask: sub[2], gw: rt ? rt[1] : '', dns: dn ? dn[1] : '' }); } return { ok: true, on: true };
    }
    return { ok: true, on: true };
  }
  function startUnit(d, L, u, how) {
    const x = L.units[u], pk = Object.keys(PKGS).find(p => (PKGS[p].units || []).includes(u));
    if (pk && !L.pkgs.includes(pk)) return `Failed to ${how} ${u}.service: Unit ${u}.service not found.`;
    const fail = m => { x.active = false; setSvc(d, L, u, false); L.fail[u] = m; jl(d, L, u, m); jl(d, L, 'systemd', `${u}.service: Failed with result 'exit-code'.`); return `Job for ${u}.service failed because the control process exited with error code.\nSee "systemctl status ${u}.service" and "journalctl -xeu ${u}.service" for details.`; };
    if (diskFull(L)) return fail(`${UNITS[u].proc}: Failed to write pid file: No space left on device`);
    const r = applyConf(d, L, u); if (r.err) return fail(r.err);
    x.active = true; setSvc(d, L, u, r.on !== false); L.fail[u] = null; jl(d, L, u, `Started ${UNITS[u].d}.`); return '';
  }
  const unitName = s => { s = String(s || '').replace(/\.service$/, ''); s = ALIAS[s] || s; return UNITS[s] ? s : null; };
  function statusText(d, L, u) {
    const x = L.units[u], pk = Object.keys(PKGS).find(p => (PKGS[p].units || []).includes(u)), inst = !pk || L.pkgs.includes(pk);
    if (!inst) return `Unit ${u}.service could not be found.`;
    const act = x.active, failed = !!L.fail[u] && !act, lines = L.log.filter(l => l.u === u).slice(-4).map(l => l.t);
    return `${act ? '●' : failed ? '×' : '○'} ${u}.service - ${UNITS[u].d}\n     Loaded: loaded (/lib/systemd/system/${u}.service; ${x.enabled ? 'enabled' : 'disabled'}; vendor preset: enabled)\n     Active: ${act ? 'active (running) since Mon 2026-10-12 09:00:00 UTC; 2h ago' : failed ? 'failed (Result: exit-code) since Mon 2026-10-12 09:00:00 UTC' : 'inactive (dead)'}\n${act ? `   Main PID: ${400 + u.length * 17} (${UNITS[u].proc})\n` : ''}${lines.length ? '\n' + lines.join('\n') : ''}`;
  }

  // ---------- Tokenizer ----------
  function tokenize(s) {
    const out = []; let cur = '', q = null, has = false;
    const flush = () => { if (has) out.push({ v: cur }); cur = ''; has = false; };
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) { if (c === q) q = null; else cur += c; continue; }
      if (c === '"' || c === "'") { q = c; has = true; continue; }
      if (/\s/.test(c)) { flush(); continue; }
      if (c === '>') { flush(); if (s[i + 1] === '>') { out.push({ v: '>>', op: true }); i++; } else out.push({ v: '>', op: true }); continue; }
      cur += c; has = true;
    }
    flush(); return out;
  }
  function splitTop(s, seps) {
    const out = []; let cur = '', q = null;
    for (let i = 0; i < s.length; i++) {
      const c = s[i]; if (q) { cur += c; if (c === q) q = null; continue; }
      if (c === '"' || c === "'") { q = c; cur += c; continue; }
      const sp = seps.find(x => s.startsWith(x, i)); if (sp) { out.push(cur); cur = ''; i += sp.length - 1; continue; }
      cur += c;
    }
    out.push(cur); return out;
  }

  // ---------- SAN-LUNs (lsblk, multipath, mount) ----------
  const gbStr = gb => gb >= 1024 ? (gb / 1024).toFixed(1).replace(/\.0$/, '') + 'T' : gb + 'G';
  const scanList = (ctx, d) => (ctx.luns ? ctx.luns(d) : []).map(e => ({ key: e.sto + ':' + e.lun, name: e.name, gb: e.gb, paths: e.paths.map(p => ({ hp: p.hp, sp: p.sp, ctl: p.ctl })) }));
  const isMp = L => L.pkgs.includes('multipath-tools');
  function devTable(L) {
    const out = []; let n = 1; (L.scsi || []).forEach((e, i) => { const paths = e.paths.map(p => ({ name: 'sd' + String.fromCharCode(97 + n++), p })); out.push({ e, i, mp: 'mpath' + String.fromCharCode(97 + i), paths }); }); return out;
  }
  function findDev(L, path) {
    const t = devTable(L), m = path.match(/^\/dev\/(?:mapper\/)?(\w+)$/); if (!m) return null;
    for (const x of t) { if (isMp(L) && m[1] === x.mp && /mapper/.test(path)) return { kind: 'mpath', x, gb: x.e.gb }; for (const q of x.paths) if (q.name === m[1] && !/mapper/.test(path)) return { kind: 'path', x, q, gb: x.e.gb }; }
    return null;
  }
  const devPath = f => f.kind === 'mpath' ? '/dev/mapper/' + f.x.mp : '/dev/' + f.q.name;
  function rescan(st) {
    const L = st.L, before = (L.scsi || []).reduce((s, e) => s + e.paths.length, 0), cur = scanList(st.ctx, st.d), now = cur.reduce((s, e) => s + e.paths.length, 0);
    const oldKeys = new Set((L.scsi || []).flatMap(e => e.paths.map(p => e.key + p.hp + p.sp))), newKeys = new Set(cur.flatMap(e => e.paths.map(p => e.key + p.hp + p.sp)));
    const added = [...newKeys].filter(k => !oldKeys.has(k)).length, removed = [...oldKeys].filter(k => !newKeys.has(k)).length; void before; void now;
    L.scsi = cur; return `Scanning SCSI subsystem for new devices\nScanning host 2 for all SCSI target IDs, all LUNs\n${added} new or changed device(s) found.\n${removed} device(s) removed.`;
  }
  const afterWrite = (st, p) => /^\/sys\/class\/scsi_host\/host\d+\/scan$/.test(p) ? rescan(st) : '';
  function lsblk(st) {
    const L = st.L, mnt = dev => Object.keys(L.mounts).filter(k => L.mounts[k] === dev).join(','), rows = ['NAME        MAJ:MIN RM   SIZE RO TYPE  MOUNTPOINTS', 'sda           8:0    0    20G  0 disk', '└─sda1        8:1    0    20G  0 part  /'];
    devTable(L).forEach((x, i) => x.paths.forEach((q, k) => {
      rows.push(`${q.name.padEnd(13)} 8:${(i * 16 + k) * 16}    0 ${gbStr(x.e.gb).padStart(5)}  0 disk`);
      if (isMp(L)) rows.push(`└─${x.mp.padEnd(10)} 253:${i}    0 ${gbStr(x.e.gb).padStart(5)}  0 mpath ${mnt('/dev/mapper/' + x.mp)}`.trimEnd()); else if (mnt('/dev/' + q.name)) rows[rows.length - 1] += ' ' + mnt('/dev/' + q.name);
    }));
    return rows.join('\n');
  }
  function multipathLL(st) {
    const L = st.L, live = scanList(st.ctx, st.d), out = [];
    if (!isMp(L)) return 'Command \'multipath\' not found, but can be installed with:\nsudo apt install multipath-tools';
    devTable(L).forEach(x => {
      const le = live.find(e => e.key === x.e.key), alive = q => !!le && le.paths.some(p => p.hp === q.p.hp && p.sp === q.p.sp), ok = x.paths.filter(alive).length;
      out.push(`${x.mp} (3600${x.e.key.replace(/\D/g, '').padEnd(4, '0')}a1b2c3d4e5f60718) dm-${x.i} HUAWEI,XSG1`, `size=${gbStr(x.e.gb)} features='1 queue_if_no_path' hwhandler='0' wp=rw`, `\`-+- policy='service-time 0' prio=${ok ? 50 : 0} status=${ok ? 'active' : 'enabled'}`);
      x.paths.forEach((q, k) => out.push(`  ${k === x.paths.length - 1 ? '`' : '|'}- ${2 + (k % 2)}:0:${k}:${x.i} ${q.name} 8:${(x.i * 16 + k) * 16} ${alive(q) ? 'active ready running' : 'failed faulty running'}`));
    });
    return out.length ? out.join('\n') : '(keine Multipath-Geräte: erst LUNs freigeben, zonen und rescannen)';
  }
  function mkfs(a, st, fs) {
    if (!st.root) return `mke2fs: Permission denied while trying to determine filesystem size (versuche: sudo mkfs.${fs} …)`;
    const dev = a.filter(x => !x.startsWith('-')).pop(); if (!dev) return `Usage: mkfs.${fs} <Gerät>`;
    const f = findDev(st.L, dev); if (!f) return `The file ${dev} does not exist and no size was specified.`;
    if (f.kind === 'path' && isMp(st.L)) return `mkfs.${fs}: ${dev} is apparently in use by the system; will not make a filesystem here!\n(Das Gerät gehört zu einem Multipath-Gerät: nimm /dev/mapper/${f.x.mp}.)`;
    if (Object.values(st.L.mounts).includes(devPath(f))) return `${dev} is mounted; will not make a filesystem here!`;
    st.L.fmt[devPath(f)] = fs; return `mke2fs 1.46.5\nCreating filesystem with ${f.gb * 262144} 4k blocks and ${f.gb * 65536} inodes\nAllocating group tables: done\nWriting inode tables: done\nCreating journal (262144 blocks): done\nWriting superblocks and filesystem accounting information: done`;
  }
  function mount(a, st) {
    const L = st.L, args = a.filter(x => !x.startsWith('-'));
    if (!args.length) return ['/dev/sda1 on / type ext4 (rw,relatime)'].concat(Object.keys(L.mounts).map(k => `${L.mounts[k]} on ${k} type ${L.fmt[L.mounts[k]] || 'ext4'} (rw,relatime)`)).join('\n');
    if (!st.root) return 'mount: only root can do that (versuche: sudo mount …)';
    if (args.length < 2) return 'mount: Usage: mount <Gerät> <Verzeichnis>';
    const f = findDev(L, args[0]), mp = resolvePath(L, args[1]); if (!f) return `mount: ${args[1]}: special device ${args[0]} does not exist.`;
    if (!L.fs[mp] || !L.fs[mp].d) return `mount: ${args[1]}: mount point does not exist.`;
    if (f.kind === 'path' && isMp(L)) return `mount: ${args[1]}: ${args[0]} already mounted or mount point busy.`;
    if (!L.fmt[devPath(f)]) return `mount: ${args[1]}: wrong fs type, bad option, bad superblock on ${args[0]}, missing codepage or helper program, or other error.\n(Das Gerät hat noch kein Dateisystem: erst mkfs.ext4.)`;
    if (L.mounts[mp]) return `mount: ${args[1]}: ${args[0]} already mounted or mount point busy.`;
    L.mounts[mp] = devPath(f); return '';
  }
  function umount(a, st) { if (!st.root) return 'umount: only root can do that (versuche: sudo umount …)'; const mp = resolvePath(st.L, a[0] || ''); if (!st.L.mounts[mp]) return `umount: ${a[0]}: not mounted.`; delete st.L.mounts[mp]; return ''; }

  // ---------- Befehle ----------
  const flagsOf = (a) => { const f = new Set(), rest = []; a.forEach(t => { if (/^-[A-Za-z]+$/.test(t)) [...t.slice(1)].forEach(c => f.add(c)); else rest.push(t); }); return { f, rest }; };
  const need = (st, cmd) => st.root ? null : `${cmd}: Permission denied (versuche: sudo ${cmd} …)`;
  const pkgOf = bin => Object.keys(PKGS).find(p => (PKGS[p].bins || []).includes(bin));
  const hasBin = (L, bin) => { const p = pkgOf(bin); return !p || L.pkgs.includes(p); };

  function lsLong(L, p, name, f) { const e = L.fs[p]; return `${modeStr(e)} ${e.d ? 2 : 1} ${(e.o || 'root').padEnd(8)} ${(e.o || 'root').padEnd(8)} ${String(f.has('h') ? hs(sizeOf(e)) : sizeOf(e)).padStart(f.has('h') ? 5 : 9)} ${DATE} ${name}`; }
  function onlineErr(ctx, d) { if (!d.cfg.ip || !d.cfg.mask) return 'Temporary failure resolving \'archive.ubuntu.com\' (der Server hat keine IP-Adresse)'; if (!d.cfg.gw) return 'Temporary failure resolving \'archive.ubuntu.com\' (kein Standardgateway gesetzt)'; if (ctx.reach && !ctx.reach(d, d.cfg.gw)) return `Could not connect to archive.ubuntu.com: Gateway ${d.cfg.gw} nicht erreichbar`; return null; }

  const C = {
    pwd: (a, st) => st.L.cwd,
    cd: (a, st) => { const L = st.L, p = a[0] ? resolvePath(L, a[0]) : (L.root ? '/root' : '/home/' + L.user), e = L.fs[p]; if (!e) return `bash: cd: ${a[0]}: No such file or directory`; if (!e.d) return `bash: cd: ${a[0]}: Not a directory`; if (!canRead(L, st, p)) return `bash: cd: ${a[0]}: Permission denied`; L.cwd = p; return ''; },
    ls: (a, st) => {
      const L = st.L, { f, rest } = flagsOf(a), paths = rest.length ? rest : ['.'], out = [];
      paths.forEach(raw => {
        const p = resolvePath(L, raw), e = L.fs[p]; if (!e) { out.push(`ls: cannot access '${raw}': No such file or directory`); return; }
        if (!canRead(L, st, p)) { out.push(`ls: cannot open directory '${raw}': Permission denied`); return; }
        if (paths.length > 1 && e.d) out.push(raw + ':');
        const names = e.d ? kids(L, p).filter(k => f.has('a') || !baseOf(k).startsWith('.')) : [p];
        if (f.has('l')) { if (e.d) out.push('total ' + Math.ceil(names.length * 4)); names.forEach(k => out.push(lsLong(L, k, e.d ? baseOf(k) : raw, f))); } else out.push(names.map(baseOf).join('  '));
      });
      return out.join('\n');
    },
    cat: (a, st) => a.map(raw => { const p = resolvePath(st.L, raw); if (p === '/dev/null') return ''; const e = st.L.fs[p]; if (!e) return `cat: ${raw}: No such file or directory`; if (e.d) return `cat: ${raw}: Is a directory`; if (!canRead(st.L, st, p)) return `cat: ${raw}: Permission denied`; return (e.t || '').replace(/\n$/, ''); }).join('\n') || (st.stdin != null ? st.stdin : ''),
    echo: a => { const e = a[0] === '-e', t = (e ? a.slice(1) : a).join(' '); return e ? t.replace(/\\n/g, '\n') : t; },
    touch: (a, st) => a.map(raw => { const p = resolvePath(st.L, raw); if (st.L.fs[p]) return ''; return writeFile(st.L, st, p, '', false); }).filter(Boolean).join('\n'),
    mkdir: (a, st) => { const { f, rest } = flagsOf(a); return rest.map(raw => { const p = resolvePath(st.L, raw); if (st.L.fs[p]) return f.has('p') ? '' : `mkdir: cannot create directory '${raw}': File exists`; if (!canWrite(st.L, st, p)) return `mkdir: cannot create directory '${raw}': Permission denied`; if (!st.L.fs[dirOf(p)]) { if (!f.has('p')) return `mkdir: cannot create directory '${raw}': No such file or directory`; let q = ''; p.split('/').filter(Boolean).forEach(s => { q += '/' + s; if (!st.L.fs[q]) st.L.fs[q] = { d: 1, o: st.root ? 'root' : st.L.user }; }); return ''; } st.L.fs[p] = { d: 1, o: st.root ? 'root' : st.L.user }; return ''; }).filter(Boolean).join('\n'); },
    rm: (a, st) => { const { f, rest } = flagsOf(a); return rest.map(raw => { const p = resolvePath(st.L, raw), e = st.L.fs[p]; if (p === '/' || p === '/etc' || p === '/home') return `rm: it is dangerous to operate recursively on '${raw}'`; if (!e) return f.has('f') ? '' : `rm: cannot remove '${raw}': No such file or directory`; if (!canWrite(st.L, st, p)) return `rm: cannot remove '${raw}': Permission denied`; if (e.d && !f.has('r') && !f.has('R')) return `rm: cannot remove '${raw}': Is a directory`; Object.keys(st.L.fs).forEach(k => { if (k === p || k.startsWith(p + '/')) delete st.L.fs[k]; }); return ''; }).filter(Boolean).join('\n'); },
    cp: (a, st) => { const { rest } = flagsOf(a); if (rest.length < 2) return 'cp: missing destination file operand'; const src = resolvePath(st.L, rest[0]), e = st.L.fs[src]; if (!e) return `cp: cannot stat '${rest[0]}': No such file or directory`; if (e.d) return `cp: -r not specified; omitting directory '${rest[0]}'`; let dst = resolvePath(st.L, rest[1]); if (st.L.fs[dst] && st.L.fs[dst].d) dst += '/' + baseOf(src); if (!canWrite(st.L, st, dst)) return `cp: cannot create regular file '${rest[1]}': Permission denied`; st.L.fs[dst] = Object.assign({}, e, { o: st.root ? 'root' : st.L.user }); return ''; },
    mv: (a, st) => { const { rest } = flagsOf(a); if (rest.length < 2) return 'mv: missing destination file operand'; const src = resolvePath(st.L, rest[0]), e = st.L.fs[src]; if (!e) return `mv: cannot stat '${rest[0]}': No such file or directory`; let dst = resolvePath(st.L, rest[1]); if (st.L.fs[dst] && st.L.fs[dst].d) dst += '/' + baseOf(src); if (!canWrite(st.L, st, dst) || !canWrite(st.L, st, src)) return `mv: cannot move '${rest[0]}' to '${rest[1]}': Permission denied`; st.L.fs[dst] = e; delete st.L.fs[src]; return ''; },
    chmod: (a, st) => { if (a.length < 2) return 'chmod: missing operand'; if (!/^[0-7]{3}$/.test(a[0])) return `chmod: Modus (nur Oktalzahl wie 644 oder 755) „${a[0]}“ wird hier nicht unterstützt`; return a.slice(1).map(raw => { const p = resolvePath(st.L, raw), e = st.L.fs[p]; if (!e) return `chmod: cannot access '${raw}': No such file or directory`; if (!canWrite(st.L, st, p)) return `chmod: changing permissions of '${raw}': Operation not permitted`; e.m = a[0]; return ''; }).filter(Boolean).join('\n'); },
    chown: (a, st) => { if (a.length < 2) return 'chown: missing operand'; if (!st.root) return `chown: changing ownership of '${a[1]}': Operation not permitted`; return a.slice(1).map(raw => { const p = resolvePath(st.L, raw), e = st.L.fs[p]; if (!e) return `chown: cannot access '${raw}': No such file or directory`; e.o = a[0].split(':')[0]; return ''; }).filter(Boolean).join('\n'); },
    head: (a, st) => tailHead(a, st, true), tail: (a, st) => tailHead(a, st, false),
    wc: (a, st) => { const t = st.stdin != null ? st.stdin : a.map(r => readFile(st.L, resolvePath(st.L, r)) || '').join(''), n = t === '' ? 0 : t.replace(/\n$/, '').split('\n').length; return a.includes('-l') || st.stdin != null ? String(n) : `${n} ${t.split(/\s+/).filter(Boolean).length} ${t.length}`; },
    sort: (a, st) => (st.stdin || '').split('\n').sort().join('\n'), uniq: (a, st) => (st.stdin || '').split('\n').filter((l, i, x) => l !== x[i - 1]).join('\n'),
    grep: (a, st) => {
      const { f, rest } = flagsOf(a); if (!rest.length) return 'Usage: grep [OPTION]... PATTERN [FILE]...';
      let re; try { re = new RegExp(rest[0], f.has('i') ? 'i' : ''); } catch (e) { return `grep: Invalid regular expression`; }
      const files = rest.slice(1), src = files.length ? files.map(r => { const t = readFile(st.L, resolvePath(st.L, r)); return t === null ? { err: `grep: ${r}: No such file or directory` } : { n: r, t }; }) : [{ n: '', t: st.stdin || '' }], out = [];
      src.forEach(s => { if (s.err) { out.push(s.err); return; } s.t.split('\n').forEach((l, i) => { if (re.test(l) !== f.has('v')) out.push((files.length > 1 ? s.n + ':' : '') + (f.has('n') ? (i + 1) + ':' : '') + l); }); }); return out.join('\n');
    },
    sed: (a, st) => {
      const { f, rest } = flagsOf(a), ex = rest[0] || ''; if (!rest.length) return 'Usage: sed [-i] SCRIPT FILE'; const file = rest[1] ? resolvePath(st.L, rest[1]) : null;
      let t = file ? readFile(st.L, file) : (st.stdin || ''); if (t === null) return `sed: can't read ${rest[1]}: No such file or directory`;
      let m = ex.match(/^s(.)(.*?)\1(.*?)\1([gi]*)$/), del = ex.match(/^\/(.*)\/d$/); if (!m && !del) return `sed: Ausdruck „${ex}“ wird hier nicht unterstützt (erlaubt: s/alt/neu/[g] und /muster/d)`;
      let re; try { re = m ? new RegExp(m[2], (m[4].includes('g') ? 'g' : '') + (m[4].includes('i') ? 'i' : '')) : new RegExp(del[1]); } catch (e) { return 'sed: ungültiger regulärer Ausdruck'; }
      const out = m ? t.split('\n').map(l => l.replace(re, m[3])).join('\n') : t.split('\n').filter(l => !re.test(l)).join('\n');
      if (f.has('i') && file) { if (!canWrite(st.L, st, file)) return `sed: couldn't open temporary file ${dirOf(file)}/sedXXXX: Permission denied`; st.L.fs[file].t = out; return ''; } return out.replace(/\n$/, '');
    },
    tee: (a, st) => { const { f, rest } = flagsOf(a), t = st.stdin || ''; const e = rest.map(r => { const p = resolvePath(st.L, r), w = writeFile(st.L, st, p, t + '\n', f.has('a')); return w || afterWrite(st, p); }).filter(Boolean); return e.length ? e.join('\n') : t; },
    truncate: (a, st) => { const i = a.indexOf('-s'), raw = a[a.length - 1], p = resolvePath(st.L, raw), e = st.L.fs[p]; if (i < 0) return 'truncate: you must specify either -s or -r'; if (!e) return `truncate: cannot open '${raw}' for writing: No such file or directory`; if (!canWrite(st.L, st, p)) return `truncate: cannot open '${raw}' for writing: Permission denied`; e.t = ''; delete e.s; return ''; },
    find: (a, st) => {
      const L = st.L, root = resolvePath(L, a[0] && !a[0].startsWith('-') ? a[0] : '.'), ni = a.indexOf('-name'), si = a.indexOf('-size'); let nre = null, min = null;
      if (ni >= 0) nre = new RegExp('^' + a[ni + 1].replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
      if (si >= 0) { const m = String(a[si + 1]).match(/^\+(\d+)([kMG]?)$/); if (!m) return 'find: ungültige Größenangabe (z. B. -size +100M)'; min = +m[1] * ({ '': 512, k: 1024, M: 1024 ** 2, G: 1024 ** 3 }[m[2]]); }
      return Object.keys(L.fs).filter(k => (k === root || k.startsWith(root === '/' ? '/' : root + '/')) && canRead(L, st, k) && (!nre || nre.test(baseOf(k))) && (min === null || (!L.fs[k].d && sizeOf(L.fs[k]) > min))).sort().join('\n');
    },
    du: (a, st) => { const { f, rest } = flagsOf(a), out = []; (rest.length ? rest : ['.']).forEach(raw => { const p = resolvePath(st.L, raw), e = st.L.fs[p]; if (!e) { out.push(`du: cannot access '${raw}': No such file or directory`); return; } const sum = Object.keys(st.L.fs).filter(k => k === p || k.startsWith(p + '/')).reduce((s, k) => s + sizeOf(st.L.fs[k]), 0); out.push(`${f.has('h') ? hs(sum) : Math.ceil(sum / 1024)}\t${raw}`); }); return out.join('\n'); },
    df: (a, st) => { const u = Math.min(used(st.L), TOTAL), p = Math.min(100, Math.ceil(u / TOTAL * 100)); return `Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda2        ${hs(TOTAL)}  ${hs(u).padStart(4)} ${hs(TOTAL - u).padStart(5)} ${String(p).padStart(3)}% /\ntmpfs           1.9G     0  1.9G   0% /dev/shm` + Object.keys(st.L.mounts).map(mp => { const f = findDev(st.L, st.L.mounts[mp]), gb = f ? f.gb : 0; return `\n${st.L.mounts[mp].padEnd(15)} ${hs(gb * 1024 ** 3 * 0.98).padStart(4)}  ${'24K'.padStart(4)} ${hs(gb * 1024 ** 3 * 0.97).padStart(5)}   1% ${mp}`; }).join(''); },
    free: () => '               total        used        free      shared  buff/cache   available\nMem:           3.8Gi       612Mi       2.4Gi       1.0Mi       812Mi       3.0Gi\nSwap:          2.0Gi          0B       2.0Gi',
    uptime: () => ' 09:00:00 up 2:14,  1 user,  load average: 0.08, 0.03, 0.01', date: () => 'Mon Oct 12 09:00:00 UTC 2026',
    whoami: (a, st) => st.root ? 'root' : st.L.user, id: (a, st) => st.root ? 'uid=0(root) gid=0(root) groups=0(root)' : `uid=1000(${st.L.user}) gid=1000(${st.L.user}) groups=1000(${st.L.user}),27(sudo)`,
    hostname: (a, st) => st.d.cfg.hostname, uname: (a) => a.includes('-a') ? `Linux ${'host'} 5.15.0-91-generic #101-Ubuntu SMP x86_64 GNU/Linux` : 'Linux',
    which: (a, st) => a.map(b => hasBin(st.L, b) && (Object.prototype.hasOwnProperty.call(C, b) || ['nginx', 'htop', 'vim', 'tree', 'ifconfig', 'dig', 'tcpdump', 'systemctl', 'apt', 'sudo', 'ufw'].includes(b)) ? '/usr/bin/' + b : '').filter(Boolean).join('\n'),
    ps: (a, st) => { const L = st.L, rows = ['root           1  0.0  0.3 168000 11800 ?        Ss   08:46   0:02 /sbin/init', 'root         410  0.0  0.2  50000  8200 ?        Ss   08:46   0:00 /lib/systemd/systemd-journald']; Object.keys(UNITS).forEach(u => { if (L.units[u].active) rows.push(`root         ${400 + u.length * 17}  0.0  0.4 120000 14000 ?        Ss   08:46   0:00 ${UNITS[u].proc}`); }); rows.push(`${L.user}      2210  0.0  0.1  10000  4000 pts/0    Ss   09:00   0:00 -bash`); return 'USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\n' + rows.join('\n'); },
    ss: (a, st) => ssTable(st), netstat: (a, st) => hasBin(st.L, 'netstat') ? ssTable(st) : 'Command \'netstat\' not found, but can be installed with:\nsudo apt install net-tools',
    history: () => '', clear: () => '',
    help: () => 'Verfügbare Befehle (Linux-Server):\n  Dateien:   ls cat cd pwd cp mv rm mkdir touch chmod chown head tail grep sed tee find du df truncate\n  System:    systemctl journalctl ps ss free uptime hostname hostnamectl whoami id useradd userdel\n  Pakete:    apt update | apt install <Paket> | apt remove <Paket>\n  Speicher:  lsblk | multipath -ll | sudo rescan-scsi-bus.sh | sudo mkfs.ext4 <Gerät> | sudo mount <Gerät> <Ordner> | df -h\n  Netzwerk:  ip a | ip r | ip addr add <IP>/<Präfix> dev eth0 | ip route add default via <IP> | ping | curl | nslookup | dig | ufw\n  Dateien schreiben: echo "text" > datei   echo "zeile" >> datei   sed -i \'s/alt/neu/\' datei\n  Rechte: Systemdateien brauchen sudo (z. B. sudo systemctl restart nginx).',
    nano: () => 'Im Simulator gibt es keinen Terminal-Editor. Schreibe Dateien mit echo "text" > datei oder >> datei und ändere mit sed -i \'s/alt/neu/\' datei.', vi: () => C.nano(), vim: () => C.nano(),
    exit: (a, st) => { if (st.L.root) { st.L.root = false; st.L.cwd = '/home/' + st.L.user; return ''; } return 'logout\n(Dies ist die einzige Sitzung – du bleibst angemeldet.)'; }, logout: (a, st) => C.exit(a, st),
    su: (a, st) => { st.L.root = true; st.L.cwd = '/root'; return ''; },
    hostnamectl: (a, st) => { if (a[0] !== 'set-hostname' || !a[1]) return `   Static hostname: ${st.d.cfg.hostname}\n  Operating System: Ubuntu 22.04.4 LTS`; const n = need(st, 'hostnamectl'); if (n) return 'Failed to set hostname: Interactive authentication required.'; st.d.cfg.hostname = a[1]; st.L.fs['/etc/hostname'].t = a[1] + '\n'; return ''; },
    useradd: (a, st) => { const n = need(st, 'useradd'); if (n) return 'useradd: Permission denied.'; const { rest } = flagsOf(a.filter(x => x !== '-m')), name = rest[rest.length - 1]; if (!name || a.length < 1) return 'Usage: useradd [options] LOGIN'; if (st.L.users.includes(name)) return `useradd: user '${name}' already exists`; st.L.users.push(name); if (a.includes('-m')) st.L.fs['/home/' + name] = { d: 1, o: name }; return ''; },
    userdel: (a, st) => { if (!st.root) return 'userdel: Permission denied.'; const n = a[a.length - 1]; if (!st.L.users.includes(n) || n === 'root') return `userdel: user '${n}' does not exist`; st.L.users = st.L.users.filter(u => u !== n); return ''; },
    passwd: (a, st) => st.root || !a[0] ? 'passwd: password updated successfully' : 'passwd: You may not view or modify password information for ' + a[0] + '.',
    crontab: (a, st) => `no crontab for ${st.root ? 'root' : st.L.user}`,
    lsblk: (a, st) => lsblk(st), multipath: (a, st) => multipathLL(st), 'rescan-scsi-bus.sh': (a, st) => st.root ? rescan(st) : 'rescan-scsi-bus.sh: Permission denied (versuche: sudo rescan-scsi-bus.sh)',
    'mkfs.ext4': (a, st) => mkfs(a, st, 'ext4'), 'mkfs.xfs': (a, st) => mkfs(a, st, 'xfs'), mount: (a, st) => mount(a, st), umount: (a, st) => umount(a, st),
    fdisk: (a, st) => { if (!st.root) return 'fdisk: cannot open /dev/sda: Permission denied (versuche: sudo fdisk -l)'; return ['Disk /dev/sda: 20 GiB'].concat(devTable(st.L).flatMap(x => x.paths.map(q => `Disk /dev/${q.name}: ${x.e.gb} GiB`))).join('\n'); },
    ufw: (a, st) => ufw(a, st), journalctl: (a, st) => journal(a, st), systemctl: (a, st) => systemctl(a, st), apt: (a, st) => apt(a, st), 'apt-get': (a, st) => apt(a, st),
    ip: (a, st) => ipCmd(a, st), ifconfig: (a, st) => hasBin(st.L, 'ifconfig') ? ipCmd(['a'], st) : 'Command \'ifconfig\' not found, but can be installed with:\nsudo apt install net-tools',
    nginx: (a, st) => { if (!hasBin(st.L, 'nginx')) return 'Command \'nginx\' not found'; if (a[0] === '-t') { if (!st.root) return 'nginx: [alert] could not open error log file: open() "/var/log/nginx/error.log" failed (13: Permission denied)\nnginx: [emerg] open() "/etc/nginx/nginx.conf" failed (13: Permission denied)'; const r = nginxCheck(st.L); return r.err ? `${r.err}\nnginx: configuration file /etc/nginx/nginx.conf test failed` : 'nginx: the configuration file /etc/nginx/nginx.conf syntax is ok\nnginx: configuration file /etc/nginx/nginx.conf test is successful'; } return 'nginx version: nginx/1.18.0 (Ubuntu)'; },
    htop: (a, st) => hasBin(st.L, 'htop') ? C.ps(a, st) : 'Command \'htop\' not found, but can be installed with:\nsudo apt install htop',
    tree: (a, st) => { if (!hasBin(st.L, 'tree')) return 'Command \'tree\' not found, but can be installed with:\nsudo apt install tree'; const p = resolvePath(st.L, a[0] || '.'), out = [a[0] || '.']; const walk = (dir, pre) => { const k = kids(st.L, dir); k.forEach((x, i) => { out.push(pre + (i === k.length - 1 ? '└── ' : '├── ') + baseOf(x)); if (st.L.fs[x].d) walk(x, pre + (i === k.length - 1 ? '    ' : '│   ')); }); }; walk(p, ''); return out.join('\n'); },
    dig: (a, st) => { if (!hasBin(st.L, 'dig')) return 'Command \'dig\' not found, but can be installed with:\nsudo apt install dnsutils'; const n = a.find(x => !x.startsWith('-') && !x.startsWith('@')); if (!n) return 'Usage: dig [@server] name'; const r = st.ctx.resolve(st.d, n); return r.err ? `;; ->>HEADER<<- opcode: QUERY, status: NXDOMAIN\n;; ${r.err}` : `;; ANSWER SECTION:\n${n}.\t\t3600\tIN\tA\t${r.ip}\n\n;; SERVER: ${st.d.cfg.dns || '–'}#53`; },
    tcpdump: (a, st) => hasBin(st.L, 'tcpdump') ? 'tcpdump: Im Simulator gibt es keinen Paketmitschnitt. Nutze den Ping-Debugger und den Paket-Reiter im Planer.' : 'Command \'tcpdump\' not found, but can be installed with:\nsudo apt install tcpdump'
  };
  function tailHead(a, st, head) {
    const name = head ? 'head' : 'tail', files = []; let n = 10;
    for (let i = 0; i < a.length; i++) { if (a[i] === '-n') { n = +a[++i] || 10; } else if (/^-\d+$/.test(a[i])) n = -a[i]; else if (!a[i].startsWith('-')) files.push(a[i]); }
    let t;
    if (files.length) { const p = resolvePath(st.L, files[0]), e = st.L.fs[p]; if (!e) return `${name}: cannot open '${files[0]}' for reading: No such file or directory`; if (!canRead(st.L, st, p)) return `${name}: cannot open '${files[0]}' for reading: Permission denied`; t = e.t || ''; } else t = st.stdin || '';
    const ls = t.replace(/\n$/, '').split('\n'); return (head ? ls.slice(0, n) : ls.slice(-n)).join('\n');
  }
  function ssTable(st) {
    const L = st.L, rows = ['Netid State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process'];
    Object.keys(UNITS).forEach(u => { const x = UNITS[u]; if (!x.port || !L.units[u].active) return; const p = u === 'nginx' && L.listen && L.listen.nginx ? L.listen.nginx : x.port; rows.push(`${x.proto.padEnd(5)} ${x.proto === 'tcp' ? 'LISTEN' : 'UNCONN'} 0      ${x.proto === 'tcp' ? '511' : '0  '}    ${(x.proto === 'tcp' ? '0.0.0.0:' : '0.0.0.0:') + p}   0.0.0.0:*     users:(("${x.proc}",pid=${400 + u.length * 17}))`); });
    return rows.join('\n');
  }
  function ipCmd(a, st) {
    const L = st.L, d = st.d, ifs = st.ctx.ifaces(d), s = a.filter(x => !x.startsWith('-'))[0] || '';
    if (/^(a|addr|address)$/.test(s) && (a.includes('add') || a.includes('del'))) {
      if (!st.root) return 'RTNETLINK answers: Operation not permitted'; const add = a.includes('add'), cidr = a[a.indexOf(add ? 'add' : 'del') + 1] || '', m = cidr.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/), di = a.indexOf('dev'), dev = di >= 0 ? a[di + 1] : 'eth0', i = ifs.find(x => x.lin === dev);
      if (!m || !isIp(m[1]) || +m[2] > 32) return `Error: inet prefix is expected rather than "${cidr}".`; if (!i) return `Cannot find device "${dev}"`;
      st.ctx.setIp(d, i.port, add ? m[1] : null, add ? n2ip(m[2] == 0 ? 0 : (0xffffffff << (32 - +m[2])) >>> 0) : null); return '';
    }
    if (/^(a|addr|address|link|l)?$/.test(s) || a[0] === '-br') {
      const brief = a.includes('-br') || a.includes('-brief');
      if (brief) return ['lo               UNKNOWN        127.0.0.1/8'].concat(ifs.map(i => `${i.lin.padEnd(16)} ${i.up ? 'UP     ' : 'DOWN   '}     ${i.ip ? i.ip + '/' + maskLen(i.mask) : ''}`)).join('\n');
      return ['1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN\n    inet 127.0.0.1/8 scope host lo'].concat(ifs.map((i, k) => `${k + 2}: ${i.lin}: <BROADCAST,MULTICAST${i.up ? ',UP,LOWER_UP' : ''}> mtu 1500 qdisc fq_codel state ${i.up ? 'UP' : 'DOWN'}\n    link/ether 52:54:00:12:34:${(k + 10).toString(16)} brd ff:ff:ff:ff:ff:ff${i.ip ? `\n    inet ${i.ip}/${maskLen(i.mask)} scope global ${i.lin}` : ''}`)).join('\n');
    }
    if (/^(r|route)$/.test(s)) {
      if (a.includes('add') || a.includes('del')) { if (!st.root) return 'RTNETLINK answers: Operation not permitted'; const vi = a.indexOf('via'), gw = vi >= 0 ? a[vi + 1] : null; if (!a.includes('default') || !gw || !isIp(gw)) return 'Hier unterstützt: ip route add default via <IP>'; if (a.includes('del')) { d.cfg.gw = null; return ''; } d.cfg.gw = gw; return ''; }
      const out = d.cfg.gw ? [`default via ${d.cfg.gw} dev ${ifs[0] ? ifs[0].lin : 'eth0'}`] : []; ifs.forEach(i => { if (i.ip) out.push(`${n2ip((ipn(i.ip) & ipn(i.mask)) >>> 0)}/${maskLen(i.mask)} dev ${i.lin} proto kernel scope link src ${i.ip}`); }); return out.join('\n');
    }
    return undefined;
  }
  function ufw(a, st) {
    const U = st.L.ufw, cmd = a[0]; if (!st.root) return 'ERROR: You need to be root to run this script';
    if (cmd === 'enable') { U.on = true; return 'Firewall is active and enabled on system startup'; } if (cmd === 'disable') { U.on = false; return 'Firewall stopped and disabled on system startup'; }
    if (cmd === 'allow' && a[1]) { const p = String(a[1]).replace(/\/.*$/, ''); if (!U.allow.includes(p)) U.allow.push(p); return 'Rule added'; } if (cmd === 'delete' && a[1] === 'allow' && a[2]) { U.allow = U.allow.filter(x => x !== String(a[2]).replace(/\/.*$/, '')); return 'Rule deleted'; }
    if (cmd === 'status') return !U.on ? 'Status: inactive' : `Status: active\n\nTo                         Action      From\n--                         ------      ----\n${U.allow.map(p => `${p}`.padEnd(27) + 'ALLOW       Anywhere').join('\n')}`;
    return 'Usage: ufw [enable|disable|status|allow <Port>|delete allow <Port>]';
  }
  function journal(a, st) {
    const L = st.L, ui = a.indexOf('-u'), ni = a.indexOf('-n'), n = ni >= 0 ? +a[ni + 1] || 10 : 20, u = ui >= 0 ? unitName(a[ui + 1]) || a[ui + 1] : null;
    if (u && !UNITS[u]) return `-- No entries --`; const rows = L.log.filter(l => !u || l.u === u).slice(-n).map(l => l.t); return rows.length ? rows.join('\n') : '-- No entries --';
  }
  function systemctl(a, st) {
    const L = st.L, d = st.d, act = a.find(x => !x.startsWith('-')), args = a.filter(x => !x.startsWith('-')).slice(1);
    if (act === 'list-units' || (act === undefined && a.includes('--failed'))) { const failed = a.includes('--failed'); const rows = Object.keys(UNITS).filter(u => failed ? (L.fail[u] && !L.units[u].active) : true).map(u => `  ${(u + '.service').padEnd(26)} loaded ${L.units[u].active ? 'active running' : (L.fail[u] ? 'failed failed' : 'inactive dead')}   ${UNITS[u].d}`); return failed && !rows.length ? '0 loaded units listed.' : 'UNIT                       LOAD   ACTIVE SUB     DESCRIPTION\n' + rows.join('\n'); }
    if (!act) return 'Usage: systemctl [status|start|stop|restart|reload|enable|disable|is-active] <Dienst>';
    if (act === 'daemon-reload') return need(st, 'systemctl') ? 'Failed to reload daemon: Interactive authentication required.' : '';
    if (!args.length) return `Too few arguments.`;
    return args.map(raw => {
      const u = unitName(raw), nm = String(raw).replace(/\.service$/, ''); if (!u) return act === 'status' ? `Unit ${nm}.service could not be found.` : `Failed to ${act} ${nm}.service: Unit ${nm}.service not found.`;
      reconcile(d, L); const x = L.units[u];
      if (act === 'status') return statusText(d, L, u);
      if (act === 'is-active') return x.active ? 'active' : (L.fail[u] ? 'failed' : 'inactive'); if (act === 'is-enabled') return x.enabled ? 'enabled' : 'disabled';
      if (!['start', 'stop', 'restart', 'reload', 'enable', 'disable'].includes(act)) return `Unknown command verb ${act}.`;
      if (!st.root) return '==== AUTHENTICATING FOR org.freedesktop.systemd1.manage-units ====\nAuthentication is required to manage system services or other units.\nFailed: Interactive authentication required (versuche: sudo systemctl ' + act + ' ' + u + ').';
      if (act === 'enable') { x.enabled = true; return `Created symlink /etc/systemd/system/multi-user.target.wants/${u}.service → /lib/systemd/system/${u}.service.`; }
      if (act === 'disable') { x.enabled = false; return `Removed /etc/systemd/system/multi-user.target.wants/${u}.service.`; }
      if (act === 'stop') { if (x.active) jl(d, L, u, `Stopped ${UNITS[u].d}.`); x.active = false; setSvc(d, L, u, false); return ''; }
      if (act === 'reload' && !x.active) return `Failed to reload ${u}.service: Unit ${u}.service is not active, cannot reload.`;
      return startUnit(d, L, u, act);
    }).filter(Boolean).join('\n');
  }
  function apt(a, st) {
    const L = st.L, d = st.d, act = a[0], pk = a.slice(1).filter(x => !x.startsWith('-'));
    if (!st.root) return 'E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\nE: Unable to acquire the dpkg frontend lock, are you root? (versuche: sudo apt …)';
    if (act === 'update') { const e = onlineErr(st.ctx, d); return e ? `Err:1 http://archive.ubuntu.com/ubuntu jammy InRelease\n  ${e}\nW: Failed to fetch http://archive.ubuntu.com/ubuntu/dists/jammy/InRelease\nE: Some index files failed to download.` : 'Hit:1 http://archive.ubuntu.com/ubuntu jammy InRelease\nReading package lists... Done'; }
    if (act === 'install') {
      if (!pk.length) return 'E: No packages specified'; const e = onlineErr(st.ctx, d); if (e) return `Reading package lists... Done\nErr:1 http://archive.ubuntu.com/ubuntu jammy/main amd64 ${pk[0]}\n  ${e}\nE: Failed to fetch http://archive.ubuntu.com/ubuntu/pool/main/${pk[0]}.deb\nE: Unable to fetch some archives, maybe run apt-get update?`;
      if (diskFull(L)) return 'E: You don\'t have enough free space in /var/cache/apt/archives/.';
      return pk.map(p => {
        if (!PKGS[p]) return `E: Unable to locate package ${p}`; if (L.pkgs.includes(p)) return `${p} is already the newest version.`;
        L.pkgs.push(p); const out = [`Reading package lists... Done`, `The following NEW packages will be installed:\n  ${p}`, `Setting up ${p} ...`];
        if (p === 'nginx') { L.fs['/etc/nginx/nginx.conf'] = { t: NGINX_CONF, o: 'root', m: '644' }; L.fs['/var/www/html/index.html'] = { t: '<html><head><title>Welcome to nginx!</title></head><body>Welcome to nginx!</body></html>\n', o: 'www-data', m: '644' }; L.fs['/var/log/nginx/error.log'] = { t: '', o: 'www-data', m: '644' }; const r = startUnit(d, L, 'nginx', 'start'); if (!r) out.push('Created symlink … nginx.service wird gestartet.'); }
        if (p === 'bind9') { L.fs['/etc/bind/db.local'] = { t: DB_SAMPLE, o: 'root', m: '644' }; startUnit(d, L, 'bind9', 'start'); out.push('Created symlink … bind9.service wird gestartet.'); }
        if (p === 'isc-dhcp-server') { L.fs['/etc/dhcp/dhcpd.conf'] = { t: DHCP_SAMPLE, o: 'root', m: '644' }; startUnit(d, L, 'isc-dhcp-server', 'start'); out.push('invoke-rc.d: initscript isc-dhcp-server, action "start" failed. (Das ist normal: erst /etc/dhcp/dhcpd.conf ausfüllen)'); }
        return out.join('\n');
      }).join('\n');
    }
    if (act === 'remove' || act === 'purge') return pk.map(p => { if (!L.pkgs.includes(p)) return `Package '${p}' is not installed, so not removed`; if (PRE.includes(p)) return `E: ${p} wird vom System benötigt und nicht entfernt.`; L.pkgs = L.pkgs.filter(x => x !== p); (PKGS[p].units || []).forEach(u => { L.units[u].active = false; setSvc(d, L, u, false); }); return `Removing ${p} ...`; }).join('\n');
    return 'Usage: apt [update|install <Paket>|remove <Paket>]';
  }

  // ---------- Ausführung ----------
  const FALLBACK = /^(ping|curl|nslookup|traceroute|trace|nc|ipconfig|show|\?|ip)$/i;
  function runCmd(ctx, d, L, seg, stdin) {
    const toks = tokenize(seg); if (!toks.length) return { out: '' };
    let redir = null; const ri = toks.findIndex(t => t.op); if (ri >= 0) { redir = { op: toks[ri].v, file: (toks[ri + 1] || {}).v }; toks.splice(ri); }
    let args = toks.map(t => t.v), cmd = args.shift(), st = { d, L, ctx, root: L.root, stdin };
    if (cmd === 'sudo') { if (!args.length) return { out: 'usage: sudo <Befehl>' }; const a0 = args[0]; if (a0 === '-i' || a0 === 's' || a0 === '-s') { L.root = true; L.cwd = '/root'; return { out: '' }; } st.root = true; cmd = args.shift(); }
    let out;
    if (cmd === 'curl' && args.length && /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/.test(args.filter(x => !x.startsWith('-')).pop() || '') ) out = localCurl(d, L);
    else if (Object.prototype.hasOwnProperty.call(C, cmd)) out = C[cmd](args, st);
    if (out === undefined) {
      if (FALLBACK.test(cmd)) return { fb: [cmd].concat(args).join(' ') };
      out = `bash: ${cmd}: command not found`;
    }
    if (redir) {
      if (!redir.file) return { out: 'bash: syntax error near unexpected token `newline\'' };
      const p = resolvePath(L, redir.file), e = writeFile(L, st, p, out === '' ? '' : out + '\n', redir.op === '>>'); return { out: e || afterWrite(st, p) };
    }
    return { out };
  }
  function localCurl(d, L) { const sv = d.svc; if (!sv || !L.units.nginx.active || !sv.http.on) return 'curl: (7) Failed to connect to localhost port 80 after 0 ms: Connection refused'; const idx = readFile(L, '/var/www/html/index.html'); return idx === null ? '<html>404 Not Found</html>' : idx.replace(/\n$/, ''); }
  function exec(ctx, d, raw) {
    const L = init(d); reconcile(d, L); if (L.scsi === null) L.scsi = scanList(ctx, d); const line = String(raw || '').replace(/\s2>\s*\/dev\/null/g, '').replace(/\s2>&1/g, '').trim(); if (!line) return '';
    const segs = splitTop(line, ['&&', ';']).map(x => x.trim()).filter(Boolean), outs = [];
    for (const seg of segs) {
      const pipe = splitTop(seg, ['|']); let data = null;
      for (const part of pipe) {
        const r = runCmd(ctx, d, L, part.trim(), data);
        if (r.fb !== undefined) data = ctx.fallback(d, r.fb); else data = r.out;
      }
      if (data) outs.push(data);
    }
    return outs.join('\n');
  }
  function prompt(d) { const L = init(d), home = L.root ? '/root' : '/home/' + L.user, c = L.cwd === home ? '~' : L.cwd.startsWith(home + '/') ? '~' + L.cwd.slice(home.length) : L.cwd; return `${L.root ? 'root' : L.user}@${d.cfg.hostname}:${c}${L.root ? '#' : '$'} `; }
  const isLinux = d => !!d && d.type === 'server' && (!d.os || d.os === 'linux');

  return { exec, prompt, init, isLinux, applyConf, startUnit, unitName, nginxCheck, readFile, writeFile, resolvePath, used, TOTAL, jl, diskFull };
})();
if (typeof module !== 'undefined') module.exports = LX;
