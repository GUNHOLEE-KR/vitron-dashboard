import { supabase } from '../db/supabase'

// 전체 직원 목록 조회
export async function getWorkers() {
  const { data, error } = await supabase
    .from('workers')
    .select('*')
    .order('hired_at', { ascending: true })
    .order('created_at')
  if (error) throw error
  return data
}

// 직원 추가 (입사일 포함)
export async function addWorker(name, hiredAt) {
  const { data, error } = await supabase
    .from('workers')
    .insert({
      name,
      active: true,
      hired_at: hiredAt || new Date().toISOString().slice(0, 10)
    })
    .select()
    .single()
  if (error) throw error
  return data
}

// 재직/퇴사 상태 변경 (퇴사일 포함)
export async function setWorkerStatus(name, active, resignedAt = null) {
  const updates = { active }
  if (!active) {
    updates.resigned_at = resignedAt || new Date().toISOString().slice(0, 10)
  } else {
    updates.resigned_at = null
  }
  const { error } = await supabase
    .from('workers')
    .update(updates)
    .eq('name', name)
  if (error) throw error
}

// 직원 삭제
export async function removeWorker(name) {
  const { error } = await supabase
    .from('workers')
    .delete()
    .eq('name', name)
  if (error) throw error
}

// 입사일/퇴사일 수정
export async function updateWorkerDates(name, hiredAt, resignedAt) {
  const { error } = await supabase
    .from('workers')
    .update({ hired_at: hiredAt || null, resigned_at: resignedAt || null })
    .eq('name', name)
  if (error) throw error
}