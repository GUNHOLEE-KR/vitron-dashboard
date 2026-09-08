// 교육 자료 촬영용 «회의록 시험감» 을 만들고 지운다 (2026-09-08 신설)
// ==============================================================
// 「참석자별 발표 내용」과 「인원별 / 프로젝트별 보기」는 «자료가 있어야» 찍힌다.
// capture_shots.mjs 는 자료를 만들지 않는 것이 규칙이라(찍자고 시험 자료를 남길
// 일이 아니다) 만드는 일을 여기로 뺐다.
//
// 🔑 이 파일이 있어야 그림 8-3·8-4 를 «다음에도 똑같이» 찍을 수 있다.
//    재현되지 않는 촬영 정의는 두지 않는다는 원칙(capture_shots.mjs 끝 주석)을 지킨다.
//
// 쓰는 법
// -------
//   node tools/manual/seed_meeting_demo.mjs         # 만든다
//   node tools/manual/seed_meeting_demo.mjs del     # 지운다  ← 촬영 뒤 반드시
//
// 🔴 «테스트 DB 에서만» 돈다. /api/health 가 env=test 라고 답하지 않으면 그 자리에서
//    멈춘다 — 운영 회의록에 시험감을 심는 사고를 코드가 막는다.
// ⚠ 비밀번호는 다루지 않는다. capture_shots.mjs 와 같이 SESSION_SECRET 으로
//   세션 토큰만 만든다.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d }
const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')

const BASE = opt('api', 'http://localhost:3001')
const ENV_FILE = opt('env', path.join(REPO, '.env'))
const TITLE = '9월 1주 주간회의 (교육 자료 예시)'

const line = fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)
  .find(l => l.startsWith('SESSION_SECRET='))
if (!line) throw new Error(`${ENV_FILE} 에 SESSION_SECRET 이 없습니다`)
const secret = line.slice('SESSION_SECRET='.length).trim()
const token = (() => {
  const body = Buffer.from(JSON.stringify({
    uid: 1, login: 'gunholee@vi-tron.com', name: '이건호', role: 'admin',
    workerId: 7, mustChange: false, exp: Date.now() + 3600 * 1000,
  })).toString('base64url')
  return `${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`
})()

const call = async (m, p, body) => {
  const r = await fetch(BASE + p, { method: m,
    headers: { Cookie: `kpi_session=${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined })
  let j = null; try { j = await r.json() } catch { /* 없음 */ }
  if (!r.ok) throw new Error(`${m} ${p} → HTTP ${r.status} ${j?.error || ''}`)
  return j
}

// 🔴 안전 고리 — 여기가 테스트가 아니면 아무것도 하지 않는다.
const health = await call('GET', '/api/health')
if (health.env !== 'test') {
  console.error(`멈춥니다: 테스트 서버가 아닙니다 (env=${health.env} · DB ${health.db_name}).`)
  console.error('교육 자료 촬영은 테스트 DB 에서만 합니다.')
  process.exit(1)
}

const meetings = await call('GET', '/api/meetings')
const old = meetings.filter(m => m.title === TITLE)
for (const m of old) await call('DELETE', `/api/meetings/${m.id}`)

if (args[0] === 'del') {
  console.log(`지웠습니다 — ${old.length}건 (DB ${health.db_name})`)
  process.exit(0)
}

// 참석자·프로젝트는 «있는 것» 에서 고른다 — 번호를 박아 두면 다른 DB 에서 안 돈다.
const workers = (await call('GET', '/api/workers')).filter(w => w.active).slice(0, 4)
if (workers.length < 3) throw new Error('재직자가 셋도 안 됩니다 — 촬영감을 만들 수 없습니다')
// 🔑 상위업무 = parent_key 가 없는 이슈다 (jiraRepo.getJiraTree 와 같은 기준).
//    끝난 것은 화면 목록에서 감춰지므로 여기서도 뺀다 — 안 그러면 고르개가 빈칸으로 찍힌다.
const issues = await call('GET', '/api/jira-issues')
const parents = issues
  .filter(i => !i.parent_key && i.status_category !== 'done' && /^\[[A-Z]+-\d+\]/.test(i.full_text))
  .map(i => i.full_text).slice(0, 2)
if (parents.length < 2) throw new Error('Jira 상위업무가 둘도 안 됩니다 — 동기화를 먼저 하십시오')
const keyOf = t => (String(t).match(/\[([A-Z]+-\d+)\]/) || [])[1] || null

const made = await call('POST', '/api/meetings', {
  title: TITLE,
  met_on: new Date().toISOString().slice(0, 10),
  place: '본사 회의실',
  attendee_ids: workers.map(w => w.id),
  author_worker_id: workers[0].id,
  body_html: '<div><b>■ 지난 주 진행</b></div>'
    + '<ul><li>현장 점검 <span style="color:#dc2626">일정 조정</span> 필요</li>'
    + '<li>견적 회신 대기 2건</li></ul>'
    + '<div><br></div><div><b>■ 이번 주 할 일</b></div>'
    + '<div>아래 <b>참석자별 발표 내용</b>을 보고 순서대로 진행합니다.</div>',
})
const put = (wid, html, t) => call('PUT', `/api/meetings/${made.id}/notes/${wid}`,
  { body_html: html, parent_key: keyOf(t), parent_text: t })

await put(workers[0].id, '<div>얼라인 오류 점검 결과와 <b>다음 방문 일정</b>을 보고합니다.</div>', parents[0])
await put(workers[0].id, '<div>모션 파츠 <span style="color:#dc2626">견적</span> 회신 대기 중입니다.</div>', parents[1])
await put(workers[1].id, '<div>현장 준비 일정과 필요한 자재를 공유드립니다.</div>', parents[0])
await put(workers[2].id, '<div>프로젝트와 무관한 공지 한 건 있습니다.</div>', null)

const full = (await call('GET', '/api/meetings')).find(m => m.id === made.id)
console.log(`만들었습니다 — id ${made.id} · 발표 ${full.notes.length}줄 (DB ${health.db_name})`)
for (const n of full.notes) console.log(`  ${n.name} / ${n.parent_summary || n.parent_text || '(미지정)'}`)
console.log('\n촬영이 끝나면 반드시:  node tools/manual/seed_meeting_demo.mjs del')
