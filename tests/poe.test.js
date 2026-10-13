// PoE-Budget, power inline never, Injector
global.NL = require('../src/engine.js'); global.window = undefined;
const SB = require('../src/sandbox.js');
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const net = { devs: {}, links: [], seq: 1 }, api = SB.testApi(net), A = (m, h) => api.addDev(m, 0, 0, h), G = n => 'GigabitEthernet1/0/' + n;
const sw = A('C9200L-24P-4X', 'SW'), aps = []; for (let i = 1; i <= 13; i++) { const a = A('C9120AXI', 'AP-' + i); aps.push(a); net.links.push({ a, ap: 'GigabitEthernet0', b: sw, bp: G(i), cable: 'cu' }); }
const X = lines => { const s = NL.newSess(); ['enable', 'configure terminal', ...lines, 'end'].forEach(l => NL.exec(net, sw, s, l)); };
const on = () => aps.filter(a => NL.poePower(net, net.devs[a]).ok).length;
ok(on() === 12, '13 APs à 30 W an 370 W Budget: 12 werden versorgt (' + on() + ')');
const al = NL.poeAlloc(net, net.devs[sw]); ok(Math.abs(al.used - 360) < 0.01, 'vergeben: ' + al.used + ' W von ' + al.budget);
ok(/PoE-Budget/.test(NL.poePower(net, net.devs[aps[12]]).reason) && /power-deny/.test(api.iosShow('SW', 'show power inline')), 'der 13. AP: power-deny, Begruendung nennt das Budget');
X(['interface ' + G(1), 'power inline never']); ok(on() === 12 && !NL.poePower(net, net.devs[aps[0]]).ok && NL.poePower(net, net.devs[aps[12]]).ok, 'power inline never auf Port 1: AP-13 rutscht nach');
X(['interface ' + G(1), 'no power inline never', 'interface ' + G(13), 'power inline port priority high']); ok(NL.poePower(net, net.devs[aps[12]]).ok && !NL.poePower(net, net.devs[aps[11]]).ok, 'Prioritaet high: AP-13 wird vor AP-12 versorgt');
const d12 = net.devs[aps[11]]; d12.ap = d12.ap || {}; NL.apState(d12).injector = true; ok(NL.poePower(net, d12).ok, 'PoE-Injector umgeht das Budget');
const non = A('C1000-8T-2G-L', 'SW2'), ph = A('IP-Phone', 'PH'); net.links.push({ a: ph, ap: 'eth0', b: non, bp: 'GigabitEthernet1/0/1', cable: 'cu' }); ok(!NL.poePower(net, net.devs[ph]).ok && /kein PoE/.test(NL.poePower(net, net.devs[ph]).reason), 'IP-Telefon an Nicht-PoE-Switch: kein Strom');
process.exit(bad ? 1 : 0);
