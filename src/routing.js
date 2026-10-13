// ===================== NetLab Routing-Protokolle: OSPF, EIGRP, BGP =====================
// Berechnet dynamische Routen aus der Konfiguration (router ospf/eigrp/bgp) und der Verkabelung.
// Der Engine-Kern fragt über den Hook "dyn" nach diesen Routen und über "show" nach den Anzeigebefehlen.
const RTG = (function () {
  const N = typeof NL !== 'undefined' ? NL : require('./engine.js');
  const { inNet, maskLen, netN, n2ip, ip2n, validIp, peerOf, l2, l3, isDown, portStatus, blocks } = N;
  const AD = { ospf: 110, eigrp: 90, ebgp: 20, ibgp: 200 };
  const wc2m = wc => n2ip(~ip2n(wc) >>> 0);
  const classful = ip => { const a = +ip.split('.')[0]; return a < 128 ? '255.0.0.0' : a < 192 ? '255.255.0.0' : '255.255.255.0'; };
  const pad = (s, n) => String(s).padEnd(n);
  const isRt = d => !d.fw && !(d.model && N.MODELS[d.model] && N.MODELS[d.model].cloud) && (d.type === 'router' || (d.type === 'switch' && d.cfg.ipRouting));
  const sh = N.sh || (x => x);
  const nif = x => (N.normIf(x) || x).toLowerCase();
  const lines = b => b ? b.lines.map(l => l.trim()) : [];

  // ---------- Konfiguration lesen ----------
  function ospfCfg(d) {
    const b = blocks(d, 'router ospf')[0]; if (!b) return null; const c = { pid: b.head.split(' ')[2], nets: [], passiveDef: false, passive: new Set(), noPassive: new Set(), rid: null, defOrig: null, redist: new Set(), refBw: 100 };
    for (const l of lines(b)) { const t = l.split(/\s+/), k = t[0].toLowerCase();
      if (k === 'network' && t[4]) c.nets.push({ net: t[1], mask: wc2m(t[2]), area: t[4] });
      else if (k === 'passive-interface') { if (t[1] === 'default') c.passiveDef = true; else c.passive.add(nif(t[1])); }
      else if (k === 'no' && t[1] === 'passive-interface') c.noPassive.add(nif(t[2]));
      else if (k === 'router-id') c.rid = t[1];
      else if (k === 'default-information') c.defOrig = /always/.test(l) ? 'always' : 'if';
      else if (k === 'redistribute') c.redist.add(t[1]);
      else if (k === 'auto-cost') c.refBw = +t[2] || 100; }
    return c;
  }
  function eigrpCfg(d) {
    const b = blocks(d, 'router eigrp')[0]; if (!b) return null; const c = { as: b.head.split(' ')[2], nets: [], passiveDef: false, passive: new Set(), noPassive: new Set(), rid: null, redist: new Set() };
    for (const l of lines(b)) { const t = l.split(/\s+/), k = t[0].toLowerCase();
      if (k === 'network' && validIp(t[1])) c.nets.push({ net: t[1], mask: t[2] && validIp(t[2]) ? wc2m(t[2]) : classful(t[1]) });
      else if (k === 'passive-interface') { if (t[1] === 'default') c.passiveDef = true; else c.passive.add(nif(t[1])); }
      else if (k === 'no' && t[1] === 'passive-interface') c.noPassive.add(nif(t[2]));
      else if (k === 'eigrp' && t[1] === 'router-id') c.rid = t[2];
      else if (k === 'redistribute') c.redist.add(t[1]); }
    return c;
  }
  function bgpCfg(d) {
    const b = blocks(d, 'router bgp')[0]; if (!b) return null; const c = { as: +b.head.split(' ')[2], nbrs: {}, nets: [], rid: null, redist: new Set() };
    for (const l of lines(b)) { const t = l.split(/\s+/), k = t[0].toLowerCase();
      if (k === 'neighbor' && validIp(t[1])) { const n = c.nbrs[t[1]] = c.nbrs[t[1]] || { ip: t[1], as: null, upd: null, nhs: false, defOrig: false, multihop: 1, shut: false }, o = (t[2] || '').toLowerCase();
        if (o === 'remote-as') n.as = +t[3]; else if (o === 'update-source') n.upd = t[3]; else if (o === 'next-hop-self') n.nhs = true; else if (o === 'default-originate') n.defOrig = true; else if (o === 'ebgp-multihop') n.multihop = +t[3] || 255; else if (o === 'shutdown') n.shut = true; }
      else if (k === 'network') c.nets.push({ net: t[1], mask: t[3] || classful(t[1]) });
      else if (k === 'bgp' && t[1] === 'router-id') c.rid = t[2];
      else if (k === 'redistribute') c.redist.add(t[1]); }
    return c;
  }

  // ---------- gemeinsame Hilfen ----------
  const ifaceSpeed = (net, d, ifn) => { if (/^(Loopback|Vlan|Tunnel|Port-channel)/.test(ifn)) return ifn.startsWith('Loopback') ? 8000 : 1000; const ps = portStatus(net, d.id, ifn); return ps.st === 'connected' ? ps.speed : 1000; };
  const extra = (d, ifn, re) => { const i = d.cfg.ifs[ifn]; for (const e of (i && i.extra) || []) { const m = e.match(re); if (m) return m; } return null; };
  const routerId = (d, cfgRid, ifs) => { if (cfgRid) return cfgRid; const lo = ifs.filter(i => i.ifn.startsWith('Loopback')).map(i => i.ip).sort((a, b) => ip2n(b) - ip2n(a)); if (lo.length) return lo[0]; const all = ifs.map(i => i.ip).sort((a, b) => ip2n(b) - ip2n(a)); return all[0] || '0.0.0.0'; };
  function neighborsOn(net, d, i) { // andere Geräte-Interfaces im selben L2-Segment
    const eps = l2(net, d.id, i.ifn).eps; const out = [];
    for (const e of eps) { const nd = net.devs[e.dev]; if (!nd || nd.id === d.id || !isRt(nd) || isDown(nd)) continue; const ni = l3(net, nd.id).find(x => x.ifn === e.ifn); if (ni) out.push({ dev: nd, i: ni }); }
    return out;
  }

  // ---------- OSPF ----------
  function ospfIfaces(net, d, c) {
    const ifs = l3(net, d.id), res = [];
    for (const i of ifs) {
      let area = null; const nm = (i.ifn + '').toLowerCase();
      const ex = extra(d, i.ifn, new RegExp('^ip ospf ' + c.pid + ' area (\\d+)$')); if (ex) area = ex[1];
      else for (const n of c.nets) if (inNet(i.ip, n.net, n.mask)) { area = n.area; break; }
      if (area === null) continue;
      const passive = (c.passiveDef ? !c.noPassive.has(nm) : c.passive.has(nm)), cm = extra(d, i.ifn, /^ip ospf cost (\d+)$/), spd = ifaceSpeed(net, d, i.ifn) ;
      res.push({ ifn: i.ifn, ip: i.ip, mask: i.mask, area, passive, cost: cm ? +cm[1] : Math.max(1, Math.floor(c.refBw / spd)), hello: +((extra(d, i.ifn, /^ip ospf hello-interval (\d+)$/) || [])[1] || 10), dead: +((extra(d, i.ifn, /^ip ospf dead-interval (\d+)$/) || [])[1] || 0) });
    }
    return res;
  }
  function ospfAll(net) {
    const R = {}; for (const d of Object.values(net.devs)) { if (!isRt(d) || isDown(d)) continue; const c = ospfCfg(d); if (!c) continue; const ifs = ospfIfaces(net, d, c); R[d.id] = { d, c, ifs, rid: routerId(d, c.rid, l3(net, d.id)), adj: [], bad: [] }; }
    for (const id in R) { const r = R[id];
      for (const i of r.ifs) { if (i.passive) continue;
        for (const nb of neighborsOn(net, r.d, i)) { const o = R[nb.dev.id]; if (!o) continue; const oi = o.ifs.find(x => x.ifn === nb.i.ifn);
          if (!oi) { r.bad.push({ ifn: i.ifn, peer: nb.dev.cfg.hostname, why: `${nb.dev.cfg.hostname} hat ${sh(nb.i.ifn)} nicht in OSPF (network-Anweisung fehlt)` }); continue; }
          if (oi.passive) { r.bad.push({ ifn: i.ifn, peer: nb.dev.cfg.hostname, why: `${nb.dev.cfg.hostname} ${sh(oi.ifn)} ist passive-interface und sendet keine Hellos` }); continue; }
          if (oi.area !== i.area) { r.bad.push({ ifn: i.ifn, peer: nb.dev.cfg.hostname, why: `Area stimmt nicht: ${i.area} ↔ ${oi.area}` }); continue; }
          if (maskLen(oi.mask) !== maskLen(i.mask)) { r.bad.push({ ifn: i.ifn, peer: nb.dev.cfg.hostname, why: `Subnetzmaske stimmt nicht: /${maskLen(i.mask)} ↔ /${maskLen(oi.mask)}` }); continue; }
          if (i.hello !== oi.hello || (i.dead || i.hello * 4) !== (oi.dead || oi.hello * 4)) { r.bad.push({ ifn: i.ifn, peer: nb.dev.cfg.hostname, why: `Hello-/Dead-Timer passen nicht (${i.hello}/${i.dead || i.hello * 4} ↔ ${oi.hello}/${oi.dead || oi.hello * 4})` }); continue; }
          r.adj.push({ id: nb.dev.id, rid: o.rid, ifn: i.ifn, ip: nb.i.ip, cost: i.cost, host: nb.dev.cfg.hostname }); } } }
    return R;
  }
  function ospfRoutes(net, R, rid) {
    const me = R[rid]; if (!me) return []; const dist = { [rid]: 0 }, first = { [rid]: null }, todo = new Set(Object.keys(R));
    while (todo.size) { let u = null; todo.forEach(x => { if (dist[x] !== undefined && (u === null || dist[x] < dist[u])) u = x; }); if (u === null) break; todo.delete(u);
      for (const a of R[u].adj) { const nd = dist[u] + a.cost; if (dist[a.id] === undefined || nd < dist[a.id]) { dist[a.id] = nd; first[a.id] = u === rid ? { ifn: a.ifn, nh: a.ip } : first[u]; } } }
    const best = {}; const put = (net0, mask, metric, f, ext) => { const k = net0 + '/' + mask, cur = best[k]; if (!cur || metric < cur.metric) best[k] = { proto: 'ospf', net: net0, mask, nh: f.nh, ifn: f.ifn, ad: AD.ospf, metric, ext }; };
    const own = new Set(me.ifs.map(i => n2ip(netN(i.ip, i.mask)) + '/' + i.mask));
    for (const id in R) { if (id === rid || dist[id] === undefined) continue; const s = R[id], f = first[id];
      for (const i of s.ifs) { const nw = n2ip(netN(i.ip, i.mask)); if (!own.has(nw + '/' + i.mask)) put(nw, i.mask, dist[id] + i.cost, f, ''); }
      const hasDef = s.d.cfg.routes.some(r => r.net === '0.0.0.0' && r.mask === '0.0.0.0');
      if (s.c.defOrig === 'always' || (s.c.defOrig && hasDef)) put('0.0.0.0', '0.0.0.0', dist[id] + 1, f, 'E2');
      if (s.c.redist.has('static')) s.d.cfg.routes.filter(r => !(r.net === '0.0.0.0' && s.c.defOrig)).forEach(r => put(r.net, r.mask, dist[id] + 20, f, 'E2'));
      if (s.c.redist.has('connected')) l3(net, s.d.id).filter(i => !s.ifs.some(x => x.ifn === i.ifn)).forEach(i => put(n2ip(netN(i.ip, i.mask)), i.mask, dist[id] + 20, f, 'E2')); }
    return Object.values(best);
  }

  // ---------- EIGRP ----------
  function eigrpIfaces(net, d, c) {
    const res = []; for (const i of l3(net, d.id)) { if (!c.nets.some(n => inNet(i.ip, n.net, n.mask))) continue; const nm = i.ifn.toLowerCase(), spd = ifaceSpeed(net, d, i.ifn);
      const bw = extra(d, i.ifn, /^bandwidth (\d+)$/), dl = extra(d, i.ifn, /^delay (\d+)$/), hello = extra(d, i.ifn, new RegExp('^ip hello-interval eigrp ' + c.as + ' (\\d+)$'));
      res.push({ ifn: i.ifn, ip: i.ip, mask: i.mask, passive: c.passiveDef ? !c.noPassive.has(nm) : c.passive.has(nm), bw: bw ? +bw[1] : spd * 1000, delay: dl ? +dl[1] : spd >= 10000 ? 1 : spd >= 1000 ? 10 : spd >= 100 ? 100 : 1000, loop: i.ifn.startsWith('Loopback'), hello: hello ? +hello[1] : 5 }); }
    return res;
  }
  function eigrpAll(net) {
    const R = {}; for (const d of Object.values(net.devs)) { if (!isRt(d) || isDown(d)) continue; const c = eigrpCfg(d); if (!c) continue; const ifs = eigrpIfaces(net, d, c); R[d.id] = { d, c, ifs, rid: routerId(d, c.rid, l3(net, d.id)), adj: [], bad: [] }; }
    for (const id in R) { const r = R[id];
      for (const i of r.ifs) { if (i.passive || i.loop) continue;
        for (const nb of neighborsOn(net, r.d, i)) { const o = R[nb.dev.id]; if (!o) { continue; } const oi = o.ifs.find(x => x.ifn === nb.i.ifn);
          if (r.c.as !== o.c.as) { r.bad.push({ ifn: i.ifn, peer: nb.dev.cfg.hostname, why: `AS-Nummer stimmt nicht: ${r.c.as} ↔ ${o.c.as}` }); continue; }
          if (!oi) { r.bad.push({ ifn: i.ifn, peer: nb.dev.cfg.hostname, why: `${nb.dev.cfg.hostname} hat ${sh(nb.i.ifn)} nicht in EIGRP (network-Anweisung fehlt)` }); continue; }
          if (oi.passive) { r.bad.push({ ifn: i.ifn, peer: nb.dev.cfg.hostname, why: `${nb.dev.cfg.hostname} ${sh(oi.ifn)} ist passive-interface` }); continue; }
          if (maskLen(oi.mask) !== maskLen(i.mask)) { r.bad.push({ ifn: i.ifn, peer: nb.dev.cfg.hostname, why: 'Subnetzmaske stimmt nicht' }); continue; }
          r.adj.push({ id: nb.dev.id, ifn: i.ifn, ip: nb.i.ip, bw: i.bw, delay: i.delay, host: nb.dev.cfg.hostname }); } } }
    return R;
  }
  function eigrpRoutes(net, R, rid) {
    const me = R[rid]; if (!me) return []; const best = {}; const own = new Set(me.ifs.map(i => n2ip(netN(i.ip, i.mask)) + '/' + i.mask));
    const metric = (minBw, delay) => 256 * (Math.floor(1e7 / minBw) + delay);
    const walk = (cur, visited, minBw, delay, first) => {
      for (const a of R[cur].adj) { if (visited.has(a.id)) continue; const o = R[a.id], mb = Math.min(minBw, a.bw), dl = delay + a.delay, f = first || { ifn: a.ifn, nh: a.ip }, v2 = new Set(visited).add(a.id);
        for (const i of o.ifs) { const nw = n2ip(netN(i.ip, i.mask)), k = nw + '/' + i.mask; if (own.has(k)) continue; const m = metric(Math.min(mb, i.bw), dl + i.delay), cur2 = best[k]; if (!cur2 || m < cur2.metric) best[k] = { proto: 'eigrp', net: nw, mask: i.mask, nh: f.nh, ifn: f.ifn, ad: AD.eigrp, metric: m, ext: '' }; }
        if (v2.size < 10) walk(a.id, v2, mb, dl, f); }
    };
    walk(rid, new Set([rid]), Infinity, 0, null);
    return Object.values(best);
  }

  // ---------- BGP ----------
  // Basis-Tabelle ohne BGP: verbunden, statisch, OSPF, EIGRP (für Nachbar-Erreichbarkeit und Next-Hop-Auflösung)
  function baseLookup(net, d, ip, igp) {
    const ifs = l3(net, d.id); let best = null;
    for (const i of ifs) if (inNet(ip, i.ip, i.mask)) { const L = maskLen(i.mask) + 0.5; if (!best || L > best.len) best = { len: L, ifn: i.ifn, nh: ip, direct: true }; }
    const cand = (r, ifn, nh, ad) => { const L = maskLen(r.mask); if (!best || L > best.len || (L === best.len && ad < best.ad)) best = { len: L, ifn, nh, ad, direct: false }; };
    for (const r of d.cfg.routes) { if (!inNet(ip, r.net, r.mask)) continue; if (r.ifn) { const i = ifs.find(x => x.ifn === r.ifn); if (i) cand(r, r.ifn, inNet(ip, i.ip, i.mask) ? ip : (r.nh || ip), r.ad || 1); } else { const i = ifs.find(x => inNet(r.nh, x.ip, x.mask)); if (i) cand(r, i.ifn, r.nh, r.ad || 1); } }
    for (const r of (igp[d.id] || [])) { if (!inNet(ip, r.net, r.mask)) continue; cand(r, r.ifn, r.nh, r.ad); }
    return best;
  }
  function bgpAll(net, igp) {
    const R = {};
    for (const d of Object.values(net.devs)) { if (!isRt(d) || isDown(d)) continue; const c = bgpCfg(d); if (!c) continue; R[d.id] = { d, c, ifs: l3(net, d.id), rid: routerId(d, c.rid, l3(net, d.id)), peers: [], rib: {}, adjin: {} }; }
    const owner = ip => Object.values(R).find(r => r.ifs.some(i => i.ip === ip));
    // Sitzungen
    for (const id in R) { const r = R[id];
      for (const n of Object.values(r.c.nbrs)) {
        const pr = { ip: n.ip, as: n.as, cfg: n, state: 'Idle', why: '', peer: null, ibgp: n.as === r.c.as, src: null };
        r.peers.push(pr);
        if (n.shut) { pr.why = 'administrativ abgeschaltet (shutdown)'; continue; } if (!n.as) { pr.why = 'remote-as fehlt'; continue; }
        const o = owner(n.ip); if (!o) { pr.state = 'Active'; pr.why = `Unter ${n.ip} antwortet kein BGP-Router`; continue; }
        pr.peer = o; if (isDown(o.d)) { pr.state = 'Active'; pr.why = `${o.d.cfg.hostname} ist aus`; continue; }
        const route = baseLookup(net, r.d, n.ip, igp); if (!route) { pr.state = 'Active'; pr.why = `Keine Route zu ${n.ip}`; continue; }
        if (!pr.ibgp && !route.direct && n.multihop <= 1) { pr.state = 'Active'; pr.why = 'eBGP-Nachbar ist nicht direkt verbunden (ebgp-multihop fehlt)'; continue; }
        const srcIf = n.upd ? r.ifs.find(i => i.ifn.toLowerCase() === (N.normIf(n.upd) || n.upd).toLowerCase()) : r.ifs.find(i => i.ifn === route.ifn); if (!srcIf) { pr.state = 'Active'; pr.why = 'Quell-Interface (update-source) hat keine IP oder ist down'; continue; }
        pr.src = srcIf.ip;
        if (o.c.as !== n.as) { pr.state = 'Idle'; pr.why = `remote-as stimmt nicht: konfiguriert ${n.as}, der Nachbar ist AS ${o.c.as}`; continue; }
        const back = Object.values(o.c.nbrs).find(x => x.ip === pr.src); if (!back) { pr.state = 'Active'; pr.why = `${o.d.cfg.hostname} hat keinen neighbor ${pr.src} (Gegenstelle erwartet diese Quelladresse)`; continue; }
        if (back.as !== r.c.as) { pr.state = 'Idle'; pr.why = `${o.d.cfg.hostname} erwartet für ${pr.src} die AS ${back.as}, hier ist AS ${r.c.as}`; continue; }
        if (back.shut) { pr.state = 'Idle'; pr.why = `${o.d.cfg.hostname}: Nachbar ist dort abgeschaltet`; continue; }
        const back2 = baseLookup(net, o.d, pr.src, igp); if (!back2) { pr.state = 'Active'; pr.why = `${o.d.cfg.hostname} hat keine Route zurück zu ${pr.src}`; continue; }
        if (!pr.ibgp && !back2.direct && back.multihop <= 1) { pr.state = 'Active'; pr.why = `${o.d.cfg.hostname}: eBGP-Nachbar nicht direkt verbunden (ebgp-multihop fehlt)`; continue; }
        pr.state = 'Established'; pr.backCfg = back;
      } }
    // Routen: Ursprung, dann Weitergabe bis zum Fixpunkt
    const better = (a, b) => !b || a.path.length < b.path.length || (a.path.length === b.path.length && (a.type === 'ebgp' ? 0 : a.type === 'local' ? -1 : 1) < (b.type === 'ebgp' ? 0 : b.type === 'local' ? -1 : 1)) || (a.path.length === b.path.length && a.type === b.type && ip2n(a.from || '0.0.0.0') < ip2n(b.from || '0.0.0.0'));
    for (const id in R) { const r = R[id];
      for (const n of r.c.nets) { const has = baseLookup(net, r.d, n.net, igp), exact = r.d.cfg.routes.some(x => x.net === n.net && x.mask === n.mask) || r.ifs.some(i => n2ip(netN(i.ip, i.mask)) === n.net && i.mask === n.mask) || (igp[id] || []).some(x => x.net === n.net && x.mask === n.mask); if (has && exact) r.rib[n.net + '/' + n.mask] = { net: n.net, mask: n.mask, path: [], nh: '0.0.0.0', type: 'local', from: null, valid: true }; }
      if (r.c.redist.has('connected')) r.ifs.forEach(i => { const nw = n2ip(netN(i.ip, i.mask)); r.rib[nw + '/' + i.mask] = r.rib[nw + '/' + i.mask] || { net: nw, mask: i.mask, path: [], nh: '0.0.0.0', type: 'local', from: null, valid: true }; });
      if (r.c.redist.has('static')) r.d.cfg.routes.forEach(x => { r.rib[x.net + '/' + x.mask] = r.rib[x.net + '/' + x.mask] || { net: x.net, mask: x.mask, path: [], nh: '0.0.0.0', type: 'local', from: null, valid: true }; }); }
    for (let round = 0; round < 12; round++) { let changed = false;
      for (const id in R) { const r = R[id];
        for (const pr of r.peers) { if (pr.state !== 'Established') continue; const o = pr.peer, send = [];
          for (const rt of Object.values(r.rib)) { if (!rt.valid) continue; if (rt.type === 'ibgp' && pr.ibgp) continue; send.push(rt); }
          const list = send.map(rt => ({ net: rt.net, mask: rt.mask, path: pr.ibgp ? rt.path.slice() : [r.c.as, ...rt.path], nh: pr.ibgp ? (rt.type === 'local' || pr.cfg.nhs ? pr.src : rt.nh) : pr.src }));
          if (pr.cfg.defOrig) list.push({ net: '0.0.0.0', mask: '0.0.0.0', path: pr.ibgp ? [] : [r.c.as], nh: pr.src, def: true });
          const oPeer = o.peers.find(x => x.ip === pr.src && x.peer && x.peer.d.id === id); if (!oPeer) continue;
          for (const m of list) { if (m.path.includes(o.c.as)) continue;
            const ok = m.nh && (o.ifs.some(i => i.ip === m.nh) || baseLookup(net, o.d, m.nh, igp)), key = m.net + '/' + m.mask, cand = { net: m.net, mask: m.mask, path: m.path, nh: m.nh, type: pr.ibgp ? 'ibgp' : 'ebgp', from: pr.src, valid: !!ok, via: id, def: !!m.def }, cur = o.rib[key];
            if (cur && cur.type === 'local') continue;
            if (!cur || (cand.valid && !cur.valid) || (cand.valid === cur.valid && better(cand, cur) && JSON.stringify([cand.path, cand.nh, cand.type]) !== JSON.stringify([cur.path, cur.nh, cur.type]))) { if (!cur || JSON.stringify([cur.path, cur.nh, cur.type, cur.valid]) !== JSON.stringify([cand.path, cand.nh, cand.type, cand.valid])) { o.rib[key] = cand; changed = true; } } } } }
      // zurückgezogene Routen entfernen: Routen, deren Absender sie nicht mehr hat
      for (const id in R) { const r = R[id]; for (const k of Object.keys(r.rib)) { const x = r.rib[k]; if (x.type === 'local') continue; const src = R[x.via], alive = src && src.peers.some(p => p.state === 'Established' && p.peer && p.peer.d.id === id && (!x.def || p.cfg.defOrig)); if (!src || !alive || (!x.def && !src.rib[k])) { delete r.rib[k]; changed = true; } } }
      if (!changed) break; }
    return R;
  }
  function bgpRoutes(net, R, igp, rid) {
    const me = R[rid]; if (!me) return []; const out = [];
    for (const x of Object.values(me.rib)) { if (x.type === 'local' || !x.valid) continue; const f = me.ifs.find(i => i.ip === x.nh) ? null : baseLookup(net, me.d, x.nh, igp); const ifn = f ? f.ifn : null; if (!ifn) continue; out.push({ proto: 'bgp', net: x.net, mask: x.mask, nh: f.direct ? x.nh : f.nh, ifn, ad: x.type === 'ebgp' ? AD.ebgp : AD.ibgp, metric: 0, ext: '', path: x.path }); }
    return out;
  }

  // ---------- Gesamtberechnung (pro Operation zwischengespeichert) ----------
  let CACHE = null;
  function compute(net) {
    if (CACHE && CACHE.net === net && CACHE.tick === N.rtick()) return CACHE;
    const O = ospfAll(net), E = eigrpAll(net), routes = {}, igp = {};
    for (const d of Object.values(net.devs)) { if (!isRt(d)) continue; igp[d.id] = [...(O[d.id] ? ospfRoutes(net, O, d.id) : []), ...(E[d.id] ? eigrpRoutes(net, E, d.id) : [])]; }
    const Bg = bgpAll(net, igp);
    for (const id in igp) routes[id] = igp[id].concat(Bg[id] ? bgpRoutes(net, Bg, igp, id) : []);
    CACHE = { net, tick: N.rtick(), O, E, B: Bg, routes, igp }; return CACHE;
  }
  const dyn = (net, d) => (isRt(d) && !isDown(d) ? (compute(net).routes[d.id] || []) : []);

  // ---------- show-Befehle ----------
  function show(net, d, u) {
    if (!isRt(d)) return undefined; const C = compute(net);
    if (u[0] === 'ip' && 'ospf'.startsWith(u[1] || '~') && (u[1] || '').length >= 2) {
      const r = C.O[d.id]; if (!r) return '% OSPF-Routing-Prozess ist nicht konfiguriert (router ospf <Nr>)';
      if ('neighbor'.startsWith(u[2] || '~')) { const rows = r.adj.map(a => pad(a.rid, 17) + pad('1', 6) + pad('FULL/DR', 12) + pad('00:00:34', 11) + pad(a.ip, 16) + sh(a.ifn)); const bad = r.bad.map(b => `  ✗ ${sh(b.ifn)} zu ${b.peer}: ${b.why}`); return [pad('Neighbor ID', 17) + pad('Pri', 6) + pad('State', 12) + pad('Dead Time', 11) + pad('Address', 16) + 'Interface', ...rows, ...(rows.length ? [] : ['Keine Nachbarn.']), ...bad].join('\n'); }
      if ('interface'.startsWith(u[2] || '~')) return [pad('Interface', 12) + pad('PID', 5) + pad('Area', 7) + pad('IP Address/Mask', 20) + pad('Cost', 6) + 'Status', ...r.ifs.map(i => pad(sh(i.ifn), 12) + pad(r.c.pid, 5) + pad(i.area, 7) + pad(`${i.ip}/${maskLen(i.mask)}`, 20) + pad(i.cost, 6) + (i.passive ? 'PASSIVE' : r.adj.some(a => a.ifn === i.ifn) ? 'FULL' : 'UP, keine Nachbarn'))].join('\n');
      return `Routing Process "ospf ${r.c.pid}" with ID ${r.rid}\n Number of areas: ${new Set(r.ifs.map(i => i.area)).size}\n Neighbors in FULL state: ${r.adj.length}`;
    }
    if (u[0] === 'ip' && 'eigrp'.startsWith(u[1] || '~') && (u[1] || '').length >= 2) {
      const r = C.E[d.id]; if (!r) return '% EIGRP-Prozess ist nicht konfiguriert (router eigrp <AS>)';
      if ('neighbors'.startsWith(u[2] || '~')) { const rows = r.adj.map((a, k) => pad(k, 3) + pad(a.ip, 16) + pad(sh(a.ifn), 12) + 'Up'), bad = r.bad.map(b => `  ✗ ${sh(b.ifn)} zu ${b.peer}: ${b.why}`); return [`EIGRP-IPv4 Neighbors for AS(${r.c.as})`, pad('H', 3) + pad('Address', 16) + pad('Interface', 12) + 'State', ...rows, ...(rows.length ? [] : ['Keine Nachbarn.']), ...bad].join('\n'); }
      if ('topology'.startsWith(u[2] || '~')) return [`EIGRP-IPv4 Topology Table for AS(${r.c.as})/ID(${r.rid})`, ...C.routes[d.id].filter(x => x.proto === 'eigrp').map(x => `P ${x.net}/${maskLen(x.mask)}, 1 successors, FD is ${x.metric}\n        via ${x.nh} (${x.metric}/0), ${sh(x.ifn)}`)].join('\n');
      return `Routing Protocol is "eigrp ${r.c.as}"\n  Router-ID: ${r.rid}\n  Neighbors: ${r.adj.length}`;
    }
    if (u[0] === 'ip' && 'bgp'.startsWith(u[1] || '~') && (u[1] || '').length >= 1 && u[1] !== 'brief') {
      const r = C.B[d.id]; if (!r) return '% BGP ist nicht konfiguriert (router bgp <AS>)';
      if ('summary'.startsWith(u[2] || '~') && u[2]) return [`BGP router identifier ${r.rid}, local AS number ${r.c.as}`, pad('Neighbor', 16) + pad('AS', 8) + pad('State/PfxRcd', 14) + 'Hinweis', ...r.peers.map(p => pad(p.ip, 16) + pad(p.as || '-', 8) + pad(p.state === 'Established' ? Object.values(r.rib).filter(x => x.from === p.src || (x.via === (p.peer && p.peer.d.id))).length : p.state, 14) + (p.why ? '← ' + p.why : ''))].join('\n');
      const rows = Object.values(r.rib).sort((a, b) => ip2n(a.net) - ip2n(b.net)); return [`BGP table, local router ID is ${r.rid}`, 'Status: * valid, > best, i internal', pad('   Network', 22) + pad('Next Hop', 16) + 'Path', ...rows.map(x => pad((x.valid ? '*>' : '* ') + (x.type === 'ibgp' ? 'i' : ' ') + ' ' + x.net + '/' + maskLen(x.mask), 22) + pad(x.nh, 16) + (x.path.length ? x.path.join(' ') + ' i' : 'i') + (x.valid ? '' : '  (Next Hop nicht erreichbar)'))].join('\n');
    }
    if (u[0] === 'ip' && 'protocols'.startsWith(u[1] || '~') && (u[1] || '').length >= 2) {
      const o = [], O = C.O[d.id], E = C.E[d.id], B = C.B[d.id];
      if (O) o.push(`Routing Protocol is "ospf ${O.c.pid}"\n  Router ID ${O.rid}\n  Routing for Networks:\n${O.c.nets.map(n => `    ${n.net} ${n.mask} area ${n.area}`).join('\n')}\n  Passive Interface(s): ${O.ifs.filter(i => i.passive).map(i => sh(i.ifn)).join(', ') || '–'}\n  Distance: 110`);
      if (E) o.push(`Routing Protocol is "eigrp ${E.c.as}"\n  Router-ID ${E.rid}\n  Routing for Networks:\n${E.c.nets.map(n => `    ${n.net} ${n.mask}`).join('\n')}\n  Distance: internal 90`);
      if (B) o.push(`Routing Protocol is "bgp ${B.c.as}"\n  Router ID ${B.rid}\n  Neighbors: ${B.peers.map(p => p.ip + ' ' + p.state).join(', ') || '–'}\n  Distance: external 20 internal 200`);
      return o.length ? o.join('\n\n') : 'Es läuft kein dynamisches Routing-Protokoll.';
    }
    if (u[0] === 'ip' && 'route'.startsWith(u[1] || '~') && u[2] && ['ospf', 'eigrp', 'bgp'].includes(u[2])) { const rows = dyn(net, d).filter(x => x.proto === u[2]); return rows.length ? rows.map(r => `${{ ospf: r.ext ? 'O E2' : 'O   ', eigrp: 'D   ', bgp: 'B   ' }[r.proto]}  ${r.net}/${maskLen(r.mask)} [${r.ad}/${r.metric}] via ${r.nh}, ${r.ifn}`).join('\n') : 'Keine Routen dieses Protokolls.'; }
    return undefined;
  }
  N.setHooks({ dyn, show });
  return { compute, dyn, ospfCfg, eigrpCfg, bgpCfg, isRt, AD };
})();
if (typeof module !== 'undefined') module.exports = RTG;
