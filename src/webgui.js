// ===================== NetLab Web-GUIs =====================
// Verwaltungsoberflächen im Browserfenster: Linux-Server, Hypervisor, Windows-Server, Storage, FC-Switch.
// Die Oberflächen rufen dieselben Funktionen wie die Terminals auf (Linux, PowerShell) beziehungsweise
// die Module für Storage und Virtualisierung. Das Planer-Skript übergibt die Schnittstelle über init().
const WEBGUI = (function () {
  const PORT = 8443, NETPORT = 443;
  let A = null; const SESS = {};
  const init = api => { A = api; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const kindOf = d => {
    if (!d) return null; if (d.type === 'ap') return 'ap'; if (d.type === 'wlc') return 'wlc'; if (d.type === 'switch') return 'switch'; if (d.type === 'router') return A.isCloud(d) ? null : d.fw ? 'firewall' : 'router'; if (d.type === 'storage') return 'storage'; if (d.type === 'fc') return 'fabric';
    if (d.type !== 'server' || A.isCloud(d)) return null;
    return d.os === 'windows' ? 'windows' : (A.VIRT.isHost(d) ? 'hypervisor' : 'linux');
  };
  const PRODUCT = { linux: ['Server-Web-Konsole', 'Linux'], hypervisor: ['Virtualisierungs-Manager', 'Hypervisor'], windows: ['Server-Manager', 'Windows Server 2022'], storage: ['Storage-Manager', 'Speichersystem'], fabric: ['Fabric-Manager', 'FC-Switch'], switch: ['Catalyst Web-Oberfläche', 'Cisco IOS XE Switch'], router: ['Router Web-Oberfläche', 'Cisco IOS XE Router'], firewall: ['Cisco ASDM', 'Adaptive Security Device Manager'], ap: ['Access-Point-Verwaltung', 'Cisco Access Point'], wlc: ['WLAN-Controller', 'Catalyst 9800'] };
  const isNet = k => k === 'switch' || k === 'router' || k === 'firewall';
  const portOf = d => { const k = kindOf(d); return isNet(k) || k === 'ap' || k === 'wlc' ? NETPORT : PORT; };
  const hasGui = d => !!kindOf(d);

  // ---------- kleine UI-Bausteine ----------
  const attrs = o => Object.entries(o || {}).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ');
  const btn = (label, act, data, cls) => `<button type="button" class="wg-b ${cls || ''}" data-act="${act}" ${attrs(data)}>${label}</button>`;
  const chip = (t, k) => `<span class="wg-chip ${k || ''}">${t}</span>`;
  const tbl = (head, rows, empty) => rows.length ? `<div class="wg-ts"><table class="wg-t"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : `<p class="wg-empty">${empty || 'Keine Einträge.'}</p>`;
  const field = (id, label, val, o = {}) => `<div class="wg-f"><label for="wf-${id}">${label}</label><input id="wf-${id}" ${o.type ? `type="${o.type}"` : ''} value="${esc(val == null ? '' : val)}" ${o.ph ? `placeholder="${esc(o.ph)}"` : ''} ${o.min != null ? `min="${o.min}"` : ''} ${o.max != null ? `max="${o.max}"` : ''} autocomplete="off" spellcheck="false">${o.hint ? `<small>${o.hint}</small>` : ''}</div>`;
  const sel = (id, label, opts, cur, hint) => `<div class="wg-f"><label for="wf-${id}">${label}</label><select id="wf-${id}">${opts.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>${hint ? `<small>${hint}</small>` : ''}</div>`;
  const bar = (used, total, warn) => { const p = total ? Math.min(100, Math.round(used / total * 100)) : 0; return `<div class="wg-bar" role="img" aria-label="${p} Prozent"><i class="${p >= (warn || 90) ? 'hot' : ''}" style="width:${p}%"></i></div>`; };
  const gb = n => n >= 1024 ? (n / 1024).toFixed(1).replace('.0', '') + ' TB' : n + ' GB';
  const card = (title, body, cls) => `<section class="wg-card ${cls || ''}"><h3>${title}</h3>${body}</section>`;
  const failed = out => /(^|\n)(\S+ : |error:|E: |bash: |Failed |Job for |.*Permission denied|.*not found|.*failed)/i.test(String(out || ''));

  // ---------- Fenster / Zustand ----------
  function create(devId, root, o = {}) {
    const G = { id: devId, page: null, dlg: null, msg: null, log: [], file: null, tab: {}, auth: !!SESS[devId] || !!o.auth, chrome: !!o.chrome, onClose: o.onClose };
    const dev = () => A.net().devs[devId], kind = () => kindOf(dev());
    const draw = () => {
      const d = dev(); if (!d) { root.innerHTML = '<p class="wg-empty">Das Gerät gibt es nicht mehr.</p>'; return; }
      const k = kind(), main = root.querySelector('.wg-main'), top = main ? main.scrollTop : 0, ip = hostIp(d);
      if (!k) { root.innerHTML = '<p class="wg-empty">Dieses Gerät hat keine Weboberfläche.</p>'; return; }
      clearTimeout(G._bt); const ps = A.powerState ? A.powerState(d) : 'on';
      if (ps !== 'on') {
        const left = A.bootLeft(d), name = PRODUCT[k][0];
        root.innerHTML = `<div class="wg-win">${G.chrome ? `<div class="wg-chrome"><span class="wg-dots"><i></i><i></i><i></i></span><div class="wg-url"><span>${esc(d.cfg.hostname)}</span></div><button class="wg-x" data-act="close" aria-label="Fenster schließen">✕</button></div>` : ''}<div class="wg-off ${ps}"><div>${logo(k)}<h2>${ps === 'off' ? esc(d.cfg.hostname) + ' ist ausgeschaltet' : esc(d.cfg.hostname) + ' startet …'}</h2><p>${ps === 'off' ? 'Die Weboberfläche ist erst nach dem Einschalten und Booten erreichbar.' : name + ' ist gleich bereit.'}</p>${ps === 'off' ? btn('Einschalten', 'pwron', null, 'primary') : `<div class="wg-boot"><i style="animation-duration:${left}ms"></i></div>`}</div></div></div>`;
        if (ps === 'boot') G._bt = setTimeout(() => { if (document.body.contains(root)) draw(); }, left + 80);
        return;
      }
      const url = `https://${ip || d.cfg.hostname.toLowerCase()}${portOf(d) === NETPORT ? '' : ':' + PORT}/`;
      const chrome = G.chrome ? `<div class="wg-chrome"><span class="wg-dots"><i></i><i></i><i></i></span><div class="wg-url" title="${esc(url)}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg><span>${esc(url)}</span>${ip ? '' : '<em>Direktzugriff (keine IP-Adresse)</em>'}</div><button class="wg-x" data-act="close" aria-label="Fenster schließen">✕</button></div>` : '';
      if (!G.auth && k === 'firewall') { root.innerHTML = `<div class="wg-win">${chrome}<div class="wg-login wg-firewall"><form class="as-login" data-act="login"><div class="as-lh"><svg class="as-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l8 3v6c0 5-3.4 9-8 11-4.6-2-8-6-8-11V5z"/></svg><b>Cisco ASDM-IDM Launcher</b></div><div class="as-lb"><p>Geben Sie die Zugangsdaten für die ASA ein.</p><div class="wg-f"><label for="wf-dev">Gerät/IP-Adresse</label><input id="wf-dev" value="${esc(ip || d.cfg.hostname)}" readonly></div>${field('user', 'Benutzername', 'admin')}${field('pw', 'Kennwort', 'NetLab-2026', { type: 'password' })}<div class="wg-row end"><button type="submit" class="wg-b primary" data-act="login">OK</button></div><small>Simulator-Zugangsdaten sind vorausgefüllt.</small></div></form></div></div>`; return; }
      if (!G.auth) { root.innerHTML = `<div class="wg-win">${chrome}<div class="wg-login wg-${k}"><form class="wg-lc" data-act="login"><div class="wg-logo">${logo(k)}</div><h2>${PRODUCT[k][0]}</h2><p>${esc(d.cfg.hostname)} · ${PRODUCT[k][1]}</p>${field('user', 'Benutzername', k === 'windows' ? 'Administrator' : 'admin')}${field('pw', 'Kennwort', 'NetLab-2026', { type: 'password' })}<button type="submit" class="wg-b primary wide" data-act="login">Anmelden</button><small>Simulator-Zugangsdaten sind vorausgefüllt.</small></form></div></div>`; return; }
      const nav = NAV[k](d), flat = nav.filter(n => n[0][0] !== '-'), pg = G.page && flat.some(n => n[0] === G.page) ? G.page : flat[0][0]; G.page = pg;
      let body = ''; try { body = PAGES[k][pg](d, G) } catch (e) { body = `<p class="wg-empty">Fehler beim Laden der Seite: ${esc(e.message)}</p>`; console.error(e); }
      if (k === 'firewall') root.innerHTML = asdmHtml(d, G, chrome, nav, pg, body); else root.innerHTML = `<div class="wg-win">${chrome}<div class="wg-app wg-${k}">
        <header class="wg-top"><div class="wg-brand">${logo(k)}<b>${PRODUCT[k][0]}</b><span>${esc(d.cfg.hostname)}</span></div><div class="wg-user">${isNet(k) ? (d.saved ? '' : `<span class="wg-unsaved" title="Running-Config unterscheidet sich von der Startup-Config">● nicht gespeichert</span>`) + btn('Konfiguration speichern', 'iosave', null, 'sm') : ''}<span>${k === 'windows' ? 'Administrator' : 'admin'}</span>${btn('Abmelden', 'logout', null, 'ghost sm')}</div></header>
        <div class="wg-body"><nav class="wg-nav" aria-label="Navigation">${nav.map(([id, lbl]) => id[0] === '-' ? `<h4 class="wg-grp">${lbl}</h4>` : `<button type="button" class="${id === pg ? 'act' : ''}" data-act="nav" data-p="${id}" ${id === pg ? 'aria-current="page"' : ''}>${lbl}</button>`).join('')}</nav>
        <div class="wg-main" role="main" tabindex="-1"><div class="wg-ph"><h1>${flat.find(n => n[0] === pg)[1]}</h1></div>${G.msg ? `<div class="wg-msg ${G.msg.err ? 'err' : 'ok'}" role="status">${esc(G.msg.t)}</div>` : ''}${body}</div></div>
        ${G.log.length ? `<footer class="wg-log"><b>Letzte Aktionen (gleichwertig im Terminal)</b>${G.log.slice(-3).map(l => `<code class="${l.err ? 'err' : ''}">${esc(l.cmd)}</code>`).join('')}</footer>` : ''}
        ${G.dlg ? dlgHtml(d, G) : ''}</div></div>`;
      const m = root.querySelector('.wg-main'); if (m && top) m.scrollTop = top;
      const f = root.querySelector('.wg-dlg input, .wg-dlg select'); if (f && G._focus !== G.dlg) { f.focus(); G._focus = G.dlg; }
      if (G.page === 'terminal') { const o = root.querySelector('#wg-out'); if (o) o.scrollTop = 1e9; const i = root.querySelector('#wg-cmd'); if (i && !G.dlg) i.focus(); }
    };
    G.draw = draw; G.dev = dev; G.root = root; G.kind = kind; if (typeof ALL !== 'undefined') ALL.add(G); return G;
  }
  const logo = k => `<svg class="wg-ico" viewBox="0 0 24 24" aria-hidden="true">${{ linux: '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01"/>', hypervisor: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="18" height="8" rx="1.5"/>', windows: '<path d="M3 5l8-1.2V11H3zM13 3.6L21 2v9h-8zM3 13h8v7.2L3 19zM13 13h8v9l-8-1.6z"/>', storage: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>', firewall: '<path d="M12 2l8 3v6c0 5-3.4 9-8 11-4.6-2-8-6-8-11V5z"/><path d="M9 12l2 2 4-4"/>', ap: '<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a14 14 0 0 1 20 0"/><circle cx="12" cy="19.5" r="1"/>', wlc: '<rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 17h.01M10 17h.01M7 9.5a7 7 0 0 1 10 0M9.5 6.5a3.5 3.5 0 0 1 5 0"/>', switch: '<rect x="2" y="8" width="20" height="8" rx="1.5"/><path d="M6 12h.01M10 12h.01M14 12h.01M18 12h.01"/>', router: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16M4 12h16M8 8l-2-2M16 8l2-2M8 16l-2 2M16 16l2 2"/>', fabric: '<circle cx="12" cy="12" r="3"/><circle cx="4" cy="5" r="2"/><circle cx="20" cy="5" r="2"/><circle cx="4" cy="19" r="2"/><circle cx="20" cy="19" r="2"/><path d="M6 6l4 4M18 6l-4 4M6 18l4-4M18 18l-4-4"/>' }[k]}</svg>`;
  const hostIp = d => { if (d.type === 'switch' || d.type === 'router') { const n = Object.keys(d.cfg.ifs).find(k => d.cfg.ifs[k].ip); return n ? d.cfg.ifs[n].ip : ''; } const h = d.ports.map(p => A.hip(d, p)).find(x => x && x.ip); return h ? h.ip : ''; };

  // ASDM: vier Bereiche (Startseite, Konfiguration, Überwachung, Werkzeuge) mit eigener Navigation
  const FW = {
    home: [['dashboard', 'Geräteinformationen']],
    cfg: [['-a', 'Geräteeinrichtung'], ['interfaces', 'Schnittstellen'], ['routes', 'Routing'], ['-b', 'Firewall'], ['rules', 'Zugriffsregeln'], ['nat', 'NAT-Regeln'], ['-c', 'Geräteverwaltung'], ['dhcp', 'DHCP-Server'], ['general', 'System'], ['config', 'Konfiguration sichern']],
    mon: [['-m', 'Überwachung'], ['monitor', 'Status und Tabellen']],
    tools: [['-t', 'Werkzeuge'], ['cli', 'Befehlszeile (CLI)'], ['ping', 'Ping und Traceroute']]
  };
  const FWTABS = [['home', 'Startseite'], ['cfg', 'Konfiguration'], ['mon', 'Überwachung'], ['tools', 'Werkzeuge']];
  const fwMode = pg => (FWTABS.find(([m]) => FW[m].some(n => n[0] === pg)) || FWTABS[0])[0];
  function asdmHtml(d, G, chrome, nav, pg, body) {
    const mode = fwMode(pg), items = FW[mode], url = hostIp(d) || d.cfg.hostname.toLowerCase();
    return `<div class="wg-win">${chrome}<div class="as">
      <div class="as-cap"><svg class="as-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l8 3v6c0 5-3.4 9-8 11-4.6-2-8-6-8-11V5z"/></svg>Cisco ASDM 7.18 für ASA – ${esc(url)}</div>
      <div class="as-tb" role="tablist">${FWTABS.map(([m, l]) => `<button type="button" role="tab" class="as-tab ${m === mode ? 'act' : ''}" aria-selected="${m === mode}" data-act="mode" data-m="${m}">${l}</button>`).join('')}<span class="as-sp"></span>${btn('Speichern', 'iosave', null, 'as-b')}${btn('Aktualisieren', 'refresh', null, 'as-b')}${btn('Abmelden', 'logout', null, 'as-b')}</div>
      <div class="as-body"><nav class="as-nav" aria-label="Navigation">${items.map(([id, lbl]) => id[0] === '-' ? `<h4>${lbl}</h4>` : `<button type="button" class="${id === pg ? 'act' : ''}" data-act="nav" data-p="${id}" ${id === pg ? 'aria-current="page"' : ''}>${lbl}</button>`).join('')}</nav>
        <div class="as-main wg-main" role="main" tabindex="-1"><div class="as-pt">${nav.find(n => n[0] === pg)[1]}</div>${G.msg ? `<div class="wg-msg ${G.msg.err ? 'err' : 'ok'}" role="status">${esc(G.msg.t)}</div>` : ''}${body}</div></div>
      ${G.log.length ? `<footer class="wg-log"><b>Letzte Aktionen (gleichwertig in der CLI)</b>${G.log.slice(-3).map(l => `<code class="${l.err ? 'err' : ''}">${esc(l.cmd)}</code>`).join('')}</footer>` : ''}
      <div class="as-st"><span>${esc(d.cfg.hostname)}</span><span>admin (15)</span><span class="${d.saved ? 'ok' : 'warn'}">${d.saved ? 'Konfiguration gespeichert' : 'Änderungen nicht gespeichert'}</span></div>
      ${G.dlg ? dlgHtml(d, G) : ''}</div></div>`;
  }

  // ---------- Navigation ----------
  const monOn = d => { try { return A.LX.init(d).pkgs.includes('zabbix-server'); } catch (e) { return false; } };
  const bkpOn = d => { try { return A.LX.init(d).pkgs.includes('backup-server'); } catch (e) { return false; } };
  const NAV = {
    linux: d => (monOn(d) ? [['mon', 'Monitoring']] : []).concat(bkpOn(d) ? [['bkp', 'Backup']] : []).concat([['overview', 'Übersicht'], ['network', 'Netzwerk'], ['services', 'Dienste'], ['files', 'Konfigurationsdateien'], ['storage', 'Speicher'], ['firewall', 'Firewall'], ['software', 'Software'], ['virt', 'Virtualisierung'], ['terminal', 'Terminal']]),
    hypervisor: d => (monOn(d) ? [['mon', 'Monitoring']] : []).concat(bkpOn(d) ? [['bkp', 'Backup']] : []).concat([['overview', 'Übersicht'], ['vms', 'Virtuelle Maschinen'], ['vswitch', 'Virtueller Switch'], ['datastores', 'Datastores'], ['cluster', 'Cluster und HA'], ['network', 'Netzwerk'], ['services', 'Dienste'], ['files', 'Konfigurationsdateien'], ['storage', 'Speicher'], ['firewall', 'Firewall'], ['software', 'Software'], ['terminal', 'Terminal']]),
    windows: d => [['dashboard', 'Dashboard'], ['local', 'Lokaler Server'], ['roles', 'Rollen und Features'], ['ad', 'Active Directory'], ['dns', 'DNS'], ['dhcp', 'DHCP'], ['shares', 'Dateidienste'], ['services', 'Dienste'], ['firewall', 'Firewall'], ['terminal', 'PowerShell']],
    storage: d => [['dashboard', 'Dashboard'], ['pools', 'Speicherpools'], ['luns', 'LUNs'], ['hosts', 'Hosts und Zugriff'], ['hypermetro', 'HyperMetro'], ['ports', 'Ports und Controller']],
    fabric: d => [['dashboard', 'Dashboard'], ['ports', 'Ports'], ['zoning', 'Zoning'], ['fabric', 'Fabric']],
    switch: d => [['dashboard', 'Dashboard'], ['-m', 'Überwachung'], ['monitor', 'Status und Tabellen'], ['-c', 'Konfiguration'], ['interfaces', 'Schnittstellen'], ['vlans', 'VLAN'], ['l3', 'Layer 3'], ['rproto', 'Dynamisches Routing'], ['stp', 'Spanning Tree'], ['ec', 'EtherChannel'], ['qos', 'QoS'], ['acl', 'Zugriffslisten (ACL)'], ['dhcp', 'DHCP-Server'], ['-a', 'Verwaltung'], ['mgmt', 'Verwaltung'], ['config', 'Konfigurationsverwaltung'], ['cli', 'Konsole (CLI)'], ['-t', 'Fehlersuche'], ['ping', 'Ping und Traceroute']],
    firewall: d => [].concat(...Object.values(FW)),
    ap: d => [['dashboard', 'Übersicht'], ['wlan', 'Funknetzwerke (SSID)'], ['clients', 'Clients'], ['network', 'Netzwerk'], ['controller', 'Controller'], ['cli', 'Konsole']],
    wlc: d => [['dashboard', 'Dashboard'], ['-c', 'Konfiguration'], ['wlan', 'WLANs'], ['aps', 'Access Points'], ['clients', 'Clients'], ['-a', 'Verwaltung'], ['network', 'Netzwerk'], ['cli', 'Konsole']],
    router: d => [['dashboard', 'Dashboard'], ['-m', 'Überwachung'], ['monitor', 'Status und Tabellen'], ['-c', 'Konfiguration'], ['interfaces', 'Schnittstellen'], ['l3', 'Routing'], ['rproto', 'Dynamisches Routing'], ['vpn', 'Site-to-Site-VPN'], ['qos', 'QoS'], ['acl', 'Zugriffslisten (ACL)'], ['dhcp', 'DHCP-Server'], ['-a', 'Verwaltung'], ['mgmt', 'Verwaltung'], ['config', 'Konfigurationsverwaltung'], ['cli', 'Konsole (CLI)'], ['-t', 'Fehlersuche'], ['ping', 'Ping und Traceroute']]
  };

  // ---------- Aktionen ausführen ----------
  function exec(G, cmds, ok) {
    const d = G.dev(); cmds = [].concat(cmds); let last = '';
    for (const c of cmds) { let out = ''; A.act(() => { out = A.exec(d, c); }); const bad = failed(out); G.log.push({ cmd: (A.isWn(d) ? 'PS> ' : '$ ') + c, err: bad }); last = out; if (bad) { G.msg = { err: true, t: String(out).split('\n').filter(Boolean).slice(0, 3).join(' ') }; G.log = G.log.slice(-8); return false; } }
    G.msg = ok ? { t: ok } : null; G.log = G.log.slice(-8); return last || true;
  }
  // IOS-Befehle (Konfigurationsmodus) über den Simulator ausführen; Fehlermeldungen beginnen mit %
  const iosBad = out => String(out || '').split('\n').filter(l => /^%/.test(l) && !/Creating vlan|Access VLAN does not exist/.test(l));
  function ios(G, lines, ok) {
    const d = G.dev(); lines = [].concat(lines); const out = A.ios(d, lines);
    lines.forEach(l => G.log.push({ cmd: l, err: false })); const bad = iosBad(out);
    if (bad.length) { G.log[G.log.length - 1].err = true; G.msg = { err: true, t: bad.slice(0, 2).join(' ') }; G.log = G.log.slice(-10); return false; }
    G.msg = ok ? { t: ok } : null; G.log = G.log.slice(-10); return true;
  }
  const res = (G, r, ok) => { G.msg = r && r.err ? { err: true, t: r.err } : (ok ? { t: ok } : null); return !(r && r.err); };
  const v = (G, id) => { const e = G.root.querySelector('#wf-' + id); return e ? (e.type === 'checkbox' ? e.checked : e.value) : ''; };

  // ---------- Seiten ----------
  const PAGES = { linux: {}, hypervisor: {}, windows: {}, storage: {}, fabric: {}, switch: {}, router: {}, firewall: {}, ap: {}, wlc: {} };
  const ifaces = d => A.ctx().ifaces(d);
  const maskLen = m => m ? m.split('.').reduce((a, x) => a + (+x).toString(2).replace(/0/g, '').length, 0) : '';

  // --- gemeinsame Linux-Seiten ---
  const LX = {
    overview(d, G) {
      const L = A.LX.init(d), du = A.LX.diskUse(d), us = A.LX.unitList(d), ifs = ifaces(d);
      return `<div class="wg-grid">${card('System', `<dl class="wg-dl"><dt>Hostname</dt><dd>${esc(d.cfg.hostname)} ${btn('Ändern', 'dlg', { k: 'host' }, 'sm ghost')}</dd><dt>Betriebssystem</dt><dd>Ubuntu 22.04.4 LTS</dd><dt>Laufzeit</dt><dd>2 Std. 14 Min.</dd><dt>Benutzer</dt><dd>${esc(L.users.join(', '))}</dd></dl>`)}
        ${card('Ressourcen', `<p class="wg-k">Prozessor</p>${bar(4, 100)}<p class="wg-s">4 % von ${d.hv ? d.hv.cores : 4} Kernen</p><p class="wg-k">Arbeitsspeicher</p>${bar(612, 3900)}<p class="wg-s">612 MB von 3,8 GB</p><p class="wg-k">Systemplatte</p>${bar(du.used, du.total, 85)}<p class="wg-s">${gb(Math.round(Math.min(du.used, du.total) / 1073741824))} von ${gb(Math.round(du.total / 1073741824))}${du.full ? ' – <b class="wg-bad">voll</b>' : ''}</p>`)}
        ${card('Netzwerk', ifs.length ? `<dl class="wg-dl">${ifs.map(i => `<dt>${esc(i.lin)}</dt><dd>${i.ip ? esc(i.ip + '/' + maskLen(i.mask)) : '<span class="wg-mut">keine IP</span>'} ${chip(i.up ? 'verbunden' : 'getrennt', i.up ? 'ok' : 'bad')}</dd>`).join('')}<dt>Gateway</dt><dd>${esc(d.cfg.gw || '–')}</dd><dt>DNS</dt><dd>${esc(d.cfg.dns || '–')}</dd></dl>` : '<p class="wg-empty">Keine Netzwerkkarte.</p>')}
        ${card('Dienste', `<p class="wg-big">${us.filter(u => u.active).length}<small> laufen</small></p>${us.some(u => u.failed) ? `<p>${chip(us.filter(u => u.failed).length + ' fehlgeschlagen', 'bad')}</p>` : '<p class="wg-mut">Keine Fehler.</p>'}${btn('Zu den Diensten', 'nav', { p: 'services' }, 'sm')}`)}</div>`;
    },
    network(d, G) {
      const ifs = ifaces(d);
      return card('Schnittstellen', tbl(['Name', 'Status', 'IPv4-Adresse', 'MAC-Adresse', ''], ifs.map((i, k) => [`<b>${esc(i.lin)}</b>`, chip(i.up ? 'verbunden' : 'getrennt', i.up ? 'ok' : 'bad'), i.ip ? esc(i.ip + '/' + maskLen(i.mask)) : '–', `52:54:00:12:34:${(k + 10).toString(16)}`, btn('Bearbeiten', 'dlg', { k: 'net', i: i.lin }, 'sm')]), 'Keine Netzwerkkarte.'))
        + card('Routing und DNS', `<dl class="wg-dl"><dt>Standard-Gateway</dt><dd>${esc(d.cfg.gw || 'nicht gesetzt')}</dd><dt>DNS-Server</dt><dd>${esc(d.cfg.dns || 'nicht gesetzt')}</dd></dl>${btn('Gateway und DNS ändern', 'dlg', { k: 'gw' }, 'sm')}`);
    },
    services(d, G) {
      const us = A.LX.unitList(d);
      return card('Systemdienste', tbl(['Dienst', 'Beschreibung', 'Status', 'Autostart', 'Aktionen'], us.map(u => [`<b>${esc(u.name)}</b>${u.port ? `<br><small class="wg-mut">Port ${esc(u.port)}</small>` : ''}`, esc(u.desc), u.active ? chip('läuft', 'ok') : u.failed ? chip('fehlgeschlagen', 'bad') : chip('gestoppt'), `<label class="wg-sw"><input type="checkbox" data-act="enable" data-u="${esc(u.name)}" ${u.enabled ? 'checked' : ''} aria-label="Autostart ${esc(u.name)}"><i></i></label>`, `<div class="wg-row">${u.active ? btn('Stoppen', 'svc', { u: u.name, c: 'stop' }, 'sm') + btn('Neu starten', 'svc', { u: u.name, c: 'restart' }, 'sm') : btn('Starten', 'svc', { u: u.name, c: 'start' }, 'sm primary')}${btn('Protokoll', 'dlg', { k: 'log', u: u.name }, 'sm ghost')}</div>`]), 'Keine Dienste.'))
        + '<p class="wg-note">Hinweis: Dienste lesen ihre Konfiguration beim Starten. Änderungen unter „Konfigurationsdateien“ wirken nach einem Neustart des Dienstes.</p>';
    },
    files(d, G) {
      const A_ = A.LX, L = A_.init(d), fl = A_.fileList(d); if (!G.file || !fl.includes(G.file)) G.file = fl.find(f => /nginx\.conf|db\.lab|dhcpd\.conf/.test(f)) || fl[0];
      const txt = G.file ? (L.fs[G.file] && L.fs[G.file].t) || '' : '', map = { 'nginx.conf': 'nginx', 'db.lab': 'bind9', 'dhcpd.conf': 'isc-dhcp-server' }, u = Object.keys(map).find(k => G.file && G.file.endsWith(k));
      return `<div class="wg-split"><aside class="wg-files"><h3>Dateien</h3>${fl.map(f => `<button type="button" class="${f === G.file ? 'act' : ''}" data-act="file" data-f="${esc(f)}">${esc(f)}</button>`).join('') || '<p class="wg-empty">Keine Dateien.</p>'}${btn('Neue Datei', 'dlg', { k: 'newfile' }, 'sm ghost')}</aside>
        <div class="wg-edit">${G.file ? `<div class="wg-row"><b>${esc(G.file)}</b></div><textarea id="wf-text" spellcheck="false" aria-label="Dateiinhalt">${esc(txt)}</textarea><div class="wg-row">${btn('Speichern', 'savefile', null, 'primary')}${/nginx\.conf$/.test(G.file) ? btn('Syntax prüfen (nginx -t)', 'nginxt', null) : ''}${u ? btn(`${map[u]} neu starten`, 'svc', { u: map[u], c: 'restart', save: 1 }) : ''}</div><p class="wg-note">Systemdateien darf nur root ändern, die Oberfläche speichert als Administrator.</p>` : '<p class="wg-empty">Wähle eine Datei.</p>'}</div></div>`;
    },
    storage(d, G) {
      const ctx = A.ctx(), bi = A.LX.blockInfo(ctx, d), df = A.exec(d, 'df -h'), lb = A.exec(d, 'lsblk');
      return card('Datenträger und LUNs', `<div class="wg-row">${btn('Neu scannen', 'run', { c: 'sudo rescan-scsi-bus.sh', ok: 'SCSI-Bus gescannt.' }, 'primary')}${btn('Dateisystem anlegen', 'dlg', { k: 'mkfs' }, bi.length ? '' : 'disabled')}${btn('Einbinden', 'dlg', { k: 'mount' }, bi.length ? '' : 'disabled')}</div>` + tbl(['LUN', 'Gerät', 'Größe', 'Pfade', 'Dateisystem', 'Eingebunden'], bi.map(x => [`<b>${esc(x.name)}</b>`, `<code>${esc(x.dev)}</code>`, gb(x.gb), x.paths.length + (x.multipath ? ' (Multipath)' : ' (je Pfad ein Gerät)'), esc(x.fs || '–'), esc(x.mounts.join(', ') || '–')]), 'Keine SAN-LUNs sichtbar. Prüfe Masking, Zoning und starte einen Rescan.'))
        + card('Blockgeräte (lsblk)', `<pre class="wg-pre">${esc(lb)}</pre>`) + card('Belegung (df -h)', `<pre class="wg-pre">${esc(df)}</pre>`);
    },
    firewall(d, G) {
      const U = A.LX.ufwState(d);
      return card('Firewall (ufw)', `<p>Status: ${U.on ? chip('aktiv', 'ok') : chip('inaktiv', 'bad')} ${U.on ? btn('Deaktivieren', 'run', { c: 'sudo ufw disable' }, 'sm') : btn('Aktivieren', 'run', { c: 'sudo ufw enable' }, 'sm primary')}</p>${U.on && !U.allow.includes('22') ? '<p class="wg-warn">SSH (Port 22) ist nicht erlaubt: Beim Aktivieren sperrst du dich per SSH aus.</p>' : ''}` + tbl(['Erlaubter Port', 'Aktion'], U.allow.map(p => [`<b>${esc(p)}</b>`, btn('Entfernen', 'run', { c: 'sudo ufw delete allow ' + p }, 'sm ghost')]), 'Keine Regeln. Ist die Firewall aktiv, wird alles Eingehende blockiert.') + `<div class="wg-row">${btn('Port freigeben', 'dlg', { k: 'allow' }, 'primary')}</div>`);
    },
    software(d, G) {
      return card('Pakete', tbl(['Paket', 'Beschreibung', 'Status', ''], A.LX.pkgList(d).map(p => [`<b>${esc(p.name)}</b>`, esc(p.desc), p.installed ? chip('installiert', 'ok') : chip('verfügbar'), p.installed ? btn('Entfernen', 'run', { c: 'sudo apt remove ' + p.name }, 'sm ghost') : btn('Installieren', 'run', { c: 'sudo apt install ' + p.name, ok: p.name + ' installiert.' }, 'sm primary')])))
        + '<p class="wg-note">Die Installation braucht IP-Adresse, Gateway und eine Verbindung ins Internet. Sonst meldet apt, dass es die Paketquellen nicht erreicht.</p>';
    },
    terminal(d, G) {
      const lines = A.termOut(d);
      return `<div class="wg-term" id="wg-out" role="log" aria-live="polite">${lines.map(o => `<div class="k-${o.c}">${esc(o.t) || '&nbsp;'}</div>`).join('')}</div><form class="wg-termin" data-act="term"><label for="wg-cmd">${esc(A.prompt(d))}</label><input id="wg-cmd" autocomplete="off" spellcheck="false" aria-label="Befehl"></form>`;
    }
  };
  Object.assign(PAGES.linux, LX, {
    virt(d, G) { return card('Virtualisierung', `<p>Dieser Server ist kein Hypervisor. Ein Hypervisor lässt mehrere virtuelle Maschinen auf einem Server laufen. Sie hängen an einem virtuellen Switch, dessen Uplinks die Netzwerkports des Servers sind.</p>${A.VIRT.vmsOf(A.net(), d.id).length ? '' : btn('Als Hypervisor einrichten', 'hvon', null, 'primary')}`); }
  });
  Object.assign(PAGES.hypervisor, LX);

  // --- Hypervisor ---
  const VIRT = A_ => A_.VIRT;
  PAGES.hypervisor.overview = (d, G) => {
    const vm = A.VIRT, net = A.net(), ur = vm.usedRam(net, d.id), uc = vm.usedCpu(net, d.id), vms = vm.vmsOf(net, d.id), du = A.LX.diskUse(d);
    return `<div class="wg-grid">${card('Host', `<dl class="wg-dl"><dt>Hostname</dt><dd>${esc(d.cfg.hostname)} ${btn('Ändern', 'dlg', { k: 'host' }, 'sm ghost')}</dd><dt>Kerne</dt><dd>${d.hv.cores}</dd><dt>Arbeitsspeicher</dt><dd>${d.hv.ramGb} GB</dd><dt>Cluster</dt><dd>${esc(d.hv.cluster || 'keiner')}</dd><dt>vSwitch</dt><dd>${esc(d.vsw.name)}, Uplinks: ${esc(d.vsw.uplinks.join(', ') || 'keine')}</dd></dl>`)}
      ${card('Kapazität', `<p class="wg-k">Arbeitsspeicher (fest vergeben)</p>${bar(ur, d.hv.ramGb, 85)}<p class="wg-s">${ur} von ${d.hv.ramGb} GB belegt</p><p class="wg-k">vCPUs (${vm.OVERCOMMIT}:1 Überbuchung)</p>${bar(uc, d.hv.cores * vm.OVERCOMMIT, 90)}<p class="wg-s">${uc} von ${d.hv.cores * vm.OVERCOMMIT}</p><p class="wg-k">Systemplatte</p>${bar(du.used, du.total, 85)}`)}
      ${card('Virtuelle Maschinen', `<p class="wg-big">${vms.filter(v => v.vm.state === 'running').length}<small> von ${vms.length} laufen</small></p>${btn('Zur Verwaltung', 'nav', { p: 'vms' }, 'sm')}`)}
      ${card('Dienste', `<p class="wg-big">${A.LX.unitList(d).filter(u => u.active).length}<small> laufen</small></p>${btn('Zu den Diensten', 'nav', { p: 'services' }, 'sm')}`)}</div>`;
  };
  PAGES.hypervisor.vms = (d, G) => {
    const vm = A.VIRT, net = A.net(), vms = vm.vmsOf(net, d.id);
    return `<div class="wg-row">${btn('VM erstellen', 'dlg', { k: 'newvm' }, 'primary')}</div>` + tbl(['Name', 'Status', 'Ressourcen', 'Datastore', 'VLAN', 'IP-Adresse', 'Aktionen'], vms.map(v => { const h = A.hip(v, 'eth0'); return [`<b>${esc(v.cfg.hostname)}</b><br><small class="wg-mut">${v.os === 'windows' ? 'Windows Server' : 'Ubuntu Linux'}</small>`, v.vm.state === 'running' ? chip('läuft', 'ok') : chip('aus'), `${v.vm.cpu} vCPU, ${v.vm.ramGb} GB RAM, ${v.vm.diskGb} GB`, esc(vm.dsName(net, v.vm.ds)), v.vm.vlan || '–', h && h.ip ? esc(h.ip + '/' + maskLen(h.mask)) : '<span class="wg-mut">keine</span>', `<div class="wg-row">${btn(v.vm.state === 'running' ? 'Ausschalten' : 'Einschalten', 'vmpow', { v: v.id }, 'sm ' + (v.vm.state === 'running' ? '' : 'primary'))}${btn('Konsole', 'dlg', { k: 'vmcon', v: v.id }, 'sm')}${btn('Bearbeiten', 'dlg', { k: 'vmedit', v: v.id }, 'sm')}${btn('Verschieben', 'dlg', { k: 'vmmig', v: v.id }, 'sm')}${btn('Löschen', 'vmdel', { v: v.id }, 'sm ghost bad')}</div>`]; }), 'Noch keine VM. Lege mit „VM erstellen“ die erste an.')
      + '<p class="wg-note">RAM wird fest vergeben, vCPUs dürfen überbucht werden. Eine VM startet nur, wenn genug RAM frei ist und ihr Datastore sichtbar ist.</p>';
  };
  PAGES.hypervisor.vswitch = (d, G) => {
    const net = A.net(), vms = A.VIRT.vmsOf(net, d.id), ports = d.ports.filter(p => d.pk[p] !== 'fc' && !/^ibmc$|mgmt$/i.test(p)), groups = {}; vms.forEach(v => { (groups[v.vm.vlan || 0] = groups[v.vm.vlan || 0] || []).push(v); });
    return card(`${esc(d.vsw.name)}: Uplinks`, tbl(['Physischer Port', 'Link', 'Uplink'], ports.map(p => [`<b>${esc(A.SH(p))}</b>`, A.status(d, p) === 'connected' ? chip('verbunden', 'ok') : chip('kein Link', 'bad'), `<label class="wg-sw"><input type="checkbox" data-act="uplink" data-p="${esc(p)}" ${d.vsw.uplinks.includes(p) ? 'checked' : ''} aria-label="${esc(p)} als Uplink"><i></i></label>`]), 'Keine Ports.') + '<p class="wg-note">Nur Kabel an Uplink-Ports verbinden die VMs mit dem physischen Netz. Mit VLAN-Tag braucht der Switchport einen Trunk, der dieses VLAN durchlässt.</p>')
      + card('Port-Gruppen (nach VLAN)', tbl(['VLAN', 'VMs'], Object.keys(groups).sort((a, b) => a - b).map(k => [k === '0' ? 'ohne Tag (untagged)' : `VLAN ${k}`, groups[k].map(x => esc(x.cfg.hostname)).join(', ')]), 'Keine VMs.'));
  };
  PAGES.hypervisor.datastores = (d, G) => {
    const net = A.net(), ds = A.VIRT.datastores(net, d), vms = A.VIRT.vmsOf(net, d.id);
    return card('Datastores', `<table class="wg-t"><thead><tr><th>Name</th><th>Typ</th><th>Kapazität</th><th>Belegt</th><th>VMs</th></tr></thead><tbody><tr><td><b>lokale Platte</b></td><td>lokal</td><td>nicht begrenzt</td><td>–</td><td>${vms.filter(v => v.vm.ds === 'local').map(v => esc(v.cfg.hostname)).join(', ') || '–'}</td></tr>${ds.map(x => { const u = A.VIRT.dsUsed(net, x.id); return `<tr><td><b>${esc(x.name)}</b></td><td>SAN-LUN</td><td>${gb(x.gb)}</td><td>${gb(u)}${bar(u, x.gb, 85)}</td><td>${Object.values(net.devs).filter(z => z.vm && z.vm.ds === x.id).map(z => esc(z.cfg.hostname)).join(', ') || '–'}</td></tr>`; }).join('')}</tbody></table>`) + '<p class="wg-note">Datastores sind LUNs, die dieser Host sieht (Masking, Zoning, Rescan im Storage-Manager und unter „Speicher“). Für Live-Migration und HA müssen alle Cluster-Hosts denselben Datastore sehen.</p>';
  };
  PAGES.hypervisor.cluster = (d, G) => {
    const net = A.net(), cl = d.hv.cluster, hosts = Object.values(net.devs).filter(x => A.VIRT.isHost(x) && cl && x.hv.cluster === cl), ha = A.VIRT.clusterHa(net, cl);
    return card('Cluster', `<div class="wg-row">${field('cl', 'Cluster-Name', cl, { ph: 'z. B. CL1' })}${btn('Übernehmen', 'cluster', null, 'primary')}</div><p>HA ${ha ? chip('aktiv', 'ok') : chip('aus')} <label class="wg-sw"><input type="checkbox" data-act="ha" ${ha ? 'checked' : ''} ${cl ? '' : 'disabled'} aria-label="HA"><i></i></label></p><p class="wg-note">${cl ? 'HA gilt für alle Hosts des Clusters.' : 'Trage einen Cluster-Namen ein (gleich auf allen Hosts), damit VMs migrieren können und HA möglich ist.'}</p>`)
      + card('Hosts im Cluster', tbl(['Host', 'Status', 'RAM', 'VMs'], hosts.map(h => [`<b>${esc(h.cfg.hostname)}</b>`, h.off ? chip('ausgefallen', 'bad') : chip('aktiv', 'ok'), `${A.VIRT.usedRam(net, h.id)} / ${h.hv.ramGb} GB`, A.VIRT.vmsOf(net, h.id).length]), cl ? 'Keine Hosts.' : 'Kein Cluster.'))
      + card('Ereignisse', (() => { const ev = Object.values(net.devs).filter(x => x.vm).flatMap(x => x.vm.events.map(e => `${x.cfg.hostname}: ${e}`)); return ev.length ? `<ul class="wg-ul">${ev.slice(-8).map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : '<p class="wg-empty">Keine Ereignisse.</p>'; })());
  };

  // --- Windows ---
  const W = d => A.WIN.init(d), roleName = { 'AD-Domain-Services': 'Active Directory-Domänendienste', DNS: 'DNS-Server', DHCP: 'DHCP-Server', 'Web-Server': 'Webserver (IIS)', 'FS-FileServer': 'Dateiserver' };
  const adOf = (d, G) => { const w = W(d), dc = w.domain ? (w.domain.role === 'dc' ? d : A.net().devs[w.domain.dc]) : null; return dc && dc.win && dc.win.ad ? { dc, ad: dc.win.ad } : null; };
  PAGES.windows.dashboard = (d, G) => {
    const w = W(d), sv = Object.keys(w.svc);
    return `<div class="wg-grid">${card('Lokaler Server', `<dl class="wg-dl"><dt>Computername</dt><dd>${esc(d.cfg.hostname)}</dd><dt>Domäne</dt><dd>${w.domain ? esc(w.domain.name) + (w.domain.role === 'dc' ? ' (Domänencontroller)' : '') : 'Arbeitsgruppe WORKGROUP'}</dd><dt>IP-Adresse</dt><dd>${esc(hostIp(d) || 'keine')}</dd><dt>Betriebssystem</dt><dd>Windows Server 2022 Standard</dd></dl>`)}
      ${card('Rollen', `<ul class="wg-ul">${Object.keys(roleName).map(r => `<li>${w.feats[r] ? chip('installiert', 'ok') : chip('–')} ${roleName[r]}</li>`).join('')}</ul>${btn('Rollen verwalten', 'nav', { p: 'roles' }, 'sm')}`)}
      ${card('Dienste', `<p class="wg-big">${sv.filter(s => w.svc[s] === 'Running').length}<small> von ${sv.length} laufen</small></p>${sv.some(s => w.svc[s] !== 'Running') ? `<p>${chip(sv.filter(s => w.svc[s] !== 'Running').length + ' gestoppt', 'bad')}</p>` : ''}${btn('Zu den Diensten', 'nav', { p: 'services' }, 'sm')}`)}
      ${w.feats['AD-Domain-Services'] && !w.domain ? card('Aktion erforderlich', `<p class="wg-warn">AD DS ist installiert, der Server ist aber noch kein Domänencontroller.</p>${btn('Server heraufstufen', 'dlg', { k: 'forest' }, 'primary')}`) : ''}</div>`;
  };
  PAGES.windows.local = (d, G) => {
    const w = W(d), ifs = ifaces(d);
    return card('Eigenschaften', `<dl class="wg-dl"><dt>Computername</dt><dd>${esc(d.cfg.hostname)}${w.pendingName ? ` → <b>${esc(w.pendingName)}</b> (nach Neustart)` : ''} ${btn('Ändern', 'dlg', { k: 'rename' }, 'sm ghost')}</dd><dt>Domäne</dt><dd>${w.domain ? esc(w.domain.name) + ' ' + btn('Verlassen', 'run', { c: 'Remove-Computer', ok: 'Domäne verlassen.' }, 'sm ghost') : 'Arbeitsgruppe WORKGROUP ' + btn('Domäne beitreten', 'dlg', { k: 'join' }, 'sm')}</dd></dl>${w.pendingName ? btn('Jetzt neu starten', 'run', { c: 'Restart-Computer', ok: 'Neu gestartet.' }, 'primary') : ''}`)
      + card('Netzwerkadapter', tbl(['Adapter', 'Status', 'IPv4', 'Gateway', 'DNS', ''], ifs.map(i => [`<b>${esc(i.alias)}</b>`, chip(i.up ? 'verbunden' : 'getrennt', i.up ? 'ok' : 'bad'), i.ip ? esc(i.ip + '/' + maskLen(i.mask)) : '–', esc(d.cfg.gw || '–'), esc(d.cfg.dns || '–'), btn('Konfigurieren', 'dlg', { k: 'wnet', i: i.alias }, 'sm')]), 'Kein Adapter.'));
  };
  PAGES.windows.roles = (d, G) => {
    const w = W(d);
    return card('Rollen und Features', tbl(['Rolle', 'Status', ''], Object.keys(roleName).map(r => [`<b>${roleName[r]}</b><br><small class="wg-mut">${r}</small>`, w.feats[r] ? chip('installiert', 'ok') : chip('verfügbar'), w.feats[r] ? '' : btn('Installieren', 'run', { c: `Install-WindowsFeature -Name ${r} -IncludeManagementTools`, ok: roleName[r] + ' installiert.' }, 'sm primary')])))
      + (w.feats['AD-Domain-Services'] && !w.domain ? card('Domänencontroller', `<p class="wg-warn">AD DS ist installiert. Heraufstufen legt die Gesamtstruktur an (inklusive DNS).</p>${btn('Server zum Domänencontroller heraufstufen', 'dlg', { k: 'forest' }, 'primary')}`) : '');
  };
  PAGES.windows.ad = (d, G) => {
    const w = W(d), x = adOf(d, G); if (!x) return card('Active Directory', `<p class="wg-empty">${w.domain ? 'Dieser Server ist kein Domänencontroller.' : 'Der Server ist keine Domäne beigetreten und kein Domänencontroller.'} Installiere die Rolle „Active Directory-Domänendienste“ und stufe den Server herauf.</p>${btn('Zu Rollen und Features', 'nav', { p: 'roles' }, 'sm')}`);
    if (w.domain.role !== 'dc') return card('Active Directory', '<p class="wg-empty">Die Verwaltung läuft auf dem Domänencontroller.</p>');
    const tab = G.tab.ad || 'users', A_ = x.ad, dom = w.domain.name;
    const tabs = `<div class="wg-tabs">${[['users', 'Benutzer'], ['groups', 'Gruppen'], ['ous', 'Organisationseinheiten'], ['comps', 'Computer']].map(([k, t]) => `<button type="button" class="${k === tab ? 'act' : ''}" data-act="tab" data-t="ad" data-v="${k}">${t}</button>`).join('')}</div>`;
    const body = tab === 'users' ? `<div class="wg-row">${btn('Neuer Benutzer', 'dlg', { k: 'newuser' }, 'primary')}</div>` + tbl(['Name', 'Anmeldename', 'Status', 'Organisationseinheit', ''], A_.users.map(u => [`<b>${esc(u.name)}</b>`, esc(u.sam), u.enabled ? chip('aktiv', 'ok') : chip('deaktiviert', 'bad'), esc(u.ou || 'Users'), `<div class="wg-row">${btn(u.enabled ? 'Deaktivieren' : 'Aktivieren', 'run', { c: (u.enabled ? 'Disable-ADAccount ' : 'Enable-ADAccount ') + u.sam }, 'sm')}${btn('Löschen', 'run', { c: 'Remove-ADUser -Identity ' + u.sam, ok: 'Benutzer gelöscht.' }, 'sm ghost bad')}</div>`]), 'Keine Benutzer.')
      : tab === 'groups' ? `<div class="wg-row">${btn('Neue Gruppe', 'dlg', { k: 'newgroup' }, 'primary')}${btn('Mitglied hinzufügen', 'dlg', { k: 'addmember' })}</div>` + tbl(['Gruppe', 'Mitglieder'], A_.groups.map(g => [`<b>${esc(g.name)}</b>`, g.members.map(esc).join(', ') || '–']), 'Keine Gruppen.')
        : tab === 'ous' ? `<div class="wg-row">${btn('Neue OU', 'dlg', { k: 'newou' }, 'primary')}</div>` + tbl(['Name', 'Distinguished Name'], A_.ous.map(o => [`<b>${esc(o)}</b>`, `OU=${esc(o)},${esc(A.WIN.dn(dom))}`]), 'Keine Organisationseinheiten.')
          : tbl(['Computer', 'DNS-Hostname'], [[`<b>${esc(d.cfg.hostname.toUpperCase())}</b> (DC)`, esc(d.cfg.hostname.toLowerCase() + '.' + dom)]].concat(A_.comps.map(c => [`<b>${esc(c.name.toUpperCase())}</b>`, esc(c.name.toLowerCase() + '.' + dom)])), '');
    return card(`Domäne ${esc(dom)}`, tabs + body);
  };
  PAGES.windows.dns = (d, G) => {
    const w = W(d); if (!w.feats.DNS) return card('DNS', `<p class="wg-empty">Die Rolle „DNS-Server“ ist nicht installiert.</p>${btn('Installieren', 'run', { c: 'Install-WindowsFeature -Name DNS -IncludeManagementTools', ok: 'DNS-Server installiert.' }, 'primary')}`);
    const z = G.tab.dnsz && w.dnsZones.includes(G.tab.dnsz) ? G.tab.dnsz : w.dnsZones[0], recs = (d.svc.dns.records || []).filter(r => z && r.name.toLowerCase().endsWith(z));
    return card('Forward-Lookupzonen', `<p>Dienst: ${w.svc.DNS === 'Running' ? chip('läuft', 'ok') : chip('gestoppt', 'bad')}</p><div class="wg-row">${btn('Neue Zone', 'dlg', { k: 'newzone' }, 'primary')}</div>` + `<div class="wg-tabs">${w.dnsZones.map(zz => `<button type="button" class="${zz === z ? 'act' : ''}" data-act="tab" data-t="dnsz" data-v="${esc(zz)}">${esc(zz)}</button>`).join('')}</div>`)
      + (z ? card(`Einträge in ${esc(z)}`, `<div class="wg-row">${btn('A-Eintrag hinzufügen', 'dlg', { k: 'newrec', z }, 'primary')}</div>` + tbl(['Name', 'Typ', 'Daten'], recs.map(r => [`<b>${esc(r.name === z ? '@' : r.name.slice(0, -z.length - 1))}</b>`, 'A', esc(r.ip === '@' ? d.cfg.ip : r.ip)]), 'Keine Einträge.')) : '');
  };
  PAGES.windows.dhcp = (d, G) => {
    const w = W(d); if (!w.feats.DHCP) return card('DHCP', `<p class="wg-empty">Die Rolle „DHCP-Server“ ist nicht installiert.</p>${btn('Installieren', 'run', { c: 'Install-WindowsFeature -Name DHCP -IncludeManagementTools', ok: 'DHCP-Server installiert.' }, 'primary')}`);
    const s = w.dhcp.scope;
    return card('DHCP-Server', `<dl class="wg-dl"><dt>Dienst</dt><dd>${w.svc.DHCPServer === 'Running' ? chip('läuft', 'ok') : chip('gestoppt', 'bad')} ${w.svc.DHCPServer === 'Running' ? btn('Stoppen', 'run', { c: 'Stop-Service DHCPServer' }, 'sm') : btn('Starten', 'run', { c: 'Start-Service DHCPServer' }, 'sm primary')}</dd><dt>Autorisierung in AD</dt><dd>${w.domain ? (w.dhcp.auth ? chip('autorisiert', 'ok') : chip('nicht autorisiert', 'bad') + ' ' + btn('Autorisieren', 'run', { c: 'Add-DhcpServerInDC', ok: 'Server autorisiert.' }, 'sm primary')) : '<span class="wg-mut">nicht nötig (keine Domäne)</span>'}</dd></dl>${w.domain && !w.dhcp.auth ? '<p class="wg-warn">In einer Domäne vergibt ein DHCP-Server erst nach der Autorisierung Adressen.</p>' : ''}`)
      + card('IPv4-Bereich', s ? `<dl class="wg-dl"><dt>Name</dt><dd>${esc(s.name)}</dd><dt>Adressbereich</dt><dd>${esc(s.start)} bis ${esc(s.end)}</dd><dt>Subnetzmaske</dt><dd>${esc(s.mask)}</dd><dt>Router</dt><dd>${esc(s.router || '–')}</dd><dt>DNS-Server</dt><dd>${esc(s.dns || '–')}</dd></dl><div class="wg-row">${btn('Optionen ändern', 'dlg', { k: 'dhcpopt' }, 'sm')}${btn('Bereich löschen', 'run', { c: 'Remove-DhcpServerv4Scope', ok: 'Bereich gelöscht.' }, 'sm ghost bad')}</div>` : `<p class="wg-empty">Noch kein Bereich.</p>${btn('Bereich erstellen', 'dlg', { k: 'newscope' }, 'primary')}`);
  };
  PAGES.windows.shares = (d, G) => {
    const w = W(d), sh = [{ name: 'ADMIN$', path: 'C:\\Windows', full: ['Administratoren'] }, { name: 'C$', path: 'C:\\', full: ['Administratoren'] }].concat(w.shares);
    return card('Freigaben', `<div class="wg-row">${btn('Neue Freigabe', 'dlg', { k: 'newshare' }, 'primary')}</div>` + tbl(['Name', 'Pfad', 'Vollzugriff', 'Ändern', 'Lesen'], sh.map(s => [`<b>${esc(s.name)}</b>`, `<code>${esc(s.path)}</code>`, esc((s.full || []).join(', ') || '–'), esc((s.change || []).join(', ') || '–'), esc((s.read || []).join(', ') || '–')])))
      + (w.feats['FS-FileServer'] ? '' : '<p class="wg-note">Tipp: Die Rolle „Dateiserver“ ist nicht installiert (Rollen und Features).</p>');
  };
  PAGES.windows.services = (d, G) => {
    const w = W(d), S = A.WIN.SERVICES;
    return card('Dienste', tbl(['Name', 'Anzeigename', 'Status', ''], Object.keys(w.svc).map(n => [`<b>${esc(n)}</b>`, esc(S[n] || n), w.svc[n] === 'Running' ? chip('läuft', 'ok') : chip('gestoppt', 'bad'), `<div class="wg-row">${w.svc[n] === 'Running' ? btn('Stoppen', 'run', { c: 'Stop-Service ' + n }, 'sm') + btn('Neu starten', 'run', { c: 'Restart-Service ' + n }, 'sm') : btn('Starten', 'run', { c: 'Start-Service ' + n }, 'sm primary')}</div>`])));
  };
  PAGES.windows.firewall = (d, G) => {
    const w = W(d);
    return card('Windows-Firewall', `<p>Status: ${w.fwOn ? chip('aktiv', 'ok') : chip('aus', 'bad')} ${w.fwOn ? btn('Ausschalten', 'run', { c: 'Set-NetFirewallProfile -Enabled False' }, 'sm') : btn('Einschalten', 'run', { c: 'Set-NetFirewallProfile -Enabled True' }, 'sm primary')}</p><div class="wg-row">${btn('Neue Regel', 'dlg', { k: 'newfw' }, 'primary')}</div>` + tbl(['Regel', 'Port', 'Richtung', 'Aktiv'], w.fw.map(r => [`<b>${esc(r.name)}</b>`, `${r.port}/${r.proto}`, 'Eingehend', `<label class="wg-sw"><input type="checkbox" data-act="fwrule" data-n="${esc(r.name)}" ${r.on ? 'checked' : ''} aria-label="${esc(r.name)}"><i></i></label>`]), 'Keine Regeln. Eingehender Verkehr ist blockiert.'));
  };
  PAGES.windows.terminal = LX.terminal;

  // --- Storage ---
  const ST = () => A.STOR, S0 = ST;
  PAGES.storage.dashboard = (d, G) => {
    const T = ST().st(d), pools = T.pools.map(p => ({ p, i: ST().poolInfo(d, p) })), ports = d.ports.filter(p => d.pk[p] === 'fc'), up = ports.filter(p => A.status(d, p) === 'connected');
    return `<div class="wg-grid">${card('Kapazität', pools.length ? pools.map(x => `<p class="wg-k">${esc(x.p.name)} (${ST().RAID[x.p.raid].name})</p>${bar(x.i.alloc, x.i.usable, 85)}<p class="wg-s">${gb(x.i.alloc)} von ${gb(x.i.usable)} belegt${x.i.over ? ' – <b class="wg-bad">überprovisioniert</b>' : ''}</p>`).join('') : '<p class="wg-empty">Noch kein Pool.</p>' + btn('Pool erstellen', 'nav', { p: 'pools' }, 'sm primary'))}
      ${card('LUNs', `<p class="wg-big">${T.luns.length}<small> angelegt</small></p><p class="wg-mut">${T.luns.filter(l => l.hosts.length).length} davon Hosts zugeordnet</p>${btn('Zu den LUNs', 'nav', { p: 'luns' }, 'sm')}`)}
      ${card('Controller', ['A', 'B'].map(c => { const cp = ports.filter(p => p[0] === c), cu = cp.filter(p => A.status(d, p) === 'connected'); return `<p>${chip('Controller ' + c, cu.length ? 'ok' : '')} ${cu.length} von ${cp.length} FC-Ports mit Link</p>`; }).join('') + btn('Zu den Ports', 'nav', { p: 'ports' }, 'sm'))}
      ${card('Meldungen', (() => { const m = []; pools.forEach(x => x.i.over && m.push(`Pool ${esc(x.p.name)} ist überprovisioniert.`)); T.luns.forEach(l => { if (!l.hosts.length) m.push(`LUN ${esc(l.name)} ist keinem Host zugeordnet.`); }); if (!up.length && ports.length) m.push('Kein FC-Port hat Link.'); return m.length ? `<ul class="wg-ul">${m.map(x => `<li>${chip('Hinweis', 'warn')} ${x}</li>`).join('')}</ul>` : '<p class="wg-mut">Keine Meldungen.</p>'; })())}</div>`;
  };
  PAGES.storage.pools = (d, G) => {
    const T = ST().st(d);
    return `<div class="wg-row">${btn('Pool erstellen', 'dlg', { k: 'newpool' }, 'primary')}</div>` + tbl(['Pool', 'RAID', 'Platten', 'Nutzbar', 'Belegt', 'Ausfallsicherheit', ''], T.pools.map(p => { const i = ST().poolInfo(d, p); return [`<b>${esc(p.name)}</b>`, ST().RAID[p.raid].name, `${p.disks} × ${p.diskGb} GB`, gb(i.usable), `${gb(i.alloc)}${bar(i.alloc, i.usable, 85)}`, i.fault ? `${i.fault} Platte${i.fault > 1 ? 'n' : ''}` : chip('keine', 'bad'), btn('Löschen', 'delpool', { n: p.name }, 'sm ghost bad')]; }), 'Noch kein Pool. Ein Pool fasst Platten zu einer RAID-Gruppe zusammen.')
      + '<p class="wg-note">Die Rohkapazität geht zum Teil für RAID-Redundanz verloren: RAID 5 verliert eine Platte, RAID 6 zwei, RAID 10 und RAID 1 die Hälfte.</p>';
  };
  PAGES.storage.luns = (d, G) => {
    const T = ST().st(d), net = A.net();
    return `<div class="wg-row">${btn('LUN erstellen', 'dlg', { k: 'newlun' }, 'primary')}</div>` + tbl(['ID', 'Name', 'Pool', 'Größe', 'Typ', 'Zugeordnete Hosts', ''], T.luns.map(l => [l.id, `<b>${esc(l.name)}</b>`, esc(l.pool), gb(l.gb), l.thin ? 'Thin' : 'Thick', l.hosts.map(h => esc((net.devs[h] || { cfg: { hostname: h } }).cfg.hostname)).join(', ') || '<span class="wg-mut">keiner</span>', `<div class="wg-row">${btn('Zuordnen', 'dlg', { k: 'maplun', l: l.id }, 'sm')}${btn('Löschen', 'dellun', { l: l.id }, 'sm ghost bad')}</div>`]), 'Noch keine LUN.');
  };
  PAGES.storage.hosts = (d, G) => {
    const net = A.net(), T = ST().st(d), servers = Object.values(net.devs).filter(x => x.type === 'server' && !A.isCloud(x));
    return card('Hosts und LUN-Sichtbarkeit', tbl(['Host', 'FC-Ports (WWPN)', 'LUN', 'Sichtbarkeit'], servers.flatMap(s => { const fc = s.ports.filter(p => s.pk[p] === 'fc'), ls = T.luns.filter(l => l.hosts.includes(s.id)); if (!ls.length) return [[`<b>${esc(s.cfg.hostname)}</b>`, fc.map(p => `<code>${esc(A.wwpn(s, p))}</code>`).join('<br>') || '<span class="wg-mut">kein HBA</span>', '–', '<span class="wg-mut">keine LUN zugeordnet</span>']]; return ls.map((l, i) => { const w = ST().why(net, s, d, l.id), n = ST().hostLuns(net, s).filter(x => x.sto === d.id && x.lun === l.id).map(x => x.paths.length)[0]; return [i ? '' : `<b>${esc(s.cfg.hostname)}</b>`, i ? '' : fc.map(p => `<code>${esc(A.wwpn(s, p))}</code>`).join('<br>') || '<span class="wg-mut">kein HBA</span>', esc(l.name), w ? `${chip('nicht sichtbar', 'bad')} <small>${esc(w)}</small>` : chip(n + ' Pfad' + (n > 1 ? 'e' : ''), 'ok')]; }); }), 'Kein Server im Plan.'))
      + '<p class="wg-note">Ein Server sieht eine LUN, wenn drei Dinge stimmen: Zuordnung hier (LUN-Masking), aktives Zoning im FC-Switch und Verkabelung. Danach braucht er einen Rescan.</p>';
  };
  PAGES.storage.ports = (d, G) => card('Ports', tbl(['Port', 'Controller', 'Status', 'Geschwindigkeit', 'WWPN', 'Verbunden mit'], d.ports.map(p => { const s = A.statusFull(d, p), fc = d.pk[p] === 'fc'; return [`<b>${esc(A.SH(p))}</b>`, p[0] === 'A' || p[0] === 'B' ? p[0] : '–', s.st === 'connected' ? chip('Link up', 'ok') : chip(s.st === 'notconnect' ? 'kein Link' : s.st, 'bad'), s.st === 'connected' ? esc(A.fmtSpeed(s.speed, s.proto)) : '–', fc ? `<code>${esc(A.wwpn(d, p))}</code>` : '–', s.peer ? esc(A.net().devs[s.peer.dev].cfg.hostname + ' ' + A.SH(s.peer.port)) : '–']; })));

  // --- Fabric ---
  PAGES.fabric.dashboard = (d, G) => {
    const Z = ST().zs(d), net = A.net(), up = d.ports.filter(p => A.status(d, p) === 'connected');
    return `<div class="wg-grid">${card('Fabric', `<dl class="wg-dl"><dt>Switch</dt><dd>${esc(d.cfg.hostname)}</dd><dt>VSAN</dt><dd>${d.cfg.vsan || 10}</dd><dt>Ports mit Link</dt><dd>${up.length} von ${d.ports.length}</dd></dl>`)}
      ${card('Zoning', `<p>Zoneset: ${Z.active ? chip('aktiv', 'ok') : chip('nicht aktiv', 'bad')}</p><p class="wg-mut">${Z.zones.length} Zone${Z.zones.length === 1 ? '' : 'n'}</p>${Z.active ? '' : '<p class="wg-warn">Ohne aktives Zoneset gilt „deny“: Es besteht keine Verbindung zwischen Servern und Storage.</p>'}${btn('Zum Zoning', 'nav', { p: 'zoning' }, 'sm')}`)}
      ${card('Angeschlossen', tbl(['Gerät', 'Port', 'Rolle'], ST().attached(net, d).map(x => [esc(x.dev.cfg.hostname), esc(A.SH(x.port)), x.role === 'initiator' ? 'Server (Initiator)' : 'Storage (Target)']), 'Nichts angeschlossen.'))}</div>`;
  };
  PAGES.fabric.ports = (d, G) => card('Ports', tbl(['Port', 'Status', 'Geschwindigkeit', 'Transceiver', 'Verbunden mit', 'WWPN der Gegenstelle'], d.ports.map(p => { const s = A.statusFull(d, p), pd = s.peer ? A.net().devs[s.peer.dev] : null; return [`<b>${esc(A.SH(p))}</b>`, s.st === 'connected' ? chip('Link up', 'ok') : chip(s.st === 'notconnect' ? 'kein Link' : s.st, s.link ? 'bad' : ''), s.st === 'connected' ? esc(A.fmtSpeed(s.speed, s.proto)) : '–', esc(d.xcvr[p] || '–'), pd ? esc(pd.cfg.hostname + ' ' + A.SH(s.peer.port)) : '–', pd && pd.pk[s.peer.port] === 'fc' ? `<code>${esc(A.wwpn(pd, s.peer.port))}</code>` : '–']; })));
  PAGES.fabric.zoning = (d, G) => {
    const Z = ST().zs(d), lab = A.fcLabel();
    return card('Zoneset', `<p>Status: ${Z.active ? chip('aktiv', 'ok') : chip('nicht aktiv', 'bad')}</p><div class="wg-row">${btn('Auto-Zoning aus Verkabelung', 'autozone', null, '')}${btn(Z.active ? 'Zoneset deaktivieren' : 'Zoneset aktivieren', 'zset', null, Z.active ? '' : 'primary')}${btn('Zone erstellen', 'dlg', { k: 'newzone2' }, 'primary')}</div>`)
      + card(`Zonen (${Z.zones.length})`, tbl(['Zone', 'Mitglieder', ''], Z.zones.map(z => [`<b>${esc(z.name)}</b>`, z.members.map(w => `${esc(lab[w] || '?')}<br><code class="wg-mut">${esc(w)}</code>`).join('<br>'), btn('Löschen', 'delzone', { n: z.name }, 'sm ghost bad')]), 'Noch keine Zone. „Auto-Zoning“ legt je Server-Port und Storage-Port eine Zone an (Single-Initiator).'))
      + '<p class="wg-note">Änderungen am Zoning gelten erst, wenn das Zoneset aktiv ist. Best Practice ist Single-Initiator-Zoning: eine Zone je Server-Port mit den Storage-Ports, die er braucht.</p>';
  };
  PAGES.fabric.fabric = (d, G) => card('Fabric-Einstellungen', `<div class="wg-row">${field('vsan', 'VSAN', d.cfg.vsan || 10, { type: 'number', min: 1, max: 4093 })}${btn('Übernehmen', 'vsan', null, 'primary')}</div><p class="wg-note">Ein VSAN trennt FC-Fabrics logisch auf einem Switch (vergleichbar mit einem VLAN).</p>`);

  // ---------- Cisco Switch / Router ----------
  const natSort = a => a.slice().sort((x, y) => x.localeCompare(y, 'en', { numeric: true }));
  const vlStr = a => { if (a === null) return 'alle'; const o = []; let i = 0; a = a.slice().sort((x, y) => x - y); while (i < a.length) { let j = i; while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++; o.push(j > i ? a[i] + '-' + a[j] : '' + a[i]); i = j + 1; } return o.join(',') || 'keine'; };
  const stChip = (d, p) => { const s = A.statusFull(d, p), i = d.cfg.ifs[p]; return i.shutdown ? chip('admin down', 'bad') : s.st === 'connected' ? chip('up', 'ok') : s.st === 'err-disabled' ? chip('err-disabled', 'bad') : chip('down'); };
  const peerName = (d, p) => { const s = A.statusFull(d, p), pd = s.peer ? A.net().devs[s.peer.dev] : null; return pd ? esc(pd.cfg.hostname + ' ' + A.SH(s.peer.port)) : '<span class="wg-mut">–</span>'; };
  const mgmtAddr = d => { const n = Object.keys(d.cfg.ifs).find(k => d.cfg.ifs[k].ip); return n ? { n, ip: d.cfg.ifs[n].ip, mask: d.cfg.ifs[n].mask } : null; };
  const showBox = (d, c) => `<pre class="wg-pre">${esc(A.iosShow(d, c) || '(keine Ausgabe)')}</pre>`;
  const faceplate = d => `<div class="wg-face" role="group" aria-label="Portansicht">${d.ports.map(p => { const s = A.statusFull(d, p), i = d.cfg.ifs[p], c = i.shutdown ? 'adm' : s.st === 'connected' ? 'up' : s.st === 'err-disabled' ? 'err' : 'dn'; return `<button type="button" class="wg-port ${c}" data-act="nav" data-p="interfaces" title="${esc(A.SH(p))}: ${i.shutdown ? 'admin down' : s.st}${d.type === 'switch' ? (i.mode === 'trunk' ? ', Trunk' : ', VLAN ' + i.vlan) : ''}" aria-label="${esc(A.SH(p))} ${i.shutdown ? 'admin down' : s.st}"><i></i><span>${esc(A.SH(p).replace(/^[A-Za-z]+/, ''))}</span></button>`; }).join('')}</div><div class="wg-leg"><span><i class="up"></i>up</span><span><i class="dn"></i>down</span><span><i class="adm"></i>admin down</span><span><i class="err"></i>err-disabled</span></div>`;
  PAGES.switch.dashboard = PAGES.router.dashboard = (d, G) => {
    const up = d.ports.filter(p => !d.cfg.ifs[p].shutdown && A.status(d, p) === 'connected').length, m = mgmtAddr(d), sw = d.type === 'switch', nv = sw ? Object.keys(d.cfg.vlans).length : 0;
    const nb = A.iosShow(d, 'show cdp neighbors').split('\n').slice(3).filter(l => l.trim());
    return `<div class="wg-cards">
      ${card('Gerät', `<dl class="wg-dl"><dt>Hostname</dt><dd>${esc(d.cfg.hostname)}</dd><dt>Modell</dt><dd>${esc(d.model || (sw ? 'Switch' : 'Router'))}</dd><dt>Software</dt><dd>Cisco IOS XE (NetLab)</dd><dt>Management-IP</dt><dd>${m ? esc(m.ip + '/' + maskLen(m.mask) + ' (' + A.SH(m.n) + ')') : '<span class="wg-mut">keine – ' + (sw ? 'SVI anlegen' : 'Schnittstelle konfigurieren') + '</span>'}</dd><dt>Konfiguration</dt><dd>${d.saved ? chip('gespeichert', 'ok') : chip('nicht gespeichert', 'bad')}</dd></dl>`)}
      ${card('Schnittstellen', `<p class="wg-big">${up}<small> von ${d.ports.length} up</small></p>${bar(up, d.ports.length, 101)}<p class="wg-note">${d.ports.filter(p => d.cfg.ifs[p].shutdown).length} administrativ abgeschaltet</p>${btn('Zu den Schnittstellen', 'nav', { p: 'interfaces' }, 'sm')}`)}
      ${sw ? card('VLANs', `<p class="wg-big">${nv}<small> angelegt</small></p><p class="wg-note">Layer 3: ${d.cfg.ipRouting ? chip('ip routing an', 'ok') : chip('reiner Layer-2-Switch')}</p>${btn('Zu den VLANs', 'nav', { p: 'vlans' }, 'sm')}`) : card('Routing', `<p class="wg-big">${d.cfg.routes.length}<small> statische Routen</small></p>${btn('Zum Routing', 'nav', { p: 'l3' }, 'sm')}`)}
    </div>${A.NL.MODELS[d.model] && A.NL.MODELS[d.model].poe ? poeCard(d) : ''}${card('Portansicht', faceplate(d))}
    ${card('Nachbarn (CDP)', nb.length ? `<pre class="wg-pre">${esc(['Gerät          Lokal         Plattform        Port', ...nb].join('\n'))}</pre>` : '<p class="wg-empty">Keine CDP-Nachbarn. Verbinde den Port mit einem Switch oder Router.</p>')}`;
  };
  PAGES.switch.monitor = PAGES.router.monitor = (d, G) => {
    const sw = d.type === 'switch', tabs = [['ifs', 'Schnittstellen', 'show interfaces status'], ['ip', 'IP-Schnittstellen', 'show ip interface brief'], ['route', 'Routing-Tabelle', 'show ip route'], ['cdp', 'CDP-Nachbarn', 'show cdp neighbors'], ['inv', 'Inventar', 'show inventory'], ['ver', 'Version', 'show version']].concat(sw ? [['vlan', 'VLAN', 'show vlan brief'], ['trunk', 'Trunks', 'show interfaces trunk']] : []).concat([['acl', 'ACLs', 'show access-lists']]);
    const t = G.tab.mon || 'ifs', cur = tabs.find(x => x[0] === t) || tabs[0];
    return `<div class="wg-tabs" role="tablist">${tabs.map(x => `<button type="button" role="tab" class="${x[0] === cur[0] ? 'act' : ''}" aria-selected="${x[0] === cur[0]}" data-act="tab" data-t="mon" data-v="${x[0]}">${x[1]}</button>`).join('')}</div>` + card(cur[1], `<p class="wg-note">Entspricht dem Befehl <code>${cur[2]}</code>.</p>${showBox(d, cur[2])}`);
  };
  PAGES.switch.interfaces = PAGES.router.interfaces = (d, G) => {
    const sw = d.type === 'switch', ps = d.ports; G.isel = (G.isel || []).filter(p => ps.includes(p));
    const hdr = sw ? ['Port', 'Status', 'Beschreibung', 'Modus', 'VLAN', 'Verbunden mit', ''] : ['Port', 'Status', 'Beschreibung', 'IP-Adresse', 'Verbunden mit', ''];
    const rows = ps.map(p => { const i = d.cfg.ifs[p], chk = `<label class="wg-ck"><input type="checkbox" data-act="isel" data-p="${esc(p)}" ${G.isel.includes(p) ? 'checked' : ''} aria-label="${esc(A.SH(p))} auswählen"></label>`;
      const base = [`<span class="wg-nw">${chk}<b>${esc(A.SH(p))}</b></span>`, stChip(d, p), esc(i.desc || '')];
      const mid = sw ? [i.mode === 'trunk' ? 'Trunk' : 'Access', i.mode === 'trunk' ? `nativ ${i.native}, erlaubt ${vlStr(i.allowed)}` : i.vlan] : [i.ip ? esc(i.ip + '/' + maskLen(i.mask)) : '<span class="wg-mut">keine</span>'];
      return base.concat(mid, [peerName(d, p), btn('Bearbeiten', 'dlg', { k: 'ifedit', p }, 'sm')]); });
    const sel = G.isel.length;
    const svi = sw ? Object.keys(d.cfg.ifs).filter(n => n.startsWith('Vlan')) : [];
    return `<div class="wg-row">${btn(`Auswahl bearbeiten (${sel})`, 'dlg', { k: 'ifedit', p: '*' }, 'primary' + (sel ? '' : ' disabled'))}${btn('Alle auswählen', 'isall', null, 'sm')}${btn('Auswahl aufheben', 'isnone', null, 'sm ghost')}${btn('Auswahl aktivieren', 'ifup', null, 'sm' + (sel ? '' : ' disabled'))}${btn('Auswahl abschalten', 'ifdown', null, 'sm' + (sel ? '' : ' disabled'))}</div>`
      + tbl(hdr, rows, 'Keine Schnittstellen.') + (svi.length ? `<p class="wg-note">SVIs (Vlan-Schnittstellen) findest du unter Layer 3.</p>` : '');
  };
  PAGES.switch.vlans = (d, G) => {
    const vs = Object.keys(d.cfg.vlans).map(Number).sort((a, b) => a - b);
    return `<div class="wg-row">${btn('VLAN hinzufügen', 'dlg', { k: 'newvlan' }, 'primary')}</div>` + tbl(['VLAN-ID', 'Name', 'Status', 'Access-Ports', 'Trunks', ''], vs.map(v => { const acc = natSort(d.ports.filter(p => d.cfg.ifs[p].mode !== 'trunk' && d.cfg.ifs[p].vlan === v)), tr = d.ports.filter(p => d.cfg.ifs[p].mode === 'trunk' && (d.cfg.ifs[p].allowed === null || d.cfg.ifs[p].allowed.includes(v)));
      return [`<b>${v}</b>`, esc(d.cfg.vlans[v]), chip('active', 'ok'), acc.length ? esc(acc.map(A.SH).join(', ')) : '<span class="wg-mut">keine</span>', tr.length ? esc(tr.map(A.SH).join(', ')) : '<span class="wg-mut">–</span>', `<div class="wg-row">${btn('Umbenennen', 'dlg', { k: 'vlname', v }, 'sm')}${v === 1 ? '' : btn('Löschen', 'vldel', { v }, 'sm ghost bad')}</div>`]; }))
      + '<p class="wg-note">Ein Access-Port gehört zu genau einem VLAN. Auf Trunks fließen mehrere VLANs getaggt (802.1Q). Ein VLAN, das nicht angelegt ist, macht seine Ports inaktiv.</p>';
  };
  PAGES.switch.l3 = PAGES.router.l3 = (d, G) => {
    const sw = d.type === 'switch', svis = sw ? natSort(Object.keys(d.cfg.ifs).filter(n => n.startsWith('Vlan'))) : [];
    let h = '';
    if (sw) {
      h += card('IP-Routing', `<p>${d.cfg.ipRouting ? chip('aktiv', 'ok') + ' Der Switch routet zwischen seinen SVIs (Layer-3-Switch).' : chip('aus') + ' Der Switch arbeitet nur auf Layer 2. Die SVIs dienen als Management-Adresse.'}</p><div class="wg-row">${btn(d.cfg.ipRouting ? 'Routing abschalten' : 'Routing aktivieren', 'iprt', null, d.cfg.ipRouting ? '' : 'primary')}</div>`);
      h += card('SVIs (Vlan-Schnittstellen)', `<div class="wg-row">${btn('SVI hinzufügen', 'dlg', { k: 'newsvi' }, 'primary')}</div>` + tbl(['Schnittstelle', 'IP-Adresse', 'Status', ''], svis.map(n => { const i = d.cfg.ifs[n]; return [`<b>${esc(n)}</b>`, i.ip ? esc(i.ip + '/' + maskLen(i.mask)) : '<span class="wg-mut">keine</span>', i.shutdown ? chip('admin down', 'bad') : (A.ifUp && !A.ifUp(d, n) ? chip('down') : chip('up', 'ok')), `<div class="wg-row">${btn('Bearbeiten', 'dlg', { k: 'editsvi', n }, 'sm')}${n === 'Vlan1' ? '' : btn('Löschen', 'svidel', { n }, 'sm ghost bad')}</div>`]; }), 'Keine SVIs.'));
      h += card('Default-Gateway (Layer-2-Betrieb)', `<div class="wg-row end">${field('dgw', 'ip default-gateway', d.cfg.gw || '', { ph: '192.168.1.1' })}${btn('Speichern', 'dgw', null, 'primary')}</div><p class="wg-note">Wird benutzt, solange <code>ip routing</code> aus ist, damit der Switch aus anderen Netzen erreichbar ist.</p>`);
    }
    h += card('Statische Routen', `<div class="wg-row">${btn('Route hinzufügen', 'dlg', { k: 'newroute' }, 'primary')}</div>` + (sw && !d.cfg.ipRouting ? '<p class="wg-note">Statische Routen wirken erst mit <code>ip routing</code>.</p>' : '') + tbl(['Zielnetz', 'Maske', 'Next Hop / Schnittstelle', ''], d.cfg.routes.map((r, i) => [`<b>${esc(r.net)}</b>`, esc(r.mask) + ' <small class="wg-mut">(/' + maskLen(r.mask) + ')</small>', esc(r.nh || A.SH(r.ifn)), btn('Löschen', 'rtdel', { i }, 'sm ghost bad')]), 'Keine statischen Routen.'));
    h += card('Routing-Tabelle', showBox(d, 'show ip route'));
    return h;
  };
  PAGES.switch.acl = PAGES.router.acl = (d, G) => {
    const names = Object.keys(d.cfg.acls), ifs = Object.keys(d.cfg.ifs).filter(n => d.cfg.ifs[n].aclIn || d.cfg.ifs[n].aclOut);
    return `<div class="wg-row">${btn('Regel hinzufügen', 'dlg', { k: 'newace' }, 'primary')}${btn('ACL an Schnittstelle binden', 'dlg', { k: 'aclbind' }, 'sm' + (names.length ? '' : ' disabled'))}</div>`
      + (names.length ? names.map(a => card('ACL ' + esc(a), tbl(['Nr.', 'Regel'], d.cfg.acls[a].map((e, i) => [(i + 1) * 10, `<code>${esc(e.text)}</code>`])) + `<div class="wg-row">${btn('ACL löschen', 'acldel', { a }, 'sm ghost bad')}</div>`)).join('') : '<p class="wg-empty">Noch keine Zugriffsliste. Lege mit „Regel hinzufügen“ die erste an.</p>')
      + card('Gebunden an', tbl(['Schnittstelle', 'ACL', 'Richtung', ''], ifs.flatMap(n => [d.cfg.ifs[n].aclIn ? [`<b>${esc(A.SH(n))}</b>`, esc(d.cfg.ifs[n].aclIn), 'in', btn('Lösen', 'aclunbind', { n, dir: 'in' }, 'sm ghost')] : null, d.cfg.ifs[n].aclOut ? [`<b>${esc(A.SH(n))}</b>`, esc(d.cfg.ifs[n].aclOut), 'out', btn('Lösen', 'aclunbind', { n, dir: 'out' }, 'sm ghost')] : null].filter(Boolean)), 'Keine ACL gebunden. Eine ACL wirkt erst, wenn sie an eine Schnittstelle gebunden ist.'))
      + '<p class="wg-note">Am Ende jeder Liste steht ein unsichtbares <code>deny ip any any</code>. Reihenfolge zählt: die erste passende Regel gewinnt. Quelle und Ziel: <code>any</code>, <code>host 10.0.0.5</code> oder <code>10.0.0.0 0.0.0.255</code> (Wildcard-Maske).</p>';
  };
  PAGES.switch.mgmt = PAGES.router.mgmt = (d, G) => {
    const sw = d.type === 'switch', m = mgmtAddr(d);
    return card('Hostname', `<div class="wg-row end">${field('hn', 'Hostname', d.cfg.hostname)}${btn('Speichern', 'hostname', null, 'primary')}</div>`)
      + card('Management-Zugang', `<dl class="wg-dl"><dt>Web-Oberfläche</dt><dd>${m ? `<code>https://${esc(m.ip)}/</code> ${chip('erreichbar, wenn Routing stimmt', 'ok')}` : chip('keine Management-IP', 'bad')}</dd><dt>Management-Schnittstelle</dt><dd>${m ? esc(A.SH(m.n)) : '–'}</dd></dl><p class="wg-note">Von einem PC erreichst du diese Seite im Webbrowser unter der Management-Adresse. Der PC braucht dafür eine IP im selben Netz (oder ein Gateway dorthin).</p>`)
      + card('Gerät', `<dl class="wg-dl"><dt>Modell</dt><dd>${esc(d.model || '–')}</dd><dt>Ports</dt><dd>${d.ports.length}</dd></dl>${showBox(d, 'show inventory')}`);
  };
  PAGES.switch.config = PAGES.router.config = (d, G) => card('Running-Config', `<div class="wg-row">${btn('Konfiguration speichern (write memory)', 'iosave', null, 'primary')}${d.saved ? chip('gespeichert', 'ok') : chip('nicht gespeichert', 'bad')}</div><p class="wg-note">Ohne Speichern ist die Konfiguration nach einem Neustart weg. Die Running-Config ist die laufende Konfiguration, die Startup-Config wird beim Start geladen.</p>${showBox(d, 'show running-config')}`);
  PAGES.switch.cli = PAGES.router.cli = (d, G) => {
    const lines = A.termOut(d);
    return `<div class="wg-term" id="wg-out" role="log" aria-live="polite">${lines.map(o => `<div class="k-${o.c}">${esc(o.t) || '&nbsp;'}</div>`).join('')}</div><form class="wg-termin" data-act="term"><label for="wg-cmd">${esc(A.prompt(d))}</label><input id="wg-cmd" autocomplete="off" spellcheck="false" aria-label="Befehl"></form>`;
  };
  PAGES.switch.ping = PAGES.router.ping = (d, G) => `<form class="wg-row end" data-act="pingf">${field('pdst', 'Ziel-IP-Adresse', G.pdst || '', { ph: '192.168.1.10' })}<button type="submit" class="wg-b primary" data-act="pingf" data-m="ping">Ping</button><button type="submit" class="wg-b" data-act="pingf" data-m="traceroute">Traceroute</button></form>` + (G.pout ? card(G.pout.t, `<pre class="wg-pre">${esc(G.pout.o)}</pre>`) : '<p class="wg-empty">Gib eine Ziel-IP ein. Der Test läuft vom Gerät aus, mit der Quelladresse der Ausgangsschnittstelle.</p>');

  // ---------- DHCP (Cisco IOS und ASA) ----------
  const dhcpPools = d => A.blocks(d, 'ip dhcp pool').map(b => { const g = k => { const l = b.lines.find(x => x.toLowerCase().startsWith(k + ' ')); return l ? l.slice(k.length + 1).trim() : ''; }, nm = b.head.split(' ')[3], nw = g('network').split(' '); return { name: nm, net: nw[0] || '', mask: nw[1] || '', gw: g('default-router'), dns: g('dns-server'), leases: d.leases && d.leases[nm] ? Object.keys(d.leases[nm]).length : 0 }; });
  const excluded = d => d.cfg.lines.filter(l => /^ip dhcp excluded-address /i.test(l)).map(l => l.split(' ').slice(3));
  PAGES.switch.dhcp = PAGES.router.dhcp = (d, G) => {
    const ps = dhcpPools(d), ifs = Object.keys(d.cfg.ifs).filter(n => d.cfg.ifs[n].ip), has = p => ifs.find(n => A.inNet(d.cfg.ifs[n].ip, p.net, p.mask));
    return `<p class="wg-note">Ein Switch mit <code>ip routing</code> oder ein Router kann DHCP-Server sein. Der Pool wird für das Netz benutzt, in dem die Schnittstelle (SVI) liegt, an der die Clients hängen. Clients in anderen Netzen brauchen ein Relay (<code>ip helper-address</code>).</p>`
      + card('DHCP-Pools', `<div class="wg-row">${btn('Pool hinzufügen', 'dlg', { k: 'dpool' }, 'primary')}</div>` + tbl(['Name', 'Netz', 'Default-Router', 'DNS', 'Schnittstelle', 'Leases', ''], ps.map(p => [`<b>${esc(p.name)}</b>`, p.net ? esc(p.net + '/' + maskLen(p.mask)) : '<span class="wg-mut">fehlt</span>', esc(p.gw || '–'), esc(p.dns || '–'), has(p) ? esc(A.SH(has(p))) : chip('keine Schnittstelle im Netz', 'bad'), p.leases, btn('Löschen', 'dpooldel', { n: p.name }, 'sm ghost bad')]), 'Noch kein Pool. Ohne Pool vergibt das Gerät keine Adressen.'))
      + card('Ausgeschlossene Adressen', `<div class="wg-row">${btn('Bereich ausschließen', 'dlg', { k: 'dexcl' }, 'primary')}</div>` + tbl(['Von', 'Bis', ''], excluded(d).map((a, i) => [`<b>${esc(a[0])}</b>`, esc(a[1] || a[0]), btn('Entfernen', 'dexcldel', { i }, 'sm ghost')]), 'Keine. Schließe Gateway und feste Server-Adressen aus dem Pool aus.'))
      + card('DHCP-Relay (ip helper-address)', tbl(['Schnittstelle', 'IP-Adresse', 'Relay zu', ''], ifs.map(n => [`<b>${esc(A.SH(n))}</b>`, esc(d.cfg.ifs[n].ip), d.cfg.ifs[n].helper ? esc(d.cfg.ifs[n].helper) : '<span class="wg-mut">–</span>', btn('Ändern', 'dlg', { k: 'dhelp', n }, 'sm')]), 'Keine Schnittstelle mit IP-Adresse.'))
      + card('Vergebene Adressen', showBox(d, 'show ip dhcp binding'));
  };
  PAGES.firewall.dhcp = (d, G) => {
    const dd = d.cfg.dhcpd || { pools: {}, dns: null }, ifs = Object.keys(d.cfg.ifs).filter(n => d.cfg.ifs[n].nameif && d.cfg.ifs[n].ip);
    return `<p class="wg-note">Die ASA kann pro Zone einen DHCP-Server betreiben. Der Bereich muss im Subnetz der Schnittstelle liegen; die Schnittstelle selbst ist Gateway der Clients.</p>`
      + card('DHCP-Server je Schnittstelle', tbl(['Schnittstelle', 'Zone', 'Subnetz', 'Adressbereich', 'Status', ''], ifs.map(n => { const i = d.cfg.ifs[n], q = dd.pools[i.nameif] || {}; return [`<b>${esc(A.SH(n))}</b>`, esc(i.nameif), esc(i.ip + '/' + maskLen(i.mask)), q.start ? esc(q.start + ' – ' + q.end) : '<span class="wg-mut">nicht festgelegt</span>', q.on ? chip('aktiviert', 'ok') : chip('aus'), btn('Bearbeiten', 'dlg', { k: 'fwdhcp', n }, 'sm')]; }), 'Keine Schnittstelle mit Zone und IP-Adresse. Lege sie unter „Schnittstellen“ an.'))
      + card('Gemeinsame Einstellungen', `<dl class="wg-dl"><dt>DNS-Server für Clients</dt><dd>${esc(dd.dns || '–')}</dd></dl>`)
      + card('Bindings', showBox(d, 'show dhcpd binding'));
  };

  // ---------- Firewall (ASA, Oberfläche im OPNsense-Stil) ----------
  const zoneOf = (d, n) => d.cfg.ifs[n].nameif;
  const fwIfs = d => d.ports.filter(p => d.cfg.ifs[p]);
  PAGES.firewall.config = PAGES.router.config; PAGES.firewall.cli = PAGES.router.cli; PAGES.firewall.ping = PAGES.router.ping;
  PAGES.firewall.monitor = (d, G) => {
    const tabs = [['ifs', 'Schnittstellen', 'show interface ip brief'], ['route', 'Routing-Tabelle', 'show route'], ['nat', 'NAT', 'show nat'], ['acl', 'Regeln (ACL)', 'show access-list'], ['ver', 'Version', 'show version']], t = G.tab.mon || 'ifs', cur = tabs.find(x => x[0] === t) || tabs[0];
    return `<div class="wg-tabs" role="tablist">${tabs.map(x => `<button type="button" role="tab" class="${x[0] === cur[0] ? 'act' : ''}" aria-selected="${x[0] === cur[0]}" data-act="tab" data-t="mon" data-v="${x[0]}">${x[1]}</button>`).join('')}</div>` + card(cur[1], `<p class="wg-note">Entspricht dem Befehl <code>${cur[2]}</code>.</p>${showBox(d, cur[2])}`);
  };
  PAGES.firewall.dashboard = (d, G) => {
    const ps = fwIfs(d), up = ps.filter(p => !d.cfg.ifs[p].shutdown && A.status(d, p) === 'connected').length, rules = Object.values(d.cfg.acls).reduce((n, a) => n + a.length, 0), bound = ps.filter(p => d.cfg.ifs[p].aclIn).length;
    const hint = [];
    if (!ps.some(p => zoneOf(d, p))) hint.push('Noch keine Zone zugewiesen: gib einer Schnittstelle unter „Zuweisungen und Zonen“ einen Namen (z. B. inside, outside) und ein Security-Level.');
    if (rules && !bound) hint.push('Es gibt Regeln, aber keine ist an eine Schnittstelle gebunden. Erst die Bindung („eingehend“) macht sie wirksam.');
    return `<div class="wg-cards">
      ${card('System', `<dl class="wg-dl"><dt>Hostname</dt><dd>${esc(d.cfg.hostname)}</dd><dt>Modell</dt><dd>${esc(d.model || 'ASA')}</dd><dt>Konfiguration</dt><dd>${d.saved ? chip('gespeichert', 'ok') : chip('nicht gespeichert', 'bad')}</dd><dt>Verkehr zwischen gleichen Levels</dt><dd>${d.cfg.sameSec ? chip('erlaubt', 'ok') : chip('gesperrt')}</dd></dl>`)}
      ${card('Schnittstellen', `<p class="wg-big">${up}<small> von ${ps.length} verbunden</small></p>${bar(up, ps.length, 101)}${btn('Zu den Schnittstellen', 'nav', { p: 'interfaces' }, 'sm')}`)}
      ${card('Regeln und NAT', `<p class="wg-big">${rules}<small> Regeln · ${bound} Bindungen</small></p><p class="wg-note">${d.cfg.nat.length} NAT-Regel${d.cfg.nat.length === 1 ? '' : 'n'}, ${d.cfg.routes.length} statische Route${d.cfg.routes.length === 1 ? '' : 'n'}</p>${btn('Zu den Zugriffsregeln', 'nav', { p: 'rules' }, 'sm')}`)}
    </div>${hint.length ? `<div class="wg-msg err" role="status">${hint.map(esc).join('<br>')}</div>` : ''}
    ${card('Zonen', tbl(['Schnittstelle', 'Zone', 'Security-Level', 'IP-Adresse', 'Status'], ps.filter(p => zoneOf(d, p) || d.cfg.ifs[p].ip).map(p => { const i = d.cfg.ifs[p]; return [`<b>${esc(A.SH(p))}</b>`, i.nameif ? esc(i.nameif) : '<span class="wg-mut">–</span>', i.sl === null ? '–' : i.sl, i.ip ? esc(i.ip + '/' + maskLen(i.mask)) : '–', stChip(d, p)]; }), 'Noch keine Zonen. Weise einer Schnittstelle einen Namen zu.'))}
    <p class="wg-note">Regel: Verkehr von hohem zu niedrigem Security-Level (inside → outside) ist erlaubt, der umgekehrte Weg wird ohne ACL verworfen. Antworten auf erlaubte Verbindungen lässt die Firewall zustandsbehaftet durch.</p>`;
  };
  PAGES.firewall.interfaces = (d, G) => card('Zuweisungen und Zonen', tbl(['Schnittstelle', 'Status', 'Zone (nameif)', 'Security-Level', 'IP-Adresse', 'Verbunden mit', ''], fwIfs(d).map(p => { const i = d.cfg.ifs[p]; return [`<b>${esc(A.SH(p))}</b>`, stChip(d, p), i.nameif ? esc(i.nameif) : '<span class="wg-mut">nicht zugewiesen</span>', i.sl === null ? '–' : i.sl, i.ip ? esc(i.ip + '/' + maskLen(i.mask)) : '<span class="wg-mut">keine</span>', peerName(d, p), btn('Bearbeiten', 'dlg', { k: 'fwif', p }, 'sm')]; })))
    + '<p class="wg-note">Ohne Zone (nameif) leitet die ASA über eine Schnittstelle nichts weiter. „inside“ bekommt automatisch Level 100, „outside“ Level 0.</p>';
  PAGES.firewall.rules = (d, G) => {
    const names = Object.keys(d.cfg.acls), ps = fwIfs(d).filter(p => d.cfg.ifs[p].nameif);
    return `<div class="wg-row">${btn('Regel hinzufügen', 'dlg', { k: 'fwrule' }, 'primary')}${btn('Liste an Zone binden', 'dlg', { k: 'fwbind' }, 'sm' + (names.length && ps.length ? '' : ' disabled'))}</div>`
      + (names.length ? names.map(a => card('Regelliste ' + esc(a), tbl(['Nr.', 'Aktion', 'Regel'], d.cfg.acls[a].map((e, i) => [i + 1, e.action === 'permit' ? chip('erlauben', 'ok') : chip('blockieren', 'bad'), `<code>${esc(e.text)}</code>`])) + `<div class="wg-row">${btn('Liste löschen', 'fwacldel', { a }, 'sm ghost bad')}</div>`)).join('') : '<p class="wg-empty">Noch keine Regeln. Ohne Regel verwirft die ASA Verkehr von niedrigem zu hohem Level.</p>')
      + card('Bindung an Zonen (eingehend)', tbl(['Zone', 'Schnittstelle', 'Regelliste', ''], ps.filter(p => d.cfg.ifs[p].aclIn).map(p => [`<b>${esc(d.cfg.ifs[p].nameif)}</b>`, esc(A.SH(p)), esc(d.cfg.ifs[p].aclIn), btn('Lösen', 'fwunbind', { z: d.cfg.ifs[p].nameif }, 'sm ghost')]), 'Keine Liste gebunden.'))
      + '<p class="wg-note">Regeln werden von oben nach unten geprüft, die erste passende gewinnt; am Ende steht ein unsichtbares „deny ip any any“. Die ASA nutzt Netzmasken statt Wildcards (z. B. <code>10.10.0.0 255.255.255.0</code>).</p>';
  };
  PAGES.firewall.nat = (d, G) => `<div class="wg-row">${btn('NAT-Regel hinzufügen', 'dlg', { k: 'fwnat' }, 'primary')}</div>` + tbl(['Von Zone', 'Nach Zone', 'Art', ''], d.cfg.nat.map((n, i) => [`<b>${esc(n.from)}</b>`, `<b>${esc(n.to)}</b>`, 'Dynamisches PAT: Quelle → Interface-Adresse', btn('Löschen', 'fwnatdel', { i }, 'sm ghost bad')]), 'Keine NAT-Regeln. Private Adressen kommen so nicht ins Internet.') + card('Aktive Übersetzungen', showBox(d, 'show nat'));
  PAGES.firewall.routes = (d, G) => `<div class="wg-row">${btn('Route hinzufügen', 'dlg', { k: 'fwroute' }, 'primary')}</div>` + tbl(['Zielnetz', 'Maske', 'Gateway', 'Zone', ''], d.cfg.routes.map((r, i) => [`<b>${esc(r.net)}</b>`, esc(r.mask), esc(r.nh || '–'), esc(r.via || '–'), btn('Löschen', 'fwrtdel', { i }, 'sm ghost bad')]), 'Keine statischen Routen. Für das Internet brauchst du eine Default-Route (0.0.0.0 0.0.0.0).') + card('Routing-Tabelle', showBox(d, 'show route'));
  PAGES.firewall.general = (d, G) => card('Hostname', `<div class="wg-row end">${field('hn', 'Hostname', d.cfg.hostname)}${btn('Speichern', 'hostname', null, 'primary')}</div>`)
    + card('Verkehr zwischen Zonen gleichen Levels', `<p>${d.cfg.sameSec ? chip('erlaubt', 'ok') : chip('gesperrt')} Standardmäßig lässt die ASA keinen Verkehr zwischen Zonen mit demselben Security-Level zu.</p><div class="wg-row">${btn(d.cfg.sameSec ? 'Sperren' : 'Erlauben', 'fwsame', null, d.cfg.sameSec ? '' : 'primary')}</div><p class="wg-note"><code>same-security-traffic permit inter-interface</code></p>`);

  // ---------- HyperMetro (aktiv-aktiv mit Quorum-Server) ----------
  PAGES.storage.hypermetro = (d, G) => {
    const net = A.net(), S = ST(), dm = S.hm(d), others = Object.values(net.devs).filter(x => x.type === 'storage' && x.id !== d.id), srvs = Object.values(net.devs).filter(x => x.type === 'server' && !A.isCloud(x) && !x.vm);
    const intro = `<p class="wg-note">HyperMetro verbindet zwei Storage-Arrays zu einem aktiv-aktiv-Cluster: Die Hosts sehen eine LUN mit Pfaden zu <b>beiden</b> Arrays. Fällt ein Array oder die Verbindung zwischen ihnen aus, entscheidet ein <b>Quorum-Server</b> an einem dritten Standort, welche Seite weiterarbeiten darf. Ohne diesen Schiedsrichter könnten beide Seiten gleichzeitig schreiben (Split-Brain) und die Daten zerstören.</p>`;
    if (!dm) return intro + card('HyperMetro-Domäne', `<p>${chip('nicht eingerichtet')} Dieses Array gehört noch zu keiner Domäne.</p><div class="wg-row">${btn('Domäne erstellen', 'dlg', { k: 'hmnew' }, 'primary' + (others.length && srvs.length ? '' : ' disabled'))}</div>${!others.length ? '<p class="wg-warn">Es gibt kein zweites Storage-System im Plan.</p>' : ''}${!srvs.length ? '<p class="wg-warn">Für den Quorum-Server brauchst du einen Server (dritter Standort).</p>' : ''}`);
    const b = net.devs[dm.peer], q = net.devs[dm.quorum], st = S.hmState(net, d), me = st.a.id === d.id ? st.a : st.b, peer = st.a.id === d.id ? st.b : st.a, qs = S.quorumState(net, q), qip = q ? S.ipOf(q) : null;
    const modes = { normal: [chip('normal: aktiv-aktiv', 'ok')], split: [chip('Verbindung getrennt: ein Array arbeitet', 'bad')], failover: [chip('Failover: ein Array arbeitet', 'bad')], stopped: [chip('gestoppt: kein Zugriff', 'bad')] };
    const side = (x, dev) => [`<b>${esc(dev.cfg.hostname)}</b>${dm.preferred === dev.id ? ' <small class="wg-mut">(bevorzugt)</small>' : ''}`, x.up ? chip('läuft', 'ok') : chip('aus', 'bad'), x.q.ok ? chip('erreichbar', 'ok') : `${chip('nicht erreichbar', 'bad')}<br><small class="wg-mut">${esc(x.q.why || '')}</small>`, x.active ? chip('aktiv', 'ok') : chip('Standby', 'bad')];
    const pairs = S.st(d).luns.filter(l => l.hm);
    return intro
      + card(`Domäne ${esc(dm.name)}`, `<p>${modes[st.mode][0]}</p><p>${esc(st.text)}</p>` + tbl(['Array', 'Zustand', 'Quorum-Server', 'Rolle'], [side(me, d), side(peer, b)])
        + `<dl class="wg-dl"><dt>Replikationsverbindung</dt><dd>${st.link.ok ? chip('verbunden', 'ok') + ' über ' + esc(st.link.via) : chip('unterbrochen', 'bad') + ' <small class="wg-mut">' + esc(st.link.why) + '</small>'}</dd><dt>Bevorzugter Standort</dt><dd>${esc(net.devs[dm.preferred].cfg.hostname)}</dd><dt>Statische Priorität als Fallback</dt><dd>${dm.staticFallback ? chip('an', 'ok') : chip('aus')}</dd></dl>`
        + `<div class="wg-row">${btn('Einstellungen', 'dlg', { k: 'hmset' }, 'sm')}${btn('Replikationszonen anlegen', 'hmzone', null, 'sm')}${btn('Domäne löschen', 'hmdel', null, 'sm ghost bad')}</div>`)
      + card('Quorum-Server', `<dl class="wg-dl"><dt>Server</dt><dd>${q ? '<b>' + esc(q.cfg.hostname) + '</b>' : '–'}${qip ? ' (' + esc(qip) + ')' : ''}</dd><dt>Dienst</dt><dd>${qs.ok ? chip('läuft', 'ok') : chip('nicht bereit', 'bad') + ' <small class="wg-mut">' + esc(qs.why) + '</small>'}</dd></dl><p class="wg-note">Auf dem Server installierst du das Paket <code>quorum-server</code> und startest den Dienst: <code>sudo apt install quorum-server</code>, dann <code>sudo systemctl enable --now quorum-server</code>. Er muss von beiden Arrays über deren Management-Netz erreichbar sein, am besten an einem dritten Standort.</p>`)
      + card('HyperMetro-Paare', `<div class="wg-row">${btn('Paar erstellen', 'dlg', { k: 'hmpair' }, 'primary')}</div>` + tbl(['LUN', 'Größe', `Pool auf ${esc(d.cfg.hostname)}`, `Partner-LUN auf ${esc(b.cfg.hostname)}`, 'Status', ''], pairs.map(l => { const r = S.st(b).luns.find(x => x.id === l.hm.peerLun), both = me.active && peer.active; return [`<b>${esc(l.name)}</b>`, gb(l.gb), esc(l.pool), r ? esc(r.name + ' (' + r.pool + ')') : '–', both ? chip('aktiv-aktiv', 'ok') : me.active || peer.active ? chip('nur ' + esc((me.active ? d : b).cfg.hostname), 'bad') : chip('gestoppt', 'bad'), btn('Auflösen', 'hmpairdel', { l: l.id }, 'sm ghost bad')]; }), 'Noch kein Paar. Ein Paar spiegelt eine LUN synchron auf das Partner-Array; Hosts bekommen sie mit Pfaden zu beiden Arrays.'));
  };

  // ---------- WLAN: Access Point und Controller ----------
  const NLw = () => A.NL;
  const secName = x => ({ wpa2: 'WPA2-PSK', wpa3: 'WPA3-SAE', open: 'offen' }[x] || x);
  const hostLn = d => { const h = d.ports.map(p => A.hip(d, p)).find(x => x && x.ip); return h || {}; };
  const ssidList = d => d.type === 'wlc' ? NLw().wlcState(d).ssids : NLw().apState(d).ssids;
  const ssidTable = (d, ro) => tbl(['SSID', 'Sicherheit', 'VLAN', 'Status', ro ? '' : ''], ssidList(d).map((x, i) => [`<b>${esc(x.name)}</b>`, esc(secName(x.sec)), x.vlan ? x.vlan : '<span class="wg-mut">nativ (untagged)</span>', x.on === false ? chip('aus') : chip('sendet', 'ok'), ro ? '' : `<div class="wg-row">${btn('Bearbeiten', 'dlg', { k: 'ssid', i }, 'sm')}${btn(x.on === false ? 'Einschalten' : 'Ausschalten', 'ssidon', { i }, 'sm')}${btn('Löschen', 'ssiddel', { i }, 'sm ghost bad')}</div>`]), 'Noch keine SSID. Ohne SSID sendet der Access Point kein WLAN.');
  const clientRows = list => list.map(c => { const h = A.hip(c, c.ports[0]) || {}, st = A.statusFull(c, c.ports[0]), l = A.NL.wifiLinkOf(A.net(), c); return [`<b>${esc(c.cfg.hostname)}</b>`, esc((c.wifi || {}).ssid || ''), l ? esc(A.net().devs[l.b].cfg.hostname) : '–', h.ip ? esc(h.ip) : '<span class="wg-mut">keine</span>', st.st === 'connected' ? chip('verbunden', 'ok') : chip('getrennt', 'bad')]; });
  const netCard = d => { const h = hostLn(d); return card('IP-Konfiguration', `<dl class="wg-dl"><dt>IP-Adresse</dt><dd>${h.ip ? esc(h.ip + '/' + maskLen(h.mask)) : '<span class="wg-mut">keine</span>'}</dd><dt>Gateway</dt><dd>${esc(d.cfg.gw || '–')}</dd><dt>DNS</dt><dd>${esc(d.cfg.dns || '–')}</dd><dt>DHCP</dt><dd>${d.cfg.dhcp ? chip('an', 'ok') : chip('aus')}</dd></dl><div class="wg-row">${btn('Statisch einstellen', 'dlg', { k: 'apnet' }, 'primary')}${btn('Per DHCP beziehen', 'apdhcp', null, '')}</div>${A.status(d, d.ports[0]) !== 'connected' ? '<p class="wg-warn">Der Uplink hat keinen Link: Kabel, Strom (PoE) und Switchport prüfen.</p>' : ''}`); };
  PAGES.ap.network = PAGES.wlc.network = (d, G) => netCard(d) + '<p class="wg-note">Der Access Point braucht eine IP-Adresse im Management-Netz, um erreichbar zu sein und seinen Controller zu finden. Die Funk-Clients bekommen ihre Adressen aus dem VLAN der SSID.</p>';
  PAGES.ap.cli = PAGES.wlc.cli = PAGES.router.cli;
  PAGES.ap.dashboard = (d, G) => {
    const pw = NLw().apPower(A.net(), d), j = NLw().apJoined(A.net(), d), st = NLw().apState(d), h = hostLn(d), cl = NLw().apClients(A.net(), d), ss = NLw().apSsids(A.net(), d), up = A.statusFull(d, d.ports[0]);
    return `<div class="wg-cards">
      ${card('Gerät', `<dl class="wg-dl"><dt>Hostname</dt><dd>${esc(d.cfg.hostname)}</dd><dt>Modell</dt><dd>${esc(d.model || 'Access Point')}</dd><dt>IP-Adresse</dt><dd>${h.ip ? esc(h.ip + '/' + maskLen(h.mask)) : '<span class="wg-mut">keine</span>'}</dd><dt>Betriebsart</dt><dd>${j === null ? 'Autonom' : 'Controller (Lightweight)'}</dd></dl>`)}
      ${card('Stromversorgung', `<p>${pw.ok ? chip('versorgt', 'ok') + ' ' + esc(pw.via) : chip('kein Strom', 'bad')}</p>${pw.ok ? '' : `<p class="wg-warn">${esc(pw.reason)}</p>`}<div class="wg-row">${btn(st.injector ? 'PoE-Injector entfernen' : 'PoE-Injector anschließen', 'apinj', null, 'sm')}</div>`)}
      ${card('Uplink und Funk', `<p>${up.st === 'connected' ? chip('Link up', 'ok') + ' ' + esc(A.fmtSpeed(up.speed, up.proto)) : chip('kein Link', 'bad')}</p><p class="wg-note">${ss.length} SSID${ss.length === 1 ? '' : 's'} aktiv, ${cl.length} Client${cl.length === 1 ? '' : 's'} verbunden</p>${j && !j.ok ? `<p class="wg-warn">Controller-Modus, aber nicht angemeldet: ${esc(j.why)}</p>` : ''}`)}
    </div>`;
  };
  PAGES.ap.wlan = (d, G) => {
    const j = NLw().apJoined(A.net(), d);
    if (j === null) return `<div class="wg-row">${btn('SSID hinzufügen', 'dlg', { k: 'ssid', i: '' }, 'primary')}</div>` + ssidTable(d) + '<p class="wg-note">WPA2/WPA3 braucht einen Schlüssel von 8 bis 63 Zeichen. Das VLAN muss zum Switchport passen: „nativ“ sendet untagged, jedes andere VLAN geht getaggt auf den Uplink und braucht dort einen Trunk, der das VLAN erlaubt.</p>';
    return card('Vom Controller verwaltet', `<p>${j.ok ? chip('angemeldet', 'ok') + ' Die SSIDs kommen von <b>' + esc(j.wlc.cfg.hostname) + '</b>.' : chip('nicht angemeldet', 'bad') + ' ' + esc(j.why)}</p>`) + (j.ok ? tbl(['SSID', 'Sicherheit', 'VLAN'], NLw().apSsids(A.net(), d).map(x => [`<b>${esc(x.name)}</b>`, esc(secName(x.sec)), x.vlan || 'nativ']), '') : '<p class="wg-note">Solange der AP den Controller nicht erreicht, sendet er keine SSID.</p>');
  };
  PAGES.ap.clients = (d, G) => card('Verbundene Clients', tbl(['Client', 'SSID', 'AP', 'IP-Adresse', 'Status'], clientRows(NLw().apClients(A.net(), d)), 'Kein Client verbunden. Verbinde ein Notebook oder Smartphone im Detailfeld mit einer SSID.'));
  PAGES.ap.controller = (d, G) => {
    const j = NLw().apJoined(A.net(), d), st = NLw().apState(d), wl = Object.values(A.net().devs).filter(x => x.type === 'wlc');
    return card('WLAN-Controller', `<p>${j === null ? chip('autonom') + ' Der AP arbeitet allein mit seinen eigenen SSIDs.' : j.ok ? chip('angemeldet', 'ok') + ' bei ' + esc(j.wlc.cfg.hostname) : chip('nicht angemeldet', 'bad') + ' ' + esc(j.why)}</p><div class="wg-row end">${field('wlc', 'IP-Adresse des Controllers (leer = autonom)', st.wlc, { ph: wl[0] ? (hostLn(wl[0]).ip || '10.0.0.70') : '10.0.0.70' })}${btn('Speichern', 'apwlc', null, 'primary')}</div>`)
      + '<p class="wg-note">Ein Lightweight-AP bekommt seine Konfiguration vom Controller (CAPWAP). Dafür muss er den Controller per IP erreichen. Ohne Join sendet er kein WLAN.</p>';
  };
  PAGES.wlc.dashboard = (d, G) => {
    const ip = hostLn(d).ip, aps = Object.values(A.net().devs).filter(x => x.type === 'ap' && NLw().apState(x).wlc === ip), joined = aps.filter(a => { const j = NLw().apJoined(A.net(), a); return j && j.ok; }), cl = [].concat(...joined.map(a => NLw().apClients(A.net(), a)));
    return `<div class="wg-cards">${card('Access Points', `<p class="wg-big">${joined.length}<small> von ${aps.length} angemeldet</small></p>${bar(joined.length, aps.length || 1, 101)}${btn('Zu den Access Points', 'nav', { p: 'aps' }, 'sm')}`)}
      ${card('Clients', `<p class="wg-big">${cl.length}<small> verbunden</small></p>${btn('Zu den Clients', 'nav', { p: 'clients' }, 'sm')}`)}
      ${card('WLANs', `<p class="wg-big">${NLw().wlcState(d).ssids.length}<small> konfiguriert</small></p>${btn('Zu den WLANs', 'nav', { p: 'wlan' }, 'sm')}`)}</div>
      ${card('Gerät', `<dl class="wg-dl"><dt>Hostname</dt><dd>${esc(d.cfg.hostname)}</dd><dt>IP-Adresse</dt><dd>${ip ? esc(ip + '/' + maskLen(hostLn(d).mask)) : '<span class="wg-mut">keine</span>'}</dd><dt>Modell</dt><dd>${esc(d.model || 'Controller')}</dd></dl>`)}`;
  };
  PAGES.wlc.wlan = (d, G) => `<div class="wg-row">${btn('WLAN hinzufügen', 'dlg', { k: 'ssid', i: '' }, 'primary')}</div>` + ssidTable(d) + '<p class="wg-note">Die WLANs gelten für alle Access Points, die bei diesem Controller angemeldet sind. Hinter einem AP im Trunk-Modus braucht jedes VLAN eine Freigabe auf dem Switchport.</p>';
  PAGES.wlc.aps = (d, G) => {
    const ip = hostLn(d).ip, aps = Object.values(A.net().devs).filter(x => x.type === 'ap');
    return tbl(['Access Point', 'IP-Adresse', 'Controller laut AP', 'Strom', 'Status'], aps.map(a => { const j = NLw().apJoined(A.net(), a), st = NLw().apState(a), pw = NLw().apPower(A.net(), a), mine = st.wlc === ip; return [`<b>${esc(a.cfg.hostname)}</b>`, esc(hostLn(a).ip || '–'), st.wlc ? esc(st.wlc) + (mine ? '' : ' <small class="wg-mut">(anderer Controller)</small>') : '<span class="wg-mut">autonom</span>', pw.ok ? chip('ok', 'ok') : chip('kein Strom', 'bad'), mine ? (j && j.ok ? chip('angemeldet', 'ok') : chip('nicht angemeldet', 'bad') + '<br><small class="wg-mut">' + esc(j ? j.why : '') + '</small>') : '–']; }), 'Kein Access Point im Plan.') + '<p class="wg-note">Ein AP meldet sich an, wenn in seiner Controller-Einstellung die IP dieses Controllers steht und beide sich erreichen (IP, Gateway, VLAN).</p>';
  };
  PAGES.wlc.clients = (d, G) => { const ip = hostLn(d).ip, aps = Object.values(A.net().devs).filter(x => x.type === 'ap' && NLw().apState(x).wlc === ip && (NLw().apJoined(A.net(), x) || {}).ok); return card('Verbundene Clients', tbl(['Client', 'SSID', 'AP', 'IP-Adresse', 'Status'], clientRows([].concat(...aps.map(a => NLw().apClients(A.net(), a)))), 'Kein Client verbunden.')); };

  // ---------- Spanning Tree und EtherChannel ----------
  PAGES.switch.stp = (d, G) => {
    const net = A.net(), vls = Object.keys(d.cfg.vlans).map(Number).sort((a, b) => a - b), v = vls.includes(+G.tab.stpv) ? +G.tab.stpv : vls[0], r = A.NL.stp(net, v), x = r.sw[d.id], c = A.NL.stpCfg(d), peers = Object.values(net.devs).filter(y => y.type === 'switch');
    const root = x ? net.devs[x.rootId] : null, ports = x ? Object.keys(x.ports).sort((a, b) => d.ports.indexOf(a) - d.ports.indexOf(b)) : [];
    const prios = [0, 4096, 8192, 12288, 16384, 20480, 24576, 28672, 32768, 36864, 40960, 45056, 49152, 53248, 57344, 61440];
    return `<div class="wg-row end"><div class="wg-f"><label for="wf-stpv">VLAN</label><select id="wf-stpv" data-act="stpv">${vls.map(n => `<option value="${n}" ${n === v ? 'selected' : ''}>VLAN ${n}</option>`).join('')}</select></div><div class="wg-f"><label for="wf-mode">Modus</label><select id="wf-stmode"><option value="rapid-pvst" ${c.mode === 'rapid-pvst' ? 'selected' : ''}>Rapid-PVST+</option><option value="pvst" ${c.mode === 'pvst' ? 'selected' : ''}>PVST+</option></select></div>${btn('Modus setzen', 'stmode', null, 'sm')}</div>`
      + card(`Spanning Tree VLAN ${v}`, c.off.has(v) ? `<p>${chip('deaktiviert', 'bad')} Dieser Switch nimmt in VLAN ${v} nicht am Spanning Tree teil. Schleifen legen das Netz lahm.</p><div class="wg-row">${btn('Spanning Tree einschalten', 'stoff', { v, on: 1 }, 'primary')}</div>`
        : x ? `<dl class="wg-dl"><dt>Root Bridge</dt><dd><b>${esc(root.cfg.hostname)}</b> ${x.root ? chip('dieser Switch', 'ok') : ''}</dd><dt>Root-ID</dt><dd><code>${x.rootBid[0]} ${esc(x.rootBid[1])}</code></dd><dt>Bridge-ID dieses Switches</dt><dd><code>${x.bid[0]} ${esc(x.bid[1])}</code> (Priorität ${x.prio})</dd><dt>Pfadkosten zur Root</dt><dd>${x.root ? '0' : x.cost}</dd><dt>Root-Port</dt><dd>${x.rp ? esc(A.SH(x.rp)) : '–'}</dd></dl>
          <div class="wg-row end"><div class="wg-f"><label for="wf-sprio">Priorität</label><select id="wf-sprio">${prios.map(n => `<option value="${n}" ${n === x.prio ? 'selected' : ''}>${n}</option>`).join('')}</select></div>${btn('Priorität setzen', 'stprio', { v }, 'primary')}${btn('Root primary', 'stroot', { v }, 'sm')}${btn('Spanning Tree aus', 'stoff', { v, on: 0 }, 'sm ghost bad')}</div>
          <p class="wg-note">Die Root Bridge ist der Switch mit der niedrigsten Bridge-ID (Priorität, dann MAC-Adresse). Wähle sie bewusst: am besten ein Core-Switch mit Priorität 4096 oder <code>root primary</code>.</p>` : `<p class="wg-empty">In diesem VLAN gibt es keinen Link zu einem anderen Switch.</p>`)
      + (x ? card('Ports', tbl(['Port', 'Rolle', 'Status', 'Kosten'], ports.map(p => { const q = x.ports[p]; return [`<b>${esc(A.SH(p))}</b>`, q.role === 'desg' ? 'Designated' : q.role === 'root' ? 'Root' : 'Alternate', q.sts === 'FWD' ? chip('Forwarding', 'ok') : chip('Blocking', 'bad'), q.cost]; }), 'Keine Ports mit Nachbar-Switch.')) : '')
      + (peers.length > 1 ? card('Alle Switches in diesem VLAN', tbl(['Switch', 'Priorität', 'Rolle'], Object.entries(r.sw).map(([id, y]) => [`<b>${esc(net.devs[id].cfg.hostname)}</b>`, y.prio, y.root ? chip('Root', 'ok') : 'Non-Root']), 'Keine.')) : '');
  };
  PAGES.switch.ec = (d, G) => {
    const net = A.net(), groups = {}; d.ports.forEach(p => { const i = d.cfg.ifs[p]; if (i.cg) (groups[i.cg.n] = groups[i.cg.n] || []).push(p); });
    const ns = Object.keys(groups).map(Number).sort((a, b) => a - b), prot = m => ({ on: 'statisch (on)', active: 'LACP active', passive: 'LACP passive', desirable: 'PAgP desirable', auto: 'PAgP auto' }[m]);
    return `<div class="wg-row">${btn('Port-Channel erstellen', 'dlg', { k: 'ecnew' }, 'primary')}</div>` + tbl(['Port-Channel', 'Protokoll', 'Status', 'Mitglieder', 'Nachbar', ''], ns.map(n => { const b = A.NL.bundleOf(net, d, groups[n][0]), po = d.cfg.ifs['Port-channel' + n]; return [`<b>Po${n}</b> <small class="wg-mut">${po && po.mode === 'trunk' ? 'Trunk' : 'Access VLAN ' + (po ? po.vlan : 1)}</small>`, esc(prot(d.cfg.ifs[groups[n][0]].cg.mode)), b && b.ok ? chip('gebündelt', 'ok') : chip(b && b.partial ? 'unvollständig' : 'ausgesetzt', 'bad') + (b && b.reason ? `<br><small class="wg-mut">${esc(b.reason)}</small>` : ''), groups[n].map(p => esc(A.SH(p))).join(', '), b && b.peerDev ? esc(net.devs[b.peerDev].cfg.hostname) : '–', btn('Auflösen', 'ecdel', { n }, 'sm ghost bad')]; }), 'Noch kein Port-Channel. Mehrere Links zwischen zwei Switches ohne Bündelung blockiert das Spanning Tree bis auf einen.')
      + '<p class="wg-note">Ein EtherChannel fasst mehrere Kabel zu einem logischen Link zusammen: mehr Bandbreite und Ausfallsicherheit, und das Spanning Tree sieht nur einen Link. Beide Seiten müssen passende Modi haben (active mit active oder passive, oder beide <code>on</code>) und gleich konfigurierte Ports.</p>';
  };

  // ---------- Dynamisches Routing (OSPF, EIGRP, BGP) ----------
  PAGES.switch.rproto = PAGES.router.rproto = (d, G) => {
    if (d.type === 'switch' && !d.cfg.ipRouting) return '<p class="wg-empty">Dieser Switch routet nicht. Schalte unter „Layer 3“ zuerst <code>ip routing</code> ein, dann kannst du Routing-Protokolle nutzen.</p>';
    const net = A.net(), C = A.RTG.compute(net), tab = G.tab.rp || 'ospf', tabs = [['ospf', 'OSPF'], ['eigrp', 'EIGRP'], ['bgp', 'BGP']];
    const head = `<div class="wg-tabs" role="tablist">${tabs.map(x => `<button type="button" role="tab" class="${x[0] === tab ? 'act' : ''}" aria-selected="${x[0] === tab}" data-act="tab" data-t="rp" data-v="${x[0]}">${x[1]}</button>`).join('')}</div>`;
    const blk = k => A.blocks(d, 'router ' + k)[0], none = k => `<p class="wg-empty">${k.toUpperCase()} läuft auf diesem Gerät nicht.</p><div class="wg-row">${btn(k.toUpperCase() + ' starten', 'dlg', { k: 'rpstart', p: k }, 'primary')}</div>`;
    const netRows = (b, kind) => b.lines.filter(l => /^network /i.test(l)).map(l => { const t = l.split(/\s+/); return [`<b>${esc(t[1])}</b>`, kind === 'bgp' ? esc(t[3] || '') : esc(t[2] || '–'), kind === 'ospf' ? esc(t[4] || '') : '', btn('Entfernen', 'rpnetdel', { k: kind, l }, 'sm ghost bad')]; });
    if (tab === 'ospf') {
      const b = blk('ospf'); if (!b) return head + none('ospf'); const r = C.O[d.id], pid = b.head.split(' ')[2], dflt = b.lines.find(l => /^default-information/i.test(l));
      return head + `<div class="wg-row">${btn('Netz hinzufügen', 'dlg', { k: 'ospfnet', pid }, 'primary')}${btn(dflt ? 'Default-Route nicht mehr verteilen' : 'Default-Route verteilen', 'ospfdef', { pid, on: dflt ? 0 : 1 }, 'sm')}${btn('Prozess löschen', 'rpdel', { k: 'ospf', n: pid }, 'sm ghost bad')}</div>`
        + card(`OSPF ${esc(pid)} (Router-ID ${esc(r ? r.rid : '–')})`, tbl(['Netz', 'Wildcard-Maske', 'Area', ''], netRows(b, 'ospf'), 'Keine network-Anweisung. Ohne sie ist keine Schnittstelle in OSPF.'))
        + card('Schnittstellen in OSPF', tbl(['Schnittstelle', 'IP-Adresse', 'Area', 'Kosten', 'Rolle', ''], (r ? r.ifs : []).map(i => [`<b>${esc(A.SH(i.ifn))}</b>`, esc(i.ip + '/' + maskLen(i.mask)), i.area, i.cost, i.passive ? chip('passiv') : chip('aktiv', 'ok'), btn(i.passive ? 'Aktiv schalten' : 'Passiv schalten', 'rppass', { k: 'ospf', n: pid, i: i.ifn, on: i.passive ? 0 : 1 }, 'sm')]), 'Noch keine Schnittstelle in OSPF.'))
        + card('Nachbarn', tbl(['Router-ID', 'Adresse', 'Schnittstelle', 'Status'], (r ? r.adj : []).map(a => [`<b>${esc(a.host)}</b> <small class="wg-mut">${esc(a.rid)}</small>`, esc(a.ip), esc(A.SH(a.ifn)), chip('FULL', 'ok')]), 'Keine Nachbarn.') + (r && r.bad.length ? `<div class="wg-msg err">${r.bad.map(x => esc(`${A.SH(x.ifn)} zu ${x.peer}: ${x.why}`)).join('<br>')}</div>` : ''))
        + card('OSPF-Routen', showBox(d, 'show ip route ospf'));
    }
    if (tab === 'eigrp') {
      const b = blk('eigrp'); if (!b) return head + none('eigrp'); const r = C.E[d.id], as = b.head.split(' ')[2];
      return head + `<div class="wg-row">${btn('Netz hinzufügen', 'dlg', { k: 'eigrpnet', as }, 'primary')}${btn('Prozess löschen', 'rpdel', { k: 'eigrp', n: as }, 'sm ghost bad')}</div>`
        + card(`EIGRP AS ${esc(as)} (Router-ID ${esc(r ? r.rid : '–')})`, tbl(['Netz', 'Wildcard-Maske', '', ''], netRows(b, 'eigrp'), 'Keine network-Anweisung.'))
        + card('Schnittstellen in EIGRP', tbl(['Schnittstelle', 'IP-Adresse', 'Bandbreite (kbit/s)', 'Delay (10 µs)', 'Rolle', ''], (r ? r.ifs : []).map(i => [`<b>${esc(A.SH(i.ifn))}</b>`, esc(i.ip + '/' + maskLen(i.mask)), i.bw, i.delay, i.passive ? chip('passiv') : chip('aktiv', 'ok'), btn(i.passive ? 'Aktiv schalten' : 'Passiv schalten', 'rppass', { k: 'eigrp', n: as, i: i.ifn, on: i.passive ? 0 : 1 }, 'sm')]), 'Noch keine Schnittstelle in EIGRP.'))
        + card('Nachbarn', tbl(['Gerät', 'Adresse', 'Schnittstelle', 'Status'], (r ? r.adj : []).map(a => [`<b>${esc(a.host)}</b>`, esc(a.ip), esc(A.SH(a.ifn)), chip('Up', 'ok')]), 'Keine Nachbarn.') + (r && r.bad.length ? `<div class="wg-msg err">${r.bad.map(x => esc(`${A.SH(x.ifn)} zu ${x.peer}: ${x.why}`)).join('<br>')}</div>` : ''))
        + card('EIGRP-Routen', showBox(d, 'show ip route eigrp'));
    }
    const b = blk('bgp'); if (!b) return head + none('bgp'); const r = C.B[d.id], as = b.head.split(' ')[2];
    return head + `<div class="wg-row">${btn('Nachbar hinzufügen', 'dlg', { k: 'bgpnbr', as }, 'primary')}${btn('Netz ankündigen', 'dlg', { k: 'bgpnet', as }, 'sm')}${btn('Prozess löschen', 'rpdel', { k: 'bgp', n: as }, 'sm ghost bad')}</div>`
      + card(`BGP AS ${esc(as)} (Router-ID ${esc(r ? r.rid : '–')})`, tbl(['Nachbar', 'AS', 'Status', 'Hinweis', ''], (r ? r.peers : []).map(p => [`<b>${esc(p.ip)}</b>${p.ibgp ? ' <small class="wg-mut">iBGP</small>' : ' <small class="wg-mut">eBGP</small>'}`, p.as || '–', p.state === 'Established' ? chip('Established', 'ok') : chip(p.state, 'bad'), esc(p.why || ''), btn('Entfernen', 'bgpnbrdel', { as, ip: p.ip }, 'sm ghost bad')]), 'Kein Nachbar. Lege einen mit „Nachbar hinzufügen“ an.'))
      + card('Angekündigte Netze', tbl(['Netz', 'Maske', '', ''], netRows(b, 'bgp'), 'Keine. Ohne network-Anweisung kündigt der Router nichts an.') + '<p class="wg-note">Ein Netz wird nur angekündigt, wenn es exakt in der Routing-Tabelle steht (verbunden, statisch oder per IGP gelernt).</p>')
      + card('BGP-Tabelle', showBox(d, 'show ip bgp'));
  };

  // ---------- PoE und QoS ----------
  const poeCard = d => { const al = A.NL.poeAlloc(A.net(), d), rows = d.ports.filter(p => al.map[p]).map(p => { const a = al.map[p]; return [`<b>${esc(A.SH(p))}</b>`, esc(a.dev), a.state === 'on' ? chip('versorgt', 'ok') : a.state === 'deny' ? chip('Budget erschöpft', 'bad') : chip(a.state === 'never' ? 'PoE aus' : 'Port aus', 'bad'), a.state === 'on' ? a.w.toFixed(1) + ' W' : a.need ? 'braucht ' + a.need + ' W' : '–']; }); return card('PoE-Budget', `<p class="wg-big">${al.used.toFixed(1)}<small> von ${al.budget} W vergeben</small></p>${bar(al.used, al.budget, 90)}` + (rows.length ? tbl(['Port', 'Gerät', 'Status', 'Leistung'], rows) : '<p class="wg-note">Kein PoE-Gerät angeschlossen.</p>') + '<p class="wg-note">Der Switch vergibt sein Budget in Port-Reihenfolge, Ports mit <code>power inline port priority high</code> zuerst. Ist es leer, bleibt der nächste Port ohne Strom (power-deny).</p>'); };
  const qosLines = (d, pre) => A.blocks(d, pre);
  PAGES.switch.qos = PAGES.router.qos = (d, G) => {
    const on = d.cfg.lines.some(l => l.toLowerCase() === 'mls qos'), cms = qosLines(d, 'class-map'), pms = qosLines(d, 'policy-map'), sw = d.type === 'switch';
    const bound = d.ports.flatMap(p => (d.cfg.ifs[p].extra || []).filter(x => x.startsWith('service-policy ')).map(x => [p, x.split(' ')[1], x.split(' ')[2]]));
    return `<p class="wg-note">QoS bevorzugt wichtigen Verkehr (z. B. Sprache), wenn eine Leitung voll ist. Ablauf: Verkehr in einer <b>Class-Map</b> erkennen, in einer <b>Policy-Map</b> eine Behandlung festlegen und die Policy an eine Schnittstelle binden. Der Simulator prüft die Konfiguration, simuliert aber keinen Datenstau.</p>`
      + (sw ? card('QoS global', `<p>${on ? chip('aktiv (mls qos)', 'ok') : chip('aus')}</p><div class="wg-row">${btn(on ? 'QoS ausschalten' : 'QoS einschalten', 'qoson', { on: on ? 0 : 1 }, on ? '' : 'primary')}</div>`) : '')
      + card('Class-Maps (Verkehr erkennen)', `<div class="wg-row">${btn('Class-Map hinzufügen', 'dlg', { k: 'qcm' }, 'primary')}</div>` + tbl(['Name', 'Regel', 'Match', ''], cms.map(b => [`<b>${esc(b.head.split(' ')[2])}</b>`, esc(b.head.split(' ')[1]), `<code>${esc(b.lines.join('; ') || '–')}</code>`, btn('Löschen', 'qcmdel', { n: b.head.split(' ')[2] }, 'sm ghost bad')]), 'Noch keine Class-Map.'))
      + card('Policy-Maps (Behandlung festlegen)', `<div class="wg-row">${btn('Policy-Map hinzufügen', 'dlg', { k: 'qpm' }, 'primary' + (cms.length ? '' : ' disabled'))}${btn('Policy an Schnittstelle binden', 'dlg', { k: 'qbind' }, 'sm' + (pms.length ? '' : ' disabled'))}</div>` + tbl(['Name', 'Inhalt', ''], pms.map(b => [`<b>${esc(b.head.split(' ')[1])}</b>`, `<code>${esc(b.lines.join('; ') || '–')}</code>`, btn('Löschen', 'qpmdel', { n: b.head.split(' ')[1] }, 'sm ghost bad')]), cms.length ? 'Noch keine Policy-Map.' : 'Lege zuerst eine Class-Map an.'))
      + card('Gebundene Policies', tbl(['Schnittstelle', 'Richtung', 'Policy'], bound.map(([p, dir, nm]) => [`<b>${esc(A.SH(p))}</b>`, dir, esc(nm)]), 'Keine Policy gebunden. Eine Policy wirkt erst an einer Schnittstelle.'));
  };

  // ---------- Site-to-Site-VPN (IPsec mit IKEv2 über Tunnel-Schnittstellen) ----------
  PAGES.router.vpn = (d, G) => {
    const net = A.net(), tuns = Object.keys(d.cfg.ifs).filter(n => n.startsWith('Tunnel')), prof = A.blocks(d, 'crypto ipsec profile'), ik = A.blocks(d, 'crypto ikev2 profile');
    return `<p class="wg-note">Ein <b>Site-to-Site-VPN</b> verbindet zwei Standorte verschlüsselt über das Internet. Der Router baut dafür eine Tunnel-Schnittstelle zum Router der Gegenseite auf (IPsec mit IKEv2 und Pre-Shared Key). Beide Seiten brauchen passende Algorithmen und denselben Schlüssel, außerdem eine Route zum Netz der Gegenseite durch den Tunnel.</p>`
      + `<div class="wg-row">${btn('VPN-Assistent', 'dlg', { k: 'vpnnew' }, 'primary')}</div>`
      + card('Tunnel', tbl(['Tunnel', 'Eigene Adresse', 'Peer (Gegenstelle)', 'Modus', 'Status', ''], tuns.map(n => { const i = d.cfg.ifs[n], st = A.NL.tunnel(net, d.id, n); return [`<b>${esc(n)}</b>`, i.ip ? esc(i.ip + '/' + maskLen(i.mask)) : '–', esc(i.tdst || '–'), i.tmode === 'ipsec' ? 'IPsec (VTI)' : 'GRE', st.up ? chip('Up', 'ok') : chip('Down', 'bad') + `<br><small class="wg-mut">${esc(st.reason || '')}</small>`, btn('Löschen', 'vpndel', { n }, 'sm ghost bad')]; }), 'Noch kein Tunnel. Der Assistent legt Proposal, Keyring, Profile und Tunnel an.'))
      + card('Statische Routen durch den Tunnel', tbl(['Zielnetz', 'Maske', 'Über'], d.cfg.routes.filter(r => r.ifn && r.ifn.startsWith('Tunnel')).map(r => [`<b>${esc(r.net)}</b>`, esc(r.mask), esc(r.ifn)]), 'Keine. Ohne Route zum Netz der Gegenseite geht kein Verkehr durch den Tunnel.'))
      + card('Krypto-Bausteine', `<dl class="wg-dl"><dt>IKEv2-Profile</dt><dd>${ik.map(b => esc(b.head.split(' ')[3])).join(', ') || '–'}</dd><dt>IPsec-Profile</dt><dd>${prof.map(b => esc(b.head.split(' ')[3])).join(', ') || '–'}</dd></dl>`)
      + card('show crypto session', showBox(d, 'show crypto session'));
  };

  // ---------- Monitoring (Zabbix-ähnlich) ----------
  const spark = (vals, o = {}) => { const w = 360, h = 64, v = vals.filter(x => x !== null && x !== undefined); if (v.length < 2) return `<svg viewBox="0 0 ${w} ${h}" class="wg-spark" role="img" aria-label="Noch keine Daten"><text x="8" y="36" class="wg-sp-t">Noch keine Daten (alle 5 s ein Messwert)</text></svg>`; const mx = o.max || Math.max(...v, 1) * 1.15, n = vals.length, pts = vals.map((x, i) => x === null || x === undefined ? null : [(i / Math.max(1, n - 1) * (w - 4) + 2).toFixed(1), (h - 4 - (x / mx) * (h - 8)).toFixed(1)]); let d = '', pen = false; pts.forEach(p => { if (!p) { pen = false; return; } d += (pen ? 'L' : 'M') + p[0] + ' ' + p[1]; pen = true; }); return `<svg viewBox="0 0 ${w} ${h}" class="wg-spark" role="img" aria-label="Verlauf">${o.thr ? `<line x1="0" x2="${w}" y1="${(h - 4 - (o.thr / mx) * (h - 8)).toFixed(1)}" y2="${(h - 4 - (o.thr / mx) * (h - 8)).toFixed(1)}" class="wg-sp-thr"/>` : ''}<path d="${d}" class="wg-sp-l ${o.cls || ''}"/></svg>`; };
  const ago = t => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? s + ' s' : s < 3600 ? Math.floor(s / 60) + ' min ' + (s % 60) + ' s' : Math.floor(s / 3600) + ' h'; };
  const clock = t => new Date(t).toTimeString().slice(0, 8);
  const monSt = d => { const m = A.mon(); return m[d.id] || { hist: {}, probs: [], syslog: [] }; };
  PAGES.linux.mon = PAGES.hypervisor.mon = (d, G) => {
    const net = A.net(), M = A.MON, z = M.zbx(d), st = monSt(d), tab = G.tab.zm || 'dash', on = M.isMonitor(net, d), ip = (A.hip(d, d.ports.find(p => (A.hip(d, p) || {}).ip)) || {}).ip || '';
    const tabs = [['dash', 'Dashboard'], ['hosts', 'Hosts'], ['graph', 'Graphen'], ['prob', 'Probleme'], ['sys', 'Syslog'], ['setup', 'Einrichtung']];
    const head = `<div class="wg-tabs" role="tablist">${tabs.map(x => `<button type="button" role="tab" class="${x[0] === tab ? 'act' : ''}" aria-selected="${x[0] === tab}" data-act="tab" data-t="zm" data-v="${x[0]}">${x[1]}${x[0] === 'prob' && st.probs.some(p => !p.until) ? ` <span class="wg-cnt">${st.probs.filter(p => !p.until).length}</span>` : ''}</button>`).join('')}</div>` + (on ? '' : '<div class="wg-msg err">Der Dienst zabbix-server läuft nicht. Starte ihn unter „Dienste“, sonst werden keine Werte erfasst.</div>');
    const last = id => (st.hist[id] || []).slice(-1)[0], hostName = h => (net.devs[h.dev] || { cfg: { hostname: '?' } }).cfg.hostname;
    if (tab === 'dash') {
      const act = st.probs.filter(p => !p.until).sort((a, b) => b.sev - a.sev || b.since - a.since);
      return head + `<div class="wg-cards">${card('Hosts', `<p class="wg-big">${z.hosts.length}<small> überwacht</small></p><p class="wg-note">${z.hosts.filter(h => last(h.dev) && last(h.dev).up).length} erreichbar, ${z.hosts.filter(h => last(h.dev) && !last(h.dev).up).length} nicht erreichbar</p>`)}${card('Probleme', `<p class="wg-big ${act.length ? 'wg-bad' : ''}">${act.length}<small> aktiv</small></p>${btn('Zu den Problemen', 'tab', { t: 'zm', v: 'prob' }, 'sm')}`)}${card('Syslog', `<p class="wg-big">${st.syslog.length}<small> Meldungen</small></p>${btn('Zum Syslog', 'tab', { t: 'zm', v: 'sys' }, 'sm')}`)}</div>`
        + card('Verfügbarkeit der Hosts', z.hosts.length ? `<div class="wg-tiles">${z.hosts.map(h => { const l = last(h.dev), cls = !l ? 'na' : !l.up ? 'down' : l.snmp === false ? 'warn' : 'ok'; return `<div class="wg-tile ${cls}"><b>${esc(hostName(h))}</b><span>${!l ? 'wartet …' : !l.up ? 'nicht erreichbar' : l.rtt + ' ms'}</span></div>`; }).join('')}</div>` : '<p class="wg-empty">Noch keine Hosts. Unter „Hosts“ kannst du das Netz durchsuchen.</p>')
        + card('Aktive Probleme', act.length ? tbl(['Schwere', 'Host', 'Problem', 'Seit'], act.slice(0, 8).map(p => [chip(A.MON.SEV[p.sev], p.sev >= 3 ? 'bad' : ''), `<b>${esc(p.host)}</b>`, esc(p.text), ago(p.since)])) : '<p class="wg-empty">Keine Probleme. Alles ok.</p>');
    }
    if (tab === 'hosts') {
      return head + `<div class="wg-row">${btn('Host hinzufügen', 'dlg', { k: 'zhost' }, 'primary')}${btn('Netz durchsuchen', 'zdisc', null, '')}</div>` + tbl(['Host', 'IP-Adresse', 'ICMP', 'SNMP/Agent', 'CPU', 'Speicher', 'Verfügbarkeit', ''], z.hosts.map(h => { const l = last(h.dev), dev = net.devs[h.dev], ipd = dev ? M.devIp(dev) : '–'; return [`<b>${esc(hostName(h))}</b>`, esc(ipd || '–'), !l ? '…' : l.up ? chip(l.rtt + ' ms', 'ok') : chip('aus', 'bad'), !l || !l.up ? '–' : l.snmp === true ? chip('ok', 'ok') : l.snmp === false ? chip('keine Daten', 'bad') + `<br><small class="wg-mut">${esc(l.why)}</small>` : '<span class="wg-mut">nicht konfiguriert</span>', l && l.cpu !== null ? l.cpu + ' %' : '–', l && l.mem !== null ? l.mem + ' %' : '–', M.availability(st.hist[h.dev] || []) === null ? '–' : M.availability(st.hist[h.dev]) + ' %', `<div class="wg-row">${btn('Bearbeiten', 'dlg', { k: 'zhedit', h: h.dev }, 'sm')}${btn('Entfernen', 'zhdel', { h: h.dev }, 'sm ghost bad')}</div>`]; }), 'Noch keine Hosts.');
    }
    if (tab === 'graph') {
      const hs = z.hosts, cur = hs.find(h => h.dev === G.tab.zh) || hs[0]; if (!cur) return head + '<p class="wg-empty">Füge zuerst Hosts hinzu.</p>';
      const hi = st.hist[cur.dev] || [], col = k => hi.map(x => x[k]), lastv = k => { const v = col(k).filter(x => x !== null && x !== undefined); return v.length ? v[v.length - 1] : '–'; };
      return head + `<div class="wg-row end"><div class="wg-f"><label for="wf-zh">Host</label><select id="wf-zh" data-act="zhsel">${hs.map(h => `<option value="${esc(h.dev)}" ${h.dev === cur.dev ? 'selected' : ''}>${esc(hostName(h))}</option>`).join('')}</select></div></div>`
        + card(`Antwortzeit (ms): ${lastv('rtt')}`, spark(col('rtt'))) + card(`CPU-Auslastung (%): ${lastv('cpu')}`, spark(col('cpu'), { max: 100, thr: 90, cls: 'cpu' })) + card(`Speicher (%): ${lastv('mem')}`, spark(col('mem'), { max: 100 }))
        + (hi.some(x => x.disk !== null && x.disk !== undefined) ? card(`Festplatte (%): ${lastv('disk')}`, spark(col('disk'), { max: 100, thr: 90 })) : '') + card(`Verkehr eingehend (kbit/s): ${lastv('inK')}`, spark(col('inK'))) + card(`Verkehr ausgehend (kbit/s): ${lastv('outK')}`, spark(col('outK')));
    }
    if (tab === 'prob') {
      const all = st.probs.slice().sort((a, b) => (a.until ? 1 : 0) - (b.until ? 1 : 0) || b.since - a.since);
      return head + tbl(['Status', 'Schwere', 'Host', 'Problem', 'Seit', 'Dauer'], all.slice(0, 40).map(p => [p.until ? chip('gelöst', 'ok') : chip('aktiv', 'bad'), A.MON.SEV[p.sev], `<b>${esc(p.host)}</b>`, esc(p.text), clock(p.since), p.until ? Math.max(1, Math.round((p.until - p.since) / 1000)) + ' s' : ago(p.since)]), 'Keine Probleme aufgezeichnet.') + '<p class="wg-note">Ein Problem entsteht, wenn ein Trigger zutrifft (z. B. Host zweimal hintereinander nicht erreichbar, CPU dreimal über 90 %). Es wird gelöst, sobald der Wert wieder normal ist.</p>';
    }
    if (tab === 'sys') {
      const flt = G.tab.zsh || '', hostsS = [...new Set(st.syslog.map(x => x.host))].sort(), rows = st.syslog.filter(x => !flt || x.host === flt).slice(-60).reverse(), sevc = s2 => s2 <= 3 ? 'bad' : s2 === 4 ? '' : 'ok';
      const rs = d.lx && d.lx.units.rsyslog && d.lx.units.rsyslog.active;
      return head + `<div class="wg-row end"><div class="wg-f"><label for="wf-zsh">Host filtern</label><select id="wf-zsh" data-act="zsh"><option value="">Alle</option>${hostsS.map(h => `<option ${h === flt ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></div></div>` + (rs ? '' : '<div class="wg-msg err">rsyslog läuft auf diesem Server nicht: Es werden keine Syslog-Meldungen angenommen.</div>')
        + tbl(['Zeit', 'Host', 'Schwere', 'Meldung'], rows.map(x => [clock(x.t), `<b>${esc(x.host)}</b>`, chip(['Notfall', 'Alarm', 'Kritisch', 'Fehler', 'Warnung', 'Hinweis', 'Info', 'Debug'][x.sev] || 'Info', sevc(x.sev)), `<code>${esc(x.text)}</code>`]), `Noch keine Meldungen. Konfiguriere auf den Geräten <code>logging host ${esc(ip || '<IP dieses Servers>')}</code> und löse ein Ereignis aus (z. B. Kabel ziehen).`);
    }
    const ndev = Object.values(net.devs).filter(x => !A.NL.isHost(x) && x.type !== 'fc');
    return head + `<p class="wg-note">So bindest du Geräte an: Der Server fragt sie per <b>ICMP</b> (Ping) und <b>SNMP</b> ab und empfängt <b>Syslog</b>-Meldungen. Server brauchen für CPU, Speicher und Platte den <b>Zabbix-Agent</b>.</p>`
      + card('Netzwerkgeräte', tbl(['Gerät', 'SNMP', 'Syslog an diesen Server'], ndev.map(x => { const cs = M.communities(x), sl = x.cfg.lines.some(l => new RegExp('^logging (host )?' + ip.replace(/\./g, '\\.')).test(l)); return [`<b>${esc(x.cfg.hostname)}</b>`, cs.length ? chip('Community ' + cs[0], 'ok') : chip('nicht konfiguriert', 'bad'), sl ? chip('ja', 'ok') : chip('nein', 'bad')]; }), 'Keine Switches oder Router im Plan.') + `<p class="wg-note">Auf einem Cisco-Gerät: <code>snmp-server community public RO</code> und <code>logging host ${esc(ip || '<IP dieses Servers>')}</code>.</p>`)
      + card('Dieser Server', `<dl class="wg-dl"><dt>zabbix-server</dt><dd>${on ? chip('läuft', 'ok') : chip('gestoppt', 'bad')}</dd><dt>rsyslog (Syslog-Empfang)</dt><dd>${d.lx.units.rsyslog && d.lx.units.rsyslog.active ? chip('läuft', 'ok') : chip('gestoppt', 'bad')}</dd><dt>IP-Adresse</dt><dd>${esc(ip || '–')}</dd></dl>`);
  };

  // ---------- Backup und Restore ----------
  PAGES.linux.bkp = PAGES.hypervisor.bkp = (d, G) => {
    const net = A.net(), B = A.BKP, S = B.st(d), tab = G.tab.bk || 'jobs', on = B.isBackup(net, d), used = B.usedMb(d), nm = id => (net.devs[id] || { cfg: { hostname: '(gelöscht)' } }).cfg.hostname, jn = id => (S.jobs.find(j => j.id === id) || { name: '–' }).name, day = net.day || 0;
    const tabs = [['jobs', 'Jobs'], ['store', 'Sicherungen'], ['log', 'Protokoll']];
    const head = `<div class="wg-tabs" role="tablist">${tabs.map(x => `<button type="button" role="tab" class="${x[0] === tab ? 'act' : ''}" aria-selected="${x[0] === tab}" data-act="tab" data-t="bk" data-v="${x[0]}">${x[1]}</button>`).join('')}</div>` + (on ? '' : '<div class="wg-msg err">Der Dienst backup-server läuft nicht. Starte ihn unter „Dienste“.</div>');
    const top = card('Zeit und Speicher', `<div class="wg-row"><b>Heute: ${B.dateOf(day)}</b>${btn('+1 Tag', 'bkday', { n: 1 }, 'sm')}${btn('+7 Tage', 'bkday', { n: 7 }, 'sm')}<span class="wg-note">Mit jedem Tag laufen alle Jobs einmal (Zeitplan: täglich).</span></div><p>Belegt: <b>${used} von ${S.quotaMb} MB</b></p>${bar(used, S.quotaMb, 85)}`);
    if (tab === 'jobs') return head + top + `<div class="wg-row">${btn('Job hinzufügen', 'dlg', { k: 'bkjob' }, 'primary')}</div>` + tbl(['Job', 'Quelle', 'Art', 'Aufbewahrung', 'Letzte Sicherung', 'Restore-Test', ''], S.jobs.map(j => { const s0 = net.devs[j.src], l = j.last; return [`<b>${esc(j.name)}</b>`, esc(nm(j.src)), esc(s0 ? B.KIND[B.kindOf(s0)] : '–'), `${j.keep} Sicherungen`, l ? (l.ok ? chip(B.dateOf(l.day) + ' ok', 'ok') : chip('fehlgeschlagen', 'bad') + `<br><small class="wg-mut">${esc(l.msg)}</small>`) : '<span class="wg-mut">noch nie</span>', j.tested !== null ? chip('bestanden ' + B.dateOf(j.tested), 'ok') : chip('nie getestet', 'bad'), `<div class="wg-row">${btn('Jetzt sichern', 'bkrun', { j: j.id }, 'sm primary')}${btn('Löschen', 'bkjdel', { j: j.id }, 'sm ghost bad')}</div>`]; }), 'Noch kein Job. Lege einen an und wähle das Gerät, das gesichert werden soll.') + '<p class="wg-note">Eine Sicherung ist erst etwas wert, wenn du die Wiederherstellung getestet hast. Mache unter „Sicherungen“ einen Restore-Test.</p>';
    if (tab === 'store') return head + tbl(['Datum', 'Job', 'Quelle', 'Größe', ''], S.store.slice().sort((a, b) => b.day - a.day || b.id - a.id).map(b => [B.dateOf(b.day), `<b>${esc(jn(b.job))}</b>`, esc(nm(b.src)), b.size + ' MB', `<div class="wg-row">${btn('Restore-Test', 'bktest', { b: b.id }, 'sm')}${btn('Wiederherstellen', 'bkrestore', { b: b.id }, 'sm')}${btn('Löschen', 'bkdel', { b: b.id }, 'sm ghost bad')}</div>`]), 'Noch keine Sicherung. Starte einen Job oder lass einen Tag vergehen.') + '<p class="wg-note">„Wiederherstellen“ überschreibt den aktuellen Stand des Geräts mit dem Stand der Sicherung. Dienste lesen Konfigurationsdateien erst beim Neustart.</p>';
    return head + tbl(['Datum', 'Job', 'Ergebnis'], S.log.slice(-40).reverse().map(l => [B.dateOf(l.day), `<b>${esc(l.job)}</b>`, l.ok ? chip('ok', 'ok') + ' ' + esc(l.msg) : chip('Fehler', 'bad') + ' ' + esc(l.msg)]), 'Noch keine Einträge.');
  };

  // ---------- Dialoge ----------
  function dlgHtml(d, G) {
    const x = G.dlg, k = x.k, net = A.net(), wrap = (t, body, ok, okLbl) => `<div class="wg-ov" data-act="dlgbg"><form class="wg-dlg" role="dialog" aria-modal="true" aria-label="${esc(t)}" data-act="dlgok"><h2>${t}</h2>${body}<div class="wg-row end">${btn('Abbrechen', 'dlgx', null, 'ghost')}${ok === false ? '' : `<button type="submit" class="wg-b primary" data-act="dlgok">${okLbl || 'OK'}</button>`}</div></form></div>`;
    const servers = Object.values(net.devs).filter(s => s.type === 'server' && !A.isCloud(s));
    switch (k) {
      case 'fwif': { const i = d.cfg.ifs[x.p]; return wrap(`Schnittstelle ${esc(A.SH(x.p))}`, `<div class="wg-2">${field('nif', 'Zone (nameif)', i.nameif || '', { ph: 'inside' })}${field('sl', 'Security-Level (0–100)', i.sl === null ? '' : i.sl, { type: 'number', min: 0, max: 100 })}</div><div class="wg-2">${field('ip', 'IP-Adresse', i.ip || '', { ph: '10.0.0.1' })}${field('mask', 'Subnetzmaske', i.mask || '255.255.255.0')}</div>` + sel('st', 'Status', [['up', 'aktiv'], ['down', 'abgeschaltet']], i.shutdown ? 'down' : 'up'), true, 'Speichern'); }
      case 'fwrule': return wrap('Regel hinzufügen', `<div class="wg-2">${field('acl', 'Regelliste', Object.keys(d.cfg.acls)[0] || 'INSIDE_IN')}${sel('act', 'Aktion', [['permit', 'erlauben'], ['deny', 'blockieren']])}</div><div class="wg-2">${sel('proto', 'Protokoll', [['ip', 'ip (alles)'], ['icmp', 'icmp'], ['tcp', 'tcp'], ['udp', 'udp']])}${field('port', 'Zielport', '', { ph: '80 oder www' })}</div>` + field('src', 'Quelle', 'any', { hint: 'any, host 10.0.0.5 oder 10.0.0.0 255.255.255.0' }) + field('dst', 'Ziel', 'any'), true, 'Hinzufügen');
      case 'fwbind': return wrap('Regelliste an Zone binden', sel('acl', 'Regelliste', Object.keys(d.cfg.acls).map(a => [a, a])) + sel('z', 'Zone (eingehend)', Object.values(d.cfg.ifs).filter(i => i.nameif).map(i => [i.nameif, i.nameif])), true, 'Binden');
      case 'fwnat': { const z = Object.values(d.cfg.ifs).filter(i => i.nameif).map(i => [i.nameif, i.nameif]); return wrap('NAT-Regel (dynamisches PAT)', sel('from', 'Von Zone (intern)', z, 'inside') + sel('to', 'Nach Zone (extern)', z, 'outside'), z.length > 1, 'Hinzufügen'); }
      case 'fwroute': return wrap('Statische Route', sel('z', 'Über Zone', Object.values(d.cfg.ifs).filter(i => i.nameif).map(i => [i.nameif, i.nameif]), 'outside') + `<div class="wg-2">${field('net', 'Zielnetz', '0.0.0.0')}${field('mask', 'Subnetzmaske', '0.0.0.0')}</div>` + field('gw', 'Gateway', '', { ph: '203.0.113.1' }), true, 'Hinzufügen');
      case 'dpool': return wrap('DHCP-Pool hinzufügen', field('n', 'Name', '', { ph: 'CLIENTS' }) + `<div class="wg-2">${field('net', 'Netz', '', { ph: '10.30.0.0' })}${field('mask', 'Subnetzmaske', '255.255.255.0')}</div><div class="wg-2">${field('gw', 'Default-Router', '', { ph: '10.30.0.1' })}${field('dns', 'DNS-Server', '', { ph: '10.10.0.53' })}</div>`, true, 'Anlegen');
      case 'dexcl': return wrap('Adressen ausschließen', `<div class="wg-2">${field('a', 'Von', '', { ph: '10.30.0.1' })}${field('b', 'Bis (optional)', '', { ph: '10.30.0.20' })}</div>`, true, 'Ausschließen');
      case 'dhelp': return wrap(`Relay auf ${esc(A.SH(x.n))}`, field('h', 'DHCP-Server (leer = kein Relay)', d.cfg.ifs[x.n].helper || '', { ph: '10.10.0.11' }), true, 'Speichern');
      case 'fwdhcp': { const i = d.cfg.ifs[x.n], q = (d.cfg.dhcpd && d.cfg.dhcpd.pools[i.nameif]) || {}; return wrap(`DHCP-Server auf ${esc(i.nameif)}`, `<div class="wg-2">${field('s', 'Erste Adresse', q.start || '', { ph: '10.255.0.100' })}${field('e', 'Letzte Adresse', q.end || '', { ph: '10.255.0.150' })}</div>` + field('dns', 'DNS-Server für Clients', (d.cfg.dhcpd && d.cfg.dhcpd.dns) || '') + sel('on', 'Status', [['1', 'aktiviert'], ['0', 'aus']], q.on ? '1' : '0'), true, 'Anwenden'); }
      case 'hmnew': { const others = Object.values(net.devs).filter(y => y.type === 'storage' && y.id !== d.id), fcn = y => y.ports.filter(p => y.pk[p] === 'fc').length, srvs = Object.values(net.devs).filter(y => y.type === 'server' && !A.isCloud(y) && !y.vm).sort((a, b) => fcn(a) - fcn(b)); return wrap('HyperMetro-Domäne erstellen', field('n', 'Name der Domäne', 'DOM1') + sel('peer', 'Partner-Array', others.map(y => [y.id, y.cfg.hostname])) + sel('q', 'Quorum-Server (dritter Standort)', srvs.map(y => [y.id, y.cfg.hostname + (S0().ipOf(y) ? ' (' + S0().ipOf(y) + ')' : '')])) + sel('pref', 'Bevorzugter Standort', [['local', d.cfg.hostname + ' (dieses Array)'], ['remote', 'Partner-Array']], 'local', 'Bei einer Trennung gewinnt dieser Standort, wenn beide den Quorum-Server erreichen.') + `<label class="wg-ck2"><input type="checkbox" id="wf-sf" checked> Statische Priorität als Fallback, wenn der Quorum-Server nicht erreichbar ist</label>`, true, 'Erstellen'); }
      case 'hmset': { const dm = S0().hm(d), b = net.devs[dm.peer], srvs = Object.values(net.devs).filter(y => y.type === 'server' && !A.isCloud(y) && !y.vm); return wrap('Domäne bearbeiten', sel('pref', 'Bevorzugter Standort', [[d.id, d.cfg.hostname], [b.id, b.cfg.hostname]], dm.preferred) + sel('q', 'Quorum-Server', srvs.map(y => [y.id, y.cfg.hostname]), dm.quorum) + `<label class="wg-ck2"><input type="checkbox" id="wf-sf" ${dm.staticFallback ? 'checked' : ''}> Statische Priorität als Fallback</label>`, true, 'Speichern'); }
      case 'hmpair': { const dm = S0().hm(d), b = net.devs[dm.peer], free = S0().st(d).luns.filter(l => !l.hm); return wrap('HyperMetro-Paar erstellen', free.length ? sel('lun', 'LUN auf diesem Array', free.map(l => [l.id, `${l.name} (${gb(l.gb)})`])) + sel('pool', `Pool auf ${esc(b.cfg.hostname)} für die Partner-LUN`, S0().st(b).pools.map(p => [p.name, `${p.name} (${gb(S0().poolInfo(b, p).free)} frei)`]), '', 'Die Partner-LUN bekommt dieselbe Größe und dieselbe Host-Zuordnung.') : '<p class="wg-empty">Lege zuerst eine LUN an, die gespiegelt werden soll.</p>', free.length > 0, 'Paar erstellen'); }
      case 'ssid': { const L = ssidList(d), cur = x.i === '' ? null : L[+x.i] || null; return wrap(cur ? `SSID ${esc(cur.name)}` : (d.type === 'wlc' ? 'WLAN hinzufügen' : 'SSID hinzufügen'), field('n', 'Name der SSID', cur ? cur.name : '', { ph: 'Firma-WLAN' }) + sel('sec', 'Sicherheit', [['wpa2', 'WPA2-PSK'], ['wpa3', 'WPA3-SAE'], ['open', 'Offen (ohne Passwort)']], cur ? cur.sec : 'wpa2') + field('psk', 'WLAN-Schlüssel (8 bis 63 Zeichen)', cur ? cur.psk : '', { hint: 'Wird bei „Offen“ ignoriert.' }) + field('vlan', 'VLAN (0 = nativ/untagged)', cur ? cur.vlan || 0 : 0, { type: 'number', min: 0, max: 4094 }), true, 'Speichern'); }
      case 'apnet': { const h = hostLn(d); return wrap('IP-Konfiguration', field('ip', 'IP-Adresse', h.ip || '', { ph: '10.0.0.60' }) + field('len', 'Präfixlänge', h.mask ? maskLen(h.mask) : 24, { type: 'number', min: 1, max: 30 }) + field('gw', 'Gateway', d.cfg.gw || '', { ph: '10.0.0.1' }), true, 'Speichern'); }
      case 'ecnew': { const used = new Set(d.ports.filter(p => d.cfg.ifs[p].cg).map(p => d.cfg.ifs[p].cg.n)); let n = 1; while (used.has(n)) n++; const ps = d.ports.filter(p => A.NL.peerOfPort(net, d.id, p) && !d.cfg.ifs[p].cg); return wrap('Port-Channel erstellen', `<div class="wg-2">${field('n', 'Nummer', n, { type: 'number', min: 1, max: 64 })}${sel('md', 'Modus', [['active', 'LACP active (empfohlen)'], ['passive', 'LACP passive'], ['on', 'statisch (on)'], ['desirable', 'PAgP desirable'], ['auto', 'PAgP auto']], 'active')}</div><div class="wg-f"><label>Mitglieder (Ports mit Kabel)</label>${ps.length ? ps.map(p => `<label class="wg-ck2"><input type="checkbox" data-ecp="${esc(p)}"> ${esc(A.SH(p))} → ${esc(net.devs[A.NL.peerOfPort(net, d.id, p).dev].cfg.hostname)}</label>`).join('') : '<small>Keine freien Ports mit Kabel.</small>'}</div><label class="wg-ck2"><input type="checkbox" id="wf-trunk" checked> Als Trunk konfigurieren</label>`, ps.length > 1, 'Erstellen'); }
      case 'rpstart': return wrap(x.p === 'bgp' ? 'BGP starten' : x.p.toUpperCase() + ' starten', field('n', x.p === 'bgp' ? 'Eigene AS-Nummer' : x.p === 'eigrp' ? 'AS-Nummer (muss bei allen Nachbarn gleich sein)' : 'Prozess-ID', x.p === 'bgp' ? 65001 : x.p === 'eigrp' ? 100 : 1, { type: 'number', min: 1 }), true, 'Starten');
      case 'ospfnet': return wrap('OSPF-Netz hinzufügen', `<div class="wg-2">${field('net', 'Netz', '', { ph: '10.0.0.0' })}${field('wc', 'Wildcard-Maske', '0.0.0.255')}</div>` + field('area', 'Area', 0, { type: 'number', min: 0 }), true, 'Hinzufügen');
      case 'eigrpnet': return wrap('EIGRP-Netz hinzufügen', `<div class="wg-2">${field('net', 'Netz', '', { ph: '10.0.0.0' })}${field('wc', 'Wildcard-Maske', '0.0.0.255')}</div>`, true, 'Hinzufügen');
      case 'bgpnbr': return wrap('BGP-Nachbar hinzufügen', `<div class="wg-2">${field('ip', 'IP-Adresse des Nachbarn', '', { ph: '10.12.0.2' })}${field('as', 'AS des Nachbarn', '', { type: 'number', min: 1 })}</div><label class="wg-ck2"><input type="checkbox" id="wf-nhs"> next-hop-self (für iBGP-Nachbarn)</label><label class="wg-ck2"><input type="checkbox" id="wf-defo"> Default-Route an den Nachbarn senden</label>`, true, 'Hinzufügen');
      case 'bgpnet': return wrap('Netz ankündigen', `<div class="wg-2">${field('net', 'Netz', '', { ph: '10.1.0.0' })}${field('mask', 'Subnetzmaske', '255.255.255.0')}</div>`, true, 'Ankündigen');
      case 'qcm': return wrap('Class-Map hinzufügen', field('n', 'Name', 'VOICE') + sel('m', 'Match', [['dscp ef', 'DSCP EF (Sprache)'], ['dscp af41', 'DSCP AF41 (Video)'], ['dscp af21', 'DSCP AF21 (Daten, wichtig)'], ['dscp cs1', 'DSCP CS1 (Scavenger)'], ['protocol http', 'Protokoll HTTP'], ['any', 'Alles']]), true, 'Anlegen');
      case 'qpm': { const cms = A.blocks(d, 'class-map'); return wrap('Policy-Map hinzufügen', field('n', 'Name', 'QOS-POLICY') + sel('c', 'Class-Map', cms.map(b => [b.head.split(' ')[2], b.head.split(' ')[2]])) + `<div class="wg-2">${sel('a', 'Behandlung', [['priority percent', 'Strikte Priorität (Sprache)'], ['bandwidth percent', 'Garantierte Bandbreite']])}${field('pc', 'Prozent der Leitung', 30, { type: 'number', min: 1, max: 100 })}</div>`, true, 'Anlegen'); }
      case 'qbind': return wrap('Policy an Schnittstelle binden', sel('p', 'Policy-Map', A.blocks(d, 'policy-map').map(b => [b.head.split(' ')[1], b.head.split(' ')[1]])) + sel('i', 'Schnittstelle', d.ports.map(p => [p, A.SH(p)])) + sel('dir', 'Richtung', [['output', 'ausgehend (output)'], ['input', 'eingehend (input)']]), true, 'Binden');
      case 'vpnnew': { const ifs = Object.keys(d.cfg.ifs).filter(n => d.cfg.ifs[n].ip && !n.startsWith('Tunnel')); const used = new Set(Object.keys(d.cfg.ifs).filter(n => n.startsWith('Tunnel')).map(n => +n.slice(6))); let t = 0; while (used.has(t)) t++; return wrap('VPN-Assistent', `<div class="wg-2">${field('tn', 'Tunnel-Nummer', t, { type: 'number', min: 0 })}${sel('wan', 'WAN-Schnittstelle (Quelle)', ifs.map(n => [n, `${A.SH(n)} (${d.cfg.ifs[n].ip})`]))}</div>` + field('peer', 'WAN-Adresse der Gegenstelle', '', { ph: '198.51.100.1' }) + `<div class="wg-2">${field('tip', 'Tunnel-Adresse (eigene, /30)', '', { ph: '172.16.0.1' })}${field('psk', 'Pre-Shared Key', 'Vpn!Lab2026')}</div><div class="wg-2">${field('rnet', 'Netz der Gegenseite', '', { ph: '10.2.0.0' })}${field('rmask', 'Maske', '255.255.255.0')}</div><h4>Algorithmen (müssen auf beiden Seiten gleich sein)</h4><div class="wg-2">${sel('enc', 'Verschlüsselung', [['aes-cbc-256', 'AES-256'], ['aes-cbc-128', 'AES-128']])}${sel('int', 'Integrität', [['sha256', 'SHA-256'], ['sha1', 'SHA-1']])}</div>${sel('grp', 'DH-Gruppe', [['14', 'Gruppe 14 (2048 Bit)'], ['19', 'Gruppe 19 (ECP-256)'], ['5', 'Gruppe 5 (1536 Bit, veraltet)']])}`, ifs.length > 0, 'Einrichten'); }
      case 'zhost': { const z = A.MON.zbx(d), cand = Object.values(net.devs).filter(y => y.id !== d.id && !y.vm && !(y.model && A.NL.MODELS[y.model] && A.NL.MODELS[y.model].cloud) && A.MON.devIp(y) && !z.hosts.some(h => h.dev === y.id)); return wrap('Host hinzufügen', cand.length ? sel('dev', 'Gerät', cand.map(y => [y.id, `${y.cfg.hostname} (${A.MON.devIp(y)})`])) + field('snmp', 'SNMP-Community (leer = nur Ping)', 'public') + `<label class="wg-ck2"><input type="checkbox" id="wf-agent" checked> Zabbix-Agent abfragen (nur Server)</label>` : '<p class="wg-empty">Alle Geräte mit IP-Adresse werden schon überwacht.</p>', cand.length > 0, 'Hinzufügen'); }
      case 'zhedit': { const h = A.MON.zbx(d).hosts.find(y => y.dev === x.h); return wrap('Host bearbeiten', field('snmp', 'SNMP-Community (leer = nur Ping)', h.snmp) + `<label class="wg-ck2"><input type="checkbox" id="wf-agent" ${h.agent ? 'checked' : ''}> Zabbix-Agent abfragen</label>`, true, 'Speichern'); }
      case 'bkjob': { const cand = Object.values(net.devs).filter(y => y.id !== d.id && !y.vm && A.BKP.kindOf(y) !== 'other' && !(y.model && A.NL.MODELS[y.model] && A.NL.MODELS[y.model].cloud)); return wrap('Backup-Job hinzufügen', field('n', 'Name', '') + sel('src', 'Quelle', cand.map(y => [y.id, `${y.cfg.hostname} – ${A.BKP.KIND[A.BKP.kindOf(y)]}`])) + field('keep', 'Aufbewahrung (Anzahl Sicherungen)', 7, { type: 'number', min: 1, max: 60 }), cand.length > 0, 'Anlegen'); }
      case 'ifedit': {
        const ps = x.p === '*' ? (G.isel || []) : [x.p], one = ps.length === 1 ? d.cfg.ifs[ps[0]] : null, sw = d.type === 'switch', U = one ? '' : [['', '– unverändert –']];
        const vl = Object.keys(d.cfg.vlans || {}).map(Number).sort((a, b) => a - b).map(n => [n, `${n} – ${d.cfg.vlans[n]}`]);
        if (!ps.length) return wrap('Schnittstellen bearbeiten', '<p class="wg-empty">Wähle zuerst Schnittstellen in der Tabelle aus.</p>', false);
        return wrap(one ? `Schnittstelle ${esc(A.SH(ps[0]))}` : `${ps.length} Schnittstellen bearbeiten`,
          (one ? field('desc', 'Beschreibung', one.desc || '', { ph: 'z. B. Uplink zu SW2' }) : '')
          + sel('st', 'Status', (one ? [] : [['', '– unverändert –']]).concat([['up', 'aktiv (no shutdown)'], ['down', 'abgeschaltet (shutdown)']]), one ? (one.shutdown ? 'down' : 'up') : '')
          + (sw && A.NL.MODELS[d.model] && A.NL.MODELS[d.model].poe ? sel('poe', 'PoE', (one ? [] : [['', '– unverändert –']]).concat([['auto', 'automatisch (Standard)'], ['never', 'aus (power inline never)'], ['high', 'automatisch, hohe Priorität']]), one ? ((one.extra || []).includes('power inline never') ? 'never' : (one.extra || []).includes('power inline port priority high') ? 'high' : 'auto') : '') : '') + (sw ? sel('mode', 'Modus', (one ? [] : [['', '– unverändert –']]).concat([['access', 'Access'], ['trunk', 'Trunk']]), one ? one.mode : '') + sel('vlan', 'Access-VLAN', (one ? [] : [['', '– unverändert –']]).concat(vl), one ? one.vlan : '', 'Gilt im Modus Access.') + `<div class="wg-2">${field('nat', 'Native VLAN (Trunk)', one ? one.native : '', { type: 'number', min: 1, max: 4094 })}${field('allow', 'Erlaubte VLANs (Trunk)', one ? (one.allowed === null ? 'all' : vlStr(one.allowed)) : '', { ph: 'all oder 10,20,30', hint: 'all, none oder Liste' })}</div>`
            : (one ? `<div class="wg-2">${field('ip', 'IP-Adresse', one.ip || '', { ph: '10.0.0.1' })}${field('mask', 'Subnetzmaske', one.mask || '', { ph: '255.255.255.0' })}</div>` : '')), true, 'Übernehmen');
      }
      case 'newvlan': return wrap('VLAN hinzufügen', `<div class="wg-2">${field('id', 'VLAN-ID', '', { type: 'number', min: 2, max: 4094, ph: '10' })}${field('n', 'Name', '', { ph: 'Verkauf' })}</div>`, true, 'Hinzufügen');
      case 'vlname': return wrap(`VLAN ${esc(x.v)} umbenennen`, field('n', 'Name', d.cfg.vlans[x.v] || ''), true, 'Speichern');
      case 'newsvi': return wrap('SVI hinzufügen', field('id', 'VLAN-ID', '', { type: 'number', min: 1, max: 4094, ph: '10' }) + `<div class="wg-2">${field('ip', 'IP-Adresse', '', { ph: '192.168.10.1' })}${field('mask', 'Subnetzmaske', '255.255.255.0')}</div>`, true, 'Anlegen');
      case 'editsvi': { const i = d.cfg.ifs[x.n]; return wrap(esc(x.n), `<div class="wg-2">${field('ip', 'IP-Adresse', i.ip || '')}${field('mask', 'Subnetzmaske', i.mask || '255.255.255.0')}</div>` + sel('st', 'Status', [['up', 'aktiv'], ['down', 'abgeschaltet']], i.shutdown ? 'down' : 'up'), true, 'Speichern'); }
      case 'newroute': return wrap('Statische Route', `<div class="wg-2">${field('net', 'Zielnetz', '', { ph: '10.2.0.0' })}${field('mask', 'Subnetzmaske', '255.255.255.0')}</div>` + field('nh', 'Next Hop (IP-Adresse)', '', { ph: '10.0.0.2' }), true, 'Hinzufügen');
      case 'newace': return wrap('ACL-Regel hinzufügen', `<div class="wg-2">${field('acl', 'ACL-Nummer oder Name', Object.keys(d.cfg.acls)[0] || '100', { hint: '1–99 Standard, 100–199 erweitert' })}${sel('act', 'Aktion', [['permit', 'permit (erlauben)'], ['deny', 'deny (verwerfen)']])}</div>` + `<div class="wg-2">${sel('proto', 'Protokoll', [['ip', 'ip (alles)'], ['icmp', 'icmp'], ['tcp', 'tcp'], ['udp', 'udp']])}${field('port', 'Zielport (tcp/udp)', '', { ph: '80 oder www' })}</div>` + field('src', 'Quelle', 'any', { hint: 'any, host 10.0.0.5 oder 10.0.0.0 0.0.0.255' }) + field('dst', 'Ziel', 'any'), true, 'Hinzufügen');
      case 'aclbind': return wrap('ACL an Schnittstelle binden', sel('acl', 'ACL', Object.keys(d.cfg.acls).map(a => [a, a])) + sel('if', 'Schnittstelle', Object.keys(d.cfg.ifs).filter(n => !(d.type === 'switch' && !n.startsWith('Vlan') && !d.cfg.ipRouting && false)).map(n => [n, A.SH(n)])) + sel('dir', 'Richtung', [['in', 'in (eingehend)'], ['out', 'out (ausgehend)']]), true, 'Binden');
      case 'host': return wrap('Hostname ändern', field('h', 'Neuer Hostname', d.cfg.hostname), true, 'Ändern');
      case 'net': { const i = ifaces(d).find(y => y.lin === x.i) || {}; return wrap(`Schnittstelle ${esc(x.i)}`, field('ip', 'IPv4-Adresse', i.ip || '', { ph: '10.0.0.10' }) + field('len', 'Präfixlänge', i.mask ? maskLen(i.mask) : 24, { type: 'number', min: 1, max: 32 }), true, 'Übernehmen'); }
      case 'gw': return wrap('Gateway und DNS', field('gw', 'Standard-Gateway', d.cfg.gw || '', { ph: '10.0.0.1' }) + field('dns', 'DNS-Server', d.cfg.dns || '', { ph: '10.0.0.10' }), true, 'Übernehmen');
      case 'log': return wrap(`Protokoll: ${esc(x.u)}`, `<pre class="wg-pre">${esc(A.LX.logLines(d, x.u, 12).join('\n') || 'Keine Einträge.')}</pre>`, false);
      case 'newfile': return wrap('Neue Datei', field('path', 'Pfad', '/home/admin/notizen2.txt'), true, 'Anlegen');
      case 'mkfs': case 'mount': { const bi = A.LX.blockInfo(A.ctx(), d); return wrap(k === 'mkfs' ? 'Dateisystem anlegen' : 'Einbinden', sel('dev', 'Gerät', bi.map(b => [b.dev, `${b.name} (${gb(b.gb)}) ${b.dev}`]), bi[0] && bi[0].dev, bi.some(b => b.multipath) ? 'Mit Multipath nimmst du das Multipath-Gerät, nie einen einzelnen Pfad.' : '') + (k === 'mkfs' ? sel('fs', 'Dateisystem', [['ext4', 'ext4'], ['xfs', 'xfs']], 'ext4') : field('mp', 'Einhängepunkt', '/data')), true, k === 'mkfs' ? 'Formatieren' : 'Einbinden'); }
      case 'allow': return wrap('Port freigeben', field('port', 'Port', '', { ph: 'z. B. 80', type: 'number', min: 1, max: 65535 }), true, 'Freigeben');
      case 'newvm': { const ds = A.VIRT.datastores(net, d); return wrap('VM erstellen', field('n', 'Name', '', { ph: 'WEB-VM' }) + `<div class="wg-2">${field('c', 'vCPUs', 2, { type: 'number', min: 1, max: 32 })}${field('r', 'RAM (GB)', 4, { type: 'number', min: 1, max: 512 })}</div><div class="wg-2">${field('dk', 'Festplatte (GB)', 40, { type: 'number', min: 1, max: 2000 })}${field('vl', 'VLAN (0 = ohne Tag)', 0, { type: 'number', min: 0, max: 4094 })}</div>` + sel('ds', 'Datastore', [['local', 'lokale Platte']].concat(ds.map(y => [y.id, `${y.name} (${gb(y.gb - A.VIRT.dsUsed(net, y.id))} frei)`]))) + sel('os', 'Betriebssystem', [['linux', 'Ubuntu Linux 22.04'], ['windows', 'Windows Server 2022']]), true, 'Erstellen'); }
      case 'vmedit': { const vm = net.devs[x.v], h = A.hip(vm, 'eth0') || {}, ds = A.VIRT.datastores(net, d); return wrap(`VM ${esc(vm.cfg.hostname)}`, field('vl', 'VLAN (0 = ohne Tag)', vm.vm.vlan, { type: 'number', min: 0, max: 4094 }) + sel('ds', 'Datastore', [['local', 'lokale Platte']].concat(ds.map(y => [y.id, y.name])), vm.vm.ds, vm.vm.state === 'running' ? 'Nur bei ausgeschalteter VM änderbar.' : '') + `<h4>Netzwerk im Gast</h4>` + field('ip', 'IP-Adresse / Präfix', h.ip ? h.ip + '/' + maskLen(h.mask) : '', { ph: '10.20.0.10/24' }) + field('gw', 'Gateway', vm.cfg.gw || '', { ph: '10.20.0.1' }), true, 'Speichern'); }
      case 'vmmig': { const vm = net.devs[x.v], others = Object.values(net.devs).filter(y => A.VIRT.isHost(y) && y.id !== d.id); return wrap(`${esc(vm.cfg.hostname)} verschieben`, others.length ? sel('to', 'Ziel-Host', others.map(y => [y.id, y.cfg.hostname + (y.hv.cluster ? ` (Cluster ${y.hv.cluster})` : '')]), others[0].id, vm.vm.state === 'running' ? 'Live-Migration: braucht gemeinsamen Datastore.' : 'Kalte Migration.') : '<p class="wg-empty">Es gibt keinen weiteren Hypervisor im Plan.</p>', others.length ? true : false, 'Verschieben'); }
      case 'vmcon': { const vm = net.devs[x.v], lines = A.termOut(vm); return wrap(`Konsole: ${esc(vm.cfg.hostname)}`, `<div class="wg-term sm" id="wg-out2" role="log">${lines.map(o => `<div class="k-${o.c}">${esc(o.t) || '&nbsp;'}</div>`).join('')}</div><div class="wg-termin"><label for="wg-vmcmd">${esc(A.prompt(vm))}</label><input id="wg-vmcmd" data-vm="${vm.id}" autocomplete="off" spellcheck="false" aria-label="Befehl"></div>`, false); }
      case 'rename': return wrap('Computer umbenennen', field('n', 'Neuer Name', d.cfg.hostname) + '<p class="wg-note">Der Name gilt nach einem Neustart.</p>', true, 'Umbenennen');
      case 'join': return wrap('Domäne beitreten', field('dom', 'Domäne', 'lab.local') + field('usr', 'Benutzer', 'lab\\administrator') + '<p class="wg-note">Der DNS-Server dieses Computers muss der Domänencontroller sein.</p>', true, 'Beitreten');
      case 'wnet': return wrap(`Adapter ${esc(x.i)}`, field('ip', 'IPv4-Adresse', hostIp(d), { ph: '10.0.0.10' }) + field('len', 'Präfixlänge', 24, { type: 'number', min: 1, max: 32 }) + field('gw', 'Standardgateway', d.cfg.gw || '') + field('dns', 'Bevorzugter DNS-Server', d.cfg.dns || ''), true, 'Übernehmen');
      case 'forest': return wrap('Server zum Domänencontroller heraufstufen', field('dom', 'Domänenname', 'lab.local') + field('pw', 'DSRM-Kennwort', 'P@ssw0rd123', { type: 'password', hint: 'Mindestens 7 Zeichen aus drei Klassen (Groß, Klein, Ziffer, Sonderzeichen).' }), true, 'Heraufstufen');
      case 'newuser': { const x2 = adOf(d, G); return wrap('Neuer Benutzer', field('n', 'Vollständiger Name', '', { ph: 'Max Muster' }) + field('sam', 'Anmeldename', '', { ph: 'mmuster' }) + field('pw', 'Kennwort', '', { type: 'password' }) + sel('ou', 'Organisationseinheit', [['', 'Users (Standard)']].concat(x2.ad.ous.map(o => [o, o]))), true, 'Erstellen'); }
      case 'newgroup': return wrap('Neue Gruppe', field('n', 'Name', '', { ph: 'Vertrieb' }) + sel('sc', 'Bereich', [['Global', 'Global'], ['DomainLocal', 'Domänenlokal'], ['Universal', 'Universal']]), true, 'Erstellen');
      case 'addmember': { const x2 = adOf(d, G); return wrap('Mitglied hinzufügen', sel('g', 'Gruppe', x2.ad.groups.map(g => [g.name, g.name])) + sel('u', 'Benutzer', x2.ad.users.map(u => [u.sam, `${u.name} (${u.sam})`])), true, 'Hinzufügen'); }
      case 'newou': return wrap('Neue Organisationseinheit', field('n', 'Name', '', { ph: 'Sales' }), true, 'Erstellen');
      case 'newzone': return wrap('Neue Zone', field('n', 'Zonenname', '', { ph: 'test.local' }), true, 'Erstellen');
      case 'newrec': return wrap(`A-Eintrag in ${esc(x.z)}`, field('n', 'Name', '', { ph: 'www' }) + field('ip', 'IP-Adresse', '', { ph: '10.0.0.50' }), true, 'Hinzufügen');
      case 'newscope': return wrap('IPv4-Bereich erstellen', field('n', 'Name', 'LAN') + field('s', 'Startadresse', '10.0.0.100') + field('e', 'Endadresse', '10.0.0.150') + field('m', 'Subnetzmaske', '255.255.255.0'), true, 'Erstellen');
      case 'dhcpopt': { const s = W(d).dhcp.scope; return wrap('Bereichsoptionen', field('r', 'Router (Standardgateway)', s.router) + field('dns', 'DNS-Server', s.dns), true, 'Speichern'); }
      case 'newshare': { const x2 = adOf(d, G); return wrap('Neue Freigabe', field('n', 'Freigabename', '', { ph: 'Daten' }) + field('p', 'Pfad', 'D:\\Daten') + (x2 ? sel('who', 'Vollzugriff für', [['', '– niemand –'], ['Jeder', 'Jeder']].concat(x2.ad.groups.map(g => [`${A.WIN.NB(x2.dc.win.domain.name)}\\${g.name}`, `${A.WIN.NB(x2.dc.win.domain.name)}\\${g.name}`]))) : sel('who', 'Vollzugriff für', [['', '– niemand –'], ['Jeder', 'Jeder']])), true, 'Erstellen'); }
      case 'newfw': return wrap('Neue Firewall-Regel', field('n', 'Name', '') + field('p', 'Port', '', { type: 'number', min: 1, max: 65535 }) + sel('pr', 'Protokoll', [['TCP', 'TCP'], ['UDP', 'UDP']]), true, 'Erstellen');
      case 'newpool': return wrap('Speicherpool erstellen', field('n', 'Poolname', '', { ph: 'POOL1' }) + sel('r', 'RAID-Level', Object.entries(ST().RAID).map(([kk, r]) => [kk, `${r.name}: ${r.note}`]), 'raid5') + `<div class="wg-2">${field('c', 'Anzahl Platten', 6, { type: 'number', min: 2, max: 24 })}${sel('g', 'Größe je Platte', ST().DISKS.map(g => [g, g + ' GB']), 600)}</div>`, true, 'Erstellen');
      case 'newlun': { const T = ST().st(d); return wrap('LUN erstellen', field('n', 'LUN-Name', '', { ph: 'DB01' }) + sel('p', 'Pool', T.pools.length ? T.pools.map(p => [p.name, `${p.name} (frei ${gb(ST().poolInfo(d, p).free)})`]) : [['', '– erst einen Pool anlegen –']]) + field('g', 'Größe (GB)', 100, { type: 'number', min: 1 }) + `<label class="wg-ck"><input type="checkbox" id="wf-thin"> Thin Provisioning (reserviert zunächst nur 10 Prozent)</label>`, true, 'Erstellen'); }
      case 'maplun': { const l = ST().st(d).luns.find(y => y.id === +x.l); return wrap(`LUN ${esc(l.name)} zuordnen`, servers.length ? servers.map(s => `<label class="wg-ck"><input type="checkbox" data-host="${s.id}" ${l.hosts.includes(s.id) ? 'checked' : ''}> ${esc(s.cfg.hostname)}</label>`).join('') + '<p class="wg-note">LUN-Masking: Nur angekreuzte Hosts dürfen die LUN sehen.</p>' : '<p class="wg-empty">Kein Server im Plan.</p>', true, 'Speichern'); }
      case 'newzone2': { const at = ST().attached(net, d), o = list => list.map(y => [y.wwpn, `${y.dev.cfg.hostname} ${A.SH(y.port)}`]); return wrap('Zone erstellen', field('n', 'Zonenname', '', { ph: 'Z_SRV01_STO01' }) + sel('i', 'Initiator (Server)', o(at.filter(y => y.role === 'initiator')).length ? o(at.filter(y => y.role === 'initiator')) : [['', '– keiner angeschlossen –']]) + sel('t', 'Target (Storage)', o(at.filter(y => y.role === 'target')).length ? o(at.filter(y => y.role === 'target')) : [['', '– keiner angeschlossen –']]), true, 'Erstellen'); }
    }
    return '';
  }

  // ---------- Ereignisse ----------
  function bind(G) {
    const root = G.root, d = () => G.dev();
    const done = () => G.draw();
    const dlgOk = () => {
      const x = G.dlg, k = x.k, dv = d(), net = A.net(); let ok = true;
      const E = (c, m) => { const r = exec(G, c, m); ok = !!r; };
      switch (k) {
        case 'fwif': {
          const nm = v(G, 'nif').trim(), sl = v(G, 'sl').trim(), ip = v(G, 'ip').trim(), L = ['interface ' + x.p];
          if (nm) L.push('nameif ' + nm); else if (dv.cfg.ifs[x.p].nameif) L.push('no nameif');
          if (nm && sl !== '') L.push('security-level ' + sl);
          L.push(ip ? `ip address ${ip} ${v(G, 'mask').trim()}` : 'no ip address', v(G, 'st') === 'up' ? 'no shutdown' : 'shutdown', 'exit');
          ok = ios(G, L, 'Schnittstelle gespeichert.'); break;
        }
        case 'fwrule': { const pr = v(G, 'proto'), pt = v(G, 'port').trim(), a = v(G, 'acl').trim(); if (!a || /\s/.test(a)) { G.msg = { err: true, t: 'Name der Regelliste ohne Leerzeichen angeben.' }; ok = false; break; } if (pt && !['tcp', 'udp'].includes(pr)) { G.msg = { err: true, t: 'Ports gibt es nur bei tcp und udp.' }; ok = false; break; } ok = ios(G, `access-list ${a} extended ${v(G, 'act')} ${pr} ${v(G, 'src').trim()} ${v(G, 'dst').trim()}${pt ? ' eq ' + pt : ''}`, 'Regel hinzugefügt. Sie wirkt, sobald die Liste an eine Zone gebunden ist.'); break; }
        case 'fwbind': ok = ios(G, `access-group ${v(G, 'acl')} in interface ${v(G, 'z')}`, 'Regelliste gebunden.'); break;
        case 'fwnat': ok = ios(G, `nat (${v(G, 'from')},${v(G, 'to')}) source dynamic any interface`, 'NAT-Regel hinzugefügt.'); break;
        case 'fwroute': ok = ios(G, `route ${v(G, 'z')} ${v(G, 'net').trim()} ${v(G, 'mask').trim()} ${v(G, 'gw').trim()}`, 'Route hinzugefügt.'); break;
        case 'dpool': { const n = v(G, 'n').trim().replace(/\s+/g, '_'), L = ['ip dhcp pool ' + n, `network ${v(G, 'net').trim()} ${v(G, 'mask').trim()}`]; if (!n) { ok = false; break; } if (v(G, 'gw').trim()) L.push('default-router ' + v(G, 'gw').trim()); if (v(G, 'dns').trim()) L.push('dns-server ' + v(G, 'dns').trim()); L.push('exit'); ok = ios(G, L, 'Pool angelegt. Die Clients bekommen ab jetzt Adressen aus diesem Netz.'); break; }
        case 'dexcl': { const a = v(G, 'a').trim(), b = v(G, 'b').trim(); ok = ios(G, `ip dhcp excluded-address ${a}${b ? ' ' + b : ''}`, 'Bereich ausgeschlossen.'); break; }
        case 'dhelp': { const h = v(G, 'h').trim(); ok = ios(G, ['interface ' + x.n, h ? 'ip helper-address ' + h : 'no ip helper-address', 'exit'], h ? 'Relay eingerichtet.' : 'Relay entfernt.'); break; }
        case 'fwdhcp': { const i = dv.cfg.ifs[x.n], s0 = v(G, 's').trim(), e0 = v(G, 'e').trim(), dn = v(G, 'dns').trim(), L = []; if (s0 || e0) L.push(`dhcpd address ${s0}-${e0} ${i.nameif}`); if (dn) L.push('dhcpd dns ' + dn); L.push(v(G, 'on') === '1' ? 'dhcpd enable ' + i.nameif : 'no dhcpd enable ' + i.nameif); ok = ios(G, L, 'DHCP-Server gespeichert.'); break; }
        case 'hmnew': A.act(() => { ok = res(G, A.STOR.hmCreate(net, dv, net.devs[v(G, 'peer')], { name: v(G, 'n'), quorum: v(G, 'q'), preferred: v(G, 'pref'), staticFallback: v(G, 'sf') }), 'HyperMetro-Domäne erstellt. Lege Replikationszonen an und richte den Quorum-Server ein.'); }); break;
        case 'hmset': A.act(() => { ok = res(G, A.STOR.hmSet(net, dv, { preferred: v(G, 'pref'), quorum: v(G, 'q'), staticFallback: v(G, 'sf') }), 'Gespeichert.'); }); break;
        case 'hmpair': A.act(() => { ok = res(G, A.STOR.hmPairCreate(net, dv, { lun: v(G, 'lun'), pool: v(G, 'pool') }), 'Paar erstellt. Hosts sehen die LUN jetzt mit Pfaden zu beiden Arrays (nach einem Rescan).'); }); break;
        case 'ssid': {
          const L = ssidList(dv), i = x.i === '' ? -1 : +x.i, n = v(G, 'n').trim(), sec = v(G, 'sec'), psk = v(G, 'psk'), vl = Math.round(+v(G, 'vlan') || 0);
          if (!n || n.length > 32) { G.msg = { err: true, t: 'Der Name der SSID braucht 1 bis 32 Zeichen.' }; ok = false; break; }
          if (sec !== 'open' && (psk.length < 8 || psk.length > 63)) { G.msg = { err: true, t: 'Der WLAN-Schlüssel braucht 8 bis 63 Zeichen.' }; ok = false; break; }
          if (!(vl >= 0 && vl <= 4094)) { G.msg = { err: true, t: 'VLAN 0 bis 4094.' }; ok = false; break; }
          if (L.some((y, k) => y.name === n && k !== i)) { G.msg = { err: true, t: `Die SSID „${n}“ gibt es schon.` }; ok = false; break; }
          A.act(() => { const o = { name: n, sec, psk: sec === 'open' ? '' : psk, vlan: vl, on: i >= 0 ? L[i].on : true }; if (i >= 0) L[i] = o; else L.push(o); });
          [`wlan ${n} ${L.length} ${n}`, sec === 'open' ? 'no security wpa' : `security wpa ${sec === 'wpa3' ? 'wpa3' : 'wpa2'} ciphers aes`, sec === 'open' ? '' : 'security wpa akm ' + (sec === 'wpa3' ? 'sae' : 'psk') + ' set-key ascii 0 ********', vl ? 'client vlan ' + vl : 'no client vlan', 'no shutdown'].filter(Boolean).forEach(c => G.log.push({ cmd: c, err: false })); G.log = G.log.slice(-8);
          G.msg = { t: 'SSID gespeichert. Clients verbinden sich mit dem Schlüssel.' }; break;
        }
        case 'apnet': { const ip = v(G, 'ip').trim(), gw = v(G, 'gw').trim(); if (!ip) { ok = false; G.msg = { err: true, t: 'IP-Adresse fehlt.' }; break; } const o = A.exec(dv, `ip ${ip}/${v(G, 'len')}${gw ? ' ' + gw : ''}`); G.log.push({ cmd: `ip ${ip}/${v(G, 'len')}${gw ? ' ' + gw : ''}`, err: false }); if (/ungültig|nicht|invalid/i.test(o)) { G.msg = { err: true, t: String(o).split('\n')[0] }; ok = false; } else { A.act(() => { dv.cfg.dhcp = false; }); G.msg = { t: 'IP-Konfiguration gespeichert.' }; } break; }
        case 'ecnew': { const ps = [...root.querySelectorAll('[data-ecp]')].filter(c => c.checked).map(c => c.dataset.ecp), n = +v(G, 'n'); if (ps.length < 2) { G.msg = { err: true, t: 'Wähle mindestens zwei Ports.' }; ok = false; break; } const L = []; ps.forEach(p => L.push('interface ' + p, `channel-group ${n} mode ${v(G, 'md')}`, 'exit')); if (v(G, 'trunk')) L.push('interface port-channel ' + n, 'switchport mode trunk', 'exit'); ok = ios(G, L, `Port-Channel ${n} erstellt. Richte die Gegenseite mit passendem Modus ein.`); break; }
        case 'rpstart': ok = ios(G, [`router ${x.p} ${v(G, 'n').trim()}`, 'exit'], x.p.toUpperCase() + ' gestartet. Füge jetzt Netze oder Nachbarn hinzu.'); break;
        case 'ospfnet': ok = ios(G, [`router ospf ${x.pid}`, `network ${v(G, 'net').trim()} ${v(G, 'wc').trim()} area ${v(G, 'area')}`, 'exit'], 'Netz hinzugefügt.'); break;
        case 'eigrpnet': ok = ios(G, [`router eigrp ${x.as}`, `network ${v(G, 'net').trim()} ${v(G, 'wc').trim()}`, 'exit'], 'Netz hinzugefügt.'); break;
        case 'bgpnbr': { const ip = v(G, 'ip').trim(), L = ['router bgp ' + x.as, `neighbor ${ip} remote-as ${v(G, 'as')}`]; if (v(G, 'nhs')) L.push(`neighbor ${ip} next-hop-self`); if (v(G, 'defo')) L.push(`neighbor ${ip} default-originate`); L.push('exit'); ok = ios(G, L, 'Nachbar hinzugefügt. Die Gegenseite braucht einen passenden neighbor-Eintrag.'); break; }
        case 'bgpnet': ok = ios(G, [`router bgp ${x.as}`, `network ${v(G, 'net').trim()} mask ${v(G, 'mask').trim()}`, 'exit'], 'Netz wird angekündigt, sobald es in der Routing-Tabelle steht.'); break;
        case 'qcm': { const n = v(G, 'n').trim().replace(/\s+/g, '_'), m = v(G, 'm'); if (!n) { ok = false; break; } ok = ios(G, [`class-map match-any ${n}`, m === 'any' ? 'match any' : 'match ' + m, 'exit'], 'Class-Map angelegt.'); break; }
        case 'qpm': ok = ios(G, [`policy-map ${v(G, 'n').trim().replace(/\s+/g, '_')}`, `class ${v(G, 'c')}`, `${v(G, 'a')} ${v(G, 'pc')}`, 'exit'], 'Policy-Map angelegt. Binde sie jetzt an eine Schnittstelle.'); break;
        case 'qbind': ok = ios(G, [`interface ${v(G, 'i')}`, `service-policy ${v(G, 'dir')} ${v(G, 'p')}`, 'exit'], 'Policy gebunden.'); break;
        case 'vpnnew': {
          const tn = +v(G, 'tn'), peer = v(G, 'peer').trim(), tip = v(G, 'tip').trim(), psk = v(G, 'psk').trim(), enc = v(G, 'enc'), integ = v(G, 'int'), grp = v(G, 'grp'), wan = v(G, 'wan'), sfx = 'T' + tn;
          if (!peer || !tip || !psk) { G.msg = { err: true, t: 'Peer-Adresse, Tunnel-Adresse und Schlüssel werden gebraucht.' }; ok = false; break; }
          const esp = enc === 'aes-cbc-128' ? 'esp-aes 128' : 'esp-aes 256', hm = integ === 'sha1' ? 'esp-sha-hmac' : 'esp-sha256-hmac';
          const L = [`crypto ikev2 proposal PROP-${sfx}`, `encryption ${enc}`, `integrity ${integ}`, `group ${grp}`, 'exit', `crypto ikev2 policy POL-${sfx}`, `proposal PROP-${sfx}`, 'exit', `crypto ikev2 keyring KR-${sfx}`, 'peer SITE', `address ${peer}`, `pre-shared-key ${psk}`, 'exit', 'exit', `crypto ikev2 profile IKE-${sfx}`, `match identity remote address ${peer} 255.255.255.255`, 'authentication remote pre-share', 'authentication local pre-share', `keyring local KR-${sfx}`, 'exit',
            `crypto ipsec transform-set TS-${sfx} ${esp} ${hm}`, 'mode tunnel', 'exit', `crypto ipsec profile IPS-${sfx}`, `set transform-set TS-${sfx}`, `set ikev2-profile IKE-${sfx}`, 'exit',
            `interface Tunnel${tn}`, `ip address ${tip} 255.255.255.252`, `tunnel source ${wan}`, `tunnel destination ${peer}`, 'tunnel mode ipsec ipv4', `tunnel protection ipsec profile IPS-${sfx}`, 'exit'];
          if (v(G, 'rnet').trim()) L.push(`ip route ${v(G, 'rnet').trim()} ${v(G, 'rmask').trim()} Tunnel${tn}`);
          ok = ios(G, L, 'VPN eingerichtet. Die Gegenstelle braucht passende Einstellungen (Quelle und Ziel gespiegelt, gleicher Schlüssel).'); break;
        }
        case 'zhost': A.act(() => { ok = res(G, A.MON.addHost(net, dv, v(G, 'dev'), { snmp: v(G, 'snmp').trim(), agent: v(G, 'agent') }), 'Host hinzugefügt. Der erste Messwert kommt in wenigen Sekunden.'); }); break;
        case 'zhedit': A.act(() => { const h = A.MON.zbx(dv).hosts.find(y => y.dev === x.h); if (h) { h.snmp = v(G, 'snmp').trim(); h.agent = !!v(G, 'agent'); } }); G.msg = { t: 'Gespeichert.' }; break;
        case 'bkjob': A.act(() => { ok = res(G, A.BKP.addJob(net, dv, { name: v(G, 'n'), src: v(G, 'src'), keep: v(G, 'keep') }), 'Job angelegt. Starte ihn mit „Jetzt sichern“.'); }); break;
        case 'ifedit': {
          const ps = x.p === '*' ? (G.isel || []) : [x.p], one = ps.length === 1, sw = dv.type === 'switch', L = [];
          const allow = v(G, 'allow').trim().toLowerCase();
          if (sw && allow && allow !== 'all' && allow !== 'none' && !/^\d+([,-]\d+)*$/.test(allow)) { G.msg = { err: true, t: 'Erlaubte VLANs: all, none oder eine Liste wie 10,20,30.' }; ok = false; break; }
          ps.forEach(p => {
            L.push('interface ' + p);
            if (one) { const ds = v(G, 'desc').trim(); L.push(ds ? 'description ' + ds : 'no description'); }
            const st = v(G, 'st'); if (st) L.push(st === 'up' ? 'no shutdown' : 'shutdown');
            if (sw) {
              const md = v(G, 'mode'); if (md) L.push('switchport mode ' + md);
              const av = v(G, 'vlan'); if (av && (md || dv.cfg.ifs[p].mode) !== 'trunk') L.push('switchport access vlan ' + av);
              if ((md || dv.cfg.ifs[p].mode) === 'trunk') { const nv = v(G, 'nat'); if (nv) L.push('switchport trunk native vlan ' + nv); if (allow) L.push('switchport trunk allowed vlan ' + allow); }
            } else if (one) { const ip = v(G, 'ip').trim(), mk = v(G, 'mask').trim(); L.push(ip ? `ip address ${ip} ${mk}` : 'no ip address'); }
            { const pv = v(G, 'poe'); if (pv === 'never') L.push('no power inline port priority high', 'power inline never'); else if (pv === 'auto') L.push('no power inline never', 'no power inline port priority high'); else if (pv === 'high') L.push('no power inline never', 'power inline port priority high'); }
            L.push('exit');
          });
          ok = ios(G, L, ps.length > 1 ? `${ps.length} Schnittstellen geändert.` : 'Schnittstelle gespeichert.'); break;
        }
        case 'newvlan': { const id = +v(G, 'id'), n = v(G, 'n').trim().replace(/\s+/g, '_'); if (!(id >= 2 && id <= 4094)) { G.msg = { err: true, t: 'VLAN-ID 2–4094.' }; ok = false; break; } ok = ios(G, ['vlan ' + id].concat(n ? ['name ' + n] : []).concat(['exit']), `VLAN ${id} angelegt.`); break; }
        case 'vlname': { const n = v(G, 'n').trim().replace(/\s+/g, '_'); if (!n) { ok = false; break; } ok = ios(G, ['vlan ' + x.v, 'name ' + n, 'exit'], 'VLAN umbenannt.'); break; }
        case 'newsvi': { const id = +v(G, 'id'); if (!(id >= 1 && id <= 4094)) { G.msg = { err: true, t: 'VLAN-ID 1–4094.' }; ok = false; break; } ok = ios(G, (dv.cfg.vlans[id] ? [] : ['vlan ' + id, 'exit']).concat(['interface vlan ' + id, `ip address ${v(G, 'ip').trim()} ${v(G, 'mask').trim()}`, 'no shutdown', 'exit']), `SVI Vlan${id} angelegt.` + (dv.cfg.ipRouting ? '' : ' Für Routing zwischen VLANs braucht der Switch „ip routing“.')); break; }
        case 'editsvi': { const ip = v(G, 'ip').trim(); ok = ios(G, ['interface ' + x.n, ip ? `ip address ${ip} ${v(G, 'mask').trim()}` : 'no ip address', v(G, 'st') === 'up' ? 'no shutdown' : 'shutdown', 'exit'], 'SVI gespeichert.'); break; }
        case 'newroute': ok = ios(G, `ip route ${v(G, 'net').trim()} ${v(G, 'mask').trim()} ${v(G, 'nh').trim()}`, 'Route hinzugefügt.'); break;
        case 'newace': {
          const pr = v(G, 'proto'), pt = v(G, 'port').trim(), a = v(G, 'acl').trim(); if (!a) { ok = false; break; }
          if (pt && !['tcp', 'udp'].includes(pr)) { G.msg = { err: true, t: 'Ports gibt es nur bei tcp und udp.' }; ok = false; break; }
          const std = /^\d+$/.test(a) && +a < 100;
          ok = ios(G, std ? `access-list ${a} ${v(G, 'act')} ${v(G, 'src').trim()}` : `access-list ${a} ${v(G, 'act')} ${pr} ${v(G, 'src').trim()} ${v(G, 'dst').trim()}${pt ? ' eq ' + pt : ''}`, 'Regel hinzugefügt. Sie wirkt, sobald die ACL an eine Schnittstelle gebunden ist.'); break;
        }
        case 'aclbind': ok = ios(G, ['interface ' + v(G, 'if'), `ip access-group ${v(G, 'acl')} ${v(G, 'dir')}`, 'exit'], 'ACL gebunden.'); break;
        case 'host': { const n = v(G, 'h').trim().replace(/\s+/g, '-'); if (!n) { ok = false; break; } E('sudo hostnamectl set-hostname ' + n, 'Hostname geändert.'); break; }
        case 'net': { const ip = v(G, 'ip').trim(), len = v(G, 'len'); if (!ip) { G.msg = { err: true, t: 'IP-Adresse fehlt.' }; ok = false; break; } E(`sudo ip addr add ${ip}/${len} dev ${x.i}`, 'Schnittstelle konfiguriert.'); break; }
        case 'gw': { const gw = v(G, 'gw').trim(), dns = v(G, 'dns').trim(); if (gw) { E('sudo ip route add default via ' + gw); } if (ok && dns) A.act(() => { dv.cfg.dns = dns; }); if (ok) G.msg = { t: 'Gateway und DNS gespeichert.' }; break; }
        case 'newfile': { const p = v(G, 'path').trim(); E(`sudo touch ${p}`, 'Datei angelegt.'); if (ok) G.file = p; break; }
        case 'mkfs': E(`sudo mkfs.${v(G, 'fs')} ${v(G, 'dev')}`, 'Dateisystem angelegt.'); break;
        case 'mount': { const mp = v(G, 'mp').trim() || '/data'; E([`sudo mkdir -p ${mp}`, `sudo mount ${v(G, 'dev')} ${mp}`], `Eingebunden unter ${mp}.`); break; }
        case 'allow': E('sudo ufw allow ' + v(G, 'port'), 'Port freigegeben.'); break;
        case 'newvm': A.act(() => { const r = A.VIRT.createVm(net, dv, { name: v(G, 'n'), cpu: v(G, 'c'), ramGb: v(G, 'r'), diskGb: v(G, 'dk'), vlan: v(G, 'vl'), ds: v(G, 'ds'), os: v(G, 'os') }, A.defSvc); ok = res(G, r, 'VM erstellt. Schalte sie ein und gib ihr eine IP-Adresse (Bearbeiten).'); }); break;
        case 'vmedit': A.act(() => { const vm = net.devs[x.v]; let r = A.VIRT.setVlan(vm, v(G, 'vl')); if (!r.err && vm.vm.state !== 'running') vm.vm.ds = v(G, 'ds'); ok = res(G, r, 'VM gespeichert.'); }); if (ok) { const ip = v(G, 'ip').trim(), gw = v(G, 'gw').trim(), vm = net.devs[x.v]; if (ip) { let o = ''; A.act(() => { o = A.exec(vm, `ip ${ip}${gw ? ' ' + gw : ''}`); }); if (failed(o) || /nicht|ungültig|invalid/i.test(o)) { G.msg = { err: true, t: String(o).split('\n')[0] }; ok = false; } } } break;
        case 'vmmig': A.act(() => { const vm = net.devs[x.v]; ok = res(G, A.VIRT.migrate(net, vm, v(G, 'to')), `${vm.cfg.hostname} läuft jetzt auf ${net.devs[v(G, 'to')].cfg.hostname}.`); }); break;
        case 'rename': E(`Rename-Computer -NewName ${v(G, 'n')}`, 'Name wird nach dem Neustart gültig.'); break;
        case 'join': E(`Add-Computer -DomainName ${v(G, 'dom')} -Credential ${v(G, 'usr')}`, 'Der Domäne beigetreten.'); break;
        case 'wnet': E([`New-NetIPAddress -InterfaceAlias ${x.i} -IPAddress ${v(G, 'ip')} -PrefixLength ${v(G, 'len')}${v(G, 'gw') ? ' -DefaultGateway ' + v(G, 'gw') : ''}`].concat(v(G, 'dns') ? [`Set-DnsClientServerAddress -InterfaceAlias ${x.i} -ServerAddresses ${v(G, 'dns')}`] : []), 'Adapter konfiguriert.'); break;
        case 'forest': E(`Install-ADDSForest -DomainName ${v(G, 'dom')} -SafeModeAdministratorPassword (ConvertTo-SecureString "${v(G, 'pw')}" -AsPlainText -Force) -Force`, 'Gesamtstruktur erstellt. Der Server ist jetzt Domänencontroller.'); break;
        case 'newuser': E(`New-ADUser -Name "${v(G, 'n')}" -SamAccountName ${v(G, 'sam')} -AccountPassword (ConvertTo-SecureString "${v(G, 'pw')}" -AsPlainText -Force) -Enabled $true${v(G, 'ou') ? ` -Path "OU=${v(G, 'ou')},${A.WIN.dn(W(dv).domain.name)}"` : ''}`, 'Benutzer erstellt.'); break;
        case 'newgroup': E(`New-ADGroup -Name ${v(G, 'n')} -GroupScope ${v(G, 'sc')}`, 'Gruppe erstellt.'); break;
        case 'addmember': E(`Add-ADGroupMember -Identity "${v(G, 'g')}" -Members ${v(G, 'u')}`, 'Mitglied hinzugefügt.'); break;
        case 'newou': E(`New-ADOrganizationalUnit -Name ${v(G, 'n')}`, 'Organisationseinheit erstellt.'); break;
        case 'newzone': E(`Add-DnsServerPrimaryZone -Name ${v(G, 'n')}`, 'Zone erstellt.'); break;
        case 'newrec': E(`Add-DnsServerResourceRecordA -Name ${v(G, 'n')} -ZoneName ${x.z} -IPv4Address ${v(G, 'ip')}`, 'Eintrag hinzugefügt.'); break;
        case 'newscope': E(`Add-DhcpServerv4Scope -Name ${v(G, 'n')} -StartRange ${v(G, 's')} -EndRange ${v(G, 'e')} -SubnetMask ${v(G, 'm')}`, 'Bereich erstellt. Setze die Optionen und starte den Dienst.'); break;
        case 'dhcpopt': E(`Set-DhcpServerv4OptionValue${v(G, 'r') ? ' -Router ' + v(G, 'r') : ''}${v(G, 'dns') ? ' -DnsServer ' + v(G, 'dns') : ''}`, 'Optionen gespeichert.'); break;
        case 'newshare': { const p = v(G, 'p').trim(), who = v(G, 'who'), cmds = []; if (!W(dv).files[p.replace(/\\$/, '')]) cmds.push(`New-Item -ItemType Directory -Path ${p}`); cmds.push(`New-SmbShare -Name ${v(G, 'n')} -Path ${p}${who ? ' -FullAccess ' + who : ''}`); E(cmds, 'Freigabe erstellt.'); break; }
        case 'newfw': E(`New-NetFirewallRule -DisplayName "${v(G, 'n')}" -Direction Inbound -LocalPort ${v(G, 'p')} -Protocol ${v(G, 'pr')} -Action Allow`, 'Regel erstellt.'); break;
        case 'newpool': A.act(() => { ok = res(G, A.STOR.createPool(dv, { name: v(G, 'n'), raid: v(G, 'r'), disks: v(G, 'c'), diskGb: v(G, 'g') }), 'Pool erstellt.'); }); break;
        case 'newlun': A.act(() => { ok = res(G, A.STOR.createLun(dv, { name: v(G, 'n'), pool: v(G, 'p'), gb: v(G, 'g'), thin: v(G, 'thin') }), 'LUN erstellt. Ordne sie jetzt einem Host zu.'); }); break;
        case 'maplun': A.act(() => { root.querySelectorAll('[data-host]').forEach(c => A.STOR.maskLun(dv, +x.l, c.dataset.host, c.checked, A.net())); G.msg = { t: 'Zuordnung gespeichert.' }; }); break;
        case 'newzone2': A.act(() => { ok = res(G, A.STOR.zoneAdd(dv, v(G, 'n'), [v(G, 'i'), v(G, 't')]), 'Zone erstellt. Aktiviere das Zoneset, damit sie gilt.'); }); break;
      }
      if (ok) G.dlg = null; done();
    };
    root.addEventListener('submit', e => { e.preventDefault(); const f = e.target.closest('[data-act]'); if (!f) return; if (f.dataset.act === 'login') { SESS[G.id] = true; G.auth = true; G.msg = null; done(); } else if (f.dataset.act === 'dlgok') dlgOk(); else if (f.dataset.act === 'pingf') { const dst = v(G, 'pdst').trim(), m = (e.submitter && e.submitter.dataset.m) || 'ping'; G.pdst = dst; if (dst) { const dv = d(); G.pout = { t: `${m} ${dst}`, o: A.iosShow(dv, `${m} ${dst}`) }; } done(); } else if (f.dataset.act === 'term') { const i = root.querySelector('#wg-cmd'); if (i && i.value.trim()) { A.termRun(d(), i.value); i.value = ''; } done(); } });
    root.addEventListener('change', e => {
      const t = e.target, a = t.dataset && t.dataset.act; if (!a) return; const dv = d(), net = A.net();
      if (a === 'stpv') { G.tab.stpv = t.value; done(); }
      else if (a === 'zhsel') { G.tab.zh = t.value; done(); }
      else if (a === 'zsh') { G.tab.zsh = t.value; done(); }
      else if (a === 'isel') { G.isel = G.isel || []; G.isel = t.checked ? G.isel.concat(t.dataset.p) : G.isel.filter(x => x !== t.dataset.p); G._keep = 1; done(); }
      else if (a === 'enable') { if (exec(G, `sudo systemctl ${t.checked ? 'enable' : 'disable'} ${t.dataset.u}`, 'Autostart geändert.')) { } done(); }
      else if (a === 'uplink') { A.act(() => { A.VIRT.setUplink(dv, t.dataset.p, t.checked); }); G.msg = { t: 'Uplinks gespeichert.' }; done(); }
      else if (a === 'ha') { A.act(() => { A.VIRT.setHa(net, dv, t.checked); }); G.msg = { t: t.checked ? 'HA aktiv: Fällt ein Host aus, starten seine VMs auf anderen Cluster-Hosts neu.' : 'HA aus.' }; done(); }
      else if (a === 'fwrule') { exec(G, `${t.checked ? 'Enable' : 'Disable'}-NetFirewallRule -DisplayName "${t.dataset.n}"`, 'Regel geändert.'); done(); }
    });
    root.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.id === 'wg-vmcmd') { e.preventDefault(); const vm = A.net().devs[e.target.dataset.vm]; if (e.target.value.trim()) A.termRun(vm, e.target.value); e.target.value = ''; const o = root.querySelector('#wg-out2'); if (o) o.innerHTML = A.termOut(vm).map(x => `<div class="k-${x.c}">${esc(x.t) || '&nbsp;'}</div>`).join(''); if (o) o.scrollTop = 1e9; }
      if (e.key === 'Escape' && G.dlg) { G.dlg = null; done(); }
    });
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'FORM' || b.type === 'checkbox' || (b.type === 'submit' && b.closest('form'))) return; const a = b.dataset.act, D = b.dataset, dv = d(), net = A.net();
      if (a === 'dlgbg') { if (e.target === b) { G.dlg = null; done(); } return; }
      if (b.disabled || b.classList.contains('disabled')) return;
      G.msg = a === 'nav' || a === 'tab' ? null : G.msg;
      switch (a) {
        case 'hmzone': A.act(() => { const r = A.STOR.hmAutoZone(net, dv); G.msg = { t: r.n ? `${r.n} Replikationszone${r.n > 1 ? 'n' : ''} angelegt. Aktiviere das Zoneset am FC-Switch.` : 'Keine neuen Replikationszonen nötig (oder die Arrays hängen nicht am selben FC-Switch).' }; }); break;
        case 'hmdel': A.act(() => { res(G, A.STOR.hmDelete(net, dv), 'Domäne gelöscht.'); }); break;
        case 'hmpairdel': A.act(() => { res(G, A.STOR.hmPairDelete(net, dv, D.l), 'Paar aufgelöst, die Partner-LUN wurde gelöscht.'); }); break;
        case 'ssidon': A.act(() => { const L = ssidList(dv), y = L[+D.i]; if (y) y.on = y.on === false; }); G.msg = { t: 'Gespeichert.' }; break;
        case 'ssiddel': A.act(() => { ssidList(dv).splice(+D.i, 1); }); G.msg = { t: 'SSID gelöscht. Verbundene Clients verlieren das WLAN.' }; break;
        case 'apinj': A.act(() => { const st = NLw().apState(dv); st.injector = !st.injector; }); G.msg = { t: NLw().apState(dv).injector ? 'PoE-Injector angeschlossen.' : 'PoE-Injector entfernt.' }; break;
        case 'apwlc': { const ip = v(G, 'wlc').trim(); if (ip && !A.NL.validIp(ip)) { G.msg = { err: true, t: 'Ungültige IP-Adresse.' }; break; } A.act(() => { NLw().apState(dv).wlc = ip; }); G.log.push({ cmd: ip ? `capwap ap controller ip address ${ip}` : 'no capwap ap controller ip address', err: false }); G.msg = { t: ip ? 'Controller gespeichert. Der AP versucht sich anzumelden.' : 'Autonomer Betrieb.' }; break; }
        case 'apdhcp': { let r; A.act(() => { dv.cfg.dhcp = true; r = A.dhcp(dv); }); G.msg = r.err ? { err: true, t: 'DHCP fehlgeschlagen: ' + r.err } : { t: `DHCP: ${r.ip}/${maskLen(r.mask)} von ${r.server}.` }; break; }
        case 'stprio': ios(G, `spanning-tree vlan ${D.v} priority ${v(G, 'sprio')}`, 'Priorität gesetzt.'); break;
        case 'stroot': ios(G, `spanning-tree vlan ${D.v} root primary`, 'Dieser Switch ist jetzt Root Bridge für das VLAN.'); break;
        case 'stoff': ios(G, D.on === '1' ? `spanning-tree vlan ${D.v}` : `no spanning-tree vlan ${D.v}`, D.on === '1' ? 'Spanning Tree eingeschaltet.' : 'Spanning Tree ausgeschaltet. Achtung: Schleifen führen zu einem Broadcast-Sturm.'); break;
        case 'stmode': ios(G, 'spanning-tree mode ' + v(G, 'stmode'), 'Modus gesetzt.'); break;
        case 'ecdel': { const L = []; dv.ports.filter(p => dv.cfg.ifs[p].cg && dv.cfg.ifs[p].cg.n === +D.n).forEach(p => L.push('interface ' + p, 'no channel-group', 'exit')); L.push('no interface port-channel ' + D.n); ios(G, L, 'Port-Channel aufgelöst.'); break; }
        case 'rpdel': ios(G, `no router ${D.k} ${D.n}`, 'Prozess gelöscht.'); break;
        case 'rpnetdel': { const hd0 = A.blocks(dv, 'router ' + D.k)[0]; if (hd0) ios(G, [hd0.head, 'no ' + D.l, 'exit'], 'Entfernt.'); break; }
        case 'rppass': { const hd0 = A.blocks(dv, 'router ' + D.k)[0]; if (hd0) ios(G, [hd0.head, (D.on === '1' ? '' : 'no ') + 'passive-interface ' + D.i, 'exit'], D.on === '1' ? 'Schnittstelle ist passiv: sie sendet keine Hellos mehr.' : 'Schnittstelle ist aktiv.'); break; }
        case 'ospfdef': ios(G, [`router ospf ${D.pid}`, (D.on === '1' ? '' : 'no ') + 'default-information originate', 'exit'], D.on === '1' ? 'Default-Route wird verteilt, sofern der Router selbst eine hat.' : 'Nicht mehr verteilt.'); break;
        case 'bgpnbrdel': ios(G, [`router bgp ${D.as}`, `no neighbor ${D.ip} remote-as ${((A.RTG.bgpCfg(dv) || { nbrs: {} }).nbrs[D.ip] || {}).as}`, 'exit'], 'Nachbar entfernt.'); break;
        case 'qoson': ios(G, D.on === '1' ? 'mls qos' : 'no mls qos', D.on === '1' ? 'QoS ist aktiv.' : 'QoS ausgeschaltet.'); break;
        case 'qcmdel': ios(G, 'no class-map ' + D.n, 'Class-Map gelöscht.'); break;
        case 'qpmdel': ios(G, 'no policy-map ' + D.n, 'Policy-Map gelöscht.'); break;
        case 'vpndel': { const sfx = 'T' + D.n.slice(6); ios(G, [`no interface ${D.n}`, `no crypto ipsec profile IPS-${sfx}`, `no crypto ikev2 profile IKE-${sfx}`, `no crypto ikev2 keyring KR-${sfx}`, `no crypto ikev2 policy POL-${sfx}`, `no crypto ikev2 proposal PROP-${sfx}`, `no crypto ipsec transform-set TS-${sfx}`].slice(0, 1), 'Tunnel gelöscht.'); break; }
        case 'zdisc': { let n = 0; A.act(() => { n = A.MON.discover(net, dv); }); G.msg = { t: n ? `${n} Gerät${n > 1 ? 'e' : ''} hinzugefügt.` : 'Keine neuen Geräte mit IP-Adresse gefunden.' }; A.monTickNow(); break; }
        case 'zhdel': A.act(() => { const z = A.MON.zbx(dv); z.hosts = z.hosts.filter(y => y.dev !== D.h); }); G.msg = { t: 'Host entfernt.' }; break;
        case 'bkday': A.advanceDays(+D.n); G.msg = { t: 'Datum: ' + A.BKP.dateOf(net.day || 0) }; break;
        case 'bkrun': { let r; A.act(() => { r = A.BKP.runJob(net, dv, A.BKP.st(dv).jobs.find(y => y.id === +D.j), A.bkH()); }); res(G, r, `Gesichert (${r && r.size} MB).`); break; }
        case 'bkjdel': A.act(() => { A.BKP.delJob(dv, +D.j); }); G.msg = { t: 'Job und seine Sicherungen gelöscht.' }; break;
        case 'bkdel': A.act(() => { A.BKP.delBackup(dv, +D.b); }); G.msg = { t: 'Sicherung gelöscht.' }; break;
        case 'bktest': { let r; A.act(() => { r = A.BKP.testRestore(net, dv, +D.b, A.bkH()); }); res(G, r, 'Restore-Test bestanden: Die Sicherung ist lesbar und passt zum Gerät.'); break; }
        case 'bkrestore': { if (!confirm('Den aktuellen Stand des Geräts mit dieser Sicherung überschreiben?')) break; let r; A.act(() => { r = A.BKP.restore(net, dv, +D.b, A.bkH()); }); res(G, r, `Wiederhergestellt: Stand ${r && A.BKP.dateOf(r.day)} auf ${r && r.dev}.`); break; }
        case 'dpooldel': ios(G, 'no ip dhcp pool ' + D.n, 'Pool gelöscht.'); break;
        case 'dexcldel': { const a = excluded(dv)[+D.i]; if (a) ios(G, `no ip dhcp excluded-address ${a.join(' ')}`, 'Ausschluss entfernt.'); break; }
        case 'fwacldel': ios(G, 'no access-list ' + D.a, 'Regelliste gelöscht.'); break;
        case 'fwunbind': ios(G, `no access-group x in interface ${D.z}`, 'Bindung gelöst.'); break;
        case 'fwnatdel': { const n = dv.cfg.nat[+D.i]; if (n) ios(G, `no nat (${n.from},${n.to}) source dynamic any interface`, 'NAT-Regel gelöscht.'); break; }
        case 'fwrtdel': { const r = dv.cfg.routes[+D.i]; if (r) ios(G, `no route ${r.via || 'x'} ${r.net} ${r.mask} ${r.nh}`, 'Route gelöscht.'); break; }
        case 'fwsame': ios(G, dv.cfg.sameSec ? 'no same-security-traffic permit inter-interface' : 'same-security-traffic permit inter-interface', 'Einstellung gespeichert.'); break;
        case 'isall': G.isel = dv.ports.slice(); break;
        case 'isnone': G.isel = []; break;
        case 'ifup': case 'ifdown': { const ps = G.isel || []; if (ps.length) ios(G, [].concat(...ps.map(p => ['interface ' + p, a === 'ifup' ? 'no shutdown' : 'shutdown', 'exit'])), a === 'ifup' ? 'Ausgewählte Schnittstellen aktiviert.' : 'Ausgewählte Schnittstellen abgeschaltet.'); break; }
        case 'vldel': ios(G, 'no vlan ' + D.v, `VLAN ${D.v} gelöscht. Ports in diesem VLAN sind jetzt inaktiv.`); break;
        case 'iprt': ios(G, dv.cfg.ipRouting ? 'no ip routing' : 'ip routing', dv.cfg.ipRouting ? 'Routing abgeschaltet.' : 'Routing aktiviert.'); break;
        case 'dgw': { const g2 = v(G, 'dgw').trim(); ios(G, g2 ? 'ip default-gateway ' + g2 : 'no ip default-gateway', 'Default-Gateway gespeichert.'); break; }
        case 'svidel': ios(G, 'no interface ' + D.n, 'SVI gelöscht.'); break;
        case 'rtdel': { const r = dv.cfg.routes[+D.i]; if (r) ios(G, `no ip route ${r.net} ${r.mask} ${r.nh || r.ifn}`, 'Route gelöscht.'); break; }
        case 'acldel': ios(G, 'no access-list ' + D.a, 'ACL gelöscht.'); break;
        case 'aclunbind': ios(G, ['interface ' + D.n, `no ip access-group ${D.dir}`, 'exit'], 'ACL gelöst.'); break;
        case 'hostname': { const n = v(G, 'hn').trim().replace(/\s+/g, '-'); if (n) ios(G, 'hostname ' + n, 'Hostname geändert.'); break; }
        case 'iosave': { const o = A.ios(dv, ['write memory'], { conf: false }); G.log.push({ cmd: 'write memory', err: false }); G.msg = /OK/.test(o) ? { t: 'Konfiguration gespeichert (Startup-Config).' } : { err: true, t: o }; break; }
        case 'close': if (G.onClose) G.onClose(); return;
        case 'pwron': A.powerOn(G.id); break;
        case 'mode': G.page = FW[D.m].find(n => n[0][0] !== '-')[0]; G.dlg = null; G.msg = null; break;
        case 'refresh': G.msg = { t: 'Aktualisiert.' }; break;
        case 'logout': SESS[G.id] = false; G.auth = false; G.msg = null; break;
        case 'nav': G.page = D.p; G.dlg = null; break;
        case 'tab': G.tab[D.t] = D.v; break;
        case 'dlg': G.dlg = Object.assign({}, D); G._focus = null; break;
        case 'dlgx': G.dlg = null; break;
        case 'run': exec(G, D.c, D.ok || null); break;
        case 'svc': { if (D.save) { const t = root.querySelector('#wf-text'); if (t && G.file) A.act(() => { A.LX.saveFile(dv, G.file, t.value); }); } exec(G, `sudo systemctl ${D.c} ${D.u}`, `${D.u}: ${D.c === 'stop' ? 'gestoppt' : D.c === 'start' ? 'gestartet' : 'neu gestartet'}.`); break; }
        case 'file': { const t = root.querySelector('#wf-text'); G.file = D.f; break; }
        case 'savefile': { const t = root.querySelector('#wf-text'); if (t && G.file) { let r = ''; A.act(() => { r = A.LX.saveFile(dv, G.file, t.value); }); G.msg = r ? { err: true, t: r } : { t: 'Datei gespeichert. Dienste lesen sie beim nächsten (Neu-)Start.' }; } break; }
        case 'nginxt': { const t = root.querySelector('#wf-text'); if (t) A.act(() => { A.LX.saveFile(dv, G.file, t.value); }); const o = A.exec(dv, 'sudo nginx -t'); G.log.push({ cmd: '$ sudo nginx -t', err: /failed|emerg/.test(o) }); G.msg = { err: /failed|emerg/.test(o), t: o.split('\n').join(' ') }; break; }
        case 'hvon': A.act(() => { A.VIRT.enable(net, dv); }); G.msg = { t: 'Hypervisor eingerichtet.' }; G.page = 'vms'; break;
        case 'vmpow': A.act(() => { const vm = net.devs[D.v]; G.msg = (() => { const r = vm.vm.state === 'running' ? A.VIRT.stop(net, vm) : A.VIRT.start(net, vm); return r.err ? { err: true, t: r.err } : { t: `${vm.cfg.hostname} ${vm.vm.state === 'running' ? 'läuft' : 'ist ausgeschaltet'}.` }; })(); }); break;
        case 'vmdel': if (!confirm('VM löschen?')) break; A.act(() => { A.VIRT.del(net, net.devs[D.v]); }); G.msg = { t: 'VM gelöscht.' }; break;
        case 'cluster': A.act(() => { dv.hv.cluster = v(G, 'cl').trim(); }); G.msg = { t: 'Cluster gespeichert.' }; break;
        case 'delpool': { let r; A.act(() => { r = A.STOR.deletePool(dv, D.n); }); res(G, r, 'Pool gelöscht.'); break; }
        case 'dellun': { let r; A.act(() => { r = A.STOR.deleteLun(dv, +D.l); }); res(G, r, 'LUN gelöscht.'); break; }
        case 'autozone': A.act(() => { const r = A.STOR.autoZones(net, dv); G.msg = { t: r.n ? `${r.n} Zone${r.n > 1 ? 'n' : ''} angelegt. Aktiviere das Zoneset.` : 'Keine neuen Zonen nötig.' }; }); break;
        case 'zset': A.act(() => { const r = A.STOR.zoneActive(dv, !A.STOR.zs(dv).active); res(G, r, A.STOR.zs(dv).active ? 'Zoneset aktiviert.' : 'Zoneset deaktiviert: keine Verbindungen mehr.'); }); break;
        case 'delzone': A.act(() => { A.STOR.zoneDel(dv, D.n); }); G.msg = { t: 'Zone gelöscht.' }; break;
        case 'vsan': A.act(() => { dv.cfg.vsan = Math.max(1, Math.min(4093, +v(G, 'vsan') || 10)); }); G.msg = { t: 'VSAN gespeichert.' }; break;
        default: return;
      }
      done();
    });
    return G;
  }

  // ---------- Öffentliche Schnittstelle ----------
  const ALL = new Set(); const refreshAll = pg => { ALL.forEach(G => { try { if (!document.body.contains(G.root)) { ALL.delete(G); return; } if (!pg || (G.page && G.page.startsWith(pg))) G.draw(); } catch (e) { } }); };
  const OPEN = {}; let ZTOP = 40, CASCADE = 0;
  // Verschiebbares, in der Größe änderbares, maximierbares Fenster (auch vom PC-Desktop benutzt)
  function floatFrame(o) {
    o = o || {}; const handle = o.handle || '.wg-chrome';
    const vw = window.innerWidth, vh = window.innerHeight, w = Math.min(o.w || 1040, vw - 24), h = Math.min(o.h || 700, vh - 24), off = (CASCADE++ % 6) * 28;
    const host = document.createElement('div'); host.className = 'wg-float ' + (o.cls || ''); host.style.cssText = `left:${Math.max(8, Math.round((vw - w) / 2) + off - 70)}px;top:${Math.max(8, 40 + off)}px;width:${w}px;height:${h}px;z-index:${++ZTOP}`;
    const body = document.createElement('div'); host.appendChild(body); document.body.appendChild(host);
    const close = () => { host.remove(); if (o.onClose) o.onClose(); };
    // Verschieben an der Titelleiste, Doppelklick maximiert, Ziehen an der unteren rechten Ecke ändert die Größe
    let drag = null, saved = null;
    host.addEventListener('pointerdown', e => {
      host.style.zIndex = ++ZTOP;
      const bar = e.target.closest(handle); if (!bar || e.target.closest('button,input,select,textarea,a') || host.classList.contains('max')) return;
      drag = { x: e.clientX, y: e.clientY, l: host.offsetLeft, t: host.offsetTop }; host.setPointerCapture(e.pointerId); host.classList.add('moving');
    });
    host.addEventListener('pointermove', e => { if (!drag) return; const L = Math.min(window.innerWidth - 80, Math.max(80 - host.offsetWidth, drag.l + e.clientX - drag.x)), T = Math.min(window.innerHeight - 40, Math.max(0, drag.t + e.clientY - drag.y)); host.style.left = L + 'px'; host.style.top = T + 'px'; });
    const end = () => { drag = null; host.classList.remove('moving'); }; host.addEventListener('pointerup', end); host.addEventListener('pointercancel', end);
    const toggleMax = () => { if (host.classList.toggle('max')) { saved = host.style.cssText; host.style.cssText = `z-index:${ZTOP}`; } else if (saved) host.style.cssText = saved + `;z-index:${++ZTOP}`; };
    host.addEventListener('dblclick', e => { const bar = host.querySelector(handle), r = bar && bar.getBoundingClientRect(); if (!r || e.clientY < r.top || e.clientY > r.bottom || e.target.closest('button,input,select,textarea,a')) return; toggleMax(); });
    return { host, body, close, toggleMax };
  }
  function open(devId) {
    const ex = OPEN[devId]; if (ex && document.body.contains(ex.host)) { ex.host.style.zIndex = ++ZTOP; ex.host.classList.remove('min'); return ex.G; }
    const f = floatFrame({ onClose: () => { delete OPEN[devId]; } });
    const G = bind(create(devId, f.body, { chrome: true, onClose: f.close })); OPEN[devId] = { host: f.host, G }; G.draw(); return G;
  }
  function mount(root, devId, o) { const G = bind(create(devId, root, Object.assign({ chrome: false }, o || {}))); G.draw(); return G; }
  // Testhilfe: Seitenaufbau ohne DOM
  function renderPage(devId, page) { const fake = { innerHTML: '', querySelector: () => null, addEventListener() { } }, G = create(devId, fake, { auth: true }); G.page = page; const d = G.dev(), k = kindOf(d); return PAGES[k][page](d, G); }
  const pages = devId => { const d = A.net().devs[devId]; const k = kindOf(d); return k ? NAV[k](d).map(n => n[0]).filter(x => x[0] !== '-') : []; };
  return { refreshAll, init, open, mount, hasGui, kindOf, PORT, NETPORT, portOf, renderPage, pages, floatFrame };
})();
if (typeof module !== 'undefined') module.exports = WEBGUI;
