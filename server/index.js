require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const express = require('express')
const { Pool } = require('pg')
const cors = require('cors')
// fetch 는 Node 18+ 내장 전역을 쓴다 (node-fetch v2 는 AbortSignal.timeout 과 호환되지 않음)

// DATE 타입을 JS Date 객체가 아닌 YYYY-MM-DD 문자열로 반환
const { types } = require('pg')
types.setTypeParser(1082, val => val)

// NUMERIC 은 기본이 «문자열» 이다. 그대로 두면 거리를 더할 때 숫자 덧셈이 아니라
// 문자열 이어붙이기가 되어 「12.3」+「4.5」가 「12.34.5」가 된다.
// (KPI 추적 시스템에서 점수 합산이 이렇게 깨진 사고가 있었다)
types.setTypeParser(1700, val => (val === null ? null : parseFloat(val)))

// ⚠️ 오늘 날짜를 만들 때 toISOString() 을 쓰면 안 된다.
// toISOString() 은 UTC 기준이라 한국(UTC+9)에서는 오전 9시 이전에 전날이 된다.
// 컨테이너 시간대가 UTC 면 하루 종일 어긋날 수도 있다.
function todayLocal() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

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
  const { name, hired_at, email } = req.body
  try {
    const { rows } = await pool.query(
      'INSERT INTO workers (name, active, hired_at, email) VALUES ($1, true, $2, $3) RETURNING *',
      [name, hired_at || todayLocal(), email || null]
    )
    res.json(rows[0])
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 회사 메일 주소. KPI 추적 시스템(8083)이 이 값을 로그인 아이디로 쓴다.
app.patch('/api/workers/:id/email', async (req, res) => {
  const { email } = req.body
  const value = String(email || '').trim()
  if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return res.status(400).json({ error: '메일 주소 형식이 올바르지 않습니다.' })
  }
  try {
    const { rowCount } = await pool.query(
      'UPDATE workers SET email = $1 WHERE id = $2', [value || null, req.params.id]
    )
    if (rowCount === 0) return res.status(404).json({ error: '해당 직원을 찾을 수 없습니다.' })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 아래 세 API 는 이름이 아니라 id 로 대상을 지정한다.
// 동명이인이 있으면 이름으로는 누구를 고칠지 특정할 수 없기 때문이다.
app.patch('/api/workers/:id/status', async (req, res) => {
  const { id } = req.params
  const { active, resigned_at } = req.body
  try {
    const { rowCount } = await pool.query(
      'UPDATE workers SET active = $1, resigned_at = $2 WHERE id = $3',
      [active, active ? null : (resigned_at || todayLocal()), id]
    )
    if (rowCount === 0) return res.status(404).json({ error: '해당 직원을 찾을 수 없습니다.' })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.patch('/api/workers/:id/dates', async (req, res) => {
  const { id } = req.params
  const { hired_at, resigned_at } = req.body
  try {
    const { rowCount } = await pool.query(
      'UPDATE workers SET hired_at = $1, resigned_at = $2 WHERE id = $3',
      [hired_at || null, resigned_at || null, id]
    )
    if (rowCount === 0) return res.status(404).json({ error: '해당 직원을 찾을 수 없습니다.' })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.delete('/api/workers/:id', async (req, res) => {
  try {
    // 업무 기록은 남긴다 (worker_id·worker_name 이 그대로 보존된다)
    const { rowCount } = await pool.query('DELETE FROM workers WHERE id = $1', [req.params.id])
    if (rowCount === 0) return res.status(404).json({ error: '해당 직원을 찾을 수 없습니다.' })
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
  const { worker_id, worker_name, work_date, rows } = req.body
  if (!worker_id) {
    return res.status(400).json({ error: 'worker_id 가 필요합니다.' })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // 지울 대상도 id 로 특정한다. 이름으로 지우면 동명이인의 기록까지 함께 사라진다.
    await client.query(
      'DELETE FROM work_history WHERE work_date = $1 AND worker_id = $2',
      [work_date, worker_id]
    )
    if (rows && rows.length > 0) {
      const values = rows.map((_, i) =>
        `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5})`
      ).join(', ')
      const params = rows.flatMap(r =>
        [worker_id, r.worker_name || worker_name, r.work_date, r.work_hour, r.work_text])
      await client.query(
        `INSERT INTO work_history (worker_id, worker_name, work_date, work_hour, work_text)
         VALUES ${values}`,
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

// ─── Jira 토큰 만료 안내 ─────────────────────────────────────

// Atlassian 은 API 토큰의 만료일을 조회하는 API 를 제공하지 않는다.
// 그래서 발급 시 확인한 만료일을 JIRA_TOKEN_EXPIRES(YYYY-MM-DD)에 기록해 두고
// 남은 일수를 계산한다. 값이 없으면 안내를 표시하지 않는다.
const TOKEN_WARN_DAYS = 30

app.get('/api/jira/token-status', (req, res) => {
  const expiresAt = process.env.JIRA_TOKEN_EXPIRES
  if (!expiresAt || !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) {
    return res.json({ configured: false })
  }

  // 날짜만 비교한다. 양쪽을 같은 기준(UTC 자정)으로 맞춰 시각 차이를 없애고,
  // 오늘 날짜는 로컬 기준으로 잡는다 (UTC 로 잡으면 오전에 하루 밀린다)
  const todayAtMidnight = new Date(todayLocal() + 'T00:00:00Z')
  const expiryAtMidnight = new Date(expiresAt + 'T00:00:00Z')
  const daysLeft = Math.round((expiryAtMidnight - todayAtMidnight) / 86400000)

  const level = daysLeft < 0 ? 'expired'
    : daysLeft <= TOKEN_WARN_DAYS ? 'warn'
    : 'ok'

  res.json({ configured: true, expiresAt, daysLeft, level })
})

// ─── 스케줄표 ────────────────────────────────────────────────
// 설계서: docs/design/스케줄표_설계.md
// 「어느 날 어디에서 무엇을 할 계획인가」를 다룬다. 업무 내용을 적는
// work_history 와 달리 «장소와 이동 수단» 이 중심이다.

// 장소 이름이 갈라지는 것을 막기 위한 정규화.
// 「(주)삼양화학 인천공장」·「삼양화학인천공장」 을 같은 것으로 보고 경고한다.
function normalizePlaceName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[（(]주[）)]|㈜/g, '')
    .replace(/[\s\-_.·,]/g, '')
}

// 이름이 서로 «포함» 관계면 같은 곳일 가능성이 높다고 본다.
// 편집거리 같은 정교한 방법은 장소 수가 적어 과하고, 오히려 엉뚱한 경고를 낸다.
function findSimilarPlaces(name, places) {
  const target = normalizePlaceName(name)
  if (target.length < 2) return []
  return places.filter(p => {
    const other = normalizePlaceName(p.name)
    if (!other) return false
    return other === target || other.includes(target) || target.includes(other)
  })
}

// 시간대가 겹치는가. 종일은 모든 시간대와 겹치고, 오전과 오후는 겹치지 않는다.
function slotsOverlap(a, b) {
  if (a === 'allday' || b === 'allday') return true
  if (a === 'time' || b === 'time') return true   // 시각 지정은 판단이 어려워 겹침으로 본다
  return a === b
}

// ── 장소 ──
app.get('/api/schedule/places', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM schedule_places
        WHERE ($1 = 'true' OR active) ORDER BY active DESC, name ASC`,
      [String(req.query.all === '1')]
    )
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/schedule/places', async (req, res) => {
  const { name, address, distance_km, travel_min, category, memo, created_by, force } = req.body
  const value = String(name || '').trim()
  if (!value) return res.status(400).json({ error: '장소 이름을 입력해 주세요.' })
  try {
    // 비슷한 이름이 있으면 «등록 시점에» 알린다. 나중에 합치는 것보다 훨씬 싸다.
    if (!force) {
      const { rows: existing } = await pool.query('SELECT id, name, distance_km FROM schedule_places WHERE active')
      const similar = findSimilarPlaces(value, existing)
      if (similar.length > 0) {
        return res.status(409).json({
          error: '비슷한 이름의 장소가 이미 있습니다.',
          similar,
        })
      }
    }
    const { rows } = await pool.query(
      `INSERT INTO schedule_places (name, address, distance_km, travel_min, category, memo, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [value, address || null, distance_km ?? null, travel_min ?? null,
       category || null, memo || null, created_by ?? null]
    )
    res.json(rows[0])
  } catch (e) {
    if (e.code === '23505') {   // unique_violation
      return res.status(409).json({ error: '같은 이름의 장소가 이미 있습니다.' })
    }
    res.status(500).json({ error: e.message })
  }
})

app.patch('/api/schedule/places/:id', async (req, res) => {
  const { name, address, distance_km, travel_min, category, memo, active } = req.body
  try {
    const { rowCount } = await pool.query(
      `UPDATE schedule_places
          SET name = COALESCE($1, name), address = $2,
              distance_km = $3, travel_min = $4,
              category = $5, memo = $6, active = COALESCE($7, active)
        WHERE id = $8`,
      [name ? String(name).trim() : null, address || null, distance_km ?? null,
       travel_min ?? null, category || null, memo || null,
       active === undefined ? null : !!active, req.params.id]
    )
    if (rowCount === 0) return res.status(404).json({ error: '해당 장소를 찾을 수 없습니다.' })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 지우지 않고 «숨긴다». 지난 계획·실적이 이 장소를 참조하고 있기 때문이다.
app.delete('/api/schedule/places/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'UPDATE schedule_places SET active = FALSE WHERE id = $1', [req.params.id]
    )
    if (rowCount === 0) return res.status(404).json({ error: '해당 장소를 찾을 수 없습니다.' })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── 차량 ──
app.get('/api/schedule/vehicles', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT v.*, w.name AS owner_name
         FROM schedule_vehicles v
         LEFT JOIN workers w ON w.id = v.owner_worker_id
        WHERE ($1 = 'true' OR v.active)
        ORDER BY v.kind ASC, v.name ASC, v.id ASC`,
      [String(req.query.all === '1')]
    )
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/schedule/vehicles', async (req, res) => {
  const { kind, name, plate, owner_worker_id, fuel_type, rate_per_km, km_per_liter, memo } = req.body
  if (!name) return res.status(400).json({ error: '차량 이름(차종)을 입력해 주세요.' })
  if (kind === 'own' && !owner_worker_id) {
    return res.status(400).json({ error: '자차는 소유 직원을 지정해 주세요.' })
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO schedule_vehicles
         (kind, name, plate, owner_worker_id, fuel_type, rate_per_km, km_per_liter, memo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [kind || 'company', String(name).trim(), plate || null, owner_worker_id ?? null,
       fuel_type || null, rate_per_km ?? null, km_per_liter ?? null, memo || null]
    )
    res.json(rows[0])
  } catch (e) {
    if (e.code === '23505') {   // unique_violation — 번호판 중복
      return res.status(409).json({ error: '같은 번호판의 차량이 이미 등록돼 있습니다.' })
    }
    res.status(500).json({ error: e.message })
  }
})

// 단가·연비는 정산 금액에 직접 영향을 준다. 화면에서 대표이사만 부를 수 있게 하고,
// 여기서는 값만 바꾼다 (권한 판정은 정산 화면에서 한다 — 설계서 4.2절)
app.patch('/api/schedule/vehicles/:id', async (req, res) => {
  const { name, plate, fuel_type, rate_per_km, km_per_liter, memo, active } = req.body
  try {
    const { rowCount } = await pool.query(
      `UPDATE schedule_vehicles
          SET name = COALESCE($1, name), plate = $2, fuel_type = $3,
              rate_per_km = $4, km_per_liter = $5, memo = $6,
              active = COALESCE($7, active)
        WHERE id = $8`,
      [name ? String(name).trim() : null, plate || null, fuel_type || null,
       rate_per_km ?? null, km_per_liter ?? null, memo || null,
       active === undefined ? null : !!active, req.params.id]
    )
    if (rowCount === 0) return res.status(404).json({ error: '해당 차량을 찾을 수 없습니다.' })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── 계획 ──
// 달력이 한 번에 그려지도록 장소·차량·직원 이름을 함께 돌려준다.
const PLAN_SELECT = `
  SELECT p.*, w.name AS worker_name, w.team AS worker_team,
         pl.name AS place_name, pl.category AS place_category,
         v.name AS vehicle_name, v.plate AS vehicle_plate, v.kind AS vehicle_kind,
         a.id AS actual_id, a.as_planned, a.distance_km AS actual_distance_km
    FROM schedule_plans p
    LEFT JOIN workers w          ON w.id  = p.worker_id
    LEFT JOIN schedule_places pl ON pl.id = p.place_id
    LEFT JOIN schedule_vehicles v ON v.id = p.vehicle_id
    LEFT JOIN schedule_actuals a  ON a.plan_id = p.id`

app.get('/api/schedule/plans', async (req, res) => {
  const { from, to, worker_id, vehicle_id } = req.query
  if (!from || !to) return res.status(400).json({ error: 'from·to 날짜가 필요합니다.' })
  try {
    const { rows } = await pool.query(
      `${PLAN_SELECT}
        WHERE p.plan_date >= $1 AND p.plan_date <= $2
          AND ($3::int IS NULL OR p.worker_id  = $3::int)
          AND ($4::int IS NULL OR p.vehicle_id = $4::int)
        ORDER BY p.plan_date ASC, p.slot ASC, p.worker_id ASC`,
      [from, to, worker_id || null, vehicle_id || null]
    )
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 같은 날 같은 차량을 쓰려는 계획이 있는지 알려 준다(달력에서 미리 보여 주기 위함).
app.get('/api/schedule/vehicle-usage', async (req, res) => {
  const { from, to } = req.query
  if (!from || !to) return res.status(400).json({ error: 'from·to 날짜가 필요합니다.' })
  try {
    const { rows } = await pool.query(
      `SELECT p.vehicle_id, p.plan_date, p.slot, p.worker_id, w.name AS worker_name,
              v.name AS vehicle_name, v.plate AS vehicle_plate
         FROM schedule_plans p
         LEFT JOIN workers w ON w.id = p.worker_id
         LEFT JOIN schedule_vehicles v ON v.id = p.vehicle_id
        WHERE p.vehicle_id IS NOT NULL
          AND p.status <> 'canceled'
          AND p.plan_date >= $1 AND p.plan_date <= $2
        ORDER BY p.plan_date ASC, p.vehicle_id ASC`,
      [from, to]
    )
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/schedule/plans', async (req, res) => {
  const b = req.body
  if (!b.worker_id) return res.status(400).json({ error: '이름을 먼저 선택해 주세요.' })
  if (!b.plan_date) return res.status(400).json({ error: '날짜가 필요합니다.' })
  const useType = b.use_type === 'personal' ? 'personal' : 'business'
  // 개인 사용은 장소·용무를 받지 않는다 (설계서 5.2절 — 사적인 행선지를 남기지 않는다)
  const placeId   = useType === 'personal' ? null : (b.place_id ?? null)
  const placeText = useType === 'personal' ? null : (b.place_text || null)
  const purpose   = useType === 'personal' ? null : (b.purpose || null)
  try {
    // 차량 겹침 검사 — 먼저 등록한 사람이 우선이고, 겹치면 경고만 한다.
    // force=true 로 다시 부르면 그대로 등록된다 (승인 절차를 두지 않는다)
    if (b.vehicle_id && !b.force) {
      const { rows: conflicts } = await pool.query(
        `SELECT p.id, p.slot, p.worker_id, w.name AS worker_name
           FROM schedule_plans p LEFT JOIN workers w ON w.id = p.worker_id
          WHERE p.vehicle_id = $1 AND p.plan_date = $2 AND p.status <> 'canceled'`,
        [b.vehicle_id, b.plan_date]
      )
      const hit = conflicts.filter(c => slotsOverlap(c.slot, b.slot || 'allday'))
      if (hit.length > 0) {
        return res.status(409).json({
          error: `이미 ${hit.map(h => h.worker_name).join('·')} 님이 예약한 차량입니다.`,
          conflicts: hit,
        })
      }
    }
    const { rows } = await pool.query(
      `INSERT INTO schedule_plans
         (worker_id, plan_date, slot, start_time, end_time, use_type,
          place_id, place_text, purpose, transport, vehicle_id,
          est_distance_km, est_travel_min, round_trip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [b.worker_id, b.plan_date, b.slot || 'allday', b.start_time || null, b.end_time || null,
       useType, placeId, placeText, purpose, b.transport || 'office', b.vehicle_id ?? null,
       b.est_distance_km ?? null, b.est_travel_min ?? null,
       b.round_trip === undefined ? true : !!b.round_trip]
    )
    res.json(rows[0])
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.patch('/api/schedule/plans/:id', async (req, res) => {
  const b = req.body
  try {
    const { rows: cur } = await pool.query('SELECT * FROM schedule_plans WHERE id = $1', [req.params.id])
    if (cur.length === 0) return res.status(404).json({ error: '해당 계획을 찾을 수 없습니다.' })
    const useType = b.use_type ?? cur[0].use_type
    const personal = useType === 'personal'
    const { rowCount } = await pool.query(
      `UPDATE schedule_plans
          SET plan_date = COALESCE($1, plan_date), slot = COALESCE($2, slot),
              start_time = $3, end_time = $4, use_type = $5,
              place_id = $6, place_text = $7, purpose = $8,
              transport = COALESCE($9, transport), vehicle_id = $10,
              est_distance_km = $11, est_travel_min = $12,
              round_trip = COALESCE($13, round_trip),
              status = COALESCE($14, status), updated_at = now()
        WHERE id = $15`,
      [b.plan_date || null, b.slot || null, b.start_time || null, b.end_time || null, useType,
       personal ? null : (b.place_id ?? cur[0].place_id),
       personal ? null : (b.place_text ?? cur[0].place_text),
       personal ? null : (b.purpose ?? cur[0].purpose),
       b.transport || null, b.vehicle_id ?? cur[0].vehicle_id,
       b.est_distance_km ?? cur[0].est_distance_km,
       b.est_travel_min ?? cur[0].est_travel_min,
       b.round_trip === undefined ? null : !!b.round_trip,
       b.status || null, req.params.id]
    )
    if (rowCount === 0) return res.status(404).json({ error: '해당 계획을 찾을 수 없습니다.' })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.delete('/api/schedule/plans/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT locked FROM schedule_actuals WHERE plan_id = $1', [req.params.id]
    )
    if (rows.some(r => r.locked)) {
      return res.status(409).json({ error: '정산이 완료된 달의 기록은 지울 수 없습니다.' })
    }
    await pool.query('DELETE FROM schedule_actuals WHERE plan_id = $1', [req.params.id])
    const { rowCount } = await pool.query('DELETE FROM schedule_plans WHERE id = $1', [req.params.id])
    if (rowCount === 0) return res.status(404).json({ error: '해당 계획을 찾을 수 없습니다.' })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── 실적 ──
app.get('/api/schedule/actuals', async (req, res) => {
  const { from, to, worker_id } = req.query
  if (!from || !to) return res.status(400).json({ error: 'from·to 날짜가 필요합니다.' })
  try {
    const { rows } = await pool.query(
      `SELECT a.*, w.name AS worker_name, w.team AS worker_team,
              pl.name AS place_name,
              v.name AS vehicle_name, v.plate AS vehicle_plate,
              v.kind AS vehicle_kind, v.rate_per_km, v.km_per_liter
         FROM schedule_actuals a
         LEFT JOIN workers w           ON w.id  = a.worker_id
         LEFT JOIN schedule_places pl  ON pl.id = a.place_id
         LEFT JOIN schedule_vehicles v ON v.id  = a.vehicle_id
        WHERE a.work_date >= $1 AND a.work_date <= $2
          AND ($3::int IS NULL OR a.worker_id = $3::int)
        ORDER BY a.work_date ASC, a.worker_id ASC`,
      [from, to, worker_id || null]
    )
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 「계획대로」 한 번 누르면 계획 내용을 그대로 실적으로 만든다.
// 계획 없이 생긴 일도 기록할 수 있게 plan_id 없이도 받는다.
app.post('/api/schedule/actuals', async (req, res) => {
  const b = req.body
  try {
    let base = {}
    if (b.plan_id) {
      const { rows } = await pool.query('SELECT * FROM schedule_plans WHERE id = $1', [b.plan_id])
      if (rows.length === 0) return res.status(404).json({ error: '해당 계획을 찾을 수 없습니다.' })
      base = rows[0]
      const { rows: dup } = await pool.query(
        'SELECT id FROM schedule_actuals WHERE plan_id = $1', [b.plan_id]
      )
      if (dup.length > 0) {
        return res.status(409).json({ error: '이 계획에는 이미 실적이 있습니다.', actual_id: dup[0].id })
      }
    }
    const workerId = b.worker_id ?? base.worker_id
    const workDate = b.work_date ?? base.plan_date
    if (!workerId || !workDate) {
      return res.status(400).json({ error: '직원과 날짜가 필요합니다.' })
    }
    const useType  = b.use_type ?? base.use_type ?? 'business'
    const personal = useType === 'personal'
    // 왕복이면 거리를 2배로 잡아 기본값을 만든다 (사용자가 고칠 수 있다)
    const estimated = base.est_distance_km != null
      ? (base.round_trip ? base.est_distance_km * 2 : base.est_distance_km)
      : null

    const { rows } = await pool.query(
      `INSERT INTO schedule_actuals
         (plan_id, worker_id, work_date, as_planned, use_type,
          place_id, place_text, purpose, transport, vehicle_id,
          distance_km, toll_fee, transit_fee, fuel_fee, memo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [b.plan_id ?? null, workerId, workDate,
       b.as_planned === undefined ? true : !!b.as_planned, useType,
       personal ? null : (b.place_id ?? base.place_id ?? null),
       personal ? null : (b.place_text ?? base.place_text ?? null),
       personal ? null : (b.purpose ?? base.purpose ?? null),
       b.transport ?? base.transport ?? 'office',
       b.vehicle_id ?? base.vehicle_id ?? null,
       b.distance_km ?? estimated,
       b.toll_fee ?? 0, b.transit_fee ?? 0, b.fuel_fee ?? 0, b.memo || null]
    )
    // 계획 상태를 함께 옮겨 달력에서 «확인 필요» 표시가 사라지게 한다
    if (b.plan_id) {
      await pool.query(
        'UPDATE schedule_plans SET status = $1, updated_at = now() WHERE id = $2',
        [b.as_planned === false ? 'changed' : 'done', b.plan_id]
      )
    }
    res.json(rows[0])
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.patch('/api/schedule/actuals/:id', async (req, res) => {
  const b = req.body
  try {
    const { rows: cur } = await pool.query('SELECT * FROM schedule_actuals WHERE id = $1', [req.params.id])
    if (cur.length === 0) return res.status(404).json({ error: '해당 실적을 찾을 수 없습니다.' })
    // 정산이 끝난 달은 고칠 수 없다. 승인 금액과 근거가 어긋나기 때문이다.
    // 정정이 필요하면 대표이사가 잠금을 풀고 재승인한다 (설계서 3.3절)
    if (cur[0].locked) {
      return res.status(409).json({ error: '정산이 완료된 달의 기록입니다. 수정하려면 대표이사가 잠금을 해제해야 합니다.' })
    }
    const useType  = b.use_type ?? cur[0].use_type
    const personal = useType === 'personal'
    await pool.query(
      `UPDATE schedule_actuals
          SET as_planned = COALESCE($1, as_planned), use_type = $2,
              place_id = $3, place_text = $4, purpose = $5,
              transport = COALESCE($6, transport), vehicle_id = $7,
              distance_km = $8, toll_fee = COALESCE($9, toll_fee),
              transit_fee = COALESCE($10, transit_fee), fuel_fee = COALESCE($11, fuel_fee),
              memo = $12, updated_at = now()
        WHERE id = $13`,
      [b.as_planned === undefined ? null : !!b.as_planned, useType,
       personal ? null : (b.place_id ?? cur[0].place_id),
       personal ? null : (b.place_text ?? cur[0].place_text),
       personal ? null : (b.purpose ?? cur[0].purpose),
       b.transport || null, b.vehicle_id ?? cur[0].vehicle_id,
       b.distance_km ?? cur[0].distance_km,
       b.toll_fee ?? null, b.transit_fee ?? null, b.fuel_fee ?? null,
       b.memo ?? cur[0].memo, req.params.id]
    )
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.delete('/api/schedule/actuals/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT locked, plan_id FROM schedule_actuals WHERE id = $1', [req.params.id])
    if (rows.length === 0) return res.status(404).json({ error: '해당 실적을 찾을 수 없습니다.' })
    if (rows[0].locked) {
      return res.status(409).json({ error: '정산이 완료된 달의 기록은 지울 수 없습니다.' })
    }
    await pool.query('DELETE FROM schedule_actuals WHERE id = $1', [req.params.id])
    // 실적을 지우면 계획은 다시 «확인 필요» 상태로 돌아간다
    if (rows[0].plan_id) {
      await pool.query('UPDATE schedule_plans SET status = $1 WHERE id = $2', ['planned', rows[0].plan_id])
    }
    res.json({ ok: true })
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
