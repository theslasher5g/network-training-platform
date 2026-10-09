global.NL=require('../src/engine.js'); global.window=undefined;
const SB=require('../src/sandbox.js');
const probe=SB.testApi(SB.example());
let bad=0;
for(const sc of probe.SC){
  const net=probe.buildScen(sc.id); SB.testApi(net);                // S.net = net
  const ev=()=>sc.goals.map(g=>{try{return g.c(net)?1:0}catch(e){return 'E:'+e.message}});
  const before=ev(); sc.sol(net); const after=ev();
  const ok=after.every(x=>x===1) && !before.every(x=>x===1);
  if(!ok) bad++;
  console.log((ok?'ok  ':'FAIL'),sc.id.padEnd(9),'vorher',before.join(''),'nachher',after.join(''));
}
process.exitCode=bad;
