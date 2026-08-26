// 스케줄 달력 — 업무 현황 대시보드와 사내 포털이 «같은 것» 을 쓴다.
// ════════════════════════════════════════════════════════════
// 🔑 각자 그리면 언젠가 한쪽만 고쳐 두 화면이 어긋난다. 그래서 한 벌만 둔다.
//    ⚠ `CLAUDE.md` 의 「App.jsx 단일 파일 유지」에 대한 «예외» 다
//      (2026-08-26 사용자 승인 — 포털과 함께 쓰는 화면 조각만 여기로).
//
// 이 파일은 «그리기» 만 한다. 무엇을 그릴지(계획 목록·행 구성)와 누르면 무엇을 할지는
// 전부 밖에서 넣어 준다 — 대시보드는 계획 창을 열고, 포털은 대시보드로 보낸다.
import {
  thS, tdS, SLOT_MAP, TRANSPORT_MAP, GROUP_BYS,
  workerColor, calWeekDays, monthGridDays, isSameMonth, mdLabel, dayName,
  shortPlace, planIcon, planDetail, planState, PLAN_STATE_MARK,
} from './schedule-core'

// 달력 배지 하나.
// 이름은 «어느 기준으로 보든» 늘 보여 준다 — 장소·차량으로 볼 때는 「누구인가」 가
// 핵심 정보이고, 사람 기준으로 볼 때도 한 칸에 여러 명이 겹칠 수 있다.
export function PlanBadge({ plan, workers, onClick, todayStr, compact = false }) {
  const color = workerColor(plan.worker_id, workers)
  const st = planState(plan, todayStr)
  const personal = plan.use_type === 'personal'
  const vacation = plan.use_type === 'vacation'
  return (
    <div data-badge onClick={e => { e.stopPropagation(); onClick && onClick() }}
      title={`${plan.worker_name} · ${SLOT_MAP[plan.slot]} · ${vacation ? ('휴가 · ' + (plan.vacation_type || '')) : personal ? '개인 사용' : (plan.place_name || plan.place_text || '장소 미정')}${plan.purpose ? ' · ' + plan.purpose : ''}${plan.vehicle_name ? ' · ' + plan.vehicle_name : ''}`}
      style={{
        cursor: 'pointer',
        background: st === 'planned' || st === 'needCheck' ? color + '22' : color + 'dd',
        color: st === 'planned' || st === 'needCheck' ? '#111827' : '#fff',
        border: `1px solid ${color}`, borderStyle: (personal || vacation) ? 'dashed' : 'solid',
        borderRadius: 4, padding: '2px 5px', fontSize: compact ? 10 : 11,
        marginBottom: 2, overflow: 'hidden',
        opacity: st === 'canceled' ? .45 : 1,
        textDecoration: st === 'canceled' ? 'line-through' : 'none',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap', overflow: 'hidden' }}>
        <span>{planIcon(plan)}</span>
        <strong style={{ fontSize: compact ? 10 : 11 }}>{plan.worker_name}</strong>
        {!compact && <span style={{ opacity: .9, overflow: 'hidden', textOverflow: 'ellipsis' }}>{shortPlace(plan)}</span>}
        {/* 시간대는 종일이 아닐 때만 — 배차 겹침을 판단할 때 필요하다 */}
        {plan.slot !== 'allday' && <span style={{ opacity: .85, fontSize: compact ? 9 : 10 }}>{SLOT_MAP[plan.slot]}</span>}
        {st === 'needCheck' && <span style={{ color: '#c2410c', fontWeight: 700 }}>{PLAN_STATE_MARK.needCheck}</span>}
        {st === 'changed' && <span>{PLAN_STATE_MARK.changed}</span>}
      </div>
      {/* 월 달력은 칸이 넓은 대신 이름만 보였다. 둘째 줄에 «어디에·무엇으로·왕복»을 적는다. */}
      {compact && planDetail(plan) && (
        <div style={{
          fontSize: 9, opacity: .85, whiteSpace: 'nowrap', overflow: 'hidden',
          textOverflow: 'ellipsis', paddingLeft: 1, lineHeight: 1.35,
        }}>{planDetail(plan)}</div>
      )}
    </div>
  )
}

// ── 월 ──────────────────────────────────────────────────────
export function ScheduleMonth({ ym, byDate, workers, todayStr, onOpenPlan, onPickDate, onOpenCell,
                                pasting, isPicked, togglePick, readOnly = false }) {
  const days = monthGridDays(ym)
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)' }}>
        {['월', '화', '수', '목', '금', '토', '일'].map((d, i) => (
          <div key={d} style={{
            ...thS, borderRadius: 0, padding: '7px 0',
            color: i === 5 ? '#93c5fd' : i === 6 ? '#fca5a5' : '#fff',
          }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)' }}>
        {days.map(d => {
          const list = byDate(d)
          const out = !isSameMonth(d, ym)
          const isToday = d === todayStr
          const chosen = pasting && isPicked && isPicked(d, null)
          return (
            <div key={d}
              onClick={e => {
                // 배지를 눌렀을 때는 칸 동작이 겹치지 않게 한다
                if (e.target.closest('[data-badge]')) return
                if (readOnly) return
                if (pasting) togglePick(d, null)
                else onOpenCell && onOpenCell({ date: d })
              }}
              title={readOnly ? '' : pasting ? '누르면 붙일 칸으로 고릅니다' : '누르면 이 날짜에 계획을 추가합니다'}
              style={{
                minHeight: 96, borderRight: '1px solid #f1f5f9', borderBottom: '1px solid #f1f5f9',
                padding: '4px 5px', cursor: readOnly ? 'default' : 'pointer',
                background: chosen ? '#dbeafe' : out ? '#fafafa' : isToday ? '#eff6ff' : '#fff',
                boxShadow: chosen ? 'inset 0 0 0 2px #1a56db' : 'none',
                opacity: out ? .5 : 1, overflow: 'hidden',
              }}>
              <div style={{
                fontSize: 11, fontWeight: isToday ? 700 : 500, marginBottom: 3,
                color: isToday ? '#1a56db' : '#6b7280',
              }}>
                {Number(d.slice(8, 10))}
              </div>
              {list.slice(0, 4).map(p => (
                <PlanBadge key={p.id} plan={p} workers={workers} todayStr={todayStr}
                  onClick={() => onOpenPlan && onOpenPlan(p)} compact />
              ))}
              {list.length > 4 && (
                <div data-badge onClick={() => onPickDate && onPickDate(d)}
                  style={{ fontSize: 10, color: '#1a56db', cursor: 'pointer', fontWeight: 600 }}>
                  +{list.length - 4}건 더
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── 주 ──────────────────────────────────────────────────────
// «기준 × 날짜» 격자. 세로축은 고른 기준(사람·장소·차량)이 된다.
//   사람  누가 어디 있는가 — 위치 파악
//   장소  그 현장에 누가 언제 가는가 — 동행·중복 방문
//   차량  배차표 — 한 줄에서 겹침이 드러난다
// 칸을 누르면 «그 줄의 값 + 그 날짜» 가 계획 창에 미리 채워진다.
export function ScheduleWeek({ anchor, shown, workers, todayStr, onOpenPlan, onOpenCell,
                               pasting, isPicked, togglePick, rows, groupBy, sortByGroup,
                               readOnly = false }) {
  const days = calWeekDays(anchor)
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
        <thead>
          <tr>
            <th style={{ ...thS, width: 130, position: 'sticky', left: 0, zIndex: 2 }}>
              {GROUP_BYS.find(g => g.v === groupBy)?.label}
            </th>
            {days.map((d, i) => (
              <th key={d} style={{ ...thS, background: d === todayStr ? '#1a56db' : '#1e3a5f' }}>
                <div style={{ color: i === 5 ? '#93c5fd' : i === 6 ? '#fca5a5' : '#fff' }}>
                  {mdLabel(d)} ({dayName(d)})
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={8} style={{ ...tdS, color: '#6b7280', padding: '18px' }}>
              표시할 줄이 없습니다.
            </td></tr>
          )}
          {rows.map((row, ri) => (
            <tr key={row.key} style={{ background: ri % 2 === 0 ? '#fff' : '#f8fbff' }}>
              <td style={{
                ...tdS, textAlign: 'left', fontWeight: 700, position: 'sticky', left: 0,
                background: ri % 2 === 0 ? '#fff' : '#f8fbff', zIndex: 1,
              }}>
                <span style={{
                  display: 'inline-block', width: 8, height: 8, borderRadius: 2, marginRight: 6,
                  background: row.color,
                }} />
                {row.label}
                {row.sub && <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 500, marginLeft: 14 }}>{row.sub}</div>}
              </td>
              {days.map(d => {
                const list = shown.filter(p => p.plan_date === d && row.match(p)).sort(sortByGroup)
                // 붙여넣기 선택 키 — 사람 기준일 때만 사람이 정해진다
                const wid = row.cellDefaults?.workerId ?? null
                const chosen = pasting && isPicked && isPicked(d, wid)
                return (
                  <td key={d}
                    onClick={e => {
                      if (e.target.closest('[data-badge]')) return
                      if (readOnly) return
                      if (pasting) togglePick(d, wid)
                      else onOpenCell && onOpenCell({ date: d, ...row.cellDefaults })
                    }}
                    title={readOnly ? '' : pasting ? `${row.label} · ${d} — 누르면 붙일 칸으로 고릅니다`
                      : `${row.label} · ${d} — 누르면 계획을 추가합니다`}
                    style={{
                      ...tdS, verticalAlign: 'top', minWidth: 96, cursor: readOnly ? 'default' : 'pointer',
                      background: chosen ? '#dbeafe' : d === todayStr ? '#eff6ff' : 'transparent',
                      boxShadow: chosen ? 'inset 0 0 0 2px #1a56db' : 'none',
                    }}>
                    {list.length === 0
                      ? <span style={{ color: '#e2e8f0', fontSize: 11 }}>{pasting ? '+' : '-'}</span>
                      : list.map(p => (
                        <PlanBadge key={p.id} plan={p} workers={workers} todayStr={todayStr}
                          onClick={() => onOpenPlan && onOpenPlan(p)} />
                      ))}
                    {/* 차량 기준에서 한 칸에 둘 이상이면 배차가 겹친 것이다 */}
                    {groupBy === 'vehicle' && row.key.startsWith('v') && list.length > 1 && (
                      <div style={{ fontSize: 10, color: '#991b1b', fontWeight: 700 }}>겹침 {list.length}건</div>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── 일 ──────────────────────────────────────────────────────
// 그날 일정을 «고른 기준» 으로 묶어 보여 준다 + 차량 배정.
// 한 표에 섞어 놓으면 여러 사람이 등록했을 때 누가 무엇인지 읽기 어렵다.
// ⚠ Card 는 대시보드의 공통 껍데기다. 포털은 자기 껍데기를 넣어 준다 —
//   여기서 만들면 두 화면의 카드 모양이 갈린다.
export function ScheduleDay({ date, byDate, workers, vehicles, todayStr, onOpenPlan, onOpenCell,
                              onOpenActual, rows, groupBy, sortByGroup, Card, readOnly = false }) {
  const list = byDate(date)
  const noPlan = workers.filter(w => !list.some(p => p.worker_id === w.id))
  const carRows = vehicles.filter(v => v.kind === 'company').map(v => ({
    v, users: list.filter(p => p.vehicle_id === v.id && p.status !== 'canceled'),
  }))
  // 그 날 내용이 있는 묶음만 세운다
  const filled = rows.map(r => ({ row: r, items: list.filter(p => r.match(p)).sort(sortByGroup) }))
    .filter(g => g.items.length > 0)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)', gap: 16 }}>
      <Card title={`${date} (${dayName(date)}) 일정 ${list.length}건 · ${GROUP_BYS.find(g => g.v === groupBy)?.label}별`}>
        {!readOnly && (
          <div style={{ marginBottom: 10 }}>
            <button onClick={() => onOpenCell && onOpenCell({ date })}
              style={{
                padding: '7px 14px', borderRadius: 7, border: '1px solid #1a56db', background: '#eff6ff',
                color: '#1a56db', cursor: 'pointer', fontSize: 12, fontWeight: 700,
              }}>+ 이 날짜에 추가</button>
          </div>
        )}
        {list.length === 0
          ? <div style={{ fontSize: 12, color: '#6b7280' }}>등록된 일정이 없습니다.</div>
          : filled.map(({ row, items }) => (
            <div key={row.key} style={{ marginBottom: 14 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px',
                background: '#f1f5f9', borderRadius: 6, marginBottom: 6,
              }}>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: row.color }} />
                <strong style={{ fontSize: 12 }}>{row.label}</strong>
                {row.sub && <span style={{ fontSize: 10, color: '#6b7280' }}>{row.sub}</span>}
                <span style={{ fontSize: 11, color: '#6b7280' }}>· {items.length}건</span>
                {groupBy === 'vehicle' && row.key.startsWith('v') && items.length > 1 && (
                  <span style={{ fontSize: 10, color: '#991b1b', fontWeight: 700 }}>겹침</span>
                )}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {items.map(p => {
                    const tp = TRANSPORT_MAP[p.transport] || TRANSPORT_MAP.office
                    const personal = p.use_type === 'personal'
                    const vacation = p.use_type === 'vacation'
                    const dist = p.est_distance_km != null
                      ? (p.round_trip ? p.est_distance_km * 2 : p.est_distance_km) : null
                    return (
                      <tr key={p.id} onClick={() => onOpenPlan && onOpenPlan(p)} style={{ cursor: 'pointer' }}>
                        <td style={{ ...tdS, textAlign: 'left', width: 96, fontWeight: 700 }}>
                          <span style={{
                            display: 'inline-block', width: 8, height: 8, borderRadius: 2, marginRight: 6,
                            background: workerColor(p.worker_id, workers),
                          }} />
                          {p.worker_name}
                        </td>
                        <td style={{ ...tdS, width: 64 }}>{SLOT_MAP[p.slot]}</td>
                        <td style={{ ...tdS, textAlign: 'left' }}>
                          {vacation
                            ? <em style={{ color: '#047857' }}>🌴 휴가 · {p.vacation_type || ''}</em>
                            : personal
                              ? <em style={{ color: '#6b7280' }}>개인 사용</em>
                              : p.transport === 'office'
                                ? '사무실'
                                : (p.place_name || p.place_text || '-')}
                          {p.purpose && <div style={{ fontSize: 10, color: '#6b7280' }}>{p.purpose}</div>}
                        </td>
                        <td style={{ ...tdS, width: 120 }}>
                          {vacation ? '-' : `${tp.icon} ${p.vehicle_name || tp.label}`}
                        </td>
                        <td style={{ ...tdS, width: 64 }}>{dist != null ? `${dist}km` : '-'}</td>
                        {!readOnly && (
                          <td style={{ ...tdS, width: 96 }} onClick={e => e.stopPropagation()}>
                            {p.actual_id
                              ? <button onClick={() => onOpenActual && onOpenActual(p)}
                                style={{
                                  padding: '3px 8px', borderRadius: 6, border: '1px solid #059669',
                                  background: '#ecfdf5', color: '#059669', cursor: 'pointer', fontSize: 11, fontWeight: 700,
                                }}>
                                {p.actual_distance_km != null ? `${p.actual_distance_km}km` : '완료'}
                                {p.as_planned === false ? ' ↺' : ''}
                              </button>
                              : <button onClick={() => onOpenActual && onOpenActual(p)}
                                style={{
                                  padding: '3px 8px', borderRadius: 6,
                                  border: '1px solid ' + (p.plan_date < todayStr ? '#fdba74' : '#e5e7eb'),
                                  background: '#fff', color: p.plan_date < todayStr ? '#9a3412' : '#6b7280',
                                  cursor: 'pointer', fontSize: 11, fontWeight: 600,
                                }}>
                                실적 입력
                              </button>}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
      </Card>
      <div>
        <Card title="차량 배정">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thS}>차량</th><th style={thS}>사용자</th></tr></thead>
            <tbody>
              {carRows.map(({ v, users }) => (
                <tr key={v.id} style={{ background: users.length > 1 ? '#fef2f2' : 'transparent' }}>
                  <td style={{ ...tdS, textAlign: 'left', fontWeight: 600 }}>
                    {v.name}<div style={{ fontSize: 10, color: '#6b7280' }}>{v.plate}</div>
                  </td>
                  <td style={tdS}>
                    {users.length === 0
                      ? <span style={{ color: '#9ca3af', fontSize: 11 }}>비어 있음</span>
                      : users.map(u => (
                        <div key={u.id} style={{ fontSize: 11 }}>
                          {u.worker_name} <span style={{ color: '#6b7280' }}>({SLOT_MAP[u.slot]})</span>
                          {u.use_type === 'personal' && <span style={{ color: '#92400e' }}> 개인</span>}
                        </div>
                      ))}
                    {users.length > 1 && <div style={{ fontSize: 10, color: '#991b1b', fontWeight: 700 }}>겹침</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        {date >= todayStr && noPlan.length > 0 && (
          <Card title="계획 미입력">
            <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.7 }}>
              {noPlan.map(w => w.name).join(' · ')}
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
