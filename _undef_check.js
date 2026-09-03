const parser=require('@babel/parser');const traverse=require('@babel/traverse').default;const fs=require('fs');
const GLOBALS=new Set(['console','require','module','exports','process','global','setTimeout','clearTimeout','setInterval','clearInterval','Promise','JSON','Math','Date','Object','Array','String','Number','Boolean','Error','RegExp','Map','Set','WeakMap','WeakSet','Symbol','parseInt','parseFloat','isNaN','isFinite','encodeURIComponent','decodeURIComponent','fetch','FormData','Blob','URL','URLSearchParams','TextEncoder','TextDecoder','atob','btoa','crypto','undefined','NaN','Infinity','AbortController','__DEV__','performance','FileReader','Uint8Array','ArrayBuffer','navigator','window','document','requestAnimationFrame','cancelAnimationFrame','structuredClone','Intl','Buffer','_WORKLET','globalThis','ReadableStream','WebSocket','XMLHttpRequest','Headers','Request','Response','queueMicrotask','setImmediate','BigInt','Proxy','Reflect','escape','unescape','Function','TypeError','RangeError']);
for(const f of process.argv.slice(2)){
 let code;try{code=fs.readFileSync(f,'utf8')}catch(e){continue}
 let ast;try{ast=parser.parse(code,{sourceType:'module',plugins:['jsx','classProperties','objectRestSpread','optionalChaining','nullishCoalescingOperator','dynamicImport']})}catch(e){console.log('PARSE FAIL',f,e.message);continue}
 const bad=new Map();
 traverse(ast,{ReferencedIdentifier(p){const n=p.node.name;if(GLOBALS.has(n))return;if(p.scope.hasBinding(n,true))return;if(!bad.has(n))bad.set(n,p.node.loc&&p.node.loc.start.line)}});
 if(bad.size)console.log(f,'->',[...bad].map(([k,v])=>k+':'+v).join(', '));
}
