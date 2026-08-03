require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const express = require('express')
const { Pool } = require('pg')
const cors = require('cors')
// fetch 는 Node 18+ 내장 전역을 쓴다 (node-fetch v2 는 AbortSignal.timeout 과 호환되지 않음)

// DATE 타입을 JS Date 객체가 아닌 YYYY-MM-DD 문자열로 반환
const { types } = require('pg')
types.setTypeParser(1082, val => val)

const app = express()
app.use(cors())
app.use(express.json())

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
})

// ─── Workers ────────────────────────────────────────────────

app.get('/api/workers', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM workers ORDER BY hired_at ASC NULLS LAST, created_at ASC'
    )
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/workers', async (req, res) => {
  const { name, hired_at } = req.body
  try {
    const { rows } = await pool.query(
      'INSERT INTO workers (name, active, hired_at) VALUES ($1, true, $2) RETURNING *',
      [name, hired_at || new Date().toISOString().slice(0, 10)]
    )
    res.json(rows[0])
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.patch('/api/workers/:name/status', async (req, res) => {
  const { name } = req.params
  const { active, resigned_at } = req.body
  try {
    await pool.query(
      'UPDATE workers SET active = $1, resigned_at = $2 WHERE name = $3',
      [active, active ? null : (resigned_at || new Date().toISOString().slice(0, 10)), name]
    )
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.patch('/api/workers/:name/dates', async (req, res) => {
  const { name } = req.params
  const { hired_at, resigned_at } = req.body
  try {
    await pool.query(
      'UPDATE workers SET hired_at = $1, resigned_at = $2 WHERE name = $3',
      [hired_at || null, resigned_at || null, name]
    )
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.delete('/api/workers/:name', async (req, res) => {
  try {
    await pool.query('DELETE FROM workers WHERE name = $1', [req.params.name])
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── Work History ────────────────────────────────────────────

app.get('/api/history', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM work_history ORDER BY work_date DESC, work_hour ASC'
    )
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/history/date/:date', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM work_history WHERE work_date = $1 ORDER BY work_hour ASC',
      [req.params.date]
    )
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/history/range', async (req, res) => {
  const { from, to } = req.query
  try {
    const { rows } = await pool.query(
      'SELECT * FROM work_history WHERE work_date >= $1 AND work_date <= $2 ORDER BY work_date ASC, work_hour ASC',
      [from, to]
    )
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/history/save', async (req, res) => {
  const { worker_name, work_date, rows } = req.body
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      'DELETE FROM work_history WHERE work_date = $1 AND worker_name = $2',
      [work_date, worker_name]
    )
    if (rows && rows.length > 0) {
      const values = rows.map((_, i) =>
        `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`
      ).join(', ')
      const params = rows.flatMap(r => [r.worker_name, r.work_date, r.work_hour, r.work_text])
      await client.query(
        `INSERT INTO work_history (worker_name, work_date, work_hour, work_text) VALUES ${values}`,
        params
      )
    }
    await client.query('COMMIT')
    res.json({ ok: true })
  } catch (e) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: e.message })
  } finally {
    client.release()
  }
})

// ─── Jira Issues ─────────────────────────────────────────────

app.get('/api/jira-issues', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM jira_issues ORDER BY jira_key ASC')
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/jira-issues', async (req, res) => {
  const { full_text, parent_text } = req.body
  try {
    let parentKey = null
    if (parent_text) {
      const { rows } = await pool.query(
        'SELECT jira_key FROM jira_issues WHERE full_text = $1',
        [parent_text]
      )
      parentKey = rows[0]?.jira_key ?? null
    }
    const manualKey = 'MANUAL-' + Date.now()
    await pool.query(
      'INSERT INTO jira_issues (jira_key, summary, parent_key, full_text) VALUES ($1, $2, $3, $4)',
      [manualKey, full_text, parentKey, full_text]
    )
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.delete('/api/jira-issues', async (req, res) => {
  const { full_text } = req.body
  try {
    await pool.query('DELETE FROM jira_issues WHERE full_text = $1', [full_text])
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── Jira Sync ───────────────────────────────────────────────

// 신형 검색 API(/rest/api/3/search/jql)를 nextPageToken 방식으로 끝까지 조회한다.
// 구형 /rest/api/3/search 는 Atlassian 이 제거해 410 을 반환한다.
// 페이지 반복이 끝나지 않으면 메모리를 모두 소진해 프로세스가 죽는다
// (실제로 배포본에서 heap out of memory 로 백엔드가 사망한 사례가 있었다)
const MAX_PAGES  = 100    // 페이지당 100건 → 최대 1만 건
const MAX_ISSUES = 20000
const JIRA_TIMEOUT_MS = 30000

async function searchJiraIssues(baseUrl, auth, jql, fields) {
  const issues = []
  const seenTokens = new Set()
  let pageToken = null
  let page = 0

  do {
    if (++page > MAX_PAGES) {
      throw new Error(`Jira 조회가 ${MAX_PAGES}페이지를 넘겨 중단했습니다. 검색 조건을 확인해 주세요.`)
    }

    const params = new URLSearchParams({ jql, maxResults: '100', fields })
    if (pageToken) params.set('nextPageToken', pageToken)

    let response
    try {
      response = await fetch(`${baseUrl}/rest/api/3/search/jql?${params}`, {
        headers: { Authorization: auth, Accept: 'application/json' },
        signal: AbortSignal.timeout(JIRA_TIMEOUT_MS)
      })
    } catch (e) {
      const reason = e.name === 'TimeoutError'
        ? `응답이 ${JIRA_TIMEOUT_MS / 1000}초 안에 오지 않았습니다`
        : e.message
      throw new Error(`Jira 서버에 연결할 수 없습니다 (${reason}).`)
    }

    const body = await response.text()

    if (!response.ok) {
      let detail = body.slice(0, 300)
      try {
        const parsed = JSON.parse(body)
        if (parsed.errorMessages?.length) detail = parsed.errorMessages.join(' ')
      } catch { /* JSON 이 아니면 원문 앞부분을 그대로 쓴다 */ }
      throw new Error(`Jira 조회 실패 (HTTP ${response.status}): ${detail}`)
    }

    const data = JSON.parse(body)
    issues.push(...(data.issues || []))

    if (issues.length > MAX_ISSUES) {
      throw new Error(`Jira 이슈가 ${MAX_ISSUES}건을 넘어 중단했습니다.`)
    }

    const nextToken = data.isLast ? null : (data.nextPageToken || null)
    // 같은 토큰이 다시 오면 영원히 같은 페이지를 받게 된다
    if (nextToken && seenTokens.has(nextToken)) {
      throw new Error('Jira 가 같은 페이지를 반복해 반환했습니다. 무한 반복을 막기 위해 중단했습니다.')
    }
    if (nextToken) seenTokens.add(nextToken)
    pageToken = nextToken
  } while (pageToken)

  return issues
}

// 토큰이 만료되면 Jira 가 401 대신 빈 결과를 주는 경우가 있어 0건과 구분되지 않는다.
// 계정 조회로 인증 상태를 확인해 사용자가 원인을 알 수 있는 문구를 만든다.
async function explainEmptyResult(baseUrl, auth) {
  const generic = 'Jira 조회 결과가 0건입니다. 기존 업무 목록을 보존하기 위해 동기화를 중단했습니다.'
  try {
    const response = await fetch(`${baseUrl}/rest/api/3/myself`, {
      headers: { Authorization: auth, Accept: 'application/json' },
      signal: AbortSignal.timeout(JIRA_TIMEOUT_MS)
    })
    if (response.status === 401 || response.status === 403) {
      return 'Jira 인증에 실패했습니다. API 토큰이 만료되었거나 잘못되었습니다. ' +
             '관리자에게 토큰 갱신을 요청해 주세요. (기존 업무 목록은 그대로 보존했습니다)'
    }
  } catch { /* 확인 자체가 실패하면 일반 문구를 쓴다 */ }
  return generic
}

app.post('/api/jira-sync', async (req, res) => {
  const email = process.env.JIRA_EMAIL
  const token = process.env.JIRA_TOKEN
  const host  = process.env.JIRA_HOST  // e.g. vi-tron.atlassian.net

  if (!email || !token || !host) {
    return res.status(500).json({ error: 'Jira 환경변수(JIRA_EMAIL, JIRA_TOKEN, JIRA_HOST)가 설정되지 않았습니다.' })
  }

  const auth = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64')
  const baseUrl = `https://${host}`

  try {
    // 에픽(상위 이슈) 조회
    const epics = await searchJiraIssues(baseUrl, auth, 'issuetype=Epic', 'summary')

    // 하위 이슈 조회
    const children = await searchJiraIssues(
      baseUrl, auth, 'issuetype!=Epic AND parent is not EMPTY', 'summary,parent'
    )

    const allIssues = [
      ...epics.map(i => ({
        jira_key:   i.key,
        summary:    i.fields.summary,
        parent_key: null,
        full_text:  `[${i.key}] ${i.fields.summary}`
      })),
      ...children.map(i => ({
        jira_key:   i.key,
        summary:    i.fields.summary,
        parent_key: i.fields.parent?.key ?? null,
        full_text:  `[${i.key}] ${i.fields.summary}`
      }))
    ]

    // 안전장치: 조회 결과가 비어 있으면 기존 목록을 지우지 않고 중단한다.
    // (과거 코드는 Jira 오류 응답을 빈 목록으로 취급해 전체 삭제로 이어졌다)
    // 502/503/504 는 nginx 가 자체 오류로 가로채므로 500 으로 돌려준다
    if (allIssues.length === 0) {
      return res.status(500).json({ error: await explainEmptyResult(baseUrl, auth) })
    }

    // 같은 INSERT 문에 중복 키가 들어가면 ON CONFLICT 가 오류를 내므로 미리 제거한다
    const uniqueIssues = [...new Map(allIssues.map(i => [i.jira_key, i])).values()]

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM jira_issues WHERE jira_key NOT LIKE \'MANUAL-%\'')

      // 건별 왕복 대신 500건씩 묶어 INSERT (NAS 환경에서 응답 지연 방지)
      const CHUNK_SIZE = 500
      for (let start = 0; start < uniqueIssues.length; start += CHUNK_SIZE) {
        const chunk = uniqueIssues.slice(start, start + CHUNK_SIZE)
        const placeholders = chunk.map((_, n) => {
          const base = n * 4
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`
        })
        const values = chunk.flatMap(i => [i.jira_key, i.summary, i.parent_key, i.full_text])
        await client.query(
          `INSERT INTO jira_issues (jira_key, summary, parent_key, full_text)
           VALUES ${placeholders.join(', ')}
           ON CONFLICT (jira_key) DO UPDATE
           SET summary = EXCLUDED.summary,
               parent_key = EXCLUDED.parent_key,
               full_text = EXCLUDED.full_text`,
          values
        )
      }
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }

    res.json({ ok: true, count: uniqueIssues.length })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── 헬스체크 ────────────────────────────────────────────────

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ ok: true, db: 'connected' })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`API server running on port ${PORT}`))
