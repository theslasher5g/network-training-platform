// Docker und Kubernetes (k3s) auf einem Linux-Server
global.NL = require('../src/engine.js'); global.window = undefined;
const SB = require('../src/sandbox.js'), LXm = require('../src/linux.js');
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const net = { devs: {}, links: [], seq: 1 }, api = SB.testApi(net), A = (m, h) => api.addDev(m, 0, 0, h), G = n => 'GigabitEthernet1/0/' + n;
const sv = A('HW-1288H-V5', 'SRV-C'), pc = A('PC', 'PC-1'), sw = A('C9200L-24T-4G', 'SW'), rt = A('ISR4321', 'R-GW');
const cu = (a, ap, b, bp) => net.links.push({ a, ap, b, bp, cable: 'cu' }); cu(sv, 'eth0', sw, G(1)); cu(pc, 'eth0', sw, G(2)); cu(rt, 'GigabitEthernet0/0/0', sw, G(24));
{ const s = NL.newSess(); ['enable', 'configure terminal', 'interface g0/0/0', 'ip address 10.0.0.1 255.255.255.0', 'no shutdown', 'end'].forEach(l => NL.exec(net, rt, s, l)); }
api.hostLine(net.devs[sv], NL.newSess(), 'ip 10.0.0.10/24 10.0.0.1'); api.hostLine(net.devs[pc], NL.newSess(), 'ip 10.0.0.20/24 10.0.0.1');
const L = c => api.lx('SRV-C', c), P = net.devs[pc];
ok(/not found/.test(L('docker ps')), 'ohne Paket kein docker');
L('sudo apt install docker.io'); ok(/Cannot connect/.test(L('sudo docker ps')), 'Daemon laeuft noch nicht');
L('sudo systemctl enable --now docker'); ok(/permission denied/.test(L('docker ps')), 'ohne sudo keine Berechtigung');
ok(/CONTAINER ID/.test(L('sudo docker ps')), 'docker ps (leer)');
// Port belegt durch nginx auf dem Host
L('sudo apt install nginx'); L('sudo systemctl enable --now nginx'); ok(/port is already allocated/.test(L('sudo docker run -d --name web -p 80:80 nginx')), 'Port 80 durch Host-nginx belegt');
L('sudo systemctl stop nginx'); let o = L('sudo docker run -d --name web -p 8080:80 nginx'); ok(/^[0-9a-f]{64}$/m.test(o), 'Container gestartet: ' + o.split('\n').pop().slice(0, 12));
ok(/web/.test(L('sudo docker ps')) && /0\.0\.0\.0:8080->80/.test(L('sudo docker ps')), 'ps zeigt Port-Mapping');
ok(/Welcome to nginx/.test((api.httpGet(P, 'http://10.0.0.10:8080') || {}).title || ''), 'PC erreicht Container auf 8080');
ok(api.httpGet(P, 'http://10.0.0.10').err, 'Port 80 nicht erreichbar');
const lx = LXm.init(net.devs[sv]); lx.ufw.on = true; ok(/Zeit/.test(api.httpGet(P, 'http://10.0.0.10:8080').err), 'ufw blockt 8080'); L('sudo ufw allow 8080'); ok(api.httpGet(P, 'http://10.0.0.10:8080').ok, 'nach ufw allow erreichbar');
// Bind-Mount
L('sudo mkdir -p /srv/site'); L('echo "<html><head><title>Firma</title></head><body>Hallo Firma</body></html>" | sudo tee /srv/site/index.html'); L('sudo docker run -d --name site -p 8081:80 -v /srv/site:/usr/share/nginx/html nginx'); L('sudo ufw allow 8081');
let g = api.httpGet(P, 'http://10.0.0.10:8081'); ok(g.ok && g.title === 'Firma' && /Hallo Firma/.test(g.body), 'Bind-Mount liefert eigene Seite');
ok(/Conflict/.test(L('sudo docker run -d --name site -p 8082:80 nginx')), 'Name doppelt');
L('sudo docker stop web'); ok(api.httpGet(P, 'http://10.0.0.10:8080').err, 'gestoppter Container antwortet nicht');
ok(!/web/.test(L('sudo docker ps')) && /Exited/.test(L('sudo docker ps -a')), 'ps -a zeigt gestoppt');
ok(/running/.test(L('sudo docker rm web') && 'running') && !/web/.test(L('sudo docker ps -a')), 'rm entfernt');
o = L('sudo docker run -d --name db mysql'); L('sudo docker ps -a'); ok(/Exited \(1\)/.test(L('sudo docker ps -a')) && /MYSQL_ROOT_PASSWORD/.test(L('sudo docker logs db')), 'mysql ohne Passwort beendet sich');
ok(/Hello from Docker/.test(L('sudo docker run hello-world')), 'hello-world'); ok(/hallo/.test(L('sudo docker run --rm alpine echo hallo')), 'alpine echo');
ok(/pull access denied/.test(L('sudo docker pull gibtesnicht')), 'unbekanntes Image');
// Kein Internet: Gateway weg
net.devs[sv].cfg.gw = null; ok(/name resolution|Temporary/.test(L('sudo docker pull redis')), 'ohne Gateway kein Pull'); net.devs[sv].cfg.gw = '10.0.0.1';
// Kubernetes
ok(/not found/.test(L('kubectl get pods')), 'kubectl ohne k3s'); L('sudo apt install k3s'); ok(/refused/.test(L('sudo kubectl get nodes')), 'k3s nicht gestartet'); L('sudo systemctl enable --now k3s');
ok(/permission denied/.test(L('kubectl get nodes')), 'kubectl ohne sudo'); ok(/Ready/.test(L('sudo kubectl get nodes')), 'Node Ready');
L('sudo kubectl create deployment web --image=nginx --replicas=3'); const pods = L('sudo kubectl get pods'); ok((pods.match(/Running/g) || []).length === 3, 'drei Pods laufen');
L('sudo kubectl expose deployment web --port=80 --type=NodePort'); const svc = L('sudo kubectl get svc'), np = +(svc.match(/80:(\d+)\/TCP/) || [])[1]; ok(np >= 30000 && np <= 32767, 'NodePort ' + np);
L('sudo ufw allow ' + np); g = api.httpGet(P, 'http://10.0.0.10:' + np); ok(g.ok && /nginx/.test(g.title), 'PC erreicht NodePort');
L('sudo kubectl scale deployment web --replicas=5'); ok((L('sudo kubectl get pods').match(/Running/g) || []).length === 5, 'skaliert auf 5');
L('sudo kubectl create deployment kaputt --image=nginx:gibts-nicht-im-simulator-aber-tag'); L('sudo kubectl create deployment falsch --image=nichtda'); ok(/ImagePullBackOff/.test(L('sudo kubectl get pods')) && /pull access denied/.test(L('sudo kubectl describe pod ' + L('sudo kubectl get pods').split('\n').find(l => /falsch/.test(l)).split(/\s+/)[0])), 'unbekanntes Image: ImagePullBackOff');
L('sudo kubectl delete deployment web'); ok(/503|Pod/.test(api.httpGet(P, 'http://10.0.0.10:' + np).err || ''), 'ohne Deployment kein Pod (503)');
L('sudo bash -c true'); L('printf "apiVersion: apps/v1\\nkind: Deployment\\nmetadata:\\n  name: shop\\nspec:\\n  replicas: 2\\n  selector:\\n    matchLabels:\\n      app: shop\\n  template:\\n    spec:\\n      containers:\\n      - name: shop\\n        image: httpd\\n---\\napiVersion: v1\\nkind: Service\\nmetadata:\\n  name: shop\\nspec:\\n  type: NodePort\\n  selector:\\n    app: shop\\n  ports:\\n  - port: 80\\n    nodePort: 30090\\n" > /home/admin/shop.yaml');
o = L('sudo kubectl apply -f /home/admin/shop.yaml'); ok(/deployment.apps\/shop created/.test(o) && /service\/shop created/.test(o), 'apply -f legt Deployment und Service an: ' + o.replace(/\n/g, ' | ')); L('sudo ufw allow 30090'); g = api.httpGet(P, 'http://10.0.0.10:30090'); ok(g.ok && g.title === 'It works!', 'httpd ueber NodePort 30090');
process.exit(bad ? 1 : 0);
