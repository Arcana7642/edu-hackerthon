import {isTF,normalizeTF,formatTF,gradeTF} from './dist/tf-utils.js';

const str={type:'string'};
const schema={type:'object',properties:{items:{type:'array',items:{type:'object',properties:{questionId:str,correct:{type:['boolean','null']},reason:str,feedback:str},required:['questionId','correct','reason','feedback'],additionalProperties:false}}},required:['items'],additionalProperties:false};

// Both portals use the same rubric. Model output cannot replace submitted answers.
export async function gradeAnswers(llm,questions,answers){
 if(!Array.isArray(questions)||!questions.length||!Array.isArray(answers)||answers.length!==questions.length||new Set(questions.map(q=>q.id)).size!==questions.length||new Set(answers.map(a=>a.questionId)).size!==questions.length||questions.some(q=>!answers.some(a=>a.questionId===q.id)))throw new Error('모든 문항의 답안을 한 번씩 제출하세요.');
 const submitted=questions.map(q=>{const a=answers.find(a=>a.questionId===q.id);return isTF(q)?{questionId:q.id,tfAnswer:normalizeTF(a.tfAnswer||a.answer),answer:formatTF(a.tfAnswer||a.answer)}:{questionId:q.id,answer:String(a.answer??'').trim()}});
 const output=await llm('학생 답안을 제공된 정답과 채점 기준으로 채점하세요. 의미가 같은 표현을 인정하고 숫자와 단위를 확인하세요. T/F가 F이면 판단·틀린 부분·고친 문장을 모두 평가하세요. 판단만 맞으면 정답이 아닙니다. correct는 true/false, 판단이 어려우면 null입니다. reason은 정답이면 빈 문자열, 그 외에는 개념 부족 추정/단순 실수 추정/추가 확인 필요 중 하나입니다. 오답 원인을 확정하지 마세요. feedback에는 짧은 평가 근거를 쓰세요. 모든 문항을 정확히 한 번씩 반환하세요.',{questions,answers:submitted},schema);
 if(!Array.isArray(output?.items)||output.items.length!==questions.length||new Set(output.items.map(i=>i.questionId)).size!==questions.length||output.items.some(i=>!questions.some(q=>q.id===i.questionId)||![true,false,null].includes(i.correct)||typeof i.feedback!=='string'||typeof i.reason!=='string'))throw new Error('AI 채점 결과가 문항과 일치하지 않습니다. 다시 시도해 주세요.');
 return submitted.map(a=>{const q=questions.find(q=>q.id===a.questionId),evaluation=output.items.find(i=>i.questionId===a.questionId);let correct=evaluation.correct,feedback=evaluation.feedback;
  if(isTF(q)&&gradeTF(q,a.tfAnswer).correct===false){correct=false;feedback=gradeTF(q,a.tfAnswer).feedback}
  if(!a.answer){correct=false;feedback='답안이 작성되지 않았습니다.'}
  const reason=correct===true?'':correct===null?'추가 확인 필요':['개념 부족 추정','단순 실수 추정','추가 확인 필요'].includes(evaluation.reason)?evaluation.reason:'추가 확인 필요';
  return {...a,correct,reason,feedback};
 });
}
