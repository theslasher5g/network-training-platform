// ===================== NetLab Virtualisierung =====================
// Hypervisor-Hosts mit virtuellem Switch (vSwitch), VMs als eigene Geräte, Kapazität, Migration und HA.
// Die Layer-2-Anbindung der VMs steckt in engine.js (l2: d.vsw, virtuelle Links mit l.virt).
const VIRT = (function () {
  const N = typeof NL !== 'undefined' ? NL : require('./engine.js');
  const S = typeof STOR !== 'undefined' ? STOR : require('./storage.js');
  const CAP = { 'HW-2288H-V5': [64, 512], 'HW-1288H-V5': [32, 256], 'HW-TaiShan-2280': [128, 512], 'SRV-1U': [32, 256], 'SRV-2U': [64, 512] };
  const OVERCOMMIT = 4;
  const isMgPort = p => p === 'ibmc' || /mgmt$/i.test(p);

  const hv = d => d && d.hv ? d.hv : null;
  const isHost = d => !!(d && d.hv && d.vsw);
  const isVm = d => !!(d && d.vm);
  const vmsOf = (net, hostId) => Object.values(net.devs).filter(d => d.vm && d.vm.host === hostId);
  const running = (net, hostId) => vmsOf(net, hostId).filter(v => v.vm.state === 'running');
  const usedRam = (net, hostId) => running(net, hostId).reduce((s, v) => s + v.vm.ramGb, 0);
  const usedCpu = (net, hostId) => running(net, hostId).reduce((s, v) => s + v.vm.cpu, 0);

  function enable(net, d) {
    if (d.type !== 'server') return { err: 'Nur Server können Hypervisor sein.' }; if (isHost(d)) return { ok: true };
    const [cores, ram] = CAP[d.model] || [16, 64];
    d.hv = { cores, ramGb: ram, cluster: '', ha: false };
    d.vsw = { name: 'vSwitch0', uplinks: d.ports.filter(p => d.pk[p] === 'rj45' && !isMgPort(p)).slice(0, 2) };
    return { ok: true };
  }
  function disable(net, d) { if (vmsOf(net, d.id).length) return { err: 'Auf dem Host liegen noch VMs. Erst die VMs löschen oder verschieben.' }; delete d.hv; delete d.vsw; return { ok: true }; }
  function setUplink(d, port, on) { if (!isHost(d)) return { err: 'Kein Hypervisor.' }; d.vsw.uplinks = d.vsw.uplinks.filter(p => p !== port); if (on) d.vsw.uplinks.push(port); return { ok: true }; }

  // ---------- Datastores (LUNs, die der Host sieht) ----------
  function datastores(net, host) { return S.hostLuns(net, host).map(e => ({ id: e.sto + ':' + e.lun, name: e.name, gb: e.gb, sto: e.sto })); }
  const dsUsed = (net, id) => Object.values(net.devs).filter(d => d.vm && d.vm.ds === id).reduce((s, v) => s + v.vm.diskGb, 0);
  function dsOk(net, vm, hostId) { if (vm.vm.ds === 'local') return true; return datastores(net, net.devs[hostId]).some(x => x.id === vm.vm.ds); }
  function dsName(net, id) { if (id === 'local') return 'lokale Platte'; const [sto, lun] = id.split(':'), d = net.devs[sto], l = d && d.stor && d.stor.luns.find(x => String(x.id) === lun); return l ? l.name : id; }

  // ---------- VM-Verwaltung ----------
  function uniqueName(net, base) { const used = new Set(Object.values(net.devs).map(d => d.cfg.hostname)); if (!used.has(base)) return base; for (let n = 2; n < 1000; n++) if (!used.has(base + '-' + n)) return base + '-' + n; return base; }
  function createVm(net, host, o, mkSvc) {
    if (!isHost(host)) return { err: 'Erst den Server als Hypervisor einrichten.' };
    const name = String(o.name || '').trim(), cpu = Math.round(+o.cpu), ram = Math.round(+o.ramGb), disk = Math.round(+o.diskGb), vlan = o.vlan === '' || o.vlan == null ? 0 : Math.round(+o.vlan);
    if (!/^[A-Za-z][\w-]{0,14}$/.test(name)) return { err: 'VM-Name: Buchstaben, Ziffern, - und _ (max. 15 Zeichen, beginnt mit Buchstabe).' };
    if (Object.values(net.devs).some(d => d.cfg.hostname.toLowerCase() === name.toLowerCase())) return { err: `Den Namen „${name}“ gibt es im Plan schon.` };
    if (!(cpu >= 1 && cpu <= 32)) return { err: 'vCPUs: 1 bis 32.' }; if (!(ram >= 1 && ram <= 512)) return { err: 'Arbeitsspeicher: 1 bis 512 GB.' }; if (!(disk >= 1 && disk <= 2000)) return { err: 'Festplatte: 1 bis 2000 GB.' };
    if (!(vlan >= 0 && vlan <= 4094)) return { err: 'VLAN: 0 (ohne Tag) bis 4094.' };
    const ds = o.ds || 'local';
    if (ds !== 'local') { const x = datastores(net, host).find(y => y.id === ds); if (!x) return { err: 'Der Datastore ist auf diesem Host nicht sichtbar (Zoning, Masking, Rescan).' }; if (x.gb - dsUsed(net, ds) < disk) return { err: `Im Datastore ${x.name} sind nur ${x.gb - dsUsed(net, ds)} GB frei.` }; }
    const id = 'd' + (net.seq++), n = vmsOf(net, host.id).length, d = N.mkDev(id, 'server', host.x + (n % 4) * 100 - 150, host.y + 170 + Math.floor(n / 4) * 100, 1, { icon: 'vm', host: name });
    d.model = null; d.use = {}; d.svc = mkSvc ? mkSvc() : { http: { on: false, https: false, title: '', body: '' }, dns: { on: false, records: [] }, dhcp: { on: false, gw: '', dns: '', start: '', mask: '255.255.255.0', max: 50, leases: {} } };
    d.os = o.os === 'windows' ? 'windows' : 'linux'; d.vm = { host: host.id, vlan, cpu, ramGb: ram, diskGb: disk, ds, state: 'stopped', events: [] }; d.rack = null;
    net.devs[id] = d; net.links.push({ a: id, ap: 'eth0', b: host.id, bp: 'vm-' + id, cable: 'cu', virt: true });
    return { ok: true, id };
  }
  function start(net, vm) {
    const v = vm.vm, h = net.devs[v.host]; if (v.state === 'running') return { err: `${vm.cfg.hostname} läuft schon.` };
    if (h.off) return { err: `Der Host ${h.cfg.hostname} ist ausgeschaltet.` };
    if (!dsOk(net, vm, h.id)) return { err: `Der Datastore „${dsName(net, v.ds)}“ ist auf ${h.cfg.hostname} nicht erreichbar (SAN prüfen: Masking, Zoning, Rescan).` };
    if (usedRam(net, h.id) + v.ramGb > h.hv.ramGb) return { err: `Nicht genug Arbeitsspeicher auf ${h.cfg.hostname}: ${h.hv.ramGb - usedRam(net, h.id)} GB frei, ${vm.cfg.hostname} braucht ${v.ramGb} GB. Eine andere VM stoppen oder verschieben.` };
    if (usedCpu(net, h.id) + v.cpu > h.hv.cores * OVERCOMMIT) return { err: `Zu viele vCPUs auf ${h.cfg.hostname} (maximal ${h.hv.cores * OVERCOMMIT} bei ${OVERCOMMIT}:1 Überbuchung).` };
    v.state = 'running'; return { ok: true };
  }
  function stop(net, vm) { if (vm.vm.state !== 'running') return { err: `${vm.cfg.hostname} ist schon aus.` }; vm.vm.state = 'stopped'; return { ok: true }; }
  function del(net, vm) { net.links = net.links.filter(l => l.a !== vm.id && l.b !== vm.id); delete net.devs[vm.id]; return { ok: true }; }
  function cascade(net, hostId) { vmsOf(net, hostId).forEach(v => del(net, v)); }
  function setVlan(vm, vlan) { const n = Math.round(+vlan); if (!(n >= 0 && n <= 4094)) return { err: 'VLAN: 0 (ohne Tag) bis 4094.' }; vm.vm.vlan = n; return { ok: true }; }
  function relink(net, vm, hostId) { const l = net.links.find(x => x.virt && x.a === vm.id); if (l) { l.b = hostId; l.bp = 'vm-' + vm.id; } vm.vm.host = hostId; const h = net.devs[hostId]; vm.x = h.x + 60; vm.y = h.y + 170; }
  function migrate(net, vm, toId) {
    const to = net.devs[toId], from = net.devs[vm.vm.host]; if (!isHost(to)) return { err: 'Das Ziel ist kein Hypervisor.' }; if (to.id === from.id) return { err: 'Die VM liegt schon auf diesem Host.' };
    if (!from.hv.cluster || from.hv.cluster !== to.hv.cluster) return { err: 'Beide Hosts müssen im selben Cluster sein (Cluster-Name im Host-Inspektor).' };
    if (to.off) return { err: `Der Ziel-Host ${to.cfg.hostname} ist ausgeschaltet.` };
    if (vm.vm.ds === 'local' && vm.vm.state === 'running') return { err: `${vm.cfg.hostname} liegt auf einer lokalen Platte: Live-Migration braucht einen gemeinsamen Datastore (LUN, die beide Hosts sehen). Erst stoppen oder die VM auf den Datastore legen.` };
    if (vm.vm.ds !== 'local' && !dsOk(net, vm, to.id)) return { err: `Der Datastore „${dsName(net, vm.vm.ds)}“ ist auf ${to.cfg.hostname} nicht sichtbar: LUN auch für diesen Host freigeben, zonen und rescannen.` };
    if (vm.vm.state === 'running' && usedRam(net, to.id) + vm.vm.ramGb > to.hv.ramGb) return { err: `Auf ${to.cfg.hostname} sind nur ${to.hv.ramGb - usedRam(net, to.id)} GB RAM frei.` };
    if (vm.vm.ds === 'local') vm.vm.ds = 'local';
    relink(net, vm, to.id); vm.vm.events.push(`Migriert von ${from.cfg.hostname} nach ${to.cfg.hostname}.`); return { ok: true };
  }
  const clusterHa = (net, c) => !!c && Object.values(net.devs).some(x => isHost(x) && x.hv.cluster === c && x.hv.ha);
  function setHa(net, d, on) { const c = d.hv.cluster; (c ? Object.values(net.devs).filter(x => isHost(x) && x.hv.cluster === c) : [d]).forEach(x => { x.hv.ha = !!on; }); d.hv.ha = !!on; }
  // HA: VMs ausgefallener Hosts auf andere Cluster-Hosts neu starten (HA gilt für den ganzen Cluster)
  function haRun(net) {
    const moved = [];
    for (const h of Object.values(net.devs)) {
      if (!isHost(h) || !h.off || !h.hv.cluster || !clusterHa(net, h.hv.cluster)) continue;
      for (const vm of vmsOf(net, h.id)) {
        if (vm.vm.state !== 'running') continue;
        const cand = Object.values(net.devs).find(t => isHost(t) && t.id !== h.id && !t.off && t.hv.cluster === h.hv.cluster && dsOk(net, vm, t.id) && vm.vm.ds !== 'local' && usedRam(net, t.id) + vm.vm.ramGb <= t.hv.ramGb);
        if (!cand) { if (!vm.vm.events.includes('HA: kein Host mit gemeinsamem Datastore und freiem RAM.')) vm.vm.events.push('HA: kein Host mit gemeinsamem Datastore und freiem RAM.'); continue; }
        relink(net, vm, cand.id); vm.vm.events.push(`HA: ${h.cfg.hostname} ausgefallen, VM auf ${cand.cfg.hostname} neu gestartet.`); moved.push(vm.id);
      }
    }
    return moved;
  }
  const stateText = v => v === 'running' ? 'running' : 'shut off';

  // ---------- virsh (Konsole des Hosts) ----------
  function virsh(net, host, args, root) {
    if (!isHost(host)) return 'error: failed to connect to the hypervisor\nerror: Failed to connect socket to \'/var/run/libvirt/libvirt-sock\': No such file or directory\n(Der Server ist kein Hypervisor: im Inspektor „Virtualisierung“ einrichten.)';
    const a = args.filter(x => !x.startsWith('--')), flags = args.filter(x => x.startsWith('--')), cmd = a[0], vms = vmsOf(net, host.id), find = n => vms.find(v => v.cfg.hostname.toLowerCase() === String(n).toLowerCase());
    if (!cmd) return 'Usage: virsh list --all | start <VM> | shutdown <VM> | destroy <VM> | dominfo <VM> | nodeinfo | migrate --live <VM> <Ziel-Host>';
    if (cmd === 'list') { const all = flags.includes('--all'), rows = vms.filter(v => all || v.vm.state === 'running'); return ' Id   Name           State\n----------------------------------\n' + rows.map((v, i) => ` ${v.vm.state === 'running' ? String(i + 1).padEnd(4) : '-   '} ${v.cfg.hostname.padEnd(14)} ${stateText(v.vm.state)}`).join('\n'); }
    if (cmd === 'nodeinfo') return `CPU model:           x86_64\nCPU(s):              ${host.hv.cores}\nMemory size:         ${host.hv.ramGb * 1048576} KiB`;
    const v = find(a[1]); if (!a[1]) return `error: command '${cmd}' requires <domain> option`; if (!v) return `error: failed to get domain '${a[1]}'`;
    if (cmd === 'dominfo') return `Id:             ${v.vm.state === 'running' ? vms.indexOf(v) + 1 : '-'}\nName:           ${v.cfg.hostname}\nState:          ${stateText(v.vm.state)}\nCPU(s):         ${v.vm.cpu}\nMax memory:     ${v.vm.ramGb * 1048576} KiB\nVLAN:           ${v.vm.vlan || 'ohne Tag'}\nDatastore:      ${dsName(net, v.vm.ds)}`;
    if (!root) return 'error: authentication failed: Interactive authentication required (versuche: sudo virsh …)';
    if (cmd === 'start') { const r = start(net, v); return r.err ? 'error: Failed to start domain ' + v.cfg.hostname + '\nerror: ' + r.err : `Domain '${v.cfg.hostname}' started`; }
    if (cmd === 'shutdown' || cmd === 'destroy') { const r = stop(net, v); return r.err ? 'error: ' + r.err : `Domain '${v.cfg.hostname}' ${cmd === 'destroy' ? 'destroyed' : 'is being shutdown'}`; }
    if (cmd === 'migrate') { const to = Object.values(net.devs).find(t => isHost(t) && t.cfg.hostname.toLowerCase() === String(a[2] || '').toLowerCase()); if (!to) return `error: Zielhost „${a[2] || ''}“ nicht gefunden (Hostname eines Hypervisors)`; const r = migrate(net, v, to.id); return r.err ? 'error: ' + r.err : ''; }
    return `error: unknown command: '${cmd}'`;
  }
  return { CAP, OVERCOMMIT, isHost, isVm, vmsOf, usedRam, usedCpu, enable, disable, setUplink, datastores, dsUsed, dsName, dsOk, createVm, start, stop, del, cascade, setVlan, migrate, haRun, clusterHa, setHa, virsh, uniqueName };
})();
if (typeof module !== 'undefined') module.exports = VIRT;
