// Bounded UI-chrome dictionary for the private ko / zh-CN work.
// Stage B1: navigation, the main draft title and the studio tabs.
// Stage B2: the core draft flow (setup, series, timer/turn, picker, staging, reset dialog,
// team columns, session save/restore status, TeamChooser) and draft-session parse errors.
// The details-analysis tab and champion-info panel are NOT translated and stay lang="ko".
// Champion, item and rune names are NOT translated in this file: official Chinese
// names must come from an approved, versioned source, never from ad-hoc transliteration.
// Chinese copy is a draft for native review, not a verified release translation.

export const SUPPORTED_LOCALES = ["ko", "zh-CN"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ko";
export const LOCALE_STORAGE_KEY = "pmi:locale";

/** Endonyms: each language is always shown in its own script, regardless of the active locale. */
export const LOCALE_LABELS: Record<Locale, string> = {
  ko: "한국어",
  "zh-CN": "简体中文",
};

const ko = {
  "nav.label": "주요 메뉴",
  "nav.draft": "밴픽",
  "nav.team": "내 팀",
  "nav.t1": "T1",
  "nav.radar": "메타",
  "nav.more": "전체 메뉴",
  "nav.moreLabel": "전체 분석 메뉴",
  "space.DRAFT": "모의 밴픽",
  "space.TEAM": "팀 분석",
  "space.T1": "T1 브리프",
  "space.RADAR": "메타 레이더",
  "space.CREATOR": "크리에이터",
  "space.PROOF": "검증 상태",
  "draft.title": "모의 밴픽",
  "draft.tabsLabel": "작업실 보기",
  "draft.tab.DRAFT": "모의 밴픽",
  "draft.tab.DETAILS": "상세 분석",
  "locale.selectorLabel": "언어",
  "locale.partialNote": "중국어 간체 번역은 진행 중입니다. 밴픽 기본 흐름만 번역되었고 상세 분석, 챔피언 정보와 챔피언 이름은 한국어로 표시됩니다.",

  // Stage B2 · draft header and top bar
  "draft.brandLabel": "Pro Meta Intelligence 홈",
  "draft.pagesLabel": "분석 페이지",
  "draft.data.fixture": "고정 예제 데이터",
  "draft.data.locked": "고정된 분석 데이터",
  "draft.intro": "양 팀을 고르고 순서대로 밴·픽을 확정하세요. 한 화면에서 두 팀을 직접 조작합니다.",
  "draft.format": "표준 5밴 5픽 · 피어리스 · 이 기기에만 저장",

  // Setup and side / first pick
  "draft.setupLabel": "밴픽 팀 설정",
  "draft.swapLabel": "블루와 레드 팀 교체",
  "draft.swap": "진영 교체",
  "draft.setupHint": "팀은 빈 시리즈에서, 진영은 각 세트 시작 전에 변경할 수 있습니다.",
  "draft.side.BLUE": "블루",
  "draft.side.RED": "레드",
  "draft.firstPick": "선픽 진영",
  "draft.firstPick.BLUE": "블루 선픽",
  "draft.firstPick.RED": "레드 선픽",
  "draft.firstPickHint": "진영과 선픽은 별도 선택 · 각 세트 시작 전에 설정",

  // Series
  "draft.seriesLabel": "피어리스 시리즈",
  "draft.seriesTitle": "피어리스 · {game}세트",
  "draft.seriesLocks": "이전 세트 양 팀 픽 {count}개 자동 잠금 · 일반 밴은 세트마다 초기화",
  "draft.sessionSummary": "저장·불러오기 및 시리즈 관리",
  "draft.sessionInfo": "분석 데이터 {state} · 패치 {patch} · 기준 {cutoff} · {model}",
  "draft.sessionInfo.locked": "고정됨",
  "draft.sessionInfo.pending": "첫 선택 시 고정",
  "draft.import": "시나리오 불러오기",
  "draft.saveJson": "시리즈 JSON 저장",
  "draft.reopen": "이전 세트 수정",
  "draft.resetSeries": "시리즈 초기화",
  "draft.gameLocks": "{game}세트 픽 · 다음 세트 사용 불가",

  // Session save / restore statuses (stored in state as codes, rendered per locale)
  "draft.storage.CHECKING": "저장된 시리즈 확인 중…",
  "draft.storage.RESTORED": "저장된 시리즈를 복원했습니다. 타이머는 일시정지 상태입니다.",
  "draft.storage.RESTORE_FAILED": "기존 기록 복원 실패: {reason}",
  "draft.storage.IDLE": "선택하면 이 기기에 자동 저장됩니다.",
  "draft.storage.UNAVAILABLE": "기기 저장을 사용할 수 없습니다. JSON으로 저장하세요.",
  "draft.storage.SAVING": "기기에 저장 중…",
  "draft.storage.SAVED": "이 기기에 저장됨 · 새로고침 후 이어서 분석할 수 있습니다.",
  "draft.storage.SAVE_FAILED": "기기 저장에 실패했습니다. JSON으로 저장하세요.",
  "draft.import.PARSE_FAILED": "{reason} 현재 작업은 유지했습니다.",
  "draft.import.LOADED": "시리즈와 고정 데이터를 불러왔습니다. 확정 전 선택도 복원했습니다.",
  "draft.import.READ_FAILED": "파일을 읽을 수 없습니다. 현재 작업은 유지했습니다.",

  // Timer and turn
  "draft.stageLabel": "실시간 가상 밴픽",
  "draft.timerStart": "타이머 시작",
  "draft.timerPause": "일시정지",
  "draft.phase.BAN": "{phase}차 밴",
  "draft.phase.PICK": "{phase}차 픽",
  "draft.complete": "밴픽 완료",
  "draft.turnHeading": "{team} · {side} 차례",
  "draft.scenarioComplete": "시나리오 완성",
  "draft.turnHint.BAN": "{slot}번째 밴 · 챔피언을 올려놓은 뒤 확정하세요.",
  "draft.turnHint.PICK": "{slot}번째 픽 · 챔피언을 올려놓은 뒤 확정하세요.",
  "draft.turnDoneHint": "양 팀의 픽 10개가 다음 세트부터 자동으로 잠깁니다.",
  "draft.nextGame": "세트 저장하고 다음 세트",
  "draft.progressLabel": "밴픽 {count}/{total} 확정",

  // Picker, search, filters, empty states
  "draft.pickerLabel": "챔피언 선택판",
  "draft.search": "챔피언 검색",
  "draft.searchPlaceholder": "한글 또는 영문 이름",
  "draft.searchClear": "지우기",
  "draft.searchClearLabel": "챔피언 검색 지우기",
  "draft.availableOnly": "선택 가능한 챔피언만",
  "draft.championCount": "{count}개",
  "draft.lockReason.previous": "{name} · 이전 세트 픽",
  "draft.lockReason.taken": "{name} · 이미 선택됨",
  "draft.badge.fearless": "피어리스",
  "draft.empty.locked": "검색된 챔피언이 모두 잠겨 있습니다. 필터를 해제하면 잠금 사유를 볼 수 있습니다.",
  "draft.empty.none": "검색 결과가 없습니다. 한글 또는 영문 이름을 다시 확인하세요.",

  // Staging / confirm / undo
  "draft.stagedPending": "올려놓음 · 아직 확정 전",
  "draft.selectThenConfirm": "선택 → 확정",
  "draft.chooseChampion": "챔피언을 선택하세요",
  "draft.cancelStage": "선택 취소",
  "draft.confirm.BAN": "밴 확정",
  "draft.confirm.PICK": "픽 확정",
  "draft.undo": "한 수 되돌리기",
  "draft.resetGame": "현재 세트 초기화",
  "draft.scenarioJson": "시나리오 JSON",
  "draft.sequenceLabel": "전체 밴픽 순서",

  // Team columns
  "draft.column.label": "{side} 팀 밴픽",
  "draft.column.bans": "{side} 밴",
  "draft.column.noTeam": "팀 선택",
  "draft.column.sample": "{count}경기 공개 표본 · {leagues}",
  "draft.column.noEvidence": "근거 없음",
  "draft.column.banSlot": "{slot}번째 밴",
  "draft.column.stagedTitle": "{name} · 확정 전",
  "draft.column.staged": "올려놓음 · 확정 전",
  "draft.column.confirmed": "선택 확정 · TURN {turn}",
  "draft.column.waiting": "선택 대기",
  "draft.column.phase1Pick": "1차 픽",
  "draft.column.phase2Pick": "2차 픽",
  "draft.inspect.BAN": "{side} {slot}번째 밴 {name} 정보 보기",
  "draft.inspect.PICK": "{side} {slot}번째 픽 {name} 정보 보기",

  // Reset dialog
  "draft.reset.seriesTitle": "시리즈 전체를 초기화할까요?",
  "draft.reset.gameTitle": "현재 세트를 초기화할까요?",
  "draft.reset.seriesBody": "이전 세트와 현재 선택이 모두 삭제됩니다. 이 작업은 되돌릴 수 없습니다.",
  "draft.reset.gameBody": "현재 세트의 밴·픽과 올려놓은 선택이 삭제됩니다. 이전 세트는 유지됩니다. 이 작업은 되돌릴 수 없습니다.",
  "draft.reset.cancel": "계속 분석하기",
  "draft.reset.confirm": "초기화",

  // TeamChooser
  "team.pick": "팀 고르기",
  "team.hint": "리그별로 찾거나 이름 검색",
  "team.change": "변경 ›",
  "team.close": "닫기",
  "team.closeLabel": "{label} 닫기",
  "team.search": "팀 이름 검색",
  "team.searchPlaceholder": "팀명·별칭·리그 검색",
  "team.leagueFilter": "리그 필터",
  "team.allChip": "전체",
  "team.otherLeague": "다른 리그",
  "team.chooseLeague": "리그 선택",
  "team.allLeagues": "전체 리그",
  "team.count": "{league} · {count}개 팀",
  "team.countCurrent": "{league} · {count}개 팀 · 현재 {team}",
  "team.selected": " · 선택됨",
  "team.sample": "공개 표본 {count}경기",
  "team.empty": "이 조건에 맞는 팀이 없습니다.",
  "team.resetSearch": "전체 팀에서 다시 찾기",
  "team.more": "{count}개 더 보기",
  "team.clear": "내 팀 선택 해제",

  // draft-session parse errors (Korean must equal DRAFT_SESSION_ERROR_TEXT in draft-session.ts)
  "session.error.SIZE_LIMIT": "시나리오 파일은 16MB 이하여야 합니다.",
  "session.error.INVALID_JSON": "JSON 파일을 읽을 수 없습니다. 저장한 시나리오 파일을 선택하세요.",
  "session.error.UNSUPPORTED_FORMAT": "지원하는 피어리스 시나리오 파일이 아닙니다.",
  "session.error.INVALID_FIRST_PICK_SIDE": "선픽 진영이 올바르지 않습니다.",
  "session.error.MODEL_VERSION_MISMATCH": "분석 버전이 다릅니다. 같은 결과를 보장할 수 없어 불러오지 않았습니다.",
  "session.error.MISSING_ANALYSIS": "분석 데이터가 없거나 손상되었습니다.",
  "session.error.SNAPSHOT_MISMATCH": "패치 또는 기준 시점이 분석 데이터와 일치하지 않습니다.",
  "session.error.INVALID_SAMPLE": "분석 표본이나 순위 값이 올바르지 않습니다.",
  "session.error.MISSING_TEAMS": "두 팀 정보가 필요합니다.",
  "session.error.INVALID_TEAMS": "분석 데이터에 있는 서로 다른 두 팀을 선택해야 합니다.",
  "session.error.INVALID_PREVIOUS_GAMES": "이전 세트 기록이 올바르지 않습니다.",
  "session.error.PREVIOUS_MATCHUP_MISMATCH": "이전 세트의 대진이 현재 대진과 다릅니다.",
  "session.error.PREVIOUS_FIRST_PICK_SIDE": "이전 세트의 선픽 진영이 올바르지 않습니다.",
  "session.error.PREVIOUS_SELECTIONS": "이전 세트에 중복 선택 또는 잘못된 밴픽 순서가 있습니다.",
  "session.error.PREVIOUS_GAME_INCOMPLETE": "완료되지 않았거나 피어리스 규칙에 어긋난 이전 세트입니다.",
  "session.error.CURRENT_GAME": "현재 세트 기록 또는 세트 번호가 올바르지 않습니다.",
  "session.error.STAGED_CHAMPION": "올려놓은 챔피언이 이미 잠겼거나 선택할 수 없습니다.",
} as const;

type KoMessages = typeof ko;
/** Every dictionary key, plain or templated. */
export type AnyMessageKey = keyof KoMessages;

/** Extracts `{name}` placeholders from a literal template type. */
type ParamNames<S extends string> = S extends `${string}{${infer Name}}${infer Rest}` ? Name | ParamNames<Rest> : never;

/** Keys whose Korean source has at least one `{param}`: only usable through `format`. */
export type TemplateKey = { [K in AnyMessageKey]: [ParamNames<KoMessages[K]>] extends [never] ? never : K }[AnyMessageKey];
/** Keys without placeholders: usable through `t`. */
export type MessageKey = Exclude<AnyMessageKey, TemplateKey>;
/** Exactly the placeholders of the Korean source; missing or extra params are compile errors. */
export type MessageParams<K extends TemplateKey> = { [P in ParamNames<KoMessages[K]>]: string | number };
export type Messages = Record<AnyMessageKey, string>;

// Typed against the Korean source: a missing or extra key is a compile error.
// Placeholder parity with Korean is checked by tests/locale.test.mjs.
const zhCN: Messages = {
  "nav.label": "主要菜单",
  "nav.draft": "禁选",
  "nav.team": "我的战队",
  "nav.t1": "T1",
  "nav.radar": "版本趋势",
  "nav.more": "全部菜单",
  "nav.moreLabel": "全部分析菜单",
  "space.DRAFT": "模拟禁选",
  "space.TEAM": "战队分析",
  "space.T1": "T1 简报",
  "space.RADAR": "版本雷达",
  "space.CREATOR": "创作者",
  "space.PROOF": "验证状态",
  "draft.title": "模拟禁选",
  "draft.tabsLabel": "工作区视图",
  "draft.tab.DRAFT": "模拟禁选",
  "draft.tab.DETAILS": "详细分析",
  "locale.selectorLabel": "语言",
  "locale.partialNote": "简体中文翻译进行中。目前仅翻译了禁选基本流程，详细分析、英雄信息和英雄名称仍以韩语显示。",

  "draft.brandLabel": "Pro Meta Intelligence 首页",
  "draft.pagesLabel": "分析页面",
  "draft.data.fixture": "固定示例数据",
  "draft.data.locked": "已固定的分析数据",
  "draft.intro": "选择双方战队，并按顺序确认禁用与选用。在同一界面中直接操作两支战队。",
  "draft.format": "标准 5 禁 5 选 · Fearless · 仅保存在本设备",

  "draft.setupLabel": "禁选战队设置",
  "draft.swapLabel": "交换蓝色方与红色方战队",
  "draft.swap": "交换阵营",
  "draft.setupHint": "战队只能在空系列赛中更改，阵营可在每局开始前更改。",
  "draft.side.BLUE": "蓝色方",
  "draft.side.RED": "红色方",
  "draft.firstPick": "先选阵营",
  "draft.firstPick.BLUE": "蓝色方先选",
  "draft.firstPick.RED": "红色方先选",
  "draft.firstPickHint": "阵营与先选分别设置 · 每局开始前设定",

  "draft.seriesLabel": "Fearless 系列赛",
  "draft.seriesTitle": "Fearless · 第 {game} 局",
  "draft.seriesLocks": "前几局双方选用的 {count} 名英雄已自动锁定 · 普通禁用每局重置",
  "draft.sessionSummary": "保存·导入与系列赛管理",
  "draft.sessionInfo": "分析数据{state} · 版本 {patch} · 截止 {cutoff} · {model}",
  "draft.sessionInfo.locked": "已固定",
  "draft.sessionInfo.pending": "将在首次选择时固定",
  "draft.import": "导入方案",
  "draft.saveJson": "保存系列赛 JSON",
  "draft.reopen": "修改上一局",
  "draft.resetSeries": "重置系列赛",
  "draft.gameLocks": "第 {game} 局选用 · 后续对局不可用",

  "draft.storage.CHECKING": "正在检查已保存的系列赛…",
  "draft.storage.RESTORED": "已恢复保存的系列赛。计时器处于暂停状态。",
  "draft.storage.RESTORE_FAILED": "恢复已有记录失败：{reason}",
  "draft.storage.IDLE": "开始选择后将自动保存在本设备。",
  "draft.storage.UNAVAILABLE": "无法使用设备存储。请保存为 JSON。",
  "draft.storage.SAVING": "正在保存到本设备…",
  "draft.storage.SAVED": "已保存在本设备 · 刷新后可继续分析。",
  "draft.storage.SAVE_FAILED": "保存到设备失败。请保存为 JSON。",
  "draft.import.PARSE_FAILED": "{reason}已保留当前进度。",
  "draft.import.LOADED": "已导入系列赛与固定数据，并恢复了尚未确认的选择。",
  "draft.import.READ_FAILED": "无法读取文件。已保留当前进度。",

  "draft.stageLabel": "实时模拟禁选",
  "draft.timerStart": "开始计时",
  "draft.timerPause": "暂停",
  "draft.phase.BAN": "第 {phase} 阶段禁用",
  "draft.phase.PICK": "第 {phase} 阶段选用",
  "draft.complete": "禁选完成",
  "draft.turnHeading": "{team} · 轮到{side}",
  "draft.scenarioComplete": "方案已完成",
  "draft.turnHint.BAN": "第 {slot} 个禁用 · 请先预选英雄再确认。",
  "draft.turnHint.PICK": "第 {slot} 个选用 · 请先预选英雄再确认。",
  "draft.turnDoneHint": "双方的 10 个选用将从下一局起自动锁定。",
  "draft.nextGame": "保存本局并进入下一局",
  "draft.progressLabel": "已确认禁选 {count}/{total}",

  "draft.pickerLabel": "英雄选择面板",
  "draft.search": "搜索英雄",
  "draft.searchPlaceholder": "韩文或英文名称",
  "draft.searchClear": "清除",
  "draft.searchClearLabel": "清除英雄搜索",
  "draft.availableOnly": "仅显示可选英雄",
  "draft.championCount": "{count} 个",
  "draft.lockReason.previous": "{name} · 前几局已选用",
  "draft.lockReason.taken": "{name} · 已被选择",
  "draft.badge.fearless": "Fearless",
  "draft.empty.locked": "搜索到的英雄均已锁定。取消筛选即可查看锁定原因。",
  "draft.empty.none": "没有搜索结果。请检查韩文或英文名称。",

  "draft.stagedPending": "已预选 · 尚未确认",
  "draft.selectThenConfirm": "选择 → 确认",
  "draft.chooseChampion": "请选择英雄",
  "draft.cancelStage": "取消预选",
  "draft.confirm.BAN": "确认禁用",
  "draft.confirm.PICK": "确认选用",
  "draft.undo": "撤销一步",
  "draft.resetGame": "重置当前对局",
  "draft.scenarioJson": "方案 JSON",
  "draft.sequenceLabel": "完整禁选顺序",

  "draft.column.label": "{side} 战队禁选",
  "draft.column.bans": "{side} 禁用",
  "draft.column.noTeam": "选择战队",
  "draft.column.sample": "{count} 场公开样本 · {leagues}",
  "draft.column.noEvidence": "暂无依据",
  "draft.column.banSlot": "第 {slot} 个禁用",
  "draft.column.stagedTitle": "{name} · 未确认",
  "draft.column.staged": "已预选 · 未确认",
  "draft.column.confirmed": "已确认 · TURN {turn}",
  "draft.column.waiting": "等待选择",
  "draft.column.phase1Pick": "第一阶段选用",
  "draft.column.phase2Pick": "第二阶段选用",
  "draft.inspect.BAN": "查看{side}第 {slot} 个禁用 {name} 的信息",
  "draft.inspect.PICK": "查看{side}第 {slot} 个选用 {name} 的信息",

  "draft.reset.seriesTitle": "要重置整个系列赛吗？",
  "draft.reset.gameTitle": "要重置当前对局吗？",
  "draft.reset.seriesBody": "之前的对局与当前选择将全部删除。此操作无法撤销。",
  "draft.reset.gameBody": "当前对局的禁用、选用及预选将被删除，之前的对局会保留。此操作无法撤销。",
  "draft.reset.cancel": "继续分析",
  "draft.reset.confirm": "重置",

  "team.pick": "选择战队",
  "team.hint": "按赛区查找或搜索名称",
  "team.change": "更改 ›",
  "team.close": "关闭",
  "team.closeLabel": "关闭{label}",
  "team.search": "搜索战队名称",
  "team.searchPlaceholder": "搜索战队名·别名·赛区",
  "team.leagueFilter": "赛区筛选",
  "team.allChip": "全部",
  "team.otherLeague": "其他赛区",
  "team.chooseLeague": "选择赛区",
  "team.allLeagues": "全部赛区",
  "team.count": "{league} · {count} 支战队",
  "team.countCurrent": "{league} · {count} 支战队 · 当前 {team}",
  "team.selected": " · 已选择",
  "team.sample": "公开样本 {count} 场",
  "team.empty": "没有符合条件的战队。",
  "team.resetSearch": "在全部战队中重新查找",
  "team.more": "再显示 {count} 个",
  "team.clear": "取消选择我的战队",

  "session.error.SIZE_LIMIT": "方案文件不能超过 16MB。",
  "session.error.INVALID_JSON": "无法读取 JSON 文件。请选择已保存的方案文件。",
  "session.error.UNSUPPORTED_FORMAT": "不是受支持的 Fearless 方案文件。",
  "session.error.INVALID_FIRST_PICK_SIDE": "先选阵营无效。",
  "session.error.MODEL_VERSION_MISMATCH": "分析版本不同，无法保证相同结果，因此未导入。",
  "session.error.MISSING_ANALYSIS": "分析数据缺失或已损坏。",
  "session.error.SNAPSHOT_MISMATCH": "版本或截止时间与分析数据不一致。",
  "session.error.INVALID_SAMPLE": "分析样本或排名数值无效。",
  "session.error.MISSING_TEAMS": "需要双方战队信息。",
  "session.error.INVALID_TEAMS": "必须选择分析数据中存在的两支不同战队。",
  "session.error.INVALID_PREVIOUS_GAMES": "之前对局的记录无效。",
  "session.error.PREVIOUS_MATCHUP_MISMATCH": "之前对局的对阵与当前对阵不同。",
  "session.error.PREVIOUS_FIRST_PICK_SIDE": "之前对局的先选阵营无效。",
  "session.error.PREVIOUS_SELECTIONS": "之前对局存在重复选择或错误的禁选顺序。",
  "session.error.PREVIOUS_GAME_INCOMPLETE": "之前的对局未完成或违反 Fearless 规则。",
  "session.error.CURRENT_GAME": "当前对局记录或局数编号无效。",
  "session.error.STAGED_CHAMPION": "预选的英雄已被锁定或无法选择。",
};

export const MESSAGES: Record<Locale, Messages> = { ko, "zh-CN": zhCN };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

/** Placeholder names in a template, in order of appearance. */
export function placeholdersOf(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((match) => match[1]);
}

/**
 * Plain-text substitution. The result is a string rendered as a React text node, never as HTML,
 * so values such as team names are always escaped by React. A missing param keeps `{name}`
 * visible instead of silently disappearing.
 */
export function interpolate(template: string, params: Readonly<Record<string, string | number>>): string {
  return template.replace(PLACEHOLDER, (match, name: string) => Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match);
}

function lookup(locale: Locale, key: AnyMessageKey): string {
  return (isLocale(locale) ? MESSAGES[locale][key] : undefined) ?? MESSAGES[DEFAULT_LOCALE][key];
}

export function translateMessage(locale: Locale, key: MessageKey): string {
  return lookup(locale, key);
}

export function formatMessage<K extends TemplateKey>(locale: Locale, key: K, params: MessageParams<K>): string {
  return interpolate(lookup(locale, key), params);
}

/** Value written to `<html lang>`. */
export function htmlLangFor(locale: Locale): string {
  return locale;
}

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

/** Returns a saved, valid locale or null. Never throws (privacy modes may deny storage). */
export function readStoredLocale(storage: ReadableStorage | null | undefined): Locale | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

/** Persists the preference; returns false instead of throwing when storage is unavailable or full. */
export function writeStoredLocale(storage: WritableStorage | null | undefined, locale: Locale): boolean {
  if (!storage || !isLocale(locale)) return false;
  try {
    storage.setItem(LOCALE_STORAGE_KEY, locale);
    return true;
  } catch {
    return false;
  }
}
