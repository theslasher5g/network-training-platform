// ===================== NetLab Monitoring (Zabbix-ähnlich) =====================
// Ein Linux-Server mit dem Paket zabbix-server fragt Geräte per ICMP und SNMP ab (Erreichbarkeit, Latenz, CPU,
// Speicher, Verkehr), wertet Trigger aus und sammelt Syslog-Meldungen. Der Verlauf liegt nur im Arbeitsspeicher.
const MON = (function () {
  const N = typeof NL !== 'undefined' ? NL : require('./engine.js');
  const MAXH = 120;
  const hash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
  const nz = (key, t) => (hash(key + '|' + Math.floor(t / 5000)) % 1000) / 1000;
  const zbx = d => d.zbx || (d.zbx = { hosts: [], sysSrc: true });
  const devIp = (d) => { if (N.isHost(d)) { for (const p of d.ports) { const h = N.hip(d, p); if (h && h.ip) return h.ip; } return null; } const n = Object.keys(d.cfg.ifs).find(k => d.cfg.ifs[k].ip && !k.startsWith('Tunnel')); return n ? d.cfg.ifs[n].ip : null; };
  const unitOn = (d, u) => !!(d.lx && d.lx.pkgs && d.lx.pkgs.includes(u) && d.lx.units[u] && d.lx.units[u].active);
  const isMonitor = (net, d) => !!d && d.type === 'server' && !N.isDown(d) && unitOn(d, 'zabbix-server');
  const isSyslog = (net, d) => !!d && d.type === 'server' && !N.isDown(d) && !!d.lx && d.lx.units.rsyslog && d.lx.units.rsyslog.active;
  const communities = d => d.cfg.lines.map(l => l.match(/^snmp-server community (\S+) (ro|rw)/i)).filter(Boolean).map(m => m[1]);
  const syslogTargets = d => d.cfg.lines.map(l => l.match(/^logging (?:host )?(\d+\.\d+\.\d+\.\d+)/i)).filter(Boolean).map(m => m[1]);
  const sevOf = t => { const m = /^%[A-Z0-9_-]+-(\d)-/.exec(t); return m ? +m[1] : 6; };

  // ---------- Messwerte ----------
  function sample(net, srv, h, t, H) {
    const d = net.devs[h.dev]; const s = { t, up: false, rtt: null, snmp: null, cpu: null, mem: null, disk: null, inK: null, outK: null, why: '' };
    if (!d) { s.why = 'Gerät existiert nicht mehr'; return s; }
    const ip = devIp(d); if (!ip) { s.why = 'Das Gerät hat keine IP-Adresse'; return s; }
    const r = N.ping(net, srv.id, ip); s.up = !!r.ok; if (!s.up) { s.why = r.reason || 'nicht erreichbar'; return s; }
    s.rtt = Math.round(((r.path ? r.path.length : 1) * 1.4 + nz('rtt' + d.id, t) * 1.2) * 10) / 10;
    const net_ = !N.isHost(d), conn = d.ports.filter(p => N.portStatus(net, d.id, p).st === 'connected').length;
    if (net_) {
      if (h.snmp) { const cs = communities(d); s.snmp = cs.includes(h.snmp); if (!s.snmp) s.why = cs.length ? `SNMP: Community „${h.snmp}“ stimmt nicht` : 'SNMP: auf dem Gerät ist keine Community konfiguriert (snmp-server community)'; }
      if (s.snmp) {
        let cpu = 6 + conn * 0.9 + (N.isRouter(d) ? 9 : 0) + nz('cpu' + d.id, t) * 6;
        if (d.type === 'switch') { for (const v of Object.keys(d.cfg.vlans).map(Number)) { if (N.stp(net, v).storm.has(d.id)) { cpu = 97 + nz('st' + d.id, t) * 2; break; } } }
        s.cpu = Math.min(100, Math.round(cpu * 10) / 10); s.mem = Math.round((28 + conn * 0.7 + nz('mem' + d.id, t) * 3) * 10) / 10;
        s.inK = Math.round(conn * 140 * (0.7 + nz('in' + d.id, t) * 0.6)); s.outK = Math.round(conn * 110 * (0.7 + nz('out' + d.id, t) * 0.6));
      }
    } else if (h.agent && H && d.type === 'server' && unitOn(d, 'zabbix-agent')) {
      const up = H.unitCount ? H.unitCount(d) : 2, vms = H.vmCount ? H.vmCount(d) : 0;
      s.snmp = true; s.cpu = Math.min(100, Math.round((5 + up * 5 + vms * 12 + nz('cpu' + d.id, t) * 7) * 10) / 10); s.mem = Math.min(100, Math.round((18 + up * 4 + vms * 15 + nz('mem' + d.id, t) * 4) * 10) / 10);
      s.disk = H.diskPct ? H.diskPct(d) : null; s.inK = Math.round(conn * 90 * (0.6 + nz('in' + d.id, t) * 0.8)); s.outK = Math.round(conn * 70 * (0.6 + nz('out' + d.id, t) * 0.8));
    } else if (h.agent && d.type === 'server') { s.snmp = false; s.why = 'Zabbix-Agent läuft nicht (Paket zabbix-agent installieren und starten)'; }
    return s;
  }

  // ---------- Trigger ----------
  const SEV = { 4: 'Katastrophe', 3: 'Hoch', 2: 'Mittel', 1: 'Warnung', 0: 'Info' };
  function evalTriggers(net, srv, S, t) {
    const st = S[srv.id] = S[srv.id] || { hist: {}, probs: [], syslog: [] }; const open = k => st.probs.find(p => p.key === k && !p.until);
    const need = (key, on, host, sev, text) => { const cur = open(key); if (on && !cur) st.probs.push({ key, host, sev, text, since: t, until: null }); else if (!on && cur) cur.until = t; else if (on && cur) cur.text = text; };
    for (const h of zbx(srv).hosts) {
      const d = net.devs[h.dev]; const hist = (st.hist[h.dev] || []), last = hist.slice(-3), name = d ? d.cfg.hostname : h.dev; if (!d) continue;
      need('down:' + h.dev, last.length >= 2 && last.slice(-2).every(x => !x.up), name, 4, `${name} ist nicht erreichbar${last.length && last[last.length - 1].why ? ' (' + last[last.length - 1].why + ')' : ''}`);
      need('cpu:' + h.dev, last.length >= 3 && last.every(x => x.cpu !== null && x.cpu > 90), name, 3, `CPU-Auslastung auf ${name} über 90 %`);
      need('disk:' + h.dev, last.length >= 1 && last[last.length - 1].disk !== null && last[last.length - 1].disk > 90, name, 2, `Speicherplatz auf ${name} fast voll`);
      need('snmp:' + h.dev, last.length >= 2 && last.slice(-2).every(x => x.up && x.snmp === false), name, 1, `${name}: Abfrage per SNMP/Agent nicht möglich`);
    }
    if (st.probs.length > 200) st.probs.splice(0, st.probs.length - 200);
  }
  function tick(net, srv, S, t) {
    if (!isMonitor(net, srv)) return false; const st = S[srv.id] = S[srv.id] || { hist: {}, probs: [], syslog: [] };
    for (const h of zbx(srv).hosts) { const a = st.hist[h.dev] = st.hist[h.dev] || []; a.push(sample(net, srv, h, t, S._H)); if (a.length > MAXH) a.shift(); }
    evalTriggers(net, srv, S, t); return true;
  }
  const availability = hist => hist.length ? Math.round(hist.filter(x => x.up).length / hist.length * 1000) / 10 : null;
  function addHost(net, srv, devId, o = {}) { const z = zbx(srv); if (!net.devs[devId]) return { err: 'Gerät nicht gefunden' }; if (z.hosts.some(h => h.dev === devId)) return { err: 'Das Gerät wird schon überwacht.' }; const d = net.devs[devId]; z.hosts.push({ dev: devId, snmp: o.snmp !== undefined ? o.snmp : (N.isHost(d) ? '' : 'public'), agent: o.agent !== undefined ? !!o.agent : d.type === 'server' }); return { ok: true }; }
  function discover(net, srv) { let n = 0; for (const d of Object.values(net.devs)) { if (d.id === srv.id || (d.model && N.MODELS[d.model] && N.MODELS[d.model].cloud)) continue; if (d.vm) continue; if (!devIp(d)) continue; if (addHost(net, srv, d.id).ok) n++; } return n; }
  // Syslog: Gerät schickt an "logging host", Server muss rsyslog laufen haben und erreichbar sein
  function syslogRoute(net, d, text) {
    const out = []; for (const ip of syslogTargets(d)) { const srv = Object.values(net.devs).find(x => x.type === 'server' && devIp0(x).includes(ip)); if (!srv || !isSyslog(net, srv)) continue; const dip = devIp(d); if (!dip) continue; if (!N.ping(net, d.id, ip).ok) continue; out.push(srv); }
    return out;
  }
  const devIp0 = d => d.ports.map(p => (N.hip(d, p) || {}).ip).filter(Boolean);
  return { zbx, sample, tick, evalTriggers, availability, addHost, discover, isMonitor, isSyslog, syslogRoute, communities, devIp, sevOf, SEV, MAXH, unitOn };
})();
if (typeof module !== 'undefined') module.exports = MON;
