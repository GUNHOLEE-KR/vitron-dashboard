const BASE = '/api'

export async function getWorkers() {
  const res = await fetch(`${BASE}/workers`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function addWorker(name, hiredAt, email) {
  const res = await fetch(`${BASE}/workers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, hired_at: hiredAt, email })
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// 회사 메일 주소. KPI 추적 시스템(8083)이 이 값을 로그인 아이디로 쓴다.
export async function updateWorkerEmail(id, email) {
  const res = await fetch(`${BASE}/workers/${id}/email`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  })
  if (!res.ok) {
    // 서버는 {"error":"..."} 로 답한다. 그 문구만 꺼내 쓴다.
    // try 안에서 곧바로 throw 하면 자기 catch 에 걸려 원본 JSON 이 그대로 화면에 뜬다.
    const text = await res.text()
    let message = text
    try { message = JSON.parse(text).error || text } catch { /* JSON 이 아니면 원문을 쓴다 */ }
    throw new Error(message)
  }
}

// 직책. 빈 문자열을 보내면 «직책 없음» 으로 지운다.
// ⚠ 값은 서버(server/index.js 의 POSITIONS)가 검사한다 — 목록에 없으면 400 이 온다.
export async function updateWorkerPosition(id, position) {
  const res = await fetch(`${BASE}/workers/${id}/position`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ position })
  })
  if (!res.ok) {
    const text = await res.text()
    let message = text
    try { message = JSON.parse(text).error || text } catch { /* JSON 이 아니면 원문을 쓴다 */ }
    throw new Error(message)
  }
}

// 달력·차트에서 이 사람을 나타내는 색. 빈 문자열을 보내면 «자동 배정» 으로 되돌아간다.
export async function updateWorkerColor(id, color) {
  const res = await fetch(`${BASE}/workers/${id}/color`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ color })
  })
  if (!res.ok) {
    const text = await res.text()
    let message = text
    try { message = JSON.parse(text).error || text } catch { /* JSON 이 아니면 원문을 쓴다 */ }
    throw new Error(message)
  }
}

// 아래 세 함수는 이름이 아니라 id 로 대상을 지정한다.
// 동명이인이 있으면 이름으로는 누구를 고칠지 특정할 수 없다.
export async function setWorkerStatus(id, active, resignedAt = null) {
  const res = await fetch(`${BASE}/workers/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active, resigned_at: resignedAt })
  })
  if (!res.ok) throw new Error(await res.text())
}

export async function updateWorkerDates(id, hiredAt, resignedAt) {
  const res = await fetch(`${BASE}/workers/${id}/dates`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hired_at: hiredAt, resigned_at: resignedAt })
  })
  if (!res.ok) throw new Error(await res.text())
}

export async function removeWorker(id) {
  const res = await fetch(`${BASE}/workers/${id}`, {
    method: 'DELETE'
  })
  if (!res.ok) throw new Error(await res.text())
}
