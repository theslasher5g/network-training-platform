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
  function deleteLun(d, id) { const S = st(d); S.luns = S.luns.filter(l => l.id !== id); return { ok: true }; }
  function maskLun(d, id, hostId, on) { const l = st(d).luns.find(x => x.id === id); if (!l) return { err: 'LUN nicht gefunden.' }; l.hosts = l.hosts.filter(h => h !== hostId); if (on) l.hosts.push(hostId); return { ok: true }; }

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
      for (const l of sto.stor.luns) if (l.hosts.includes(host.id)) res.push({ sto: sto.id, stoName: sto.cfg.hostname, lun: l.id, name: l.name, gb: l.gb, thin: l.thin, paths: mine });
    }
    return res.sort((a, b) => (a.sto + a.lun).localeCompare(b.sto + b.lun, 'de', { numeric: true }));
  }
  // Erklärung, warum eine maskierte LUN nicht sichtbar ist
  function why(net, host, sto, lun) {
    const l = sto.stor && sto.stor.luns.find(x => x.id === lun); if (!l) return 'LUN existiert nicht.';
    if (!l.hosts.includes(host.id)) return `LUN-Masking: ${l.name} ist nicht für ${host.cfg.hostname} freigegeben.`;
    const hs = fcPorts(host); if (!hs.length) return `${host.cfg.hostname} hat keinen FC-Port (HBA fehlt).`;
    if (!hs.some(p => N.portStatus(net, host.id, p).st === 'connected')) return `Kein FC-Link am HBA von ${host.cfg.hostname}: Kabel, Transceiver und Port prüfen.`;
    if (!paths(net, host).some(p => p.sto === sto.id)) return `Kein Pfad von ${host.cfg.hostname} zu ${sto.cfg.hostname}: Zoning (aktives Zoneset mit Initiator und Target) oder Storage-Verkabelung prüfen.`;
    return null;
  }
  return { RAID, DISKS, st, poolInfo, createPool, deletePool, createLun, deleteLun, maskLun, zs, zoneAdd, zoneDel, zoneActive, autoZones, attached, zoned, paths, hostLuns, why, lunAlloc, lunSize, poolOf };
})();
if (typeof module !== 'undefined') module.exports = STOR;
