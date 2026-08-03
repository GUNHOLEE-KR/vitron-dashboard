const BASE = '/api'

export async function getJiraTree() {
  const res = await fetch(`${BASE}/jira-issues`)
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()

  const tree = {}
  const parents = data.filter(i => !i.parent_key)
  const children = data.filter(i => i.parent_key)

  parents.forEach(p => {
    tree[p.full_text] = children
      .filter(c => c.parent_key === p.jira_key)
      .map(c => c.full_text)
  })
  return tree
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
