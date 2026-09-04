// 스케줄 달력이 쓰는 «순수한 조각» — 상수·색·날짜 계산·배지 문구.
// ════════════════════════════════════════════════════════════
// 왜 App.jsx 밖으로 나왔는가
//   업무 현황 대시보드와 사내 포털이 «같은 달력» 을 보여야 하기 때문이다.
//   각자 그리면 언젠가 한쪽만 고쳐 두 화면이 어긋난다.
//   ⚠ `CLAUDE.md` 의 「App.jsx 단일 파일 유지」에 대한 «예외» 다 —
//     포털과 함께 쓰는 화면 조각만 여기로 뺀다 (2026-08-26 사용자 승인).
//
// 🔑 이 파일에는 JSX 를 두지 않는다. 화면 조각은 ScheduleCalendar.jsx 로 나눈다.

// ── 이동 수단 ───────────────────────────────────────────────
// 표시용에는 사무실과 «이동 없음» 도 필요하다(달력 배지·일 뷰).
// none 을 빼 두면 휴가 배지가 fallback 으로 🏢(사무실) 처럼 보인다.
export const OUT_TRANSPORTS = [
  { v: 'company_car', label: '법인차량', icon: '🚗', needsVehicle: true },
  { v: 'own_car', label: '자차', icon: '🚙', needsVehicle: true },
  { v: 'transit', label: '대중교통', icon: '🚌', needsVehicle: false },
]
export const TRANSPORT_MAP = Object.fromEntries([
  ...OUT_TRANSPORTS,
  { v: 'office', label: '사무실', icon: '🏢', needsVehicle: false },
  { v: 'none', label: '이동 없음', icon: '🌴', needsVehicle: false },
].map(t => [t.v, t]))

// 장소 목록 맨 위의 고정 항목. 장소 목록(DB)에 넣지 않는다 —
// 사무실은 회사 자체이고 거리가 0 이라 관리 대상을 늘릴 이유가 없다.
export const OFFICE_PLACE = 'office'

export const SLOTS = [
  { v: 'allday', label: '종일' }, { v: 'am', label: '오전' },
  { v: 'pm', label: '오후' }, { v: 'time', label: '시각 지정' },
]
export const SLOT_MAP = Object.fromEntries(SLOTS.map(s => [s.v, s.label]))

// 표 머리글은 데이터 행과 확실히 구분되는 진한 남색으로.
// 연한 회색(#f9fafb)이던 때는 첫 데이터 행과 같은 색이라 머리글이 붙어 보였다.
export const thS = { background: '#1e3a5f', padding: '8px 10px', textAlign: 'center', fontWeight: 700, border: '1px solid #e5e7eb', fontSize: 11, color: '#fff', whiteSpace: 'nowrap' }
export const tdS = { padding: '6px 10px', border: '1px solid #e5e7eb', textAlign: 'center', verticalAlign: 'middle', fontSize: 12 }

// ── 날짜 ────────────────────────────────────────────────────
// ⚠️ 날짜를 YYYY-MM-DD 로 만들 때 toISOString() 을 쓰면 안 된다.
// toISOString() 은 UTC 기준이라 한국(UTC+9)에서는 오전 9시 이전에 전날이 된다.
// 실제로 오전에 업무를 저장하면 전날 날짜로 기록되는 버그가 있었다.
export function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function today() { return ymd(new Date()) }
export function dayName(d) { return ['일', '월', '화', '수', '목', '금', '토'][new Date(d).getDay()] }
export function mdLabel(dateStr) { return `${Number(dateStr.slice(5, 7))}/${Number(dateStr.slice(8, 10))}` }

// 리포트 탭의 주차는 «1~7일 = 1주차» 방식이지만, 스케줄 달력은 사람이 보는
// 달력과 같아야 하므로 «월요일 시작» 실제 주를 쓴다.
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return ymd(new Date(y, m - 1, d + n))
}
export function calWeekStart(dateStr) {   // 그 날짜가 속한 주의 월요일
  const [y, m, d] = dateStr.split('-').map(Number)
  const dow = new Date(y, m - 1, d).getDay()   // 0=일 … 6=토
  return addDays(dateStr, dow === 0 ? -6 : 1 - dow)
}
export function calWeekDays(dateStr) {    // 월~일 7일
  const s = calWeekStart(dateStr)
  return Array.from({ length: 7 }, (_, i) => addDays(s, i))
}
// 월 달력 격자 — 1일이 속한 주의 월요일부터 6주(42칸)를 채운다.
// 42칸 고정이면 달을 옮겨도 격자 높이가 흔들리지 않는다.
export function monthGridDays(ym) {
  const start = calWeekStart(ym + '-01')
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}
export function isSameMonth(dateStr, ym) { return dateStr.slice(0, 7) === ym }
export function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ── 색 ──────────────────────────────────────────────────────
// 사람마다 색을 고정한다. 색이 매번 바뀌면 달력에서 누구인지 알 수 없다.
//
// 🔴 2026-08-25 개편 — 예전에는 «입사일 순번 % 팔레트 길이» 로 계산했다.
//    직원이 팔레트보다 많아지자 색이 한 바퀴 돌아 **두 쌍이 완전히 같은 색**이 됐고
//    (고광용↔송지형, 이건호↔김동현), 사람이 늘고 줄 때마다 남의 색까지 밀렸다.
//    이제 `workers.color` 에 «값» 으로 박아 두고 [설정] 탭에서 고친다.
//
// 🔴 이 팔레트는 «네 번 틀리고 다섯 번째에» 정했다. 남겨 두는 이유는 같은 실수를 막기 위해서다.
//   1차 색상(hue)만 40도씩 벌리고 명도·채도는 전부 같은 단계 → 「다 비슷하다」
//   2차 ΔE 30 이상인데도 비슷했다 — 지적받은 쌍이 전부 «같은 색 이름» 이었다.
//       🔑 사람은 작은 점을 «미세한 거리» 가 아니라 «색 이름» 으로 분류한다.
//   3차 이름을 다르게 하고 ΔE 49 까지 올렸는데 남색(밝기 27)·적갈(밝기 28)이 붙어 보였다.
//       🔑 둘 다 아주 어두우면 12px 점에서는 «검은 점» 둘로 보인다.
//   4차 밝기를 45 이상으로 올렸더니 주황(57)과 분홍(57)이 붙었다.
//       🔑 색상이 가까운데 밝기까지 같으면 붙는다. ΔE 73.9 여도 그렇다.
//   5차 「색상 간격」 과 「밝기 간격」 을 «함께» 보는 규칙을 코드에 박고 되짚어 찾기로
//       조합 9,684개를 전부 훑어 골랐다 (ΔE 60.6).
//   ⚠ ΔE 는 «큰 면적» 기준이라 12px 점에 그대로 쓸 수 없다 — 보조 지표로만 본다.
// 고르는 도구 = `tools/pick-colors.mjs` — 버리지 말 것. 사람이 늘면 다시 돌린다.
export const WORKER_COLORS = [
  '#3b82f6', '#dc2626', '#facc15', '#16a34a', '#67e8f9', '#c026d3',
  '#f9a8d4', '#f97316', '#a3e635', '#0d9488', '#c084fc', '#93c5fd',
]
export function workerColor(workerId, workers) {
  const w = workers.find(x => x.id === workerId)
  if (w?.color) return w.color
  const i = workers.findIndex(x => x.id === workerId)
  return WORKER_COLORS[(i < 0 ? 0 : i) % WORKER_COLORS.length]
}

// ── 직책 서열 ────────────────────────────────────────────────
// 「같은 장소에 있는 사람들을 한 줄로 묶고, 색은 그 가운데 최상급자의 것으로」
// 라는 지시(2026-09-04)를 위해 필요하다. 값은 `workers.position` 에 들어가는 것과
// 같아야 한다 — 설정 화면의 직책 고르개도 이 배열을 쓴다.
// ⚠ KPI 의 서열(kpi_users.rank_order)과는 다른 것이다. 그쪽은 «사람 하나하나의
//   번호» 이고 이것은 «직책 단위» 다 (db/migrations/020-worker-position.sql 참고).
export const POSITIONS = ['대표이사', '이사', '부장', '차장', '과장', '대리', '주임', '사원']

// 직책이 비었거나 목록에 없으면 «맨 아래» 로 본다. 서열을 지어낼 수는 없다.
export function positionRank(w) {
  const i = POSITIONS.indexOf(w?.position)
  return i < 0 ? POSITIONS.length : i
}

// 🔑 묶음 안에 직책 가진 사람이 하나도 없으면 노랑 (2026-09-04 지시).
//    「누구 색인지 못 정했다」 를 색으로 말해 준다.
export const NO_POSITION_COLOR = '#eab308'

// 한 묶음의 «최상급자» — ① 직책 서열 ② 같으면 입사일이 빠른 사람 ③ 그래도 같으면 id.
// ⚠ 정렬 기준을 끝까지 정해 둔다. 하나라도 비겨서 순서가 흔들리면 «같은 화면인데
//   색이 달라지는» 일이 생긴다.
export function topWorkerOf(plans, workers) {
  const ws = plans.map(p => workers.find(w => w.id === p.worker_id)).filter(Boolean)
  if (ws.length === 0) return null
  return ws.slice().sort((a, b) =>
    positionRank(a) - positionRank(b)
    || String(a.hired_at || '9999-12-31').localeCompare(String(b.hired_at || '9999-12-31'))
    || (a.id - b.id))[0]
}

// 묶음의 색 — 최상급자의 색. 아무도 직책이 없으면 노랑.
export function groupColor(plans, workers) {
  const top = topWorkerOf(plans, workers)
  if (!top || positionRank(top) >= POSITIONS.length) return NO_POSITION_COLOR
  return workerColor(top.id, workers)
}

// 같은 «장소» 인가를 가르는 열쇠. 휴가는 장소가 아니므로 묶지 않는다(null).
export function placeKeyOf(p) {
  if (p.use_type === 'vacation') return null
  if (p.transport === 'office') return 'office'
  if (p.place_id != null) return 'p' + p.place_id
  return 't' + (p.place_text || '')
}

// 같은 장소끼리 묶어 [[계획,…], [계획], …] 로 돌려준다.
// 🔑 묶이지 않는 것도 «혼자짜리 묶음» 으로 돌려 부르는 쪽의 다루기를 하나로 만든다.
//    (한쪽은 계획, 한쪽은 묶음으로 받으면 반드시 한 곳을 빠뜨린다)
// ⚠ 들어온 «순서» 를 지킨다 — 밖에서 이미 정렬해 넘긴 것을 흐트러뜨리지 않는다.
export function groupByPlace(list) {
  const out = []
  const at = new Map()
  for (const p of list) {
    const k = placeKeyOf(p)
    if (k === null) { out.push([p]); continue }
    if (!at.has(k)) { at.set(k, out.length); out.push([]) }
    out[at.get(k)].push(p)
  }
  return out
}

// 차량도 같은 문제였다 — 법인차 4대가 «전부» 주황, 자차는 «전부» 보라로 박혀 있어
// 배차표에서 색만 보고는 어느 차인지 알 수 없었다 (2026-08-25 지적).
// ⚠ 차량 색은 «직원 색과도» 떨어져 있어야 한다 — 주 뷰의 차량 기준에서는
//   행(차량)과 배지(사람)가 동시에 보인다. 위 팔레트와 ΔE 25 이상 벌려 골랐다.
export const VEHICLE_COLORS = [
  '#f97316', '#a3e635', '#0d9488', '#c084fc', '#ca8a04', '#0891b2',
  '#be185d', '#65a30d', '#7c3aed', '#22d3ee', '#ef4444', '#64748b',
]
export function vehicleColor(vehicle, vehicles = []) {
  if (vehicle?.color) return vehicle.color
  const i = vehicles.findIndex(v => v.id === vehicle?.id)
  if (i < 0) return vehicle?.kind === 'own' ? '#8b5cf6' : '#f59e0b'
  return VEHICLE_COLORS[i % VEHICLE_COLORS.length]
}

// ── 보기 기준 ───────────────────────────────────────────────
// 여러 사람이 등록하면 등록 순서대로 쌓여 뒤섞인다. 무엇을 기준으로 묶어 볼지
// 고르게 한다. 주 뷰는 이 기준이 «격자의 세로축» 이 되므로 성격이 크게 달라진다.
export const GROUP_BYS = [
  { v: 'worker', label: '사람', icon: '👤' },
  { v: 'place', label: '장소', icon: '📍' },
  { v: 'vehicle', label: '차량', icon: '🚗' },
]

// 기준에 맞는 행 목록을 만든다. 각 행은 {key,label,sub,color,match,cellDefaults} 다.
//   match        그 행에 속하는 계획인지
//   cellDefaults 빈 칸을 눌렀을 때 계획 창에 미리 채울 값
export function buildGroupRows(groupBy, workers, places, vehicles, plans, opts = {}) {
  if (groupBy === 'worker') {
    return workers.map(w => ({
      key: 'w' + w.id, label: w.name, color: workerColor(w.id, workers),
      match: p => p.worker_id === w.id, cellDefaults: { workerId: w.id },
    }))
  }
  if (groupBy === 'place') {
    // 그 기간에 실제로 쓰인 장소만 보여 준다. 등록된 장소를 다 세우면 빈 줄만 길어진다.
    const used = new Map()
    plans.forEach(p => {
      if (p.use_type === 'vacation' || p.place_id == null) return
      if (!used.has(p.place_id)) used.set(p.place_id, p.place_name || p.place_text || '(이름 없음)')
    })
    const rows = [{
      key: 'office', label: '🏢 사무실 (내근)', color: '#64748b',
      match: p => p.use_type !== 'vacation' && p.transport === 'office',
      cellDefaults: { placeId: OFFICE_PLACE },
    }]
    ;[...used.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'ko'))
      .forEach(([id, name]) => {
        const pl = places.find(x => x.id === id)
        rows.push({
          key: 'p' + id, label: name,
          sub: pl?.distance_km != null ? `${pl.distance_km}km` : '',
          color: '#0ea5e9', match: p => p.place_id === id, cellDefaults: { placeId: id },
        })
      })
    rows.push({
      key: 'vac', label: '🌴 휴가', color: '#059669',
      match: p => p.use_type === 'vacation', cellDefaults: { kind: 'vacation' },
    })
    return rows
  }
  // 차량 — 법인차는 배차 확인용이라 그 주에 안 쓰였어도 «항상» 세운다
  const rows = vehicles.filter(v => v.kind === 'company').map(v => ({
    key: 'v' + v.id, label: v.name, sub: v.plate || '', color: vehicleColor(v, vehicles),
    match: p => p.vehicle_id === v.id, cellDefaults: { vehicleId: v.id, transport: 'company_car' },
  }))
  // 자차는 그 기간에 쓰인 것만
  const usedOwn = new Set(plans.filter(p => p.vehicle_kind === 'own' && p.vehicle_id).map(p => p.vehicle_id))
  vehicles.filter(v => v.kind === 'own' && usedOwn.has(v.id)).forEach(v => {
    rows.push({
      key: 'v' + v.id, label: v.name + (v.owner_name ? ` (${v.owner_name})` : ''),
      sub: '자차', color: vehicleColor(v, vehicles), match: p => p.vehicle_id === v.id,
      cellDefaults: { vehicleId: v.id, transport: 'own_car' },
    })
  })
  // 🔑 차량 기준은 «배차표» 다 — 「어느 차를 누가 어디로 가져가는가」 를 보는 자리다.
  //    차량이 걸리지 않은 일정(사무실 내근·대중교통·휴가)까지 세우면 그 줄이 가장 길어
  //    정작 배차가 묻힌다 (2026-08-25 지적). 기본으로 감추고, 체크 한 번으로 꺼낸다.
  if (opts.showNoCar) {
    rows.push({
      key: 'nocar', label: '차량 없음', sub: '사무실·대중교통·휴가', color: '#94a3b8',
      match: p => !p.vehicle_id, cellDefaults: {},
    })
  }
  return rows
}

// ── 「어디에서」 한 줄 ──────────────────────────────────────
// 확인 창 · 풍선 · 메일이 함께 쓰는 «행선지 문구» 의 정본.
//
// 🔑 규칙이 곳곳에 따로 적혀 있어 사고가 났다 (2026-09-02).
//    사무실 내근은 장소 목록에 없는 고정 항목이라 place_id 가 비고 transport 로만
//    구분되는데, 장소 이름만 보던 곳들이 「장소 미정」으로 떨어뜨렸다. 완료 처리
//    확인 창은 물론 «대표이사께 가는 보고 메일 제목» 까지 그렇게 나갔다.
//    ⚠ 새로 쓰는 곳에서 이름만 보고 판단하지 말고 반드시 이것을 쓸 것.
export function placeLabel(plan) {
  if (plan.use_type === 'vacation') return '휴가'   // 종류까지 붙일 곳은 부르는 쪽에서 처리한다
  if (plan.use_type === 'personal') return '개인 사용'   // 행선지를 적지 않는다 (사생활)
  if (plan.transport === 'office') return '사무실'
  const nm = plan.place_name || plan.place_text
  if (nm) return nm
  // 차량만 잡아 둔 예약은 «행선지를 아예 받지 않는다». 「장소 미정」이라고 하면
  // 빠뜨린 것처럼 읽히므로 무엇을 한 것인지 그대로 적는다 (2026-09-02 사용자 결정).
  if (plan.vehicle_id || plan.vehicle_name) return '차량 예약'
  return '장소 미정'
}

// ── 배지 문구 ───────────────────────────────────────────────
// 배지에 넣을 짧은 장소 이름. 달력 칸이 좁아 긴 이름은 잘라야 한다.
// 편도면 방향을 화살표로 덧붙인다 — 「→현장」 은 나가는 길, 「현장→」 은 돌아오는 길.
export function shortPlace(plan) {
  if (plan.use_type === 'vacation') return plan.vacation_type || '휴가'
  if (plan.use_type === 'personal') return '개인 사용'
  if (plan.transport === 'office') return '사무실'
  const nm = plan.place_name || plan.place_text || ''
  const cut = nm.length > 9 ? nm.slice(0, 9) + '…' : nm
  if (plan.one_way_dir === '출발') return '→' + cut
  if (plan.one_way_dir === '복귀') return cut + '→'
  // 이동 = 현장에서 현장으로. 「어디서 왔는지」가 이 유형의 핵심이라 함께 적는다.
  // ⚠ 두 이름을 다 적으면 칸을 넘치므로 출발지는 더 짧게 자른다.
  if (plan.one_way_dir === '이동') {
    const f = plan.from_place_name || ''
    const fcut = f.length > 6 ? f.slice(0, 6) + '…' : f
    return (fcut ? fcut + '→' : '→') + cut
  }
  return cut
}
// 배지에 붙는 아이콘 — 휴가는 이동 수단이 없으므로 따로 잡는다
export function planIcon(plan) {
  if (plan.use_type === 'vacation') return '🌴'
  return (TRANSPORT_MAP[plan.transport] || TRANSPORT_MAP.office).icon
}
// 차량은 모델명만 남긴다. 「Model Y 15도 3955」 를 그대로 쓰면 달력 칸을 다 먹는다.
export const shortVehicle = (name) => String(name || '').replace(/\s*\d+[가-힣]\s*\d+\s*$/, '').trim()
// 배지 둘째 줄 — «어디에 · 무엇으로 · 왕복인가». 이름만 있으면 달력만 보고는
// 어디 갔는지 알 수 없어 매번 눌러 봐야 했다.
export function planDetail(plan) {
  if (plan.use_type === 'vacation') return plan.vacation_type || ''
  if (plan.use_type === 'personal') return plan.vehicle_name ? shortVehicle(plan.vehicle_name) : ''
  const parts = [shortPlace(plan)]
  if (plan.vehicle_name) parts.push(shortVehicle(plan.vehicle_name))
  // 사무실 내근은 이동이 없어 왕복을 따질 것이 없다
  if (plan.transport && plan.transport !== 'office') parts.push(plan.round_trip ? '왕복' : '편도')
  return parts.filter(Boolean).join(' · ')
}
// 계획 한 건이 어떤 상태인지 — 달력 표시와 「확인 필요」 판단에 쓴다
export function planState(plan, todayStr) {
  if (plan.status === 'canceled') return 'canceled'
  if (plan.actual_id) return plan.as_planned === false ? 'changed' : 'done'
  return plan.plan_date < todayStr ? 'needCheck' : 'planned'
}
export const PLAN_STATE_MARK = { done: '', changed: '↺', needCheck: '●', planned: '', canceled: '✕' }
