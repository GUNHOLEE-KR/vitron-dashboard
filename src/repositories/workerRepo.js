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

export async function setWorkerStatus(name, active, resignedAt = null) {
  const res = await fetch(`${BASE}/workers/${encodeURIComponent(name)}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active, resigned_at: resignedAt })
  })
  if (!res.ok) throw new Error(await res.text())
}

export async function updateWorkerDates(name, hiredAt, resignedAt) {
  const res = await fetch(`${BASE}/workers/${encodeURIComponent(name)}/dates`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hired_at: hiredAt, resigned_at: resignedAt })
  })
  if (!res.ok) throw new Error(await res.text())
}

export async function removeWorker(name) {
  const res = await fetch(`${BASE}/workers/${encodeURIComponent(name)}`, {
    method: 'DELETE'
  })
  if (!res.ok) throw new Error(await res.text())
}
