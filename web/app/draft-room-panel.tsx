"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { DraftRoomClient, createRoomUrl, parseRoomLink, type RoomLink, type RoomState } from "./draft-room-client";
import { createDraftShareUrl } from "./draft-share";
import type { DraftSession } from "./draft-session";
import type { RadarReport } from "./radar-types";
import "./draft-room-panel.css";

export type RoomControls = RoomState & { action: (kind: "SELECT" | "NEXT_GAME" | "RESET", championId?: string) => void };
export function DraftRoomPanel({ outgoing, liveReport, ready, onSnapshot, onRoomChange }: {
  outgoing: DraftSession; liveReport: RadarReport; ready: boolean;
  onSnapshot: (session: DraftSession, reset: boolean) => void; onRoomChange: (state: RoomControls) => void;
}) {
  const endpoint = (import.meta as ImportMeta & { env?: { VITE_DRAFT_ROOM_ENDPOINT?: string } }).env?.VITE_DRAFT_ROOM_ENDPOINT?.trim() ?? "";
  const latest = useRef({ liveReport, onSnapshot, onRoomChange });
  useLayoutEffect(() => { latest.current = { liveReport, onSnapshot, onRoomChange }; }, [liveReport, onSnapshot, onRoomChange]);
  const copyEpoch = useRef(0);
  const feedbackRoom = useRef<string | undefined>(undefined);
  const client = useRef<DraftRoomClient | null>(null);
  const [state, setState] = useState<RoomState>({ active: false, connected: false, sending: false });
  const [link, setLink] = useState<RoomLink | null>(null);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<"CREATE" | "RESET" | null>(null);
  const [fallback, setFallback] = useState("");
  const [copied, setCopied] = useState(false);
  const [resume, setResume] = useState(false);
  useEffect(() => {
    if (!endpoint) return;
    let mounted = true;
    const room = new DraftRoomClient(endpoint, () => latest.current.liveReport, next => {
      if (!mounted) return;
      const nextId = next.active ? next.snapshot?.id : undefined;
      if (feedbackRoom.current !== nextId || !next.active) {
        copyEpoch.current++; feedbackRoom.current = nextId; setCopied(false); setFallback("");
      }
      setState(next);
      if (next.role === "BLUE" && next.snapshot && next.invite) {
        const resumeLink: RoomLink = { v: 1, id: next.snapshot.id };
        window.history.replaceState(null, "", createRoomUrl(window.location.href, resumeLink.id));
        setLink(resumeLink); setResume(true);
      }
      latest.current.onRoomChange({ ...next, action: (kind, championId) => { void room.action(kind, championId); } });
    }, (session, reset) => latest.current.onSnapshot(session, reset));
    client.current = room;
    const read = () => {
      try { const next = parseRoomLink(window.location.href); setLink(next); setResume(!!next && room.credentialFor(next.id)); setError(""); }
      catch { setLink(null); setError("초대 링크를 확인해 주세요."); }
    };
    const reconnect = () => room.reconnect();
    read(); window.addEventListener("hashchange", read);
    window.addEventListener("offline", reconnect); window.addEventListener("online", reconnect);
    return () => { mounted = false; room.leave(); client.current = null; window.removeEventListener("hashchange", read); window.removeEventListener("offline", reconnect); window.removeEventListener("online", reconnect); };
  }, [endpoint]);
  async function copy(kind: "invite" | "view") {
    const key = state[kind]; if (!key || !state.snapshot) return;
    const source = client.current;
    const epoch = ++copyEpoch.current;
    setCopied(false); setFallback("");
    const url = createRoomUrl(window.location.href, state.snapshot.id, kind, key);
    try { await navigator.clipboard.writeText(url); if (source === client.current && epoch === copyEpoch.current) { setCopied(true); setFallback(""); } }
    catch { if (source === client.current && epoch === copyEpoch.current) setFallback(url); }
  }
  function create() {
    if (!ready || state.active) return;
    try { const share = new URL(createDraftShareUrl(window.location.href, outgoing)).hash; setConfirm(null); void client.current?.enter({ share }); }
    catch { setError("현재 밴픽을 확인한 뒤 다시 만들어 주세요."); }
  }
  return <details lang="ko" className="draft-room" open={state.active || !!link || undefined}>
    <summary>친구와 밴픽</summary>
    {!endpoint ? <p>실시간 대전 준비 중 · 지금은 링크 공유 이용</p> : <>
      {!state.active ? <>
        <p>블루·레드가 자기 차례를 진행합니다. 참가하면 현재 밴픽을 방의 밴픽으로 바꿉니다. 분석은 현재 공개 자료를 사용합니다.</p>
        {link ? resume ? <button type="button" disabled={!ready} onClick={() => void client.current?.enter(link)}>이 방에 다시 참여</button> : <>
          {link.invite && <button type="button" disabled={!ready} onClick={() => void client.current?.enter(link)}>레드로 참가</button>}
          {link.view && <button type="button" disabled={!ready} onClick={() => void client.current?.enter(link)}>관전하기</button>}
          {!link.invite && !link.view && <p>이 기기에 참여 정보가 없습니다. 초대 링크를 받아 주세요.</p>}
        </> : <button type="button" disabled={!ready} onClick={() => setConfirm("CREATE")}>현재 밴픽으로 방 만들기</button>}
      </> : <>
        <p role="status">{state.role === "BLUE" ? "블루 · 방장" : state.role === "RED" ? "레드" : state.role === "SPECTATOR" ? "관전 중" : "참여 확인 중"} · {state.ended ? "방 이용이 끝났습니다." : state.connected ? state.snapshot?.status === "WAITING" ? "레드 참가를 기다리고 있습니다." : state.snapshot?.status === "COMPLETE" ? "이번 세트 완료" : "밴픽 진행 중" : "연결 확인 중"}</p>
        {state.warning && <p role="status">새로고침하면 방 참여 정보 없어짐</p>}
        {state.invite && <button type="button" disabled={state.ended} onClick={() => void copy("invite")}>레드 초대 링크 복사</button>}
        {state.view && <button type="button" disabled={state.ended} onClick={() => void copy("view")}>관전 링크 복사</button>}
        {state.role === "BLUE" && <>
          <button type="button" disabled={!state.connected || state.sending || state.snapshot?.status !== "COMPLETE"} onClick={() => void client.current?.action("NEXT_GAME")}>방 다음 세트</button>
          <button type="button" disabled={!state.connected || state.sending} onClick={() => setConfirm("RESET")}>방 밴픽 초기화</button>
        </>}
        <button type="button" onClick={() => { client.current?.leave(); setConfirm(null); setFallback(""); setCopied(false); setResume(!!link && !!client.current?.credentialFor(link.id)); }}>혼자 연습으로 돌아가기</button>
        <p>돌아가면 마지막 방 밴픽을 개인 연습으로 이어갑니다.</p>
      </>}
      {state.message && <p role="status">{state.message}</p>}
      {error && <p role="alert">{error}</p>}
      {copied && <p role="status">초대 링크를 복사했습니다.</p>}
      {fallback && <label>아래 링크를 복사해 주세요.<input readOnly aria-label="복사할 방 링크" value={fallback} onFocus={e => e.currentTarget.select()} /></label>}
      {confirm && <div className="draft-room-confirm" role="group" aria-label={confirm === "CREATE" ? "방 만들기 확인" : "방 초기화 확인"}>
        <p>{confirm === "CREATE" ? "현재 팀·확정 밴픽으로 방을 만듭니다. 현재 보드는 검증된 방 밴픽으로 바뀌고 올려놓은 챔피언은 제외됩니다. 계속할까요?" : "모든 참가자의 밴픽과 이전 세트를 초기화할까요?"}</p>
        <button type="button" onClick={() => setConfirm(null)}>취소</button>
        <button type="button" disabled={!ready || (confirm === "RESET" && (!state.connected || state.sending))} onClick={() => { if (confirm === "CREATE") create(); else { void client.current?.action("RESET"); setConfirm(null); } }}>{confirm === "CREATE" ? "동의하고 방 만들기" : "방 초기화 확인"}</button>
      </div>}
    </>}
  </details>;
}
