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

// ── 계획 ──
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
