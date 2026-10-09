// ===================== NetLab UI =====================
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem('netlab.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('netlab.' + k, JSON.stringify(v)); } catch (e) { } },
    del(k) { try { localStorage.removeItem('netlab.' + k); } catch (e) { } }
  };
  const ALL = LABS.list;
  let done = new Set(store.get('done', []));
  const app = $('#app');
  const TYPE = { cli: 'CLI-Lab', subnet: 'Trainer', quiz: 'Theorie', ise: 'Policy-Lab', ssl: 'Policy-Lab' };
  let cur = null;

  function leds() {
    $('#leds').innerHTML = ALL.map((l, i) => `<a href="#lab/${l.id}" class="hled ${done.has(l.id) ? 'on' : ''}" title="${i + 1}. ${esc(l.title)}${done.has(l.id) ? ' (erledigt)' : ''}" aria-label="Lab ${i + 1}: ${esc(l.title)}"></a>`).join('');
    $('#count').textContent = `${done.size}/${ALL.length}`;
  }
  function markDone(id) { if (done.has(id)) return false; done.add(id); store.set('done', [...done]); leds(); return true; }

  // ---------------- Home ----------------
  function home() {
    cur = null; document.title = 'NetLab – Cisco-Netzwerke lernen';
    const tracks = [...new Set(ALL.map(l => l.track))];
    const next = ALL.find(l => !done.has(l.id));
    app.innerHTML = `
      <section class="hero">
        <h1>Netzwerke lernt man, indem man sie baut.</h1>
        <p class="lede">Echte Cisco-IOS-Befehle, ein Simulator, der Pakete wirklich durch VLANs, Trunks, Router, ACLs und IPsec-Tunnel schickt – und ein Ping-Debugger, der dir zeigt, wo sie hängen bleiben.</p>
        <div class="cta">${next ? `<a class="btn primary" href="#lab/${next.id}">${done.size ? 'Weiter mit' : 'Starten mit'} „${esc(next.title)}“</a>` : '<span class="allgood">Alle Labs abgeschlossen. Stark.</span>'}
        <a class="btn" href="#sandbox">Eigenes Netz planen</a></div>
      </section>
      <a class="planner" href="#sandbox">
        <span class="pl-t">Netzplaner</span>
        <span class="pl-d">Baue dein Netz mit echter Hardware: Catalyst 9200L/9500, ASA-Firewall, MDS-FC-Switch, Huawei-Server mit frei bestückbaren RoCE-/FC-Karten und OceanStor-Storage. Jedes Gerät zeigt seine echten Ports mit Belegung, du steckst Transceiver und Kabel Port für Port, baust das Rack und exportierst am Ende geprüfte Configs, FC-Zoning, Hardware-Blätter und Patchliste.</span>
      </a>
      <section class="rack" aria-label="Lernpfad">
        ${tracks.map(t => `<div class="rack-row">
          <h2 class="rack-label">${esc(t)}</h2>
          <div class="ports">${ALL.map((l, i) => l.track !== t ? '' : `
            <a class="port ${done.has(l.id) ? 'on' : ''}" href="#lab/${l.id}">
              <span class="jack" aria-hidden="true"><span class="led"></span><span class="pin"></span><span class="pnum">${i + 1}</span></span>
              <span class="ptitle">${esc(l.title)}</span>
              <span class="pmeta">${TYPE[l.type]}, ${l.est}${done.has(l.id) ? ', erledigt' : ''}</span>
            </a>`).join('')}</div></div>`).join('')}
      </section>
      <section class="howto">
        <div><h3>So funktioniert ein Lab</h3><p>Links stehen die Aufgaben. Sie haken sich live ab, sobald dein Netz sie erfüllt. Klick auf ein Gerät öffnet seine Konsole – dort tippst du IOS-Befehle wie am echten Gerät, inklusive Abkürzungen wie <code>conf t</code> oder <code>sh ip int br</code>.</p></div>
        <div><h3>Wenn ein Ping scheitert</h3><p>Der Simulator verfolgt jedes Paket Hop für Hop und nennt den Grund: falsches VLAN, fehlender Trunk, Interface im shutdown, fehlende Rückroute, ACL-Treffer oder ein IKEv2-Proposal, das nicht passt.</p></div>
        <div><h3>Dein Fortschritt</h3><p>Konfigurationen und erledigte Labs speichert dein Browser auf diesem Gerät. Jedes Lab lässt sich zurücksetzen.</p></div>
      </section>`;
  }

  // ---------------- Shell ----------------
  function shell(lab, main) {
    const i = ALL.indexOf(lab);
    document.title = lab.title + ' – NetLab';
    app.innerHTML = `<div class="lab">
      <aside class="side">
        <a class="back" href="#">Alle Labs</a>
        <p class="crumb">Lab ${i + 1} in ${esc(lab.track)}</p>
        <h1 class="ltitle">${esc(lab.title)}</h1>
        <p class="intro">${lab.intro}</p>
        ${lab.spec ? `<div class="spec"><table>${lab.spec.map((r, k) => `<tr>${r.map(c => k ? `<td>${esc(c)}</td>` : `<th>${esc(c)}</th>`).join('')}</tr>`).join('')}</table></div>` : ''}
        <div id="banner"></div>
        <h2 class="sh">Aufgaben</h2>
        <ul class="tasks" id="tasks"></ul>
        ${lab.hints ? `<details class="hints"><summary>Hinweise (${lab.hints.length})</summary><ol>${lab.hints.map(h => `<li>${h}</li>`).join('')}</ol></details>` : ''}
        <div class="actions">${lab.sol ? '<button class="btn" id="solBtn">Lösung ansehen</button>' : ''}<button class="btn ghost" id="resetBtn">Lab zurücksetzen</button></div>
      </aside>
      <section class="main">${main}</section></div>`;
    $('#resetBtn').onclick = () => { if (confirm('Lab zurücksetzen? Deine Konfiguration in diesem Lab geht verloren.')) { store.del('state.' + lab.id); route(); } };
    if (lab.sol) $('#solBtn').onclick = () => showSol(lab);
  }
  function renderTasks(list, lab) {
    $('#tasks').innerHTML = list.map(t => `<li class="${t.ok ? 'ok' : ''}"><span class="box" aria-hidden="true"></span><span><span class="sr">${t.ok ? 'Erledigt: ' : 'Offen: '}</span>${t.t}${t.note && !t.ok ? `<span class="tnote">${esc(t.note)}</span>` : ''}</span></li>`).join('');
    const all = list.length && list.every(t => t.ok);
    if (all) {
      const fresh = markDone(lab.id);
      const nx = ALL[ALL.indexOf(lab) + 1];
      $('#banner').innerHTML = `<div class="banner ${fresh ? 'fresh' : ''}" role="status"><strong>Lab abgeschlossen.</strong> ${nx ? `<a href="#lab/${nx.id}">Weiter: ${esc(nx.title)}</a>` : '<a href="#">Zur Übersicht</a>'}</div>`;
    } else $('#banner').innerHTML = '';
  }
  function modal(html) {
    const m = document.createElement('div'); m.className = 'modal'; m.innerHTML = `<div class="mbox" role="dialog" aria-modal="true">${html}<button class="btn ghost mclose">Schließen</button></div>`;
    document.body.appendChild(m); const close = () => m.remove();
    m.addEventListener('click', e => { if (e.target === m || e.target.classList.contains('mclose')) close(); });
    document.addEventListener('keydown', function k(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', k); } });
    $('.mclose', m).focus(); return m;
  }
  function showSol(lab) {
    const m = modal(`<h2>Musterlösung</h2><p class="muted">Versuch es zuerst selbst – der Ping-Debugger hilft. Es gibt oft mehrere richtige Wege.</p>
      ${Object.entries(lab.sol).map(([id, l]) => `<h3>${esc(cur.net.devs[id].cfg.hostname)}</h3><pre class="code">${esc(l.join('\n'))}</pre>`).join('')}
      <button class="btn primary" id="runSol">Lösung in die Geräte eingeben</button>`);
    $('#runSol', m).onclick = () => {
      for (const [id, lines] of Object.entries(lab.sol)) { cur.sess[id] = NL.newSess(); lines.forEach(l => runCmd(id, l, true)); }
      m.remove(); refresh(); drawOut();
    };
  }

  // ---------------- CLI lab ----------------
  const VOC = ['enable', 'configure', 'terminal', 'interface', 'range', 'vlan', 'name', 'switchport', 'mode', 'access', 'trunk', 'allowed', 'native', 'encapsulation', 'dot1Q', 'ip', 'address', 'route', 'routing', 'default-gateway', 'access-group', 'access-list', 'shutdown', 'show', 'running-config', 'brief', 'hostname', 'exit', 'end', 'ping', 'traceroute', 'write', 'memory', 'spanning-tree', 'portfast', 'bpduguard', 'authentication', 'port-control', 'auto', 'dot1x', 'pae', 'authenticator', 'mab', 'crypto', 'ikev2', 'ipsec', 'proposal', 'policy', 'keyring', 'profile', 'transform-set', 'tunnel', 'source', 'destination', 'protection', 'encryption', 'integrity', 'group', 'match', 'identity', 'remote', 'local', 'pre-share', 'pre-shared-key', 'set', 'ikev2-profile', 'radius', 'server', 'aaa', 'new-model', 'system-auth-control', 'line', 'vty', 'transport', 'input', 'login', 'username', 'privilege', 'secret', 'service', 'password-encryption', 'domain-name', 'generate', 'rsa', 'modulus', 'description', 'interfaces', 'session', 'permit', 'deny', 'any', 'host', 'network', 'start-stop', 'accounting', 'authorization', 'access-lists', 'startup-config', 'copy', 'aes-cbc-256', 'sha256', 'esp-aes', 'esp-sha256-hmac', 'enable'];
  function openCli(lab) {
    const net = LABS.build(lab); const snap = store.get('state.' + lab.id); if (snap) NL.restore(net, snap);
    cur = { lab, net, sess: {}, out: {}, hist: [], hi: 0, active: null };
    shell(lab, `<div class="topo-wrap"><svg id="topo" viewBox="0 0 800 400" role="group" aria-label="Netzwerk-Topologie – Geräte anklicken öffnet die Konsole"></svg>
        <div class="legend"><span><i class="lg access"></i>Access</span><span><i class="lg trunk"></i>Trunk (802.1Q)</span><span><i class="lg wan"></i>Router-Link</span><span><i class="lg down"></i>down</span></div></div>
      <div class="term"><div class="tabs" id="tabs" role="tablist"></div><div class="out" id="out" aria-live="polite"></div>
        <div class="inrow"><label id="prompt" for="cmd"></label><input id="cmd" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" aria-label="Befehl eingeben"></div></div>`);
    const inp = $('#cmd');
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { const v = inp.value; inp.value = ''; if (v.trim()) { cur.hist.push(v); } cur.hi = cur.hist.length; runCmd(cur.active, v); refresh(); drawOut(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (cur.hi > 0) { cur.hi--; inp.value = cur.hist[cur.hi]; } }
      else if (e.key === 'ArrowDown') { e.preventDefault(); if (cur.hi < cur.hist.length) { cur.hi++; inp.value = cur.hist[cur.hi] || ''; } }
      else if (e.key === 'Tab') { e.preventDefault(); complete(inp); }
    });
    inp.addEventListener('paste', e => {
      const t = (e.clipboardData || window.clipboardData).getData('text'); if (!t.includes('\n')) return;
      e.preventDefault(); t.split(/\r?\n/).forEach(l => { if (l.trim()) runCmd(cur.active, l); }); refresh(); drawOut();
    });
    $('#out').addEventListener('click', () => { if (!window.getSelection().toString()) inp.focus(); });
    const first = Object.values(net.devs).find(d => !NL.isHost(d)) || Object.values(net.devs)[0];
    openDev(first.id, true); refresh();
  }
  function complete(inp) {
    const v = inp.value; const m = v.match(/(\S+)$/); if (!m) return;
    const c = VOC.filter(w => w.toLowerCase().startsWith(m[1].toLowerCase()));
    if (c.length === 1) inp.value = v.slice(0, v.length - m[1].length) + c[0] + ' ';
    else if (c.length > 1) { push(cur.active, 'out', c.join('  ')); drawOut(); }
  }
  function openDev(id, quiet) {
    if (!cur.sess[id]) { cur.sess[id] = NL.newSess(); cur.out[id] = []; const d = cur.net.devs[id]; push(id, 'sys', NL.isHost(d) ? `${d.cfg.hostname} – Endgerät. Befehle: ip, show ip, ping, trace. Hilfe mit ?` : `${d.cfg.hostname} – Konsole verbunden. Mit ? siehst du die Befehle des aktuellen Modus.`); }
    cur.active = id; drawTabs(); drawOut(); drawTopo();
    if (!quiet) $('#cmd').focus();
  }
  function push(id, c, t) { (cur.out[id] = cur.out[id] || []).push({ c, t }); if (cur.out[id].length > 600) cur.out[id].splice(0, 100); }
  function runCmd(id, raw, silentFocus) {
    const d = cur.net.devs[id], s = cur.sess[id] || (cur.sess[id] = NL.newSess());
    if (!cur.out[id]) cur.out[id] = [];
    push(id, 'cmd', NL.prompt(d, s) + raw);
    if (/^\s*(clear|cls)\s*$/i.test(raw)) { cur.out[id] = []; return; }
    let r; try { r = NL.exec(cur.net, id, s, raw); } catch (e) { r = '% Interner Fehler: ' + e.message; console.error(e); }
    if (r) r.split('\n').forEach(l => push(id, /^\[(Ping-Debugger|Hinweis|Pfad|Debug)\]/.test(l) ? 'dbg' : (/^%/.test(l) ? (/Creating vlan/.test(l) ? 'out' : 'err') : 'out'), l));
  }
  function drawTabs() {
    $('#tabs').innerHTML = Object.keys(cur.sess).map(id => `<button role="tab" aria-selected="${id === cur.active}" class="tab ${id === cur.active ? 'act' : ''}" data-id="${id}">${esc(cur.net.devs[id].cfg.hostname)}</button>`).join('');
    $('#tabs').querySelectorAll('.tab').forEach(b => b.onclick = () => openDev(b.dataset.id));
  }
  function drawOut() {
    const id = cur.active, d = cur.net.devs[id];
    $('#out').innerHTML = (cur.out[id] || []).map(o => `<div class="ln k-${o.c}">${esc(o.t) || '&nbsp;'}</div>`).join('');
    $('#out').scrollTop = 1e9;
    $('#prompt').textContent = NL.prompt(d, cur.sess[id]).trim();
    drawTabs();
  }
  function refresh() {
    const { lab, net } = cur;
    store.set('state.' + lab.id, NL.snapshot(net));
    drawTopo();
    renderTasks(lab.tasks.map(t => { let ok = false; try { ok = !!t.c(net); } catch (e) { console.error(e); } return { t: t.t, ok }; }), lab);
  }
  function linkKind(net, l) {
    const A = net.devs[l.a], B = net.devs[l.b];
    const tr = (d, p) => (d.type === 'switch' && d.cfg.ifs[p].mode === 'trunk') || (d.type === 'router' && Object.keys(d.cfg.ifs).some(n => n.startsWith(p + '.')));
    if (tr(A, l.ap) || tr(B, l.bp)) return 'trunk';
    if (A.type === 'router' && B.type === 'router') return 'wan';
    return 'access';
  }
  const ICON = {
    switch: '<rect x="-34" y="-15" width="68" height="30" rx="5" class="body sw"/><g class="detail">' + [-24, -14, -4, 6, 16].map(x => `<rect x="${x}" y="2" width="7" height="6" rx="1"/>`).join('') + '<path d="M-22 -6h18m-4 -3l4 3-4 3M22 -6h-18m4 -3l-4 3 4 3" class="stroke"/></g>',
    router: '<circle r="21" class="body rt"/><path class="stroke" d="M-11 0h22M0 -11v22M7 -4l4 4-4 4M-7 -4l-4 4 4 4M-4 -7l4 -4 4 4M-4 7l4 4 4 -4"/>',
    pc: '<rect x="-20" y="-18" width="40" height="27" rx="3" class="body"/><rect x="-15" y="-13" width="30" height="17" class="screen"/><path class="stroke" d="M0 9v6M-10 16h20"/>',
    server: '<rect x="-15" y="-22" width="30" height="44" rx="3" class="body"/><path class="stroke" d="M-9 -12h18M-9 -4h18M-9 4h18"/><circle cx="7" cy="14" r="2.2" class="dot"/>',
    ise: '<rect x="-15" y="-22" width="30" height="44" rx="3" class="body ise"/><path class="stroke" d="M0 -14l9 4v6c0 7-4 11-9 13-5-2-9-6-9-13v-6z"/><path class="stroke" d="M-4 0l3 3 6-6"/>',
    cloud: '<path class="body" d="M-26 12a12 12 0 0 1 2-23 16 16 0 0 1 30-4 12 12 0 0 1 20 9 10 10 0 0 1-2 18z"/>',
    phone: '<rect x="-13" y="-20" width="26" height="38" rx="4" class="body"/><rect x="-8" y="-15" width="16" height="9" class="screen"/>' + [-6, 0, 6].map(x => [0, 6, 12].map(y => `<circle cx="${x}" cy="${y}" r="1.6" class="dot"/>`).join('')).join(''),
    printer: '<rect x="-20" y="-8" width="40" height="20" rx="3" class="body"/><path class="stroke" d="M-12 -8v-10h24v10M-12 12v6h24v-6"/><circle cx="13" cy="0" r="2" class="dot"/>'
  };
  function drawTopo() {
    const net = cur.net; let s = '';
    for (const l of net.links) {
      const A = net.devs[l.a], B = net.devs[l.b]; const up = NL.linkUp(net, l.a, l.ap); const k = linkKind(net, l);
      s += `<line class="cable ${k} ${up ? '' : 'down'}" x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}"/>`;
      const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
      const dist = (D, O) => 56 + ((O.y - D.y) / len > 0.6 ? 34 : 0);
      let dA = dist(A, B), dB = dist(B, A); if (dA + dB + 22 > len) { const f = (len - 22) / (dA + dB); dA *= f; dB *= f; }
      const lab = (D, p, O, dd) => { if (p === 'eth0') return ''; const t = dd / len, x = D.x + (O.x - D.x) * t, y = D.y + (O.y - D.y) * t; const st = !up && D.cfg.ifs[p] && D.cfg.ifs[p].shutdown ? 'shut' : ''; return `<g class="plabel ${st}" transform="translate(${x.toFixed(1)},${y.toFixed(1)})"><rect x="-21" y="-9" width="42" height="17" rx="3"/><text y="3.5">${NL.sh(p)}</text></g>`; };
      s += lab(A, l.ap, B, dA) + lab(B, l.bp, A, dB);
    }
    for (const id in net.devs) {
      const d = net.devs[id]; const sub = NL.isHost(d) ? (d.cfg.ip ? d.cfg.ip + '/' + NL.maskLen(d.cfg.mask) : 'keine IP') : '';
      s += `<g class="dev ${id === cur.active ? 'sel' : ''} t-${d.type}" transform="translate(${d.x},${d.y})" tabindex="0" role="button" data-id="${id}" aria-label="Konsole von ${esc(d.cfg.hostname)} öffnen">
        <circle r="38" class="halo"/>${ICON[d.icon] || ICON[d.type]}
        <text class="hn" y="${d.type === 'switch' ? 32 : 40}">${esc(d.cfg.hostname)}</text>${sub ? `<text class="ipl" y="54">${sub}</text>` : ''}</g>`;
    }
    const svg = $('#topo'); svg.innerHTML = s;
    svg.querySelectorAll('.dev').forEach(g => { g.onclick = () => openDev(g.dataset.id); g.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDev(g.dataset.id); } }; });
  }

  // ---------------- Policy labs (ISE / SSL) ----------------
  const sel = (name, opts, v, label) => `<select data-k="${name}" aria-label="${label}">${opts.map(o => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  function rowTools(i, n) { return `<td class="rtools"><button data-a="up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Regel nach oben">↑</button><button data-a="dn" data-i="${i}" ${i === n - 1 ? 'disabled' : ''} aria-label="Regel nach unten">↓</button><button data-a="rm" data-i="${i}" aria-label="Regel löschen">✕</button></td>`; }
  function wireRules(root, st, save) {
    root.querySelectorAll('tr[data-i] select').forEach(s => s.onchange = () => { st.rules[+s.closest('tr').dataset.i][s.dataset.k] = s.value; save(); });
    root.querySelectorAll('button[data-a]').forEach(b => b.onclick = () => { const i = +b.dataset.i, r = st.rules; if (b.dataset.a === 'up') [r[i - 1], r[i]] = [r[i], r[i - 1]]; else if (b.dataset.a === 'dn') [r[i + 1], r[i]] = [r[i], r[i + 1]]; else r.splice(i, 1); save(); });
  }
  function openIse(lab) {
    const I = LABS.ISE; let st = store.get('state.' + lab.id) || I.init();
    shell(lab, '<div class="policy" id="pol"></div>');
    const save = () => { store.set('state.' + lab.id, st); draw(); };
    function draw() {
      const O = I.opts;
      $('#pol').innerHTML = `<h2 class="ph">Authorization Policy <span class="muted">– Policy Set „Wired-Access“</span></h2>
        <div class="tscroll"><table class="rules"><thead><tr><th>#</th><th>Methode</th><th>AD-Gruppe</th><th>Endpoint-Profil</th><th>Posture</th><th>Autorisierungsprofil</th><th><span class="sr">Aktionen</span></th></tr></thead><tbody>
        ${st.rules.map((r, i) => `<tr data-i="${i}"><td class="num">${i + 1}</td><td>${sel('m', O.m, r.m, 'Methode')}</td><td>${sel('g', O.g, r.g, 'AD-Gruppe')}</td><td>${sel('p', O.p, r.p, 'Profil')}</td><td>${sel('s', O.s, r.s, 'Posture')}</td><td>${sel('r', O.r, r.r, 'Ergebnis')}</td>${rowTools(i, st.rules.length)}</tr>`).join('')}
        <tr class="def"><td class="num">–</td><td colspan="4">Default – greift, wenn keine Regel passt</td><td>${sel('def', O.r, st.def, 'Standardergebnis')}</td><td></td></tr></tbody></table></div>
        <button class="btn" id="add">Regel hinzufügen</button>
        <h2 class="ph">Testgeräte am Switch</h2>
        <div class="tscroll"><table class="eps"><thead><tr><th>Gerät</th><th>Methode, Gruppe, Profil, Posture</th><th>Treffer</th><th>Bekommt</th></tr></thead><tbody>
        ${I.eps.map(e => { const r = I.eval(st, e); const ok = r.r === e.x; return `<tr class="${ok ? 'ok' : 'bad'}"><td><b>${esc(e.n)}</b>${ok ? '' : `<span class="why">Soll: ${esc(e.x)}. ${e.why}</span>`}</td><td class="attrs">${[e.m, e.g, e.p, e.s].map(esc).join(', ')}</td><td>${r.idx < 0 ? 'Default' : 'Regel ' + (r.idx + 1)}</td><td><span class="res ${ok ? 'ok' : 'bad'}">${esc(r.r)}</span></td></tr>`; }).join('')}
        </tbody></table></div>`;
      wireRules($('#pol'), st, save);
      $('#pol select[data-k="def"]').onchange = e => { st.def = e.target.value; save(); };
      $('#add').onclick = () => { st.rules.push({ m: 'Beliebig', g: 'Beliebig', p: 'Beliebig', s: 'Beliebig', r: 'DenyAccess' }); save(); };
      renderTasks(I.tasks(st), lab);
    }
    draw();
  }
  function openSsl(lab) {
    const S = LABS.SSL; let st = store.get('state.' + lab.id) || S.init();
    shell(lab, '<div class="policy" id="pol"></div>');
    const save = () => { store.set('state.' + lab.id, st); draw(); };
    function draw() {
      const O = S.opts;
      $('#pol').innerHTML = `<h2 class="ph">Decryption Policy <span class="muted">– Next-Generation Firewall</span></h2>
        <label class="check"><input type="checkbox" id="ca" ${st.ca ? 'checked' : ''}> Firmen-Root-CA der Firewall per GPO/MDM auf alle Clients verteilt</label>
        <div class="tscroll"><table class="rules"><thead><tr><th>#</th><th>URL-Kategorie</th><th>Aktion</th><th><span class="sr">Aktionen</span></th></tr></thead><tbody>
        ${st.rules.map((r, i) => `<tr data-i="${i}"><td class="num">${i + 1}</td><td>${sel('c', O.c, r.c, 'Kategorie')}</td><td>${sel('a', O.a, r.a, 'Aktion')}</td>${rowTools(i, st.rules.length)}</tr>`).join('')}
        <tr class="def"><td class="num">–</td><td>Default</td><td>${sel('def', O.a, st.def, 'Standardaktion')}</td><td></td></tr></tbody></table></div>
        <button class="btn" id="add">Regel hinzufügen</button>
        <h2 class="ph">Testverkehr</h2>
        <div class="tscroll"><table class="eps"><thead><tr><th>Verbindung</th><th>Kategorie</th><th>Treffer</th><th>Firewall macht</th></tr></thead><tbody>
        ${S.tasks(st).slice(1).map((t, k) => { const f = S.flows[k]; return `<tr class="${t.ok ? 'ok' : 'bad'}"><td><b>${esc(f.n)}</b>${t.ok ? '' : `<span class="why">Soll: ${esc(f.x)}. ${esc(t.note)}</span>`}</td><td class="attrs">${esc(f.c)}</td><td>${t.got.idx < 0 ? 'Default' : 'Regel ' + (t.got.idx + 1)}</td><td><span class="res ${t.ok ? 'ok' : 'bad'}">${esc(t.got.a)}</span></td></tr>`; }).join('')}
        </tbody></table></div>`;
      wireRules($('#pol'), st, save);
      $('#pol select[data-k="def"]').onchange = e => { st.def = e.target.value; save(); };
      $('#ca').onchange = e => { st.ca = e.target.checked; save(); };
      $('#add').onclick = () => { st.rules.unshift({ c: 'Malware', a: 'Blockieren' }); save(); };
      renderTasks(S.tasks(st).map(t => ({ t: t.t, ok: t.ok })), lab);
    }
    draw();
  }

  // ---------------- Subnetting ----------------
  function openSubnet(lab) {
    let st = store.get('state.' + lab.id) || { ok: 0, tries: 0 };
    let q = LABS.subnetQ();
    shell(lab, `<div class="drill"><p class="dcount" id="dc"></p><div class="qcard"><p class="q" id="q"></p>
      <div class="arow"><input id="ans" autocomplete="off" spellcheck="false" aria-label="Antwort" placeholder="Antwort"><button class="btn primary" id="chk">Prüfen</button></div>
      <div id="fb" aria-live="polite"></div></div>
      <details class="cheat"><summary>Spickzettel</summary><table><tr><th>Präfix</th><th>Maske</th><th>Hosts</th></tr>${[22, 23, 24, 25, 26, 27, 28, 29, 30].map(l => `<tr><td>/${l}</td><td>${NL.lenMask(l)}</td><td>${Math.pow(2, 32 - l) - 2}</td></tr>`).join('')}</table></details></div>`);
    const draw = () => { $('#q').innerHTML = q.q; $('#dc').textContent = `${Math.min(st.ok, lab.goal)} von ${lab.goal} richtig, ${st.tries} Versuche`; renderTasks([{ t: `${lab.goal} Aufgaben richtig lösen (${Math.min(st.ok, lab.goal)}/${lab.goal})`, ok: st.ok >= lab.goal }], lab); };
    let answered = false;
    const check = () => {
      if (answered) { q = LABS.subnetQ(); answered = false; $('#ans').value = ''; $('#fb').innerHTML = ''; $('#chk').textContent = 'Prüfen'; draw(); $('#ans').focus(); return; }
      const v = $('#ans').value.trim().replace(/^\//, ''); if (!v) return;
      const ok = v === q.a.replace(/^\//, ''); st.tries++; if (ok) st.ok++; store.set('state.' + lab.id, st);
      $('#fb').innerHTML = ok ? `<p class="fb ok">Richtig: ${esc(q.a)}</p>` : `<p class="fb bad">Nicht ganz – richtig ist <b>${esc(q.a)}</b>.</p><p class="way">${esc(q.way)}</p>`;
      answered = true; $('#chk').textContent = 'Nächste Aufgabe'; draw();
    };
    $('#chk').onclick = check; $('#ans').onkeydown = e => { if (e.key === 'Enter') check(); };
    draw(); $('#ans').focus();
  }

  // ---------------- Quiz ----------------
  function openQuiz(lab) {
    let st = store.get('state.' + lab.id) || {};
    shell(lab, `<div class="quiz" id="qz"></div>`);
    const draw = () => {
      $('#qz').innerHTML = lab.qs.map((q, i) => { const a = st[i]; const ans = a !== undefined; return `<fieldset class="qq ${ans ? (a === q.a ? 'ok' : 'bad') : ''}"><legend>${i + 1}. ${esc(q.q)}</legend>
        ${q.o.map((o, k) => `<label class="opt ${ans && k === q.a ? 'right' : ''} ${ans && k === a && a !== q.a ? 'wrong' : ''}"><input type="radio" name="q${i}" value="${k}" ${a === k ? 'checked' : ''}> ${esc(o)}</label>`).join('')}
        ${ans ? `<p class="qe">${a === q.a ? 'Richtig. ' : 'Leider falsch. '}${esc(q.e)}</p>` : ''}</fieldset>`; }).join('');
      $('#qz').querySelectorAll('input').forEach(r => r.onchange = () => { st[+r.name.slice(1)] = +r.value; store.set('state.' + lab.id, st); draw(); });
      renderTasks(lab.qs.map((q, i) => ({ t: 'Frage ' + (i + 1), ok: st[i] === q.a })), lab);
    };
    draw();
  }

  // ---------------- Router ----------------
  function route() {
    if (location.hash === '#sandbox') { cur = null; window.scrollTo(0, 0); return Sandbox.open(app); }
    Sandbox.close();
    const m = location.hash.match(/^#lab\/([\w-]+)/); const lab = m && ALL.find(l => l.id === m[1]);
    window.scrollTo(0, 0);
    if (!lab) return home();
    ({ cli: openCli, ise: openIse, ssl: openSsl, subnet: openSubnet, quiz: openQuiz })[lab.type](lab);
  }
  window.addEventListener('hashchange', route);
  leds(); route();
})();
