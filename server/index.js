require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const express = require('express')
const { Pool } = require('pg')
const cors = require('cors')
const fetch = require('node-fetch')

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
async function searchJiraIssues(baseUrl, auth, jql, fields) {
  const issues = []
  let pageToken = null

  do {
    const params = new URLSearchParams({ jql, maxResults: '100', fields })
    if (pageToken) params.set('nextPageToken', pageToken)

    const response = await fetch(`${baseUrl}/rest/api/3/search/jql?${params}`, {
      headers: { Authorization: auth, Accept: 'application/json' }
    })
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
    pageToken = data.isLast ? null : (data.nextPageToken || null)
  } while (pageToken)

  return issues
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
    if (allIssues.length === 0) {
      return res.status(502).json({
        error: 'Jira 조회 결과가 0건입니다. 기존 업무 목록을 보존하기 위해 동기화를 중단했습니다.'
      })
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
