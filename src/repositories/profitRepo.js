// 프로젝트 손익 — 대표이사 전용 (2026-09-25 신설)
//
// 🔴 서버가 직책(대표이사)으로 막는다. 화면이 탭을 숨기는 것은 편의일 뿐이고,
//    다른 사람이 주소를 직접 불러도 403 이 돌아온다.
const BASE = '/api/profit'

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

// ── 계약금액 — 고치지 않고 쌓는다 (가장 최근 줄이 지금 계약) ──
export const getContracts = () => request('GET', '/contracts')
// { parent_key, parent_text, amount, vat_included, contract_date, kind, note }
export const addContract = (body) => request('POST', '/contracts', body)
export const removeContract = (id) => request('DELETE', `/contracts/${id}`)

// ── 인건비 단가 — 사람별 시간당, 적용 시작일 이력 ──
export const getRates = () => request('GET', '/rates')
// { worker_id, hourly_rate, effective_from, note } — 같은 사람·같은 날이면 덮어쓴다
export const addRate = (body) => request('POST', '/rates', body)
export const removeRate = (id) => request('DELETE', `/rates/${id}`)
