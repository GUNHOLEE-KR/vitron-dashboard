// 차량 관리 — 정비·검사·보험 이력과 기한 알림 (2026-09-24 신설)
//
// ⚠ scheduleRepo 와 주소 뿌리가 다르다(`/api/vehicle-care`). 차량 «예약·정산» 과
//   차량 «관리» 는 쓰는 자리도 권한도 달라 섞지 않는다.
const BASE = '/api/vehicle-care'

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
    throw err
  }
  return data
}

// { events, insurances } — vehicleId 를 주면 그 차만, 안 주면 법인차량 전체
export const getVehicleCare = (vehicleId) =>
  request('GET', vehicleId ? `?vehicle_id=${vehicleId}` : '')

// 기한이 30일 안으로 다가온 것(지난 것도 함께 — days_left 가 음수)
export const getVehicleDue = () => request('GET', '/due')

export const addVehicleEvent = (body) => request('POST', '/events', body)
export const updateVehicleEvent = (id, patch) => request('PATCH', `/events/${id}`, patch)
export const removeVehicleEvent = (id) => request('DELETE', `/events/${id}`)

export const addVehicleInsurance = (body) => request('POST', '/insurances', body)
export const updateVehicleInsurance = (id, patch) => request('PATCH', `/insurances/${id}`, patch)
export const removeVehicleInsurance = (id) => request('DELETE', `/insurances/${id}`)
