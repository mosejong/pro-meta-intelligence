"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { migrateClubSeasonSlots, savedSeasonCatalogId } from "./club-season-compat";
import { CLUB_STORAGE_KEY, MAX_CLUBS, applyGuestClub, deleteGuestClub, parseClubLibrary, saveGuestClub, withClubWriteLock, type GuestClub } from "./guest-club";
import { ROSTER_ROLES, basisKey, playerKey, type RosterBasis, type RosterIndex, type RosterState } from "./roster-scenario";
import { loadPreservedSeasonCatalogById } from "./season-catalog-loader";
import { emptySeasonSlots, resolveSeasonRef, type SeasonSlots, type SeasonCardCatalog, type TeamSeasonSlots } from "./season-player-cards";
import "./guest-club.css";

const isAbortError = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

export function GuestClubPanel({ basis, index, rosters, blueTeamId, redTeamId, disabled, onApply, seasonLineups, seasonCatalog, onSeasonApply, publicationRoot = "./" }: {
  basis: RosterBasis; index: RosterIndex; rosters: RosterState; blueTeamId: string; redTeamId: string; disabled: boolean; onApply: (next: RosterState) => void;
  seasonLineups: TeamSeasonSlots; seasonCatalog: SeasonCardCatalog | null; onSeasonApply: (teamId: string, slots: SeasonSlots) => void; publicationRoot?: string;
}) {
  // In-flight preserved-catalog read for a load confirmation; aborted whenever its inputs go stale.
  const job = useRef<{ controller: AbortController | null }>({ controller: null });
  const [clubs, setClubs] = useState<GuestClub[]>([]);
  const [name, setName] = useState("");
  const [head, setHead] = useState("");
  const [assistant, setAssistant] = useState("");
  const [side, setSide] = useState("BLUE");
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("");
  const [failure, setFailure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [pending, setPending] = useState<{ kind: "LOAD" | "DELETE"; club: GuestClub } | null>(null);
  useEffect(() => {
    const read = () => {
      try { setClubs(parseClubLibrary(window.localStorage.getItem(CLUB_STORAGE_KEY)).clubs); setReady(true); setStatus(""); setFailure(false); }
      catch (e) { setReady(false); setStatus(e instanceof Error ? e.message : "이 기기 저장소를 사용할 수 없습니다."); setFailure(true); }
    };
    const timer = window.setTimeout(read, 0);
    const box = job.current;
    const changed = (event: StorageEvent) => { if (event.key === CLUB_STORAGE_KEY || event.key === null) { box.controller?.abort(); setPending(null); read(); } };
    window.addEventListener("storage", changed);
    return () => { window.clearTimeout(timer); window.removeEventListener("storage", changed); };
  }, []);
  const teamId = side === "BLUE" ? blueTeamId : redTeamId;
  const basisToken = basisKey(basis);
  // Team, side, basis, rosters, season lineups/catalog, room start (disabled) or unmount: a late
  // preserved-catalog result must never apply, so the in-flight read is aborted.
  useLayoutEffect(() => {
    const box = job.current;
    return () => { box.controller?.abort(); };
  }, [teamId, side, basisToken, rosters, seasonLineups, seasonCatalog, disabled, publicationRoot, index]);
  function cancelPending() { job.current.controller?.abort(); setPending(null); }
  function error(e: unknown) { setFailure(true); setStatus(e instanceof Error ? e.message : "저장소를 사용할 수 없습니다. 기존 구단과 로스터를 유지합니다."); }
  async function save() {
    if (!ready || disabled || busy) return;
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const club: GuestClub = { id: crypto.randomUUID(), revision: 1, name: name.trim(), headCoach: head.trim(), assistantCoach: assistant.trim(), baseTeamId: teamId, basis: structuredClone(basis), slots: structuredClone(rosters[teamId]), seasonSlots: structuredClone(seasonLineups[teamId] ?? emptySeasonSlots()), createdAt: now, updatedAt: now };
      const check = applyGuestClub(club, teamId, rosters, basis, index, seasonCatalog, seasonLineups);
      if (!check[teamId]) throw new Error("선수 구성을 확인해 주세요.");
      const next = await withClubWriteLock(() => saveGuestClub(window.localStorage, club));
      setClubs(next.clubs); setFailure(false); setStatus("이 기기에 구단을 저장했습니다.");
    } catch (e) { error(e); } finally { setBusy(false); }
  }
  async function confirm() {
    if (!pending || disabled || !ready || busy) return;
    setBusy(true);
    let controller: AbortController | null = null;
    const storedUnchanged = () => {
      const club = parseClubLibrary(window.localStorage.getItem(CLUB_STORAGE_KEY)).clubs.find(c => c.id === pending.club.id);
      if (!club || JSON.stringify(club) !== JSON.stringify(pending.club)) throw new Error("저장된 구단이 바뀌었습니다. 목록을 다시 확인해 주세요.");
      return club;
    };
    try {
      const club = storedUnchanged();
      if (pending.kind === "DELETE") {
        const next = await withClubWriteLock(() => {
          const fresh = parseClubLibrary(window.localStorage.getItem(CLUB_STORAGE_KEY)).clubs.find(c => c.id === club.id);
          if (!fresh || JSON.stringify(fresh) !== JSON.stringify(club)) throw new Error("구단 정보가 바뀌어 삭제하지 않았습니다.");
          return deleteGuestClub(window.localStorage, club.id);
        });
        setClubs(next.clubs); setStatus("저장된 구단을 삭제했습니다. 현재 로스터는 유지합니다.");
      } else {
        // Runtime-only copy: the stored club (id, revision, createdAt, refs) is never rewritten.
        let runtime = club;
        const savedId = savedSeasonCatalogId(club);
        if (seasonCatalog && savedId && savedId !== seasonCatalog.catalog_id) {
          controller = new AbortController();
          job.current.controller = controller;
          setLoadingSaved(true);
          setStatus("저장 당시 시즌 선수 자료를 확인하는 중입니다. 취소할 수 있습니다."); setFailure(false);
          const saved = await loadPreservedSeasonCatalogById(publicationRoot, savedId, controller.signal);
          if (controller.signal.aborted) throw new DOMException("aborted", "AbortError");
          storedUnchanged();
          runtime = migrateClubSeasonSlots(club, saved, seasonCatalog);
        }
        // Validate everything first, then apply both roster and season slots in one go.
        const next = applyGuestClub(runtime, teamId, rosters, basis, index, seasonCatalog, seasonLineups);
        const slots = structuredClone(runtime.seasonSlots ?? emptySeasonSlots());
        if (controller?.signal.aborted) throw new DOMException("aborted", "AbortError");
        if (job.current.controller === controller) job.current.controller = null;
        onApply(next); onSeasonApply(teamId, slots); setName(club.name); setHead(club.headCoach); setAssistant(club.assistantCoach);
        setStatus(`${club.name} 구단을 ${side === "BLUE" ? "블루" : "레드"} 로스터로 불러왔습니다. 밴픽은 유지합니다.${runtime !== club ? " 저장 당시와 내용이 완전히 같은 시즌 카드만 현재 자료 버전으로 맞춰 적용했고, 저장된 구단은 바꾸지 않았습니다." : ""}`);
      }
      setFailure(false); setPending(null);
    } catch (e) {
      setPending(null);
      if (isAbortError(e) || controller?.signal.aborted) { setFailure(false); setStatus("구단 불러오기를 취소했습니다. 기존 로스터를 유지합니다."); }
      else error(e);
    } finally {
      if (controller && job.current.controller === controller) job.current.controller = null;
      setLoadingSaved(false); setBusy(false);
    }
  }
  return <section className="guest-club" lang="ko" aria-label="내 구단">
    <header><h3>내 구단</h3><small>{clubs.length} / {MAX_CLUBS}</small></header>
    <p>선수를 바꿔 나만의 구단을 저장해 보세요. 로그인 없이 이 브라우저에 보관하며, 기기를 바꾸거나 사이트 데이터를 지우면 없어집니다.</p>
    <div className="guest-club-fields">
      <label>구단 이름<input value={name} maxLength={40} onChange={e => setName(e.target.value)} disabled={disabled} placeholder="우리 동네 드림팀" /></label>
      <label>저장할 진영<select aria-label="저장할 진영" value={side} onChange={e => { setSide(e.target.value); setPending(null); }} disabled={disabled || busy}><option value="BLUE">블루</option><option value="RED">레드</option></select></label>
    </div>
    <details><summary>감독·코치 이름 넣기</summary><p>직접 적는 가상 구성입니다. 공식 소속이나 능력치를 뜻하지 않습니다.</p><div className="guest-club-fields">
      <label>감독 이름<input value={head} maxLength={60} onChange={e => setHead(e.target.value)} disabled={disabled} /></label>
      <label>코치 이름<input value={assistant} maxLength={60} onChange={e => setAssistant(e.target.value)} disabled={disabled} /></label>
    </div></details>
    <button type="button" disabled={disabled || busy || !ready || !name.trim() || clubs.length >= MAX_CLUBS} onClick={() => void save()}>새 구단으로 저장</button>
    {ready && !clubs.length && <p>저장한 구단이 없습니다. 아래에서 선수를 구성한 뒤 저장하세요.</p>}
    <div className="guest-club-list">{clubs.map(club => <article key={club.id}>
      <div><strong>{club.name}</strong><small>{club.headCoach && `감독 ${club.headCoach} `}{club.assistantCoach && `코치 ${club.assistantCoach} `} · 패치 {club.basis.patch_id}</small></div>
      <button type="button" disabled={disabled || busy || !ready} onClick={() => setPending({ kind: "LOAD", club })}>불러오기</button>
      <button type="button" disabled={disabled || busy || !ready} onClick={() => setPending({ kind: "DELETE", club })}>삭제</button>
    </article>)}</div>
    {pending && <div className="guest-club-confirm" role="group" aria-label={pending.kind === "LOAD" ? "구단 불러오기 확인" : "구단 삭제 확인"}>
      <p>{pending.kind === "LOAD" ? `${pending.club.name}의 선수 구성을 ${side === "BLUE" ? "블루" : "레드"}에 적용할까요? 빈 자리도 그대로 적용하며, 상대 선수와 중복되면 불러오지 않습니다.` : `${pending.club.name} 구단을 이 기기에서 삭제할까요? 현재 로스터는 유지합니다.`}</p>
      {pending.kind === "LOAD" && <ul>{ROSTER_ROLES.map(role => {
        const p = pending.club.slots[role];
        const ref = pending.club.seasonSlots?.[role]; let seasonName = "시즌 선수 (자료를 먼저 불러와 주세요)";
        try { if (ref) { const c = resolveSeasonRef(ref, role, seasonCatalog); seasonName = `${c.season} ${c.player_name} · ${c.game_count}경기`; } } catch { /* Confirmation remains explicit; apply refuses unavailable references. */ }
        return <li key={role}>{role} · {ref ? seasonName : p ? index.players.get(playerKey(p.source_team_id, p.player_id))?.player_name ?? "현재 자료에 없는 선수" : "빈 자리"}</li>;
      })}</ul>}
      <button type="button" disabled={busy && !loadingSaved} onClick={cancelPending}>취소</button><button type="button" disabled={disabled || busy || !ready} onClick={() => void confirm()}>{pending.kind === "LOAD" ? "불러오기 확정" : "삭제 확정"}</button>
    </div>}
    {status && <p role={failure ? "alert" : "status"}>{status}</p>}
  </section>;
}
