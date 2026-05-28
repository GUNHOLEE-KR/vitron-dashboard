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
    const email = Deno.env.get('JIRA_EMAIL')
    const token = Deno.env.get('JIRA_TOKEN')
    const auth = 'Basic ' + btoa(email + ':' + token)

    // Jira API에서 이슈 수집
    let allIssues = [], startAt = 0

    while (true) {
      const url =
        'https://vi-tron.atlassian.net/rest/api/3/search/jql' +
        '?jql=project=VITRON ORDER BY key ASC' +
        '&maxResults=100&startAt=' + startAt +
        '&fields=summary,key,assignee,parent'

      const res = await fetch(url, {
        headers: { Authorization: auth, Accept: 'application/json' }
      })

      const json = await res.json()
      if (!json.issues?.length) break
      allIssues = [...allIssues, ...json.issues]
      if (json.issues.length < 100) break
      startAt += json.issues.length
    }

    // Supabase에 저장
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    )

    const rows = allIssues.map(i => ({
      jira_key:   i.key,
      summary:    i.fields.summary,
      assignee:   i.fields.assignee?.displayName ?? '',
      parent_key: i.fields.parent?.key ?? null,
      synced_at:  new Date().toISOString()
    }))

    await supabase.from('jira_issues').delete().neq('id', '00000000-0000-0000-0000-000000000000')

    if (rows.length > 0) {
      await supabase.from('jira_issues').insert(rows)
    }

    return new Response(
      JSON.stringify({ success: true, count: rows.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})