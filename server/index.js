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
    const epicRes = await fetch(
      `${baseUrl}/rest/api/3/search?jql=issuetype=Epic&maxResults=100&fields=summary,key`,
      { headers: { Authorization: auth, Accept: 'application/json' } }
    )
    const epicData = await epicRes.json()

    // 하위 이슈 조회
    const childRes = await fetch(
      `${baseUrl}/rest/api/3/search?jql=issuetype!=Epic AND "Epic Link" is not EMPTY&maxResults=500&fields=summary,key,parent`,
      { headers: { Authorization: auth, Accept: 'application/json' } }
    )
    const childData = await childRes.json()

    const allIssues = [
      ...(epicData.issues || []).map(i => ({
        jira_key:   i.key,
        summary:    i.fields.summary,
        parent_key: null,
        full_text:  `[${i.key}] ${i.fields.summary}`
      })),
      ...(childData.issues || []).map(i => ({
        jira_key:   i.key,
        summary:    i.fields.summary,
        parent_key: i.fields.parent?.key ?? null,
        full_text:  `[${i.key}] ${i.fields.summary}`
      }))
    ]

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM jira_issues WHERE jira_key NOT LIKE \'MANUAL-%\'')
      for (const issue of allIssues) {
        await client.query(
          `INSERT INTO jira_issues (jira_key, summary, parent_key, full_text)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (jira_key) DO UPDATE
           SET summary = $2, parent_key = $3, full_text = $4`,
          [issue.jira_key, issue.summary, issue.parent_key, issue.full_text]
        )
      }
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }

    res.json({ ok: true, count: allIssues.length })
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
