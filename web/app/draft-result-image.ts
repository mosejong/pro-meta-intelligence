import { championAssetId } from "./champion-assets";
import type { DraftSelection } from "./draft-agent";
import type { DraftResultReport } from "./draft-result-report";
import { SHARE_CHAMPIONS } from "./share-champion-ids";

/** Text-only, client-side PNG summary of a READY draft result. No network, no images, no scores. */
export type DraftResultImageSide = { side: "BLUE" | "RED"; side_label: string; team_lines: string[]; picks: string[]; bans: string[] };
export type DraftResultImageModel = {
  title: string; notice: string; sides: DraftResultImageSide[];
  patch_line: string; cutoff_line: string; boundary_lines: string[];
};
export type DraftResultImageInput = {
  result: DraftResultReport; selections: DraftSelection[]; patchId: string; dataCutoff: string | null | undefined;
  nameOf: (id: string) => string;
};

export const IMAGE_WIDTH = 1080;
export const TEAM_LINE_CHARS = 16;
export const TEAM_MAX_LINES = 2;
const EMPTY_TEAM = "이름 없는 팀";
const UNKNOWN_CHAMPION = "알 수 없는 챔피언";
const catalog = new Map(SHARE_CHAMPIONS.map(([, id]) => [id.toLowerCase(), id]));
const canonical = (value: string) => catalog.get(championAssetId(value).toLowerCase()) ?? value;
// Control, whitespace, zero-width, line/paragraph separator and bidi code points collapse to a single space.
// Code-point comparison instead of a regex literal so no invisible characters live in the source.
const isInvisibleOrSpace = (cp: number) => cp <= 0x20 || (cp >= 0x7f && cp <= 0xa0) || cp === 0x1680 ||
  (cp >= 0x2000 && cp <= 0x200f) || (cp >= 0x2028 && cp <= 0x202f) || cp === 0x205f ||
  (cp >= 0x2060 && cp <= 0x2069) || cp === 0x3000 || cp === 0xfeff;
function clean(value: unknown): string {
  if (typeof value !== "string") return "";
  let out = "", pendingSpace = false;
  for (const ch of value) {
    if (isInvisibleOrSpace(ch.codePointAt(0) ?? 0)) { pendingSpace = out.length > 0; continue; }
    if (pendingSpace) { out += " "; pendingSpace = false; }
    out += ch;
  }
  return out;
}

/** Splits a team name into at most TEAM_MAX_LINES lines of TEAM_LINE_CHARS code points, adding an ellipsis if cut. */
export function wrapTeamName(name: unknown, lineChars = TEAM_LINE_CHARS, maxLines = TEAM_MAX_LINES): string[] {
  const chars = [...(clean(name) || EMPTY_TEAM)];
  const lines: string[] = [];
  for (let i = 0; i < chars.length && lines.length < maxLines; i += lineChars) lines.push(chars.slice(i, i + lineChars).join("").trim());
  if (chars.length > lineChars * maxLines) {
    const last = [...lines[maxLines - 1]];
    lines[maxLines - 1] = last.slice(0, Math.max(1, lineChars - 1)).join("").trimEnd() + "…";
  }
  return lines.filter(Boolean);
}

function cutoffDate(value: string | null | undefined): string {
  const text = clean(value);
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  return match ? match[1] : text ? text.slice(0, 32) : "미확인";
}

function champion(nameOf: (id: string) => string, id: string): string {
  let name = "";
  try { name = clean(nameOf(id)); } catch { name = ""; }
  return [...(name || clean(id) || UNKNOWN_CHAMPION)].slice(0, 24).join("");
}

/** Pure: builds a detached display model. Throws for non-READY results so nothing incomplete can be saved. */
export function buildDraftResultImageModel(input: DraftResultImageInput): DraftResultImageModel {
  const { result, selections, patchId, dataCutoff, nameOf } = input;
  if (!result || result.status !== "READY" || !Array.isArray(result.sides) || result.sides.length !== 2) throw new Error("NOT_READY");
  if (!Array.isArray(selections) || selections.length !== 20) throw new Error("NOT_READY");
  const sides = result.sides.map((team): DraftResultImageSide => {
    const bans = selections.filter((s) => s.side === team.side && s.kind === "BAN").map((s) => champion(nameOf, canonical(s.champion_id)));
    const picks = team.picks.map((p) => champion(nameOf, p.champion_id));
    if (picks.length !== 5 || bans.length !== 5) throw new Error("NOT_READY");
    return { side: team.side, side_label: team.side === "BLUE" ? "블루" : "레드", team_lines: wrapTeamName(team.team_name), picks, bans };
  });
  return {
    title: "밴픽 결과",
    notice: "연습 결과 · 승패 예측 아님",
    sides,
    patch_line: `패치 ${clean(patchId) || "미확인"}`,
    cutoff_line: `자료 기준일 ${cutoffDate(dataCutoff)}`,
    boundary_lines: [
      "공개 경기 기록을 바탕으로 한 연습 밴픽입니다.",
      "승률·점수·실력·포지션은 계산하거나 확정하지 않습니다.",
    ],
  };
}

/** Deterministic serialization of the display model (stable key order). */
export function serializeDraftResultImageModel(model: DraftResultImageModel): string {
  return JSON.stringify({
    title: model.title, notice: model.notice,
    sides: model.sides.map((s) => ({ side: s.side, side_label: s.side_label, team_lines: [...s.team_lines], picks: [...s.picks], bans: [...s.bans] })),
    patch_line: model.patch_line, cutoff_line: model.cutoff_line, boundary_lines: [...model.boundary_lines],
  });
}

export function draftResultImageFileName(model: DraftResultImageModel): string {
  const safe = (lines: string[]) => lines.join("").replace(/[\\/:*?"<>|\s]+/g, "_").split("…").join("").slice(0, 24) || "team";
  return `banpick-${safe(model.sides[0].team_lines)}-vs-${safe(model.sides[1].team_lines)}.png`;
}

type Ctx = Pick<CanvasRenderingContext2D, "fillRect" | "fillText" | "measureText"> & { fillStyle: unknown; font: string; textBaseline: unknown; textAlign: unknown };
type CanvasLike = { width: number; height: number; getContext(type: "2d"): Ctx | null };

const PAD = 64, ROW = 52, FONT = "'Pretendard', 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif";
const COLORS = { bg: "#0f1420", card: "#182033", text: "#f2f4f8", muted: "#a9b2c6", BLUE: "#5aa2ff", RED: "#ff6b6b", line: "#2a3550" };

export function draftResultImageHeight(model: DraftResultImageModel): number {
  let h = PAD + 70 + 56 + 32;
  for (const s of model.sides) h += 40 + s.team_lines.length * 58 + 24 + 44 + 5 * ROW + 20 + 44 + 5 * ROW + 40 + 32;
  return h + 44 * 2 + model.boundary_lines.length * 40 + PAD;
}

function fit(ctx: Ctx, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  const chars = [...text];
  while (chars.length > 1 && ctx.measureText(chars.join("") + "…").width > max) chars.pop();
  return chars.join("") + "…";
}

/** Draws text only onto a canvas-like target. Returns the list of strings drawn (for checks). */
export function renderDraftResultImage(model: DraftResultImageModel, canvas: CanvasLike): string[] {
  canvas.width = IMAGE_WIDTH;
  canvas.height = draftResultImageHeight(model);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("NO_CANVAS");
  const drawn: string[] = [];
  const max = IMAGE_WIDTH - PAD * 2;
  const text = (value: string, x: number, y: number, size: number, color: string, weight = 400, width = max) => {
    ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color;
    const out = fit(ctx, value, width); ctx.fillText(out, x, y); drawn.push(out);
  };
  ctx.textBaseline = "top"; ctx.textAlign = "left";
  ctx.fillStyle = COLORS.bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
  let y = PAD;
  text(model.title, PAD, y, 60, COLORS.text, 800); y += 70;
  text(model.notice, PAD, y, 34, COLORS.muted, 600); y += 56 + 32;
  for (const s of model.sides) {
    const color = s.side === "BLUE" ? COLORS.BLUE : COLORS.RED;
    const blockH = 40 + s.team_lines.length * 58 + 24 + 44 + 5 * ROW + 20 + 44 + 5 * ROW + 40;
    ctx.fillStyle = COLORS.card; ctx.fillRect(PAD - 24, y - 20, max + 48, blockH);
    ctx.fillStyle = color; ctx.fillRect(PAD - 24, y - 20, 10, blockH);
    text(s.side_label, PAD, y, 30, color, 700); y += 40;
    for (const line of s.team_lines) { text(line, PAD, y, 48, COLORS.text, 800); y += 58; }
    y += 24;
    text("픽", PAD, y, 30, color, 700); y += 44;
    s.picks.forEach((name, i) => { text(`${i + 1}. ${name}`, PAD + 16, y, 36, COLORS.text, 600, max - 16); y += ROW; });
    y += 20;
    text("밴", PAD, y, 30, COLORS.muted, 700); y += 44;
    s.bans.forEach((name, i) => { text(`${i + 1}. ${name}`, PAD + 16, y, 34, COLORS.muted, 500, max - 16); y += ROW; });
    y += 40 + 32;
  }
  ctx.fillStyle = COLORS.line; ctx.fillRect(PAD, y - 16, max, 2);
  text(model.patch_line, PAD, y, 30, COLORS.text, 600); y += 44;
  text(model.cutoff_line, PAD, y, 30, COLORS.text, 600); y += 44;
  for (const line of model.boundary_lines) { text(line, PAD, y, 26, COLORS.muted); y += 40; }
  return drawn;
}

/** Renders to a fresh canvas and encodes PNG locally. Nothing is uploaded. */
export function createDraftResultPng(model: DraftResultImageModel, doc: Document = document): Promise<Blob> {
  const canvas = doc.createElement("canvas");
  renderDraftResultImage(model, canvas as unknown as CanvasLike);
  return new Promise((resolve, reject) => {
    try { canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("ENCODE_FAILED")), "image/png"); }
    catch (error) { reject(error); }
  });
}

/** Triggers a browser download via an object URL, revoking it afterwards. */
export function downloadBlob(blob: Blob, fileName: string, doc: Document = document, urls: Pick<typeof URL, "createObjectURL" | "revokeObjectURL"> = URL): void {
  const url = urls.createObjectURL(blob);
  try {
    const a = doc.createElement("a");
    a.href = url; a.download = fileName; a.rel = "noopener"; a.style.display = "none";
    doc.body.appendChild(a);
    try { a.click(); } finally { a.remove(); }
  } finally {
    setTimeout(() => urls.revokeObjectURL(url), 1000);
  }
}
