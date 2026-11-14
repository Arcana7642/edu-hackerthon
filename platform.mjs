import {randomBytes,createHash,scryptSync,timingSafeEqual,randomUUID} from 'node:crypto';
import {isTF,validateTFResponse,formatTF,gradeTF} from './dist/tf-utils.js';

// Local prototype identity and role checks. The two portals never share a state API.
export function createPlatform({sql,json,body,llm,retrieve,key,origin,seed,onMaterialsChanged=()=>{}}){
 sql.exec(`CREATE TABLE IF NOT EXISTS portal_auth(token_hash TEXT PRIMARY KEY,role TEXT NOT NULL,student_id TEXT,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS student_access(student_id TEXT PRIMARY KEY,class_id TEXT NOT NULL,code TEXT UNIQUE NOT NULL);
 CREATE TABLE IF NOT EXISTS platform_meta(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL);
 INSERT OR IGNORE INTO platform_meta(id,revision) VALUES(1,1);`);
 if(!sql.prepare('PRAGMA table_info(platform_meta)').all().some(c=>c.name==='teacher_revision'))sql.exec('ALTER TABLE platform_meta ADD COLUMN teacher_revision INTEGER NOT NULL DEFAULT 1');
 const teacherRevision=()=>sql.prepare('SELECT teacher_revision FROM platform_meta WHERE id=1').get().teacher_revision;
 const hasKey=()=>typeof key==='function'?key():!!key;
 const password=process.env.TEACHER_PASSWORD||'thinkmate-demo';
 const passwordHash=scryptSync(password,'thinkmate-local-teacher-v1',64);
 const digest=t=>createHash('sha256').update(t).digest('hex');
 const load=()=>{const row=sql.prepare('SELECT payload FROM app_state WHERE id=1').get();return row?JSON.parse(row.payload):seed()};
 const revision=()=>sql.prepare('SELECT revision FROM platform_meta WHERE id=1').get().revision;
 function write(state,teacher=false){sql.exec('BEGIN');try{
  sql.prepare('INSERT OR REPLACE INTO app_state(id,payload) VALUES(1,?)').run(JSON.stringify(state));
  for(const table of ['classes','students','worksheets','results','sessions'])sql.exec(`DELETE FROM ${table}`);
  for(const c of state.classes){sql.prepare('INSERT INTO classes VALUES(?,?,?)').run(c.id,c.name,c.subject);for(const s of c.students)sql.prepare('INSERT INTO students VALUES(?,?,?,?)').run(s.id,c.id,s.name,s.number)}
  for(const w of state.worksheets)sql.prepare('INSERT INTO worksheets VALUES(?,?,?)').run(w.id,w.classId,JSON.stringify(w));
  for(const r of state.results)sql.prepare('INSERT INTO results VALUES(?,?,?,?)').run(r.id,r.classId,r.studentId,JSON.stringify(r));
  for(const [id,s] of Object.entries(state.sessions||{}))sql.prepare('INSERT INTO sessions VALUES(?,?)').run(id,JSON.stringify(s));
  sql.prepare('UPDATE platform_meta SET revision=revision+1,teacher_revision=teacher_revision+? WHERE id=1').run(teacher?1:0);sql.exec('COMMIT');
 }catch(e){sql.exec('ROLLBACK');throw e}}
 if(!sql.prepare('SELECT id FROM app_state WHERE id=1').get())write(seed());
 function access(state){const records=[];for(const c of state.classes)for(const s of c.students){let a=sql.prepare('SELECT * FROM student_access WHERE student_id=?').get(s.id);if(!a){const code=randomBytes(6).toString('hex').toUpperCase();sql.prepare('INSERT INTO student_access VALUES(?,?,?)').run(s.id,c.id,code);a={student_id:s.id,class_id:c.id,code}}records.push({studentId:s.id,code:a.code,url:origin+'/student?code='+a.code})}return records}
 function auth(req,role){const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('tm_'+role+'='));if(!cookie)return null;const token=cookie.slice(cookie.indexOf('=')+1);return sql.prepare('SELECT * FROM portal_auth WHERE token_hash=? AND role=? AND expires>?').get(digest(token),role,Date.now())||null}
 function issue(res,role,studentId=''){const token=randomBytes(32).toString('hex');sql.prepare('INSERT INTO portal_auth VALUES(?,?,?,?)').run(digest(token),role,studentId,Date.now()+8*3600000);res.setHeader('Set-Cookie',`tm_${role}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`)}
 function logout(req,res,role){const a=auth(req,role);if(a)sql.prepare('DELETE FROM portal_auth WHERE token_hash=?').run(a.token_hash);res.setHeader('Set-Cookie',`tm_${role}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`)}
 function identity(state,id){for(const c of state.classes){const s=c.students.find(s=>s.id===id);if(s)return {...s,classId:c.id,className:c.name,subject:c.subject}}return null}
 const resultFor=(state,id,worksheetId)=>state.results.filter(r=>r.studentId===id&&r.worksheetId===worksheetId).at(-1);
 const sessionKey=(id,w)=>id+':'+w;
 function sessionFor(state,id,w){return state.learningSessions?.[sessionKey(id,w)]||(state.sessions?.[id]?.worksheetId===w?state.sessions[id]:null)}
 function publicSession(s){if(!s)return null;return {id:s.id,worksheetId:s.worksheetId,concept:s.concept,reason:s.reason,demo:s.demo,messages:s.messages,turnCount:s.answers.length,phase:s.verification?'complete':s.answers.length>=3?'check':'chat',check:s.answers.length>=3&&s.check?{text:s.check.text}:null,verification:s.verification||null,sources:s.sources||[]}}
 function storeSession(state,id,s){state.learningSessions??={};state.learningSessions[sessionKey(id,s.worksheetId)]=s;state.sessions??={};state.sessions[id]=s;write(state)}
 function refreshStudentSession(id,s){const latest=load();if(!identity(latest,id)||resultFor(latest,id,s.worksheetId)?.id!==s.resultId||sessionFor(latest,id,s.worksheetId)?.id!==s.id)throw new Error('선생님이 답안을 갱신했습니다. 학습을 다시 시작해 주세요.');storeSession(latest,id,s)}
 function studentHome(state,id){const student=identity(state,id);if(!student)return null;return {student,aiConfigured:hasKey(),tasks:state.worksheets.filter(w=>w.classId===student.classId).map(w=>{const r=resultFor(state,id,w.id),s=sessionFor(state,id,w.id),incorrect=r?.items.filter(i=>i.correct===false)||[],pending=r?.items.filter(i=>i.correct===null).length||0;return {id:w.id,title:w.title,questionCount:w.questions.length,hasTF:w.questions.some(isTF),submitted:!!r,score:r?Math.round(r.items.filter(i=>i.correct===true).length/r.items.length*100):null,incorrectCount:incorrect.length,pendingCount:pending,status:s?.verification?(s.verification.correct?'success':'retry'):s?'in-progress':incorrect.length?'ready':pending?'review':r?'clear':'waiting',concept:s?.concept||w.questions.find(q=>q.id===incorrect[0]?.questionId)?.concept||'',session:publicSession(s)}}),revision:revision()}}
 const locks=new Set(),attempts=new Map();
 function rateLimited(req){const id=req.socket.remoteAddress;const now=Date.now();const a=attempts.get(id)||{n:0,until:now+60000};if(now>a.until){a.n=0;a.until=now+60000}a.n++;attempts.set(id,a);return a.n>30}
 async function route(req,res,url){const p=url.pathname;
  if(p==='/api/state'){json(res,401,{error:'공용 상태 API는 사용하지 않습니다. 역할별 사이트로 로그인하세요.'});return true}
  if(!p.startsWith('/api/teacher/')&&!p.startsWith('/api/student/'))return false;
  const role=p.startsWith('/api/teacher/')?'teacher':'student';
  const action=p.slice(('/api/'+role+'/').length);
  if(action==='login-info'&&role==='teacher'&&req.method==='GET'){json(res,200,{demo:!process.env.TEACHER_PASSWORD});return true}
  if(action==='login'&&req.method==='POST'){
   if(rateLimited(req)){json(res,429,{error:'로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.'});return true}
   const b=JSON.parse((await body(req)).toString('utf8'));
   if(role==='teacher'){const candidate=scryptSync(String(b.password||'').slice(0,256),'thinkmate-local-teacher-v1',64);if(!timingSafeEqual(candidate,passwordHash)){json(res,401,{error:'교사 비밀번호를 확인해 주세요.'});return true}issue(res,role);json(res,200,{ok:true})}
   else{const a=sql.prepare('SELECT * FROM student_access WHERE code=?').get(String(b.code||'').trim().toUpperCase());if(!a||!identity(load(),a.student_id)){json(res,401,{error:'선생님께 받은 접속 코드를 확인해 주세요.'});return true}issue(res,role,a.student_id);json(res,200,{ok:true})}return true;
  }
  let actor=auth(req,role);
  if(!actor&&action==='me'&&req.method==='GET'){
   if(role==='teacher'){issue(res,role);actor={role:'teacher'}}
   else{const state=load(),all=state.classes.flatMap(c=>c.students),demo=all.find(s=>s.id==='s1')||all.find(s=>state.results.some(r=>r.studentId===s.id&&r.items.some(i=>i.correct===false)))||all[0];if(!demo){json(res,404,{error:'아직 등록된 학생이 없습니다. 교사 화면에서 학생을 먼저 추가해 주세요.'});return true}issue(res,role,demo.id);actor={role:'student',student_id:demo.id}}
  }
  if(!actor){json(res,401,{error:'로그인이 필요합니다.'});return true}
  if(action==='logout'&&req.method==='POST'){logout(req,res,role);json(res,200,{ok:true});return true}
  if(action==='me'&&req.method==='GET'){json(res,200,role==='teacher'?{role:'teacher',name:'선생님'}:{role:'student',student:identity(load(),actor.student_id)});return true}
  if(role==='teacher'){
   if(action==='state'&&req.method==='GET'){const state=load();json(res,200,{state,revision:revision(),teacherRevision:teacherRevision(),access:access(state)});return true}
   if(action==='state'&&req.method==='PUT'){
    const b=JSON.parse((await body(req)).toString('utf8')),incoming=b.state,current=load();
    if(b.teacherRevision!==teacherRevision()){json(res,409,{error:'다른 교사 화면에서 자료를 수정했습니다. 새로고침 후 다시 저장해 주세요.',revision:revision()});return true}
    if(!incoming||!Array.isArray(incoming.classes)||!Array.isArray(incoming.worksheets)||!Array.isArray(incoming.results))throw new Error('학급 데이터 형식이 올바르지 않습니다.');
    // Teacher writes cannot replace a student's active session with an old browser snapshot.
    incoming.sessions=current.sessions||{};incoming.learningSessions=current.learningSessions||{};
    const changed=new Set();for(const r of incoming.results){const old=current.results.find(x=>x.id===r.id);if(!old||JSON.stringify(old.items)!==JSON.stringify(r.items))changed.add(r.studentId+':'+r.worksheetId)}
    for(const k of changed){delete incoming.learningSessions[k];const [id,w]=k.split(':');if(incoming.sessions[id]?.worksheetId===w||!incoming.sessions[id]?.worksheetId)delete incoming.sessions[id]}
    write(incoming,true);onMaterialsChanged(incoming);json(res,200,{ok:true,revision:revision(),teacherRevision:teacherRevision(),access:access(incoming)});return true;
   }
   json(res,404,{error:'교사용 API를 찾을 수 없습니다.'});return true;
  }
  const state=load(),student=identity(state,actor.student_id);if(!student){json(res,403,{error:'등록된 학생이 아닙니다.'});return true}
  if(action==='home'&&req.method==='GET'){json(res,200,studentHome(state,student.id));return true}
  if(action==='worksheet'&&req.method==='GET'){
   const w=state.worksheets.find(w=>w.id===url.searchParams.get('worksheetId')&&w.classId===student.classId);
   if(!w){json(res,403,{error:'내 반에 배정된 학습지만 이용할 수 있습니다.'});return true}
   const previous=resultFor(state,student.id,w.id);
   json(res,200,{id:w.id,title:w.title,questions:w.questions.map(q=>({id:q.id,type:q.type,text:q.text,options:q.options})),answers:(previous?.items||[]).map(i=>({questionId:i.questionId,answer:i.answer,tfAnswer:i.tfAnswer}))});return true;
  }
  if(action==='worksheet/submit'&&req.method==='POST'){
   const b=JSON.parse((await body(req)).toString('utf8')),w=state.worksheets.find(w=>w.id===b.worksheetId&&w.classId===student.classId);
   if(!w){json(res,403,{error:'내 반에 배정된 학습지만 이용할 수 있습니다.'});return true}
   if(!Array.isArray(b.answers)||b.answers.length!==w.questions.length||new Set(b.answers.map(a=>a.questionId)).size!==w.questions.length){json(res,400,{error:'모든 문항의 답안을 한 번씩 제출하세요.'});return true}
   let items;try{items=w.questions.map(q=>{
    const a=b.answers.find(a=>a.questionId===q.id);if(!a)throw new Error('문항별 답안을 확인하세요.');
    if(isTF(q)){const tfAnswer=validateTFResponse(a.tfAnswer);return {questionId:q.id,answer:formatTF(tfAnswer),tfAnswer,...gradeTF(q,tfAnswer)}}
    const answer=String(a.answer??'').trim();if(!answer||answer.length>2000)throw new Error('답안은 1~2,000자로 입력하세요.');
    if(q.type==='3지선다'&&!['1','2','3'].includes(answer))throw new Error('선택지를 확인하세요.');
    const norm=s=>String(s).normalize('NFKC').replace(/\s+/g,'').toLowerCase();
    const correct=q.type==='서술형'?null:norm(answer)===norm(q.answer);
    return {questionId:q.id,answer,correct,reason:correct===null?'추가 확인 필요':correct?'':'개념 부족 추정'};
   })}catch(e){json(res,400,{error:e.message});return true}
   const result={id:randomUUID(),classId:student.classId,studentId:student.id,worksheetId:w.id,source:'student-web',date:new Date().toISOString(),items};
   state.results=state.results.filter(r=>!(r.studentId===student.id&&r.worksheetId===w.id));state.results.push(result);
   delete state.learningSessions?.[sessionKey(student.id,w.id)];if(state.sessions?.[student.id]?.worksheetId===w.id)delete state.sessions[student.id];
   write(state,true);json(res,200,{ok:true,correctCount:items.filter(i=>i.correct===true).length,pendingCount:items.filter(i=>i.correct===null).length,total:items.length});return true;
  }
  if(!['sessions/start','sessions/turn','sessions/verify'].includes(action)||req.method!=='POST'){json(res,404,{error:'학생용 API를 찾을 수 없습니다.'});return true}
  const b=JSON.parse((await body(req)).toString('utf8'));
  const w=state.worksheets.find(w=>w.id===b.worksheetId&&w.classId===student.classId);
  if(!w){json(res,403,{error:'내 반에 배정된 학습지만 이용할 수 있습니다.'});return true}
  const lock=student.id+':'+w.id;if(locks.has(lock)){json(res,409,{error:'이전 답변을 처리하고 있습니다.'});return true}locks.add(lock);
  try{
   let s=sessionFor(state,student.id,w.id);
   if(action==='sessions/start'){
    if(s&&!b.restart){json(res,200,{session:publicSession(s)});return true}
    const r=resultFor(state,student.id,w.id),item=r?.items.find(i=>i.correct===false),q=w.questions.find(q=>q.id===item?.questionId);
    if(!item||!q)throw new Error('채점된 오답이 없습니다. 선생님의 답안 확인을 기다려 주세요.');
    if(!hasKey()&&!/밀도/.test(q.text+q.concept))throw new Error('이 단원은 GPT API 연결 후 학습할 수 있습니다.');
    const calculation=q.concept.includes('계산')||item.reason==='단순 실수 추정';
    const answer=q.type==='3지선다'?q.options?.[Number(item.answer)-1]||item.answer:item.answer;
    s={id:randomUUID(),worksheetId:w.id,resultId:r.id,questionId:q.id,concept:q.concept,reason:item.reason,calculation,answers:[],messages:[{role:'ai',text:calculation?'네 풀이 과정을 함께 살펴보자. 어떤 식으로 계산했는지 설명해 줄래?':`네가 쓴 “${answer}”라는 답을 같이 살펴보자. 왜 그렇게 생각했는지 네 말로 설명해 줄래?`}],demo:!hasKey(),check:null,verification:null};
    storeSession(state,student.id,s);json(res,200,{session:publicSession(s)});return true;
   }
   if(!s||s.id!==b.sessionId)throw new Error('현재 학습을 다시 불러와 주세요.');
   const answer=String(b.answer||'').trim();if(!answer||answer.length>2000)throw new Error('답변은 1~2,000자로 입력해 주세요.');
   if(action==='sessions/turn'){
    if(s.answers.length>=3||s.verification)throw new Error('대화가 끝났습니다. 독립 확인 문제로 이동해 주세요.');
    const n=s.answers.length,final=n===2;let message,check=null;
    if(hasKey()){const result=resultFor(state,student.id,w.id),q=w.questions.find(q=>q.id===s.questionId);const refs=await retrieve(student.classId,s.concept,w.materialId);s.sources=refs.map(r=>({title:r.title,page:r.page,citation:r.citation}));const schema={type:'object',properties:{message:{type:'string'},check:{anyOf:[{type:'null'},{type:'object',properties:{text:{type:'string'},answer:{type:'string'},rubric:{type:'string'}},required:['text','answer','rubric'],additionalProperties:false}]}},required:['message','check'],additionalProperties:false};
     const out=await llm(`학생에게 정답을 직접 알려주지 말고 답변에 맞춰 한 가지 질문으로 이해를 도와주세요. 학생의 오답 원인은 추정입니다. ${final?'세 번째 응답 이후이므로 질문을 더 하지 말고 마무리하세요. check에 같은 개념의 새로운 독립 문제와 정답·채점 기준을 반환하세요. message에 독립 문제 정답이나 힌트를 쓰지 마세요.':'check는 null이며 학생 답변에 맞춘 쉬운 비교 또는 설명 질문을 합니다.'}`,{question:q,studentAnswer:result?.items.find(i=>i.questionId===q.id)?.answer,messages:s.messages,answer,references:refs},schema);message=out.message;check=out.check;if(final&&!check?.answer)throw new Error('독립 문제 생성에 실패했습니다. 다시 제출해 주세요.');
    }else{const unsure=/모르|어려|글쎄/.test(answer);message=n===0?(s.calculation?'밀도는 질량을 부피로 나눈 값이야. 네가 쓴 나눗셈을 다시 계산하고, 단위도 함께 말해 줄래?':unsure?'작은 블록을 두 개 붙였다고 생각해 보자. 질량도 부피도 두 배가 되면 10÷2와 20÷4는 어떻게 될까?':'같은 물질 10 g의 부피가 2 cm³이고, 20 g의 부피가 4 cm³라면 두 밀도를 비교해 볼래?'):n===1?(s.calculation?'밀도에 부피를 곱하면 원래 질량이 되는지 확인해 볼래? 그 관계를 네 말로 설명해 줘.':'질량과 부피가 같은 비율로 늘 때 밀도가 어떻게 되는지 네 말로 설명해 줄래?'):'생각을 들려줘서 고마워. 이제 새로운 문제를 힌트 없이 혼자 풀어보자.';if(final)check={text:s.calculation?'질량이 80 g이고 부피가 20 cm³인 물체의 밀도는 얼마일까요? 단위도 쓰세요.':'같은 물질의 질량과 부피가 모두 세 배가 되었습니다. 처음 밀도가 4 g/cm³였다면 바뀐 밀도는 얼마인가요? 단위도 쓰세요.',answer:'4 g/cm³',rubric:'숫자 4와 밀도 단위 g/cm³을 함께 쓴다.'}}
    s.answers.push(answer);s.messages.push({role:'student',text:answer},{role:'ai',text:message});if(check)s.check=check;refreshStudentSession(student.id,s);json(res,200,{session:publicSession(s)});return true;
   }
   if(s.answers.length!==3||!s.check)throw new Error('세 번의 대화를 먼저 완료해 주세요.');
   if(s.verification){json(res,200,{session:publicSession(s)});return true}
   let v;if(hasKey()){v=await llm('학생이 힌트 없이 푼 문제를 주어진 정답과 채점 기준으로 평가하세요. 정답이어도 완전한 이해를 단정하지 말고 이번 문제의 독립 해결 성공으로 기록하세요. 오답이면 정답과 짧은 피드백을 알려주세요.',{check:s.check,answer},{type:'object',properties:{correct:{type:'boolean'},feedback:{type:'string'}},required:['correct','feedback'],additionalProperties:false})}else{const correct=/^4(?:\.0+)?g\/(?:cm(?:³|3|\^3)|㎤)$/i.test(answer.replace(/\s+/g,''));v={correct,feedback:correct?'새 문제를 힌트 없이 해결했어! 이번 문제에서 독립 해결 성공으로 기록할게.':'정답은 4 g/cm³야. 질량을 부피로 나누는 과정과 단위를 다시 확인해 보자. 선생님께도 추가 학습이 필요한 것으로 알려둘게.'}}
   s.verification={...v,answer,at:new Date().toISOString()};refreshStudentSession(student.id,s);json(res,200,{session:publicSession(s)});return true;
  }finally{locks.delete(lock)}
 }
 return {route,auth,load,write,access};
}
