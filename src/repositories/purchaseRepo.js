// 구매 요청 — 요청 · 승인 · 이력 (2026-08-26 신설)
// 승인된 것이 곧 구매 이력이라 목록 API 가 하나뿐이다.
const BASE = '/api/purchases'

// 서버는 {"error":"..."} 로 답한다. 그 문구만 꺼내 쓴다.
// ⚠ try 안에서 곧바로 throw 하면 자기 catch 에 걸려 원본 JSON 이 그대로 화면에 뜬다.
//   (2026-08-06 에 실제로 겪은 결함이라 여기서도 파싱과 throw 를 나눠 둔다)
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

// 관리자가 아니면 서버가 «본인 것만» 돌려준다. 화면에서 거르지 않는다.
// ⚠ workerIds 는 관리자에게만 뜻이 있다 — 일반 직원이 남의 번호를 넣어도 서버가 막는다.
// 🔑 workerIds 를 «주지 않으면» 전 직원이고, «빈 배열» 이면 아무도 아니다. 둘은 다른 뜻이다.
export function getPurchases({ from, to, status, workerIds } = {}) {
  const q = new URLSearchParams()
  if (from) q.set('from', from)
  if (to) q.set('to', to)
  if (status) q.set('status', status)
  // ⚠ `if (workerIds)` 로 쓰면 «빈 배열» 이 truthy 라 통과하고, 빈 문자열이 나가
  //   서버가 「안 보냈다」로 읽어 전 직원을 돌려준다. undefined 인지로 가른다.
  if (workerIds !== undefined) q.set('worker_ids', workerIds.join(','))
  const s = q.toString()
  return request('GET', s ? `?${s}` : '')
}

export const addPurchase = (p) => request('POST', '', p)
// 승인·반려는 대표이사만 할 수 있다. 서버가 막으므로 화면은 단추를 감추기만 한다.
export const setPurchaseStatus = (id, status, rejectReason) =>
  request('PATCH', `/${id}/approval`, { status, reject_reason: rejectReason })
// ⚠ 승인된 건은 서버가 409 로 막는다 — 그것은 요청이 아니라 이미 구매 이력이다.
export const removePurchase = (id) => request('DELETE', `/${id}`)
