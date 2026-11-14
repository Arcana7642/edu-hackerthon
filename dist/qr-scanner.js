let pdfModule=null;
function decodeCanvas(canvas){
 const context=canvas.getContext('2d',{willReadFrequently:true});const data=context.getImageData(0,0,canvas.width,canvas.height);const found=[];
 for(let i=0;i<6;i++){const result=window.jsQR(data.data,data.width,data.height,{inversionAttempts:'attemptBoth'});if(!result)break;found.push(result.data);const points=[result.location.topLeftCorner,result.location.topRightCorner,result.location.bottomLeftCorner,result.location.bottomRightCorner];const x0=Math.max(0,Math.floor(Math.min(...points.map(p=>p.x)))-6),x1=Math.min(data.width,Math.ceil(Math.max(...points.map(p=>p.x)))+6),y0=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y)))-6),y1=Math.min(data.height,Math.ceil(Math.max(...points.map(p=>p.y)))+6);for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const at=(y*data.width+x)*4;data.data[at]=255;data.data[at+1]=255;data.data[at+2]=255;data.data[at+3]=255}}
 return found;
}
async function imageCanvas(file){const bitmap=await createImageBitmap(file);try{const scale=Math.min(1,2600/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);return canvas}finally{bitmap.close()}}
export async function readWorksheetQR(file){
 if(!window.jsQR)throw new Error('QR 인식 모듈을 불러오지 못했습니다. 새로고침해 주세요.');
 let decoded=[];
 if(file.type==='application/pdf'||/\.pdf$/i.test(file.name)){
  pdfModule??=await import('/vendor/pdf.mjs');pdfModule.GlobalWorkerOptions.workerSrc='/vendor/pdf.worker.mjs';
  const pdf=await pdfModule.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false}).promise;
  try{if(pdf.numPages>20)throw new Error('QR 자동 인식은 20쪽 이하 PDF를 지원합니다. 학습지별로 나누어 업로드하세요.');for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i),size=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(3,2200/Math.max(size.width,size.height))});const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;decoded.push(...decodeCanvas(canvas));page.cleanup()}}finally{await pdf.destroy()}
 }else decoded=decodeCanvas(await imageCanvas(file));
 const valid=[...new Set(decoded)].filter(value=>{try{const q=JSON.parse(value);return q.app==='halsuisseo'&&q.v===1}catch{return false}});
 if(valid.length>1)throw new Error('서로 다른 학습지 QR이 포함되어 있습니다. 학습지별로 나누어 업로드하세요.');
 return valid[0]||null;
}
