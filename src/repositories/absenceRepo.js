// 장기 부재(장기출장·휴직·파견) 기간.
// 이 기간은 집계에서 «가동일»에서 빠지고, 그 기간에 남은 업무 기록도 세지 않는다.
const BASE = '/api'

async function req(path, options) {
  const res = await fetch(BASE + path, options)
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { /* 아래에서 원문으로 알린다 */ }
  if (!res.ok) throw new Error(data?.error || text || `요청 실패 (${res.status})`)
  return data
}

export function getAbsences() {
  return req('/worker-absences')
}

export function addAbsence(absence) {
  return req('/worker-absences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(absence)
  })
}

export function updateAbsence(id, absence) {
  return req(`/worker-absences/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(absence)
  })
}

export function removeAbsence(id) {
  return req(`/worker-absences/${id}`, { method: 'DELETE' })
}
