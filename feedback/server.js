// 바이트론 의견 접수 서비스 (2026-08-29 신설)
// ==============================================================
// 하는 일은 둘뿐이다.
//   ① GET  /widget.js    위젯을 내려 준다 (어느 제품이든 script 한 줄로 붙인다)
//   ② POST /api/report   접수한 내용을 «메일로» 보낸다
//
// 🔑 DB 가 없다. 접수처가 메일이라 저장할 곳이 필요 없다 (2026-08-29 사용자 결정).
//    대신 «보냈는가» 를 사람에게 분명히 알린다 — 실패했는데 「보냈습니다」 라고
//    하면 그 의견은 아무도 모르게 사라진다. 그래서 이 API 만큼은
//    «메일을 보낸 뒤에» 응답한다 (다른 알림들과 다른 점).
//
// ⚠ 실패해도 내용을 잃지 않도록 서버 로그에 통째로 남긴다. 메일이 며칠 막혀 있어도
//   로그에서 건져 낼 수 있어야 한다.
//
// 🔑 CORS 를 연다. 대시보드(:8082)·KPI(:8083)·RTDB 등 «다른 출처» 에서 부르기 때문이다.
//    받기만 하고 돌려주는 정보가 없으므로 열어도 새어 나갈 것이 없다.
const express = require('express')
const path = require('path')
const nodemailer = require('nodemailer')

const app = express()
const PORT = Number(process.env.PORT || 3003)

// 캡처를 base64 로 받으므로 본문이 커진다. 4MB × 3장 + 여유.
app.use(express.json({ limit: '20mb' }))

// ── CORS ────────────────────────────────────────────────────
// ⚠ 어느 제품에서 부를지 미리 알 수 없다(RTDB 등). 그래서 출처를 가리지 않는다.
//   쿠키를 쓰지 않으므로 credentials 는 열지 않는다 — 남의 세션이 실려 올 일이 없다.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

// 위젯은 자주 바뀌므로 오래 캐시하지 않는다 — 고친 문구가 며칠 뒤에 반영되면
// 「한 곳만 고치면 전부 반영」이라는 이 구조의 뜻이 없어진다.
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '5m' }))

app.get('/api/health', (req, res) => res.json({ ok: true, mail: mailReady() }))

// ── 메일 ────────────────────────────────────────────────────
const cfg = () => ({
  host: process.env.MAIL_HOST || 'smtp.daum.net',
  port: Number(process.env.MAIL_PORT || 465),
  user: process.env.MAIL_SMTP_USER || '',
  pass: process.env.MAIL_PASS || '',
  from: process.env.MAIL_FROM || '',
  // 접수처. 사용자 지시로 이건호에게 모인다 (2026-08-29).
  to: process.env.FEEDBACK_MAIL_TO || 'gunholee@vi-tron.com',
})
const mailReady = () => {
  const c = cfg()
  return !!(c.user && c.pass && c.from && c.to)
}

let tx = null
function transport() {
  const c = cfg()
  if (!tx) {
    tx = nodemailer.createTransport({
      host: c.host, port: c.port, secure: c.port === 465,
      auth: { user: c.user, pass: c.pass },
      connectionTimeout: 30000, greetingTimeout: 30000, socketTimeout: 30000,
    })
  }
  return tx
}

const KIND = {
  bug:     { icon: '🐞', label: '에러' },
  improve: { icon: '🔧', label: '불편' },
  feature: { icon: '✨', label: '기능' },
}

const clip = (s, n) => {
  const t = String(s == null ? '' : s)
  return t.length > n ? t.slice(0, n) + '…' : t
}

// dataUrl → 첨부. 형식이 아니면 조용히 버린다 (본문은 살려야 한다).
function toAttachment(shot, i) {
  const m = /^data:(image\/[a-z.+-]+);base64,(.+)$/i.exec(String(shot?.dataUrl || ''))
  if (!m) return null
  const ext = (m[1].split('/')[1] || 'png').replace('jpeg', 'jpg')
  return {
    filename: clip(shot.name, 60) || `캡처-${i + 1}.${ext}`,
    content: Buffer.from(m[2], 'base64'),
    contentType: m[1],
  }
}

app.post('/api/report', async (req, res) => {
  const b = req.body || {}
  const text = String(b.text || '').trim()
  if (!text) return res.status(400).json({ error: '내용이 비어 있습니다.' })

  const k = KIND[b.kind] || { icon: '📝', label: '의견' }
  const product = clip(b.product, 60) || '(제품 미상)'
  // 🔑 이름은 «선택» 이다 (2026-08-29 사용자 결정). 비우면 익명으로 간다.
  const who = clip(b.reporter, 40)
  const shots = Array.isArray(b.shots) ? b.shots.slice(0, 3) : []
  const attachments = shots.map(toAttachment).filter(Boolean)

  const subject = `[의견] ${k.icon} ${k.label} · ${product}${who ? ` · ${who}` : ' · 익명'}`
  const body = [
    `${k.icon} ${k.label} 의견이 들어왔습니다.`,
    '',
    `제품     : ${product}`,
    `보낸 사람 : ${who || '(익명 — 이름을 적지 않으셨습니다)'}`,
    '',
    '── 내용 ' + '─'.repeat(40),
    clip(text, 8000),
    '─'.repeat(48),
    '',
    `화면 주소 : ${clip(b.page, 300) || '-'}`,
    `창 크기   : ${clip(b.screen, 20) || '-'}`,
    `브라우저  : ${clip(b.agent, 300) || '-'}`,
    `캡처      : ${attachments.length ? attachments.length + '장 (첨부)' : '없음'}`,
    '',
    '— 바이트론 이앤에스 의견 접수',
  ].join('\n')

  // ⚠ 메일이 꺼져 있으면 «보낸 척하지 않는다». 위젯이 그대로 사람에게 알린다.
  if (!mailReady()) {
    console.error('[feedback] 메일 설정이 없어 보내지 못했습니다:\n' + body)
    return res.status(500).json({ error: '메일 설정이 서버에 없습니다. 관리자에게 알려 주세요.' })
  }

  const c = cfg()
  try {
    await transport().sendMail({
      from: { name: `${who || '익명'} (의견 접수)`, address: c.from },
      to: c.to,
      subject,
      text: body,
      attachments,
    })
    console.log(`[feedback] sent :: ${subject} (캡처 ${attachments.length}장)`)
    res.json({ ok: true })
  } catch (e) {
    // 🔴 내용을 통째로 남긴다. 메일이 막혀 있어도 로그에서 건져 낼 수 있어야 한다.
    console.error(`[feedback] FAILED :: ${e.message}\n${body}`)
    tx = null                       // 연결이 상했을 수 있으니 버린다
    res.status(500).json({ error: e.message })
  }
})

app.listen(PORT, () => {
  console.log(`의견 접수 서비스 실행 중 — 포트 ${PORT}`)
  if (!mailReady()) console.warn('⚠ 메일 설정(MAIL_*)이 없습니다 — 접수는 실패로 응답합니다.')
})
