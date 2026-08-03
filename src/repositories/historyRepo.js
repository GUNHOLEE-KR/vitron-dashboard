const BASE = '/api'

export async function getHistory() {
  const res = await fetch(`${BASE}/history`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getHistoryByDate(date) {
  const res = await fetch(`${BASE}/history/date/${date}`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// workerId 로 저장 대상을 특정한다 (동명이인 구분). 이름은 기록 보존용으로 함께 보낸다.
export async function saveWorkerHistory(workerId, workerName, rows, workDate) {
  const date = workDate || new Date().toISOString().slice(0, 10)
  const res = await fetch(`${BASE}/history/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ worker_id: workerId, worker_name: workerName, work_date: date, rows })
  })
  if (!res.ok) throw new Error(await res.text())
}

export async function getHistoryByRange(from, to) {
  const res = await fetch(`${BASE}/history/range?from=${from}&to=${to}`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}
