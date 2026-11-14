const app=document.querySelector('#app');
async function start(){const r=await fetch('/api/teacher/me');if(!r.ok)throw new Error('교사 화면을 불러오지 못했습니다.');globalThis.WorksheetTF=await import('/tf-utils.js');await import('/app.js')}
start().catch(()=>{app.innerHTML='<section class="login-shell"><h1>서버에 연결할 수 없습니다.</h1><p>로컬 서버 실행 후 새로고침해 주세요.</p><a href="/teacher">다시 열기 →</a></section>'});
