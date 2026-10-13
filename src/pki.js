// ===================== NetLab Zertifikate und PKI =====================
// Simulierte Zertifikate: PEM-Dateien, deren Inhalt die Eckdaten (Name, Aussteller, Laufzeit, Schlüssel) trägt.
// Es gibt openssl (genrsa, req, x509, verify), einen Vertrauensspeicher je Gerät (d.trust) und die Prüfung
// durch den Browser. Die Zeit läuft in Tagen (net.day, der erste Tag ist der 13.10.2026).
const PKI = (function () {
  const BASE = Date.UTC(2026, 9, 13);
  const hash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
  const hex = (s, n) => { let o = '', h = hash(s); while (o.length < n) { h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0; o += h.toString(16).padStart(8, '0'); } return o.slice(0, n); };
  const enc = s => typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64');
  const dec = s => typeof atob === 'function' ? decodeURIComponent(escape(atob(s))) : Buffer.from(s, 'base64').toString('utf8');
  const TYPES = { key: 'PRIVATE KEY', csr: 'CERTIFICATE REQUEST', cert: 'CERTIFICATE' };
  const pem = (kind, o) => `-----BEGIN ${TYPES[kind]}-----\n${(enc(JSON.stringify(o)).match(/.{1,64}/g) || []).join('\n')}\n-----END ${TYPES[kind]}-----\n`;
  function parse(txt) {
    const m = /-----BEGIN ([A-Z ]+)-----\s*([\s\S]*?)\s*-----END \1-----/.exec(String(txt || '')); if (!m) return null;
    const kind = Object.keys(TYPES).find(k => TYPES[k] === m[1]); if (!kind) return null;
    try { const o = JSON.parse(dec(m[2].replace(/\s/g, ''))); return o && typeof o === 'object' ? { kind, o } : null; } catch (e) { return null; }
  }
  const dateOf = day => new Date(BASE + day * 86400000).toUTCString().replace(/^\w+, (\d+) (\w+) (\d+) .*/, (m, d, mo, y) => `${mo} ${String(+d).padStart(2, ' ')} 00:00:00 ${y} GMT`);
  const isoOf = day => new Date(BASE + day * 86400000).toISOString().slice(0, 10);
  const newKid = (d, bits) => { const s = d.pki = d.pki || { seq: 1 }; return hex(d.id + ':' + (s.seq++), 16); };
  const parseSubj = s => { const m = /CN\s*=\s*([^\/,]+)/.exec(String(s || '')); return m ? m[1].trim() : null; };
  const parseSan = s => { const out = []; String(s || '').split(',').forEach(x => { const m = /^\s*(DNS|IP)\s*:\s*(\S+)\s*$/i.exec(x); if (m) out.push(m[1].toUpperCase() + ':' + m[2]); }); return out; };
  const fp = c => hex((c.cn || '') + '|' + (c.kid || '') + '|' + (c.serial || ''), 40).toUpperCase().replace(/(..)(?=.)/g, '$1:');

  // ---------- Aufbau einer Zertifikatsdatei ----------
  const mkKey = (d, bits) => ({ kid: newKid(d), bits: bits || 2048 });
  const mkCsr = (key, cn, san) => ({ cn, san: san || [], kid: key.kid });
  function mkCert(d, { cn, san, kid, issuer, ik, ca, day, days, serial }) { const s = d.pki = d.pki || { seq: 1 }; return { cn, san: san || [], kid, issuer: issuer || cn, ik: ik || kid, ca: !!ca, nb: day, na: day + days, serial: serial || (1000 + (s.seq++)) }; }
  // Für Szenarien: Zertifikat direkt ausstellen (CA-Datei aus dem Dateisystem)
  function issue(net, d, ca, o) { const key = mkKey(d, 2048), c = mkCert(d, { cn: o.cn, san: o.san, kid: key.kid, issuer: ca.cert.cn, ik: ca.cert.kid, ca: false, day: o.day === undefined ? (net.day || 0) : o.day, days: o.days || 365 }); return { key: pem('key', key), cert: pem('cert', c) }; }
  function mkCa(d, cn, day, days) { const key = mkKey(d, 4096), c = mkCert(d, { cn, kid: key.kid, ca: true, day, days }); return { key: pem('key', key), cert: pem('cert', c), keyObj: key, certObj: c }; }

  // ---------- Prüfung ----------
  // Zertifikat gegen einen Vertrauensspeicher (Liste von CA-Kennungen) prüfen
  function verify(cert, trust, day, host) {
    const out = { ok: true, issues: [] };
    if (day < cert.nb) out.issues.push({ code: 'NOT_YET_VALID', msg: `Das Zertifikat ist erst ab dem ${isoOf(cert.nb)} gültig.` });
    if (day > cert.na) out.issues.push({ code: 'EXPIRED', msg: `Das Zertifikat ist am ${isoOf(cert.na)} abgelaufen.` });
    if (host !== undefined && host !== null) {
      const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(host), names = (cert.san || []).filter(x => (isIp ? x.startsWith('IP:') : x.startsWith('DNS:'))).map(x => x.slice(x.indexOf(':') + 1)); if (!isIp && !cert.san.length && cert.cn) names.push(cert.cn);
      const hit = names.some(n => n.toLowerCase() === host.toLowerCase() || (n.startsWith('*.') && host.toLowerCase().endsWith(n.slice(1).toLowerCase()) && host.split('.').length === n.split('.').length));
      if (!hit) out.issues.push({ code: 'NAME', msg: `Der Name „${host}“ steht nicht im Zertifikat (gültig für: ${(cert.san.length ? cert.san.map(x => x.slice(x.indexOf(':') + 1)) : [cert.cn]).join(', ')}).` });
    }
    const selfSigned = cert.issuer === cert.cn && cert.ik === cert.kid;
    const trusted = (trust || []).some(t => t.id === cert.ik);
    if (!trusted) out.issues.push({ code: 'UNTRUSTED', msg: selfSigned ? 'Das Zertifikat ist selbst signiert und nicht im Vertrauensspeicher.' : `Der Aussteller „${cert.issuer}“ ist nicht vertrauenswürdig (CA-Zertifikat fehlt im Vertrauensspeicher).` });
    out.ok = !out.issues.length; return out;
  }
  const trustList = d => (d.trust || []);
  const ERRCODE = { EXPIRED: 'NET::ERR_CERT_DATE_INVALID', NOT_YET_VALID: 'NET::ERR_CERT_DATE_INVALID', NAME: 'NET::ERR_CERT_COMMON_NAME_INVALID', UNTRUSTED: 'NET::ERR_CERT_AUTHORITY_INVALID' };
  // Prüfung, die der Browser/curl eines Clients bei https macht
  function clientCheck(c, cert, host, day) {
    const v = verify(cert, trustList(c), day, host); if (v.ok) return { ok: true };
    const first = v.issues.find(x => x.code === 'EXPIRED') || v.issues.find(x => x.code === 'NOT_YET_VALID') || v.issues.find(x => x.code === 'NAME') || v.issues[0];
    return { ok: false, code: ERRCODE[first.code], why: first.msg, issues: v.issues };
  }

  // ---------- Vertrauensspeicher ----------
  function trustAdd(d, cert) { if (!cert.ca && !(cert.issuer === cert.cn && cert.ik === cert.kid)) return { err: 'Das ist kein CA-Zertifikat (CA:TRUE fehlt). Importiere das Zertifikat der Zertifizierungsstelle, nicht das des Servers.' }; d.trust = d.trust || []; const id = cert.kid; if (d.trust.some(t => t.id === id)) return { ok: true, dup: true }; d.trust.push({ id, cn: cert.cn, na: cert.na }); return { ok: true }; }
  function trustRemove(d, cn) { const n = (d.trust || []).length; d.trust = (d.trust || []).filter(t => t.cn !== cn); return n - d.trust.length; }

  // ---------- openssl ----------
  const textOf = (c, kind) => {
    if (kind === 'csr') return `Certificate Request:\n    Data:\n        Subject: CN = ${c.cn}\n        Requested Extensions:\n${c.san.length ? '            X509v3 Subject Alternative Name:\n                ' + c.san.map(x => x.replace(':', ':')).join(', ') + '\n' : ''}`;
    return `Certificate:\n    Data:\n        Serial Number: ${c.serial}\n        Issuer: CN = ${c.issuer}\n        Validity\n            Not Before: ${dateOf(c.nb)}\n            Not After : ${dateOf(c.na)}\n        Subject: CN = ${c.cn}\n        X509v3 extensions:\n            X509v3 Basic Constraints: critical\n                CA:${c.ca ? 'TRUE' : 'FALSE'}\n${c.san.length ? '            X509v3 Subject Alternative Name:\n                ' + c.san.join(', ').replace(/DNS:/g, 'DNS:').replace(/IP:/g, 'IP Address:') + '\n' : ''}`;
  };
  function run(d, L, a, root, ctx) {
    ctx = ctx || {}; const day = ctx.day || 0, sub = a[0];
    if (!sub || sub === 'help') return 'openssl: Befehle: genrsa, req, x509, verify, version\nBeispiele:\n  openssl genrsa -out server.key 2048\n  openssl req -new -key server.key -out server.csr -subj "/CN=intranet.lab.local" -addext "subjectAltName=DNS:intranet.lab.local,IP:10.0.0.10"\n  openssl req -x509 -new -key ca.key -days 3650 -subj "/CN=Lab-CA" -out ca.crt\n  openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -days 365 -out server.crt\n  openssl x509 -in server.crt -noout -text';
    if (sub === 'version') return 'OpenSSL 3.0.2 15 Mar 2022 (Library: OpenSSL 3.0.2 15 Mar 2022)';
    const opt = (n, def) => { const i = a.indexOf(n); return i >= 0 && i + 1 < a.length ? a[i + 1] : def; }, has = n => a.includes(n);
    const abs = p => (p.startsWith('/') ? p : (L.cwd + '/' + p)).replace(/\/+/g, '/').replace(/\/$/, '');
    const dirOf = p => p.replace(/\/[^/]*$/, '') || '/', can = p => root || p.startsWith('/home/' + L.user + '/') || p.startsWith('/tmp/') || p.startsWith(L.cwd === '/root' ? '/root/' : '/home/' + L.user + '/');
    const read = p => { const e = L.fs[abs(p)]; return e && !e.d ? e.t : null; };
    const write = (p, t) => { p = abs(p); const dir = dirOf(p); if (!L.fs[dir] || !L.fs[dir].d) return `Can't open "${p}" for writing, No such file or directory`; if (!can(p)) return `Can't open "${p}" for writing, Permission denied (versuche: sudo openssl …)`; L.fs[p] = { t, o: root ? 'root' : L.user, m: /key|\.pem$/.test(p) && /key/.test(p) ? '600' : '644' }; return null; };
    const loadAs = (p, kind, flag) => { const t = read(p); if (t === null) return { err: `Could not open file or uri for ${flag}: ${p}\nerror: No such file or directory` }; const x = parse(t); if (!x || x.kind !== kind) return { err: `Could not read ${kind === 'key' ? 'private key' : kind === 'csr' ? 'certificate request' : 'certificate'} from ${p}\nerror: no start line (Datei ist kein ${kind === 'key' ? 'Schlüssel' : kind === 'csr' ? 'Zertifikatsantrag' : 'Zertifikat'})` }; return { o: x.o }; };
    const out = (p, txt, msg) => { if (!p) return txt; const e = write(p, txt); return e || msg || ''; };
    if (sub === 'genrsa') { const bits = +(a.filter(x => /^\d+$/.test(x)).pop() || 2048); if (![1024, 2048, 3072, 4096].includes(bits)) return 'genrsa: Schlüssellänge 1024, 2048, 3072 oder 4096'; const k = mkKey(d, bits); return out(opt('-out'), pem('key', k), ''); }
    if (sub === 'req') {
      const exts = a.map((x, i) => a[i - 1] === '-addext' ? x : null).filter(Boolean), san = parseSan(exts.filter(x => /^subjectAltName/i.test(x)).map(x => x.replace(/^subjectAltName\s*=\s*/i, '')).join(',')), subj = parseSubj(opt('-subj')), days = +(opt('-days', 30));
      if (has('-x509')) {
        let kobj; if (has('-newkey')) { kobj = mkKey(d, 2048); const kp = opt('-keyout'); const e = kp ? write(kp, pem('key', kobj)) : null; if (e) return e; } else { const r = loadAs(opt('-key', ''), 'key', '-key'); if (r.err) return r.err; kobj = r.o; }
        if (!subj) return 'req: Subject fehlt (-subj "/CN=Name").'; if (!(days > 0)) return 'req: -days muss > 0 sein';
        const cert = mkCert(d, { cn: subj, san, kid: kobj.kid, ca: !exts.some(x => /basicConstraints\s*=.*CA:FALSE/i.test(x)), day, days }); return out(opt('-out'), pem('cert', cert), '');
      }
      if (has('-new')) { const r = loadAs(opt('-key', ''), 'key', '-key'); if (r.err) return r.err; if (!subj) return 'req: Subject fehlt (-subj "/CN=Name"). Ohne -subj fragt openssl interaktiv, das geht im Simulator nicht.'; return out(opt('-out'), pem('csr', mkCsr(r.o, subj, san)), ''); }
      return 'req: -new oder -x509 angeben';
    }
    if (sub === 'x509') {
      if (has('-req')) {
        const csr = loadAs(opt('-in', ''), 'csr', '-in'); if (csr.err) return csr.err; const ca = loadAs(opt('-CA', ''), 'cert', '-CA'); if (ca.err) return ca.err; const ck = loadAs(opt('-CAkey', ''), 'key', '-CAkey'); if (ck.err) return ck.err;
        if (ca.o.kid !== ck.o.kid) return 'Error: CA certificate and CA private key do not match (passende Schlüsseldatei zur CA verwenden).';
        if (!ca.o.ca) return 'Error: Das Aussteller-Zertifikat ist keine CA (CA:FALSE).'; const days = +(opt('-days', 30)); if (!(days > 0)) return 'x509: -days muss > 0 sein';
        const cert = mkCert(d, { cn: csr.o.cn, san: csr.o.san, kid: csr.o.kid, issuer: ca.o.cn, ik: ca.o.kid, ca: false, day, days }); return out(opt('-out'), pem('cert', cert), 'Certificate request self-signature ok\nsubject=CN = ' + csr.o.cn);
      }
      const r = loadAs(opt('-in', ''), 'cert', '-in'); if (r.err) return r.err; const c = r.o, o = [];
      if (has('-text')) o.push(textOf(c)); if (has('-subject')) o.push('subject=CN = ' + c.cn); if (has('-issuer')) o.push('issuer=CN = ' + c.issuer); if (has('-startdate')) o.push('notBefore=' + dateOf(c.nb)); if (has('-enddate')) o.push('notAfter=' + dateOf(c.na)); if (has('-dates')) o.push('notBefore=' + dateOf(c.nb), 'notAfter=' + dateOf(c.na));
      if (has('-fingerprint')) o.push('sha256 Fingerprint=' + fp(c)); if (has('-modulus')) o.push('Modulus=' + c.kid.toUpperCase()); if (has('-serial')) o.push('serial=' + c.serial);
      if (has('-checkend')) { const s = +opt('-checkend', 0), end = c.na - day; o.push(end * 86400 > s ? 'Certificate will not expire' : 'Certificate will expire'); }
      if (!has('-noout')) o.push(out(null, pem('cert', c)).trim()); return o.join('\n');
    }
    if (sub === 'rsa' || sub === 'pkey') { const r = loadAs(opt('-in', ''), 'key', '-in'); if (r.err) return r.err; return has('-modulus') ? 'Modulus=' + r.o.kid.toUpperCase() : has('-check') ? 'RSA key ok' : pem('key', r.o).trim(); }
    if (sub === 'verify') {
      const files = a.slice(1).filter((x, i, arr) => !x.startsWith('-') && arr[i - 1] !== '-CAfile'), caf = opt('-CAfile'), res = [];
      if (!files.length) return 'verify: Zertifikatsdatei angeben'; let trust = (d.trust || []);
      if (caf) { const c = loadAs(caf, 'cert', '-CAfile'); if (c.err) return c.err; trust = [{ id: c.o.kid }]; }
      for (const f of files) {
        const c = loadAs(f, 'cert', 'cert'); if (c.err) { res.push(c.err); continue; }
        const o = c.o, selfSigned = o.issuer === o.cn && o.ik === o.kid; let msg = null;
        if (!trust.some(t => t.id === o.ik)) msg = selfSigned ? `CN = ${o.cn}\nerror 18 at 0 depth lookup: self-signed certificate\nerror ${f}: verification failed` : `CN = ${o.cn}\nerror 20 at 0 depth lookup: unable to get local issuer certificate\nerror ${f}: verification failed`;
        else if (day > o.na) msg = `CN = ${o.cn}\nerror 10 at 0 depth lookup: certificate has expired\nerror ${f}: verification failed`; else if (day < o.nb) msg = `CN = ${o.cn}\nerror 9 at 0 depth lookup: certificate is not yet valid\nerror ${f}: verification failed`;
        res.push(msg || `${f}: OK`);
      }
      return res.join('\n');
    }
    return `Invalid command '${sub}'; type "help" for a list.`;
  }
  // Zertifikatsdateien im Dateisystem eines Geräts (für die Web-GUI)
  function files(d, L, day) {
    const out = []; for (const p of Object.keys(L.fs)) { const e = L.fs[p]; if (e.d || !e.t || !/-----BEGIN/.test(e.t)) continue; const x = parse(e.t); if (!x) continue; out.push(Object.assign({ path: p, kind: x.kind }, x.o, x.kind === 'cert' ? { days: x.o.na - day, state: day > x.o.na ? 'expired' : day < x.o.nb ? 'future' : x.o.na - day <= 30 ? 'soon' : 'ok' } : {})); }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }
  return { parse, pem, mkKey, mkCsr, mkCert, mkCa, issue, verify, clientCheck, trustAdd, trustRemove, trustList, fp, run, files, dateOf, isoOf, ERRCODE };
})();
if (typeof module !== 'undefined') module.exports = PKI;
