export const providers={
 baze:{name:'BAZE',baseUrl:'https://api.baze.co/v1/gateway',model:'gpt-5.6-sol',keyVariable:'BAZE_API_KEY',websiteKeyVariable:'THINKMATE_BAZE_API_KEY',modelVariable:'BAZE_MODEL',embeddingVariable:'BAZE_EMBEDDING_MODEL'},
 openai:{name:'OpenAI',baseUrl:'https://api.openai.com/v1',model:'gpt-4.1-mini',keyVariable:'OPENAI_API_KEY',modelVariable:'OPENAI_MODEL',embeddingVariable:'OPENAI_EMBEDDING_MODEL'}
};

export function aiSettings(env=process.env){
 const provider=env.AI_PROVIDER||((env.THINKMATE_BAZE_API_KEY||env.BAZE_API_KEY)?'baze':'openai'),p=providers[provider];
 if(!p)throw new Error('AI_PROVIDER는 baze 또는 openai여야 합니다.');
 return {provider,key:(p.websiteKeyVariable&&env[p.websiteKeyVariable])||env[p.keyVariable]||'',model:env[p.modelVariable]||p.model,embeddingModel:env[p.embeddingVariable]||'text-embedding-3-small'};
}

export async function requestAi(settings,route,payload,fetchImpl=fetch){
 const p=providers[settings.provider];
 if(!p||!['responses','embeddings'].includes(route))throw new Error('지원하지 않는 AI 연결입니다.');
 if(!settings.key)throw new Error(`서버에 ${p.keyVariable}를 설정하거나 API 연결 화면에서 키를 입력하세요.`);
 // Fixed provider URLs and no redirects keep credentials on the selected service.
 const url=p.baseUrl+'/'+route+(settings.provider==='baze'?'/':'');
 const r=await fetchImpl(url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:`Bearer ${settings.key}`},body:JSON.stringify(payload),signal:AbortSignal.timeout(90000)});
 if(!r.ok)throw new Error(`${p.name} AI 요청 실패 (${r.status}). API 키·모델·잔여 사용량을 확인해 주세요.`);
 return r.json();
}
