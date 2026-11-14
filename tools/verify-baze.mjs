// Explicit live verification only; uses an isolated database and bills the configured BAZE account.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath} from 'node:url';

const websiteEnv=parseEnv(await readFile(new URL('../.env',import.meta.url),'utf8').catch(()=>''));
const websiteKey=process.env.THINKMATE_BAZE_API_KEY||websiteEnv.THINKMATE_BAZE_API_KEY||process.env.BAZE_API_KEY;
if(!websiteKey)throw Error('THINKMATE_BAZE_API_KEY or BAZE_API_KEY is required.');
const root=fileURLToPath(new URL('..',import.meta.url)),dir=await mkdtemp(path.join(tmpdir(),'thinkmate-baze-'));
const allocator=net.createServer();await new Promise(r=>allocator.listen(0,'127.0.0.1',r));const port=allocator.address().port;await new Promise(r=>allocator.close(r));
const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,THINKMATE_BAZE_API_KEY:websiteKey,AI_PROVIDER:'baze',BAZE_MODEL:'gpt-5.6-sol',PORT:String(port),THINKMATE_DATA_DIR:dir},windowsHide:true,stdio:['ignore','pipe','pipe']});
let cookie='';
try{
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Startup timeout')),15000);child.stdout.on('data',d=>{if(d.toString().includes('SQLite ready')){clearTimeout(timer);resolve()}});child.once('error',reject);child.once('exit',()=>{clearTimeout(timer);reject(Error('Server exited'))})});
 async function call(route,payload,auth=cookie,method=payload===undefined?'GET':'POST'){
  const r=await fetch(`http://127.0.0.1:${port}`+route,{method,headers:{'Content-Type':'application/json',Cookie:auth},body:payload===undefined?undefined:JSON.stringify(payload),signal:AbortSignal.timeout(120000)}),data=await r.json();
  assert.ok(r.ok,route+': '+(data.error||r.status));return {data,cookie:r.headers.get('set-cookie')?.split(';')[0]};
 }
 cookie=(await call('/api/teacher/me')).cookie;
 const connected=(await call('/api/teacher/ai/connect',{provider:'baze',model:'gpt-5.6-sol',embeddingModel:'text-embedding-3-small'})).data;
 assert.equal(connected.indexError,null);assert.equal(connected.provider,'baze');assert.equal(connected.rag.embeddedCount,connected.rag.chunkCount);
 console.log('PASS BAZE connection and embeddings: '+connected.rag.embeddedCount+' chunks');
 const hits=(await call('/api/teacher/rag/search',{classId:'class1',materialId:'m1',query:'밀도는 질량과 부피로 어떻게 구하나요?'})).data.results;
 assert.ok(hits.length);assert.equal(hits[0].method,'hybrid');assert.ok(hits[0].citation);console.log('PASS RAG hybrid search with source pages');
 const generated=(await call('/api/worksheets/generate',{classId:'class1',materialId:'m1',title:'BAZE 연결 확인',goal:'밀도 공식과 계산',type:'단답형',count:2})).data;
 assert.equal(generated.questions.length,2);assert.ok(generated.questions.every(q=>q.answer&&q.rubric));console.log('PASS source-grounded question generation');
 const snapshot=(await call('/api/teacher/state')).data,w={id:'baze-live-check',classId:'class1',materialId:'m1',title:'BAZE 연결 확인',questions:generated.questions};
 snapshot.state.worksheets.push(w);await call('/api/teacher/state',{state:snapshot.state,teacherRevision:snapshot.teacherRevision},cookie,'PUT');
 const teacherGrade=(await call('/api/grade',{classId:'class1',studentId:'s1',worksheetId:w.id,answers:w.questions.map(q=>({questionId:q.id,answer:q.answer}))})).data;
 assert.equal(teacherGrade.items.length,2);assert.ok(teacherGrade.items.every(i=>i.correct===true));console.log('PASS teacher AI grading');
 const studentCookie=(await call('/api/student/me')).cookie;
 const seedWorksheet=(await call('/api/student/worksheet?worksheetId=w1',undefined,studentCookie)).data;
 const submitted=(await call('/api/student/worksheet/submit',{worksheetId:'w1',answers:seedWorksheet.questions.map(q=>({questionId:q.id,answer:q.type==='3지선다'?'1':'모르겠어요'}))},studentCookie)).data;
 assert.equal(submitted.gradingMode,'ai');assert.ok(submitted.correctCount<submitted.total);console.log('PASS student AI grading');
 let session=(await call('/api/student/sessions/start',{worksheetId:'w1'},studentCookie)).data.session;
 for(const answer of ['양이 많으면 밀도가 커진다고 생각했어요.','질량과 부피를 나누어 비교할 수 있어요.','같은 물질이면 질량과 부피가 같은 비율로 늘어나 밀도가 같아요.']){
  session=(await call('/api/student/sessions/turn',{worksheetId:'w1',sessionId:session.id,answer},studentCookie)).data.session;
 }
 assert.equal(session.phase,'check');assert.ok(session.sources.length);assert.deepEqual(Object.keys(session.check),['text']);console.log('PASS RAG-grounded review and private independent question');
 const teacherState=(await call('/api/teacher/state')).data.state,expected=teacherState.sessions.s1.check.answer;
 session=(await call('/api/student/sessions/verify',{worksheetId:'w1',sessionId:session.id,answer:expected},studentCookie)).data.session;
 assert.equal(session.verification.correct,true);console.log('PASS independent review AI grading');
 console.log('LIVE VERIFICATION COMPLETE: BAZE / gpt-5.6-sol / text-embedding-3-small');
}finally{
 if(child.exitCode===null){const ended=new Promise(r=>child.once('exit',r));child.kill();await ended}
 await rm(dir,{recursive:true,force:true});
}
