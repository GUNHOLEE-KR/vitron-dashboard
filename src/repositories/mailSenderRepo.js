// 사람마다의 메일 발송 계정 (2026-08-29 신설)
// ⚠ 앱 비밀번호는 «보내기만» 한다. 서버는 되돌려 주지 않으므로 화면에 다시 띄울 수 없다.
const BASE = '/api'

// 서버가 {"error":"..."} 로 답한다. 그 문구만 꺼내 쓴다 —
// 원본 JSON 이 그대로 화면에 뜨면 사람이 읽을 수 없다.
async function fail(res) {
  const text = await res.text()
  let message = text
  try { message = JSON.parse(text).error || text } catch { /* JSON 이 아니면 원문을 쓴다 */ }
  throw new Error(message)
}

export async function getMyMailSender() {
  const res = await fetch(`${BASE}/mail-sender/me`, { credentials: 'same-origin' })
  if (!res.ok) await fail(res)
  return res.json()
}

// 서버가 저장 «전에» 실제로 접속해 본다. 틀리면 400 과 함께 까닭이 온다.
export async function saveMyMailSender(smtpUser, password) {
  const res = await fetch(`${BASE}/mail-sender/me`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ smtp_user: smtpUser, password })
  })
  if (!res.ok) await fail(res)
}

export async function removeMyMailSender() {
  const res = await fetch(`${BASE}/mail-sender/me`, {
    method: 'DELETE', credentials: 'same-origin'
  })
  if (!res.ok) await fail(res)
}
