global.NL = require('../src/engine.js'); global.window = undefined;
const V = require('../src/virt.js'), S = require('../src/storage.js');
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const net = { devs: {}, links: [], seq: 1 };
const mk = (id, type, model, host, x) => { net.devs[id] = NL.mkDev(id, type, x || 0, 0, 0, { model, host }); net.seq = Math.max(net.seq, +id.slice(1) + 1 || net.seq); return net.devs[id]; };
const sw = mk('s0', 'switch', 'C9200L-24P-4X', 'SW'), h1 = mk('s1', 'server', 'HW-2288H-V5', 'HV1', 100), h2 = mk('s2', 'server', 'HW-2288H-V5', 'HV2', 500), pc = mk('s3', 'pc', null, 'PC-20'), pc10 = mk('s4', 'pc', null, 'PC-10');
net.seq = 10;
const G = 'GigabitEthernet1/0/', cu = (a, ap, b, bp) => net.links.push({ a, ap, b, bp, cable: 'cu' });
cu('s1', 'eth0', 's0', G + 1); cu('s2', 'eth0', 's0', G + 2); cu('s3', 'eth0', 's0', G + 3); cu('s4', 'eth0', 's0', G + 4);
const run = (id, lines) => { const s = NL.newSess(); ['enable', 'configure terminal'].concat(lines, ['end']).forEach(l => NL.exec(net, id, s, l)); };
run('s0', ['vlan 10', 'vlan 20', 'interface g1/0/1', 'switchport mode trunk', 'switchport trunk allowed vlan 10,20', 'interface g1/0/2', 'switchport mode trunk', 'switchport trunk allowed vlan 10,20', 'interface g1/0/3', 'switchport mode access', 'switchport access vlan 20', 'interface g1/0/4', 'switchport mode access', 'switchport access vlan 10', 'ip routing', 'interface vlan 20', 'ip address 10.20.0.1 255.255.255.0', 'no shutdown', 'interface vlan 10', 'ip address 10.10.0.1 255.255.255.0', 'no shutdown']);
const hostIp = (id, ip, gw) => NL.exec(net, id, NL.newSess(), `ip ${ip}${gw ? ' ' + gw : ''}`);
hostIp('s3', '10.20.0.50/24', '10.20.0.1'); hostIp('s4', '10.10.0.50/24', '10.10.0.1');

ok(V.createVm(net, h1, { name: 'x' }).err, 'VM ohne Hypervisor-Rolle abgelehnt');
ok(V.enable(net, h1).ok && h1.hv.cores === 64 && h1.hv.ramGb === 512 && h1.vsw.uplinks.includes('eth0'), 'Hypervisor aktiviert (Modell-Kapazitaet, Uplinks eth0/eth1)');
V.enable(net, h2);
ok(V.createVm(net, h1, { name: 'bad name', cpu: 2, ramGb: 4, diskGb: 40 }).err, 'ungueltiger VM-Name');
const r = V.createVm(net, h1, { name: 'WEB-VM', cpu: 2, ramGb: 8, diskGb: 40, vlan: 20 }); ok(r.ok, 'VM angelegt');
const vm = net.devs[r.id]; hostIp(r.id, '10.20.0.10/24', '10.20.0.1');
ok(V.createVm(net, h1, { name: 'web-vm', cpu: 1, ramGb: 1, diskGb: 1 }).err, 'doppelter Name abgelehnt');
ok(!NL.ping(net, pc.id, '10.20.0.10').ok && /gestoppt/.test((NL.ping(net, pc.id, '10.20.0.10').notes || []).join(' ')), 'gestoppte VM nicht erreichbar (Hinweis nennt gestoppte VM)');
ok(V.start(net, vm).ok && vm.vm.state === 'running', 'VM starten');
ok(NL.ping(net, pc.id, '10.20.0.10').ok, 'PC im VLAN 20 erreicht VM (VLAN-Tag ueber Uplink/Trunk)');
ok(NL.ping(net, vm.id, '10.20.0.50').ok, 'VM erreicht PC');
ok(NL.ping(net, vm.id, '10.20.0.1').ok, 'VM erreicht Gateway');
// VM-zu-VM auf demselben Host ohne Uplink
const r2 = V.createVm(net, h1, { name: 'DB-VM', cpu: 2, ramGb: 8, diskGb: 40, vlan: 20 }); const vm2 = net.devs[r2.id]; hostIp(r2.id, '10.20.0.11/24', '10.20.0.1'); V.start(net, vm2);
net.links.find(l => l.a === 's1' && l.ap === 'eth0').cut = true;
ok(NL.ping(net, vm.id, '10.20.0.11').ok, 'VM-zu-VM im selben VLAN laeuft intern, auch ohne Uplink');
ok(!NL.ping(net, pc.id, '10.20.0.10').ok, 'Uplink ab: von aussen nicht erreichbar');
net.links.find(l => l.a === 's1' && l.ap === 'eth0').cut = false;
// falsche VLAN-Konfiguration
V.setVlan(vm, 10); ok(!NL.ping(net, vm.id, '10.20.0.50').ok, 'VM im falschen VLAN (10) erreicht VLAN-20-PC nicht'); V.setVlan(vm, 20);
// Trunk ohne VLAN 20
run('s0', ['interface g1/0/1', 'switchport trunk allowed vlan 10']); const pr = NL.ping(net, pc.id, '10.20.0.10'); ok(!pr.ok, 'Trunk ohne VLAN 20: unerreichbar');
run('s0', ['interface g1/0/1', 'switchport trunk allowed vlan 10,20']);
// Access-Port statt Trunk
run('s0', ['interface g1/0/1', 'switchport mode access', 'switchport access vlan 10']); ok(!NL.ping(net, pc.id, '10.20.0.10').ok, 'Access-Port statt Trunk: VM im VLAN 20 unerreichbar');
run('s0', ['interface g1/0/1', 'switchport mode trunk', 'switchport trunk allowed vlan 10,20']);
// Uplink nicht im vSwitch
V.setUplink(h1, 'eth0', false); ok(!NL.ping(net, pc.id, '10.20.0.10').ok, 'Kabel an Port ohne vSwitch-Uplink: unerreichbar'); V.setUplink(h1, 'eth0', true); ok(NL.ping(net, pc.id, '10.20.0.10').ok, 'Uplink wieder zugewiesen');
// Kapazitaet
const big = V.createVm(net, h1, { name: 'BIG', cpu: 4, ramGb: 500, diskGb: 40 }); const bvm = net.devs[big.id]; ok(/Nicht genug Arbeitsspeicher/.test(V.start(net, bvm).err), 'Start scheitert bei zu wenig RAM');
V.stop(net, vm2); ok(vm2.vm.state === 'stopped' && V.usedRam(net, 's1') === 8, 'RAM-Zaehlung nur laufende VMs');
// Host aus -> VMs down
h1.off = true; ok(!NL.ping(net, pc.id, '10.20.0.10').ok && /HV1/.test((NL.ping(net, pc.id, '10.20.0.10').notes || []).join(' ')), 'Host aus: VM nicht erreichbar (Hinweis nennt den Host)'); h1.off = false;
// Migration
ok(/Cluster/.test(V.migrate(net, vm, 's2').err), 'Migration braucht gleichen Cluster'); h1.hv.cluster = 'C1'; h2.hv.cluster = 'C1';
ok(/gemeinsamen Datastore/.test(V.migrate(net, vm, 's2').err), 'Live-Migration von lokaler Platte abgelehnt');
V.stop(net, vm); ok(V.migrate(net, vm, 's2').ok && vm.vm.host === 's2', 'Kalte Migration moeglich'); V.start(net, vm);
ok(NL.ping(net, pc.id, '10.20.0.10').ok, 'nach Migration erreichbar (Host 2 Uplink)');
// Loeschen
ok(V.del(net, vm).ok && !net.devs[vm.id] && !net.links.some(l => l.a === vm.id), 'VM loeschen entfernt Geraet und Link');
V.cascade(net, 's1'); ok(V.vmsOf(net, 's1').length === 0, 'cascade loescht VMs des Hosts');
// virsh
const v3 = V.createVm(net, h2, { name: 'APP', cpu: 1, ramGb: 2, diskGb: 10 }).id;
ok(/APP\s+shut off/.test(V.virsh(net, h2, ['list', '--all'], false)), 'virsh list --all');
ok(/Interactive authentication/.test(V.virsh(net, h2, ['start', 'APP'], false)), 'virsh start ohne root');
ok(/started/.test(V.virsh(net, h2, ['start', 'APP'], true)) && net.devs[v3].vm.state === 'running', 'virsh start');
process.exit(bad ? 1 : 0);
