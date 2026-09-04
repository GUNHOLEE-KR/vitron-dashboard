// 하이패스 사용내역 엑셀 읽기 (2026-09-04 신설)
// ════════════════════════════════════════════════════════════
// 하이패스는 조회 API 가 없다. 사람이 내려받은 파일을 그대로 읽어 들인다.
//
// 🔴 실물을 열어 보고 알아낸 것 세 가지 (2026-09-04, 기간별_사용내역.xls)
//   ① 확장자가 거짓말이다 — `.xls` 인데 속은 xlsx(ZIP/OOXML)다.
//      openpyxl 은 «확장자만 보고» 거절했다. 그래서 여기서도 확장자를 믿지 않고
//      xlsx 가 내용으로 판단하게 둔다.
//   ② 시트가 둘인데 「기간별_사용내역」 을 써야 한다.
//      「운영사별 사용내역」 은 한 통행이 사업자별로 «쪼개져» 두 줄이 된다
//      (번호 65 = 한국도로공사 15,200 + 경기고속도로 1,800). 그걸 읽으면 같은
//      통행이 두 번 잡힌다. 66건짜리 파일이 72줄로 보인다.
//   ③ 파일 어디에도 «어느 차량인지» 가 없다. 번호판 칸이 없고 「카드별명」은 비어
//      있다. 있는 것은 마스킹된 카드번호뿐 — 그것으로 차량을 가린다.
//
// ⚠ 「번호」 칸은 열쇠로 쓸 수 없다. 내려받을 때마다 1부터 다시 매겨진다.
//   (사용자: 「파일이름이나 정렬 방식은 다운로드 받을 때마다 달라서 확인해야해」)
const XLSX = require('xlsx')

// 머리글 이름 → 우리가 쓰는 이름. 하이패스 쪽이 칸 이름을 조금 바꿔도 견디도록
// «있는 것만» 가져다 쓴다.
const COLS = {
  '거래일시': 'used_at',
  '입구일시': 'entry_at',
  '출구일시': 'exit_at',
  '입구': 'gate_in',
  '출구': 'gate_out',
  '청구금액': 'amount',
  '카드번호': 'card_no',
  '비고': 'note',
}

// 「2026/07/05 17:27:27」 → Date. 엑셀이 날짜로 저장한 경우도 받는다.
function toDate(v) {
  if (v == null || v === '') return null
  if (v instanceof Date) return v
  const s = String(v).trim().replace(/\//g, '-')
  // 시각이 없으면 자정으로 둔다
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/)
  if (!m) return null
  const [, y, mo, d, hh = '0', mi = '0', ss = '0'] = m
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mi), Number(ss))
}

const toInt = v => {
  if (v == null || v === '') return 0
  const n = Number(String(v).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? Math.round(n) : 0
}

// 「기간별」 시트를 고른다. 이름이 바뀌었을 때를 대비해 «운영사별이 아닌 것» 을 쓴다.
function pickSheet(wb) {
  const names = wb.SheetNames
  const byName = names.find(n => n.replace(/\s/g, '').includes('기간별'))
  if (byName) return byName
  const notVendor = names.find(n => !n.replace(/\s/g, '').includes('운영사'))
  return notVendor || names[0]
}

// 머리글 줄을 찾는다. 1~4행은 제목·기간·합계라 «거래일시가 있는 줄» 이 머리글이다.
function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cells = (rows[i] || []).map(c => String(c ?? '').trim())
    if (cells.includes('거래일시') && cells.includes('청구금액')) return i
  }
  return -1
}

/**
 * 엑셀 바이트를 읽어 통행 목록을 돌려준다.
 *   { rows: [{used_at, entry_at, exit_at, gate_in, gate_out, amount, card_no, note}],
 *     cards: [카드번호…], sheet, period, warnings: [] }
 * ⚠ 던지지 않고 «무엇이 잘못됐는지» 를 warnings 로 돌려준다 — 사람이 고칠 수 있어야 한다.
 */
function parseHipass(buffer) {
  const warnings = []
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  if (!wb.SheetNames.length) return { rows: [], cards: [], warnings: ['시트가 없습니다.'] }

  const sheet = pickSheet(wb)
  if (!sheet.replace(/\s/g, '').includes('기간별')) {
    warnings.push(`「기간별」 시트를 찾지 못해 「${sheet}」 를 읽었습니다. 내용을 확인해 주십시오.`)
  }
  const grid = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: false, defval: '' })

  // 머리말에서 기간을 주워 둔다 — 화면이 「무엇을 올렸는지」 를 말할 수 있게.
  let period = null
  for (let i = 0; i < Math.min(grid.length, 6); i++) {
    const t = (grid[i] || []).map(c => String(c ?? '')).join(' ')
    const m = t.match(/사용기간\s*:\s*(\d{8})\s*~\s*(\d{8})/)
    if (m) { period = `${m[1]} ~ ${m[2]}`; break }
  }

  const hi = findHeader(grid)
  if (hi < 0) {
    return { rows: [], cards: [], sheet, period,
      warnings: ['「거래일시」·「청구금액」 칸이 있는 머리글 줄을 찾지 못했습니다. 하이패스에서 내려받은 파일이 맞는지 확인해 주십시오.'] }
  }
  const head = (grid[hi] || []).map(c => String(c ?? '').trim())
  const idx = {}
  head.forEach((name, i) => { if (COLS[name] && idx[COLS[name]] === undefined) idx[COLS[name]] = i })
  for (const need of ['used_at', 'amount']) {
    if (idx[need] === undefined) {
      return { rows: [], cards: [], sheet, period,
        warnings: [`필요한 칸(${need === 'used_at' ? '거래일시' : '청구금액'})이 없습니다.`] }
    }
  }

  const rows = []
  const cards = new Set()
  let skippedNoDate = 0
  for (let i = hi + 1; i < grid.length; i++) {
    const r = grid[i] || []
    const at = toDate(r[idx.used_at])
    if (!at) { if ((r[idx.used_at] ?? '') !== '') skippedNoDate++; continue }
    const card = idx.card_no !== undefined ? String(r[idx.card_no] ?? '').trim() : ''
    if (card) cards.add(card)
    rows.push({
      used_at: at,
      entry_at: idx.entry_at !== undefined ? toDate(r[idx.entry_at]) : null,
      exit_at: idx.exit_at !== undefined ? toDate(r[idx.exit_at]) : null,
      gate_in: idx.gate_in !== undefined ? String(r[idx.gate_in] ?? '').trim() || null : null,
      gate_out: idx.gate_out !== undefined ? String(r[idx.gate_out] ?? '').trim() || null : null,
      amount: toInt(r[idx.amount]),
      card_no: card || null,
      note: idx.note !== undefined ? String(r[idx.note] ?? '').trim().slice(0, 120) || null : null,
    })
  }
  if (skippedNoDate) warnings.push(`날짜를 읽지 못한 줄 ${skippedNoDate}개를 건너뛰었습니다.`)
  // 🔑 카드가 둘 이상이면 «차량이 섞인» 파일이다. 한 차로 몰아 넣으면 남의 통행료가
  //    내 차에 붙는다 — 올리는 쪽에서 막아야 하므로 알려 준다.
  if (cards.size > 1) {
    warnings.push(`카드가 ${cards.size}장 섞여 있습니다 (${[...cards].join(', ')}). 차량별로 나눠 올려 주십시오.`)
  }
  return { rows, cards: [...cards], sheet, period, warnings }
}

module.exports = { parseHipass }
