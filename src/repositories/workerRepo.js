const BASE = '/api'

export async function getWorkers() {
  const res = await fetch(`${BASE}/workers`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function addWorker(name, hiredAt) {
  const res = await fetch(`${BASE}/workers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, hired_at: hiredAt })
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
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
