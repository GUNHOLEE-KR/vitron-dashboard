const BASE = '/api'

// { tree, done } 을 돌려준다.
//   tree = { 상위업무 전체이름: [하위업무 전체이름, …] }
//   done = 이미 종료된 업무의 전체이름 Set
//
// 🔑 완료 업무를 tree 에서 «빼지 않는» 것이 중요하다. 지난 기록은 이 트리를 타고
//    복원되므로 여기서 빼면 과거 날짜를 조회했을 때 적어 둔 업무가 사라진다.
//    감추는 일은 화면이 «고르는 목록»에서만 한다.
// ⚠ 판정은 status_category('done') 로 한다. 표시 이름(「완료」)은 프로젝트마다 다르다.
// ⚠ 수동 추가 업무(MANUAL-…)는 상태가 NULL 이라 자동으로 «완료 아님» 이 된다 — 고정업무가 그것이다.
export async function getJiraTree() {
  const res = await fetch(`${BASE}/jira-issues`)
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()

  const tree = {}
  const parents = data.filter(i => !i.parent_key)
  const children = data.filter(i => i.parent_key)

  // 🔑 이름으로 «중복을 눌러 묶는다».
  //    업무 기록은 이름만 저장하므로 트리에서 이름이 두 번 나오면 뜻이 없고,
  //    화면이 이름을 key 로 쓰기 때문에 리액트가 「같은 key 가 둘」 이라며
  //    한 줄을 조용히 빠뜨릴 수 있다 (2026-08-25 실제로 겪었다 —
  //    같은 업무가 `VITRON-231` 과 `MANUAL-…` 두 줄로 들어와 있었다).
  parents.forEach(p => {
    tree[p.full_text] = [...new Set(children
      .filter(c => c.parent_key === p.jira_key)
      .map(c => c.full_text))]
  })
  const done = new Set(
    data.filter(i => i.status_category === 'done').map(i => i.full_text)
  )
  return { tree, done }
}

export async function syncJira() {
  const res = await fetch(`${BASE}/jira-sync`, { method: 'POST' })
  const text = await res.text()

  // 프록시(nginx) 오류 등으로 JSON 이 아닌 HTML 이 올 수 있으므로 먼저 파싱을 시도한다
  let data = null
  try { data = JSON.parse(text) } catch { /* 아래에서 원문으로 안내한다 */ }

  if (!res.ok) {
    throw new Error(data?.error || `서버 오류 HTTP ${res.status} — ${text.slice(0, 120)}`)
  }
  if (!data) {
    throw new Error(`서버가 JSON 이 아닌 응답을 반환했습니다 — ${text.slice(0, 120)}`)
  }
  return data.count
}

// Jira API 토큰 만료까지 남은 일수 (서버에 만료일이 기록돼 있을 때만 값이 온다)
export async function getJiraTokenStatus() {
  try {
    const res = await fetch(`${BASE}/jira/token-status`)
    if (!res.ok) return { configured: false }
    return await res.json()
  } catch {
    return { configured: false }   // 안내 기능이 본 화면을 막지 않도록 조용히 넘어간다
  }
}

export async function addJiraIssue(fullText, parentText) {
  const res = await fetch(`${BASE}/jira-issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ full_text: fullText, parent_text: parentText })
  })
  if (!res.ok) throw new Error(await res.text())
}

export async function removeJiraIssue(fullText) {
  const res = await fetch(`${BASE}/jira-issues`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ full_text: fullText })
  })
  if (!res.ok) throw new Error(await res.text())
}
