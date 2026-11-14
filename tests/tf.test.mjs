import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTF,formatTF,validateTFResponse,gradeTF} from '../dist/tf-utils.js';
import {createDemoQuestions} from '../dist/demo-questions.js';
test('T/F OCR parsing round trips structured responses',()=>{
 const a={judgment:'F',wrongPart:'성종',correction:'훈민정음을 창제한 왕은 세종이다.'};
 assert.deepEqual(normalizeTF(formatTF(a)),a);assert.deepEqual(normalizeTF(JSON.stringify(a)),a);
 assert.deepEqual(normalizeTF('F | 성종 | 훈민정음을 창제한 왕은 세종이다.'),a);
 assert.equal(normalizeTF('true').judgment,'T');assert.equal(normalizeTF('거짓').judgment,'F');
});
test('F requires identification and correction, while T clears irrelevant content',()=>{
 assert.throws(()=>validateTFResponse({judgment:'F',wrongPart:'성종'}),/모두 입력/);
 assert.throws(()=>validateTFResponse({judgment:''}),/선택/);
 assert.deepEqual(validateTFResponse({judgment:'T',wrongPart:'unused',correction:'unused'}),{judgment:'T',wrongPart:'',correction:''});
});
test('F judgment alone cannot earn credit; equivalent unrecognized wording needs review',()=>{
 const q=createDemoQuestions('teacher-joseon','T/F',3)[1];
 assert.equal(gradeTF(q,{judgment:'T'}).correct,false);
 assert.equal(gradeTF(q,{judgment:'F'}).correct,false);
 assert.equal(gradeTF(q,{judgment:'F',wrongPart:q.wrongPart,correction:q.correction}).correct,true);
 assert.equal(gradeTF(q,{judgment:'F',wrongPart:q.wrongPart,correction:'창제한 왕은 세종입니다.'}).correct,null);
 for(const id of ['teacher-galaxy','teacher-joseon','teacher-circulation','m1'])for(const item of createDemoQuestions(id,'T/F',3))if(item.answer==='F'){assert.ok(item.wrongPart);assert.ok(item.correction)}
});
