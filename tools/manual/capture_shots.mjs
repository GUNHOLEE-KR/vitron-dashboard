// 업무 현황 대시보드 매뉴얼용 화면 촬영기 (정본 — 지우지 말 것)
// ==============================================================
// 2026-08-21 에 화면 «전체» 가 로그인 뒤로 옮겨져, 이제 사람이 한 번 로그인해 줘야
// 화면을 찍을 수 있다. KPI 저장소의 같은 도구와 방식이 같다.
//
// 쓰는 법
// -------
//   1) 전용 프로필로 Chrome 을 열어 사람이 한 번 로그인한다
//        chrome.exe --user-data-dir=<프로필> http://vitron-nas:8082
//   2) ⚠ 그 창을 «닫는다». 같은 프로필을 두 프로세스가 동시에 쓸 수 없다
//   3) node capture_shots.mjs --profile <프로필> --out <저장소>\docs\manual\captures
//
// 🔑 쿠키는 «호스트» 단위라 포트를 가리지 않는다. KPI(:8083)에서 로그인한 프로필로
//    대시보드(:8082)도 그대로 열린다 — 프로필을 따로 만들 필요가 없다.
//
// ⚠ 여기서 찍는 것은 «로그인 때문에 달라진 화면» 뿐이다. 나머지 캡처 50여 장은
//   2026-08-15 에 사람이 찍은 것을 그대로 쓴다. 전부 다시 찍으면 손으로 맞춰 둔
//   구도(펼침 상태·마우스 위치)가 흐트러진다.
//
// ⚠ 비밀번호는 이 도구가 다루지 않는다. 프로필에 남은 세션 쿠키만 쓴다.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d }

const CHROME = opt('chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
const PROFILE = opt('profile')
const OUT = opt('out', path.join(process.cwd(), 'captures'))
const URL_BASE = opt('url', 'http://vitron-nas:8082')
const PORT = Number(opt('port', '9334'))
const W = Number(opt('width', '1600'))
const H = Number(opt('height', '1000'))

if (!PROFILE) { console.error('--profile <프로필 폴더> 가 필요합니다'); process.exit(1) }
fs.mkdirSync(OUT, { recursive: true })

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
  await goto(URL_BASE)

  const probe = await cdp.send('Runtime.evaluate', {
    expression: `!!document.querySelector('input[type=password]')`, returnByValue: true })
  if (probe.result.value) {
    console.error('로그인되어 있지 않습니다. 전용 프로필로 창을 열어 한 번 로그인한 뒤')
    console.error('그 창을 닫고 다시 실행해 주십시오.')
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
}
