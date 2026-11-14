import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createRag,splitPages} from '../rag.mjs';
function fixture(options={}){const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE materials(id TEXT PRIMARY KEY,class_id TEXT,title TEXT,text TEXT)');const rag=createRag({sql,embed:async()=>{throw Error('No API expected')},hasKey:()=>false,getModel:()=> 'test-model',...options});return {sql,rag}}
const state={materials:[{id:'heart',classId:'c1',title:'순환계',text:'[1쪽: 심장의 구조]\n심실은 혈액을 강하게 내보내므로 심방보다 근육이 두껍다. 판막은 혈액의 역류를 막는다.\n[2쪽: 혈액 순환]\n온몸순환은 좌심실에서 대동맥, 온몸 모세혈관, 대정맥을 거쳐 우심방으로 이어진다.',extraction:'원문 검토'},{id:'space',classId:'c1',title:'우리은하',text:'[1쪽]\n우리은하는 중심부가 볼록한 원반 모양이다. 별이 한 방향으로 겹쳐 보여 은하수가 띠 모양으로 보인다.'},{id:'history',classId:'c2',title:'조선 건국',text:'[1쪽]\n위화도 회군 후 이성계와 급진파 사대부가 조선을 건국했다.'}]};
test('page-aware chunks stay bounded and retain source pages',()=>{const chunks=splitPages('[1쪽]\n'+('심장과 혈액 순환. '.repeat(180))+'\n[2쪽]\n판막은 역류를 막는다.');assert.ok(chunks.length>2);assert.ok(chunks.every(c=>c.text.length<=650));assert.equal(chunks.at(-1).page,2);assert.ok(chunks.at(-1).text.includes('판막'))});
test('Korean retrieval returns relevant text and page without any external API',async()=>{const {sql,rag}=fixture();rag.sync(state);const hits=await rag.search('c1','심실이 심방보다 두꺼운 이유');assert.equal(hits[0].materialId,'heart');assert.equal(hits[0].page,1);assert.equal(hits[0].citation,'순환계 1쪽');assert.equal(hits[0].method,'local');assert.ok(hits[0].text.includes('근육이 두껍다'));assert.equal((await rag.search('c1','위화도 회군')).length,0);assert.equal((await rag.search('c1','은하수 띠 모양'))[0].materialId,'space');sql.close()});
test('material and class boundaries are preserved',async()=>{const {sql,rag}=fixture();rag.sync(state);assert.equal((await rag.search('c1','심장','space')).length,0);assert.equal((await rag.search('c2','위화도'))[0].materialId,'history');assert.equal(rag.status('c1').documentCount,2);sql.close()});
test('changed content replaces stale chunks and removed documents disappear',()=>{const {sql,rag}=fixture();rag.sync(state);const first=rag.status().chunkCount;rag.sync(state);assert.equal(rag.status().chunkCount,first);rag.sync({materials:[{...state.materials[0],text:'[3쪽]\n새로운 판막 설명'}]});assert.equal(rag.status().documentCount,1);assert.equal(sql.prepare('SELECT page FROM rag_chunks').get().page,3);assert.equal(sql.prepare('SELECT COUNT(*) n FROM rag_chunks WHERE text LIKE ?').get('%우리은하%').n,0);sql.close()});
test('optional embeddings persist and hybrid search uses matching model',async()=>{let calls=0;const {sql,rag}=fixture({hasKey:()=>true,embed:async texts=>{calls++;return texts.map(t=>t.includes('심')?[1,0]:[0,1])}});rag.sync(state);await rag.indexVectors('c1');assert.equal(rag.status('c1').embeddedCount,rag.status('c1').chunkCount);const previous=calls;await rag.indexVectors('c1');assert.equal(calls,previous);const hits=await rag.search('c1','심실');assert.equal(hits[0].materialId,'heart');assert.equal(hits[0].method,'hybrid');sql.close()});
test('embedding failures do not mark documents as embedded',async()=>{const {sql,rag}=fixture({hasKey:()=>true});rag.sync(state);await assert.rejects(()=>rag.indexVectors('c1'),/No API expected/);assert.equal(rag.status('c1').embeddedCount,0);sql.close()});

test('concurrent indexing for different classes embeds both scopes',async()=>{
 const {sql,rag}=fixture({hasKey:()=>true,embed:async texts=>{await new Promise(resolve=>setImmediate(resolve));return texts.map(()=>[1,0])}});
 rag.sync(state);await Promise.all([rag.indexVectors('c1'),rag.indexVectors('c2')]);
 for(const id of ['c1','c2'])assert.equal(rag.status(id).embeddedCount,rag.status(id).chunkCount);
 sql.close();
});
test('invalid query embeddings fail clearly without returning misleading search results',async()=>{
 const {sql,rag}=fixture({hasKey:()=>true,embed:async texts=>texts.map(t=>t==='심실'?[]:[1,0])});rag.sync(state);
 await assert.rejects(()=>rag.search('c1','심실'),/검색어 임베딩/);sql.close();
});
