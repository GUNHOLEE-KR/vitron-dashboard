// 회의록 — 회의 내용을 적고, 할 일이 된 것은 「안건」으로 떼어 단다 (2026-09-05 신설)
// 🔑 회의록을 지워도 안건은 남는다(회의만 떨어진다). 안건에는 기한·담당·Jira 가 걸려 있다.
const BASE = '/api/meetings'

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

export function getMeetings({ from, to } = {}) {
  const q = new URLSearchParams()
  if (from) q.set('from', from)
  if (to) q.set('to', to)
  const s = q.toString()
  return request('GET', s ? `?${s}` : '')
}

export const addMeeting = (row) => request('POST', '', row)
export const updateMeeting = (id, patch) => request('PATCH', `/${id}`, patch)
// 돌아오는 kept_agenda = 회의만 떨어지고 «남은» 안건 수.
export const removeMeeting = (id) => request('DELETE', `/${id}`)
