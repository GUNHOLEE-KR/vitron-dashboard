const BASE = '/api/schedule'

// 서버는 {"error":"..."} 로 답한다. 그 문구만 꺼내 쓴다.
// 409 에는 similar(비슷한 장소)·conflicts(차량 예약자) 가 함께 오므로
// 오류 객체에 실어 화면이 「그래도 등록할까요?」를 물어볼 수 있게 한다.
// ⚠ try 안에서 곧바로 throw 하면 자기 catch 에 걸려 원본 JSON 이 그대로 화면에 뜬다.
async function request(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { /* JSON 이 아니면 원문을 쓴다 */ }

  if (!res.ok) {
    const err = new Error(data?.error || text || `요청 실패 (HTTP ${res.status})`)
    err.status = res.status
    err.similar = data?.similar
    err.conflicts = data?.conflicts
    err.actualId = data?.actual_id
    throw err
  }
  return data
}

// ── 장소 ──
// 장소가 수십 개가 되면 콤보로는 고를 수 없어 별도 선택 창에서 검색·관리한다.
export const getPlaces = (all = false) => request('GET', `/places${all ? '?all=1' : ''}`)
// force=true 로 다시 부르면 유사 이름 경고를 넘기고 등록한다
export const addPlace = (place) => request('POST', '/places', place)
export const updatePlace = (id, patch) => request('PATCH', `/places/${id}`, patch)
// 지우지 않고 숨긴다 — 지난 계획·실적이 이 장소를 참조한다
export const hidePlace = (id) => request('DELETE', `/places/${id}`)

// ── 차량 ──
export const getVehicles = (all = false) => request('GET', `/vehicles${all ? '?all=1' : ''}`)
export const addVehicle = (vehicle) => request('POST', '/vehicles', vehicle)
export const updateVehicle = (id, patch) => request('PATCH', `/vehicles/${id}`, patch)

// ── 장소 쌍 거리 (2026-09-04 신설) ──
// 「이동」 일정(현장 → 현장)이 쓴다. 장소의 distance_km 는 「회사 → 장소」 하나뿐이라
// 현장끼리의 거리는 거기에 없다.
// 🔑 한 쌍은 한 줄이고 방향을 가리지 않는다 — A→B 를 찾으면 B→A 로도 쓴다.
export const getPlaceDistance = (from, to) =>
  authRequest('GET', `/schedule/place-distances?from=${from}&to=${to}`)
export const getPlaceDistances = () => authRequest('GET', '/schedule/place-distances')
export const savePlaceDistance = (row) => authRequest('POST', '/schedule/place-distances', row)

// ── 계획 ──
// 차량 알림 메일이 살아 있는가 (설정 탭 카드용).
// 🔑 «조용히 멈추는 것» 이 이 기능의 가장 큰 위험이라 상태를 늘 볼 수 있게 둔다.
export const getMailStatus = () => request('GET', '/mail-status')

export function getPlans(from, to, filters = {}) {
  const q = new URLSearchParams({ from, to })
  if (filters.worker_id) q.set('worker_id', filters.worker_id)
  if (filters.vehicle_id) q.set('vehicle_id', filters.vehicle_id)
  return request('GET', `/plans?${q}`)
}
export const getVehicleUsage = (from, to) =>
  request('GET', `/vehicle-usage?from=${from}&to=${to}`)
export const addPlan = (plan) => request('POST', '/plans', plan)
export const updatePlan = (id, patch) => request('PATCH', `/plans/${id}`, patch)
export const removePlan = (id) => request('DELETE', `/plans/${id}`)

// ── 휴가 승인 (2026-08-26 신설) ──
// 승인·반려는 대표이사만 할 수 있다. 서버가 막으므로 화면은 단추를 감추기만 한다.
export const setApproval = (id, approval, rejectReason) =>
  request('PATCH', `/plans/${id}/approval`, { approval, reject_reason: rejectReason })
// 연차 부여·사용·잔여. 관리자가 아니면 서버가 «본인 것만» 돌려준다.
export const getVacationSummary = (on) =>
  request('GET', `/vacation-summary${on ? `?on=${on}` : ''}`)

// ── 로그인 (정산 화면 전용) ──
// 계정·세션을 KPI 추적 시스템과 공유한다 — KPI 에서 로그인했으면 여기서도 통한다.
// credentials:'include' 가 없으면 쿠키가 실려 가지 않는다.
async function authRequest(method, path, body) {
  const res = await fetch('/api' + path, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { /* JSON 이 아니면 원문 */ }
  if (!res.ok) {
    const err = new Error(data?.error || text || `요청 실패 (HTTP ${res.status})`)
    err.status = res.status
    throw err
  }
  return data
}

export const login = (loginId, password) =>
  authRequest('POST', '/auth/login', { login_id: loginId, password })
export const logout = () => authRequest('POST', '/auth/logout')
export const whoAmI = () => authRequest('GET', '/auth/me')

// ── 정산 ──
// workerId 를 주면 «그 사람만» 확정·해제한다. 주지 않으면 그달 전원 (종전 동작).
// 🔑 사람마다 정산이 끝나는 시점이 다르다 — 출장에서 늦게 돌아온 한 사람 때문에
//    나머지 일곱 명의 정산까지 미뤄 두어야 하는 것이 이 화면의 가장 큰 불편이었다.
// 🔑 정산은 «두 단계» 다 (2026-09-04).
//    notify   1차 — 금액을 박제하고 실적을 잠근 뒤 각 직원에게 안내 메일
//    complete 2차 — 입금을 확인하고 완료
//    입금할 금액이 없는 사람은 1차에서 바로 완료가 된다(서버가 판정한다).
export const getSettlement = (ym) => authRequest('GET', `/schedule/settlement?ym=${ym}`)
export const notifySettlement = (ym, workerId) =>
  authRequest('POST', `/schedule/settlement/${ym}/notify`,
    workerId ? { worker_id: workerId } : {})
export const completeSettlement = (ym, workerId) =>
  authRequest('POST', `/schedule/settlement/${ym}/complete`,
    workerId ? { worker_id: workerId } : {})
export const reopenSettlement = (ym, workerId) =>
  authRequest('POST', `/schedule/settlement/${ym}/reopen`,
    workerId ? { worker_id: workerId } : {})

// ── 실적 ──
export function getActuals(from, to, workerId) {
  const q = new URLSearchParams({ from, to })
  if (workerId) q.set('worker_id', workerId)
  return request('GET', `/actuals?${q}`)
}
// plan_id 만 주면 계획 내용이 그대로 실적이 된다 (「계획대로」 버튼)
export const addActual = (actual) => request('POST', '/actuals', actual)
export const updateActual = (id, patch) => request('PATCH', `/actuals/${id}`, patch)
export const removeActual = (id) => request('DELETE', `/actuals/${id}`)
