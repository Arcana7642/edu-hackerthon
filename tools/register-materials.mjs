import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const records=JSON.parse(await readFile(path.join(root,'data/material-import.json'),'utf8'));
const db=new DatabaseSync(path.join(root,'data/thinkmate.sqlite'));
const state=JSON.parse(db.prepare('SELECT payload FROM app_state WHERE id=1').get().payload);
const classId=state.classId||state.classes[0]?.id;
if(!state.classes.some(c=>c.id===classId))throw new Error('자료를 등록할 반이 없습니다.');
await writeFile(path.join(root,'data/before-material-import.json'),JSON.stringify(state,null,2),'utf8');
for(const m of records){if(m.text.length<100||m.pageCount!==3)throw new Error('자료 본문과 페이지를 확인해 주세요.');await readFile(path.join(root,'data/uploads',m.sourceFile))}
db.exec('BEGIN');
try{
 for(const record of records){const material={...record,classId};const i=state.materials.findIndex(m=>m.id===material.id);if(i<0)state.materials.push(material);else state.materials[i]=material;
  db.prepare('INSERT INTO materials(id,class_id,title,text) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET class_id=excluded.class_id,title=excluded.title,text=excluded.text').run(material.id,classId,material.title,material.text);
 }
 db.prepare('UPDATE app_state SET payload=? WHERE id=1').run(JSON.stringify(state));
 db.prepare('UPDATE platform_meta SET revision=revision+1,teacher_revision=teacher_revision+1 WHERE id=1').run();
 db.exec('COMMIT');
 console.log(JSON.stringify({registered:records.length,classId,totalMaterials:state.materials.length,pages:records.reduce((a,m)=>a+m.pageCount,0),embeddings:'not generated - API connection required'}));
}catch(e){db.exec('ROLLBACK');throw e}finally{db.close()}
