import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoQuestions} from '../dist/demo-questions.js';
for(const id of ['teacher-galaxy','teacher-joseon','teacher-circulation']){
 test(id+' supports distinct source-based questions in all five formats',()=>{const mixed=createDemoQuestions(id,'혼합형',6);assert.equal(mixed.length,6);assert.equal(new Set(mixed.map(q=>q.id)).size,6);assert.equal(new Set(mixed.map(q=>q.text)).size,6);assert.equal(new Set(mixed.map(q=>q.type)).size,5);for(const type of ['3지선다','단답형','서술형','빈칸 넣기','T/F']){const qs=createDemoQuestions(id,type,3);assert.equal(qs.length,3);assert.ok(qs.every(q=>q.type===type&&q.answer&&q.rubric&&q.sourcePage>=1&&q.sourcePage<=3));for(const q of qs)if(type==='3지선다'){assert.equal(q.options.length,3);assert.ok(['1','2','3'].includes(q.answer))}}});
}
test('unsupported sources and excessive single-format counts do not produce fake AI output',()=>{assert.equal(createDemoQuestions('unknown','혼합형',4),null);assert.throws(()=>createDemoQuestions('teacher-galaxy','서술형',6),/최대 3개/)});
