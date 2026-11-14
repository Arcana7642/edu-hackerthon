# 역할별 API

같은 출처의 HttpOnly 쿠키 세션으로 인증합니다. 오류: HTTP 4xx/5xx와 `{error:string}`.

## 교사

- GET /api/teacher/login-info → `{demo}`
- POST /api/teacher/login `{password}` → 교사 쿠키
- GET /api/teacher/me → 역할·교사명
- POST /api/teacher/logout → 쿠키·서버 세션 폐기
- GET /api/teacher/state → `{state,revision,teacherRevision,access:[{studentId,code,url}]}`
- PUT /api/teacher/state `{state,teacherRevision}` → `{ok,revision,teacherRevision,access}`

교사 저장은 최신 학생 세션을 유지합니다. 다른 교사 창의 편집으로 teacherRevision이 다르면 409입니다. 답안을 재채점하면 해당 학습 세션을 무효화합니다.

아래 기존 API도 교사 로그인이 필요합니다.

- POST /api/materials: multipart `classId,title,text,file?` → `{id,status,chunkCount}`. TXT/MD·text 처리, PDF 본문 추출은 추가 연결.
- POST /api/worksheets/generate: `{classId,materialId,title,goal,type,count}` → `{questions:[{id,type,concept,text,options,answer,rubric}]}`.
- POST /api/ocr: multipart `classId,worksheet,student,file` → `{answers:{문항ID:문자열}}`. OCR_BACKEND_URL로 전달.
- POST /api/grade: `{classId,worksheetId,studentId,questions,answers:[{questionId,answer}]}` → `{items:[{questionId,answer,correct,reason}]}`. correct는 true/false/null, null은 교사 검토.

## 학생

- POST /api/student/login `{code}` → 해당 학생 쿠키
- GET /api/student/me → 본인 정보
- POST /api/student/logout → 쿠키·서버 세션 폐기
- GET /api/student/home → `{student,tasks,aiConfigured,revision}`
- POST /api/student/sessions/start `{worksheetId,restart?:boolean}` → `{session}`
- POST /api/student/sessions/turn `{worksheetId,sessionId,answer}` → `{session}`
- POST /api/student/sessions/verify `{worksheetId,sessionId,answer}` → `{session}`

학생 ID는 쿠키 세션에서 결정합니다. tasks에는 본인 반 과제와 본인 답안 상태만 포함합니다. session은 `{id,worksheetId,concept,reason,demo,messages,turnCount,phase,check,verification}`입니다. check는 세 번의 대화 뒤 `{text}`만 공개합니다. 정답과 채점 기준은 서버에 보관합니다. phase는 chat/check/complete입니다.

대화 전 독립 문제 제출과 네 번째 대화는 거부합니다. 같은 세션 동시 요청은 409입니다. 교사 재채점 이후 이전 세션은 제출할 수 없습니다. 학생 결과는 교사가 조회하는 같은 SQLite 상태에 기록합니다.

## 공통

GET /api/health → AI·OCR 설정 여부와 SQLite 상태.
기존 /api/state는 401, /api/tutor/*는 403으로 폐쇄했습니다. 세션 8시간, 로그인 IP당 분당 30회 제한. 기본 교사 비밀번호는 로컬 시연용입니다.

현재 로컬 시연은 로그인 화면을 생략합니다. GET /api/teacher/me, GET /api/student/me는 쿠키가 없으면 시연 세션을 자동 발급합니다. 일반 학생 주소의 기본 학생은 s1이며, 해당 학생이 없으면 등록된 학생을 선택합니다. 학생별 링크는 코드로 학생을 식별한 뒤 바로 접속합니다. 운영용 접근 통제는 별도로 다시 구성해야 합니다.


## RAG 및 OpenAI 설정 (교사 전용)

- GET /api/teacher/rag/status?classId=... → 검색 색인 상태
- POST /api/teacher/rag/search {classId,query,materialId?,limit?} → {results:[{chunkId,materialId,title,page,text,score,method,provenance,citation}],rag}
- POST /api/teacher/rag/reindex {classId,materialId?} → {rag,configured}. 키가 없으면 로컬 색인, 있으면 임베딩까지 생성합니다.
- GET /api/teacher/ai/status?classId=... → {configured,verifiedAt,model,embeddingModel,rag}. 키 자체는 반환하지 않습니다.
- POST /api/teacher/ai/connect {classId,key,model,embeddingModel} → 임베딩·GPT 요청 검증 후 .env에 저장. {configured,verifiedAt,model,embeddingModel,rag,indexError}. 연결 검증 성공 후 임베딩 생성이 실패한 경우 indexError를 별도로 반환합니다.

로컬 검색은 BM25, GPT 연결 후에는 임베딩 유사도와 본문 점수를 결합합니다. 검색은 요청한 반과 자료로 제한합니다. 키가 없으면 실제 API 연결은 미완료입니다.


## 학습지 QR (교사 전용)

- GET /api/teacher/worksheets/qr?classId=...&worksheetId=... → `{identity,payload,svg,title}`. 저장된 학습지로만 발급합니다.
- POST /api/teacher/worksheets/identify `{classId,qrPayload}` → `{worksheetId,classId,title,revision}`. 잘못된 형식·다른 반·삭제된 학습지·수정 전 버전은 오류입니다.
- payload는 JSON 문자열 `{app:"halsuisseo",v:1,classId,worksheetId,revision}`입니다. revision은 학습지 제목·문항의 정규화된 SHA-256 앞 16자리입니다. 학생 개인정보·정답은 넣지 않습니다.
- OCR multipart에 `qrPayload`를 선택적으로 추가합니다. 서버는 QR을 검증하고 `worksheet` 필드를 실제 식별 ID로 덮어쓴 후 OCR_BACKEND_URL로 보냅니다. OCR 서버의 반환형은 기존 `{answers}`에 `worksheetId`, `qrPayload`를 선택적으로 포함할 수 있습니다. 응답 ID가 QR 또는 반과 다르면 거부합니다.
- OCR 프록시 최종 응답: `{...OCR결과,worksheetId,classId,qrDetected}`. 프런트엔드는 이 worksheetId로 문항을 연결합니다.
- 클라이언트 QR 검출은 jsQR 및 PDF.js로 수행하며, QR 자체는 qrcode 패키지로 생성합니다. 서버 API는 생성/식별/전달 계약을 제공하고, 파일의 이미지 QR 검출은 브라우저에서 처리합니다.

과목 분류: /api/materials multipart에 subject 필드를 포함할 수 있습니다. 교사 상태의 materials[].subject에 과목을 저장하며, 기존 자료에 과목이 없으면 반의 과목을 사용합니다. 프런트엔드 자료 목록에서 전체·과목별 필터와 개수를 제공하고 학습지/RAG 자료 선택은 과목별 optgroup으로 표시합니다.


## T/F 문항 및 학생 직접 제출

문항 type에 `T/F`를 지원합니다. `answer`는 `T` 또는 `F`이며, F 문항에는 `wrongPart`(틀린 구절), `correction`(바르게 고친 전체 문장), `rubric`을 입력합니다. GPT 생성 응답의 다른 유형과 T 문항은 wrongPart/correction을 빈 문자열로 반환합니다.

- GET `/api/student/worksheet?worksheetId=...` → `{id,title,questions:[{id,type,text,options}],answers:[{questionId,answer,tfAnswer}]}`. 본인 반 학습지와 본인 이전 답안만 제공하며 정답·채점 기준은 제외합니다.
- POST `/api/student/worksheet/submit` → 입력 `{worksheetId,answers:[{questionId,tfAnswer:{judgment:"F",wrongPart:"틀린 구절",correction:"고친 문장"}}]}`. 다른 문항 유형은 tfAnswer 대신 answer 문자열을 전달합니다. 출력 `{ok,correctCount,pendingCount,total}`.
- 학생 ID는 쿠키에서 결정하고 클라이언트의 correct 값은 무시합니다. 모든 문항을 한 번씩 제출해야 합니다. F일 때 두 수정 항목을 서버에서도 검증합니다. 결과는 `source:student-web`으로 저장되고 기존 해당 학습지 학습 세션은 초기화됩니다. 교사 상태 버전을 올려 오래된 교사 저장으로 덮어쓰지 못하게 합니다.
- OCR answers 맵의 T/F 값은 `{judgment,wrongPart,correction}` 객체 또는 `판단: F\n틀린 부분: ...\n고친 문장: ...` 문자열을 사용할 수 있습니다. 교사 `/api/grade` 요청은 해당 항목을 tfAnswer에도 포함합니다.
- 웹 직접 제출의 로컬 채점은 T/F 판단 후 F의 두 수정 항목을 비교합니다. 정확한 일치 외에는 교사 검토(null)로 두며 의미 채점을 했다고 표시하지 않습니다.
