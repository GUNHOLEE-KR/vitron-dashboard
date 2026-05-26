import { supabase } from '../db/supabase'

// 전체 히스토리 조회
export async function getHistory() {
  const { data, error } = await supabase
    .from('work_history')
    .select('*')
    .order('work_date', { ascending: false })
    .order('work_hour')
  if (error) throw error
  return data
}

// 특정 날짜 조회
export async function getHistoryByDate(date) {
  const { data, error } = await supabase
    .from('work_history')
    .select('*')
    .eq('work_date', date)
    .order('work_hour')
  if (error) throw error
  return data
}

// 특정 직원의 오늘 업무 저장 (upsert)
export async function saveWorkerHistory(workerName, rows) {
  const today = new Date().toISOString().slice(0, 10)

  // 오늘 해당 직원 데이터 삭제 후 재입력
  const { error: delError } = await supabase
    .from('work_history')
    .delete()
    .eq('work_date', today)
    .eq('worker_name', workerName)
  if (delError) throw delError

  if (rows.length === 0) return

  const { error } = await supabase
    .from('work_history')
    .insert(rows)
  if (error) throw error
}

// 날짜 범위 조회 (주간/월간/연간 분석용)
export async function getHistoryByRange(from, to) {
  const { data, error } = await supabase
    .from('work_history')
    .select('*')
    .gte('work_date', from)
    .lte('work_date', to)
    .order('work_date')
    .order('work_hour')
  if (error) throw error
  return data
}