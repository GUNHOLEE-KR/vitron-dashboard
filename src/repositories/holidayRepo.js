const BASE = '/api'

// 공휴일 — 「어느 날이 휴일인가」. 야간·휴일 근무 판정과 가동일 계산이 함께 쓴다.
// 출처는 서버가 하루 1회 받아 오는 Google 「대한민국의 휴일」 달력이다.
async function request(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
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

export const getHolidays = () => request('GET', '/holidays')
export const syncHolidays = () => request('POST', '/holidays/sync')
export const addHoliday = (date, name, note) => request('POST', '/holidays', { date, name, note })
// 「공휴일이지만 우리는 근무」 — 지우지 않고 되돌린다.
// 지우면 다음 동기화가 다시 넣기 때문이다.
export const setHolidayWorking = (date, isWorking) =>
  request('PATCH', `/holidays/${date}`, { is_working: isWorking })
export const removeHoliday = (date) => request('DELETE', `/holidays/${date}`)

// 실제로 쉬는 날만 모아 Set 으로 만든다 — 「그날 근무」로 표시한 날은 뺀다.
export const restDaySet = (rows) =>
  new Set((rows || []).filter(h => !h.is_working).map(h => h.date))
