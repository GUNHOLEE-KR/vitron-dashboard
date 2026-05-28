import { supabase } from '../db/supabase'

const EMAIL = import.meta.env.VITE_JIRA_EMAIL
const TOKEN = import.meta.env.VITE_JIRA_TOKEN

// 환경에 따라 프록시 경로 자동 선택
// 로컬 개발: Vite 프록시 (/jira-api)
// 배포 환경: Vercel API Route (/api/jira-proxy)
async function jiraFetch(path) {
  const isDev = import.meta.env.DEV

  if (isDev) {
    const auth = 'Basic ' + btoa(import.meta.env.VITE_JIRA_EMAIL + ':' + import.meta.env.VITE_JIRA_TOKEN)
    const res = await fetch('/jira-api' + path, {
      headers: { Authorization: auth, Accept: 'application/json' }
    })
    return res.json()
  } else {
    const res = await fetch('/api/jira-proxy?url=' + encodeURIComponent(path))
    return res.json()
  }
}

// Jira 이슈 목록 조회 (트리 구조로 반환)
export async function getJiraTree() {
  const { data, error } = await supabase
    .from('jira_issues')
    .select('*')
    .order('jira_key')
  if (error) throw error

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

// Jira API에서 동기화
export async function syncJira() {
  let allIssues = [], startAt = 0

  while (true) {
    const path =
      '/rest/api/3/search/jql' +
      '?jql=project=VITRON ORDER BY key ASC' +
      '&maxResults=100&startAt=' + startAt +
      '&fields=summary,key,assignee,parent'

    const json = await jiraFetch(path)
    if (!json.issues?.length) break
    allIssues = [...allIssues, ...json.issues]
    if (json.issues.length < 100) break
    startAt += json.issues.length
  }

  const rows = allIssues.map(i => ({
    jira_key:   i.key,
    summary:    i.fields.summary,
    assignee:   i.fields.assignee?.displayName ?? '',
    parent_key: i.fields.parent?.key ?? null,
    synced_at:  new Date().toISOString()
  }))

  await supabase.from('jira_issues').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  if (rows.length > 0) {
    const { error } = await supabase.from('jira_issues').insert(rows)
    if (error) throw error
  }
  return rows.length
}

// 수동 Jira 추가
export async function addJiraIssue(fullText, parentText) {
  let parentKey = null
  if (parentText) {
    const { data } = await supabase
      .from('jira_issues')
      .select('jira_key')
      .eq('full_text', parentText)
      .single()
    parentKey = data?.jira_key ?? null
  }
  const manualKey = 'MANUAL-' + Date.now()
  const { error } = await supabase
    .from('jira_issues')
    .insert({ jira_key: manualKey, summary: fullText, parent_key: parentKey })
  if (error) throw error
}

// Jira 삭제
export async function removeJiraIssue(fullText) {
  const { error } = await supabase
    .from('jira_issues')
    .delete()
    .eq('full_text', fullText)
  if (error) throw error
}