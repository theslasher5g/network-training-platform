// ===================== NetLab Windows-Terminal (Server und Clients) =====================
// PowerShell-Teilmenge: Netzwerk, Rollen (AD DS, DNS, DHCP, IIS), Active Directory, Dienste, Firewall, Dateien.
// Zustand liegt in d.win (reines JSON). Rollen steuern d.svc (HTTP, DNS, DHCP) des Netzsimulators.
const WIN = (function () {
  const FEATURES = {
    'AD-Domain-Services': { d: 'Active Directory-Domänendienste' }, DNS: { d: 'DNS-Server', svc: 'DNS', fw: [['DNS (UDP-In)', 53, 'UDP']] }, DHCP: { d: 'DHCP-Server', svc: 'DHCPServer', fw: [['DHCP Server (UDP-In)', 67, 'UDP']] },
    'Web-Server': { d: 'Webserver (IIS)', svc: 'W3SVC', fw: [['World Wide Web Services (HTTP Traffic-In)', 80, 'TCP']] }, 'FS-FileServer': { d: 'Dateiserver', fw: [['File and Printer Sharing (SMB-In)', 445, 'TCP']] }
  };
  const SERVICES = { Spooler: 'Print Spooler', W32Time: 'Windows Time', LanmanServer: 'Server', MpsSvc: 'Windows Defender Firewall', DNS: 'DNS Server', NTDS: 'Active Directory Domain Services', DHCPServer: 'DHCP Server', W3SVC: 'World Wide Web Publishing Service' };
  const isIp = s => /^\d{1,3}(\.\d{1,3}){3}$/.test(s) && s.split('.').every(x => +x < 256);
  const ipn = ip => String(ip).split('.').reduce((a, b) => ((a << 8) + (+b)) >>> 0, 0), n2ip = n => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  const lenMask = l => n2ip(l === 0 ? 0 : (0xffffffff << (32 - l)) >>> 0);
  const dn = dom => dom.split('.').map(x => 'DC=' + x).join(',');
  const NB = dom => dom.split('.')[0].toUpperCase();

  function init(d) {
    if (d.win) return d.win;
    d.win = { domain: null, feats: {}, svc: { Spooler: 'Running', W32Time: 'Running', LanmanServer: 'Running', MpsSvc: 'Running' }, startup: {}, pendingName: null, fwOn: true, fw: [], files: { 'C:\\Users\\Administrator': { d: 1 }, 'C:\\inetpub': { d: 1 }, 'C:\\inetpub\\wwwroot': { d: 1 }, 'D:\\': { d: 1 } }, shares: [], dnsZones: [], dhcp: { scope: null, auth: false }, ad: null, cwd: 'C:\\Users\\Administrator' };
    if (d.svc) { d.svc.http.on = false; d.svc.dns.on = false; d.svc.dhcp.on = false; } // frische Installation: keine Rollen
    return d.win;
  }
  const isClient = d => d.type === 'pc';
  const wid = d => init(d);

  // ---------- Tokenizer / Parser ----------
  function tokenize(s) {
    const out = []; let cur = '', q = null, depth = 0, has = false, par = false;
    const flush = () => { if (has) out.push({ v: cur, par }); cur = ''; has = false; par = false; };
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (depth) { if (c === '(') { depth++; cur += c; } else if (c === ')') { depth--; if (depth) cur += c; } else cur += c; continue; }
      if (q) { if (c === q) q = null; else cur += c; continue; }
      if (c === '"' || c === "'") { q = c; has = true; continue; }
      if (c === '(' && !has) { depth = 1; has = true; par = true; continue; }
      if (/\s/.test(c)) { flush(); continue; }
      cur += c; has = true;
    }
    flush(); return out;
  }
  function splitPipe(s) {
    const out = []; let cur = '', q = null, depth = 0;
    for (const c of s) { if (q) { cur += c; if (c === q) q = null; continue; } if (c === '"' || c === "'") { q = c; cur += c; continue; } if (c === '(') depth++; if (c === ')') depth--; if (c === '|' && !depth) { out.push(cur); cur = ''; continue; } cur += c; }
    out.push(cur); return out;
  }
  const A = {}; // Alias-Tabelle: cmdlet-Name (klein) → Funktion
  function parse(ctx, d, str) {
    const t = tokenize(str), name = (t.shift() || { v: '' }).v, p = {}, pos = [];
    for (let i = 0; i < t.length; i++) {
      const x = t[i];
      if (!x.par && /^-[A-Za-z]/.test(x.v)) { const k = x.v.slice(1).replace(/:.*$/, '').toLowerCase(), nx = t[i + 1]; if (x.v.includes(':')) p[k] = x.v.split(':').slice(1).join(':'); else if (nx && (nx.par || !/^-[A-Za-z]/.test(nx.v))) { p[k] = nx.par ? evalPar(ctx, d, nx.v) : nx.v; i++; } else p[k] = true; }
      else pos.push(x.par ? evalPar(ctx, d, x.v) : x.v);
    }
    return { name, p, pos };
  }
  const evalPar = (ctx, d, inner) => { const r = runPipe(ctx, d, inner); return typeof r === 'string' ? r.trim() : r; };
  const list = v => v === undefined || v === true ? [] : String(v).split(',').map(x => x.trim()).filter(Boolean);
  const get = (a, ...names) => { for (const n of names) if (a.p[n.toLowerCase()] !== undefined) return a.p[n.toLowerCase()]; return undefined; };

  // ---------- Ausgabe ----------
  function table(rows, cols) {
    if (!rows.length) return ''; cols = cols || Object.keys(rows[0]);
    const val = v => v === true ? 'True' : v === false ? 'False' : v == null ? '' : String(v), w = cols.map(c => Math.max(c.length, ...rows.map(r => val(r[c]).length)));
    return ['', cols.map((c, i) => c.padEnd(w[i])).join('  ').trimEnd(), cols.map((c, i) => '-'.repeat(c.length).padEnd(w[i])).join('  ').trimEnd()].concat(rows.map(r => cols.map((c, i) => val(r[c]).padEnd(w[i])).join('  ').trimEnd())).join('\n') + '\n';
  }
  const lst = (rows) => rows.map(r => Object.keys(r).map(k => `${k.padEnd(Math.max(...Object.keys(r).map(x => x.length)))} : ${r[k] === true ? 'True' : r[k] === false ? 'False' : r[k] == null ? '' : r[k]}`).join('\n')).join('\n\n') + '\n';
  const render = (v, mode) => Array.isArray(v) ? (mode === 'list' ? lst(v) : table(v, v.cols)) : (v == null ? '' : String(v));
  const err = (cmd, msg) => `${cmd} : ${msg}`;

  // ---------- Dienste / Firewall / Synchronisation ----------
  const DC_OF = (ctx, d) => { const w = d.win; if (!w || !w.domain) return null; if (w.domain.role === 'dc') return d; return ctx.net.devs[w.domain.dc] || null; };
  function sync(ctx, d) {
    const w = init(d), sv = d.svc; if (!sv) return;
    const run = n => w.svc[n] === 'Running';
    sv.http.on = !!(w.feats['Web-Server'] && run('W3SVC'));
    sv.dns.on = !!(w.feats.DNS && run('DNS'));
    sv.dhcp.on = !!(w.feats.DHCP && w.dhcp.scope && run('DHCPServer') && (!w.domain || w.dhcp.auth));
    if (w.dhcp.scope) { const s = w.dhcp.scope; Object.assign(sv.dhcp, { start: s.start, max: Math.max(1, ipn(s.end) - ipn(s.start) + 1), mask: s.mask, gw: s.router || '', dns: s.dns || '' }); }
    if (w.feats['Web-Server']) { const idx = w.files['C:\\inetpub\\wwwroot\\index.html']; if (idx) { const m = idx.t.match(/<title>([\s\S]*?)<\/title>/i); sv.http.title = m ? m[1] : d.cfg.hostname; sv.http.body = idx.t.replace(/<title>[\s\S]*?<\/title>/i, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); } else sv.http.body = '404 - File or directory not found.'; }
    if (w.domain && w.domain.role === 'dc') { sv.dns.records = (sv.dns.records || []).filter(r => !r.ad); [w.domain.name, d.cfg.hostname.toLowerCase() + '.' + w.domain.name].forEach(n => sv.dns.records.push({ name: n, ip: '@', ad: true })); }
  }
  const addFw = (w, rules) => rules.forEach(([name, port, proto]) => { if (!w.fw.some(r => r.name === name)) w.fw.push({ name, port, proto, on: true }); });

  // ---------- Cmdlets ----------
  const C = {};
  const ps = (names, fn) => names.forEach(n => { C[n.toLowerCase()] = fn; });
  const needServer = (d, cmd) => isClient(d) ? err(cmd, `Das Cmdlet ist nur auf Windows Server verfügbar (Rolle fehlt auf einem Client).`) : null;
  const needDc = (ctx, d, cmd) => { const w = init(d); if (!w.domain || w.domain.role !== 'dc') return err(cmd, 'Unable to find a default server with Active Directory Web Services running. (Dieser Server ist kein Domänencontroller.)'); return null; };
  const ad = d => d.win.ad || (d.win.ad = { users: [], groups: [{ name: 'Domain Admins', members: ['Administrator'] }, { name: 'Domain Users', members: ['Administrator'] }], ous: [], comps: [] });
  const sec = (a, ...n) => String(get(a, ...n) || '');
  const pwOk = pw => pw.length >= 7 && [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(r => r.test(pw)).length >= 3;

  ps(['hostname'], (a, st) => st.d.cfg.hostname);
  ps(['whoami'], (a, st) => { const w = init(st.d); return (w.domain ? NB(w.domain.name) : st.d.cfg.hostname.toLowerCase()).toLowerCase() + '\\' + (isClient(st.d) ? 'admin' : 'administrator'); });
  ps(['get-date'], () => 'Montag, 12. Oktober 2026 09:00:00');
  ps(['get-netipaddress', 'get-netipconfiguration'], (a, st) => { const rows = st.ctx.ifaces(st.d).map(i => ({ InterfaceAlias: i.alias, IPv4Address: i.ip ? i.ip + '/' + maskLen(i.mask) : '', Status: i.up ? 'Up' : 'Disconnected' })); rows.cols = ['InterfaceAlias', 'IPv4Address', 'Status']; return rows; });
  const maskLen = m => isIp(m) ? ipn(m).toString(2).replace(/0/g, '').length : null;
  ps(['new-netipaddress'], (a, st) => {
    const al = sec(a, 'interfacealias', 'interfaceindex'), ip = sec(a, 'ipaddress'), pl = +(get(a, 'prefixlength') || 24), gw = sec(a, 'defaultgateway'), i = st.ctx.ifaces(st.d).find(x => x.alias.toLowerCase() === al.toLowerCase());
    if (!i) return err('New-NetIPAddress', `Keine Netzwerkschnittstelle „${al}“ gefunden. Mit Get-NetIPAddress siehst du die Namen (z. B. Ethernet0).`);
    if (!isIp(ip)) return err('New-NetIPAddress', `Ungültige IP-Adresse „${ip}“.`); if (!(pl >= 1 && pl <= 32)) return err('New-NetIPAddress', 'PrefixLength 1 bis 32.');
    if (gw && !isIp(gw)) return err('New-NetIPAddress', `Ungültiges Gateway „${gw}“.`);
    st.ctx.setIp(st.d, i.port, ip, lenMask(pl)); if (gw) st.d.cfg.gw = gw; st.d.cfg.dhcp = false; return table([{ IPAddress: ip, InterfaceAlias: i.alias, PrefixLength: pl }]);
  });
  ps(['set-dnsclientserveraddress'], (a, st) => { const al = sec(a, 'interfacealias'), s = list(get(a, 'serveraddresses')); if (!st.ctx.ifaces(st.d).some(x => x.alias.toLowerCase() === al.toLowerCase())) return err('Set-DnsClientServerAddress', `Keine Netzwerkschnittstelle „${al}“ gefunden.`); if (!s.length || !s.every(isIp)) return err('Set-DnsClientServerAddress', 'ServerAddresses: gültige IP-Adresse(n) angeben.'); st.d.cfg.dns = s[0]; return ''; });
  ps(['get-dnsclientserveraddress'], (a, st) => { const r = [{ InterfaceAlias: 'Ethernet0', ServerAddresses: st.d.cfg.dns || '' }]; r.cols = ['InterfaceAlias', 'ServerAddresses']; return r; });
  ps(['test-netconnection'], (a, st) => {
    const tgt = sec(a, 'computername') || st.pos[0], port = get(a, 'port'); if (!tgt) return err('Test-NetConnection', 'ComputerName fehlt.');
    let ip = tgt, extra = ''; if (!isIp(tgt)) { const r = st.ctx.resolve(st.d, tgt); if (r.err) return `WARNING: Name resolution of ${tgt} failed\n${r.err}`; ip = r.ip; extra = `RemoteAddress     : ${ip}\n`; }
    const ok = st.ctx.ping(st.d, ip, port ? { proto: 'tcp', port: +port } : undefined);
    return `ComputerName       : ${tgt}\n${extra ? extra.replace('RemoteAddress    ', 'RemoteAddress      ') : `RemoteAddress      : ${ip}\n`}${port ? `RemotePort         : ${port}\nTcpTestSucceeded   : ${ok.ok ? 'True' : 'False'}` : `PingSucceeded      : ${ok.ok ? 'True' : 'False'}`}${ok.ok ? '' : '\n[Ping-Debugger] ' + ok.reason}`;
  });
  ps(['resolve-dnsname'], (a, st) => { const n = sec(a, 'name') || st.pos[0], r = st.ctx.resolve(st.d, n || ''); if (r.err) return err('Resolve-DnsName', `${n} : ${r.err}`); const rows = [{ Name: n, Type: 'A', TTL: 3600, IPAddress: r.ip }]; rows.cols = ['Name', 'Type', 'TTL', 'IPAddress']; return rows; });
  ps(['rename-computer'], (a, st) => { const n = sec(a, 'newname') || st.pos[0]; if (!/^[A-Za-z0-9-]{1,15}$/.test(n || '')) return err('Rename-Computer', 'Computername: 1 bis 15 Zeichen, Buchstaben, Ziffern und -.'); init(st.d).pendingName = n; return 'WARNING: The changes will take effect after you restart the computer ' + st.d.cfg.hostname + '. (Restart-Computer)'; });
  ps(['restart-computer'], (a, st) => { const w = init(st.d); if (w.pendingName) { st.d.cfg.hostname = w.pendingName; w.pendingName = null; } return 'Der Computer wird neu gestartet … (im Simulator sofort fertig)'; });
  ps(['systeminfo'], (a, st) => { const w = init(st.d); return `Host Name:                 ${st.d.cfg.hostname.toUpperCase()}\nOS Name:                   Microsoft Windows ${isClient(st.d) ? '11 Pro' : 'Server 2022 Standard'}\nDomain:                    ${w.domain ? w.domain.name : 'WORKGROUP'}\nLogon Server:              ${w.domain ? '\\\\' + DC_NAME(st.ctx, st.d) : '\\\\' + st.d.cfg.hostname.toUpperCase()}`; });
  const DC_NAME = (ctx, d) => { const dc = DC_OF(ctx, d); return dc ? dc.cfg.hostname.toUpperCase() : ''; };

  // --- Rollen ---
  ps(['install-windowsfeature', 'add-windowsfeature'], (a, st) => {
    const n = needServer(st.d, 'Install-WindowsFeature'); if (n) return n; const w = init(st.d), names = list(get(a, 'name') || st.pos[0]), rows = [];
    if (!names.length) return err('Install-WindowsFeature', 'Name fehlt (z. B. -Name AD-Domain-Services).');
    for (const f of names) {
      const F = FEATURES[f]; if (!F) return err('Install-WindowsFeature', `Das Feature „${f}“ gibt es nicht. Bekannt: ${Object.keys(FEATURES).join(', ')}.`);
      if (!w.feats[f]) { w.feats[f] = true; if (F.svc) w.svc[F.svc] = f === 'DHCP' ? 'Stopped' : 'Running'; if (F.fw && f !== 'DHCP') addFw(w, F.fw); if (f === 'DNS' && !w.dnsZones.length) { /* Zonen später */ } rows.push({ Success: true, 'Restart Needed': 'No', 'Exit Code': 'Success', 'Feature Result': F.d }); } else rows.push({ Success: true, 'Restart Needed': 'No', 'Exit Code': 'NoChangeNeeded', 'Feature Result': '{}' });
    }
    sync(st.ctx, st.d); rows.cols = ['Success', 'Restart Needed', 'Exit Code', 'Feature Result']; return rows;
  });
  ps(['get-windowsfeature'], (a, st) => { const w = init(st.d), rows = Object.keys(FEATURES).map(f => ({ 'Display Name': (w.feats[f] ? '[X] ' : '[ ] ') + FEATURES[f].d, Name: f, 'Install State': w.feats[f] ? 'Installed' : 'Available' })); rows.cols = ['Display Name', 'Name', 'Install State']; return rows; });
  ps(['install-addsforest'], (a, st) => {
    const n = needServer(st.d, 'Install-ADDSForest'); if (n) return n; const w = init(st.d), dom = sec(a, 'domainname').toLowerCase();
    if (!w.feats['AD-Domain-Services']) return err('Install-ADDSForest', 'Die Rolle AD-Domain-Services ist nicht installiert. Erst: Install-WindowsFeature AD-Domain-Services -IncludeManagementTools');
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(dom)) return err('Install-ADDSForest', 'DomainName: vollständiger Name wie lab.local.');
    if (w.domain) return err('Install-ADDSForest', `Der Server gehört schon zur Domäne ${w.domain.name}.`);
    if (!st.d.cfg.ip || st.d.cfg.dhcp) return err('Install-ADDSForest', 'Ein Domänencontroller braucht eine statische IP-Adresse (New-NetIPAddress …).');
    if (!get(a, 'safemodeadministratorpassword')) return err('Install-ADDSForest', 'SafeModeAdministratorPassword fehlt (-SafeModeAdministratorPassword (ConvertTo-SecureString "P@ssw0rd123" -AsPlainText -Force)).');
    if (!pwOk(String(get(a, 'safemodeadministratorpassword')))) return err('Install-ADDSForest', 'Das Kennwort erfüllt die Komplexitätsanforderungen nicht (mindestens 7 Zeichen, Groß-/Kleinbuchstaben, Ziffern, Sonderzeichen).');
    w.domain = { name: dom, role: 'dc', dc: st.d.id }; w.feats.DNS = true; w.svc.DNS = 'Running'; w.svc.NTDS = 'Running'; addFw(w, FEATURES.DNS.fw); if (!w.dnsZones.includes(dom)) w.dnsZones.push(dom); ad(st.d); st.d.cfg.dns = st.d.cfg.ip; sync(st.ctx, st.d);
    return `Die Gesamtstruktur ${dom} wurde erstellt. DNS-Rolle und Zone ${dom} sind eingerichtet, der Server ist jetzt Domänencontroller (NetBIOS: ${NB(dom)}).\n(Der Neustart ist im Simulator nicht nötig.)`;
  });
  ps(['get-addomain'], (a, st) => { const x = needDc(st.ctx, st.d, 'Get-ADDomain'); if (x) return x; const dom = st.d.win.domain.name; return `DNSRoot             : ${dom}\nNetBIOSName         : ${NB(dom)}\nDistinguishedName   : ${dn(dom)}\nPDCEmulator         : ${st.d.cfg.hostname.toLowerCase()}.${dom}\nForest              : ${dom}`; });
  ps(['new-adorganizationalunit'], (a, st) => { const x = needDc(st.ctx, st.d, 'New-ADOrganizationalUnit'); if (x) return x; const n = sec(a, 'name') || st.pos[0]; if (!n) return err('New-ADOrganizationalUnit', 'Name fehlt.'); const A_ = ad(st.d); if (A_.ous.includes(n)) return err('New-ADOrganizationalUnit', 'Die Organisationseinheit existiert bereits.'); A_.ous.push(n); return ''; });
  ps(['get-adorganizationalunit'], (a, st) => { const x = needDc(st.ctx, st.d, 'Get-ADOrganizationalUnit'); if (x) return x; const dom = st.d.win.domain.name, r = ad(st.d).ous.map(n => ({ Name: n, DistinguishedName: `OU=${n},${dn(dom)}` })); r.cols = ['Name', 'DistinguishedName']; return r; });
  const ouOf = (a, dom) => { const p = sec(a, 'path'); const m = p.match(/^OU=([^,]+),/i); return m ? m[1] : null; };
  ps(['new-aduser'], (a, st) => {
    const x = needDc(st.ctx, st.d, 'New-ADUser'); if (x) return x; const A_ = ad(st.d), name = sec(a, 'name') || st.pos[0], sam = sec(a, 'samaccountname') || (name || '').toLowerCase().replace(/\s+/g, '.'), pw = String(get(a, 'accountpassword') || ''), ou = ouOf(a);
    if (!name) return err('New-ADUser', 'Name fehlt.'); if (A_.users.some(u => u.sam.toLowerCase() === sam.toLowerCase())) return err('New-ADUser', 'Das angegebene Konto existiert bereits.');
    if (ou && !A_.ous.includes(ou)) return err('New-ADUser', `Das Verzeichnisobjekt OU=${ou} wurde nicht gefunden. Erst New-ADOrganizationalUnit.`);
    const en = get(a, 'enabled'); const enabled = en === true || /^(\$true|true|1)$/i.test(String(en)); if (en !== undefined && enabled && !pw) return err('New-ADUser', 'Ein aktiviertes Konto braucht ein Kennwort (-AccountPassword).');
    if (pw && !pwOk(pw)) return err('New-ADUser', 'Das Kennwort erfüllt die Längen-, Komplexitäts- oder Verlaufsanforderung der Domäne nicht (mindestens 7 Zeichen, Groß-/Kleinbuchstaben, Ziffern, Sonderzeichen).');
    A_.users.push({ sam, name, enabled: !!(enabled && pw), ou }); A_.groups.find(g => g.name === 'Domain Users').members.push(sam); return '';
  });
  const userRows = (A_, dom) => A_.users.map(u => ({ Name: u.name, SamAccountName: u.sam, Enabled: u.enabled, DistinguishedName: `CN=${u.name},${u.ou ? 'OU=' + u.ou + ',' : 'CN=Users,'}${dn(dom)}` }));
  const filt = (rows, a) => { const id = sec(a, 'identity'), f = sec(a, 'filter'); if (id) return rows.filter(r => [r.SamAccountName, r.Name].some(v => String(v).toLowerCase() === id.toLowerCase())); const m = f.match(/^(\w+)\s+-(eq|like)\s+'?([^']*)'?$/i); if (m) { const re = m[2].toLowerCase() === 'like' ? new RegExp('^' + m[3].replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i') : new RegExp('^' + m[3].replace(/[.+^${}()|[\]\\]/g, '\\$&') + '$', 'i'); return rows.filter(r => re.test(String(r[m[1]] == null ? '' : r[m[1]]))); } return rows; };
  ps(['get-aduser'], (a, st) => { const x = needDc(st.ctx, st.d, 'Get-ADUser'); if (x) return x; const r = filt(userRows(ad(st.d), st.d.win.domain.name), a); if (get(a, 'identity') && !r.length) return err('Get-ADUser', `Kann kein Objekt mit dem Namen „${get(a, 'identity')}“ finden.`); r.cols = ['Name', 'SamAccountName', 'Enabled']; return r; });
  ps(['remove-aduser'], (a, st) => { const x = needDc(st.ctx, st.d, 'Remove-ADUser'); if (x) return x; const A_ = ad(st.d), id = sec(a, 'identity') || st.pos[0], u = A_.users.find(v => v.sam.toLowerCase() === String(id).toLowerCase()); if (!u) return err('Remove-ADUser', `Kann kein Objekt mit dem Namen „${id}“ finden.`); A_.users = A_.users.filter(v => v !== u); A_.groups.forEach(g => { g.members = g.members.filter(m => m !== u.sam); }); return ''; });
  C['disable-adaccount'] = (a, st) => adEnable(a, st, false, 'Disable-ADAccount'); C['enable-adaccount'] = (a, st) => adEnable(a, st, true, 'Enable-ADAccount');
  function adEnable(a, st, on, cmd) { const x = needDc(st.ctx, st.d, cmd); if (x) return x; const id = sec(a, 'identity') || st.pos[0], u = ad(st.d).users.find(v => v.sam.toLowerCase() === String(id).toLowerCase()); if (!u) return err(cmd, `Kann kein Objekt mit dem Namen „${id}“ finden.`); u.enabled = on; return ''; }
  ps(['new-adgroup'], (a, st) => { const x = needDc(st.ctx, st.d, 'New-ADGroup'); if (x) return x; const A_ = ad(st.d), n = sec(a, 'name') || st.pos[0], sc = sec(a, 'groupscope'); if (!n) return err('New-ADGroup', 'Name fehlt.'); if (!['Global', 'Universal', 'DomainLocal'].includes(sc)) return err('New-ADGroup', 'GroupScope fehlt oder ungültig (Global, Universal oder DomainLocal).'); if (A_.groups.some(g => g.name.toLowerCase() === n.toLowerCase())) return err('New-ADGroup', 'Die Gruppe existiert bereits.'); A_.groups.push({ name: n, members: [] }); return ''; });
  ps(['get-adgroup'], (a, st) => { const x = needDc(st.ctx, st.d, 'Get-ADGroup'); if (x) return x; const r = filt(ad(st.d).groups.map(g => ({ Name: g.name, SamAccountName: g.name, Members: g.members.length })), a); r.cols = ['Name', 'Members']; return r; });
  ps(['add-adgroupmember'], (a, st) => { const x = needDc(st.ctx, st.d, 'Add-ADGroupMember'); if (x) return x; const A_ = ad(st.d), id = sec(a, 'identity') || st.pos[0], g = A_.groups.find(v => v.name.toLowerCase() === String(id).toLowerCase()); if (!g) return err('Add-ADGroupMember', `Kann kein Objekt mit dem Namen „${id}“ finden.`); for (const m of list(get(a, 'members'))) { const u = A_.users.find(v => v.sam.toLowerCase() === m.toLowerCase()); if (!u) return err('Add-ADGroupMember', `Kann kein Objekt „${m}“ finden.`); if (!g.members.includes(u.sam)) g.members.push(u.sam); } return ''; });
  ps(['get-adgroupmember'], (a, st) => { const x = needDc(st.ctx, st.d, 'Get-ADGroupMember'); if (x) return x; const A_ = ad(st.d), id = sec(a, 'identity') || st.pos[0], g = A_.groups.find(v => v.name.toLowerCase() === String(id).toLowerCase()); if (!g) return err('Get-ADGroupMember', `Kann kein Objekt mit dem Namen „${id}“ finden.`); const r = g.members.map(m => { const u = A_.users.find(v => v.sam === m); return { Name: u ? u.name : m, SamAccountName: m }; }); r.cols = ['Name', 'SamAccountName']; return r; });
  ps(['get-adcomputer'], (a, st) => { const x = needDc(st.ctx, st.d, 'Get-ADComputer'); if (x) return x; const dom = st.d.win.domain.name, r = [{ Name: st.d.cfg.hostname.toUpperCase(), DNSHostName: st.d.cfg.hostname.toLowerCase() + '.' + dom }].concat(ad(st.d).comps.map(c => ({ Name: c.name.toUpperCase(), DNSHostName: c.name.toLowerCase() + '.' + dom }))); r.cols = ['Name', 'DNSHostName']; return r; });
  ps(['add-computer'], (a, st) => {
    const w = init(st.d), dom = (sec(a, 'domainname') || sec(a, 'domain')).toLowerCase(), cred = String(get(a, 'credential') || '');
    if (!dom) return err('Add-Computer', 'Das Cmdlet braucht -DomainName (und -Credential).'); if (!cred) return err('Add-Computer', 'Fehlender Pflichtparameter: Credential (z. B. -Credential lab\\administrator).');
    if (w.domain) return err('Add-Computer', `Der Computer „${st.d.cfg.hostname}“ gehört schon zur Domäne „${w.domain.name}“.`);
    const fail = why => err('Add-Computer', `Der Computer „${st.d.cfg.hostname}“ konnte der Domäne „${dom}“ nicht beitreten, Fehler: Die angegebene Domäne ist nicht vorhanden oder konnte nicht kontaktiert werden.\n[Hinweis] ${why}`);
    if (!st.d.cfg.ip) return fail('Der Computer hat keine IP-Adresse (New-NetIPAddress oder DHCP).');
    const r = st.ctx.resolve(st.d, dom); if (r.err) return fail('DNS: ' + r.err + ' Der DNS-Server des Computers muss der Domänencontroller sein (Set-DnsClientServerAddress).');
    const dc = Object.values(st.ctx.net.devs).find(x => x.win && x.win.domain && x.win.domain.role === 'dc' && x.win.domain.name === dom && ((x.cfg.ip === r.ip) || (x.cfg.nic && Object.values(x.cfg.nic).some(n => n && n.ip === r.ip)))); if (!dc) return fail(`„${dom}“ löst zu ${r.ip} auf, dort läuft aber kein Domänencontroller dieser Domäne.`);
    const pr = st.ctx.ping(st.d, r.ip, { proto: 'tcp', port: 389 }); if (!pr.ok) return fail(`Der Domänencontroller ${dc.cfg.hostname} (${r.ip}) ist nicht erreichbar: ${pr.reason}`);
    if (dc.win.svc.NTDS !== 'Running') return fail('Der Dienst NTDS (Active Directory) auf dem Domänencontroller läuft nicht.');
    const u = cred.split('\\'); if (u[0].toUpperCase() !== NB(dom) && u.length > 1) return err('Add-Computer', `Das Benutzerkonto „${cred}“ gehört nicht zur Domäne ${NB(dom)}.`);
    w.domain = { name: dom, role: 'member', dc: dc.id }; const A_ = ad(dc); if (!A_.comps.some(c => c.name.toLowerCase() === st.d.cfg.hostname.toLowerCase())) A_.comps.push({ name: st.d.cfg.hostname });
    sync(st.ctx, st.d); return `WARNING: Die Änderungen werden nach dem Neustart des Computers ${st.d.cfg.hostname} wirksam. (Im Simulator sofort.)`;
  });
  ps(['remove-computer'], (a, st) => { const w = init(st.d); if (!w.domain) return err('Remove-Computer', 'Der Computer ist in keiner Domäne.'); const dc = DC_OF(st.ctx, st.d); if (dc && dc.win && dc.win.ad) dc.win.ad.comps = dc.win.ad.comps.filter(c => c.name.toLowerCase() !== st.d.cfg.hostname.toLowerCase()); w.domain = null; return 'WARNING: Der Computer ist jetzt Mitglied der Arbeitsgruppe WORKGROUP.'; });

  // --- DNS-Server ---
  ps(['add-dnsserverprimaryzone'], (a, st) => { const w = init(st.d); if (!w.feats.DNS) return err('Add-DnsServerPrimaryZone', 'Die DNS-Rolle ist nicht installiert (Install-WindowsFeature DNS).'); const n = (sec(a, 'name') || st.pos[0] || '').toLowerCase(); if (!n) return err('Add-DnsServerPrimaryZone', 'Name fehlt.'); if (w.dnsZones.includes(n)) return err('Add-DnsServerPrimaryZone', `Die Zone ${n} existiert bereits.`); w.dnsZones.push(n); return ''; });
  ps(['add-dnsserverresourcerecorda'], (a, st) => { const w = init(st.d), z = sec(a, 'zonename').toLowerCase(), n = sec(a, 'name'), ip = sec(a, 'ipv4address'); if (!w.feats.DNS) return err('Add-DnsServerResourceRecordA', 'Die DNS-Rolle ist nicht installiert.'); if (!w.dnsZones.includes(z)) return err('Add-DnsServerResourceRecordA', `Die Zone ${z} existiert nicht auf diesem Server.`); if (!n || !isIp(ip)) return err('Add-DnsServerResourceRecordA', 'Name und gültige IPv4Address angeben.'); const fq = n === '@' ? z : n + '.' + z; st.d.svc.dns.records = (st.d.svc.dns.records || []).filter(r => r.name.toLowerCase() !== fq.toLowerCase()); st.d.svc.dns.records.push({ name: fq, ip }); return ''; });
  ps(['get-dnsserverresourcerecord'], (a, st) => { const w = init(st.d), z = sec(a, 'zonename').toLowerCase(); if (!w.dnsZones.includes(z)) return err('Get-DnsServerResourceRecord', `Die Zone ${z} existiert nicht.`); const r = (st.d.svc.dns.records || []).filter(x => x.name.toLowerCase().endsWith(z)).map(x => ({ HostName: x.name === z ? '@' : x.name.slice(0, -z.length - 1), RecordType: 'A', RecordData: x.ip === '@' ? st.d.cfg.ip : x.ip })); r.cols = ['HostName', 'RecordType', 'RecordData']; return r; });

  // --- DHCP-Server ---
  ps(['add-dhcpserverv4scope'], (a, st) => {
    const w = init(st.d); if (!w.feats.DHCP) return err('Add-DhcpServerv4Scope', 'Die DHCP-Rolle ist nicht installiert (Install-WindowsFeature DHCP).');
    const s = sec(a, 'startrange'), e = sec(a, 'endrange'), m = sec(a, 'subnetmask'), n = sec(a, 'name');
    if (!n || !isIp(s) || !isIp(e) || !isIp(m)) return err('Add-DhcpServerv4Scope', 'Name, StartRange, EndRange und SubnetMask (gültige IPv4-Adressen) angeben.'); if (ipn(e) < ipn(s)) return err('Add-DhcpServerv4Scope', 'EndRange liegt vor StartRange.');
    if (w.dhcp.scope) return err('Add-DhcpServerv4Scope', 'Es gibt schon einen Bereich (Simulator: ein Bereich pro Server).');
    w.dhcp.scope = { name: n, start: s, end: e, mask: m, router: '', dns: '' }; sync(st.ctx, st.d); return '';
  });
  ps(['set-dhcpserverv4optionvalue'], (a, st) => { const w = init(st.d); if (!w.dhcp.scope) return err('Set-DhcpServerv4OptionValue', 'Es gibt noch keinen Bereich (Add-DhcpServerv4Scope).'); const r = sec(a, 'router'), dns = sec(a, 'dnsserver'); if (r && !isIp(r)) return err('Set-DhcpServerv4OptionValue', 'Ungültiger Router.'); if (dns && !isIp(dns)) return err('Set-DhcpServerv4OptionValue', 'Ungültiger DnsServer.'); if (r) w.dhcp.scope.router = r; if (dns) w.dhcp.scope.dns = dns; sync(st.ctx, st.d); return ''; });
  ps(['get-dhcpserverv4scope'], (a, st) => { const w = init(st.d), s = w.dhcp.scope, r = s ? [{ ScopeId: n2ip((ipn(s.start) & ipn(s.mask)) >>> 0), Name: s.name, StartRange: s.start, EndRange: s.end, State: 'Active' }] : []; r.cols = ['ScopeId', 'Name', 'StartRange', 'EndRange', 'State']; return r; });
  ps(['remove-dhcpserverv4scope'], (a, st) => { const w = init(st.d); if (!w.dhcp.scope) return err('Remove-DhcpServerv4Scope', 'Es gibt keinen Bereich.'); w.dhcp.scope = null; sync(st.ctx, st.d); return ''; });
  ps(['add-dhcpserverindc'], (a, st) => { const w = init(st.d); if (!w.feats.DHCP) return err('Add-DhcpServerInDC', 'Die DHCP-Rolle ist nicht installiert.'); if (!w.domain) return err('Add-DhcpServerInDC', 'Der Server ist in keiner Domäne, eine Autorisierung ist nicht nötig.'); w.dhcp.auth = true; sync(st.ctx, st.d); return ''; });
  ps(['get-dhcpserverindc'], (a, st) => { const w = init(st.d), r = w.dhcp.auth ? [{ IPAddress: st.d.cfg.ip, DnsName: st.d.cfg.hostname.toLowerCase() + (w.domain ? '.' + w.domain.name : '') }] : []; r.cols = ['IPAddress', 'DnsName']; return r; });

  // --- Dienste ---
  const svcRows = w => Object.keys(w.svc).map(n => ({ Status: w.svc[n], Name: n, DisplayName: SERVICES[n] || n })), svcFix = rows => { rows.cols = ['Status', 'Name', 'DisplayName']; return rows; };
  ps(['get-service'], (a, st) => { const w = init(st.d), n = sec(a, 'name') || st.pos[0]; let r = svcRows(w); if (n) { const re = new RegExp('^' + n.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i'); r = r.filter(x => re.test(x.Name) || re.test(x.DisplayName)); if (!r.length) return err('Get-Service', `Es wurde kein Dienst mit dem Namen „${n}“ gefunden.`); } return svcFix(r); });
  const svcAct = (cmd, to) => (a, st) => {
    const w = init(st.d), n = sec(a, 'name') || st.pos[0]; if (!n) return err(cmd, 'Name fehlt.'); const key = Object.keys(w.svc).find(k => k.toLowerCase() === n.toLowerCase());
    if (!key) return err(cmd, `Der Dienst „${n}“ wurde nicht gefunden.`);
    if (to === 'Running' && key === 'DHCPServer' && w.domain && !w.dhcp.auth) { w.svc[key] = 'Running'; sync(st.ctx, st.d); return `WARNING: Der DHCP-Dienst läuft, vergibt aber keine Adressen: Der Server ist in der Domäne nicht autorisiert (Add-DhcpServerInDC).`; }
    w.svc[key] = to; sync(st.ctx, st.d); return '';
  };
  ps(['start-service'], svcAct('Start-Service', 'Running')); ps(['stop-service'], svcAct('Stop-Service', 'Stopped'));
  ps(['restart-service'], (a, st) => { const r = svcAct('Restart-Service', 'Stopped')(a, st); return r ? r : svcAct('Restart-Service', 'Running')(a, st); });

  // --- Firewall ---
  ps(['get-netfirewallrule'], (a, st) => { const w = init(st.d), r = w.fw.map(x => ({ DisplayName: x.name, Direction: 'Inbound', Enabled: x.on, Action: 'Allow', LocalPort: x.port + '/' + x.proto })); r.cols = ['DisplayName', 'Enabled', 'LocalPort']; return r; });
  ps(['new-netfirewallrule'], (a, st) => { const w = init(st.d), n = sec(a, 'displayname'), port = +sec(a, 'localport'), pr = (sec(a, 'protocol') || 'TCP').toUpperCase(); if (!n || !(port >= 1 && port <= 65535)) return err('New-NetFirewallRule', 'DisplayName und LocalPort (1 bis 65535) angeben.'); if (!/^(allow)$/i.test(sec(a, 'action') || 'Allow')) { w.fw.push({ name: n, port, proto: pr, on: false }); sync(st.ctx, st.d); return ''; } w.fw.push({ name: n, port, proto: pr, on: true }); sync(st.ctx, st.d); return ''; });
  const fwSet = on => (a, st) => { const w = init(st.d), n = sec(a, 'displayname') || st.pos[0], r = w.fw.find(x => x.name.toLowerCase() === String(n).toLowerCase()); if (!r) return err(on ? 'Enable-NetFirewallRule' : 'Disable-NetFirewallRule', `Keine Regel „${n}“ gefunden (Get-NetFirewallRule).`); r.on = on; sync(st.ctx, st.d); return ''; };
  ps(['enable-netfirewallrule'], fwSet(true)); ps(['disable-netfirewallrule'], fwSet(false));
  ps(['remove-netfirewallrule'], (a, st) => { const w = init(st.d), n = sec(a, 'displayname') || st.pos[0]; w.fw = w.fw.filter(x => x.name.toLowerCase() !== String(n).toLowerCase()); sync(st.ctx, st.d); return ''; });
  ps(['set-netfirewallprofile'], (a, st) => { const w = init(st.d), en = get(a, 'enabled'); if (en === undefined) return err('Set-NetFirewallProfile', 'Enabled fehlt (True oder False).'); w.fwOn = /^(\$?true|1)$/i.test(String(en)); sync(st.ctx, st.d); return ''; });

  // --- Dateien und Freigaben ---
  const wpath = (w, p) => { p = String(p || '').replace(/\//g, '\\'); if (!/^[A-Za-z]:/.test(p)) p = w.cwd.replace(/\\$/, '') + '\\' + p; const out = []; p.slice(3).split('\\').forEach(x => { if (!x || x === '.') return; if (x === '..') out.pop(); else out.push(x); }); return p.slice(0, 3).toUpperCase().replace(/\\?$/, '\\') + out.join('\\'); };
  const dirOf = p => { const r = p.replace(/\\[^\\]*$/, ''); return r.length <= 2 ? p.slice(0, 2) + '\\' : r; }, norm = p => p.length > 3 ? p.replace(/\\$/, '') : p;
  ps(['new-item'], (a, st) => { const w = init(st.d), p = norm(wpath(w, sec(a, 'path') || st.pos[0])), t = (sec(a, 'itemtype') || 'File').toLowerCase(); if (w.files[p]) return err('New-Item', `Das Element mit dem angegebenen Namen ${p} ist bereits vorhanden.`); if (!w.files[norm(dirOf(p))]) return err('New-Item', `Der Pfad ${dirOf(p)} wurde nicht gefunden.`); w.files[p] = t.startsWith('dir') ? { d: 1 } : { t: String(get(a, 'value') || '') }; return `\n    Verzeichnis: ${dirOf(p)}\n\nMode   Name\n----   ----\n${t.startsWith('dir') ? 'd-----' : '-a----'} ${p.replace(/^.*\\/, '')}`; });
  C['set-content'] = (a, st) => wr(a, st, false, 'Set-Content'); C['add-content'] = (a, st) => wr(a, st, true, 'Add-Content');
  function wr(a, st, app, cmd) { const w = init(st.d), p = norm(wpath(w, sec(a, 'path') || st.pos[0])), v = String(get(a, 'value') !== undefined ? get(a, 'value') : st.pos[1] || ''); if (!w.files[norm(dirOf(p))]) return err(cmd, `Der Pfad ${dirOf(p)} wurde nicht gefunden.`); if (w.files[p] && w.files[p].d) return err(cmd, `Zugriff verweigert: ${p} ist ein Verzeichnis.`); w.files[p] = { t: (app && w.files[p] ? w.files[p].t + '\n' : '') + v }; sync(st.ctx, st.d); return ''; }
  ps(['get-content', 'cat', 'type'], (a, st) => { const w = init(st.d), p = norm(wpath(w, sec(a, 'path') || st.pos[0])), f = w.files[p]; if (!f || f.d) return err('Get-Content', `Der Pfad ${p} kann nicht gefunden werden, da er nicht vorhanden ist.`); return f.t; });
  ps(['test-path'], (a, st) => { const w = init(st.d), p = norm(wpath(w, sec(a, 'path') || st.pos[0])); return w.files[p] ? 'True' : 'False'; });
  ps(['remove-item', 'del', 'rm'], (a, st) => { const w = init(st.d), p = norm(wpath(w, sec(a, 'path') || st.pos[0])); if (!w.files[p]) return err('Remove-Item', `Der Pfad ${p} kann nicht gefunden werden.`); Object.keys(w.files).forEach(k => { if (k === p || k.startsWith(p + '\\')) delete w.files[k]; }); sync(st.ctx, st.d); return ''; });
  ps(['get-childitem', 'dir', 'ls'], (a, st) => { const w = init(st.d), p = norm(wpath(w, sec(a, 'path') || st.pos[0] || w.cwd)); if (!w.files[p] && p.length > 3) return err('Get-ChildItem', `Der Pfad ${p} kann nicht gefunden werden.`); const r = Object.keys(w.files).filter(k => k !== p && dirOf(k) === p).map(k => ({ Mode: w.files[k].d ? 'd-----' : '-a----', Length: w.files[k].d ? '' : (w.files[k].t || '').length, Name: k.replace(/^.*\\/, '') })); r.cols = ['Mode', 'Length', 'Name']; return r; });
  ps(['set-location', 'cd'], (a, st) => { const w = init(st.d), p = norm(wpath(w, sec(a, 'path') || st.pos[0])); if (!w.files[p] || !w.files[p].d) return err('Set-Location', `Der Pfad ${p} kann nicht gefunden werden.`); w.cwd = p; return ''; });
  ps(['new-smbshare'], (a, st) => {
    const w = init(st.d), n = sec(a, 'name'), p = norm(wpath(w, sec(a, 'path'))); if (!n || !sec(a, 'path')) return err('New-SmbShare', 'Name und Path angeben.'); if (!w.files[p] || !w.files[p].d) return err('New-SmbShare', `Der Ordner ${p} existiert nicht (New-Item -ItemType Directory).`);
    if (w.shares.some(s => s.name.toLowerCase() === n.toLowerCase())) return err('New-SmbShare', `Die Freigabe ${n} existiert bereits.`);
    for (const k of ['fullaccess', 'readaccess', 'changeaccess']) for (const who of list(get(a, k))) { const m = who.split('\\'), g = m[m.length - 1], dc = DC_OF(st.ctx, st.d); if (/^(everyone|jeder)$/i.test(who)) continue; if (!dc || !dc.win || !dc.win.ad) return err('New-SmbShare', `Keine Zuordnung zwischen Kontonamen und Sicherheits-IDs für „${who}“: Der Server ist in keiner Domäne.`); const A_ = dc.win.ad; if (!A_.groups.some(x => x.name.toLowerCase() === g.toLowerCase()) && !A_.users.some(x => x.sam.toLowerCase() === g.toLowerCase())) return err('New-SmbShare', `Keine Zuordnung zwischen Kontonamen und Sicherheits-IDs für „${who}“ (Gruppe oder Benutzer existiert in ${dc.win.domain.name} nicht).`); }
    w.shares.push({ name: n, path: p, full: list(get(a, 'fullaccess')), change: list(get(a, 'changeaccess')), read: list(get(a, 'readaccess')) }); const r = [{ Name: n, ScopeName: '*', Path: p }]; r.cols = ['Name', 'ScopeName', 'Path']; return r;
  });
  ps(['get-smbshare'], (a, st) => { const w = init(st.d), r = [{ Name: 'ADMIN$', Path: 'C:\\Windows' }, { Name: 'C$', Path: 'C:\\' }].concat(w.shares.map(s => ({ Name: s.name, Path: s.path }))); r.cols = ['Name', 'Path']; return r; });

  // --- Pipeline-Filter ---
  const FILTERS = {
    'select-object': (v, a) => { const cols = list(get(a, 'property') || a.pos[0]); if (!Array.isArray(v) || !cols.length) return v; const r = v.map(o => { const x = {}; cols.forEach(c => { const k = Object.keys(o).find(y => y.toLowerCase() === c.toLowerCase()); x[k || c] = k ? o[k] : ''; }); return x; }); r.cols = r[0] ? Object.keys(r[0]) : cols; return r; },
    'format-table': (v, a) => { const r = v; if (Array.isArray(r) && (a.pos[0] || get(a, 'property'))) return FILTERS['select-object'](r, a); return r; }, 'format-list': (v, a) => { v.mode = 'list'; return v; },
    'measure-object': v => `\nCount    : ${Array.isArray(v) ? v.length : 1}\n`, 'sort-object': (v, a) => { const k = list(get(a, 'property') || a.pos[0])[0]; if (!Array.isArray(v) || !k) return v; const r = v.slice().sort((x, y) => String(x[k]).localeCompare(String(y[k]), 'de')); r.cols = v.cols; return r; },
    'out-string': v => v, 'out-host': v => v,
    'where-object': (v, a, raw) => { const m = raw.match(/\$_\.(\w+)\s+-(eq|ne|like|match)\s+'?"?([^'"}\s]+)'?"?/i) || raw.match(/^(\w+)\s+-(eq|ne|like|match)\s+'?"?([^'"}\s]+)'?"?/i); if (!Array.isArray(v) || !m) return v; const val = x => String(x === true ? 'True' : x === false ? 'False' : x == null ? '' : x).toLowerCase(), t = m[3].toLowerCase().replace(/^\$/, ''); const r = v.filter(o => { const k = Object.keys(o).find(y => y.toLowerCase() === m[1].toLowerCase()), x = k ? val(o[k]) : '', op = m[2].toLowerCase(); return op === 'eq' ? x === t : op === 'ne' ? x !== t : op === 'like' ? new RegExp('^' + t.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(x) : new RegExp(t, 'i').test(x); }); r.cols = v.cols; return r; }
  };
  FILTERS.ft = FILTERS['format-table']; FILTERS.fl = FILTERS['format-list']; FILTERS.select = FILTERS['select-object']; FILTERS.sort = FILTERS['sort-object']; FILTERS.where = FILTERS['where-object']; FILTERS['?'] = FILTERS['where-object']; FILTERS.measure = FILTERS['measure-object'];
  const FALLBACK = /^(ping|nslookup|tracert|traceroute|trace|nc|ipconfig|show|\?|ip|curl|help)$/i;

  function runPipe(ctx, d, line) {
    const parts = splitPipe(line.trim()); let v = null;
    for (let i = 0; i < parts.length; i++) {
      const raw = parts[i].trim(), nm = (raw.split(/\s+/)[0] || '').toLowerCase();
      if (i > 0 && FILTERS[nm]) { const a = parse(ctx, d, raw); v = FILTERS[nm](v, a, raw.slice(raw.indexOf(' ') + 1).replace(/^\{|\}$/g, '').trim()); continue; }
      const a = parse(ctx, d, raw), fn = Object.prototype.hasOwnProperty.call(C, a.name.toLowerCase()) ? C[a.name.toLowerCase()] : null;
      if (!fn) { if (FALLBACK.test(a.name)) { v = ctx.fallback(d, raw); continue; } v = err(a.name, `Die Benennung „${a.name}“ wurde nicht als Name eines Cmdlet, einer Funktion, einer Skriptdatei oder eines ausführbaren Programms erkannt. Überprüfen Sie die Schreibweise des Namens, oder ob der Pfad korrekt ist.`); continue; }
      if (nm === 'convertto-securestring') { v = String(a.p.string || a.pos[0] || ''); continue; }
      v = fn(a, { d, ctx, pos: a.pos });
    }
    return v;
  }
  C['convertto-securestring'] = (a) => String(a.p.string || a.pos[0] || '');
  C['get-credential'] = (a) => String(a.pos[0] || a.p.username || '');
  C['write-host'] = (a) => a.pos.join(' '); C['write-output'] = C['write-host']; C.echo = C['write-host'];
  C['get-command'] = () => 'Verfügbar: Install-WindowsFeature, Get-WindowsFeature, Install-ADDSForest, New-ADUser, Get-ADUser, New-ADGroup, Add-ADGroupMember, Add-Computer, New-NetIPAddress, Set-DnsClientServerAddress, Add-DhcpServerv4Scope, Add-DnsServerResourceRecordA, Get-Service, New-NetFirewallRule, New-Item, Set-Content, New-SmbShare … (Get-Help <Name>)';
  C['get-help'] = (a) => a.pos[0] ? `Hilfe zu ${a.pos[0]}: Im Simulator gibt es keine Hilfeseiten. Das Wiki erklärt die Konzepte (Windows Server und Active Directory).` : C['get-command']();
  C.help = C['get-help'];
  C['clear-host'] = () => ''; C.cls = () => '';

  function exec(ctx, d, raw) {
    const w = init(d); const line = String(raw || '').trim(); if (!line) return '';
    const stmts = line.split(/;(?=(?:[^"']*["'][^"']*["'])*[^"']*$)/).map(x => x.trim()).filter(Boolean), out = [];
    for (const s of stmts) { const r = runPipe(ctx, d, s); const text = Array.isArray(r) ? render(r, r.mode) : (r == null ? '' : String(r)); if (text !== '') out.push(text.replace(/\n+$/, '')); }
    void w; return out.join('\n');
  }
  const prompt = d => { const w = init(d); return isClient(d) ? `C:\\Users\\admin>` : `PS ${w.cwd}> `; };
  const isWin = d => !!d && ((d.type === 'server' && d.os === 'windows') || (d.type === 'pc' && d.icon === 'pc'));
  return { exec, prompt, init, isWin, sync, FEATURES, SERVICES, NB, dn };
})();
if (typeof module !== 'undefined') module.exports = WIN;
