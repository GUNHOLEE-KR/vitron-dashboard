// 안건 — 회의에서 나온 것·확인할 것 (2026-09-04 신설)
// 대시보드에 적고, 키울 것만 Jira 로 올린다.
const BASE = '/api/agenda'

// ⚠ 로그인 세션을 쓰므로 credentials:'include' 가 필요하다.
async function request(method, path, body) {
  const res = await fetch(BASE + path, {
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

export function getAgenda({ status, ownerId, parentKey } = {}) {
  const q = new URLSearchParams()
  if (status) q.set('status', status)
  if (ownerId) q.set('owner_id', ownerId)
  if (parentKey) q.set('parent_key', parentKey)
  const s = q.toString()
  return request('GET', s ? `?${s}` : '')
}

export const addAgenda = (row) => request('POST', '', row)
export const updateAgenda = (id, patch) => request('PATCH', `/${id}`, patch)
export const removeAgenda = (id) => request('DELETE', `/${id}`)
// 관리자 확인 — 이때 Jira 이슈도 «완료» 로 넘어간다.
export const confirmAgenda = (id) => request('POST', `/${id}/confirm`)
export const agendaToJira = (id) => request('POST', `/${id}/to-jira`)
