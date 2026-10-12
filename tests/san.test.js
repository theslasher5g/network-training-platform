// Integration: Storage (Pool, LUN, Masking, Zoning) + Linux-Terminal (rescan, multipath, mkfs, mount)
global.NL = require('../src/engine.js'); global.window = undefined;
const SB = require('../src/sandbox.js'), LXm = require('../src/linux.js');
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const net = { devs: {}, links: [], seq: 1 }, api = SB.testApi(net), ST = api.STOR, A = (m, h) => api.addDev(m, 0, 0, h);
const sId = A('HW-2288H-V5', 'SRV-DB'), mId = A('MDS-9132T', 'MDS-A'), tId = A('HW-Dorado-5000V6', 'STO-01'), swId = A('C9200L-24P-4X', 'SW'), rId = A('ISR4331', 'R-GW');
NL.setCard(net, sId, 1, 'HBA-2x32G-FC'); NL.setCard(net, tId, 1, 'IO-4x32G-FC');
const X = 'DS-SFP-FC32G-SW', fc = (a, ap, b, bp) => { net.links.push({ a, ap, b, bp, cable: 'mmf' }); net.devs[a].xcvr[ap] = X; net.devs[b].xcvr[bp] = X; }, cu = (a, ap, b, bp) => net.links.push({ a, ap, b, bp, cable: 'cu' });
fc(sId, 'slot2/1', mId, 'fc1/1'); fc(sId, 'slot2/2', mId, 'fc1/2'); fc(tId, 'A-slot2/1', mId, 'fc1/9'); fc(tId, 'B-slot2/1', mId, 'fc1/10');
cu(sId, 'eth0', swId, 'GigabitEthernet1/0/2'); cu(rId, 'GigabitEthernet0/0/1', swId, 'GigabitEthernet1/0/24');
const rs = NL.newSess(); ['enable', 'configure terminal', 'interface g0/0/1', 'ip address 10.0.0.1 255.255.255.0', 'no shutdown', 'end'].forEach(l => NL.exec(net, rId, rs, l));
api.hostLine(net.devs[sId], NL.newSess(), 'ip 10.0.0.10/24 10.0.0.1');
const T = net.devs[tId], M = net.devs[mId], L = l => api.lx('SRV-DB', l);
LXm.init(net.devs[sId]).scsi = [];  // frisch gebootet, noch nichts gescannt

ST.createPool(T, { name: 'POOL1', raid: 'raid5', disks: 6, diskGb: 600 }); ST.createLun(T, { name: 'DB01', pool: 'POOL1', gb: 200 }); ST.maskLun(T, 0, sId, true);
ok(!/\bsdb\b/.test(L('lsblk')), 'ohne Zoning keine LUN sichtbar');
ST.autoZones(net, M); ST.zoneActive(M, true);
ok(!/\bsdb\b/.test(L('lsblk')), 'nach Zoning: erst nach Rescan sichtbar (Snapshot)');
ok(/Permission denied/.test(L('rescan-scsi-bus.sh')), 'rescan braucht sudo');
ok(/4 new or changed/.test(L('sudo rescan-scsi-bus.sh')), 'sudo rescan findet 4 Pfade');
const lb = L('lsblk'); ok(['sdb', 'sdc', 'sdd', 'sde'].every(n => new RegExp('\\b' + n + '\\b').test(lb)) && /200G/.test(lb), 'lsblk: vier Pfad-Geraete mit 200G');
ok(/not found/.test(L('multipath -ll')), 'multipath nicht installiert');
ok(/Setting up multipath-tools/.test(L('sudo apt install multipath-tools')), 'apt install multipath-tools (Gateway erreichbar)');
const ml = L('multipath -ll'); ok(/mpatha/.test(ml) && (ml.match(/active ready running/g) || []).length === 4, 'multipath -ll: mpatha mit 4 aktiven Pfaden');
ok(/mpatha/.test(L('lsblk')), 'lsblk zeigt mpatha');
ok(/apparently in use/.test(L('sudo mkfs.ext4 /dev/sdb')), 'mkfs auf Pfad-Geraet verboten (Multipath-Mitglied)');
ok(/Permission denied/.test(L('mkfs.ext4 /dev/mapper/mpatha')), 'mkfs braucht sudo');
ok(/mount point does not exist/.test(L('sudo mount /dev/mapper/mpatha /data')), 'mount ohne Verzeichnis scheitert');
L('sudo mkdir /data'); ok(/wrong fs type/.test(L('sudo mount /dev/mapper/mpatha /data')), 'mount ohne Dateisystem scheitert');
ok(/Creating filesystem/.test(L('sudo mkfs.ext4 /dev/mapper/mpatha')), 'mkfs.ext4 auf mpatha');
ok(L('sudo mount /dev/mapper/mpatha /data') === '', 'mount ok');
ok(/\/dev\/mapper\/mpatha.*\/data/.test(L('df -h')) && /\/data/.test(L('lsblk')), 'df und lsblk zeigen /data');
ok(/mpatha on \/data/.test(L('mount')), 'mount listet die Einbindung');
L('sudo bash -c true'); L('echo test | sudo tee /data/probe.txt'); ok(L('cat /data/probe.txt') === 'test', 'Datei auf /data');
// Pfadausfall
net.links = net.links.filter(l => !(l.a === tId && l.ap === 'B-slot2/1'));
const m2 = L('multipath -ll'); ok(/failed faulty/.test(m2) && (m2.match(/active ready/g) || []).length === 2, 'Controller-B-Kabel gezogen: 2 Pfade failed, 2 aktiv');
ok(/umount|^$/.test(L('sudo umount /data')) && !/\/data/.test(L('mount')), 'umount');
// LUN-Masking entfernen -> nach Rescan weg
ST.maskLun(T, 0, sId, false); ok(/4 device\(s\) removed|device\(s\) removed/.test(L('sudo rescan-scsi-bus.sh')) && !/mpatha/.test(L('lsblk')), 'Masking entzogen + Rescan: Geraet weg');
// Rescan per sysfs
ST.maskLun(T, 0, sId, true); ok(/new or changed/.test(L('echo "- - -" | sudo tee /sys/class/scsi_host/host0/scan')) && /mpatha/.test(L('lsblk')), 'Rescan per echo "- - -" > .../scan');
process.exit(bad ? 1 : 0);
