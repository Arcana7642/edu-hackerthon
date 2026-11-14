import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
test('OCR proxy uses verified QR identity instead of a wrong manual selection',async t=>{
 let seen=null,calls=0,mismatch=false;
 const ocr=http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const form=await new Response(Buffer.concat(chunks),{headers:{'Content-Type':req.headers['content-type']}}).formData();calls++;seen={worksheet:form.get('worksheet'),qrPayload:form.get('qrPayload')};res.setHeader('Content-Type','application/json');res.end(JSON.stringify({worksheetId:mismatch?'w1':seen.worksheet,answers:{q1:'2'}}))});
 await new Promise(r=>ocr.listen(0,'127.0.0.1',r));const ocrPort=ocr.address().port;t.after(()=>new Promise(r=>ocr.close(r)));
 const allocator=net.createServer();await new Promise(r=>allocator.listen(0,'127.0.0.1',r));const port=allocator.address().port;await new Promise(r=>allocator.close(r));
 const temp=await mkdtemp(path.join(tmpdir(),'qr-ocr-'));const root=fileURLToPath(new URL('..',import.meta.url));
 const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),OPENAI_API_KEY:'',THINKMATE_DATA_DIR:temp,OCR_BACKEND_URL:`http://127.0.0.1:${ocrPort}`},windowsHide:true,stdio:['ignore','pipe','pipe']});
 t.after(async()=>{if(child.exitCode===null){const closed=new Promise(r=>child.once('exit',r));child.kill();await closed}await rm(temp,{recursive:true,force:true})});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Startup timeout')),10000);child.stdout.on('data',d=>{if(d.toString().includes('SQLite ready')){clearTimeout(timer);resolve()}});child.once('exit',c=>{if(c){clearTimeout(timer);reject(Error('Server exit '+c))}})});
 const base=`http://localhost:${port}`;const identity=await fetch(base+'/api/teacher/me'),cookie=identity.headers.get('set-cookie').split(';')[0];
 async function call(route,data,method='POST'){const r=await fetch(base+route,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},body:method==='GET'?undefined:JSON.stringify(data)});return {status:r.status,data:await r.json()}}
 const current=(await call('/api/teacher/state',null,'GET')).data;current.state.worksheets.push({...current.state.worksheets[0],id:'w2',title:'두 번째 학습지'});
 assert.equal((await call('/api/teacher/state',{state:current.state,teacherRevision:current.teacherRevision},'PUT')).status,200);
 const qr=(await call('/api/teacher/worksheets/qr?worksheetId=w2&classId=class1',null,'GET')).data;assert.ok(qr.svg.includes('<svg'));
 const found=await call('/api/teacher/worksheets/identify',{classId:'class1',qrPayload:qr.payload});assert.equal(found.data.worksheetId,'w2');
 function form(payload=qr.payload){const f=new FormData();f.set('classId','class1');f.set('student','s1');f.set('worksheet','w1');f.set('qrPayload',payload);f.set('file',new Blob(['image-fixture'],{type:'image/png'}),'answer.png');return f}
 const r=await fetch(base+'/api/ocr',{method:'POST',headers:{Cookie:cookie},body:form()});const result=await r.json();assert.equal(r.status,200);assert.equal(seen.worksheet,'w2');assert.equal(result.worksheetId,'w2');assert.equal(result.qrDetected,true);
 const invalid=await fetch(base+'/api/ocr',{method:'POST',headers:{Cookie:cookie},body:form('{"app":"unknown"}')});assert.equal(invalid.status,400);assert.equal(calls,1);
 mismatch=true;const wrong=await fetch(base+'/api/ocr',{method:'POST',headers:{Cookie:cookie},body:form()});assert.equal(wrong.status,400);assert.match((await wrong.json()).error,/일치하지/);
 const unauthorized=await fetch(base+'/api/teacher/worksheets/qr?worksheetId=w2&classId=class1');assert.equal(unauthorized.status,401);
});
