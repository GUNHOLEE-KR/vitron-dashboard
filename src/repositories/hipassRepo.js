// 하이패스 통행 내역 (2026-09-04 신설)
// 하이패스는 조회 API 가 없어 «내려받은 엑셀» 을 올려서 쓴다.
//   법인차량  대표이사·관리자가 한 번 올리면 전 직원이 자기 것만 골라 쓴다
//   자차      본인이 자기 것을 올린다
const BASE = '/api/hipass'

// ⚠ 정산과 같은 로그인 세션을 쓴다 — credentials:'include' 가 없으면 쿠키가 실려 가지 않는다.
async function request(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { /* JSON 이 아니면 원문을 쓴다 */ }
  if (!res.ok) {
    const err = new Error(data?.error || text || `요청 실패 (HTTP ${res.status})`)
    err.status = res.status
    // 🔑 「차량을 모르겠다」 는 오류가 아니라 «물어볼 것» 이다. 화면이 차량 고르개를
    //    띄울 수 있도록 함께 싣는다.
    err.needVehicle = !!data?.need_vehicle
    err.card = data?.card
    err.warnings = data?.warnings
    throw err
  }
  return data
}

// 파일을 base64 로 실어 보낸다. 업로드 미들웨어를 들이지 않기 위함이고,
// 하이패스 파일은 두 달치가 16KB 라 이 방식으로 충분하다.
export function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error('파일을 읽지 못했습니다.'))
    r.onload = () => {
      const s = String(r.result || '')
      resolve(s.slice(s.indexOf(',') + 1))     // data:...;base64, 뒤만
    }
    r.readAsDataURL(file)
  })
}

// vehicleId 를 주면 그 차량으로 넣는다(카드가 아직 등록되지 않았을 때).
export const uploadHipass = (fileBase64, filename, vehicleId) =>
  request('POST', '/upload',
    { file_base64: fileBase64, filename, ...(vehicleId ? { vehicle_id: vehicleId } : {}) })

// unclaimed=true 면 «아직 아무도 안 가져간» 것만. 실적 창이 고를 것을 보여 줄 때 쓴다.
export function getHipass({ from, to, vehicleId, unclaimed } = {}) {
  const q = new URLSearchParams()
  if (from) q.set('from', from)
  if (to) q.set('to', to)
  if (vehicleId) q.set('vehicle_id', vehicleId)
  if (unclaimed) q.set('unclaimed', '1')
  const s = q.toString()
  return request('GET', s ? `?${s}` : '')
}

// 실적에 붙이기 / 떼기(actualId = null). 실적의 하이패스 금액은 «붙은 것의 합» 으로 다시 센다.
export const claimHipass = (id, actualId) => request('POST', `/${id}/claim`, { actual_id: actualId })
export const addManualHipass = (row) => request('POST', '/manual', row)
export const removeHipass = (id) => request('DELETE', `/${id}`)

// ── 근거 자료 (2026-09-04 신설) ──
// 🔑 올린 «파일 원본» 을 DB 에 남긴다. 그래야 나중에 「이 금액의 근거가 무엇이냐」에
//    답할 수 있다. 자동으로 지우지 않는다 — 사람이 손으로만 지운다(지시).
export const getHipassSummary = (ym) => request('GET', `/summary?ym=${ym}`)
export const getHipassByWorker = (ym, workerId) =>
  request('GET', `/by-worker?ym=${ym}${workerId ? `&worker_id=${workerId}` : ''}`)
export const removeHipassUpload = (id) => request('DELETE', `/uploads/${id}`)
// 원본은 «주소» 로 연다. fetch 로 받아 Blob 을 만들 수도 있지만, 그러면 파일 이름을
// 서버가 붙여 준 것(Content-Disposition)이 아니라 우리가 지어내야 한다.
export const hipassFileUrl = (id) => `/api/hipass/uploads/${id}/file`

// 인원별 근거를 CSV 로 만든다.
// 🔴 맨 앞에 «BOM» 을 붙인다 — 없으면 엑셀이 UTF-8 을 못 알아채 한글이 통째로 깨진다.
export function tollsToCsv(rows) {
  const esc = v => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = ['직원', '작업일', '통행일', '차량', '번호판', '구간', '금액(원)', '용도', '비고', '원본파일']
  const body = rows.map(r => [
    r.worker_name, r.work_date, r.used_date,
    r.vehicle_name, r.vehicle_plate,
    `${r.gate_in || '-'} → ${r.gate_out || '-'}`,
    r.amount,
    r.use_type === 'personal' ? '개인 사용' : '업무',
    r.manual ? '손으로 넣음' : (r.note || ''),
    r.source_filename || '',
  ].map(esc).join(','))
  return '﻿' + [head.join(','), ...body].join('\r\n')
}
