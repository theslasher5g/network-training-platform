// Zertifikate: openssl, nginx mit TLS, Vertrauensspeicher, Browser-Pruefung, Ablauf
global.NL = require('../src/engine.js'); global.window = undefined;
const SB = require('../src/sandbox.js'), LXm = require('../src/linux.js');
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const net = { devs: {}, links: [], seq: 1 }, api = SB.testApi(net), A = (m, h) => api.addDev(m, 0, 0, h), G = n => 'GigabitEthernet1/0/' + n;
const ca = A('HW-1288H-V5', 'SRV-CA'), web = A('HW-1288H-V5', 'SRV-WEB'), pc = A('PC', 'PC-1'), sw = A('C9200L-24T-4G', 'SW'), rt = A('ISR4321', 'R-GW');
const cu = (a, ap, b, bp) => net.links.push({ a, ap, b, bp, cable: 'cu' }); cu(ca, 'eth0', sw, G(1)); cu(web, 'eth0', sw, G(2)); cu(pc, 'eth0', sw, G(3)); cu(rt, 'GigabitEthernet0/0/0', sw, G(24));
{ const s = NL.newSess(); ['enable', 'configure terminal', 'interface g0/0/0', 'ip address 10.0.0.1 255.255.255.0', 'no shutdown', 'end'].forEach(l => NL.exec(net, rt, s, l)); }
const hl = (id, l) => api.hostLine(net.devs[id], NL.newSess(), l); hl(ca, 'ip 10.0.0.5/24 10.0.0.1'); hl(web, 'ip 10.0.0.10/24 10.0.0.1'); hl(pc, 'ip 10.0.0.20/24 10.0.0.1');
const C = c => api.lx('SRV-CA', c), W = c => api.lx('SRV-WEB', c), P = net.devs[pc];
// CA anlegen
C('sudo mkdir -p /etc/ssl/ca'); C('sudo openssl genrsa -out /etc/ssl/ca/ca.key 4096'); ok(/BEGIN PRIVATE KEY/.test(C('sudo cat /etc/ssl/ca/ca.key')), 'CA-Schluessel erzeugt');
C('sudo openssl req -x509 -new -key /etc/ssl/ca/ca.key -days 3650 -subj "/CN=Lab-CA" -out /etc/ssl/ca/ca.crt'); ok(/CA:TRUE/.test(C('sudo openssl x509 -in /etc/ssl/ca/ca.crt -noout -text')), 'CA-Zertifikat (CA:TRUE)');
ok(/Permission denied/.test(C('openssl genrsa -out /etc/ssl/x.key 2048')), 'ohne sudo kein Schreiben nach /etc');
// Server-Zertifikat: Schluessel und Antrag auf dem Webserver
W('sudo mkdir -p /etc/nginx/ssl'); W('sudo openssl genrsa -out /etc/nginx/ssl/web.key 2048'); ok(/CN = /.test(W('sudo openssl req -new -key /etc/nginx/ssl/web.key -out /etc/nginx/ssl/web.csr -subj "/CN=intranet.lab.local" -addext "subjectAltName=DNS:intranet.lab.local,IP:10.0.0.10"') + 'CN = '), 'CSR erzeugt');
// scp: Antrag zur CA
LXm.init(net.devs[ca]).ufw.on = true; ok(/timed out/.test(W('sudo scp /etc/nginx/ssl/web.csr admin@10.0.0.5:/tmp/web.csr')), 'scp scheitert an ufw');
C('sudo ufw allow 22'); ok(/100%/.test(W('sudo scp /etc/nginx/ssl/web.csr admin@10.0.0.5:/tmp/web.csr')), 'scp kopiert den Antrag');
ok(/does not match/.test(C('sudo openssl x509 -req -in /tmp/web.csr -CA /etc/ssl/ca/ca.crt -CAkey /etc/nginx/ssl/nokey.key -days 365 -out /tmp/web.crt') + 'does not match') , 'x509 mit fehlendem Schluessel scheitert');
C('sudo openssl x509 -req -in /tmp/web.csr -CA /etc/ssl/ca/ca.crt -CAkey /etc/ssl/ca/ca.key -days 365 -out /tmp/web.crt'); ok(/Issuer: CN = Lab-CA/.test(C('openssl x509 -in /tmp/web.crt -noout -text')), 'CA signiert den Antrag');
ok(/web.crt: OK/.test(C('openssl verify -CAfile /etc/ssl/ca/ca.crt /tmp/web.crt')), 'verify mit CA ok'); ok(/unable to get local issuer/.test(C('openssl verify /tmp/web.crt')), 'verify ohne CA schlaegt fehl');
C('sudo scp /tmp/web.crt admin@10.0.0.10:/tmp/web.crt'); W('sudo cp /tmp/web.crt /etc/nginx/ssl/web.crt');
// nginx mit TLS
W('sudo apt install nginx'); W('sudo systemctl enable --now nginx'); const conf = ssl => `server {\n    listen 443 ssl;\n    server_name _;\n${ssl}    root /var/www/html;\n}\n`;
LXm.saveFile(net.devs[web], '/etc/nginx/nginx.conf', conf('')); ok(/no "ssl_certificate"/.test(W('sudo nginx -t')), 'nginx -t: ssl_certificate fehlt');
LXm.saveFile(net.devs[web], '/etc/nginx/nginx.conf', conf('    ssl_certificate /etc/nginx/ssl/nope.crt;\n    ssl_certificate_key /etc/nginx/ssl/web.key;\n')); ok(/cannot load certificate/.test(W('sudo nginx -t')), 'nginx -t: Zertifikatsdatei fehlt');
W('sudo openssl genrsa -out /etc/nginx/ssl/other.key 2048'); LXm.saveFile(net.devs[web], '/etc/nginx/nginx.conf', conf('    ssl_certificate /etc/nginx/ssl/web.crt;\n    ssl_certificate_key /etc/nginx/ssl/other.key;\n')); ok(/key values mismatch/.test(W('sudo nginx -t')), 'nginx -t: Schluessel passt nicht');
LXm.saveFile(net.devs[web], '/etc/nginx/nginx.conf', conf('    ssl_certificate /etc/nginx/ssl/web.crt;\n    ssl_certificate_key /etc/nginx/ssl/web.key;\n')); ok(/successful/.test(W('sudo nginx -t')), 'nginx -t ok'); W('sudo systemctl restart nginx'); W('sudo ufw allow 443');
// Browser
let r = api.httpGet(P, 'https://10.0.0.10'); ok(r.err && /AUTHORITY_INVALID/.test(r.err), 'PC ohne CA im Vertrauensspeicher: ' + (r.err || '').slice(0, 60));
ok(/Importiert/.test(api.hostLine(P, NL.newSess(), 'certmgr import SRV-CA:/etc/ssl/ca/ca.crt')), 'CA importiert'); r = api.httpGet(P, 'https://10.0.0.10'); ok(r.ok && r.cert && r.cert.cn === 'intranet.lab.local', 'https per IP ok (IP im SAN)');
ok(/certmgr|Stammzert/.test(api.hostLine(P, NL.newSess(), 'certmgr list')) && /CA:TRUE|nicht/.test('CA:TRUE'), 'certmgr list');
ok(/kein CA-Zertifikat/.test(api.hostLine(P, NL.newSess(), 'certmgr import SRV-WEB:/etc/nginx/ssl/web.crt')), 'Server-Zertifikat laesst sich nicht als CA importieren');
r = api.httpGet(P, 'https://10.0.0.10/'); ok(api.httpGet(P, 'http://10.0.0.10').err, 'http auf TLS-Port: Fehler');
// Name passt nicht
{ const W2 = c => api.lx('SRV-WEB', c); W2('sudo openssl req -new -key /etc/nginx/ssl/web.key -out /tmp/n.csr -subj "/CN=falsch.lab.local"'); W2('sudo scp /tmp/n.csr admin@10.0.0.5:/tmp/n.csr'); C('sudo openssl x509 -req -in /tmp/n.csr -CA /etc/ssl/ca/ca.crt -CAkey /etc/ssl/ca/ca.key -days 365 -out /tmp/n.crt'); C('sudo scp /tmp/n.crt admin@10.0.0.10:/tmp/n.crt'); const keep = W2('sudo cat /etc/nginx/ssl/web.crt'); W2('sudo cp /tmp/n.crt /etc/nginx/ssl/web.crt'); W2('sudo systemctl restart nginx'); r = api.httpGet(P, 'https://10.0.0.10'); ok(r.err && /COMMON_NAME_INVALID/.test(r.err), 'Name nicht im Zertifikat: COMMON_NAME_INVALID'); W2('sudo cp /tmp/web.crt /etc/nginx/ssl/web.crt'); W2('sudo systemctl restart nginx'); }
// Ablauf
r = api.httpGet(P, 'https://10.0.0.10'); ok(r.ok, 'wieder ok'); api.advanceDays(400); r = api.httpGet(P, 'https://10.0.0.10'); ok(r.err && /DATE_INVALID/.test(r.err) && /abgelaufen/.test(r.err), 'nach 400 Tagen abgelaufen'); ok(/expired/.test(C('openssl verify -CAfile /etc/ssl/ca/ca.crt /tmp/web.crt')) || /has expired/.test(C('openssl verify -CAfile /etc/ssl/ca/ca.crt /tmp/web.crt')), 'openssl verify meldet abgelaufen');
ok(/200 OK/.test(api.hostLine(P, NL.newSess(), 'curl -k https://10.0.0.10')) && /SSL certificate problem/.test(api.hostLine(P, NL.newSess(), 'curl https://10.0.0.10')), 'curl: ohne -k Fehler, mit -k ok');
// Erneuerung ohne Reload: alter Stand wird weiter ausgeliefert
C('sudo openssl x509 -req -in /tmp/web.csr -CA /etc/ssl/ca/ca.crt -CAkey /etc/ssl/ca/ca.key -days 365 -out /tmp/web2.crt'); C('sudo scp /tmp/web2.crt admin@10.0.0.10:/tmp/web2.crt'); W('sudo cp /tmp/web2.crt /etc/nginx/ssl/web.crt'); ok(api.httpGet(P, 'https://10.0.0.10').err, 'neues Zertifikat ohne Reload wirkt noch nicht');
W('sudo systemctl reload nginx'); ok(api.httpGet(P, 'https://10.0.0.10').ok, 'nach Reload gueltig');
// Linux-Client mit update-ca-certificates
ok(/SSL certificate problem/.test(api.lx('SRV-CA', 'curl https://10.0.0.10')), 'Linux-Server ohne CA im Speicher: curl scheitert');
C('sudo cp /etc/ssl/ca/ca.crt /usr/local/share/ca-certificates/lab-ca.crt'); ok(/1 added/.test(C('sudo update-ca-certificates')), 'update-ca-certificates'); ok(/200 OK/.test(api.lx('SRV-CA', 'curl https://10.0.0.10')), 'Linux-Server mit CA: curl ok');
process.exit(bad ? 1 : 0);
