import {createHash} from 'node:crypto';

export function terms(text){
 const words=String(text).normalize('NFKC').toLowerCase().match(/[가-힣a-z0-9]+/g)||[];
 const result=[];for(const word of words){result.push(word);if(/[가-힣]/.test(word))for(const n of [2,3])for(let i=0;i<=word.length-n;i++)result.push(word.slice(i,i+n))}return result.filter(t=>!['보다','이유','어떤','에서','으로','하는','이다','것은','대한','하게'].includes(t));
}
export function splitPages(text,max=650,overlap=100){
 const chunks=[];let page=1,buffer='';
 const emit=()=>{while(buffer.length){const end=buffer.length>max?Math.max(buffer.lastIndexOf('\n',max),Math.floor(max*.7)):buffer.length;const length=Math.min(max,end);const value=buffer.slice(0,length).trim();if(value)chunks.push({page,text:value});if(length>=buffer.length){buffer='';break}buffer=buffer.slice(Math.max(1,length-overlap))}};
 for(const line of String(text).replace(/\r/g,'').split('\n')){const marker=line.match(/^\[(\d+)쪽[^\]]*\]/);if(marker){emit();page=Number(marker[1]);buffer=line+'\n'}else{buffer+=line+'\n';if(buffer.length>max*2)emit()}}
 emit();return chunks;
}
function similarity(a,b){if(a.length!==b.length)return 0;let s=0,aa=0,bb=0;for(let i=0;i<a.length;i++){s+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i]}return s/(Math.sqrt(aa*bb)||1)}
export function createRag({sql,embed,hasKey,getModel}){
 sql.exec(`CREATE TABLE IF NOT EXISTS rag_documents(id TEXT PRIMARY KEY,class_id TEXT NOT NULL,title TEXT NOT NULL,content_hash TEXT NOT NULL,provenance TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS rag_chunks(id TEXT PRIMARY KEY,material_id TEXT NOT NULL,class_id TEXT NOT NULL,page INTEGER NOT NULL,ordinal INTEGER NOT NULL,text TEXT NOT NULL,terms TEXT NOT NULL,embedding TEXT,embedding_model TEXT);
 CREATE INDEX IF NOT EXISTS rag_class_material ON rag_chunks(class_id,material_id);`);
 const digest=t=>createHash('sha256').update(t).digest('hex');
 function sync(state){const documents=state.materials.filter(m=>m.text?.trim());const valid=new Set(documents.map(m=>m.id));sql.exec('SAVEPOINT rag_sync');try{
  for(const old of sql.prepare('SELECT id FROM rag_documents').all())if(!valid.has(old.id)){sql.prepare('DELETE FROM rag_documents WHERE id=?').run(old.id);sql.prepare('DELETE FROM rag_chunks WHERE material_id=?').run(old.id)}
  for(const m of documents){const hash=digest(m.text),existing=sql.prepare('SELECT * FROM rag_documents WHERE id=?').get(m.id);sql.prepare('INSERT INTO materials(id,class_id,title,text) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET class_id=excluded.class_id,title=excluded.title,text=excluded.text').run(m.id,m.classId,m.title,m.text);if(existing?.content_hash===hash&&existing.class_id===m.classId&&existing.title===m.title)continue;
   sql.prepare('DELETE FROM rag_chunks WHERE material_id=?').run(m.id);sql.prepare('INSERT OR REPLACE INTO rag_documents VALUES(?,?,?,?,?,?)').run(m.id,m.classId,m.title,hash,m.extraction||'등록된 텍스트',new Date().toISOString());
   const insert=sql.prepare('INSERT INTO rag_chunks VALUES(?,?,?,?,?,?,?,?,?)');splitPages(m.text).forEach((c,i)=>insert.run(m.id+':'+hash.slice(0,10)+':'+i,m.id,m.classId,c.page,i,c.text,JSON.stringify(terms(c.text)),null,null));
  }sql.exec('RELEASE rag_sync');
 }catch(e){sql.exec('ROLLBACK TO rag_sync');sql.exec('RELEASE rag_sync');throw e}return status()}
 function status(classId){const rows=classId?sql.prepare('SELECT * FROM rag_documents WHERE class_id=?').all(classId):sql.prepare('SELECT * FROM rag_documents').all();const documents=rows.map(d=>{const s=sql.prepare('SELECT COUNT(*) count,SUM(CASE WHEN embedding IS NOT NULL AND embedding_model=? THEN 1 ELSE 0 END) embedded FROM rag_chunks WHERE material_id=?').get(getModel(),d.id);return {id:d.id,title:d.title,classId:d.class_id,chunkCount:s.count,embeddedCount:s.embedded||0,provenance:d.provenance,updatedAt:d.updated_at}});return {method:hasKey()?'hybrid':'local',documents,documentCount:documents.length,chunkCount:documents.reduce((n,d)=>n+d.chunkCount,0),embeddedCount:documents.reduce((n,d)=>n+d.embeddedCount,0),embeddingModel:getModel()}}
 let indexing=null;
 async function indexVectors(classId,materialId){if(!hasKey())return status(classId);if(indexing){await indexing;return status(classId)}indexing=(async()=>{const rows=sql.prepare('SELECT * FROM rag_chunks WHERE class_id=?'+(materialId?' AND material_id=?':'')).all(...(materialId?[classId,materialId]:[classId])).filter(r=>!r.embedding||r.embedding_model!==getModel());for(let i=0;i<rows.length;i+=32){const batch=rows.slice(i,i+32),model=getModel(),vectors=await embed(batch.map(r=>r.text));if(vectors.length!==batch.length)throw new Error('임베딩 결과 개수가 일치하지 않습니다.');const update=sql.prepare('UPDATE rag_chunks SET embedding=?,embedding_model=? WHERE id=?');for(let j=0;j<batch.length;j++){if(!Array.isArray(vectors[j])||!vectors[j].length||vectors[j].some(n=>!Number.isFinite(n)))throw new Error('임베딩 응답 형식이 잘못되었습니다.');update.run(JSON.stringify(vectors[j]),model,batch[j].id)}}})();try{await indexing;return status(classId)}finally{indexing=null}}
 async function search(classId,query,materialId,limit=5){const q=String(query||'').trim();if(!q)throw new Error('검색어를 입력하세요.');let rows=sql.prepare('SELECT c.*,d.title,d.provenance FROM rag_chunks c JOIN rag_documents d ON d.id=c.material_id WHERE c.class_id=?'+(materialId?' AND c.material_id=?':'')).all(...(materialId?[classId,materialId]:[classId]));if(!rows.length)return [];
  const qt=[...new Set(terms(q))],docs=rows.map(r=>JSON.parse(r.terms)),avg=docs.reduce((n,t)=>n+t.length,0)/docs.length,df=new Map(qt.map(t=>[t,docs.filter(a=>a.includes(t)).length]));
  let ranked=rows.map((r,i)=>{const counts=new Map();for(const t of docs[i])counts.set(t,(counts.get(t)||0)+1);let score=0;for(const t of qt){const tf=counts.get(t)||0;if(tf)score+=Math.log(1+(rows.length-(df.get(t)||0)+.5)/((df.get(t)||0)+.5))*tf*2.2/(tf+1.2*(.25+.75*docs[i].length/avg))}return {...r,lexical:score}});
  const max=Math.max(...ranked.map(r=>r.lexical),1);let vector=null;
  if(hasKey()){await indexVectors(classId,materialId);rows=sql.prepare('SELECT id,embedding,embedding_model FROM rag_chunks WHERE class_id=?'+(materialId?' AND material_id=?':'')).all(...(materialId?[classId,materialId]:[classId]));vector=(await embed([q]))[0];const embeddings=new Map(rows.filter(r=>r.embedding_model===getModel()&&r.embedding).map(r=>[r.id,JSON.parse(r.embedding)]));ranked=ranked.map(r=>({...r,score:.35*r.lexical/max+.65*Math.max(0,similarity(vector,embeddings.get(r.id)||[]))}))}else ranked=ranked.map(r=>({...r,score:r.lexical/max}));
  return ranked.filter(r=>r.score>0).sort((a,b)=>b.score-a.score).slice(0,Math.max(1,Math.min(10,limit))).map(r=>({chunkId:r.id,materialId:r.material_id,title:r.title,page:r.page,text:r.text,score:Number(r.score.toFixed(4)),method:vector?'hybrid':'local',provenance:r.provenance,citation:r.title+' '+r.page+'쪽'}));
 }
 return {sync,status,indexVectors,search};
}
