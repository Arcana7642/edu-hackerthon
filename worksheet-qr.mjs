import {createHash} from 'node:crypto';
import QRCode from 'qrcode';

function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));return value}
export function worksheetRevision(worksheet){return createHash('sha256').update(JSON.stringify(canonical({title:worksheet.title,questions:worksheet.questions}))).digest('hex').slice(0,16)}
export function worksheetIdentity(worksheet){return {app:'halsuisseo',v:1,classId:worksheet.classId,worksheetId:worksheet.id,revision:worksheetRevision(worksheet)}}
export function identifyWorksheet(state,payload,classId){
 if(typeof payload!=='string'||payload.length>2000)throw new Error('학습지 QR 형식이 올바르지 않습니다.');
 let qr;try{qr=JSON.parse(payload)}catch{throw new Error('할 수 있어 학습지의 QR 코드가 아닙니다.')}
 if(qr?.app!=='halsuisseo'||qr.v!==1||typeof qr.worksheetId!=='string'||typeof qr.classId!=='string'||!/^[a-f0-9]{16}$/.test(qr.revision))throw new Error('할 수 있어 학습지의 QR 코드가 아닙니다.');
 if(qr.classId!==classId)throw new Error('다른 반의 학습지입니다. 해당 반을 선택한 뒤 다시 업로드하세요.');
 const worksheet=state.worksheets.find(w=>w.id===qr.worksheetId&&w.classId===classId);
 if(!worksheet)throw new Error('등록되지 않았거나 삭제된 학습지입니다.');
 if(worksheetRevision(worksheet)!==qr.revision)throw new Error('수정 전 학습지의 QR입니다. 학습지 내용을 확인하고 다시 출력하세요.');
 return {worksheetId:worksheet.id,classId:worksheet.classId,title:worksheet.title,revision:qr.revision};
}
export async function createWorksheetQR(worksheet){const identity=worksheetIdentity(worksheet),payload=JSON.stringify(identity);const svg=await QRCode.toString(payload,{type:'svg',errorCorrectionLevel:'M',margin:4,width:200});return {identity,payload,svg}}
