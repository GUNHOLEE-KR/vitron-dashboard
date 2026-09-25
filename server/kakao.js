// 카카오톡 「나에게 보내기」 (2026-09-25 신설)
// ============================================================
// 🔑 무료 방식이다(사용자 선택). 받을 사람이 자기 카카오 계정을 «한 번 연결» 해 두면
//    그 사람의 「나와의 채팅」 으로 보낸다. 알림톡(유료·문구 사전 심사·대행사 계약)이 아니다.
//
// 설정 (.env) — 없으면 기능만 «꺼진» 상태로 돈다. 나머지 대시보드는 그대로다.
//   KAKAO_REST_KEY      카카오 디벨로퍼스 앱의 REST API 키
//   KAKAO_CLIENT_SECRET 보안 → Client Secret 을 켰으면 그 값 (안 켰으면 비워 둔다)
//   KAKAO_REDIRECT_URI  예: http://vitron-nas:8082/api/kakao/callback
//                       ⚠ 카카오 앱의 「Redirect URI」 에 «글자 그대로» 등록해야 한다
//   KAKAO_TO_TEST       (테스트 서버만) 받는 사람의 로그인 아이디 — 없으면 대표이사
//
// ⚠ 토큰 규칙 (카카오 공식 문서 기준 — 바뀌면 여기만 고친다)
//   · access 토큰은 몇 시간이면 끝난다 → 보낼 때마다 남은 시간을 보고 필요하면 갱신
//   · refresh 토큰은 약 두 달 → 갱신할 때 남은 기간이 짧으면 «새 refresh 토큰» 이 온다.
//     그래서 서버가 하루 한 번 갱신해 두면 끊기지 않는다(index.js 의 하루 점검)
//   · 「나에게 보내기」 기본 글 템플릿의 본문은 200자까지다
const AUTH = 'https://kauth.kakao.com'
const API = 'https://kapi.kakao.com'
const TEXT_MAX = 200

const cfg = () => ({
  key: String(process.env.KAKAO_REST_KEY || '').trim(),
  secret: String(process.env.KAKAO_CLIENT_SECRET || '').trim(),
  redirect: String(process.env.KAKAO_REDIRECT_URI || '').trim(),
  testTo: String(process.env.KAKAO_TO_TEST || '').trim(),
})

// 필수 두 값이 있어야 «켜진» 것이다
const isConfigured = () => !!(cfg().key && cfg().redirect)

// 메시지의 [대시보드에서 보기] 단추가 여는 주소 — 되돌아올 주소와 같은 집(origin)이다.
// ⚠ 이 집이 카카오 앱의 「사이트 도메인」 에 등록돼 있어야 단추가 열린다.
function appUrl(hash = '') {
  try { return new URL(cfg().redirect).origin + '/' + hash } catch { return '' }
}

// 카카오 로그인(동의) 화면 주소. talk_message = 「카카오톡 메시지 전송」 동의 항목
function authorizeUrl(state) {
  const c = cfg()
  const p = new URLSearchParams({
    client_id: c.key, redirect_uri: c.redirect, response_type: 'code',
    scope: 'talk_message', state,
  })
  return `${AUTH}/oauth/authorize?${p}`
}

async function post(url, form, headers = {}) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8', ...headers },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(15000),
  })
  const text = await r.text()
  let data = null
  try { data = JSON.parse(text) } catch { /* 카카오가 JSON 이 아닌 것을 주는 경우 */ }
  if (!r.ok) {
    // 사람이 읽을 사유 — 카카오는 error_description(인증) / msg(API) 에 담아 준다
    const why = data?.error_description || data?.msg || data?.error || text || `HTTP ${r.status}`
    const err = new Error(`카카오 ${r.status}: ${why}`)
    err.status = r.status
    err.code = data?.error || data?.code
    throw err
  }
  return data
}

// 토큰 응답 → 우리가 담을 꼴. refresh 가 안 왔으면(갱신 때 흔함) null — 부르는 쪽이 옛것을 유지
function tokenOut(d) {
  const now = Date.now()
  return {
    access: d.access_token,
    accessExpiresAt: new Date(now + Number(d.expires_in || 0) * 1000),
    refresh: d.refresh_token || null,
    refreshExpiresAt: d.refresh_token_expires_in
      ? new Date(now + Number(d.refresh_token_expires_in) * 1000) : null,
  }
}

async function exchangeCode(code) {
  const c = cfg()
  const form = { grant_type: 'authorization_code', client_id: c.key, redirect_uri: c.redirect, code }
  if (c.secret) form.client_secret = c.secret
  return tokenOut(await post(`${AUTH}/oauth/token`, form))
}

async function refresh(refreshToken) {
  const c = cfg()
  const form = { grant_type: 'refresh_token', client_id: c.key, refresh_token: refreshToken }
  if (c.secret) form.client_secret = c.secret
  return tokenOut(await post(`${AUTH}/oauth/token`, form))
}

// 200자에 맞춘다 — 넘기면 카카오가 통째로 거절한다
function fitText(s) {
  const t = String(s || '')
  return t.length <= TEXT_MAX ? t : t.slice(0, TEXT_MAX - 1) + '…'
}

async function sendMemo(accessToken, { text, url, buttonTitle = '대시보드에서 보기' }) {
  const link = { web_url: url, mobile_web_url: url }
  const template = { object_type: 'text', text: fitText(text), link, button_title: buttonTitle }
  return post(`${API}/v2/api/talk/memo/default/send`,
    { template_object: JSON.stringify(template) },
    { Authorization: `Bearer ${accessToken}` })
}

module.exports = { cfg, isConfigured, appUrl, authorizeUrl, exchangeCode, refresh, sendMemo, fitText, TEXT_MAX }
