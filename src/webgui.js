// ===================== NetLab Web-GUIs =====================
// Verwaltungsoberflächen im Browserfenster: Linux-Server, Hypervisor, Windows-Server, Storage, FC-Switch.
// Die Oberflächen rufen dieselben Funktionen wie die Terminals auf (Linux, PowerShell) beziehungsweise
// die Module für Storage und Virtualisierung. Das Planer-Skript übergibt die Schnittstelle über init().
const WEBGUI = (function () {
  const PORT = 8443;
  let A = null; const SESS = {};
  const init = api => { A = api; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const kindOf = d => {
    if (!d) return null; if (d.type === 'storage') return 'storage'; if (d.type === 'fc') return 'fabric';
    if (d.type !== 'server' || A.isCloud(d)) return null;
    return d.os === 'windows' ? 'windows' : (A.VIRT.isHost(d) ? 'hypervisor' : 'linux');
  };
  const PRODUCT = { linux: ['Server-Web-Konsole', 'Linux'], hypervisor: ['Virtualisierungs-Manager', 'Hypervisor'], windows: ['Server-Manager', 'Windows Server 2022'], storage: ['Storage-Manager', 'Speichersystem'], fabric: ['Fabric-Manager', 'FC-Switch'] };
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
      const url = `https://${ip || d.cfg.hostname.toLowerCase()}:${PORT}/`;
      const chrome = G.chrome ? `<div class="wg-chrome"><span class="wg-dots"><i></i><i></i><i></i></span><div class="wg-url" title="${esc(url)}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg><span>${esc(url)}</span>${ip ? '' : '<em>Direktzugriff (keine IP-Adresse)</em>'}</div><button class="wg-x" data-act="close" aria-label="Fenster schließen">✕</button></div>` : '';
      if (!G.auth) { root.innerHTML = `<div class="wg-win">${chrome}<div class="wg-login wg-${k}"><form class="wg-lc" data-act="login"><div class="wg-logo">${logo(k)}</div><h2>${PRODUCT[k][0]}</h2><p>${esc(d.cfg.hostname)} · ${PRODUCT[k][1]}</p>${field('user', 'Benutzername', k === 'windows' ? 'Administrator' : 'admin')}${field('pw', 'Kennwort', 'NetLab-2026', { type: 'password' })}<button type="submit" class="wg-b primary wide" data-act="login">Anmelden</button><small>Simulator-Zugangsdaten sind vorausgefüllt.</small></form></div></div>`; return; }
      const nav = NAV[k](d), pg = G.page && nav.some(n => n[0] === G.page) ? G.page : nav[0][0]; G.page = pg;
      let body = ''; try { body = PAGES[k][pg](d, G) } catch (e) { body = `<p class="wg-empty">Fehler beim Laden der Seite: ${esc(e.message)}</p>`; console.error(e); }
      root.innerHTML = `<div class="wg-win">${chrome}<div class="wg-app wg-${k}">
        <header class="wg-top"><div class="wg-brand">${logo(k)}<b>${PRODUCT[k][0]}</b><span>${esc(d.cfg.hostname)}</span></div><div class="wg-user"><span>${k === 'windows' ? 'Administrator' : 'admin'}</span>${btn('Abmelden', 'logout', null, 'ghost sm')}</div></header>
        <div class="wg-body"><nav class="wg-nav" aria-label="Navigation">${nav.map(([id, lbl]) => `<button type="button" class="${id === pg ? 'act' : ''}" data-act="nav" data-p="${id}" ${id === pg ? 'aria-current="page"' : ''}>${lbl}</button>`).join('')}</nav>
        <div class="wg-main" role="main" tabindex="-1"><div class="wg-ph"><h1>${nav.find(n => n[0] === pg)[1]}</h1></div>${G.msg ? `<div class="wg-msg ${G.msg.err ? 'err' : 'ok'}" role="status">${esc(G.msg.t)}</div>` : ''}${body}</div></div>
        ${G.log.length ? `<footer class="wg-log"><b>Letzte Aktionen (gleichwertig im Terminal)</b>${G.log.slice(-3).map(l => `<code class="${l.err ? 'err' : ''}">${esc(l.cmd)}</code>`).join('')}</footer>` : ''}
        ${G.dlg ? dlgHtml(d, G) : ''}</div></div>`;
      const m = root.querySelector('.wg-main'); if (m && top) m.scrollTop = top;
      const f = root.querySelector('.wg-dlg input, .wg-dlg select'); if (f && G._focus !== G.dlg) { f.focus(); G._focus = G.dlg; }
      if (G.page === 'terminal') { const o = root.querySelector('#wg-out'); if (o) o.scrollTop = 1e9; const i = root.querySelector('#wg-cmd'); if (i && !G.dlg) i.focus(); }
    };
    G.draw = draw; G.dev = dev; G.root = root; G.kind = kind; return G;
  }
  const logo = k => `<svg class="wg-ico" viewBox="0 0 24 24" aria-hidden="true">${{ linux: '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01"/>', hypervisor: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="18" height="8" rx="1.5"/>', windows: '<path d="M3 5l8-1.2V11H3zM13 3.6L21 2v9h-8zM3 13h8v7.2L3 19zM13 13h8v9l-8-1.6z"/>', storage: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>', fabric: '<circle cx="12" cy="12" r="3"/><circle cx="4" cy="5" r="2"/><circle cx="20" cy="5" r="2"/><circle cx="4" cy="19" r="2"/><circle cx="20" cy="19" r="2"/><path d="M6 6l4 4M18 6l-4 4M6 18l4-4M18 18l-4-4"/>' }[k]}</svg>`;
  const hostIp = d => { const h = d.ports.map(p => A.hip(d, p)).find(x => x && x.ip); return h ? h.ip : ''; };

  // ---------- Navigation ----------
  const NAV = {
    linux: d => [['overview', 'Übersicht'], ['network', 'Netzwerk'], ['services', 'Dienste'], ['files', 'Konfigurationsdateien'], ['storage', 'Speicher'], ['firewall', 'Firewall'], ['software', 'Software'], ['virt', 'Virtualisierung'], ['terminal', 'Terminal']],
    hypervisor: d => [['overview', 'Übersicht'], ['vms', 'Virtuelle Maschinen'], ['vswitch', 'Virtueller Switch'], ['datastores', 'Datastores'], ['cluster', 'Cluster und HA'], ['network', 'Netzwerk'], ['services', 'Dienste'], ['files', 'Konfigurationsdateien'], ['storage', 'Speicher'], ['firewall', 'Firewall'], ['software', 'Software'], ['terminal', 'Terminal']],
    windows: d => [['dashboard', 'Dashboard'], ['local', 'Lokaler Server'], ['roles', 'Rollen und Features'], ['ad', 'Active Directory'], ['dns', 'DNS'], ['dhcp', 'DHCP'], ['shares', 'Dateidienste'], ['services', 'Dienste'], ['firewall', 'Firewall'], ['terminal', 'PowerShell']],
    storage: d => [['dashboard', 'Dashboard'], ['pools', 'Speicherpools'], ['luns', 'LUNs'], ['hosts', 'Hosts und Zugriff'], ['ports', 'Ports und Controller']],
    fabric: d => [['dashboard', 'Dashboard'], ['ports', 'Ports'], ['zoning', 'Zoning'], ['fabric', 'Fabric']]
  };

  // ---------- Aktionen ausführen ----------
  function exec(G, cmds, ok) {
    const d = G.dev(); cmds = [].concat(cmds); let last = '';
    for (const c of cmds) { let out = ''; A.act(() => { out = A.exec(d, c); }); const bad = failed(out); G.log.push({ cmd: (A.isWn(d) ? 'PS> ' : '$ ') + c, err: bad }); last = out; if (bad) { G.msg = { err: true, t: String(out).split('\n').filter(Boolean).slice(0, 3).join(' ') }; G.log = G.log.slice(-8); return false; } }
    G.msg = ok ? { t: ok } : null; G.log = G.log.slice(-8); return last || true;
  }
  const res = (G, r, ok) => { G.msg = r && r.err ? { err: true, t: r.err } : (ok ? { t: ok } : null); return !(r && r.err); };
  const v = (G, id) => { const e = G.root.querySelector('#wf-' + id); return e ? (e.type === 'checkbox' ? e.checked : e.value) : ''; };

  // ---------- Seiten ----------
  const PAGES = { linux: {}, hypervisor: {}, windows: {}, storage: {}, fabric: {} };
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
  const ST = () => A.STOR;
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

  // ---------- Dialoge ----------
  function dlgHtml(d, G) {
    const x = G.dlg, k = x.k, net = A.net(), wrap = (t, body, ok, okLbl) => `<div class="wg-ov" data-act="dlgbg"><form class="wg-dlg" role="dialog" aria-modal="true" aria-label="${esc(t)}" data-act="dlgok"><h2>${t}</h2>${body}<div class="wg-row end">${btn('Abbrechen', 'dlgx', null, 'ghost')}${ok === false ? '' : `<button type="submit" class="wg-b primary" data-act="dlgok">${okLbl || 'OK'}</button>`}</div></form></div>`;
    const servers = Object.values(net.devs).filter(s => s.type === 'server' && !A.isCloud(s));
    switch (k) {
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
        case 'maplun': A.act(() => { root.querySelectorAll('[data-host]').forEach(c => A.STOR.maskLun(dv, +x.l, c.dataset.host, c.checked)); G.msg = { t: 'Zuordnung gespeichert.' }; }); break;
        case 'newzone2': A.act(() => { ok = res(G, A.STOR.zoneAdd(dv, v(G, 'n'), [v(G, 'i'), v(G, 't')]), 'Zone erstellt. Aktiviere das Zoneset, damit sie gilt.'); }); break;
      }
      if (ok) G.dlg = null; done();
    };
    root.addEventListener('submit', e => { e.preventDefault(); const f = e.target.closest('[data-act]'); if (!f) return; if (f.dataset.act === 'login') { SESS[G.id] = true; G.auth = true; G.msg = null; done(); } else if (f.dataset.act === 'dlgok') dlgOk(); else if (f.dataset.act === 'term') { const i = root.querySelector('#wg-cmd'); if (i && i.value.trim()) { A.termRun(d(), i.value); i.value = ''; } done(); } });
    root.addEventListener('change', e => {
      const t = e.target, a = t.dataset && t.dataset.act; if (!a) return; const dv = d(), net = A.net();
      if (a === 'enable') { if (exec(G, `sudo systemctl ${t.checked ? 'enable' : 'disable'} ${t.dataset.u}`, 'Autostart geändert.')) { } done(); }
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
        case 'close': if (G.onClose) G.onClose(); return;
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
        case 'dellun': A.act(() => { A.STOR.deleteLun(dv, +D.l); }); G.msg = { t: 'LUN gelöscht.' }; break;
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
  const OPEN = {}; let ZTOP = 40, CASCADE = 0;
  function open(devId) {
    const ex = OPEN[devId]; if (ex && document.body.contains(ex.host)) { ex.host.style.zIndex = ++ZTOP; ex.host.classList.remove('min'); return ex.G; }
    const vw = window.innerWidth, vh = window.innerHeight, w = Math.min(1040, vw - 24), h = Math.min(700, vh - 24), off = (CASCADE++ % 6) * 28;
    const host = document.createElement('div'); host.className = 'wg-float'; host.style.cssText = `left:${Math.max(8, Math.round((vw - w) / 2) + off - 70)}px;top:${Math.max(8, 40 + off)}px;width:${w}px;height:${h}px;z-index:${++ZTOP}`;
    const win = document.createElement('div'); host.appendChild(win); document.body.appendChild(host);
    const close = () => { host.remove(); delete OPEN[devId]; };
    // Verschieben an der Titelleiste, Doppelklick maximiert, Ziehen an der unteren rechten Ecke ändert die Größe
    let drag = null, saved = null;
    host.addEventListener('pointerdown', e => {
      host.style.zIndex = ++ZTOP;
      const bar = e.target.closest('.wg-chrome'); if (!bar || e.target.closest('button') || host.classList.contains('max')) return;
      drag = { x: e.clientX, y: e.clientY, l: host.offsetLeft, t: host.offsetTop }; host.setPointerCapture(e.pointerId); host.classList.add('moving');
    });
    host.addEventListener('pointermove', e => { if (!drag) return; const L = Math.min(window.innerWidth - 80, Math.max(80 - host.offsetWidth, drag.l + e.clientX - drag.x)), T = Math.min(window.innerHeight - 40, Math.max(0, drag.t + e.clientY - drag.y)); host.style.left = L + 'px'; host.style.top = T + 'px'; });
    const end = () => { drag = null; host.classList.remove('moving'); }; host.addEventListener('pointerup', end); host.addEventListener('pointercancel', end);
    host.addEventListener('dblclick', e => { const bar = host.querySelector('.wg-chrome'), r = bar && bar.getBoundingClientRect(); if (!r || e.clientY < r.top || e.clientY > r.bottom || e.target.closest('button')) return; if (host.classList.toggle('max')) { saved = host.style.cssText; host.style.cssText = `z-index:${ZTOP}`; } else if (saved) host.style.cssText = saved + `;z-index:${++ZTOP}`; });
    const G = bind(create(devId, win, { chrome: true, onClose: close })); OPEN[devId] = { host, G }; G.draw(); return G;
  }
  function mount(root, devId, o) { const G = bind(create(devId, root, Object.assign({ chrome: false }, o || {}))); G.draw(); return G; }
  // Testhilfe: Seitenaufbau ohne DOM
  function renderPage(devId, page) { const fake = { innerHTML: '', querySelector: () => null, addEventListener() { } }, G = create(devId, fake, { auth: true }); G.page = page; const d = G.dev(), k = kindOf(d); return PAGES[k][page](d, G); }
  const pages = devId => { const d = A.net().devs[devId]; const k = kindOf(d); return k ? NAV[k](d).map(n => n[0]) : []; };
  return { init, open, mount, hasGui, kindOf, PORT, renderPage, pages };
})();
if (typeof module !== 'undefined') module.exports = WEBGUI;
