// ===================== NetLab Engine (no DOM) =====================
const NL = (function () {
  // ---------- IP helpers ----------
  const ip2n = s => {
    if (typeof s !== 'string' || !/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return null;
    const p = s.split('.').map(Number); if (p.some(x => x > 255)) return null;
    return (p[0] * 16777216 + (p[1] << 16) + (p[2] << 8) + p[3]) >>> 0;
  };
  const n2ip = n => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  const validIp = s => ip2n(s) !== null;
  const lenMask = l => n2ip(l === 0 ? 0 : (0xFFFFFFFF << (32 - l)) >>> 0);
  const maskLen = m => { const n = ip2n(m); if (n === null) return null; let l = 0; while (l < 32 && ((n >>> (31 - l)) & 1)) l++; return ip2n(lenMask(l)) === n ? l : null; };
  const netN = (ip, mask) => (ip2n(ip) & ip2n(mask)) >>> 0;
  const inNet = (ip, net, mask) => validIp(ip) && validIp(net) && netN(ip, mask) === netN(net, mask);
  const wcMatch = (ip, base, wc) => { const w = ip2n(wc); return ((ip2n(ip) & ~w) >>> 0) === ((ip2n(base) & ~w) >>> 0); };

  // ---------- interface names ----------
  const IFT = [['twentyfivegige', 'TwentyFiveGigE'], ['hundredgige', 'HundredGigE'], ['management', 'Management'], ['tengigabitethernet', 'TenGigabitEthernet'], ['gigabitethernet', 'GigabitEthernet'], ['fastethernet', 'FastEthernet'], ['ethernet', 'Ethernet'], ['tunnel', 'Tunnel'], ['vlan', 'Vlan'], ['loopback', 'Loopback'], ['portchannel', 'Port-channel']];
  function normIf(s) {
    s = String(s).replace(/\s+/g, '').toLowerCase().replace(/^port-?channel/, 'portchannel');
    const m = s.match(/^([a-z]+)(\d[\d\/\.]*)$/); if (!m) return null;
    const t = IFT.find(x => x[0].startsWith(m[1])); return t ? t[1] + m[2] : null;
  }
  const sh = n => String(n).replace('TwentyFiveGigE', 'Twe').replace('HundredGigE', 'Hu').replace('Management', 'Mg').replace('TenGigabitEthernet', 'Te').replace('GigabitEthernet', 'Gi').replace('FastEthernet', 'Fa').replace('Ethernet', 'Et').replace('Tunnel', 'Tu').replace('Loopback', 'Lo').replace('Port-channel', 'Po');
  const natSort = a => a.slice().sort((x, y) => x.localeCompare(y, 'en', { numeric: true }));

  // ---------- model ----------
  function newIf(type) {
    return { shutdown: type === 'router', ip: null, mask: null, mode: 'access', modeSet: false, vlan: 1, allowed: null, native: 1,
      encap: null, desc: '', aclIn: null, aclOut: null, extra: [], tsrc: null, tdst: null, tmode: 'gre', tprot: null, nameif: null, sl: null };
  }
  const rng = (a, b) => { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; };
  const gp = (pre, a, b, k) => rng(a, b).map(i => [pre + i, k]);
  const OB = [['eth0', 'rj45'], ['eth1', 'rj45'], ['ibmc', 'rj45']];
  const OB10 = [['eth0', 'sfp+'], ['eth1', 'sfp+'], ['ibmc', 'rj45']];
  const MODELS = {
    // ---- Switches
    'C9200L-24P-4X': { type: 'switch', vendor: 'Cisco', u: 1, poe: true, label: 'Catalyst 9200L-24P-4X', info: '24× 1G RJ45 PoE+, 4× 10G SFP+', ports: [...gp('GigabitEthernet1/0/', 1, 24, 'rj45'), ...gp('TenGigabitEthernet1/1/', 1, 4, 'sfp+')] },
    'C9200L-48P-4X': { type: 'switch', vendor: 'Cisco', u: 1, poe: true, label: 'Catalyst 9200L-48P-4X', info: '48× 1G RJ45 PoE+, 4× 10G SFP+', ports: [...gp('GigabitEthernet1/0/', 1, 48, 'rj45'), ...gp('TenGigabitEthernet1/1/', 1, 4, 'sfp+')] },
    'C9200L-24T-4G': { type: 'switch', vendor: 'Cisco', u: 1, label: 'Catalyst 9200L-24T-4G', info: '24× 1G RJ45, 4× 1G SFP', ports: [...gp('GigabitEthernet1/0/', 1, 24, 'rj45'), ...gp('GigabitEthernet1/1/', 1, 4, 'sfp')] },
    'C9300-24P': { type: 'switch', vendor: 'Cisco', u: 1, poe: true, label: 'Catalyst 9300-24P', info: '24× 1G RJ45 PoE+, Uplink-Modul 4× 10G SFP+', ports: [...gp('GigabitEthernet1/0/', 1, 24, 'rj45'), ...gp('TenGigabitEthernet1/1/', 1, 4, 'sfp+')] },
    'C9300-48P': { type: 'switch', vendor: 'Cisco', u: 1, poe: true, label: 'Catalyst 9300-48P', info: '48× 1G RJ45 PoE+, Uplink-Modul 4× 10G SFP+', ports: [...gp('GigabitEthernet1/0/', 1, 48, 'rj45'), ...gp('TenGigabitEthernet1/1/', 1, 4, 'sfp+')] },
    'C9300X-24Y': { type: 'switch', vendor: 'Cisco', u: 1, label: 'Catalyst 9300X-24Y', info: '24× 10/25G SFP28, Uplink-Modul 2× 100G QSFP28', ports: [...gp('TwentyFiveGigE1/0/', 1, 24, 'sfp28'), ...gp('HundredGigE1/1/', 1, 2, 'qsfp28')] },
    'C9500-32C': { type: 'switch', vendor: 'Cisco', u: 1, label: 'Catalyst 9500-32C (100G Core)', info: '32× 100G QSFP28', ports: gp('HundredGigE1/0/', 1, 32, 'qsfp28') },
    'C2960X-24TS-L': { type: 'switch', vendor: 'Cisco', u: 1, label: 'Catalyst 2960-X 24TS-L', info: '24× 1G RJ45, 4× 1G SFP', ports: [...gp('GigabitEthernet1/0/', 1, 24, 'rj45'), ...gp('GigabitEthernet1/0/', 25, 28, 'sfp')] },
    'C2960X-48FPS-L': { type: 'switch', vendor: 'Cisco', u: 1, poe: true, label: 'Catalyst 2960-X 48FPS-L', info: '48× 1G RJ45 PoE+, 4× 1G SFP', ports: [...gp('GigabitEthernet1/0/', 1, 48, 'rj45'), ...gp('GigabitEthernet1/0/', 49, 52, 'sfp')] },
    'C9500-16X': { type: 'switch', vendor: 'Cisco', u: 1, label: 'Catalyst 9500-16X (Core)', info: '16× 10G SFP+', ports: gp('TenGigabitEthernet1/0/', 1, 16, 'sfp+') },
    'C9500-24Y4C': { type: 'switch', vendor: 'Cisco', u: 1, label: 'Catalyst 9500-24Y4C (25G/100G Core)', info: '24× 10/25G SFP28, 4× 100G QSFP28', ports: [...gp('TwentyFiveGigE1/0/', 1, 24, 'sfp28'), ...gp('HundredGigE1/0/', 25, 28, 'qsfp28')] },
    'C1000-8T-2G-L': { type: 'switch', vendor: 'Cisco', u: 1, label: 'Catalyst 1000-8T-2G-L', info: '8× 1G RJ45, 2× 1G SFP', ports: [...gp('GigabitEthernet1/0/', 1, 8, 'rj45'), ...gp('GigabitEthernet1/0/', 9, 10, 'sfp')] },
    // ---- SAN
    'MDS-9132T': { type: 'fc', vendor: 'Cisco', u: 1, label: 'MDS 9132T (FC-Switch)', info: '32× 32G Fibre Channel (SFP+)', ports: gp('fc1/', 1, 32, 'fc') },
    'MDS-9148T': { type: 'fc', vendor: 'Cisco', u: 1, label: 'MDS 9148T (FC-Switch)', info: '48× 32G Fibre Channel (SFP+)', ports: gp('fc1/', 1, 48, 'fc') },
    'MDS-9396T': { type: 'fc', vendor: 'Cisco', u: 2, label: 'MDS 9396T (FC-Switch)', info: '96× 32G Fibre Channel (SFP+)', ports: gp('fc1/', 1, 96, 'fc') },
    // ---- Router / Firewall
    'ISR4331': { type: 'router', vendor: 'Cisco', u: 1, label: 'ISR 4331', info: '2× 1G RJ45, 1× 1G SFP', ports: [['GigabitEthernet0/0/0', 'rj45'], ['GigabitEthernet0/0/1', 'rj45'], ['GigabitEthernet0/0/2', 'sfp']] },
    'ISR4321': { type: 'router', vendor: 'Cisco', u: 1, label: 'ISR 4321', info: '2× 1G RJ45, 2× 1G SFP', ports: [['GigabitEthernet0/0/0', 'rj45'], ['GigabitEthernet0/0/1', 'rj45'], ['GigabitEthernet0/1/0', 'sfp'], ['GigabitEthernet0/1/1', 'sfp']] },
    'ISR4351': { type: 'router', vendor: 'Cisco', u: 1, label: 'ISR 4351', info: '3× 1G RJ45, 3× 1G SFP', ports: [['GigabitEthernet0/0/0', 'rj45'], ['GigabitEthernet0/0/1', 'rj45'], ['GigabitEthernet0/0/2', 'rj45'], ['GigabitEthernet0/1/0', 'sfp'], ['GigabitEthernet0/1/1', 'sfp'], ['GigabitEthernet0/1/2', 'sfp']] },
    'ISR4451-X': { type: 'router', vendor: 'Cisco', u: 2, label: 'ISR 4451-X', info: '4× 1G RJ45, 2× 10G SFP+', ports: [...gp('GigabitEthernet0/0/', 0, 3, 'rj45'), ...gp('TenGigabitEthernet0/1/', 0, 1, 'sfp+')] },
    'C1111-8P': { type: 'router', vendor: 'Cisco', u: 1, label: 'ISR 1111-8P', info: '1× 1G WAN RJ45, 8× 1G LAN (Switchports als Routerports vereinfacht)', ports: [['GigabitEthernet0/0/0', 'rj45'], ...gp('GigabitEthernet0/1/', 0, 7, 'rj45')] },
    'C8300-1N1S': { type: 'router', vendor: 'Cisco', u: 1, label: 'Catalyst 8300-1N1S (Edge)', info: '4× 1G RJ45/SFP, 2× 10G SFP+', ports: [...gp('GigabitEthernet0/0/', 0, 3, 'rj45'), ...gp('TenGigabitEthernet0/1/', 0, 1, 'sfp+')] },
    'ASA-5516-X': { type: 'router', fw: true, vendor: 'Cisco', u: 1, label: 'ASA 5516-X (Firewall)', info: '8× 1G RJ45 + Management', ports: [...gp('GigabitEthernet1/', 1, 8, 'rj45'), ['Management1/1', 'rj45']] },
    'ASA-5506-X': { type: 'router', fw: true, vendor: 'Cisco', u: 1, label: 'ASA 5506-X (Firewall)', info: '8× 1G RJ45 + Management', ports: [...gp('GigabitEthernet1/', 1, 8, 'rj45'), ['Management1/1', 'rj45']] },
    'ASA-5508-X': { type: 'router', fw: true, vendor: 'Cisco', u: 1, label: 'ASA 5508-X (Firewall)', info: '8× 1G RJ45 + Management', ports: [...gp('GigabitEthernet1/', 1, 8, 'rj45'), ['Management1/1', 'rj45']] },
    'ASA-5525-X': { type: 'router', fw: true, vendor: 'Cisco', u: 1, label: 'ASA 5525-X (Firewall)', info: '8× 1G RJ45 + Management', ports: [...gp('GigabitEthernet0/', 0, 7, 'rj45'), ['Management0/0', 'rj45']] },
    'ASA-5545-X': { type: 'router', fw: true, vendor: 'Cisco', u: 1, label: 'ASA 5545-X (Firewall)', info: '8× 1G RJ45 + 2× 10G SFP+ + Management', ports: [...gp('GigabitEthernet0/', 0, 7, 'rj45'), ...gp('TenGigabitEthernet0/', 8, 9, 'sfp+'), ['Management0/0', 'rj45']] },
    // ---- Server (Huawei + generisch)
    'HW-2288H-V5': { type: 'server', vendor: 'Huawei', u: 2, slots: 4, label: 'Huawei FusionServer Pro 2288H V5', info: '2U, 2× 1G LOM + iBMC, 4 PCIe-Slots (vereinfachtes Planungsmodell)', onboard: OB },
    'HW-1288H-V5': { type: 'server', vendor: 'Huawei', u: 1, slots: 2, label: 'Huawei FusionServer Pro 1288H V5', info: '1U, 2× 1G LOM + iBMC, 2 PCIe-Slots (vereinfachtes Planungsmodell)', onboard: OB },
    'HW-TaiShan-2280': { type: 'server', vendor: 'Huawei', u: 2, slots: 4, label: 'Huawei TaiShan 200 (Modell 2280, ARM)', info: '2U, 2× 1G LOM + iBMC, 4 PCIe-Slots (vereinfachtes Planungsmodell)', onboard: OB },
    'SRV-1U': { type: 'server', vendor: 'Generisch', u: 1, slots: 2, label: 'Server 1U (generisch)', info: '1U, 2× 10G SFP+ + BMC, 2 PCIe-Slots', onboard: OB10 },
    'SRV-2U': { type: 'server', vendor: 'Generisch', u: 2, slots: 4, label: 'Server 2U (generisch)', info: '2U, 2× 10G SFP+ + BMC, 4 PCIe-Slots', onboard: OB10 },
    'HW-1288H-V6': { type: 'server', vendor: 'Huawei', u: 1, slots: 3, label: 'Huawei FusionServer Pro 1288H V6', info: '1U, 2× 10G SFP+ LOM + iBMC, 3 PCIe-Slots (vereinfachtes Planungsmodell)', onboard: OB10 },
    'HW-2288H-V6': { type: 'server', vendor: 'Huawei', u: 2, slots: 6, label: 'Huawei FusionServer Pro 2288H V6', info: '2U, 2× 10G SFP+ LOM + iBMC, 6 PCIe-Slots (vereinfachtes Planungsmodell)', onboard: OB10 },
    'HW-2488H-V5': { type: 'server', vendor: 'Huawei', u: 2, slots: 6, label: 'Huawei FusionServer Pro 2488H V5 (4 Sockel)', info: '2U, 2× 1G LOM + iBMC, 6 PCIe-Slots (vereinfachtes Planungsmodell)', onboard: OB },
    'HW-5885H-V5': { type: 'server', vendor: 'Huawei', u: 4, slots: 8, label: 'Huawei FusionServer Pro 5885H V5', info: '4U, 2× 1G LOM + iBMC, 8 PCIe-Slots (vereinfachtes Planungsmodell)', onboard: OB },
    'SRV-4U': { type: 'server', vendor: 'Generisch', u: 4, slots: 8, label: 'Server 4U (generisch)', info: '4U, 2× 10G SFP+ + BMC, 8 PCIe-Slots', onboard: OB10 },
    // ---- Storage
    'HW-Dorado-5000V6': { type: 'storage', vendor: 'Huawei', u: 2, slots: 4, label: 'Huawei OceanStor Dorado 5000 V6', info: '2U, 2 Controller, 4 Interface-Slots je Controller (vereinfachtes Planungsmodell)', onboard: [['A-mgmt', 'rj45'], ['B-mgmt', 'rj45']] },
    'HW-Dorado-3000V6': { type: 'storage', vendor: 'Huawei', u: 2, slots: 2, label: 'Huawei OceanStor Dorado 3000 V6', info: '2U, 2 Controller, 2 Interface-Slots je Controller (vereinfachtes Planungsmodell)', onboard: [['A-mgmt', 'rj45'], ['B-mgmt', 'rj45']] },
    'HW-Dorado-6000V6': { type: 'storage', vendor: 'Huawei', u: 4, slots: 6, label: 'Huawei OceanStor Dorado 6000 V6', info: '4U, 2 Controller, 6 Interface-Slots je Controller (vereinfachtes Planungsmodell)', onboard: [['A-mgmt', 'rj45'], ['B-mgmt', 'rj45']] },
    'HW-Dorado-18000V6': { type: 'storage', vendor: 'Huawei', u: 4, slots: 8, label: 'Huawei OceanStor Dorado 18000 V6', info: '4U-Controller-Gehäuse, 2 Controller, 8 Interface-Slots je Controller (vereinfachtes Planungsmodell)', onboard: [['A-mgmt', 'rj45'], ['B-mgmt', 'rj45']] },
    'STO-GEN': { type: 'storage', vendor: 'Generisch', u: 2, slots: 4, label: 'Storage (generisch, 2 Controller)', info: '2U, 2 Controller, 4 Interface-Slots je Controller', onboard: [['A-mgmt', 'rj45'], ['B-mgmt', 'rj45']] },
    // ---- WLAN
    'C9105AXI': { type: 'ap', vendor: 'Cisco', icon: 'ap', poe: true, label: 'Catalyst 9105AX Access Point', info: 'Wi-Fi 6, 2×2, 1× 1G RJ45 (PoE)', ports: [['GigabitEthernet0', 'rj45']] },
    'C9120AXI': { type: 'ap', vendor: 'Cisco', icon: 'ap', poe: true, label: 'Catalyst 9120AX Access Point', info: 'Wi-Fi 6, 4×4, 1× 2.5G mGig RJ45 (PoE)', ports: [['GigabitEthernet0', 'rj45']] },
    'C9130AXI': { type: 'ap', vendor: 'Cisco', icon: 'ap', poe: true, label: 'Catalyst 9130AX Access Point', info: 'Wi-Fi 6, 8×8, 1× 5G mGig RJ45 (PoE)', ports: [['GigabitEthernet0', 'rj45']] },
    'AIR-AP2802I': { type: 'ap', vendor: 'Cisco', icon: 'ap', poe: true, label: 'Aironet 2802I Access Point', info: 'Wi-Fi 5, 4×4, 1× 2.5G mGig RJ45 (PoE)', ports: [['GigabitEthernet0', 'rj45']] },
    'C9800-L': { type: 'wlc', vendor: 'Cisco', icon: 'wlc', label: 'Catalyst 9800-L WLAN-Controller', info: 'Controller für bis zu 250 Access Points (vereinfacht: ein 1G-Kupfer-Uplink)', ports: [['GigabitEthernet0/0/0', 'rj45']] },
    // ---- Endgeräte
    'Server': { type: 'server', label: 'Server (einfach, 1 Port)', icon: 'server' },
    'ISP-Cloud': { type: 'server', cloud: true, label: 'Internet / ISP (Cloud)', info: 'Simuliertes Internet: DNS und Webserver, 1 Uplink', icon: 'cloud' },
    'PC': { type: 'pc', label: 'PC / Notebook', icon: 'pc' },
    'IP-Phone': { type: 'pc', label: 'IP-Telefon', icon: 'phone' },
    'Printer': { type: 'pc', label: 'Drucker', icon: 'printer' },
    'Laptop': { type: 'pc', info: 'Funk-Client (Wi-Fi 6): verbindet sich mit einer SSID, bekommt per DHCP oder statisch eine IP', label: 'Notebook (WLAN)', icon: 'laptop', wifi: true, ports: [['wlan0', 'wifi']] },
    'Smartphone': { type: 'pc', info: 'Funk-Client: verbindet sich mit einer SSID, Browser und IP-Einstellungen', label: 'Smartphone (WLAN)', icon: 'smartphone', wifi: true, ports: [['wlan0', 'wifi']] },
    'Tablet': { type: 'pc', info: 'Funk-Client: verbindet sich mit einer SSID, Browser und IP-Einstellungen', label: 'Tablet (WLAN)', icon: 'tablet', wifi: true, ports: [['wlan0', 'wifi']] },
    'IP-Camera': { type: 'pc', info: 'PoE-Kamera am Switchport, Videostrom per RTSP (vereinfacht: ein Netzwerkport)', label: 'IP-Kamera', icon: 'camera' },
    'Smart-TV': { type: 'pc', info: 'Netzwerkgerät mit einem LAN-Port, braucht IP, Gateway und DNS', label: 'Smart-TV', icon: 'tv' },
    'Access-Control': { type: 'pc', info: 'Badge-Leser an einem Switchport (Beispiel für IoT-Geräte im eigenen VLAN)', label: 'Zutrittsleser (Badge)', icon: 'reader' }
  };
  const CARDS = {
    'NIC-4x1G': { for: 'server', kind: 'rj45', n: 4, short: '4×1G', label: '4× 1G RJ45 (z. B. Intel I350-T4)' },
    'NIC-2x10G': { for: 'server', kind: 'sfp+', n: 2, short: '2×10G', label: '2× 10G SFP+ (z. B. Intel X710-DA2)' },
    'NIC-2x25G': { for: 'server', kind: 'sfp28', n: 2, short: '2×25G', label: '2× 25G SFP28' },
    'NIC-2x25G-ROCE': { for: 'server', kind: 'sfp28', n: 2, roce: true, short: '2×25G RoCE', label: '2× 25G SFP28, RoCE v2 (z. B. NVIDIA ConnectX-5)' },
    'NIC-2x100G-ROCE': { for: 'server', kind: 'qsfp28', n: 2, roce: true, short: '2×100G RoCE', label: '2× 100G QSFP28, RoCE v2 (z. B. NVIDIA ConnectX-6 Dx)' },
    'HBA-2x16G-FC': { for: 'server', kind: 'fc', n: 2, short: '2×16G FC', label: '2× 16G Fibre-Channel-HBA' },
    'HBA-2x32G-FC': { for: 'server', kind: 'fc', n: 2, short: '2×32G FC', label: '2× 32G Fibre-Channel-HBA' },
    'IO-4x10G': { for: 'storage', kind: 'sfp+', n: 4, short: '4×10G iSCSI', label: '4× 10G SFP+ (iSCSI)' },
    'IO-4x25G': { for: 'storage', kind: 'sfp28', n: 4, roce: true, short: '4×25G RoCE', label: '4× 25G SFP28 (iSCSI / NVMe-oF über RoCE)' },
    'IO-2x100G': { for: 'storage', kind: 'qsfp28', n: 2, roce: true, short: '2×100G RoCE', label: '2× 100G QSFP28 (NVMe-oF über RoCE)' },
    'IO-4x16G-FC': { for: 'storage', kind: 'fc', n: 4, short: '4×16G FC', label: '4× 16G Fibre Channel' },
    'IO-4x32G-FC': { for: 'storage', kind: 'fc', n: 4, short: '4×32G FC', label: '4× 32G Fibre Channel' }
  };
  const XCVR = {
    'GLC-TE': { speed: 1000, media: 'cu', fam: 'T', proto: 'eth', label: '1000BASE-T (RJ45-SFP)' },
    'GLC-SX-MMD': { speed: 1000, media: 'mmf', fam: 'SX', proto: 'eth', label: '1000BASE-SX' },
    'GLC-LH-SMD': { speed: 1000, media: 'smf', fam: 'LH', proto: 'eth', label: '1000BASE-LX/LH' },
    'SFP-10G-SR': { speed: 10000, media: 'mmf', fam: 'SR', proto: 'eth', label: '10GBASE-SR' },
    'SFP-10G-LR': { speed: 10000, media: 'smf', fam: 'LR', proto: 'eth', label: '10GBASE-LR' },
    'SFP-25G-SR-S': { speed: 25000, media: 'mmf', fam: 'SR25', proto: 'eth', label: '25GBASE-SR' },
    'QSFP-100G-SR4-S': { speed: 100000, media: 'mmf', fam: 'SR4', proto: 'eth', label: '100GBASE-SR4' },
    'QSFP-100G-LR4-S': { speed: 100000, media: 'smf', fam: 'LR4', proto: 'eth', label: '100GBASE-LR4' },
    'DS-SFP-FC16G-SW': { speed: 16000, media: 'mmf', fam: 'FC', proto: 'fc', label: '16G FC Shortwave' },
    'DS-SFP-FC32G-SW': { speed: 32000, media: 'mmf', fam: 'FC', proto: 'fc', label: '32G FC Shortwave' }
  };
  const KIND = { wifi: { label: 'WLAN' }, rj45: { label: 'RJ45' }, sfp: { label: 'SFP', speeds: [1000] }, 'sfp+': { label: 'SFP+', speeds: [1000, 10000] }, sfp28: { label: 'SFP28', speeds: [10000, 25000] }, qsfp28: { label: 'QSFP28', speeds: [100000] }, fc: { label: 'FC-SFP+' } };
  const CABLES = { cu: 'Kupfer Cat6 (RJ45)', mmf: 'Glasfaser OM3/OM4 Multimode (LC-LC)', smf: 'Glasfaser OS2 Singlemode (LC-LC)', dac: 'DAC-Twinax (passiv)' };
  const MEDIA = { cu: 'Kupfer', mmf: 'Multimode-Faser', smf: 'Singlemode-Faser' };
  const DACSPEED = { 'sfp+': 10000, sfp28: 25000, qsfp28: 100000 };
  const slotAccepts = (k, X) => k === 'fc' ? X.proto === 'fc' : (X.proto === 'eth' && ((KIND[k] || {}).speeds || []).includes(X.speed));
  const fmtSpeed = (s, proto) => proto === 'fc' ? (s / 1000) + 'G FC' : (s >= 1000 ? (s / 1000) + 'G' : s + 'M');
  function hip(d, p) { return p === d.ports[0] ? { ip: d.cfg.ip, mask: d.cfg.mask } : ((d.cfg.nic && d.cfg.nic[p]) || null); }
  const hashN = s => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
  function wwpn(d, p) { const hx = n => n.toString(16).padStart(8, '0'); const s = hx(hashN(d.id + '|' + p)) + hx(hashN(p + '|' + d.id)); return '20:00:' + s.slice(0, 12).match(/../g).join(':'); }
  function buildPorts(type, M, cards) {
    const ports = [], pk = {}, pcard = {}, grp = {};
    const add = (n, k, g, c) => { ports.push(n); pk[n] = k; if (g) grp[n] = g; if (c) pcard[n] = c; };
    (M.onboard || []).forEach(([n, k]) => add(n, k, 'onboard'));
    (cards || []).forEach((ck, i) => {
      const C = ck && CARDS[ck]; if (!C) return;
      if (type === 'storage') ['A', 'B'].forEach(ctl => rng(1, C.n).forEach(j => add(`${ctl}-slot${i + 1}/${j}`, C.kind, `${ctl}-slot${i + 1}`, ck)));
      else rng(1, C.n).forEach(j => add(`slot${i + 1}/${j}`, C.kind, `slot${i + 1}`, ck));
    });
    return { ports, pk, pcard, grp };
  }
  function mkDev(id, type, x, y, nports, opt = {}) {
    const M = opt.model && MODELS[opt.model];
    let ports = [], pk = {}, pcard = {}, grp = {}, cards = null;
    if (M) type = M.type;
    if (M && M.ports) M.ports.forEach(([n, k]) => { ports.push(n); pk[n] = k; });
    else if (M && M.onboard) { cards = (opt.cards || M.defCards || []).slice(); while (cards.length < (M.slots || 0)) cards.push(null); ({ ports, pk, pcard, grp } = buildPorts(type, M, cards)); }
    else {
      if (type === 'switch') for (let i = 1; i <= (nports || 8); i++) ports.push('GigabitEthernet0/' + i);
      else if (type === 'router') for (let i = 0; i < (nports || 3); i++) ports.push('GigabitEthernet0/' + i);
      else ports = ['eth0'];
      ports.forEach(p => { pk[p] = 'rj45'; });
    }
    const d = { id, type, x, y, icon: opt.icon || (M && M.icon) || type, model: opt.model || null, ports, pk, pcard, grp, cards, xcvr: {}, rack: null, fw: !!(M && M.fw), saved: false,
      cfg: { hostname: opt.host || id, ifs: {}, vlans: {}, routes: [], acls: {}, lines: [], blocks: [], ipRouting: false, gw: null, ip: null, mask: null, rsa: false, nic: {}, nat: [], sameSec: false } };
    if (type === 'switch') { d.cfg.vlans = { 1: 'default' }; d.cfg.ifs.Vlan1 = Object.assign(newIf('switch'), { shutdown: true }); }
    if (type === 'switch' || type === 'router' || type === 'fc') ports.forEach(p => { d.cfg.ifs[p] = newIf(type === 'router' ? 'router' : 'switch'); });
    return d;
  }
  // Karte in einem Slot wechseln: Ports neu aufbauen, Kabel an verschwundenen/geänderten Ports entfernen
  function setCard(net, id, slot, ck) {
    const d = net.devs[id], M = MODELS[d.model]; d.cards[slot] = ck || null;
    const b = buildPorts(d.type, M, d.cards);
    const gone = d.ports.filter(p => !b.ports.includes(p) || d.pk[p] !== b.pk[p]);
    let removed = 0;
    net.links = net.links.filter(l => { const hit = (l.a === id && gone.includes(l.ap)) || (l.b === id && gone.includes(l.bp)); if (hit) removed++; return !hit; });
    gone.forEach(p => { delete d.xcvr[p]; delete d.cfg.nic[p]; });
    d.ports = b.ports; d.pk = b.pk; d.pcard = b.pcard; d.grp = b.grp; return removed;
  }
  const isHost = d => d.type === 'pc' || d.type === 'server' || d.type === 'storage' || d.type === 'ap' || d.type === 'wlc';
  const host = (net, id) => net.devs[id].cfg.hostname;

  function peerOf(net, d, p) {
    for (const l of net.links) { if (l.a === d && l.ap === p) return { dev: l.b, port: l.bp }; if (l.b === d && l.bp === p) return { dev: l.a, port: l.ap }; }
    return null;
  }
  // Ausgeschaltet oder noch beim Booten (d.boot = { t0, ms })
  let clockFn = null; const now = () => clockFn ? clockFn() : Date.now(), setClock = f => { clockFn = f; };
  const booting = d => !!(d.boot && now() < d.boot.t0 + d.boot.ms), isDown = d => !!(d.off || booting(d));
  const downWhy = d => d.off ? 'ist ausgeschaltet' : 'startet noch (Bootvorgang läuft)';
  function portAdminUp(net, dId, p) { const d = net.devs[dId]; if (isDown(d)) return false; if (isHost(d)) return true; const i = d.cfg.ifs[p]; return !!i && !i.shutdown; }
  function linkOf(net, d, p) { return net.links.find(l => (l.a === d && l.ap === p) || (l.b === d && l.bp === p)) || null; }
  const cfgSpeed = (d, p) => { const i = d.cfg.ifs && d.cfg.ifs[p]; const e = i && i.extra.find(x => /^speed \d+$/.test(x)); return e ? +e.split(' ')[1] : null; };
  // ---------- WLAN: Access Points, Controller, Clients ----------
  const apState = d => d.ap || (d.ap = { ssids: [], wlc: '', injector: false });
  const wlcState = d => d.wlc || (d.wlc = { ssids: [] });
  // Stromversorgung des AP: PoE-Port eines PoE-Switches oder PoE-Injector
  function apPower(net, ap) {
    if (apState(ap).injector) return { ok: true, via: 'PoE-Injector' };
    const pe = peerOf(net, ap.id, ap.ports[0]); if (!pe) return { ok: false, reason: 'Kein Kabel: ohne PoE-Switch oder Injector hat der AP keinen Strom' };
    const sw = net.devs[pe.dev];
    if (sw.type === 'switch' && MODELS[sw.model] && MODELS[sw.model].poe) {
      if (isDown(sw)) return { ok: false, reason: `${sw.cfg.hostname} ${downWhy(sw)}` };
      const i = sw.cfg.ifs[pe.port]; if (i && i.shutdown) return { ok: false, reason: `${sw.cfg.hostname} ${sh(pe.port)} ist shutdown, damit auch kein PoE` };
      return { ok: true, via: `PoE von ${sw.cfg.hostname} ${sh(pe.port)}` };
    }
    return { ok: false, reason: `${sw.cfg.hostname} liefert kein PoE (kein PoE-Switch). Nutze einen PoE-Port oder aktiviere den PoE-Injector.` };
  }
  // Lightweight-Modus: Ist ein Controller eingetragen, gehören die SSIDs dem Controller
  const JOINING = new Set();
  function apJoined(net, ap) {
    const st = apState(ap); if (!st.wlc) return null;
    if (JOINING.has(ap.id)) return { ok: false, why: 'Join wird gerade geprüft' };
    JOINING.add(ap.id); try { return apJoin2(net, ap, st); } finally { JOINING.delete(ap.id); }
  }
  function apJoin2(net, ap, st) {
    const w = Object.values(net.devs).find(x => x.type === 'wlc' && (hip(x, x.ports[0]) || {}).ip === st.wlc);
    if (!w) return { ok: false, why: `Unter ${st.wlc} gibt es keinen WLAN-Controller` };
    if (isDown(w)) return { ok: false, why: `Der Controller ${w.cfg.hostname} ${downWhy(w)}` };
    const r = ping(net, ap.id, st.wlc); if (!r.ok) return { ok: false, why: `Der AP erreicht den Controller ${st.wlc} nicht: ${r.reason}` };
    return { ok: true, wlc: w };
  }
  function apSsids(net, ap) {
    const j = apJoined(net, ap); if (j === null) return apState(ap).ssids.filter(x => x.on !== false);
    return j.ok ? wlcState(j.wlc).ssids.filter(x => x.on !== false) : [];
  }
  const wifiLinkOf = (net, c) => net.links.find(l => l.wifi && l.a === c.id) || null;
  const apClients = (net, ap) => net.links.filter(l => l.wifi && l.b === ap.id).map(l => net.devs[l.a]).filter(Boolean);
  // Sichtbare SSIDs: alle eingeschalteten APs mit Strom (ein Eintrag je SSID, mit der Liste der APs)
  function wifiScan(net) {
    const m = {};
    for (const ap of Object.values(net.devs)) { if (ap.type !== 'ap' || isDown(ap) || !apPower(net, ap).ok) continue; for (const s of apSsids(net, ap)) { (m[s.name] = m[s.name] || { ssid: s.name, sec: s.sec, aps: [] }).aps.push(ap.id); } }
    return Object.values(m);
  }
  function wifiConnect(net, c, ssid, psk) {
    net.links = net.links.filter(l => !(l.wifi && l.a === c.id)); c.wifi = { ssid: '', psk: '' };
    const sc = wifiScan(net).find(x => x.ssid === ssid); if (!sc) return { err: `Das WLAN „${ssid}“ wird von keinem erreichbaren Access Point gesendet.` };
    let lastErr = null;
    for (const id of sc.aps) {
      const ap = net.devs[id], s = apSsids(net, ap).find(x => x.name === ssid);
      if (s.sec !== 'open' && s.psk !== psk) { lastErr = 'Authentifizierung fehlgeschlagen: Der WLAN-Schlüssel ist falsch.'; continue; }
      c.wifi = { ssid, psk: psk || '' }; net.links.push({ a: c.id, ap: c.ports[0], b: ap.id, bp: 'wlan-' + c.id, virt: true, wifi: true }); return { ok: true, ap: ap.cfg.hostname, sec: s.sec, vlan: s.vlan || 0 };
    }
    return { err: lastErr || 'Verbindung fehlgeschlagen.' };
  }
  function wifiDisconnect(net, c) { net.links = net.links.filter(l => !(l.wifi && l.a === c.id)); if (c.wifi) c.wifi = { ssid: '', psk: '' }; return { ok: true }; }

  function phys(net, l) {
    if (l.wifi) {
      const c = net.devs[l.a], ap = net.devs[l.b], w = c.wifi || {}, bad = r => ({ ok: false, reason: r });
      if (isDown(c)) return bad(`${c.cfg.hostname} ${downWhy(c)}`); if (isDown(ap)) return bad(`${ap.cfg.hostname} ${downWhy(ap)}`);
      const pw = apPower(net, ap); if (!pw.ok) return bad(`${ap.cfg.hostname}: ${pw.reason}`);
      const j = apJoined(net, ap); if (j && !j.ok) return bad(`${ap.cfg.hostname} sendet kein WLAN: ${j.why}`);
      const sd = apSsids(net, ap).find(x => x.name === w.ssid); if (!sd) return bad(`Das WLAN „${w.ssid}“ wird von ${ap.cfg.hostname} nicht (mehr) gesendet`);
      if (sd.sec !== 'open' && sd.psk !== w.psk) return bad('WLAN-Authentifizierung fehlgeschlagen: falscher Schlüssel');
      return { ok: true, speed: 1200, proto: 'wifi' };
    }
    if (l.virt) { // virtueller Link VM ↔ vSwitch des Hypervisor-Hosts
      const vm = net.devs[l.a].vm ? net.devs[l.a] : net.devs[l.b], h = net.devs[vm.vm.host];
      if (vm.vm.state !== 'running') return { ok: false, reason: `${vm.cfg.hostname} ist ausgeschaltet (VM gestoppt)` };
      if (isDown(h)) return { ok: false, reason: `Der Host ${h.cfg.hostname} ${downWhy(h)}` };
      return { ok: true, speed: 10000, proto: 'eth' };
    }
    const cab = l.cable || 'cu';
    const S = [[l.a, l.ap], [l.b, l.bp]].map(([id, p]) => { const d = net.devs[id]; return { d, p, h: d.cfg.hostname, k: (d.pk && d.pk[p]) || 'rj45', x: d.xcvr && d.xcvr[p] }; });
    const bad = r => ({ ok: false, reason: r });
    if (l.cut) return bad('Kabel ist gezogen (Ausfall-Simulation)');
    const offs = S.filter(s => isDown(s.d)); if (offs.length) return bad(`${offs[0].h} ${downWhy(offs[0].d)}`);
    const np = S.find(s => s.d.type === 'ap' && !apPower(net, s.d).ok); if (np) return bad(`${np.h} hat keinen Strom: ${apPower(net, np.d).reason}`);
    const fcA = S[0].k === 'fc', fcB = S[1].k === 'fc';
    if (fcA !== fcB) { const f = S[fcA ? 0 : 1], e = S[fcA ? 1 : 0]; return bad(`Fibre-Channel-Port (${f.h} ${sh(f.p)}) und Ethernet-Port (${e.h} ${sh(e.p)}) lassen sich nicht verbinden`); }
    const sp = [];
    for (const s of S) {
      const nm = `${s.h} ${sh(s.p)}`;
      if (s.k === 'rj45') { if (cab !== 'cu') return bad(`${nm} ist ein RJ45-Kupferport – ${CABLES[cab]} lässt sich dort nicht stecken`); sp.push({ speed: 1000, fam: 'T' }); continue; }
      if (cab === 'dac') {
        if (fcA || !DACSPEED[s.k]) return bad(`${nm}: DAC-Kabel gibt es nur für SFP+/SFP28/QSFP28-Ethernet-Slots`);
        if (s.x) return bad(`${nm}: im Slot steckt bereits ${s.x} – ein DAC-Kabel ersetzt den Transceiver`);
        sp.push({ speed: DACSPEED[s.k], fam: 'DAC-' + s.k }); continue;
      }
      if (!s.x) return bad(`${nm}: kein Transceiver im ${KIND[s.k].label}-Slot gesteckt`);
      const X = XCVR[s.x];
      if (!slotAccepts(s.k, X)) return bad(`${nm}: ${s.x} (${X.label}) passt nicht in einen ${KIND[s.k].label}-Slot`);
      if (X.media !== cab) return bad(`${nm}: ${s.x} ist für ${MEDIA[X.media]}, gesteckt ist ${CABLES[cab]}`);
      sp.push({ speed: X.speed, fam: X.fam });
    }
    if (sp[0].fam !== sp[1].fam) return bad(cab === 'dac' ? `DAC-Kabel verbindet unterschiedliche Slot-Typen (${S[0].k} ↔ ${S[1].k})` : `Optiken passen nicht zusammen: ${S[0].x || 'RJ45'} ↔ ${S[1].x || 'RJ45'} – unterschiedliche Wellenlänge/Geschwindigkeit, kein Link`);
    const cs = S.map(s => cfgSpeed(s.d, s.p));
    if (cs[0] && cs[1] && cs[0] !== cs[1]) return bad(`Speed mismatch: ${S[0].h} ${cs[0]} Mbit/s, ${S[1].h} ${cs[1]} Mbit/s`);
    for (let k = 0; k < 2; k++) {
      const s = S[k], o = S[1 - k]; const i = s.d.cfg.ifs && s.d.cfg.ifs[s.p];
      if (s.d.type === 'switch' && o.d.type === 'switch' && i && i.extra.some(x => x.startsWith('spanning-tree bpduguard enable')) && portAdminUp(net, o.d.id, o.p))
        return { ok: false, err: k === 0 ? 'a' : 'b', reason: `${s.h} ${sh(s.p)} ist err-disabled: BPDU Guard hat eine BPDU von ${o.h} empfangen (Switch an Access-Port)` };
    }
    return { ok: true, speed: Math.min(sp[0].speed, sp[1].speed, ...cs.filter(Boolean)), proto: fcA ? 'fc' : 'eth' };
  }
  function linkUp(net, dId, p) { const l = linkOf(net, dId, p); if (!l) return false; const pe = peerOf(net, dId, p); return portAdminUp(net, dId, p) && portAdminUp(net, pe.dev, pe.port) && phys(net, l).ok; }
  function portStatus(net, dId, p) {
    const d = net.devs[dId], l = linkOf(net, dId, p), i = d.cfg.ifs && d.cfg.ifs[p];
    if (i && i.shutdown) return { st: 'disabled', reason: 'administrativ abgeschaltet (shutdown)', link: l, peer: l ? peerOf(net, dId, p) : null };
    if (!l) return { st: 'notconnect', reason: 'kein Kabel gesteckt', link: null };
    const pe = peerOf(net, dId, p);
    if (!portAdminUp(net, pe.dev, pe.port)) return { st: 'notconnect', reason: `Gegenseite ${host(net, pe.dev)} ${sh(pe.port)} ist shutdown`, link: l, peer: pe };
    const ph = phys(net, l);
    if (!ph.ok) { const mine = ph.err && ((ph.err === 'a') === (l.a === dId && l.ap === p)); return { st: ph.err ? (mine ? 'err-disabled' : 'notconnect') : 'notconnect', reason: ph.reason, link: l, peer: pe }; }
    return { st: 'connected', reason: '', speed: ph.speed, proto: ph.proto, link: l, peer: pe };
  }
  const allowed = (i, v) => i.allowed === null || i.allowed.includes(v);

  // ---------- EtherChannel und Spanning Tree ----------
  const hid = (o, k, v) => { Object.defineProperty(o, k, { value: v, writable: true, enumerable: false, configurable: true }); };
  const effIf = (d, p) => { const i = d.cfg.ifs[p]; if (i && i.cg && d.cfg.ifs['Port-channel' + i.cg.n]) { const b = bundleOf(null, d, p); if (b && b.ok) return d.cfg.ifs['Port-channel' + i.cg.n]; } return i; };
  const CGMODES = { on: 'on', active: 'lacp', passive: 'lacp', desirable: 'pagp', auto: 'pagp' };
  // Bündel-Prüfung: alle Mitglieder gehen zum selben Nachbarn, Modi passen zusammen, gleiche Einstellungen
  function bundleOf(net, d, p) {
    const i = d.cfg.ifs[p]; if (!i || !i.cg) return null; net = net || d._net;
    const mem = d.ports.filter(q => d.cfg.ifs[q].cg && d.cfg.ifs[q].cg.n === i.cg.n), po = 'Port-channel' + i.cg.n;
    if (!net) return { n: i.cg.n, po, members: mem, ok: true };
    const peers = mem.map(q => peerOf(net, d.id, q)), r = x => ({ n: i.cg.n, po, members: mem, ok: false, reason: x });
    if (peers.some(x => !x)) return { n: i.cg.n, po, members: mem, ok: mem.some((q, k) => peers[k]), reason: 'nicht alle Mitglieder haben ein Kabel', partial: true, peerDev: (peers.find(x => x) || {}).dev };
    if (new Set(peers.map(x => x.dev)).size > 1) return r('Die Mitglieder gehen zu verschiedenen Nachbarn');
    const pd = net.devs[peers[0].dev]; if (pd.type !== 'switch') return r('Der Nachbar ist kein Switch');
    const pc = peers.map(x => pd.cfg.ifs[x.port]); if (pc.some(x => !x || !x.cg)) return r(`${pd.cfg.hostname}: Gegenstelle hat kein channel-group`);
    if (new Set(pc.map(x => x.cg.n)).size > 1) return r(`${pd.cfg.hostname}: Mitglieder liegen in verschiedenen Port-Channels`);
    const ma = i.cg.mode, mb = pc[0].cg.mode, okm = ma === 'on' ? mb === 'on' : mb !== 'on' && CGMODES[ma] === CGMODES[mb] && (ma === 'active' || mb === 'active' || ma === 'desirable' || mb === 'desirable');
    if (!okm) return r(`Modus passt nicht: ${ma} ↔ ${mb} (${CGMODES[ma] === CGMODES[mb] ? 'beide passiv, keiner verhandelt' : 'LACP/PAgP/on lassen sich nicht mischen'})`);
    const sp = mem.map(q => { const l = linkOf(net, d.id, q), ph = l && phys(net, l); return ph && ph.ok ? ph.speed : 0; });
    if (sp.some(x => !x)) return { n: i.cg.n, po, members: mem, ok: mem.some((q, k) => sp[k]), reason: 'nicht alle Mitglieder haben Link', partial: true, peerDev: pd.id, peerPo: pc[0].cg.n };
    if (new Set(sp).size > 1) return r('Unterschiedliche Geschwindigkeiten');
    const key = q => { const x = d.cfg.ifs[q]; return [x.mode, x.vlan, x.native, JSON.stringify(x.allowed)].join('|'); };
    if (new Set(mem.map(key)).size > 1) return r('Die Mitglieder haben unterschiedliche Switchport-Einstellungen (Modus, VLAN, Trunk-Liste)');
    return { n: i.cg.n, po, members: mem, ok: true, peerDev: pd.id, peerPo: pc[0].cg.n, speed: sp.reduce((a, b) => a + b, 0), mode: ma };
  }
  function stpCfg(d) {
    const r = { mode: 'rapid-pvst', prio: {}, root: {}, off: new Set() };
    for (const raw of d.cfg.lines) {
      const l = raw.toLowerCase().trim(); let m;
      if ((m = l.match(/^spanning-tree mode (\S+)/))) r.mode = m[1];
      else if ((m = l.match(/^spanning-tree vlan (\S+) priority (\d+)/))) (parseVl(m[1]) || []).forEach(v => { r.prio[v] = +m[2]; delete r.root[v]; });
      else if ((m = l.match(/^spanning-tree vlan (\S+) root (primary|secondary)/))) (parseVl(m[1]) || []).forEach(v => { r.root[v] = m[2]; });
      else if ((m = l.match(/^no spanning-tree vlan (\S+)$/))) (parseVl(m[1]) || []).forEach(v => r.off.add(v));
      else if ((m = l.match(/^spanning-tree vlan (\S+)$/))) (parseVl(m[1]) || []).forEach(v => r.off.delete(v));
    }
    return r;
  }
  const bridgeMac = d => { const h = hashN('mac|' + d.id) >>> 0, g = hashN(d.id + '|2') & 0xffff; const x = (h >>> 0).toString(16).padStart(8, '0') + g.toString(16).padStart(4, '0'); return '0c' + x.slice(0, 2) + '.' + x.slice(2, 6) + '.' + x.slice(6, 10); };
  const portCostOf = (speed, i, v) => { if (i) { for (const e of i.extra || []) { let m = e.match(/^spanning-tree vlan (\S+) cost (\d+)$/); if (m && (parseVl(m[1]) || []).includes(v)) return +m[2]; m = e.match(/^spanning-tree cost (\d+)$/); if (m) return +m[1]; } } return speed >= 100000 ? 1 : speed >= 25000 ? 1 : speed >= 10000 ? 2 : speed >= 1000 ? 4 : speed >= 100 ? 19 : 100; };
  const carries = (d, p, v) => { const i = effIf(d, p); if (!i) return false; return i.mode === 'trunk' ? allowed(i, v) : i.vlan === v; };
  function stp(net, v) {
    if (!net._stp) hid(net, '_stp', {}); const key = 'v' + v; if (net._stpAt === STPTICK && net._stp[key]) return net._stp[key];
    if (net._stpAt !== STPTICK) { net._stp = {}; hid(net, '_stpAt', STPTICK); }
    const all = Object.values(net.devs).filter(d => d.type === 'switch' && !isDown(d) && d.cfg.vlans[v]);
    const part = all.filter(d => !stpCfg(d).off.has(v)), isPart = id => part.some(x => x.id === id);
    all.forEach(d => { hid(d, '_net', net); });
    // Prioritäten
    const prio = {}; part.forEach(d => { const c = stpCfg(d); prio[d.id] = c.prio[v] !== undefined ? c.prio[v] : 32768; });
    part.forEach(d => { const c = stpCfg(d); if (c.root[v]) { const others = part.filter(x => x.id !== d.id).map(x => prio[x.id]); const low = others.length ? Math.min(...others) : 32768; prio[d.id] = c.root[v] === 'primary' ? Math.max(0, Math.min(24576, low - 4096)) : Math.min(28672, Math.max(0, low)); } });
    const bid = d => [prio[d.id] + v, bridgeMac(d)];
    const cmp = (a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
    // Kanten (Bündel zählen als eine Kante)
    const edges = [], used = new Set();
    for (const d of all) for (const p of d.ports) {
      const pe = peerOf(net, d.id, p); if (!pe) continue; const pd = net.devs[pe.dev]; if (pd.type !== 'switch' || !pd.cfg.vlans[v]) continue;
      const l = linkOf(net, d.id, p), ph = phys(net, l); if (!ph.ok || !portAdminUp(net, d.id, p) || !portAdminUp(net, pd.id, pe.port)) continue;
      if (!carries(d, p, v) || !carries(pd, pe.port, v)) continue;
      const ba = bundleOf(net, d, p), bb = bundleOf(net, pd, pe.port);
      if ((ba && !ba.ok) || (bb && !bb.ok)) continue; // ausgesetzt (suspended)
      const k = [d.id + (ba ? '|Po' + ba.n : '|' + p), pd.id + (bb ? '|Po' + bb.n : '|' + pe.port)].sort().join('~'); if (used.has(k)) continue; used.add(k);
      edges.push({ a: d.id, ap: ba ? ba.members : [p], b: pd.id, bp: bb ? bb.members : [pe.port], speed: ba ? ba.speed : ph.speed, ai: d.cfg.ifs[p], bi: pd.cfg.ifs[pe.port], bundle: ba ? ba.n : 0 });
    }
    const res = { vlan: v, sw: {}, edges, storm: new Set(), part: part.map(d => d.id) };
    // Komponenten und Root
    const adj = {}; part.forEach(d => { adj[d.id] = []; }); edges.forEach(e => { if (isPart(e.a) && isPart(e.b)) { adj[e.a].push(e); adj[e.b].push(e); } });
    const seen = new Set(), pidx = (d, p) => d.ports.indexOf(p);
    for (const d0 of part) {
      if (seen.has(d0.id)) continue; const comp = [], st = [d0.id]; seen.add(d0.id);
      while (st.length) { const u = st.pop(); comp.push(u); adj[u].forEach(e => { const w = e.a === u ? e.b : e.a; if (!seen.has(w)) { seen.add(w); st.push(w); } }); }
      const root = comp.map(id => net.devs[id]).sort((a, b) => cmp(bid(a), bid(b)))[0];
      const dist = {}, via = {}; comp.forEach(id => { dist[id] = Infinity; }); dist[root.id] = 0; const todo = new Set(comp);
      while (todo.size) {
        let u = null; todo.forEach(id => { if (u === null || dist[id] < dist[u] || (dist[id] === dist[u] && cmp(bid(net.devs[id]), bid(net.devs[u])) < 0)) u = id; }); todo.delete(u); if (dist[u] === Infinity) break;
        adj[u].forEach(e => {
          const w = e.a === u ? e.b : e.a; if (!todo.has(w)) return; const wp = e.a === w ? e.ap[0] : e.bp[0], wi = e.a === w ? e.ai : e.bi, up = e.a === u ? e.ap[0] : e.bp[0], c = dist[u] + portCostOf(e.speed, wi, v);
          const cand = { cost: c, u, e, wp, up }, cur = via[w];
          const better = !cur || c < cur.cost || (c === cur.cost && (cmp(bid(net.devs[u]), bid(net.devs[cur.u])) < 0 || (cmp(bid(net.devs[u]), bid(net.devs[cur.u])) === 0 && (pidx(net.devs[u], up) < pidx(net.devs[cur.u], cur.up) || (up === cur.up && pidx(net.devs[w], wp) < pidx(net.devs[w], cur.wp))))));
          if (better) { via[w] = cand; dist[w] = c; }
        });
      }
      comp.forEach(id => { const d = net.devs[id]; res.sw[id] = { root: id === root.id, rootId: root.id, rootBid: bid(root), bid: bid(d), cost: dist[id], rp: id === root.id ? null : via[id].wp, ports: {}, prio: prio[id], mode: stpCfg(d).mode }; });
      // Rollen je Kante
      for (const e of edges) {
        if (!comp.includes(e.a) || !comp.includes(e.b)) continue;
        const A = { id: e.a, ports: e.ap, i: e.ai }, B = { id: e.b, ports: e.bp, i: e.bi };
        const adv = X => [dist[X.id], bid(net.devs[X.id]), pidx(net.devs[X.id], X.ports[0])];
        const ca = adv(A), cb = adv(B), aWins = ca[0] !== cb[0] ? ca[0] < cb[0] : (cmp(ca[1], cb[1]) !== 0 ? cmp(ca[1], cb[1]) < 0 : ca[2] <= cb[2]);
        for (const [X, win] of [[A, aWins], [B, !aWins]]) {
          const S0 = res.sw[X.id], cost = portCostOf(e.speed, X.i, v);
          X.ports.forEach(p => { if (win) S0.ports[p] = { role: 'desg', sts: 'FWD', cost }; else if (S0.rp === p || (X.ports.includes(S0.rp))) S0.ports[p] = { role: 'root', sts: 'FWD', cost }; else S0.ports[p] = { role: 'altn', sts: 'BLK', cost }; });
        }
      }
    }
    // Schleifen: Weiterleitungs-Graph aller Switches (auch ohne STP) auf Zyklen prüfen
    const fe = edges.filter(e => { const sa = res.sw[e.a], sb = res.sw[e.b], blk = (S0, ps) => S0 && ps.every(p => (S0.ports[p] || {}).sts === 'BLK'); return !(blk(sa, e.ap) || blk(sb, e.bp)); });
    const nodes = new Set(); fe.forEach(e => { nodes.add(e.a); nodes.add(e.b); }); const par = {}; nodes.forEach(n => { par[n] = n; }); const find = x => par[x] === x ? x : (par[x] = find(par[x])); const cyc = new Set();
    fe.forEach(e => { const ra = find(e.a), rb = find(e.b); if (ra === rb) cyc.add(ra); else par[ra] = rb; });
    if (cyc.size) nodes.forEach(n => { if ([...cyc].some(c => find(c) === find(n))) res.storm.add(n); });
    net._stp[key] = res; return res;
  }
  let STPTICK = 0; const stpBump = () => { STPTICK++; };
  const stpBlocked = (net, dId, p, v) => { const r = stp(net, v), s0 = r.sw[dId]; return !!(s0 && s0.ports[p] && s0.ports[p].sts === 'BLK'); };
  // ---------- Layer 2 ----------
  function l2(net, sId, sIf) {
    STPTICK++; const eps = [], notes = [], seen = new Set();
    const note = s => { if (!notes.includes(s)) notes.push(s); };
    const send = (dId, p, tag) => {
      const pe = peerOf(net, dId, p); if (!pe) return;
      if (!portAdminUp(net, dId, p)) { note(`${host(net, dId)} ${sh(p)} ist administrativ down (shutdown)`); return; }
      if (!portAdminUp(net, pe.dev, pe.port)) { note(`${host(net, pe.dev)} ${sh(pe.port)} ist administrativ down (shutdown)`); return; }
      const ph = phys(net, linkOf(net, dId, p)); if (!ph.ok) { note('Kein Link: ' + ph.reason); return; }
      recv(pe.dev, pe.port, tag);
    };
    const recv = (dId, p, tag) => {
      const d = net.devs[dId], h = d.cfg.hostname;
      if (d.type === 'switch') {
        hid(d, '_net', net); const bu = bundleOf(net, d, p); if (bu && !bu.ok) { note(`${h} ${sh(p)} ist im Port-Channel ${bu.n} ausgesetzt: ${bu.reason}`); return; }
        const i = effIf(d, p); let v;
        if (i.mode === 'trunk') { v = tag === null ? i.native : tag; if (!allowed(i, v)) { note(`${h} ${sh(p)}: VLAN ${v} ist auf dem Trunk nicht erlaubt`); return; } }
        else { if (tag !== null) { note(`${h} ${sh(p)} ist ein Access-Port, empfängt aber getaggte Frames (VLAN ${tag}) – fehlt hier ein Trunk?`); return; } v = i.vlan; }
        if (!d.cfg.vlans[v]) { note(`${h}: VLAN ${v} ist nicht angelegt – Port ${sh(p)} ist inaktiv`); return; }
        if (stpBlocked(net, dId, p, v)) { note(`${h} ${sh(p)}: Spanning Tree blockiert den Port in VLAN ${v} (Alternate/BLK)`); return; }
        inSw(dId, v);
      } else if (d.type === 'router') {
        if (tag === null) { const i = d.cfg.ifs[p]; if (i && !i.shutdown && i.ip) eps.push({ dev: dId, ifn: p }); }
        else {
          const sub = Object.keys(d.cfg.ifs).find(n => n.startsWith(p + '.') && d.cfg.ifs[n].encap === tag);
          if (!sub) { note(`${h}: kein Subinterface mit "encapsulation dot1Q ${tag}" auf ${sh(p)}`); return; }
          const s = d.cfg.ifs[sub]; if (s.shutdown) { note(`${h} ${sh(sub)} ist shutdown`); return; }
          if (s.ip) eps.push({ dev: dId, ifn: sub });
        }
      } else if (d.type === 'ap') { // Access Point: Brücke zwischen WLAN-Clients und dem Uplink
        if (p.startsWith('wlan-')) { const c = net.devs[p.slice(5)], sd = c && c.wifi && apSsids(net, d).find(x => x.name === c.wifi.ssid); inAp(dId, sd ? (sd.vlan || 0) : 0); }
        else { if (tag === null) eps.push({ dev: dId, ifn: p }); inAp(dId, tag === null ? 0 : tag); }
      } else if (d.vsw) { // Hypervisor: virtueller Switch zwischen VMs und Uplinks
        if (p.startsWith('vm-')) { const vm = net.devs[p.slice(3)]; if (vm && vm.vm) inVsw(dId, vm.vm.vlan || 0); }
        else {
          if (d.vsw.uplinks.includes(p)) inVsw(dId, tag === null ? 0 : tag);
          else if (tag !== null) note(`${h} ${sh(p)}: Port ist kein Uplink des ${d.vsw.name}, die VMs im VLAN ${tag} sind darüber nicht erreichbar`);
          if (tag === null) eps.push({ dev: dId, ifn: p });
        }
      } else {
        if (tag === null) eps.push({ dev: dId, ifn: p });
        else note(`${h} empfängt getaggte Frames (VLAN ${tag}) – das Endgerät hängt an einem Trunk-Port`);
      }
    };
    const inAp = (aId, v) => {
      const k = 'ap|' + aId + '|' + v; if (seen.has(k)) return; seen.add(k); const ap = net.devs[aId], ss = apSsids(net, ap);
      for (const c of apClients(net, ap)) { const sd = ss.find(x => x.name === (c.wifi || {}).ssid); if (!sd || (sd.vlan || 0) !== v) continue; const l = wifiLinkOf(net, c), ph = l && phys(net, l); if (ph && ph.ok) eps.push({ dev: c.id, ifn: c.ports[0] }); else if (ph) note(ph.reason); }
      if (peerOf(net, aId, ap.ports[0])) send(aId, ap.ports[0], v === 0 ? null : v);
    };
    const inVsw = (hId, v) => {
      const k = 'vsw|' + hId + '|' + v; if (seen.has(k)) return; seen.add(k);
      const h = net.devs[hId];
      for (const vm of Object.values(net.devs)) if (vm.vm && vm.vm.host === hId && (vm.vm.vlan || 0) === v) { const l = linkOf(net, vm.id, 'eth0'), ph = l && phys(net, l); if (ph && ph.ok) eps.push({ dev: vm.id, ifn: 'eth0' }); else if (ph) note(ph.reason); }
      for (const u of h.vsw.uplinks) if (peerOf(net, hId, u)) send(hId, u, v === 0 ? null : v);
    };
    const inSw = (dId, v) => {
      const k = dId + '|' + v; if (seen.has(k)) return; seen.add(k);
      const d = net.devs[dId]; hid(d, '_net', net);
      if (stp(net, v).storm.has(dId)) { note(`Broadcast-Sturm in VLAN ${v}: Eine Schleife zwischen den Switches ohne Spanning Tree legt das Netz lahm (${d.cfg.hostname})`); return; }
      const svi = d.cfg.ifs['Vlan' + v]; if (svi && !svi.shutdown && svi.ip) eps.push({ dev: dId, ifn: 'Vlan' + v });
      for (const p of d.ports) {
        const i = effIf(d, p); if (!peerOf(net, dId, p)) continue;
        { const bu = bundleOf(net, d, p); if (bu && !bu.ok) continue; }
        if (stpBlocked(net, dId, p, v)) continue;
        if (i.mode === 'trunk') { if (allowed(i, v)) send(dId, p, v === i.native ? null : v); else note(`${d.cfg.hostname} ${sh(p)}: VLAN ${v} ist auf dem Trunk nicht erlaubt`); }
        else if (i.vlan === v) send(dId, p, null);
      }
    };
    const d0 = net.devs[sId];
    if (d0.type === 'switch') { const v = +sIf.slice(4); if (d0.cfg.vlans[v]) inSw(sId, v); else note(`${d0.cfg.hostname}: VLAN ${v} existiert nicht`); }
    else if (d0.type === 'router') {
      if (sIf.includes('.')) {
        const par = sIf.split('.')[0], s = d0.cfg.ifs[sIf];
        if (d0.cfg.ifs[par].shutdown) note(`${d0.cfg.hostname} ${sh(par)} ist shutdown`);
        else if (s.encap === null) note(`${d0.cfg.hostname} ${sh(sIf)}: "encapsulation dot1Q" fehlt`);
        else send(sId, par, s.encap);
      } else send(sId, sIf, null);
    } else send(sId, sIf, null);
    return { eps: eps.filter(e => !(e.dev === sId && e.ifn === sIf)), notes };
  }

  // ---------- Layer 3 ----------
  function ifUp(net, dId, n, opt = {}) {
    const d = net.devs[dId];
    if (isHost(d)) return linkUp(net, dId, n);
    const i = d.cfg.ifs[n]; if (!i || i.shutdown) return false;
    if (n.startsWith('Vlan')) return !!d.cfg.vlans[+n.slice(4)];
    if (n.startsWith('Loopback')) return true;
    if (n.startsWith('Port-channel')) return d.ports.some(q => d.cfg.ifs[q].cg && 'Port-channel' + d.cfg.ifs[q].cg.n === n && (bundleOf(net, d, q) || {}).ok && linkUp(net, dId, q));
    if (n.startsWith('Tunnel')) return opt.noTunnel ? false : tunnel(net, dId, n).up;
    if (n.includes('.')) return linkUp(net, dId, n.split('.')[0]);
    return linkUp(net, dId, n);
  }
  function l3(net, dId, opt = {}) {
    const d = net.devs[dId];
    if (isHost(d)) { const r = []; for (const p of d.ports) { const h = hip(d, p); if (h && h.ip && ifUp(net, dId, p)) r.push({ ifn: p, ip: h.ip, mask: h.mask }); } return r; }
    const r = [];
    for (const n in d.cfg.ifs) { const i = d.cfg.ifs[n]; if (!i.ip) continue; if (opt.noTunnel && n.startsWith('Tunnel')) continue; if (ifUp(net, dId, n, opt)) r.push({ ifn: n, ip: i.ip, mask: i.mask }); }
    return r;
  }
  const isRouter = d => d.type === 'router' || (d.type === 'switch' && d.cfg.ipRouting);
  function lookup(net, dId, dst, opt = {}) {
    const d = net.devs[dId], h = d.cfg.hostname, ifs = l3(net, dId, opt);
    if (!isRouter(d)) {
      if (!ifs.length) return { err: `${h} hat keine aktive IP-Adresse (IP fehlt oder Interface down)` };
      for (const i of ifs) if (inNet(dst, i.ip, i.mask)) return { ifn: i.ifn, nh: dst };
      const gw = d.cfg.gw;
      if (!gw) return { err: `${h}: ${dst} liegt nicht im eigenen Subnetz und es ist kein Default-Gateway gesetzt` };
      const gi = ifs.find(i => inNet(gw, i.ip, i.mask));
      if (!gi) return { err: `${h}: Default-Gateway ${gw} liegt nicht im eigenen Subnetz` };
      return { ifn: gi.ifn, nh: gw };
    }
    let best = null; const skip = [];
    const cand = (len, ifn, nh) => { if (!best || len > best.len) best = { len, ifn, nh }; };
    for (const i of ifs) if (inNet(dst, i.ip, i.mask)) cand(maskLen(i.mask) + 0.5, i.ifn, dst);
    for (const r of d.cfg.routes) {
      if (!inNet(dst, r.net, r.mask)) continue;
      const L = maskLen(r.mask);
      if (r.ifn) { const i = ifs.find(x => x.ifn === r.ifn); if (i) cand(L, r.ifn, inNet(dst, i.ip, i.mask) ? dst : (r.nh || dst));
        else if (!opt.noTunnel) skip.push(`${h}: Route ${r.net}/${L} via ${sh(r.ifn)} ist inaktiv` + (r.ifn.startsWith('Tunnel') ? ' – ' + tunnel(net, dId, r.ifn).reason : ' (Interface down)')); }
      else { const i = ifs.find(x => inNet(r.nh, x.ip, x.mask)); if (i) cand(L, i.ifn, r.nh); else skip.push(`${h}: Route ${r.net}/${L} via ${r.nh} ist inaktiv (Next Hop in keinem aktiven Netz)`); }
    }
    if (!best) return { err: `${h}: keine Route zu ${dst} in der Routing-Tabelle`, skip };
    best.skip = skip; return best;
  }
  function aclOk(d, name, src, dst, flow) {
    if (!name) return true; const a = d.cfg.acls[name]; if (!a || !a.length) return true;
    flow = flow || { proto: 'icmp' };
    for (const e of a) {
      if (e.remark) continue;
      if (e.ext) { if (e.proto !== 'ip' && e.proto !== flow.proto) continue; if (e.dport && e.dport !== flow.port) continue; }
      const ms = (spec, ip) => spec.any || wcMatch(ip, spec.ip, spec.wc);
      if (ms(e.src, src) && (!e.ext || ms(e.dst, dst))) return e.action === 'permit';
    }
    return false;
  }
  const ipOf = (net, e) => { const d = net.devs[e.dev]; return isHost(d) ? (hip(d, e.ifn) || {}).ip : d.cfg.ifs[e.ifn].ip; };
  // ASA-Logik: Security-Level, ACL am Eingangsinterface (ersetzt die implizite Freigabe), nameif Pflicht
  function fwCheck(d, inIf, outIf, srcIp, dst, flow) {
    const h = d.cfg.hostname, a = d.cfg.ifs[inIf], b = d.cfg.ifs[outIf]; if (!a || !b) return null;
    const fl = flow.proto === 'icmp' ? 'ICMP' : `${flow.proto.toUpperCase()}/${flow.port}`;
    if (!a.nameif) return `${h}: ${sh(inIf)} hat kein "nameif" – die Firewall verarbeitet dort keinen Verkehr`;
    if (!b.nameif) return `${h}: ${sh(outIf)} hat kein "nameif" – die Firewall verarbeitet dort keinen Verkehr`;
    if (a.aclIn) { const acl = d.cfg.acls[a.aclIn]; return (acl && acl.length && aclOk(d, a.aclIn, srcIp, dst, flow)) ? null : `${h}: ACL ${a.aclIn} (access-group in ${a.nameif}) verwirft ${fl} ${srcIp} → ${dst} (implizites deny am Ende)`; }
    const la = a.sl === null ? 0 : a.sl, lb = b.sl === null ? 0 : b.sl;
    if (la > lb) return null;
    if (la === lb) return d.cfg.sameSec ? null : `${h}: ${a.nameif} und ${b.nameif} haben dasselbe Security-Level (${la}) – "same-security-traffic permit inter-interface" fehlt`;
    return `${h}: Verkehr von ${a.nameif} (Level ${la}) nach ${b.nameif} (Level ${lb}) ist ohne ACL verboten – access-list anlegen und mit "access-group … in interface ${a.nameif}" binden`;
  }
  function fwd(net, srcDev, srcIp, dst, opt = {}) {
    const flow = opt.flow || { proto: 'icmp' }; const est = !!opt.reply && flow.proto !== 'icmp';
    let cur = srcDev, ingress = null, nat = null; const path = [host(net, srcDev)]; const acc = [];
    for (let ttl = 0; ttl < 20; ttl++) {
      const d = net.devs[cur];
      if (l3(net, cur, opt).some(i => i.ip === dst)) return { ok: true, path, dev: cur, nat };
      const r = lookup(net, cur, dst, opt); (r.skip || []).forEach(x => { if (!acc.includes(x)) acc.push(x); });
      if (r.err) return { ok: false, path, reason: r.err, notes: acc };
      if (d.fw && ingress && !opt.reply) {
        const why = fwCheck(d, ingress, r.ifn, srcIp, dst, flow); if (why) return { ok: false, path, reason: why, notes: acc };
        const nr = (d.cfg.nat || []).find(n => n.from === d.cfg.ifs[ingress].nameif && n.to === d.cfg.ifs[r.ifn].nameif);
        if (nr && !nat) { nat = { dev: cur, ip: d.cfg.ifs[r.ifn].ip, orig: srcIp }; srcIp = nat.ip; }
      }
      if (!isHost(d)) { const i = d.cfg.ifs[r.ifn]; if (i && !d.fw && !est && !aclOk(d, i.aclOut, srcIp, dst, flow)) return { ok: false, path, reason: `${d.cfg.hostname}: ACL ${i.aclOut} (out auf ${sh(r.ifn)}) blockiert ${srcIp} → ${dst}` }; }
      const seg = r.ifn.startsWith('Tunnel') ? tunSeg(net, cur, r.ifn) : l2(net, cur, r.ifn);
      let nx = seg.eps.find(e => ipOf(net, e) === r.nh) || null;
      if (!nx && r.ifn.startsWith('Tunnel') && seg.eps.length === 1) nx = seg.eps[0];
      if (!nx) return { ok: false, path, notes: acc.concat(seg.notes.length || r.ifn.startsWith('Tunnel') ? seg.notes : [`Im Layer-2-Segment von ${d.cfg.hostname} ${sh(r.ifn)} antwortet niemand auf ${r.nh} – stimmen VLAN-Zuordnung, Trunk und Ziel-IP?`]), reason: `${d.cfg.hostname}: ${r.nh} ist über ${sh(r.ifn)} nicht erreichbar (ARP-Anfrage bleibt unbeantwortet)` };
      const nd = net.devs[nx.dev];
      if (!isHost(nd)) { const ii = nd.cfg.ifs[nx.ifn]; if (!nd.fw && !est && !aclOk(nd, ii.aclIn, srcIp, dst, flow)) return { ok: false, path: [...path, nd.cfg.hostname], reason: `${nd.cfg.hostname}: ACL ${ii.aclIn} (in auf ${sh(nx.ifn)}) blockiert ${srcIp} → ${dst}` }; }
      path.push(nd.cfg.hostname); cur = nx.dev; ingress = nx.ifn;
      const owns = l3(net, cur, opt).some(i => i.ip === dst);
      if (!owns && !isRouter(nd)) return { ok: false, path, reason: `${nd.cfg.hostname} ist kein Router und leitet das Paket für ${dst} nicht weiter` };
    }
    return { ok: false, path, notes: acc, reason: 'TTL abgelaufen – vermutlich eine Routing-Schleife' };
  }
  function ping(net, sId, dst, flow) {
    flow = flow || { proto: 'icmp' };
    if (!validIp(dst)) return { ok: false, reason: `"${dst}" ist keine gültige IP-Adresse`, path: [] };
    const d = net.devs[sId];
    if (l3(net, sId).some(i => i.ip === dst)) return { ok: true, path: [d.cfg.hostname] };
    const r = lookup(net, sId, dst); if (r.err) return { ok: false, reason: r.err, path: [d.cfg.hostname], notes: r.skip || [] };
    const srcIp = isHost(d) ? (hip(d, r.ifn) || {}).ip : d.cfg.ifs[r.ifn].ip;
    const a = fwd(net, sId, srcIp, dst, { flow }); if (!a.ok) return a;
    const b = fwd(net, a.dev, dst, a.nat ? a.nat.ip : srcIp, { flow, reply: true }); if (!b.ok) return { ...b, reason: 'Hinweg ok, aber Rückweg scheitert: ' + b.reason };
    if (a.nat) { const c = fwd(net, b.dev, dst, srcIp, { flow, reply: true }); if (!c.ok) return { ...c, reason: 'Rückweg nach NAT-Rückübersetzung scheitert: ' + c.reason }; }
    return { ok: true, path: a.path, nat: a.nat };
  }

  // ---------- Tunnels / IPsec ----------
  const blocks = (d, pre) => d.cfg.blocks.filter(b => b.head.toLowerCase().startsWith(pre + ' '));
  const blk = (d, pre, name) => blocks(d, pre).find(b => b.head.slice(pre.length + 1).split(/\s+/)[0] === name);
  const bval = (b, key) => { const l = b.lines.find(x => x.toLowerCase().startsWith(key + ' ')); return l ? l.slice(key.length + 1).trim() : null; };
  const words = s => (s || '').toLowerCase().split(/\s+/).filter(Boolean);
  function tunnel(net, dId, n) {
    const d = net.devs[dId], t = d.cfg.ifs[n], h = d.cfg.hostname;
    if (!t || t.shutdown) return { up: false, reason: `${h} ${n} ist shutdown` };
    if (!t.tsrc) return { up: false, reason: `${h} ${n}: "tunnel source" fehlt` };
    if (!t.tdst) return { up: false, reason: `${h} ${n}: "tunnel destination" fehlt` };
    let sip = t.tsrc;
    if (!validIp(sip)) { const si = d.cfg.ifs[sip]; if (!si || !si.ip || !ifUp(net, dId, sip, { noTunnel: true })) return { up: false, reason: `${h} ${n}: Tunnel-Source ${sh(sip)} ist down oder hat keine IP` }; sip = si.ip; }
    let peer = null, ownerFound = null;
    for (const id in net.devs) {
      if (id === dId) continue; const pd = net.devs[id]; if (pd.type !== 'router') continue;
      if (!Object.values(pd.cfg.ifs).some(i => i.ip === t.tdst && !i.tsrc)) continue;
      ownerFound = pd;
      for (const pn in pd.cfg.ifs) {
        if (!pn.startsWith('Tunnel')) continue; const pt = pd.cfg.ifs[pn];
        let ps = pt.tsrc; if (ps && !validIp(ps)) ps = pd.cfg.ifs[ps] && pd.cfg.ifs[ps].ip;
        if (pt.tdst === sip && ps === t.tdst) peer = { dev: id, ifn: pn };
      }
    }
    if (!ownerFound) return { up: false, reason: `${h} ${n}: kein Router besitzt die Tunnel-Destination ${t.tdst}` };
    if (!peer) return { up: false, reason: `${h} ${n}: ${ownerFound.cfg.hostname} hat keinen passenden Tunnel (source/destination müssen gespiegelt sein)` };
    const pd = net.devs[peer.dev], pt = pd.cfg.ifs[peer.ifn];
    if (pt.shutdown) return { up: false, reason: `${pd.cfg.hostname} ${peer.ifn} ist shutdown` };
    const u1 = fwd(net, dId, sip, t.tdst, { noTunnel: true }); if (!u1.ok) return { up: false, reason: 'Underlay: ' + u1.reason };
    const u2 = fwd(net, peer.dev, t.tdst, sip, { noTunnel: true }); if (!u2.ok) return { up: false, reason: 'Underlay (Rückweg): ' + u2.reason };
    if (t.tmode !== pt.tmode) return { up: false, reason: `Tunnel-Modus unterschiedlich (${h}: ${t.tmode}, ${pd.cfg.hostname}: ${pt.tmode})` };
    if (t.tmode === 'ipsec') { const c = cryptoCheck(d, t, sip, pd, pt, t.tdst); if (!c.ok) return { up: false, reason: c.reason }; }
    return { up: true, peer, sip };
  }
  function tunSeg(net, dId, n) { const s = tunnel(net, dId, n); return s.up ? { eps: [s.peer], notes: [] } : { eps: [], notes: [s.reason] }; }
  function cryptoSide(d, t, peerIp) {
    const h = d.cfg.hostname;
    if (!t.tprot) return { err: `${h}: "tunnel protection ipsec profile" fehlt am Tunnel` };
    const ipp = blk(d, 'crypto ipsec profile', t.tprot); if (!ipp) return { err: `${h}: IPsec-Profil "${t.tprot}" existiert nicht` };
    const tsn = bval(ipp, 'set transform-set'); if (!tsn) return { err: `${h}: IPsec-Profil ${t.tprot} hat kein "set transform-set"` };
    const ts = blk(d, 'crypto ipsec transform-set', tsn); if (!ts) return { err: `${h}: Transform-Set "${tsn}" existiert nicht` };
    const tsv = words(ts.head).slice(4).sort().join(' ');
    const ikn = bval(ipp, 'set ikev2-profile'); if (!ikn) return { err: `${h}: IPsec-Profil ${t.tprot} hat kein "set ikev2-profile"` };
    const ik = blk(d, 'crypto ikev2 profile', ikn); if (!ik) return { err: `${h}: IKEv2-Profil "${ikn}" existiert nicht` };
    const lw = ik.lines.map(l => l.toLowerCase());
    if (!lw.some(l => l.startsWith('match identity remote address ' + peerIp))) return { err: `${h}: IKEv2-Profil ${ikn} – "match identity remote address ${peerIp}" fehlt` };
    if (!lw.includes('authentication remote pre-share') || !lw.includes('authentication local pre-share')) return { err: `${h}: IKEv2-Profil ${ikn} – "authentication local pre-share" und "authentication remote pre-share" nötig` };
    const krn = bval(ik, 'keyring local'); if (!krn) return { err: `${h}: IKEv2-Profil ${ikn} – "keyring local NAME" fehlt` };
    const kr = blk(d, 'crypto ikev2 keyring', krn); if (!kr) return { err: `${h}: Keyring "${krn}" existiert nicht` };
    let cur = null; const peers = [];
    for (const l of kr.lines) { const w = l.split(/\s+/); const k = w[0].toLowerCase(); if (k === 'peer') { cur = {}; peers.push(cur); } else if (cur && k === 'address') cur.addr = w[1]; else if (cur && k === 'pre-shared-key') cur.key = w[w.length - 1]; }
    const pe = peers.find(p => p.addr === peerIp); if (!pe) return { err: `${h}: Keyring ${krn} hat keinen Peer mit "address ${peerIp}"` };
    if (!pe.key) return { err: `${h}: Keyring ${krn} – "pre-shared-key" fehlt` };
    const props = blocks(d, 'crypto ikev2 proposal').map(b => ({ name: b.head.split(/\s+/)[3], enc: words(bval(b, 'encryption')), integ: words(bval(b, 'integrity')), group: words(bval(b, 'group')) }));
    const used = new Set(); blocks(d, 'crypto ikev2 policy').forEach(b => b.lines.forEach(l => { const w = l.split(/\s+/); if (w[0].toLowerCase() === 'proposal') used.add(w[1]); }));
    const act = props.filter(p => used.has(p.name));
    if (!act.length) return { err: `${h}: keine IKEv2-Policy, die ein vorhandenes Proposal verwendet ("crypto ikev2 policy" → "proposal NAME")` };
    for (const p of act) if (!p.enc.length || !p.integ.length || !p.group.length) return { err: `${h}: Proposal ${p.name} ist unvollständig (encryption, integrity und group nötig)` };
    return { tsv, key: pe.key, props: act };
  }
  const inter = (a, b) => a.some(x => b.includes(x));
  function cryptoCheck(da, ta, aIp, db, tb, bIp) {
    const A = cryptoSide(da, ta, bIp); if (A.err) return { ok: false, reason: A.err };
    const B = cryptoSide(db, tb, aIp); if (B.err) return { ok: false, reason: B.err };
    if (!A.props.some(p => B.props.some(q => inter(p.enc, q.enc) && inter(p.integ, q.integ) && inter(p.group, q.group))))
      return { ok: false, reason: 'IKE_SA_INIT fehlgeschlagen: keine übereinstimmenden Proposals (encryption / integrity / group)' };
    if (A.key !== B.key) return { ok: false, reason: 'IKE_AUTH fehlgeschlagen: die Pre-Shared-Keys stimmen nicht überein' };
    if (A.tsv !== B.tsv) return { ok: false, reason: 'CHILD_SA fehlgeschlagen: die IPsec-Transform-Sets stimmen nicht überein' };
    return { ok: true };
  }

  // ---------- show output ----------
  function vlStr(a) { if (a === null) return 'all'; if (!a.length) return 'none'; const s = a.slice().sort((x, y) => x - y), o = []; let i = 0; while (i < s.length) { let j = i; while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++; o.push(j > i + 1 ? s[i] + '-' + s[j] : (j === i + 1 ? s[i] + ',' + s[j] : '' + s[i])); i = j + 1; } return o.join(','); }
  function parseVl(str) {
    const out = [];
    for (const p of String(str).split(',')) { const m = p.match(/^(\d+)(?:-(\d+))?$/); if (!m) return null; const a = +m[1], b = m[2] ? +m[2] : a; if (a < 1 || b > 4094 || b < a) return null; for (let v = a; v <= b; v++) if (!out.includes(v)) out.push(v); }
    return out;
  }
  function runcfg(net, d) {
    const c = d.cfg, o = ['Building configuration...', '', 'Current configuration:', '!', 'hostname ' + c.hostname, '!'];
    if (c.lines.length) { c.lines.forEach(l => o.push(l)); o.push('!'); }
    if (d.type === 'switch' && c.ipRouting) o.push('ip routing', '!');
    if (d.type === 'switch') Object.keys(c.vlans).map(Number).sort((a, b) => a - b).forEach(v => { if (v === 1) return; o.push('vlan ' + v); if (c.vlans[v] !== 'VLAN' + String(v).padStart(4, '0')) o.push(' name ' + c.vlans[v]); o.push('!'); });
    c.blocks.filter(b => !b.head.startsWith('line ')).forEach(b => { o.push(b.head); b.lines.forEach(l => o.push(' ' + l)); o.push('!'); });
    for (const n of natSort(Object.keys(c.ifs))) {
      const i = c.ifs[n]; o.push('interface ' + n);
      if (i.desc) o.push(' description ' + i.desc);
      if (i.encap !== null) o.push(' encapsulation dot1Q ' + i.encap);
      if (d.type === 'switch' && !n.startsWith('Vlan')) {
        if (i.mode === 'trunk') { if (i.native !== 1) o.push(' switchport trunk native vlan ' + i.native); if (i.allowed !== null) o.push(' switchport trunk allowed vlan ' + vlStr(i.allowed)); o.push(' switchport mode trunk'); }
        else { if (i.vlan !== 1) o.push(' switchport access vlan ' + i.vlan); if (i.modeSet) o.push(' switchport mode access'); }
      }
      if (i.ip) o.push(` ip address ${i.ip} ${i.mask}`); else if (d.type === 'router' || n.startsWith('Vlan')) o.push(' no ip address');
      if (i.helper) o.push(' ip helper-address ' + i.helper);
      if (i.cg) o.push(` channel-group ${i.cg.n} mode ${i.cg.mode}`);
      if (i.aclIn) o.push(' ip access-group ' + i.aclIn + ' in'); if (i.aclOut) o.push(' ip access-group ' + i.aclOut + ' out');
      if (i.tsrc) o.push(' tunnel source ' + i.tsrc); if (i.tdst) o.push(' tunnel destination ' + i.tdst);
      if (n.startsWith('Tunnel') && i.tmode === 'ipsec') o.push(' tunnel mode ipsec ipv4'); if (i.tprot) o.push(' tunnel protection ipsec profile ' + i.tprot);
      i.extra.forEach(l => o.push(' ' + l));
      if (i.shutdown) o.push(' shutdown');
      o.push('!');
    }
    c.routes.forEach(r => o.push(`ip route ${r.net} ${r.mask} ${r.ifn || r.nh}`));
    if (c.gw && d.type === 'switch') o.push('ip default-gateway ' + c.gw);
    for (const a in c.acls) c.acls[a].forEach(e => o.push('access-list ' + a + ' ' + e.text));
    o.push('!');
    c.blocks.filter(b => b.head.startsWith('line ')).forEach(b => { o.push(b.head); b.lines.forEach(l => o.push(' ' + l)); });
    o.push('!', 'end');
    return o.join('\n');
  }
  const pad = (s, n) => String(s).padEnd(n).slice(0, Math.max(n, String(s).length));
  // ---------- Firewall (ASA-Stil) ----------
  const PORTN = { www: 80, http: 80, https: 443, ssh: 22, telnet: 23, domain: 53, ftp: 21, smtp: 25, pop3: 110, imap4: 143, ntp: 123, snmp: 161, ldap: 389, ldaps: 636, syslog: 514, rdp: 3389 };
  const PNAME = { 80: 'www', 443: 'https', 22: 'ssh', 23: 'telnet', 53: 'domain', 21: 'ftp', 25: 'smtp' };
  const portNum = w => PORTN[w] || (/^\d+$/.test(w || '') ? +w : null);
  const maskWc = m => n2ip((~ip2n(m)) >>> 0);
  const ifByName = (c, nm) => Object.keys(c.ifs).find(k => c.ifs[k].nameif === nm);
  function asaAcl(c, t) {
    const name = t[1]; const r = t.slice(2).map(x => x.toLowerCase());
    if (r[0] === 'remark') return '';
    let k = 0; if (r[k] === 'extended') k++;
    const action = r[k++]; if (!['permit', 'deny'].includes(action)) return null;
    const proto = r[k++]; if (!['ip', 'icmp', 'tcp', 'udp'].includes(proto)) return '% Protokoll: ip, icmp, tcp oder udp';
    const spec = () => {
      const w = r[k];
      if (w === 'any' || w === 'any4') { k++; return { any: true, txt: 'any' }; }
      if (w === 'host') { const ip = r[k + 1]; if (!validIp(ip || '')) return null; k += 2; return { ip, wc: '0.0.0.0', txt: 'host ' + ip }; }
      if (validIp(w || '') && validIp(r[k + 1] || '') && maskLen(r[k + 1]) !== null) { const ip = w, m = r[k + 1]; k += 2; return { ip, wc: maskWc(m), txt: ip + ' ' + m }; }
      return null;
    };
    const src = spec(); if (!src) return '% Quelle: any, host <IP> oder <Netz> <Netzmaske> (ASA nutzt Netzmasken, keine Wildcards)';
    const dst = spec(); if (!dst) return '% Ziel: any, host <IP> oder <Netz> <Netzmaske>';
    let dport = null; if (r[k] === 'eq') { dport = portNum(r[k + 1]); if (!dport) return '% Unbekannter Port'; k += 2; }
    if (dport && !['tcp', 'udp'].includes(proto)) return '% Ports gibt es nur bei tcp und udp';
    const text = [action, proto, src.txt, dst.txt, dport ? 'eq ' + (PNAME[dport] || dport) : null].filter(Boolean).join(' ');
    (c.acls[name] = c.acls[name] || []).push({ action, ext: true, proto, src, dst, dport, text }); return '';
  }
  function fwConf(d, s, t) {
    const c = d.cfg, lw = t.map(x => x.toLowerCase());
    if (M(t, 'access-list') && t.length > 2) return asaAcl(c, t);
    if (M(t, 'access-group') && t.length >= 5) {
      if (lw[2] !== 'in' || !'interface'.startsWith(lw[3])) return '% Syntax: access-group <ACL> in interface <nameif>';
      const n = ifByName(c, t[4]); if (!n) return `% Interface-Name "${t[4]}" unbekannt (nameif am Interface fehlt)`;
      if (!c.acls[t[1]]) return `% ACL ${t[1]} existiert nicht`; c.ifs[n].aclIn = t[1]; return '';
    }
    if (M(t, 'no', 'access-group') && t.length >= 6) { const n = ifByName(c, t[5]); if (n) c.ifs[n].aclIn = null; return ''; }
    if (M(t, 'route') && t.length >= 5) {
      const n = ifByName(c, t[1]); if (!n) return `% Interface-Name "${t[1]}" unbekannt`;
      const [, , net, mask, gw] = t; if (!validIp(net) || maskLen(mask) === null || !validIp(gw || '')) return '% Syntax: route <nameif> <Netz> <Maske> <Gateway>';
      const i = c.ifs[n]; if (!i.ip || !inNet(gw, i.ip, i.mask)) return `% Gateway ${gw} liegt nicht im Subnetz von ${t[1]}`;
      c.routes = c.routes.filter(q => !(q.net === net && q.mask === mask && q.nh === gw)); c.routes.push({ net, mask, nh: gw, ifn: null, via: t[1] }); return '';
    }
    if (M(t, 'no', 'route') && t.length >= 6) { c.routes = c.routes.filter(q => !(q.net === t[3] && q.mask === t[4] && q.nh === t[5])); return ''; }
    if (M(t, 'nat') && /^\(.+,.+\)$/.test(t[1] || '')) {
      const m = t[1].match(/^\((.+),(.+)\)$/);
      if (!(lw[2] === 'source' && lw[3] === 'dynamic' && lw[4] === 'any' && lw[5] === 'interface')) return '% In diesem Simulator: nat (<von>,<nach>) source dynamic any interface';
      if (!ifByName(c, m[1]) || !ifByName(c, m[2])) return '% nameif unbekannt';
      c.nat = c.nat.filter(n => !(n.from === m[1] && n.to === m[2])); c.nat.push({ from: m[1], to: m[2] }); return '';
    }
    if (M(t, 'no', 'nat') && /^\(.+,.+\)$/.test(t[2] || '')) { const m = t[2].match(/^\((.+),(.+)\)$/); c.nat = c.nat.filter(n => !(n.from === m[1] && n.to === m[2])); return ''; }
    if (M(t, 'dhcpd') && t[1]) {
      const dd = c.dhcpd = c.dhcpd || { pools: {}, dns: null }, neg0 = false;
      if (lw[1] === 'address') { const m = (t[2] || '').match(/^(\d+\.\d+\.\d+\.\d+)-(\d+\.\d+\.\d+\.\d+)$/); if (!m || !validIp(m[1]) || !validIp(m[2]) || !t[3]) return '% Syntax: dhcpd address <von>-<bis> <nameif>'; if (!ifByName(c, t[3])) return `% Interface-Name "${t[3]}" unbekannt`; dd.pools[t[3]] = Object.assign(dd.pools[t[3]] || { on: false }, { start: m[1], end: m[2] }); return ''; }
      if (lw[1] === 'dns') { if (!validIp(t[2] || '')) return '% Syntax: dhcpd dns <IP-Adresse>'; dd.dns = t[2]; return ''; }
      if (lw[1] === 'enable') { if (!t[2] || !ifByName(c, t[2])) return '% Syntax: dhcpd enable <nameif>'; const p0 = dd.pools[t[2]] = dd.pools[t[2]] || { on: false }; p0.on = true; return ''; }
      return null;
    }
    if (M(t, 'no', 'dhcpd') && lw[2] === 'enable' && t[3]) { const dd = c.dhcpd; if (dd && dd.pools[t[3]]) dd.pools[t[3]].on = false; return ''; }
    if (M(t, 'same-security-traffic', 'permit', 'inter-interface')) { c.sameSec = true; return ''; }
    if (M(t, 'no', 'same-security-traffic')) { c.sameSec = false; return ''; }
    return undefined;
  }
  function runcfgFw(net, d) {
    const c = d.cfg, o = [': Saved', ':', 'ASA Version 9.x (NetLab-Simulation)', '!', 'hostname ' + c.hostname, '!'];
    c.lines.forEach(l => o.push(l)); if (c.sameSec) o.push('same-security-traffic permit inter-interface'); if (c.lines.length || c.sameSec) o.push('!');
    for (const n of natSort(Object.keys(c.ifs))) {
      const i = c.ifs[n]; o.push('interface ' + n);
      if (i.desc) o.push(' description ' + i.desc); if (i.nameif) o.push(' nameif ' + i.nameif); if (i.sl !== null) o.push(' security-level ' + i.sl);
      if (i.ip) o.push(` ip address ${i.ip} ${i.mask}`); else o.push(' no ip address'); if (i.shutdown) o.push(' shutdown'); o.push('!');
    }
    for (const a in c.acls) c.acls[a].forEach(e => o.push(`access-list ${a} extended ${e.text}`));
    for (const n in c.ifs) { const i = c.ifs[n]; if (i.aclIn && i.nameif) o.push(`access-group ${i.aclIn} in interface ${i.nameif}`); }
    if (c.dhcpd) { for (const n in c.dhcpd.pools) { const q = c.dhcpd.pools[n]; if (q.start) o.push(`dhcpd address ${q.start}-${q.end} ${n}`); } if (c.dhcpd.dns) o.push('dhcpd dns ' + c.dhcpd.dns); for (const n in c.dhcpd.pools) if (c.dhcpd.pools[n].on) o.push('dhcpd enable ' + n); }
    c.nat.forEach(n => o.push(`nat (${n.from},${n.to}) source dynamic any interface`));
    c.routes.forEach(r => { const ni = r.via || (Object.values(c.ifs).find(i => i.ip && r.nh && inNet(r.nh, i.ip, i.mask)) || {}).nameif || '?'; o.push(`route ${ni} ${r.net} ${r.mask} ${r.nh}`); });
    o.push('!', 'end'); return o.join('\n');
  }
  const cfgOf = (net, d) => d.fw ? runcfgFw(net, d) : runcfg(net, d);
  function fwBrief(net, d) {
    const o = [pad('Interface', 24) + pad('Name', 11) + pad('Level', 6) + pad('IP-Address', 16) + pad('Status', 22) + 'Protocol'];
    for (const n of natSort(Object.keys(d.cfg.ifs))) { const i = d.cfg.ifs[n], up = ifUp(net, d.id, n); o.push(pad(n, 24) + pad(i.nameif || '-', 11) + pad(i.sl === null ? '-' : i.sl, 6) + pad(i.ip || 'unassigned', 16) + pad(i.shutdown ? 'administratively down' : (up ? 'up' : 'down'), 22) + (up ? 'up' : 'down')); }
    return o.join('\n');
  }
  const natShow = d => d.cfg.nat.length ? d.cfg.nat.map(n => `nat (${n.from},${n.to}) source dynamic any interface`).join('\n') : 'Keine NAT-Regeln konfiguriert.';

  function ipBrief(net, d) {
    const o = [pad('Interface', 23) + pad('IP-Address', 16) + 'OK? Method ' + pad('Status', 22) + 'Protocol'];
    for (const n of natSort(Object.keys(d.cfg.ifs))) {
      const i = d.cfg.ifs[n]; const up = ifUp(net, d.id, n);
      const st = i.shutdown ? 'administratively down' : (up ? 'up' : 'down');
      o.push(pad(n, 23) + pad(i.ip || 'unassigned', 16) + 'YES ' + pad(i.ip ? 'manual' : 'unset', 7) + pad(st, 22) + (up ? 'up' : 'down'));
    }
    return o.join('\n');
  }
  function vlanBrief(d) {
    const o = [pad('VLAN', 5) + pad('Name', 33) + pad('Status', 10) + 'Ports', '---- -------------------------------- --------- -------------------------------'];
    for (const v of Object.keys(d.cfg.vlans).map(Number).sort((a, b) => a - b)) {
      const ports = natSort(d.ports.filter(p => d.cfg.ifs[p].mode !== 'trunk' && d.cfg.ifs[p].vlan === v)).map(sh).join(', ');
      o.push(pad(v, 5) + pad(d.cfg.vlans[v], 33) + pad('active', 10) + ports);
    }
    return o.join('\n');
  }
  function trunkShow(net, d) {
    const t = d.ports.filter(p => d.cfg.ifs[p].mode === 'trunk');
    if (!t.length) return '';
    const o = [pad('Port', 10) + pad('Mode', 13) + pad('Encapsulation', 15) + pad('Status', 13) + 'Native vlan'];
    t.forEach(p => o.push(pad(sh(p), 10) + pad('on', 13) + pad('802.1q', 15) + pad(linkUp(net, d.id, p) ? 'trunking' : 'not-connect', 13) + d.cfg.ifs[p].native));
    o.push('', pad('Port', 10) + 'Vlans allowed on trunk'); t.forEach(p => o.push(pad(sh(p), 10) + (d.cfg.ifs[p].allowed === null ? '1-4094' : vlStr(d.cfg.ifs[p].allowed))));
    return o.join('\n');
  }
  function routeShow(net, d) {
    const o = ['Codes: C - connected, S - static, * - candidate default', ''];
    const def = d.cfg.routes.find(r => r.net === '0.0.0.0' && r.mask === '0.0.0.0');
    o.push(def ? `Gateway of last resort is ${def.nh || def.ifn} to network 0.0.0.0` : 'Gateway of last resort is not set', '');
    if (d.type === 'switch' && !d.cfg.ipRouting) return o.concat(['% IP routing ist auf diesem Switch nicht aktiv (ip routing)']).join('\n');
    l3(net, d.id).forEach(i => o.push(`C     ${n2ip(netN(i.ip, i.mask))}/${maskLen(i.mask)} is directly connected, ${i.ifn}`));
    d.cfg.routes.forEach(r => o.push(`S${r.net === '0.0.0.0' ? '*' : ' '}    ${r.net}/${maskLen(r.mask)} [1/0] via ${r.nh || r.ifn}`));
    return o.join('\n');
  }
  function cryptoShow(net, d) {
    const t = Object.keys(d.cfg.ifs).filter(n => n.startsWith('Tunnel'));
    if (!t.length) return 'Keine Tunnel-Interfaces konfiguriert.';
    return t.map(n => { const s = tunnel(net, d.id, n); const i = d.cfg.ifs[n]; return `Interface: ${n}\nSession status: ${s.up ? 'UP-ACTIVE' : 'DOWN'}\nPeer: ${i.tdst || '-'}  Modus: ${i.tmode === 'ipsec' ? 'IPsec (VTI)' : 'GRE'}` + (s.up ? '' : `\n[Debug] ${s.reason}`); }).join('\n\n');
  }
  function aclShow(d) {
    const ks = Object.keys(d.cfg.acls); if (!ks.length) return '';
    return ks.map(a => `${d.fw || isNaN(+a) || +a >= 100 ? 'Extended' : 'Standard'} IP access list ${a}\n` + d.cfg.acls[a].map((e, i) => `    ${(i + 1) * 10} ${e.text}`).join('\n')).join('\n');
  }

  function ptype(d, p) { const k = d.pk && d.pk[p]; if (!k || k === 'rj45') return '10/100/1000BaseTX'; if (d.xcvr && d.xcvr[p]) return XCVR[d.xcvr[p]].label; return 'Not Present'; }
  function ifStatus(net, d) {
    const o = [pad('Port', 11) + pad('Name', 19) + pad('Status', 13) + pad('Vlan', 11) + pad('Duplex', 7) + pad('Speed', 7) + 'Type'];
    for (const p of d.ports) {
      const i = d.cfg.ifs[p], s = portStatus(net, d.id, p);
      let type = ptype(d, p); if (s.link && (s.link.cable === 'dac')) type = 'DAC (passiv)';
      const vl = d.type === 'switch' ? (i.mode === 'trunk' ? 'trunk' : String(i.vlan)) : 'routed';
      const spd = s.st === 'connected' ? (s.speed >= 10000 ? 'a-' + s.speed / 1000 + 'G' : 'a-1000') : 'auto';
      o.push(pad(sh(p), 11) + pad((i.desc || '').slice(0, 18), 19) + pad(s.st, 13) + pad(vl, 11) + pad(s.st === 'connected' ? 'a-full' : 'auto', 7) + pad(spd, 7) + type);
    }
    return o.join('\n');
  }
  function stpShow(net, d, u) {
    STPTICK++;
    const vs = u[1] === 'vlan' && u[2] ? (parseVl(u[2]) || []) : Object.keys(d.cfg.vlans).map(Number).sort((a, b) => a - b);
    if (u[1] === 'summary') { const off = stpCfg(d).off; return ['Switch is in ' + stpCfg(d).mode + ' mode', ...vs.map(v => pad('VLAN' + String(v).padStart(4, '0'), 10) + (off.has(v) ? 'Spanning Tree DEAKTIVIERT' : 'aktiv'))].join('\n'); }
    if (u[1] === 'root') { return [pad('Vlan', 14) + pad('Root ID', 26) + pad('Cost', 6) + 'Root Port', ...vs.map(v => { const r = stp(net, v), x = r.sw[d.id]; return x ? pad('VLAN' + String(v).padStart(4, '0'), 14) + pad(x.rootBid[0] + ' ' + x.rootBid[1], 26) + pad(x.cost, 6) + (x.rp ? sh(x.rp) : 'Dieser Switch ist die Root') : pad('VLAN' + String(v).padStart(4, '0'), 14) + 'kein STP'; })].join('\n'); }
    const out = [];
    for (const v of vs) {
      const r = stp(net, v), x = r.sw[d.id], tag = 'VLAN' + String(v).padStart(4, '0'); if (!d.cfg.vlans[v]) { out.push('Spanning tree instance(s) for vlan ' + v + ' does not exist.'); continue; }
      if (!x) { out.push(tag, stpCfg(d).off.has(v) ? '  Spanning tree ist für dieses VLAN DEAKTIVIERT (no spanning-tree vlan ' + v + ')' : '  Keine Spanning-Tree-Teilnehmer (kein Link in diesem VLAN)', ''); continue; }
      const proto = x.mode === 'pvst' ? 'ieee' : 'rstp';
      out.push(tag, `  Spanning tree enabled protocol ${proto}`, `  Root ID    Priority    ${x.rootBid[0]}`, `             Address     ${x.rootBid[1]}`, x.root ? '             Dieser Switch ist die Root' : `             Cost        ${x.cost}\n             Port        ${sh(x.rp)}`, `  Bridge ID  Priority    ${x.bid[0]}  (priority ${x.prio} sys-id-ext ${v})`, `             Address     ${x.bid[1]}`, '',
        pad('Interface', 14) + pad('Role', 6) + pad('Sts', 5) + pad('Cost', 6) + 'Type');
      Object.keys(x.ports).sort((a, b) => d.ports.indexOf(a) - d.ports.indexOf(b)).forEach(p => { const q = x.ports[p]; out.push(pad(sh(p), 14) + pad(q.role === 'desg' ? 'Desg' : q.role === 'root' ? 'Root' : 'Altn', 6) + pad(q.sts, 5) + pad(q.cost, 6) + 'P2p'); });
      out.push('');
    }
    return out.join('\n').trim();
  }
  function ecShow(net, d) {
    const groups = {}; d.ports.forEach(p => { const i = d.cfg.ifs[p]; if (i.cg) (groups[i.cg.n] = groups[i.cg.n] || []).push(p); });
    const ns = Object.keys(groups).map(Number).sort((a, b) => a - b); if (!ns.length) return 'Es ist kein Port-Channel konfiguriert (channel-group am Port).';
    const o = ['Flags:  D - down   P - bundled in port-channel   s - suspended   I - stand-alone', '', 'Number of channel-groups in use: ' + ns.length, '', pad('Group', 7) + pad('Port-channel', 15) + pad('Protocol', 10) + 'Ports'];
    ns.forEach(n => { const b = bundleOf(net, d, groups[n][0]), prot = { on: 'none', active: 'LACP', passive: 'LACP', desirable: 'PAgP', auto: 'PAgP' }[d.cfg.ifs[groups[n][0]].cg.mode]; o.push(pad(n, 7) + pad(`Po${n}(${b && b.ok ? 'SU' : b && b.partial ? 'SD' : 'SD'})`, 15) + pad(prot, 10) + groups[n].map(p => `${sh(p)}(${b && b.ok ? 'P' : b && b.partial ? 'D' : 's'})`).join(' ')); if (b && !b.ok && b.reason) o.push(pad('', 7) + '  → ' + b.reason); });
    return o.join('\n');
  }
  function cdpShow(net, d) {
    const o = ['Capability Codes: R - Router, S - Switch, H - Host, P - Phone', '', pad('Device ID', 17) + pad('Local Intrfce', 18) + pad('Holdtme', 9) + pad('Capability', 12) + pad('Platform', 16) + 'Port ID'];
    for (const p of d.ports) {
      const s = portStatus(net, d.id, p); if (s.st !== 'connected') continue;
      const pd = net.devs[s.peer.dev]; if (pd.type !== 'switch' && pd.type !== 'router' && pd.icon !== 'phone') continue;
      const cap = pd.type === 'switch' ? 'S I' : pd.type === 'router' ? 'R' : 'H P';
      o.push(pad(pd.cfg.hostname, 17) + pad(sh(p), 18) + pad('163', 9) + pad(cap, 12) + pad((pd.model || (pd.icon === 'phone' ? 'IP-Phone' : pd.type)).slice(0, 15), 16) + sh(s.peer.port));
    }
    return o.join('\n');
  }
  function invShow(d) {
    const M = d.model && MODELS[d.model];
    const o = [`NAME: "1", DESCR: "${M ? 'Cisco ' + M.label + ' – ' + M.info : d.type}"`, `PID: ${d.model || '-'}`];
    for (const p in (d.xcvr || {})) if (d.xcvr[p]) o.push('', `NAME: "${p}", DESCR: "${XCVR[d.xcvr[p]].label}"`, `PID: ${d.xcvr[p]}`);
    return o.join('\n');
  }
  function exportCfg(net, d) {
    const M = d.model && MODELS[d.model];
    const head = ['! ' + '='.repeat(60), '! Hostname : ' + d.cfg.hostname, '! Modell   : ' + (M ? 'Cisco ' + M.label : d.type), '! Erstellt : NetLab Netzplaner, ' + new Date().toLocaleString('de-DE'),
      '! Hinweis  : vor dem Einspielen prüfen – Passwörter und Keys ersetzen,', '!            Interface-Namen mit der echten Hardware abgleichen.', '! ' + '='.repeat(60)];
    const body = cfgOf(net, d).split('\n'); return head.concat(d.fw ? body : body.slice(3)).join('\n') + '\n';
  }

  // ---------- CLI ----------
  const INV = "% Invalid input detected at '^' marker.";
  const M = (t, ...ws) => { if (t.length < ws.length) return false; for (let i = 0; i < ws.length; i++) { const tok = (t[i] || '').toLowerCase(); if (!tok || !ws[i].split('|').some(w => w.startsWith(tok))) return false; } return true; };
  const newSess = () => ({ mode: 'user', ifs: [], blk: null, sub: 0, vl: [] });
  function prompt(d, s) {
    const h = d.cfg.hostname; if (isHost(d)) return h + '> ';
    const m = { user: '>', priv: '#', conf: '(config)#', if: '(config-if)#', range: '(config-if-range)#', subif: '(config-subif)#', vlan: '(config-vlan)#' };
    if (s.mode === 'blk') return h + '(' + (s.sub ? s.blkp + '-peer' : s.blkp) + ')# ';
    return h + m[s.mode] + ' ';
  }
  // block-mode vocabulary: first word -> [allowed, pos1, pos2, pos3]
  const BV = {
    proposal: { encryption: [], integrity: [], group: [], prf: [] },
    policy: { proposal: [], match: [] },
    keyring: { peer: [], address: [], 'pre-shared-key': [['local', 'remote']], description: [], identity: [] },
    profile: { match: [['identity', 'fvrf'], ['remote', 'local'], ['address', 'fqdn']], authentication: [['local', 'remote']], keyring: [['local']], lifetime: [], dpd: [], identity: [] },
    ipsecprofile: { set: [['transform-set', 'ikev2-profile', 'pfs', 'security-association']] },
    transform: { mode: [['tunnel', 'transport']] },
    radius: { address: [['ipv4']], key: [], timeout: [], 'automate-tester': [] },
    line: { transport: [['input', 'output']], login: [['local', 'authentication']], password: [], 'exec-timeout': [], 'logging': [], 'access-class': [], privilege: [] },
    aaagroup: { server: [['name']] },
    dhcppool: { network: [], 'default-router': [], 'dns-server': [], lease: [], 'domain-name': [] }
  };
  const REPL = { transport: 2, login: 1, password: 1, address: 1, key: 1, encryption: 1, integrity: 1, group: 1, set: 2, keyring: 2, 'pre-shared-key': 1, mode: 1, 'exec-timeout': 1, network: 1, 'default-router': 1, 'dns-server': 1, lease: 1, 'domain-name': 1 };
  function expand(tokens, vocab) {
    const t = tokens.slice(); const firsts = Object.keys(vocab);
    const pick = (tok, list) => { const lt = tok.toLowerCase(); if (list.includes(lt)) return lt; const m = list.filter(w => w.startsWith(lt)); return m.length === 1 ? m[0] : null; };
    const f = pick(t[0], firsts); if (!f) return null; t[0] = f;
    (vocab[f] || []).forEach((lst, k) => { if (t[k + 1]) { const x = pick(t[k + 1], lst); if (x) t[k + 1] = x; } });
    return t;
  }
  const IFX = { authentication: [['port-control', 'host-mode', 'order', 'priority', 'periodic'], ['auto', 'force-authorized', 'force-unauthorized', 'multi-auth', 'multi-domain', 'single-host']], dot1x: [['pae', 'timeout'], ['authenticator']], mab: [], 'spanning-tree': [['portfast', 'bpduguard', 'guard', 'cost', 'port-priority', 'vlan', 'link-type'], ['enable', 'disable', 'root']], 'storm-control': [], speed: [], mtu: [], 'priority-flow-control': [['mode'], ['on', 'off', 'auto']], duplex: [], cdp: [['enable']], lldp: [['transmit', 'receive']] };
  const GL = ['no spanning-tree vlan ', 'ip dhcp excluded-address ', 'aaa ', 'dot1x system-auth-control', 'enable secret ', 'enable password ', 'service ', 'username ', 'ip domain-name ', 'ip domain name ', 'banner ', 'snmp-server ', 'ntp server ', 'logging ', 'ip ssh ', 'spanning-tree ', 'no cdp run', 'cdp run', 'lldp run', 'no ip http server', 'no ip http secure-server', 'ip dhcp snooping', 'device-tracking', 'radius-server ', 'authentication ', 'no service '];
  const GREPL = ['enable secret', 'enable password', 'ip domain-name', 'ip domain name', 'banner motd', 'ip ssh version', 'aaa authentication dot1x', 'aaa authorization network', 'aaa accounting dot1x', 'spanning-tree mode'];

  function exec(net, dId, s, raw) {
    const d = net.devs[dId]; const line = raw.trim().replace(/\s+/g, ' ');
    if (!line || line.startsWith('!')) return '';
    if (isHost(d)) return hostExec(net, d, line);
    if (d.type === 'fc') return '% FC-Switch: CLI wird nicht simuliert – Ports, Transceiver und Zoning im Netzplaner einstellen.';
    if (line.endsWith('?')) return help(d, s);
    const t = line.split(' ');
    if (!['user', 'priv'].includes(s.mode) && M(t, 'do') && t.length > 1) return execMode(net, d, s, t.slice(1), true);
    if (['user', 'priv'].includes(s.mode)) return execMode(net, d, s, t, false);
    if (M(t, 'end')) { s.mode = 'priv'; s.sub = 0; return ''; }
    let r;
    if (s.mode === 'conf') r = conf(net, d, s, t, line);
    else if (s.mode === 'vlan') r = vlanc(d, s, t, line);
    else if (s.mode === 'blk') r = blkc(d, s, t, line);
    else r = ifc(net, d, s, t, line);
    if (r === null) return INV;
    if (d.saved && !t[0].toLowerCase().startsWith('ex')) d.saved = false;
    return r;
  }
  function execMode(net, d, s, t, fromConf) {
    const priv = s.mode !== 'user' || fromConf;
    if (!fromConf && M(t, 'enable')) { s.mode = 'priv'; return ''; }
    if (!fromConf && M(t, 'disable')) { s.mode = 'user'; return ''; }
    if (!fromConf && (M(t, 'exit') || M(t, 'logout'))) { s.mode = 'user'; return ''; }
    if (priv && !fromConf && M(t, 'configure') && (t.length === 1 || M(t.slice(1), 'terminal'))) { s.mode = 'conf'; return 'Enter configuration commands, one per line.  End with CNTL/Z.'; }
    if (priv && (M(t, 'write') || M(t, 'copy', 'running-config', 'startup-config'))) { d.saved = true; d.startup = JSON.stringify(d.cfg); return 'Building configuration...\n[OK]'; }
    if (M(t, 'ping') && t[1]) return pingOut(net, d, t[1]);
    if (M(t, 'traceroute') && t[1]) return traceOut(net, d, t[1]);
    if (M(t, 'show')) {
      const u = t.slice(1);
      if (priv && M(u, 'running-config')) return cfgOf(net, d);
      if (d.fw && M(u, 'interface', 'ip', 'brief')) return fwBrief(net, d);
      if (d.fw && M(u, 'nameif')) return fwBrief(net, d);
      if (d.fw && M(u, 'nat')) return natShow(d);
      if (d.fw && M(u, 'route')) return routeShow(net, d);
      if (M(u, 'ip', 'interface')) return ipBrief(net, d);
      if (d.type === 'switch' && M(u, 'spanning-tree')) return stpShow(net, d, u.map(x => x.toLowerCase()));
      if (d.type === 'switch' && M(u, 'etherchannel')) return ecShow(net, d);
      if (M(u, 'ip', 'route')) return routeShow(net, d);
      if (!d.fw && M(u, 'ip', 'dhcp', 'binding')) { const rows = []; for (const pn in (d.leases || {})) for (const cid in d.leases[pn]) rows.push(pad(d.leases[pn][cid], 16) + pad(net.devs[cid] ? net.devs[cid].cfg.hostname : cid, 18) + 'Automatic (Pool ' + pn + ')'); return ['Bindings from all pools not associated with VRF:', pad('IP address', 16) + pad('Client', 18) + 'Type', ...rows].join('\n'); }
      if (!d.fw && M(u, 'ip', 'dhcp', 'pool')) { const ps = blocks(d, 'ip dhcp pool'); if (!ps.length) return 'Kein DHCP-Pool konfiguriert (ip dhcp pool <Name>).'; return ps.map(b => { const nm = b.head.split(' ')[3], n = bval(b, 'network'), lc = d.leases && d.leases[nm] ? Object.keys(d.leases[nm]).length : 0; return `Pool ${nm} :\n Network               : ${n || '–'}\n Default router        : ${bval(b, 'default-router') || '–'}\n DNS server            : ${bval(b, 'dns-server') || '–'}\n Aktive Leases         : ${lc}`; }).join('\n\n'); }
      if (d.fw && M(u, 'dhcpd')) { const dd = d.cfg.dhcpd; if (!dd || !Object.keys(dd.pools).length) return 'DHCP-Server ist nicht konfiguriert (dhcpd address / dhcpd enable).'; const rows = []; for (const pn in (d.leases || {})) for (const cid in d.leases[pn]) rows.push(pad(d.leases[pn][cid], 16) + (net.devs[cid] ? net.devs[cid].cfg.hostname : cid) + '  (' + pn + ')'); return Object.entries(dd.pools).map(([n, q]) => `Interface ${n}: ${q.on ? 'aktiviert' : 'nicht aktiviert'}, Bereich ${q.start || '–'}-${q.end || '–'}`).join('\n') + (rows.length ? '\n\nBindings:\n' + rows.join('\n') : '');}
      if (d.type === 'switch' && M(u, 'vlan')) return vlanBrief(d);
      if (d.type === 'switch' && M(u, 'interfaces', 'trunk')) return trunkShow(net, d);
      if (M(u, 'access-lists')) return aclShow(d);
      if (M(u, 'interfaces', 'status')) return ifStatus(net, d);
      if (M(u, 'cdp', 'neighbors')) return cdpShow(net, d);
      if (M(u, 'inventory')) return invShow(d);
      if (d.type === 'router' && M(u, 'crypto')) return cryptoShow(net, d);
      if (M(u, 'version')) return 'Cisco IOS Software (NetLab Simulation), Version 15.x\n' + d.cfg.hostname + ' uptime is 3 hours';
      if (M(u, 'history')) return '(siehe Pfeiltaste ↑)';
      return INV;
    }
    if (!priv && M(t, 'configure')) return '% Erst in den privilegierten Modus wechseln: enable';
    return INV;
  }
  function conf(net, d, s, t, line) {
    const sw = d.type === 'switch', rt = d.type === 'router', c = d.cfg;
    const low = line.toLowerCase();
    if (d.fw) { const fr = fwConf(d, s, t); if (fr !== undefined) return fr; }
    if (M(t, 'exit')) { s.mode = 'priv'; return ''; }
    if (M(t, 'hostname') && t[1]) { c.hostname = t[1]; return ''; }
    if (!d.fw && M(t, 'ip', 'dhcp', 'pool') && t[3]) { if (d.type === 'switch' && !d.cfg.ipRouting && false) return null; return enterBlk(c, s, `ip dhcp pool ${t[3]}`, 'dhcppool', 'dhcp-config'); }
    if (!d.fw && M(t, 'no', 'ip', 'dhcp', 'pool') && t[4]) { c.blocks = c.blocks.filter(b => b.head !== `ip dhcp pool ${t[4]}`); return ''; }
    if (M(t, 'no', 'interface') && t[2]) {
      const n = normIf(t.slice(2).join('')); if (!n || !c.ifs[n]) return `% Interface ${t[2]} gibt es nicht`;
      if (!(n.startsWith('Vlan') || n.startsWith('Port-channel') || n.startsWith('Loopback') || n.startsWith('Tunnel') || (n.includes('.') && !d.ports.includes(n)))) return '% Physische Schnittstellen lassen sich nicht löschen';
      if (n === 'Vlan1') return '% Vlan1 lässt sich nicht löschen';
      if (n.startsWith('Port-channel')) d.ports.forEach(q => { const i = c.ifs[q]; if (i.cg && 'Port-channel' + i.cg.n === n) i.cg = null; });
      delete c.ifs[n]; return '';
    }
    if (M(t, 'interface') && t[1]) {
      if (M(t.slice(1), 'range')) {
        const spec = t.slice(2).join('').toLowerCase(); const out = [];
        for (const part of spec.split(',')) {
          const m = part.match(/^(.*\/)(\d+)-(\d+)$/);
          if (m) { for (let k = +m[2]; k <= +m[3]; k++) { const n = normIf(m[1] + k); if (!n || !c.ifs[n]) return '% Interface ' + (n || part) + ' gibt es nicht'; out.push(n); } }
          else { const n = normIf(part); if (!n || !c.ifs[n]) return '% Interface ' + (n || part) + ' gibt es nicht'; out.push(n); }
        }
        s.ifs = out; s.mode = 'range'; return '';
      }
      const n = normIf(t.slice(1).join('')); if (!n) return null;
      if (!c.ifs[n]) {
        if (sw && (n.startsWith('Vlan') || n.startsWith('Port-channel'))) c.ifs[n] = Object.assign(newIf('switch'), { shutdown: false });
        else if (rt && (n.startsWith('Tunnel') || n.startsWith('Loopback'))) c.ifs[n] = Object.assign(newIf('router'), { shutdown: false });
        else if (rt && n.includes('.') && c.ifs[n.split('.')[0]]) c.ifs[n] = Object.assign(newIf('router'), { shutdown: false });
        else return `% Interface ${n} gibt es auf diesem Gerät nicht`;
      }
      s.ifs = [n]; s.mode = n.includes('.') ? 'subif' : 'if'; return '';
    }
    if (sw && M(t, 'vlan') && t[1]) { const l = parseVl(t[1]); if (!l) return null; l.forEach(v => { if (!c.vlans[v]) c.vlans[v] = 'VLAN' + String(v).padStart(4, '0'); }); s.vl = l; s.mode = 'vlan'; return ''; }
    if (sw && M(t, 'no', 'vlan') && t[2]) { const l = parseVl(t[2]); if (!l) return null; l.forEach(v => { if (v !== 1) delete c.vlans[v]; }); return ''; }
    if (M(t, 'ip', 'routing')) { if (sw) c.ipRouting = true; return ''; }
    if (M(t, 'no', 'ip', 'routing')) { if (sw) c.ipRouting = false; return ''; }
    if (sw && M(t, 'no', 'ip', 'default-gateway')) { c.gw = null; return ''; }
    if (sw && M(t, 'ip', 'default-gateway') && t[2]) { if (!validIp(t[2])) return null; c.gw = t[2]; return ''; }
    if (M(t, 'ip', 'route') && t.length >= 5) {
      const [, , n, m, x] = t; if (!validIp(n) || maskLen(m) === null) return '% Ungültiges Netz oder Maske';
      if (netN(n, m) !== ip2n(n)) return `% Inkonsistente Adresse/Maske – meintest du ${n2ip(netN(n, m))}?`;
      let r; if (validIp(x)) r = { net: n, mask: m, nh: x, ifn: null }; else { const i = normIf(x); if (!i || !c.ifs[i]) return null; r = { net: n, mask: m, nh: null, ifn: i }; }
      c.routes = c.routes.filter(q => !(q.net === n && q.mask === m && (q.nh || q.ifn) === (r.nh || r.ifn))); c.routes.push(r); return '';
    }
    if (M(t, 'no', 'ip', 'route') && t.length >= 5) { c.routes = c.routes.filter(q => !(q.net === t[3] && q.mask === t[4] && (!t[5] || (q.nh || q.ifn) === (validIp(t[5]) ? t[5] : normIf(t[5]))))); return ''; }
    if (M(t, 'access-list') && t[1]) return aclParse(c, t);
    if (M(t, 'no', 'access-list') && t[2]) { delete c.acls[t[2]]; return ''; }
    if (rt && M(t, 'crypto', 'ikev2') && t[2] && t[3]) {
      const k = expand([t[2]], { proposal: [], policy: [], keyring: [], profile: [] }); if (!k) return null;
      return enterBlk(c, s, `crypto ikev2 ${k[0]} ${t[3]}`, k[0], `config-ikev2-${k[0]}`);
    }
    if (rt && M(t, 'crypto', 'ipsec', 'transform-set') && t.length >= 5) {
      const tr = t.slice(4).map(x => x.toLowerCase()); const okT = ['esp-aes', 'esp-gcm', 'esp-sha-hmac', 'esp-sha256-hmac', 'esp-sha384-hmac', 'esp-sha512-hmac', 'esp-3des', 'esp-des', 'esp-md5-hmac', '128', '192', '256'];
      if (!tr.every(x => okT.includes(x))) return '% Unbekannte Transform – z. B. esp-aes 256 esp-sha256-hmac';
      c.blocks = c.blocks.filter(b => !b.head.startsWith('crypto ipsec transform-set ' + t[3] + ' '));
      return enterBlk(c, s, `crypto ipsec transform-set ${t[3]} ${tr.join(' ')}`, 'transform', 'cfg-crypto-trans');
    }
    if (rt && M(t, 'crypto', 'ipsec', 'profile') && t[3]) return enterBlk(c, s, `crypto ipsec profile ${t[3]}`, 'ipsecprofile', 'ipsec-profile');
    if (M(t, 'crypto', 'key', 'generate')) {
      if (!c.lines.some(l => /^ip domain[- ]name /.test(l.toLowerCase()))) return '% Please define a domain-name first.';
      c.rsa = true; return `The name for the keys will be: ${c.hostname}.${(c.lines.find(l => /^ip domain[- ]name /.test(l.toLowerCase())) || '').split(' ').pop()}\n% The key modulus size is 2048 bits\n% Generating 2048 bit RSA keys, keys will be non-exportable...\n[OK]`;
    }
    if (M(t, 'radius', 'server') && t[2]) return enterBlk(c, s, `radius server ${t[2]}`, 'radius', 'config-radius-server');
    if (M(t, 'aaa', 'group', 'server', 'radius') && t[4]) { if (!c.lines.some(l => l.toLowerCase() === 'aaa new-model')) return '% Zuerst "aaa new-model"'; return enterBlk(c, s, `aaa group server radius ${t[4]}`, 'aaagroup', 'config-sg-radius'); }
    if (M(t, 'line', 'vty|console')) {
      const kind = 'vty'.startsWith(t[1].toLowerCase()) ? 'vty' : 'console'; const rest = t.slice(2).join(' ') || (kind === 'vty' ? '0 4' : '0');
      return enterBlk(c, s, `line ${kind} ${rest}`, 'line', 'config-line');
    }
    // generic global lines
    let gl = low; if (gl.startsWith('no ') && !GL.some(p => gl.startsWith(p))) {
      const body = gl.slice(3); const before = c.lines.length; c.lines = c.lines.filter(l => !l.toLowerCase().startsWith(body)); return before === c.lines.length && !GL.some(p => body.startsWith(p) || (body + ' ').startsWith(p)) ? null : '';
    }
    if (GL.some(p => gl.startsWith(p) || (gl + ' ') === p)) {
      if (gl.startsWith('aaa ') && gl !== 'aaa new-model' && !c.lines.some(l => l.toLowerCase() === 'aaa new-model')) return '% AAA ist noch nicht aktiv – zuerst "aaa new-model"';
      const key = GREPL.find(k => gl.startsWith(k)); if (key) c.lines = c.lines.filter(l => !l.toLowerCase().startsWith(key));
      if (gl.startsWith('username ')) { const u = gl.split(' ')[1]; c.lines = c.lines.filter(l => !l.toLowerCase().startsWith('username ' + u + ' ')); }
      if (!c.lines.some(l => l.toLowerCase() === gl)) c.lines.push(line);
      return '';
    }
    return null;
  }
  function enterBlk(c, s, head, kind, p) {
    let b = c.blocks.find(x => x.head === head); if (!b) { b = { head, lines: [] }; c.blocks.push(b); }
    s.mode = 'blk'; s.blk = head; s.bk = kind; s.blkp = p; s.sub = 0; return '';
  }
  function blkc(d, s, t, line) {
    const b = d.cfg.blocks.find(x => x.head === s.blk); if (!b) { s.mode = 'conf'; return null; }
    if (M(t, 'exit')) { if (s.sub) s.sub = 0; else s.mode = 'conf'; return ''; }
    const neg = t[0].toLowerCase() === 'no'; const tt = neg ? t.slice(1) : t;
    const vocab = BV[s.bk]; const e = tt.length ? expand(tt, vocab) : null;
    if (!e) { const r = conf(null, d, s, t, line); return r; }
    const ln = e.join(' ');
    if (s.bk === 'dhcppool' && !neg) {
      if (e[0] === 'network' && !(validIp(e[1] || '') && maskLen(e[2] || '') !== null)) return '% Syntax: network <Netz> <Subnetzmaske>, z. B. network 192.168.10.0 255.255.255.0';
      if (['default-router', 'dns-server'].includes(e[0]) && !validIp(e[1] || '')) return '% Syntax: ' + e[0] + ' <IP-Adresse>';
    }
    if (neg) { b.lines = b.lines.filter(l => !l.toLowerCase().startsWith(ln.toLowerCase())); return ''; }
    if (s.bk === 'keyring' && e[0] === 'peer') { if (!e[1]) return null; s.sub = 1; if (!b.lines.includes('peer ' + e[1])) b.lines.push('peer ' + e[1]); return ''; }
    if (s.bk === 'keyring' && !s.sub && ['address', 'pre-shared-key'].includes(e[0])) return '% Zuerst in den Peer wechseln: peer NAME';
    if (s.bk === 'radius' && e[0] === 'address' && (!validIp(e[2] || '') || e[1] !== 'ipv4')) return '% Syntax: address ipv4 <IP> auth-port 1812 acct-port 1813';
    if (s.bk === 'policy' && e[0] === 'proposal' && !e[1]) return null;
    const rk = REPL[e[0]];
    if (rk && s.bk !== 'keyring' && !(s.bk === 'profile' && e[0] === 'match') && !(s.bk === 'profile' && e[0] === 'authentication')) { const key = e.slice(0, rk).join(' ').toLowerCase(); b.lines = b.lines.filter(l => !l.toLowerCase().startsWith(key)); }
    if (s.bk === 'profile' && e[0] === 'authentication') { const key = e.slice(0, 2).join(' '); b.lines = b.lines.filter(l => !l.startsWith(key)); }
    if (s.bk === 'keyring' && rk) { // replace within current peer
      let idx = -1; for (let i = b.lines.length - 1; i >= 0; i--) if (b.lines[i].startsWith('peer ')) { idx = i; break; }
      for (let i = idx + 1; i < b.lines.length && !b.lines[i].startsWith('peer '); i++) if (b.lines[i].startsWith(e[0] + ' ')) { b.lines.splice(i, 1); i--; }
      let ins = b.lines.length; for (let i = idx + 1; i < b.lines.length; i++) if (b.lines[i].startsWith('peer ')) { ins = i; break; }
      b.lines.splice(ins, 0, ln); return '';
    }
    if (!b.lines.includes(ln)) b.lines.push(ln);
    return '';
  }
  function vlanc(d, s, t, line) {
    if (M(t, 'exit')) { s.mode = 'conf'; return ''; }
    if (M(t, 'name') && t[1]) { s.vl.forEach(v => { d.cfg.vlans[v] = t[1]; }); return ''; }
    return conf(null, d, s, t, line);
  }
  function ifc(net, d, s, t, line) {
    const sw = d.type === 'switch', rt = d.type === 'router', c = d.cfg;
    if (M(t, 'exit')) { s.mode = 'conf'; return ''; }
    const neg = (t[0] || '').toLowerCase() === 'no'; const u = neg ? t.slice(1) : t;
    const each = f => { for (const n of s.ifs) { const r = f(c.ifs[n], n); if (r) return r; } return ''; };
    const one = s.ifs.length === 1 ? c.ifs[s.ifs[0]] : null;
    if (d.fw) {
      if (M(u, 'nameif')) {
        if (neg) return each(i => { i.nameif = null; });
        const nm = u[1]; if (!nm || !/^[A-Za-z][\w-]*$/.test(nm)) return '% Syntax: nameif <name>';
        if (Object.entries(c.ifs).some(([k, x]) => x.nameif === nm && !s.ifs.includes(k))) return `% Der Name "${nm}" ist bereits vergeben`;
        each(i => { i.nameif = nm; if (i.sl === null) i.sl = nm === 'inside' ? 100 : 0; });
        return nm === 'inside' ? 'INFO: Security level for "inside" set to 100 by default.' : nm === 'outside' ? 'INFO: Security level for "outside" set to 0 by default.' : '';
      }
      if (M(u, 'security-level')) { const n = +u[1]; if (!(u[1] !== undefined && n >= 0 && n <= 100)) return '% Security-Level 0–100'; return each(i => { i.sl = n; }); }
    }
    if (M(u, 'shutdown') && u.length === 1) return each(i => { i.shutdown = !neg; });
    if (M(u, 'description')) return each(i => { i.desc = neg ? '' : line.split(' ').slice(1).join(' '); });
    if (M(u, 'ip', 'address')) {
      if (sw && !s.ifs.every(n => n.startsWith('Vlan'))) return '% Auf Layer-2-Ports gibt es keine IP-Adresse – nutze ein SVI (interface vlan X)';
      if (neg) return each(i => { i.ip = null; i.mask = null; });
      if (!one) return null;
      const ip = u[2], m = u[3];
      if (!validIp(ip) || maskLen(m) === null) return '% Ungültige IP-Adresse oder Subnetzmaske (z. B. ip address 192.168.1.1 255.255.255.0)';
      const L = maskLen(m); const nn = netN(ip, m);
      if (L < 31 && (ip2n(ip) === nn || ip2n(ip) === ((nn | (~ip2n(m) >>> 0)) >>> 0))) return `% ${ip} ist Netz- oder Broadcast-Adresse im Subnetz /${L}`;
      for (const n in c.ifs) { if (n === s.ifs[0]) continue; const x = c.ifs[n]; if (x.ip && (inNet(ip, x.ip, x.mask) || inNet(x.ip, ip, m))) return `% ${n2ip(nn)} overlaps with ${n}`; }
      one.ip = ip; one.mask = m; return '';
    }
    if (sw && M(u, 'channel-group')) {
      if (neg) return each((i, n) => { i.cg = null; });
      const n = +u[1], md = (u[3] || '').toLowerCase(); if (!(n >= 1 && n <= 64) || !u[2] || !'mode'.startsWith(u[2].toLowerCase()) || !['on', 'active', 'passive', 'desirable', 'auto'].includes(md)) return '% Syntax: channel-group <1-64> mode <on|active|passive|desirable|auto>';
      if (s.ifs.some(q => q.startsWith('Vlan') || q.startsWith('Port-channel'))) return '% channel-group gehört an physische Ports';
      if (!c.ifs['Port-channel' + n]) c.ifs['Port-channel' + n] = Object.assign(newIf('switch'), { shutdown: false });
      return each(i => { i.cg = { n, mode: md }; });
    }
    if (M(u, 'ip', 'helper-address')) { if (neg) return each(i => { i.helper = null; }); if (!validIp(u[2] || '')) return '% Syntax: ip helper-address <IP-Adresse des DHCP-Servers>'; return each(i => { i.helper = u[2]; }); }
    if (M(u, 'ip', 'access-group')) {
      if (neg) return each(i => { if (!u[3] || 'in'.startsWith(u[3])) i.aclIn = null; if (!u[3] || 'out'.startsWith(u[3])) i.aclOut = null; });
      if (!u[2] || !u[3]) return null; const dir = u[3].toLowerCase();
      return each(i => { if (dir === 'in') i.aclIn = u[2]; else if (dir === 'out') i.aclOut = u[2]; else return INV; });
    }
    if (M(u, 'switchport')) {
      if (!sw || s.ifs.some(n => n.startsWith('Vlan'))) return null;
      const v = u.slice(1);
      if (M(v, 'mode', 'access')) return each(i => { i.mode = 'access'; i.modeSet = true; });
      if (M(v, 'mode', 'trunk')) return each(i => { i.mode = 'trunk'; i.modeSet = true; });
      if (M(v, 'access', 'vlan')) {
        if (neg) return each(i => { i.vlan = 1; });
        const n = +v[2]; if (!(n >= 1 && n <= 4094)) return null; let msg = '';
        if (!c.vlans[n]) { c.vlans[n] = 'VLAN' + String(n).padStart(4, '0'); msg = `% Access VLAN does not exist. Creating vlan ${n}`; }
        each(i => { i.vlan = n; }); return msg;
      }
      if (M(v, 'trunk', 'native', 'vlan')) { const n = neg ? 1 : +v[3]; if (!(n >= 1 && n <= 4094)) return null; return each(i => { i.native = n; }); }
      if (M(v, 'trunk', 'allowed', 'vlan')) {
        if (neg) return each(i => { i.allowed = null; });
        const a = v[3] ? v[3].toLowerCase() : null; if (!a) return null;
        if (a === 'all') return each(i => { i.allowed = null; });
        if (a === 'none') return each(i => { i.allowed = []; });
        if (['add', 'remove', 'except'].includes(a)) { const l = parseVl(v[4]); if (!l) return null;
          return each(i => { let cur = i.allowed === null ? null : i.allowed.slice();
            if (a === 'add') { if (cur !== null) l.forEach(x => { if (!cur.includes(x)) cur.push(x); }); }
            else if (a === 'remove') { if (cur === null) { cur = []; for (let k = 1; k <= 4094; k++) if (!l.includes(k)) cur.push(k); } else cur = cur.filter(x => !l.includes(x)); }
            else { cur = []; for (let k = 1; k <= 4094; k++) if (!l.includes(k)) cur.push(k); }
            i.allowed = cur; }); }
        const l = parseVl(a); if (!l) return null; return each(i => { i.allowed = l; });
      }
      if (M(v, 'trunk', 'encapsulation')) return '';
      if (M(v, 'nonegotiate') || M(v, 'port-security') || M(v, 'voice')) {
        const ln = 'switchport ' + v.join(' ').toLowerCase();
        return each(i => { if (neg) i.extra = i.extra.filter(x => !x.startsWith(ln)); else if (!i.extra.includes(ln)) i.extra.push(ln); });
      }
      return null;
    }
    if (M(u, 'encapsulation', 'dot1q')) { if (!rt || !s.ifs[0].includes('.')) return '% encapsulation dot1Q nur auf Router-Subinterfaces (z. B. interface g0/0.10)'; if (neg) { one.encap = null; return ''; } const n = +u[2]; if (!(n >= 1 && n <= 4094)) return null; one.encap = n; return ''; }
    if (M(u, 'tunnel')) {
      if (!one || !s.ifs[0].startsWith('Tunnel')) return null; const v = u.slice(1);
      if (M(v, 'source') && (v[1] || neg)) { if (neg) { one.tsrc = null; return ''; } const x = validIp(v[1]) ? v[1] : normIf(v[1]); if (!x || (!validIp(x) && !c.ifs[x])) return null; one.tsrc = x; return ''; }
      if (M(v, 'destination') && (v[1] || neg)) { if (neg) { one.tdst = null; return ''; } if (!validIp(v[1])) return null; one.tdst = v[1]; return ''; }
      if (M(v, 'mode')) { if (neg) { one.tmode = 'gre'; return ''; } if (M(v.slice(1), 'ipsec')) { one.tmode = 'ipsec'; return ''; } if (M(v.slice(1), 'gre')) { one.tmode = 'gre'; return ''; } return null; }
      if (M(v, 'protection', 'ipsec', 'profile')) { if (neg) { one.tprot = null; return ''; } if (!v[3]) return null; one.tprot = v[3]; return ''; }
      return null;
    }
    const e = u.length ? expand(u, IFX) : null;
    if (e) {
      if (e[0] === 'mab' && e.length > 1) return null;
      if (e[0] === 'speed') { if (!/^(auto|10|100|1000|10000)$/.test(e[1] || '')) return '% Syntax: speed auto|10|100|1000'; if (!neg) { each(i => { i.extra = i.extra.filter(x => !x.startsWith('speed ')); }); if (e[1] === 'auto') return ''; } }
      const ln = e.join(' ').toLowerCase();
      return each(i => { if (neg) i.extra = i.extra.filter(x => !x.startsWith(ln)); else { { const rk = e[0] === 'authentication' && e[1] === 'port-control' ? 'authentication port-control' : (['mtu', 'priority-flow-control'].includes(e[0]) ? e[0] : null); if (rk) i.extra = i.extra.filter(x => !x.startsWith(rk)); } if (!i.extra.includes(ln)) i.extra.push(ln); } });
    }
    return conf(net, d, s, t, line);
  }
  function aclParse(c, t) {
    const num = +t[1]; const rest = t.slice(2).map(x => x.toLowerCase());
    if (!(num >= 1 && num <= 199)) return '% Nummerierte ACLs: 1–99 Standard, 100–199 Extended';
    if (rest[0] === 'remark') { (c.acls[num] = c.acls[num] || []).push({ remark: true, text: 'remark ' + t.slice(3).join(' ') }); return ''; }
    const action = rest[0]; if (!['permit', 'deny'].includes(action)) return null;
    let k = 1; const ext = num >= 100;
    const spec = () => {
      const w = rest[k];
      if (w === 'any') { k++; return { any: true, txt: 'any' }; }
      if (w === 'host') { const ip = rest[k + 1]; if (!validIp(ip || '')) return null; k += 2; return { ip, wc: '0.0.0.0', txt: 'host ' + ip }; }
      if (validIp(w || '')) { const wc = rest[k + 1]; if (validIp(wc || '')) { k += 2; return { ip: w, wc, txt: w + ' ' + wc }; } k++; return { ip: w, wc: '0.0.0.0', txt: w }; }
      return null;
    };
    let proto = 'ip';
    if (ext) { proto = rest[1]; if (!['ip', 'icmp', 'tcp', 'udp'].includes(proto)) return '% Protokoll: ip, icmp, tcp oder udp'; k = 2; }
    const src = spec(); if (!src) return null; let dst = null;
    if (ext) { if (['tcp', 'udp'].includes(proto) && rest[k] === 'eq') k += 2; dst = spec(); if (!dst) return null; if (rest[k] === 'eq') k += 2; }
    if (rest[k] === 'log') k++;
    if (k < rest.length && rest[k] !== 'eq') return null;
    const e = { action, ext, proto, src, dst, text: rest.join(' ') };
    (c.acls[num] = c.acls[num] || []).push(e); return '';
  }
  function hostExec(net, d, line) {
    const t = line.split(' '); const c = d.cfg; c.nic = c.nic || {};
    const sheet = () => `NAME   : ${c.hostname}\n` + d.ports.map(p => { const h = hip(d, p), st = portStatus(net, d.id, p); return `${pad(p, 20)} ${pad(h && h.ip ? h.ip + '/' + maskLen(h.mask) : 'keine IP', 20)} ${st.st === 'connected' ? 'link up, ' + fmtSpeed(st.speed, st.proto) : st.st}`; }).join('\n') + `\nGATEWAY: ${c.gw || 'nicht gesetzt'}`;
    if ((/^(ip|ipconfig|ifconfig)$/i.test(t[0]) && t.length === 1) || (M(t, 'show') && (!t[1] || M(t.slice(1), 'ip')))) return sheet();
    if (t[0].toLowerCase() === 'ip') {
      let a = t.slice(1), port = d.ports[0];
      if (a[0] && d.ports.includes(a[0])) { port = a[0]; a = a.slice(1); }
      if (a[0] === 'dhcp') return 'DHCP wird in diesem Lab nicht simuliert – bitte statisch: ip [Port] <IP> <Maske|/Präfix> [Gateway]';
      let ip = a[0], mask = null, rest = a.slice(1);
      if (ip && ip.includes('/')) { const [x, b] = ip.split('/'); ip = x; if (!(+b >= 1 && +b <= 30)) return '% Ungültiges Präfix'; mask = lenMask(+b); }
      else if (rest[0] && rest[0].startsWith('/')) { const b = +rest[0].slice(1); if (!(b >= 1 && b <= 30)) return '% Ungültiges Präfix'; mask = lenMask(b); rest = rest.slice(1); }
      else { mask = rest[0]; rest = rest.slice(1); }
      const gw = rest[0] || null;
      if (!validIp(ip || '') || !validIp(mask || '') || maskLen(mask) === null) return '% Syntax: ip [Port] 192.168.1.10 255.255.255.0 [Gateway]   oder   ip [Port] 192.168.1.10/24 [Gateway]';
      if (gw && !validIp(gw)) return '% Ungültiges Gateway';
      if (gw && !inNet(gw, ip, mask)) return `% Gateway ${gw} liegt nicht im Subnetz ${n2ip(netN(ip, mask))}/${maskLen(mask)}`;
      if (port === d.ports[0]) { c.ip = ip; c.mask = mask; } else c.nic[port] = { ip, mask };
      if (gw) c.gw = gw;
      return `Checking for duplicate address...\n${c.hostname} ${port === d.ports[0] ? '' : port + ' '}: ${ip} ${mask}` + (gw ? ` gateway ${gw}` : '');
    }
    if (/^(nc|telnet)$/i.test(t[0]) && t[1] && t[2]) {
      const pn = +t[2], proto = (t[3] || 'tcp').toLowerCase();
      if (!(pn > 0 && pn < 65536)) return '% Port 1–65535'; if (!['tcp', 'udp'].includes(proto)) return '% Protokoll: tcp oder udp';
      const r = ping(net, d.id, t[1], { proto, port: pn });
      return r.ok ? `Connection to ${t[1]} ${pn} port [${proto}] succeeded!` : `nc: connect to ${t[1]} port ${pn} (${proto}) failed: timeout` + dbg(r);
    }
    if (M(t, 'ping') && t[1]) { const r = ping(net, d.id, t[1]); return r.ok ? [1, 2, 3, 4, 5].map(i => `84 bytes from ${t[1]} icmp_seq=${i} ttl=${64 - Math.max(0, (r.path || []).length - 1)} time=${(1 + Math.random() * 2).toFixed(1)} ms`).join('\n') + (r.nat ? `\n[NAT] Quelladresse wurde an ${host(net, r.nat.dev)} von ${r.nat.orig} auf ${r.nat.ip} übersetzt` : '') : `${t[1]} icmp_seq=1 timeout\n${t[1]} icmp_seq=2 timeout\n${t[1]} icmp_seq=3 timeout` + dbg(r); }
    if ((M(t, 'trace') || M(t, 'tracert') || M(t, 'traceroute')) && t[1]) return traceOut(net, d, t[1]);
    if (t[0] === '?' || M(t, 'help')) return 'Befehle am Endgerät / Server:\n  ip [Port] <IP>/<Präfix> [Gateway]   Adresse setzen (Port z. B. slot1/1; ohne Angabe: erster Port)\n  show ip                              Ports, Adressen, Link-Status\n  ping <IP>                            Erreichbarkeit testen\n  nc <IP> <Port> [tcp|udp]             Verbindung zu einem Dienst testen (Firewall-Regeln!)\n  trace <IP>                           Pfad anzeigen';
    return `Unbekannter Befehl "${t[0]}". Hilfe mit ?`;
  }
  const dbg = r => '\n\n[Ping-Debugger] ' + r.reason + ((r.notes || []).length ? '\n' + r.notes.slice(0, 4).map(n => '[Hinweis] ' + n).join('\n') : '') + ((r.path || []).length > 1 ? '\n[Pfad] ' + r.path.join(' → ') + ' ✗' : '');
  function pingOut(net, d, dst) {
    const r = ping(net, d.id, dst);
    let o = `Type escape sequence to abort.\nSending 5, 100-byte ICMP Echos to ${dst}, timeout is 2 seconds:\n`;
    return o + (r.ok ? '!!!!!\nSuccess rate is 100 percent (5/5), round-trip min/avg/max = 1/2/4 ms' : '.....\nSuccess rate is 0 percent (0/5)' + dbg(r));
  }
  function traceOut(net, d, dst) {
    const r = ping(net, d.id, dst); const p = (r.path || []).slice(1);
    let o = `Tracing the route to ${dst}\n`; p.forEach((h, i) => { o += `  ${i + 1} ${h}  1 msec 1 msec 2 msec\n`; });
    return o + (r.ok ? '' : `  ${p.length + 1}  *  *  *` + dbg(r));
  }
  const HELP = {
    user: 'enable  ping  show  traceroute',
    priv: 'configure terminal  show running-config  show interfaces status  show cdp neighbors  show inventory  show ip interface brief  show ip route  show vlan brief  show interfaces trunk  show access-lists  show crypto session  ping  traceroute  write memory  disable',
    conf: 'hostname  interface  interface range  vlan  ip routing  ip route  ip default-gateway  access-list  crypto ikev2 …  crypto ipsec …  aaa …  radius server  dot1x system-auth-control  line vty 0 4  enable secret  username  ip domain-name  crypto key generate rsa  service password-encryption  do <befehl>  end  exit',
    if: 'ip address  shutdown / no shutdown  switchport mode access|trunk  switchport access vlan  switchport trunk allowed vlan  switchport trunk native vlan  encapsulation dot1Q  ip access-group  tunnel source|destination|mode|protection  authentication port-control auto  dot1x pae authenticator  mab  spanning-tree portfast  spanning-tree bpduguard enable  description  exit',
    vlan: 'name  exit  end'
  };
  function help(d, s) {
    const k = ['range', 'subif', 'if'].includes(s.mode) ? 'if' : s.mode;
    if (d.fw && k === 'conf') return 'Verfügbare Befehle (Firewall):\n  hostname\n  interface <Port>\n  access-list <NAME> extended permit|deny <ip|icmp|tcp|udp> <Quelle> <Ziel> [eq <Port>]\n  access-group <NAME> in interface <nameif>\n  route <nameif> <Netz> <Maske> <Gateway>\n  nat (<von>,<nach>) source dynamic any interface\n  same-security-traffic permit inter-interface\n  do show …\n  end / exit';
    if (d.fw && k === 'if') return 'Verfügbare Befehle (Interface):\n  nameif <name>\n  security-level <0-100>\n  ip address <IP> <Maske>\n  no shutdown\n  description <Text>\n  exit';
    if (s.mode === 'blk') return 'Verfügbare Befehle: ' + Object.keys(BV[s.bk]).join('  ') + '  exit  end';
    return 'Verfügbare Befehle (Auswahl):\n  ' + (HELP[k] || '').split('  ').join('\n  ');
  }

  // ---------- serialisation ----------
  function snapshot(net) { const o = {}; for (const id in net.devs) o[id] = { cfg: net.devs[id].cfg, saved: net.devs[id].saved }; return o; }
  function restore(net, snap) { for (const id in snap) if (net.devs[id]) { net.devs[id].cfg = snap[id].cfg; net.devs[id].saved = snap[id].saved; } }

  return { peerOfPort: (net, d, p) => peerOf(net, d, p), stp: (net, v) => { STPTICK++; return stp(net, v); }, bundleOf, bridgeMac, stpCfg, effIf, apState, wlcState, apPower, apJoined, apSsids, apClients, wifiScan, wifiConnect, wifiDisconnect, wifiLinkOf, isDown, booting, setClock, l2, MODELS, XCVR, CABLES, CARDS, KIND, setCard, wwpn, fmtSpeed, hip, cfgOf, slotAccepts, phys, portStatus, linkOf, exportCfg, ip2n, n2ip, validIp, lenMask, maskLen, netN, inNet, normIf, sh, mkDev, newIf, isHost, peerOf, linkUp, ifUp, l3, lookup, ping, tunnel, exec, newSess, prompt, runcfg, snapshot, restore, blk, blocks, parseVl };
})();
if (typeof module !== 'undefined') module.exports = NL;
