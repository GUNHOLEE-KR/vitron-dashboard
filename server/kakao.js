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
//   KAKAO_SENDER        (2026-09-25, 048) 보내는 사람의 로그인 아이디 — 있으면 그 사람의 카카오에서
//                       받는 사람(친구)에게 «친구 메시지» 로 보낸다. 없거나 받는 사람과 같으면
//                       예전처럼 「나에게 보내기」
//
// ⚠ 친구 메시지 규칙 (카카오 공식 문서, 2026-09-25 확인)
//   · 받는 사람도 우리 앱에 카카오 로그인(연결)하고 「친구 목록」·「메시지 전송」 에 동의해야 한다
//   · 심사 전에는 받는 사람이 «앱 멤버» 여야 하고 하루 30건까지다
//   · 받는 사람은 친구 목록의 uuid 로 지정한다 — 우리는 연결 때 적어 둔 카카오 사용자 번호로 찾는다
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
  sender: String(process.env.KAKAO_SENDER || '').trim(),
})

// 필수 두 값이 있어야 «켜진» 것이다
const isConfigured = () => !!(cfg().key && cfg().redirect)

// 메시지의 [대시보드에서 보기] 단추가 여는 주소 — 되돌아올 주소와 같은 집(origin)이다.
// ⚠ 이 집이 카카오 앱의 「사이트 도메인」 에 등록돼 있어야 단추가 열린다.
function appUrl(hash = '') {
  try { return new URL(cfg().redirect).origin + '/' + hash } catch { return '' }
}

// 카카오 로그인(동의) 화면 주소. talk_message = 「카카오톡 메시지 전송」, friends = 「카카오 서비스 내
// 친구목록」 동의 항목. 누가 무엇을 요청할지는 index.js 가 정한다(보내는 사람·받는 사람).
function authorizeUrl(state, scopes = ['talk_message']) {
  const c = cfg()
  const p = new URLSearchParams({
    client_id: c.key, redirect_uri: c.redirect, response_type: 'code',
    scope: scopes.join(','), state,
  })
  return `${AUTH}/oauth/authorize?${p}`
}

async function post(url, form, headers = {}) {
  return call(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8', ...headers },
    body: new URLSearchParams(form),
  })
}

async function get(url, accessToken) {
  return call(url, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } })
}

async function call(url, init) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) })
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
    // 받은 동의(공백 구분). 갱신 응답에는 없을 수 있다 — 그때는 null(부르는 쪽이 옛것을 유지)
    scope: d.scope ? String(d.scope) : null,
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

// 연결한 사람의 카카오 사용자 번호 — 친구 목록에서 그 사람을 찾는 열쇠다
async function userId(accessToken) {
  const d = await get(`${API}/v2/user/me`, accessToken)
  return d?.id != null ? String(d.id) : null
}

// 친구 목록 — «우리 앱에 연결했고 프로필을 공개한» 친구만 온다(카카오 규칙). 100명씩 끝까지.
// 받는 사람 한 명을 찾는 데만 쓰므로 목록 자체를 밖으로 내보내지 않는다(index.js).
async function friends(accessToken) {
  const all = []
  for (let offset = 0; offset < 2000; offset += 100) {
    const d = await get(`${API}/v1/api/talk/friends?limit=100&offset=${offset}`, accessToken)
    const els = d?.elements || []
    all.push(...els)
    if (els.length < 100 || all.length >= Number(d?.total_count || 0)) break
  }
  return all
}

// 친구에게 보내기 — 받는 사람은 uuid 로. 카카오는 «일부 실패» 를 200 으로 주므로 직접 따진다
async function sendFriend(accessToken, uuid, { text, url, buttonTitle = '대시보드에서 보기' }) {
  const link = { web_url: url, mobile_web_url: url }
  const template = { object_type: 'text', text: fitText(text), link, button_title: buttonTitle }
  const d = await post(`${API}/v1/api/talk/friends/message/default/send`,
    { receiver_uuids: JSON.stringify([uuid]), template_object: JSON.stringify(template) },
    { Authorization: `Bearer ${accessToken}` })
  if (!(d?.successful_receiver_uuids || []).includes(uuid)) {
    const f = (d?.failure_info || [])[0]
    const err = new Error(`카카오가 보내지 못했습니다${f ? ` (${f.code}: ${f.msg})` : ''}`)
    err.status = 409
    throw err
  }
  return d
}

module.exports = { cfg, isConfigured, appUrl, authorizeUrl, exchangeCode, refresh, sendMemo, fitText, TEXT_MAX,
  userId, friends, sendFriend }
