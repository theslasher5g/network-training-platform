// ===================== NetLab Labs =====================
const LABS = (function () {
  const N = typeof NL !== 'undefined' ? NL : require('./engine.js');
  const P = (n, a, ip) => N.ping(n, a, ip).ok;
  const IF = (n, d, i) => n.devs[d].cfg.ifs[N.normIf(i)];
  const GL = (n, d, re) => n.devs[d].cfg.lines.some(l => re.test(l.toLowerCase()));
  const BL = (n, d, head) => n.devs[d].cfg.blocks.find(b => b.head.toLowerCase().startsWith(head.toLowerCase()));
  const BH = (b, re) => !!b && b.lines.some(l => re.test(l.toLowerCase()));
  const VL = (n, d, v, name) => { const x = n.devs[d].cfg.vlans[v]; return !!x && (!name || x.toUpperCase() === name); };
  const ACC = (n, d, ports, v) => ports.every(p => { const i = IF(n, d, p); return i.mode === 'access' && i.modeSet && i.vlan === v; });
  const TR = (n, d, p) => IF(n, d, p).mode === 'trunk';
  const IPM = (i, ip, len) => !!i && i.ip === ip && N.maskLen(i.mask || '') === len;
  const ROUTE = (n, d, ip) => n.devs[d].cfg.routes.some(r => N.inNet(ip, r.net, r.mask));
  const ext = i => i ? i.extra : [];

  const T = {
    pc: (id, x, y, ip, len, gw, opt = {}) => ({ id, type: opt.server ? 'server' : 'pc', x, y, opt: Object.assign({ host: opt.host || id }, opt), host: ip ? [`ip ${ip}/${len}` + (gw ? ' ' + gw : '')] : [] })
  };

  function build(lab) {
    const net = { devs: {}, links: [] };
    lab.devs.forEach(d => { net.devs[d.id] = N.mkDev(d.id, d.type, d.x, d.y, d.ports, d.opt || {}); });
    lab.links.forEach(([a, ap, b, bp]) => net.links.push({ a, ap: ap === 'eth0' ? 'eth0' : N.normIf(ap), b, bp: bp === 'eth0' ? 'eth0' : N.normIf(bp) }));
    lab.devs.forEach(d => {
      const dev = net.devs[d.id];
      if (N.isHost(dev)) (d.host || []).forEach(l => N.exec(net, d.id, N.newSess(), l));
      const cmds = (lab.setup || {})[d.id];
      if (cmds) { const s = N.newSess(); ['enable', 'configure terminal', ...cmds, 'end'].forEach(l => { const r = N.exec(net, d.id, s, l); if (r && r.startsWith('%') && !r.includes('Creating vlan')) console.warn('setup', d.id, l, r); }); }
      dev.saved = false;
    });
    return net;
  }

  const sw = (id, x, y, host) => ({ id, type: 'switch', x, y, opt: { host: host || id } });
  const rt = (id, x, y, host) => ({ id, type: 'router', x, y, opt: { host: host || id } });

  const L = [];

  // ---------------- Grundlagen ----------------
  L.push({
    id: 'basics', track: 'Grundlagen', title: 'Erste Schritte in Cisco IOS', type: 'cli', est: '10 min',
    intro: 'Zwei PCs hängen an einem neuen Switch. Lerne die IOS-Modi kennen, vergib Adressen und prüfe die Verbindung.',
    devs: [sw('SW1', 400, 90), T.pc('PC1', 210, 290), T.pc('PC2', 590, 290)],
    links: [['PC1', 'eth0', 'SW1', 'g0/1'], ['PC2', 'eth0', 'SW1', 'g0/2']],
    tasks: [
      { t: 'Gib dem Switch den Hostnamen <code>SW-Lab</code>', c: n => n.devs.SW1.cfg.hostname === 'SW-Lab' },
      { t: 'PC1 bekommt <code>192.168.1.10/24</code>', c: n => n.devs.PC1.cfg.ip === '192.168.1.10' && n.devs.PC1.cfg.mask === '255.255.255.0' },
      { t: 'PC2 bekommt <code>192.168.1.20/24</code>', c: n => n.devs.PC2.cfg.ip === '192.168.1.20' && n.devs.PC2.cfg.mask === '255.255.255.0' },
      { t: 'PC1 erreicht PC2 per <code>ping</code>', c: n => P(n, 'PC1', '192.168.1.20') },
      { t: 'Switch-Konfiguration gespeichert', c: n => n.devs.SW1.saved && n.devs.SW1.cfg.hostname === 'SW-Lab' }
    ],
    hints: ['Klicke auf ein Gerät, um seine Konsole zu öffnen. Mit <code>?</code> siehst du die Befehle des aktuellen Modus.',
      'IOS-Modi: <code>enable</code> (privilegiert, #) → <code>configure terminal</code> (Konfiguration) → <code>end</code> zurück.',
      'Am PC: <code>ip 192.168.1.10 255.255.255.0</code> oder kurz <code>ip 192.168.1.10/24</code>.',
      'Speichern mit <code>write memory</code> oder <code>copy running-config startup-config</code>.'],
    sol: { SW1: ['enable', 'configure terminal', 'hostname SW-Lab', 'end', 'write memory'], PC1: ['ip 192.168.1.10 255.255.255.0'], PC2: ['ip 192.168.1.20 255.255.255.0'] }
  });
  L.push({ id: 'subnet', track: 'Grundlagen', title: 'Subnetting-Trainer', type: 'subnet', est: '15 min', goal: 8,
    intro: 'Netzadresse, Broadcast, Hostbereich, Maske und VLSM: Beantworte 8 zufällige Aufgaben richtig. Bei Fehlern bekommst du den Rechenweg.' });

  // ---------------- Switching ----------------
  L.push({
    id: 'vlans', track: 'Switching', title: 'VLANs segmentieren', type: 'cli', est: '15 min',
    intro: 'Vier PCs im selben IP-Netz. Vertrieb (PC1, PC2) und IT (PC3, PC4) sollen auf Layer 2 getrennt werden – nur durch VLANs.',
    devs: [sw('SW1', 400, 80), T.pc('PC1', 130, 300, '192.168.1.11', 24), T.pc('PC2', 310, 300, '192.168.1.12', 24), T.pc('PC3', 490, 300, '192.168.1.13', 24), T.pc('PC4', 670, 300, '192.168.1.14', 24)],
    links: [['PC1', 'eth0', 'SW1', 'g0/1'], ['PC2', 'eth0', 'SW1', 'g0/2'], ['PC3', 'eth0', 'SW1', 'g0/3'], ['PC4', 'eth0', 'SW1', 'g0/4']],
    tasks: [
      { t: 'VLAN 10 mit Namen <code>SALES</code>', c: n => VL(n, 'SW1', 10, 'SALES') },
      { t: 'VLAN 20 mit Namen <code>IT</code>', c: n => VL(n, 'SW1', 20, 'IT') },
      { t: 'Gi0/1–0/2 als Access-Ports in VLAN 10', c: n => ACC(n, 'SW1', ['g0/1', 'g0/2'], 10) },
      { t: 'Gi0/3–0/4 als Access-Ports in VLAN 20', c: n => ACC(n, 'SW1', ['g0/3', 'g0/4'], 20) },
      { t: 'PC1 ↔ PC2 erreichbar (VLAN 10)', c: n => P(n, 'PC1', '192.168.1.12') && ACC(n, 'SW1', ['g0/1', 'g0/2'], 10) },
      { t: 'PC3 ↔ PC4 erreichbar (VLAN 20)', c: n => P(n, 'PC3', '192.168.1.14') && ACC(n, 'SW1', ['g0/3', 'g0/4'], 20) },
      { t: 'PC1 erreicht PC3 <b>nicht</b> mehr', c: n => !P(n, 'PC1', '192.168.1.13') }
    ],
    hints: ['VLAN anlegen: <code>vlan 10</code> → <code>name SALES</code>.',
      'Mehrere Ports gleichzeitig: <code>interface range g0/1 - 2</code>.',
      'Port festlegen: <code>switchport mode access</code> und <code>switchport access vlan 10</code>.',
      'Kontrolle: <code>show vlan brief</code>.'],
    sol: { SW1: ['enable', 'configure terminal', 'vlan 10', 'name SALES', 'vlan 20', 'name IT', 'interface range g0/1 - 2', 'switchport mode access', 'switchport access vlan 10', 'interface range g0/3 - 4', 'switchport mode access', 'switchport access vlan 20', 'end'] }
  });
  L.push({
    id: 'trunk', track: 'Switching', title: '802.1Q-Trunk zwischen Switches', type: 'cli', est: '20 min',
    intro: 'SW1 ist fertig, SW2 ist neu. Verbinde beide per Trunk, sodass VLAN 10 und 20 standortübergreifend funktionieren – nach Best Practice.',
    devs: [sw('SW1', 250, 100), sw('SW2', 550, 100), T.pc('PC1', 120, 300, '192.168.10.11', 24), T.pc('PC2', 320, 300, '192.168.20.12', 24), T.pc('PC3', 480, 300, '192.168.10.13', 24), T.pc('PC4', 680, 300, '192.168.20.14', 24)],
    links: [['SW1', 'g0/8', 'SW2', 'g0/8'], ['PC1', 'eth0', 'SW1', 'g0/1'], ['PC2', 'eth0', 'SW1', 'g0/2'], ['PC3', 'eth0', 'SW2', 'g0/1'], ['PC4', 'eth0', 'SW2', 'g0/2']],
    setup: { SW1: ['vlan 10', 'name SALES', 'vlan 20', 'name IT', 'interface g0/1', 'switchport mode access', 'switchport access vlan 10', 'interface g0/2', 'switchport mode access', 'switchport access vlan 20'] },
    tasks: [
      { t: 'SW2: VLAN 10 <code>SALES</code> und 20 <code>IT</code> anlegen', c: n => VL(n, 'SW2', 10, 'SALES') && VL(n, 'SW2', 20, 'IT') },
      { t: 'SW2: Gi0/1 → VLAN 10, Gi0/2 → VLAN 20', c: n => ACC(n, 'SW2', ['g0/1'], 10) && ACC(n, 'SW2', ['g0/2'], 20) },
      { t: 'Gi0/8 auf beiden Switches als Trunk', c: n => TR(n, 'SW1', 'g0/8') && TR(n, 'SW2', 'g0/8') },
      { t: 'Native VLAN 99 auf beiden Seiten', c: n => IF(n, 'SW1', 'g0/8').native === 99 && IF(n, 'SW2', 'g0/8').native === 99 },
      { t: 'Trunk erlaubt nur VLAN 10, 20 und 99', c: n => ['SW1', 'SW2'].every(s => { const a = IF(n, s, 'g0/8').allowed; return a && a.slice().sort((x, y) => x - y).join() === '10,20,99'; }) },
      { t: 'PC1 ↔ PC3 erreichbar', c: n => P(n, 'PC1', '192.168.10.13') },
      { t: 'PC2 ↔ PC4 erreichbar', c: n => P(n, 'PC2', '192.168.20.14') }
    ],
    hints: ['Trunk: <code>interface g0/8</code> → <code>switchport mode trunk</code>.',
      'Native VLAN weg von VLAN 1 schützt vor VLAN-Hopping: <code>switchport trunk native vlan 99</code>.',
      'Erlaubte VLANs: <code>switchport trunk allowed vlan 10,20,99</code>.',
      'Kontrolle: <code>show interfaces trunk</code>. Native VLAN muss auf beiden Seiten gleich sein.'],
    sol: {
      SW1: ['enable', 'configure terminal', 'vlan 99', 'name NATIVE', 'interface g0/8', 'switchport mode trunk', 'switchport trunk native vlan 99', 'switchport trunk allowed vlan 10,20,99', 'end'],
      SW2: ['enable', 'configure terminal', 'vlan 10', 'name SALES', 'vlan 20', 'name IT', 'vlan 99', 'name NATIVE', 'interface g0/1', 'switchport mode access', 'switchport access vlan 10', 'interface g0/2', 'switchport mode access', 'switchport access vlan 20', 'interface g0/8', 'switchport mode trunk', 'switchport trunk native vlan 99', 'switchport trunk allowed vlan 10,20,99', 'end']
    }
  });
  L.push({ id: 'quiz-l2', track: 'Switching', title: 'Theorie: STP, EtherChannel, HSRP', type: 'quiz', est: '5 min',
    intro: 'Redundanz-Protokolle, die in jedem Campus-Netz laufen. Beantworte alle Fragen richtig.',
    qs: [
      { q: 'Welche Aufgabe hat Spanning Tree (STP)?', o: ['Layer-2-Schleifen verhindern, indem redundante Pfade blockiert werden', 'VLANs zwischen Switches übertragen', 'IP-Adressen an Clients verteilen', 'Bandbreite mehrerer Links bündeln'], a: 0, e: 'Ohne STP würden Broadcasts in redundanten Topologien endlos kreisen (Broadcast Storm).' },
      { q: 'Nach welchem Kriterium wird die Root Bridge gewählt?', o: ['Höchste IP-Adresse', 'Niedrigste Bridge-ID (Priorität + MAC-Adresse)', 'Meiste aktive Ports', 'Schnellster Uplink'], a: 1, e: 'Die niedrigste Bridge-ID gewinnt. Deshalb setzt man die Priorität am Core-Switch bewusst herunter.' },
      { q: 'Ein Access-Port mit BPDU Guard empfängt eine BPDU. Was passiert?', o: ['Der Port wird Root Port', 'Die BPDU wird ignoriert', 'Der Port geht in den Zustand err-disabled', 'Der Port wechselt in VLAN 1'], a: 2, e: 'BPDU Guard schützt Endgeräte-Ports vor fremden Switches – der Port wird sofort abgeschaltet.' },
      { q: 'Wozu dient EtherChannel mit LACP?', o: ['Mehrere physische Links zu einem logischen Link bündeln', 'Verschlüsselung zwischen Switches', 'Automatisches VLAN-Lernen', 'Ersatz für Routing'], a: 0, e: 'STP sieht den Bündel-Link als einen Port – alle Leitungen bleiben aktiv.' },
      { q: 'Was stellt HSRP bereit?', o: ['Einen Backup-DHCP-Server', 'Eine virtuelle Gateway-IP, die bei Ausfall ein anderer Router übernimmt', 'Lastverteilung über VLANs', 'Ein Routing-Protokoll für WAN-Strecken'], a: 1, e: 'Clients sprechen die virtuelle IP an; Active und Standby-Router teilen sie sich.' }
    ] });

  // ---------------- Routing ----------------
  L.push({
    id: 'ros', track: 'Routing', title: 'Router-on-a-Stick', type: 'cli', est: '20 min',
    intro: 'VLAN 10 und 20 sollen miteinander sprechen. Der Router hat nur einen physischen Port zum Switch – nutze Subinterfaces mit 802.1Q.',
    devs: [rt('R1', 400, 45), sw('SW1', 400, 205), T.pc('PC1', 220, 330, '192.168.10.10', 24, '192.168.10.1'), T.pc('PC2', 580, 330, '192.168.20.10', 24, '192.168.20.1')],
    links: [['R1', 'g0/0', 'SW1', 'g0/8'], ['PC1', 'eth0', 'SW1', 'g0/1'], ['PC2', 'eth0', 'SW1', 'g0/2']],
    setup: { SW1: ['vlan 10', 'name CLIENTS', 'vlan 20', 'name PRINTERS', 'interface g0/1', 'switchport mode access', 'switchport access vlan 10', 'interface g0/2', 'switchport mode access', 'switchport access vlan 20'] },
    tasks: [
      { t: 'SW1 Gi0/8 als Trunk zum Router', c: n => TR(n, 'SW1', 'g0/8') },
      { t: 'R1 Gi0/0 aktiviert', c: n => !IF(n, 'R1', 'g0/0').shutdown },
      { t: 'R1 Gi0/0.10: dot1Q 10, <code>192.168.10.1/24</code>', c: n => { const i = IF(n, 'R1', 'g0/0.10'); return !!i && i.encap === 10 && IPM(i, '192.168.10.1', 24); } },
      { t: 'R1 Gi0/0.20: dot1Q 20, <code>192.168.20.1/24</code>', c: n => { const i = IF(n, 'R1', 'g0/0.20'); return !!i && i.encap === 20 && IPM(i, '192.168.20.1', 24); } },
      { t: 'PC1 erreicht sein Gateway', c: n => P(n, 'PC1', '192.168.10.1') },
      { t: 'PC1 ↔ PC2 über den Router', c: n => P(n, 'PC1', '192.168.20.10') }
    ],
    hints: ['Router-Interfaces sind ab Werk <code>shutdown</code> – <code>show ip interface brief</code> verrät es.',
      'Subinterface: <code>interface g0/0.10</code> → <code>encapsulation dot1Q 10</code> → <code>ip address …</code>.',
      'Die Encapsulation muss vor der IP-Adresse gesetzt werden – und zur VLAN-ID passen.'],
    sol: { SW1: ['enable', 'configure terminal', 'interface g0/8', 'switchport mode trunk', 'end'], R1: ['enable', 'configure terminal', 'interface g0/0', 'no shutdown', 'interface g0/0.10', 'encapsulation dot1Q 10', 'ip address 192.168.10.1 255.255.255.0', 'interface g0/0.20', 'encapsulation dot1Q 20', 'ip address 192.168.20.1 255.255.255.0', 'end'] }
  });
  L.push({
    id: 'static', track: 'Routing', title: 'Statisches Routing über drei Router', type: 'cli', est: '20 min',
    intro: 'Zwei Standort-LANs, drei Router in Reihe. Die Interfaces sind konfiguriert – aber ein Fehler versteckt sich, und keiner kennt die fremden Netze.',
    devs: [T.pc('PC1', 80, 270, '10.1.1.10', 24, '10.1.1.1'), rt('R1', 240, 120), rt('R2', 400, 120), rt('R3', 560, 120), T.pc('PC2', 720, 270, '10.3.3.10', 24, '10.3.3.1')],
    links: [['PC1', 'eth0', 'R1', 'g0/0'], ['R1', 'g0/1', 'R2', 'g0/0'], ['R2', 'g0/1', 'R3', 'g0/0'], ['R3', 'g0/1', 'PC2', 'eth0']],
    setup: {
      R1: ['interface g0/0', 'ip address 10.1.1.1 255.255.255.0', 'no shutdown', 'interface g0/1', 'ip address 172.16.12.1 255.255.255.252', 'no shutdown'],
      R2: ['interface g0/0', 'ip address 172.16.12.2 255.255.255.252', 'no shutdown', 'interface g0/1', 'ip address 172.16.23.1 255.255.255.252'],
      R3: ['interface g0/0', 'ip address 172.16.23.2 255.255.255.252', 'no shutdown', 'interface g0/1', 'ip address 10.3.3.1 255.255.255.0', 'no shutdown']
    },
    tasks: [
      { t: 'Finde und behebe das Interface-Problem zwischen R2 und R3', c: n => N.ifUp(n, 'R2', 'GigabitEthernet0/1') },
      { t: 'R1 hat eine Route zu <code>10.3.3.0/24</code>', c: n => ROUTE(n, 'R1', '10.3.3.10') },
      { t: 'R3 hat den Rückweg zu <code>10.1.1.0/24</code>', c: n => ROUTE(n, 'R3', '10.1.1.10') },
      { t: 'R2 kennt beide LANs', c: n => ROUTE(n, 'R2', '10.1.1.10') && ROUTE(n, 'R2', '10.3.3.10') },
      { t: 'PC1 ↔ PC2 erreichbar', c: n => P(n, 'PC1', '10.3.3.10') }
    ],
    hints: ['Beginne mit <code>show ip interface brief</code> auf jedem Router.',
      'Statische Route: <code>ip route 10.3.3.0 255.255.255.0 172.16.12.2</code> (Ziel, Maske, Next Hop).',
      'Ein Ping braucht Hin- <b>und</b> Rückweg. Der Ping-Debugger zeigt, wo es hakt.',
      'An R1 und R3 ist auch eine Default-Route möglich: <code>ip route 0.0.0.0 0.0.0.0 …</code>'],
    sol: {
      R2: ['enable', 'configure terminal', 'interface g0/1', 'no shutdown', 'exit', 'ip route 10.1.1.0 255.255.255.0 172.16.12.1', 'ip route 10.3.3.0 255.255.255.0 172.16.23.2', 'end'],
      R1: ['enable', 'configure terminal', 'ip route 10.3.3.0 255.255.255.0 172.16.12.2', 'end'],
      R3: ['enable', 'configure terminal', 'ip route 10.1.1.0 255.255.255.0 172.16.23.1', 'end']
    }
  });
  L.push({
    id: 'l3sw', track: 'Routing', title: 'Inter-VLAN-Routing am Layer-3-Switch', type: 'cli', est: '10 min',
    intro: 'Statt Router-on-a-Stick routet der Core-Switch selbst – mit SVIs. So läuft das in den meisten Campus-Netzen.',
    devs: [sw('MLS1', 400, 90), T.pc('PC1', 220, 300, '192.168.10.10', 24, '192.168.10.1'), T.pc('PC2', 580, 300, '192.168.20.10', 24, '192.168.20.1')],
    links: [['PC1', 'eth0', 'MLS1', 'g0/1'], ['PC2', 'eth0', 'MLS1', 'g0/2']],
    setup: { MLS1: ['vlan 10', 'name OFFICE', 'vlan 20', 'name LAB', 'interface g0/1', 'switchport mode access', 'switchport access vlan 10', 'interface g0/2', 'switchport mode access', 'switchport access vlan 20'] },
    tasks: [
      { t: 'IP-Routing auf dem Switch aktivieren', c: n => n.devs.MLS1.cfg.ipRouting },
      { t: 'SVI VLAN 10: <code>192.168.10.1/24</code>', c: n => IPM(IF(n, 'MLS1', 'vlan10'), '192.168.10.1', 24) && !IF(n, 'MLS1', 'vlan10').shutdown },
      { t: 'SVI VLAN 20: <code>192.168.20.1/24</code>', c: n => IPM(IF(n, 'MLS1', 'vlan20'), '192.168.20.1', 24) && !IF(n, 'MLS1', 'vlan20').shutdown },
      { t: 'PC1 ↔ PC2 erreichbar', c: n => P(n, 'PC1', '192.168.20.10') }
    ],
    hints: ['<code>ip routing</code> schaltet den Switch zum Router.', 'SVI: <code>interface vlan 10</code> → <code>ip address 192.168.10.1 255.255.255.0</code> → <code>no shutdown</code>.'],
    sol: { MLS1: ['enable', 'configure terminal', 'ip routing', 'interface vlan 10', 'ip address 192.168.10.1 255.255.255.0', 'no shutdown', 'interface vlan 20', 'ip address 192.168.20.1 255.255.255.0', 'no shutdown', 'end'] }
  });

  // ---------------- Security ----------------
  L.push({
    id: 'acl', track: 'Security', title: 'Gäste-Netz mit ACL isolieren', type: 'cli', est: '20 min',
    intro: 'Gäste dürfen ins Internet, aber weder interne Server noch das Mitarbeiter-Netz erreichen. Löse das mit einer Extended ACL am Router.',
    devs: [T.pc('STAFF', 90, 330, '192.168.10.10', 24, '192.168.10.1'), T.pc('GUEST', 310, 330, '192.168.30.10', 24, '192.168.30.1'), sw('SW1', 200, 180), rt('R1', 430, 180),
      T.pc('SRV1', 660, 320, '10.0.0.10', 24, '10.0.0.1', { server: true }), T.pc('INET', 660, 70, '198.51.100.10', 24, '198.51.100.1', { server: true, host: 'INTERNET', icon: 'cloud' })],
    links: [['STAFF', 'eth0', 'SW1', 'g0/1'], ['GUEST', 'eth0', 'SW1', 'g0/2'], ['SW1', 'g0/8', 'R1', 'g0/0'], ['R1', 'g0/1', 'SRV1', 'eth0'], ['R1', 'g0/2', 'INET', 'eth0']],
    setup: {
      SW1: ['vlan 10', 'name STAFF', 'vlan 30', 'name GUEST', 'interface g0/1', 'switchport mode access', 'switchport access vlan 10', 'interface g0/2', 'switchport mode access', 'switchport access vlan 30', 'interface g0/8', 'switchport mode trunk'],
      R1: ['interface g0/0', 'no shutdown', 'interface g0/0.10', 'encapsulation dot1Q 10', 'ip address 192.168.10.1 255.255.255.0', 'interface g0/0.30', 'encapsulation dot1Q 30', 'ip address 192.168.30.1 255.255.255.0', 'interface g0/1', 'ip address 10.0.0.1 255.255.255.0', 'no shutdown', 'interface g0/2', 'ip address 198.51.100.1 255.255.255.0', 'no shutdown']
    },
    tasks: [
      { t: 'Extended ACL <code>110</code> angelegt', c: n => (n.devs.R1.cfg.acls[110] || []).length > 0 },
      { t: 'ACL 110 eingehend an Gi0/0.30 (Gäste-VLAN)', c: n => (IF(n, 'R1', 'g0/0.30') || {}).aclIn === '110' },
      { t: 'Gast → Server <code>10.0.0.10</code> blockiert', c: n => !P(n, 'GUEST', '10.0.0.10') },
      { t: 'Gast → Mitarbeiter-Netz blockiert', c: n => !P(n, 'GUEST', '192.168.10.10') },
      { t: 'Gast → Internet <code>198.51.100.10</code> erlaubt', c: n => P(n, 'GUEST', '198.51.100.10') },
      { t: 'Mitarbeiter → Server und Internet erlaubt', c: n => P(n, 'STAFF', '10.0.0.10') && P(n, 'STAFF', '198.51.100.10') }
    ],
    hints: ['Extended ACL: <code>access-list 110 deny ip &lt;Quelle&gt; &lt;Wildcard&gt; &lt;Ziel&gt; &lt;Wildcard&gt;</code>.',
      'Wildcard ist die invertierte Maske: /24 → <code>0.0.0.255</code>.',
      'Jede ACL endet mit einem impliziten <b>deny any</b> – vergiss <code>access-list 110 permit ip any any</code> nicht.',
      'Extended ACLs so nah wie möglich an der Quelle: <code>interface g0/0.30</code> → <code>ip access-group 110 in</code>.'],
    sol: { R1: ['enable', 'configure terminal', 'access-list 110 deny ip 192.168.30.0 0.0.0.255 10.0.0.0 0.0.0.255', 'access-list 110 deny ip 192.168.30.0 0.0.0.255 192.168.10.0 0.0.0.255', 'access-list 110 permit ip any any', 'interface g0/0.30', 'ip access-group 110 in', 'end'] }
  });
  L.push({
    id: 'harden', track: 'Security', title: 'Switch-Härtung nach Audit', type: 'cli', est: '25 min',
    intro: 'Ein Audit hat den Switch zerpflückt: Telnet, Klartext-Passwörter, offene Ports. Bring ihn auf Stand – ohne den Betrieb zu stören.',
    devs: [sw('SW1', 400, 90), T.pc('PC1', 220, 300, '192.168.1.11', 24), T.pc('PC2', 400, 310, '192.168.1.12', 24), T.pc('PC3', 580, 300, '192.168.1.13', 24)],
    links: [['PC1', 'eth0', 'SW1', 'g0/1'], ['PC2', 'eth0', 'SW1', 'g0/2'], ['PC3', 'eth0', 'SW1', 'g0/3']],
    setup: { SW1: ['enable password cisco', 'line vty 0 4', 'password cisco', 'login', 'transport input telnet', 'exit'] },
    tasks: [
      { t: '<code>enable secret</code> statt <code>enable password</code>', c: n => GL(n, 'SW1', /^enable secret /) && !GL(n, 'SW1', /^enable password /) },
      { t: 'Passwörter in der Config verschlüsseln', c: n => GL(n, 'SW1', /^service password-encryption$/) },
      { t: 'Lokaler Admin mit <code>secret</code> (nicht password)', c: n => GL(n, 'SW1', /^username \S+ (privilege \d+ )?secret /) },
      { t: 'SSH vorbereitet: Domain-Name und RSA-Schlüssel', c: n => GL(n, 'SW1', /^ip domain[- ]name /) && n.devs.SW1.cfg.rsa },
      { t: 'VTY: nur SSH, Login mit lokalem User', c: n => { const b = BL(n, 'SW1', 'line vty'); return BH(b, /^transport input ssh$/) && BH(b, /^login local$/); } },
      { t: 'Ungenutzte Ports Gi0/4–0/8 abgeschaltet', c: n => [4, 5, 6, 7, 8].every(k => IF(n, 'SW1', 'g0/' + k).shutdown) },
      { t: 'Gi0/1–0/3: fest Access, PortFast und BPDU Guard', c: n => [1, 2, 3].every(k => { const i = IF(n, 'SW1', 'g0/' + k); return i.modeSet && i.mode === 'access' && i.extra.includes('spanning-tree portfast') && i.extra.some(x => x.startsWith('spanning-tree bpduguard enable')); }) },
      { t: 'Clients funktionieren weiterhin', c: n => P(n, 'PC1', '192.168.1.12') && P(n, 'PC1', '192.168.1.13') }
    ],
    hints: ['Ist-Zustand: <code>show running-config</code>. Entfernen mit <code>no …</code>, z. B. <code>no enable password</code>.',
      'Lokaler User: <code>username admin privilege 15 secret …</code>.',
      'SSH braucht Hostname + <code>ip domain-name lab.local</code> + <code>crypto key generate rsa modulus 2048</code>.',
      'VTY: <code>line vty 0 4</code> → <code>transport input ssh</code> → <code>login local</code>.',
      'Ports: <code>spanning-tree portfast</code> und <code>spanning-tree bpduguard enable</code>.'],
    sol: { SW1: ['enable', 'configure terminal', 'no enable password', 'enable secret Str0ng!Pass', 'service password-encryption', 'username admin privilege 15 secret Adm1n!Pass', 'ip domain-name lab.local', 'crypto key generate rsa modulus 2048', 'line vty 0 4', 'transport input ssh', 'login local', 'no password', 'exit', 'interface range g0/4 - 8', 'shutdown', 'interface range g0/1 - 3', 'switchport mode access', 'spanning-tree portfast', 'spanning-tree bpduguard enable', 'end', 'write memory'] }
  });
  L.push({ id: 'quiz-sec', track: 'Security', title: 'Theorie: NAT, DMZ, Zero Trust', type: 'quiz', est: '5 min',
    intro: 'Architektur-Grundlagen, ohne die keine Firewall- oder NAC-Planung funktioniert.',
    qs: [
      { q: 'Was macht PAT (NAT Overload)?', o: ['Viele interne Adressen teilen sich eine öffentliche IP über Portnummern', 'Verschlüsselt Verkehr ins Internet', 'Ordnet jedem Client eine eigene öffentliche IP zu', 'Verteilt Last auf mehrere Server'], a: 0, e: 'Der Router merkt sich pro Verbindung den Quellport – so passen tausende Clients hinter eine IP.' },
      { q: 'Wofür ist eine DMZ gedacht?', o: ['Für Gäste-WLAN', 'Für aus dem Internet erreichbare Server, getrennt vom internen Netz', 'Für Backups', 'Für das Management-Netz'], a: 1, e: 'Wird ein Webserver kompromittiert, steht der Angreifer in der DMZ – nicht im LAN.' },
      { q: 'Was ist das Grundprinzip von Zero Trust?', o: ['Internes Netz ist vertrauenswürdig', 'Jeder Zugriff wird geprüft – unabhängig vom Netzstandort', 'Keine Passwörter mehr', 'Alle Ports sind geschlossen'], a: 1, e: '„Never trust, always verify“: Identität, Gerätezustand und Kontext entscheiden, nicht das VLAN.' },
      { q: 'Was zeichnet eine Stateful Firewall aus?', o: ['Sie prüft nur Ziel-Ports', 'Sie merkt sich Verbindungen und lässt Antworten automatisch zu', 'Sie arbeitet nur auf Layer 2', 'Sie entschlüsselt jeden TLS-Verkehr'], a: 1, e: 'Rückpakete einer erlaubten Verbindung brauchen keine eigene Regel.' },
      { q: 'Wogegen schützt DHCP Snooping?', o: ['Gegen Rogue-DHCP-Server im Access-Netz', 'Gegen DDoS aus dem Internet', 'Gegen VLAN-Hopping', 'Gegen schwache Passwörter'], a: 0, e: 'Nur „trusted“ Ports (Uplinks) dürfen DHCP-Offers senden.' },
      { q: 'Warum gilt EAP-TLS als sicherer als PEAP-MSCHAPv2?', o: ['Es ist schneller', 'Es nutzt Zertifikate statt Passwörter – nichts zum Abgreifen oder Erraten', 'Es braucht keinen RADIUS-Server', 'Es funktioniert ohne Switch-Konfiguration'], a: 1, e: 'Gegenseitige Zertifikats-Authentisierung verhindert Credential-Phishing über gefälschte Access Points.' }
    ] });

  // ---------------- Enterprise ----------------
  L.push({
    id: 'dot1x', track: 'Enterprise / NAC', title: 'NAC Teil 1: 802.1X und MAB am Switch', type: 'cli', est: '25 min',
    intro: 'Bevor Cisco ISE Entscheidungen treffen kann, muss der Access-Switch Anfragen per RADIUS schicken. Richte AAA, RADIUS und Port-Authentisierung ein.',
    devs: [sw('SW1', 400, 90), T.pc('ISE', 660, 90, '10.10.10.5', 24, null, { server: true, host: 'ISE', icon: 'ise' }), T.pc('PC1', 200, 300, '10.10.10.21', 24, null, {}), T.pc('PHONE', 400, 310, '10.10.10.22', 24, null, { icon: 'phone' }), T.pc('PRN', 600, 300, '10.10.10.23', 24, null, { icon: 'printer', host: 'PRINTER' })],
    links: [['SW1', 'g0/8', 'ISE', 'eth0'], ['PC1', 'eth0', 'SW1', 'g0/1'], ['PHONE', 'eth0', 'SW1', 'g0/2'], ['PRN', 'eth0', 'SW1', 'g0/3']],
    setup: { SW1: ['interface vlan 1', 'ip address 10.10.10.2 255.255.255.0', 'shutdown'] },
    tasks: [
      { t: 'Management-SVI aktiv, ISE (<code>10.10.10.5</code>) erreichbar', c: n => P(n, 'SW1', '10.10.10.5') },
      { t: 'AAA aktivieren', c: n => GL(n, 'SW1', /^aaa new-model$/) },
      { t: 'RADIUS-Server <code>ISE</code>: Adresse 10.10.10.5 (1812/1813) und Key', c: n => { const b = BL(n, 'SW1', 'radius server ise'); return BH(b, /^address ipv4 10\.10\.10\.5/) && BH(b, /^key \S+/); } },
      { t: 'AAA-Methoden: dot1x-Authentisierung und Network-Autorisierung über RADIUS', c: n => GL(n, 'SW1', /^aaa authentication dot1x default group radius/) && GL(n, 'SW1', /^aaa authorization network default group radius/) },
      { t: 'Accounting für dot1x (start-stop)', c: n => GL(n, 'SW1', /^aaa accounting dot1x default start-stop group radius/) },
      { t: '802.1X global einschalten', c: n => GL(n, 'SW1', /^dot1x system-auth-control$/) },
      { t: 'Gi0/1–0/3: Access, port-control auto, 802.1X-Authenticator und MAB', c: n => [1, 2, 3].every(k => { const i = IF(n, 'SW1', 'g0/' + k); const x = ext(i); return i.modeSet && i.mode === 'access' && x.includes('authentication port-control auto') && x.includes('dot1x pae authenticator') && x.includes('mab'); }) }
    ],
    hints: ['VLAN 1 ist ab Werk shutdown: <code>interface vlan 1</code> → <code>no shutdown</code>.',
      'RADIUS: <code>radius server ISE</code> → <code>address ipv4 10.10.10.5 auth-port 1812 acct-port 1813</code> → <code>key …</code>.',
      'AAA: <code>aaa authentication dot1x default group radius</code>, analog <code>aaa authorization network …</code> und <code>aaa accounting dot1x default start-stop group radius</code>.',
      'Port: <code>authentication port-control auto</code>, <code>dot1x pae authenticator</code>, <code>mab</code> (MAB für Geräte ohne Supplicant wie Drucker).'],
    sol: { SW1: ['enable', 'configure terminal', 'interface vlan 1', 'no shutdown', 'exit', 'aaa new-model', 'radius server ISE', 'address ipv4 10.10.10.5 auth-port 1812 acct-port 1813', 'key IseR4dius!', 'exit', 'aaa authentication dot1x default group radius', 'aaa authorization network default group radius', 'aaa accounting dot1x default start-stop group radius', 'dot1x system-auth-control', 'interface range g0/1 - 3', 'switchport mode access', 'authentication port-control auto', 'dot1x pae authenticator', 'mab', 'end'] }
  });
  L.push({ id: 'ise', track: 'Enterprise / NAC', title: 'NAC Teil 2: ISE Authorization Policy', type: 'ise', est: '15 min',
    intro: 'Der Switch fragt jetzt bei ISE an. Baue die Authorization Policy so, dass jedes Gerät genau den Zugriff bekommt, den es braucht. Regeln werden von oben nach unten geprüft – die erste passende gewinnt.' });
  L.push({ id: 'ssl', track: 'Enterprise / NAC', title: 'SSL/TLS-Inspection-Policy', type: 'ssl', est: '15 min',
    intro: 'Über 90 % des Web-Verkehrs ist verschlüsselt. Entscheide, was die Firewall aufbricht, was sie durchlässt und was sie blockiert – technisch und rechtlich sauber.' });
  L.push({
    id: 'vpn', track: 'Enterprise / NAC', title: 'Site-to-Site-VPN mit IKEv2 (VTI)', type: 'cli', est: '35 min',
    intro: 'Zentrale und Filiale sind übers Internet verbunden. Der ISP routet keine privaten Netze – baue einen IPsec-Tunnel mit IKEv2 und route die LANs hindurch.',
    devs: [T.pc('PCHQ', 70, 280, '10.1.0.10', 24, '10.1.0.1', { host: 'PC-HQ' }), rt('RHQ', 220, 130, 'R-HQ'), rt('ISP', 400, 130), rt('RBR', 580, 130, 'R-BR'), T.pc('PCBR', 730, 280, '10.2.0.10', 24, '10.2.0.1', { host: 'PC-BR' })],
    links: [['PCHQ', 'eth0', 'RHQ', 'g0/0'], ['RHQ', 'g0/1', 'ISP', 'g0/0'], ['ISP', 'g0/1', 'RBR', 'g0/1'], ['RBR', 'g0/0', 'PCBR', 'eth0']],
    setup: {
      RHQ: ['interface g0/0', 'ip address 10.1.0.1 255.255.255.0', 'no shutdown', 'interface g0/1', 'ip address 203.0.113.1 255.255.255.252', 'no shutdown', 'exit', 'ip route 0.0.0.0 0.0.0.0 203.0.113.2'],
      ISP: ['interface g0/0', 'ip address 203.0.113.2 255.255.255.252', 'no shutdown', 'interface g0/1', 'ip address 198.51.100.2 255.255.255.252', 'no shutdown'],
      RBR: ['interface g0/0', 'ip address 10.2.0.1 255.255.255.0', 'no shutdown', 'interface g0/1', 'ip address 198.51.100.1 255.255.255.252', 'no shutdown', 'exit', 'ip route 0.0.0.0 0.0.0.0 198.51.100.2']
    },
    tasks: [
      { t: 'Underlay: R-HQ erreicht R-BR (<code>198.51.100.1</code>)', c: n => P(n, 'RHQ', '198.51.100.1') },
      { t: 'Beide Router: IKEv2-Proposal und -Policy', c: n => ['RHQ', 'RBR'].every(r => N.blocks(n.devs[r], 'crypto ikev2 policy').some(b => b.lines.some(l => /^proposal /.test(l) && N.blk(n.devs[r], 'crypto ikev2 proposal', l.split(' ')[1])))) },
      { t: 'Beide Router: Keyring und IKEv2-Profil', c: n => ['RHQ', 'RBR'].every(r => N.blocks(n.devs[r], 'crypto ikev2 keyring').length && N.blocks(n.devs[r], 'crypto ikev2 profile').length) },
      { t: 'Beide Router: Transform-Set und IPsec-Profil', c: n => ['RHQ', 'RBR'].every(r => N.blocks(n.devs[r], 'crypto ipsec transform-set').length && N.blocks(n.devs[r], 'crypto ipsec profile').length) },
      { t: 'Tunnel0 im Modus IPsec (<code>172.16.0.1/30</code> ↔ <code>.2/30</code>) ist UP', c: n => IPM(IF(n, 'RHQ', 'tunnel0'), '172.16.0.1', 30) && IPM(IF(n, 'RBR', 'tunnel0'), '172.16.0.2', 30) && IF(n, 'RHQ', 'tunnel0').tmode === 'ipsec' && N.tunnel(n, 'RHQ', 'Tunnel0').up },
      { t: 'Routen zum jeweils anderen LAN über den Tunnel', c: n => { const ok = (r, ip, nh) => n.devs[r].cfg.routes.some(x => N.inNet(ip, x.net, x.mask) && x.net !== '0.0.0.0' && (x.ifn === 'Tunnel0' || x.nh === nh)); return ok('RHQ', '10.2.0.10', '172.16.0.2') && ok('RBR', '10.1.0.10', '172.16.0.1'); } },
      { t: 'PC-HQ ↔ PC-BR verschlüsselt erreichbar', c: n => P(n, 'PCHQ', '10.2.0.10') }
    ],
    hints: ['Reihenfolge: Proposal → Policy → Keyring → IKEv2-Profil → Transform-Set → IPsec-Profil → Tunnel → Routen.',
      'Proposal: <code>crypto ikev2 proposal P1</code> → <code>encryption aes-cbc-256</code>, <code>integrity sha256</code>, <code>group 14</code>. Policy: <code>crypto ikev2 policy POL</code> → <code>proposal P1</code>.',
      'Keyring: <code>crypto ikev2 keyring KR</code> → <code>peer BR</code> → <code>address 198.51.100.1</code> → <code>pre-shared-key …</code> (auf beiden Seiten gleich).',
      'Profil: <code>match identity remote address 198.51.100.1 255.255.255.255</code>, <code>authentication remote pre-share</code>, <code>authentication local pre-share</code>, <code>keyring local KR</code>.',
      'IPsec: <code>crypto ipsec transform-set TS esp-aes 256 esp-sha256-hmac</code>, dann <code>crypto ipsec profile IPS</code> → <code>set transform-set TS</code> → <code>set ikev2-profile …</code>.',
      'Tunnel: <code>tunnel source g0/1</code>, <code>tunnel destination …</code>, <code>tunnel mode ipsec ipv4</code>, <code>tunnel protection ipsec profile IPS</code>. Status: <code>show crypto session</code>.'],
    sol: (() => {
      const side = (peer, tip, lan) => ['enable', 'configure terminal', 'crypto ikev2 proposal PROP-AES256', 'encryption aes-cbc-256', 'integrity sha256', 'group 14', 'crypto ikev2 policy POL', 'proposal PROP-AES256',
        'crypto ikev2 keyring KR', 'peer SITE', 'address ' + peer, 'pre-shared-key Vpn!Lab2026', 'exit', 'crypto ikev2 profile IKE-PROF', 'match identity remote address ' + peer + ' 255.255.255.255', 'authentication remote pre-share', 'authentication local pre-share', 'keyring local KR',
        'crypto ipsec transform-set TS esp-aes 256 esp-sha256-hmac', 'mode tunnel', 'crypto ipsec profile IPSEC-PROF', 'set transform-set TS', 'set ikev2-profile IKE-PROF',
        'interface Tunnel0', 'ip address ' + tip + ' 255.255.255.252', 'tunnel source g0/1', 'tunnel destination ' + peer, 'tunnel mode ipsec ipv4', 'tunnel protection ipsec profile IPSEC-PROF', 'exit', 'ip route ' + lan + ' 255.255.255.0 Tunnel0', 'end'];
      return { RHQ: side('198.51.100.1', '172.16.0.1', '10.2.0.0'), RBR: side('203.0.113.1', '172.16.0.2', '10.1.0.0') };
    })()
  });

  // ---------------- Capstone ----------------
  L.push({
    id: 'capstone', track: 'Abschlussprojekt', title: 'Kompletter Standort von null', type: 'cli', est: '60 min',
    intro: 'Neuer Standort, leere Geräte. Baue VLANs, Trunks, Inter-VLAN-Routing, Management-Zugang und Gäste-Isolation – so, wie du es im echten Rollout tun würdest.',
    spec: [['VLAN', 'Name', 'Netz', 'Gateway'], ['10', 'STAFF', '192.168.10.0/24', '.1'], ['30', 'GUEST', '192.168.30.0/24', '.1'], ['50', 'SERVER', '10.50.0.0/24', '.1'], ['99', 'MGMT', '10.99.0.0/24', '.1 (SW-CORE .11, SW-ACC .12)']],
    devs: [T.pc('STAFF', 100, 330, '192.168.10.10', 24, '192.168.10.1'), T.pc('GUEST', 330, 330, '192.168.30.10', 24, '192.168.30.1'), sw('SWACC', 215, 190, 'SW-ACC'), sw('SWCORE', 480, 190, 'SW-CORE'), rt('REDGE', 480, 60, 'R-EDGE'),
      T.pc('SRV1', 700, 320, '10.50.0.10', 24, '10.50.0.1', { server: true }), T.pc('INET', 710, 60, '198.51.100.10', 24, '198.51.100.1', { server: true, host: 'INTERNET', icon: 'cloud' })],
    links: [['STAFF', 'eth0', 'SWACC', 'g0/1'], ['GUEST', 'eth0', 'SWACC', 'g0/2'], ['SWACC', 'g0/8', 'SWCORE', 'g0/7'], ['SWCORE', 'g0/8', 'REDGE', 'g0/0'], ['SWCORE', 'g0/1', 'SRV1', 'eth0'], ['REDGE', 'g0/1', 'INET', 'eth0']],
    tasks: [
      { t: 'VLANs 10 STAFF, 30 GUEST, 50 SERVER, 99 MGMT auf beiden Switches', c: n => ['SWACC', 'SWCORE'].every(s => VL(n, s, 10, 'STAFF') && VL(n, s, 30, 'GUEST') && VL(n, s, 50, 'SERVER') && VL(n, s, 99, 'MGMT')) },
      { t: 'Access-Ports: STAFF → 10, GUEST → 30, SRV1 → 50', c: n => ACC(n, 'SWACC', ['g0/1'], 10) && ACC(n, 'SWACC', ['g0/2'], 30) && ACC(n, 'SWCORE', ['g0/1'], 50) },
      { t: 'Trunks SW-ACC ↔ SW-CORE ↔ R-EDGE', c: n => TR(n, 'SWACC', 'g0/8') && TR(n, 'SWCORE', 'g0/7') && TR(n, 'SWCORE', 'g0/8') },
      { t: 'R-EDGE: Gateways aller VLANs und Internet-Uplink aktiv', c: n => P(n, 'REDGE', '198.51.100.10') && [['10', '192.168.10.1'], ['30', '192.168.30.1'], ['50', '10.50.0.1'], ['99', '10.99.0.1']].every(([v, ip]) => { const i = IF(n, 'REDGE', 'g0/0.' + v); return i && i.encap === +v && IPM(i, ip, 24) && N.ifUp(n, 'REDGE', 'GigabitEthernet0/0.' + v); }) },
      { t: 'Switch-Management über VLAN 99 aus dem Staff-Netz erreichbar', c: n => P(n, 'STAFF', '10.99.0.11') && P(n, 'STAFF', '10.99.0.12') },
      { t: 'Staff erreicht Server und Internet', c: n => P(n, 'STAFF', '10.50.0.10') && P(n, 'STAFF', '198.51.100.10') },
      { t: 'Gäste erreichen nur das Internet', c: n => P(n, 'GUEST', '198.51.100.10') && !P(n, 'GUEST', '10.50.0.10') && !P(n, 'GUEST', '192.168.10.10') && !P(n, 'GUEST', '10.99.0.12') },
      { t: 'Beide Switches nur per SSH administrierbar', c: n => ['SWACC', 'SWCORE'].every(s => BH(BL(n, s, 'line vty'), /^transport input ssh$/)) }
    ],
    hints: ['Arbeite von unten nach oben: VLANs → Access-Ports → Trunks → Router → Management → ACL.',
      'Switch-Management: <code>interface vlan 99</code> + IP + <code>ip default-gateway 10.99.0.1</code> (Switch routet nicht selbst).',
      'Alles im Blick: Der Ping-Debugger zeigt bei jedem fehlgeschlagenen Ping den Grund.'],
    sol: (() => {
      const vl = ['vlan 10', 'name STAFF', 'vlan 30', 'name GUEST', 'vlan 50', 'name SERVER', 'vlan 99', 'name MGMT'];
      return {
        SWACC: ['enable', 'configure terminal', ...vl, 'interface g0/1', 'switchport mode access', 'switchport access vlan 10', 'interface g0/2', 'switchport mode access', 'switchport access vlan 30', 'interface g0/8', 'switchport mode trunk', 'interface vlan 99', 'ip address 10.99.0.12 255.255.255.0', 'no shutdown', 'exit', 'ip default-gateway 10.99.0.1', 'line vty 0 4', 'transport input ssh', 'end'],
        SWCORE: ['enable', 'configure terminal', ...vl, 'interface g0/1', 'switchport mode access', 'switchport access vlan 50', 'interface range g0/7 - 8', 'switchport mode trunk', 'interface vlan 99', 'ip address 10.99.0.11 255.255.255.0', 'no shutdown', 'exit', 'ip default-gateway 10.99.0.1', 'line vty 0 4', 'transport input ssh', 'end'],
        REDGE: ['enable', 'configure terminal', 'interface g0/0', 'no shutdown', 'interface g0/0.10', 'encapsulation dot1Q 10', 'ip address 192.168.10.1 255.255.255.0', 'interface g0/0.30', 'encapsulation dot1Q 30', 'ip address 192.168.30.1 255.255.255.0', 'interface g0/0.50', 'encapsulation dot1Q 50', 'ip address 10.50.0.1 255.255.255.0', 'interface g0/0.99', 'encapsulation dot1Q 99', 'ip address 10.99.0.1 255.255.255.0', 'interface g0/1', 'ip address 198.51.100.1 255.255.255.0', 'no shutdown', 'exit',
          'access-list 130 deny ip 192.168.30.0 0.0.0.255 10.0.0.0 0.255.255.255', 'access-list 130 deny ip 192.168.30.0 0.0.0.255 192.168.10.0 0.0.0.255', 'access-list 130 permit ip any any', 'interface g0/0.30', 'ip access-group 130 in', 'end']
      };
    })()
  });

  // ---------------- builder labs (pure logic) ----------------
  const ISE = {
    opts: { m: ['Beliebig', '802.1X', 'MAB'], g: ['Beliebig', 'Employees', 'Contractors'], p: ['Beliebig', 'Windows-Workstation', 'Cisco-IP-Phone', 'Printer', 'Unknown'], s: ['Beliebig', 'Compliant', 'NonCompliant', 'Unknown'],
      r: ['Employee-Access (VLAN 10)', 'Contractor-Internet-Only', 'Voice-VLAN', 'Printer-dACL', 'Quarantine-Remediation', 'Guest-Redirect (CWA)', 'PermitAccess (Vollzugriff)', 'DenyAccess'] },
    eps: [
      { n: 'Anna – Firmen-Laptop', m: '802.1X', g: 'Employees', p: 'Windows-Workstation', s: 'Compliant', x: 'Employee-Access (VLAN 10)', why: 'Mitarbeiterin mit gesundem Gerät: volles Arbeitsnetz.' },
      { n: 'Ben – Laptop ohne aktuelle Updates', m: '802.1X', g: 'Employees', p: 'Windows-Workstation', s: 'NonCompliant', x: 'Quarantine-Remediation', why: 'Posture fehlgeschlagen: nur Zugriff auf Update-Server, bis das Gerät gesund ist. Diese Regel muss <i>vor</i> der allgemeinen Mitarbeiter-Regel stehen.' },
      { n: 'Clara – externe Beraterin', m: '802.1X', g: 'Contractors', p: 'Windows-Workstation', s: 'Compliant', x: 'Contractor-Internet-Only', why: 'Externe bekommen nur Internet, keine internen Systeme.' },
      { n: 'IP-Telefon Empfang', m: 'MAB', g: '–', p: 'Cisco-IP-Phone', s: 'Unknown', x: 'Voice-VLAN', why: 'Telefone können kein 802.1X → MAB + Profiling erkennt sie.' },
      { n: 'Drucker 2. OG', m: 'MAB', g: '–', p: 'Printer', s: 'Unknown', x: 'Printer-dACL', why: 'Drucker nur mit dACL: Druck-Ports, sonst nichts.' },
      { n: 'Besucher-Smartphone', m: 'MAB', g: '–', p: 'Unknown', s: 'Unknown', x: 'Guest-Redirect (CWA)', why: 'Unbekanntes Gerät → Gästeportal (Central Web Auth).' }
    ],
    init: () => ({ rules: [{ m: 'Beliebig', g: 'Employees', p: 'Beliebig', s: 'Beliebig', r: 'Employee-Access (VLAN 10)' }], def: 'PermitAccess (Vollzugriff)' }),
    eval(st, e) {
      for (let i = 0; i < st.rules.length; i++) { const r = st.rules[i]; const ok = k => r[k] === 'Beliebig' || r[k] === e[k]; if (ok('m') && ok('g') && ok('p') && ok('s')) return { idx: i, r: r.r }; }
      return { idx: -1, r: st.def };
    },
    tasks(st) { return ISE.eps.map(e => { const res = ISE.eval(st, e); return { t: e.n + ' → <b>' + e.x + '</b>', ok: res.r === e.x, got: res }; }).concat([{ t: 'Standardregel gewährt keinen Vollzugriff', ok: !['PermitAccess (Vollzugriff)', 'Employee-Access (VLAN 10)'].includes(st.def) }]); }
  };
  const SSL = {
    opts: { c: ['Beliebig', 'Finanzen', 'Gesundheit', 'Software-Updates', 'Social-Media', 'Malware', 'Nachrichten', 'Nicht kategorisiert'], a: ['Entschlüsseln', 'Nicht entschlüsseln', 'Blockieren'] },
    flows: [
      { n: 'Online-Banking', c: 'Finanzen', x: 'Nicht entschlüsseln', bad: 'Bankdaten im Klartext auf der Firewall – Datenschutz und Betriebsrat sagen nein.' },
      { n: 'Portal der Arztpraxis', c: 'Gesundheit', x: 'Nicht entschlüsseln', bad: 'Gesundheitsdaten sind besonders geschützt (Art. 9 DSGVO).' },
      { n: 'Windows Update', c: 'Software-Updates', x: 'Nicht entschlüsseln', bad: 'Certificate Pinning: Das Update bricht mit Zertifikatsfehler ab.' },
      { n: 'Social-Media-Feed', c: 'Social-Media', x: 'Entschlüsseln', bad: 'Häufiger Phishing- und Malware-Vektor bleibt ungeprüft.' },
      { n: 'Unbekannte Download-Seite', c: 'Nicht kategorisiert', x: 'Entschlüsseln', bad: 'Unkategorisierte Seiten sind riskant – Downloads bleiben unsichtbar.' },
      { n: 'Bekannter Malware-C2-Server', c: 'Malware', x: 'Blockieren', bad: 'Kommunikation zum Command-and-Control-Server muss gestoppt werden.' },
      { n: 'Nachrichtenportal', c: 'Nachrichten', x: 'Entschlüsseln', bad: 'Auch seriöse Seiten liefern Malvertising aus – prüfen.' }
    ],
    init: () => ({ rules: [{ c: 'Beliebig', a: 'Entschlüsseln' }], def: 'Nicht entschlüsseln', ca: false }),
    eval(st, f) { for (let i = 0; i < st.rules.length; i++) { const r = st.rules[i]; if (r.c === 'Beliebig' || r.c === f.c) return { idx: i, a: r.a }; } return { idx: -1, a: st.def }; },
    tasks(st) {
      return [{ t: 'Firmen-Root-CA auf allen Clients verteilt', ok: st.ca }].concat(SSL.flows.map(f => { const r = SSL.eval(st, f); let ok = r.a === f.x; let note = ok ? '' : f.bad; if (ok && r.a === 'Entschlüsseln' && !st.ca) { ok = false; note = 'Clients vertrauen der Firewall-CA nicht → Zertifikatswarnung im Browser.'; } return { t: f.n + ' → <b>' + f.x + '</b>', ok, got: r, note }; }));
    }
  };

  // ---------------- subnetting generator ----------------
  function subnetQ() {
    const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
    const bases = [() => `192.168.${rnd(0, 255)}.${rnd(1, 254)}`, () => `10.${rnd(0, 255)}.${rnd(0, 255)}.${rnd(1, 254)}`, () => `172.${rnd(16, 31)}.${rnd(0, 255)}.${rnd(1, 254)}`];
    const type = rnd(0, 6); const len = type === 6 ? 0 : rnd(18, 30); const ip = bases[rnd(0, 2)]();
    const m = N.lenMask(len), nw = N.netN(ip, m), bc = (nw | (~N.ip2n(m) >>> 0)) >>> 0, hosts = Math.pow(2, 32 - len) - 2;
    const bs = Math.pow(2, 8 - (len % 8));
    const way = `/${len} → Maske ${m}. ` + (len % 8 ? `Blockgröße im ${Math.ceil(len / 8)}. Oktett: 256 − ${256 - bs} = ${bs}` : 'Die Maske endet genau an einer Oktett-Grenze') + ` → Netz ${N.n2ip(nw)}, Broadcast ${N.n2ip(bc)}, Hosts ${N.n2ip(nw + 1)}–${N.n2ip(bc - 1)} (${hosts} nutzbar).`;
    switch (type) {
      case 0: return { q: `Netzadresse von <code>${ip}/${len}</code>?`, a: N.n2ip(nw), way };
      case 1: return { q: `Broadcast-Adresse von <code>${ip}/${len}</code>?`, a: N.n2ip(bc), way };
      case 2: return { q: `Wie viele nutzbare Hosts hat ein <code>/${len}</code>?`, a: String(hosts), way: `2^(32−${len}) − 2 = ${hosts}. Netz- und Broadcast-Adresse sind nicht nutzbar.` };
      case 3: return { q: `Erste nutzbare Host-Adresse in <code>${ip}/${len}</code>?`, a: N.n2ip(nw + 1), way };
      case 4: return { q: `Letzte nutzbare Host-Adresse in <code>${ip}/${len}</code>?`, a: N.n2ip(bc - 1), way };
      case 5: return { q: `Subnetzmaske (dezimal) für <code>/${len}</code>?`, a: m, way: `${len} Einsen von links: ${m}.` };
      default: { const h = rnd(5, 2000); let l = 30; while (Math.pow(2, 32 - l) - 2 < h) l--; return { q: `Kleinstes Präfix für ein Netz mit <b>${h}</b> Hosts? (Antwort z. B. <code>/24</code>)`, a: '/' + l, way: `2^${32 - l} − 2 = ${Math.pow(2, 32 - l) - 2} ≥ ${h}, aber 2^${31 - l} − 2 = ${Math.pow(2, 31 - l) - 2} reicht nicht → /${l}.` }; }
    }
  }

  return { list: L, build, ISE, SSL, subnetQ };
})();
if (typeof module !== 'undefined') module.exports = LABS;
