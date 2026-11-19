# 실제 경기 자료의 최소 승패 기준선 — 오프라인 연구만

Claude Opus5.5 medium. UI가정엔진과분리해실제관측자료로무엇을입증해야할지확인할최소기준선도구를구현한다. 사용자실전예측/선수효과/밴픽인과효과/학습모델출시가아님. 기존로컬OE CSV와OracleElixirCSVAdapter(SourceRegistry.load_default()).import_file(...retrieved_at=명시/source_timezone=UTC)만사용. 추가네트워크/출처/API/키/공개UI/가중치튜닝없음.

소유 신규ops/benchmark_match_baselines.py, 신규tests/test_match_baselines.py, docs/MATCH_BASELINE_RESEARCH_2026-11-19.md. 다른파일/git/install/fulltest/browser/subagent금지. 아직실데이터CLI실행은부모Codex가실제해시/메타확인뒤수행. Claude는작은synthetic단위만시도,승인거부반복금지.

고정설정:2026 observed_at기준, 대상league LCK/LPL/LEC/LCS/LCP/WLDs/MSI/FST/EWC(설정명시), 평가시작2026-07-01T00:00Z. 그이전게임은워밍업. 시뮬레이션공개지연24h:타깃t의예측은observed_at+24h<=t인과거게임결과만반영. 실제available_at는수집시각이고이실험은실제당시가용성재현아님을보고서에분리명시. 동일시간게임의결과서로사용불가. 타깃winner는정답레이블로만,예측전에사용하지말것.

비교1)fixed0.5,2)현재까지공개된파랑승패에Laplace(blueWins+1)/(games+2),3)팀ID기준Elo(initial1500,K20,scale400)만. 이름은조인키금지. Elo는경기예측시점예상p를보존하고지연결과가공개될때K*(y-p)업데이트한다. 팀명단/선수/챔프/게임내stats/KDA/gold는사용하지않고에폭별재튜닝없음. 모든타깃평가+두팀이각5경기이상사전공개표본있는하위집단을별도표기(전체를대체하지않음). league별샘플/Brier/logloss/accuracy_with_half_credit_ties(확률.5는.5점)/tie_count. 유리한팀/기간만고르지말것. 확률유한/범위검증및logloss안전clamp작은epsilon.

공통입력은MatchRecord시퀀스, 순수함수로나눠정렬/입력불변. 같은ID 중복/충돌이있으면전체ID를거부하고집계사유에남겨샘플중복금지(정확중복은1개만가능,충돌은전부제외). winner가양팀밖/동일팀/무시간대/시점불일치는거부. CLI --input --retrieved-at --content-hash --output을필수로받고해시sha256먼저확인, 출력은outputs같은로컬연구경로사용하며web/public내출력은거부. source_hash/실제retrieved_at/고정설정/지연가정/평가범위/제외사유/각코호트샘플/NO_UI_EFFECT/NOT_CAUSAL_DRAFT_VALUE/NOT_A_RELEASED_PREDICTOR를보고서에담는다. 원본행/토큰/키출력없고집계만. 같은결과보고서덮어쓰기는안전하게명시? 기본기존output있으면거부하여비교보존.

합성단위:미래winner변경이이전예측불변/공개전결과누출없음/기준선정확계산/입력순서·이름변경불변/중복·충돌제외/기준기간분리. 테스트는새파일만. 결과문서는실데이터성능은미실행이라고명시하고이미모델입증된것처럼표시하지말것. 한도오류는실제오류/reset기록후종료과금모델우회없음.
