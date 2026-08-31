// VITRON ERP 포털 화면 촬영기 (교육 자료용)
// ==============================================================
// 왜 따로 있는가
// --------------
// `capture_shots.mjs` 는 «대시보드(:5173/:8082)» 를 찍는다. 포털은 다른 앱이고
// 주소도 `/ERP/` 아래라 카드 구조가 다르다(모서리 12px — 대시보드는 10px).
// 같은 파일에 억지로 넣으면 선택자가 서로 걸려 엉뚱한 상자를 집는다.
//
// 쓰는 법
// -------
//   node tools/manual/capture_portal.mjs
//
// 기본은 «배포본»(http://vitron-nas/ERP/) 을 찍는다. 포털은 로컬 개발 서버를
// 따로 띄우기 번거롭고, 교육 자료에는 직원들이 실제로 보는 화면이 들어가야 한다.
//
// ⚠ 로컬 `.env` 의 SESSION_SECRET 이 NAS 의 값과 같아야 한다. 다르면 세션이
//   통하지 않아 「로그인하지 않으셨습니다」 화면이 찍힌다 — 그때는 여기서 멈춘다.
// ⚠ 비밀번호는 이 도구가 다루지 않는다. 서명 비밀만 읽어 토큰을 만든다.
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d }

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')

const CHROME = opt('chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
const OUT = opt('out', path.join(REPO, 'docs', 'manual', 'captures'))
const URL_BASE = opt('url', 'http://vitron-nas/ERP/')
const ENV_FILE = opt('env', path.join(REPO, '.env'))
const PORT = Number(opt('port', '9335'))   // 대시보드 촬영기(9334)와 겹치지 않게
const W = Number(opt('width', '1400'))
const H = Number(opt('height', '1000'))
// 관리자 계정의 눈으로 찍는다 — 「전 직원」 고르개와 결재 줄이 보여야 한다.
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
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-shot-'))

const sleep = ms => new Promise(r => setTimeout(r, ms))

// 🔑 포털의 카드는 «모서리 12px 흰 상자» 다(Portal.jsx 의 box). 그것으로 찾는다.
//    「몇 단계 위로 올라가기」 식은 화면이 조금만 바뀌어도 엉뚱한 상자를 집는다.
const HELPERS = `
window.__cards = () => [...document.querySelectorAll('main div')].filter(n =>
  getComputedStyle(n).borderRadius === '12px' && n.getBoundingClientRect().width > 400)
window.__pad = r => ({ x: r.x + scrollX - 8, y: r.y + scrollY - 8,
                       width: r.width + 16, height: r.height + 16 })
// 첫 카드 = 오늘·내일 (날짜가 매일 바뀌어 «글자로» 찾을 수 없다)
window.__rectFirstCard = () => {
  const c = window.__cards()[0]
  return c ? window.__pad(c.getBoundingClientRect()) : null
}
// 글자로 시작하는 카드 — 「스케줄」처럼 제목이 고정된 것
window.__rectCard = title => {
  const c = window.__cards().find(n => (n.innerText || '').trim().startsWith(title))
  return c ? window.__pad(c.getBoundingClientRect()) : null
}
// 「업무」 같은 묶음 제목 «아래» 의 타일 격자
window.__rectAfterH = label => {
  const h = [...document.querySelectorAll('h2')].find(n => n.textContent.trim() === label)
  const el = h && h.nextElementSibling
  return el ? window.__pad(el.getBoundingClientRect()) : null
}
window.__pageSize = () => ({
  width: document.documentElement.scrollWidth,
  height: document.documentElement.scrollHeight,
})
`

const SHOTS = [
  // 첫 화면 전체 — 교육의 출발점이라 «주소창 없이» 화면만 온전히 담는다
  { file: '90_포털_전체.png', full: true, wait: 3200 },
  { file: '91_포털_오늘내일.png', wait: 3200, clipJs: '__rectFirstCard()' },
  // ⚠ 「내 일정만 · 이번 주」 그대로 찍으면 «표시할 줄이 없습니다» 만 담긴다.
  //   달력 읽는 법을 가르치는 그림이라 «전 직원 · 지난주» 로 돌려 놓고 찍는다.
  {
    file: '92_포털_스케줄.png', wait: 4200, clipJs: `__rectCard('스케줄')`,
    js: `(()=>{const s=document.querySelector('main select');
      if(s){const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;
        set.call(s,'all'); s.dispatchEvent(new Event('change',{bubbles:true}))}
      setTimeout(()=>{const b=[...document.querySelectorAll('button')]
        .find(x=>x.textContent.trim()==='◀'); if(b)b.click()},500)})()`,
  },
  { file: '93_포털_타일_업무.png', wait: 3200, clipJs: `__rectAfterH('업무')` },
  { file: '94_포털_타일_문서도구.png', wait: 3200, clipJs: `__rectAfterH('문서 · 일감')` },
]

const ONLY = opt('only', '')
const TARGETS = ONLY ? SHOTS.filter(s => s.file.includes(ONLY)) : SHOTS

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.waiting = new Map()
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
  // 🔑 캐시를 끈다. 안 끄면 «지난번 배포» 가 찍힌다 (2026-08-24 에 겪었다)
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })

  const goto = async url => {
    await cdp.send('Page.navigate', { url })
    await sleep(2500)
    await cdp.send('Runtime.evaluate', { expression: HELPERS })
  }
  const u = new URL(URL_BASE)
  await cdp.send('Network.setCookie', {
    name: 'kpi_session', value: sessionToken(),
    domain: u.hostname, path: '/', httpOnly: true, secure: false,
  })

  await goto(URL_BASE)

  // 로그인하지 않으면 포털이 노란 안내 상자를 띄운다 — 그것으로 판정한다
  const probe = await cdp.send('Runtime.evaluate', {
    expression: `document.body.innerText.includes('로그인하지 않으셨습니다')`,
    returnByValue: true,
  })
  if (probe.result.value) {
    console.error('세션이 통하지 않았습니다. 확인할 것:')
    console.error(`  · ${ENV_FILE} 의 SESSION_SECRET 이 NAS 의 값과 같은가`)
    console.error(`  · ${URL_BASE} 가 열려 있는가`)
    process.exitCode = 2
  } else {
    for (const s of TARGETS) {
      await goto(URL_BASE)
      if (s.js) await cdp.send('Runtime.evaluate', { expression: s.js })
      await sleep(s.wait ?? 1500)
      const params = { format: 'png' }
      if (s.full) {
        const r = await cdp.send('Runtime.evaluate', {
          expression: '__pageSize()', returnByValue: true })
        params.clip = { x: 0, y: 0, ...r.result.value, scale: 1 }
        params.captureBeyondViewport = true
      }
      if (s.clipJs) {
        const r = await cdp.send('Runtime.evaluate', {
          expression: s.clipJs, returnByValue: true })
        // ⚠ 상자를 못 찾으면 «엉뚱한 화면» 이 조용히 저장된다. 조각을 노린 촬영이면 끊는다.
        if (!r.result.value) throw new Error(`${s.file}: 잘라 낼 상자를 찾지 못했습니다`)
        params.clip = { ...r.result.value, scale: 1 }
        params.captureBeyondViewport = true
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
  // 임시 프로필은 남기지 않는다 — 로그인 흔적을 디스크에 굴리지 않는다
  try { fs.rmSync(PROFILE, { recursive: true, force: true }) } catch { /* 잠겨 있으면 둔다 */ }
}
