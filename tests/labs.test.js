global.NL = require('../src/engine.js');
const LABS = require('../src/labs.js');
let fail=0;
for (const lab of LABS.list.filter(l=>l.type==='cli')) {
  const net = LABS.build(lab);
  const before = lab.tasks.map(t=>t.c(net));
  for (const id in lab.sol) { const s = NL.newSess(); for (const l of lab.sol[id]) { const r = NL.exec(net,id,s,l); if (r && (r.startsWith('%')) && !r.includes('Creating vlan')) console.log('  ['+lab.id+'] '+id+' "'+l+'" -> '+r); } }
  const after = lab.tasks.map(t=>t.c(net));
  const bad = after.map((v,i)=>v?null:i).filter(x=>x!==null);
  console.log(lab.id.padEnd(10), 'before', before.map(b=>b?1:0).join(''), 'after', after.map(b=>b?1:0).join(''), bad.length?'FAIL':'ok');
  if (bad.length){ fail++; bad.forEach(i=>console.log('   ✗', lab.tasks[i].t)); }
  lab._net = net;
}
// debug pings
const v = LABS.list.find(l=>l.id==='vpn')._net;
console.log(NL.exec(v,'RHQ',(()=>{const s=NL.newSess();s.mode='priv';return s})(),'show crypto session'));
process.exitCode = fail;
