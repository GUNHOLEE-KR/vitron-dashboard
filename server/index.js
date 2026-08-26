require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const express = require('express')
const { Pool } = require('pg')
const cors = require('cors')
// fetch 는 Node 18+ 내장 전역을 쓴다 (node-fetch v2 는 AbortSignal.timeout 과 호환되지 않음)

// DATE 타입을 JS Date 객체가 아닌 YYYY-MM-DD 문자열로 반환
const mailer = require('./mailer')
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

// ─── 로그인 게이트 ───────────────────────────────────────────
// 2026-08-21 부터 «화면 전체» 가 로그인 뒤에 있다. 그 전에는 정산 화면만 막았다.
//
// 🔑 라우트마다 requireLogin 을 붙이지 않고 «전부 막고 예외만 여는» 방식을 쓴다.
//    붙이는 방식은 새 API 를 하나 더할 때 조용히 빠뜨리기 쉽고, 빠뜨려도
//    아무 증상이 없어 알아차릴 방법이 없다.
const OPEN_PATHS = new Set([
  '/api/health',        // 컨테이너 상태 확인 — 로그인 없이 답해야 한다
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/me',       // 「지금 로그인 상태인가」 를 묻는 곳이라 막으면 안 된다
])
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/') || OPEN_PATHS.has(req.path)) return next()
  const session = sessionOf(req)
  if (!session) return res.status(401).json({ error: '로그인이 필요합니다.' })
  // 임시 비밀번호 계정은 들여보내지 않는다 — KPI 와 같은 규칙이다.
  // 비밀번호를 다루는 코드를 두 벌로 만들지 않으려고 «바꾸는 곳» 은 KPI 하나로 둔다.
  if (session.mustChange) {
    return res.status(403).json({
      code: 'MUST_CHANGE_PASSWORD',
      error: '임시 비밀번호입니다. KPI 추적 시스템에서 비밀번호를 먼저 정해 주십시오.',
    })
  }
  req.session = session
  next()
})

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
// 달력·차트에서 이 사람을 나타내는 색 (2026-08-25 신설).
// 🔑 예전에는 «입사일 순번 % 팔레트 길이» 로 계산했는데, 직원이 팔레트보다 많아지자
//    색이 한 바퀴 돌아 두 쌍이 «완전히 같은 색» 이 됐다. 사람이 늘고 줄 때마다
//    남의 색까지 밀리는 문제도 있었다. 그래서 «계산» 이 아니라 «값» 으로 둔다.
// ⚠ 비우면(`null`) 예전처럼 팔레트에서 자동으로 고른다 — 새로 들어온 사람의 기본값이다.
app.patch('/api/workers/:id/color', async (req, res) => {
  const raw = String(req.body?.color || '').trim()
  if (raw && !/^#[0-9a-fA-F]{6}$/.test(raw)) {
    return res.status(400).json({ error: '색은 #rrggbb 형식이어야 합니다.' })
  }
  try {
    const { rowCount } = await pool.query(
      'UPDATE workers SET color = $1 WHERE id = $2', [raw ? raw.toLowerCase() : null, req.params.id]
    )
    if (rowCount === 0) return res.status(404).json({ error: '해당 직원을 찾을 수 없습니다.' })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

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

// ─── 장기 부재 (장기출장·휴직·파견) ──────────────────────────
// 장기 출장자는 업무를 입력할 수 없는데 집계에는 재직자로 들어간다.
// 그 한 사람 때문에 평균이 내려가고 최소값이 그 사람으로 고정된다.
// 부재 기간을 등록해 두면 화면이 그 기간을 «가동일»에서 빼고,
// 그 기간에 남은 기록도 집계에서 제외한다 (2026-08-18 사용자 결정).
// 「집계 제외」는 부재가 아니라 «애초에 대상이 아닌 사람»(대표이사 등)을 위한 사유다.
// 처리 방식(그 기간을 빼는 것)이 같아 같은 표를 쓴다. 기간을 열어 두면 계속 제외된다.
const ABSENCE_KINDS = ['장기출장', '휴직', '파견', '집계 제외']
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

app.get('/api/worker-absences', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.*, w.name AS worker_name
       FROM worker_absences a JOIN workers w ON w.id = a.worker_id
       ORDER BY a.from_date DESC, a.id DESC`
    )
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/worker-absences', async (req, res) => {
  const { worker_id, kind, from_date, to_date, note } = req.body
  if (!worker_id) return res.status(400).json({ error: '대상 직원을 골라 주세요.' })
  if (!ABSENCE_KINDS.includes(kind)) {
    return res.status(400).json({ error: `사유는 ${ABSENCE_KINDS.join('/')} 중 하나여야 합니다.` })
  }
  if (!DATE_ONLY.test(String(from_date || ''))) {
    return res.status(400).json({ error: '시작일을 YYYY-MM-DD 형식으로 넣어 주세요.' })
  }
  // 종료일은 비울 수 있다 (진행 중). 넣었다면 시작일보다 앞설 수 없다.
  if (to_date && !DATE_ONLY.test(String(to_date))) {
    return res.status(400).json({ error: '종료일을 YYYY-MM-DD 형식으로 넣어 주세요.' })
  }
  if (to_date && to_date < from_date) {
    return res.status(400).json({ error: '종료일이 시작일보다 앞설 수 없습니다.' })
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO worker_absences (worker_id, kind, from_date, to_date, note)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [worker_id, kind, from_date, to_date || null, note || null]
    )
    res.json(rows[0])
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 돌아왔을 때 종료일만 채우는 일이 잦아 수정도 둔다.
app.patch('/api/worker-absences/:id', async (req, res) => {
  const { kind, from_date, to_date, note } = req.body
  if (kind && !ABSENCE_KINDS.includes(kind)) {
    return res.status(400).json({ error: `사유는 ${ABSENCE_KINDS.join('/')} 중 하나여야 합니다.` })
  }
  if (to_date && from_date && to_date < from_date) {
    return res.status(400).json({ error: '종료일이 시작일보다 앞설 수 없습니다.' })
  }
  try {
    const { rows } = await pool.query(
      `UPDATE worker_absences
       SET kind = COALESCE($1, kind), from_date = COALESCE($2, from_date),
           to_date = $3, note = COALESCE($4, note)
       WHERE id = $5 RETURNING *`,
      [kind || null, from_date || null, to_date || null, note ?? null, req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: '해당 부재 기록을 찾을 수 없습니다.' })
    res.json(rows[0])
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.delete('/api/worker-absences/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM worker_absences WHERE id = $1', [req.params.id])
    if (rowCount === 0) return res.status(404).json({ error: '해당 부재 기록을 찾을 수 없습니다.' })
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

// 업무명은 «저장할 때» 공백을 다듬는다 — 앞뒤를 떼고 사이 공백을 한 칸으로 누른다.
//
// 🔴 같은 업무가 공백 하나 차이로 갈라지면 집계가 나뉜다. 실제로
//   「[VITRON-231]  설계 화면 구현」(공백 2개) 45건과 공백 1개 16건이 따로 쌓여 있었다.
//   화면(App.jsx 의 normText)이 같은 규칙으로 묶어 주고 있어 «보이는 결과»는 멀쩡했지만,
//   DB 를 직접 조회하면 두 갈래로 나온다. 그래서 들어올 때 한 번 다듬어 둔다.
//
// ⚠ 공백만 다듬는다. 대소문자·글자는 손대지 않는다 — 업무명은 사람이 적은 그대로가 사실이다.
// 업무명의 «공백 모양» 을 하나로 맞춘다 — 앞뒤를 떼고 연속 공백은 한 칸으로.
//
// 🔑 업무 기록을 «저장할 때» 와 Jira 업무명을 «담을 때» 가 반드시 같은 규칙이어야 한다.
//    한쪽만 누르면 «고르는 값» 과 «저장되는 값» 이 달라져 같은 업무가 두 줄로 갈라진다.
//    실제로 그랬다 — 수동 추가 업무 이름에 두 칸이 들어가 있었는데 저장만 눌러서,
//    한 업무가 「한 칸 56건 / 두 칸 45건」 으로 나뉘어 집계됐다 (2026-08-24 정리).
function normalizeWorkText(s) {
  return s == null ? s : String(s).trim().replace(/\s+/g, ' ')
}

app.post('/api/history/save', async (req, res) => {
  const { worker_id, worker_name, work_date, rows } = req.body
  if (!worker_id) {
    return res.status(400).json({ error: 'worker_id 가 필요합니다.' })
  }
  if (!canEditWorker(req.session, worker_id)) return denyOther(res)
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
        [worker_id, r.worker_name || worker_name, r.work_date, r.work_hour,
         normalizeWorkText(r.work_text)])
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
  // 손으로 적는 곳이라 공백이 겹치기 가장 쉽다. 실제로 여기서 들어간 두 칸 때문에
  // 한 업무가 두 줄로 갈라졌다 (normalizeWorkText 주석 참고).
  const full_text = normalizeWorkText(req.body?.full_text)
  const parent_text = normalizeWorkText(req.body?.parent_text)
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
      // 🔑 원인을 `cause` 로 달아 둔다. 사람에게 보여 줄 문구로 갈아 끼우면서
      //    원본을 버리면, 서버 로그에 「연결할 수 없습니다」만 남아 무엇 때문이었는지
      //    (DNS·인증서·타임아웃) 되짚을 방법이 사라진다.
      throw new Error(`Jira 서버에 연결할 수 없습니다 (${reason}).`, { cause: e })
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
    const epics = await searchJiraIssues(baseUrl, auth, 'issuetype=Epic', 'summary,status')

    // 하위 이슈 조회
    const children = await searchJiraIssues(
      baseUrl, auth, 'issuetype!=Epic AND parent is not EMPTY', 'summary,parent,status'
    )

    // 상태는 «분류(statusCategory.key)» 로 판정한다. 표시 이름(「완료」·「검토 중」)은
    // 프로젝트 설정에 따라 바뀔 수 있어 그것으로 거르면 조용히 어긋난다.
    const statusOf = i => ({
      status_name:     i.fields.status?.name ?? null,
      status_category: i.fields.status?.statusCategory?.key ?? null
    })

    const allIssues = [
      // full_text 는 업무 기록에 그대로 저장되는 값이다. 기록을 저장할 때와 «같은 규칙» 으로
      // 공백을 눌러야 고르는 값과 저장되는 값이 어긋나지 않는다 (normalizeWorkText 주석 참고).
      ...epics.map(i => ({
        jira_key:   i.key,
        summary:    i.fields.summary,
        parent_key: null,
        full_text:  normalizeWorkText(`[${i.key}] ${i.fields.summary}`),
        ...statusOf(i)
      })),
      ...children.map(i => ({
        jira_key:   i.key,
        summary:    i.fields.summary,
        parent_key: i.fields.parent?.key ?? null,
        full_text:  normalizeWorkText(`[${i.key}] ${i.fields.summary}`),
        ...statusOf(i)
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
      const COLS = 6
      for (let start = 0; start < uniqueIssues.length; start += CHUNK_SIZE) {
        const chunk = uniqueIssues.slice(start, start + CHUNK_SIZE)
        const placeholders = chunk.map((_, n) => {
          const base = n * COLS
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`
        })
        const values = chunk.flatMap(i =>
          [i.jira_key, i.summary, i.parent_key, i.full_text, i.status_name, i.status_category])
        await client.query(
          `INSERT INTO jira_issues (jira_key, summary, parent_key, full_text, status_name, status_category)
           VALUES ${placeholders.join(', ')}
           ON CONFLICT (jira_key) DO UPDATE
           SET summary = EXCLUDED.summary,
               parent_key = EXCLUDED.parent_key,
               full_text = EXCLUDED.full_text,
               status_name = EXCLUDED.status_name,
               status_category = EXCLUDED.status_category`,
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

// 편도 일정의 방향(출발/복귀). 왕복이면 방향이 없으므로 «지운다» —
// 왕복으로 바꿔 놓고 옛 방향이 남아 있으면 달력에 「→ 현장」이 그대로 붙어 거짓말이 된다.
const ONE_WAY_DIRS = ['출발', '복귀']
function oneWayDir(roundTrip, value) {
  if (roundTrip) return null
  return ONE_WAY_DIRS.includes(value) ? value : null
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
      `SELECT v.*, w.name AS owner_name, aw.name AS assigned_worker_name
         FROM schedule_vehicles v
         LEFT JOIN workers w  ON w.id  = v.owner_worker_id
         LEFT JOIN workers aw ON aw.id = v.assigned_worker_id
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
// 🔴 2026-08-25: 여기에 지뢰가 있었다. 예전에는 본문에 «없는» 칸까지 그대로
//    `fuel_type = $3` 로 덮어써, 한 칸만 고치려고 부르면 나머지가 통째로 NULL 이
//    됐다. 실제로 Model Y 의 연료(전기)와 단가(100원/km)를 날렸다 —
//    단가는 정산 금액이 걸린 값이다.
//    🔑 **보낸 칸만 고친다.** 4번 문서 4.7절의 「수정 항목마다 경로를 나눈다」와
//       같은 이유이고, 칸이 늘어날수록 사고가 커지므로 여기서 아예 막는다.
//    ⚠ null 을 «명시해서» 보내면 지운다 — 「안 보냄」과 「비우기」는 다른 뜻이다.
const VEHICLE_PATCH_COLS = ['name', 'plate', 'fuel_type', 'rate_per_km',
                            'km_per_liter', 'memo', 'active', 'assigned_worker_id', 'color']

// 🔑 돈이 되는 두 칸은 «승인 권한자만» 고친다 (2026-08-25 신설).
//    rate_per_km  개인 사용 청구액 = 거리 × 이 값
//    km_per_liter 자차 환급 리터   = 거리 ÷ 이 값  (낮출수록 환급이 늘어난다)
//    그전에는 화면 자체가 없어 DB 로만 바꿀 수 있었는데, 설정 탭과 매뉴얼은
//    「정산 화면에서 대표이사만 고칠 수 있습니다」 라고 «없는 기능»을 안내하고 있었다.
const VEHICLE_MONEY_COLS = ['rate_per_km', 'km_per_liter']

app.patch('/api/schedule/vehicles/:id', async (req, res) => {
  const touchesMoney = VEHICLE_MONEY_COLS.some(c => c in req.body)
  if (touchesMoney && !await canApprove(req.session.uid)) {
    return res.status(403).json({ error: '단가·연비는 대표이사만 고칠 수 있습니다.' })
  }
  const sets = [], vals = []
  for (const col of VEHICLE_PATCH_COLS) {
    if (!(col in req.body)) continue                  // 안 보낸 칸은 손대지 않는다
    let v = req.body[col]
    if (col === 'name') {
      if (!v || !String(v).trim()) continue           // 이름은 비울 수 없다
      v = String(v).trim()
    } else if (col === 'color') {
      v = String(v || '').trim().toLowerCase()
      if (v && !/^#[0-9a-f]{6}$/.test(v)) {
        return res.status(400).json({ error: '색은 #rrggbb 형식이어야 합니다.' })
      }
      v = v || null                                   // 비우면 기본색으로 되돌아간다
    } else if (col === 'active') {
      v = !!v
    } else if (v === '' || v === undefined) {
      v = null                                        // 빈 칸은 «비우기» 로 읽는다
    }
    vals.push(v)
    sets.push(`${col} = $${vals.length}`)
  }
  if (!sets.length) return res.json({ ok: true })     // 바꿀 것이 없으면 그냥 통과
  vals.push(req.params.id)
  try {
    const { rowCount } = await pool.query(
      `UPDATE schedule_vehicles SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals
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
  SELECT p.*, w.name AS worker_name, w.team AS worker_team, w.email AS worker_email,
         pl.name AS place_name, pl.category AS place_category,
         v.name AS vehicle_name, v.plate AS vehicle_plate, v.kind AS vehicle_kind,
         v.assigned_worker_id AS vehicle_assigned_worker_id,
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
// 차량 알림 메일이 살아 있는가. 🔑설정 화면이 이걸 읽는다 —
// 비밀번호가 바뀌어 조용히 멈추는 것이 이 기능의 가장 큰 위험이다.
app.get('/api/schedule/mail-status', (req, res) => {
  res.json(mailer.lastResult())
})

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

// 일정 유형 세 가지 — business(업무) · personal(개인 사용) · vacation(휴가)
const USE_TYPES = ['business', 'personal', 'vacation']

app.post('/api/schedule/plans', async (req, res) => {
  const b = req.body
  if (!b.worker_id) return res.status(400).json({ error: '이름을 먼저 선택해 주세요.' })
  if (!canEditWorker(req.session, b.worker_id)) return denyOther(res)
  if (!b.plan_date) return res.status(400).json({ error: '날짜가 필요합니다.' })
  const useType = USE_TYPES.includes(b.use_type) ? b.use_type : 'business'
  // 개인 사용·휴가는 장소·용무를 받지 않는다.
  // 개인 사용은 사적인 행선지를 남기지 않기 위함이고(설계서 5.2절),
  // 휴가는 애초에 «어디서 일하는가» 가 없다.
  const keepPlace = useType === 'business'
  const placeId   = keepPlace ? (b.place_id ?? null) : null
  const placeText = keepPlace ? (b.place_text || null) : null
  const purpose   = keepPlace ? (b.purpose || null) : null
  const vacationType = useType === 'vacation' ? (b.vacation_type || null) : null
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
    const roundTrip = b.round_trip === undefined ? true : !!b.round_trip
    // 휴가는 등록하는 순간 «신청» 이 된다. 업무 일정은 승인 제도 밖이라 NULL 로 둔다.
    const approval = useType === 'vacation' ? 'pending' : null
    const { rows } = await pool.query(
      `INSERT INTO schedule_plans
         (worker_id, plan_date, slot, start_time, end_time, use_type,
          place_id, place_text, purpose, transport, vehicle_id,
          est_distance_km, est_travel_min, round_trip, vacation_type, one_way_dir, approval)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [b.worker_id, b.plan_date, b.slot || 'allday', b.start_time || null, b.end_time || null,
       useType, placeId, placeText, purpose, b.transport || 'office', b.vehicle_id ?? null,
       b.est_distance_km ?? null, b.est_travel_min ?? null,
       roundTrip, vacationType, oneWayDir(roundTrip, b.one_way_dir), approval]
    )
    // 🔑 차량 알림 — 저장은 이미 끝났다. 메일은 «덤» 이라 await 하지 않는다.
    //    이름(차량·장소·직원)이 붙은 줄이 필요해 조회용 SELECT 로 한 번 더 읽는다.
    notifyVehicle('create', rows[0].id, req, b.batch_id, b.conflicts_ack)
    // 휴가 신청 알림 — 🔑 「보낼까요?」는 «화면» 이 묻는다(사용자 지시). 그 답이 b.notify 다.
    //    ⚠ 안 보내기로 했어도 신청 자체는 그대로 남는다. 메일은 알림일 뿐 신청서가 아니다.
    if (useType === 'vacation' && b.notify !== false) {
      notifyVacationPlan('request', rows[0].id, req, b.batch_id)
    }
    res.json(rows[0])
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 알림용으로 «이름까지 붙은» 계획 한 줄을 읽어 mailer 에 넘긴다.
// ⚠ 실패해도 삼킨다 — 알림 때문에 예약이 흔들리면 안 된다.
async function notifyVehicle(kind, planId, req, batchId, conflicts) {
  try {
    if (!mailer.isEnabled()) return
    const { rows } = await pool.query(`${PLAN_SELECT} WHERE p.id = $1`, [planId])
    if (!rows.length) return
    mailer.notify({
      kind,
      plans: rows[0],
      conflicts,
      batchId,
      // 답장은 «등록한 사람» 에게 간다. session.login 이 회사 메일 주소다.
      actor: { name: req.session?.name, email: req.session?.login },
    })
  } catch (e) {
    console.error(`[mail] notifyVehicle(${kind}) :: ${e.message}`)
  }
}

// 휴가 알림용으로 «이름까지 붙은» 계획 한 줄을 읽어 mailer 에 넘긴다.
// ⚠ 실패해도 삼킨다 — 알림 때문에 신청이 흔들리면 안 된다.
async function notifyVacationPlan(kind, planId, req, batchId) {
  try {
    if (!mailer.isEnabled()) return
    const { rows } = await pool.query(`${PLAN_SELECT} WHERE p.id = $1`, [planId])
    if (!rows.length) return
    mailer.notifyVacation({
      kind, plans: rows[0], batchId,
      actor: { name: req.session?.name, email: req.session?.login },
    })
  } catch (e) {
    console.error(`[mail] notifyVacationPlan(${kind}) :: ${e.message}`)
  }
}

app.patch('/api/schedule/plans/:id', async (req, res) => {
  const b = req.body
  try {
    const { rows: cur } = await pool.query('SELECT * FROM schedule_plans WHERE id = $1', [req.params.id])
    if (cur.length === 0) return res.status(404).json({ error: '해당 계획을 찾을 수 없습니다.' })
    if (!canEditWorker(req.session, cur[0].worker_id)) return denyOther(res)
    const useType = b.use_type ?? cur[0].use_type
    const keepPlace = useType === 'business'
    const { rowCount } = await pool.query(
      `UPDATE schedule_plans
          SET plan_date = COALESCE($1, plan_date), slot = COALESCE($2, slot),
              start_time = $3, end_time = $4, use_type = $5,
              place_id = $6, place_text = $7, purpose = $8,
              transport = COALESCE($9, transport), vehicle_id = $10,
              est_distance_km = $11, est_travel_min = $12,
              round_trip = COALESCE($13, round_trip),
              status = COALESCE($14, status), vacation_type = $15,
              one_way_dir = $17, updated_at = now()
        WHERE id = $16`,
      [b.plan_date || null, b.slot || null, b.start_time || null, b.end_time || null, useType,
       keepPlace ? (b.place_id ?? cur[0].place_id) : null,
       keepPlace ? (b.place_text ?? cur[0].place_text) : null,
       keepPlace ? (b.purpose ?? cur[0].purpose) : null,
       b.transport || null, b.vehicle_id ?? cur[0].vehicle_id,
       b.est_distance_km ?? cur[0].est_distance_km,
       b.est_travel_min ?? cur[0].est_travel_min,
       b.round_trip === undefined ? null : !!b.round_trip,
       b.status || null,
       useType === 'vacation' ? (b.vacation_type ?? cur[0].vacation_type) : null,
       req.params.id,
       // 왕복 여부를 안 보냈으면 원래 값을 기준으로 방향을 판정한다.
       oneWayDir(b.round_trip === undefined ? cur[0].round_trip : !!b.round_trip,
                 b.one_way_dir === undefined ? cur[0].one_way_dir : b.one_way_dir)]
    )
    if (rowCount === 0) return res.status(404).json({ error: '해당 계획을 찾을 수 없습니다.' })
    // 고친 뒤의 모습으로 알린다. 차량이 빠졌으면 mailer 가 알아서 거른다.
    notifyVehicle('update', req.params.id, req)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.delete('/api/schedule/plans/:id', async (req, res) => {
  try {
    const { rows: own } = await pool.query(
      'SELECT worker_id FROM schedule_plans WHERE id = $1', [req.params.id]
    )
    if (own.length === 0) return res.status(404).json({ error: '해당 계획을 찾을 수 없습니다.' })
    if (!canEditWorker(req.session, own[0].worker_id)) return denyOther(res)
    const { rows } = await pool.query(
      'SELECT locked FROM schedule_actuals WHERE plan_id = $1', [req.params.id]
    )
    if (rows.some(r => r.locked)) {
      return res.status(409).json({ error: '정산이 완료된 달의 기록은 지울 수 없습니다.' })
    }
    // 🔑 지우기 «전에» 읽어 둔다. 지운 뒤에는 무엇을 취소했는지 알 길이 없다.
    let doomed = null
    try {
      if (mailer.isEnabled()) {
        const { rows: r } = await pool.query(`${PLAN_SELECT} WHERE p.id = $1`, [req.params.id])
        doomed = r[0] || null
      }
    } catch { /* 알림용이라 실패해도 삭제는 그대로 진행한다 */ }

    await pool.query('DELETE FROM schedule_actuals WHERE plan_id = $1', [req.params.id])
    const { rowCount } = await pool.query('DELETE FROM schedule_plans WHERE id = $1', [req.params.id])
    if (rowCount === 0) return res.status(404).json({ error: '해당 계획을 찾을 수 없습니다.' })
    if (doomed) {
      const actor = { name: req.session?.name, email: req.session?.login }
      if (doomed.use_type === 'vacation') {
        // 🔑 휴가 취소는 «신청을 물린다» 는 뜻이라 대표이사에게 알려야 한다.
        //    ⚠ 이미 반려된 건은 알리지 않는다 — 대표이사가 이미 아는 일이고,
        //    반려당한 사람이 그 줄을 지웠다고 다시 메일이 가면 성가시기만 하다.
        if (doomed.approval !== 'rejected') {
          mailer.notifyVacation({ kind: 'cancel', plans: doomed, actor })
        }
      } else {
        mailer.notify({ kind: 'delete', plans: doomed, actor })
      }
    }
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── 휴가 승인 (2026-08-26 신설) ──────────────────────────────
// 🔑 승인 권한은 새 칸을 파지 않고 `can_approve_settlement` 를 그대로 쓴다.
//    「대표이사인가」를 묻는 칸이 둘이 되면 언젠가 어긋난다.
app.patch('/api/schedule/plans/:id/approval', async (req, res) => {
  const want = String(req.body?.approval || '')
  const reason = String(req.body?.reject_reason || '').trim() || null
  if (!['approved', 'rejected'].includes(want)) {
    return res.status(400).json({ error: '승인 또는 반려만 할 수 있습니다.' })
  }
  try {
    if (!await canApprove(req.session.uid)) {
      return res.status(403).json({ error: '휴가 승인은 대표이사만 할 수 있습니다.' })
    }
    const { rows } = await pool.query(`${PLAN_SELECT} WHERE p.id = $1`, [req.params.id])
    if (!rows.length) return res.status(404).json({ error: '해당 계획을 찾을 수 없습니다.' })
    if (rows[0].use_type !== 'vacation') {
      return res.status(400).json({ error: '휴가만 승인할 수 있습니다.' })
    }
    // 🔑 반려는 «왜» 를 함께 받는다. 이유 없는 반려는 결국 말로 다시 물어보게 되고,
    //    그러면 기록이 남지 않아 승인 제도를 둔 뜻이 없어진다.
    if (want === 'rejected' && !reason) {
      return res.status(400).json({ error: '반려 사유를 적어 주세요.' })
    }
    await pool.query(
      `UPDATE schedule_plans
          SET approval = $1, approved_at = now(), approved_by_id = $2,
              reject_reason = $3, updated_at = now()
        WHERE id = $4`,
      [want, req.session.uid, want === 'rejected' ? reason : null, req.params.id])
    notifyVacationResult(want, req.params.id, req, reason)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 승인·반려 결과는 «신청한 사람» 에게 알린다.
// ⚠ 회사 메일 주소가 없는 직원이면 보낼 곳이 없다. 그때는 조용히 넘기지 않고 로그에 남긴다 —
//   「보냈겠지」 하고 넘어가면 당사자만 결과를 모른 채로 남는다.
async function notifyVacationResult(kind, planId, req, reason) {
  try {
    if (!mailer.isEnabled()) return
    const { rows } = await pool.query(`${PLAN_SELECT} WHERE p.id = $1`, [planId])
    if (!rows.length) return
    const to = rows[0].worker_email
    if (!to) {
      console.warn(`[mail] vacation ${kind}: ${rows[0].worker_name} 님의 메일 주소가 없어 못 보냄 (plan#${planId})`)
      return
    }
    mailer.notifyVacation({
      kind, plans: rows[0], to, reason,
      actor: { name: req.session?.name, email: req.session?.login },
    })
  } catch (e) {
    console.error(`[mail] notifyVacationResult(${kind}) :: ${e.message}`)
  }
}

// ── 연차 부여·사용·잔여 (2026-08-26 신설) ────────────────────
// 근로기준법 60조 기준.
//   1년 미만  : 1개월 개근마다 1일 (최대 11일)
//   1년 이상  : 15일
//   3년 이상  : 15 + (근속연수 − 1) ÷ 2 의 몫,  상한 25일
// ⚠ 「개근」은 시스템이 판단하지 않는다. 결근 데이터가 없어 «개근한 것으로 보고» 센다.
//   1년 미만인 사람이 결근한 달이 있으면 실제보다 많게 나온다 — 화면에 이 단서를 적는다.
function annualLeaveDays(hiredAt, on) {
  if (!hiredAt) return null                      // 입사일이 없으면 셀 수 없다. 0 이 아니라 «모름» 이다
  const h = new Date(`${String(hiredAt).slice(0, 10)}T00:00:00`)
  const d = new Date(`${on}T00:00:00`)
  if (d < h) return 0
  let years = d.getFullYear() - h.getFullYear()
  const before = (d.getMonth() < h.getMonth())
    || (d.getMonth() === h.getMonth() && d.getDate() < h.getDate())
  if (before) years -= 1
  if (years < 1) {
    let months = (d.getFullYear() - h.getFullYear()) * 12 + (d.getMonth() - h.getMonth())
    if (d.getDate() < h.getDate()) months -= 1
    return Math.max(0, Math.min(11, months))
  }
  return Math.min(25, 15 + Math.floor((years - 1) / 2))
}

// 그 사람의 «올해 연차 연도» — 입사일 기준으로 센다(법정 원칙).
function leaveYearRange(hiredAt, on) {
  if (!hiredAt) return null
  const h = new Date(`${String(hiredAt).slice(0, 10)}T00:00:00`)
  const d = new Date(`${on}T00:00:00`)
  let start = new Date(d.getFullYear(), h.getMonth(), h.getDate())
  if (start > d) start = new Date(d.getFullYear() - 1, h.getMonth(), h.getDate())
  const end = new Date(start.getFullYear() + 1, start.getMonth(), start.getDate())
  end.setDate(end.getDate() - 1)
  const fmt = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  return { from: fmt(start), to: fmt(end) }
}

app.get('/api/schedule/vacation-summary', async (req, res) => {
  try {
    const on = /^\d{4}-\d{2}-\d{2}$/.test(req.query.on || '') ? req.query.on : todayLocal()
    // 🔴 남의 연차는 관리자만 본다. 본인 것은 누구나 본다.
    const isAdmin = req.session?.role === 'admin'
    const myWorkerId = req.session?.workerId ?? null

    const { rows: workers } = await pool.query(
      'SELECT id, name, hired_at FROM workers WHERE active ORDER BY name')
    const targets = isAdmin ? workers : workers.filter(w => w.id === myWorkerId)

    const out = []
    for (const w of targets) {
      const range = leaveYearRange(w.hired_at, on)
      const granted = annualLeaveDays(w.hired_at, on)
      let used = 0, waiting = 0, byType = {}, rows = []
      if (range) {
        const { rows: vac } = await pool.query(
          `SELECT plan_date, slot, vacation_type, approval
             FROM schedule_plans
            WHERE worker_id = $1 AND use_type = 'vacation'
              AND plan_date >= $2 AND plan_date <= $3
              AND (approval IS NULL OR approval <> 'rejected')
            ORDER BY plan_date`,
          [w.id, range.from, range.to])
        rows = vac
        for (const v of vac) {
          const days = mailer.vacDays(v)
          byType[v.vacation_type || '기타'] = (byType[v.vacation_type || '기타'] || 0) + days
          // 🔑 «연차» 만 잔여에서 깎는다. 병가·포상·기타는 세어 보여만 준다.
          if (v.vacation_type !== '연차') continue
          // 🔑 「쓴 것」과 「기다리는 것」을 갈라 센다. 대기 중인 신청을 «사용» 이라 부르면
          //    아직 승인도 안 났는데 쓴 것처럼 읽힌다. 다만 잔여에서는 «둘 다» 뺀다 —
          //    신청해 둔 날을 남은 것으로 세면 결국 있지도 않은 연차를 또 신청하게 된다.
          if (v.approval === 'pending') waiting += days
          else used += days
        }
      }
      const round1 = n => Math.round(n * 10) / 10
      out.push({
        worker_id: w.id, name: w.name, hired_at: w.hired_at,
        range, granted, used: round1(used), waiting: round1(waiting),
        remaining: granted == null ? null : round1(granted - used - waiting),
        by_type: byType, rows,
      })
    }
    // 승인 대기 목록. 🔑 승인할 수 있는 사람에게만 내려보낸다 —
    //    못 누르는 사람에게 보여 주면 「왜 안 눌리지」 만 남는다.
    const canApproveNow = await canApprove(req.session.uid)
    let pending = []
    if (canApproveNow) {
      const { rows: pend } = await pool.query(
        `${PLAN_SELECT} WHERE p.approval = 'pending' ORDER BY p.plan_date ASC, w.name ASC`)
      pending = pend
    }
    res.json({
      on, scope: isAdmin ? 'all' : 'me', items: out,
      can_approve: canApproveNow, pending,
    })
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

// 보고 결과를 실적에 적는다. 「보냈다」와 「왜 안 보냈다」를 한 쌍으로 남긴다.
const markReport = (id, at, skip) => pool.query(
  'UPDATE schedule_actuals SET reported_at = $1, report_skip = $2 WHERE id = $3',
  [at, skip, id])

// 완료 보고 메일용으로 «이름까지 붙은» 실적 한 줄을 읽어 mailer 에 넘긴다.
// ⚠ 실패해도 삼킨다 — 보고 때문에 완료 처리가 흔들리면 안 된다.
async function notifyDone(actualId, req) {
  try {
    const { rows } = await pool.query(
      `SELECT a.*, w.name AS worker_name,
              pl.name AS place_name,
              v.name AS vehicle_name, v.plate AS vehicle_plate
         FROM schedule_actuals a
         LEFT JOIN workers w           ON w.id  = a.worker_id
         LEFT JOIN schedule_places pl  ON pl.id = a.place_id
         LEFT JOIN schedule_vehicles v ON v.id  = a.vehicle_id
        WHERE a.id = $1`, [actualId])
    if (!rows.length) return
    const a = rows[0]

    // 🔑 «당일에 처리한 것만» 보고한다 (2026-08-26 사용자 결정).
    //    늦게 넣은 것은 보내는 대신 «누락» 으로 적는다. 지우지 않고 적는 이유는,
    //    안 보낸 사실이 어디에도 없으면 「보고가 없었다」와 「일을 안 했다」를
    //    구분할 수 없기 때문이다. 나중에 KPI 가 이 칸을 세어 누락 건수를 낸다.
    // ⚠ 출장처럼 늦게 복귀해 늦어진 것은 감점 대상이 아니다(사용자 방침).
    //    그 판정은 KPI 쪽에서 transport·use_type 을 보고 한다 — 여기서는 사실만 적는다.
    if (String(a.work_date) !== todayLocal()) {
      await markReport(actualId, null, 'late')
      console.log(`[mail] skip(late) actual#${actualId} :: work_date ${a.work_date}`)
      return
    }
    if (!mailer.isEnabled()) { await markReport(actualId, null, 'mail_off'); return }

    // 답장은 «처리한 사람» 에게 간다. session.login 이 회사 메일 주소다.
    mailer.notifyDone({
      actual: a,
      actor: { name: req.session?.name, email: req.session?.login },
      onResult: ok => markReport(actualId, ok ? new Date() : null, ok ? null : 'failed')
        .catch(e => console.error(`[mail] markReport(${actualId}) :: ${e.message}`)),
    })
  } catch (e) {
    console.error(`[mail] notifyDone :: ${e.message}`)
  }
}

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
    // 계획에 붙는 실적이면 «계획의 주인» 을 본다. 본문의 worker_id 를 믿으면
    // 남의 계획에 자기 번호를 붙여 보내는 것으로 통과된다.
    if (!canEditWorker(req.session, base.worker_id ?? workerId)) return denyOther(res)
    const useType  = b.use_type ?? base.use_type ?? 'business'
    const keepPlace = useType === 'business'
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
       keepPlace ? (b.place_id ?? base.place_id ?? null) : null,
       keepPlace ? (b.place_text ?? base.place_text ?? null) : null,
       keepPlace ? (b.purpose ?? base.purpose ?? null) : null,
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
    // 🔑 작업 완료 보고는 화면이 아니라 «여기» 에 건다 (2026-08-26 신설).
    //    「계획대로 완료」는 차량·대중교통이면 실적 창을 열고 아니면 그 자리에서
    //    처리하는 두 갈래인데, 둘 다 결국 이 API 로 모인다. 화면 두 곳에 각각
    //    걸면 한쪽을 조용히 빠뜨린다 — 배차표 필터에서 이미 겪은 종류의 실수다.
    notifyDone(rows[0].id, req)
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
    if (!canEditWorker(req.session, cur[0].worker_id)) return denyOther(res)
    // 정산이 끝난 달은 고칠 수 없다. 승인 금액과 근거가 어긋나기 때문이다.
    // 정정이 필요하면 대표이사가 잠금을 풀고 재승인한다 (설계서 3.3절)
    if (cur[0].locked) {
      return res.status(409).json({ error: '정산이 완료된 달의 기록입니다. 수정하려면 대표이사가 잠금을 해제해야 합니다.' })
    }
    const useType  = b.use_type ?? cur[0].use_type
    const keepPlace = useType === 'business'
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
       keepPlace ? (b.place_id ?? cur[0].place_id) : null,
       keepPlace ? (b.place_text ?? cur[0].place_text) : null,
       keepPlace ? (b.purpose ?? cur[0].purpose) : null,
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
    const { rows } = await pool.query('SELECT locked, plan_id, worker_id FROM schedule_actuals WHERE id = $1', [req.params.id])
    if (rows.length === 0) return res.status(404).json({ error: '해당 실적을 찾을 수 없습니다.' })
    if (!canEditWorker(req.session, rows[0].worker_id)) return denyOther(res)
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

// ─── 로그인 ──────────────────────────────────────────────────
// 2026-08-21 부터 화면 «전체» 가 로그인 뒤에 있다 (그 전에는 정산 화면만 막았다).
// 게이트는 파일 맨 위 app.use 에 있고, 여기는 로그인·로그아웃·상태 조회만 둔다.
//
// ⚠ 계정과 세션을 KPI 추적 시스템(:8083)과 «그대로 공유» 한다.
//    - 계정: kpi_users (같은 DB). 새로 만들면 두 벌이 되어 반드시 어긋난다
//    - 세션: 같은 SESSION_SECRET + 같은 쿠키 이름 → KPI 에서 로그인하면 여기서도 통한다
//    그래서 해시 검증·토큰 형식을 KPI 구현과 «똑같이» 맞춰야 한다. 임의로 바꾸면
//    한쪽에서 만든 쿠키를 다른 쪽이 읽지 못한다.
const crypto = require('crypto')
const SESSION_COOKIE = 'kpi_session'
const SESSION_HOURS = 12
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex')
if (!process.env.SESSION_SECRET) {
  console.warn('경고: SESSION_SECRET 이 없어 임시 값을 씁니다. KPI 로그인이 이 서버에서 통하지 않습니다.')
}

// 저장 형식: scrypt$<salt hex>$<key hex>  (KPI 와 동일)
function verifyPassword(plain, stored) {
  const [algo, saltHex, keyHex] = String(stored || '').split('$')
  if (algo !== 'scrypt' || !saltHex || !keyHex) return false
  const expected = Buffer.from(keyHex, 'hex')
  const actual = crypto.scryptSync(plain, Buffer.from(saltHex, 'hex'), expected.length)
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

function readToken(token) {
  const [body, sig] = String(token || '').split('.')
  if (!body || !sig) return null
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url')
  if (sig.length !== expected.length) return null
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString())
    return payload.exp > Date.now() ? payload : null
  } catch { return null }
}

function makeToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url')
  return `${body}.${sig}`
}

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

function sessionOf(req) { return readToken(readCookie(req, SESSION_COOKIE)) }

function requireLogin(req, res, next) {
  const session = sessionOf(req)
  if (!session) return res.status(401).json({ error: '로그인이 필요합니다.' })
  req.session = session
  next()
}

// ─── 「내 것만 수정」 판정 ────────────────────────────────────
// 2026-08-21 결정. 업무 기록과 스케줄(계획·실적)은 본인만 고칠 수 있다.
// 관리자(role='admin')는 대신 적어 줄 수 있게 통과시킨다 — 장기 부재자의 기록을
// 넣어 주거나 잘못 들어간 것을 고칠 길이 없으면 운영이 막힌다.
//
// 🔑 수정·삭제는 «본문» 이 아니라 «DB 에 저장된 worker_id» 로 판정해야 한다.
//    본문 값을 믿으면 남의 계획을 열어 자기 번호를 적어 보내는 것으로 뚫린다.
function isAdmin(session) { return session?.role === 'admin' }

function canEditWorker(session, workerId) {
  if (isAdmin(session)) return true
  if (workerId == null) return false
  return Number(session?.workerId) === Number(workerId)
}

function denyOther(res) {
  return res.status(403).json({ error: '남의 기록은 수정할 수 없습니다.' })
}

// 정산 승인 권한. kpi_users.role 에 새 등급을 만들지 않고 «허가» 컬럼으로 둔 이유는
// 이 표를 KPI 와 함께 쓰기 때문이다 — KPI 가 모르는 role 값이 들어가면 그 계정이
// 권한 없는 사용자로 취급될 수 있다(설계서 4.2절).
async function canApprove(uid) {
  const { rows } = await pool.query(
    'SELECT can_approve_settlement FROM kpi_users WHERE id = $1 AND active', [uid])
  return !!rows[0]?.can_approve_settlement
}

app.post('/api/auth/login', async (req, res) => {
  const loginId = String(req.body?.login_id || '').trim().toLowerCase()
  const password = String(req.body?.password || '')
  if (!loginId || !password) {
    return res.status(400).json({ error: '아이디와 비밀번호를 입력해 주세요.' })
  }
  try {
    const { rows } = await pool.query(
      'SELECT * FROM kpi_users WHERE lower(login_id) = $1 AND active', [loginId])
    const user = rows[0]
    // 아이디가 없는 것과 비밀번호가 틀린 것을 구분해 알리지 않는다(계정 탐색 방지).
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' })
    }
    const payload = {
      uid: user.id, login: user.login_id, name: user.display_name,
      role: user.role, workerId: user.worker_id,
      mustChange: user.must_change_password,
      exp: Date.now() + SESSION_HOURS * 3600 * 1000
    }
    // Secure 는 붙이지 않는다 — 사내망 http 라 붙이면 쿠키가 저장되지 않는다.
    res.setHeader('Set-Cookie',
      `${SESSION_COOKIE}=${makeToken(payload)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}`)
    await pool.query('UPDATE kpi_users SET last_login_at = now() WHERE id = $1', [user.id])
    res.json({
      login_id: user.login_id, name: user.display_name, role: user.role,
      worker_id: user.worker_id, must_change_password: user.must_change_password,
      can_approve: await canApprove(user.id),
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`)
  res.json({ ok: true })
})

// 화면이 «지금 로그인 상태인가» 를 물어보는 곳. 로그인 안 했으면 401 이 아니라
// {logged_in:false} 를 준다 — 정산 화면에 들어가기 전에 조용히 확인해야 하기 때문이다.
app.get('/api/auth/me', async (req, res) => {
  const session = sessionOf(req)
  if (!session) return res.json({ logged_in: false })
  try {
    res.json({
      logged_in: true, login_id: session.login, name: session.name,
      role: session.role, worker_id: session.workerId,
      must_change_password: session.mustChange,
      can_approve: await canApprove(session.uid),
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── 정산 ────────────────────────────────────────────────────
// 실적을 월별로 모아 «직원이 회사에 낼 돈» 과 «회사가 직원에게 줄 것» 을 계산한다.
//   직원 → 회사 : 법인차 개인 사용 = 주행거리 × 차량 단가 + 하이패스
//   회사 → 직원 : 자차 업무 주행 = 거리 ÷ 연비 = 주유 한도(리터) / 대중교통 실비
// 계산식은 현행 정산기준 문서를 그대로 따른다(설계서 3장).

function ymRange(ym) {
  const [y, m] = String(ym).split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return [`${ym}-01`, `${ym}-${String(last).padStart(2, '0')}`]
}

async function buildSettlement(ym) {
  const [from, to] = ymRange(ym)
  const { rows } = await pool.query(
    `SELECT a.*, w.name AS worker_name, w.team AS worker_team,
            v.kind AS vehicle_kind, v.name AS vehicle_name, v.plate AS vehicle_plate,
            v.rate_per_km, v.km_per_liter
       FROM schedule_actuals a
       LEFT JOIN workers w           ON w.id = a.worker_id
       LEFT JOIN schedule_vehicles v ON v.id = a.vehicle_id
      WHERE a.work_date >= $1 AND a.work_date <= $2
      ORDER BY a.work_date ASC`, [from, to])

  const byWorker = new Map()
  const byVehicle = new Map()

  for (const r of rows) {
    const km = Number(r.distance_km || 0)
    // ── 사람별 ──
    if (!byWorker.has(r.worker_id)) {
      byWorker.set(r.worker_id, {
        worker_id: r.worker_id, worker_name: r.worker_name, team: r.worker_team,
        personal_km: 0, personal_amount: 0, toll_amount: 0,
        own_car_km: 0, own_car_liter: 0, own_car_missing_efficiency: false,
        transit_amount: 0, business_km: 0, fuel_amount: 0, rows: [],
      })
    }
    const w = byWorker.get(r.worker_id)
    if (r.use_type === 'personal') {
      w.personal_km += km
      // 단가가 없으면 청구액을 0 으로 두고 «단가 없음» 을 화면에서 알린다
      w.personal_amount += Math.round(km * Number(r.rate_per_km || 0))
      w.toll_amount += Number(r.toll_fee || 0)
    } else if (r.use_type === 'business') {
      w.business_km += km
      w.fuel_amount += Number(r.fuel_fee || 0)
      w.transit_amount += Number(r.transit_fee || 0)
      if (r.vehicle_kind === 'own') {
        w.own_car_km += km
        if (r.km_per_liter) w.own_car_liter += km / Number(r.km_per_liter)
        else if (km > 0) w.own_car_missing_efficiency = true
      }
    }
    w.rows.push({
      id: r.id, work_date: r.work_date, use_type: r.use_type,
      distance_km: km, toll_fee: r.toll_fee, fuel_fee: r.fuel_fee,
      transit_fee: r.transit_fee, vehicle_name: r.vehicle_name,
      vehicle_kind: r.vehicle_kind, memo: r.memo, locked: r.locked,
    })

    // ── 차량별 ──
    if (r.vehicle_id) {
      if (!byVehicle.has(r.vehicle_id)) {
        byVehicle.set(r.vehicle_id, {
          vehicle_id: r.vehicle_id, name: r.vehicle_name, plate: r.vehicle_plate,
          kind: r.vehicle_kind, total_km: 0, business_km: 0, personal_km: 0,
          toll_amount: 0, fuel_amount: 0,
        })
      }
      const v = byVehicle.get(r.vehicle_id)
      v.total_km += km
      if (r.use_type === 'personal') v.personal_km += km
      else v.business_km += km
      v.toll_amount += Number(r.toll_fee || 0)
      v.fuel_amount += Number(r.fuel_fee || 0)
    }
  }

  const workers = [...byWorker.values()].map(w => ({
    ...w,
    personal_km: Math.round(w.personal_km * 10) / 10,
    business_km: Math.round(w.business_km * 10) / 10,
    own_car_km: Math.round(w.own_car_km * 10) / 10,
    own_car_liter: Math.round(w.own_car_liter * 100) / 100,
    // 회사에 낼 돈 = 개인 사용 거리 × 단가 + 하이패스
    charge_total: w.personal_amount + w.toll_amount,
  })).sort((a, b) => String(a.worker_name).localeCompare(String(b.worker_name), 'ko'))

  // 계획 대비 실적 현황 — 화면이 「왜 비어 있는지」를 설명할 수 있게 한다.
  //   pending  지난 날짜인데 실적이 없는 계획 → 지금 넣을 수 있다
  //   upcoming 아직 오지 않은 계획 → 다녀온 뒤에 넣는다
  const { rows: planRows } = await pool.query(
    `SELECT p.id, p.plan_date, p.use_type, p.transport, p.vehicle_id,
            w.name AS worker_name, pl.name AS place_name, p.place_text,
            v.name AS vehicle_name,
            (a.id IS NOT NULL) AS has_actual
       FROM schedule_plans p
       LEFT JOIN workers w            ON w.id  = p.worker_id
       LEFT JOIN schedule_places pl   ON pl.id = p.place_id
       LEFT JOIN schedule_vehicles v  ON v.id  = p.vehicle_id
       LEFT JOIN schedule_actuals a   ON a.plan_id = p.id
      WHERE p.plan_date >= $1 AND p.plan_date <= $2 AND p.status <> 'canceled'
      ORDER BY p.plan_date ASC`, [from, to])
  const td = todayLocal()
  const missing = planRows.filter(p => !p.has_actual)

  return {
    ym, from, to,
    plan_count: planRows.length,
    pending: missing.filter(p => p.plan_date <= td),
    upcoming_count: missing.filter(p => p.plan_date > td).length,
    workers,
    vehicles: [...byVehicle.values()].map(v => ({
      ...v,
      total_km: Math.round(v.total_km * 10) / 10,
      business_km: Math.round(v.business_km * 10) / 10,
      personal_km: Math.round(v.personal_km * 10) / 10,
    })),
    actual_count: rows.length,
  }
}

app.get('/api/schedule/settlement', requireLogin, async (req, res) => {
  const ym = String(req.query.ym || '')
  if (!/^\d{4}-\d{2}$/.test(ym)) return res.status(400).json({ error: 'ym 은 YYYY-MM 형식이어야 합니다.' })
  try {
    const calc = await buildSettlement(ym)
    // 저장된 정산 상태(승인 여부·승인 시점 금액)를 함께 준다
    const { rows: saved } = await pool.query(
      `SELECT s.*, u.display_name AS settled_by_name
         FROM schedule_settlements s
         LEFT JOIN kpi_users u ON u.id = s.settled_by
        WHERE s.ym = $1`, [ym])
    res.json({
      ...calc,
      saved,
      can_approve: await canApprove(req.session.uid),
      me: { worker_id: req.session.workerId, name: req.session.name, role: req.session.role },
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 정산 확정 — 대표이사만. 그 달 금액을 «승인 시점 값으로 박아» 두고 실적을 잠근다.
// 나중에 단가나 연비가 바뀌어도 지난 정산액이 흔들리지 않게 하려는 것이다.
app.post('/api/schedule/settlement/:ym/approve', requireLogin, async (req, res) => {
  const ym = req.params.ym
  if (!/^\d{4}-\d{2}$/.test(ym)) return res.status(400).json({ error: 'ym 형식이 올바르지 않습니다.' })
  if (!await canApprove(req.session.uid)) {
    return res.status(403).json({ error: '정산 승인 권한이 없습니다. 대표이사만 승인할 수 있습니다.' })
  }
  const client = await pool.connect()
  try {
    const calc = await buildSettlement(ym)
    await client.query('BEGIN')
    for (const w of calc.workers) {
      await client.query(
        `INSERT INTO schedule_settlements
           (ym, worker_id, personal_km, personal_amount, toll_amount,
            own_car_km, own_car_liter, transit_amount, status, settled_by, settled_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'settled',$9,now())
         ON CONFLICT (ym, worker_id) DO UPDATE
         SET personal_km=EXCLUDED.personal_km, personal_amount=EXCLUDED.personal_amount,
             toll_amount=EXCLUDED.toll_amount, own_car_km=EXCLUDED.own_car_km,
             own_car_liter=EXCLUDED.own_car_liter, transit_amount=EXCLUDED.transit_amount,
             status='settled', settled_by=EXCLUDED.settled_by, settled_at=now(),
             updated_at=now()`,
        [ym, w.worker_id, w.personal_km, w.personal_amount, w.toll_amount,
         w.own_car_km, w.own_car_liter, w.transit_amount, req.session.uid])
    }
    // 그 달 실적을 잠근다 — 승인 금액과 근거가 어긋나지 않게 한다
    const [from, to] = ymRange(ym)
    const { rowCount } = await client.query(
      'UPDATE schedule_actuals SET locked = TRUE WHERE work_date >= $1 AND work_date <= $2',
      [from, to])
    await client.query('COMMIT')
    res.json({ ok: true, workers: calc.workers.length, locked: rowCount })
  } catch (e) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: e.message })
  } finally {
    client.release()
  }
})

// 잠금 해제 — 정정이 필요할 때. 대표이사만. 다시 승인해야 확정된다.
app.post('/api/schedule/settlement/:ym/reopen', requireLogin, async (req, res) => {
  const ym = req.params.ym
  if (!/^\d{4}-\d{2}$/.test(ym)) return res.status(400).json({ error: 'ym 형식이 올바르지 않습니다.' })
  if (!await canApprove(req.session.uid)) {
    return res.status(403).json({ error: '잠금 해제 권한이 없습니다. 대표이사만 할 수 있습니다.' })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `UPDATE schedule_settlements SET status='open', settled_by=NULL, settled_at=NULL,
              updated_at=now() WHERE ym = $1`, [ym])
    const [from, to] = ymRange(ym)
    const { rowCount } = await client.query(
      'UPDATE schedule_actuals SET locked = FALSE WHERE work_date >= $1 AND work_date <= $2',
      [from, to])
    await client.query('COMMIT')
    res.json({ ok: true, unlocked: rowCount })
  } catch (e) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: e.message })
  } finally {
    client.release()
  }
})

// ─── 공휴일 ──────────────────────────────────────────────────
// 「어느 날이 휴일인가」를 알아야 ①휴일 근무 시간을 세고 ②가동일에서 뺄 수 있다.
//
// 출처 = Google 「대한민국의 휴일」 iCal. 인증 키가 필요 없고 사내에서 그대로 열린다.
// 🔑 대체공휴일·임시공휴일이 지정되면 이 피드에 반영된다 — 그래서 해마다 손으로
//    넣는 방식보다 낫다. 다만 «갑자기» 생기므로 월 1회로는 늦어 «하루 1회» 돈다.
//
// 🔑 DESCRIPTION 이 「공휴일」 / 「기념일」 로 갈린다. 이것으로 걸러야 한다 —
//    식목일·어버이날·스승의날은 기념일이라 쉬는 날이 아니다. 그대로 받으면
//    가동일이 잘못 줄어든다.
const HOLIDAY_ICS = 'https://calendar.google.com/calendar/ical/'
  + 'ko.south_korea%23holiday%40group.v.calendar.google.com/public/basic.ics'
const HOLIDAY_SYNC_MS = 24 * 60 * 60 * 1000

// iCal 한 덩어리에서 «공휴일» 만 뽑는다. 라이브러리를 쓰지 않는다 —
// 필요한 것이 DTSTART·SUMMARY·DESCRIPTION 셋뿐이라 의존성을 더할 이유가 없다.
function parseHolidayIcs(text) {
  const out = []
  for (const block of String(text).split('BEGIN:VEVENT').slice(1)) {
    const date = (block.match(/DTSTART;VALUE=DATE:(\d{4})(\d{2})(\d{2})/) || [])
    const summary = (block.match(/SUMMARY:([^\r\n]+)/) || [])[1]
    const desc = (block.match(/DESCRIPTION:([^\r\n]+)/) || [])[1] || ''
    if (!date.length || !summary) continue
    // 「기념일」 은 쉬는 날이 아니다
    if (!desc.startsWith('공휴일')) continue
    out.push({ date: `${date[1]}-${date[2]}-${date[3]}`, name: summary.trim() })
  }
  return out
}

async function syncHolidays() {
  const res = await fetch(HOLIDAY_ICS, { signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`공휴일 달력을 받지 못했습니다 (HTTP ${res.status})`)
  const list = parseHolidayIcs(await res.text())
  if (list.length === 0) {
    // 조회 0건이면 기존 목록을 지우지 않고 멈춘다 — Jira 동기화와 같은 안전장치.
    // 피드 형식이 바뀌었을 때 공휴일이 통째로 사라지는 것을 막는다.
    throw new Error('공휴일이 0건으로 왔습니다. 형식이 바뀐 것 같아 기존 목록을 그대로 둡니다.')
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // 🔑 손으로 넣은 것(manual)은 건드리지 않는다. 덮으면 다음날 아침에 사라진다.
    for (const h of list) {
      await client.query(
        `INSERT INTO holidays (holiday_date, name, source, synced_at)
         VALUES ($1, $2, 'auto', now())
         ON CONFLICT (holiday_date) DO UPDATE
           SET name = EXCLUDED.name, synced_at = now(), updated_at = now()
         WHERE holidays.source = 'auto'`,
        [h.date, h.name]
      )
    }
    // 피드에서 빠진 날(취소된 임시공휴일 등)은 auto 만 지운다
    const dates = list.map(h => h.date)
    const { rowCount: removed } = await client.query(
      `DELETE FROM holidays
        WHERE source = 'auto'
          AND holiday_date >= (SELECT min(holiday_date) FROM holidays WHERE source='auto')
          AND NOT (holiday_date = ANY($1::date[]))`,
      [dates]
    )
    await client.query('COMMIT')
    console.log(`[${new Date().toISOString()}] 공휴일 동기화: ${list.length}건 반영, ${removed}건 삭제`)
    return { synced: list.length, removed }
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

app.get('/api/holidays', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT to_char(holiday_date, 'YYYY-MM-DD') AS date, name, source, is_working, note,
              to_char(synced_at, 'YYYY-MM-DD HH24:MI') AS synced_at
         FROM holidays ORDER BY holiday_date ASC`)
    res.json(rows)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/holidays/sync', async (req, res) => {
  try { res.json(await syncHolidays()) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/holidays', async (req, res) => {
  const { date, name, note } = req.body || {}
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    return res.status(400).json({ error: '날짜를 YYYY-MM-DD 로 넣어 주세요.' })
  }
  if (!String(name || '').trim()) return res.status(400).json({ error: '이름을 넣어 주세요.' })
  try {
    await pool.query(
      `INSERT INTO holidays (holiday_date, name, source, note)
       VALUES ($1, $2, 'manual', $3)
       ON CONFLICT (holiday_date) DO UPDATE
         SET name = EXCLUDED.name, source = 'manual', note = EXCLUDED.note, updated_at = now()`,
      [date, String(name).trim(), note || null])
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// 「공휴일이지만 우리는 근무」 — 지우지 않고 되돌린다.
// 지우면 다음 동기화가 다시 넣기 때문이다.
app.patch('/api/holidays/:date', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'UPDATE holidays SET is_working = $1, updated_at = now() WHERE holiday_date = $2',
      [!!req.body?.is_working, req.params.date])
    if (!rowCount) return res.status(404).json({ error: '그 날짜가 목록에 없습니다.' })
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/holidays/:date', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT source FROM holidays WHERE holiday_date = $1', [req.params.date])
    if (!rows.length) return res.status(404).json({ error: '그 날짜가 목록에 없습니다.' })
    if (rows[0].source === 'auto') {
      return res.status(409).json({
        error: '자동으로 받아 온 공휴일은 지워도 다음 동기화에 다시 들어옵니다. '
             + '「그날 근무」로 표시해 주세요.' })
    }
    await pool.query('DELETE FROM holidays WHERE holiday_date = $1', [req.params.date])
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
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
app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`)
  // 공휴일 동기화 — 기동할 때 한 번, 그 뒤 하루 1회.
  // ⚠ 실패해도 서버를 멈추지 않는다. 사내망이 밖으로 못 나가는 상황이 있을 수 있고,
  //   그때 대시보드 전체가 죽으면 훨씬 큰 문제다. 기존 목록으로 그냥 돈다.
  const run = () => syncHolidays().catch(e => console.warn('공휴일 동기화 실패:', e.message))
  run()
  setInterval(run, HOLIDAY_SYNC_MS)
})
