"use client";
import { useRef, useState } from "react";
import { cloudSaveEndpoint, downloadCloudSave, uploadCloudSave, type CloudSaveError } from "./cloud-save";
import "./cloud-save.css";

const errorText: Record<CloudSaveError, string> = {
  NOT_CONFIGURED: "아직 이 기능을 사용할 수 없어요.",
  TOO_LARGE: "저장할 내용이 너무 커요. 파일 저장을 이용하세요.",
  INVALID_CODE: "코드 형식이 맞지 않아요. 예: AB12C-DE34F",
  NOT_FOUND: "그 코드의 저장본이 없거나 기간(30일)이 지났어요.",
  RATE_LIMITED: "요청이 많아 잠시 막혔어요. 조금 뒤에 다시 시도하세요.",
  NETWORK: "서버에 연결하지 못했어요. 지금 작업은 그대로예요.",
  SERVER: "서버 응답을 확인하지 못했어요. 지금 작업은 그대로예요.",
};

type Status = { tone: "info" | "error"; text: string } | null;

/**
 * "다른 기기에서 이어하기": upload the current scenario (same JSON as the file save) and get a code,
 * or enter a code to load one. Renders nothing unless a cloud endpoint is configured at build time.
 * Loading goes through the caller's onLoad, which validates with the existing scenario codec.
 */
export function CloudSavePanel({ getScenario, onLoad, disabled, endpoint = cloudSaveEndpoint() }: {
  getScenario: () => string | null;
  onLoad: (text: string) => Promise<boolean>;
  disabled: boolean;
  endpoint?: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Status>(null);
  const token = useRef(0);
  if (!endpoint) return null;

  async function save() {
    const text = getScenario();
    if (!text || busy) return;
    const mine = ++token.current;
    setBusy(true); setStatus({ tone: "info", text: "저장하는 중…" });
    const result = await uploadCloudSave(text, endpoint);
    if (mine !== token.current) return;
    setBusy(false);
    if (result.ok) { setCode({ code: result.code, expiresAt: result.expiresAt }); setStatus(null); }
    else setStatus({ tone: "error", text: errorText[result.error] });
  }
  async function load() {
    if (busy || disabled) return;
    const mine = ++token.current;
    setBusy(true); setStatus({ tone: "info", text: "불러오는 중…" });
    const result = await downloadCloudSave(input, endpoint);
    if (mine !== token.current) return;
    if (!result.ok) { setBusy(false); setStatus({ tone: "error", text: errorText[result.error] }); return; }
    const ok = await onLoad(result.text);
    setBusy(false);
    setStatus(ok ? { tone: "info", text: "불러왔어요." } : { tone: "error", text: "저장본 형식을 확인하지 못해 불러오지 않았어요. 지금 작업은 그대로예요." });
  }
  const expires = code ? new Date(code.expiresAt).toLocaleDateString("ko-KR") : "";
  return <section className="cloud-save" aria-labelledby="cloud-save-title">
    <h3 id="cloud-save-title">다른 기기에서 이어하기</h3>
    <p>지금 밴픽을 서버에 저장하고 코드를 받아요. 다른 기기에서 코드를 넣으면 이어서 할 수 있어요. 코드를 아는 사람은 누구나 열 수 있으니 공개된 곳에 올리지 마세요.</p>
    <button type="button" onClick={() => void save()} disabled={busy || disabled}>코드 만들기</button>
    {code && <p className="cloud-save-code" role="status">코드 <strong>{code.code}</strong> · {expires}까지 보관</p>}
    <form onSubmit={(event) => { event.preventDefault(); void load(); }}>
      <label htmlFor="cloud-save-input">코드로 불러오기</label>
      <input id="cloud-save-input" value={input} onChange={(event) => setInput(event.target.value)} placeholder="AB12C-DE34F" autoComplete="off" spellCheck={false} maxLength={16} />
      <button type="submit" disabled={busy || disabled || !input.trim()}>불러오기</button>
    </form>
    <p role={status?.tone === "error" ? "alert" : "status"}>{status?.text ?? ""}</p>
  </section>;
}
