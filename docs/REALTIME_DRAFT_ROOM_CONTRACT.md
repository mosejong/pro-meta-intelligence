# 실시간 밴픽방 v1 구현 계약

2026-11-18 사용자: 최종 구단주 서비스까지 완성도 향상. 현재 배치는 실제 두 브라우저의 실시간 밴픽방이다. 계정/외부 서버/구매/배포 활성화 없음.

## 구성

- 브라우저는 기존5개탭/개인 연습을 유지. 추가 '친구와 밴픽'에서 현재 팀·밴픽으로 방 만들기, 레드 초대 링크/관전 링크 복사, 명시적 참여·나가기.
- 부모 구현 서버는 신뢰한 로컬 current.json + pinned 챔피언 목록/기존 드래프트 규칙을 사용. 클라이언트 보고서나 턴을 신뢰하지 않음.
- URL에는 서버 주소가 없고 #room=base64url({v:1,id,invite?,view?})만 허용. invite는 레드1자리 참여, view는 읽기 전용. 블루 소유 토큰은 링크에 포함하지 않음.
- 역할 BLUE/RED/SPECTATOR. 확인 전 개인 밴픽을 교체하지 않음. 방의 확정 밴픽만 동기화하며 로스터/역할/개인 연습/분석 보고서는 공유 안 됨.
- 환경변수 VITE_DRAFT_ROOM_ENDPOINT 빌드값으로 서버를 설정. 빈 값이면 로그인/서버 설정을 노출하지 않고 '실시간 대전 준비 중 · 지금은 링크 공유 이용'을 표시. 로컬 실제 검사는127.0.0.1 별도포트.

## HTTP

- POST /v1/rooms body {share: '#draft=...'} (기존 createDraftShareUrl의 fragment, 서버가 자기 공개 report로 검증). 응답 {id,role:'BLUE',token,snapshot,invite,view}. token은 이 기기 sessionStorage만, 전체 state/URL/export에 넣지 않음.
- POST /v1/rooms/:id/join body {invite} 또는 {view}. 응답 {id,role,token,snapshot}; 관전 token=view. 레드자리는 처음참가1명만, 재접속은 sessionStorage기존 token 사용.
- GET /v1/rooms/:id Authorization: Bearer token → {id,role,snapshot}. 인증된 BLUE에게만 snapshot 밖에 invite/view를 추가해 새로고침 후 초대 링크를 복구한다. token은 URLquery로 보내지 않음.
- GET /v1/rooms/:id/events 동일Authorization → application/x-ndjson, 한 줄 JSON {snapshot}; 빈줄은keepalive. 처음에도snapshot전송, fetchreader로 구독. 연결실패시입력잠금/재접속, revision역행/다른방 응답무시.
- POST /v1/rooms/:id/actions Authorization body {id:UUID,revision:number,kind:'SELECT',championId} 또는 {id,revision,kind:'NEXT_GAME'|'RESET'}.
- SELECT 자기 차례만 가능, 관전자거부, stale revision409, 중복 actionid 동일payload 멱등 응답/다른payload거부. NEXT_GAME/RESET은방장BLUE만, 전자는현재20턴완료필수. 중간되돌리기는v1없음.
- 오류 JSON {error:{code,message},snapshot?}. 404방없음/410만료/401토큰/403권한/409경합/413크기/429제한.

## Snapshot

{id,revision,patch_id,cutoff,model_version,blueTeamId,redTeamId,firstPickSide,selections:DraftSelection[],games:DraftGame[],seats:{BLUE:true,RED:boolean},status:'WAITING'|'DRAFTING'|'COMPLETE',expiresAt:string}

서버 브로드캐스트 state에 초대키/토큰 없음. status WAITING은레드미참여, DRAFTING은참여후현재20턴미완료, COMPLETE는20턴완료. seats는자리가등록됐다는뜻, 온라인상태로표현하지않음.

## 범위

의존성 추가 없이 NodeHTTP+fetch streaming, SSR용 Vite bundle standalone서버. 기본127.0.0.1, 제한된명시CORS목록, body크기/방수/TTL/연결수 제한. 임시메모리방이며서버재시작시끝난다. 운영용영속화·남용대응·다중서버·OAuth는다음관문.

검사: 실제로 분리된브라우저2개+관전자, 상대차례불가/레드자리중복불가/관전자조작거부/동시요청버전경합/재접속/잘못된키/만료/개인연습보존. 단순 BroadcastChannel을 인터넷 공유방이라고 부르지 않음.
