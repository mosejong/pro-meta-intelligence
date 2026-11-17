/** Enable only after a real, monitored contact mailbox is supplied.
 * No ad SDK, tracking, network request or empty reserved space is mounted.
 */
const PARTNERSHIP_EMAIL: string | null = null;

export function PartnershipPlacement() {
  if (!PARTNERSHIP_EMAIL) return null;
  return <aside className="studio-partnership" aria-label="제휴·광고 문의" lang="ko">
    <div><strong>제휴·광고 문의</strong><p>이용 흐름을 존중하는 협업을 기다립니다.</p></div>
    <a href={`mailto:${PARTNERSHIP_EMAIL}`}>이메일로 문의</a>
  </aside>;
}
