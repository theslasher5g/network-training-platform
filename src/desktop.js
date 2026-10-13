// ===================== NetLab PC-Desktop =====================
// Ein Windows-ähnlicher Desktop für PCs und Notebooks: Fenster, Taskleiste, Startmenü und Programme
// (Eingabeaufforderung, Webbrowser, Netzwerkverbindungen, Datei-Explorer, Editor, Einstellungen).
// Alle Programme benutzen dieselben Funktionen wie Terminal und Web-GUI. Das Planer-Skript übergibt die Schnittstelle über init().
const DESKTOP = (function () {
  let A = null; const init = api => { A = api; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const OPEN = {};
  const IC = {
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    cmd: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12 15h5"/>',
    browser: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
    net: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    edit: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
    pc: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    start: '<path d="M3 5l8-1.2V11H3zM13 3.6L21 2v9h-8zM3 13h8v7.2L3 19zM13 13h8v9l-8-1.6z"/>',
    power: '<path d="M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0"/>'
  };
  const ico = (k, c) => `<svg class="dk-i ${c || ''}" viewBox="0 0 24 24" aria-hidden="true">${IC[k] || IC.file}</svg>`;
  const APPS = {
    explorer: { t: 'Datei-Explorer', ic: 'folder', w: 640, h: 400 }, cmd: { t: 'Eingabeaufforderung', ic: 'cmd', w: 640, h: 380 }, browser: { t: 'Webbrowser', ic: 'browser', w: 780, h: 480 },
    net: { t: 'Netzwerkverbindungen', ic: 'net', w: 500, h: 440 }, edit: { t: 'Editor', ic: 'edit', w: 520, h: 380 }, settings: { t: 'Einstellungen', ic: 'settings', w: 520, h: 420 }
  };
  const parentOf = k => { const r = k.replace(/\\[^\\]*$/, ''); return r.length <= 2 ? k.slice(0, 2) + '\\' : r; };
  const baseOf = k => k.replace(/^.*\\/, '') || k;
  const HOME = 'C:\\Users\\Benutzer';

  function open(devId) {
    const ex = OPEN[devId]; if (ex && document.body.contains(ex.host)) { ex.host.style.zIndex = 9000; ex.host.classList.remove('min'); return ex; }
    const f = A.GUI.floatFrame({ w: 1120, h: 720, cls: 'dk-host', handle: '.dk-title', onClose: () => { delete OPEN[devId]; } });
    const h = build(devId, f.body, f); OPEN[devId] = h; return h;
  }
  // Eingebettet (Tab "Systeme"): kein eigener Fensterrahmen
  function mount(root, devId) { return build(devId, root, null); }
  function build(devId, root, f) {
    const dev = () => A.net().devs[devId], W = () => A.WIN.init(dev()), files = () => W().files;
    let z = 10, seq = 0, menu = false; const wins = []; f = f || { host: root, close() { } };
    root.innerHTML = `<div class="dk ${f.body ? '' : 'emb'}" tabindex="-1">${f.body ? `<div class="dk-title" role="presentation"><span class="wg-dots"><i></i><i></i><i></i></span><b>${esc(dev().cfg.hostname)}</b><span class="dk-sub">Windows 11 · Desktop</span><button class="wg-x" data-g="close" aria-label="Desktop schließen">✕</button></div>` : ''}
      <div class="dk-screen" id="dk-screen"><div class="dk-icons" id="dk-icons"></div></div>
      <div class="dk-off" id="dk-off" hidden></div><div class="dk-menu" id="dk-menu" hidden></div>
      <div class="dk-task"><button class="dk-start" data-g="menu" aria-label="Startmenü" aria-expanded="false">${ico('start')}</button><div class="dk-run" id="dk-run"></div><div class="dk-tray" id="dk-tray"></div></div></div>`;
    const $ = s => root.querySelector(s), screen = $('#dk-screen');

    // ---------- Desktop-Symbole, Startmenü, Taskleiste ----------
    const desk = () => Object.keys(files()).filter(k => parentOf(k) === HOME + '\\Desktop' && !files()[k].d);
    const drawIcons = () => {
      const base = [['explorer', 'Dieser PC', 'pc'], ['cmd', 'Eingabeauf&shy;forderung', 'cmd'], ['browser', 'Webbrowser', 'browser'], ['net', 'Netzwerk', 'net'], ['edit', 'Editor', 'edit'], ['settings', 'Einstellungen', 'settings']];
      $('#dk-icons').innerHTML = base.map(([a, n, i]) => `<button class="dk-ic" data-app="${a}" ${a === 'explorer' ? 'data-arg="PC"' : ''}>${ico(i)}<span>${n}</span></button>`).join('') + desk().map(p => `<button class="dk-ic" data-app="edit" data-arg="${esc(p)}">${ico('file')}<span>${esc(baseOf(p))}</span></button>`).join('');
    };
    const drawMenu = () => {
      const m = $('#dk-menu'); m.hidden = !menu; $('.dk-start').setAttribute('aria-expanded', menu);
      if (menu) m.innerHTML = `<div class="dk-mh">${esc(dev().cfg.hostname)} · Benutzer</div>${Object.entries(APPS).map(([a, x]) => `<button data-app="${a}" data-arg="">${ico(x.ic)}<span>${x.t}</span></button>`).join('')}<hr><button data-g="close">${ico('power')}<span>Herunterfahren (Desktop schließen)</span></button>`;
    };
    const ipOf = () => { const d = dev(), p = d.ports.find(q => d.pk[q] !== 'fc'), h = p && A.hip(d, p); return { p, ip: h && h.ip, up: p && A.status(d, p) === 'connected' }; };
    const drawTask = () => {
      const top = Math.max(0, ...wins.filter(w => !w.min).map(w => w.z));
      $('#dk-run').innerHTML = wins.map(w => `<button class="dk-tb ${!w.min && w.z === top ? 'act' : ''}" data-tb="${w.id}" title="${esc(w.title)}">${ico(APPS[w.app].ic)}<span>${esc(w.title)}</span></button>`).join('');
      const n = ipOf(), t = new Date();
      $('#dk-tray').innerHTML = `<span class="dk-net ${n.up ? 'up' : 'dn'}" title="${n.up ? 'Verbunden' + (n.ip ? ', ' + esc(n.ip) : ', keine IP-Adresse') : 'Kein Netzwerkkabel verbunden'}">${ico('net')}</span><span class="dk-clock">${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}</span>`;
    };
    let lastPs = null, lastMin = -1;
    const drawPower = () => {
      const ps = A.powerState(dev()), el = $('#dk-off'); if (ps === lastPs) return; lastPs = ps; el.hidden = ps === 'on';
      if (ps === 'off') { el.innerHTML = `${ico('pc')}<h2>${esc(dev().cfg.hostname)} ist ausgeschaltet</h2><p>Schalte den PC ein, dann startet Windows.</p><button class="dk-b pri" data-g="pwron">Einschalten</button>`; }
      else if (ps === 'boot') { el.innerHTML = `${ico('pc')}<h2>Windows startet …</h2><div class="wg-boot"><i style="animation-duration:${A.bootLeft(dev())}ms"></i></div>`; }
    };
    const tick = setInterval(() => { if (!document.body.contains(f.host)) { clearInterval(tick); return; } drawPower(); const m = new Date().getMinutes(); if (m !== lastMin) { lastMin = m; drawTask(); } }, 1000);

    // ---------- Fenster ----------
    const place = w => { const e = w.el; e.classList.toggle('max', !!w.max); e.hidden = !!w.min; e.style.zIndex = w.z; if (!w.max) { e.style.left = w.x + 'px'; e.style.top = w.y + 'px'; e.style.width = w.w + 'px'; e.style.height = w.h + 'px'; } else { e.style.left = e.style.top = e.style.width = e.style.height = ''; } e.classList.toggle('foc', w === focused()); };
    const focused = () => wins.filter(w => !w.min).sort((a, b) => b.z - a.z)[0];
    const focus = w => { w.z = ++z; w.min = false; wins.forEach(place); drawTask(); };
    const closeWin = w => { w.el.remove(); wins.splice(wins.indexOf(w), 1); wins.forEach(place); drawTask(); };
    function launch(app, arg) {
      const a = APPS[app], sw = screen.clientWidth || 900, sh = screen.clientHeight || 560, n = seq++ % 6;
      const w = { id: 'w' + (++z), app, arg: arg || '', title: a.t, x: Math.min(40 + n * 30, Math.max(0, sw - 260)), y: 24 + n * 30, w: Math.min(a.w, sw - 8), h: Math.min(a.h, sh - 8), z: ++z, min: false, max: false, s: {} };
      const e = document.createElement('div'); e.className = 'dk-win'; e.dataset.id = w.id; e.setAttribute('role', 'dialog'); e.setAttribute('aria-label', a.t);
      e.innerHTML = `<div class="dk-wt">${ico(a.ic)}<b class="dk-wtitle">${esc(a.t)}</b><span class="sp"></span><button data-w="min" aria-label="Minimieren">–</button><button data-w="max" aria-label="Maximieren">▢</button><button data-w="x" class="cl" aria-label="Schließen">✕</button></div><div class="dk-wb"></div>`;
      w.el = e; w.body = e.querySelector('.dk-wb'); screen.appendChild(e); wins.push(w); w.setTitle = t => { w.title = t; e.querySelector('.dk-wtitle').textContent = t; drawTask(); };
      try { MOUNT[app](w); } catch (x) { w.body.innerHTML = `<p class="dk-err">Fehler: ${esc(x.message)}</p>`; console.error(x); }
      focus(w); const first = w.body.querySelector('input,textarea'); if (first) first.focus(); return w;
    }
    const msg = (w, t, err) => { const m = w.body.querySelector('.dk-msg'); if (m) { m.textContent = t; m.className = 'dk-msg ' + (err ? 'err' : 'ok'); } };
    const run = line => { let o = ''; A.act(() => { o = A.exec(dev(), line); }); return String(o || ''); };

    // ---------- Programme ----------
    const MOUNT = {};
    MOUNT.cmd = w => {
      const d = dev(), hist = []; let hi = 0; w.body.innerHTML = `<div class="dk-term"><div class="dk-out" role="log" aria-live="polite"></div><form class="dk-in"><label for="${w.id}-c">${esc(A.prompt(d))}</label><input id="${w.id}-c" autocomplete="off" spellcheck="false" aria-label="Befehl"></form></div>`;
      const out = w.body.querySelector('.dk-out'), inp = w.body.querySelector('input'), lab = w.body.querySelector('label');
      const show = () => { out.innerHTML = A.termOut(dev()).map(o => `<div class="k-${o.c}">${esc(o.t) || '&nbsp;'}</div>`).join(''); out.scrollTop = 1e9; lab.textContent = A.prompt(dev()); };
      w.body.querySelector('form').onsubmit = e => { e.preventDefault(); const v = inp.value; if (!v.trim()) return; hist.push(v); hi = hist.length; inp.value = ''; A.termRun(dev(), v); show(); drawTask(); };
      inp.onkeydown = e => { if (e.key === 'ArrowUp' && hi > 0) { inp.value = hist[--hi]; e.preventDefault(); } else if (e.key === 'ArrowDown' && hi < hist.length) { inp.value = hist[++hi] || ''; e.preventDefault(); } };
      w.body.onclick = e => { if (!window.getSelection().toString()) inp.focus(); }; show();
    };
    MOUNT.browser = w => {
      w.body.innerHTML = `<div class="dk-br"><form class="dk-url"><button type="button" class="dk-nb" data-h="home" aria-label="Startseite">⌂</button><input value="" placeholder="http://web.lab.local oder https://192.168.1.2/" aria-label="Adresse" autocomplete="off" spellcheck="false"><button class="dk-b pri" type="submit">Los</button></form><div class="dk-page"></div></div>`;
      const inp = w.body.querySelector('input'), page = w.body.querySelector('.dk-page');
      const show = () => {
        const r = w.s.res; page.innerHTML = '';
        if (w.s.gui && A.net().devs[w.s.gui]) { const c = document.createElement('div'); c.className = 'dk-guihost'; page.appendChild(c); A.GUI.mount(c, w.s.gui, {}); return; }
        page.innerHTML = !r ? `<div class="dk-home"><h2>Startseite</h2><p>Gib oben eine Adresse ein. Namen werden über den DNS-Server der IP-Konfiguration aufgelöst.</p><p>Beispiele: <code>http://web.lab.local</code> für Webserver, <code>https://&lt;IP-Adresse&gt;/</code> für die Oberfläche eines Switches oder Routers, <code>https://&lt;IP-Adresse&gt;:8443</code> für Server und Storage.</p></div>`
          : r.err ? `<div class="neterr"><h2>Seite nicht erreichbar</h2><p>${esc(r.err)}</p>${r.why ? `<p class="dk-why">${esc(r.why)}</p>` : ''}</div>`
            : `<div class="dk-home"><h2>${esc(r.title)}</h2><p>${esc(r.body).replace(/\n/g, '<br>')}</p><p class="dk-why">${r.scheme}://${esc(r.host)} → ${r.ip}:${r.port}</p></div>`;
        w.setTitle((r && r.title ? r.title : w.s.gui ? 'Weboberfläche' : 'Webbrowser') + ' – Browser');
      };
      const go = () => { const u = inp.value.trim(); w.s.gui = null; if (!u) { w.s.res = null; show(); return; } const gt = A.guiTarget(dev(), u); if (gt && gt.id) { w.s.gui = gt.id; w.s.res = null; } else w.s.res = gt || A.httpGet(dev(), u); show(); };
      w.body.querySelector('form').onsubmit = e => { e.preventDefault(); go(); }; w.body.querySelector('[data-h]').onclick = () => { inp.value = ''; go(); };
      if (w.arg) { inp.value = w.arg; go(); } else show();
    };
    MOUNT.net = w => {
      const draw = () => {
        const d = dev(), ports = d.ports.filter(p => d.pk[p] !== 'fc'); if (!ports.includes(w.s.p)) w.s.p = ports[0];
        const p = w.s.p, prim = p === d.ports[0], cur = A.hip(d, p) || {}, dh = prim && d.cfg.dhcp, ro = dh ? 'disabled' : '', up = A.status(d, p) === 'connected';
        w.body.innerHTML = `<div class="dk-pad"><div class="dk-adapter ${up ? 'up' : 'dn'}">${ico('net')}<div><b>${esc(A.SH(p))}</b><span>${up ? 'Verbunden' : 'Netzwerkkabel nicht angeschlossen'}</span></div></div>
          ${ports.length > 1 ? `<div class="dk-f"><label for="${w.id}-p">Netzwerkadapter</label><select id="${w.id}-p">${ports.map(q => `<option value="${esc(q)}" ${q === p ? 'selected' : ''}>${esc(A.SH(q))}${(A.hip(d, q) || {}).ip ? ' – ' + esc(A.hip(d, q).ip) : ''}</option>`).join('')}</select></div>` : ''}
          ${prim ? `<div class="dk-radio"><label><input type="radio" name="${w.id}-m" value="dhcp" ${dh ? 'checked' : ''}> IP-Adresse automatisch beziehen (DHCP)</label><label><input type="radio" name="${w.id}-m" value="static" ${dh ? '' : 'checked'}> Folgende IP-Adresse verwenden</label></div>` : ''}
          <div class="dk-2"><div class="dk-f"><label for="${w.id}-ip">IP-Adresse</label><input id="${w.id}-ip" value="${esc(cur.ip || '')}" ${ro}></div><div class="dk-f"><label for="${w.id}-mk">Subnetzmaske</label><input id="${w.id}-mk" value="${esc(cur.mask || '')}" placeholder="255.255.255.0" ${ro}></div></div>
          ${prim ? `<div class="dk-2"><div class="dk-f"><label for="${w.id}-gw">Standardgateway</label><input id="${w.id}-gw" value="${esc(d.cfg.gw || '')}" ${ro}></div><div class="dk-f"><label for="${w.id}-dns">DNS-Server</label><input id="${w.id}-dns" value="${esc(d.cfg.dns || '')}" ${ro}></div></div>` : ''}
          <div class="dk-row"><button class="dk-b pri" data-n="ok">OK</button></div><p class="dk-msg" aria-live="polite"></p></div>`;
        const g = k => w.body.querySelector(`#${w.id}-${k}`);
        if (g('p')) g('p').onchange = e => { w.s.p = e.target.value; draw(); };
        w.body.querySelectorAll(`input[name="${w.id}-m"]`).forEach(r => r.onchange = () => { const x = r.value === 'dhcp'; ['ip', 'mk', 'gw', 'dns'].forEach(k => { if (g(k)) g(k).disabled = x; }); });
        w.body.querySelector('[data-n=ok]').onclick = () => {
          const mode = prim ? w.body.querySelector(`input[name="${w.id}-m"]:checked`).value : 'static';
          if (mode === 'dhcp') { let m, bad = false; A.act(() => { d.cfg.dhcp = true; const r = A.dhcp(d); bad = !!r.err; m = r.err ? 'DHCP fehlgeschlagen: ' + r.err : `DHCP-Zuweisung von ${r.server}: ${r.ip}/${A.maskLen(r.mask)}, Gateway ${r.gw || '–'}, DNS ${r.dns || '–'}`; }); draw(); msg(w, m, bad); drawTask(); return; }
          const ip = g('ip').value.trim(), mk = g('mk').value.trim(), gw = prim ? g('gw').value.trim() : '', dns = prim ? g('dns').value.trim() : '';
          if (ip && (!A.validIp(ip) || A.maskLen(mk) === null)) return msg(w, 'Ungültige IP-Adresse oder Subnetzmaske.', true);
          if (gw && (!A.validIp(gw) || !A.inNet(gw, ip, mk))) return msg(w, 'Das Gateway liegt nicht im Subnetz der IP-Adresse.', true);
          if (dns && !A.validIp(dns)) return msg(w, 'Ungültiger DNS-Server.', true);
          A.act(() => { if (prim) d.cfg.dhcp = false; A.setIp(d, p, ip || null, ip ? mk : null); if (prim) { d.cfg.gw = gw || null; d.cfg.dns = dns || null; } }); draw(); msg(w, 'Gespeichert.'); drawTask();
        };
      };
      draw();
    };
    const sizeOf = k => { const x = files()[k]; return x.d ? '' : ((x.t || '').length + ' B'); };
    MOUNT.explorer = w => {
      w.s.path = w.arg === 'PC' ? '' : (w.arg || HOME + '\\Documents'); w.s.sel = null; w.s.mk = null;
      const exists = p => p === '' || /^[A-Z]:\\$/.test(p) || !!files()[p];
      const draw = () => {
        const p = w.s.path, fl = files(), kids = p === '' ? ['C:\\', 'D:\\'].filter(x => x === 'C:\\' || fl[x]) : Object.keys(fl).filter(k => k !== p && parentOf(k) === p).sort((a, b) => (fl[b] && fl[b].d ? 1 : 0) - (fl[a] && fl[a].d ? 1 : 0) || a.localeCompare(b));
        w.setTitle(p === '' ? 'Dieser PC' : baseOf(p) + ' – Explorer');
        const quick = [['Desktop', HOME + '\\Desktop'], ['Dokumente', HOME + '\\Documents'], ['Downloads', HOME + '\\Downloads'], ['Dieser PC', '']];
        w.body.innerHTML = `<div class="dk-ex"><nav class="dk-qa" aria-label="Schnellzugriff">${quick.map(([n, q]) => `<button class="${q === p ? 'act' : ''}" data-go="${esc(q)}">${ico(q === '' ? 'pc' : 'folder')}${n}</button>`).join('')}</nav>
          <div class="dk-main"><div class="dk-bar"><button class="dk-nb" data-up aria-label="Eine Ebene nach oben" ${p === '' ? 'disabled' : ''}>${ico('up')}</button><input class="dk-addr" value="${esc(p || 'Dieser PC')}" readonly aria-label="Pfad">${p === '' ? '' : `<button class="dk-b" data-mk="dir">Neuer Ordner</button><button class="dk-b" data-mk="file">Neue Textdatei</button><button class="dk-b" data-del ${w.s.sel ? '' : 'disabled'}>Löschen</button>`}</div>
          ${w.s.mk ? `<form class="dk-mk"><label for="${w.id}-n">${w.s.mk === 'dir' ? 'Ordnername' : 'Dateiname'}</label><input id="${w.id}-n" autocomplete="off" value="${w.s.mk === 'dir' ? 'Neuer Ordner' : 'Neu.txt'}"><button class="dk-b pri" type="submit">Anlegen</button><button class="dk-b" type="button" data-mkx>Abbrechen</button></form>` : ''}
          <div class="dk-list" role="listbox" aria-label="Inhalt">${kids.length ? kids.map(k => { const isD = k.length <= 3 || (fl[k] && fl[k].d); return `<button class="dk-fi ${w.s.sel === k ? 'act' : ''}" role="option" aria-selected="${w.s.sel === k}" data-p="${esc(k)}" data-d="${isD ? 1 : 0}">${ico(isD ? 'folder' : 'file')}<span class="n">${esc(k.length <= 3 ? k + ' (' + (k[0] === 'C' ? 'Lokaler Datenträger' : 'Daten') + ')' : baseOf(k))}</span><span class="s">${isD ? '' : esc(sizeOf(k))}</span></button>`; }).join('') : '<p class="dk-empty">Dieser Ordner ist leer.</p>'}</div><p class="dk-msg" aria-live="polite"></p></div></div>`;
        const b = w.body;
        b.querySelectorAll('[data-go]').forEach(x => x.onclick = () => { w.s.path = x.dataset.go; w.s.sel = null; draw(); });
        const up = b.querySelector('[data-up]'); up.onclick = () => { w.s.path = w.s.path.length <= 3 ? '' : parentOf(w.s.path); w.s.sel = null; draw(); };
        b.querySelectorAll('.dk-fi').forEach(x => { x.onclick = () => { w.s.sel = x.dataset.p; draw(); const again = w.body.querySelector(`.dk-fi[data-p="${CSS.escape(x.dataset.p)}"]`); if (again) again.focus(); }; x.ondblclick = () => { if (x.dataset.d === '1') { w.s.path = x.dataset.p; w.s.sel = null; draw(); } else launch('edit', x.dataset.p); }; });
        b.querySelectorAll('[data-mk]').forEach(x => x.onclick = () => { w.s.mk = x.dataset.mk; draw(); const i = w.body.querySelector('.dk-mk input'); if (i) { i.focus(); i.select(); } });
        const mx = b.querySelector('[data-mkx]'); if (mx) mx.onclick = () => { w.s.mk = null; draw(); };
        const mf = b.querySelector('.dk-mk'); if (mf) mf.onsubmit = e => { e.preventDefault(); const n = mf.querySelector('input').value.trim().replace(/[\\/:*?"<>|]/g, ''), np = (w.s.path.endsWith('\\') ? w.s.path : w.s.path + '\\') + n; if (!n) return; if (files()[np]) { w.s.mk = null; draw(); msg(w, `„${n}“ gibt es hier schon.`, true); return; } A.act(() => { files()[np] = w.s.mk === 'dir' ? { d: 1 } : { t: '' }; }); w.s.mk = null; draw(); drawIcons(); msg(w, 'Angelegt.'); };
        const del = b.querySelector('[data-del]'); if (del) del.onclick = () => { const s = w.s.sel; if (!s) return; A.act(() => { Object.keys(files()).forEach(k => { if (k === s || k.startsWith(s + '\\')) delete files()[k]; }); }); w.s.sel = null; draw(); drawIcons(); msg(w, 'Gelöscht.'); };
      };
      if (!exists(w.s.path)) w.s.path = HOME; draw();
    };
    MOUNT.edit = w => {
      w.s.path = w.arg || ''; const fl = files();
      w.body.innerHTML = `<div class="dk-ed"><form class="dk-bar"><input class="dk-addr" aria-label="Dateipfad" placeholder="C:\\Users\\Benutzer\\Documents\\Neu.txt" value="${esc(w.s.path)}"><button class="dk-b pri" type="submit">Speichern</button></form><textarea aria-label="Text" spellcheck="false"></textarea><p class="dk-msg" aria-live="polite"></p></div>`;
      const ta = w.body.querySelector('textarea'), ad = w.body.querySelector('.dk-addr'); ta.value = w.s.path && fl[w.s.path] && !fl[w.s.path].d ? fl[w.s.path].t || '' : '';
      w.setTitle((w.s.path ? baseOf(w.s.path) : 'Unbenannt') + ' – Editor');
      w.body.querySelector('form').onsubmit = e => {
        e.preventDefault(); const p = ad.value.trim().replace(/\\$/, ''); if (!/^[A-Z]:\\.+/.test(p)) return msg(w, 'Gib einen vollständigen Pfad an, z. B. C:\\Users\\Benutzer\\Documents\\Neu.txt.', true);
        if (!files()[parentOf(p)] && parentOf(p).length > 3) return msg(w, `Der Ordner ${parentOf(p)} existiert nicht. Lege ihn im Explorer an.`, true);
        if (files()[p] && files()[p].d) return msg(w, 'Das ist ein Ordner.', true);
        A.act(() => { files()[p] = { t: ta.value }; A.WIN.sync(A.ctx(), dev()); }); w.s.path = p; w.setTitle(baseOf(p) + ' – Editor'); msg(w, 'Gespeichert.'); drawIcons();
      };
    };
    MOUNT.settings = w => {
      const draw = () => {
        const d = dev(), x = W(), n = ipOf();
        w.body.innerHTML = `<div class="dk-pad"><h3>System</h3><dl class="dk-dl"><dt>Gerätename</dt><dd>${esc(d.cfg.hostname)}${x.pendingName ? ` <small>(wird nach Neustart zu ${esc(x.pendingName)})</small>` : ''}</dd><dt>Edition</dt><dd>Windows 11 Pro</dd><dt>Domäne</dt><dd>${x.domain ? esc(x.domain.name) : 'Arbeitsgruppe WORKGROUP'}</dd><dt>IP-Adresse</dt><dd>${n.ip ? esc(n.ip) : '<span class="dk-mut">keine</span>'}</dd><dt>Standardgateway</dt><dd>${esc(d.cfg.gw || '–')}</dd><dt>DNS-Server</dt><dd>${esc(d.cfg.dns || '–')}</dd></dl>
          <h3>Gerät umbenennen</h3><form class="dk-row" data-f="rn"><input id="${w.id}-rn" placeholder="neuer Name" aria-label="Neuer Gerätename"><button class="dk-b" type="submit">Umbenennen</button></form>
          <h3>Mit einer Domäne verbinden</h3><form class="dk-row" data-f="jn"><input id="${w.id}-dom" placeholder="firma.local" aria-label="Domänenname"><input id="${w.id}-usr" placeholder="Administrator" aria-label="Benutzername" value="Administrator"><button class="dk-b pri" type="submit">Beitreten</button></form><p class="dk-msg" aria-live="polite"></p></div>`;
        const g = k => w.body.querySelector(`#${w.id}-${k}`), ok = (o, t) => { const bad = /^\S+ : |nicht|fehl|error|Fehler/i.test(o) && !!o.trim(); draw(); msg(w, bad ? o.split('\n').filter(Boolean).slice(0, 2).join(' ') : t, bad); };
        w.body.querySelector('[data-f=rn]').onsubmit = e => { e.preventDefault(); const n = g('rn').value.trim(); if (n) { const o = run(`Rename-Computer -NewName ${n}`); ok(o, 'Der Name gilt nach dem Neustart.'); } };
        w.body.querySelector('[data-f=jn]').onsubmit = e => { e.preventDefault(); const dm = g('dom').value.trim(), u = g('usr').value.trim() || 'Administrator'; if (dm) { const o = run(`Add-Computer -DomainName ${dm} -Credential ${u}`); ok(o, 'Der Domäne beigetreten.'); } };
      };
      draw();
    };

    // ---------- Ereignisse ----------
    const winOf = el => { const e = el.closest('.dk-win'); return e && wins.find(w => w.id === e.dataset.id); };
    let drag = null;
    root.addEventListener('pointerdown', e => {
      f.host.style.zIndex = Math.max(+f.host.style.zIndex || 0, 41);
      if (menu && !e.target.closest('#dk-menu') && !e.target.closest('.dk-start')) { menu = false; drawMenu(); }
      const w = winOf(e.target); if (!w) return; if (w !== focused()) focus(w);
      const bar = e.target.closest('.dk-wt'); if (!bar || e.target.closest('button') || w.max) return;
      drag = { w, x: e.clientX, y: e.clientY, l: w.x, t: w.y }; bar.setPointerCapture(e.pointerId); bar.classList.add('moving');
    });
    root.addEventListener('pointermove', e => { if (!drag) return; const sw = screen.clientWidth, sh = screen.clientHeight, w = drag.w; w.x = Math.min(sw - 60, Math.max(60 - w.w, drag.l + e.clientX - drag.x)); w.y = Math.min(sh - 30, Math.max(0, drag.t + e.clientY - drag.y)); w.el.style.left = w.x + 'px'; w.el.style.top = w.y + 'px'; });
    const stop = () => { if (drag) { const e = drag.w.el.querySelector('.dk-wt'); e.classList.remove('moving'); drag.w.w = drag.w.el.offsetWidth; drag.w.h = drag.w.el.offsetHeight; } drag = null; };
    root.addEventListener('pointerup', stop); root.addEventListener('pointercancel', stop);
    root.addEventListener('dblclick', e => { const bar = e.target.closest('.dk-wt'); if (bar && !e.target.closest('button')) { const w = winOf(bar); w.max = !w.max; place(w); return; } const ic = e.target.closest('.dk-ic'); if (ic) { launch(ic.dataset.app, ic.dataset.arg); } });
    root.addEventListener('click', e => {
      const t = e.target, g = t.closest('[data-g]'), wb = t.closest('[data-w]'), tb = t.closest('[data-tb]'), ap = t.closest('#dk-menu [data-app]'), ic = t.closest('.dk-ic');
      if (g) { if (g.dataset.g === 'pwron') { A.powerOn(devId); drawPower(); } else if (g.dataset.g === 'close') f.close(); else if (g.dataset.g === 'menu') { menu = !menu; drawMenu(); } return; }
      if (wb) { const w = winOf(wb); if (wb.dataset.w === 'x') closeWin(w); else if (wb.dataset.w === 'min') { w.min = true; wins.forEach(place); drawTask(); } else { w.max = !w.max; place(w); } return; }
      if (tb) { const w = wins.find(x => x.id === tb.dataset.tb); if (w === focused()) { w.min = true; wins.forEach(place); drawTask(); } else focus(w); return; }
      if (ap) { menu = false; drawMenu(); launch(ap.dataset.app, ap.dataset.arg); return; }
      if (ic) { root.querySelectorAll('.dk-ic.sel').forEach(x => x.classList.remove('sel')); ic.classList.add('sel'); return; }
      if (t.closest('#dk-screen') && !t.closest('.dk-win')) root.querySelectorAll('.dk-ic.sel').forEach(x => x.classList.remove('sel'));
    });
    root.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('dk-ic')) launch(e.target.dataset.app, e.target.dataset.arg); if (e.key === 'Escape' && menu) { menu = false; drawMenu(); } });
    drawIcons(); drawTask(); drawPower();
    return { host: f.host, close: f.close, launch, wins };
  }
  return { init, open, mount };
})();
if (typeof module !== 'undefined') module.exports = DESKTOP;
