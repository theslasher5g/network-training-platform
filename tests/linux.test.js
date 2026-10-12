global.NL = require('../src/engine.js'); global.window = undefined;
const SB = require('../src/sandbox.js');
const net = { devs: {}, links: [], seq: 1 };
const api = SB.testApi(net);
const mk = (m, h) => api.addDev(m, 100, 100, h);
mk('C9200L-24P-4X', 'SW'); mk('Server', 'WEB-01'); mk('PC', 'PC-1'); mk('PC', 'GW');
const G = 'GigabitEthernet1/0/';
[['WEB-01', 1], ['PC-1', 2], ['GW', 3]].forEach(([h, i]) => net.links.push({ a: api.hd(net, h).id, ap: 'eth0', b: api.hd(net, 'SW').id, bp: G + i, cable: 'cu' }));
api.hostLine(api.hd(net, 'GW'), NL.newSess(), 'ip 10.0.0.1/24');
api.hostLine(api.hd(net, 'PC-1'), NL.newSess(), 'ip 10.0.0.20/24 10.0.0.1');
api.hostLine(api.hd(net, 'WEB-01'), NL.newSess(), 'ip 10.0.0.10/24 10.0.0.1');
api.hd(net, 'PC-1').cfg.dns = '10.0.0.10';
const sv = api.hd(net, 'WEB-01').svc, pc = api.hd(net, 'PC-1');
const X = l => api.lx('WEB-01', l);
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) { bad++; } };

ok(api.lxPrompt('WEB-01') === 'admin@WEB-01:~$ ', 'prompt');
ok(X('whoami') === 'admin' && X('hostname') === 'WEB-01', 'whoami/hostname');
ok(/notizen/.test(X('ls')), 'ls zeigt Home');
ok(X('cat /etc/hostname') === 'WEB-01', 'cat /etc/hostname');
ok(X('foo') === 'bash: foo: command not found', 'unbekannter Befehl');

// Rechte und systemd
ok(/Authentication is required/.test(X('systemctl stop nginx')) && sv.http.on, 'ohne sudo kein stop');
X('sudo systemctl stop nginx'); ok(!sv.http.on && X('systemctl is-active nginx') === 'inactive', 'sudo stop');
ok(!api.httpGet(pc, 'http://10.0.0.10').ok, 'HTTP bei gestopptem nginx nicht erreichbar');
X('sudo systemctl start nginx'); ok(sv.http.on && api.httpGet(pc, 'http://10.0.0.10').ok, 'start -> Seite erreichbar');
ok(/active \(running\)/.test(X('systemctl status nginx')), 'status zeigt running');

// kaputte Config
X("sudo sed -i 's/listen 80;/listen 80/' /etc/nginx/nginx.conf");
ok(/not terminated by ";"/.test(X('sudo nginx -t')), 'nginx -t findet Fehler');
ok(/failed/.test(X('sudo systemctl restart nginx')) && !sv.http.on, 'restart schlaegt fehl');
ok(/failed/.test(X('systemctl status nginx')) && /emerg/.test(X('journalctl -u nginx -n 5')), 'status/journal zeigen Fehler');
X("sudo sed -i 's/listen 80$/listen 80;/' /etc/nginx/nginx.conf"); X('sudo systemctl restart nginx');
ok(sv.http.on && /syntax is ok/.test(X('sudo nginx -t')), 'Config repariert -> laeuft');

// anderer Port
X("sudo sed -i 's/listen 80;/listen 8080;/' /etc/nginx/nginx.conf"); X('sudo systemctl restart nginx');
ok(!sv.http.on && /8080/.test(X('ss -tulpn')), 'listen 8080: Port 80 zu, ss zeigt 8080');
X("sudo sed -i 's/listen 8080;/listen 80;/' /etc/nginx/nginx.conf"); X('sudo systemctl restart nginx');

// index.html -> Seiteninhalt
X('echo "<html><head><title>Intranet</title></head><body>Hallo Team</body></html>" | sudo tee /var/www/html/index.html'); X('sudo systemctl reload nginx');
ok(/Hallo Team/.test(api.httpGet(pc, 'http://10.0.0.10').body) && api.httpGet(pc, 'http://10.0.0.10').title === 'Intranet', 'index.html wird ausgeliefert');
ok(/Hallo Team/.test(X('curl localhost')), 'curl localhost');

// apt + DNS
ok(/Unable to locate/.test(X('sudo apt install gibtsnicht')) , 'apt: unbekanntes Paket');
ok(/Permission denied/.test(X('apt install bind9')), 'apt ohne sudo');
X('sudo apt install bind9');
ok(/bind9/.test(X('systemctl status bind9')) && /\bactive\b/.test(X('systemctl is-active bind9')), 'bind9 installiert und aktiv');
X('echo "intranet IN A 10.0.0.10" | sudo tee -a /etc/bind/db.lab'); X('sudo systemctl restart bind9');
ok(sv.dns.records.some(r => r.name === 'intranet.lab.local' && r.ip === '10.0.0.10'), 'db.lab -> DNS-Eintraege');
ok(api.resolve(pc, 'intranet.lab.local').ip === '10.0.0.10', 'Client loest Namen auf');
X('echo "bad IN A 10.0.0" | sudo tee -a /etc/bind/db.lab'); ok(/failed/.test(X('sudo systemctl restart bind9')), 'bind9: ungueltige IP -> Fehler');
X("sudo sed -i '/bad IN A/d' /etc/bind/db.lab"); X('sudo systemctl restart bind9'); ok(X('systemctl is-active bind9') === 'active', 'bind9 repariert');

// DHCP
ok(/failed|not configured|invoke-rc/i.test(X('sudo apt install isc-dhcp-server')) && X('systemctl is-active isc-dhcp-server') === 'failed', 'dhcp nach Installation ohne Config: failed');
X('echo "subnet 10.0.0.0 netmask 255.255.255.0 {" | sudo tee /etc/dhcp/dhcpd.conf'); X('echo "  range 10.0.0.100 10.0.0.120;" | sudo tee -a /etc/dhcp/dhcpd.conf'); X('echo "  option routers 10.0.0.1;" | sudo tee -a /etc/dhcp/dhcpd.conf'); X('echo "}" | sudo tee -a /etc/dhcp/dhcpd.conf');
X('sudo systemctl restart isc-dhcp-server'); ok(sv.dhcp.on && sv.dhcp.start === '10.0.0.100' && sv.dhcp.max === 21 && sv.dhcp.gw === '10.0.0.1', 'dhcpd.conf -> DHCP-Pool');

// Pipes, Redirects
ok(/nginx/.test(X('ps aux | grep nginx')), 'pipe: ps | grep');
ok(X('echo hallo > ~/a.txt && cat ~/a.txt') === 'hallo', 'redirect + &&');
ok(X('cat /etc/hosts | wc -l') === '2', 'pipe: wc -l');
ok(/Permission denied/.test(X('echo x > /etc/hostname')), 'Schreiben in /etc ohne root verboten');
ok(/Permission denied/.test(X('cat /etc/shadow')), 'shadow geschuetzt');

// Netzwerk
ok(/10\.0\.0\.10\/24/.test(X('ip -br a')), 'ip -br a');
ok(/default via 10\.0\.0\.1/.test(X('ip r')), 'ip r');
ok(/bytes from|Erfolgsrate|!/.test(X('ping 10.0.0.1')), 'ping ueber hostLine');
X('sudo ip addr add 10.0.0.11/24 dev eth0'); ok(/10\.0\.0\.11/.test(X('ip a')), 'ip addr add setzt IP'); X('sudo ip addr add 10.0.0.10/24 dev eth0');

// ufw
X('sudo ufw enable'); ok(!api.httpGet(pc, 'http://10.0.0.10').ok, 'ufw blockt HTTP');
X('sudo ufw allow 80'); ok(api.httpGet(pc, 'http://10.0.0.10').ok, 'ufw allow 80 -> erreichbar'); X('sudo ufw disable');

// Platte voll
api.hd(net, 'WEB-01').lx.fs['/var/log/app.log'] = { t: '', s: 19 * 1024 ** 3, o: 'root', m: '644' };
ok(/100%/.test(X('df -h')), 'df: 100% bei voller Platte');
ok(/app\.log/.test(X('sudo find / -size +1G')), 'find -size findet Grossdatei');
ok(/failed/.test(X('sudo systemctl restart nginx')) && /No space left/.test(X('journalctl -u nginx -n 3')), 'Dienst startet bei voller Platte nicht');
X('sudo truncate -s 0 /var/log/app.log'); X('sudo systemctl restart nginx');
ok(!/100%/.test(X('df -h')) && sv.http.on, 'Platte frei -> Dienst startet');

// sudo -i / exit
X('sudo -i'); ok(/^root@WEB-01:~# $/.test(api.lxPrompt('WEB-01')), 'root-Prompt'); X('exit'); ok(/^admin@/.test(api.lxPrompt('WEB-01')), 'exit zurueck');
process.exit(bad ? 1 : 0);
