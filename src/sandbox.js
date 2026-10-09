// ===================== NetLab Netzplaner (Sandbox) =====================
const Sandbox = (function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem('netlab.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('netlab.' + k, JSON.stringify(v)); } catch (e) { } }
  };
  const SH = NL.sh, MODELS = NL.MODELS, CARDS = NL.CARDS, XCVR = NL.XCVR, KIND = NL.KIND, hip = NL.hip;
  const RU = 42, UH = 30, RX = 46, RW = 470, VW = 1200, VH = 640;
  const VCOL = ['#2B66C8', '#1E8A57', '#8E44AD', '#D35400', '#16A085', '#C0392B', '#7F8C2D', '#2C7BB6', '#B5487E', '#5D6D7E'];
  let VM = {};
  const vcolor = v => v === 1 ? '#8A96A3' : (VM[v] || VCOL[v % VCOL.length]);
  function vmap() { const ids = new Set(); Object.values(S.net.devs).forEach(d => { if (d.type === 'switch') Object.keys(d.cfg.vlans).forEach(v => { if (+v !== 1) ids.add(+v); }); }); VM = {}; [...ids].sort((a, b) => a - b).forEach((v, i) => { VM[v] = VCOL[i % VCOL.length]; }); }
  const CABCOL = { cu: '#2B66C8', mmf: '#16A6A0', smf: '#D9A400', dac: '#9B6BD3' };
  const CABSHORT = { cu: 'Kupfer Cat6', mmf: 'Glas OM3 (MM)', smf: 'Glas OS2 (SM)', dac: 'DAC (passiv)' };
  const USES = ['Daten', 'Storage (iSCSI/NVMe-oF)', 'Cluster / Migration', 'Backup', 'Management'];
  let S = null, DL = null, app = null, dlAsked = false;

  function initDL() {
    if (dlAsked || typeof window === 'undefined' || !(window.claude && typeof window.claude.use === 'function')) return; dlAsked = true;
    window.claude.use('downloads').then(d => { DL = d; if (S && $('#xport')) renderExport(); }).catch(() => { DL = null; });
  }
  initDL();

  // ---------------- helpers / model ----------------
  const uOf = d => (MODELS[d.model] || {}).u || 0;
  const isIcon = d => d.type === 'pc' || !!(MODELS[d.model] && MODELS[d.model].icon);
  const isMg = p => p === 'ibmc' || /mgmt$/i.test(p) || /^Management/.test(p);
  const exportable = d => !isIcon(d);
  const dh = id => S.net.devs[id].cfg.hostname;
  const defSvc = () => ({ http: { on: true, https: false, title: '', body: 'Der Webserver läuft.' }, dns: { on: false, records: [] }, dhcp: { on: false, gw: '', dns: '', start: '', mask: '255.255.255.0', max: 50, leases: {} } });
  function newNet() { return { devs: {}, links: [], seq: 1 }; }
  function freeAt(net, id, pos, u) {
    if (pos < 1 || pos + u - 1 > RU) return false;
    for (const o of Object.values(net.devs)) { if (o.id === id || !o.rack) continue; const ou = uOf(o); if (pos <= o.rack + ou - 1 && o.rack <= pos + u - 1) return false; }
    return true;
  }
  function autoRack(net, id) { const d = net.devs[id], u = uOf(d); if (!u) return; d.rack = null; for (let p = RU - u + 1; p >= 1; p--) if (freeAt(net, id, p, u)) { d.rack = p; return; } }
  function addDev(net, model, x, y, host) {
    const M = MODELS[model]; const id = 'd' + (net.seq++);
    const pre = { switch: 'SW', router: M.fw ? 'FW' : 'R', fc: 'MDS', server: M.cloud ? 'ISP' : 'SRV', storage: 'STO', pc: M.icon === 'phone' ? 'PHONE' : M.icon === 'printer' ? 'PRN' : 'PC' }[M.type];
    const used = new Set(Object.values(net.devs).map(d => d.cfg.hostname)); let n = 1, h = host;
    if (!h) { do { h = pre + '-' + String(n++).padStart(2, '0'); } while (used.has(h)); }
    net.devs[id] = NL.mkDev(id, M.type, x, y, 0, { model, host: h, icon: M.icon });
    net.devs[id].use = {}; if (M.type === 'server') { net.devs[id].svc = defSvc(); if (M.cloud) { const sv = net.devs[id].svc; sv.dns.on = true; sv.dns.records = [{ name: 'www.example.com', ip: '@' }, { name: 'update.example.com', ip: '@' }]; sv.http.title = 'Internet'; sv.http.body = 'Du hast das (simulierte) Internet erreicht.'; } } autoRack(net, id); return id;
  }
  function migrate(net) {
    const fresh = [];
    for (const d of Object.values(net.devs)) {
      if (d.type === 'server' && !d.svc) d.svc = defSvc();
      d.cfg.nic = d.cfg.nic || {}; d.cfg.nat = d.cfg.nat || []; d.pcard = d.pcard || {}; d.grp = d.grp || {}; d.use = d.use || {};
      if (d.rack === undefined) { d.rack = null; fresh.push(d.id); }
    }
    fresh.forEach(id => autoRack(net, id));
  }
  function run(net, id, lines) {
    const d = net.devs[id], s = NL.newSess(), h = NL.isHost(d);
    [...(h ? [] : ['enable', 'configure terminal']), ...lines, ...(h ? [] : ['end'])].forEach(l => NL.exec(net, id, s, l));
  }
  function example() {
    const net = newNet(); const A = (m, x, y, h) => addDev(net, m, x, y, h);
    const isp = A('ISP-Cloud', 60, 90, 'ISP'), re = A('ISR4331', 240, 90, 'R-EDGE'), fw = A('ASA-5516-X', 450, 90, 'FW-01'), core = A('C9500-24Y4C', 790, 100, 'SW-CORE'), acc = A('C9200L-24P-4X', 330, 300, 'SW-ACC-01');
    const mds = A('MDS-9132T', 1010, 290, 'MDS-A'), srv = A('HW-2288H-V5', 720, 450, 'SRV-HW01'), sto = A('HW-Dorado-5000V6', 1010, 540, 'STO-01');
    const pc = A('PC', 130, 470, 'PC-101'), pr = A('Printer', 260, 470, 'PRN-01');
    const D = net.devs; NL.setCard(net, srv, 0, 'NIC-2x25G-ROCE'); NL.setCard(net, srv, 1, 'HBA-2x32G-FC'); NL.setCard(net, sto, 0, 'IO-4x25G'); NL.setCard(net, sto, 1, 'IO-4x32G-FC');
    const L = (a, ap, b, bp, cable) => net.links.push({ a, ap, b, bp, cable: cable || 'cu' });
    const X = (id, p, x) => { D[id].xcvr[p] = x; };
    L(isp, 'eth0', re, 'GigabitEthernet0/0/0'); L(re, 'GigabitEthernet0/0/1', fw, 'GigabitEthernet1/1'); L(fw, 'GigabitEthernet1/2', acc, 'GigabitEthernet1/0/24');
    L(acc, 'TenGigabitEthernet1/1/1', core, 'TwentyFiveGigE1/0/23', 'mmf'); X(acc, 'TenGigabitEthernet1/1/1', 'SFP-10G-SR'); X(core, 'TwentyFiveGigE1/0/23', 'SFP-10G-SR');
    L(srv, 'slot1/1', core, 'TwentyFiveGigE1/0/1', 'dac'); L(srv, 'slot1/2', core, 'TwentyFiveGigE1/0/2', 'dac');
    L(sto, 'A-slot1/1', core, 'TwentyFiveGigE1/0/5', 'mmf'); L(sto, 'B-slot1/1', core, 'TwentyFiveGigE1/0/6', 'mmf');
    [[sto, 'A-slot1/1', core, 'TwentyFiveGigE1/0/5'], [sto, 'B-slot1/1', core, 'TwentyFiveGigE1/0/6']].forEach(([a, ap, b, bp]) => { X(a, ap, 'SFP-25G-SR-S'); X(b, bp, 'SFP-25G-SR-S'); });
    L(srv, 'ibmc', acc, 'GigabitEthernet1/0/3'); L(sto, 'A-mgmt', acc, 'GigabitEthernet1/0/4');
    L(srv, 'slot2/1', mds, 'fc1/1', 'mmf'); L(sto, 'A-slot2/1', mds, 'fc1/9', 'mmf'); X(srv, 'slot2/1', 'DS-SFP-FC32G-SW'); X(mds, 'fc1/1', 'DS-SFP-FC32G-SW'); X(sto, 'A-slot2/1', 'DS-SFP-FC32G-SW'); X(mds, 'fc1/9', 'DS-SFP-FC32G-SW');
    L(pc, 'eth0', acc, 'GigabitEthernet1/0/1'); L(pr, 'eth0', acc, 'GigabitEthernet1/0/2');
    const vl = ['vlan 10', 'name SERVER', 'vlan 20', 'name STORAGE', 'vlan 30', 'name CLIENTS', 'vlan 99', 'name MGMT', 'vlan 100', 'name FW-TRANSIT'];
    run(net, core, [...vl, 'ip routing', 'interface vlan 10', 'ip address 10.10.0.1 255.255.255.0', 'no shutdown', 'interface vlan 20', 'ip address 10.20.0.1 255.255.255.0', 'no shutdown', 'interface vlan 30', 'ip address 10.30.0.1 255.255.255.0', 'no shutdown',
      'interface vlan 99', 'ip address 10.99.0.1 255.255.255.0', 'no shutdown', 'interface vlan 100', 'ip address 10.255.0.2 255.255.255.0', 'no shutdown', 'exit', 'ip route 0.0.0.0 0.0.0.0 10.255.0.1',
      'interface twe1/0/1', 'switchport mode access', 'switchport access vlan 10', 'spanning-tree portfast', 'description SRV-HW01 slot1/1',
      'interface twe1/0/2', 'switchport mode access', 'switchport access vlan 20', 'spanning-tree portfast', 'priority-flow-control mode on', 'mtu 9216', 'description SRV-HW01 slot1/2 (RoCE)',
      'interface twe1/0/5', 'switchport mode access', 'switchport access vlan 20', 'priority-flow-control mode on', 'mtu 9216', 'description STO-01 A-slot1/1',
      'interface twe1/0/6', 'switchport mode access', 'switchport access vlan 20', 'priority-flow-control mode on', 'mtu 9216', 'description STO-01 B-slot1/1',
      'interface twe1/0/23', 'switchport mode trunk', 'switchport trunk allowed vlan 30,99,100', 'description Uplink SW-ACC-01 Te1/1/1']);
    run(net, acc, ['vlan 30', 'name CLIENTS', 'vlan 99', 'name MGMT', 'vlan 100', 'name FW-TRANSIT', 'interface range g1/0/1 - 2', 'switchport mode access', 'switchport access vlan 30', 'spanning-tree portfast', 'spanning-tree bpduguard enable',
      'interface range g1/0/3 - 4', 'switchport mode access', 'switchport access vlan 99', 'interface g1/0/24', 'switchport mode access', 'switchport access vlan 100', 'description FW-01 inside',
      'interface te1/1/1', 'switchport mode trunk', 'switchport trunk allowed vlan 30,99,100', 'description Uplink SW-CORE Twe1/0/23', 'interface vlan 99', 'ip address 10.99.0.12 255.255.255.0', 'no shutdown', 'exit', 'ip default-gateway 10.99.0.1']);
    run(net, fw, ['interface g1/1', 'nameif outside', 'ip address 203.0.113.2 255.255.255.0', 'no shutdown', 'interface g1/2', 'nameif inside', 'ip address 10.255.0.1 255.255.255.0', 'no shutdown', 'exit',
      'route outside 0.0.0.0 0.0.0.0 203.0.113.1', 'route inside 10.0.0.0 255.0.0.0 10.255.0.2', 'nat (inside,outside) source dynamic any interface']);
    run(net, re, ['interface g0/0/0', 'description WAN zum ISP', 'ip address 198.51.100.2 255.255.255.252', 'no shutdown', 'interface g0/0/1', 'ip address 203.0.113.1 255.255.255.0', 'no shutdown', 'exit', 'ip route 0.0.0.0 0.0.0.0 198.51.100.1']);
    run(net, isp, ['ip 198.51.100.1/30 198.51.100.2']);
    run(net, srv, ['ip slot1/1 10.10.0.11/24 10.10.0.1', 'ip slot1/2 10.20.0.11/24', 'ip ibmc 10.99.0.31/24']);
    run(net, sto, ['ip A-slot1/1 10.20.0.21/24', 'ip B-slot1/1 10.20.0.22/24', 'ip A-mgmt 10.99.0.41/24 10.99.0.1']);
    run(net, pc, ['ip 10.30.0.10/24 10.30.0.1']); run(net, pr, ['ip 10.30.0.11/24 10.30.0.1']);
    D[srv].svc.dns.on = true; D[srv].svc.dns.records = [{ name: 'web.lab.local', ip: '10.10.0.11' }, { name: 'storage.lab.local', ip: '10.20.0.21' }, { name: 'www.example.com', ip: '198.51.100.1' }]; D[srv].svc.http.title = 'Willkommen auf SRV-HW01'; D[srv].svc.http.body = 'Intranet-Startseite.\nDieser Server läuft im VLAN 10.'; D[pc].cfg.dns = '10.10.0.11';
    [[mds, 42], [core, 41], [acc, 40], [fw, 39], [re, 38], [srv, 20], [sto, 10]].forEach(([id, r]) => { D[id].rack = r; });
    return net;
  }
  function save() { if (typeof localStorage !== 'undefined') store.set(S.scen ? 'scen.' + S.scen : 'sandbox', S.net); }

  // ---------------- syslog ----------------
  function states() { const m = {}; for (const id in S.net.devs) { const d = S.net.devs[id]; if (NL.isHost(d)) continue; d.ports.forEach(p => { m[id + '|' + p] = NL.portStatus(S.net, id, p).st; }); } return m; }
  function logDiff(prev) {
    const now = states();
    for (const k in now) {
      const [id, p] = k.split('|'); const a = prev[k], b = now[k]; if (a === undefined || a === b) continue;
      const L = m => push(id, 'log', m);
      if (b === 'connected') { L(`%LINK-3-UPDOWN: Interface ${p}, changed state to up`); L(`%LINEPROTO-5-UPDOWN: Line protocol on Interface ${p}, changed state to up`); }
      else if (b === 'err-disabled') { L(`%SPANTREE-2-BLOCK_BPDUGUARD: Received BPDU on port ${p} with BPDU Guard enabled. Disabling port.`); L(`%PM-4-ERR_DISABLE: bpduguard error detected on ${SH(p)}, putting ${SH(p)} in err-disable state`); }
      else if (b === 'disabled') L(`%LINK-5-CHANGED: Interface ${p}, changed state to administratively down`);
      else if (a === 'connected') { L(`%LINEPROTO-5-UPDOWN: Line protocol on Interface ${p}, changed state to down`); L(`%LINK-3-UPDOWN: Interface ${p}, changed state to down`); }
    }
  }
  function act(fn) { const before = S.undo ? JSON.stringify(S.net) : null, prev = states(); fn(); logDiff(prev); if (before !== null && JSON.stringify(S.net) !== before) { S.undo.push(before); if (S.undo.length > 60) S.undo.shift(); S.redo = []; } save(); if (typeof document !== 'undefined' && document.getElementById('cv')) render(); }

  // ---------------- open / toolbar ----------------
  const GROUPS = [['Switches', M => M.type === 'switch'], ['Router', M => M.type === 'router' && !M.fw], ['Firewall', M => M.fw], ['FC-Switch (SAN)', M => M.type === 'fc'], ['Server', M => M.type === 'server' && !M.icon], ['Storage', M => M.type === 'storage'], ['Endgeräte', M => M.type === 'pc' || M.icon]];
  function open(root) {
    app = root; document.title = 'Netzplaner – NetLab'; initDL(); document.removeEventListener('keydown', escKey);
    const sid = store.get('sbxscen', null), sc = sid && SC.find(x => x.id === sid), net = sc ? (store.get('scen.' + sid) || buildScen(sid)) : (store.get('sandbox') || example()); migrate(net);
    S = { net, scen: sc ? sid : null, undo: [], redo: [], sel: null, port: null, cable: 'cu', cabling: false, pend: null, view: store.get('sbxview', 'plan'), mode: store.get('sbxmode', 'rt'), tool: 'select', pcat: 0, flyout: null, dock: 'ports', dockOpen: true, itab: 'port', _sp: null, pdus: [], pduN: 0, pduSrc: null, sim: null, ptab: 'pdu', tf: 'all', out: {}, sess: {}, hist: [], hi: 0, drag: null, toast: '' };
    S.sel = Object.keys(net.devs).find(id => net.devs[id].type === 'switch') || Object.keys(net.devs)[0] || null;
    app.innerHTML = `<div class="sbx">
      <header class="sbar">
        <div class="seg2" id="segv" role="group" aria-label="Ansicht"><button data-v="plan">Netzplan</button><button data-v="rack">Rack</button></div>
        <div class="seg2" id="segm" role="group" aria-label="Modus"><button data-m="rt">Echtzeit</button><button data-m="sim">Simulation</button></div>
        <button class="ibtn" id="undoBtn" title="Rückgängig (Strg+Z)" aria-label="Rückgängig"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg></button><button class="ibtn" id="redoBtn" title="Wiederholen (Strg+Y)" aria-label="Wiederholen"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/></svg></button>
        <button class="pill" id="scenpill" hidden></button>
        <div class="sp"></div>
        <details class="menu"><summary class="btn">Mehr</summary><div class="mlist"><button data-m="desc">Ports automatisch beschriften</button><button data-m="example">Beispielnetz laden</button><button data-m="empty">Leeres Projekt</button><button data-m="json">Projekt als JSON</button><button data-m="import">Projekt importieren</button></div></details>
        <button class="btn primary" id="xBtn">Prüfen &amp; exportieren</button>
      </header>
      <nav class="rail" id="rail" aria-label="Werkzeuge und Geräte"></nav>
      <div class="stage"><div class="hint" id="hint" aria-live="polite" hidden></div><div class="fly" id="fly" hidden></div>
        <div class="canvas" id="cvwrap"><svg id="cv" role="group" aria-label="Netzplan"></svg></div></div>
      <section class="dock" id="dock">
        <div class="dtabs" role="tablist"><button role="tab" class="dt" data-d="ports">Ports</button><button role="tab" class="dt" data-d="cli">Konsole</button><button role="tab" class="dt" data-d="pkt">Pakete <i class="badge" id="pktn"></i></button><button role="tab" class="dt" data-d="task" id="dtTask" hidden>Aufgabe <i class="badge" id="taskn"></i></button><span class="sp"></span><button class="dtog" id="dockTgl" aria-label="Dock ein- oder ausklappen" title="Dock ein-/ausklappen"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button></div>
        <div class="dpane" data-p="ports" id="fp"></div>
        <div class="dpane cli" data-p="cli" hidden><div class="clihead"><span class="tab act" id="tname"></span></div><div class="out" id="out" aria-live="polite"></div>
          <div class="inrow"><label id="prompt" for="cmd"></label><input id="cmd" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" aria-label="Befehl eingeben"></div></div>
        <div class="dpane" data-p="pkt" id="pdu" hidden></div>
        <div class="dpane" data-p="task" id="task" hidden></div>
      </section>
      <aside class="insp" id="insp"></aside>
    </div>`;
    $$('#segv button').forEach(b => b.onclick = () => { S.view = b.dataset.v; store.set('sbxview', S.view); render(); });
    $$('#segm button').forEach(b => b.onclick = () => { S.mode = b.dataset.m; store.set('sbxmode', S.mode); S.sim = null; S.ptab = 'pdu'; render(); });
    $('#xBtn').onclick = exportModal; $('#undoBtn').onclick = undo; $('#redoBtn').onclick = redo; $('#scenpill').onclick = () => { S.dock = 'task'; S.dockOpen = true; drawDock(); };
    $$('.mlist button').forEach(b => b.onclick = () => { b.closest('details').open = false; menu(b.dataset.m); });
    $$('#dock [data-d]').forEach(b => b.onclick = () => { S.dock = b.dataset.d; S.dockOpen = true; drawDock(); if (S.dock === 'cli') setTimeout(() => $('#cmd').focus(), 0); });
    $('#dockTgl').onclick = () => { S.dockOpen = !S.dockOpen; drawDock(); };
    wireCanvas(); wireTerm(); document.addEventListener('keydown', escKey); render();
  }
  function escKey(e) {
    if (!S || document.querySelector('.modal')) return;
    if ((e.ctrlKey || e.metaKey) && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName || '')) { const k = e.key.toLowerCase(); if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; } if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); return; } }
    if (e.key === 'Escape' && (S.cabling || S.pend || S.pduSrc || S.tool !== 'select' || S.flyout != null)) { S.cabling = false; S.pend = null; S.pduSrc = null; S.tool = 'select'; S.flyout = null; render(); }
  }
  function undo() { if (!S.undo.length) return; S.redo.push(JSON.stringify(S.net)); S.net = JSON.parse(S.undo.pop()); migrate(S.net); S.pend = null; S.sim = null; save(); render(); }
  function redo() { if (!S.redo.length) return; S.undo.push(JSON.stringify(S.net)); S.net = JSON.parse(S.redo.pop()); migrate(S.net); S.pend = null; S.sim = null; save(); render(); }
  function menu(m) {
    if (m === 'desc') autoDesc();
    if (m === 'example') { if (confirm('Beispielnetz laden? Dein aktuelles Projekt wird ersetzt.')) { store.set('sbxscen', null); store.set('sandbox', example()); open(app); } }
    if (m === 'empty') { if (confirm('Leeres Projekt anlegen? Dein aktuelles Projekt wird ersetzt.')) { store.set('sbxscen', null); store.set('sandbox', newNet()); open(app); } }
    if (m === 'json') fileModal('Projekt als JSON', 'Damit kannst du das Projekt sichern oder auf einem anderen Gerät importieren.', 'netlab-projekt.json', JSON.stringify(S.net));
    if (m === 'import') {
      const md = modal(`<h2>Projekt importieren</h2><p class="muted">Füge den JSON-Text eines exportierten Projekts ein.</p><textarea id="imp" class="ta" rows="8" aria-label="Projekt-JSON"></textarea><button class="btn primary" id="impGo">Importieren</button><p id="impErr" class="err"></p>`);
      $('#impGo', md).onclick = () => { try { const j = JSON.parse($('#imp', md).value); if (!j.devs || !j.links) throw new Error('kein NetLab-Projekt'); store.set('sandbox', j); md.remove(); open(app); } catch (e) { $('#impErr', md).textContent = 'Import fehlgeschlagen: ' + e.message; } };
    }
  }
  function toast(t) { S.toast = t; }
  function render() {
    if (!S.net.devs[S.sel]) S.sel = Object.keys(S.net.devs)[0] || null;
    const sd = S.net.devs[S.sel]; if (S.port && (!sd || !sd.pk[S.port])) S.port = null;
    if (S.pduSrc && !S.net.devs[S.pduSrc]) S.pduSrc = null;
    $$('#segv button').forEach(b => b.classList.toggle('act', b.dataset.v === S.view)); $$('#segm button').forEach(b => b.classList.toggle('act', b.dataset.m === S.mode));
    $('#cvwrap').dataset.tool = S.cabling ? 'cable' : S.tool;
    let h = '';
    if (S.cabling) h = S.pend ? `<b>Kabel:</b> Ende A ist ${esc(dh(S.pend.dev))} ${esc(SH(S.pend.port))} – jetzt freien Port am anderen Gerät anklicken (Esc: Abbruch)` : `<b>Kabel (${CABSHORT[S.cable]}):</b> freien Port anklicken (Esc: Ende)`;
    else if (S.tool === 'delete') h = '<b>Löschen:</b> Gerät oder Kabel anklicken (Esc: Ende)';
    else if (S.tool === 'fail') h = '<b>Ausfall:</b> Gerät anklicken = ausschalten/einschalten, Kabel anklicken = ziehen/stecken (Esc: Ende)';
    else if (S.tool === 'pdu') h = S.pduSrc ? `<b>Paket:</b> Quelle ${esc(dh(S.pduSrc))} – jetzt Ziel anklicken` : '<b>Paket:</b> Quelle, dann Ziel anklicken';
    if (S.view === 'rack') { const un = Object.values(S.net.devs).filter(d => uOf(d) && !d.rack); if (un.length) h += (h ? '<br>' : '') + `Nicht im Rack: ${un.map(d => esc(d.cfg.hostname)).join(', ')} – Gerät auswählen und rechts eine Position setzen.`; }
    const wasToast = !!S.toast; if (S.toast) h = S.toast;
    $('#hint').innerHTML = h; $('#hint').hidden = !h; S.toast = '';
    clearTimeout(S._ht); if (wasToast) S._ht = setTimeout(() => { const el = $('#hint'); if (el && S && !S.cabling && S.tool === 'select') el.hidden = true; }, 6500);
    S.vb = null; vmap(); drawView(); drawPal(); drawPanel(); drawInsp(); drawOut(); drawPdu(); drawTask(); drawDock(); $('#undoBtn').disabled = !S.undo.length; $('#redoBtn').disabled = !S.redo.length;
  }

  // ---------------- Palette (Packet-Tracer-Stil) ----------------
  const PCATS = [['Netzwerk', M => M.type === 'switch' || (M.type === 'router' && !M.fw) || !!M.cloud], ['Firewall', M => !!M.fw], ['Server', M => M.type === 'server' && !M.icon], ['Storage & SAN', M => M.type === 'storage' || M.type === 'fc'], ['Endgeräte', M => (M.type === 'pc' || !!M.icon) && !M.cloud], ['Kabel', null]];
  const TICON = {
    switch: '<rect x="-24" y="-9" width="48" height="18" rx="3" class="body sw"/>' + [-16, -9, -2, 5, 12].map(x => `<rect x="${x}" y="-5" width="5" height="4" class="dot"/><rect x="${x}" y="1" width="5" height="4" class="dot"/>`).join(''),
    fc: '<rect x="-24" y="-9" width="48" height="18" rx="3" class="body fcx"/>' + [-16, -9, -2, 5, 12].map(x => `<rect x="${x}" y="-5" width="5" height="4" class="dot"/><rect x="${x}" y="1" width="5" height="4" class="dot"/>`).join(''),
    router: '<circle r="19" class="body rt"/><path class="stroke" d="M-10 0h20M0 -10v20M6 -4l4 4-4 4M-6 -4l-4 4 4 4M-4 -6l4 -4 4 4M-4 6l4 4 4 -4"/>',
    fw: '<rect x="-22" y="-16" width="44" height="32" rx="3" class="body fwx"/><path class="stroke" d="M-22 -5h44M-22 6h44M-8 -16v11M8 -5v11M-8 6v10"/>',
    storage: '<rect x="-22" y="-16" width="44" height="32" rx="3" class="body stx"/>' + [-11, -2, 7].map(y => `<rect x="-17" y="${y}" width="34" height="6" rx="1" class="screen"/><circle cx="13" cy="${y + 3}" r="1.4" class="dot"/>`).join('')
  };
  function tileIcon(M) { const k = M.icon || (M.fw ? 'fw' : M.type); const g = ICON[M.icon] || TICON[k] || ICON[k] || TICON[M.type] || ''; return `<svg viewBox="-28 -24 56 48" class="tic" aria-hidden="true">${g}</svg>`; }
  function addAt(model, x, y) {
    act(() => { const n = Object.keys(S.net.devs).length; const id = addDev(S.net, model, x == null ? 160 + (n * 143) % 860 : x, y == null ? 120 + (n * 101) % 400 : y); S.sel = id; S.port = null; S.cabling = false; S.tool = 'select'; S.flyout = null; });
  }
  const RI = {
    select: '<path d="M4.04 4.69a.5.5 0 0 1 .65-.65l16 6.5a.5.5 0 0 1-.06.95l-6.13 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.13a.5.5 0 0 1-.95.06z"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><path d="M10 11v6M14 11v6"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    network: '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3M12 12V8"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    server: '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 6h.01M6 18h.01"/>',
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
    monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/>',
    power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>',
    clip: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="m9 14 2 2 4-4"/>',
    plug: '<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
    terminal: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8M16 17H8M10 9H8"/>'
  };
  const ico = k => `<svg viewBox="0 0 24 24" class="ri" aria-hidden="true">${RI[k]}</svg>`;
  const CATIC = ['network', 'shield', 'server', 'database', 'monitor', 'plug'], CATSH = ['Netzwerk', 'Firewall', 'Server', 'Storage', 'Endgeräte', 'Kabel'];
  function drawPal() {
    const rail = $('#rail'), fly = $('#fly'); if (!rail) return; const tools = [['select', 'Auswählen', 'select'], ['delete', 'Löschen', 'trash'], ['pdu', 'Paket', 'send'], ['fail', 'Ausfall', 'power']];
    rail.innerHTML = tools.map(([k, n, i]) => `<button class="rb ${S.tool === k && !S.cabling ? 'act' : ''}" data-tool="${k}" title="${n === 'Paket' ? 'Paket senden' : n}">${ico(i)}<span>${n}</span></button>`).join('') + '<i class="rsep"></i>'
      + PCATS.map((c, i) => `<button class="rb ${S.flyout === i || (i === 5 && S.cabling) ? 'act' : ''}" data-c="${i}" aria-expanded="${S.flyout === i}" title="${c[0]}">${ico(CATIC[i])}<span>${CATSH[i]}</span></button>`).join('') + `<i class="rsep"></i><button class="rb ${S.flyout === 'scen' || S.scen ? 'act' : ''}" data-s="scen" title="Aufgaben">${ico('clip')}<span>Aufgaben</span></button>`;
    $$('.rb[data-tool]', rail).forEach(b => b.onclick = () => { S.tool = b.dataset.tool; S.cabling = false; S.pend = null; S.pduSrc = null; S.flyout = null; render(); });
    $$('.rb[data-c]', rail).forEach(b => b.onclick = () => { const i = +b.dataset.c; S.flyout = S.flyout === i ? null : i; S.pcat = i; drawPal(); });
    $$('.rb[data-s]', rail).forEach(b => b.onclick = () => { S.flyout = S.flyout === 'scen' ? null : 'scen'; drawPal(); });
    if (S.flyout == null) { fly.hidden = true; fly.innerHTML = ''; return; }
    if (S.flyout === 'scen') { scenFly(fly); return; }
    const cat = PCATS[S.flyout], items = cat[1] ? Object.entries(MODELS).filter(([k, M]) => cat[1](M)).map(([k, M]) => `<button class="tile" draggable="true" data-model="${k}" title="${esc(M.label + (M.info ? ' – ' + M.info.replace(' (vereinfachtes Planungsmodell)', '') : ''))}">${tileIcon(M)}<span>${esc(M.label.replace(/^(Huawei|Cisco) /, '').replace(/ \(.*\)$/, ''))}</span></button>`).join('')
      : Object.keys(CABSHORT).map(c => `<button class="tile cabt ${S.cabling && S.cable === c ? 'act' : ''}" data-cab="${c}" title="${CABSHORT[c]}"><svg viewBox="-28 -24 56 48" class="tic" aria-hidden="true"><path d="M-22 10C-6 10 -6 -10 6 -10S22 -2 24 -10" fill="none" stroke="${CABCOL[c]}" stroke-width="4" stroke-linecap="round"/><circle cx="-22" cy="10" r="3.5" fill="${CABCOL[c]}"/><circle cx="24" cy="-10" r="3.5" fill="${CABCOL[c]}"/></svg><span>${CABSHORT[c]}</span></button>`).join('');
    fly.hidden = false;
    fly.innerHTML = `<div class="flyh"><h2>${cat[0]}</h2><button class="x" id="flyX" aria-label="Schließen">✕</button></div><p class="flyp">${cat[1] ? 'In den Plan ziehen oder anklicken.' : 'Kabeltyp wählen, dann zwei Ports anklicken.'}</p><div class="tiles">${items}</div>`;
    $('#flyX').onclick = () => { S.flyout = null; drawPal(); };
    $$('.tile[data-model]', fly).forEach(b => { b.onclick = () => addAt(b.dataset.model); b.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', b.dataset.model); e.dataTransfer.effectAllowed = 'copy'; setTimeout(() => { fly.hidden = true; }, 0); }); });
    $$('.tile[data-cab]', fly).forEach(b => b.onclick = () => { S.cable = b.dataset.cab; S.cabling = true; S.tool = 'select'; S.pend = null; S.flyout = null; render(); });
  }
  function drawDock() {
    const dk = $('#dock'); if (!dk) return; dk.classList.toggle('closed', !S.dockOpen); const tt = $('#dtTask'); if (tt) tt.hidden = !S.scen; if (!S.scen && S.dock === 'task') S.dock = 'ports';
    $$('#dock [data-d]').forEach(b => { b.classList.toggle('act', b.dataset.d === S.dock); b.setAttribute('aria-selected', b.dataset.d === S.dock); });
    $$('#dock .dpane').forEach(p => { p.hidden = p.dataset.p !== S.dock; }); $('#pktn').textContent = S.pdus.length || '';
  }

  // ---------------- Pakete (PDU), Echtzeit & Simulation ----------------
  const dn = id => S.net.devs[id] ? S.net.devs[id].cfg.hostname : '(gelöscht)';
  const ifaceList = d => NL.isHost(d) ? d.ports.map(p => hip(d, p)).filter(h => h && h.ip) : d.type === 'fc' ? [] : Object.values(d.cfg.ifs).filter(i => i.ip);
  function pickIp(src, dst) { const di = ifaceList(dst).map(h => h.ip), sn = ifaceList(src); return di.find(ip => sn.some(n => NL.inNet(ip, n.ip, n.mask))) || di[0] || null; }
  function pduPick(id) { if (!S.pduSrc) { S.pduSrc = id; S.sel = id; render(); return; } const a = S.pduSrc; S.pduSrc = null; sendPdu(a, id); }
  function route(a, b) {
    if (a === b) return [a]; const net = S.net, prev = { [a]: null }, q = [a];
    while (q.length) { const x = q.shift(); if (x === b) break; for (const l of net.links) { const y = l.a === x ? l.b : (l.b === x ? l.a : null); if (!y || y in prev || NL.portStatus(net, l.a, l.ap).st !== 'connected') continue; prev[y] = x; q.push(y); } }
    if (!(b in prev)) return null; const out = []; for (let c = b; c !== null; c = prev[c]) out.unshift(c); return out;
  }
  const linkIdx = (a, b) => S.net.links.findIndex(l => ((l.a === a && l.b === b) || (l.a === b && l.b === a)) && NL.portStatus(S.net, l.a, l.ap).st === 'connected');
  function buildSim(rec) {
    const byName = n => Object.keys(S.net.devs).find(id => S.net.devs[id].cfg.hostname === n), ids = rec.path.map(byName).filter(Boolean);
    let seq = ids.length ? [ids[0]] : [rec.src]; for (let i = 1; i < ids.length; i++) { const r = route(ids[i - 1], ids[i]); if (r) seq = seq.concat(r.slice(1)); }
    if (!rec.ok && /^Hinweg ok/.test(rec.reason)) { const rr = route(rec.src, rec.dst); if (rr) seq = rr; }
    const full = rec.ok ? seq.concat(seq.slice(0, -1).reverse()) : seq, evs = [];
    for (let k = 1; k < full.length; k++) {
      const to = S.net.devs[full[k]], fwdLeg = k <= seq.length - 1, last = k === full.length - 1;
      let info = to.type === 'switch' ? 'L2-Weiterleitung (MAC/VLAN)' : to.type === 'fc' ? 'FC-Weiterleitung' : to.fw ? 'Firewall: Level/ACL/NAT geprüft, geroutet' : NL.isHost(to) ? (fwdLeg && k === seq.length - 1 ? 'ICMP-Echo empfangen, Antwort erzeugt' : 'ICMP-Antwort empfangen') : 'Routing (Next Hop aus Routingtabelle)';
      if (!NL.isHost(to) && last) info = 'ICMP-Antwort angekommen';
      evs.push({ from: full[k - 1], to: full[k], li: linkIdx(full[k - 1], full[k]), info, leg: fwdLeg ? 'Echo' : 'Antwort' });
    }
    return { id: Date.now() + Math.random(), rec, evs, i: 0, running: false, auto: true, done: false, endDev: full[full.length - 1] || rec.src };
  }
  function sendPdu(sId, dId) {
    const s = S.net.devs[sId], d = S.net.devs[dId];
    if (!s || !d) return; if (sId === dId) { toast('Quelle und Ziel sind dasselbe Gerät.'); render(); return; }
    const ip = pickIp(s, d); if (!ip) { toast(`<span class="neg">${esc(d.cfg.hostname)} hat keine IP-Adresse – das Paket kann nicht adressiert werden.</span>`); render(); return; }
    if (!ifaceList(s).length) { toast(`<span class="neg">${esc(s.cfg.hostname)} hat keine IP-Adresse – es kann kein Paket senden.</span>`); render(); return; }
    const r = NL.ping(S.net, sId, ip), rec = { n: ++S.pduN, src: sId, dst: dId, ip, ok: !!r.ok, reason: r.reason || '', notes: r.notes || [], path: r.path || [], nat: r.nat };
    S.pdus.unshift(rec); if (S.pdus.length > 14) S.pdus.pop(); S.sel = sId; S.dock = 'pkt'; S.dockOpen = true;
    if (S.mode === 'sim' && S.view === 'plan') { S.sim = buildSim(rec); S.ptab = 'ev'; render(); runSim(true); return; }
    S.sim = null; S.ptab = 'pdu'; toast(r.ok ? `<span class="okmsg">✓ Paket erfolgreich:</span> ${esc(s.cfg.hostname)} → ${esc(d.cfg.hostname)} (${ip})` : `<span class="neg">✕ Paket fehlgeschlagen:</span> ${esc(r.reason)}`); render();
  }
  function animateEv(ev, m, done) {
    const svg = $('#cv'), p = ev.li >= 0 ? svg.querySelector(`.wire[data-li="${ev.li}"]`) : null, dev = id => S.net.devs[id];
    let env = $('#env'); if (!env) { env = document.createElementNS('http://www.w3.org/2000/svg', 'g'); env.id = 'env'; env.setAttribute('class', 'env'); env.innerHTML = '<rect x="-8" y="-6" width="16" height="12" rx="2"/><path d="M-8 -6l8 6 8-6" fill="none"/>'; svg.appendChild(env); }
    const a = dev(ev.from), b = dev(ev.to), t0 = performance.now(), dur = 560;
    const rev = ev.li >= 0 && S.net.links[ev.li].a !== ev.from, len = p ? p.getTotalLength() : 0;
    const tick = now => { if (S.sim !== m) return; const k = Math.min(1, (now - t0) / dur); let x, y; if (p) { const q = p.getPointAtLength(rev ? len * (1 - k) : len * k); x = q.x; y = q.y; } else { x = a.x + (b.x - a.x) * k; y = a.y + (b.y - a.y) * k; } env.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)})`); if (k < 1) requestAnimationFrame(tick); else done(); };
    requestAnimationFrame(tick);
  }
  function runSim(auto) {
    const m = S.sim; if (!m || m.running) return; if (m.done) { m.i = 0; m.done = false; const e = $('#env'); if (e) e.remove(); drawView(); }
    m.auto = auto;
    const next = () => {
      if (S.sim !== m) return; if (m.i >= m.evs.length) { finishSim(m); return; }
      if (S.view !== 'plan') { m.i = m.evs.length; finishSim(m); return; }
      m.running = true; drawPdu();
      animateEv(m.evs[m.i], m, () => { if (S.sim !== m) return; m.running = false; m.i++; drawPdu(); if (m.auto && m.i < m.evs.length) setTimeout(next, 90); else if (m.i >= m.evs.length) finishSim(m); });
    };
    next();
  }
  function finishSim(m) { m.done = true; m.running = false; const e = $('#env'); if (e) e.remove(); drawView(); drawPdu(); }
  function simOverlay() {
    const m = S.sim; if (!m || !m.done || S.view !== 'plan') return ''; const d = S.net.devs[m.rec.ok ? m.rec.src : m.endDev]; if (!d) return '';
    const L = layout(d), x = d.x + L.w / 2 + 2, y = d.y - L.h / 2 - 4;
    return m.rec.ok ? `<g class="pres ok" transform="translate(${x},${y})"><circle r="10"/><path d="M-5 0l3.5 4 7-8" /></g>` : `<g class="pres bad" transform="translate(${x},${y})"><circle r="10"/><path d="M-4.5 -4.5l9 9m0 -9l-9 9"/></g>`;
  }
  function drawPdu() {
    const el = $('#pdu'); if (!el) return; const m = S.sim, tab = S.ptab === 'ev' && m ? 'ev' : 'pdu', last = S.pdus[0];
    const rows = S.pdus.map(r => `<tr class="${r.ok ? 'ok' : 'bad'}" title="${esc(r.reason)}"><td><span class="pst2 ${r.ok ? 'ok' : 'bad'}">${r.ok ? '✓ Erfolgreich' : '✕ Fehlgeschlagen'}</span></td><td>${esc(dn(r.src))}</td><td>${esc(dn(r.dst))}</td><td>ICMP</td><td>${r.n}</td></tr>`).join('');
    const ev = m ? m.evs.map((e, k) => `<tr class="${k < m.i ? 'done' : k === m.i && m.running ? 'cur' : ''}"><td>${((k + 1) * 0.001).toFixed(3)}</td><td>${esc(dn(e.from))}</td><td>${esc(dn(e.to))}</td><td>${e.leg}</td><td>${esc(e.info)}</td></tr>`).join('') + (m.done && !m.rec.ok ? `<tr class="bad"><td colspan="5">✕ ${esc(m.rec.reason)}</td></tr>` : '') : '';
    el.innerHTML = `<div class="ptabs" role="tablist"><button role="tab" class="${tab === 'pdu' ? 'act' : ''}" data-t="pdu">PDU-Liste</button>${S.mode === 'sim' ? `<button role="tab" class="${tab === 'ev' ? 'act' : ''}" data-t="ev">Ereignisliste</button>` : ''}
      ${S.mode === 'sim' && m ? `<span class="sctl"><button id="simStep" ${m.running ? 'disabled' : ''}>Schritt</button><button id="simAuto" ${m.running ? 'disabled' : ''}>${m.done ? 'Nochmal' : 'Abspielen'}</button></span>` : ''}${S.pdus.length ? '<button class="clr" id="pduClr">Leeren</button>' : ''}</div>
      <div class="pdut">${tab === 'ev' ? `<table class="eps"><thead><tr><th>Zeit</th><th>Von</th><th>Nach</th><th>Typ</th><th>Info</th></tr></thead><tbody>${ev}</tbody></table>` : (rows ? `<table class="eps"><thead><tr><th>Status</th><th>Quelle</th><th>Ziel</th><th>Typ</th><th>Nr</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted small">Noch kein Paket gesendet. Werkzeug „Paket senden“ wählen, dann Quelle und Ziel anklicken.</p>')}</div>
      ${last && !last.ok && tab === 'pdu' ? `<p class="pdufail">${esc(last.reason)}${last.notes.length ? '<br>' + esc(last.notes[0]) : ''}</p>` : ''}`;
    $$('.ptabs [data-t]', el).forEach(b => b.onclick = () => { S.ptab = b.dataset.t; drawPdu(); });
    if ($('#simStep', el)) $('#simStep', el).onclick = () => { if (m.done) { runSim(false); } else { const mm = m; mm.auto = false; runSim(false); } };
    if ($('#simAuto', el)) $('#simAuto', el).onclick = () => runSim(true);
    if ($('#pduClr', el)) $('#pduClr').onclick = () => { S.pdus = []; S.sim = null; S.ptab = 'pdu'; render(); };
  }

  // ---------------- geometry ----------------
  const PSZ = { rj45: 9, sfp: 10, 'sfp+': 10, sfp28: 10, qsfp28: 14, fc: 10 };
  function layout(d) {
    const L = { ports: {}, groups: [], w: 0, h: 0, rows: 2, icon: false };
    if (isIcon(d)) { L.icon = true; L.rows = 1; L.w = 64; L.h = 58; L.ports[d.ports[0]] = { x: 27, y: 0, s: 10, row: 0 }; return L; }
    if (d.type === 'server' || d.type === 'storage') {
      const M = MODELS[d.model] || {}, ctls = d.type === 'storage' ? ['A', 'B'] : [null]; L.rows = ctls.length; let maxX = 0;
      ctls.forEach((ctl, ri) => {
        let x = 6; const y0 = 4 + ri * 30;
        const grp = (ports, label, empty) => {
          const gx = x; if (empty) { x += 22; } else { x += 3; ports.forEach(p => { const s = (PSZ[d.pk[p]] || 10) + 1; L.ports[p] = { x, y: y0 + 9, s, row: ri }; x += s + 2; }); x += 1; }
          L.groups.push({ x: gx, y: y0, w: x - gx, h: 26, label, empty: !!empty, ctl }); x += 5;
        };
        grp(d.ports.filter(p => d.grp[p] === 'onboard' && (!ctl || p.startsWith(ctl + '-'))), 'Onboard');
        for (let k = 1; k <= (M.slots || 0); k++) { const g = ctl ? `${ctl}-slot${k}` : `slot${k}`, ps = d.ports.filter(p => d.grp[p] === g), ck = d.cards && d.cards[k - 1]; grp(ps, ps.length && ck ? CARDS[ck].short : `Slot ${k} frei`, !ps.length); }
        maxX = Math.max(maxX, x);
      });
      L.w = maxX + 2; L.h = 4 + ctls.length * 30; return L;
    }
    const one = d.type === 'router'; L.rows = one ? 1 : 2; const ps = d.ports; let x = 8, maxH = 0, i0 = 0;
    while (i0 < ps.length) {
      const k = d.pk[ps[i0]]; let j = i0; while (j < ps.length && d.pk[ps[j]] === k) j++;
      const grp = ps.slice(i0, j), sz = (one && k === 'rj45') ? 12 : (PSZ[k] || 10), pitch = sz + 2, cols = Math.ceil(grp.length / L.rows);
      grp.forEach((p, n) => { const col = Math.floor(n / L.rows), row = n % L.rows; L.ports[p] = { x: x + col * pitch + Math.floor(col / 6) * 5, y: 4 + row * pitch, s: sz, row }; });
      x += cols * pitch + Math.floor((cols - 1) / 6) * 5 + 11; maxH = Math.max(maxH, 4 + L.rows * pitch); i0 = j;
    }
    L.w = x - 3; L.h = maxH + 2; return L;
  }
  function pstat(d, p) {
    const st = NL.portStatus(S.net, d.id, p); let cls = 'free';
    if (st.st === 'connected') cls = 'up'; else if (st.st === 'err-disabled') cls = 'err'; else if (st.st === 'disabled') cls = st.link ? 'shut' : 'shutfree'; else if (st.link) cls = 'down';
    return { st, cls };
  }
  function fillOf(d, p, st) {
    if (d.type === 'switch') { const i = d.cfg.ifs[p]; return i.mode === 'trunk' ? 'url(#trk)' : vcolor(i.vlan); }
    return CABCOL[st.link.cable || 'cu'];
  }
  const peerTxt = st => st.peer ? `${dh(st.peer.dev)} ${SH(st.peer.port)}` : '';
  function ptip(d, p, st) {
    const i = d.cfg.ifs && d.cfg.ifs[p], k = d.pk[p], t = [`${d.cfg.hostname} ${p}`, KIND[k].label + (d.pcard && d.pcard[p] ? ', ' + CARDS[d.pcard[p]].short : '')];
    if (i && i.desc) t.push(i.desc);
    if (d.type === 'switch' && i) t.push(i.mode === 'trunk' ? 'Trunk' : 'Access VLAN ' + i.vlan);
    if (d.fw && i && i.nameif) t.push(`nameif ${i.nameif}, Level ${i.sl === null ? 0 : i.sl}`);
    t.push(st.st === 'connected' ? `Link up, ${NL.fmtSpeed(st.speed, st.proto)}` : st.st + (st.reason ? ': ' + st.reason : ''));
    if (d.xcvr[p]) t.push('Transceiver: ' + d.xcvr[p]); if (st.link) t.push(`Kabel zu ${peerTxt(st)} (${CABSHORT[st.link.cable || 'cu']})`);
    if (NL.isHost(d) && k !== 'fc') { const h = hip(d, p); if (h && h.ip) t.push(`${h.ip}/${NL.maskLen(h.mask)}`); } if (k === 'fc' && NL.isHost(d)) t.push('WWPN ' + NL.wwpn(d, p));
    if (d.pcard && d.pcard[p] && CARDS[d.pcard[p]].roce) t.push('RoCE v2-fähig');
    return t.join('\n');
  }
  const pn = p => isMg(p) ? 'M' : (/^\d+$/.test(p.split('/').pop()) ? p.split('/').pop() : (p.replace(/\D+/g, '') || '·'));
  function portSvg(d, p, P, ox, oy, lbl) {
    const { st, cls } = pstat(d, p), x = ox + P.x, y = oy + P.y, s = P.s;
    const fill = cls === 'up' ? fillOf(d, p, st) : (cls === 'err' ? '#FFB020' : null);
    const roce = d.pcard && d.pcard[p] && CARDS[d.pcard[p]].roce;
    const cur = S.sel === d.id && S.port === p, pend = S.pend && S.pend.dev === d.id && S.pend.port === p;
    return `<g class="cp ${cur ? 'cur' : ''} ${pend ? 'pend' : ''}" data-d="${d.id}" data-p="${esc(p)}"><title>${esc(ptip(d, p, st))}</title><rect class="pt ${cls}" x="${x}" y="${y}" width="${s}" height="${s}" rx="1.5"${fill ? ` style="fill:${fill}"` : ''}/>`
      + (d.xcvr[p] ? `<rect class="px" x="${x + 2.5}" y="${y + 2.5}" width="${s - 5}" height="${s - 5}"/>` : '') + (roce ? `<circle class="rc" cx="${x + s - 1.2}" cy="${y + 1.2}" r="1.6"/>` : '')
      + (lbl ? `<text class="pl" x="${x + s / 2}" y="${y + s / 2 + 2.1}">${esc(pn(p))}</text>` : '') + '</g>';
  }
  const portsSvg = (d, L, ox, oy, lbl) => d.ports.filter(p => L.ports[p]).map(p => portSvg(d, p, L.ports[p], ox, oy, lbl)).join('');
  function groupsSvg(L, ox, oy, lbl) {
    return L.groups.map(g => `<rect class="grp ${g.empty ? 'empty' : ''}" x="${ox + g.x}" y="${oy + g.y}" width="${g.w}" height="${g.h}" rx="2"/>` + (lbl ? `<text class="gl" x="${ox + g.x + 2}" y="${oy + g.y + 5.6}">${esc(g.ctl ? g.ctl + ' · ' + g.label : g.label)}</text>` : '')).join('');
  }
  const defs = () => '<defs><pattern id="trk" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" fill="#C98A08"/><rect width="2" height="4" fill="#1d2329"/></pattern></defs>';
  function stats(d) {
    const r = { total: d.ports.length, used: 0, up: 0, bad: 0, shut: 0 };
    for (const p of d.ports) { const c = pstat(d, p).cls; if (NL.linkOf(S.net, d.id, p)) r.used++; if (c === 'up') r.up++; else if (c === 'err' || c === 'down') r.bad++; else if (c === 'shut' || c === 'shutfree') r.shut++; }
    r.free = r.total - r.used; return r;
  }

  // ---------------- plan view ----------------
  function cablePath(A, B) {
    const dirOf = (a, b) => a.rows === 1 ? (b.y >= a.y ? 1 : -1) : (a.row === 0 ? -1 : 1);
    const da = dirOf(A, B), db = dirOf(B, A), k = Math.max(28, Math.min(120, Math.hypot(B.x - A.x, B.y - A.y) * 0.4));
    const ay = A.y + da * A.s / 2, by = B.y + db * B.s / 2;
    return { d: `M${A.x.toFixed(1)},${ay.toFixed(1)} C${A.x.toFixed(1)},${(ay + da * k).toFixed(1)} ${B.x.toFixed(1)},${(by + db * k).toFixed(1)} ${B.x.toFixed(1)},${by.toFixed(1)}`, mx: (A.x + B.x) / 2, my: (ay + by) / 2, la: { x: A.x, y: ay + da * 5 }, lb: { x: B.x, y: by + db * 5 } };
  }
  const ICON = {
    pc: '<rect x="-20" y="-18" width="40" height="27" rx="3" class="body"/><rect x="-15" y="-13" width="30" height="17" class="screen"/><path class="stroke" d="M0 9v6M-10 16h20"/>',
    server: '<rect x="-15" y="-22" width="30" height="44" rx="3" class="body"/><path class="stroke" d="M-9 -12h18M-9 -4h18M-9 4h18"/><circle cx="7" cy="14" r="2.2" class="dot"/>',
    phone: '<rect x="-13" y="-20" width="26" height="38" rx="4" class="body"/><rect x="-8" y="-15" width="16" height="9" class="screen"/>' + [-6, 0, 6].map(x => [0, 6, 12].map(y => `<circle cx="${x}" cy="${y}" r="1.6" class="dot"/>`).join('')).join(''),
    cloud: '<path class="body" d="M-26 12a12 12 0 0 1 2-23 16 16 0 0 1 30-4 12 12 0 0 1 20 9 10 10 0 0 1-2 18z"/><path class="stroke" d="M-8 1h16M0 -7v16"/>',
    printer: '<rect x="-20" y="-8" width="40" height="20" rx="3" class="body"/><path class="stroke" d="M-12 -8v-10h24v10M-12 12v6h24v-6"/><circle cx="13" cy="0" r="2" class="dot"/>'
  };
  function drawPlan() {
    const net = S.net, LC = {}; for (const id in net.devs) LC[id] = layout(net.devs[id]);
    const P = (id, p) => { const d = net.devs[id], L = LC[id], q = L.ports[p]; return { x: d.x - L.w / 2 + q.x + q.s / 2, y: d.y - L.h / 2 + q.y + q.s / 2, s: q.s, row: q.row, rows: L.rows }; };
    let s = defs() + '<pattern id="gr" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".9" style="fill:var(--line)"/></pattern><rect width="' + VW + '" height="' + VH + '" fill="url(#gr)" pointer-events="none"/>', cab = '';
    const lamp = st => st.st === 'connected' ? '#3DDB8A' : st.st === 'err-disabled' ? '#FFB020' : st.link && st.st !== 'disabled' ? '#FF5A4A' : st.st === 'disabled' ? '#8a8f95' : '#FF5A4A';
    net.links.forEach((l, li) => {
      if (!LC[l.a] || !LC[l.b] || !LC[l.a].ports[l.ap] || !LC[l.b].ports[l.bp]) return;
      const st = NL.portStatus(net, l.a, l.ap), up = st.st === 'connected', rel = S.sel && (l.a === S.sel || l.b === S.sel), c = cablePath(P(l.a, l.ap), P(l.b, l.bp));
      cab += `<g class="lw ${rel ? 'rel' : ''}" data-d="${l.a}" data-p="${esc(l.ap)}"><title>${esc(dh(l.a))} ${esc(SH(l.ap))} ↔ ${esc(dh(l.b))} ${esc(SH(l.bp))}, ${CABSHORT[l.cable || 'cu']}${up ? ', Link up' : ', kein Link: ' + esc(st.reason)}</title>`
        + `<path d="${c.d}" class="wire hit"/><path d="${c.d}" data-li="${li}" class="wire ${up ? '' : 'dn'} ${l.cut ? 'cut' : ''}" style="stroke:${CABCOL[l.cable || 'cu']}"/><circle class="lamp" cx="${c.la.x.toFixed(1)}" cy="${c.la.y.toFixed(1)}" r="2.7" style="fill:${lamp(st)}"/><circle class="lamp" cx="${c.lb.x.toFixed(1)}" cy="${c.lb.y.toFixed(1)}" r="2.7" style="fill:${lamp(NL.portStatus(net, l.b, l.bp))}"/>${up ? '' : `<circle cx="${c.mx}" cy="${c.my}" r="7" class="xdot"/><path class="xmark" d="M${c.mx - 3} ${c.my - 3}l6 6m0 -6l-6 6"/>`}</g>`;
    });
    s += cab;
    for (const id in net.devs) {
      const d = net.devs[id], L = LC[id], x = d.x - L.w / 2, y = d.y - L.h / 2, h0 = hip(d, d.ports[0]) || {}, M = MODELS[d.model] || {};
      const sub = L.icon ? (NL.isHost(d) ? (h0.ip ? h0.ip + '/' + NL.maskLen(h0.mask) : 'keine IP') : '') : (M.label || '').replace(/^(Huawei|Cisco) /, '');
      const stt = L.icon ? null : stats(d);
      s += `<g class="dev ${id === S.sel ? 'sel' : ''} ${id === S.pduSrc ? 'src' : ''} ${d.off ? 'off' : ''}" data-dev="${id}" transform="translate(${x.toFixed(1)},${y.toFixed(1)})" tabindex="0" role="button" aria-label="${esc(d.cfg.hostname)} auswählen">`
        + `<rect class="selbox" x="-5" y="-5" width="${L.w + 10}" height="${L.h + 10}" rx="7"/>`
        + (L.icon ? `<g transform="translate(32,34) scale(.85)" class="ic">${ICON[d.icon] || ICON[d.type]}</g>` : `<rect class="fpl t-${d.fw ? 'fw' : d.type}" width="${L.w}" height="${L.h}" rx="4"/>${groupsSvg(L, 0, 0, false)}`)
        + portsSvg(d, L, 0, 0, false)
        + (L.icon ? `<text class="hn" x="${L.w / 2}" y="${L.h + 14}">${esc(d.cfg.hostname)}</text><text class="ipl" x="${L.w / 2}" y="${L.h + 26}">${esc(sub)}</text>`
          : `<text class="hn" x="${L.w / 2}" y="-18">${esc(d.cfg.hostname)}</text><text class="ipl" x="${L.w / 2}" y="-6">${esc(sub)} · ${stt.used}/${stt.total} belegt</text>`) + '</g>';
    }
    s += simOverlay();
    if (!Object.keys(net.devs).length) s += `<text x="${VW / 2}" y="${VH / 2}" class="empty">Leeres Projekt. Öffne links eine Kategorie und wähle ein Gerät.</text>`;
    return s;
  }

  // ---------------- rack view ----------------
  function drawRack() {
    const net = S.net; let s = defs(), under = '', over = '';
    s += `<rect class="rackbody" x="${RX - 10}" y="16" width="${RW + 20}" height="${RU * UH + 24}" rx="4"/>`;
    for (let u = 1; u <= RU; u++) { const y = 28 + (RU - u) * UH; s += `<rect class="ru ${u % 2 ? 'a' : 'b'}" x="${RX}" y="${y}" width="${RW}" height="${UH}"/><text class="rn" x="${RX - 14}" y="${y + UH / 2 + 3}">${u}</text>`; }
    const placed = Object.values(net.devs).filter(d => uOf(d) && d.rack), used = placed.reduce((n, d) => n + uOf(d), 0);
    s += `<text class="rt" x="${RX}" y="11">Rack A · ${used} von ${RU} HE belegt</text>`;
    const LC = {};
    placed.forEach(d => {
      const L = layout(d), h = uOf(d) * UH, k = Math.min(1, (h - 4) / L.h), y = 28 + (RU - (d.rack + uOf(d) - 1)) * UH, ox = RW - L.w * k - 10, oy = (h - L.h * k) / 2;
      LC[d.id] = { L, k, ox, oy, y };
      s += `<g class="rdev ${d.id === S.sel ? 'sel' : ''} ${d.off ? 'off' : ''}" data-dev="${d.id}" transform="translate(${RX},${y})" tabindex="0" role="button" aria-label="${esc(d.cfg.hostname)} auswählen"><rect class="rface t-${d.fw ? 'fw' : d.type}" width="${RW}" height="${h - 1}" rx="2"/><rect class="rear" x="-5" y="3" width="5" height="${h - 7}"/><rect class="rear" x="${RW}" y="3" width="5" height="${h - 7}"/>`
        + `<text class="rname" x="10" y="${h / 2 - 2}">${esc(d.cfg.hostname)}</text><text class="rmod" x="10" y="${h / 2 + 9}">${esc(((MODELS[d.model] || {}).label || '').replace(/^(Huawei|Cisco) /, '').slice(0, 24))}</text>`
        + `<g transform="translate(${ox.toFixed(1)},${oy.toFixed(1)}) scale(${k.toFixed(3)})">${groupsSvg(L, 0, 0, false)}${portsSvg(d, L, 0, 0, false)}</g></g>`;
    });
    net.links.forEach((l, li) => {
      const a = LC[l.a], b = LC[l.b]; if (!a || !b || !a.L.ports[l.ap] || !b.L.ports[l.bp]) return;
      const pt = (c, p) => { const q = c.L.ports[p]; return { x: RX + c.ox + (q.x + q.s / 2) * c.k, y: c.y + c.oy + (q.y + q.s / 2) * c.k }; };
      const A = pt(a, l.ap), B = pt(b, l.bp), X = RX + RW + 26 + (li % 18) * 8, st = NL.portStatus(net, l.a, l.ap), up = st.st === 'connected', rel = S.sel && (l.a === S.sel || l.b === S.sel);
      const dd = `M${A.x},${A.y} C${X},${A.y} ${X},${B.y} ${B.x},${B.y}`;
      const path = `<g class="lw ${rel ? 'rel' : ''}" data-d="${l.a}" data-p="${esc(l.ap)}"><title>${esc(dh(l.a))} ${esc(SH(l.ap))} ↔ ${esc(dh(l.b))} ${esc(SH(l.bp))}, ${CABSHORT[l.cable || 'cu']}${up ? '' : ', kein Link: ' + esc(st.reason)}</title><path class="wire hit" d="${dd}"/><path class="wire ${up ? '' : 'dn'}" style="stroke:${CABCOL[l.cable || 'cu']}" d="${dd}"/></g>`;
      if (rel) over += path; else under += path;
    });
    return s.replace('</defs>', '</defs>' + under) + over;
  }
  function fitVB() {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const d of Object.values(S.net.devs)) { const L = layout(d); x0 = Math.min(x0, d.x - L.w / 2); x1 = Math.max(x1, d.x + L.w / 2); y0 = Math.min(y0, d.y - L.h / 2 - 28); y1 = Math.max(y1, d.y + L.h / 2 + 34); }
    if (x0 > x1) return { x: 0, y: 0, w: VW, h: VH };
    let w = Math.max(760, x1 - x0 + 120), h = Math.max(440, y1 - y0 + 90); const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    return { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w: Math.round(w), h: Math.round(h) };
  }
  function drawView() {
    const svg = $('#cv'), wrap = $('#cvwrap'); wrap.classList.toggle('rack', S.view === 'rack');
    if (S.view === 'rack') { svg.setAttribute('viewBox', `0 0 700 ${RU * UH + 52}`); svg.style.width = '700px'; svg.style.height = (RU * UH + 52) + 'px'; svg.style.maxWidth = 'none'; svg.innerHTML = drawRack(); }
    else { const v = S.vb || (S.vb = fitVB()); svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`); svg.style.width = ''; svg.style.height = ''; svg.style.maxWidth = ''; svg.innerHTML = drawPlan(); }
  }
  function wireCanvas() {
    const svg = $('#cv');
    const pt = e => { const r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal, k = Math.min(r.width / vb.width, r.height / vb.height), ox = (r.width - vb.width * k) / 2, oy = (r.height - vb.height * k) / 2; return S.view === 'rack' ? { x: (e.clientX - r.left) * vb.width / r.width, y: (e.clientY - r.top) * vb.height / r.height } : { x: vb.x + (e.clientX - r.left - ox) / k, y: vb.y + (e.clientY - r.top - oy) / k }; };
    svg.addEventListener('pointerdown', e => {
      if (e.target.closest('.cp') || e.target.closest('.lw')) return; const g = e.target.closest('[data-dev]'); if (!g) return;
      const d = S.net.devs[g.dataset.dev], p = pt(e); S.drag = { id: d.id, sx: p.x, sy: p.y, ox: d.x, oy: d.y, orack: d.rack, moved: false, snap: JSON.stringify(S.net) }; svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', e => {
      if (!S.drag) return; const p = pt(e), d = S.net.devs[S.drag.id], dx = p.x - S.drag.sx, dy = p.y - S.drag.sy; if (Math.abs(dx) + Math.abs(dy) > 4) S.drag.moved = true; if (!S.drag.moved) return;
      if (S.view === 'plan') { const L = layout(d); const v = S.vb || { x: 0, y: 0, w: VW, h: VH }; d.x = Math.max(v.x + L.w / 2 + 8, Math.min(v.x + v.w - L.w / 2 - 8, Math.round(S.drag.ox + dx))); d.y = Math.max(v.y + L.h / 2 + 30, Math.min(v.y + v.h - L.h / 2 - 36, Math.round(S.drag.oy + dy))); drawView(); }
      else if (uOf(d) && S.drag.orack) { const pos = Math.max(1, Math.min(RU - uOf(d) + 1, Math.round(S.drag.orack - dy / UH))); if (pos !== d.rack && freeAt(S.net, d.id, pos, uOf(d))) { d.rack = pos; drawView(); } }
    });
    svg.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('text/plain')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    svg.addEventListener('drop', e => { e.preventDefault(); const m = e.dataTransfer.getData('text/plain'); if (!MODELS[m]) return; const p = pt(e); if (S.view === 'rack') addAt(m); else addAt(m, Math.round(p.x), Math.round(p.y)); });
    svg.addEventListener('pointerup', () => { if (!S.drag) return; const { id, moved, snap } = S.drag; S.drag = null; if (moved) { if (snap) { S.undo.push(snap); if (S.undo.length > 60) S.undo.shift(); S.redo = []; } save(); drawInsp(); $('#undoBtn').disabled = false; } else { const now = Date.now(), lc = S.lastClick; if (lc && lc.id === id && now - lc.t < 380 && S.tool === 'select' && !S.cabling) { S.lastClick = null; dblDev(id); } else { S.lastClick = { id, t: now }; clickDev(id); } } });
    svg.addEventListener('click', e => { const c = e.target.closest('.cp') || e.target.closest('.lw'); if (c) portClick(c.dataset.d, c.dataset.p, !e.target.closest('.cp')); });
    svg.addEventListener('keydown', e => { const g = e.target.closest('[data-dev]'); if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); clickDev(g.dataset.dev); } });
  }
  function dblDev(id) { const d = S.net.devs[id]; if (!d) return; if (canApps(d)) { S.sel = id; render(); openApps(id, 'home'); } else if (!NL.isHost(d) && d.type !== 'fc') { S.sel = id; S.dock = 'cli'; S.dockOpen = true; render(); setTimeout(() => $('#cmd').focus(), 0); } }
  function delDev(id) { act(() => { S.net.links = S.net.links.filter(l => l.a !== id && l.b !== id); delete S.net.devs[id]; delete S.out[id]; if (S.sel === id) { S.sel = null; S.port = null; } }); }
  function toggleOff(id) { const d = S.net.devs[id]; act(() => { d.off = !d.off; toast(d.off ? `<b>${esc(d.cfg.hostname)}</b> ist ausgeschaltet – alle Links daran sind down.` : `${esc(d.cfg.hostname)} läuft wieder.`); }); }
  function clickDev(id) { if (S.tool === 'delete' && !S.cabling) { delDev(id); return; } if (S.tool === 'fail' && !S.cabling) { toggleOff(id); return; } if (S.tool === 'pdu' && !S.cabling) { pduPick(id); return; } const d = S.net.devs[id]; if (S.cabling && S.pend && isIcon(d) && S.pend.dev !== id) { portClick(id, d.ports[0]); return; } S.sel = id; S.port = isIcon(d) ? d.ports[0] : null; render(); }

  // ---------------- cabling ----------------
  function connect(id, p) {
    const A = S.pend, net = S.net;
    if (NL.linkOf(net, id, p)) { toast(`${esc(dh(id))} ${esc(SH(p))} ist bereits belegt.`); render(); return; }
    act(() => {
      net.links.push({ a: A.dev, ap: A.port, b: id, bp: p, cable: S.cable });
      const st = NL.portStatus(net, A.dev, A.port);
      toast(st.st === 'connected' ? `Kabel gesteckt: ${esc(dh(A.dev))} ${esc(SH(A.port))} ↔ ${esc(dh(id))} ${esc(SH(p))} – Link up (${NL.fmtSpeed(st.speed, st.proto)}).` : `<span class="neg">Kabel gesteckt, aber kein Link:</span> ${esc(st.reason)}`);
      S.pend = null; S.sel = id; S.port = p;
    });
  }
  function portClick(id, p, cableClick) {
    const d = S.net.devs[id];
    if (S.tool === 'delete' && !S.cabling) { const l = NL.linkOf(S.net, id, p); if (l) act(() => { S.net.links = S.net.links.filter(x => x !== l); toast('Kabel entfernt.'); }); else if (!cableClick) delDev(id); return; }
    if (S.tool === 'fail' && !S.cabling) { const l = NL.linkOf(S.net, id, p); if (l) act(() => { l.cut = !l.cut; toast(l.cut ? 'Kabel gezogen – der Link ist down.' : 'Kabel wieder gesteckt.'); }); else if (!cableClick) toggleOff(id); return; }
    if (S.tool === 'pdu' && !S.cabling) { pduPick(id); return; }
    if (S.cabling && !cableClick) {
      if (NL.linkOf(S.net, id, p)) { toast(`${esc(d.cfg.hostname)} ${esc(SH(p))} ist bereits belegt – erst das Kabel entfernen.`); S.sel = id; S.port = p; render(); return; }
      if (!S.pend || S.pend.dev === id) { S.pend = S.pend && S.pend.dev === id && S.pend.port === p ? null : { dev: id, port: p }; S.sel = id; S.port = p; render(); return; }
      connect(id, p); return;
    }
    S.sel = id; S.port = p; render();
  }

  // ---------------- front panel zoom + occupancy ----------------
  function drawPanel() {
    const fp = $('#fp'), d = S.net.devs[S.sel]; if (!d) { fp.innerHTML = '<p class="empty-note">Wähle ein Gerät im Plan aus, um seine Ports zu sehen.</p>'; return; }
    const M = MODELS[d.model] || {}, L = layout(d), t = stats(d), sc = L.icon ? 3 : Math.min(3, 940 / L.w), seg = (n, c) => n ? `<i class="${c}" style="flex:${n}"></i>` : '';
    const body = L.icon ? `<g transform="translate(32,34) scale(.85)" class="ic">${ICON[d.icon] || ICON[d.type]}</g>` : `<rect class="fpl t-${d.fw ? 'fw' : d.type}" width="${L.w}" height="${L.h}" rx="4"/>${groupsSvg(L, 0, 0, true)}`;
    fp.innerHTML = `<div class="phead"><div class="pt1"><b>${esc(d.cfg.hostname)}</b><span class="muted">${esc((M.info || M.label || d.type).replace(' (vereinfachtes Planungsmodell)', ''))}</span></div>
      <div class="chips"><span class="chip"><b>${t.used}</b> von ${t.total} belegt</span>${t.up ? `<span class="chip g">${t.up} up</span>` : ''}${t.bad ? `<span class="chip r">${t.bad} ohne Link</span>` : ''}${t.shut ? `<span class="chip">${t.shut} shutdown</span>` : ''}<span class="chip">${t.free} frei</span></div></div>
      <div class="obar" role="img" aria-label="Portbelegung">${seg(t.up, 'up')}${seg(t.bad, 'bad')}${seg(Math.max(0, t.used - t.up - t.bad), 'sh')}${seg(t.free, 'fr')}</div>
      <div class="fpwrap"><svg class="fpsvg" viewBox="${L.icon ? '0 0 64 58' : `0 0 ${L.w} ${L.h}`}" width="${(L.icon ? 64 : L.w) * sc}" height="${(L.icon ? 58 : L.h) * sc}" role="group" aria-label="Frontpanel ${esc(d.cfg.hostname)}">${defs()}${body}${portsSvg(d, L, 0, 0, true)}</svg></div>
      <div class="plegend"><span><i class="ld on"></i>Link up</span><span><i class="ld er"></i>err-disabled</span><span><i class="ld dn"></i>kein Link</span><span><i class="ld off"></i>frei</span>${d.type === 'switch' ? Object.keys(d.cfg.vlans).map(Number).sort((a, b) => a - b).map(v => `<span><i class="vsw" style="background:${vcolor(v)}"></i>VLAN ${v}</span>`).join('') + '<span><i class="vsw tr"></i>Trunk</span>' : ''}</div>
      ${L.icon ? '' : portTable(d)}`;
    $$('.pfil button', fp).forEach(b => b.onclick = () => { S.tf = b.dataset.f; drawPanel(); });
    $$('tr[data-p]', fp).forEach(r => r.onclick = () => { S.port = r.dataset.p; S.itab = 'port'; render(); });
  }
  function portTable(d) {
    const rows = d.ports.map(p => ({ p, ...pstat(d, p), i: d.cfg.ifs && d.cfg.ifs[p] }));
    const keep = r => S.tf === 'all' || (S.tf === 'used' && r.st.link) || (S.tf === 'free' && !r.st.link) || (S.tf === 'bad' && (r.cls === 'err' || r.cls === 'down'));
    const mode = r => d.type === 'switch' ? (r.i.mode === 'trunk' ? `Trunk, nativ ${r.i.native}` : 'VLAN ' + r.i.vlan) : d.fw ? (r.i.nameif ? `${r.i.nameif} (${r.i.sl === null ? 0 : r.i.sl})` : '–') : NL.isHost(d) ? (d.use[r.p] || (isMg(r.p) ? 'Management' : d.pk[r.p] === 'fc' ? 'SAN (FC)' : 'Daten')) : '';
    const ip = r => { if (NL.isHost(d)) { if (d.pk[r.p] === 'fc') return NL.wwpn(d, r.p); const h = hip(d, r.p); return h && h.ip ? h.ip + '/' + NL.maskLen(h.mask) : ''; } return r.i && r.i.ip ? r.i.ip + '/' + NL.maskLen(r.i.mask) : (r.i && r.i.desc) || ''; };
    const lbl = { up: 'up', err: 'err-disabled', down: 'kein Link', shut: 'shutdown', shutfree: 'shutdown', free: 'frei' };
    return `<div class="ptab"><div class="pfil" role="group" aria-label="Filter">${[['all', 'Alle'], ['used', 'Belegt'], ['free', 'Frei'], ['bad', 'Fehler']].map(([k, n]) => `<button class="${S.tf === k ? 'act' : ''}" data-f="${k}">${n}</button>`).join('')}</div>
      <div class="tscroll ptscroll"><table class="eps pt2"><thead><tr><th>Port</th><th>Status</th><th>${d.type === 'switch' ? 'Modus / VLAN' : d.fw ? 'Zone' : 'Verwendung'}</th><th>Gegenstelle</th><th>Kabel</th><th>Speed</th><th>${NL.isHost(d) ? 'IP / WWPN' : 'IP / Beschreibung'}</th></tr></thead><tbody>
      ${rows.filter(keep).map(r => `<tr data-p="${esc(r.p)}" class="${S.sel === d.id && S.port === r.p ? 'cur' : ''} c-${r.cls}"><td><b>${esc(SH(r.p))}</b></td><td><span class="sdot s-${r.cls}"></span>${lbl[r.cls]}</td><td>${esc(mode(r))}</td><td>${r.st.link ? esc(peerTxt(r.st)) : '<span class="muted">–</span>'}</td><td>${r.st.link ? CABSHORT[r.st.link.cable || 'cu'] + (d.xcvr[r.p] ? ` <span class="muted">(${esc(d.xcvr[r.p])})</span>` : '') : (d.xcvr[r.p] ? `<span class="muted">${esc(d.xcvr[r.p])} gesteckt</span>` : '')}</td><td>${r.st.speed ? NL.fmtSpeed(r.st.speed, r.st.proto) : ''}</td><td class="mono">${esc(ip(r))}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Keine Ports in dieser Auswahl.</td></tr>'}
      </tbody></table></div></div>`;
  }

  // ---------------- inspector ----------------
  const opt = (v, cur, label) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(label == null ? v : label)}</option>`;
  const vlStr = a => a === null ? 'all' : a.slice().sort((x, y) => x - y).join(',');
  function drawInsp() {
    const el = $('#insp'), d = S.net.devs[S.sel]; if (!d) { el.innerHTML = '<p class="empty-note">Wähle ein Gerät im Plan aus.</p>'; return; }
    if (S.port !== S._sp) { S._sp = S.port; if (S.port) S.itab = 'port'; }
    const M = MODELS[d.model] || {}, hp = !!S.port, tab = hp && S.itab !== 'dev' ? 'port' : 'dev';
    el.innerHTML = `<div class="ihead"><b>${esc(d.cfg.hostname)}</b><span class="muted">${esc((M.label || d.type).replace(/^(Huawei|Cisco) /, ''))}</span></div>` + (hp ? `<div class="itabs" role="tablist"><button role="tab" class="${tab === 'port' ? 'act' : ''}" data-i="port">Port ${esc(SH(S.port))}</button><button role="tab" class="${tab === 'dev' ? 'act' : ''}" data-i="dev">Gerät</button></div>` : '')
      + `<div class="ibody">${tab === 'port' ? portCard(d, S.port) : devCard(d)}</div>`;
    $$('.itabs [data-i]', el).forEach(b => b.onclick = () => { S.itab = b.dataset.i; drawInsp(); });
    wireInsp(d);
  }
  function portCard(d, p) {
    const st = NL.portStatus(S.net, d.id, p), i = d.cfg.ifs && d.cfg.ifs[p], k = d.pk[p], hostD = NL.isHost(d), card = d.pcard && d.pcard[p] ? CARDS[d.pcard[p]] : null;
    let h = `<section class="card"><h3>Port ${esc(SH(p))} <span class="muted">${esc(KIND[k].label)}${card ? ', ' + esc(card.short) : ''}</span></h3>`;
    h += `<p class="pst s-${st.st}"><b>${st.st === 'connected' ? 'Link up, ' + NL.fmtSpeed(st.speed, st.proto) : st.st === 'notconnect' ? 'Kein Link' : st.st}</b>${st.st !== 'connected' && st.reason ? ' – ' + esc(st.reason) : ''}</p>`;
    if (st.link) h += `<p class="conn">Kabel: ${CABSHORT[st.link.cable || 'cu']}<br>zu <b>${esc(dh(st.peer.dev))}</b> ${esc(SH(st.peer.port))} <button class="lnkbtn" id="goPeer">anzeigen</button></p><button class="btn small" id="unplug">Kabel entfernen</button>`;
    else h += `<p class="conn muted">Kein Kabel gesteckt.</p><button class="btn small" id="plugFrom">Kabel von hier verlegen</button>`;
    if (k !== 'rj45') h += `<div class="f"><label for="xc">Transceiver im ${esc(KIND[k].label)}-Slot</label><select id="xc">${opt('', d.xcvr[p] || '', '– leer (oder DAC-Kabel) –')}${Object.entries(XCVR).filter(([x, X]) => NL.slotAccepts(k, X)).map(([x, X]) => opt(x, d.xcvr[p] || '', `${x} (${X.label})`)).join('')}</select></div>`;
    if (card && card.roce) h += `<p class="note">Diese Karte ist RoCE v2-fähig (RDMA). Der Switch-Port braucht <code>priority-flow-control mode on</code> und MTU 9216.</p>`;
    if (hostD) {
      if (k === 'fc') h += `<div class="f"><label>WWPN (automatisch)</label><code class="mono">${NL.wwpn(d, p)}</code></div>`;
      else { const cur = hip(d, p); h += `<div class="f"><label for="pip">IP-Adresse / Präfix</label><input id="pip" value="${cur && cur.ip ? cur.ip + '/' + NL.maskLen(cur.mask) : ''}" placeholder="z. B. 10.20.0.11/24"></div>`; }
      h += `<div class="f"><label for="puse">Verwendung</label><select id="puse">${opt('', d.use[p] || '', isMg(p) ? 'Management (Standard)' : k === 'fc' ? 'SAN (Standard)' : 'Daten (Standard)')}${USES.map(u => opt(u, d.use[p] || '')).join('')}</select></div><button class="btn primary" id="papply">Übernehmen</button>`;
      return h + '</section>';
    }
    if (d.type === 'fc') return h + '<p class="muted small">FC-Switch-Ports werden über Transceiver und Kabel eingestellt. Zoning entsteht aus der Verkabelung (siehe Export).</p></section>';
    h += `<div class="f"><label for="pdesc">Beschreibung</label><input id="pdesc" value="${esc(i.desc)}" maxlength="60" placeholder="z. B. Uplink SW-CORE Te1/0/1"></div>`;
    const sp = (i.extra.find(x => /^speed \d+$/.test(x)) || 'speed auto').split(' ')[1];
    h += `<div class="f2"><div class="f"><label for="padm">Status</label><select id="padm">${opt('up', i.shutdown ? 'down' : 'up', 'no shutdown')}${opt('down', i.shutdown ? 'down' : 'up', 'shutdown')}</select></div>${k === 'rj45' && d.type === 'switch' ? `<div class="f"><label for="pspd">Speed</label><select id="pspd">${['auto', '10', '100', '1000'].map(v => opt(v, sp)).join('')}</select></div>` : ''}</div>`;
    if (d.type === 'switch') {
      const vls = Object.keys(d.cfg.vlans).map(Number).sort((a, b) => a - b), voice = (i.extra.find(x => x.startsWith('switchport voice vlan ')) || '').split(' ').pop() || '', has = x => i.extra.includes(x);
      h += `<div class="f"><label>Modus</label><div class="seg">${['access', 'trunk'].map(m => `<label><input type="radio" name="pmode" value="${m}" ${i.mode === m ? 'checked' : ''}>${m === 'access' ? 'Access' : 'Trunk (802.1Q)'}</label>`).join('')}</div></div>
        <div class="when-access" ${i.mode === 'trunk' ? 'hidden' : ''}><div class="f2"><div class="f"><label for="pvl">Access-VLAN</label><select id="pvl">${vls.map(v => opt(v, i.vlan, v + ' ' + d.cfg.vlans[v])).join('')}</select></div>
          <div class="f"><label for="pvv">Voice-VLAN</label><select id="pvv">${opt('', voice, '–')}${vls.filter(v => v !== 1).map(v => opt(v, voice, v + ' ' + d.cfg.vlans[v])).join('')}</select></div></div></div>
        <details class="acc"><summary>Schutz, NAC &amp; RoCE</summary><div class="accb"><div class="when-access" ${i.mode === 'trunk' ? 'hidden' : ''}><label class="ck"><input type="checkbox" id="ppf" ${has('spanning-tree portfast') ? 'checked' : ''}> PortFast</label>
          <label class="ck"><input type="checkbox" id="pbg" ${i.extra.some(x => x.startsWith('spanning-tree bpduguard enable')) ? 'checked' : ''}> BPDU Guard</label>
          <label class="ck"><input type="checkbox" id="pnac" ${has('authentication port-control auto') ? 'checked' : ''}> 802.1X + MAB (NAC)</label></div>
        <label class="ck"><input type="checkbox" id="ppfc" ${has('priority-flow-control mode on') ? 'checked' : ''}> PFC (verlustfrei, für RoCE)</label>
        <label class="ck"><input type="checkbox" id="pmtu" ${has('mtu 9216') ? 'checked' : ''}> Jumbo-MTU 9216</label></div></details>
        <div class="when-trunk" ${i.mode === 'trunk' ? '' : 'hidden'}><div class="f2"><div class="f"><label for="pnat">Native VLAN</label><input id="pnat" inputmode="numeric" value="${i.native}"></div>
          <div class="f"><label for="pall">Erlaubte VLANs</label><input id="pall" value="${vlStr(i.allowed)}" placeholder="all oder 10,20,99"></div></div></div>`;
    } else if (d.fw) {
      h += `<div class="f2"><div class="f"><label for="pnif">Zone (nameif)</label><input id="pnif" value="${esc(i.nameif || '')}" placeholder="inside / outside / dmz" list="nifs"><datalist id="nifs"><option>inside</option><option>outside</option><option>dmz</option></datalist></div><div class="f"><label for="psl">Security-Level</label><input id="psl" inputmode="numeric" value="${i.sl === null ? '' : i.sl}" placeholder="0–100"></div></div>
        <div class="f2"><div class="f"><label for="pip">IP-Adresse</label><input id="pip" value="${esc(i.ip || '')}"></div><div class="f"><label for="pmask">Maske</label><input id="pmask" value="${esc(i.mask || '')}" placeholder="255.255.255.0"></div></div>`;
    } else h += `<div class="f2"><div class="f"><label for="pip">IP-Adresse</label><input id="pip" value="${esc(i.ip || '')}" placeholder="10.0.0.1"></div><div class="f"><label for="pmask">Maske</label><input id="pmask" value="${esc(i.mask || '')}" placeholder="255.255.255.0"></div></div>`;
    return h + '<button class="btn primary block" id="papply">Übernehmen</button><p class="muted small">Die Änderung wird als IOS-/ASA-Befehle in die Konsole geschrieben.</p></section>';
  }
  const mgmtVlan = d => { const s = Object.keys(d.cfg.ifs).find(n => n.startsWith('Vlan') && d.cfg.ifs[n].ip); return s ? +s.slice(4) : 1; };
  const mgmtIp = d => { const s = Object.keys(d.cfg.ifs).find(n => n.startsWith('Vlan') && d.cfg.ifs[n].ip); return s ? d.cfg.ifs[s].ip + '/' + NL.maskLen(d.cfg.ifs[s].mask) : ''; };
  const acc = (t, body, open) => `<details class="acc" ${open ? 'open' : ''}><summary>${t}</summary><div class="accb">${body}</div></details>`;
  function devCard(d) {
    const M = MODELS[d.model] || {}, u = uOf(d);
    let h = `<section class="card"><h3 class="hid">${esc(d.cfg.hostname)}</h3><div class="f"><label for="dhost">Hostname</label><div class="irow"><input id="dhost" value="${esc(d.cfg.hostname)}"><button class="btn small" id="dhostGo">Setzen</button></div></div>`;
    if (canApps(d)) h += `<div class="appbtns"><button class="btn small" id="appDesk">Desktop öffnen</button>${d.type === 'server' ? '<button class="btn small" id="appSvc">Dienste</button>' : ''}</div>`;
    if (NL.isHost(d)) h += `<div class="f"><label for="hgw">Default-Gateway</label><div class="irow"><input id="hgw" value="${esc(d.cfg.gw || '')}" placeholder="z. B. 10.10.0.1"><button class="btn small" id="hgwGo">Setzen</button></div></div>`;
    if (d.cards) h += acc(`Steckplätze${d.type === 'storage' ? ' (je Controller)' : ''}`, d.cards.map((ck, i) => `<div class="f"><label for="sl${i}">Slot ${i + 1}</label><select id="sl${i}" data-slot="${i}">${opt('', ck || '', '– frei –')}${Object.entries(CARDS).filter(([k, C]) => C.for === d.type).map(([k, C]) => opt(k, ck || '', C.label)).join('')}</select></div>`).join(''), true);
    if (d.type === 'switch') {
      const vls = Object.keys(d.cfg.vlans).map(Number).sort((a, b) => a - b);
      h += acc('VLANs', `<table class="vt">${vls.map(v => `<tr><td><i class="vsw" style="background:${vcolor(v)}"></i>${v}</td><td>${esc(d.cfg.vlans[v])}</td><td>${v === 1 ? '' : `<button class="lnkbtn" data-delv="${v}" aria-label="VLAN ${v} löschen">löschen</button>`}</td></tr>`).join('')}</table><div class="irow"><input id="nvid" inputmode="numeric" placeholder="ID" aria-label="VLAN-ID" style="width:5rem"><input id="nvname" placeholder="Name" aria-label="VLAN-Name"><button class="btn small" id="nvgo">Anlegen</button></div>`, true)
        + acc('Management', `<div class="f2"><div class="f"><label for="mvl">SVI-VLAN</label><select id="mvl">${vls.map(v => opt(v, mgmtVlan(d))).join('')}</select></div><div class="f"><label for="mip">IP/Präfix</label><input id="mip" value="${mgmtIp(d)}" placeholder="z. B. 10.99.0.11/24"></div></div>
        <div class="f"><label for="mgw">Default-Gateway</label><input id="mgw" value="${esc(d.cfg.gw || '')}" placeholder="z. B. 10.99.0.1"></div><label class="ck"><input type="checkbox" id="mrt" ${d.cfg.ipRouting ? 'checked' : ''}> Layer-3-Routing aktiv (ip routing)</label><button class="btn small" id="mgo">Übernehmen</button>`, false);
    }
    if (d.fw) h += acc('Firewall-Richtlinien', `<p class="muted small">${Object.values(d.cfg.acls).reduce((n, a) => n + a.length, 0)} ACL-Regeln, ${d.cfg.nat.length} NAT-Regeln, ${d.cfg.routes.length} Routen</p><button class="btn small" id="fwBtn">Regelwerk, NAT und Routen bearbeiten</button>`, true);
    if (d.type === 'fc') h += acc('Fabric', `<div class="f"><label for="vsan">VSAN</label><input id="vsan" inputmode="numeric" value="${d.cfg.vsan || 10}"></div>`, true);
    if (u) h += acc('Rack', `<div class="f2"><div class="f"><label for="rpos">Unterste HE (1–${RU})</label><input id="rpos" inputmode="numeric" value="${d.rack || ''}" placeholder="nicht eingebaut"></div><div class="f"><label>Höhe</label><span class="hv">${u} HE</span></div></div><div class="irow"><button class="btn small" id="rset">${d.rack ? 'Verschieben' : 'Einbauen'}</button>${d.rack ? '<button class="btn small ghost" id="runset">Ausbauen</button>' : ''}</div>`, false);
    return h + `<div class="drow"><button class="btn ghost small danger" id="ddel">Gerät löschen</button></div></section>`;
  }
  function runOn(id, lines, label) {
    const d = S.net.devs[id];
    act(() => {
      push(id, 'sys', '— ' + (label || 'Aus der Oberfläche übernommen') + ' —');
      const s = S.sess[id] = NL.newSess(), all = NL.isHost(d) ? lines : ['enable', 'configure terminal', ...lines, 'end'];
      all.forEach(l => { push(id, 'cmd', NL.prompt(d, s) + l); const r = NL.exec(S.net, id, s, l); if (r) r.split('\n').forEach(x => push(id, /^%/.test(x) && !/Creating vlan/.test(x) ? 'err' : 'out', x)); });
    });
  }
  function wireInsp(d) {
    const g = id => document.getElementById(id), p = S.port;
    if (g('unplug')) g('unplug').onclick = () => act(() => { const l = NL.linkOf(S.net, d.id, p); S.net.links = S.net.links.filter(x => x !== l); toast('Kabel entfernt.'); });
    if (g('plugFrom')) g('plugFrom').onclick = () => { S.cabling = true; S.pend = { dev: d.id, port: p }; render(); };
    if (g('goPeer')) g('goPeer').onclick = () => { const st = NL.portStatus(S.net, d.id, p); S.sel = st.peer.dev; S.port = st.peer.port; render(); };
    if (g('xc')) g('xc').onchange = e => act(() => { const v = e.target.value, old = d.xcvr[p]; if (v) d.xcvr[p] = v; else delete d.xcvr[p]; if (old) push(d.id, 'log', `%TRANSCEIVER-6-REMOVED: Transceiver module removed from ${p}`); if (v) push(d.id, 'log', `%TRANSCEIVER-6-INSERTED: Transceiver module ${v} inserted in ${p}`); });
    $$('input[name="pmode"]').forEach(r => r.onchange = () => { const t = r.value === 'trunk'; $$('.when-access').forEach(x => { x.hidden = t; }); $('.when-trunk').hidden = !t; });
    if (g('papply')) g('papply').onclick = () => {
      if (NL.isHost(d)) {
        const v = g('pip') ? g('pip').value.trim() : null, uv = g('puse').value;
        act(() => { if (uv) d.use[p] = uv; else delete d.use[p]; });
        if (v !== null) { const cur = hip(d, p), now = cur && cur.ip ? cur.ip + '/' + NL.maskLen(cur.mask) : ''; if (v !== now) { if (!v) act(() => { if (p === d.ports[0]) { d.cfg.ip = null; d.cfg.mask = null; } else delete d.cfg.nic[p]; }); else runOn(d.id, [`ip ${p} ${v.includes('/') ? v : v + '/24'}`], `${SH(p)} aus der Oberfläche`); } }
        return;
      }
      const i = d.cfg.ifs[p], c = [], desc = g('pdesc').value.trim(); if (desc !== i.desc) c.push(desc ? 'description ' + desc : 'no description');
      if (g('pspd')) { const cur = (i.extra.find(x => /^speed \d+$/.test(x)) || 'speed auto').split(' ')[1]; if (g('pspd').value !== cur) c.push('speed ' + g('pspd').value); }
      const tog = (on, has, onC, offC) => { if (on && !has) c.push(...onC); if (!on && has) c.push(...offC); };
      if (d.type === 'switch') {
        const mode = $('input[name="pmode"]:checked').value; if (mode !== i.mode || !i.modeSet) c.push('switchport mode ' + mode);
        if (mode === 'access') {
          const v = +g('pvl').value; if (v !== i.vlan) c.push('switchport access vlan ' + v);
          const vv = g('pvv').value, cvv = (i.extra.find(x => x.startsWith('switchport voice vlan ')) || '').split(' ').pop() || ''; if (vv !== cvv) c.push(vv ? 'switchport voice vlan ' + vv : 'no switchport voice vlan');
          tog(g('ppf').checked, i.extra.includes('spanning-tree portfast'), ['spanning-tree portfast'], ['no spanning-tree portfast']);
          tog(g('pbg').checked, i.extra.some(x => x.startsWith('spanning-tree bpduguard enable')), ['spanning-tree bpduguard enable'], ['no spanning-tree bpduguard']);
          tog(g('pnac').checked, i.extra.includes('authentication port-control auto'), ['authentication port-control auto', 'dot1x pae authenticator', 'mab'], ['no authentication port-control', 'no dot1x pae', 'no mab']);
        } else { const nat = +g('pnat').value; if (nat && nat !== i.native) c.push('switchport trunk native vlan ' + nat); const al = g('pall').value.replace(/\s+/g, '') || 'all'; if (al !== vlStr(i.allowed)) c.push('switchport trunk allowed vlan ' + al); }
        tog(g('ppfc').checked, i.extra.includes('priority-flow-control mode on'), ['priority-flow-control mode on'], ['no priority-flow-control']);
        tog(g('pmtu').checked, i.extra.includes('mtu 9216'), ['mtu 9216'], ['no mtu']);
      } else if (d.fw) {
        const nif = g('pnif').value.trim(), sl = g('psl').value.trim(), ip = g('pip').value.trim(), m = g('pmask').value.trim();
        if (nif && nif !== (i.nameif || '')) c.push('nameif ' + nif); if (!nif && i.nameif) c.push('no nameif'); if (sl !== '' && +sl !== i.sl) c.push('security-level ' + +sl);
        if (ip !== (i.ip || '') || m !== (i.mask || '')) c.push(ip ? `ip address ${ip} ${m}` : 'no ip address');
      } else { const ip = g('pip').value.trim(), m = g('pmask').value.trim(); if (ip !== (i.ip || '') || m !== (i.mask || '')) c.push(ip ? `ip address ${ip} ${m}` : 'no ip address'); }
      const adm = g('padm').value === 'down'; if (adm !== i.shutdown) c.push(adm ? 'shutdown' : 'no shutdown');
      if (!c.length) { toast('Keine Änderung.'); render(); return; }
      runOn(d.id, ['interface ' + p, ...c], `Port ${SH(p)} aus der Oberfläche`);
    };
    if (g('dhostGo')) g('dhostGo').onclick = () => { const v = g('dhost').value.trim().replace(/\s+/g, '-'); if (!v) return; if (NL.isHost(d) || d.type === 'fc') act(() => { d.cfg.hostname = v; }); else runOn(d.id, ['hostname ' + v]); };
    if (g('hgwGo')) g('hgwGo').onclick = () => { const v = g('hgw').value.trim(); if (v && !NL.validIp(v)) { toast('<span class="neg">Ungültiges Gateway.</span>'); render(); return; } act(() => { d.cfg.gw = v || null; }); };
    $$('[data-slot]').forEach(sel => sel.onchange = () => act(() => { const n = NL.setCard(S.net, d.id, +sel.dataset.slot, sel.value); toast(n ? `Karte geändert – ${n} Kabel an entfernten Ports wurden gelöst.` : 'Karte geändert.'); }));
    if (g('nvgo')) g('nvgo').onclick = () => { const v = +g('nvid').value, n = g('nvname').value.trim().replace(/\s+/g, '_'); if (!(v >= 2 && v <= 4094)) { toast('<span class="neg">VLAN-ID 2–4094.</span>'); render(); return; } runOn(d.id, ['vlan ' + v, ...(n ? ['name ' + n] : [])]); };
    $$('[data-delv]').forEach(b => b.onclick = () => runOn(d.id, ['no vlan ' + b.dataset.delv]));
    if (g('mgo')) g('mgo').onclick = () => {
      const c = [], v = +g('mvl').value, ipv = g('mip').value.trim(), gw = g('mgw').value.trim(), old = Object.keys(d.cfg.ifs).find(n => n.startsWith('Vlan') && d.cfg.ifs[n].ip);
      if (ipv) { const [ip, len] = ipv.split('/'); if (old && old !== 'Vlan' + v) c.push('interface ' + old, 'no ip address', 'exit'); c.push('interface vlan ' + v, `ip address ${ip} ${NL.lenMask(+(len || 24))}`, 'no shutdown', 'exit'); }
      if (gw !== (d.cfg.gw || '')) c.push(gw ? 'ip default-gateway ' + gw : 'no ip default-gateway'); if (g('mrt').checked !== d.cfg.ipRouting) c.push(g('mrt').checked ? 'ip routing' : 'no ip routing');
      if (c.length) runOn(d.id, c, 'Management aus der Oberfläche');
    };
    if (g('appDesk')) g('appDesk').onclick = () => openApps(d.id, 'home');
    if (g('appSvc')) g('appSvc').onclick = () => openApps(d.id, 'svc');
    if (g('fwBtn')) g('fwBtn').onclick = () => fwModal(d);
    if (g('vsan')) g('vsan').onchange = () => act(() => { d.cfg.vsan = Math.max(1, Math.min(4093, +g('vsan').value || 10)); });
    if (g('rset')) g('rset').onclick = () => { const v = +g('rpos').value, u = uOf(d); if (!(v >= 1 && v + u - 1 <= RU)) { toast(`<span class="neg">Position 1–${RU - u + 1} (Gerät belegt ${u} HE).</span>`); render(); return; } if (!freeAt(S.net, d.id, v, u)) { toast('<span class="neg">Dieser Platz im Rack ist bereits belegt.</span>'); render(); return; } act(() => { d.rack = v; toast(`${esc(d.cfg.hostname)} sitzt in HE ${v}${u > 1 ? '–' + (v + u - 1) : ''}.`); }); };
    if (g('runset')) g('runset').onclick = () => act(() => { d.rack = null; });
    if (g('ddel')) g('ddel').onclick = () => { if (!confirm(`${d.cfg.hostname} mit allen Kabeln löschen?`)) return; act(() => { S.net.links = S.net.links.filter(l => l.a !== d.id && l.b !== d.id); delete S.net.devs[d.id]; delete S.out[d.id]; S.sel = null; S.port = null; }); };
  }

  // ---------------- firewall policy modal ----------------
  const fwSpec = x => { x = (x || 'any').trim(); if (x === 'any' || !x) return 'any'; const m = x.match(/^(\d+\.\d+\.\d+\.\d+)(?:\/(\d+))?$/); if (!m || !NL.validIp(m[1])) return null; const l = m[2] === undefined ? 32 : +m[2]; if (l > 32) return null; return l === 32 ? 'host ' + m[1] : NL.n2ip(NL.netN(m[1], NL.lenMask(l))) + ' ' + NL.lenMask(l); };
  function fwModal(d) {
    const nifs = () => Object.keys(d.cfg.ifs).filter(n => d.cfg.ifs[n].nameif);
    const md = modal(`<h2>Richtlinien ${esc(d.cfg.hostname)}</h2><div id="fwbody" class="fwbody"></div>`, true);
    const cli = lines => { const s = NL.newSess(), out = []; ['enable', 'configure terminal', ...lines, 'end'].forEach(l => { const r = NL.exec(S.net, d.id, s, l); if (r && /^%/.test(r)) out.push(r); }); return out; };
    const draw = msg => {
      const named = nifs(), acls = Object.keys(d.cfg.acls), bound = n => named.filter(i => d.cfg.ifs[i].aclIn === n).map(i => d.cfg.ifs[i].nameif)[0] || '–', nm = n => d.cfg.ifs[n].nameif;
      $('#fwbody', md).innerHTML = (msg ? `<p class="${msg.startsWith('%') ? 'err' : 'okmsg'}">${esc(msg)}</p>` : '')
        + `<h3 class="ph">Zugriffsregeln (ACL, je Interface eingehend)</h3><p class="muted small">Ohne ACL gilt die Security-Level-Regel (hoch → niedrig erlaubt). Mit ACL wird nur erlaubt, was auch drinsteht (implizites deny am Ende).</p>
        <div class="tscroll"><table class="eps"><thead><tr><th>ACL</th><th>an Interface</th><th>#</th><th>Regel</th><th></th></tr></thead><tbody>${acls.map(a => d.cfg.acls[a].map((e, k) => `<tr><td>${k ? '' : esc(a)}</td><td>${k ? '' : esc(bound(a))}</td><td>${k + 1}</td><td class="mono">${esc(e.text)}</td><td class="rtools"><button data-up="${esc(a)}:${k}" ${k ? '' : 'disabled'} aria-label="nach oben">↑</button><button data-rm="${esc(a)}:${k}" aria-label="Regel löschen">✕</button></td></tr>`).join('')).join('') || '<tr><td colspan="5" class="muted">Keine ACLs – es gelten nur die Security-Levels.</td></tr>'}</tbody></table></div>
        <div class="f3"><div class="f"><label for="fi">Interface</label><select id="fi">${named.map(n => opt(nm(n), named.some(x => nm(x) === 'inside') ? 'inside' : nm(named[0]))).join('')}</select></div><div class="f"><label for="fa">Aktion</label><select id="fa"><option>permit</option><option>deny</option></select></div>
        <div class="f"><label for="fp2">Protokoll</label><select id="fp2"><option>tcp</option><option>udp</option><option>icmp</option><option>ip</option></select></div><div class="f"><label for="fport">Ziel-Port</label><input id="fport" placeholder="443"></div>
        <div class="f"><label for="fs">Quelle</label><input id="fs" placeholder="any oder 10.30.0.0/24"></div><div class="f"><label for="fd">Ziel</label><input id="fd" placeholder="any oder 10.10.0.11"></div></div><button class="btn" id="fadd" ${named.length ? '' : 'disabled'}>Regel hinzufügen</button>
        <h3 class="ph">NAT (PAT über Interface-Adresse)</h3><div class="tscroll"><table class="eps"><tbody>${d.cfg.nat.map((n, k) => `<tr><td class="mono">nat (${esc(n.from)},${esc(n.to)}) source dynamic any interface</td><td class="rtools"><button data-nrm="${k}" aria-label="NAT-Regel löschen">✕</button></td></tr>`).join('') || '<tr><td class="muted">Keine NAT-Regel.</td></tr>'}</tbody></table></div>
        <div class="irow"><select id="nf" aria-label="von">${named.map(n => opt(nm(n), 'inside')).join('')}</select><span>→</span><select id="nt" aria-label="nach">${named.map(n => opt(nm(n), 'outside')).join('')}</select><button class="btn small" id="nadd" ${named.length > 1 ? '' : 'disabled'}>NAT hinzufügen</button></div>
        <h3 class="ph">Routen</h3><div class="tscroll"><table class="eps"><tbody>${d.cfg.routes.map((r, k) => `<tr><td class="mono">route ${esc(r.via || '')} ${esc(r.net)} ${esc(r.mask)} ${esc(r.nh || r.ifn || '')}</td><td class="rtools"><button data-rrm="${k}" aria-label="Route löschen">✕</button></td></tr>`).join('') || '<tr><td class="muted">Keine Routen.</td></tr>'}</tbody></table></div>
        <div class="irow"><select id="rif" aria-label="Interface">${named.map(n => opt(nm(n), 'outside')).join('')}</select><input id="rnet" placeholder="0.0.0.0/0" aria-label="Ziel-Netz"><input id="rgw" placeholder="Gateway" aria-label="Gateway"><button class="btn small" id="radd" ${named.length ? '' : 'disabled'}>Route hinzufügen</button></div>
        <label class="ck"><input type="checkbox" id="fss" ${d.cfg.sameSec ? 'checked' : ''}> same-security-traffic permit inter-interface</label>`;
      const root = $('#fwbody', md), upd = m => { save(); render(); draw(m); };
      $$('[data-rm]', root).forEach(b => b.onclick = () => { const [a, k] = b.dataset.rm.split(':'); d.cfg.acls[a].splice(+k, 1); if (!d.cfg.acls[a].length) { delete d.cfg.acls[a]; Object.values(d.cfg.ifs).forEach(i => { if (i.aclIn === a) i.aclIn = null; }); } upd('Regel gelöscht.'); });
      $$('[data-up]', root).forEach(b => b.onclick = () => { const [a, k] = b.dataset.up.split(':'), L = d.cfg.acls[a], x = +k; [L[x - 1], L[x]] = [L[x], L[x - 1]]; upd('Reihenfolge geändert.'); });
      $$('[data-nrm]', root).forEach(b => b.onclick = () => { d.cfg.nat.splice(+b.dataset.nrm, 1); upd('NAT-Regel gelöscht.'); });
      $$('[data-rrm]', root).forEach(b => b.onclick = () => { d.cfg.routes.splice(+b.dataset.rrm, 1); upd('Route gelöscht.'); });
      $('#fss', root).onchange = e => { d.cfg.sameSec = e.target.checked; upd(); };
      if ($('#fadd', root)) $('#fadd', root).onclick = () => {
        const nif = $('#fi', root).value, ifn = nifs().find(n => nm(n) === nif), s = fwSpec($('#fs', root).value), t = fwSpec($('#fd', root).value), pr = $('#fp2', root).value, port = $('#fport', root).value.trim();
        if (s === null || t === null) { draw('% Quelle/Ziel: any, Host-IP oder Netz/Präfix.'); return; } if (port && !['tcp', 'udp'].includes(pr)) { draw('% Ports gibt es nur bei tcp und udp.'); return; }
        const name = d.cfg.ifs[ifn].aclIn || nif.toUpperCase().replace(/[^A-Z0-9_-]/g, '') + '_IN';
        const r = cli([`access-list ${name} extended ${$('#fa', root).value} ${pr} ${s} ${t}${port ? ' eq ' + port : ''}`, `access-group ${name} in interface ${nif}`]); upd(r[0] || `Regel zu ${name} hinzugefügt und an ${nif} gebunden.`);
      };
      if ($('#nadd', root)) $('#nadd', root).onclick = () => { const r = cli([`nat (${$('#nf', root).value},${$('#nt', root).value}) source dynamic any interface`]); upd(r[0] || 'NAT-Regel hinzugefügt.'); };
      if ($('#radd', root)) $('#radd', root).onclick = () => { const m = ($('#rnet', root).value.trim() || '0.0.0.0/0').match(/^(\d+\.\d+\.\d+\.\d+)(?:\/(\d+))?$/); if (!m) { draw('% Ziel-Netz als a.b.c.d/len angeben.'); return; } const r = cli([`route ${$('#rif', root).value} ${m[1]} ${NL.lenMask(m[2] === undefined ? 32 : +m[2])} ${$('#rgw', root).value.trim()}`]); upd(r[0] || 'Route hinzugefügt.'); };
    };
    draw();
  }

  // ---------------- console ----------------
  function push(id, c, t) { (S.out[id] = S.out[id] || []).push({ c, t }); if (S.out[id].length > 800) S.out[id].splice(0, 150); }
  function drawOut() {
    const id = S.sel, d = id && S.net.devs[id];
    if (!d) { $('#out').innerHTML = ''; $('#prompt').textContent = ''; $('#tname').textContent = 'Konsole'; return; }
    if (!S.sess[id]) S.sess[id] = NL.newSess();
    if (!S.out[id]) push(id, 'sys', NL.isHost(d) ? `${d.cfg.hostname} – Konsole. Befehle: ip [Port] <IP>/<Präfix> [Gateway], show ip, ping, nc <IP> <Port>, trace.` : d.type === 'fc' ? `${d.cfg.hostname} – FC-Switch: Konfiguration über die Oberfläche, Zoning im Export.` : d.fw ? `${d.cfg.hostname} – ASA-Konsole. Einrichten über die Port-Karte oder per CLI (nameif, security-level, access-list, nat, route).` : `${d.cfg.hostname} – Konsole. ? zeigt Befehle. Auch: show interfaces status, show cdp neighbors, show inventory.`);
    $('#tname').textContent = 'Konsole: ' + d.cfg.hostname;
    $('#out').innerHTML = S.out[id].map(o => `<div class="ln k-${o.c}">${esc(o.t) || '&nbsp;'}</div>`).join(''); $('#out').scrollTop = 1e9; $('#prompt').textContent = NL.prompt(d, S.sess[id]).trim();
  }
  function wireTerm() {
    const inp = $('#cmd');
    const runL = v => { const id = S.sel; if (!id) return; const d = S.net.devs[id], s = S.sess[id] || (S.sess[id] = NL.newSess());
      act(() => { push(id, 'cmd', NL.prompt(d, s) + v); if (/^\s*(clear|cls)\s*$/i.test(v)) { S.out[id] = []; return; } let r; try { r = NL.isHost(d) ? hostLine(d, s, v) : NL.exec(S.net, id, s, v); } catch (e) { r = '% Interner Fehler: ' + e.message; }
        if (r) r.split('\n').forEach(l => push(id, /^\[(Ping-Debugger|Hinweis|Pfad|Debug|NAT)\]/.test(l) ? 'dbg' : (/^%/.test(l) && !/Creating vlan/.test(l) ? 'err' : 'out'), l)); }); };
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { const v = inp.value; inp.value = ''; if (v.trim()) S.hist.push(v); S.hi = S.hist.length; runL(v); $('#cmd').focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (S.hi > 0) { S.hi--; inp.value = S.hist[S.hi]; } }
      else if (e.key === 'ArrowDown') { e.preventDefault(); if (S.hi < S.hist.length) { S.hi++; inp.value = S.hist[S.hi] || ''; } }
    });
    inp.addEventListener('paste', e => { const t = (e.clipboardData || window.clipboardData).getData('text'); if (!t.includes('\n')) return; e.preventDefault(); t.split(/\r?\n/).forEach(l => { if (l.trim()) runL(l); }); });
  }
  function autoDesc() {
    const per = {};
    for (const l of S.net.links) for (const [a, ap, b, bp] of [[l.a, l.ap, l.b, l.bp], [l.b, l.bp, l.a, l.ap]]) {
      const d = S.net.devs[a]; if (!(d.type === 'switch' || (d.type === 'router' && !d.fw)) || d.cfg.ifs[ap].desc) continue; const pd = S.net.devs[b];
      (per[a] = per[a] || []).push('interface ' + ap, 'description ' + (NL.isHost(pd) ? `${pd.cfg.hostname} ${SH(bp)}` : `${pd.type === 'router' ? 'Router' : 'Uplink'} ${pd.cfg.hostname} ${SH(bp)}`));
    }
    const ids = Object.keys(per); if (!ids.length) { toast('Alle verkabelten Switch-Ports haben bereits eine Beschreibung.'); render(); return; }
    const n = ids.reduce((c, id) => c + per[id].length / 2, 0); ids.forEach(id => runOn(id, per[id], 'Portbeschreibungen aus der Verkabelung')); toast(`Beschreibungen an ${n} Ports gesetzt.`); render();
  }

  // ---------------- validation ----------------
  function fcTargets(net, d, p) {
    const st = NL.portStatus(net, d.id, p); if (st.st !== 'connected') return null; const pd = net.devs[st.peer.dev];
    if (pd.type === 'storage') return [pd]; if (pd.type !== 'fc') return [];
    return pd.ports.map(q => NL.portStatus(net, pd.id, q)).filter(x => x.st === 'connected' && net.devs[x.peer.dev].type === 'storage').map(x => net.devs[x.peer.dev]);
  }
  function lint(net) {
    const out = [], add = (sev, id, msg) => out.push({ sev, id, host: id ? net.devs[id].cfg.hostname : '–', msg }), devs = Object.values(net.devs);
    const hn = {}; devs.forEach(d => { (hn[d.cfg.hostname] = hn[d.cfg.hostname] || []).push(d.id); });
    for (const h in hn) if (hn[h].length > 1) add('Fehler', hn[h][0], `Hostname „${h}“ ist ${hn[h].length}× vergeben`);
    const ips = {};
    devs.forEach(d => { if (NL.isHost(d)) d.ports.forEach(p => { const h = hip(d, p); if (h && h.ip) (ips[h.ip] = ips[h.ip] || []).push(d.cfg.hostname + ' ' + SH(p)); }); else if (d.type !== 'fc') for (const n in d.cfg.ifs) { const i = d.cfg.ifs[n]; if (i.ip) (ips[i.ip] = ips[i.ip] || []).push(d.cfg.hostname + ' ' + SH(n)); } });
    for (const ip in ips) if (ips[ip].length > 1) add('Fehler', null, `IP ${ip} doppelt vergeben: ${ips[ip].join(', ')}`);
    for (const d of devs) {
      const id = d.id;
      if (isIcon(d)) { const p = d.ports[0], h = hip(d, p); if (!NL.linkOf(net, id, p)) add('Hinweis', id, 'Endgerät ist nicht verkabelt'); else if (NL.portStatus(net, id, p).st !== 'connected') add('Fehler', id, 'kein Link – ' + NL.portStatus(net, id, p).reason); else if (!h || !h.ip) add('Hinweis', id, 'keine IP-Adresse'); else if (!d.cfg.gw) add('Hinweis', id, 'kein Default-Gateway gesetzt'); continue; }
      if (d.type === 'server' || d.type === 'storage') lintHost(net, d, add); else if (d.type === 'fc') lintFc(net, d, add); else if (d.fw) lintFw(net, d, add); else lintIos(net, d, add);
    }
    const rank = { Fehler: 0, Warnung: 1, Hinweis: 2 }; return out.sort((a, b) => rank[a.sev] - rank[b.sev]);
  }
  function lintHost(net, d, add) {
    const id = d.id, data = d.ports.filter(p => !isMg(p) && d.pk[p] !== 'fc'), cab = p => NL.linkOf(net, id, p);
    d.ports.forEach(p => { const st = NL.portStatus(net, id, p); if (cab(p) && st.st !== 'connected') add('Fehler', id, `${SH(p)}: kein Link – ${st.reason}`); if (st.st === 'connected' && d.pk[p] !== 'fc') { const h = hip(d, p); if (!h || !h.ip) add('Hinweis', id, `${SH(p)}: verkabelt, aber ohne IP-Adresse`); } });
    if (d.type === 'server') {
      if (!cab('ibmc')) add('Hinweis', id, 'iBMC/Management-Port nicht angebunden (Out-of-Band-Zugriff fehlt)');
      const n = data.filter(cab).length; if (data.length && n === 0) add('Hinweis', id, 'kein Datenport verkabelt'); else if (n === 1) add('Hinweis', id, 'nur ein Datenport verkabelt – keine Link-Redundanz');
    } else {
      ['A', 'B'].forEach(c => { if (!cab(c + '-mgmt')) add('Hinweis', id, `Management-Port Controller ${c} nicht angebunden`); });
      const cn = c => d.ports.filter(p => p.startsWith(c + '-slot') && cab(p)).length, a = cn('A'), b = cn('B');
      if (a && !b) add('Warnung', id, 'nur Controller A angebunden – bei Controller-Ausfall gibt es keinen Pfad (Controller B verkabeln)'); else if (b && !a) add('Warnung', id, 'nur Controller B angebunden – Controller A verkabeln'); else if (!a && !b) add('Hinweis', id, 'kein Datenport verkabelt');
    }
    d.ports.forEach(p => {
      const c = d.pcard && d.pcard[p] && CARDS[d.pcard[p]]; if (!c || !c.roce) return; const st = NL.portStatus(net, id, p); if (st.st !== 'connected') return; const pd = net.devs[st.peer.dev], pi = pd.cfg.ifs && pd.cfg.ifs[st.peer.port]; if (pd.type !== 'switch' || !pi) return;
      if (!pi.extra.includes('priority-flow-control mode on')) add('Warnung', id, `${SH(p)} (RoCE-Karte) an ${pd.cfg.hostname} ${SH(st.peer.port)}: PFC fehlt – RoCE v2 braucht verlustfreies Ethernet (priority-flow-control mode on)`);
      if (!pi.extra.includes('mtu 9216')) add('Hinweis', id, `${SH(p)} (RoCE): am Switch-Port ${pd.cfg.hostname} ${SH(st.peer.port)} Jumbo-MTU 9216 empfohlen`);
    });
    d.ports.filter(p => d.pk[p] === 'fc' && cab(p)).forEach(p => { const t = fcTargets(net, d, p); if (t && d.type === 'server' && !t.length) add('Warnung', id, `${SH(p)} (FC): im Fabric ist kein Storage-Ziel erreichbar`); });
  }
  function lintFc(net, d, add) {
    const c = d.ports.filter(p => NL.linkOf(net, d.id, p)), kind = p => { const st = NL.portStatus(net, d.id, p); return net.devs[st.peer.dev].type; };
    c.forEach(p => { const st = NL.portStatus(net, d.id, p); if (st.st !== 'connected') add('Fehler', d.id, `${SH(p)}: kein Link – ${st.reason}`); });
    const ini = c.filter(p => kind(p) === 'server').length, tgt = c.filter(p => kind(p) === 'storage').length;
    if (ini && tgt) add('Hinweis', d.id, `Zoning nötig: ${ini} Initiator- und ${tgt} Target-Port${tgt > 1 ? 's' : ''} – Zonen stehen in der exportierten MDS-Konfiguration`); else if (ini || tgt) add('Warnung', d.id, ini ? 'Server angebunden, aber kein Storage im Fabric' : 'Storage angebunden, aber kein Server im Fabric');
  }
  function lintFw(net, d, add) {
    const id = d.id, c = d.cfg;
    d.ports.forEach(p => { const i = c.ifs[p], st = NL.portStatus(net, id, p); if (!st.link) return; if (!i.nameif) add('Fehler', id, `${SH(p)}: verkabelt, aber ohne nameif/Security-Level – die ASA leitet dort nichts weiter`); else if (!i.ip) add('Fehler', id, `${SH(p)} (${i.nameif}): keine IP-Adresse`); else if (i.shutdown) add('Warnung', id, `${SH(p)} (${i.nameif}): shutdown`); else if (st.st !== 'connected') add('Fehler', id, `${SH(p)} (${i.nameif}): kein Link – ${st.reason}`); });
    const named = d.ports.filter(p => c.ifs[p].nameif && c.ifs[p].ip), out = named.some(p => (c.ifs[p].sl || 0) === 0), inn = named.some(p => (c.ifs[p].sl || 0) > 0);
    if (!c.routes.some(r => r.net === '0.0.0.0')) add('Hinweis', id, 'keine Default-Route');
    if (out && inn && !c.nat.length) add('Warnung', id, 'kein NAT/PAT von innen nach außen – private Adressen werden im Internet nicht geroutet');
    Object.keys(c.acls).forEach(a => { if (!d.ports.some(p => c.ifs[p].aclIn === a)) add('Hinweis', id, `ACL ${a} ist an kein Interface gebunden`); });
    add('Hinweis', id, 'Admin-Zugang (enable password, username, SSH/ASDM) ist nicht Teil der Vorlage');
  }
  function lintIos(net, d, add) {
    const id = d.id, unused = [];
    for (const p of d.ports) {
      const i = d.cfg.ifs[p], st = NL.portStatus(net, id, p), l = st.link;
      if (l && !i.shutdown && st.st !== 'connected') add('Fehler', id, `${SH(p)}: kein Link – ${st.reason}`);
      if (!l) { if (!i.shutdown && d.type === 'switch') unused.push(SH(p)); continue; }
      const pd = net.devs[st.peer.dev], pi = pd.cfg.ifs && pd.cfg.ifs[st.peer.port];
      if (!i.desc && !NL.isHost(pd)) add('Hinweis', id, `${SH(p)}: Uplink ohne Beschreibung`);
      if (d.type === 'switch') {
        if (i.mode === 'access' && !d.cfg.vlans[i.vlan]) add('Fehler', id, `${SH(p)}: VLAN ${i.vlan} existiert nicht`);
        if (pd.type === 'switch') {
          if (i.mode !== 'trunk') add('Warnung', id, `${SH(p)} → ${pd.cfg.hostname}: Switch-zu-Switch-Verbindung ist kein Trunk`);
          else if (l.a === id) { if (pi.mode === 'trunk' && pi.native !== i.native) add('Fehler', id, `${SH(p)} ↔ ${pd.cfg.hostname} ${SH(st.peer.port)}: Native-VLAN-Mismatch (${i.native} / ${pi.native})`); if (pi.mode === 'trunk' && vlStr(i.allowed) !== vlStr(pi.allowed)) add('Warnung', id, `${SH(p)} ↔ ${pd.cfg.hostname}: erlaubte VLANs unterscheiden sich (${vlStr(i.allowed)} / ${vlStr(pi.allowed)})`); }
          if (i.mode === 'trunk') {
            if (i.allowed === null) add('Warnung', id, `${SH(p)}: Trunk erlaubt alle VLANs – auf benötigte VLANs einschränken`);
            if (i.native === 1) add('Hinweis', id, `${SH(p)}: Native VLAN 1 – besser ein ungenutztes VLAN (VLAN-Hopping)`);
            const used = new Set(d.ports.filter(q => d.cfg.ifs[q].mode === 'access' && NL.linkOf(net, id, q)).map(q => d.cfg.ifs[q].vlan));
            used.forEach(v => { if (v !== 1 && (i.allowed === null || i.allowed.includes(v)) && !pd.cfg.vlans[v]) add('Warnung', id, `VLAN ${v} wird hier genutzt, fehlt aber auf ${pd.cfg.hostname} – Verkehr endet am Trunk`); });
          }
        }
        if (NL.isHost(pd) && i.mode === 'access' && (!i.extra.includes('spanning-tree portfast') || !i.extra.some(x => x.startsWith('spanning-tree bpduguard')))) add('Hinweis', id, `${SH(p)} (${pd.cfg.hostname}): PortFast/BPDU Guard fehlen`);
        if (i.mode === 'access' && i.vlan === 1 && NL.isHost(pd)) add('Warnung', id, `${SH(p)} (${pd.cfg.hostname}): Endgerät im Default-VLAN 1`);
      }
    }
    if (unused.length) add('Warnung', id, `${unused.length} ungenutzte Ports nicht abgeschaltet (${unused.length > 6 ? unused.slice(0, 3).join(', ') + ' … ' + unused[unused.length - 1] : unused.join(', ')})`);
    const L = x => d.cfg.lines.some(l => l.toLowerCase().startsWith(x)), vty = d.cfg.blocks.find(b => b.head.startsWith('line vty'));
    if (!L('enable secret')) add('Warnung', id, 'kein enable secret'); if (!vty || !vty.lines.includes('transport input ssh')) add('Warnung', id, 'VTY nicht auf SSH beschränkt (line vty → transport input ssh)'); if (!L('username ')) add('Hinweis', id, 'kein lokaler Admin-User (username … secret …)');
    if (d.type === 'switch' && d.ports.some(p => d.cfg.ifs[p].extra.includes('authentication port-control auto'))) {
      if (!L('aaa new-model')) add('Fehler', id, '802.1X an Ports aktiv, aber "aaa new-model" fehlt'); if (!L('dot1x system-auth-control')) add('Fehler', id, '802.1X an Ports aktiv, aber "dot1x system-auth-control" fehlt'); if (!d.cfg.blocks.some(b => b.head.startsWith('radius server'))) add('Fehler', id, '802.1X an Ports aktiv, aber kein RADIUS-Server konfiguriert');
    }
    if (d.type === 'switch' && !mgmtIp(d)) add('Hinweis', id, 'keine Management-IP (SVI)');
  }

  // ---------------- export ----------------
  const padR = (s, n) => { s = String(s); return s.length >= n ? s + ' ' : s.padEnd(n); };
  function hwSheet(d) {
    const M = MODELS[d.model] || {}, o = ['='.repeat(78), 'Hardware-Konfigblatt: ' + d.cfg.hostname, 'Modell : ' + (M.label || d.type), 'Rack   : ' + (d.rack ? `HE ${d.rack}${uOf(d) > 1 ? '–' + (d.rack + uOf(d) - 1) : ''} (${uOf(d)} HE)` : 'nicht eingebaut'), '='.repeat(78), '', 'Bestückung:'];
    o.push('  Onboard   ' + (d.type === 'server' ? 'Management (iBMC/iDRAC) + LOM' : 'je Controller: Management-Port'));
    (d.cards || []).forEach((ck, i) => o.push(`  Slot ${i + 1}    ${ck ? CARDS[ck].label + (CARDS[ck].roce ? '  [RoCE v2-fähig]' : '') : '– frei –'}`));
    o.push('', padR('Port', 16) + padR('Typ', 9) + padR('Transceiver', 17) + padR('IP / WWPN', 26) + padR('Verwendung', 25) + 'Gegenstelle');
    for (const p of d.ports) {
      const st = NL.portStatus(S.net, d.id, p), h = hip(d, p); let peer = '– nicht verkabelt –';
      if (st.link) { const pd = S.net.devs[st.peer.dev], pi = pd.cfg.ifs && pd.cfg.ifs[st.peer.port]; peer = `${pd.cfg.hostname} ${SH(st.peer.port)}` + (pd.type === 'switch' && pi ? (pi.mode === 'trunk' ? ', Trunk' : ', Access VLAN ' + pi.vlan) : '') + ` [${CABSHORT[st.link.cable || 'cu']}${st.st === 'connected' ? '' : ', KEIN LINK'}]`; }
      o.push(padR(p, 16) + padR(KIND[d.pk[p]].label, 9) + padR(d.xcvr[p] || (st.link && st.link.cable === 'dac' ? 'DAC' : '–'), 17) + padR(d.pk[p] === 'fc' ? NL.wwpn(d, p) : (h && h.ip ? h.ip + '/' + NL.maskLen(h.mask) : '–'), 26) + padR(d.use[p] || (isMg(p) ? 'Management' : d.pk[p] === 'fc' ? 'SAN (FC)' : 'Daten'), 25) + peer);
    }
    if (d.cfg.gw) o.push('', 'Default-Gateway: ' + d.cfg.gw);
    if (d.pcard && Object.values(d.pcard).some(k => CARDS[k].roce)) o.push('', 'RoCE v2: verlustfreies Netz (PFC/ECN), durchgängig einheitliche MTU (z. B. 9000 am Host, 9216 am Switch) und DSCP/CoS-Zuordnung mit dem Netzwerk abstimmen.');
    return o.join('\n') + '\n';
  }
  const safe = x => String(x).replace(/[^A-Za-z0-9_-]+/g, '_');
  function mdsCfg(d) {
    const v = d.cfg.vsan || 10, c = d.ports.map(p => ({ p, st: NL.portStatus(S.net, d.id, p) })).filter(x => x.st.st === 'connected').map(x => ({ p: x.p, pd: S.net.devs[x.st.peer.dev], pp: x.st.peer.port }));
    const o = ['! ' + '='.repeat(60), '! Hostname : ' + d.cfg.hostname, '! Modell   : ' + (MODELS[d.model] || {}).label, '! Erstellt : NetLab Netzplaner, ' + new Date().toLocaleString('de-DE'), '! Hinweis  : Syntax prüfen (MDS/NX-OS), WWPNs durch die echten Werte der HBAs/Storage-Ports ersetzen', '! ' + '='.repeat(60), 'hostname ' + d.cfg.hostname, '!', 'vsan database', ` vsan ${v} name FABRIC-${safe(d.cfg.hostname)}`];
    c.forEach(x => o.push(` vsan ${v} interface ${x.p}`)); o.push('!');
    c.forEach(x => o.push('interface ' + x.p, ` switchport description ${x.pd.cfg.hostname} ${x.pp}`, ' switchport mode F', ' no shutdown', '!'));
    const ini = c.filter(x => x.pd.type === 'server'), tgt = c.filter(x => x.pd.type === 'storage'), zn = [];
    o.push('! Zoning: Single-Initiator-Single-Target (Default-Zone bleibt deny)');
    for (const i of ini) for (const t of tgt) { const n = safe(`${i.pd.cfg.hostname}_${i.pp}__${t.pd.cfg.hostname}_${t.pp}`).slice(0, 64); zn.push(n); o.push(`zone name ${n} vsan ${v}`, ` member pwwn ${NL.wwpn(i.pd, i.pp)}`, ` member pwwn ${NL.wwpn(t.pd, t.pp)}`, '!'); }
    if (zn.length) { const zs = 'ZS-' + safe(d.cfg.hostname); o.push(`zoneset name ${zs} vsan ${v}`); zn.forEach(n => o.push(' member ' + n)); o.push('!', `zoneset activate name ${zs} vsan ${v}`); } else o.push('! (Noch keine Server/Storage-Paare verkabelt – keine Zonen erzeugt)');
    return o.join('\n') + '\n';
  }
  const exportText = d => d.type === 'fc' ? mdsCfg(d) : (d.type === 'server' || d.type === 'storage') ? hwSheet(d) : NL.exportCfg(S.net, d);
  const exportDir = d => (d.type === 'server' || d.type === 'storage') ? 'hardware/' : 'configs/';
  const cfgDevs = () => Object.values(S.net.devs).filter(exportable);
  let XS = { dev: null, view: 'cfg' };
  function csv() {
    const q = v => `"${String(v).replace(/"/g, '""')}"`, rows = [['Nr', 'Gerät A', 'Port A', 'Transceiver A', 'Gerät B', 'Port B', 'Transceiver B', 'Kabel', 'Status']];
    S.net.links.forEach((l, k) => { const A = S.net.devs[l.a], B = S.net.devs[l.b], st = NL.portStatus(S.net, l.a, l.ap); const x = (D, p) => D.xcvr[p] || (l.cable === 'dac' ? 'DAC' : '');
      rows.push([k + 1, A.cfg.hostname, l.ap, x(A, l.ap), B.cfg.hostname, l.bp, x(B, l.bp), NL.CABLES[l.cable || 'cu'], st.st === 'connected' ? 'up' : 'kein Link: ' + st.reason]); });
    return '\ufeff' + rows.map(r => r.map(q).join(';')).join('\r\n');
  }
  function exportModal() {
    const issues = lint(S.net), c = s => issues.filter(i => i.sev === s).length;
    XS.dev = XS.dev && S.net.devs[XS.dev] && exportable(S.net.devs[XS.dev]) ? XS.dev : (cfgDevs()[0] || {}).id;
    modal(`<h2>Prüfen &amp; exportieren</h2><div class="lintsum"><span class="b-err">${c('Fehler')} Fehler</span><span class="b-warn">${c('Warnung')} Warnungen</span><span class="b-info">${c('Hinweis')} Hinweise</span></div>
      ${issues.length ? `<details class="lint" ${c('Fehler') ? 'open' : ''}><summary>Befunde anzeigen</summary><ul>${issues.map(i => `<li class="sev-${i.sev}"><b>${i.sev}</b> <span class="lh">${esc(i.host)}</span> ${esc(i.msg)}</li>`).join('')}</ul></details>` : '<p class="okmsg">Keine Befunde – sauber.</p>'}
      ${c('Fehler') ? '<p class="err">Es gibt noch Fehler. Exportieren geht trotzdem – aber so würde es in Produktion nicht laufen.</p>' : ''}<div id="xport"></div>`, true);
    renderExport();
  }
  function renderExport() {
    const box = $('#xport'); if (!box) return; const ds = cfgDevs(); if (!ds.length) { box.innerHTML = '<p class="muted">Keine Switches, Router, Firewalls, Server oder Storages im Projekt.</p>'; return; }
    const d = S.net.devs[XS.dev] || ds[0], txt = XS.view === 'csv' ? csv() : exportText(d), fname = XS.view === 'csv' ? 'patchliste.csv' : d.cfg.hostname + '.txt';
    box.innerHTML = `<div class="xtabs" role="tablist">${ds.map(x => `<button role="tab" class="xt ${XS.view === 'cfg' && x.id === d.id ? 'act' : ''}" data-x="${x.id}">${esc(x.cfg.hostname)}</button>`).join('')}<button role="tab" class="xt ${XS.view === 'csv' ? 'act' : ''}" data-x="csv">Patchliste</button></div>
      ${XS.view === 'csv' ? patchTable() : `<pre class="code xcode" tabindex="0">${esc(txt)}</pre>`}
      <div class="xact"><button class="btn" id="xcopy">Kopieren</button>${DL ? `<button class="btn" id="xdl">${esc(fname)} herunterladen</button><button class="btn primary" id="xzip">Alles als ZIP</button>` : '<span class="muted small">Downloads sind in dieser Ansicht nicht verfügbar – nutze Kopieren.</span>'}</div><p class="muted small" id="xmsg" aria-live="polite"></p>`;
    $$('.xt', box).forEach(b => b.onclick = () => { if (b.dataset.x === 'csv') XS.view = 'csv'; else { XS.view = 'cfg'; XS.dev = b.dataset.x; } renderExport(); });
    $('#xcopy').onclick = () => copyText(XS.view === 'csv' ? csv().slice(1) : txt).then(ok => { $('#xmsg').textContent = ok ? 'In die Zwischenablage kopiert.' : 'Kopieren nicht möglich – Text markieren und manuell kopieren.'; });
    if (DL) {
      $('#xdl').onclick = () => saveFile(fname, txt);
      $('#xzip').onclick = async () => {
        if (!window.JSZip) { $('#xmsg').textContent = 'ZIP-Bibliothek konnte nicht geladen werden.'; return; }
        const z = new JSZip(); cfgDevs().forEach(x => z.file(exportDir(x) + x.cfg.hostname + '.txt', exportText(x))); z.file('patchliste.csv', csv()); z.file('netlab-projekt.json', JSON.stringify(S.net));
        z.file('LIESMICH.txt', 'NetLab Export\r\n\r\nconfigs/   Konfiguration je Gerät (IOS/IOS-XE, ASA, MDS-Zoning)\r\nhardware/  Konfigblätter für Server und Storages (Karten, Ports, IPs, WWPNs, Gegenstellen)\r\npatchliste.csv  Verkabelung mit Ports, Transceivern und Kabeltyp\r\nnetlab-projekt.json  Projektdatei zum erneuten Import\r\n\r\nVor dem Rollout: Passwörter/Keys ersetzen, Interface-Namen, Transceiver und WWPNs mit der echten Hardware abgleichen.\r\n');
        saveFile('netlab-export.zip', await z.generateAsync({ type: 'blob' }));
      };
    }
  }
  function patchTable() {
    if (!S.net.links.length) return '<p class="muted">Noch keine Kabel.</p>';
    return `<div class="tscroll"><table class="eps ptab"><thead><tr><th>Nr</th><th>Von</th><th>Nach</th><th>Kabel</th><th>Status</th></tr></thead><tbody>${S.net.links.map((l, k) => { const A = S.net.devs[l.a], B = S.net.devs[l.b], st = NL.portStatus(S.net, l.a, l.ap), x = (D, p) => D.xcvr[p] ? ` <span class="muted">(${D.xcvr[p]})</span>` : '';
      return `<tr class="${st.st === 'connected' ? 'ok' : 'bad'}"><td>${k + 1}</td><td>${esc(A.cfg.hostname)} ${esc(SH(l.ap))}${x(A, l.ap)}</td><td>${esc(B.cfg.hostname)} ${esc(SH(l.bp))}${x(B, l.bp)}</td><td>${esc(CABSHORT[l.cable || 'cu'])}</td><td>${st.st === 'connected' ? 'up' : esc(st.reason)}</td></tr>`; }).join('')}</tbody></table></div>`;
  }
  async function saveFile(name, data) {
    const msg = $('#xmsg') || {}; try { await DL.save({ filename: name, data }); msg.textContent = name + ' gespeichert.'; } catch (e) { msg.textContent = e && e.code === 'declined' ? 'Download abgebrochen.' : 'Download nicht möglich (' + (e && e.code || 'Fehler') + ').'; }
  }
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) { }
    try { const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch (e) { return false; }
  }
  function fileModal(title, text, fname, data) {
    const m = modal(`<h2>${title}</h2><p class="muted">${text}</p><textarea class="ta" rows="8" readonly aria-label="${title}">${esc(data)}</textarea><div class="xact"><button class="btn" id="fmc">Kopieren</button>${DL ? `<button class="btn primary" id="fmd">${fname} herunterladen</button>` : ''}</div><p class="muted small" id="xmsg"></p>`);
    $('#fmc', m).onclick = () => copyText(data).then(ok => { $('#xmsg', m).textContent = ok ? 'Kopiert.' : 'Bitte manuell markieren und kopieren.'; }); if (DL) $('#fmd', m).onclick = () => saveFile(fname, data);
  }
  function modal(html, wide) {
    const m = document.createElement('div'); m.className = 'modal'; m.innerHTML = `<div class="mbox ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}<button class="btn ghost mclose">Schließen</button></div>`;
    document.body.appendChild(m); const close = () => { m.remove(); document.removeEventListener('keydown', k); }, k = e => { if (e.key === 'Escape') close(); };
    m.addEventListener('click', e => { if (e.target === m || e.target.classList.contains('mclose')) close(); }); document.addEventListener('keydown', k); $('.mclose', m).focus(); return m;
  }
  // ---------------- Apps & Dienste (PC/Server, Packet-Tracer-Desktop) ----------------
  const canApps = d => !!d && ((d.type === 'pc' && d.icon === 'pc') || d.type === 'server');
  const allIps = () => { const m = {}; for (const d of Object.values(S.net.devs)) { if (NL.isHost(d)) d.ports.forEach(p => { const h = hip(d, p); if (h && h.ip) m[h.ip] = d; }); else if (d.type !== 'fc') Object.values(d.cfg.ifs).forEach(i => { if (i.ip) m[i.ip] = d; }); } return m; };
  function setHostIp(d, p, ip, mask) { if (p === d.ports[0]) { d.cfg.ip = ip; d.cfg.mask = mask; } else if (ip) { d.cfg.nic = d.cfg.nic || {}; d.cfg.nic[p] = { ip, mask }; } else if (d.cfg.nic) delete d.cfg.nic[p]; }
  function resolve(c, name) {
    const dns = c.cfg.dns; if (!dns) return { err: 'Kein DNS-Server konfiguriert (IP-Konfiguration → DNS-Server).' };
    const sv = allIps()[dns]; if (!sv) return { err: `DNS-Server ${dns} existiert im Netz nicht.` };
    const r = NL.ping(S.net, c.id, dns, { proto: 'udp', port: 53 }); if (!r.ok) return { err: `DNS-Server ${dns} nicht erreichbar: ${r.reason}` };
    if (!sv.svc || !sv.svc.dns.on) return { err: `Auf ${sv.cfg.hostname} ist der DNS-Dienst ausgeschaltet.` };
    const rec = sv.svc.dns.records.find(x => x.name.toLowerCase() === name.toLowerCase()); if (rec && rec.ip === '@') { const own = hip(sv, sv.ports[0]); return own && own.ip ? { ip: own.ip, server: sv.cfg.hostname } : { err: `${sv.cfg.hostname} hat noch keine IP-Adresse – der Eintrag „${name}“ zeigt auf die eigene Adresse.` }; } return rec ? { ip: rec.ip, server: sv.cfg.hostname } : { err: `Name „${name}“ nicht gefunden (NXDOMAIN auf ${sv.cfg.hostname}).` };
  }
  function httpGet(c, url) {
    const u = (url || '').trim(); if (!u) return { err: 'Bitte eine Adresse eingeben.' };
    const m = u.match(/^(?:(https?):\/\/)?([^\/:]+)(?::(\d+))?(\/.*)?$/i); if (!m) return { err: 'Ungültige Adresse.' };
    const scheme = (m[1] || 'http').toLowerCase(), host = m[2], port = m[3] ? +m[3] : scheme === 'https' ? 443 : 80; let ip = host;
    if (!NL.validIp(host)) { const r = resolve(c, host); if (r.err) return { err: r.err }; ip = r.ip; }
    const r = NL.ping(S.net, c.id, ip, { proto: 'tcp', port }); if (!r.ok) return { err: `Zeitüberschreitung: ${ip}:${port} ist nicht erreichbar.`, why: r.reason };
    const srv = allIps()[ip], sv = srv && srv.svc;
    if (!sv || !((port === 80 && sv.http.on) || (port === 443 && sv.http.on && sv.http.https))) return { err: `Verbindung abgelehnt: Auf ${srv ? srv.cfg.hostname : ip} lauscht kein ${port === 443 ? 'HTTPS' : 'HTTP'}-Server auf Port ${port}.` };
    return { ok: true, ip, host, scheme, port, title: sv.http.title || srv.cfg.hostname, body: sv.http.body };
  }
  function dhcpRequest(c) {
    const p = c.ports[0]; if (NL.portStatus(S.net, c.id, p).st !== 'connected') return { err: 'Kein Link – Kabel und Port prüfen.' };
    const seg = NL.l2(S.net, c.id, p), ips = allIps(); let why = 'Kein DHCP-Server im selben Layer-2-Segment gefunden – VLAN, Trunk und Kabel prüfen (kein DHCP-Relay in diesem Lab).';
    if (seg.notes && seg.notes.length) why += ' ' + seg.notes[0];
    for (const ep of seg.eps) {
      const sv = S.net.devs[ep.dev]; if (!sv || sv.id === c.id || sv.type !== 'server' || !sv.svc || !sv.svc.dhcp.on) continue;
      const h = hip(sv, ep.ifn), pool = sv.svc.dhcp; if (!h || !h.ip) continue;
      if (!NL.validIp(pool.start) || NL.maskLen(pool.mask) === null) { why = `DHCP auf ${sv.cfg.hostname}: Pool nicht fertig konfiguriert (Startadresse/Maske).`; continue; }
      if (!NL.inNet(pool.start, h.ip, pool.mask) || NL.maskLen(pool.mask) !== NL.maskLen(h.mask)) { why = `DHCP auf ${sv.cfg.hostname}: Pool ${pool.start}/${NL.maskLen(pool.mask)} liegt nicht im Subnetz der Server-Schnittstelle ${h.ip}/${NL.maskLen(h.mask)}.`; continue; }
      pool.leases = pool.leases || {}; let ip = pool.leases[c.id];
      if (!ip) { const used = new Set(Object.keys(ips).filter(k => ips[k] !== c)); Object.entries(pool.leases).forEach(([k, v]) => { if (k !== c.id) used.add(v); }); for (let i = 0; i < pool.max; i++) { const cand = NL.n2ip(NL.ip2n(pool.start) + i); if (!NL.inNet(cand, h.ip, pool.mask)) break; if (!used.has(cand)) { ip = cand; break; } } }
      if (!ip) { why = `Der DHCP-Pool auf ${sv.cfg.hostname} ist erschöpft.`; continue; }
      pool.leases[c.id] = ip; setHostIp(c, p, ip, pool.mask); c.cfg.gw = pool.gw || null; c.cfg.dns = pool.dns || null;
      return { ok: true, ip, mask: pool.mask, gw: pool.gw, dns: pool.dns, server: sv.cfg.hostname };
    }
    return { err: why };
  }
  function hostLine(d, s, raw) {
    const line = raw.trim().replace(/\s+/g, ' '), t = line.split(' '), c0 = (t[0] || '').toLowerCase(), ex = l => NL.exec(S.net, d.id, s, l);
    if (c0 === 'ping' && t[1] && !NL.validIp(t[1])) { const r = resolve(d, t[1]); return r.err ? `Ping-Anfrage konnte Host „${t[1]}“ nicht finden: ${r.err}` : `Ping ${t[1]} [${r.ip}]\n` + ex('ping ' + r.ip); }
    if (c0 === 'nslookup' && t[1]) { const r = resolve(d, t[1]); return r.err ? '*** ' + r.err : `Server:  ${d.cfg.dns}\nName:    ${t[1]}\nAddress: ${r.ip}`; }
    if (c0 === 'curl' && t[1]) { const r = httpGet(d, t[1]); return r.err ? 'curl: ' + r.err + (r.why ? '\n[Ping-Debugger] ' + r.why : '') : `HTTP/1.1 200 OK (${r.scheme}://${r.host} → ${r.ip}:${r.port})\n\n${r.title}\n${r.body}`; }
    if (c0 === 'ipconfig' && t[1] && /^\/renew$/i.test(t[1])) { if (!d.cfg.dhcp) return 'Der Adapter ist nicht für DHCP konfiguriert. In der IP-Konfiguration „DHCP“ wählen.'; let o; act(() => { const r = dhcpRequest(d); o = r.err ? 'DHCP fehlgeschlagen: ' + r.err : `DHCP-Zuweisung von ${r.server}:\n  IP-Adresse . . . . : ${r.ip}\n  Subnetzmaske . . . : ${r.mask}\n  Standardgateway  . : ${r.gw || '–'}\n  DNS-Server . . . . : ${r.dns || '–'}`; }); return o; }
    if (c0 === 'ipconfig' && t[1] && /^\/release$/i.test(t[1])) { act(() => { setHostIp(d, d.ports[0], null, null); d.cfg.gw = null; d.cfg.dns = null; Object.values(S.net.devs).forEach(x => { if (x.svc) delete x.svc.dhcp.leases[d.id]; }); }); return 'Adresse freigegeben.'; }
    if (c0 === 'ipconfig' && t[1] && /^\/all$/i.test(t[1])) return ex('show ip') + `\nDNS-Server: ${d.cfg.dns || '–'}\nDHCP: ${d.cfg.dhcp ? 'aktiviert' : 'deaktiviert'}`;
    if (t[0] === '?' || c0 === 'help') return ex('?') + '\n  ping <Name|IP>                      auch mit DNS-Namen\n  nslookup <Name>                     Name per DNS auflösen\n  curl <URL>                          Webseite abrufen (http://…)\n  ipconfig [/all|/renew|/release]     Adressen, DHCP';
    return ex(line);
  }
  function openApps(id, view) {
    const d = S.net.devs[id]; if (!canApps(d)) return; if (d.type === 'server' && !d.svc) d.svc = defSvc();
    S.web = S.web || {}; S.cmd = S.cmd || {};
    let tab = view === 'svc' ? 'svc' : 'desk', v = tab === 'svc' ? 'svc' : (view && view !== 'home' ? view : 'home'), st = 'http', ipPort = d.ports[0];
    const md = modal(`<div class="appwin"><div class="appbar"><div class="apptitle"><b>${esc(d.cfg.hostname)}</b><span class="muted">${esc((MODELS[d.model] || {}).label || 'PC / Notebook')}</span></div><div class="seg2" id="apptabs"></div></div><div class="appbody" id="appbody"></div></div>`, true);
    const body = $('#appbody', md), g = x => $('#' + x, md), back = t => `<div class="apphead"><button class="btn small" id="appBack">← Desktop</button><b>${t}</b></div>`;
    function draw() {
      $('#apptabs', md).innerHTML = d.type === 'server' ? `<button class="${tab === 'desk' ? 'act' : ''}" data-t="desk">Desktop</button><button class="${tab === 'svc' ? 'act' : ''}" data-t="svc">Dienste</button>` : '';
      $$('#apptabs [data-t]', md).forEach(b => b.onclick = () => { tab = b.dataset.t; v = tab === 'svc' ? 'svc' : 'home'; draw(); });
      if (tab === 'svc') drawSvc(); else ({ home: drawHome, ip: drawIp, cmd: drawCmd, web: drawWeb, edit: drawEdit })[v]();
      if (g('appBack')) g('appBack').onclick = () => { v = 'home'; draw(); };
    }
    function drawHome() { body.innerHTML = `<div class="appgrid">${[['ip', 'IP-Konfiguration', 'network'], ['cmd', 'Eingabeaufforderung', 'terminal'], ['web', 'Webbrowser', 'globe'], ['edit', 'Texteditor', 'file']].map(([k, n, i]) => `<button class="appic" data-v="${k}">${ico(i)}<span>${n}</span></button>`).join('')}</div>`; $$('.appic', body).forEach(b => b.onclick = () => { v = b.dataset.v; draw(); }); }
    function drawIp() {
      const ports = d.ports.filter(p => d.pk[p] !== 'fc'); if (!ports.includes(ipPort)) ipPort = ports[0];
      const prim = ipPort === d.ports[0], cur = hip(d, ipPort) || {}, isD = prim && d.cfg.dhcp, ro = isD ? 'disabled' : '';
      body.innerHTML = back('IP-Konfiguration') + `<div class="appform">${ports.length > 1 ? `<div class="f"><label for="ipp">Schnittstelle</label><select id="ipp">${ports.map(p => opt(p, ipPort, SH(p) + ((hip(d, p) || {}).ip ? ' – ' + hip(d, p).ip : ''))).join('')}</select></div>` : ''}
        ${prim ? `<div class="seg"><label><input type="radio" name="ipm" value="dhcp" ${isD ? 'checked' : ''}> DHCP</label><label><input type="radio" name="ipm" value="static" ${isD ? '' : 'checked'}> Statisch</label></div>` : ''}
        <div class="f2"><div class="f"><label for="ipa">IP-Adresse</label><input id="ipa" value="${esc(cur.ip || '')}" ${ro}></div><div class="f"><label for="ipk">Subnetzmaske</label><input id="ipk" value="${esc(cur.mask || '')}" placeholder="255.255.255.0" ${ro}></div></div>
        ${prim ? `<div class="f2"><div class="f"><label for="ipg">Default-Gateway</label><input id="ipg" value="${esc(d.cfg.gw || '')}" ${ro}></div><div class="f"><label for="ipd">DNS-Server</label><input id="ipd" value="${esc(d.cfg.dns || '')}" ${ro}></div></div>` : ''}
        <button class="btn primary" id="ipgo">Anwenden</button><p id="ipmsg" class="appmsg" aria-live="polite"></p></div>`;
      if (g('ipp')) g('ipp').onchange = e => { ipPort = e.target.value; drawIp(); };
      $$('input[name="ipm"]', md).forEach(r => r.onchange = () => { const x = r.value === 'dhcp'; ['ipa', 'ipk', 'ipg', 'ipd'].forEach(k => { if (g(k)) g(k).disabled = x; }); });
      g('ipgo').onclick = () => {
        const mode = prim ? $('input[name="ipm"]:checked', md).value : 'static';
        if (mode === 'dhcp') { let m; act(() => { d.cfg.dhcp = true; const r = dhcpRequest(d); m = r.err ? `<span class="neg">DHCP fehlgeschlagen:</span> ${esc(r.err)}` : `<span class="okmsg">DHCP-Zuweisung von ${esc(r.server)}:</span> ${r.ip}/${NL.maskLen(r.mask)}, Gateway ${esc(r.gw || '–')}, DNS ${esc(r.dns || '–')}`; }); drawIp(); g('ipmsg').innerHTML = m; return; }
        const ip = g('ipa').value.trim(), mk = g('ipk').value.trim(), gw = prim ? g('ipg').value.trim() : '', dns = prim ? g('ipd').value.trim() : '', bad = x => { g('ipmsg').innerHTML = `<span class="neg">${x}</span>`; };
        if (ip && (!NL.validIp(ip) || NL.maskLen(mk) === null)) return bad('Ungültige IP-Adresse oder Subnetzmaske.'); if (gw && (!NL.validIp(gw) || !NL.inNet(gw, ip, mk))) return bad('Das Gateway liegt nicht im Subnetz der IP-Adresse.'); if (dns && !NL.validIp(dns)) return bad('Ungültiger DNS-Server.');
        act(() => { if (prim) d.cfg.dhcp = false; setHostIp(d, ipPort, ip || null, ip ? mk : null); if (prim) { d.cfg.gw = gw || null; d.cfg.dns = dns || null; } }); drawIp(); g('ipmsg').innerHTML = '<span class="okmsg">Gespeichert.</span>';
      };
    }
    function drawCmd() {
      const L = S.cmd[id] = S.cmd[id] || [{ c: 'sys', t: `Eingabeaufforderung ${d.cfg.hostname}\nBefehle: ipconfig [/all|/renew|/release], ping <Name|IP>, nslookup <Name>, curl <URL>, nc <IP> <Port>, trace <IP>` }];
      body.innerHTML = back('Eingabeaufforderung') + `<div class="appterm"><div class="out" id="aout"></div><div class="inrow"><label for="acmd">${esc(d.cfg.hostname)}&gt;</label><input id="acmd" autocomplete="off" spellcheck="false" aria-label="Befehl"></div></div>`;
      const show = () => { g('aout').innerHTML = L.map(o => `<div class="ln k-${o.c}">${esc(o.t).replace(/\n/g, '<br>') || '&nbsp;'}</div>`).join(''); g('aout').scrollTop = 1e9; }; show();
      const sess = S.sess[id] || (S.sess[id] = NL.newSess());
      g('acmd').onkeydown = e => { if (e.key !== 'Enter') return; const v = e.target.value; e.target.value = ''; if (!v.trim()) return; L.push({ c: 'cmd', t: d.cfg.hostname + '> ' + v }); if (/^\s*(cls|clear)\s*$/i.test(v)) { L.length = 0; show(); return; } let r; try { r = hostLine(d, sess, v); } catch (x) { r = '% ' + x.message; } (r || '').split('\n').forEach(l => L.push({ c: /^\[(Ping-Debugger|Hinweis|NAT)\]/.test(l) ? 'dbg' : /^%/.test(l) ? 'err' : 'out', t: l })); show(); };
      g('acmd').focus();
    }
    function drawWeb() {
      const w = S.web[id] = S.web[id] || { url: '', res: null };
      body.innerHTML = back('Webbrowser') + `<div class="browser"><div class="urlbar"><input id="url" value="${esc(w.url)}" placeholder="http://web.lab.local oder 10.10.0.11" aria-label="Adresse" autocomplete="off" spellcheck="false"><button class="btn primary small" id="go">Aufrufen</button></div><div class="page" id="page"></div></div>`;
      const show = () => { const r = w.res; g('page').innerHTML = !r ? '<p class="muted">Gib eine Adresse ein. Namen werden über den DNS-Server der IP-Konfiguration aufgelöst.</p>' : r.err ? `<div class="neterr"><h2>Seite nicht erreichbar</h2><p>${esc(r.err)}</p>${r.why ? `<p class="muted small">${esc(r.why)}</p>` : ''}</div>` : `<h2>${esc(r.title)}</h2><p>${esc(r.body).replace(/\n/g, '<br>')}</p><p class="muted small">${r.scheme}://${esc(r.host)} → ${r.ip}:${r.port}</p>`; };
      const go = () => { w.url = g('url').value; w.res = httpGet(d, w.url); show(); }; show(); g('go').onclick = go; g('url').onkeydown = e => { if (e.key === 'Enter') go(); }; g('url').focus();
    }
    function drawEdit() { body.innerHTML = back('Texteditor') + `<textarea id="note" class="ta" rows="12" aria-label="Notizen" placeholder="Notizen zu diesem Gerät …">${esc(d.notes || '')}</textarea><p class="muted small">Wird automatisch gespeichert.</p>`; g('note').oninput = e => { d.notes = e.target.value; save(); }; }
    function drawSvc() {
      const sv = d.svc, tabs = [['http', 'HTTP / HTTPS'], ['dns', 'DNS'], ['dhcp', 'DHCP']];
      let h = `<div class="svctabs">${tabs.map(([k, n]) => `<button class="${st === k ? 'act' : ''}" data-s="${k}">${n}${sv[k === 'http' ? 'http' : k].on ? ' <i class="don"></i>' : ''}</button>`).join('')}</div>`;
      if (st === 'http') h += `<div class="appform"><label class="ck"><input type="checkbox" id="hon" ${sv.http.on ? 'checked' : ''}> HTTP (Port 80) aktiv</label><label class="ck"><input type="checkbox" id="hs" ${sv.http.https ? 'checked' : ''}> HTTPS (Port 443) aktiv</label><div class="f"><label for="ht">Seitentitel</label><input id="ht" value="${esc(sv.http.title)}" placeholder="${esc(d.cfg.hostname)}"></div><div class="f"><label for="hb">Seitentext</label><textarea id="hb" class="ta" rows="5">${esc(sv.http.body)}</textarea></div></div>`;
      if (st === 'dns') h += `<div class="appform"><label class="ck"><input type="checkbox" id="don" ${sv.dns.on ? 'checked' : ''}> DNS-Dienst aktiv (Port 53)</label><table class="eps"><thead><tr><th>Name</th><th>Adresse (A)</th><th></th></tr></thead><tbody>${sv.dns.records.map((r, k) => `<tr><td>${esc(r.name)}</td><td class="mono">${esc(r.ip)}</td><td class="rtools"><button data-rm="${k}" aria-label="Eintrag löschen">✕</button></td></tr>`).join('') || '<tr><td colspan="3" class="muted">Keine Einträge.</td></tr>'}</tbody></table><div class="irow" style="margin-top:.6rem"><input id="dn" placeholder="name.lab.local" aria-label="Name"><input id="dip" placeholder="10.10.0.11" aria-label="IP-Adresse"><button class="btn small" id="dadd">Hinzufügen</button></div><p id="smsg" class="appmsg"></p></div>`;
      if (st === 'dhcp') { const p = sv.dhcp, ls = Object.entries(p.leases || {}); h += `<div class="appform"><label class="ck"><input type="checkbox" id="pon" ${p.on ? 'checked' : ''}> DHCP-Dienst aktiv</label><div class="f2"><div class="f"><label for="pg">Default-Gateway</label><input id="pg" value="${esc(p.gw)}" placeholder="10.30.0.1"></div><div class="f"><label for="pd">DNS-Server</label><input id="pd" value="${esc(p.dns)}" placeholder="10.10.0.11"></div></div><div class="f2"><div class="f"><label for="ps">Start-IP</label><input id="ps" value="${esc(p.start)}" placeholder="10.30.0.100"></div><div class="f"><label for="pm">Subnetzmaske</label><input id="pm" value="${esc(p.mask)}"></div></div><div class="f"><label for="px">Max. Clients</label><input id="px" inputmode="numeric" value="${p.max}" style="width:7rem"></div><button class="btn primary" id="psave">Speichern</button><p id="smsg" class="appmsg"></p><p class="muted small">Der Server muss im selben VLAN wie die Clients stehen und eine IP aus dem Pool-Subnetz haben (kein DHCP-Relay in diesem Lab).</p>${ls.length ? `<h4>Vergebene Adressen</h4><table class="eps"><tbody>${ls.map(([k, v]) => `<tr><td>${esc(S.net.devs[k] ? S.net.devs[k].cfg.hostname : k)}</td><td class="mono">${esc(v)}</td></tr>`).join('')}</tbody></table>` : ''}</div>`; }
      body.innerHTML = h;
      $$('.svctabs [data-s]', body).forEach(b => b.onclick = () => { st = b.dataset.s; drawSvc(); });
      if (g('hon')) { g('hon').onchange = e => { sv.http.on = e.target.checked; save(); drawSvc(); }; g('hs').onchange = e => { sv.http.https = e.target.checked; save(); }; g('ht').oninput = e => { sv.http.title = e.target.value; save(); }; g('hb').oninput = e => { sv.http.body = e.target.value; save(); }; }
      if (g('don')) { g('don').onchange = e => { sv.dns.on = e.target.checked; save(); drawSvc(); }; $$('[data-rm]', body).forEach(b => b.onclick = () => { sv.dns.records.splice(+b.dataset.rm, 1); save(); drawSvc(); }); g('dadd').onclick = () => { const n = g('dn').value.trim(), ip = g('dip').value.trim(); if (!n || !NL.validIp(ip)) { g('smsg').innerHTML = '<span class="neg">Name und gültige IP-Adresse eingeben.</span>'; return; } sv.dns.records = sv.dns.records.filter(r => r.name.toLowerCase() !== n.toLowerCase()); sv.dns.records.push({ name: n, ip }); save(); drawSvc(); }; }
      if (g('pon')) { g('pon').onchange = e => { sv.dhcp.on = e.target.checked; save(); drawSvc(); }; g('psave').onclick = () => { const p = sv.dhcp, gw = g('pg').value.trim(), dn = g('pd').value.trim(), s0 = g('ps').value.trim(), mk = g('pm').value.trim(), mx = +g('px').value; const bad = x => { g('smsg').innerHTML = `<span class="neg">${x}</span>`; }; if (s0 && !NL.validIp(s0)) return bad('Ungültige Start-IP.'); if (NL.maskLen(mk) === null) return bad('Ungültige Subnetzmaske.'); if ((gw && !NL.validIp(gw)) || (dn && !NL.validIp(dn))) return bad('Gateway/DNS: ungültige IP.'); if (!(mx >= 1 && mx <= 500)) return bad('Max. Clients: 1–500.'); Object.assign(p, { gw, dns: dn, start: s0, mask: mk, max: mx }); save(); g('smsg').innerHTML = '<span class="okmsg">Gespeichert.</span>'; }; }
    }
    draw();
  }
  // ---------------- Aufgaben: Aufbau & Fehlersuche ----------------
  const hd = (net, h) => Object.values(net.devs).find(d => d.cfg.hostname === h);
  const pg = (net, a, ip, flow) => { const d = hd(net, a); return !!d && NL.ping(net, d.id, ip, flow).ok; };
  const lk = (net, a, ap, b, bp, cable) => net.links.push({ a: hd(net, a).id, ap, b: hd(net, b).id, bp, cable: cable || 'cu' });
  const rn = (net, h, lines) => run(net, hd(net, h).id, lines);
  const mk = (net, m, x, y, h) => addDev(net, m, x, y, h);
  const G = 'GigabitEthernet1/0/';
  const SC = [
    { id: 'sc-l3', kind: 'Aufbau', title: 'Inter-VLAN-Routing am Switch', est: '10 min',
      intro: 'Vier PCs hängen an einem neuen Switch, alle mit IP-Adresse und Gateway. Trenne Vertrieb (VLAN 10) und IT (VLAN 20) – und lass den Switch zwischen den VLANs routen.',
      build(net) { mk(net, 'C9200L-24P-4X', 420, 130, 'SW-ACC'); ['PC-A1', 'PC-A2', 'PC-B1', 'PC-B2'].forEach((h, i) => { mk(net, 'PC', 170 + i * 170, 340, h); lk(net, h, 'eth0', 'SW-ACC', G + (i + 1)); });
        rn(net, 'PC-A1', ['ip 10.10.0.11/24 10.10.0.1']); rn(net, 'PC-A2', ['ip 10.10.0.12/24 10.10.0.1']); rn(net, 'PC-B1', ['ip 10.20.0.11/24 10.20.0.1']); rn(net, 'PC-B2', ['ip 10.20.0.12/24 10.20.0.1']); },
      goals: [
        { t: 'VLAN 10 und VLAN 20 existieren auf SW-ACC', c: n => { const v = hd(n, 'SW-ACC').cfg.vlans; return !!v[10] && !!v[20]; } },
        { t: 'Gi1/0/1–2 sind Access-Ports in VLAN 10, Gi1/0/3–4 in VLAN 20', c: n => { const i = hd(n, 'SW-ACC').cfg.ifs, g = k => i[G + k]; return [1, 2].every(k => g(k).mode === 'access' && g(k).vlan === 10) && [3, 4].every(k => g(k).mode === 'access' && g(k).vlan === 20); } },
        { t: 'Routing auf dem Switch ist aktiv (<code>ip routing</code>)', c: n => !!hd(n, 'SW-ACC').cfg.ipRouting },
        { t: 'SVIs: VLAN 10 = <code>10.10.0.1/24</code>, VLAN 20 = <code>10.20.0.1/24</code>, beide aktiv', c: n => { const i = hd(n, 'SW-ACC').cfg.ifs, ok = (k, ip) => i[k] && i[k].ip === ip && !i[k].shutdown && NL.maskLen(i[k].mask) === 24; return ok('Vlan10', '10.10.0.1') && ok('Vlan20', '10.20.0.1'); } },
        { t: 'PC-A1 erreicht PC-A2 (gleiches VLAN 10)', c: n => hd(n, 'SW-ACC').cfg.ifs[G + 1].vlan === 10 && pg(n, 'PC-A1', '10.10.0.12') },
        { t: 'PC-A1 erreicht PC-B1 (anderes VLAN, über den Switch geroutet)', c: n => pg(n, 'PC-A1', '10.20.0.11') }],
      hints: ['VLANs: <code>vlan 10</code>, <code>vlan 20</code>. Ports: <code>interface range g1/0/1 - 2</code> → <code>switchport mode access</code> → <code>switchport access vlan 10</code>.', 'Der Switch routet erst nach <code>ip routing</code>.', 'SVI: <code>interface vlan 10</code> → <code>ip address 10.10.0.1 255.255.255.0</code> → <code>no shutdown</code>. Die SVI-Adresse ist das Gateway der PCs.'],
      sol(net) { rn(net, 'SW-ACC', ['vlan 10', 'vlan 20', 'interface range g1/0/1 - 2', 'switchport mode access', 'switchport access vlan 10', 'interface range g1/0/3 - 4', 'switchport mode access', 'switchport access vlan 20', 'ip routing', 'interface vlan 10', 'ip address 10.10.0.1 255.255.255.0', 'no shutdown', 'interface vlan 20', 'ip address 10.20.0.1 255.255.255.0', 'no shutdown']); } },
    { id: 'sc-fw', kind: 'Aufbau', title: 'Gäste-Zone an der Firewall', est: '20 min',
      intro: 'Eine ASA trennt vier Zonen: Provider, Mitarbeiter, Gäste und einen Webserver (DMZ). Verkabelung und Endgeräte stehen. Richte Zonen, Security-Levels, NAT und Default-Route ein – Gäste sollen nur ins Internet.',
      build(net) { mk(net, 'ISP-Cloud', 450, 70, 'ISP'); mk(net, 'ASA-5516-X', 450, 230, 'FW-01'); mk(net, 'PC', 150, 380, 'PC-STAFF'); mk(net, 'PC', 450, 420, 'PC-GUEST'); mk(net, 'Server', 760, 380, 'SRV-WEB');
        lk(net, 'ISP', 'eth0', 'FW-01', 'GigabitEthernet1/1'); lk(net, 'PC-STAFF', 'eth0', 'FW-01', 'GigabitEthernet1/2'); lk(net, 'PC-GUEST', 'eth0', 'FW-01', 'GigabitEthernet1/3'); lk(net, 'SRV-WEB', 'eth0', 'FW-01', 'GigabitEthernet1/4');
        rn(net, 'ISP', ['ip 198.51.100.1/24 198.51.100.2']); rn(net, 'PC-STAFF', ['ip 10.1.0.10/24 10.1.0.1']); rn(net, 'PC-GUEST', ['ip 10.2.0.10/24 10.2.0.1']); rn(net, 'SRV-WEB', ['ip 10.3.0.10/24 10.3.0.1']); },
      goals: [
        { t: 'Zonen vergeben: Gi1/1 <code>outside</code>, Gi1/2 <code>inside</code>, Gi1/3 <code>guest</code>, Gi1/4 <code>dmz</code>', c: n => { const i = hd(n, 'FW-01').cfg.ifs, f = k => i['GigabitEthernet1/' + k].nameif; return f(1) === 'outside' && f(2) === 'inside' && f(3) === 'guest' && f(4) === 'dmz'; } },
        { t: 'Security-Levels: outside &lt; guest &lt; dmz &lt; inside', c: n => { const i = hd(n, 'FW-01').cfg.ifs, l = k => i['GigabitEthernet1/' + k].sl || 0; return l(1) < l(3) && l(3) < l(4) && l(4) < l(2); } },
        { t: 'IPs der Firewall (Gateways): .2/24 am Provider, 10.1.0.1, 10.2.0.1, 10.3.0.1 – alle Schnittstellen aktiv', c: n => { const i = hd(n, 'FW-01').cfg.ifs, ok = (k, ip) => { const x = i['GigabitEthernet1/' + k]; return x.ip === ip && !x.shutdown && NL.maskLen(x.mask) === 24; }; return ok(1, '198.51.100.2') && ok(2, '10.1.0.1') && ok(3, '10.2.0.1') && ok(4, '10.3.0.1'); } },
        { t: 'Default-Route nach außen (<code>198.51.100.1</code>)', c: n => hd(n, 'FW-01').cfg.routes.some(r => r.net === '0.0.0.0' && r.nh === '198.51.100.1') },
        { t: 'PAT von <code>inside</code> und <code>guest</code> nach <code>outside</code>', c: n => { const a = hd(n, 'FW-01').cfg.nat; return a.some(x => x.from === 'inside' && x.to === 'outside') && a.some(x => x.from === 'guest' && x.to === 'outside'); } },
        { t: 'Mitarbeiter erreichen das Internet (ISP) und den Webserver auf TCP 443', c: n => pg(n, 'PC-STAFF', '198.51.100.1') && pg(n, 'PC-STAFF', '10.3.0.10', { proto: 'tcp', port: 443 }) },
        { t: 'Gäste erreichen das Internet, aber weder den Webserver noch das Mitarbeiter-Netz', c: n => pg(n, 'PC-GUEST', '198.51.100.1') && !pg(n, 'PC-GUEST', '10.3.0.10', { proto: 'tcp', port: 443 }) && !pg(n, 'PC-GUEST', '10.1.0.10') }],
      hints: ['Interface einrichten: <code>interface g1/1</code> → <code>nameif outside</code> → <code>ip address …</code> → <code>no shutdown</code> (oder über die Port-Karte rechts).', 'Standard-Levels: inside 100, outside 0. Für <code>guest</code> und <code>dmz</code> setzt du <code>security-level</code> selbst, z. B. 20 und 50.', 'Verkehr von hohem zu niedrigem Level ist erlaubt, umgekehrt ohne ACL nicht – damit sind Gäste automatisch isoliert.', 'NAT: <code>nat (inside,outside) source dynamic any interface</code>, ebenso für <code>guest</code>.'],
      sol(net) { rn(net, 'FW-01', ['interface g1/1', 'nameif outside', 'ip address 198.51.100.2 255.255.255.0', 'no shutdown', 'interface g1/2', 'nameif inside', 'ip address 10.1.0.1 255.255.255.0', 'no shutdown', 'interface g1/3', 'nameif guest', 'security-level 20', 'ip address 10.2.0.1 255.255.255.0', 'no shutdown', 'interface g1/4', 'nameif dmz', 'security-level 50', 'ip address 10.3.0.1 255.255.255.0', 'no shutdown', 'exit', 'route outside 0.0.0.0 0.0.0.0 198.51.100.1', 'nat (inside,outside) source dynamic any interface', 'nat (guest,outside) source dynamic any interface']); } },
    { id: 'sc-trunk', kind: 'Fehlersuche', title: 'Server im anderen Gebäude nicht erreichbar', est: '10 min',
      intro: 'PC-OFFICE kann SRV-APP (10.10.0.10) nicht erreichen. Beide Switches sind per 10G-Glasfaser verbunden. Im Netz stecken zwei Fehler – finde sie mit Ping, <code>show vlan brief</code> und <code>show interfaces trunk</code>.',
      build(net) { mk(net, 'C9200L-24P-4X', 260, 190, 'SW-A'); mk(net, 'C9200L-24P-4X', 660, 190, 'SW-B'); mk(net, 'PC', 120, 370, 'PC-OFFICE'); mk(net, 'Server', 800, 370, 'SRV-APP');
        lk(net, 'PC-OFFICE', 'eth0', 'SW-A', G + 1); lk(net, 'SRV-APP', 'eth0', 'SW-B', G + 1); lk(net, 'SW-A', 'TenGigabitEthernet1/1/1', 'SW-B', 'TenGigabitEthernet1/1/1', 'mmf'); hd(net, 'SW-A').xcvr['TenGigabitEthernet1/1/1'] = 'SFP-10G-SR'; hd(net, 'SW-B').xcvr['TenGigabitEthernet1/1/1'] = 'SFP-10G-SR';
        rn(net, 'SW-A', ['vlan 10', 'name OFFICE', 'interface g1/0/1', 'switchport mode access', 'switchport access vlan 10', 'interface te1/1/1', 'switchport mode trunk']);
        rn(net, 'SW-B', ['vlan 10', 'name OFFICE', 'vlan 20', 'vlan 99', 'interface te1/1/1', 'switchport mode trunk', 'switchport trunk allowed vlan 20,99']);
        rn(net, 'PC-OFFICE', ['ip 10.10.0.20/24 10.10.0.1']); rn(net, 'SRV-APP', ['ip 10.10.0.10/24 10.10.0.1']); },
      goals: [
        { t: 'Der Trunk auf SW-B lässt VLAN 10 durch', c: n => { const a = hd(n, 'SW-B').cfg.ifs['TenGigabitEthernet1/1/1'].allowed; return a === null || a.includes(10); } },
        { t: 'Der Serverport (Gi1/0/1 auf SW-B) liegt in VLAN 10', c: n => hd(n, 'SW-B').cfg.ifs[G + 1].vlan === 10 },
        { t: 'PC-OFFICE erreicht SRV-APP', c: n => pg(n, 'PC-OFFICE', '10.10.0.10') }],
      hints: ['Ping-Debugger lesen: Er nennt oft direkt den Grund (z. B. „VLAN 10 ist auf dem Trunk nicht erlaubt“).', '<code>show interfaces trunk</code> zeigt auf jedem Switch die erlaubten VLANs.', '<code>show vlan brief</code> verrät, in welchem VLAN der Serverport liegt.'],
      sol(net) { rn(net, 'SW-B', ['interface te1/1/1', 'switchport trunk allowed vlan 10,20,99', 'interface g1/0/1', 'switchport access vlan 10']); } },
    { id: 'sc-inet', kind: 'Fehlersuche', title: 'Kein Internet im Büro', est: '10 min',
      intro: 'PC-1 erreicht weder den ISP noch Webseiten. Der Router R1 hängt am Provider (203.0.113.1/30). Drei Fehler sind eingebaut: Layer 1, Layer 3 und Endgerät.',
      build(net) { mk(net, 'PC', 150, 230, 'PC-1'); mk(net, 'ISR4331', 420, 230, 'R1'); mk(net, 'ISP-Cloud', 700, 230, 'ISP'); lk(net, 'PC-1', 'eth0', 'R1', 'GigabitEthernet0/0/0'); lk(net, 'R1', 'GigabitEthernet0/0/1', 'ISP', 'eth0');
        rn(net, 'R1', ['interface g0/0/0', 'ip address 10.0.0.1 255.255.255.0', 'no shutdown', 'interface g0/0/1', 'ip address 203.0.113.2 255.255.255.252']); rn(net, 'ISP', ['ip 203.0.113.1/30 203.0.113.2']); rn(net, 'PC-1', ['ip 10.0.0.10/24 10.0.0.254']); hd(net, 'PC-1').cfg.dns = '203.0.113.1'; },
      goals: [
        { t: 'R1: Schnittstelle zum ISP (Gi0/0/1) ist aktiviert', c: n => !hd(n, 'R1').cfg.ifs['GigabitEthernet0/0/1'].shutdown },
        { t: 'R1: Default-Route zum ISP (<code>203.0.113.1</code>) vorhanden', c: n => hd(n, 'R1').cfg.routes.some(r => r.net === '0.0.0.0' && r.nh === '203.0.113.1') },
        { t: 'PC-1: richtiges Default-Gateway (<code>10.0.0.1</code>)', c: n => hd(n, 'PC-1').cfg.gw === '10.0.0.1' },
        { t: 'PC-1 erreicht den ISP per Ping', c: n => pg(n, 'PC-1', '203.0.113.1') },
        { t: 'Im Browser von PC-1 lädt <code>http://www.example.com</code>', c: n => { const d = hd(n, 'PC-1'); return !!d && !!httpGet(d, 'http://www.example.com').ok; } }],
      hints: ['Von unten nach oben prüfen: Link und shutdown (<code>show ip interface brief</code>), dann Routen, dann Endgerät.', 'Der PC erreicht sein Gateway nur, wenn es im eigenen Subnetz liegt – vergleiche mit der Router-Schnittstelle.', 'Ohne Default-Route weiß R1 nicht, wohin Pakete ins Internet gehören.'],
      sol(net) { rn(net, 'R1', ['interface g0/0/1', 'no shutdown', 'exit', 'ip route 0.0.0.0 0.0.0.0 203.0.113.1']); rn(net, 'PC-1', ['ip 10.0.0.10/24 10.0.0.1']); } },
    { id: 'sc-web', kind: 'Fehlersuche', title: 'Intranet-Seite lädt nicht', est: '8 min',
      intro: 'Im Browser von PC-1 erscheint „Seite nicht erreichbar“, wenn <code>http://intranet.lab.local</code> aufgerufen wird. PC und Server sind korrekt verkabelt und im selben Netz. Die Ursache liegt in den Diensten und der Namensauflösung – es sind drei Fehler.',
      build(net) { mk(net, 'PC', 170, 300, 'PC-1'); mk(net, 'C9200L-24P-4X', 450, 170, 'SW'); mk(net, 'Server', 740, 300, 'SRV-INTRA'); lk(net, 'PC-1', 'eth0', 'SW', G + 1); lk(net, 'SRV-INTRA', 'eth0', 'SW', G + 2);
        rn(net, 'PC-1', ['ip 10.0.0.20/24 10.0.0.1']); rn(net, 'SRV-INTRA', ['ip 10.0.0.10/24 10.0.0.1']); hd(net, 'PC-1').cfg.dns = '10.0.0.11'; const sv = hd(net, 'SRV-INTRA').svc; sv.dns.on = true; sv.dns.records = []; sv.http.on = false; sv.http.title = 'Intranet'; sv.http.body = 'Willkommen im Intranet.'; },
      goals: [
        { t: 'PC-1 fragt den richtigen DNS-Server (<code>10.0.0.10</code>)', c: n => hd(n, 'PC-1').cfg.dns === '10.0.0.10' },
        { t: 'Auf SRV-INTRA gibt es den DNS-Eintrag <code>intranet.lab.local</code> → 10.0.0.10', c: n => hd(n, 'SRV-INTRA').svc.dns.records.some(r => r.name.toLowerCase() === 'intranet.lab.local' && (r.ip === '10.0.0.10' || r.ip === '@')) },
        { t: 'Der Webdienst (HTTP) auf SRV-INTRA ist eingeschaltet', c: n => !!hd(n, 'SRV-INTRA').svc.http.on },
        { t: 'Der Browser von PC-1 lädt <code>http://intranet.lab.local</code>', c: n => { const d = hd(n, 'PC-1'); return !!d && !!httpGet(d, 'http://intranet.lab.local').ok; } }],
      hints: ['Doppelklick auf PC-1 → Eingabeaufforderung: <code>ping 10.0.0.10</code> geht – <code>nslookup intranet.lab.local</code> nicht. Das trennt Netz von Namensauflösung.', 'DNS-Server des PCs: Desktop → IP-Konfiguration.', 'Dienste des Servers: Doppelklick auf SRV-INTRA → Reiter „Dienste“ (HTTP und DNS).'],
      sol(net) { hd(net, 'PC-1').cfg.dns = '10.0.0.10'; const sv = hd(net, 'SRV-INTRA').svc; sv.dns.records.push({ name: 'intranet.lab.local', ip: '10.0.0.10' }); sv.http.on = true; } }
  ];
  function buildScen(id) { const sc = SC.find(x => x.id === id), net = newNet(); sc.build(net); return net; }
  const sdone = () => store.get('scendone', []);
  function startScen(id) { store.set('sbxscen', id); if (!store.get('scen.' + id)) store.set('scen.' + id, buildScen(id)); open(app); S.dock = 'task'; S.dockOpen = true; render(); }
  function endScen() { store.set('sbxscen', null); open(app); }
  function resetScen() { const id = S.scen; store.set('scen.' + id, buildScen(id)); open(app); S.dock = 'task'; S.dockOpen = true; render(); }
  function scenFly(fly) {
    const done = sdone(); fly.hidden = false;
    fly.innerHTML = `<div class="flyh"><h2>Aufgaben</h2><button class="x" id="flyX" aria-label="Schließen">✕</button></div><p class="flyp">Szenarien mit Zielen, die sich live abhaken. Dein eigenes Projekt bleibt unberührt.</p><div class="scl">${SC.map(x => `<button class="sci" data-sc="${x.id}"><span class="sk ${x.kind === 'Fehlersuche' ? 'r' : 'g'}">${x.kind}</span><b>${esc(x.title)}</b><span class="muted">${x.est}${done.includes(x.id) ? ' · ✓ gelöst' : ''}${S.scen === x.id ? ' · aktiv' : ''}</span></button>`).join('')}</div>${S.scen ? '<button class="btn small block" id="scenEnd">Aufgabe beenden – zurück zum Projekt</button>' : ''}`;
    $('#flyX').onclick = () => { S.flyout = null; drawPal(); }; $$('.sci', fly).forEach(b => b.onclick = () => startScen(b.dataset.sc)); if ($('#scenEnd')) $('#scenEnd').onclick = endScen;
  }
  function drawTask() {
    const el = $('#task'), pill = $('#scenpill'); if (!el) return; const sc = S.scen && SC.find(x => x.id === S.scen);
    if (!sc) { el.innerHTML = ''; if (pill) pill.hidden = true; return; }
    const res = sc.goals.map(g => { let ok = false; try { ok = !!g.c(S.net); } catch (e) { ok = false; } return { t: g.t, ok }; }), n = res.filter(r => r.ok).length, all = n === res.length;
    if (all && !sdone().includes(sc.id)) store.set('scendone', [...sdone(), sc.id]);
    $('#taskn').textContent = n + '/' + res.length; pill.hidden = false; pill.textContent = `Aufgabe: ${sc.title} · ${n}/${res.length}`; pill.classList.toggle('done', all);
    el.innerHTML = `<div class="taskhead"><b>${esc(sc.title)}</b><span class="chip ${sc.kind === 'Fehlersuche' ? 'r' : 'g'}">${sc.kind}</span></div><p class="taskintro">${sc.intro}</p>${all ? '<div class="banner" role="status"><strong>Aufgabe gelöst.</strong> Weitere Aufgaben findest du links unter „Aufgaben“.</div>' : ''}<ul class="tasks">${res.map(r => `<li class="${r.ok ? 'ok' : ''}"><span class="box" aria-hidden="true"></span><span><span class="sr">${r.ok ? 'Erledigt: ' : 'Offen: '}</span>${r.t}</span></li>`).join('')}</ul><details class="hints"><summary>Hinweise (${sc.hints.length})</summary><ol>${sc.hints.map(h => `<li>${h}</li>`).join('')}</ol></details><div class="taskact"><button class="btn small" id="scSol">Lösung anwenden</button><button class="btn small" id="scReset">Neu starten</button><button class="btn small ghost" id="scEnd">Aufgabe beenden</button></div>`;
    $('#scSol').onclick = () => { if (confirm('Die Musterlösung wird in das Netz eingetragen. Fortfahren?')) act(() => sc.sol(S.net)); };
    $('#scReset').onclick = () => { if (confirm('Aufgabe neu starten? Deine Änderungen gehen verloren.')) resetScen(); };
    $('#scEnd').onclick = endScen;
  }

  function close() { document.removeEventListener('keydown', escKey); S = null; }
  function lintNet(net) { const keep = S; S = { net }; try { return lint(net); } finally { S = keep; } }
  function testApi(net) { S = { net, sess: {}, out: {}, cmd: {}, web: {} }; return { resolve, httpGet, dhcpRequest, hostLine, SC, buildScen, hd, addDev: (m, x, y, h) => addDev(net, m, x, y, h) }; }
  return { open, close, lint: lintNet, example, testApi };
})();
if (typeof module !== 'undefined') module.exports = Sandbox;
