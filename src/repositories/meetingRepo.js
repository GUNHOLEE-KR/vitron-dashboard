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

// 참석자별 발표 내용 (2026-09-07 신설 · 09-08 프로젝트 추가).
// 🔑 «자기 것만» 적을 수 있다(관리자는 대리 입력 가능). 비워 보내면 그 칸을 지운다.
//    돌아오는 것은 «회의록 전체» 다 — 화면이 notes 를 함께 들고 다시 그린다.
// 🔑 열쇠는 «한 회의 · 한 사람 · 한 프로젝트» — 같은 사람이 프로젝트를 나눠 적는다.
//    프로젝트를 안 고르면 「미지정」 줄 하나가 된다.
export const saveMeetingNote = (meetingId, workerId, bodyHtml, project = {}) =>
  request('PUT', `/${meetingId}/notes/${workerId}`, {
    body_html: bodyHtml,
    parent_key: project.parent_key || null,
    parent_text: project.parent_text || null,
  })
