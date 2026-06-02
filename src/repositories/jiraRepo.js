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
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
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
