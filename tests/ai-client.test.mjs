import test from 'node:test';
import assert from 'node:assert/strict';
import {aiSettings,requestAi} from '../ai-client.mjs';

test('BAZE key selects BAZE defaults while explicit OpenAI stays isolated',()=>{
 assert.deepEqual(aiSettings({BAZE_API_KEY:'baze-test'}),{provider:'baze',key:'baze-test',model:'gpt-5.6-sol',embeddingModel:'text-embedding-3-small'});
 const settings=aiSettings({AI_PROVIDER:'openai',BAZE_API_KEY:'baze-test',OPENAI_API_KEY:'openai-test'});
 assert.equal(settings.provider,'openai');assert.equal(settings.key,'openai-test');
 assert.throws(()=>aiSettings({AI_PROVIDER:'unknown'}),/AI_PROVIDER/);
});
test('BAZE Responses and embeddings use fixed gateway URLs and prohibit redirects',async()=>{
 for(const route of ['responses','embeddings']){
  const data=await requestAi({provider:'baze',key:'test-secret'},route,{model:'test-model'},async(url,options)=>{
   assert.equal(url,'https://api.baze.co/v1/gateway/'+route+'/');assert.equal(options.redirect,'error');
   assert.equal(options.headers.Authorization,'Bearer test-secret');assert.equal(JSON.parse(options.body).model,'test-model');
   return {ok:true,json:async()=>({ok:true})};
  });assert.equal(data.ok,true);
 }
});
test('request failures omit credential and provider response body',async()=>{
 await assert.rejects(()=>requestAi({provider:'baze',key:'test-secret'},'responses',{},async()=>({ok:false,status:401})),e=>e.message.includes('BAZE')&&!e.message.includes('test-secret'));
 await assert.rejects(()=>requestAi({provider:'baze',key:''},'responses',{}),/BAZE_API_KEY/);
});
