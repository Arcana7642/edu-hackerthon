import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';

const source=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
function app(){const handlers={},elements=new Map();const context=vm.createContext({
 document:{querySelector:s=>{if(!elements.has(s))elements.set(s,{innerHTML:'',textContent:'',style:{},scrollTo(){}});return elements.get(s)},querySelectorAll:()=>[],addEventListener:(name,fn)=>handlers[name]=fn},
 localStorage:{getItem:()=>null,setItem(){}},crypto:{randomUUID},location:{hostname:'example.test',origin:'https://example.test'},window:{},setTimeout:()=>1,clearTimeout(){},structuredClone,console,confirm:()=>true,
 FormData:class{constructor(f){this.fields=f.fields}get(k){return this.fields[k]??null}},fetch:()=>{throw Error('Unexpected real network request')}
 });vm.runInContext(source,context);return {run:code=>vm.runInContext(code,context),submit:async(id,fields)=>handlers.submit({preventDefault(){},target:{id,fields}}),elements};}

test('all teacher and student views render, including new empty class',()=>{const a=app();for(const view of ['dashboard','classes','materialsView','worksheetView','worksheetFolderView','ocrView','resultsView','learnView','myprogress','summaryView','settings'])assert.ok(a.run(`${view}().length`)>100,view);a.run("db.classes.push({id:'empty',name:'빈 반',subject:'과학',students:[]});db.classId='empty'");for(const view of ['dashboard','classes','materialsView','worksheetView','worksheetFolderView','ocrView','resultsView','learnView','myprogress','summaryView'])assert.ok(a.run(`${view}().length`)>100,view)});
test('generated worksheet folder shows worksheet-specific student status',()=>{const a=app();const list=a.run('worksheetView()');assert.match(list,/생성된 학습지/);assert.match(list,/data-folder="w1"/);const folder=a.run("worksheetId='w1';worksheetFolderView()");assert.match(folder,/학생 상태/);assert.match(folder,/<span>제출<\/span><strong>6/);assert.match(folder,/미제출/);assert.match(folder,/오답 학습 대기|채점 완료/);assert.match(folder,/data-worksheet="w1"/)});

test('worksheet folders retain per-worksheet sessions when a student starts another worksheet',()=>{
 const a=app();a.run("db.learningSessions={'s1:w1':{id:'saved',worksheetId:'w1',resultId:db.results[1].id,answers:['a','b','c'],verification:{correct:true}}};db.sessions.s1={worksheetId:'other',answers:[]}");
 assert.equal(a.run("worksheetStatus(students()[1],sheets()[0]).label"),'독립 해결 성공');
 a.run("db.learningSessions['s1:w1'].resultId='outdated-result'");
 assert.equal(a.run("worksheetStatus(students()[1],sheets()[0]).label"),'오답 학습 대기');
});

test('failed verification stays visible but does not count as completed learning',()=>{
 const a=app();a.run("db.results=db.results.filter(r=>r.studentId==='s1');db.sessions.s1={worksheetId:'w1',resultId:db.results[0].id,answers:['a','b','c'],verification:{correct:false}};worksheetId='w1'");
 assert.equal(a.run("worksheetStatus(students()[1],sheets()[0]).complete"),false);
 assert.match(a.run('worksheetFolderView()'),/<span>학습 완료<\/span><strong>0/);
 assert.match(a.run('worksheetFolderView()'),/student-step retry/);
 a.run('db.sessions.s1.verification.correct=true');
 assert.match(a.run('worksheetFolderView()'),/<span>학습 완료<\/span><strong>1/);
});
test('grading accepts equivalent density units, catches wrong units and defers essays',()=>{const a=app();assert.equal(a.run("localGrade(questions[1],'3 g/cm^3').correct"),true);assert.equal(a.run("localGrade(questions[1],'3 g').correct"),false);assert.equal(a.run("localGrade(questions[3],'질량과 부피가 비례한다').correct"),null);assert.equal(a.run("localGrade(questions[0],'2').correct"),true);assert.equal(a.run("localGrade(questions[0],'').reason"),'추가 확인 필요')});
test('student progresses through exactly three turns and independent check',async()=>{const a=app();a.run("studentId='s1';newSession()");assert.equal(a.run('db.sessions.s1.answers.length'),0);await a.submit('chat-form',{answer:'모르겠어'});assert.match(a.run('db.sessions.s1.messages.at(-1).text'),/작은 블록/);await a.submit('chat-form',{answer:'둘 다 5야'});assert.match(a.run('db.sessions.s1.messages.at(-1).text'),/네 말로 설명/);await a.submit('chat-form',{answer:'질량과 부피가 같은 비율로 늘어나니까 밀도는 같아'});assert.equal(a.run('db.sessions.s1.answers.length'),3);assert.match(a.run('learnView()'),/혼자 도전하기/);assert.doesNotMatch(a.run('learnView()'),/id="chat-form"/);assert.equal(a.run('db.sessions.s1.verification'),null);await a.submit('verify-form',{answer:'4 g/cm³'});assert.equal(a.run('db.sessions.s1.verification.correct'),true);assert.match(a.run('summaryView()'),/독립 해결 성공/)});
test('incorrect independent answer is recorded as additional learning',async()=>{const a=app();a.run("studentId='s1';newSession();db.sessions.s1.answers=['a','b','c']");await a.submit('verify-form',{answer:'12 g/cm³'});assert.equal(a.run('db.sessions.s1.verification.correct'),false);assert.match(a.run('summaryView()'),/김|이준서/)});
test('class creation and student records are isolated from demo class',async()=>{const a=app();await a.submit('class-form',{name:'1학년 2반',subject:'수학'});assert.equal(a.run('students().length'),0);assert.equal(a.run('sheets().length'),0);assert.equal(a.run('results().length'),0);await a.submit('student-form',{name:'테스트 학생'});assert.equal(a.run('students().length'),1);assert.equal(a.run('students()[0].number'),1);assert.equal(a.run('db.classes[0].students.length'),8)});
test('invalid multiple choice draft cannot be accepted',()=>{const a=app();assert.throws(()=>a.run("validateQuestions([{text:'질문',answer:'4',concept:'개념',rubric:'기준',type:'3지선다',options:['a','b','c']}])"),/3지선다/)});
test('student content is escaped before rendering',()=>{const a=app();a.run("db.classes[0].students[1].name='<img src=x onerror=alert(1)>'");assert.doesNotMatch(a.run('dashboard()'),/<img src=x/);assert.match(a.run('dashboard()'),/&lt;img/)});
test('blank messages preserve current dialogue',async()=>{const a=app();a.run("studentId='s1';newSession()");await a.submit('chat-form',{answer:'  '});assert.equal(a.run('db.sessions.s1.answers.length'),0)});
