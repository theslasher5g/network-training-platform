// ===================== NetLab Container (Docker und Kubernetes/k3s) =====================
// Läuft auf Linux-Servern: Paket docker.io (docker-Befehle) und k3s (kubectl). Images stammen aus einer
// simulierten Registry und brauchen beim ersten Mal eine Internetverbindung. Veröffentlichte Ports und NodePorts
// sind von anderen Geräten per HTTP erreichbar (Anbindung an httpGet im Sandbox-Modul).
const CTR = (function () {
  const hash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
  const hex = (s, n) => { let o = '', h = hash(s); while (o.length < n) { h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0; o += h.toString(16).padStart(8, '0'); } return o.slice(0, n); };
  const al = (s, n) => { let o = '', h = hash(s); while (o.length < n) { h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0; o += 'bcdfghjklmnpqrstvwxz2456789'[h % 27]; } return o; };
  const NAMES = ['brave_turing', 'calm_curie', 'eager_hopper', 'keen_lovelace', 'quirky_ritchie', 'happy_torvalds'];
  // Simulierte Registry: web = liefert eine Webseite, env = Pflicht-Variable (sonst beendet sich der Container)
  const REG = {
    nginx: { mb: 192, port: 80, web: { title: 'Welcome to nginx!', body: 'Welcome to nginx! If you see this page, the nginx web server is successfully installed and working.', root: '/usr/share/nginx/html' } },
    httpd: { mb: 148, port: 80, web: { title: 'It works!', body: 'It works!', root: '/usr/local/apache2/htdocs' } },
    'grafana/grafana': { mb: 410, port: 3000, web: { title: 'Grafana', body: 'Grafana Welcome to Grafana. Anmeldung: admin / admin' } },
    redis: { mb: 117, port: 6379 }, mysql: { mb: 586, port: 3306, env: 'MYSQL_ROOT_PASSWORD' }, postgres: { mb: 379, port: 5432, env: 'POSTGRES_PASSWORD' },
    alpine: { mb: 8, sh: true }, busybox: { mb: 5, sh: true }, python: { mb: 1020, sh: true }, 'hello-world': { mb: 1, hello: true }
  };
  const WELL = { 22: 'ssh', 80: 'nginx', 443: 'nginx' };
  const st = d => d.ctr || (d.ctr = { images: [], cts: [], seq: 1, k: { deps: [], svcs: [], cache: [], seq: 1 } });
  const imgKey = s => { const m = String(s).match(/^([^:]+)(?::(.+))?$/); return m ? { name: m[1].replace(/^docker\.io\//, '').replace(/^library\//, ''), tag: m[2] || 'latest' } : null; };
  const known = s => { const k = imgKey(s); return !!k && !!REG[k.name]; };
  const unitOn = (d, u) => !!(d.lx && d.lx.units && d.lx.units[u] && d.lx.units[u].active && d.lx.pkgs.includes(u === 'docker' ? 'docker.io' : u));
  const dockerOn = d => unitOn(d, 'docker'), k3sOn = d => unitOn(d, 'k3s');
  const htmlTitle = t => { const m = /<title>([\s\S]*?)<\/title>/i.exec(t); return m ? m[1].trim() : null; };
  const htmlBody = t => String(t).replace(/<title>[\s\S]*?<\/title>/i, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const ago = n => n < 1 ? 'Less than a second ago' : n + ' minutes ago';

  // ---------- Web-Auslieferung eines Containers ----------
  // Inhalt: Bind-Mount auf das Web-Root des Images (Datei index.html auf dem Host) oder Standardseite
  function pageOf(d, L, ct) {
    const im = REG[imgKey(ct.image).name]; if (!im || !im.web) return null;
    const m = (ct.mounts || []).find(x => im.web.root && x.c.replace(/\/$/, '') === im.web.root);
    if (m) { const e = L.fs[m.h.replace(/\/$/, '') + '/index.html']; if (e && !e.d) return { title: htmlTitle(e.t) || ct.name, body: htmlBody(e.t) }; return { title: '403 Forbidden', body: '403 Forbidden nginx' }; }
    return { title: im.web.title, body: im.web.body };
  }
  // Wird von httpGet gerufen: liefert die Antwort, wenn ein Container oder Kubernetes-Dienst den Port bedient
  function web(srv, port, L, online) {
    if (!srv || !srv.ctr) return null; L = L || srv.lx; const S = srv.ctr;
    if (dockerOn(srv)) { const ct = S.cts.find(c => c.state === 'running' && (c.ports || []).some(p => p.h === port)); if (ct) { const p = pageOf(srv, L, ct); if (p) return Object.assign({ via: 'docker:' + ct.name }, p); return { via: 'docker:' + ct.name, empty: true }; } }
    if (k3sOn(srv)) {
      const sv = S.k.svcs.find(x => x.type !== 'ClusterIP' && (x.type === 'LoadBalancer' ? x.port === port : x.nodePort === port));
      if (sv) { const pods = podsOf(srv, L, online).filter(p => p.dep === sv.dep && p.status === 'Running'); if (!pods.length) return { via: 'k8s:' + sv.name, empty: true, none: true }; const dep = S.k.deps.find(x => x.name === sv.dep), im = REG[imgKey(dep.image).name]; const pod = pods[(S.k.rr = ((S.k.rr || 0) + 1)) % pods.length]; return im && im.web ? { via: 'k8s:' + sv.name, title: im.web.title, body: im.web.body + ' (Pod ' + pod.name + ')' } : { via: 'k8s:' + sv.name, empty: true }; }
    }
    return null;
  }
  
  // ---------- Docker ----------
  function pull(d, name, online) {
    const k = imgKey(name); if (!k || !REG[k.name]) return { err: `Error response from daemon: pull access denied for ${name}, repository does not exist or may require 'docker login'` };
    if (online) return { err: `Error response from daemon: Get "https://registry-1.docker.io/v2/": dial tcp: lookup registry-1.docker.io: Temporary failure in name resolution (${online})` };
    const S = st(d); if (!S.images.some(i => i.name === k.name && i.tag === k.tag)) S.images.push({ name: k.name, tag: k.tag, id: hex(k.name + k.tag, 12), mb: REG[k.name].mb });
    return { ok: true, k };
  }
  const tbl = (head, rows) => { const all = [head].concat(rows), w = head.map((_, i) => Math.max(...all.map(r => String(r[i]).length)) + 3); return all.map(r => r.map((c, i) => i === r.length - 1 ? String(c) : String(c).padEnd(w[i])).join('')).join('\n'); };
  const portsText = ct => (ct.ports || []).map(p => `0.0.0.0:${p.h}->${p.c}/tcp`).join(', ');
  function usedPorts(d, L) { const m = {}; Object.keys(WELL).forEach(p => { const u = WELL[p]; if (L.units && L.units[u] && L.units[u].active) m[p] = u === 'ssh' ? 'sshd' : 'nginx'; }); st(d).cts.forEach(c => { if (c.state === 'running') (c.ports || []).forEach(p => { m[p.h] = 'docker:' + c.name; }); }); return m; }
  function dockerRun(d, L, a, root, ctx) {
    const S = st(d); let name = null, det = false, rm = false, ports = [], env = {}, mounts = [], restart = 'no', i = 0, img = null, cmd = [];
    for (; i < a.length; i++) {
      const t = a[i]; if (img) { cmd.push(t); continue; }
      if (t === '-d' || t === '--detach') det = true; else if (t === '--rm') rm = true; else if (t === '-it' || t === '-i' || t === '-t') { /* interaktiv */ }
      else if (t === '--name') name = a[++i]; else if (t.startsWith('--name=')) name = t.slice(7);
      else if (t === '-p' || t === '--publish') { const m = String(a[++i]).match(/^(?:[\d.]+:)?(\d+):(\d+)(?:\/tcp)?$/); if (!m) return `docker: Error response from daemon: invalid publish opts format (should be name=value but got '${a[i]}').`; ports.push({ h: +m[1], c: +m[2] }); }
      else if (t === '-e' || t === '--env') { const m = String(a[++i]).split('='); env[m[0]] = m.slice(1).join('='); }
      else if (t === '-v' || t === '--volume') { const m = String(a[++i]).split(':'); if (m.length < 2) return 'docker: Error response from daemon: invalid volume specification'; mounts.push({ h: m[0], c: m[1] }); }
      else if (t === '--restart') restart = a[++i]; else if (t.startsWith('-')) return `unknown flag: ${t}\nSee 'docker run --help'.`; else img = t;
    }
    if (!img) return '"docker run" requires at least 1 argument.\nUsage:  docker run [OPTIONS] IMAGE [COMMAND] [ARG...]';
    const k = imgKey(img); let pulled = '';
    if (!k || !REG[k.name]) return `Unable to find image '${img}' locally\ndocker: Error response from daemon: pull access denied for ${img}, repository does not exist or may require 'docker login'.`;
    if (!S.images.some(x => x.name === k.name && x.tag === k.tag)) { const r = pull(d, img, ctx.online); if (r.err) return `Unable to find image '${img}' locally\ndocker: ${r.err}.`; pulled = `Unable to find image '${img}' locally\n${k.tag}: Pulling from library/${k.name}\nDigest: sha256:${hex(k.name, 64)}\nStatus: Downloaded newer image for ${k.name}:${k.tag}\n`; }
    if (name && S.cts.some(c => c.name === name)) return `docker: Error response from daemon: Conflict. The container name "/${name}" is already in use by container "${S.cts.find(c => c.name === name).id}". You have to remove (or rename) that container to be able to reuse that name.`;
    const used = usedPorts(d, L); for (const p of ports) if (used[p.h]) return `${pulled}docker: Error response from daemon: driver failed programming external connectivity on endpoint ${name || 'container'}: Bind for 0.0.0.0:${p.h} failed: port is already allocated (belegt durch ${used[p.h]}).`;
    const R = REG[k.name], id = hex(k.name + (S.seq) + (name || ''), 64), nm = name || NAMES[S.seq % NAMES.length] + (S.seq > NAMES.length ? S.seq : '');
    const ct = { id: id.slice(0, 12), full: id, name: nm, image: k.name + (k.tag === 'latest' ? '' : ':' + k.tag), ports, env, mounts, restart, state: 'running', code: 0, logs: [], created: ctx.day || 0 }; S.seq++;
    if (R.hello) { ct.state = 'exited'; ct.logs.push('Hello from Docker!\nThis message shows that your installation appears to be working correctly.'); if (!rm) S.cts.push(ct); return pulled + ct.logs[0]; }
    if (R.sh && !det) { const out = cmd.length ? shRun(cmd, ct, d, L) : ''; ct.state = 'exited'; ct.logs.push(out); if (!rm) S.cts.push(ct); return pulled + out + (cmd.length ? '' : '(Im Simulator gibt es keine interaktive Shell im Container. Nutze: docker run IMAGE echo hallo)'); }
    if (R.env && !env[R.env]) { ct.state = 'exited'; ct.code = 1; ct.logs.push(`[Entrypoint] Database is uninitialized and password option is not specified.\n  You need to specify one of the following as an environment variable:\n  - ${R.env}`); S.cts.push(ct); return det ? pulled + ct.full : pulled + ct.logs[0]; }
    ct.logs.push(R.web ? `/docker-entrypoint.sh: Configuration complete; ready for start up\n${ct.image}: listening on port ${R.port}` : `${ct.image}: Ready to accept connections on port ${R.port}`);
    if (R.sh) { ct.logs.push(''); }
    S.cts.push(ct); return det ? pulled + ct.full : pulled + ct.logs[0] + '\n(Im Simulator läuft der Container im Hintergrund. Nächstes Mal mit -d.)';
  }
  function shRun(cmd, ct, d) { const c = cmd[0]; if (c === 'echo') return cmd.slice(1).join(' '); if (c === 'hostname') return ct.id; if (c === 'cat' && cmd[1] === '/etc/os-release') return ct.image.startsWith('alpine') ? 'NAME="Alpine Linux"' : 'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"'; if (c === 'ls') return 'bin  etc  home  lib  proc  root  tmp  usr  var'; if (c === 'whoami') return 'root'; if (c === 'uname') return 'Linux'; return `exec: "${c}": executable file not found in $PATH`; }
  function docker(d, L, a, root, ctx) {
    const S = st(d), sub = a[0]; if (!sub) return 'Usage:  docker [OPTIONS] COMMAND\n\nBefehle: run ps images pull stop start restart rm rmi logs exec inspect version info';
    if (sub === '--version') return 'Docker version 24.0.7, build afdd53b';
    if (!dockerOn(d)) return 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?\n(Starte ihn mit: sudo systemctl enable --now docker)';
    if (!root) return 'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock: connect: permission denied\n(versuche: sudo docker …)';
    const rest = a.slice(1), byName = n => S.cts.find(c => c.name === n || c.id.startsWith(n) || c.full.startsWith(n));
    switch (sub) {
      case 'version': return 'Client: Docker Engine - Community\n Version:           24.0.7\nServer: Docker Engine - Community\n Engine:\n  Version:          24.0.7';
      case 'info': return `Containers: ${S.cts.length}\n Running: ${S.cts.filter(c => c.state === 'running').length}\n Stopped: ${S.cts.filter(c => c.state !== 'running').length}\nImages: ${S.images.length}\nServer Version: 24.0.7\nStorage Driver: overlay2`;
      case 'pull': { if (!rest[0]) return '"docker pull" requires exactly 1 argument.'; const r = pull(d, rest[0], ctx.online); if (r.err) return r.err; return `${r.k.tag}: Pulling from library/${r.k.name}\nDigest: sha256:${hex(r.k.name, 64)}\nStatus: Downloaded newer image for ${r.k.name}:${r.k.tag}`; }
      case 'images': return tbl(['REPOSITORY', 'TAG', 'IMAGE ID', 'SIZE'], S.images.map(i => [i.name, i.tag, i.id, i.mb + 'MB']));
      case 'ps': { const all = rest.includes('-a') || rest.includes('--all'); return tbl(['CONTAINER ID', 'IMAGE', 'STATUS', 'PORTS', 'NAMES'], S.cts.filter(c => all || c.state === 'running').map(c => [c.id, c.image, c.state === 'running' ? 'Up 2 minutes' : `Exited (${c.code}) 1 minute ago`, c.state === 'running' ? portsText(c) : '', c.name])); }
      case 'run': return dockerRun(d, L, rest, root, ctx);
      case 'stop': case 'start': case 'restart': case 'kill': {
        if (!rest.length) return `"docker ${sub}" requires at least 1 argument.`;
        return rest.map(n => { const c = byName(n); if (!c) return `Error response from daemon: No such container: ${n}`; if (sub === 'stop' || sub === 'kill') { c.state = 'exited'; c.code = 0; return c.name; }
          const used = usedPorts(d, L); const clash = (c.ports || []).find(p => used[p.h] && c.state !== 'running'); if (clash) return `Error response from daemon: driver failed programming external connectivity on endpoint ${c.name}: Bind for 0.0.0.0:${clash.h} failed: port is already allocated\nError: failed to start containers: ${c.name}`;
          const R = REG[imgKey(c.image).name]; if (R.env && !(c.env || {})[R.env]) { c.state = 'exited'; c.code = 1; return `Error: ${c.name} beendet sich sofort (${R.env} fehlt).`; } c.state = 'running'; return c.name; }).join('\n'); }
      case 'rm': { const f = rest.includes('-f'); return rest.filter(x => !x.startsWith('-')).map(n => { const c = byName(n); if (!c) return `Error response from daemon: No such container: ${n}`; if (c.state === 'running' && !f) return `Error response from daemon: cannot remove container "/${c.name}": container is running: stop the container before removing or force remove`; S.cts = S.cts.filter(x => x !== c); return n; }).join('\n'); }
      case 'rmi': return rest.filter(x => !x.startsWith('-')).map(n => { const k = imgKey(n), i = S.images.find(x => x.name === k.name && x.tag === k.tag || x.id === n); if (!i) return `Error response from daemon: No such image: ${n}`; const u = S.cts.find(c => imgKey(c.image).name === i.name); if (u) return `Error response from daemon: conflict: unable to remove repository reference "${n}" (must force) - container ${u.id} is using its referenced image ${i.id}`; S.images = S.images.filter(x => x !== i); return `Untagged: ${i.name}:${i.tag}\nDeleted: sha256:${hex(i.id, 64)}`; }).join('\n');
      case 'logs': { const c = byName(rest.filter(x => !x.startsWith('-')).pop()); return c ? c.logs.join('\n') : 'Error response from daemon: No such container'; }
      case 'inspect': { const c = byName(rest[0]); return c ? JSON.stringify({ Id: c.full, Name: '/' + c.name, Image: c.image, State: { Status: c.state, ExitCode: c.code }, HostConfig: { PortBindings: c.ports, RestartPolicy: { Name: c.restart } }, Mounts: c.mounts }, null, 2) : 'Error: No such object: ' + rest[0]; }
      case 'exec': { const ar = rest.filter(x => x !== '-it' && x !== '-i' && x !== '-t'), c = byName(ar[0]); if (!c) return `Error response from daemon: No such container: ${ar[0]}`; if (c.state !== 'running') return `Error response from daemon: container ${c.id} is not running`; const cmd = ar.slice(1); if (!cmd.length) return 'docker exec requires an Befehl'; if (['sh', 'bash'].includes(cmd[0])) return '(Interaktive Shells gibt es im Simulator nicht. Nutze: docker exec NAME ls / oder cat DATEI)';
        if (cmd[0] === 'cat' && cmd[1]) { const im = REG[imgKey(c.image).name], pg = im && im.web ? pageOf(d, L, c) : null; if (pg && cmd[1].replace(/\/[^/]*$/, '') === im.web.root) return pg.body; } return shRun(cmd, c, d, L); }
      default: return `docker: '${sub}' is not a docker command.\nSee 'docker --help'`;
    }
  }

  // ---------- Kubernetes (k3s) ----------
  function podsOf(d, L, online) {
    const S = st(d), out = [];
    for (const dep of S.k.deps) {
      const k = imgKey(dep.image), ok = k && REG[k.name], key = ok && k.name + ':' + k.tag; let status = 'Running';
      if (!ok) status = 'ImagePullBackOff'; else if (!S.k.cache.includes(key)) { if (online === undefined || online) status = 'ImagePullBackOff'; else S.k.cache.push(key); }
      if (status === 'Running' && REG[k.name].env && !(dep.env || {})[REG[k.name].env]) status = 'CrashLoopBackOff';
      for (let i = 0; i < dep.replicas; i++) out.push({ name: `${dep.name}-${al(dep.name + dep.rev, 9)}-${al(dep.name + dep.rev + i, 5)}`, dep: dep.name, image: dep.image, status, i, rev: dep.rev });
    }
    return out;
  }
  const age = () => '2m';
  function readManifest(L, file) { const e = L.fs[file]; return e && !e.d ? e.t : null; }
  function applyYaml(d, L, txt, ctx) {
    const S = st(d), out = [];
    for (const doc of txt.split(/^---\s*$/m)) {
      const kind = (/^kind:\s*(\S+)/m.exec(doc) || [])[1]; if (!kind) continue;
      const name = (/^\s{2}name:\s*(\S+)/m.exec(doc) || /^\s*name:\s*(\S+)/m.exec(doc) || [])[1]; if (!name) return { err: 'error: error validating data: metadata.name fehlt' };
      if (kind === 'Deployment') {
        const rep = +((/replicas:\s*(\d+)/.exec(doc) || [])[1] || 1), image = (/image:\s*(\S+)/.exec(doc) || [])[1], app = (/matchLabels:\s*\n\s*app:\s*(\S+)/.exec(doc) || [])[1] || name; if (!image) return { err: 'error: Deployment ohne Container-Image' };
        const env = {}; for (const m of doc.matchAll(/-\s*name:\s*(\S+)\s*\n\s*value:\s*"?([^"\n]+)"?/g)) env[m[1]] = m[2];
        const ex = S.k.deps.find(x => x.name === name); if (ex) { const ch = ex.image !== image; ex.replicas = rep; ex.image = image; ex.app = app; ex.env = env; if (ch) ex.rev++; out.push(`deployment.apps/${name} ${ch ? 'configured' : 'unchanged'}`); } else { S.k.deps.push({ name, image, replicas: rep, app, rev: 1, env }); out.push(`deployment.apps/${name} created`); }
      } else if (kind === 'Service') {
        const type = (/type:\s*(\S+)/.exec(doc) || [])[1] || 'ClusterIP', port = +((/^\s*-?\s*port:\s*(\d+)/m.exec(doc) || [])[1] || 80), np = (/nodePort:\s*(\d+)/.exec(doc) || [])[1], sel = (/selector:\s*\n\s*app:\s*(\S+)/.exec(doc) || [])[1];
        if (!sel) return { err: `The Service "${name}" is invalid: spec.selector fehlt` };
        if (np && (+np < 30000 || +np > 32767)) return { err: `The Service "${name}" is invalid: spec.ports[0].nodePort: Invalid value: ${np}: provided port is not in the valid range. The range of valid ports is 30000-32767` };
        const dep = S.k.deps.find(x => x.app === sel); const ex = S.k.svcs.find(x => x.name === name), o = { name, type, port, nodePort: type === 'NodePort' ? (np ? +np : (ex && ex.nodePort) || nodePortFor(S, name)) : null, dep: dep ? dep.name : sel, sel };
        if (ex) { Object.assign(ex, o); out.push(`service/${name} configured`); } else { S.k.svcs.push(o); out.push(`service/${name} created`); }
      } else return { err: `error: no matches for kind "${kind}" in version "v1"` };
    }
    return out.length ? { out: out.join('\n') } : { err: 'error: no objects passed to apply' };
  }
  function nodePortFor(S, name) { let p = 30000 + hash(name) % 2767; while (S.k.svcs.some(x => x.nodePort === p)) p++; return p; }
  function kubectl(d, L, a, root, ctx) {
    const S = st(d), K = S.k; let sub = a[0];
    if (!k3sOn(d)) return 'The connection to the server localhost:8080 was refused - did you specify the right host or port?\n(k3s ist nicht gestartet: sudo apt install k3s, dann sudo systemctl enable --now k3s)';
    if (!root) return 'WARN[0000] Unable to read /etc/rancher/k3s/k3s.yaml, please start server with --write-kubeconfig-mode to modify kube config permissions\nerror: error loading config file "/etc/rancher/k3s/k3s.yaml": open /etc/rancher/k3s/k3s.yaml: permission denied\n(versuche: sudo kubectl …)';
    const rest = a.slice(1), hn = d.cfg.hostname.toLowerCase();
    const flag = n => { const i = rest.findIndex(x => x === '--' + n || x.startsWith('--' + n + '=')); if (i < 0) return null; return rest[i].includes('=') ? rest[i].split('=').slice(1).join('=') : rest[i + 1]; };
    const pos = rest.filter(x => !x.startsWith('-')), nx = x => ({ deployments: 'deployment', deployment: 'deployment', deploy: 'deployment', pods: 'pod', pod: 'pod', po: 'pod', services: 'service', service: 'service', svc: 'service', nodes: 'node', node: 'node', no: 'node' }[x] || x);
    const wide = rest.includes('-o') && rest[rest.indexOf('-o') + 1] === 'wide';
    switch (sub) {
      case 'version': return 'Client Version: v1.29.4+k3s1\nServer Version: v1.29.4+k3s1';
      case 'get': {
        const t = nx((pos[0] || '').split('/')[0]), pods = podsOf(d, L, ctx.online);
        if (t === 'node') return tbl(['NAME', 'STATUS', 'ROLES', 'AGE', 'VERSION'], [[hn, 'Ready', 'control-plane,master', '10m', 'v1.29.4+k3s1']]);
        if (t === 'pod') return pods.length ? tbl(wide ? ['NAME', 'READY', 'STATUS', 'RESTARTS', 'AGE', 'IMAGE'] : ['NAME', 'READY', 'STATUS', 'RESTARTS', 'AGE'], pods.map(p => [p.name, p.status === 'Running' ? '1/1' : '0/1', p.status, p.status === 'CrashLoopBackOff' ? '4' : '0', age()].concat(wide ? [p.image] : []))) : 'No resources found in default namespace.';
        if (t === 'deployment') return K.deps.length ? tbl(['NAME', 'READY', 'UP-TO-DATE', 'AVAILABLE', 'AGE'], K.deps.map(x => { const r = podsOf(d, L, ctx.online).filter(p => p.dep === x.name && p.status === 'Running').length; return [x.name, `${r}/${x.replicas}`, x.replicas, r, age()]; })) : 'No resources found in default namespace.';
        if (t === 'service') return tbl(['NAME', 'TYPE', 'CLUSTER-IP', 'EXTERNAL-IP', 'PORT(S)', 'AGE'], [['kubernetes', 'ClusterIP', '10.43.0.1', '<none>', '443/TCP', '10m']].concat(K.svcs.map((x, i) => [x.name, x.type, `10.43.${100 + i}.${10 + i * 7}`, x.type === 'LoadBalancer' ? (d.cfg.ip || '<pending>') : '<none>', x.nodePort ? `${x.port}:${x.nodePort}/TCP` : `${x.port}/TCP`, age()])));
        if (t === 'all') return [kubectl(d, L, ['get', 'pods'], root, ctx), kubectl(d, L, ['get', 'svc'], root, ctx), kubectl(d, L, ['get', 'deploy'], root, ctx)].join('\n\n');
        return `error: the server doesn't have a resource type "${pos[0] || ''}"`; }
      case 'create': {
        if (nx(pos[0]) !== 'deployment' || !pos[1]) return 'error: Verwende: kubectl create deployment NAME --image=IMAGE [--replicas=N]'; const image = flag('image'); if (!image) return 'error: required flag(s) "image" not set';
        if (K.deps.some(x => x.name === pos[1])) return `Error from server (AlreadyExists): deployments.apps "${pos[1]}" already exists`;
        const rep = flag('replicas') ? +flag('replicas') : 1; if (!(rep >= 0 && rep <= 20)) return 'error: replicas: 0 bis 20';
        K.deps.push({ name: pos[1], image, replicas: rep, app: pos[1], rev: 1, env: {} }); return `deployment.apps/${pos[1]} created`; }
      case 'scale': { const m = (pos[0] || '').split('/'), name = m[1] || pos[1], dep = K.deps.find(x => x.name === name), n = flag('replicas'); if (!dep) return `Error from server (NotFound): deployments.apps "${name}" not found`; if (n === null || !(+n >= 0 && +n <= 20)) return 'error: --replicas=0..20'; dep.replicas = +n; return `deployment.apps/${name} scaled`; }
      case 'expose': { const m = (pos[0] || '').split('/'), name = m[1] || pos[1], dep = K.deps.find(x => x.name === name), port = +flag('port'); if (!dep) return `Error from server (NotFound): deployments.apps "${name}" not found`; if (!(port > 0)) return 'error: --port=PORT fehlt'; const type = flag('type') || 'ClusterIP'; if (!['ClusterIP', 'NodePort', 'LoadBalancer'].includes(type)) return `error: unknown service type "${type}"`;
        if (K.svcs.some(x => x.name === name)) return `Error from server (AlreadyExists): services "${name}" already exists`; if (type === 'LoadBalancer') { const u = usedPorts(d, L); if (u[port]) return `service/${name} exposed\n(Hinweis: Port ${port} ist auf dem Node schon durch ${u[port]} belegt – der Dienst bleibt pending.)`; }
        K.svcs.push({ name, type, port, nodePort: type === 'NodePort' ? nodePortFor(S, name) : null, dep: name, sel: dep.app }); return `service/${name} exposed`; }
      case 'delete': { const t = nx((pos[0] || '').split('/')[0]), name = (pos[0] || '').split('/')[1] || pos[1];
        if (t === 'deployment') { if (!K.deps.some(x => x.name === name)) return `Error from server (NotFound): deployments.apps "${name}" not found`; K.deps = K.deps.filter(x => x.name !== name); K.svcs.forEach(s => { }); return `deployment.apps "${name}" deleted`; }
        if (t === 'service') { if (!K.svcs.some(x => x.name === name)) return `Error from server (NotFound): services "${name}" not found`; K.svcs = K.svcs.filter(x => x.name !== name); return `service "${name}" deleted`; }
        if (t === 'pod') { const p = podsOf(d, L, ctx.online).find(x => x.name === name); if (!p) return `Error from server (NotFound): pods "${name}" not found`; const dep = K.deps.find(x => x.name === p.dep); dep.rev++; return `pod "${name}" deleted (der Deployment-Controller startet einen neuen Pod)`; }
        return 'error: Verwende: kubectl delete deployment|service|pod NAME'; }
      case 'set': { if (pos[0] !== 'image') return 'error: kubectl set image deployment/NAME CONTAINER=IMAGE'; const name = (pos[1] || '').split('/')[1] || pos[1], dep = K.deps.find(x => x.name === name), im = (pos[2] || '').split('=')[1]; if (!dep) return `Error from server (NotFound): deployments.apps "${name}" not found`; if (!im) return 'error: CONTAINER=IMAGE fehlt'; dep.image = im; dep.rev++; return `deployment.apps/${name} image updated`; }
      case 'rollout': { const name = (pos[1] || '').split('/')[1] || pos[1], dep = K.deps.find(x => x.name === name); if (!dep) return `Error from server (NotFound): deployments.apps "${name}" not found`; const r = podsOf(d, L, ctx.online).filter(p => p.dep === name && p.status === 'Running').length; return r >= dep.replicas ? `deployment "${name}" successfully rolled out` : `Waiting for deployment "${name}" rollout to finish: ${r} of ${dep.replicas} updated replicas are available...`; }
      case 'describe': { const t = nx((pos[0] || '').split('/')[0]), name = (pos[0] || '').split('/')[1] || pos[1]; if (t === 'pod') { const p = podsOf(d, L, ctx.online).find(x => x.name === name); if (!p) return `Error from server (NotFound): pods "${name}" not found`; const k = imgKey(p.image); const ev = p.status === 'ImagePullBackOff' ? `  Warning  Failed   Failed to pull image "${p.image}": ${k && REG[k.name] ? 'Temporary failure in name resolution (keine Internetverbindung)' : 'pull access denied, repository does not exist'}\n  Warning  Failed   Error: ImagePullBackOff` : p.status === 'CrashLoopBackOff' ? '  Warning  BackOff  Back-off restarting failed container (Umgebungsvariable fehlt?)' : '  Normal   Started  Started container'; return `Name:   ${p.name}\nNamespace: default\nNode:   ${hn}\nStatus: ${p.status === 'Running' ? 'Running' : 'Pending'}\nImage:  ${p.image}\nEvents:\n${ev}`; }
        if (t === 'deployment') { const x = K.deps.find(y => y.name === name); return x ? `Name: ${x.name}\nReplicas: ${x.replicas} desired\nImage: ${x.image}` : `Error from server (NotFound): deployments.apps "${name}" not found`; }
        if (t === 'service') { const x = K.svcs.find(y => y.name === name); return x ? `Name: ${x.name}\nType: ${x.type}\nPort: ${x.port}/TCP\nNodePort: ${x.nodePort || '<none>'}\nSelector: app=${x.sel}\nEndpoints: ${podsOf(d, L, ctx.online).filter(p => p.dep === x.dep && p.status === 'Running').length} Pods` : `Error from server (NotFound): services "${name}" not found`; } return 'error: Verwende: kubectl describe pod|deployment|service NAME'; }
      case 'logs': { const p = podsOf(d, L, ctx.online).find(x => x.name === pos[0]); if (!p) return `Error from server (NotFound): pods "${pos[0]}" not found`; return p.status === 'Running' ? `${p.image}: listening on port ${(REG[imgKey(p.image).name] || {}).port}` : `Error from server (BadRequest): container is waiting to start: ${p.status}`; }
      case 'apply': { const f = flag('filename') || (rest.indexOf('-f') >= 0 ? rest[rest.indexOf('-f') + 1] : null); if (!f) return 'error: must specify one of -f and -k'; const path = f.startsWith('/') ? f : (L.cwd + '/' + f).replace(/\/+/g, '/'), txt = readManifest(L, path); if (txt === null) return `error: the path "${f}" does not exist`; const r = applyYaml(d, L, txt, ctx); return r.err || r.out; }
      case 'top': return 'error: Metrics API not available';
      default: return `error: unknown command "${sub}" for "kubectl"`;
    }
  }
  function run(d, L, tool, a, root, ctx) { ctx = ctx || {}; if (tool === 'docker') return docker(d, L, a, root, ctx); return kubectl(d, L, a, root, ctx); }
  // Angaben für die Web-GUI
  function view(d, L, ctx) { ctx = ctx || {}; const S = st(d); return { images: S.images, cts: S.cts, deps: S.k.deps, svcs: S.k.svcs, pods: k3sOn(d) ? podsOf(d, L, ctx.online) : [], docker: dockerOn(d), k3s: k3sOn(d) }; }
  return { st, run, web, view, dockerOn, k3sOn, REG, known, imgKey, usedPorts, pull, applyYaml, podsOf };
})();
if (typeof module !== 'undefined') module.exports = CTR;
