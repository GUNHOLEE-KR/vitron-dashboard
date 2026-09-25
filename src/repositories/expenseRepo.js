// 출장 경비 — 법인카드 등으로 «이미 쓴» 돈의 기록 (2026-09-24 신설)
//
// ⚠ 구매 요청(purchaseRepo)과 다르다. 저것은 «사기 전» 결재이고 이것은 «쓴 뒤» 의
//   기록이라 승인 절차가 없다.
const BASE = '/api/expenses'

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
    // 🔴 영수증이 크면 nginx 가 «JSON 이 아닌» 413 쪽지를 돌려준다. 그때 원문을
    //    그대로 보이면 무슨 말인지 알 수 없으므로 사람 말로 바꿔 준다.
    if (res.status === 413) {
      throw new Error('영수증 사진이 너무 큽니다. 더 작게 찍거나 줄여서 올려 주십시오.')
    }
    const err = new Error(data?.error || text || `요청 실패 (HTTP ${res.status})`)
    err.status = res.status
    throw err
  }
  return data
}

const qs = (o) => {
  const p = new URLSearchParams()
  Object.entries(o || {}).forEach(([k, v]) => { if (v) p.set(k, v) })
  const s = p.toString()
  return s ? `?${s}` : ''
}

// { from, to, worker_id, parent_key } 로 좁힌다. 영수증 본문은 «빼고» 온다.
export const getExpenses = (filter) => request('GET', qs(filter))
// { by_project, by_worker, by_month, by_kind, total, count }
export const getExpenseSummary = (filter) => request('GET', `/summary${qs(filter)}`)

export const addExpense = (body) => request('POST', '', body)
export const updateExpense = (id, patch) => request('PATCH', `/${id}`, patch)
export const removeExpense = (id) => request('DELETE', `/${id}`)

// 영수증은 새 창에서 «보는» 것이라 주소만 만들어 준다 (내려받지 않는다).
export const receiptUrl = (id) => `${BASE}/${id}/receipt`

// ── 카카오톡 「나에게 보내기」 (2026-09-25) ──
// 🔑 등록·수정·삭제 때는 보내지 않는다(사용자 지시). 「미전송」 에서 고른 것만 보낸다.
export const sendExpensesKakao = (ids) => request('POST', '/kakao-send', { ids })

async function kakaoCall(method, path) {
  const res = await fetch('/api/kakao' + path, { method })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { /* JSON 이 아니면 원문을 쓴다 */ }
  if (!res.ok) throw new Error(data?.error || text || `요청 실패 (HTTP ${res.status})`)
  return data
}
// { configured, cred_ready, test, recipient:{name}, connected, can_connect, last_ok_at, last_error, … }
export const getKakaoStatus = () => kakaoCall('GET', '/status')
export const disconnectKakao = () => kakaoCall('DELETE', '/link')
// ⚠ 연결은 fetch 가 아니라 «주소 이동» 이다 — 카카오 동의 화면을 거쳐 설정 탭으로 돌아온다
export const KAKAO_CONNECT_URL = '/api/kakao/connect'
