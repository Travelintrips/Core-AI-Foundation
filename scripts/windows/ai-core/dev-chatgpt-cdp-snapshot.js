const http=require('http');
const [portArg,targetId,expectedUrl]=process.argv.slice(2);
const port=Number(portArg);
if(!Number.isInteger(port)||port<1024||port>65535||!/^[A-Fa-f0-9]{32}$/.test(targetId)||!/^https:\/\/chatgpt\.com\/c\/[A-Za-z0-9-]{30,64}$/.test(expectedUrl)) process.exit(2);

function inventory(){
  return new Promise((resolve,reject)=>{
    http.get({host:'127.0.0.1',port,path:'/json',timeout:3000},res=>{
      let body='';
      res.on('data',chunk=>{body+=chunk;if(body.length>524288){res.destroy();reject(Error('inventory too large'));}});
      res.on('end',()=>{try{resolve(JSON.parse(body));}catch(error){reject(error);}});
    }).on('error',reject);
  });
}

(async()=>{
  const inv=await inventory();
  if(!Array.isArray(inv)) throw Error('inventory');
  const matches=inv.filter(x=>x&&x.type==='page'&&x.id===targetId&&x.url===expectedUrl&&typeof x.webSocketDebuggerUrl==='string');
  if(matches.length!==1) throw Error('target');
  const ws=new WebSocket(matches[0].webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  const expression=`(()=>{
    const body=document.body?.innerText||'';
    const editors=[...document.querySelectorAll('[contenteditable="true"][role="textbox"]')];
    const composers=editors.map(e=>{
      const r=e.getBoundingClientRect();
      return {
        name:e.getAttribute('aria-label')||e.getAttribute('data-placeholder')||'',
        screenX:window.screenX+r.x,
        screenY:window.screenY+(window.outerHeight-window.innerHeight)+r.y,
        width:r.width,
        height:r.height
      };
    });
    const stop=[...document.querySelectorAll('button')].some(b=>/^(Stop|Stop generating|Hentikan|Hentikan pembuatan)$/i.test((b.getAttribute('aria-label')||b.innerText||'').trim()));
    return {bodyText:body,composerNames:composers.map(x=>x.name),composerBounds:composers,stopVisible:stop,url:location.href};
  })()`;
  ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true}}));
  ws.onmessage=event=>{
    const message=JSON.parse(event.data);
    if(message.id!==1) return;
    const value=message.result?.result?.value;
    if(!value||value.url!==expectedUrl||typeof value.bodyText!=='string'||value.bodyText.length>200000||
       !Array.isArray(value.composerNames)||!Array.isArray(value.composerBounds)) throw Error('snapshot');
    process.stdout.write(JSON.stringify(value));
    ws.close();
  };
})().catch(()=>process.exit(3));
