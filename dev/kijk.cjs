const {chromium}=require('playwright');(async()=>{const b=await chromium.launch();
for (const [w,cs] of [[360,'light'],[360,'dark'],[1100,'light']]){
const p=await b.newPage({viewport:{width:w,height:800},colorScheme:cs});const e=[];p.on('pageerror',x=>e.push(x.message));p.on('console',m=>{if(m.type()==='error')e.push(m.text())});
await p.goto('http://localhost:8787/');await p.waitForTimeout(300);
await p.click('.vb');await p.waitForSelector('.kaart[data-model=claude] .antwoord',{timeout:20000});await p.waitForSelector('.kaart[data-model=open] .antwoord',{timeout:20000});
await p.click('.kaart[data-model=claude] button.ref');await p.waitForTimeout(400);
await p.screenshot({path:`dev/s-${w}-${cs}.png`,fullPage:true});
console.log(w,cs,'errors',e,'scrollW',await p.evaluate(()=>document.documentElement.scrollWidth));
if(w===360&&cs==='light'){await p.reload();console.log('na reload veld:',await p.inputValue('#vraag'));await p.click('.q');await p.click('.blok >> nth=2');await p.screenshot({path:'dev/s-hoe.png'});}
await p.close();}
await b.close()})();
