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
  // ⏳ 시험용 수신처. 있으면 «나가는 메일이 전부» 이리로 온다 —
  //    대표이사에게 갈 것(차량 예약·완료 보고·휴가/구매 신청)뿐 아니라
  //    🔴 «직원에게 갈 것»(휴가·구매 승인/반려)까지 포함한다. 시험 중에 남의 사서함으로
  //    「휴가가 승인되었습니다」가 날아가면 안 되기 때문이다.
  //    2026-08-26 사용자 지시로 담당자 본인 주소(이건호)를 넣어 두었다.
  //
  //    🔴 2026-08-29 «차량 예약 알림도» 이리로 돌렸다 (사용자 지시 —
  //       「개발·테스트 하는 동안에는 대표이사께 갈 메일을 모두 이건호로」).
  //       그전에는 build() 만 c.to(=MAIL_TO)를 직접 써서, 시험 중에 차를 잡을
  //       때마다 «진짜» 대표이사께 [차량] 메일이 갔다 — 유일하게 새던 구멍이었다.
  //       ⚠ MAIL_TO 자체는 그대로 둔다. isEnabled() 가 「설정이 갖춰졌는가」를
  //         이 값으로 판정하고, 운영에는 MAIL_TO_TEST 가 «없어» toBoss 가
  //         그대로 MAIL_TO 로 떨어지므로 운영 동작은 달라지지 않는다.
  //    시험이 끝나면 .env 에서 MAIL_TO_TEST 줄만 빼면 제자리로 돌아간다.
  testTo: process.env.MAIL_TO_TEST || '',
  toBoss: process.env.MAIL_TO_TEST || process.env.MAIL_TO || '',
})

const isEnabled = () => {
  const c = cfg()
  return !!(c.user && c.pass && c.from && c.to)
}

// 마지막 발송 결과. 설정 화면이 읽어 「살아 있는가」 를 보여 준다.
let last = { at: null, ok: null, detail: '아직 보낸 적이 없습니다.' }
const lastResult = () => ({ enabled: isEnabled(), ...last })

// 접속 하나를 만든다. 아이디·비밀번호만 다르고 나머지는 같다.
function makeTransport(user, pass) {
  const c = cfg()
  return nodemailer.createTransport({
    host: c.host,
    port: c.port,
    // ⚠ 465 는 «처음부터» SSL 로 붙는 포트다. STARTTLS(587)와 다르다.
    secure: c.port === 465,
    auth: { user, pass },
    // ⚠ 찬 연결이 느려 첫 통이 떨어진 적이 있다 — 넉넉히 준다.
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 30000,
  })
}

let tx = null
function transport() {
  const c = cfg()
  if (!tx) tx = makeTransport(c.user, c.pass)
  return tx
}

// 사람마다의 접속 (2026-08-29 신설). 「보내는 사람을 각자 주소로」 지시 때문이다.
// 🔑 다음은 로그인한 계정이 «가진» 주소만 From 에 허용한다(550 no permitted
//    from-header address). 그래서 남의 주소로 보내려면 그 사람 계정으로 접속해야 한다.
// ⚠ 접속을 매번 새로 맺으면 느리다. 아이디마다 하나씩 두고 다시 쓴다.
//   비밀번호가 바뀌면 키가 달라지므로 옛 접속은 자연히 안 쓰이게 된다.
const userTx = new Map()
function transportFor(smtpUser, pass) {
  // 아이디·비밀번호를 함께 키로 쓴다. JSON 이라 구분자가 값에 섞일 여지가 없다.
  const k = JSON.stringify([smtpUser, pass])
  if (!userTx.has(k)) userTx.set(k, makeTransport(smtpUser, pass))
  return userTx.get(k)
}

// 등록한 앱 비밀번호가 맞는지 «보내지 않고» 확인한다. 등록 화면이 쓴다.
// 🔑 틀린 값이 조용히 저장되면, 그 사람의 보고만 계속 실패하는데 아무도 모른다.
async function verifyLogin(smtpUser, pass) {
  const t = makeTransport(smtpUser, pass)
  try { await t.verify(); return { ok: true } }
  catch (e) { return { ok: false, error: e.message } }
  finally { try { t.close() } catch { /* 이미 닫혔을 수 있다 */ } }
}

// ── 무엇을 알릴 것인가 ───────────────────────────────────────
// 사용자 결정(2026-08-25):
//   회사 차량 업무  → 알린다 (배차라서)
//   차량 개인 사용  → 알린다 (거리×단가로 «청구» 가 걸린다)
//   자차 업무       → 알리지 않는다 (회사 차를 잡지 않는다)
//   휴가·사무실 내근 → 알리지 않는다
function isVehiclePlan(p) {
  if (!p) return false
  // 🔑 「주 사용자」 가 정해진 차량은 «누가 탔는지» 가 이미 정해져 있다 (2026-08-25 사용자 지시).
  //    화면 문구는 「주 사용자」, DB 칸은 `assigned_worker_id` 다 — 이름만 다르다.
  //    이건호–QM6, 윤기곤–카니발 7598 처럼 늘 같은 사람이 타는 차는 배차를 다툴 일이
  //    없고, 그 사람이 그 차를 잡았다는 사실은 알릴 것이 못 된다.
  //    ⚠ 개인 사용도 함께 뺀다(사용자 결정) — 청구는 월말 정산 화면에서 본다.
  //    ⚠ «그 사람이 탄 경우»에만 뺀다. 남이 그 차를 잡으면 그건 알려야 할 일이다.
  if (p.vehicle_assigned_worker_id
      && Number(p.vehicle_assigned_worker_id) === Number(p.worker_id)) return false

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

// 보낸사람·답장주소를 한 곳에서 만든다 (2026-08-29). 네 종류의 메일이 같은 규칙을 쓴다.
//   · 본인 계정이 등록돼 있으면 → From 이 «본인 주소» 다. 답장 주소는 둘 필요가 없다
//   · 없으면(대표이사·미등록) → 예전처럼 공용 주소로 나가고, 답장은 그 사람에게 간다
// 🔑 표시 이름은 어느 쪽이든 «한 사람» 이다. 받는 쪽이 누구 일인지 이름으로 알아본다.
function fromOf({ sender, actorName, actorEmail }) {
  const c = cfg()
  const name = `${actorName || '업무'} (업무 대시보드)`
  if (sender?.address) return { from: { name, address: sender.address }, replyTo: undefined }
  return {
    from: { name, address: c.from },
    replyTo: actorEmail ? `${actorName} <${actorEmail}>` : undefined,
  }
}

const TITLE = { create: '등록', update: '변경', delete: '취소' }

function build({ kind, actorName, actorEmail, plans, conflicts, sender }) {
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
    ...fromOf({ sender, actorName, actorEmail }),
    // 🔴 c.to 가 아니라 c.toBoss 다 — 시험 중이면 대표이사 대신 시험 주소로 간다.
    //   (2026-08-29. 운영에는 MAIL_TO_TEST 가 없어 결국 MAIL_TO 로 떨어진다)
    to: c.toBoss,
    subject,
    text: body.join('\n'),
  }
}

// ── 작업 완료 보고 (2026-08-26 신설) ─────────────────────────
// 배차 알림과 «다른 메일» 이다. 한 함수에 섞지 않은 이유가 셋 있다.
//   · 대상이 다르다 — 배차 알림은 회사 차를 잡은 것만, 완료 보고는 «전부»
//     (사무실 내근·휴가까지. 2026-08-26 사용자 결정)
//   · 담는 것이 다르다 — 계획이 아니라 «실제로 얼마나 다녔고 얼마가 들었는가»
//   · 🔑 제목 머리말을 `[완료]` 로 나눈다. `[차량]` 과 섞이면 대표이사가 거를 수 없다.
//     주소가 하나뿐이라 «제목» 이 유일한 분류 수단이다
const won = n => Number(n || 0).toLocaleString('ko-KR')

function buildDone({ actorName, actorEmail, a, sender }) {
  const c = cfg()
  const who = a.worker_name || actorName || '누군가'
  const car = [a.vehicle_name, a.vehicle_plate].filter(Boolean).join(' ')
  // 🔑 개인 사용은 «행선지도 사유도» 적지 않는다 (사생활) — planLine 과 같은 규칙이다.
  //    ⚠ 지금은 서버가 개인 사용 실적의 place·purpose 를 비워 두지만(keepPlace),
  //    그 조건이 바뀌면 여기로 새어 나온다. 저쪽을 믿지 말고 여기서도 막는다.
  const personal = a.use_type === 'personal'
  const where = personal ? '개인 사용' : (a.place_name || a.place_text || '장소 미정')
  const why = personal ? null : a.purpose

  const subject = `[완료] ${who} · ${dayLabel(a.work_date)} · ${where}`

  const head = !a.plan_id
    ? '작업을 완료했습니다 (계획 없이 실적만 등록).'
    : a.as_planned
      ? '계획대로 작업을 완료했습니다.'
      : '작업을 완료했습니다 — 계획과 달랐습니다.'

  const body = [
    `${who} 님이 ${head}`,
    '',
    '  · ' + [dayLabel(a.work_date), where, why, car].filter(Boolean).join(' · '),
    '',
  ]

  // 실제로 «든 것» 만 적는다. 0원짜리 줄을 늘어놓으면 볼 것이 묻힌다.
  const spent = []
  if (a.distance_km != null) spent.push(`  이동 거리 : ${Number(a.distance_km)} km`)
  if (Number(a.toll_fee))    spent.push(`  하이패스  : ${won(a.toll_fee)} 원`)
  if (Number(a.fuel_fee))    spent.push(`  주유비    : ${won(a.fuel_fee)} 원`)
  if (Number(a.transit_fee)) spent.push(`  대중교통  : ${won(a.transit_fee)} 원`)
  if (spent.length) body.push('실제', ...spent, '')

  // 메모도 개인 사용이면 싣지 않는다 — 위와 같은 이유다
  if (a.memo && !personal) body.push(`메모 : ${a.memo}`, '')

  body.push(
    `처리한 사람 : ${actorName || '-'}${actorEmail ? ` <${actorEmail}>` : ''}`,
    '',
    '실적과 정산은 업무 현황 대시보드의 [스케줄] 탭에서 보실 수 있습니다.',
    'http://vitron-nas:8082',
    '',
    '— 바이트론 이앤에스 업무 현황 대시보드',
  )

  return {
    ...fromOf({ sender, actorName, actorEmail }),
    to: c.toBoss,
    subject,
    text: body.join('\n'),
  }
}

// ── 휴가 신청 · 취소 · 승인 · 반려 (2026-08-26 신설) ─────────
// 🔑 제목 머리말을 `[휴가]` 로 나눈다. 주소가 하나뿐이라 «제목» 이 유일한 분류 수단이다.
// 🔑 가는 곳이 방향에 따라 다르다 — 신청·취소는 대표이사에게, 승인·반려는 «신청한 사람» 에게.
const VAC_TITLE = { request: '신청', cancel: '취소', approved: '승인', rejected: '반려' }

function vacLine(p) {
  const bits = [dayLabel(p.plan_date)]
  if (p.slot && p.slot !== 'allday') bits.push(SLOT[p.slot] || p.slot)
  bits.push(p.vacation_type || '휴가')
  return '  · ' + bits.join(' · ')
}

// 휴가가 며칠인가 — 종일 1일, 오전·오후 0.5일.
// ⚠ 「시각 지정」은 휴가에서 고를 수 없게 막아 두었다(화면). 옛 기록이 있으면 0.5 로 센다.
const vacDays = p => (p.slot === 'allday' ? 1 : 0.5)

function buildVacation({ kind, actorName, actorEmail, plans, to, reason, sender }) {
  const c = cfg()
  const first = plans[0] || {}
  const who = first.worker_name || actorName || '누군가'
  const many = plans.length > 1 ? ` 외 ${plans.length - 1}일` : ''
  const total = plans.reduce((s, p) => s + vacDays(p), 0)

  const subject = `[휴가] ${VAC_TITLE[kind]} · ${who} · ${dayLabel(first.plan_date)}${many}`

  const head = {
    request:  `${who} 님이 휴가를 신청했습니다.`,
    cancel:   `${who} 님이 휴가 신청을 취소했습니다.`,
    approved: `휴가가 승인되었습니다.`,
    rejected: `휴가가 반려되었습니다.`,
  }[kind]

  const body = [head, '', ...plans.map(vacLine), '', `합계 ${total}일`, '']
  if (kind === 'rejected' && reason) body.push(`사유 : ${reason}`, '')

  if (kind === 'request') {
    body.push('승인은 업무 현황 대시보드의 [스케줄] 탭 → 🌴 휴가 에서 하실 수 있습니다.')
  } else if (kind === 'approved' || kind === 'rejected') {
    body.push(`처리한 사람 : ${actorName || '-'}`)
  }
  body.push(
    '',
    'http://vitron-nas:8082',
    '',
    '— 바이트론 이앤에스 업무 현황 대시보드',
  )

  return {
    ...fromOf({ sender, actorName, actorEmail }),
    // 🔴 시험 중이면 «신청자에게 갈 것도» 시험 주소로 돌린다 (위 cfg 주석 참고)
    to: c.testTo || to || c.toBoss,
    subject,
    text: body.join('\n'),
  }
}

// ── 구매 요청 · 승인 · 반려 (2026-08-26 신설) ────────────────
// 🔑 제목 머리말 `[구매]`. 주소가 하나뿐이라 «제목» 이 유일한 분류 수단이다.
// 🔑 요청은 대표이사에게, 승인·반려는 «요청한 사람» 에게 — 휴가와 같은 결이다.
const BUY_TITLE = { request: '요청', approved: '승인', rejected: '반려' }

function buildPurchase({ kind, actorName, actorEmail, p, to, reason, sender }) {
  const c = cfg()
  const who = p.worker_name || actorName || '누군가'
  const money = `${won(p.amount)}원`
  const subject = `[구매] ${BUY_TITLE[kind]} · ${who} · ${p.item_name} · ${money}`

  const head = {
    request:  `${who} 님이 구매를 요청했습니다.`,
    approved: '구매 요청이 승인되었습니다.',
    rejected: '구매 요청이 반려되었습니다.',
  }[kind]

  const body = [head, '',
    `  물품 : ${p.item_name}`,
    `  수량 : ${Number(p.qty)}`,
    `  단가 : ${won(p.unit_price)}원`,
    `  금액 : ${money}`,
  ]
  if (p.used_for) body.push(`  사용처 : ${p.used_for}`)
  if (p.note)     body.push(`  기타 : ${p.note}`)
  if (p.link)     body.push('', `  구매 링크 : ${p.link}`)
  body.push('')
  if (kind === 'rejected' && reason) body.push(`사유 : ${reason}`, '')

  if (kind === 'request') {
    body.push('승인은 업무 현황 대시보드의 [구매] 탭에서 하실 수 있습니다.')
  } else {
    body.push(`처리한 사람 : ${actorName || '-'}`)
  }
  body.push('', 'http://vitron-nas:8082', '', '— 바이트론 이앤에스 업무 현황 대시보드')

  return {
    ...fromOf({ sender, actorName, actorEmail }),
    // 🔴 시험 중이면 «요청자에게 갈 것도» 시험 주소로 돌린다 (위 cfg 주석 참고)
    to: c.testTo || to || c.toBoss,
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

// builder — 이 묶음을 무엇으로 조립할 것인가. 차량은 build, 휴가는 buildVacation.
// 🔑 묶는 방법은 같고 «담는 글» 만 다르다. 그래서 묶기를 두 벌 만들지 않는다.
function queue(key, payload, builder) {
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
    builder: builder || build,
    timer: setTimeout(() => flush(key), BATCH_MS),
  })
}

async function flush(key) {
  const b = batches.get(key)
  batches.delete(key)
  if (!b) return
  b.plans.sort((x, y) => String(x.plan_date).localeCompare(String(y.plan_date)))
  // ⚠ sender 도 payload 에 실려 왔다. 묶인 것들은 «한 사람» 이 한 일이라 하나면 된다
  //   (묶는 키에 batchId 가 들어가고, batchId 는 한 번의 등록에서만 같다).
  await send(b.builder(b), b.sender)
}

// 🔑 한 번 실패했다고 포기하지 않는다.
//    실측(2026-08-25): 서버를 올리고 «첫 통» 이 Timeout 으로 떨어졌고, 같은 내용을
//    다시 보내니 바로 갔다. 찬 연결이 느렸을 뿐이다. 그런데 그 한 통이 조용히
//    사라지면 대표이사는 배차를 못 보고, 아무도 그 사실을 모른다.
const TRIES = 3
const wait = ms => new Promise(r => setTimeout(r, ms))

// sender 를 주면 «그 사람 계정» 으로 접속해 보낸다 (2026-08-29). 안 주면 공용 계정이다.
// ⚠ 실패해도 공용 계정으로 «몰래 다시 보내지 않는다». 본인 주소로 나가야 할 메일이
//   조용히 남의 주소로 나가면, 받는 쪽은 누구 일인지 알 수 없고 아무도 잘못을 모른다.
//   앱 비밀번호가 틀어졌으면 그 사실이 설정 화면의 마지막 결과로 드러나야 한다.
async function send(msg, sender) {
  let lastErr = null
  for (let i = 1; i <= TRIES; i++) {
    try {
      const t = sender?.smtpUser ? transportFor(sender.smtpUser, sender.pass) : transport()
      await t.sendMail(msg)
      const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19)
      last = {
        at: stamp, ok: true,
        detail: `${msg.to} 로 보냈습니다${i > 1 ? ` (${i}번째 시도)` : ''}`,
      }
      console.log(`[mail] sent to ${msg.to} :: ${msg.subject}${i > 1 ? ` (retry ${i})` : ''}`)
      return true
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
  // 🔑 던지지는 않되 «갔는지» 는 알려 준다. 완료 보고는 그 결과를 DB 에 적어야 한다 —
  //    안 적으면 실패한 건이 「늦게 넣어서 안 보낸 것」과 구분되지 않는다.
  return false
}

// ── 바깥에서 부르는 것 ───────────────────────────────────────
// 부르는 쪽은 await 하지 않아도 된다. 실패는 여기서 삼킨다.
// sender — 이 사람의 SMTP 접속 정보 {smtpUser, pass, address}. 부르는 쪽(index.js)이
//   DB 에서 찾아 넘긴다. 🔑 mailer 는 DB 를 모른다는 원칙 그대로다.
//   없으면(대표이사·미등록) 예전처럼 공용 계정으로 나간다.
function notify({ kind, actor, plans, conflicts, batchId, sender }) {
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
      sender: sender || null,
    }
    // 등록만 묶는다. 수정·취소는 한 건씩 일어나므로 바로 보낸다.
    if (kind === 'create' && batchId) queue(`${kind}|${batchId}`, payload)
    else send(build(payload), payload.sender)
  } catch (e) {
    console.error(`[mail] notify error :: ${e.message}`)
  }
}

// 🔑 묶지 않는다 — 계획 1건 = 1통 (2026-08-26 사용자 결정).
//    실측(2026-08-26)에서 계획이 있는 사람·날짜 49건이 «전부» 하루 1건이었다.
//    묶어도 달라지는 것이 없고, 완료 보고는 «바로 아는 것» 이 값어치다.
//    하루 여러 건이 실제로 생기기 시작하면 그때 queue() 를 태우면 된다.
//
// ⚠ isVehiclePlan 을 태우지 않는다. 그 규칙(주 사용자·자차 제외)은 «누가 그 차를
//   쓰는가» 를 가리는 것이라 완료 보고와 아무 상관이 없다. 태우면 사무실 내근이
//   전부 빠져 「전부 보고」 지시가 조용히 뒤집힌다.
// onResult(ok) — 보냈는지를 부르는 쪽에 알려 준다. 부르는 쪽이 그 결과를 실적에 적는다.
// 🔑 mailer 는 DB 를 모른다. 알게 하면 「메일 보내는 일」과 「기록하는 일」이 한 덩어리가 되어
//    한쪽을 고칠 때마다 다른 쪽을 함께 건드리게 된다.
function notifyDone({ actor, actual, onResult, sender }) {
  try {
    if (!isEnabled()) return
    if (!actual) return
    send(buildDone({
      actorName: actor?.name || null,
      actorEmail: actor?.email || null,
      a: actual, sender: sender || null,
    }), sender).then(ok => { try { onResult && onResult(!!ok) } catch { /* 기록 실패가 메일을 되돌리진 않는다 */ } })
  } catch (e) {
    console.error(`[mail] notifyDone error :: ${e.message}`)
  }
}

// 휴가 알림. 부르는 쪽은 await 하지 않아도 된다.
// ⚠ 「보낼까요?」를 묻는 것은 «화면» 이 한다 (2026-08-26 사용자 지시 — 차량과 다른 점).
//   여기까지 왔다는 것은 사람이 「보낸다」 고 답했다는 뜻이다.
function notifyVacation({ kind, actor, plans, batchId, to, reason, sender }) {
  try {
    if (!isEnabled()) return
    const list = (Array.isArray(plans) ? plans : [plans]).filter(Boolean)
    if (!list.length) return
    const payload = {
      kind,
      actorName: actor?.name || null,
      actorEmail: actor?.email || null,
      plans: list, to, reason,
      sender: sender || null,
    }
    // 신청만 묶는다. 「사흘 휴가」는 날짜마다 따로 저장되므로 그대로 두면 세 통이 간다.
    // 취소·승인·반려는 한 건씩 일어나므로 바로 보낸다.
    if (kind === 'request' && batchId) queue(`vac|${kind}|${batchId}`, payload, buildVacation)
    else send(buildVacation(payload), payload.sender)
  } catch (e) {
    console.error(`[mail] notifyVacation error :: ${e.message}`)
  }
}

// 구매 알림. 묶지 않는다 — 요청은 한 건씩 일어난다.
function notifyPurchase({ kind, actor, purchase, to, reason, sender }) {
  try {
    if (!isEnabled()) return
    if (!purchase) return
    send(buildPurchase({
      kind, p: purchase, to, reason,
      actorName: actor?.name || null,
      actorEmail: actor?.email || null,
      sender: sender || null,
    }), sender)
  } catch (e) {
    console.error(`[mail] notifyPurchase error :: ${e.message}`)
  }
}

module.exports = { notify, notifyDone, notifyVacation, notifyPurchase,
  isEnabled, lastResult, isVehiclePlan, vacDays, verifyLogin }
