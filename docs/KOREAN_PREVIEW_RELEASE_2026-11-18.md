# 한국어 지인 테스트판 통합 기록

2026-11-18. [메인 문서](PROJECT_MASTER_PLAN.md) · [테스트 계획](KOREAN_PREVIEW_TEST_PLAN.md)

## 통합 범위

로컬 작업실 5개 탭, 개인 로스터·역할·관측 근거/A·B 입력, 팀·밴픽 링크 공유, 게스트 구단 저장, 2022/2026 시즌 카드와 저장 참조를 최신 원격 main의 공개 자료와 통합했다. 사용자 요청한 메인 문서·개발일지도 저장소에 포함했다.

공개 정적 배포에는 방 endpoint를 설정하지 않는다. 실제 운영용 방·OAuth·기기 간 구단 저장·시즌 선수의 모델 효과·실제 경기 승률은 제공하지 않는다. 밴픽 작업실에 한국어 테스트판 범위와 기존 Riot 비제휴 고지를 표시했다. 친구에게 보내는 현재 링크는 팀·밴픽만 포함한다.

## 검증과 발견한 문제

- 최신 원격 통합 전: 웹219/219, 관련 Python33/33, Pages4/4, 구단·시즌 PC/모바일14/14.
- 최신 자료 통합 후: 웹220/220, Python전체385/385, Pages4/4, 타입/린트, Python Ruff/포맷 통과. PC/모바일 시즌·링크 공유14/14.
- Python 첫 전체 실행은 긴 임시 경로 때문에12건 실패했다. 보관소 안전장치를 바꾸지 않고 짧은 Windows 임시 경로로 재검사해385개를 통과했다. 처음 실패 로그도 보존한다.
- 웹 첫 통합 검사에서6건은 항상 추천 후보가 있다는 오래된 검사 가정 때문에 실패했다. 양성 경로에는 기존 공개 집계의 고정 fixture를 사용하고, 최신 출처 정합성과 후보 없는 상태의 비추천 동작을 별도로 검증한다. 다음 갱신에서 후보가 생겨도 음성 경로는 계속 검사한다. 제품에 가짜 추천을 채우거나 검사를 건너뛰지 않았다.
- 마지막 비제휴/한국어 이름 표시 변경 후 타입·린트, 렌더링43/43, Pages4/4, PC/모바일 시즌 저장·복원 핵심2/2를 추가 확인했다. 전체220개 결과가 실행된 시점과 구분한다.

로그는 `outputs/korean-preview-*20261118.log`에 보존한다. 고정 집계 fixture는 테스트 전용이며 정적 공개 자산 목록에 넣지 않았다. 원시 CSV·개인 자료·키는 공개 대상이 아니다.

## 배포 상태

후속 확인 완료: [PR #122](https://github.com/mosejong/pro-meta-intelligence/pull/122)의 Python·웹 CI가 통과했고 `a04f13a6120c2ef7f6d7a550dc6a2cd73cc09470`으로 main에 머지했다. [Pages 실행 44233536613](https://github.com/mosejong/pro-meta-intelligence/actions/runs/44233536613)이 success로 끝났다.

공개 주소: https://mosejong.github.io/pro-meta-intelligence/

실제 HTTPS 주소에서 독립 Chrome PC(1440px)·모바일 폭/터치(390px) 컨텍스트를 열어 한국어 화면, 2022 Nuguri 57경기 선택, 구단 저장·새로고침 후 보관을 확인했다. 두 화면 모두 pageerror 0건이었다. 실제 휴대폰·중국 지역 검증은 아니다. 지인 연락은 보내지 않았다.

브라우저 로그: `outputs/korean-preview-public-verification-20261118.log`. 화면: `outputs/korean-public-{desktop,mobile}-20261118.png`, `outputs/korean-public-season-{desktop,mobile}-20261118.png`. 로컬 outputs이므로 GitHub에 이미지가 첨부됐다고 가정하지 않는다.
