import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const email = Deno.env.get('JIRA_EMAIL') ?? ''
    const token = Deno.env.get('JIRA_TOKEN') ?? ''

    if (!email || !token) {
      return new Response(
        JSON.stringify({ error: 'JIRA credentials not set' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const auth = 'Basic ' + btoa(email + ':' + token)

    // Jira API 전체 페이지네이션
    let allIssues: any[] = []
    let startAt = 0

    while (true) {
      const jiraRes = await fetch(
        'https://vi-tron.atlassian.net/rest/api/3/search/jql' +
        '?jql=project=VITRON ORDER BY key ASC' +
        '&maxResults=100&startAt=' + startAt +
        '&fields=summary,key,assignee,parent,status',
        { headers: { Authorization: auth, Accept: 'application/json' } }
      )

      if (!jiraRes.ok) {
        const text = await jiraRes.text()
        return new Response(
          JSON.stringify({ error: 'Jira API error: ' + jiraRes.status, detail: text.slice(0, 200) }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const json = await jiraRes.json()
      const issues = json.issues ?? []
      allIssues = [...allIssues, ...issues]
      if (issues.length < 100) break
      startAt += issues.length
    }

    // 완료 여부 판단 (statusCategory.key === 'done')
    const isDone = (i: any) => i.fields.status?.statusCategory?.key === 'done'

    // 부모별 자식 이슈 목록
    const childrenByParent: Record<string, any[]> = {}
    allIssues.filter(i => i.fields.parent).forEach(i => {
      const pk = i.fields.parent.key
      if (!childrenByParent[pk]) childrenByParent[pk] = []
      childrenByParent[pk].push(i)
    })

    // 필터: 완료된 이슈 제외, 서브가 전부 완료된 상위 이슈도 제외
    const filtered = allIssues.filter(i => {
      if (isDone(i)) return false
      if (i.fields.parent) return true
      const children = childrenByParent[i.key] ?? []
      return children.length === 0 || children.some(c => !isDone(c))
    })

    const rows = filtered.map((i: any) => ({
      jira_key:   i.key,
      summary:    i.fields.summary,
      assignee:   i.fields.assignee?.displayName ?? '',
      parent_key: i.fields.parent?.key ?? null,
      synced_at:  new Date().toISOString()
    }))

    // Supabase에 저장
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    await supabase.from('jira_issues')
      .delete().neq('id', '00000000-0000-0000-0000-000000000000')

    if (rows.length > 0) {
      await supabase.from('jira_issues').insert(rows)
    }

    return new Response(
      JSON.stringify({ success: true, count: rows.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})