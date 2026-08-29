// 사람마다의 SMTP 앱 비밀번호를 봉하고 푼다 (2026-08-29 신설)
// ============================================================
// 🔑 Node 내장 crypto 만 쓴다. alpine 컨테이너에서 네이티브 빌드가 필요 없어야 해서다
//    (비밀번호 해시를 scrypt 로 둔 것과 같은 이유).
//
// 🔑 AES-256-GCM 인 이유 — 되돌릴 수 있어야 한다.
//    로그인 비밀번호는 «맞는지만» 보면 되니 해시로 충분하지만, 이 값은 SMTP 에
//    그대로 건네야 하므로 원문을 되찾을 수 있어야 한다. GCM 은 «몰래 고쳐진 것»
//    까지 잡아낸다 — DB 를 만진 흔적이 있으면 복호화가 실패한다.
//
// ⚠ 열쇠는 .env 의 MAIL_CRED_KEY 다 (hex 64자 = 32바이트).
//   · DB 에는 없다. DB 만 새어도 풀리지 않는다
//   · 반대로 «열쇠가 바뀌면 전원이 다시 등록» 해야 한다. 세 곳(.env 개발 PC ·
//     NAS 운영 · NAS 테스트)에서 같은 값을 유지할 것
const crypto = require('crypto')

const ALGO = 'aes-256-gcm'

// 열쇠를 읽는다. 없거나 형식이 틀리면 «조용히 넘어가지 않고» 던진다 —
// 열쇠가 없는데 기능이 반쯤 도는 것이 가장 나쁘다.
function keyBuf() {
  const hex = String(process.env.MAIL_CRED_KEY || '').trim()
  if (!hex) throw new Error('MAIL_CRED_KEY 가 .env 에 없습니다.')
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('MAIL_CRED_KEY 는 hex 64자(32바이트)여야 합니다.')
  }
  return Buffer.from(hex, 'hex')
}

// 열쇠가 갖춰졌는가. 화면이 「지금 등록을 받을 수 있는 상태인가」를 묻는 창구다.
function isReady() {
  try { keyBuf(); return true } catch { return false }
}

// 봉한다 → "iv:tag:암호문" (모두 hex)
function seal(plain) {
  const iv = crypto.randomBytes(12)                 // GCM 권장 길이
  const c = crypto.createCipheriv(ALGO, keyBuf(), iv)
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()])
  return [iv.toString('hex'), c.getAuthTag().toString('hex'), enc.toString('hex')].join(':')
}

// 푼다. 열쇠가 다르거나 값이 고쳐졌으면 여기서 던진다.
function open(blob) {
  const [ivHex, tagHex, encHex] = String(blob || '').split(':')
  if (!ivHex || !tagHex || !encHex) throw new Error('저장된 값의 형식이 올바르지 않습니다.')
  const d = crypto.createDecipheriv(ALGO, keyBuf(), Buffer.from(ivHex, 'hex'))
  d.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([d.update(Buffer.from(encHex, 'hex')), d.final()]).toString('utf8')
}

module.exports = { seal, open, isReady }
