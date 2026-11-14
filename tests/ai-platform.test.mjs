import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createPlatform} from '../platform.mjs';
import {createDemoState} from '../demo-data.mjs';

test('student AI grading feeds source-grounded review and private independent assessment',async()=>{
 const sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE app_state(id INTEGER PRIMARY KEY,payload TEXT);CREATE TABLE classes(id TEXT,name TEXT,subject TEXT);CREATE TABLE students(id TEXT,class_id TEXT,name TEXT,number INTEGER);CREATE TABLE worksheets(id TEXT,class_id TEXT,payload TEXT);CREATE TABLE results(id TEXT,class_id TEXT,student_id TEXT,payload TEXT);CREATE TABLE sessions(student_id TEXT,payload TEXT)');
 let fail=false,gradeCalls=0,retrievals=0;
 const platform=createPlatform({sql,seed:createDemoState,origin:'http://localhost',key:()=>true,
  json:(res,status,data)=>{res.status=status;res.data=data},body:async req=>Buffer.from(JSON.stringify(req.payload)),
  retrieve:async(classId,query,materialId)=>{assert.equal(classId,'class1');assert.equal(materialId,'m1');retrievals++;return [{title:'밀도 자료',page:1,citation:'밀도 자료 1쪽',text:'밀도는 질량을 부피로 나눈다.'}]},
  llm:async(instructions,data,schema)=>{
   if(schema.properties.items){gradeCalls++;if(fail)throw Error('AI unavailable');return {items:data.questions.map((q,i)=>({questionId:q.id,correct:i!==0,reason:i===0?'개념 부족 추정':'',feedback:'평가 근거'}))}}
   if(schema.properties.message){assert.equal(data.references[0].citation,'밀도 자료 1쪽');return {message:'생각을 잘 설명했어.',check:data.messages.filter(m=>m.role==='student').length===2?{text:'새로운 밀도 확인 문제',answer:'4 g/cm³',rubric:'숫자와 단위'}:null}}
   assert.equal(data.check.answer,'4 g/cm³');return {correct:true,feedback:'이번 확인 문제를 독립적으로 해결했어.'};
  }});
 try{
  async function call(action,payload,cookie){const res={setHeader(name,value){if(name==='Set-Cookie')this.cookie=value.split(';')[0]}};await platform.route({method:payload===undefined?'GET':'POST',headers:{cookie:cookie||''},payload,socket:{remoteAddress:'local'}},res,new URL('/api/student/'+action,'http://localhost'));return res}
  const cookie=(await call('me')).cookie,w=platform.load().worksheets.find(w=>w.id==='w1');
  const answers=w.questions.map(q=>({questionId:q.id,answer:q.type==='3지선다'?'1':'학생이 작성한 답안'}));
  const submitted=await call('worksheet/submit',{worksheetId:w.id,answers,correct:true},cookie);
  assert.equal(submitted.data.gradingMode,'ai');assert.equal(gradeCalls,1);assert.equal(submitted.data.correctCount,w.questions.length-1);
  const saved=platform.load().results.find(r=>r.studentId==='s1'&&r.worksheetId===w.id);assert.equal(saved.items[0].answer,answers[0].answer);
  fail=true;await assert.rejects(()=>call('worksheet/submit',{worksheetId:w.id,answers},cookie),/AI unavailable/);assert.equal(platform.load().results.find(r=>r.studentId==='s1'&&r.worksheetId===w.id).id,saved.id);fail=false;
  let session=(await call('sessions/start',{worksheetId:w.id},cookie)).data.session;
  for(let i=0;i<3;i++)session=(await call('sessions/turn',{worksheetId:w.id,sessionId:session.id,answer:'내가 생각한 이유'},cookie)).data.session;
  assert.equal(retrievals,3);assert.equal(session.phase,'check');assert.deepEqual(session.check,{text:'새로운 밀도 확인 문제'});assert.ok(!JSON.stringify(session).includes('rubric'));
  session=(await call('sessions/verify',{worksheetId:w.id,sessionId:session.id,answer:'4 g/cm³',correct:false},cookie)).data.session;
  assert.equal(session.verification.correct,true);assert.equal(platform.load().sessions.s1.verification.correct,true);
 }finally{sql.close()}
});
