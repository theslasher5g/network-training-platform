// ===================== NetLab Storage-Modell =====================
// Pools (RAID), LUNs, LUN-Masking (Storage) und Zoning (FC-Switch). Reine Logik auf dem Netz-JSON.
const STOR = (function () {
  const N = typeof NL !== 'undefined' ? NL : require('./engine.js');
  const RAID = {
    raid0: { name: 'RAID 0', min: 2, fault: 0, usable: n => n, note: 'Striping, keine Ausfallsicherheit' },
    raid1: { name: 'RAID 1', min: 2, even: true, fault: 1, usable: n => n / 2, note: 'Spiegel' },
    raid5: { name: 'RAID 5', min: 3, fault: 1, usable: n => n - 1, note: 'eine Parität, 1 Platte darf ausfallen' },
    raid6: { name: 'RAID 6', min: 4, fault: 2, usable: n => n - 2, note: 'zwei Paritäten, 2 Platten dürfen ausfallen' },
    raid10: { name: 'RAID 10', min: 4, even: true, fault: 1, usable: n => n / 2, note: 'Spiegel mit Striping, je Spiegel 1 Platte' }
  };
  const DISKS = [600, 1200, 1800, 3840];
  const THIN_INITIAL = 0.1;

  const st = d => d.stor || (d.stor = { pools: [], luns: [], seq: 0 });
  const poolOf = (d, name) => st(d).pools.find(p => p.name === name);
  const lunSize = l => l.gb;
  const lunAlloc = l => l.thin ? Math.ceil(l.gb * THIN_INITIAL) : l.gb;
  function poolInfo(d, p) {
    const r = RAID[p.raid], raw = p.disks * p.diskGb, usable = r.usable(p.disks) * p.diskGb;
    const luns = st(d).luns.filter(l => l.pool === p.name), alloc = luns.reduce((s, l) => s + lunAlloc(l), 0), prov = luns.reduce((s, l) => s + l.gb, 0);
    return { raw, usable, alloc, free: usable - alloc, prov, over: prov > usable, fault: r.fault, luns };
  }
  function createPool(d, o) {
    const S = st(d), name = String(o.name || '').trim(), r = RAID[o.raid], n = +o.disks, gb = +o.diskGb;
    if (!/^[A-Za-z][\w-]{0,23}$/.test(name)) return { err: 'Poolname: Buchstaben, Ziffern, - und _ (max. 24 Zeichen, beginnt mit Buchstabe).' };
    if (S.pools.some(p => p.name === name)) return { err: `Einen Pool „${name}“ gibt es schon.` };
    if (!r) return { err: 'Unbekannter RAID-Level.' };
    if (!(n >= r.min)) return { err: `${r.name} braucht mindestens ${r.min} Platten.` };
    if (r.even && n % 2) return { err: `${r.name} braucht eine gerade Plattenzahl.` };
    if (n > 24) return { err: 'Höchstens 24 Platten pro Pool.' };
    if (!DISKS.includes(gb)) return { err: 'Unbekannte Plattengröße.' };
    S.pools.push({ name, raid: o.raid, disks: n, diskGb: gb }); return { ok: true };
  }
  function deletePool(d, name) { const S = st(d); if (S.luns.some(l => l.pool === name)) return { err: `Im Pool „${name}“ liegen noch LUNs. Erst die LUNs löschen.` }; S.pools = S.pools.filter(p => p.name !== name); return { ok: true }; }
  function createLun(d, o) {
    const S = st(d), name = String(o.name || '').trim(), p = poolOf(d, o.pool), gb = Math.round(+o.gb);
    if (!/^[A-Za-z][\w-]{0,23}$/.test(name)) return { err: 'LUN-Name: Buchstaben, Ziffern, - und _ (max. 24 Zeichen).' };
    if (S.luns.some(l => l.name === name)) return { err: `Eine LUN „${name}“ gibt es schon.` };
    if (!p) return { err: 'Wähle einen Pool (erst einen Pool anlegen).' };
    if (!(gb >= 1 && gb <= 100000)) return { err: 'Größe in GB zwischen 1 und 100000.' };
    const need = o.thin ? Math.ceil(gb * THIN_INITIAL) : gb, info = poolInfo(d, p);
    if (need > info.free) return { err: `Im Pool „${p.name}“ sind nur ${info.free} GB frei, die LUN braucht ${need} GB${o.thin ? ' (Thin: Startbelegung)' : ''}. Pool erweitern oder LUN kleiner wählen.` };
    const id = S.seq++; S.luns.push({ id, name, pool: p.name, gb, thin: !!o.thin, hosts: [] }); return { ok: true, id };
  }
  function deleteLun(d, id) { const S = st(d); const l0 = S.luns.find(x => x.id === id); if (l0 && l0.hm) return { err: `Die LUN „${l0.name}“ gehört zu einem HyperMetro-Paar. Löse erst das Paar auf.` }; S.luns = S.luns.filter(l => l.id !== id); return { ok: true }; }
  function maskLun(d, id, hostId, on, net) {
    const l = st(d).luns.find(x => x.id === id); if (!l) return { err: 'LUN nicht gefunden.' }; l.hosts = l.hosts.filter(h => h !== hostId); if (on) l.hosts.push(hostId);
    if (l.hm && net && net.devs[l.hm.peer]) { const r = st(net.devs[l.hm.peer]).luns.find(x => x.id === l.hm.peerLun); if (r) { r.hosts = r.hosts.filter(h => h !== hostId); if (on) r.hosts.push(hostId); } }
    return { ok: true };
  }

  // ----- Zoning (FC-Switch) -----
  const zs = m => m.zset || (m.zset = { zones: [], active: false });
  const fcPorts = d => d.ports.filter(p => d.pk[p] === 'fc');
  function zoneAdd(m, name, members) {
    const Z = zs(m); name = String(name || '').trim();
    if (!/^[A-Za-z][\w-]{0,40}$/.test(name)) return { err: 'Zonenname: Buchstaben, Ziffern, - und _ .' };
    if (Z.zones.some(z => z.name === name)) return { err: `Eine Zone „${name}“ gibt es schon.` };
    const mem = [...new Set((members || []).filter(Boolean))]; if (mem.length < 2) return { err: 'Eine Zone braucht mindestens zwei verschiedene Mitglieder.' };
    Z.zones.push({ name, members: mem }); return { ok: true };
  }
  function zoneDel(m, name) { const Z = zs(m); Z.zones = Z.zones.filter(z => z.name !== name); return { ok: true }; }
  function zoneActive(m, on) { const Z = zs(m); if (on && !Z.zones.length) return { err: 'Es gibt noch keine Zonen, die ein Zoneset aktivieren könnte.' }; Z.active = !!on; return { ok: true }; }
  // Mitglieder: WWPNs aller FC-Geräte-Ports, die an diesem Switch hängen
  function attached(net, m) {
    const out = [];
    for (const p of m.ports) { const s = N.portStatus(net, m.id, p); if (s.st !== 'connected') continue; const pd = net.devs[s.peer.dev]; if (pd && (pd.type === 'server' || pd.type === 'storage')) out.push({ swPort: p, dev: pd, port: s.peer.port, wwpn: N.wwpn(pd, s.peer.port), role: pd.type === 'server' ? 'initiator' : 'target' }); }
    return out;
  }
  function autoZones(net, m) {
    const a = attached(net, m), ini = a.filter(x => x.role === 'initiator'), tgt = a.filter(x => x.role === 'target'), Z = zs(m); let n = 0;
    for (const i of ini) for (const t of tgt) {
      if (Z.zones.some(z => z.members.includes(i.wwpn) && z.members.includes(t.wwpn))) continue;
      const nm = (`${i.dev.cfg.hostname}_${i.port}__${t.dev.cfg.hostname}_${t.port}`).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40); let k = nm, c = 2; while (Z.zones.some(z => z.name === k)) k = nm + '_' + c++;
      Z.zones.push({ name: k, members: [i.wwpn, t.wwpn] }); n++;
    }
    return { ok: true, n };
  }
  const zoned = (m, a, b) => { const Z = zs(m); return Z.active && Z.zones.some(z => z.members.includes(a) && z.members.includes(b)); };


  // ----- HyperMetro: aktiv-aktiv-Cluster aus zwei Arrays mit Quorum-Server -----
  const QPKG = 'quorum-server';
  const hmOf = d => (d && d.stor && d.stor.hm) || null;
  const ipOf = d => { for (const p of d.ports) { const h = N.hip(d, p); if (h && h.ip) return h.ip; } return null; };
  function quorumState(net, q) {
    if (!q || q.type !== 'server') return { ok: false, why: 'Der Quorum-Server existiert nicht mehr.' };
    if (N.isDown(q)) return { ok: false, why: `${q.cfg.hostname} ist ausgeschaltet.` };
    const L = q.lx; if (!L || !L.pkgs.includes(QPKG)) return { ok: false, why: `Auf ${q.cfg.hostname} ist das Paket ${QPKG} nicht installiert (apt install ${QPKG}).` };
    const u = L.units[QPKG]; if (!u || !u.active) return { ok: false, why: `Der Dienst ${QPKG} läuft auf ${q.cfg.hostname} nicht (systemctl enable --now ${QPKG}).` };
    return { ok: true };
  }
  function quorumReach(net, a, dm) {
    const q = net.devs[dm.quorum], s = quorumState(net, q); if (!s.ok) return s;
    if (N.isDown(a)) return { ok: false, why: `${a.cfg.hostname} ist ausgeschaltet.` };
    const ip = ipOf(q); if (!ip) return { ok: false, why: `${q.cfg.hostname} hat keine IP-Adresse.` };
    const r = N.ping(net, a.id, ip); return r.ok ? { ok: true } : { ok: false, why: `${a.cfg.hostname} erreicht den Quorum-Server ${ip} nicht: ${r.reason}` };
  }
  // Replikationsverbindung: direktes FC-Kabel oder gemeinsamer FC-Switch mit aktiver Zone zwischen beiden Arrays
  function replLink(net, a, b) {
    const dn = [a, b].find(x => N.isDown(x)); if (dn) return { ok: false, why: `${dn.cfg.hostname} ist ausgeschaltet.` };
    for (const p of fcPorts(a)) { const s = N.portStatus(net, a.id, p); if (s.st === 'connected' && s.peer.dev === b.id) return { ok: true, via: 'direktes FC-Kabel' }; }
    let seen = false;
    for (const m of Object.values(net.devs)) {
      if (m.type !== 'fc') continue; const at = attached(net, m), wa = at.filter(x => x.dev.id === a.id), wb = at.filter(x => x.dev.id === b.id); if (!wa.length || !wb.length) continue; seen = true;
      if (wa.some(x => wb.some(y => zoned(m, x.wwpn, y.wwpn)))) return { ok: true, via: m.cfg.hostname };
    }
    return { ok: false, why: seen ? 'Beide Arrays hängen am selben FC-Switch, aber es gibt keine aktive Zone zwischen ihnen (Replikationszone, Zoneset aktivieren).' : 'Keine FC-Verbindung zwischen den Arrays (direkt oder über einen gemeinsamen FC-Switch).' };
  }
  // Arbitrierung: wer darf Schreibzugriffe bedienen?
  function hmState(net, a) {
    const dm = hmOf(a); if (!dm) return null; const b = net.devs[dm.peer], up = x => !N.isDown(x);
    const link = replLink(net, a, b), qa = quorumReach(net, a, dm), qb = quorumReach(net, b, dm), A = { id: a.id, up: up(a), q: qa, active: false }, B = { id: b.id, up: up(b), q: qb, active: false };
    let mode, text;
    if (A.up && B.up && link.ok) { A.active = B.active = true; mode = 'normal'; text = 'Beide Arrays sind verbunden und bedienen alle Hosts gleichzeitig (aktiv-aktiv).'; }
    else {
      const cA = A.up && qa.ok, cB = B.up && qb.ok, pref = net.devs[dm.preferred] || a; let win = null, how = '';
      if (cA && cB) { win = pref.id; how = `Beide erreichen den Quorum-Server, die Verbindung zwischen den Arrays ist aber unterbrochen: Der bevorzugte Standort ${pref.cfg.hostname} gewinnt.`; }
      else if (cA || cB) { win = (cA ? a : b).id; how = `Nur ${(cA ? a : b).cfg.hostname} erreicht den Quorum-Server und gewinnt die Arbitrierung.`; }
      else if (dm.staticFallback && up(pref)) { win = pref.id; how = `Kein Array erreicht den Quorum-Server: Fallback „statische Priorität“, der bevorzugte Standort ${pref.cfg.hostname} läuft weiter.`; }
      A.active = win === a.id; B.active = win === b.id;
      mode = win ? (A.up && B.up ? 'split' : 'failover') : 'stopped';
      text = win ? how : (dm.staticFallback ? 'Kein Array darf weiterarbeiten: Der bevorzugte Standort ist ausgefallen und der Quorum-Server ist nicht erreichbar.' : 'Kein Array erreicht den Quorum-Server und die statische Priorität ist aus: Beide Seiten stoppen, um Split-Brain zu verhindern. Die Hosts verlieren den Zugriff.');
    }
    return { a: A, b: B, link, mode, text, preferred: dm.preferred };
  }
  const hmActive = (net, sto) => { const s = hmState(net, sto); return !s || (s.a.id === sto.id ? s.a : s.b).active; };
  function hmCreate(net, a, b, o) {
    const q = net.devs[o.quorum], name = String(o.name || '').trim();
    if (!b || b.type !== 'storage' || b.id === a.id) return { err: 'Wähle ein zweites Storage-System als Partner.' };
    if (hmOf(a) || hmOf(b)) return { err: 'Eines der Arrays gehört schon zu einer HyperMetro-Domäne.' };
    if (!q || q.type !== 'server') return { err: 'Wähle einen Server als Quorum-Server (ein dritter Standort).' };
    if (!/^[A-Za-z][\w-]{0,23}$/.test(name)) return { err: 'Domänenname: Buchstaben, Ziffern, - und _ .' };
    const pref = o.preferred === 'remote' ? b.id : a.id, mk = peer => ({ name, peer, quorum: q.id, preferred: pref, staticFallback: !!o.staticFallback, pairs: [] });
    st(a).hm = mk(b.id); st(b).hm = mk(a.id); return { ok: true };
  }
  function hmSet(net, a, o) { const dm = hmOf(a), b = dm && net.devs[dm.peer]; if (!dm) return { err: 'Keine HyperMetro-Domäne.' }; for (const x of [dm, hmOf(b)]) { if (o.preferred) x.preferred = o.preferred; if (o.staticFallback !== undefined) x.staticFallback = !!o.staticFallback; if (o.quorum) x.quorum = o.quorum; } return { ok: true }; }
  function hmDelete(net, a) { const dm = hmOf(a); if (!dm) return { ok: true }; if (dm.pairs.length) return { err: 'In der Domäne gibt es noch HyperMetro-Paare. Löse sie zuerst auf.' }; const b = net.devs[dm.peer]; delete st(a).hm; if (b && b.stor) delete b.stor.hm; return { ok: true }; }
  function hmPairCreate(net, a, o) {
    const dm = hmOf(a); if (!dm) return { err: 'Erst eine HyperMetro-Domäne anlegen.' }; const b = net.devs[dm.peer], l = st(a).luns.find(x => x.id === +o.lun);
    if (!l) return { err: 'Wähle eine LUN.' }; if (l.hm) return { err: `Die LUN „${l.name}“ ist schon in einem Paar.` };
    const p = poolOf(b, o.pool); if (!p) return { err: `Wähle einen Pool auf ${b.cfg.hostname} für die Partner-LUN (dort erst einen Pool anlegen).` };
    let nm = l.name; if (st(b).luns.some(x => x.name === nm)) nm = (l.name + '_HM').slice(0, 24);
    const r = createLun(b, { name: nm, pool: o.pool, gb: l.gb, thin: l.thin }); if (r.err) return { err: `Partner-LUN auf ${b.cfg.hostname}: ${r.err}` };
    const rl = st(b).luns.find(x => x.id === r.id), pid = 'hm' + (st(a).seq + '_' + r.id);
    l.hm = { pair: pid, peer: b.id, peerLun: rl.id, canon: true }; rl.hm = { pair: pid, peer: a.id, peerLun: l.id, canon: false }; rl.hosts = l.hosts.slice();
    dm.pairs.push(pid); hmOf(b).pairs.push(pid); return { ok: true };
  }
  function hmPairDelete(net, a, lunId) {
    const l = st(a).luns.find(x => x.id === +lunId); if (!l || !l.hm) return { err: 'Das ist kein HyperMetro-Paar.' }; const b = net.devs[l.hm.peer], pid = l.hm.pair;
    if (b && b.stor) { b.stor.luns = b.stor.luns.filter(x => x.id !== l.hm.peerLun); if (b.stor.hm) b.stor.hm.pairs = b.stor.hm.pairs.filter(x => x !== pid); }
    const dm = hmOf(a); if (dm) dm.pairs = dm.pairs.filter(x => x !== pid); delete l.hm; return { ok: true };
  }
  // Replikationszonen: je ein Eintrag zwischen den Ports der beiden Arrays am selben FC-Switch
  function hmAutoZone(net, a) {
    const dm = hmOf(a), b = dm && net.devs[dm.peer]; if (!b) return { n: 0 }; let n = 0;
    for (const m of Object.values(net.devs)) {
      if (m.type !== 'fc') continue; const at = attached(net, m), wa = at.filter(x => x.dev.id === a.id), wb = at.filter(x => x.dev.id === b.id), Z = zs(m);
      for (const x of wa) for (const y of wb) { if (Z.zones.some(z => z.members.includes(x.wwpn) && z.members.includes(y.wwpn))) continue; const nm = `REPL_${a.cfg.hostname}_${x.port}__${b.cfg.hostname}_${y.port}`.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40); let k = nm, c = 2; while (Z.zones.some(z => z.name === k)) k = nm + '_' + c++; Z.zones.push({ name: k, members: [x.wwpn, y.wwpn] }); n++; }
    }
    return { n };
  }

  // ----- Pfade und Sichtbarkeit -----
  function paths(net, host) {
    const out = [];
    for (const hp of fcPorts(host)) {
      const s = N.portStatus(net, host.id, hp); if (s.st !== 'connected') continue; const pd = net.devs[s.peer.dev]; if (!pd) continue;
      if (pd.type === 'storage') { out.push({ hp, sto: pd.id, sp: s.peer.port, ctl: s.peer.port[0], sw: null }); continue; }
      if (pd.type !== 'fc') continue;
      for (const q of fcPorts(pd)) {
        if (q === s.peer.port) continue; const t = N.portStatus(net, pd.id, q); if (t.st !== 'connected') continue; const td = net.devs[t.peer.dev]; if (!td || td.type !== 'storage') continue;
        if (!zoned(pd, N.wwpn(host, hp), N.wwpn(td, t.peer.port))) continue;
        out.push({ hp, sto: td.id, sp: t.peer.port, ctl: t.peer.port[0], sw: pd.id });
      }
    }
    return out;
  }
  function hostLuns(net, host) {
    const P = paths(net, host), res = [];
    for (const sto of Object.values(net.devs)) {
      if (sto.type !== 'storage' || !sto.stor) continue;
      const mine = P.filter(p => p.sto === sto.id); if (!mine.length) continue;
      for (const l of sto.stor.luns) if (l.hosts.includes(host.id)) {
        if (l.hm && !hmActive(net, sto)) continue; // Standby-Seite: Pfade nicht nutzbar
        res.push({ sto: sto.id, stoName: sto.cfg.hostname, lun: l.id, name: l.name, gb: l.gb, thin: l.thin, paths: mine, hm: l.hm ? { pair: l.hm.pair, canon: l.hm.canon, peer: l.hm.peer, peerLun: l.hm.peerLun } : null });
      }
    }
    // HyperMetro-Paare erscheinen als ein einziges Gerät mit Pfaden zu beiden Arrays (gleiche Identität, Failover ohne neue Platte)
    const merged = [], byPair = {};
    for (const r of res) {
      if (!r.hm) { merged.push(r); continue; }
      const k = r.hm.pair, ex = byPair[k]; if (ex) { ex.paths = ex.paths.concat(r.paths); if (r.hm.canon) { ex.sto = r.sto; ex.stoName = r.stoName; ex.lun = r.lun; ex.name = r.name; } continue; }
      const row = Object.assign({}, r, { paths: r.paths.slice() }); byPair[k] = row; merged.push(row);
    }
    for (const r of merged) if (r.hm && !r.hm.canon) { r.sto = r.hm.peer; r.lun = r.hm.peerLun; const ps = net.devs[r.sto]; if (ps) r.stoName = ps.cfg.hostname; }
    return merged.sort((a, b) => (a.sto + a.lun).localeCompare(b.sto + b.lun, 'de', { numeric: true }));
  }
  // Erklärung, warum eine maskierte LUN nicht sichtbar ist
  function why(net, host, sto, lun) {
    const l = sto.stor && sto.stor.luns.find(x => x.id === lun); if (!l) return 'LUN existiert nicht.';
    if (!l.hosts.includes(host.id)) return `LUN-Masking: ${l.name} ist nicht für ${host.cfg.hostname} freigegeben.`;
    const hs = fcPorts(host); if (!hs.length) return `${host.cfg.hostname} hat keinen FC-Port (HBA fehlt).`;
    if (!hs.some(p => N.portStatus(net, host.id, p).st === 'connected')) return `Kein FC-Link am HBA von ${host.cfg.hostname}: Kabel, Transceiver und Port prüfen.`;
    if (!paths(net, host).some(p => p.sto === sto.id)) return `Kein Pfad von ${host.cfg.hostname} zu ${sto.cfg.hostname}: Zoning (aktives Zoneset mit Initiator und Target) oder Storage-Verkabelung prüfen.`;
    if (l.hm && !hmActive(net, sto)) { const h = hmState(net, sto); return `HyperMetro: ${sto.cfg.hostname} ist im Standby. ${h.text}`; }
    return null;
  }
  return { hm: hmOf, hmState, hmActive, hmCreate, hmSet, hmDelete, hmPairCreate, hmPairDelete, hmAutoZone, replLink, quorumState, quorumReach, QPKG, ipOf, RAID, DISKS, st, poolInfo, createPool, deletePool, createLun, deleteLun, maskLun, zs, zoneAdd, zoneDel, zoneActive, autoZones, attached, zoned, paths, hostLuns, why, lunAlloc, lunSize, poolOf };
})();
if (typeof module !== 'undefined') module.exports = STOR;
