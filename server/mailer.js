// 차량 예약 알림 메일 (2026-08-25 신설)
// ============================================================
// 일정에 «차량이 걸린» 계획이 등록·수정·취소되면 대표이사에게 한 통 보낸다.
//
// 🔑 보내는 사람을 «등록한 직원» 으로는 못 한다 — 다음이 막는다.
//    실측(2026-08-25): 봉투 주소(MAIL FROM)는 통과하는데 본문을 보내는 순간
//      550 5.7.0 no permitted from-header address
//    로 잘린다. 즉 **From 머리글은 로그인한 계정이 가진 주소여야** 한다.
//    그래서 «주소는 한 개, 표시 이름과 답장 주소를 등록자로» 둔다.
//      보낸사람 : 송지형 (업무 대시보드) <gunholee@vi-tron.com>
//      답장하면 : 송지형 <jihyeong55@vi-tron.com>
//    받는 쪽 필터는 제목 머리말 `[차량]` 로 건다.
//
// 🔑 메일이 실패해도 «예약 자체는 막지 않는다». 감사 로그와 같은 원칙이다 —
//    메일 서버가 잠깐 죽었다고 차를 못 잡으면 안 된다.
//
// ⚠ MAIL_PASS 가 비어 있으면 기능만 조용히 꺼지고 나머지는 그대로 돈다.
//   다만 «꺼져 있다» 는 사실은 설정 화면에서 볼 수 있어야 한다 — 안 그러면
//   멈춘 줄도 모른다. lastResult() 가 그 창구다.
const nodemailer = require('nodemailer')

const cfg = () => ({
  host: process.env.MAIL_HOST || 'smtp.daum.net',
  port: Number(process.env.MAIL_PORT || 465),
  user: process.env.MAIL_SMTP_USER || '',
  pass: process.env.MAIL_PASS || '',
  from: process.env.MAIL_FROM || '',
  to:   process.env.MAIL_TO || '',
})

const isEnabled = () => {
  const c = cfg()
  return !!(c.user && c.pass && c.from && c.to)
}

// 마지막 발송 결과. 설정 화면이 읽어 「살아 있는가」 를 보여 준다.
let last = { at: null, ok: null, detail: '아직 보낸 적이 없습니다.' }
const lastResult = () => ({ enabled: isEnabled(), ...last })

let tx = null
function transport() {
  const c = cfg()
  if (!tx) {
    tx = nodemailer.createTransport({
      host: c.host,
      port: c.port,
      // ⚠ 465 는 «처음부터» SSL 로 붙는 포트다. STARTTLS(587)와 다르다.
      secure: c.port === 465,
      auth: { user: c.user, pass: c.pass },
      // ⚠ 찬 연결이 느려 첫 통이 떨어진 적이 있다 — 넉넉히 준다.
      connectionTimeout: 30000,
      greetingTimeout: 30000,
      socketTimeout: 30000,
    })
  }
  return tx
}

// ── 무엇을 알릴 것인가 ───────────────────────────────────────
// 사용자 결정(2026-08-25):
//   회사 차량 업무  → 알린다 (배차라서)
//   차량 개인 사용  → 알린다 (거리×단가로 «청구» 가 걸린다)
//   자차 업무       → 알리지 않는다 (회사 차를 잡지 않는다)
//   휴가·사무실 내근 → 알리지 않는다
function isVehiclePlan(p) {
  if (!p) return false
  if (p.use_type === 'personal') return true                       // 차량 개인 사용
  if (p.use_type === 'business' && p.transport === 'company_car') return true
  return false
}

const WD = ['일', '월', '화', '수', '목', '금', '토']
function dayLabel(d) {
  if (!d) return '-'
  const s = String(d).slice(0, 10)
  const [y, m, dd] = s.split('-').map(Number)
  // ⚠ new Date('YYYY-MM-DD') 는 UTC 로 읽혀 하루 밀린다. 숫자로 넘긴다.
  const wd = WD[new Date(y, m - 1, dd).getDay()]
  return `${m}/${dd}(${wd})`
}
const SLOT = { allday: '종일', am: '오전', pm: '오후', time: '시간 지정' }

function planLine(p) {
  const bits = [dayLabel(p.plan_date)]
  if (p.slot && p.slot !== 'allday') bits.push(SLOT[p.slot] || p.slot)
  if (p.use_type === 'personal') {
    bits.push('개인 사용')                 // 🔑 개인 사용의 행선지는 적지 않는다 (사생활)
  } else {
    bits.push(p.place_name || p.place_text || '장소 미정')
    if (p.purpose) bits.push(p.purpose)
  }
  const car = [p.vehicle_name, p.vehicle_plate].filter(Boolean).join(' ')
  if (car) bits.push(car)
  bits.push(p.round_trip ? '왕복' : `편도${p.one_way_dir ? ' ' + p.one_way_dir : ''}`)
  if (p.est_distance_km) bits.push(`${Number(p.est_distance_km)}km`)
  return '  · ' + bits.join(' · ')
}

const TITLE = { create: '등록', update: '변경', delete: '취소' }

function build({ kind, actorName, actorEmail, plans, conflicts }) {
  const c = cfg()
  const first = plans[0] || {}
  const who = first.worker_name || actorName || '누군가'
  const car = [first.vehicle_name, first.vehicle_plate].filter(Boolean).join(' ')

  // 제목 — 받는 쪽에서 «제목으로» 거를 수 있어야 한다 (주소는 하나뿐이라서).
  const many = plans.length > 1 ? ` 외 ${plans.length - 1}건` : ''
  const subject = `[차량] ${TITLE[kind]} · ${who} · ${dayLabel(first.plan_date)}${many}`
    + (car ? ` · ${car}` : '')

  const body = [
    `${who} 님이 차량 예약을 ${TITLE[kind]}했습니다.`,
    '',
    ...plans.map(planLine),
    '',
  ]
  if (conflicts && conflicts.length) {
    body.push('⚠ 같은 차량을 이미 잡아 둔 사람이 있습니다 — 그대로 등록했습니다.')
    conflicts.forEach(x => body.push(`  · ${x.worker_name} (${SLOT[x.slot] || x.slot})`))
    body.push('')
  }
  body.push(
    `등록한 사람 : ${actorName || '-'}${actorEmail ? ` <${actorEmail}>` : ''}`,
    '',
    '배차표는 업무 현황 대시보드의 [스케줄] 탭에서 「차량」 기준으로 보시면 됩니다.',
    'http://vitron-nas:8082',
    '',
    '— 바이트론 이앤에스 업무 현황 대시보드',
  )

  return {
    from: { name: `${actorName || '업무'} (업무 대시보드)`, address: c.from },
    // 🔑 답장은 «등록한 사람» 에게 간다. 주소를 하나로 묶은 것을 이걸로 메운다.
    replyTo: actorEmail ? `${actorName} <${actorEmail}>` : undefined,
    to: c.to,
    subject,
    text: body.join('\n'),
  }
}

// ── 여러 날짜를 한 통으로 묶기 ───────────────────────────────
// 화면이 「출장 3일」을 넣으면 계획을 «날짜마다 따로» 저장한다(addPlan 반복).
// 그대로 두면 메일이 세 통 간다. 화면이 한 번의 등록마다 붙여 보내는
// batch_id 로 모았다가 «조용해지면» 한 통으로 보낸다.
//
// ⚠ 메모리에만 둔다. 서버가 중간에 죽으면 그 통은 못 가지만 계획은 이미 저장돼 있다 —
//   메일 때문에 저장을 붙잡지 않는다는 원칙 그대로다.
const BATCH_MS = 4000
const batches = new Map()

function queue(key, payload) {
  const cur = batches.get(key)
  if (cur) {
    clearTimeout(cur.timer)
    cur.plans.push(...payload.plans)
    cur.conflicts.push(...(payload.conflicts || []))
    cur.timer = setTimeout(() => flush(key), BATCH_MS)
    return
  }
  batches.set(key, {
    ...payload,
    conflicts: payload.conflicts || [],
    timer: setTimeout(() => flush(key), BATCH_MS),
  })
}

async function flush(key) {
  const b = batches.get(key)
  batches.delete(key)
  if (!b) return
  b.plans.sort((x, y) => String(x.plan_date).localeCompare(String(y.plan_date)))
  await send(build(b))
}

// 🔑 한 번 실패했다고 포기하지 않는다.
//    실측(2026-08-25): 서버를 올리고 «첫 통» 이 Timeout 으로 떨어졌고, 같은 내용을
//    다시 보내니 바로 갔다. 찬 연결이 느렸을 뿐이다. 그런데 그 한 통이 조용히
//    사라지면 대표이사는 배차를 못 보고, 아무도 그 사실을 모른다.
const TRIES = 3
const wait = ms => new Promise(r => setTimeout(r, ms))

async function send(msg) {
  let lastErr = null
  for (let i = 1; i <= TRIES; i++) {
    try {
      await transport().sendMail(msg)
      const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19)
      last = {
        at: stamp, ok: true,
        detail: `${msg.to} 로 보냈습니다${i > 1 ? ` (${i}번째 시도)` : ''}`,
      }
      console.log(`[mail] sent to ${msg.to} :: ${msg.subject}${i > 1 ? ` (retry ${i})` : ''}`)
      return
    } catch (e) {
      lastErr = e
      console.error(`[mail] attempt ${i}/${TRIES} failed :: ${e.message}`)
      // 붙는 데 실패한 것이면 연결을 버리고 새로 맺는다
      try { tx?.close() } catch { /* 이미 닫혔을 수 있다 */ }
      tx = null
      if (i < TRIES) await wait(3000 * i)
    }
  }
  // 🔑 여기서도 절대 다시 던지지 않는다. 부르는 쪽(예약 저장)이 실패하면 안 된다.
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19)
  last = { at: stamp, ok: false, detail: `${TRIES}번 시도했지만 실패했습니다 — ${lastErr?.message}` }
  console.error(`[mail] GAVE UP :: ${lastErr?.message}`)
}

// ── 바깥에서 부르는 것 ───────────────────────────────────────
// 부르는 쪽은 await 하지 않아도 된다. 실패는 여기서 삼킨다.
function notify({ kind, actor, plans, conflicts, batchId }) {
  try {
    if (!isEnabled()) return
    const list = (Array.isArray(plans) ? plans : [plans]).filter(isVehiclePlan)
    if (!list.length) return

    const payload = {
      kind,
      actorName: actor?.name || null,
      actorEmail: actor?.email || null,
      plans: list,
      conflicts: conflicts || [],
    }
    // 등록만 묶는다. 수정·취소는 한 건씩 일어나므로 바로 보낸다.
    if (kind === 'create' && batchId) queue(`${kind}|${batchId}`, payload)
    else send(build(payload))
  } catch (e) {
    console.error(`[mail] notify error :: ${e.message}`)
  }
}

module.exports = { notify, isEnabled, lastResult, isVehiclePlan }
