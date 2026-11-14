import test from 'node:test';
import assert from 'node:assert/strict';
import {gradeAnswers} from '../ai-grading.mjs';

const questions=[{id:'essay',type:'서술형',text:'밀도가 일정한 이유',answer:'질량과 부피가 비례한다.',rubric:'비례 관계 설명'}];
const evaluation=(id='essay')=>({questionId:id,correct:true,reason:'',feedback:'비례 관계를 설명했습니다.'});
test('AI rubric grading accepts equivalent wording and preserves submitted answers',async()=>{
 const answer='양이 늘면 질량과 부피도 같은 비율로 증가해서요.';
 const items=await gradeAnswers(async(instructions,data)=>{assert.equal(data.questions[0].rubric,questions[0].rubric);assert.equal(data.answers[0].answer,answer);return {items:[{...evaluation(),answer:'model replacement'}]}},questions,[{questionId:'essay',answer}]);
 assert.equal(items[0].correct,true);assert.equal(items[0].answer,answer);
});
test('missing, duplicate, and unknown AI grading IDs reject the entire result',async()=>{
 for(const items of [[],[evaluation('unknown')],[evaluation(),evaluation()]])await assert.rejects(()=>gradeAnswers(async()=>({items}),questions,[{questionId:'essay',answer:'답안'}]),/일치/);
 await assert.rejects(()=>gradeAnswers(async()=>({items:[{...evaluation(),correct:'true'}]}),questions,[{questionId:'essay',answer:'답안'}]),/일치/);
});
test('blank answers and incomplete false corrections cannot receive AI credit',async()=>{
 assert.equal((await gradeAnswers(async()=>({items:[evaluation()]}),questions,[{questionId:'essay',answer:''}]))[0].correct,false);
 const tf={...questions[0],type:'T/F',answer:'F',wrongPart:'곱한다',correction:'나눈다'};
 assert.equal((await gradeAnswers(async()=>({items:[evaluation()]}),[tf],[{questionId:'essay',tfAnswer:{judgment:'F'}}]))[0].correct,false);
});
test('uncertain AI grading stays pending for teacher review; API failures are surfaced',async()=>{
 const items=await gradeAnswers(async()=>({items:[{...evaluation(),correct:null,reason:'개념 부족 추정'}]}),questions,[{questionId:'essay',answer:'답안'}]);
 assert.equal(items[0].correct,null);assert.equal(items[0].reason,'추가 확인 필요');
 await assert.rejects(()=>gradeAnswers(async()=>{throw Error('API unavailable')},questions,[{questionId:'essay',answer:'답안'}]),/API unavailable/);
});
