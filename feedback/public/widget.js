// 바이트론 의견 보내기 위젯 (2026-08-29 신설)
// ==============================================================
// 어느 제품에든 «이 한 줄» 로 붙는다.
//
//   <script src="http://vitron-nas:8086/widget.js"
//           data-product="RTDB" data-user="이건호"></script>
//
// 🔑 왜 npm 패키지나 소스 복사가 아닌가
//    이 위젯은 대시보드·KPI 뿐 아니라 RTDB 솔루션 같은 «다른 제품» 에도 붙는다.
//    · 프레임워크를 모른다 — 그 제품이 React 가 아닐 수 있다. 그래서 순수 JS 다
//    · 복사해 두면 문구 하나 고칠 때마다 «제품 수만큼» 다시 배포해야 한다.
//      한 곳에서 서빙하면 고치는 즉시 전 제품에 반영된다
//    · 붙이는 쪽 빌드를 건드리지 않는다 — script 한 줄이면 끝이다
//
// 🔑 왜 Shadow DOM 인가
//    붙는 제품의 CSS 를 모른다. 그냥 DOM 에 넣으면 그쪽 `button { }` 규칙에
//    위젯이 물들거나, 반대로 이쪽 규칙이 그쪽을 망친다. Shadow DOM 안에 두면
//    양쪽이 서로를 못 본다.
//
// ⚠ 이 파일은 «빌드하지 않는다». 브라우저가 그대로 읽는다 —
//   그래야 붙이는 제품의 빌드 설정과 무관해진다.
(function () {
  'use strict'

  // 두 번 붙어도 아이콘이 둘 뜨지 않게 한다 (포털처럼 화면을 감싸는 제품에서 실제로 생긴다)
  if (window.__vitronFeedbackLoaded) return
  window.__vitronFeedbackLoaded = true

  var me = document.currentScript
  // 스크립트를 내려 준 곳이 곧 접수처다 — 붙이는 쪽이 주소를 두 번 적지 않아도 된다.
  var ORIGIN = new URL(me.src, location.href).origin
  var PRODUCT = me.dataset.product || document.title || '(제품 미상)'
  var USER = me.dataset.user || ''
  var POS = me.dataset.position || 'right'      // right | left

  var KINDS = [
    { id: 'bug',     icon: '🐞', label: '에러 확인',        hint: '무엇을 하다가 어떤 오류가 났는지 적어 주세요.' },
    { id: 'improve', icon: '🔧', label: '불편한 점 수정 요청', hint: '어디가 어떻게 불편한지 적어 주세요.' },
    { id: 'feature', icon: '✨', label: '기능 추가 요청',      hint: '무엇이 있으면 좋겠는지 적어 주세요.' },
  ]

  var MAX_SHOTS = 3
  var MAX_BYTES = 4 * 1024 * 1024               // 한 장 4MB — 메일 첨부 한계를 생각한 값

  // ── 껍데기 ────────────────────────────────────────────────
  var host = document.createElement('div')
  host.style.cssText = 'position:fixed;z-index:2147483000;bottom:0;' +
    (POS === 'left' ? 'left:0;' : 'right:0;')
  document.body.appendChild(host)
  var root = host.attachShadow({ mode: 'open' })

  var style = document.createElement('style')
  style.textContent = [
    ':host,*{box-sizing:border-box}',
    '.wrap{font-family:"Malgun Gothic","맑은 고딕",system-ui,sans-serif;',
    '  margin:0 18px 18px;display:flex;flex-direction:column;align-items:' +
      (POS === 'left' ? 'flex-start' : 'flex-end') + '}',
    '.fab{width:52px;height:52px;border-radius:26px;border:none;cursor:pointer;',
    '  background:#1a56db;color:#fff;font-size:22px;line-height:1;',
    '  box-shadow:0 6px 18px rgba(17,24,39,.28);transition:transform .12s}',
    '.fab:hover{transform:translateY(-2px)}',
    '.panel{width:360px;max-width:calc(100vw - 36px);background:#fff;border-radius:12px;',
    '  border:1px solid #e5e7eb;box-shadow:0 20px 50px rgba(0,0,0,.25);',
    '  margin-bottom:10px;overflow:hidden}',
    '.head{padding:13px 15px;background:#1a56db;color:#fff;display:flex;',
    '  align-items:center;justify-content:space-between}',
    '.head b{font-size:14px}',
    '.x{background:none;border:none;color:#fff;font-size:19px;cursor:pointer;line-height:1;padding:0 2px}',
    '.body{padding:14px 15px;max-height:min(560px,70vh);overflow-y:auto}',
    '.kinds{display:flex;flex-direction:column;gap:7px}',
    '.kind{display:flex;align-items:center;gap:9px;width:100%;padding:11px 12px;',
    '  border:1px solid #e5e7eb;border-radius:9px;background:#fff;cursor:pointer;',
    '  font-size:13px;text-align:left;color:#111827}',
    '.kind:hover{border-color:#1a56db;background:#f5f8ff}',
    '.kind.on{border-color:#1a56db;background:#eff6ff;font-weight:700}',
    '.kind .ic{font-size:17px}',
    '.lab{font-size:11px;font-weight:700;color:#6b7280;margin:12px 0 5px;display:block}',
    'textarea,input[type=text]{width:100%;padding:9px 10px;border:1px solid #e5e7eb;',
    '  border-radius:8px;font-size:13px;font-family:inherit}',
    'textarea{min-height:96px;resize:vertical}',
    'textarea:focus,input:focus{outline:2px solid #bfdbfe;outline-offset:-1px;border-color:#1a56db}',
    '.hint{font-size:11px;color:#9ca3af;margin-top:4px;line-height:1.6}',
    '.drop{border:1px dashed #cbd5e1;border-radius:8px;padding:11px;text-align:center;',
    '  font-size:11px;color:#6b7280;background:#f9fafb;cursor:pointer;line-height:1.7}',
    '.drop:hover{border-color:#1a56db;color:#1a56db}',
    '.shots{display:flex;gap:7px;flex-wrap:wrap;margin-top:8px}',
    '.shot{position:relative;width:72px;height:54px;border-radius:6px;overflow:hidden;',
    '  border:1px solid #e5e7eb}',
    '.shot img{width:100%;height:100%;object-fit:cover;display:block}',
    '.shot button{position:absolute;top:2px;right:2px;width:17px;height:17px;border:none;',
    '  border-radius:9px;background:rgba(17,24,39,.72);color:#fff;font-size:11px;',
    '  cursor:pointer;line-height:17px;padding:0}',
    '.send{width:100%;margin-top:14px;padding:11px;border:none;border-radius:8px;',
    '  background:#1a56db;color:#fff;font-size:14px;font-weight:700;cursor:pointer}',
    '.send:disabled{background:#cbd5e1;cursor:default}',
    '.msg{margin-top:10px;padding:10px 11px;border-radius:8px;font-size:12px;line-height:1.7;',
    '  white-space:pre-line}',
    '.ok{background:#f0fdf4;border:1px solid #bbf7d0;color:#0d7a4e}',
    '.err{background:#fef2f2;border:1px solid #fecaca;color:#b91c1c}',
    '.done{text-align:center;padding:22px 8px}',
    '.done .big{font-size:34px}',
    '.done p{font-size:13px;color:#374151;line-height:1.8;margin:9px 0 0}',
  ].join('\n')
  root.appendChild(style)

  var wrap = document.createElement('div')
  wrap.className = 'wrap'
  root.appendChild(wrap)

  var panel = null
  var fab = document.createElement('button')
  fab.className = 'fab'
  fab.title = '의견 보내기 — 에러 · 불편한 점 · 기능 추가'
  fab.textContent = '💬'
  fab.addEventListener('click', function () { panel ? close() : open() })
  wrap.appendChild(fab)

  // ── 상태 ──────────────────────────────────────────────────
  var kind = null
  var shots = []        // { name, type, dataUrl }

  function close() {
    if (panel) { panel.remove(); panel = null }
    fab.textContent = '💬'
  }

  function open() {
    kind = null; shots = []
    panel = document.createElement('div')
    panel.className = 'panel'
    panel.innerHTML =
      '<div class="head"><b>의견 보내기</b><button class="x" title="닫기">×</button></div>' +
      '<div class="body"></div>'
    wrap.insertBefore(panel, fab)
    panel.querySelector('.x').addEventListener('click', close)
    fab.textContent = '×'
    drawForm()
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  function drawForm() {
    var body = panel.querySelector('.body')
    body.innerHTML = ''

    body.appendChild(el('span', 'lab', '무엇을 알려 주시겠습니까?'))
    var kinds = el('div', 'kinds')
    KINDS.forEach(function (k) {
      var b = el('button', 'kind')
      b.appendChild(el('span', 'ic', k.icon))
      b.appendChild(el('span', null, k.label))
      b.addEventListener('click', function () {
        kind = k
        kinds.querySelectorAll('.kind').forEach(function (x) { x.classList.remove('on') })
        b.classList.add('on')
        hint.textContent = k.hint
        text.focus()
      })
      kinds.appendChild(b)
    })
    body.appendChild(kinds)

    body.appendChild(el('span', 'lab', '내용'))
    var text = el('textarea')
    text.placeholder = '겪으신 일을 그대로 적어 주세요.'
    body.appendChild(text)
    var hint = el('div', 'hint', '위에서 종류를 먼저 골라 주세요.')
    body.appendChild(hint)

    body.appendChild(el('span', 'lab', '화면 캡처 (선택)'))
    var drop = el('div', 'drop')
    drop.innerHTML = '여기를 누르면 파일을 고를 수 있습니다.<br>' +
      '<b>Win + Shift + S</b> 로 찍은 뒤 <b>Ctrl + V</b> 로 붙여 넣어도 됩니다.'
    body.appendChild(drop)
    var gallery = el('div', 'shots')
    body.appendChild(gallery)

    var file = document.createElement('input')
    file.type = 'file'; file.accept = 'image/*'; file.multiple = true
    file.style.display = 'none'
    body.appendChild(file)
    drop.addEventListener('click', function () { file.click() })
    file.addEventListener('change', function () { addFiles(file.files, gallery); file.value = '' })

    // 🔑 붙여넣기는 «패널 안에서» 만 받는다. document 에 걸면 이 위젯이 남의 화면
    //    붙여넣기까지 가로챈다.
    panel.addEventListener('paste', function (e) {
      var items = (e.clipboardData || {}).items || []
      var got = []
      for (var i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image/') === 0) {
          var f = items[i].getAsFile()
          if (f) got.push(f)
        }
      }
      if (got.length) { e.preventDefault(); addFiles(got, gallery) }
    })

    body.appendChild(el('span', 'lab', '보내는 사람 (선택)'))
    var who = document.createElement('input')
    who.type = 'text'
    who.value = USER
    who.placeholder = '이름을 적지 않으면 익명으로 갑니다'
    body.appendChild(who)
    body.appendChild(el('div', 'hint',
      '이름을 비워 두셔도 됩니다. 다만 «되물을 수가 없어» 해결이 늦어질 수 있습니다.'))

    var send = el('button', 'send', '보내기')
    body.appendChild(send)
    var msg = el('div')
    body.appendChild(msg)

    send.addEventListener('click', function () {
      msg.className = ''; msg.textContent = ''
      if (!kind) { fail(msg, '종류를 먼저 골라 주세요.'); return }
      if (!text.value.trim()) { fail(msg, '내용을 적어 주세요.'); return }
      send.disabled = true; send.textContent = '보내는 중…'
      post({
        product: PRODUCT,
        kind: kind.id,
        kindLabel: kind.label,
        text: text.value.trim(),
        reporter: who.value.trim(),
        page: location.href,
        agent: navigator.userAgent,
        screen: window.innerWidth + '×' + window.innerHeight,
        shots: shots,
      }).then(function () {
        drawDone()
      }).catch(function (e) {
        send.disabled = false; send.textContent = '보내기'
        fail(msg, '보내지 못했습니다 — ' + e.message +
          '\n적으신 내용은 그대로 남아 있습니다. 잠시 뒤 다시 눌러 주세요.')
      })
    })
  }

  function fail(node, t) { node.className = 'msg err'; node.textContent = t }

  function addFiles(list, gallery) {
    Array.prototype.forEach.call(list, function (f) {
      if (shots.length >= MAX_SHOTS) return
      if (f.size > MAX_BYTES) {
        alert('「' + (f.name || '캡처') + '」 은(는) 너무 큽니다 (4MB 까지).')
        return
      }
      var r = new FileReader()
      r.onload = function () {
        shots.push({ name: f.name || ('캡처-' + (shots.length + 1) + '.png'),
                     type: f.type || 'image/png', dataUrl: r.result })
        drawShots(gallery)
      }
      r.readAsDataURL(f)
    })
  }

  function drawShots(gallery) {
    gallery.innerHTML = ''
    shots.forEach(function (s, i) {
      var box = el('div', 'shot')
      var img = document.createElement('img')
      img.src = s.dataUrl; img.alt = s.name
      box.appendChild(img)
      var x = el('button', null, '×')
      x.title = '빼기'
      x.addEventListener('click', function () { shots.splice(i, 1); drawShots(gallery) })
      box.appendChild(x)
      gallery.appendChild(box)
    })
  }

  function drawDone() {
    var body = panel.querySelector('.body')
    body.innerHTML = ''
    var d = el('div', 'done')
    d.appendChild(el('div', 'big', '✅'))
    d.appendChild(el('p', null, '보냈습니다. 고맙습니다.\n확인한 뒤 필요하면 연락드리겠습니다.'))
    body.appendChild(d)
    setTimeout(close, 2200)
  }

  function post(payload) {
    return fetch(ORIGIN + '/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (r) {
      if (r.ok) return
      return r.text().then(function (t) {
        var m = t
        // ⚠ 서버가 JSON 이 아닌 것을 줄 수도 있다(프록시 오류 쪽). 그때는 원문을 쓴다.
        try { m = JSON.parse(t).error || t } catch { /* JSON 이 아니면 원문 */ }
        throw new Error(m)
      })
    })
  }
})()
