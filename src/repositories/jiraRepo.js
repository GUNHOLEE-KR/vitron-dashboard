import { supabase } from '../db/supabase'

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

// Jira API에서 동기화 (프록시 경유)
export async function syncJira() {
  const email = 'gunholee@vi-tron.com'
  const token = 'ATATT3xFfGF0_yUUn8ih_QEH8Qf7t61fol19De4P5M2EL9maPllkMI4Hig5L6vu4hpHoRq90lRFnn6ryvSwd0-H8jJw438UlcQuo8soROHJOySFVJkejy5lbUJ3TID0Xy40DrhJesBWiyBiiVOa9hp9ShciQ6AGAdNkHQ2fbRadk8a0dBLbjYCM=5860F5EF'
  const auth = 'Basic ' + btoa(email + ':' + token)

  let allIssues = []
  let startAt = 0

  while (true) {
    const res = await fetch(
      `/jira-api/rest/api/3/search/jql` +
      `?jql=project=VITRON AND statusCategory != Done ORDER BY key ASC` +
      `&maxResults=100&startAt=` + startAt +
      `&fields=summary,key,assignee,parent`,
      { headers: { Authorization: auth, Accept: 'application/json' } }
    )
    const json = await res.json()
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