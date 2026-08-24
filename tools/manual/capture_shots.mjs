// 업무 현황 대시보드 매뉴얼용 화면 촬영기 (정본 — 지우지 말 것)
// ==============================================================
// 2026-08-21 에 화면 «전체» 가 로그인 뒤로 옮겨져 세션 없이는 찍을 수 없다.
//
// 🔑 2026-08-24 개편 — «사람이 Chrome 을 열어 로그인하는 단계»를 없앴다.
//    그것이 PC 조작 소유권과 부딪혀 자꾸 막혔다(사용자 지시). 이제 `.env` 의
//    SESSION_SECRET 으로 세션 토큰을 만들어 CDP `Network.setCookie` 로 심는다.
//    사람이 손댈 일도, 보이는 창도 없다. KPI 저장소의 같은 도구와 방식이 같다.
//
// 쓰는 법
// -------
//   ① 백엔드와 화면을 로컬에 띄운다 (배포본과 같은 커밋이면 화면도 같다)
//        cd server && node index.js       # :3001
//        npm run dev                      # :5173
//   ② node tools/manual/capture_shots.mjs
//
// ⚠ 여기서 찍는 것은 «로그인·공휴일 때문에 달라진 화면» 뿐이다. 나머지 캡처 50여 장은
//   2026-08-15 에 사람이 찍은 것을 그대로 쓴다. 전부 다시 찍으면 손으로 맞춰 둔
//   구도(펼침 상태·마우스 위치)가 흐트러진다.
//
// ⚠ 비밀번호는 이 도구가 다루지 않는다. 서명 비밀만 읽어 토큰을 만든다.
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d }

// ⚠ URL.pathname 은 퍼센트 인코딩이라 「My Projects」 의 공백이 %20 으로 남는다.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')

const CHROME = opt('chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
const OUT = opt('out', path.join(REPO, 'docs', 'manual', 'captures'))
const URL_BASE = opt('url', 'http://localhost:5173')
const ENV_FILE = opt('env', path.join(REPO, '.env'))
const PORT = Number(opt('port', '9334'))
const W = Number(opt('width', '1600'))
const H = Number(opt('height', '1000'))
// 관리자 계정의 눈으로 찍는다 — [설정] 탭과 대리 입력 단추가 보여야 한다.
const UID = Number(opt('uid', '1'))
const LOGIN = opt('login', 'gunholee@vi-tron.com')
const NAME = opt('name', '이건호')
const ROLE = opt('role', 'admin')

// server/index.js 의 makeToken 과 같은 형식
function sessionToken() {
  const line = fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)
    .find(l => l.startsWith('SESSION_SECRET='))
  if (!line) throw new Error(`${ENV_FILE} 에 SESSION_SECRET 이 없습니다`)
  const secret = line.slice('SESSION_SECRET='.length).trim()
  const payload = {
    uid: UID, login: LOGIN, name: NAME, role: ROLE,
    workerId: null, mustChange: false, exp: Date.now() + 3600 * 1000,
  }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${sig}`
}

fs.mkdirSync(OUT, { recursive: true })
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-shot-'))

const sleep = ms => new Promise(r => setTimeout(r, ms))

const HELPERS = `
window.__byText = (text, sel) => {
  const nodes = [...document.querySelectorAll(sel || 'button,a,label,div,span,th')]
  return nodes.filter(n => (n.textContent||'').trim() === text)
              .sort((a,b) => a.textContent.length - b.textContent.length)[0] || null
}
window.__click = (text, sel) => { const el = window.__byText(text, sel); if (el) { el.click(); return true } return false }
// 화면의 한 조각만 잘라 찍을 때 쓸 좌표
window.__rect = sel => { const e = document.querySelector(sel); if (!e) return null
  const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }
// 글자로 찾아 «그것을 감싼 상자» 의 좌표를 준다. class 이름이 없는 카드를 자를 때 쓴다.
// up = 몇 단계 위로 올라갈지
window.__rectByText = (text, up) => {
  const hit = [...document.querySelectorAll('div,span,p')]
    .filter(n => (n.textContent||'').includes(text))
    .sort((a,b) => a.textContent.length - b.textContent.length)[0]
  if (!hit) return null
  let el = hit
  for (let i = 0; i < (up||0) && el.parentElement; i++) el = el.parentElement
  const r = el.getBoundingClientRect()
  return { x: r.x - 6, y: r.y - 6, width: r.width + 12, height: r.height + 12 }
}
// 🔑 «몇 단계 위» 로 세는 방식은 화면 구조가 조금만 바뀌어도 엉뚱한 상자를 집는다
//    (실제로 차량 표까지 통째로 딸려 온 적이 있다). 카드는 모서리가 둥근(10px)
//    흰 상자이므로 그것을 찾아 올라간다.
window.__rectCard = title => {
  const cards = [...document.querySelectorAll('div')].filter(n =>
    getComputedStyle(n).borderRadius === '10px' &&
    n.getBoundingClientRect().width > 250 &&
    (n.innerText || '').trim().startsWith(title))
  if (!cards.length) return null
  const r = cards[0].getBoundingClientRect()
  // ⚠ 좌표는 «문서» 기준으로 준다. 카드가 화면 아래로 넘어가 있으면 화면 기준 좌표로
  //   잘라 봐야 아랫부분이 흰 여백으로 찍힌다 (captureBeyondViewport 와 함께 쓴다).
  return { x: r.x + scrollX - 6, y: r.y + scrollY - 6,
           width: r.width + 12, height: r.height + 12 }
}
`

// 로그인 때문에 달라진 화면만 다시 찍는다.
//   clip: 'header' 처럼 조각만 잘라 찍을 선택자
const SHOTS = [
  { file: '01_전체화면.png', js: `__click('오늘 업무')`, wait: 1800 },
  { file: '02_헤더.png',    js: `__click('오늘 업무')`, wait: 1500, clip: 'header' },
  { file: '03_탭메뉴.png',  js: `__click('오늘 업무')`, wait: 1500, clip: 'nav' },
  // 입력 대상 안내 카드. 관리자로 찍으면 이름 단추가 함께 보인다 —
  // 매뉴얼 캡션에 «관리자 화면» 임을 밝혀 둔다.
  { file: '04_이름선택.png', js: `__click('오늘 업무')`, wait: 1600,
    clipText: { text: '고른 사람의 열만 편집됩니다', up: 1 } },
  // 2026-08-24 신설 — 공휴일표와 집계 제외 카드 ([설정] 탭)
  { file: '60_설정_공휴일.png',   js: `__click('설정')`, wait: 2400, clipCard: '공휴일' },
  { file: '61_설정_집계제외.png', js: `__click('설정')`, wait: 2400, clipCard: '집계 제외' },
  // 야간·휴일 카드가 들어간 일간 지표 줄
  { file: '62_일간_지표_야간휴일.png', js: `__click('일간')`, wait: 2400,
    clipText: { text: '야간·휴일', up: 3 } },
]

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map()
    ws.addEventListener('message', e => {
      const m = JSON.parse(e.data)
      if (m.id && this.waiting.has(m.id)) { this.waiting.get(m.id)(m); this.waiting.delete(m.id) }
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((res, rej) => {
      this.waiting.set(id, m => (m.error ? rej(new Error(m.error.message)) : res(m.result)))
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
}

async function fetchJson(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json() } catch { /* 아직 안 떴다 */ }
    await sleep(300)
  }
  throw new Error('Chrome 디버깅 포트에 붙지 못했습니다: ' + url)
}

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  `--user-data-dir=${PROFILE}`,
  `--remote-debugging-port=${PORT}`,
  `--window-size=${W},${H}`,
  'about:blank',
], { stdio: 'ignore' })

let ws
try {
  const list = await fetchJson(`http://127.0.0.1:${PORT}/json/list`)
  const page = list.find(t => t.type === 'page')
  if (!page) throw new Error('페이지 대상을 찾지 못했습니다')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
  const cdp = new CDP(ws)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  // 🔑 캐시를 끈다. 프로필을 재사용하므로 안 끄면 «지난번 배포» 가 찍힌다
  //    (2026-08-24 에 KPI 촬영에서 실제로 겪었다)
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })

  const goto = async url => {
    await cdp.send('Page.navigate', { url })
    await sleep(2500)
    await cdp.send('Runtime.evaluate', { expression: HELPERS })
  }
  // 🔑 세션을 «심는다». 쿠키가 HttpOnly 여도 서버는 값만 읽으므로 이것으로 통한다.
  const u = new URL(URL_BASE)
  await cdp.send('Network.setCookie', {
    name: 'kpi_session', value: sessionToken(),
    domain: u.hostname, path: '/', httpOnly: true, secure: false,
  })

  await goto(URL_BASE)

  const probe = await cdp.send('Runtime.evaluate', {
    expression: `!!document.querySelector('input[type=password]')`, returnByValue: true })
  if (probe.result.value) {
    console.error('세션이 통하지 않았습니다. 확인할 것:')
    console.error(`  · ${ENV_FILE} 의 SESSION_SECRET 이 그 서버의 값과 같은가`)
    console.error(`  · ${URL_BASE} 가 열려 있는가 (백엔드까지)`)
    process.exitCode = 2
  } else {
    for (const s of SHOTS) {
      await goto(URL_BASE)
      if (s.js) await cdp.send('Runtime.evaluate', { expression: s.js })
      await sleep(s.wait ?? 1200)
      const params = { format: 'png' }
      if (s.clip) {
        const r = await cdp.send('Runtime.evaluate', {
          expression: `__rect(${JSON.stringify(s.clip)})`, returnByValue: true })
        if (r.result.value) params.clip = { ...r.result.value, scale: 1 }
      }
      if (s.clipText) {
        const r = await cdp.send('Runtime.evaluate', {
          expression: `__rectByText(${JSON.stringify(s.clipText.text)}, ${s.clipText.up || 0})`,
          returnByValue: true })
        if (r.result.value) params.clip = { ...r.result.value, scale: 1 }
      }
      if (s.clipCard) {
        const r = await cdp.send('Runtime.evaluate', {
          expression: `__rectCard(${JSON.stringify(s.clipCard)})`, returnByValue: true })
        if (r.result.value) {
          params.clip = { ...r.result.value, scale: 1 }
          params.captureBeyondViewport = true   // 화면 아래로 넘어간 카드도 온전히 찍는다
        }
      }
      // ⚠ 잘라 낼 상자를 못 찾으면 «0바이트 그림» 이나 엉뚱한 화면이 조용히 저장된다.
      //   조각을 노린 촬영인데 상자가 없으면 여기서 끊는다.
      if ((s.clip || s.clipText || s.clipCard) && !params.clip) {
        throw new Error(`${s.file}: 잘라 낼 상자를 찾지 못했습니다`)
      }
      const shot = await cdp.send('Page.captureScreenshot', params)
      const p = path.join(OUT, s.file)
      fs.writeFileSync(p, Buffer.from(shot.data, 'base64'))
      console.log(`찍음  ${s.file}  ${(fs.statSync(p).size / 1024).toFixed(0)} KB`)
    }
  }
} catch (e) {
  console.error('실패:', e.message)
  process.exitCode = 1
} finally {
  try { ws?.close() } catch { /* 이미 닫혔을 수 있다 */ }
  chrome.kill()
  // 임시 프로필은 남기지 않는다 — 로그인 흔적이 디스크에 굴러다니게 두지 않는다
  try { fs.rmSync(PROFILE, { recursive: true, force: true }) } catch { /* 잠겨 있으면 둔다 */ }
}
