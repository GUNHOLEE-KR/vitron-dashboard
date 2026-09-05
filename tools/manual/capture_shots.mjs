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
  return { x: r.x + scrollX - 6, y: r.y + scrollY - 6,
           width: r.width + 12, height: r.height + 12 }
}
// 지표 카드 «줄» 을 잘라 낸다. 카드 한 장을 감싼 상자는 폭이 0 이라(플렉스 래퍼)
// 그것만으로는 못 자른다 — 형제 카드들의 상자를 «합쳐» 줄 전체를 만든다.
window.__rectRow = label => {
  const hit = [...document.querySelectorAll('div,span,p')]
    .filter(n => (n.textContent || '').includes(label))
    .sort((a, b) => a.textContent.length - b.textContent.length)[0]
  if (!hit || !hit.parentElement || !hit.parentElement.parentElement) return null
  const rs = [...hit.parentElement.parentElement.children]
    .map(c => c.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0)
  if (!rs.length) return null
  const x1 = Math.min(...rs.map(r => r.left)), y1 = Math.min(...rs.map(r => r.top))
  const x2 = Math.max(...rs.map(r => r.right)), y2 = Math.max(...rs.map(r => r.bottom))
  // ⚠ 좌표는 «문서» 기준으로 준다. 화면 아래로 넘어가 있으면 화면 기준 좌표로
  //   잘라 봐야 아랫부분이 흰 여백으로 찍힌다 (captureBeyondViewport 와 함께 쓴다).
  return { x: x1 + scrollX - 6, y: y1 + scrollY - 6,
           width: (x2 - x1) + 12, height: (y2 - y1) + 12 }
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
    clipRow: '야간·휴일' },
  // 2026-08-25 신설 — 차량 예약 알림 메일 카드 ([설정] 탭)
  { file: '63_설정_메일알림.png', js: `__click('설정')`, wait: 2400,
    clipCard: '차량 예약 알림 메일' },
  // 2026-08-25 2차 — 색 · 주 사용자 · 연료 · 단가 · 업무 달력 · 휴일 표시
  { file: '64_설정_차량관리.png', js: `__click('설정')`, wait: 2400, clipCard: '차량 관리' },
  // 정산 화면의 「차량 단가 · 연비」 — 스케줄 탭 → 정산 → 8월로 옮긴 뒤 찍는다
  { file: '65_정산_단가연비.png', wait: 3000,
    js: `(()=>{__click('스케줄');
      setTimeout(()=>{const b=[...document.querySelectorAll('button')].find(x=>/정산/.test(x.textContent));
        if(b)b.click();
        setTimeout(()=>{const s=document.querySelector('select');
          if(s){const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;
            set.call(s,'2026-08'); s.dispatchEvent(new Event('change',{bubbles:true}))}},600)},400)})()`,
    clipCard: '차량 단가 · 연비' },
  // 업무 달력 — 주 보기(기본)와 월 보기
  { file: '66_일간_업무달력_주.png', js: `__click('일간')`, wait: 2600,
    clipCard: '업무 달력' },
  { file: '67_일간_업무달력_월.png', wait: 2800,
    js: `(()=>{__click('일간');
      setTimeout(()=>{const bs=[...document.querySelectorAll('button')].filter(x=>x.textContent.trim()==='월');
        if(bs.length)bs[bs.length-1].click()},700)})()`,
    clipCard: '업무 달력' },

  // ── 2026-08-29 신설 ────────────────────────────────────────
  // ⚠ 「70」 은 «메일 발송 계정이 등록되지 않은» 상태라야 찍힌다. 등록돼 있으면
  //   게이트가 뜨지 않아 엉뚱한 화면이 찍힌다. --only 70 으로 따로 찍을 것.
  { file: '70_메일발송설정_게이트.png', wait: 2200 },
  // 법인차량 등록 양식을 펼친 채로 차량 관리 카드를 찍는다
  { file: '71_법인차량_등록.png', wait: 2800,
    js: `(()=>{__click('설정');
      setTimeout(()=>{const b=[...document.querySelectorAll('button')]
        .find(x=>x.textContent.includes('법인차량 등록')); if(b)b.click()},1400)})()`,
    clipCard: '차량 관리' },
  // ⚠ __click('구매') 는 「구매 요청」 같은 다른 글자에 먼저 걸린다. 탭 단추만 집는다.
  // ⚠ clipCard 로 「구매 요청」 카드만 자르려 했으나 상자를 못 찾아, 탭 화면을 통째로 찍는다.
  { file: '75_구매_요청.png', wait: 3600,
    js: `(()=>{const b=[...document.querySelectorAll('button')]
      .find(x=>x.textContent.trim()==='구매'); if(b)b.click()})()` },
  // 직원 관리 카드 — 「퇴사자 포함」 체크박스와 직책 배지가 한 카드에 함께 보인다
  { file: '77_직원목록_퇴사자포함.png', js: `__click('설정')`, wait: 2600,
    clipCard: '직원 관리' },
  { file: '78_직원목록_직책.png', js: `__click('설정')`, wait: 2600,
    clipCard: '직원 관리' },
  // 공용 메일 계정 단추가 들어간 알림 카드 (2026-08-29)
  // ⚠ clipCard 로 자르려 했으나 상자를 못 찾아 설정 화면을 통째로 찍는다.
  { file: '79_설정_메일계정.png', js: `__click('설정')`, wait: 2800 },

  // ── 2026-09-05 신설 ────────────────────────────────────────
  // ⚠ 창(모달)은 clipCard 로 자를 수 없다 — 카드 모서리(10px)가 아니다.
  //   가운데 뜬 창은 화면을 통째로 찍어도 충분히 크게 보인다.

  // 계획 등록 창의 «날짜 달력». 흩어진 날을 고른 모습이라야 뜻이 전해진다 —
  // 한 날만 켜 두면 예전 방식과 그림이 구별되지 않는다.
  { file: '53_일정_여러날짜.png', wait: 5200,
    js: `(()=>{__click('스케줄');
      setTimeout(()=>{const b=[...document.querySelectorAll('button')]
        .find(x=>x.textContent.trim()==='+ 계획 추가'); if(b)b.click()
        setTimeout(()=>{
          // 달력 격자 = 7열 grid. 앞 7칸은 요일 머리글이라 떼고,
          // 흐리게 그린 «다른 달» 칸도 뺀 뒤 그 달의 1일부터 센다.
          const g=[...document.querySelectorAll('div')].filter(n=>{
            const s=getComputedStyle(n)
            return s.display==='grid' && s.gridTemplateColumns.split(' ').length===7
          }).pop()
          if(!g)return
          const cells=[...g.children].slice(7)
            .filter(c=>getComputedStyle(c).opacity==='1')
          // ⚠ 다섯 칸을 «한 박자에» 누르면 화면이 따라오지 못한다. 누른 것을
          //   손 떼는 순간에 반영하므로, 그 사이에 그릴 틈을 줘야 한다.
          ;[7,9,14,15,16].forEach((i,k)=>setTimeout(()=>{
            const c=cells[i]; if(!c)return
            c.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))
            setTimeout(()=>window.dispatchEvent(
              new PointerEvent('pointerup',{bubbles:true})),80)
          }, k*280))
        },1200)},600)})()` },

  // 하이패스 «불러온 내역» 표 — 대조 칸이 함께 보여야 한다.
  // ⚠ scrollIntoView 는 머리글이 화면 맨 위에 붙어 표 머리가 잘렸다. 자리를 직접 셈한다.
  // ⚠ 탭을 너무 일찍 누르면 화면이 아직 없어 그대로 「오늘 업무」가 찍힌다(실제로 겪음).
  //   그래서 첫 걸음에 넉넉히 틈을 둔다.
  { file: '80_정산_하이패스_내역.png', wait: 9000,
    js: `(()=>{setTimeout(()=>{__click('스케줄')
      setTimeout(()=>{const b=[...document.querySelectorAll('button')]
        .find(x=>/정산/.test(x.textContent)); if(b)b.click()
        setTimeout(()=>{const s=document.querySelector('select')
          if(s){const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set
            set.call(s,'2026-08'); s.dispatchEvent(new Event('change',{bubbles:true}))}
          setTimeout(()=>{const h=[...document.querySelectorAll('strong')]
            .find(x=>x.textContent.includes('불러온 내역'))
            if(h)window.scrollTo(0,h.getBoundingClientRect().top+scrollY-120)},2200)
        },900)},1000)},1400)})()` },

  // 대조 뜻풀이 — 색만 보고는 무슨 뜻인지 알 수 없어 표 아래에 붙여 둔 줄
  { file: '81_정산_하이패스_뜻풀이.png', wait: 9000,
    js: `(()=>{setTimeout(()=>{__click('스케줄')
      setTimeout(()=>{const b=[...document.querySelectorAll('button')]
        .find(x=>/정산/.test(x.textContent)); if(b)b.click()
        setTimeout(()=>{const s=document.querySelector('select')
          if(s){const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set
            set.call(s,'2026-08'); s.dispatchEvent(new Event('change',{bubbles:true}))}
          setTimeout(()=>{const h=[...document.querySelectorAll('strong')]
            .find(x=>x.textContent.includes('대조는 참고일'))
            if(h)window.scrollTo(0,h.getBoundingClientRect().top+scrollY-300)},2200)
        },900)},1000)},1400)})()` },

  // 회의록 작성 폼 — 참석자 「전체」 를 눌러 둔 모습
  // ⚠ «만들지는» 않는다. 찍자고 시험 자료를 남길 일이 아니다.
  { file: '82_회의록_작성.png', wait: 4200,
    js: `(()=>{const t=[...document.querySelectorAll('button')]
      .find(x=>x.textContent.trim()==='회의록'); if(t)t.click()
      setTimeout(()=>{const b=[...document.querySelectorAll('button')]
        .find(x=>x.textContent.trim()==='+ 회의록 작성'); if(b)b.click()
        setTimeout(()=>{const a=[...document.querySelectorAll('button')]
          .find(x=>x.textContent.startsWith('전체 (')); if(a)a.click()},900)},900)})()` },

  // 구매 이력의 다단 정렬 — ①②③ 이 붙은 모습이라야 «차례» 가 보인다.
  // 대표이사가 빠진 직원 거르개도 같은 카드에 함께 찍힌다.
  { file: '83_구매_정렬.png', wait: 5000,
    js: `(()=>{const t=[...document.querySelectorAll('button')]
      .find(x=>x.textContent.trim()==='구매'); if(t)t.click()
      setTimeout(()=>{const pick=n=>[...document.querySelectorAll('button')]
        .find(x=>x.textContent.trim().replace(/[0-9▼▲\\s]/g,'')===n)
        const a=pick('금액'); if(a)a.click()
        setTimeout(()=>{const b=pick('상태'); if(b)b.click()},400)},1600)})()`,
    clipCard: '구매 이력' },

  // 정산 «사람별» 표 — 1차 안내 · 2차 입금 확인이 사람마다 따로 있다
  { file: '84_정산_사람별.png', wait: 8000,
    js: `(()=>{const S=(f,t)=>setTimeout(f,t)
      S(()=>__click('스케줄'),1200)
      S(()=>{const b=[...document.querySelectorAll('button')]
        .find(x=>/정산/.test(x.textContent)); if(b)b.click()},2300)
      S(()=>{const s=document.querySelector('select')
        if(s){const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set
          set.call(s,'2026-08'); s.dispatchEvent(new Event('change',{bubbles:true}))}},3300)
      S(()=>{const h=[...document.querySelectorAll('div,strong')]
        .find(x=>x.textContent.trim()==='사람별')
        if(h)window.scrollTo(0,h.getBoundingClientRect().top+scrollY-110)},5600)
    })()` },

  // 「이동」 — 현장에서 다른 현장으로. 왕복을 끄고 📍→📍 를 골라야 나온다.
  // ⚠ 깊게 겹친 setTimeout 은 한 걸음만 어긋나도 통째로 어그러진다.
  //   걸음마다 «절대 시각» 을 주어 나란히 세운다.
  { file: '85_일정_이동.png', wait: 10500,
    js: `(()=>{const S=(f,t)=>setTimeout(f,t)
      S(()=>__click('스케줄'),1200)
      S(()=>{const b=[...document.querySelectorAll('button')]
        .find(x=>x.textContent.trim()==='+ 계획 추가'); if(b)b.click()},2400)
      S(()=>{const p=[...document.querySelectorAll('button')]
        .find(x=>x.textContent.trim()==='장소 선택'); if(p)p.click()},3500)
      // ⚠ 줄 이름이 「파주 LGD 고객사」라 «꼭 맞는 글자» 로는 못 찾는다.
      //   먼저 검색으로 걸러 낸 뒤, 그 글자를 품은 «가장 안쪽» 칸의 줄을 누른다.
      S(()=>{const i=[...document.querySelectorAll('input')]
        .find(x=>(x.placeholder||'').includes('장소 이름'))
        if(i){const set=Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,'value').set
          set.call(i,'파주'); i.dispatchEvent(new Event('input',{bubbles:true}))}},4300)
      // ⚠ 누르는 손잡이는 «줄(tr)» 이 아니라 그 안의 칸에 달려 있다. tr 을 누르면
      //   위로만 퍼져 아래 칸의 손잡이에 닿지 않는다 — 가장 안쪽을 눌러야 한다.
      S(()=>{const hits=[...document.querySelectorAll('*')]
        .filter(n=>(n.textContent||'').includes('파주 LGD'))
        const el=hits[hits.length-1]; if(el)el.click()},5300)
      S(()=>{const l=[...document.querySelectorAll('label')]
        .find(x=>x.textContent.trim()==='왕복')
        const c=l&&l.querySelector('input[type=checkbox]'); if(c&&c.checked)c.click()},6300)
      S(()=>{const m=[...document.querySelectorAll('button')]
        .find(x=>x.textContent.includes('📍→📍')); if(m)m.click()},7100)
      S(()=>{const s=[...document.querySelectorAll('select')]
        .find(x=>[...x.options].some(o=>o.textContent.trim()==='SKIPC'))
        if(s){const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set
          const o=[...s.options].find(o=>o.textContent.trim()==='SKIPC')
          if(o){set.call(s,o.value); s.dispatchEvent(new Event('change',{bubbles:true}))}}},7900)
      // ⚠ 창이 길어 방향 칸이 화면 밖에 있다. 그 자리로 굴려 놓아야 찍힌다.
      S(()=>{const l=[...document.querySelectorAll('label')]
        .find(x=>x.textContent.trim()==='왕복')
        if(l)l.scrollIntoView({block:'center'})},8800)
    })()` },
]

// --only 로 일부만 찍는다. 파일명에 그 글자가 들어간 것만 고른다.
// 🔑 게이트 화면(70)처럼 «DB 상태가 달라야» 찍히는 것이 있어 따로 돌릴 길이 필요하다.
const ONLY = opt('only', '')
const TARGETS = ONLY ? SHOTS.filter(s => s.file.includes(ONLY)) : SHOTS

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

  // ⚠ «비밀번호 칸이 있으면 실패» 로 보면 안 된다 (2026-08-29).
  //   메일 발송 설정 게이트에도 비밀번호 칸이 있어, 세션이 멀쩡한데도 실패로 읽혔다.
  //   로그인 화면에만 있는 «회사 메일 주소» 칸으로 판정한다.
  const probe = await cdp.send('Runtime.evaluate', {
    expression: `!!document.querySelector('input[placeholder*="회사 메일"]')`,
    returnByValue: true })
  if (probe.result.value) {
    console.error('세션이 통하지 않았습니다. 확인할 것:')
    console.error(`  · ${ENV_FILE} 의 SESSION_SECRET 이 그 서버의 값과 같은가`)
    console.error(`  · ${URL_BASE} 가 열려 있는가 (백엔드까지)`)
    process.exitCode = 2
  } else {
    for (const s of TARGETS) {
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
      if (s.clipRow) {
        const r = await cdp.send('Runtime.evaluate', {
          expression: `__rectRow(${JSON.stringify(s.clipRow)})`, returnByValue: true })
        if (r.result.value) {
          params.clip = { ...r.result.value, scale: 1 }
          params.captureBeyondViewport = true
        }
      }
      // ⚠ 잘라 낼 상자를 못 찾으면 «0바이트 그림» 이나 엉뚱한 화면이 조용히 저장된다.
      //   조각을 노린 촬영인데 상자가 없으면 여기서 끊는다.
      if ((s.clip || s.clipText || s.clipCard || s.clipRow) && !params.clip) {
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
