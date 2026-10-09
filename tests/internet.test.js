global.NL=require('../src/engine.js'); global.window=undefined;
const SB=require('../src/sandbox.js'); const net=SB.example(); const T=SB.testApi(net);
const id=h=>Object.keys(net.devs).find(k=>net.devs[k].cfg.hostname===h);
const pc=net.devs[id('PC-101')], isp=net.devs[id('ISP')];
const r=x=>typeof x==='string'?x.split('\n').slice(0,3).join(' | '):JSON.stringify(x).slice(0,170);
console.log('ISP port', NL.portStatus(net,isp.id,'eth0').st);
console.log('ping ISP     ', r(T.hostLine(pc,NL.newSess(),'ping 198.51.100.1')));
console.log('http inet    ', r(T.httpGet(pc,'http://www.example.com')));
console.log('lint ISP/FW  ', SB.lint(net).filter(x=>/ISP|R-EDGE|FW-01/.test(x.host)).map(x=>x.host+': '+x.msg.slice(0,60)).join(' || '));
