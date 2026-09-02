// 바이트론 업무 포털 — VITRON ERP
// ════════════════════════════════════════════════════════════
// 🔑 달력은 만들지 않는다. 대시보드와 «같은» src/shared/ScheduleCalendar 를 쓴다.
//    각자 그리면 언젠가 한쪽만 고쳐 두 화면이 어긋난다.
// 🔑 로그인도 만들지 않는다. 쿠키(kpi_session)를 대시보드·KPI 와 함께 쓴다.
// 🔑 타일은 «탭까지» 연다 — 대시보드가 주소의 # 를 읽는다(3단계에서 넣었다).
import { useState, useEffect, useMemo } from 'react'
import {
  today, dayName, mdLabel, addDays, calWeekDays,
  monthGridDays, shiftMonth, buildGroupRows, TRANSPORT_MAP, placeLabel,
} from '../src/shared/schedule-core'
import { ScheduleWeek, ScheduleMonth } from '../src/shared/ScheduleCalendar'
import * as api from './api'
import { URLS } from './api'

// ── 타일 ────────────────────────────────────────────────────
// href 뒤의 # 가 대시보드에서 «어느 탭을 열지» 를 정한다.
// 휴가는 탭이 아니라 스케줄 탭 «안의 보기» 라 두 단계다(#schedule/vac).
//
// 🔑 주소를 «지금 보고 있는 대시보드» 에 맞춰 만든다. 박아 두었더니 시험 중에도
//    타일이 운영(:8082)으로 가 버렸고, 거기엔 아직 # 를 읽는 코드가 없어
//    무엇을 눌러도 「오늘 업무」가 열렸다 (2026-08-26 지적).
const mainTiles = (dash) => [
  { k: 'work', icon: '📋', name: '업무 현황', url: dash + '/#today',
    desc: '하루 업무를 시간대로 적고 모아 봅니다' },
  { k: 'schedule', icon: '🗓', name: '스케줄 · 차량', url: dash + '/#schedule',
    desc: '어디에 있는지 · 무엇을 타고 가는지' },
  { k: 'vacation', icon: '🌴', name: '휴가', url: dash + '/#schedule/vac',
    desc: '휴가 신청과 남은 연차' },
  { k: 'purchase', icon: '🛒', name: '구매 요청', url: dash + '/#purchase',
    desc: '물품 구매 요청과 이력' },
  // ⚠ KPI 점수는 아직 붙이지 않았다. 숫자가 없는 타일에 빈 줄을 두면
  //   「무언가 안 나온다」 로 읽히므로 그 줄 자체를 두지 않는다.
  { k: 'kpi', icon: '📊', name: 'KPI 추적', url: URLS.kpi, noStat: true,
    desc: '분기별 개인·프로젝트 점수' },
]
const ATLASSIAN = [
  { icon: '📚', name: 'Confluence', url: URLS.confluence, desc: '제품 문서 · 기준 문서 · 매뉴얼' },
  { icon: '🐞', name: 'Jira', url: URLS.jira, desc: '업무(일감) 등록과 진행 상태' },
]
const TOOLS = [
  { icon: '🗄', name: 'Gitea (소스)', url: URLS.gitea },
  { icon: '🤖', name: 'UR 시뮬레이터', url: URLS.ursim },
]

const C = { navy: '#1e3a5f', blue: '#1a56db', line: '#e5e7eb', ink: '#111827', dim: '#6b7280' }
const box = { background: '#fff', border: `1px solid ${C.line}`, borderRadius: 12 }

// 오늘/내일 한 줄 — «어디서 무엇을, 무엇을 타고»
function planLine(p) {
  if (!p) return null
  if (p.use_type === 'vacation') return `🌴 휴가 (${p.vacation_type || ''})`
  // 여기 있던 사본을 정본(placeLabel)으로 옮겼다 — 이 규칙만 맞고 나머지 세 곳이
  // 틀려 있었다 (2026-09-02).
  const where = placeLabel(p)
  const tp = TRANSPORT_MAP[p.transport] || TRANSPORT_MAP.office
  const bits = [where]
  if (p.purpose) bits.push(p.purpose)
  // 🔑 차량은 «누가 어느 차를 가져가는가» 라 반드시 붙인다 (2026-08-26 지시)
  bits.push(p.vehicle_name ? `${tp.icon} ${p.vehicle_name}` : `${tp.icon} ${tp.label}`)
  return bits.join(' · ')
}

export default function Portal() {
  const [me, setMe] = useState(null)
  const [ready, setReady] = useState(false)
  const [workers, setWorkers] = useState([])
  const [places, setPlaces] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [plans, setPlans] = useState([])
  const [vac, setVac] = useState(null)
  const [buy, setBuy] = useState(null)
  const [hist, setHist] = useState(null)
  const [now, setNow] = useState(new Date())

  // 스케줄 패널
  const [view, setView] = useState('week')      // week | month
  const [anchor, setAnchor] = useState(today())
  const [ym, setYm] = useState(today().slice(0, 7))
  const [who, setWho] = useState('me')          // me | all | <worker id>

  const todayStr = today()
  const tomorrow = addDays(todayStr, 1)

  // 시계는 1분마다. 초까지 돌리면 화면이 쉬지 않고 다시 그려진다.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(t)
  }, [])

  // 🔴 뒤쪽이 운영인지 테스트인지. nginx 한 줄로 바뀌므로 화면이 말해 줘야 한다.
  const [env, setEnv] = useState(null)
  useEffect(() => {
    let alive = true
    api.health().then(d => { if (alive) setEnv(d) }).catch(() => {})
    return () => { alive = false }
  }, [])

  useEffect(() => {
    let alive = true
    api.whoAmI()
      .then(r => { if (alive) setMe(r && r.login_id ? r : null) })
      .catch(() => { if (alive) setMe(null) })
      .finally(() => { if (alive) setReady(true) })
    return () => { alive = false }
  }, [])

  // 로그인한 뒤에만 부른다 — 안 하면 로그인 화면에서 401 이 우수수 난다
  useEffect(() => {
    if (!me) return
    let alive = true
    const put = (fn) => (v) => { if (alive) fn(v) }
    const skip = () => {}
    // ⚠ 목록에는 퇴사자까지 온다. 스케줄에 세울 이유가 없으므로 재직자만 남긴다
    //   (대시보드도 같은 규칙이다).
    api.getWorkers().then(v => put(setWorkers)((v || []).filter(w => w.active))).catch(skip)
    api.getPlaces().then(put(setPlaces)).catch(skip)
    api.getVehicles().then(put(setVehicles)).catch(skip)
    api.getVacation().then(put(setVac)).catch(skip)
    api.getPurchases().then(put(setBuy)).catch(skip)
    api.getHistoryOn(todayStr).then(put(setHist)).catch(skip)
    return () => { alive = false }
  }, [me, todayStr])

  // 달력에 필요한 날짜 폭만 받아 온다
  const [from, to] = useMemo(() => {
    if (view === 'month') {
      const g = monthGridDays(ym)
      return [g[0], g[g.length - 1]]
    }
    const w = calWeekDays(anchor)
    return [w[0], w[6]]
  }, [view, ym, anchor])

  useEffect(() => {
    if (!me) return
    let alive = true
    // 오늘·내일은 달력 범위 밖일 수 있다. 한 번에 넉넉히 받아 둔다.
    const lo = from < todayStr ? from : todayStr
    const hi = to > tomorrow ? to : tomorrow
    api.getPlans(lo, hi).then(v => { if (alive) setPlans(v || []) }).catch(() => {})
    return () => { alive = false }
  }, [me, from, to, todayStr, tomorrow])

  const canApprove = !!(vac?.can_approve || buy?.can_approve)
  const myId = me?.worker_id ?? null

  // 🔑 «지금 보고 있는» 대시보드로 보낸다. 뒤쪽이 테스트면 링크도 테스트로 —
  //    안 그러면 타일을 눌러 운영으로 가 시험한 자료가 하나도 보이지 않는다.
  //    운영 배포 때 nginx 한 줄만 되돌리면 링크도 함께 제자리로 온다.
  const dash = env?.env === 'test' ? URLS.dashboardTest : URLS.dashboard

  // 🔴 결재자가 봐야 할 것 — 최상단과 각 타일 «양쪽» 에 같은 숫자를 띄운다
  const pendVac = (vac?.pending || []).length
  const pendBuy = (buy?.items || []).filter(x => x.status === 'pending').length
  const todo = []
  if (pendBuy) todo.push({ k: 'purchase', label: '구매 요청', n: pendBuy, url: dash + '/#purchase' })
  if (pendVac) todo.push({ k: 'vacation', label: '휴가 신청', n: pendVac, url: dash + '/#schedule/vac' })

  // 스케줄 패널에 보여 줄 계획
  const shown = useMemo(() => {
    if (who === 'all') return plans
    const id = who === 'me' ? myId : Number(who)
    return plans.filter(p => p.worker_id === id)
  }, [plans, who, myId])

  const shownWorkers = useMemo(() => {
    if (who === 'all') return workers
    const id = who === 'me' ? myId : Number(who)
    return workers.filter(w => w.id === id)
  }, [workers, who, myId])

  const sortByGroup = (a, b) =>
    String(a.worker_name).localeCompare(String(b.worker_name), 'ko') ||
    String(a.slot).localeCompare(String(b.slot))
  const rows = useMemo(
    () => buildGroupRows('worker', shownWorkers, places, vehicles, shown),
    [shownWorkers, places, vehicles, shown])
  const byDate = (d) => shown.filter(p => p.plan_date === d).sort(sortByGroup)

  const mine = (d) => plans.filter(p => p.plan_date === d && p.worker_id === myId)
  const myToday = mine(todayStr)
  const myTomorrow = mine(tomorrow)

  if (!ready) return <Shell env={env}><div style={{ padding: 40, color: C.dim }}>확인 중…</div></Shell>

  if (!me) {
    return (
      <Shell env={env}>
        <div style={{ ...box, padding: 22, background: '#fffbeb', borderColor: '#fde68a', color: '#92400e' }}>
          로그인하지 않으셨습니다. <a href={dash} style={{ color: '#92400e', fontWeight: 700 }}>
            업무 현황 대시보드에서 로그인</a>하시면 이 쪽도 그대로 열립니다.
        </div>
        <Tiles dash={dash} />
      </Shell>
    )
  }

  return (
    <Shell me={me} env={env}>
      {/* ── 결재자가 봐야 할 것 (최상단) ── */}
      {canApprove && todo.length > 0 && (
        <div style={{
          ...box, borderColor: '#fca5a5', background: '#fef2f2', padding: '11px 16px',
          marginBottom: 14, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <strong style={{ color: '#b91c1c', fontSize: 13.5 }}>🔔 확인하실 것</strong>
          {todo.map(t => (
            <a key={t.k} href={t.url} style={{
              color: '#b91c1c', fontWeight: 700, fontSize: 13, textDecoration: 'none',
              background: '#fff', border: '1px solid #fecaca', borderRadius: 8, padding: '4px 11px',
            }}>{t.label} {t.n}건 ↗</a>
          ))}
        </div>
      )}

      {/* ── 1행 — 오늘·내일 ── */}
      <div style={{ ...box, padding: '14px 18px', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 17 }}>
            {now.getMonth() + 1}월 {now.getDate()}일 ({dayName(todayStr)})
          </strong>
          <span style={{ fontSize: 15, color: C.blue, fontWeight: 700 }}>
            {String(now.getHours()).padStart(2, '0')}:{String(now.getMinutes()).padStart(2, '0')}
          </span>
          <span style={{ fontSize: 12, color: C.dim }}>{me.name} 님</span>
          {hist && (
            <span style={{ fontSize: 12, marginLeft: 'auto', color: hist.filter(r => r.worker_id === myId).length ? C.dim : '#b45309', fontWeight: 700 }}>
              {hist.filter(r => r.worker_id === myId).length
                ? `오늘 업무 ${hist.filter(r => r.worker_id === myId).length}시간 적음`
                : '오늘 업무를 아직 안 적었습니다'}
            </span>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
          {[['오늘', myToday], ['내일', myTomorrow]].map(([label, list]) => (
            <div key={label} style={{ background: '#f9fafb', border: `1px solid ${C.line}`, borderRadius: 9, padding: '10px 13px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.dim, marginBottom: 5 }}>
                {label} · {label === '오늘' ? mdLabel(todayStr) : mdLabel(tomorrow)}
              </div>
              {list.length === 0
                ? <div style={{ fontSize: 12.5, color: '#9ca3af' }}>등록한 일정이 없습니다</div>
                : list.map(p => (
                  <div key={p.id} style={{ fontSize: 12.5, lineHeight: 1.75 }}>
                    {p.slot !== 'allday' && <b>[{p.slot === 'am' ? '오전' : p.slot === 'pm' ? '오후' : '시간'}] </b>}
                    {planLine(p)}
                  </div>
                ))}
            </div>
          ))}
        </div>
      </div>

      {/* ── 2행 — 스케줄 ── */}
      <div style={{ ...box, padding: '14px 18px', marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <strong style={{ fontSize: 14 }}>스케줄</strong>
          <div style={{ display: 'flex', gap: 4 }}>
            {[['week', '주간'], ['month', '월간']].map(([v, label]) => (
              <button key={v} onClick={() => setView(v)} style={{
                padding: '5px 13px', borderRadius: 7, cursor: 'pointer', fontSize: 12.5,
                fontWeight: view === v ? 700 : 500,
                border: '1px solid ' + (view === v ? C.blue : C.line),
                background: view === v ? '#eff6ff' : '#fff',
                color: view === v ? C.blue : C.dim,
              }}>{label}</button>
            ))}
          </div>
          <button onClick={() => view === 'week' ? setAnchor(addDays(anchor, -7)) : setYm(shiftMonth(ym, -1))}
            style={navBtn}>◀</button>
          <span style={{ fontSize: 12.5, fontWeight: 700, minWidth: 130, textAlign: 'center' }}>
            {view === 'week'
              ? `${mdLabel(calWeekDays(anchor)[0])} ~ ${mdLabel(calWeekDays(anchor)[6])}`
              : `${ym.slice(0, 4)}년 ${Number(ym.slice(5, 7))}월`}
          </span>
          <button onClick={() => view === 'week' ? setAnchor(addDays(anchor, 7)) : setYm(shiftMonth(ym, 1))}
            style={navBtn}>▶</button>
          <button onClick={() => { setAnchor(today()); setYm(today().slice(0, 7)) }} style={navBtn}>오늘</button>

          {/* 🔴 남의 일정은 관리자만 고를 수 있다. 대표이사는 «전 직원» 이 기본이다. */}
          {(me.role === 'admin' || canApprove) && (
            <select value={who} onChange={e => setWho(e.target.value)} style={{
              marginLeft: 'auto', padding: '5px 10px', borderRadius: 7,
              border: `1px solid ${C.line}`, fontSize: 12.5,
            }}>
              <option value="me">내 일정만</option>
              <option value="all">전 직원</option>
              {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          )}
        </div>

        {/* 🔑 달력은 대시보드와 «같은 것» 이다. readOnly 라 여기서는 눌러도 창이 뜨지 않는다 */}
        {view === 'week'
          ? <ScheduleWeek anchor={anchor} shown={shown} workers={shownWorkers} todayStr={todayStr}
              rows={rows} groupBy="worker" sortByGroup={sortByGroup} readOnly />
          : <ScheduleMonth ym={ym} byDate={byDate} workers={shownWorkers} todayStr={todayStr} readOnly />}
        <div style={{ fontSize: 11, color: C.dim, marginTop: 9 }}>
          💡 여기서는 보기만 합니다 — 고치시려면 <a href={dash + '/#schedule'}
            style={{ color: C.blue, fontWeight: 700 }}>스케줄 화면</a>으로 가십시오.
        </div>
      </div>

      <Tiles dash={dash} me={me} vac={vac} buy={buy} hist={hist} myId={myId} canApprove={canApprove}
        pendVac={pendVac} pendBuy={pendBuy} />
    </Shell>
  )
}

const navBtn = {
  padding: '5px 10px', borderRadius: 7, border: '1px solid #e5e7eb',
  background: '#fff', cursor: 'pointer', fontSize: 12.5,
}

function Shell({ me, env, children }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f3f4f6', color: C.ink,
      fontFamily: "'맑은 고딕','Malgun Gothic',system-ui,-apple-system,sans-serif" }}>
      {/* 🔴 뒤쪽이 테스트면 «한눈에» 보여야 한다. 시험 자료를 운영으로 착각하지 않도록. */}
      {env?.env === 'test' && (
        <div style={{ background: '#b91c1c', color: '#fff', padding: '6px 24px',
          fontSize: 12.5, fontWeight: 700, letterSpacing: '.3px' }}>
          🔴 테스트 자료를 보고 있습니다
          <span style={{ fontWeight: 400, opacity: .9, marginLeft: 10 }}>
            여기 숫자는 운영이 아닙니다{env.db_name ? ` · DB ${env.db_name}` : ''}
          </span>
        </div>
      )}
      <header style={{ background: C.navy, color: '#fff', padding: '17px 24px' }}>
        <div style={{ maxWidth: 1240, margin: '0 auto', display: 'flex', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-.3px' }}>바이트론 업무 포털</div>
            <div style={{ fontSize: 12, opacity: .75, marginTop: 3 }}>
              VITRON ERP · 사내 업무 시스템을 한 자리에서
            </div>
          </div>
          <div style={{ marginLeft: 'auto', textAlign: 'right', fontSize: 12, lineHeight: 1.6 }}>
            {me
              ? <>
                <b style={{ fontSize: 13 }}>{me.name || me.login_id}</b>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 9,
                  background: 'rgba(255,255,255,.18)', marginLeft: 5 }}>
                  {me.role === 'admin' ? '관리자' : '일반'}
                </span>
                <div style={{ opacity: .7 }}>{me.login_id}</div>
              </>
              : '로그인하지 않음'}
          </div>
        </div>
      </header>
      <main style={{ maxWidth: 1240, margin: '0 auto', padding: '20px 24px 44px' }}>{children}</main>
    </div>
  )
}

// ── 타일 ────────────────────────────────────────────────────
// 업무 다섯 개는 «한 줄» 로 넓게 (2026-08-26 지시). 화면이 좁으면 접힌다.
function Tiles({ dash, me, vac, buy, hist, myId, canApprove, pendVac, pendBuy }) {
  const stat = (k) => {
    if (!me) return <span style={{ color: '#9ca3af' }}>로그인하면 보입니다</span>
    if (k === 'vacation') {
      if (!vac) return null
      const m = (vac.items || []).find(x => x.worker_id === myId)
      const bits = []
      if (m && m.remaining != null) bits.push(<span key="r">잔여 <b>{m.remaining}일</b></span>)
      if (canApprove && pendVac) bits.push(<span key="p" style={{ color: '#b45309' }}> · 승인 대기 {pendVac}건</span>)
      return bits.length ? bits : <span style={{ color: '#9ca3af' }}>신청한 휴가가 없습니다</span>
    }
    if (k === 'purchase') {
      if (!buy) return null
      return <>
        {canApprove && pendBuy ? <span style={{ color: '#b45309' }}>승인 대기 {pendBuy}건 · </span> : null}
        누적 <b>{Number(buy.total?.approved || 0).toLocaleString('ko-KR')}원</b>
      </>
    }
    if (k === 'work') {
      if (!hist) return null
      const n = hist.filter(r => r.worker_id === myId).length
      return n ? <>오늘 <b>{n}시간</b> 적음</>
        : <span style={{ color: '#b45309' }}>오늘 업무를 아직 안 적었습니다</span>
    }
    return null
  }
  return (
    <>
      <H>업무</H>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
        {mainTiles(dash).map(t => <Tile key={t.k} t={t} stat={t.noStat ? null : stat(t.k)} />)}
      </div>
      <H>문서 · 일감</H>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 12 }}>
        {ATLASSIAN.map(t => <Tile key={t.name} t={t} />)}
      </div>
      <H>사내 도구</H>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 12 }}>
        {TOOLS.map(t => <Tile key={t.name} t={t} small />)}
      </div>
      <div style={{ marginTop: 24, fontSize: 11, color: C.dim, lineHeight: 1.9 }}>
        💡 <b>로그인은 하나입니다.</b> 업무 대시보드·KPI 가 같은 계정을 씁니다 —
        한 곳에서 로그인하면 나머지도 그대로 열립니다.<br />
        ⚠ <b>Confluence·Jira 는 별도 계정</b>(Atlassian)입니다. 사내 계정과 다릅니다.
      </div>
    </>
  )
}

const H = ({ children }) => (
  <h2 style={{ fontSize: 12, color: C.dim, fontWeight: 700, margin: '24px 0 10px', letterSpacing: '.3px' }}>
    {children}
  </h2>
)

function Tile({ t, stat, small }) {
  return (
    <a href={t.url} target="_blank" rel="noreferrer" style={{
      ...box, padding: small ? '12px 14px' : '15px 16px', textDecoration: 'none',
      color: 'inherit', display: 'block',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ fontSize: 21, lineHeight: 1 }}>{t.icon}</span>
        <span style={{ fontSize: small ? 13 : 14, fontWeight: 800 }}>{t.name}</span>
      </div>
      {t.desc && <div style={{ fontSize: 11, color: C.dim, marginTop: 6, lineHeight: 1.6 }}>{t.desc}</div>}
      {stat != null && <div style={{ marginTop: 9, fontSize: 12, color: C.blue, fontWeight: 700 }}>{stat}</div>}
    </a>
  )
}
