import { useState, useEffect, useRef } from 'react'
import { BarChart, Bar, PieChart, Pie, Cell, LineChart, Line, AreaChart, Area, LabelList, Treemap,
         RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
         ComposedChart, XAxis, YAxis, Tooltip, Legend, ReferenceLine, ResponsiveContainer } from 'recharts'
import { getWorkers, addWorker, setWorkerStatus, removeWorker, updateWorkerDates, updateWorkerEmail } from './repositories/workerRepo'
import { getAbsences, addAbsence, removeAbsence } from './repositories/absenceRepo'
import { getHistory, getHistoryByDate, saveWorkerHistory } from './repositories/historyRepo'
import { getJiraTree, syncJira, addJiraIssue, removeJiraIssue, getJiraTokenStatus } from './repositories/jiraRepo'
import { getPlaces, addPlace, updatePlace, hidePlace, getVehicles, addVehicle, updateVehicle,
         getPlans, addPlan, updatePlan, removePlan, getActuals, addActual, updateActual,
         removeActual, login, logout, whoAmI, getSettlement, approveSettlement,
         reopenSettlement } from './repositories/scheduleRepo'

const WORK_HOURS=[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23]
// 정규 근무시간 (09:00 시작 ~ 18:00 종료 → 17:00 행까지 포함) — 입력표에서 노랗게 강조
const BUSINESS_START_HOUR=9, BUSINESS_END_HOUR=17
const isBusinessHour=h=>h>=BUSINESS_START_HOUR&&h<=BUSINESS_END_HOUR
const COLORS=['#3b82f6','#10b981','#f59e0b','#8b5cf6','#06b6d4','#ec4899','#84cc16','#f97316']
// Jira 에 넣기 애매한 «끝이 없는» 반복 업무(주간회의 등)를 모아 두는 상위업무 이름.
// 내부적으로는 수동 추가(MANUAL-…)와 같은 것이라 Jira 동기화가 지우지 않는다.
const FIXED_PARENT='고정업무'

// 팝업이 화면보다 길어지면 아래(저장·삭제 단추)가 잘려 누를 수 없었다.
// 여기서 키를 재 두면 넘치는 만큼 «팝업 안쪽»에 스크롤바가 생긴다 —
// 배경이 스크롤되면 막대가 화면 맨 끝에 붙어 팝업과 떨어져 보이지 않는다.
// 값 80 = 배경의 위아래 여백 40+40 (여백이 다른 팝업은 제 값을 따로 쓴다).
const MODAL_MAX_H='calc(100vh - 80px)'

const TABS=['today','daily','weekly','monthly','yearly','schedule','settings']
const TAB_LABELS={today:'오늘 업무',daily:'일간',weekly:'주간',monthly:'월간',yearly:'연간',schedule:'스케줄',settings:'설정'}

// ── 스케줄 상수 ──────────────────────────────────────────
// 이동 수단.
// ⚠ 「사무실」은 이 목록에 넣지 않는다. 장소가 사무실이면 이동 자체가 없어
//   이동 수단을 물을 일이 없다 — 장소 선택으로 결정된다(place = OFFICE_PLACE).
//   예전에는 사무실이 법인차량과 같은 줄에 섞여 있어, 내근을 넣으려 해도
//   장소를 강제로 골라야 해서 등록이 막혔다.
const OUT_TRANSPORTS=[
  {v:'company_car', label:'법인차량', icon:'🚗', needsVehicle:true},
  {v:'own_car',     label:'자차',   icon:'🚙', needsVehicle:true},
  {v:'transit',     label:'대중교통', icon:'🚌', needsVehicle:false},
]
// 표시용에는 사무실과 «이동 없음» 도 필요하다(달력 배지·일 뷰).
// none 을 빼 두면 휴가 배지가 fallback 으로 🏢(사무실) 처럼 보인다.
const TRANSPORT_MAP=Object.fromEntries([
  ...OUT_TRANSPORTS,
  {v:'office', label:'사무실',   icon:'🏢', needsVehicle:false},
  {v:'none',   label:'이동 없음', icon:'🌴', needsVehicle:false},
].map(t=>[t.v,t]))
// 장소 목록 맨 위의 고정 항목. 장소 목록(DB)에 넣지 않는다 —
// 사무실은 회사 자체이고 거리가 0 이라 관리 대상을 늘릴 이유가 없다.
const OFFICE_PLACE='office'

// 일정 유형 — 무엇을 등록하는가. 이것을 먼저 고르면 그 뒤에 «필요한 것만» 나온다.
// (예전에는 「업무/개인 사용」이 차량과 무관한 자리에 먼저 나와 순서가 어긋났다)
const PLAN_KINDS=[
  {v:'work',    label:'업무',      icon:'📋', desc:'장소에서 하는 일'},
  {v:'vehicle', label:'차량 예약', icon:'🚗', desc:'차량만 쓰는 경우'},
  {v:'vacation',label:'휴가',      icon:'🌴', desc:'연차·병가 등'},
]
// 휴가 종류. 값이 늘거나 바뀔 수 있으므로 여기 한 곳에서만 관리한다.
const VACATION_TYPES=['연차','병가','포상','기타']
// 장소 분류 — 「현장」과 「고객사」를 굳이 나눌 이유가 없어 합쳤다.
const PLACE_CATEGORIES=['고객사','기타']
const SLOTS=[{v:'allday',label:'종일'},{v:'am',label:'오전'},{v:'pm',label:'오후'},{v:'time',label:'시각 지정'}]
const SLOT_MAP=Object.fromEntries(SLOTS.map(s=>[s.v,s.label]))
const SCHEDULE_VIEWS=[{v:'month',label:'월'},{v:'week',label:'주'},{v:'day',label:'일'},
                      {v:'year',label:'연'},{v:'settle',label:'💰 정산'}]
// 표 머리글은 데이터 행과 확실히 구분되는 진한 남색으로.
// 연한 회색(#f9fafb)이던 때는 첫 데이터 행과 같은 색이라 머리글이 붙어 보였다.
// 오늘 업무 입력표 머리글과 같은 색이라 화면 전체가 일관된다.
const thS={background:'#1e3a5f',padding:'8px 10px',textAlign:'center',fontWeight:700,border:'1px solid #e5e7eb',fontSize:11,color:'#fff',whiteSpace:'nowrap'}
const tdS={padding:'6px 10px',border:'1px solid #e5e7eb',textAlign:'center',verticalAlign:'middle',fontSize:12}

// 차트 공통 헬퍼 — 단위는 모두 "시간(h)"
const numLabel=(v)=>(v?String(v):'')              // 0/빈값은 라벨 숨김
const hourTip=(v)=>`${v??0}h`                       // 툴팁 값에 h 부착
// 업무명 표시 정리: "[VITRON-167] …" 또는 "VITRON-166 …" 같은 지라번호 prefix 제거 → 순수 이름만 (저장값엔 영향 없음)
const cleanName=(s)=>String(s||'').replace(/^\s*\[[^\]]*\]\s*/,'').replace(/^\s*[A-Z][A-Z0-9]*-\d+\s*/,'')

// 집계 키를 만들 때 쓰는 정규화. 앞뒤 공백을 떼고 사이 공백을 한 칸으로 눌러 준다.
// 같은 업무가 공백 차이로 두 줄이 되는 실데이터가 있다 — '[VITRON-231] 설계 화면 구현' 이
// 공백 두 칸짜리와 따로 쌓여 파레토·트리맵에 37h / 16h 로 갈라져 보였다.
// ⚠ 집계·표시에만 쓴다. 입력표 복원(cellKey→work_text)과 저장 payload 는
//    사용자가 적은 원본 그대로여야 한다 (KPI 총괄 분석도 SQL 에서 같은 규칙으로 누른다).
const normText=(s)=>String(s??'').trim().replace(/\s+/g,' ')

// ── 업무를 «대업무»로 묶기 ────────────────────────────────
// 기록에는 번호+소업무만 남아(`[VITRON-41] 현장 설치 및 데이터 수집 테스트`)
// 어느 일에 딸린 것인지 알 수 없었다. jiraTree({대업무:[소업무…]})로 되짚어 묶는다.
// Jira 에 없는 손입력 업무는 딸릴 곳이 없으니 「기타」로 모으고 늘 «맨 끝»에 둔다.
const NO_PARENT='기타'
const parentOfTask=(text,jiraTree)=>{
  if(!jiraTree)return NO_PARENT
  const t=normText(text)
  if(jiraTree[t]!==undefined)return t                 // 대업무에 직접 적은 줄
  for(const[p,subs]of Object.entries(jiraTree)){
    if(subs.some(s=>normText(s)===t))return p
  }
  return NO_PARENT
}
// 상위업무에 «직접» 적은 줄은 이름이 대업무와 같아, 그대로 두면 같은 이름이 두 줄로 보인다.
const childLabel=(text,parent)=>{
  const n=cleanName(normText(text))
  return normText(n)===normText(cleanName(parent))?'(이 업무에 직접)':n
}

const TASK_SORTS=[
  {value:'hours-desc',label:'시간 많은 순'},
  {value:'name-asc',  label:'이름 ㄱ→ㅎ'},
  {value:'name-desc', label:'이름 ㅎ→ㄱ'},
  {value:'date-asc',  label:'시작일 오래된 순'},
  {value:'date-desc', label:'시작일 최근 순'}
]
// 대업무 줄과 소업무 줄을 같은 잣대로 다룬다.
// 대업무는 묶음의 합계 시간과 «가장 이른» 시작일을 대표값으로 쓴다.
const sortKeyOfTask=x=>({
  name:x.parent!=null?cleanName(x.parent):cleanName(normText(x.task??x.name??'')),
  hours:x.hours||0,
  date:x.first??x.firstDate??''
})
function taskComparer(sort){
  return(a,b)=>{
    const A=sortKeyOfTask(a),B=sortKeyOfTask(b)
    switch(sort){
      case 'name-asc': return A.name.localeCompare(B.name,'ko')
      case 'name-desc':return B.name.localeCompare(A.name,'ko')
      // 시작일이 없는 줄은 어느 쪽으로 세우든 «맨 뒤»로 보낸다
      case 'date-asc': return (A.date||'9999').localeCompare(B.date||'9999')
      case 'date-desc':return (B.date||'').localeCompare(A.date||'')
      default:         return B.hours-A.hours||A.name.localeCompare(B.name,'ko')
    }
  }
}
// 업무 목록(각 항목에 task·hours·firstDate)을 대업무로 묶는다.
function groupTasksByParent(list,jiraTree,sort){
  const groups=new Map()
  list.forEach(t=>{
    const p=parentOfTask(t.task,jiraTree)
    if(!groups.has(p))groups.set(p,{parent:p,hours:0,first:'',children:[]})
    const g=groups.get(p)
    g.hours+=t.hours||0
    g.children.push(t)
    const d=t.firstDate||''
    if(d&&(!g.first||d<g.first))g.first=d
  })
  const cmp=taskComparer(sort)
  const arr=[...groups.values()]
  arr.forEach(g=>g.children.sort(cmp))
  arr.sort(cmp)
  // 「기타」는 언제나 맨 끝 (sort 는 안정적이라 위 정렬이 유지된다)
  return arr.sort((a,b)=>(a.parent===NO_PARENT?1:0)-(b.parent===NO_PARENT?1:0))
}
// 업무별 «처음 적은 날». 시작일 정렬의 기준이다.
function firstDateByTask(rows){
  const m={}
  rows.forEach(r=>{
    const t=normText(r.work_text),d=r.work_date
    if(!d)return
    if(!m[t]||d<m[t])m[t]=d
  })
  return m
}
// 정렬 고르개 — 표마다 같은 모양으로 둔다
function SortPicker({value,onChange}){
  return(
    <select value={value} onChange={e=>onChange(e.target.value)}
      style={{padding:'4px 8px',border:'1px solid #d1d5db',borderRadius:6,fontSize:11,background:'#fff'}}>
      {TASK_SORTS.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}
    </select>
  )
}

// ── 여러 계열이 겹친 차트용 툴팁 ────────────────────────
// 누적/다계열 차트는 모든 계열을 같은 데이터 객체에 담기 때문에,
// 해당 항목을 하지 않은 계열도 0 으로 채워져 툴팁에 전부 나온다.
// (직원 7명 중 1명만 일한 날도 7줄이 떠서 읽기 어려웠다)
// 값이 있는 계열만 남기고 큰 순서로 정렬한다.
// percent=true 면 시간과 함께 그 기간 내 비중도 보여준다 (100% 누적 차트용)
function NonZeroTooltip({active,payload,label,unit='h',percent=false}){
  if(!active||!payload)return null
  const rows=payload
    .filter(p=>Number(p.value)>0)
    .sort((a,b)=>Number(b.value)-Number(a.value))
  if(!rows.length)return null      // 전부 0 이면 툴팁을 띄우지 않는다
  const sum=percent?rows.reduce((s,p)=>s+Number(p.value),0):0
  // 업무명이 길어 잘리면 어떤 업무인지 알 수 없다. 폭을 넓게 두고
  // 긴 이름은 줄바꿈해서 제목이 전부 보이게 한다.
  return(
    <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:7,
      padding:'9px 12px',fontSize:12,boxShadow:'0 2px 10px rgba(0,0,0,.1)',maxWidth:460}}>
      {label!==undefined&&<div style={{fontWeight:700,marginBottom:5,color:'#374151'}}>{label}</div>}
      {rows.map(p=>(
        <div key={p.dataKey ?? p.name} style={{display:'flex',justifyContent:'space-between',gap:14,lineHeight:1.6,alignItems:'flex-start'}}>
          {/* 범례용 name 은 좁은 공간 탓에 14~16자로 잘려 있다.
              툴팁에서는 원본 dataKey 를 정리해 전체 제목을 보여준다. */}
          <span style={{color:p.color||p.stroke||'#6b7280',whiteSpace:'normal',wordBreak:'break-word'}}>
            {p.dataKey!=null?cleanName(String(p.dataKey)):p.name}
          </span>
          <span style={{fontWeight:700,color:'#374151',whiteSpace:'nowrap'}}>
            {p.value}{unit}{percent&&sum>0&&` (${Math.round(p.value/sum*100)}%)`}
          </span>
        </div>
      ))}
    </div>
  )
}

// ⚠️ 날짜를 YYYY-MM-DD 로 만들 때 toISOString() 을 쓰면 안 된다.
// toISOString() 은 UTC 기준이라 한국(UTC+9)에서는 오전 9시 이전에 전날이 된다.
// 실제로 오전에 업무를 저장하면 전날 날짜로 기록되는 버그가 있었다.
// 로컬 연·월·일을 그대로 조립해야 시간대 영향을 받지 않는다.
function ymd(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function today(){return ymd(new Date())}
function toMonth(d){return d.slice(0,7)}
function toYear(d){return parseInt(d.slice(0,4))}
function weekNum(d){return Math.ceil(new Date(d).getDate()/7)}
function dayName(d){return['일','월','화','수','목','금','토'][new Date(d).getDay()]}

// ── 동명이인 구분 ────────────────────────────────────
// 직원의 진짜 식별자는 id 다. 이름은 개명·오타 정정으로 바뀔 수 있어서다.
// 다만 화면에는 이름을 보여줘야 읽기 쉬우므로, 같은 이름이 둘 이상일 때만
// 입사일을 덧붙여 구분한다. (예: "홍길동 (2026-05-26 입사)")
function duplicatedNames(workers) {
  const count = {}
  workers.forEach(w => { count[w.name] = (count[w.name] || 0) + 1 })
  return new Set(Object.keys(count).filter(n => count[n] > 1))
}
function workerLabel(worker, dupNames) {
  if (!worker) return ''
  return dupNames.has(worker.name)
    ? `${worker.name} (${worker.hired_at || '입사일 미정'} 입사)`
    : worker.name
}
// 업무 기록의 worker_name 을 화면 표시용 이름으로 바꿔 둔다.
// 이렇게 해두면 집계·차트 코드는 그대로 두고도 동명이인이 자동 분리된다.
// 원본 이름은 worker_name_raw 로 남긴다 (기록 당시의 이름).
function withDisplayNames(history, workers) {
  const byId = new Map(workers.map(w => [w.id, w]))
  const dupNames = duplicatedNames(workers)
  return history.map(r => {
    const w = byId.get(r.worker_id)
    // 직원이 삭제됐으면 기록에 남은 이름을 그대로 쓴다
    const label = w ? workerLabel(w, dupNames) : r.worker_name
    return { ...r, worker_name: label, worker_name_raw: r.worker_name }
  })
}

// 평균 시간은 소수 첫째 자리까지 보여준다.
// 정수로 반올림하면 5명이 12h 일 때 2.4 → 2 가 되어 오차가 크다.
function avgHours(total, count){
  if(!count) return '0'
  const v=total/count
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

// 기간별 직원 필터 헬퍼
// ⚠ 비활성인데 퇴사일이 비어 있는 사람도 걸러낸다. 그런 행이 있으면 어느 기간을 봐도
//   계속 재직자로 세어져 평균이 조용히 틀어진다 (서버가 퇴사 시 날짜를 채우지만, DB 를
//   직접 고친 경우까지 막으려면 화면에도 방어가 있어야 한다).
function workersForPeriod(workers, periodStart, periodEnd) {
  return workers.filter(w => {
    if (!w.active && !w.resigned_at) return false
    const hiredOk = !w.hired_at || w.hired_at <= periodEnd
    const resignedOk = !w.resigned_at || w.resigned_at >= periodStart
    return hiredOk && resignedOk
  })
}

// ── 장기 부재(장기출장·휴직·파견) ────────────────────────────
// 장기 출장자는 업무를 입력할 수 없는데 집계에는 재직자로 들어간다.
// 그 한 사람 때문에 평균이 내려가고 최소값이 그 사람으로 고정된다.
// 규칙(2026-08-18 사용자 결정) — 부재 기간은 «가동일»에서 빼고,
// 그 기간에 남아 있는 기록도 집계에 넣지 않는다. 평균·최대·최소는 «하루당» 으로 본다.
// 「집계 제외」만 성격이 다르다 — 부재가 아니라 «애초에 집계 대상이 아닌 사람»(대표이사 등).
// 처리 방식이 같아 같은 표를 쓴다. 종료일을 비워 두면 계속 제외된다.
const ABSENCE_STYLE = {
  장기출장:   { fg:'#9a3412', bg:'#ffedd5' },
  휴직:      { fg:'#6b21a8', bg:'#f3e8ff' },
  파견:      { fg:'#1e40af', bg:'#dbeafe' },
  '집계 제외': { fg:'#374151', bg:'#e5e7eb' }
}
// 그 날 그 사람이 부재였는가. to_date 가 비어 있으면 «아직 안 돌아옴» 이라 끝이 없다.
function isAbsentOn(absences, workerId, date) {
  return absences.some(a => a.worker_id === workerId &&
    a.from_date <= date && (!a.to_date || a.to_date >= date))
}
// 「집계 제외」만 따로 본다 — 이것은 부재가 아니라 «애초에 업무 기록 대상이 아닌 사람»
// (대표이사 등)이다. 집계에서 빼는 것으로 끝내지 않고 «입력표에도 띄우지 않는다» —
// 적을 사람이 아닌데 열이 있으면 빈 칸이 미입력처럼 보인다.
// ⚠ 이름을 코드에 박지 않는다. 사유로 거르므로 설정 탭에서 등록·삭제하면 화면이 따라간다.
// 장기출장·휴직·파견은 여기 걸리지 않는다 — 돌아와 그 기간을 소급 입력할 수 있어야 한다.
function isExcludedOn(absences, workerId, date) {
  return absences.some(a => a.worker_id === workerId && a.kind === '집계 제외' &&
    a.from_date <= date && (!a.to_date || a.to_date >= date))
}
// 기간과 겹치는 부재만 추린다 (화면 배지용)
function absencesInPeriod(absences, workerId, from, to) {
  return absences.filter(a => a.worker_id === workerId &&
    a.from_date <= to && (!a.to_date || a.to_date >= from))
}
// 부재 기간에 남은 기록은 집계에서 뺀다. 원본은 그대로 두고 «보는 것만» 뺀다.
function excludeAbsentRows(rows, absences) {
  if (!absences.length) return rows
  return rows.filter(r => !isAbsentOn(absences, r.worker_id, r.work_date))
}
// 그 사람이 이 기간에 실제로 일할 수 있었던 날 수 = 영업일 − (재직 밖) − 부재일
// 그 기간에 «일할 수 있었던 사람» 만 남긴다. 가동일이 0이면 통째로 부재라
// 평균·최대·최소 어디에도 넣지 않는다 — 넣으면 0시간이 최소값으로 고정된다.
function workersAvailable(workers, absences, from, to) {
  return workersForPeriod(workers, from, to).filter(w => activeDays(w, absences, from, to) > 0)
}

function activeDays(worker, absences, from, to) {
  let n = 0
  const cur = new Date(from + 'T00:00:00'), end = new Date(to + 'T00:00:00')
  while (cur <= end) {
    const d = ymd(cur), dow = cur.getDay()
    const inService = (!worker.hired_at || worker.hired_at <= d) &&
                      (!worker.resigned_at || worker.resigned_at >= d)
    if (dow !== 0 && dow !== 6 && inService && !isAbsentOn(absences, worker.id, d)) n++
    cur.setDate(cur.getDate() + 1)
  }
  return n
}
function monthEnd(ym) {
  // toISOString() 을 쓰면 UTC 변환 탓에 하루 빨라진다 (8월 → 08-30).
  // 말일에 입사한 직원이 그 달 통계에서 빠지던 원인이었다.
  const [y,m]=ym.split('-').map(Number)
  return ym+'-'+String(new Date(y,m,0).getDate()).padStart(2,'0')
}
function weekStart(d) {
  const wn=weekNum(d), sd=((wn-1)*7+1)
  return d.slice(0,7)+'-'+String(sd).padStart(2,'0')
}
function weekEnd(d) {
  const wn=weekNum(d), ed=wn*7
  const [y,m]=d.slice(0,7).split('-').map(Number)
  const last=new Date(y,m,0).getDate()
  return d.slice(0,7)+'-'+String(Math.min(ed,last)).padStart(2,'0')
}
// 그 달에 주차가 몇 개인지 (1~7일=1주차, 8~14일=2주차 … 방식)
// 31일인 달은 5주차(29~31일)까지, 28일인 달은 4주차까지 나온다.
function weeksInMonth(ym){
  const [y,m]=ym.split('-').map(Number)
  return Math.ceil(new Date(y,m,0).getDate()/7)
}
// 그 달 N주차의 첫날 (주차를 골랐을 때 이동할 날짜)
function weekFirstDate(ym,wk){
  return ym+'-'+String((wk-1)*7+1).padStart(2,'0')
}

// ── 스케줄 달력용 날짜 계산 ───────────────────────────────
// 리포트 탭의 주차는 «1~7일 = 1주차» 방식이지만, 스케줄 달력은 사람이 보는
// 달력과 같아야 하므로 «월요일 시작» 실제 주를 쓴다.
// ⚠ 날짜 계산에 toISOString() 을 쓰지 않는다 (UTC 라 오전에 하루 밀린다)
function addDays(dateStr,n){
  const [y,m,d]=dateStr.split('-').map(Number)
  return ymd(new Date(y,m-1,d+n))
}
function calWeekStart(dateStr){          // 그 날짜가 속한 주의 월요일
  const [y,m,d]=dateStr.split('-').map(Number)
  const dow=new Date(y,m-1,d).getDay()   // 0=일 … 6=토
  return addDays(dateStr,dow===0?-6:1-dow)
}
function calWeekDays(dateStr){           // 월~일 7일
  const s=calWeekStart(dateStr)
  return Array.from({length:7},(_,i)=>addDays(s,i))
}
// 월 달력 격자 — 1일이 속한 주의 월요일부터 6주(42칸)를 채운다.
// 42칸 고정이면 달을 옮겨도 격자 높이가 흔들리지 않는다.
function monthGridDays(ym){
  const start=calWeekStart(ym+'-01')
  return Array.from({length:42},(_,i)=>addDays(start,i))
}
function isSameMonth(dateStr,ym){ return dateStr.slice(0,7)===ym }
function shiftMonth(ym,n){
  const [y,m]=ym.split('-').map(Number)
  const d=new Date(y,m-1+n,1)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
}
function mdLabel(dateStr){ return `${Number(dateStr.slice(5,7))}/${Number(dateStr.slice(8,10))}` }

function aggByWorker(rows){
  const m={}
  rows.forEach(r=>{
    if(!m[r.worker_name])m[r.worker_name]={total:0,works:{}}
    m[r.worker_name].total++
    const t=normText(r.work_text)
    m[r.worker_name].works[t]=(m[r.worker_name].works[t]||0)+1
  })
  return m
}
function aggByWork(rows){const m={};rows.forEach(r=>{const t=normText(r.work_text);m[t]=(m[t]||0)+1});return m}
function top8(rows){
  return Object.entries(aggByWork(rows)).sort((a,b)=>b[1]-a[1]).slice(0,8)
    .map(([name,value])=>{const nm=cleanName(name);return{name:nm.length>15?nm.slice(0,15)+'…':nm,value}})
}
// 입력표의 칸을 가리키는 키. 이름이 아니라 id 를 쓴다 —
// 동명이인이 있으면 이름으로는 두 사람이 같은 칸을 공유하게 된다.
function cellKey(hour, workerId){ return `${hour}_${workerId}` }

function buildParentSel(rows,jiraTree){
  const ps={}
  rows.forEach(r=>{
    const key=cellKey(r.work_hour,r.worker_id),val=r.work_text
    if(jiraTree[val]!==undefined){ps[key]=val}
    else{for(const[p,s]of Object.entries(jiraTree)){if(s.includes(val)){ps[key]=p;break}}}
  })
  return ps
}

// ── 직원별 업무 분석 ──────────────────────────────────
function WorkerAnalysis({rows,workers,jiraTree}){
  const [sort,setSort]=useState('hours-desc')
  if(!rows.length)return null
  const wNames=workers.map(w=>w.name).filter(n=>rows.some(r=>r.worker_name===n))
  const firstDates=firstDateByTask(rows)
  const topTasks=Object.entries(aggByWork(rows)).sort((a,b)=>b[1]-a[1]).slice(0,8).map(e=>e[0])
  const taskName=t=>{const nm=cleanName(t);return nm.length>16?nm.slice(0,16)+'…':nm}
  const barData=wNames.map(w=>{
    const wRows=rows.filter(r=>r.worker_name===w)
    const obj={name:w,total:wRows.length}
    topTasks.forEach(t=>{obj[t]=wRows.filter(r=>normText(r.work_text)===t).length})
    return obj
  })
  // 직원명은 rowSpan 으로 한 칸에 묶어 표시한다.
  // 줄마다 이름이 반복되면 어디서 사람이 바뀌는지 알아보기 어렵다.
  // first=그 직원의 첫 줄인가, span=묶을 줄 수
  // 사람 → 대업무 → 소업무. 줄 목록을 미리 펼쳐 두고 rowSpan 으로 사람 칸을 묶는다.
  // 대업무 줄도 한 줄을 차지하므로 span 에 함께 센다.
  const tableRows=[]
  wNames.forEach(w=>{
    const wRows=rows.filter(r=>r.worker_name===w)
    const total=wRows.length;if(!total)return
    const tg={}; wRows.forEach(r=>{const t=normText(r.work_text);tg[t]=(tg[t]||0)+1})
    const flat=Object.entries(tg).map(([task,hours])=>({task,hours,firstDate:firstDates[task]||''}))
    const groups=groupTasksByParent(flat,jiraTree,sort)
    const span=groups.reduce((a,g)=>a+1+g.children.length,0)
    let idx=0
    groups.forEach(g=>{
      tableRows.push({kind:'parent',worker:w,group:g,wi:wNames.indexOf(w),
        first:idx===0,span,workerTotal:total})
      idx++
      g.children.forEach(c=>{
        tableRows.push({kind:'task',worker:w,parent:g.parent,...c,
          ratio:Math.round(c.hours/total*100),wi:wNames.indexOf(w),first:false,workerTotal:total})
        idx++
      })
    })
  })
  return(
    <div style={{display:'flex',flexDirection:'column',gap:16,marginBottom:16}}>
      <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,padding:18,minWidth:260,maxWidth:'100%',boxSizing:'border-box'}}>
        <div style={{fontSize:14,fontWeight:700,marginBottom:14}}>직원별 업무 구성 · 단위: 시간(h)</div>
        <ResponsiveContainer width="100%" height={Math.max(200,wNames.length*52+60)}>
          <BarChart data={barData} layout="vertical">
            <XAxis type="number" unit="h" tick={{fontSize:11}}/>
            <YAxis type="category" dataKey="name" tick={{fontSize:12}} width={55}/>
            <Tooltip content={<NonZeroTooltip/>}/><Legend wrapperStyle={{fontSize:10}}/>
            {topTasks.map((t,i)=>(
              <Bar key={t} dataKey={t} name={taskName(t)} stackId="a" fill={COLORS[i%COLORS.length]} radius={i===topTasks.length-1?[0,4,4,0]:[0,0,0,0]}>
                <LabelList dataKey={t} position="center" fontSize={9} fill="#fff" formatter={numLabel}/>
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,padding:18,minWidth:260,maxWidth:'100%',boxSizing:'border-box',overflowX:'auto'}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14,flexWrap:'wrap'}}>
          <div style={{fontSize:14,fontWeight:700}}>직원별 업무 상세</div>
          <SortPicker value={sort} onChange={setSort}/>
        </div>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead><tr>
            <th style={thS}>직원</th><th style={{...thS,textAlign:'left'}}>업무</th>
            <th style={thS}>시간</th><th style={{...thS,minWidth:120}}>비율</th>
          </tr></thead>
          <tbody>
            {tableRows.map((r,i)=>{
              // 배경은 줄 번호가 아니라 직원 순서로 번갈아 칠한다 —
              // 줄 기준이면 한 사람의 여러 줄이 서로 다른 색이 되어 구분이 안 된다.
              const bg=r.wi%2===0?'#fff':'#eff6ff'
              const topBorder=r.first&&i>0?'2px solid #cbd5e1':undefined
              // 대업무 줄 — 이름과 묶음 합계만 적는다. 비율 막대는 소업무에만 둔다.
              if(r.kind==='parent')return(
                <tr key={i} style={{background:bg}}>
                  {r.first&&(
                    <td rowSpan={r.span} style={{...tdS,fontWeight:700,color:COLORS[r.wi%COLORS.length],
                      verticalAlign:'middle',borderTop:topBorder,whiteSpace:'nowrap'}}>
                      {r.worker}
                      <div style={{fontSize:10,fontWeight:600,color:'#9ca3af',marginTop:2}}>{r.workerTotal}h</div>
                    </td>
                  )}
                  <td style={{...tdS,textAlign:'left',fontWeight:700,borderTop:topBorder,
                    color:r.group.parent===NO_PARENT?'#6b7280':'#111827',
                    maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={r.group.parent}>
                    {cleanName(r.group.parent)}{r.group.children.length>1&&` · ${r.group.children.length}건`}
                  </td>
                  <td style={{...tdS,borderTop:topBorder,fontWeight:700}}>{r.group.hours}h</td>
                  <td style={{...tdS,borderTop:topBorder}}/>
                </tr>
              )
              return(
              <tr key={i} style={{background:bg}}>
                <td style={{...tdS,textAlign:'left',paddingLeft:18,maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}
                  title={cleanName(r.task)}><span style={{color:'#9ca3af'}}>└ </span>{childLabel(r.task,r.parent)}</td>
                <td style={tdS}><span style={{background:'#fff',color:'#1a56db',border:'1px solid #bfdbfe',padding:'2px 8px',borderRadius:12,fontWeight:700}}>{r.hours}h</span></td>
                <td style={tdS}>
                  <div style={{display:'flex',alignItems:'center',gap:5}}>
                    <div style={{flex:1,height:7,background:'#e5e7eb',borderRadius:4}}>
                      <div style={{width:r.ratio+'%',height:'100%',background:COLORS[r.wi%COLORS.length],borderRadius:4}}/>
                    </div>
                    <span style={{fontSize:11,minWidth:34,fontWeight:600}}>{r.ratio}%</span>
                  </div>
                </td>
              </tr>
            )})}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── 프로젝트 기간 비중 분석 ──────────────────────────────
function ProjectAnalysis({rows,allHistory,jiraTree}){
  const [sort,setSort]=useState('hours-desc')
  if(!rows.length)return null
  const periodAgg=aggByWork(rows),totalAgg=aggByWork(allHistory)
  const firstDates=firstDateByTask(rows)
  // 업무별 참여자. 한 사람이 여러 시간 기록해도 1명으로 세도록 Set 을 쓴다.
  // 같은 업무를 여러 명이 함께 한 경우도 그대로 모인다.
  const membersByTask={}
  rows.forEach(r=>{
    const t=normText(r.work_text)
    if(!membersByTask[t])membersByTask[t]=new Set()
    membersByTask[t].add(r.worker_name)
  })
  const data=Object.entries(periodAgg).sort((a,b)=>b[1]-a[1]).slice(0,10)
    .map(([name,ph])=>{
      const th=totalAgg[name]||ph,nm=cleanName(name)
      const members=[...(membersByTask[name]||[])].sort()
      // 참여자별 내역. 기간=이 기간에 그 사람이 쓴 시간,
      // 누적=그 사람이 이 업무에 쓴 전체 시간, 몫=이 프로젝트에서 차지한 비율
      const 멤버내역=members.map(m=>{
        const mp=rows.filter(r=>normText(r.work_text)===name&&r.worker_name===m).length
        const mt=allHistory.filter(r=>normText(r.work_text)===name&&r.worker_name===m).length||mp
        return{이름:m,기간:mp,누적:mt,몫:Math.round(mp/ph*100),기간비중:Math.round(mp/mt*100)}
      }).sort((a,b)=>b.기간-a.기간)
      return{name:nm.length>16?nm.slice(0,16)+'…':nm,fullName:nm,rawName:name,
        task:name,hours:ph,firstDate:firstDates[name]||'',
        기간:ph,누적:th,
        기간비중:Math.round(ph/th*100),인원:members.length,참여자:members,멤버내역}
    })
  // 표에 뿌릴 줄 목록. 대업무 한 줄로 묶고, 그 아래로 소업무를 늘어놓는다.
  // 소업무마다 참여자가 2명 이상이면 합계 1줄 + 개인별 줄을 잇는다.
  // 1명이면 개인 줄이 합계와 같아지므로 합계 1줄만 둔다.
  const tableRows=[]
  let pi=0
  groupTasksByParent(data,jiraTree,sort).forEach(g=>{
    tableRows.push({kind:'group',g})
    g.children.forEach(d=>{
      const 개인줄=d.멤버내역.length>1?d.멤버내역:[]
      tableRows.push({kind:'total',d,pi,span:1+개인줄.length,parent:g.parent})
      개인줄.forEach(m=>tableRows.push({kind:'member',d,pi,m}))
      pi++
    })
  })
  return(
    <div style={{display:'flex',flexDirection:'column',gap:16,marginBottom:16}}>
      <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,padding:18,minWidth:260,maxWidth:'100%',boxSizing:'border-box'}}>
        <div style={{fontSize:14,fontWeight:700,marginBottom:14}}>프로젝트 기간/누적 비교 · 단위: 시간(h), 기간 비중(%)</div>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={data}>
            <XAxis dataKey="name" tick={{fontSize:10}} interval={0} angle={-20} textAnchor="end" height={55}/>
            <YAxis yAxisId="left" orientation="left" unit="h" tick={{fontSize:11}}/>
            <YAxis yAxisId="right" orientation="right" unit="%" domain={[0,100]} tick={{fontSize:11}}/>
            <Tooltip formatter={(v,n)=>n==='기간 비중'?`${v??0}%`:`${v??0}h`}/><Legend wrapperStyle={{fontSize:11}}/>
            <Bar yAxisId="left" dataKey="기간" name="이 기간" fill="#3b82f6" barSize={18} radius={[4,4,0,0]}>
              <LabelList dataKey="기간" position="top" fontSize={9} fill="#374151" formatter={numLabel}/>
            </Bar>
            <Bar yAxisId="left" dataKey="누적" name="전체 누적" fill="#e5e7eb" barSize={18} radius={[4,4,0,0]}/>
            <Line yAxisId="right" type="monotone" dataKey="기간비중" name="기간 비중" stroke="#f59e0b" strokeWidth={2} dot={{r:4}}>
              <LabelList dataKey="기간비중" position="top" fontSize={9} fill="#b45309" formatter={(v)=>v?`${v}%`:''}/>
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
        <div style={{fontSize:11,color:'#6b7280',marginTop:8,lineHeight:1.6,background:'#f9fafb',border:'1px solid #e5e7eb',borderRadius:8,padding:'8px 12px'}}>
          💡 <b>읽는 법</b> — 파란 막대는 <b>이 기간에 쓴 시간</b>, 회색 막대는 그 업무의 <b>전체 누적 시간</b>입니다.
          주황 선은 <b>기간 비중</b> = 전체 누적 중 이 기간이 차지하는 몫(이 기간 ÷ 전체 누적).
          <b>100%에 가까우면</b> 이 기간에 시작해 이 기간에 거의 다 한 업무이고,
          <b>낮으면</b> 여러 기간에 걸쳐 길게 진행 중인 업무입니다.
        </div>
      </div>
      <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,padding:18,minWidth:260,maxWidth:'100%',boxSizing:'border-box',overflowX:'auto'}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14,flexWrap:'wrap'}}>
          <div style={{fontSize:14,fontWeight:700}}>프로젝트 기간 비중 상세</div>
          <SortPicker value={sort} onChange={setSort}/>
        </div>
        {/* 폭은 고정 px 이 아니라 비율로 나눈다.
            프로젝트에 px 를 몰아주면 화면이 넓을 때 가운데가 텅 비고
            나머지 칸이 오른쪽에 몰려 답답해진다. */}
        <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}>
          <colgroup>
            <col style={{width:'34%'}}/>
            <col style={{width:'24%'}}/>
            <col style={{width:'10%'}}/>
            <col style={{width:'10%'}}/>
            <col style={{width:'22%'}}/>
          </colgroup>
          <thead><tr>
            <th style={{...thS,textAlign:'left'}}>프로젝트</th>
            <th style={thS}>작업 인원</th>
            <th style={thS}>기간(h)</th><th style={thS}>누적(h)</th>
            <th style={thS}>기간 비중</th>
          </tr></thead>
          <tbody>
            {tableRows.map((row,i)=>{
              const {kind,d,pi,m}=row
              // 대업무 줄 — 칸을 나누지 않고 한 줄을 통째로 쓴다.
              // 아래 소업무 표의 rowSpan 구조를 건드리지 않는 가장 단순한 방법이다.
              if(kind==='group')return(
                <tr key={i} style={{background:'#eef2f7'}}>
                  <td colSpan={5} style={{...tdS,textAlign:'left',fontWeight:700,
                    borderTop:i>0?'2px solid #cbd5e1':undefined,
                    color:row.g.parent===NO_PARENT?'#6b7280':'#111827'}}>
                    {cleanName(row.g.parent)}
                    {row.g.children.length>1&&<span style={{fontWeight:600,color:'#6b7280'}}> · {row.g.children.length}건</span>}
                    <span style={{float:'right',color:'#374151'}}>{row.g.hours}h</span>
                  </td>
                </tr>
              )
              // 배경은 프로젝트 단위로 번갈아 칠한다 — 한 프로젝트의 여러 줄이 한 덩어리로 보이게
              const bg=pi%2===0?'#fff':'#f5f8fc'
              const topBorder=undefined
              const 시간=kind==='total'?d.기간:m.기간
              const 누적=kind==='total'?d.누적:m.누적
              const 비중=kind==='total'?d.기간비중:m.기간비중
              return(
              <tr key={i} style={{background:bg}}>
                {/* 프로젝트명은 rowSpan 으로 묶어 세로 가운데 정렬 (참여자 여러 명이면 그 줄 수만큼) */}
                {kind==='total'&&(
                  <td rowSpan={row.span} style={{...tdS,textAlign:'left',whiteSpace:'normal',paddingLeft:18,
                    wordBreak:'break-word',lineHeight:1.45,verticalAlign:'middle',borderTop:topBorder}}>
                    <span style={{color:'#9ca3af'}}>└ </span>{childLabel(d.rawName,row.parent)}</td>
                )}
                <td style={{...tdS,borderTop:topBorder}}>
                  {kind==='total'?(
                    <div style={{display:'flex',alignItems:'center',gap:7,justifyContent:'center'}} title={d.참여자.join(', ')}>
                      <span style={{background:'#f0fdf4',color:'#0d7a4e',border:'1px solid #bbf7d0',
                        padding:'2px 8px',borderRadius:12,fontWeight:700,fontSize:11,whiteSpace:'nowrap',flexShrink:0}}>{d.인원}명</span>
                      <span style={{fontSize:11,color:'#6b7280',fontWeight:700,whiteSpace:'nowrap'}}>전체</span>
                    </div>
                  ):(
                    // 개인 줄 — 이름과 함께 이 프로젝트에서 그 사람이 차지한 몫(%)
                    <div style={{display:'flex',alignItems:'center',gap:6,justifyContent:'center'}}>
                      <span style={{fontSize:11,color:'#9ca3af',flexShrink:0}}>↳</span>
                      <span style={{fontSize:12,color:'#374151',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.이름}</span>
                      <span title="이 프로젝트에서 이 사람이 차지한 몫" style={{background:'#eff6ff',color:'#1a56db',
                        padding:'1px 6px',borderRadius:10,fontSize:10,fontWeight:700,whiteSpace:'nowrap',flexShrink:0}}>{m.몫}%</span>
                    </div>
                  )}
                </td>
                <td style={{...tdS,whiteSpace:'nowrap',borderTop:topBorder}}>
                  <span style={{color:'#1a56db',fontWeight:kind==='total'?700:500,fontSize:12}}>{시간}h</span>
                </td>
                <td style={{...tdS,whiteSpace:'nowrap',borderTop:topBorder}}>
                  <span style={{color:'#9ca3af',fontSize:12}}>{누적}h</span>
                </td>
                <td style={{...tdS,borderTop:topBorder}}>
                  <div style={{display:'flex',alignItems:'center',gap:5}}>
                    <div style={{flex:1,height:kind==='total'?7:5,background:'#e5e7eb',borderRadius:4,minWidth:40}}>
                      <div style={{width:비중+'%',height:'100%',background:kind==='total'?'#f59e0b':'#fcd34d',borderRadius:4}}/>
                    </div>
                    <span style={{fontSize:11,minWidth:30,fontWeight:kind==='total'?700:500,color:'#b45309',whiteSpace:'nowrap'}}>{비중}%</span>
                  </div>
                </td>
              </tr>
            )})}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── 요일×시간대 히트맵 (프로토타입) ──────────────────────
function WorkHeatmap({rows}){
  if(!rows.length)return null
  const dayNames=['월','화','수','목','금','토','일']
  const grid=Array.from({length:7},()=>Array(24).fill(0))
  rows.forEach(r=>{const di=(new Date(r.work_date).getDay()+6)%7;grid[di][r.work_hour]++})
  const max=Math.max(1,...grid.flat())
  const heatColor=v=>{
    if(!v)return '#f3f4f6'
    const t=v/max,ch=(a,b)=>Math.round(a+(b-a)*t)
    return `rgb(${ch(219,26)},${ch(234,86)},${ch(254,219)})`   // #dbeafe → #1a56db
  }
  const hours=Array.from({length:24},(_,h)=>h)
  return(
    <Card title="시간대 패턴 (요일 × 시간대) · 색이 진할수록 시간(h) 많음">
      <div style={{overflowX:'auto'}}>
        <table style={{borderCollapse:'collapse',fontSize:10}}>
          <thead><tr>
            <th style={{width:28}}/>
            {hours.map(h=><th key={h} style={{minWidth:22,padding:'0 0 4px',color:'#9ca3af',fontWeight:600,textAlign:'center'}}>{h}</th>)}
          </tr></thead>
          <tbody>
            {dayNames.map((dn,di)=>(
              <tr key={dn}>
                <td style={{color:'#6b7280',fontWeight:700,padding:'0 8px 0 2px',textAlign:'right',whiteSpace:'nowrap'}}>{dn}</td>
                {grid[di].map((v,h)=>(
                  <td key={h} title={`${dn} ${String(h).padStart(2,'0')}:00 — ${v}h`}
                    style={{width:22,height:22,background:heatColor(v),border:'2px solid #fff',textAlign:'center',
                      color:(v&&v/max>0.55)?'#fff':'#9ca3af',fontWeight:600}}>{v||''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{display:'flex',alignItems:'center',gap:6,marginTop:10,fontSize:10,color:'#6b7280'}}>
        <span>적음</span>
        {[0,0.25,0.5,0.75,1].map((t,i)=>{const ch=(a,b)=>Math.round(a+(b-a)*t);return <div key={i} style={{width:20,height:11,background:`rgb(${ch(219,26)},${ch(234,86)},${ch(254,219)})`}}/>})}
        <span>많음</span>
        <span style={{marginLeft:10}}>최다 {max}h/칸</span>
      </div>
    </Card>
  )
}

// ── 업무 계층 트리맵 (프로토타입) ──────────────────────
function buildTreemapData(rows,jiraTree){
  const parentOf=t=>{if(jiraTree&&jiraTree[t]!==undefined)return t;if(jiraTree){for(const[p,subs]of Object.entries(jiraTree)){if(subs.includes(t))return p}}return '기타'}
  const tmMap={}
  rows.forEach(r=>{const p=cleanName(normText(parentOf(r.work_text))),c=cleanName(normText(r.work_text));if(!tmMap[p])tmMap[p]={};tmMap[p][c]=(tmMap[p][c]||0)+1})
  return Object.entries(tmMap).map(([p,kids])=>({name:p,children:Object.entries(kids).map(([c,v])=>({name:c,size:v}))}))
}
function TreemapCell(props){
  const {x,y,width,height,depth,name,index}=props
  if(width<=0||height<=0)return null
  const val=props.size??props.value
  const fill=depth===1?COLORS[index%COLORS.length]:'rgba(255,255,255,0)'
  return(
    <g>
      <title>{`${name}${val?` ${val}h`:''}`}</title>
      <rect x={x} y={y} width={width} height={height} style={{fill,stroke:'#fff',strokeWidth:depth===1?3:1,strokeOpacity:depth===1?1:0.7}}/>
      {depth===1&&width>54&&height>22&&<text x={x+6} y={y+16} fill="#fff" fontSize={11} fontWeight={700}>{name}</text>}
      {depth===2&&width>50&&height>26&&<text x={x+width/2} y={y+height/2} textAnchor="middle" fill="#111827" fontSize={9} dominantBaseline="central">{val}h</text>}
    </g>
  )
}
function TreemapAnalysis({data}){
  if(!data||!data.length)return null
  return(
    <Card title="업무 계층 비중 (트리맵) · 면적=시간(h), 상위업무→하위업무">
      <ResponsiveContainer width="100%" height={340}>
        <Treemap data={data} dataKey="size" stroke="#fff" isAnimationActive={false} content={<TreemapCell/>}/>
      </ResponsiveContainer>
    </Card>
  )
}

// ── 업무 편중 파레토 (프로토타입) ──────────────────────
function ParetoAnalysis({rows}){
  if(!rows.length)return null
  const agg=Object.entries(aggByWork(rows)).sort((a,b)=>b[1]-a[1])
  const total=agg.reduce((s,[,v])=>s+v,0)||1
  let cum=0
  // X축은 좁아 이름을 줄이지만, full 에 전체 제목을 남겨 툴팁에서 쓴다
  const data=agg.slice(0,12).map(([name,v])=>{cum+=v;const nm=cleanName(name)
    return{name:nm.length>14?nm.slice(0,14)+'…':nm,full:nm,시간:v,누적:Math.round(cum/total*100)}})
  const 목표도달=data.findIndex(d=>d.누적>=80)+1   // 80% 에 닿기까지 필요한 업무 개수
  return(
    <Card title="업무 편중 (파레토) · 막대=시간(h), 선=누적 비중(%)">
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data} margin={{top:16,right:24,left:0,bottom:70}}>
          <XAxis dataKey="name" tick={{fontSize:10}} interval={0} angle={-30} textAnchor="end" height={80}/>
          <YAxis yAxisId="left" unit="h" tick={{fontSize:11}}/>
          <YAxis yAxisId="right" orientation="right" unit="%" domain={[0,100]} tick={{fontSize:11}}/>
          {/* 제목은 축약된 X축 라벨 대신 전체 업무명을 보여준다 */}
          <Tooltip formatter={(v,n)=>n==='누적'?`${v}%`:`${v}h`}
            labelFormatter={(l,p)=>p&&p[0]&&p[0].payload?p[0].payload.full:l}
            contentStyle={{maxWidth:460,whiteSpace:'normal'}}/><Legend wrapperStyle={{fontSize:11}}/>
          <ReferenceLine yAxisId="right" y={80} stroke="#ef4444" strokeDasharray="4 3" label={{value:'80%',fontSize:10,fill:'#ef4444',position:'insideTopRight'}}/>
          <Bar yAxisId="left" dataKey="시간" fill="#3b82f6" radius={[4,4,0,0]}>
            <LabelList dataKey="시간" position="top" fontSize={9} fill="#374151" formatter={numLabel}/>
          </Bar>
          <Line yAxisId="right" type="monotone" dataKey="누적" stroke="#f59e0b" strokeWidth={2} dot={{r:3}}>
            <LabelList dataKey="누적" position="top" fontSize={9} fill="#b45309" formatter={(v)=>`${v}%`}/>
          </Line>
        </ComposedChart>
      </ResponsiveContainer>
      <div style={{fontSize:11,color:'#6b7280',marginTop:8,lineHeight:1.6,background:'#f9fafb',border:'1px solid #e5e7eb',borderRadius:8,padding:'8px 12px'}}>
        💡 <b>읽는 법</b> — 업무를 <b>시간이 많은 순서로</b> 왼쪽부터 세우고(막대),
        왼쪽부터 더해 간 비중을 선으로 잇습니다. <b>빨간 80% 선과 만나는 지점</b>이 핵심입니다.
        {목표도달>0&&<> 지금은 <b>상위 {목표도달}개 업무가 전체 시간의 80%</b>를 차지합니다.</>}
        <b> 적은 개수에서 80%에 닿으면</b> 소수 프로젝트에 집중된 상태이고,
        <b>많은 개수가 필요하면</b> 여러 일에 나뉘어 있다는 뜻입니다.
      </div>
    </Card>
  )
}

// ── 업무 구성 비율 추이 100% 누적 (프로토타입) ──────────────────────
function buildTaskMix(rows,keyOf){
  const topTasks=Object.entries(aggByWork(rows)).sort((a,b)=>b[1]-a[1]).slice(0,6).map(e=>e[0])
  const set=new Set(topTasks),buckets={}
  rows.forEach(r=>{const t=normText(r.work_text);if(!set.has(t))return;const {k,label}=keyOf(r);if(!buckets[k])buckets[k]={label,o:{}};buckets[k].o[t]=(buckets[k].o[t]||0)+1})
  const data=Object.keys(buckets).sort().map(k=>{const o={name:buckets[k].label};topTasks.forEach(t=>{o[t]=buckets[k].o[t]||0});return o})
  return {topTasks,data}
}
function MixTrend({data,tasks}){
  if(!data||!data.length)return null
  return(
    <Card title="업무 구성 비율 추이 (100% 누적) · 기간별 업무유형 비중(%)">
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={data} stackOffset="expand" margin={{top:10,right:12,left:0,bottom:0}}>
          <XAxis dataKey="name" tick={{fontSize:11}}/>
          <YAxis tickFormatter={v=>Math.round(v*100)+'%'} tick={{fontSize:11}}/>
          <Tooltip content={<NonZeroTooltip percent/>}/><Legend wrapperStyle={{fontSize:10}}/>
          {tasks.map((t,i)=>{const nm=cleanName(t);return <Area key={t} type="monotone" dataKey={t} name={nm.length>14?nm.slice(0,14)+'…':nm} stackId="m" stroke={COLORS[i%COLORS.length]} fill={COLORS[i%COLORS.length]} fillOpacity={0.6}/>})}
        </AreaChart>
      </ResponsiveContainer>
      <div style={{fontSize:11,color:'#6b7280',marginTop:8,lineHeight:1.6,background:'#f9fafb',border:'1px solid #e5e7eb',borderRadius:8,padding:'8px 12px'}}>
        💡 <b>읽는 법</b> — 세로축은 항상 100%입니다. 각 기간(가로)에서 업무유형이 차지하는 <b>비중(%)</b>을 보여줍니다.
        색 띠가 가로로 가며 <b>두꺼워지면 그 업무 비중↑</b>, 얇아지면 비중↓. 어느 업무가 늘고 줄었는지 <b>구성 변화</b>를 봅니다.
        (절대 시간(양)은 위 ‘분포’ 차트로 확인 — 이 차트는 <b>비율 전용</b>이라 일이 많았던 기간도 높이는 100%로 동일합니다.)
      </div>
    </Card>
  )
}

// ── 직원별 업무 분포 레이더 ──────────────────────
function RadarAnalysis({rows,workers}){
  if(!rows.length)return null
  const wNames=workers.map(w=>w.name).filter(n=>rows.some(r=>r.worker_name===n))
  const topTasks=Object.entries(aggByWork(rows)).sort((a,b)=>b[1]-a[1]).slice(0,6).map(e=>e[0])
  if(!topTasks.length||!wNames.length)return null
  const data=topTasks.map(t=>{
    const nm=cleanName(t),o={task:nm.length>10?nm.slice(0,10)+'…':nm}
    wNames.forEach(w=>{o[w]=rows.filter(r=>r.worker_name===w&&normText(r.work_text)===t).length})
    return o
  })
  return(
    <Card title="직원별 업무 분포 (레이더) · 상위 6개 업무유형별 시간(h)">
      <ResponsiveContainer width="100%" height={380}>
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid/>
          <PolarAngleAxis dataKey="task" tick={{fontSize:10}}/>
          <PolarRadiusAxis tick={{fontSize:9}}/>
          <Tooltip content={<NonZeroTooltip/>}/><Legend wrapperStyle={{fontSize:11}}/>
          {wNames.map((w,i)=><Radar key={w} name={w} dataKey={w} stroke={COLORS[i%COLORS.length]} fill={COLORS[i%COLORS.length]} fillOpacity={0.15}/>)}
        </RadarChart>
      </ResponsiveContainer>
      <div style={{fontSize:11,color:'#6b7280',marginTop:8,lineHeight:1.6,background:'#f9fafb',border:'1px solid #e5e7eb',borderRadius:8,padding:'8px 12px'}}>
        💡 <b>읽는 법</b> — 꼭지점 6개는 <b>이 기간에 시간이 가장 많이 들어간 업무유형</b>이고,
        중심에서 멀수록 그 업무에 <b>많은 시간</b>을 썼다는 뜻입니다. 사람마다 색이 다른 도형으로 겹쳐 그립니다.
        <b>한쪽으로 뾰족하면</b> 특정 업무에 집중한 사람, <b>고르게 퍼지면</b> 여러 업무를 두루 맡은 사람입니다.
        (능력 평가가 아니라 <b>시간을 어디에 썼는지</b>를 보는 그림입니다. 맡은 일이 다르므로 모양이 다른 것이 정상입니다.)
      </div>
    </Card>
  )
}

// ── Jira 토큰 만료 임박 배너 ──────────────────────
// 토큰이 만료되면 동기화가 전부 멈추므로, 만료 30일 전부터 화면 상단에 알린다.
function TokenExpiryBanner({status}){
  if(!status.configured||status.level==='ok')return null
  const expired=status.level==='expired'
  const c=expired
    ?{bg:'#fef2f2',border:'#fca5a5',text:'#991b1b'}
    :{bg:'#fffbeb',border:'#fcd34d',text:'#92400e'}
  return(
    <div style={{background:c.bg,borderBottom:`1px solid ${c.border}`,color:c.text,
      padding:'10px 20px',fontSize:13,display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
      <strong>{expired?'⛔ Jira 토큰이 만료되었습니다':`⚠️ Jira 토큰 만료 ${status.daysLeft}일 전`}</strong>
      <span style={{opacity:.85}}>
        (만료일 {status.expiresAt}) — {expired?'동기화가 동작하지 않습니다. ':''}
        Atlassian 계정 설정에서 새 토큰을 발급해 서버 환경변수를 교체해 주세요.
      </span>
    </div>
  )
}

export default function App(){
  const [tab,setTab]=useState('today')
  const [workers,setWorkers]=useState([])
  const [history,setHistory]=useState([])
  const [absences,setAbsences]=useState([])   // 장기출장·휴직·파견 기간
  const [jiraTree,setJiraTree]=useState({})
  const [jiraDone,setJiraDone]=useState(()=>new Set())   // 종료된 업무 (고르는 목록에서만 감춘다)
  const [grid,setGrid]=useState({})
  const [parentSel,setParentSel]=useState({})
  const [selWorkerId,setSelWorkerId]=useState(null)   // 이름이 아니라 id 로 선택 대상을 잡는다
  const [viewDate,setViewDate]=useState(today())
  const [viewMonth,setViewMonth]=useState(toMonth(today()))
  const [viewYear,setViewYear]=useState(toYear(today()))
  const [loading,setLoading]=useState(true)
  const [toast,setToast]=useState('')
  const [tokenStatus,setTokenStatus]=useState({configured:false})
  const toastTimerRef=useRef(null)
  // 스케줄 — 탭을 처음 열 때만 불러온다(달력은 기간이 바뀔 때마다 다시 조회)
  const [places,setPlaces]=useState([])
  const [vehicles,setVehicles]=useState([])
  const [plans,setPlans]=useState([])
  const [actuals,setActuals]=useState([])
  const [actualDialog,setActualDialog]=useState(null)   // {plan} — 실적 입력 창
  const [schedLoading,setSchedLoading]=useState(false)
  const [planDialog,setPlanDialog]=useState(null)   // {editing} | {date} | null
  const [schedFocus,setSchedFocus]=useState('')     // 등록 직후 달력을 옮길 날짜
  const [clipboard,setClipboard]=useState(null)     // 복사한 계획 (달력에서 붙여넣기)
  // 정산 화면 전용 로그인. 계정·세션을 KPI 추적 시스템과 공유하므로
  // KPI 에서 이미 로그인했다면 이 화면에서도 그대로 통한다.
  const [me,setMe]=useState(null)
  const [loginOpen,setLoginOpen]=useState(false)

  // 오늘 기준 재직 중인 직원만 (입사일 이후 + 퇴사 전)
  const td=today()
  const activeWorkers=workers.filter(w=>
    w.active &&
    (!w.hired_at || w.hired_at<=td) &&
    (!w.resigned_at || w.resigned_at>=td)
  )
  // 업무 입력표에 세울 사람 — 「집계 제외」 대상은 뺀다. 나머지 화면(스케줄·설정)은
  // 그대로 activeWorkers 를 쓴다. 대표이사도 일정·차량은 쓰고, 설정에서는 보여야 고칠 수 있다.
  const inputWorkers=activeWorkers.filter(w=>!isExcludedOn(absences,w.id,td))
  const jiraParents=Object.keys(jiraTree)
  const dupNames=duplicatedNames(workers)
  const selWorker=workers.find(w=>w.id===selWorkerId)||null
  // 분석 탭은 workers 의 이름으로 기록을 찾는다. history 의 worker_name 이
  // 표시 이름으로 바뀌어 있으므로 workers 쪽도 같은 이름으로 맞춰 넘긴다.
  const workersLabeled=workers.map(w=>({...w,name:workerLabel(w,dupNames),name_raw:w.name}))
  // 분석 탭에는 부재 기간 기록을 뺀 목록을 넘긴다. 입력 탭은 원본을 그대로 써야
  // 사용자가 적어 둔 값이 화면에서 사라지지 않는다.
  const historyForStats=excludeAbsentRows(history,absences)

  function showToast(msg, duration=2500){
    if(toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast(msg)
    if(duration>0) toastTimerRef.current=setTimeout(()=>setToast(''), duration)
  }

  useEffect(()=>{
    Promise.all([getWorkers(),getHistory(),getJiraTree(),getAbsences().catch(()=>[])])
      .then(([w,h,j,ab])=>{
        setWorkers(w);setHistory(withDisplayNames(h,w))
        setJiraTree(j.tree);setJiraDone(j.done);setAbsences(ab||[])
        const tr=h.filter(r=>r.work_date===today())
        const g={}; tr.forEach(r=>{g[cellKey(r.work_hour,r.worker_id)]=r.work_text})
        setGrid(g); setParentSel(buildParentSel(tr,j.tree))
      }).finally(()=>setLoading(false))
    // 토큰 만료 안내는 본 데이터 로딩을 막지 않도록 따로 조회한다
    getJiraTokenStatus().then(setTokenStatus)
  },[])

  // 업무 목록을 다시 읽는다. 트리와 «완료 목록» 은 늘 같은 시점의 것이어야 하므로
  // 둘을 따로 갱신하지 않고 여기 한 곳에서만 세팅한다.
  async function reloadJira(){
    const j=await getJiraTree()
    setJiraTree(j.tree); setJiraDone(j.done)
    return j
  }

  // 고르고 있던 사람이 「집계 제외」로 등록되면 선택을 비운다.
  // 안 비우면 입력표에 없는 열을 가리킨 채로 저장 버튼이 살아 있다.
  useEffect(()=>{
    if(selWorkerId&&isExcludedOn(absences,selWorkerId,td)) setSelWorkerId(null)
  },[absences,selWorkerId,td])

  async function handleSave(ds=today()){
    if(!selWorker){showToast('이름을 먼저 선택하세요');return}
    const label=workerLabel(selWorker,dupNames)
    const rows=WORK_HOURS.filter(h=>grid[cellKey(h,selWorker.id)])
      .map(h=>({work_date:ds,work_hour:h,worker_id:selWorker.id,
                worker_name:selWorker.name,work_text:grid[cellKey(h,selWorker.id)]}))
    try{
      await saveWorkerHistory(selWorker.id,selWorker.name,rows,ds)
      // 화면 목록에서도 방금 저장한 사람의 그 날짜 기록만 갈아 끼운다 (id 로 특정)
      setHistory([
        ...history.filter(r=>!(r.work_date===ds&&r.worker_id===selWorker.id)),
        ...rows.map(r=>({...r,worker_name:label,worker_name_raw:selWorker.name}))
      ])
      showToast(`${label} 저장 완료 (${ds}, ${rows.length}건)`)
    }catch(e){showToast('저장 실패: '+e.message)}
  }

  // 스케줄 데이터 — 넉넉히 «작년~내년» 을 한 번에 받아 두고 화면에서 걸러 쓴다.
  // 달력은 뷰를 자주 옮기므로 이동마다 조회하면 깜빡임이 생긴다. 건수가 적어 부담이 없다.
  async function loadSchedule(){
    setSchedLoading(true)
    try{
      const y=toYear(today())
      const [pl,vh,pn,ac]=await Promise.all([
        getPlaces(), getVehicles(), getPlans(`${y-1}-01-01`,`${y+1}-12-31`),
        getActuals(`${y-1}-01-01`,`${y+1}-12-31`)
      ])
      setPlaces(pl); setVehicles(vh); setPlans(pn); setActuals(ac)
    }catch(e){ showToast('스케줄 조회 실패: '+e.message) }
    finally{ setSchedLoading(false) }
  }

  // 스케줄 탭과 설정 탭(차량 관리)이 같은 데이터를 쓴다
  useEffect(()=>{
    if((tab==='schedule'||tab==='settings')&&places.length===0&&vehicles.length===0) loadSchedule()
    // 정산 화면에 들어가기 전에 «조용히» 로그인 상태를 확인한다.
    // 로그인 안 했으면 401 이 아니라 {logged_in:false} 가 오므로 화면이 깜빡이지 않는다.
    if(tab==='schedule'&&me===null){
      whoAmI().then(r=>{ if(r?.logged_in) setMe(r) }).catch(()=>{})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[tab])

  // 복사한 계획을 고른 칸들에 붙인다.
  // 주 뷰에서 고른 칸은 사람이 함께 정해지므로 그 사람에게 붙고,
  // 월·일 뷰에서 고른 칸은 원본과 같은 사람에게 붙는다.
  async function handlePaste(src,targets){
    if(!src||targets.length===0)return
    const conflicts=[]
    let done=0
    try{
      for(const t of targets){
        const body={
          worker_id:t.workerId||src.worker_id,
          plan_date:t.date, slot:src.slot, use_type:src.use_type,
          place_id:src.place_id??null, place_text:src.place_text??null, purpose:src.purpose??null,
          transport:src.transport, vehicle_id:src.vehicle_id??null,
          est_distance_km:src.est_distance_km??null, est_travel_min:src.est_travel_min??null,
          round_trip:src.round_trip,
        }
        try{ await addPlan(body); done++ }
        catch(e){
          if(e.status===409&&e.conflicts?.length){
            conflicts.push({...body,_names:e.conflicts.map(c=>c.worker_name)})
          }else throw e
        }
      }
      // 겹친 칸은 모아서 한 번만 묻는다
      if(conflicts.length>0){
        const lines=conflicts.map(c=>`· ${c.plan_date} — ${c._names.join('·')}`).join('\n')
        if(confirm(`아래 날짜는 그 차량이 이미 예약돼 있습니다.\n\n${lines}\n\n그래도 붙일까요?`)){
          for(const c of conflicts){ await addPlan({...c,force:true}); done++ }
        }
      }
      showToast(done>0?`${done}곳에 붙였습니다`:'붙인 계획이 없습니다')
      if(done>0){ await loadSchedule(); setSchedFocus(targets[0].date) }
    }catch(e){ showToast('붙이기 실패: '+e.message) }
    finally{ setClipboard(null) }
  }

  async function handleLoadDate(date){
    try{
      showToast('조회 중...')
      const rows=await getHistoryByDate(date)
      const g={}; rows.forEach(r=>{g[cellKey(r.work_hour,r.worker_id)]=r.work_text})
      setGrid(g); setParentSel(buildParentSel(rows,jiraTree))
      showToast(date+' 조회 완료')
    }catch(e){showToast('조회 실패')}
  }

  return(
    <div style={{minHeight:'100vh',background:'#f5f5f0'}}>
      {loading&&(
        <div style={{position:'fixed',inset:0,background:'#fff',display:'flex',alignItems:'center',justifyContent:'center',zIndex:9999,flexDirection:'column',gap:16}}>
          <div style={{width:36,height:36,border:'3px solid #e5e7eb',borderTopColor:'#1a56db',borderRadius:'50%',animation:'spin .8s linear infinite'}}/>
          <p style={{color:'#6b7280'}}>데이터를 불러오는 중...</p>
        </div>
      )}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <header style={{background:'#fff',borderBottom:'1px solid #e5e7eb',padding:'12px 20px',display:'flex',alignItems:'center',justifyContent:'space-between',position:'sticky',top:0,zIndex:100}}>
        <div>
          <div style={{fontSize:16,fontWeight:700}}>바이트론 이앤에스 업무 현황</div>
          <div style={{fontSize:12,color:'#6b7280'}}>{new Date().toLocaleDateString('ko-KR')} ({dayName(today())}요일)</div>
        </div>
        <div style={{display:'flex',gap:16,fontSize:12,color:'#6b7280'}}>
          <span>재직 <strong style={{color:'#1a56db'}}>{activeWorkers.length}</strong>명</span>
          <span>Jira <strong style={{color:'#1a56db'}}>{jiraParents.length}</strong>건</span>
          <span>누적 <strong style={{color:'#1a56db'}}>{history.length.toLocaleString()}</strong>건</span>
        </div>
      </header>
      <TokenExpiryBanner status={tokenStatus}/>
      <nav style={{background:'#fff',borderBottom:'1px solid #e5e7eb',display:'flex',padding:'0 20px',overflowX:'auto'}}>
        {TABS.map(t=>(
          <button key={t} onClick={()=>setTab(t)}
            style={{padding:'10px 16px',fontSize:13,fontWeight:tab===t?700:500,
              color:tab===t?'#1a56db':'#6b7280',background:'none',border:'none',
              borderBottom:tab===t?'2px solid #1a56db':'2px solid transparent',
              cursor:'pointer',whiteSpace:'nowrap'}}>{TAB_LABELS[t]}</button>
        ))}
      </nav>
      <main style={{padding:'16px 20px'}}>
        {tab==='today'   &&<TabToday   workers={inputWorkers} dupNames={dupNames} grid={grid} setGrid={setGrid}
          jiraTree={jiraTree} jiraDone={jiraDone} selWorkerId={selWorkerId} setSelWorkerId={setSelWorkerId}
          onSave={handleSave} onLoadDate={handleLoadDate} parentSel={parentSel} setParentSel={setParentSel}/>}
        {tab==='daily'   &&<TabDaily   history={historyForStats} workers={workersLabeled} absences={absences} viewDate={viewDate} setViewDate={setViewDate} jiraTree={jiraTree}/>}
        {tab==='weekly'  &&<TabWeekly  history={historyForStats} workers={workersLabeled} absences={absences} viewDate={viewDate} setViewDate={setViewDate} jiraTree={jiraTree}/>}
        {tab==='monthly' &&<TabMonthly history={historyForStats} workers={workersLabeled} absences={absences} viewMonth={viewMonth} setViewMonth={setViewMonth} jiraTree={jiraTree}/>}
        {tab==='yearly'  &&<TabYearly  history={historyForStats} workers={workersLabeled} absences={absences} viewYear={viewYear} setViewYear={setViewYear} jiraTree={jiraTree}/>}
        {tab==='schedule'&&<TabSchedule workers={activeWorkers.map(w=>({...w,name:workerLabel(w,dupNames)}))}
          places={places} vehicles={vehicles} plans={plans} loading={schedLoading}
          onReload={loadSchedule} showToast={showToast} focusDate={schedFocus}
          onOpenNew={()=>setPlanDialog({editing:null,date:today()})}
          onOpenPlan={p=>setPlanDialog({editing:p})}
          onOpenCell={(d)=>setPlanDialog({editing:null,...d})}
          onOpenActual={p=>setActualDialog({plan:p})}
          actuals={actuals}
          me={me} onNeedLogin={()=>setLoginOpen(true)}
          onLogout={async()=>{ try{ await logout() }catch{ /* 이미 만료됐을 수 있다 */ }
            setMe(null); showToast('로그아웃했습니다') }}
          clipboard={clipboard} onPaste={handlePaste} onCancelCopy={()=>setClipboard(null)}/>}
        {tab==='settings'&&<TabSettings workers={workers} setWorkers={setWorkers} dupNames={dupNames}
          jiraTree={jiraTree} jiraDone={jiraDone} reloadJira={reloadJira} showToast={showToast} tokenStatus={tokenStatus}
          vehicles={vehicles} onVehiclesChanged={loadSchedule}
          absences={absences} setAbsences={setAbsences}/>}
      </main>
      {planDialog&&(
        <PlanDialog editing={planDialog.editing} defaultDate={planDialog.date}
          defaultWorkerId={planDialog.workerId} defaultPlaceId={planDialog.placeId}
          defaultVehicleId={planDialog.vehicleId} defaultTransport={planDialog.transport}
          defaultKind={planDialog.kind}
          workers={activeWorkers.map(w=>({...w,name:workerLabel(w,dupNames)}))}
          places={places} vehicles={vehicles} showToast={showToast}
          onClose={()=>setPlanDialog(null)}
          onCopy={p=>{ setClipboard(p); showToast('복사했습니다 — 달력에서 붙일 칸을 골라 주세요',4000) }}
          onOpenActual={p=>setActualDialog({plan:p})}
          onSaved={async(r={})=>{ await loadSchedule(); if(r.focusDate) setSchedFocus(r.focusDate) }}/>
      )}
      {loginOpen&&(
        <LoginDialog showToast={showToast}
          onClose={()=>setLoginOpen(false)}
          onLoggedIn={u=>{ setMe(u); setLoginOpen(false) }}/>
      )}
      {actualDialog&&(
        <ActualDialog plan={actualDialog.plan}
          actual={actuals.find(a=>a.plan_id===actualDialog.plan.id)||null}
          places={places} vehicles={vehicles} showToast={showToast}
          onClose={()=>setActualDialog(null)}
          onSaved={async(r={})=>{ await loadSchedule(); if(r.focusDate) setSchedFocus(r.focusDate) }}/>
      )}
      {toast&&(
        <div style={{position:'fixed',bottom:24,left:'50%',transform:'translateX(-50%)',
          background:'#111827',color:'#fff',padding:'10px 22px',borderRadius:24,
          fontSize:13,fontWeight:700,zIndex:9999,whiteSpace:'nowrap'}}>{toast}</div>
      )}
    </div>
  )
}

// ── 오늘 업무 탭 ─────────────────────────────────────────
function TabToday({workers,dupNames,grid,setGrid,jiraTree,jiraDone=new Set(),selWorkerId,setSelWorkerId,onSave,onLoadDate,parentSel,setParentSel}){
  const [ldDate,setLdDate]=useState(today())
  // 끝난 업무는 기본으로 감춘다. 다만 «완료 처리한 뒤에도 보완 작업이 이어지는» 경우가
  // 실제로 있어(최근 30일에도 완료 업무에 76건이 적혔다) 체크 한 번으로 꺼낼 수 있게 둔다.
  const [showDone,setShowDone]=useState(false)
  const jiraParents=Object.keys(jiraTree)
  // 목록에서만 감춘다. 🔑 «지금 골라져 있는 값» 은 완료여도 남겨야 한다 —
  // 빼 버리면 과거 날짜를 조회했을 때 적어 둔 업무가 빈칸으로 보인다.
  const visible=(list,cur)=>list.filter(t=>showDone||!jiraDone.has(t)||t===cur)
  // 표시 전용 이름. 🔴 저장되는 값(option 의 value)은 «원본 그대로» 여야 한다 —
  // 화면 문구를 저장하면 상태가 바뀔 때마다 같은 업무가 두 종류로 갈라진다.
  const label=t=>jiraDone.has(t)?'(완료) '+t:t
  const doneCount=jiraParents.filter(p=>jiraDone.has(p)).length
    +Object.values(jiraTree).flat().filter(s=>jiraDone.has(s)).length
  const selWorker=workers.find(w=>w.id===selWorkerId)||null
  // 다중 시간 선택
  const [selHours,setSelHours]=useState(new Set())
  function toggleHour(h){setSelHours(s=>{const n=new Set(s);n.has(h)?n.delete(h):n.add(h);return n})}
  function toggleAll(){setSelHours(s=>s.size===WORK_HOURS.length?new Set():new Set(WORK_HOURS))}
  // 체크된 시간 전체에 동시 반영 (체크 안 된 시간은 개별 반영)
  // wid = 직원 id (이름이 아니다 — 동명이인이 같은 칸을 공유하지 않도록)
  function onParentChange(h,wid,val){
    const hours=selHours.has(h)?[...selHours]:[h]
    setParentSel(p=>{const n={...p};hours.forEach(sh=>{n[cellKey(sh,wid)]=val});return n})
    setGrid(g=>{const n={...g};hours.forEach(sh=>{n[cellKey(sh,wid)]=val});return n})
  }
  function onSubChange(h,wid,val){
    const hours=selHours.has(h)?[...selHours]:[h]
    setGrid(g=>{const n={...g};hours.forEach(sh=>{n[cellKey(sh,wid)]=val});return n})
  }
  function onDirectInput(h,wid,val){
    const hours=selHours.has(h)?[...selHours]:[h]
    setParentSel(p=>{const n={...p};hours.forEach(sh=>{n[cellKey(sh,wid)]=''});return n})
    setGrid(g=>{const n={...g};hours.forEach(sh=>{n[cellKey(sh,wid)]=val});return n})
  }
  return(
    <div>
      <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,padding:'14px 18px',marginBottom:16,display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:12}}>
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          <strong>오늘 업무 입력</strong>
          <input type="date" value={ldDate} onChange={e=>setLdDate(e.target.value)} style={{padding:'6px 10px',border:'1px solid #e5e7eb',borderRadius:7,fontSize:13}}/>
          <button onClick={()=>{setLdDate(today());onLoadDate(today())}} style={{padding:'6px 12px',borderRadius:7,border:'1px solid #1a56db',background:'#eff6ff',color:'#1a56db',cursor:'pointer',fontSize:13,fontWeight:600}}>오늘</button>
          <button onClick={()=>onLoadDate(ldDate)} style={{padding:'6px 14px',borderRadius:7,border:'1px solid #e5e7eb',background:'#fff',cursor:'pointer',fontSize:13}}>조회</button>
          {doneCount>0&&(
            <label title="Jira 에서 종료 처리한 업무를 목록에 함께 보여 줍니다"
              style={{display:'inline-flex',alignItems:'center',gap:5,padding:'6px 10px',borderRadius:7,border:'1px solid #e5e7eb',background:showDone?'#f1f5f9':'#fff',fontSize:12,color:'#6b7280',cursor:'pointer'}}>
              <input type="checkbox" checked={showDone} onChange={e=>setShowDone(e.target.checked)} style={{cursor:'pointer'}}/>
              완료 포함 <span style={{color:'#9ca3af'}}>({doneCount})</span>
            </label>
          )}
        </div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={()=>{if(!selWorker)return;const g={...grid};WORK_HOURS.forEach(h=>delete g[cellKey(h,selWorker.id)]);setGrid(g);const ps={...parentSel};WORK_HOURS.forEach(h=>delete ps[cellKey(h,selWorker.id)]);setParentSel(ps)}}
            style={{padding:'6px 14px',borderRadius:7,border:'1px solid #e5e7eb',background:'#fff',cursor:'pointer',fontSize:13}}>초기화</button>
          <button onClick={()=>onSave(ldDate)} style={{padding:'6px 14px',borderRadius:7,border:'none',background:'#0d7a4e',color:'#fff',cursor:'pointer',fontSize:13,fontWeight:600}}>
            {selWorker?`${selWorker.name} 저장`:'이름 선택 후 저장'}
          </button>
        </div>
      </div>
      <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,padding:'12px 16px',marginBottom:16}}>
        <div style={{fontSize:12,color:'#6b7280',marginBottom:8}}>내 이름을 선택하면 해당 열만 편집됩니다</div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          {workers.map(w=>(
            <button key={w.id} onClick={()=>setSelWorkerId(w.id)}
              style={{padding:'6px 16px',borderRadius:20,fontSize:13,cursor:'pointer',
                border:`2px solid ${selWorkerId===w.id?'#1a56db':'#e5e7eb'}`,
                background:selWorkerId===w.id?'#1a56db':'#fff',
                color:selWorkerId===w.id?'#fff':'#6b7280',fontWeight:selWorkerId===w.id?700:500}}>
              {selWorkerId===w.id?'✎ ':''}{workerLabel(w,dupNames)}{selWorkerId===w.id?' (나)':''}
            </button>
          ))}
        </div>
      </div>
      <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,padding:'12px 0',overflowX:'auto'}}>
        <div style={{fontSize:11,color:'#6b7280',marginBottom:8,display:'flex',gap:16,paddingLeft:12}}>
          <span><span style={{background:'#dbeafe',padding:'1px 8px',borderRadius:4,marginRight:4}}>①</span>상위업무</span>
          <span><span style={{background:'#dcfce7',padding:'1px 8px',borderRadius:4,marginRight:4}}>②</span>하위업무</span>
          <span><span style={{background:'#fffbeb',padding:'1px 8px',borderRadius:4,marginRight:4}}>③</span>직접 입력</span>
        </div>
        {/* 선택 상태 안내 */}
        {selWorker&&selHours.size>0&&(
          <div style={{background:'#f0f9ff',border:'1px solid #bae6fd',borderRadius:7,padding:'7px 14px',marginBottom:10,display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
            <span style={{fontSize:12,color:'#0369a1'}}>🔗 <strong>{selHours.size}개 시간 선택됨</strong> — 선택된 행 중 어디서 수정해도 전체에 반영됩니다</span>
            <button onClick={()=>setSelHours(new Set())} style={{padding:'3px 10px',borderRadius:5,border:'1px solid #bae6fd',background:'#fff',cursor:'pointer',fontSize:11,color:'#64748b'}}>선택 해제</button>
          </div>
        )}
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
          <thead><tr>
            {selWorker&&<th style={{background:'#1e3a5f',color:'#fff',padding:'6px 8px',width:32,border:'1px solid #e5e7eb',textAlign:'center'}}>
              <input type="checkbox" checked={selHours.size===WORK_HOURS.length} onChange={toggleAll} style={{cursor:'pointer'}}/>
            </th>}
            <th style={{background:'#1e3a5f',color:'#fff',padding:'8px 10px',width:60,border:'1px solid #e5e7eb'}}>시간</th>
            {workers.map(w=>(
              <th key={w.id} style={{background:selWorkerId===w.id?'#1a56db':'#64748b',color:'#fff',padding:'8px 12px',minWidth:155,border:'1px solid #e5e7eb'}}>
                {selWorkerId===w.id?'✎ ':''}{workerLabel(w,dupNames)}{selWorkerId===w.id?' (나)':''}
              </th>
            ))}
          </tr></thead>
          <tbody>
            {WORK_HOURS.map(h=>(
              <tr key={h} style={{background:selHours.has(h)?'#e0f2fe':isBusinessHour(h)?'#fef9c3':'#fff'}}>
                {selWorker&&<td style={{border:'1px solid #e5e7eb',textAlign:'center',padding:'4px',background:selHours.has(h)?'#bae6fd':isBusinessHour(h)?'#fef08a':'#f9fafb'}}>
                  <input type="checkbox" checked={selHours.has(h)} onChange={()=>toggleHour(h)} style={{cursor:'pointer'}}/>
                </td>}
                <td style={{background:selHours.has(h)?'#7dd3fc':isBusinessHour(h)?'#fef08a':'#f9fafb',fontWeight:700,fontSize:11,color:'#6b7280',padding:'4px 8px',border:'1px solid #e5e7eb',textAlign:'center',whiteSpace:'nowrap'}}>
                  {String(h).padStart(2,'0')}:00
                </td>
                {workers.map(w=>{
                  const key=cellKey(h,w.id),val=grid[key]||'',isMe=selWorkerId===w.id
                  const pVal=parentSel[key]||'',subs=pVal?(jiraTree[pVal]||[]):[]
                  const pOpts=visible(jiraParents,pVal),sOpts=visible(subs,val)
                  return isMe?(
                    <td key={w.id} style={{border:'1px solid #e5e7eb',padding:4,verticalAlign:'top',minWidth:155}}>
                      <div style={{display:'flex',flexDirection:'column',gap:3}}>
                        <select value={pVal} onChange={e=>onParentChange(h,w.id,e.target.value)} style={{width:'100%',fontSize:11,padding:'3px 5px',border:'1px solid #93c5fd',borderRadius:5,background:'#eff6ff'}}>
                          <option value="">① 상위업무 선택</option>
                          {pOpts.map(p=><option key={p} value={p}>{label(p)}</option>)}
                        </select>
                        <select value={subs.includes(val)?val:''} onChange={e=>onSubChange(h,w.id,e.target.value)} disabled={sOpts.length===0}
                          style={{width:'100%',fontSize:11,padding:'3px 5px',borderRadius:5,border:'1px solid #6ee7b7',background:sOpts.length===0?'#f9fafb':'#f0fdf4',color:sOpts.length===0?'#9ca3af':'#111827'}}>
                          <option value="">{sOpts.length===0?'② 하위업무 없음':'② 하위업무 선택'}</option>
                          {sOpts.map(s=><option key={s} value={s}>{label(s)}</option>)}
                        </select>
                        <input value={(!pVal&&!subs.includes(val))?val:''} onChange={e=>onDirectInput(h,w.id,e.target.value)} placeholder="③ 직접 입력"
                          style={{width:'100%',fontSize:11,padding:'3px 5px',border:'1px dashed #fcd34d',borderRadius:5,background:'#fffbeb'}}/>
                        {val&&<div style={{fontSize:10,color:'#374151',background:'#f1f5f9',padding:'2px 6px',borderRadius:4}}>✓ {val}</div>}
                      </div>
                    </td>
                  ):(
                    <td key={w.id} style={{border:'1px solid #e5e7eb',padding:'6px 8px',background:val?'#f8fafc':'#fff',verticalAlign:'top'}}>
                      {val?<span style={{fontSize:11,color:'#374151',background:'#f1f5f9',padding:'2px 6px',borderRadius:4,display:'block'}}>{val}</span>:<span style={{color:'#e2e8f0',fontSize:11}}>-</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── 공통 컴포넌트 ─────────────────────────────────────────
function Card({title,children,style={}}){
  return<div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,padding:18,marginBottom:16,...style}}>
    {title&&<div style={{fontSize:14,fontWeight:700,marginBottom:14}}>{title}</div>}{children}</div>
}
// 지표 카드. unit 은 숫자 뒤에 작게 붙는다 —
// 값만 보면 시간인지 사람 수인지 구분할 수 없어 단위를 반드시 표시한다.
function Metrics({items}){
  return<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:10,marginBottom:16}}>
    {items.map(({label,value,unit,color})=>(
      <div key={label} style={{background:'#f9fafb',border:'1px solid #e5e7eb',borderRadius:8,padding:'14px 16px',textAlign:'center'}}>
        <div style={{fontSize:26,fontWeight:700,color:color||'#1a56db'}}>
          {value}
          {unit&&<span style={{fontSize:14,fontWeight:600,marginLeft:2,opacity:.75}}>{unit}</span>}
        </div>
        <div style={{fontSize:11,color:'#6b7280',marginTop:3}}>{label}</div>
      </div>
    ))}
  </div>
}
function SectionTitle({children}){
  return<div style={{fontSize:13,fontWeight:700,color:'#374151',padding:'4px 0 12px',borderBottom:'2px solid #e5e7eb',marginBottom:14,display:'flex',alignItems:'center',gap:6}}>
    <span style={{width:4,height:16,background:'#1a56db',borderRadius:2,display:'inline-block'}}/>{children}</div>
}

// ── 일간 탭 ───────────────────────────────────────────────
function TabDaily({history,workers,absences=[],viewDate,setViewDate,jiraTree}){
  const rows=history.filter(r=>r.work_date===viewDate)
  const periodWorkers=workersAvailable(workers,absences,viewDate,viewDate)
  const agg=aggByWorker(rows),total=rows.length
  const wNames=periodWorkers.map(w=>w.name)
  const barData=wNames.map(n=>({name:n,업무수:agg[n]?.total||0}))
  const t8=top8(rows)
  return(
    <div>
      <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,padding:'14px 18px',marginBottom:16,display:'flex',gap:10,alignItems:'center'}}>
        <strong>일간 리포트</strong>
        <input type="date" value={viewDate} onChange={e=>setViewDate(e.target.value)} style={{padding:'6px 10px',border:'1px solid #e5e7eb',borderRadius:7,fontSize:13}}/>
      </div>
      <Metrics items={[
        {label:'총 업무 기록',value:total,unit:'h',color:'#1a56db'},
        {label:'활동 직원',value:Object.keys(agg).length,unit:'명',color:'#0d7a4e'},
        {label:'업무 종류',value:Object.keys(aggByWork(rows)).length,unit:'종',color:'#b45309'},
        {label:'1인 평균',value:avgHours(total,Object.keys(agg).length),unit:'h',color:'#6d28d9'}
      ]}/>
      <div style={{display:'flex',gap:16,flexWrap:'wrap',marginBottom:16}}>
        <Card title="직원별 업무량 · 단위: 시간(h)" style={{flex:2,minWidth:260,maxWidth:'100%',boxSizing:'border-box'}}>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={barData} margin={{top:16,right:8,left:0,bottom:0}}><XAxis dataKey="name" tick={{fontSize:12}}/><YAxis unit="h"/><Tooltip formatter={hourTip}/>
              <Bar dataKey="업무수" radius={[4,4,0,0]}>
                {barData.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                <LabelList dataKey="업무수" position="top" fontSize={10} fill="#374151" formatter={numLabel}/>
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        {t8.length>0&&<Card title="업무 비중 · 단위: 시간(h)" style={{flex:1,minWidth:260,maxWidth:'100%',boxSizing:'border-box'}}>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart><Pie data={t8} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
              {t8.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}</Pie>
              <Tooltip formatter={hourTip}/><Legend wrapperStyle={{fontSize:11}}/></PieChart>
          </ResponsiveContainer>
        </Card>}
      </div>
      <SectionTitle>직원별 업무 분석</SectionTitle>
      <WorkerAnalysis rows={rows} workers={periodWorkers} jiraTree={jiraTree}/>
      <SectionTitle>프로젝트 기간 비중 분석</SectionTitle>
      <ProjectAnalysis rows={rows} allHistory={history} jiraTree={jiraTree}/>
    </div>
  )
}

// ── 주간 탭 ───────────────────────────────────────────────
function TabWeekly({history,workers,absences=[],viewDate,setViewDate,jiraTree}){
  const ym=toMonth(viewDate),wk=weekNum(viewDate)
  const wS=weekStart(viewDate),wE=weekEnd(viewDate)
  const rows=history.filter(r=>toMonth(r.work_date)===ym&&weekNum(r.work_date)===wk)
  const periodWorkers=workersAvailable(workers,absences,wS,wE)
  const total=rows.length
  const days=[...new Set(rows.map(r=>r.work_date))].sort()
  const wNames=periodWorkers.map(w=>w.name)
  const dm={}
  rows.forEach(r=>{if(!dm[r.work_date])dm[r.work_date]={};dm[r.work_date][r.worker_name]=(dm[r.work_date][r.worker_name]||0)+1})
  const barData=days.map(d=>{const o={name:d.slice(5)+'('+dayName(d)+')'};wNames.forEach(n=>{o[n]=dm[d][n]||0});return o})
  const tmData=buildTreemapData(rows,jiraTree)
  const mix=buildTaskMix(rows,r=>({k:r.work_date,label:r.work_date.slice(5)+'('+dayName(r.work_date)+')'}))
  // 연도 선택지 — 기록이 있는 해와 올해를 합쳐 최근순으로
  const yearOptions=[...new Set([...history.map(r=>r.work_date.slice(0,4)),today().slice(0,4)])].sort((a,b)=>b-a)
  const selS={padding:'6px 10px',border:'1px solid #e5e7eb',borderRadius:7,fontSize:13,fontWeight:700,cursor:'pointer',background:'#fff'}
  // 연·월을 바꿀 때 지금 보던 주차가 그 달에 없을 수 있다 (5주차 → 2월)
  // 그럴 땐 마지막 주차로 맞춘다.
  const moveTo=newYm=>setViewDate(weekFirstDate(newYm,Math.min(wk,weeksInMonth(newYm))))
  return(
    <div>
      <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,padding:'14px 18px',marginBottom:16,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
        <strong style={{marginRight:2}}>주간 리포트</strong>
        {/* 연 · 월 · 주차를 각각 골라 이동한다. 날짜를 짚는 방식보다 빠르다. */}
        <select value={ym.slice(0,4)} onChange={e=>moveTo(e.target.value+'-'+ym.slice(5))} style={selS}>
          {yearOptions.map(y=><option key={y} value={y}>{y}년</option>)}
        </select>
        <select value={ym.slice(5)} onChange={e=>moveTo(ym.slice(0,4)+'-'+e.target.value)} style={selS}>
          {Array.from({length:12},(_,i)=>String(i+1).padStart(2,'0')).map(m=>(
            <option key={m} value={m}>{+m}월</option>
          ))}
        </select>
        {/* 주차 선택지 개수는 그 달 일수로 계산한다 (31일=5주차, 28일=4주차) */}
        <select value={wk} onChange={e=>setViewDate(weekFirstDate(ym,+e.target.value))}
          style={{...selS,border:'1px solid #ddd6fe',background:'#ede9fe',color:'#6d28d9'}}>
          {Array.from({length:weeksInMonth(ym)},(_,i)=>i+1).map(n=>(
            <option key={n} value={n}>{n}주차</option>
          ))}
        </select>
        <span style={{fontSize:12,color:'#6b7280'}}>{wS} ~ {wE.slice(5)}</span>
      </div>
      <Metrics items={[
        {label:'총 업무 기록',value:total,unit:'h',color:'#1a56db'},
        {label:'근무일수',value:days.length,unit:'일',color:'#0d7a4e'},
        {label:'일평균',value:avgHours(total,days.length),unit:'h',color:'#b45309'},
        {label:'1인 합계',value:avgHours(total,wNames.length),unit:'h',color:'#6d28d9'}
      ]}/>
      <Card title="일별 분포 (누적 영역) · 단위: 시간(h)">
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={barData} margin={{top:16,right:12,left:0,bottom:0}}><XAxis dataKey="name" tick={{fontSize:11}}/><YAxis unit="h"/><Tooltip content={<NonZeroTooltip/>}/><Legend wrapperStyle={{fontSize:11}}/>
            {wNames.map((n,i)=>(
              <Area key={n} type="monotone" dataKey={n} stackId="a" stroke={COLORS[i%COLORS.length]} fill={COLORS[i%COLORS.length]} fillOpacity={0.5}>
                <LabelList dataKey={n} position="top" fontSize={9} fill="#374151" formatter={numLabel}/>
              </Area>
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </Card>
      <SectionTitle>시간대 패턴 (요일 × 시간대)</SectionTitle>
      <WorkHeatmap rows={rows}/>
      <SectionTitle>업무 편중 (파레토)</SectionTitle>
      <ParetoAnalysis rows={rows}/>
      <SectionTitle>업무 계층 비중 (트리맵)</SectionTitle>
      <TreemapAnalysis data={tmData}/>
      <SectionTitle>직원별 업무 분포 (레이더)</SectionTitle>
      <RadarAnalysis rows={rows} workers={periodWorkers}/>
      <SectionTitle>업무 구성 비율 추이 (100%)</SectionTitle>
      <MixTrend data={mix.data} tasks={mix.topTasks}/>
      <SectionTitle>직원별 업무 분석</SectionTitle>
      <WorkerAnalysis rows={rows} workers={periodWorkers} jiraTree={jiraTree}/>
      <SectionTitle>프로젝트 기간 비중 분석</SectionTitle>
      <ProjectAnalysis rows={rows} allHistory={history} jiraTree={jiraTree}/>
    </div>
  )
}

// ── 월간 탭 ───────────────────────────────────────────────
function TabMonthly({history,workers,absences=[],viewMonth,setViewMonth,jiraTree}){
  const mS=viewMonth+'-01',mE=monthEnd(viewMonth)
  const rows=history.filter(r=>toMonth(r.work_date)===viewMonth)
  const periodWorkers=workersAvailable(workers,absences,mS,mE)
  const total=rows.length,agg=aggByWorker(rows)
  const days=[...new Set(rows.map(r=>r.work_date))]
  const wm={}
  rows.forEach(r=>{const w=weekNum(r.work_date)+'주';if(!wm[w])wm[w]={};wm[w][r.worker_name]=(wm[w][r.worker_name]||0)+1})
  const wNames=periodWorkers.map(w=>w.name)
  const wData=Object.entries(wm).sort((a,b)=>a[0].localeCompare(b[0])).map(([name,d])=>{const o={name};wNames.forEach(n=>{o[n]=d[n]||0});return o})
  const t8=top8(rows)
  const tmData=buildTreemapData(rows,jiraTree)
  const mix=buildTaskMix(rows,r=>({k:String(weekNum(r.work_date)),label:weekNum(r.work_date)+'주'}))
  // 연도 선택지 — 기록이 있는 해와 올해를 합쳐 최근순 (주간 탭과 동일)
  const yearOptions=[...new Set([...history.map(r=>r.work_date.slice(0,4)),today().slice(0,4)])].sort((a,b)=>b-a)
  const selS={padding:'6px 10px',border:'1px solid #e5e7eb',borderRadius:7,fontSize:13,fontWeight:700,cursor:'pointer',background:'#fff'}
  return(
    <div>
      <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,padding:'14px 18px',marginBottom:16,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
        <strong style={{marginRight:2}}>월간 분석</strong>
        {/* 연 · 월을 콤보로 고른다 (주간 탭과 같은 방식) */}
        <select value={viewMonth.slice(0,4)} onChange={e=>setViewMonth(e.target.value+'-'+viewMonth.slice(5))} style={selS}>
          {yearOptions.map(y=><option key={y} value={y}>{y}년</option>)}
        </select>
        <select value={viewMonth.slice(5)} onChange={e=>setViewMonth(viewMonth.slice(0,4)+'-'+e.target.value)}
          style={{...selS,border:'1px solid #ddd6fe',background:'#ede9fe',color:'#6d28d9'}}>
          {Array.from({length:12},(_,i)=>String(i+1).padStart(2,'0')).map(m=>(
            <option key={m} value={m}>{+m}월</option>
          ))}
        </select>
        <span style={{fontSize:12,color:'#6b7280'}}>{mS} ~ {mE.slice(5)}</span>
      </div>
      <Metrics items={[
        {label:'총 업무 기록',value:total,unit:'h',color:'#1a56db'},
        {label:'근무일수',value:days.length,unit:'일',color:'#0d7a4e'},
        {label:'업무 종류',value:Object.keys(aggByWork(rows)).length,unit:'종',color:'#b45309'},
        {label:'1인 총 업무',value:avgHours(total,wNames.length),unit:'h',color:'#6d28d9'}
      ]}/>
      <div style={{display:'flex',gap:16,flexWrap:'wrap',marginBottom:16}}>
        <Card title="주차별 분포 (누적 영역) · 단위: 시간(h)" style={{flex:2,minWidth:260,maxWidth:'100%',boxSizing:'border-box'}}>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={wData} margin={{top:16,right:12,left:0,bottom:0}}><XAxis dataKey="name" tick={{fontSize:12}}/><YAxis unit="h"/><Tooltip content={<NonZeroTooltip/>}/><Legend wrapperStyle={{fontSize:11}}/>
              {wNames.map((n,i)=>(
                <Area key={n} type="monotone" dataKey={n} stackId="a" stroke={COLORS[i%COLORS.length]} fill={COLORS[i%COLORS.length]} fillOpacity={0.5}>
                  <LabelList dataKey={n} position="top" fontSize={9} fill="#374151" formatter={numLabel}/>
                </Area>
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </Card>
        {t8.length>0&&<Card title="업무 유형 · 단위: 시간(h)" style={{flex:1,minWidth:260,maxWidth:'100%',boxSizing:'border-box'}}>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart><Pie data={t8} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
              {t8.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}</Pie>
              <Tooltip formatter={hourTip}/><Legend wrapperStyle={{fontSize:10}}/></PieChart>
          </ResponsiveContainer>
        </Card>}
      </div>
      <SectionTitle>시간대 패턴 (요일 × 시간대)</SectionTitle>
      <WorkHeatmap rows={rows}/>
      <SectionTitle>업무 편중 (파레토)</SectionTitle>
      <ParetoAnalysis rows={rows}/>
      <SectionTitle>업무 계층 비중 (트리맵)</SectionTitle>
      <TreemapAnalysis data={tmData}/>
      <SectionTitle>직원별 업무 분포 (레이더)</SectionTitle>
      <RadarAnalysis rows={rows} workers={periodWorkers}/>
      <SectionTitle>업무 구성 비율 추이 (100%)</SectionTitle>
      <MixTrend data={mix.data} tasks={mix.topTasks}/>
      <SectionTitle>직원별 업무 분석</SectionTitle>
      <WorkerAnalysis rows={rows} workers={periodWorkers} jiraTree={jiraTree}/>
      <SectionTitle>프로젝트 기간 비중 분석</SectionTitle>
      <ProjectAnalysis rows={rows} allHistory={history} jiraTree={jiraTree}/>
    </div>
  )
}

// ── 연간 탭 ───────────────────────────────────────────────
function TabYearly({history,workers,absences=[],viewYear,setViewYear,jiraTree}){
  const yS=viewYear+'-01-01',yE=viewYear+'-12-31'
  const rows=history.filter(r=>toYear(r.work_date)===viewYear)
  const periodWorkers=workersAvailable(workers,absences,yS,yE)
  const total=rows.length,agg=aggByWorker(rows)
  const days=[...new Set(rows.map(r=>r.work_date))]
  const mm={}
  rows.forEach(r=>{const m=r.work_date.slice(5,7)+'월';if(!mm[m])mm[m]={};mm[m][r.worker_name]=(mm[m][r.worker_name]||0)+1})
  const wNames=periodWorkers.map(w=>w.name)
  const mData=Object.entries(mm).sort((a,b)=>parseInt(a[0])-parseInt(b[0])).map(([name,d])=>({name,...d}))
  const t8=top8(rows)
  const wbData=wNames.map((n,i)=>({name:n,업무수:agg[n]?.total||0,fill:COLORS[i%COLORS.length]}))
  const tmData=buildTreemapData(rows,jiraTree)
  const mix=buildTaskMix(rows,r=>({k:r.work_date.slice(5,7),label:parseInt(r.work_date.slice(5,7))+'월'}))
  return(
    <div>
      <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,padding:'14px 18px',marginBottom:16,display:'flex',gap:10,alignItems:'center'}}>
        <strong>연간 분석</strong>
        <input type="number" value={viewYear} min="2020" max="2099" onChange={e=>setViewYear(parseInt(e.target.value))} style={{width:90,padding:'6px 10px',border:'1px solid #e5e7eb',borderRadius:7,fontSize:13}}/>
      </div>
      <Metrics items={[
        {label:'총 업무 기록',value:total.toLocaleString(),unit:'h',color:'#1a56db'},
        {label:'연간 근무일',value:days.length,unit:'일',color:'#0d7a4e'},
        {label:'업무 종류',value:Object.keys(aggByWork(rows)).length,unit:'종',color:'#b45309'},
        {label:'1인 연간 합계',value:avgHours(total,wNames.length),unit:'h',color:'#6d28d9'}
      ]}/>
      <Card title="월별 업무량 추이 · 단위: 시간(h)">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={mData} margin={{top:14,right:30,left:0,bottom:0}}><XAxis dataKey="name" tick={{fontSize:11}}/><YAxis unit="h"/><Tooltip content={<NonZeroTooltip/>}/><Legend wrapperStyle={{fontSize:11}}/>
            {wNames.map((n,i)=>(
              <Line key={n} type="monotone" dataKey={n} stroke={COLORS[i%COLORS.length]} strokeWidth={2} dot={{r:3}}>
                <LabelList dataKey={n} position="top" fontSize={9} fill="#374151" formatter={numLabel}/>
              </Line>
            ))}
          </LineChart>
        </ResponsiveContainer>
      </Card>
      <div style={{display:'flex',gap:16,flexWrap:'wrap',marginBottom:16}}>
        <Card title="직원별 연간 실적 · 단위: 시간(h)" style={{flex:1.5,minWidth:260,maxWidth:'100%',boxSizing:'border-box'}}>
          <ResponsiveContainer width="100%" height={Math.max(240,wNames.length*44+60)}>
            <BarChart data={wbData} layout="vertical" margin={{right:32}}>
              <XAxis type="number" unit="h"/><YAxis type="category" dataKey="name" tick={{fontSize:12}} width={60}/><Tooltip formatter={hourTip}/>
              <Bar dataKey="업무수" radius={[0,4,4,0]}>
                {wbData.map((d,i)=><Cell key={i} fill={d.fill}/>)}
                <LabelList dataKey="업무수" position="right" fontSize={10} fill="#374151" formatter={numLabel}/>
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        {t8.length>0&&<Card title="연간 업무 비중 · 단위: 시간(h)" style={{flex:1,minWidth:260,maxWidth:'100%',boxSizing:'border-box'}}>
          <ResponsiveContainer width="100%" height={Math.max(240,wNames.length*44+60)}>
            <PieChart><Pie data={t8} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
              {t8.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}</Pie>
              <Tooltip formatter={hourTip}/><Legend wrapperStyle={{fontSize:10}}/></PieChart>
          </ResponsiveContainer>
        </Card>}
      </div>
      <SectionTitle>시간대 패턴 (요일 × 시간대)</SectionTitle>
      <WorkHeatmap rows={rows}/>
      <SectionTitle>업무 편중 (파레토)</SectionTitle>
      <ParetoAnalysis rows={rows}/>
      <SectionTitle>업무 계층 비중 (트리맵)</SectionTitle>
      <TreemapAnalysis data={tmData}/>
      <SectionTitle>직원별 업무 분포 (레이더)</SectionTitle>
      <RadarAnalysis rows={rows} workers={periodWorkers}/>
      <SectionTitle>업무 구성 비율 추이 (100%)</SectionTitle>
      <MixTrend data={mix.data} tasks={mix.topTasks}/>
      <SectionTitle>직원별 업무 분석</SectionTitle>
      <WorkerAnalysis rows={rows} workers={periodWorkers} jiraTree={jiraTree}/>
      <SectionTitle>프로젝트 기간 비중 분석</SectionTitle>
      <ProjectAnalysis rows={rows} allHistory={history} jiraTree={jiraTree}/>
    </div>
  )
}

// ── 스케줄 탭 ─────────────────────────────────────────────
// 「어느 날 어디에서 무엇을 할 계획인가」를 달력으로 본다.
// 업무 내용을 적는 「오늘 업무」와 달리 장소와 이동 수단이 중심이다.
// 설계서: docs/design/스케줄표_설계.md

// 사람마다 색을 고정한다. 색이 매번 바뀌면 달력에서 누구인지 알 수 없다.
function workerColor(workerId,workers){
  const i=workers.findIndex(w=>w.id===workerId)
  return COLORS[(i<0?0:i)%COLORS.length]
}

// ── 보기 기준 ────────────────────────────────────────────
// 여러 사람이 등록하면 등록 순서대로 쌓여 뒤섞인다. 무엇을 기준으로 묶어 볼지
// 고르게 한다. 주 뷰는 이 기준이 «격자의 세로축» 이 되므로 성격이 크게 달라진다.
//   사람  누가 어디 있는가        (위치 파악)
//   장소  그 현장에 누가 언제 가는가 (동행·중복 방문)
//   차량  배차표                  (겹침 확인)
const GROUP_BYS=[
  {v:'worker', label:'사람', icon:'👤'},
  {v:'place',  label:'장소', icon:'📍'},
  {v:'vehicle',label:'차량', icon:'🚗'},
]

// 기준에 맞는 행 목록을 만든다. 각 행은 {key,label,sub,color,match,cellDefaults} 다.
//   match        그 행에 속하는 계획인지
//   cellDefaults 빈 칸을 눌렀을 때 계획 창에 미리 채울 값
function buildGroupRows(groupBy,workers,places,vehicles,plans){
  if(groupBy==='worker'){
    return workers.map(w=>({
      key:'w'+w.id, label:w.name, color:workerColor(w.id,workers),
      match:p=>p.worker_id===w.id, cellDefaults:{workerId:w.id},
    }))
  }
  if(groupBy==='place'){
    // 그 기간에 실제로 쓰인 장소만 보여 준다. 등록된 장소를 다 세우면 빈 줄만 길어진다.
    const used=new Map()
    plans.forEach(p=>{
      if(p.use_type==='vacation'||p.place_id==null) return
      if(!used.has(p.place_id)) used.set(p.place_id,p.place_name||p.place_text||'(이름 없음)')
    })
    const rows=[{key:'office',label:'🏢 사무실 (내근)',color:'#64748b',
      match:p=>p.use_type!=='vacation'&&p.transport==='office',
      cellDefaults:{placeId:OFFICE_PLACE}}]
    ;[...used.entries()].sort((a,b)=>String(a[1]).localeCompare(String(b[1]),'ko'))
      .forEach(([id,name])=>{
        const pl=places.find(x=>x.id===id)
        rows.push({key:'p'+id,label:name,
          sub:pl?.distance_km!=null?`${pl.distance_km}km`:'',
          color:'#0ea5e9',match:p=>p.place_id===id,cellDefaults:{placeId:id}})
      })
    rows.push({key:'vac',label:'🌴 휴가',color:'#059669',
      match:p=>p.use_type==='vacation',cellDefaults:{kind:'vacation'}})
    return rows
  }
  // 차량 — 법인차는 배차 확인용이라 그 주에 안 쓰였어도 «항상» 세운다
  const rows=vehicles.filter(v=>v.kind==='company').map(v=>({
    key:'v'+v.id, label:v.name, sub:v.plate||'', color:'#f59e0b',
    match:p=>p.vehicle_id===v.id, cellDefaults:{vehicleId:v.id,transport:'company_car'},
  }))
  // 자차는 그 기간에 쓰인 것만
  const usedOwn=new Set(plans.filter(p=>p.vehicle_kind==='own'&&p.vehicle_id).map(p=>p.vehicle_id))
  vehicles.filter(v=>v.kind==='own'&&usedOwn.has(v.id)).forEach(v=>{
    rows.push({key:'v'+v.id,label:v.name+(v.owner_name?` (${v.owner_name})`:''),
      sub:'자차',color:'#8b5cf6',match:p=>p.vehicle_id===v.id,
      cellDefaults:{vehicleId:v.id,transport:'own_car'}})
  })
  rows.push({key:'nocar',label:'차량 없음',sub:'사무실·대중교통·휴가',color:'#94a3b8',
    match:p=>!p.vehicle_id,cellDefaults:{}})
  return rows
}
// 배지에 넣을 짧은 장소 이름. 달력 칸이 좁아 긴 이름은 잘라야 한다.
function shortPlace(plan){
  if(plan.use_type==='vacation') return plan.vacation_type||'휴가'
  if(plan.use_type==='personal') return '개인 사용'
  if(plan.transport==='office') return '사무실'
  const nm=plan.place_name||plan.place_text||''
  return nm.length>9?nm.slice(0,9)+'…':nm
}
// 배지에 붙는 아이콘 — 휴가는 이동 수단이 없으므로 따로 잡는다
function planIcon(plan){
  if(plan.use_type==='vacation') return '🌴'
  return (TRANSPORT_MAP[plan.transport]||TRANSPORT_MAP.office).icon
}
// 계획 한 건이 어떤 상태인지 — 달력 표시와 「확인 필요」 판단에 쓴다
function planState(plan,todayStr){
  if(plan.status==='canceled') return 'canceled'
  if(plan.actual_id) return plan.as_planned===false?'changed':'done'
  return plan.plan_date<todayStr?'needCheck':'planned'
}
const PLAN_STATE_MARK={done:'',changed:'↺',needCheck:'●',planned:'',canceled:'✕'}

// 달력 배지 하나.
// showWorker — 장소·차량 기준으로 볼 때는 «누구인가» 가 핵심 정보이므로 이름을 남긴다.
function PlanBadge({plan,workers,onClick,todayStr,compact=false,showWorker=true}){
  const color=workerColor(plan.worker_id,workers)
  const st=planState(plan,todayStr)
  const personal=plan.use_type==='personal'
  const vacation=plan.use_type==='vacation'
  return(
    <div data-badge onClick={e=>{e.stopPropagation();onClick()}}
      title={`${plan.worker_name} · ${SLOT_MAP[plan.slot]} · ${vacation?('휴가 · '+(plan.vacation_type||'')):personal?'개인 사용':(plan.place_name||plan.place_text||'장소 미정')}${plan.purpose?' · '+plan.purpose:''}${plan.vehicle_name?' · '+plan.vehicle_name:''}`}
      style={{display:'flex',alignItems:'center',gap:3,cursor:'pointer',
        background:st==='planned'||st==='needCheck'?color+'22':color+'dd',
        color:st==='planned'||st==='needCheck'?'#111827':'#fff',
        border:`1px solid ${color}`,borderStyle:(personal||vacation)?'dashed':'solid',
        borderRadius:4,padding:compact?'1px 4px':'2px 5px',fontSize:compact?10:11,
        marginBottom:2,whiteSpace:'nowrap',overflow:'hidden',
        opacity:st==='canceled'?.45:1,
        textDecoration:st==='canceled'?'line-through':'none'}}>
      <span>{planIcon(plan)}</span>
      <strong style={{fontSize:compact?10:11}}>{plan.worker_name}</strong>
      {!compact&&<span style={{opacity:.9,overflow:'hidden',textOverflow:'ellipsis'}}>{shortPlace(plan)}</span>}
      {/* 시간대는 종일이 아닐 때만 — 배차 겹침을 판단할 때 필요하다 */}
      {plan.slot!=='allday'&&<span style={{opacity:.85,fontSize:compact?9:10}}>{SLOT_MAP[plan.slot]}</span>}
      {st==='needCheck'&&<span style={{color:'#c2410c',fontWeight:700}}>{PLAN_STATE_MARK.needCheck}</span>}
      {st==='changed'&&<span>{PLAN_STATE_MARK.changed}</span>}
    </div>
  )
}

function TabSchedule({workers,places,vehicles,plans,actuals=[],loading,onReload,onOpenNew,onOpenPlan,
                      onOpenCell,onOpenActual,showToast,focusDate,clipboard,onPaste,onCancelCopy,
                      me,onNeedLogin,onLogout}){
  // 붙여넣기 모드에서 고른 칸들. 「날짜_직원id」 를 키로 담는다
  // (주 뷰는 사람까지 고를 수 있고, 월·일 뷰는 날짜만 고른다)
  const [picked,setPicked]=useState([])
  const pasting=!!clipboard
  const isPicked=(d,wid)=>picked.some(p=>p.date===d&&p.workerId===wid)
  function togglePick(d,wid){
    setPicked(prev=>prev.some(p=>p.date===d&&p.workerId===wid)
      ? prev.filter(p=>!(p.date===d&&p.workerId===wid))
      : [...prev,{date:d,workerId:wid}])
  }
  // 복사를 취소하거나 붙여넣기를 마치면 선택을 비운다
  useEffect(()=>{ if(!clipboard) setPicked([]) },[clipboard])

  const [view,setView]=useState('week')
  const [groupBy,setGroupBy]=useState('worker')   // 보기 기준 — 주 뷰의 세로축이 된다
  const [anchor,setAnchor]=useState(today())      // 기준 날짜 (주·일 뷰)
  const [ym,setYm]=useState(toMonth(today()))     // 기준 월 (월 뷰)
  const [year,setYear]=useState(toYear(today()))

  // 계획을 등록하면 그 날짜로 달력을 옮긴다.
  // 보고 있는 기간 밖에 등록되면 화면에 안 나타나 «등록이 안 됐다» 고 오해한다.
  useEffect(()=>{
    if(!focusDate) return
    setAnchor(focusDate); setYm(toMonth(focusDate)); setYear(toYear(focusDate))
  },[focusDate])
  const [filterWorker,setFilterWorker]=useState('')
  const [filterVehicle,setFilterVehicle]=useState('')
  const todayStr=today()

  const shown=plans.filter(p=>
    (!filterWorker||String(p.worker_id)===filterWorker)&&
    (!filterVehicle||String(p.vehicle_id)===filterVehicle))

  // 기준에 따른 정렬 — 월 뷰 칸에서 같은 묶음이 붙어 보이게 한다.
  // 등록 순서대로 쌓이면 여러 사람이 넣었을 때 뒤섞여 읽을 수 없다.
  function groupKeyOf(p){
    if(groupBy==='worker') return String(workers.findIndex(w=>w.id===p.worker_id)).padStart(3,'0')
    if(groupBy==='place'){
      if(p.use_type==='vacation') return 'zz휴가'
      if(p.transport==='office') return '000사무실'
      return '1'+(p.place_name||p.place_text||'')
    }
    return p.vehicle_id?'1'+(p.vehicle_name||''):'zz차량없음'
  }
  const sortByGroup=(a,b)=>groupKeyOf(a).localeCompare(groupKeyOf(b),'ko')||
                           String(a.slot).localeCompare(String(b.slot))
  const byDate=(d)=>shown.filter(p=>p.plan_date===d).sort(sortByGroup)
  const groupRows=buildGroupRows(groupBy,workers,places,vehicles,shown)

  // 지난 날짜인데 실적이 없는 계획 — 정산 근거가 비어 있는 것들이라 눈에 띄게 모아 준다
  const pending=shown.filter(p=>planState(p,todayStr)==='needCheck')
    .sort((a,b)=>a.plan_date.localeCompare(b.plan_date))

  const selS={padding:'6px 8px',border:'1px solid #e5e7eb',borderRadius:7,fontSize:12,background:'#fff'}
  const navBtn={padding:'6px 12px',border:'1px solid #e5e7eb',borderRadius:7,background:'#fff',
    cursor:'pointer',fontSize:13,fontWeight:600}

  function move(n){
    if(view==='month') setYm(shiftMonth(ym,n))
    else if(view==='week') setAnchor(addDays(anchor,n*7))
    else if(view==='day') setAnchor(addDays(anchor,n))
    else setYear(year+n)
  }
  function goToday(){
    setAnchor(todayStr); setYm(toMonth(todayStr)); setYear(toYear(todayStr))
  }

  const isSettle=view==='settle'
  const periodLabel=view==='month'?`${ym.slice(0,4)}년 ${Number(ym.slice(5,7))}월`
    :view==='week'?`${mdLabel(calWeekDays(anchor)[0])} ~ ${mdLabel(calWeekDays(anchor)[6])}`
    :view==='day'?`${anchor} (${dayName(anchor)})`
    :`${year}년`

  // 차량이 같은 날 겹친 건 — 달력 위에 먼저 알려 준다
  const vehicleConflicts=(()=>{
    const m={}
    shown.filter(p=>p.vehicle_id&&p.status!=='canceled').forEach(p=>{
      const k=`${p.plan_date}_${p.vehicle_id}`
      ;(m[k]=m[k]||[]).push(p)
    })
    return Object.entries(m).filter(([,v])=>v.length>1)
      .map(([k,v])=>({date:k.split('_')[0],vehicle:v[0].vehicle_name,plate:v[0].vehicle_plate,
                      // 같은 사람이 같은 차를 두 건 넣은 경우도 겹침이지만
                      // 이름을 두 번 적으면 「이건호 · 이건호」 처럼 읽기 이상하다
                      names:[...new Set(v.map(p=>p.worker_name))],
                      count:v.length}))
  })()

  return(
    <div>
      {/* 조작 줄 */}
      <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,padding:'12px 16px',
        marginBottom:16,display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
        <div style={{display:'flex',border:'1px solid #e5e7eb',borderRadius:7,overflow:'hidden'}}>
          {SCHEDULE_VIEWS.map(v=>(
            <button key={v.v} onClick={()=>setView(v.v)}
              style={{padding:'6px 14px',border:'none',cursor:'pointer',fontSize:13,
                fontWeight:view===v.v?700:500,
                background:view===v.v?'#1a56db':'#fff',color:view===v.v?'#fff':'#6b7280'}}>{v.label}</button>
          ))}
        </div>
        {!isSettle&&<>
          <button onClick={()=>move(-1)} style={navBtn}>◀</button>
          <strong style={{fontSize:15,minWidth:150,textAlign:'center'}}>{periodLabel}</strong>
          <button onClick={()=>move(1)} style={navBtn}>▶</button>
          <button onClick={goToday} style={{...navBtn,color:'#1a56db',borderColor:'#1a56db'}}>오늘</button>
        </>}

        {/* 보기 기준 — 주 뷰에서는 격자의 세로축이 바뀐다 */}
        {!isSettle&&<>
        <span style={{fontSize:11,color:'#6b7280',marginLeft:6}}>기준</span>
        <div style={{display:'flex',border:'1px solid #e5e7eb',borderRadius:7,overflow:'hidden'}}>
          {GROUP_BYS.map(g=>(
            <button key={g.v} onClick={()=>setGroupBy(g.v)}
              title={g.v==='worker'?'누가 어디 있는지 본다'
                    :g.v==='place'?'그 현장에 누가 언제 가는지 본다'
                    :'배차표 — 차량이 겹치는지 본다'}
              style={{padding:'6px 11px',border:'none',cursor:'pointer',fontSize:12,
                fontWeight:groupBy===g.v?700:500,
                background:groupBy===g.v?'#1e3a5f':'#fff',
                color:groupBy===g.v?'#fff':'#6b7280'}}>{g.icon} {g.label}</button>
          ))}
        </div>

        <div style={{flex:1}}/>
        <select value={filterWorker} onChange={e=>setFilterWorker(e.target.value)} style={selS}>
          <option value="">전 직원</option>
          {workers.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select value={filterVehicle} onChange={e=>setFilterVehicle(e.target.value)} style={selS}>
          <option value="">전 차량</option>
          {vehicles.filter(v=>v.kind==='company').map(v=>
            <option key={v.id} value={v.id}>{v.name} {v.plate}</option>)}
        </select>
        <button onClick={onOpenNew}
          style={{padding:'7px 16px',border:'none',borderRadius:7,background:'#1a56db',color:'#fff',
            cursor:'pointer',fontSize:13,fontWeight:700}}>+ 계획 추가</button>
        </>}
      </div>

      {/* 붙여넣기 바 — 복사한 계획이 있을 때만 나온다 */}
      {pasting&&(
        <div style={{background:'#eff6ff',border:'1px solid #93c5fd',borderRadius:8,padding:'10px 14px',
          marginBottom:14,display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
          <strong style={{fontSize:12,color:'#1e40af'}}>
            📋 「{clipboard.place_name||clipboard.place_text||(clipboard.transport==='office'?'사무실':'개인 사용')}」 복사됨
          </strong>
          <span style={{fontSize:12,color:'#1e40af'}}>
            붙일 칸을 눌러 고르십시오 (다시 누르면 해제) — <strong>{picked.length}개 선택</strong>
          </span>
          <div style={{flex:1}}/>
          <button onClick={()=>{onPaste(clipboard,picked);setPicked([])}} disabled={picked.length===0}
            style={{padding:'6px 14px',borderRadius:7,border:'none',fontSize:12,fontWeight:700,
              background:picked.length?'#1a56db':'#e5e7eb',color:picked.length?'#fff':'#9ca3af',
              cursor:picked.length?'pointer':'default'}}>
            {picked.length?`${picked.length}곳에 붙이기`:'붙이기'}
          </button>
          <button onClick={onCancelCopy}
            style={{padding:'6px 12px',borderRadius:7,border:'1px solid #93c5fd',background:'#fff',
              color:'#1e40af',cursor:'pointer',fontSize:12}}>복사 취소</button>
        </div>
      )}

      {/* 안내 — 처음 쓸 때 장소가 없으면 알려 준다 */}
      {!isSettle&&places.length===0&&!pasting&&(
        <div style={{background:'#fffbeb',border:'1px solid #fcd34d',borderRadius:8,padding:'10px 14px',
          marginBottom:14,fontSize:12,color:'#92400e'}}>
          등록된 장소가 없습니다. 계획을 추가할 때 「새 장소」로 넣으면 거리·시간을 한 번만 입력하고
          다음부터는 자동으로 채워집니다.
        </div>
      )}

      {/* 실적 미입력 안내 — 정산 근거가 비어 있는 것들 */}
      {!isSettle&&!pasting&&pending.length>0&&(
        <div style={{background:'#fff7ed',border:'1px solid #fdba74',borderRadius:8,padding:'10px 14px',
          marginBottom:14,fontSize:12,color:'#9a3412'}}>
          <strong>● 실적을 넣지 않은 일정이 {pending.length}건 있습니다</strong>
          <span style={{marginLeft:6,opacity:.85}}>— 주행거리·비용이 비어 있으면 정산할 수 없습니다.</span>
          <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:8}}>
            {pending.slice(0,12).map(p=>(
              <button key={p.id} onClick={()=>onOpenActual(p)}
                style={{padding:'4px 9px',borderRadius:6,border:'1px solid #fdba74',background:'#fff',
                  color:'#9a3412',cursor:'pointer',fontSize:11,fontWeight:600}}>
                {mdLabel(p.plan_date)} {p.worker_name}
                {p.vehicle_name?` · ${p.vehicle_name}`:''}
              </button>
            ))}
            {pending.length>12&&<span style={{fontSize:11,alignSelf:'center'}}>외 {pending.length-12}건</span>}
          </div>
        </div>
      )}

      {/* 차량 겹침 경고 */}
      {!isSettle&&vehicleConflicts.length>0&&(
        <div style={{background:'#fef2f2',border:'1px solid #fca5a5',borderRadius:8,padding:'10px 14px',
          marginBottom:14,fontSize:12,color:'#991b1b'}}>
          <strong>⚠ 차량 예약이 겹칩니다</strong>
          {vehicleConflicts.map((c,i)=>(
            <div key={i} style={{marginTop:4}}>
              {c.date} · {c.vehicle} {c.plate} — {c.names.join(' · ')}
              {c.count>c.names.length&&<span style={{opacity:.8}}> ({c.count}건)</span>}
            </div>
          ))}
        </div>
      )}

      {loading&&<div style={{fontSize:12,color:'#6b7280',marginBottom:10}}>불러오는 중…</div>}

      {view==='month'&&<ScheduleMonth ym={ym} byDate={byDate} workers={workers} todayStr={todayStr}
        onOpenPlan={onOpenPlan} onPickDate={d=>{setAnchor(d);setView('day')}}
        onOpenCell={onOpenCell} pasting={pasting} isPicked={isPicked} togglePick={togglePick}/>}
      {view==='week'&&<ScheduleWeek anchor={anchor} shown={shown} workers={workers} todayStr={todayStr}
        onOpenPlan={onOpenPlan} onOpenCell={onOpenCell}
        pasting={pasting} isPicked={isPicked} togglePick={togglePick}
        rows={groupRows} groupBy={groupBy} sortByGroup={sortByGroup}/>}
      {view==='day'&&<ScheduleDay date={anchor} byDate={byDate} workers={workers} vehicles={vehicles}
        todayStr={todayStr} onOpenPlan={onOpenPlan} onOpenCell={onOpenCell} onOpenActual={onOpenActual}
        rows={groupRows} groupBy={groupBy} sortByGroup={sortByGroup}/>}
      {view==='year'&&<ScheduleYear year={year} plans={shown} workers={workers}
        onPickMonth={m=>{setYm(m);setView('month')}}/>}
      {view==='settle'&&<ScheduleSettlement me={me} onNeedLogin={onNeedLogin} onLogout={onLogout}
        onOpenActual={onOpenActual} showToast={showToast}/>}

      {!isSettle&&<div style={{marginTop:14,fontSize:11,color:'#6b7280',display:'flex',gap:14,flexWrap:'wrap'}}>
        <span>🏢 사무실</span><span>🚗 법인차량</span><span>🚙 자차</span><span>🚌 대중교통</span><span>🌴 휴가</span>
        <span style={{color:'#c2410c'}}>● 확인 필요(지난 날짜인데 실적 없음)</span>
        <span>↺ 계획과 달랐음</span>
        <span style={{borderBottom:'1px dashed #6b7280'}}>점선 = 개인 사용</span>
      </div>}
    </div>
  )
}

// 월 뷰 — 날짜 격자에 배지를 얹는다.
// 빈 곳을 누르면 그 날짜로 계획 창이 열리고, 붙여넣기 모드면 칸을 골라 담는다.
function ScheduleMonth({ym,byDate,workers,todayStr,onOpenPlan,onPickDate,onOpenCell,
                        pasting,isPicked,togglePick}){
  const days=monthGridDays(ym)
  return(
    <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,overflow:'hidden'}}>
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)'}}>
        {['월','화','수','목','금','토','일'].map((d,i)=>(
          <div key={d} style={{...thS,borderRadius:0,padding:'7px 0',
            color:i===5?'#93c5fd':i===6?'#fca5a5':'#fff'}}>{d}</div>
        ))}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)'}}>
        {days.map(d=>{
          const list=byDate(d)
          const out=!isSameMonth(d,ym)
          const isToday=d===todayStr
          const chosen=pasting&&isPicked(d,null)
          return(
            <div key={d}
              onClick={e=>{
                // 배지를 눌렀을 때는 칸 동작이 겹치지 않게 한다
                if(e.target.closest('[data-badge]'))return
                if(pasting) togglePick(d,null)
                else onOpenCell({date:d})
              }}
              title={pasting?'누르면 붙일 칸으로 고릅니다':'누르면 이 날짜에 계획을 추가합니다'}
              style={{minHeight:96,borderRight:'1px solid #f1f5f9',borderBottom:'1px solid #f1f5f9',
                padding:'4px 5px',cursor:'pointer',
                background:chosen?'#dbeafe':out?'#fafafa':isToday?'#eff6ff':'#fff',
                boxShadow:chosen?'inset 0 0 0 2px #1a56db':'none',
                opacity:out?.5:1,overflow:'hidden'}}>
              <div style={{fontSize:11,fontWeight:isToday?700:500,marginBottom:3,
                color:isToday?'#1a56db':'#6b7280'}}>
                {Number(d.slice(8,10))}
              </div>
              {list.slice(0,4).map(p=>(
                <PlanBadge key={p.id} plan={p} workers={workers} todayStr={todayStr}
                  onClick={()=>onOpenPlan(p)} compact/>
              ))}
              {list.length>4&&(
                <div data-badge onClick={()=>onPickDate(d)}
                  style={{fontSize:10,color:'#1a56db',cursor:'pointer',fontWeight:600}}>
                  +{list.length-4}건 더
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// 주 뷰 — «기준 × 날짜» 격자.
// 세로축은 고른 기준(사람·장소·차량)이 된다.
//   사람  누가 어디 있는가 — 위치 파악
//   장소  그 현장에 누가 언제 가는가 — 동행·중복 방문
//   차량  배차표 — 한 줄에서 겹침이 드러난다
// 칸을 누르면 «그 줄의 값 + 그 날짜» 가 계획 창에 미리 채워진다.
function ScheduleWeek({anchor,shown,workers,todayStr,onOpenPlan,onOpenCell,
                       pasting,isPicked,togglePick,rows,groupBy,sortByGroup}){
  const days=calWeekDays(anchor)
  return(
    <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,overflowX:'auto'}}>
      <table style={{width:'100%',borderCollapse:'collapse',minWidth:820}}>
        <thead>
          <tr>
            <th style={{...thS,width:130,position:'sticky',left:0,zIndex:2}}>
              {GROUP_BYS.find(g=>g.v===groupBy)?.label}
            </th>
            {days.map((d,i)=>(
              <th key={d} style={{...thS,background:d===todayStr?'#1a56db':'#1e3a5f'}}>
                <div style={{color:i===5?'#93c5fd':i===6?'#fca5a5':'#fff'}}>
                  {mdLabel(d)} ({dayName(d)})
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length===0&&(
            <tr><td colSpan={8} style={{...tdS,color:'#6b7280',padding:'18px'}}>
              표시할 줄이 없습니다.
            </td></tr>
          )}
          {rows.map((row,ri)=>(
            <tr key={row.key} style={{background:ri%2===0?'#fff':'#f8fbff'}}>
              <td style={{...tdS,textAlign:'left',fontWeight:700,position:'sticky',left:0,
                background:ri%2===0?'#fff':'#f8fbff',zIndex:1}}>
                <span style={{display:'inline-block',width:8,height:8,borderRadius:2,marginRight:6,
                  background:row.color}}/>
                {row.label}
                {row.sub&&<div style={{fontSize:10,color:'#6b7280',fontWeight:500,marginLeft:14}}>{row.sub}</div>}
              </td>
              {days.map(d=>{
                const list=shown.filter(p=>p.plan_date===d&&row.match(p)).sort(sortByGroup)
                // 붙여넣기 선택 키 — 사람 기준일 때만 사람이 정해진다
                const wid=row.cellDefaults?.workerId??null
                const chosen=pasting&&isPicked(d,wid)
                return(
                  <td key={d}
                    onClick={e=>{
                      if(e.target.closest('[data-badge]'))return
                      if(pasting) togglePick(d,wid)
                      else onOpenCell({date:d,...row.cellDefaults})
                    }}
                    title={pasting?`${row.label} · ${d} — 누르면 붙일 칸으로 고릅니다`
                                  :`${row.label} · ${d} — 누르면 계획을 추가합니다`}
                    style={{...tdS,verticalAlign:'top',minWidth:96,cursor:'pointer',
                      background:chosen?'#dbeafe':d===todayStr?'#eff6ff':'transparent',
                      boxShadow:chosen?'inset 0 0 0 2px #1a56db':'none'}}>
                    {list.length===0
                      ?<span style={{color:'#e2e8f0',fontSize:11}}>{pasting?'+':'-'}</span>
                      :list.map(p=>(
                        <PlanBadge key={p.id} plan={p} workers={workers} todayStr={todayStr}
                          onClick={()=>onOpenPlan(p)}
                          showWorker={groupBy!=='worker'}/>
                      ))}
                    {/* 차량 기준에서 한 칸에 둘 이상이면 배차가 겹친 것이다 */}
                    {groupBy==='vehicle'&&row.key.startsWith('v')&&list.length>1&&(
                      <div style={{fontSize:10,color:'#991b1b',fontWeight:700}}>겹침 {list.length}건</div>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// 일 뷰 — 그날 일정을 «고른 기준» 으로 묶어 보여 준다 + 차량 배정.
// 한 표에 섞어 놓으면 여러 사람이 등록했을 때 누가 무엇인지 읽기 어렵다.
function ScheduleDay({date,byDate,workers,vehicles,todayStr,onOpenPlan,onOpenCell,onOpenActual,
                      rows,groupBy,sortByGroup}){
  const list=byDate(date)
  const noPlan=workers.filter(w=>!list.some(p=>p.worker_id===w.id))
  const carRows=vehicles.filter(v=>v.kind==='company').map(v=>({
    v, users:list.filter(p=>p.vehicle_id===v.id&&p.status!=='canceled')
  }))
  // 그 날 내용이 있는 묶음만 세운다
  const filled=rows.map(r=>({row:r,items:list.filter(p=>r.match(p)).sort(sortByGroup)}))
                   .filter(g=>g.items.length>0)

  return(
    <div style={{display:'grid',gridTemplateColumns:'minmax(0,1.4fr) minmax(0,1fr)',gap:16}}>
      <Card title={`${date} (${dayName(date)}) 일정 ${list.length}건 · ${GROUP_BYS.find(g=>g.v===groupBy)?.label}별`}>
        <div style={{marginBottom:10}}>
          <button onClick={()=>onOpenCell({date})}
            style={{padding:'7px 14px',borderRadius:7,border:'1px solid #1a56db',background:'#eff6ff',
              color:'#1a56db',cursor:'pointer',fontSize:12,fontWeight:700}}>+ 이 날짜에 추가</button>
        </div>
        {list.length===0
          ?<div style={{fontSize:12,color:'#6b7280'}}>등록된 일정이 없습니다.</div>
          :filled.map(({row,items})=>(
            <div key={row.key} style={{marginBottom:14}}>
              <div style={{display:'flex',alignItems:'center',gap:6,padding:'6px 8px',
                background:'#f1f5f9',borderRadius:6,marginBottom:6}}>
                <span style={{display:'inline-block',width:8,height:8,borderRadius:2,background:row.color}}/>
                <strong style={{fontSize:12}}>{row.label}</strong>
                {row.sub&&<span style={{fontSize:10,color:'#6b7280'}}>{row.sub}</span>}
                <span style={{fontSize:11,color:'#6b7280'}}>· {items.length}건</span>
                {groupBy==='vehicle'&&row.key.startsWith('v')&&items.length>1&&(
                  <span style={{fontSize:10,color:'#991b1b',fontWeight:700}}>겹침</span>
                )}
              </div>
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <tbody>
                  {items.map(p=>{
                    const tp=TRANSPORT_MAP[p.transport]||TRANSPORT_MAP.office
                    const personal=p.use_type==='personal'
                    const vacation=p.use_type==='vacation'
                    const dist=p.est_distance_km!=null
                      ?(p.round_trip?p.est_distance_km*2:p.est_distance_km):null
                    return(
                      <tr key={p.id} onClick={()=>onOpenPlan(p)} style={{cursor:'pointer'}}>
                        <td style={{...tdS,textAlign:'left',width:96,fontWeight:700}}>
                          <span style={{display:'inline-block',width:8,height:8,borderRadius:2,marginRight:6,
                            background:workerColor(p.worker_id,workers)}}/>
                          {p.worker_name}
                        </td>
                        <td style={{...tdS,width:64}}>{SLOT_MAP[p.slot]}</td>
                        <td style={{...tdS,textAlign:'left'}}>
                          {vacation
                            ?<em style={{color:'#047857'}}>🌴 휴가 · {p.vacation_type||''}</em>
                            :personal
                              ?<em style={{color:'#6b7280'}}>개인 사용</em>
                              :p.transport==='office'
                                ?'사무실'
                                :(p.place_name||p.place_text||'-')}
                          {p.purpose&&<div style={{fontSize:10,color:'#6b7280'}}>{p.purpose}</div>}
                        </td>
                        <td style={{...tdS,width:120}}>
                          {vacation?'-':`${tp.icon} ${p.vehicle_name||tp.label}`}
                        </td>
                        <td style={{...tdS,width:64}}>{dist!=null?`${dist}km`:'-'}</td>
                        <td style={{...tdS,width:96}} onClick={e=>e.stopPropagation()}>
                          {p.actual_id
                            ?<button onClick={()=>onOpenActual(p)}
                              style={{padding:'3px 8px',borderRadius:6,border:'1px solid #059669',
                                background:'#ecfdf5',color:'#059669',cursor:'pointer',fontSize:11,fontWeight:700}}>
                              {p.actual_distance_km!=null?`${p.actual_distance_km}km`:'완료'}
                              {p.as_planned===false?' ↺':''}
                            </button>
                            :<button onClick={()=>onOpenActual(p)}
                              style={{padding:'3px 8px',borderRadius:6,
                                border:'1px solid '+(p.plan_date<todayStr?'#fdba74':'#e5e7eb'),
                                background:'#fff',color:p.plan_date<todayStr?'#9a3412':'#6b7280',
                                cursor:'pointer',fontSize:11,fontWeight:600}}>
                              실적 입력
                            </button>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
      </Card>
      <div>
        <Card title="차량 배정">
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead><tr><th style={thS}>차량</th><th style={thS}>사용자</th></tr></thead>
            <tbody>
              {carRows.map(({v,users})=>(
                <tr key={v.id} style={{background:users.length>1?'#fef2f2':'transparent'}}>
                  <td style={{...tdS,textAlign:'left',fontWeight:600}}>
                    {v.name}<div style={{fontSize:10,color:'#6b7280'}}>{v.plate}</div>
                  </td>
                  <td style={tdS}>
                    {users.length===0
                      ?<span style={{color:'#9ca3af',fontSize:11}}>비어 있음</span>
                      :users.map(u=>(
                        <div key={u.id} style={{fontSize:11}}>
                          {u.worker_name} <span style={{color:'#6b7280'}}>({SLOT_MAP[u.slot]})</span>
                          {u.use_type==='personal'&&<span style={{color:'#92400e'}}> 개인</span>}
                        </div>
                      ))}
                    {users.length>1&&<div style={{fontSize:10,color:'#991b1b',fontWeight:700}}>겹침</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        {date>=todayStr&&noPlan.length>0&&(
          <Card title="계획 미입력">
            <div style={{fontSize:12,color:'#6b7280',lineHeight:1.7}}>
              {noPlan.map(w=>w.name).join(' · ')}
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

// 연 뷰 — 월별 요약. 외근이 어느 달에 몰렸는지 본다.
function ScheduleYear({year,plans,workers,onPickMonth}){
  const months=Array.from({length:12},(_,i)=>`${year}-${String(i+1).padStart(2,'0')}`)
  const stat=months.map(m=>{
    const rows=plans.filter(p=>p.plan_date.slice(0,7)===m)
    const out=rows.filter(p=>p.transport!=='office'&&p.use_type!=='vacation')
    const vac=rows.filter(p=>p.use_type==='vacation')
    return {m, total:rows.length, out:out.length, vac:vac.length,
            people:new Set(rows.map(p=>p.worker_id)).size,
            car:rows.filter(p=>p.vehicle_id).length}
  })
  const max=Math.max(1,...stat.map(s=>s.out))
  return(
    <Card title={`${year}년 월별 요약`}>
      <table style={{width:'100%',borderCollapse:'collapse'}}>
        <thead><tr>
          <th style={thS}>월</th><th style={thS}>일정</th><th style={thS}>외근</th>
          <th style={thS}>차량 사용</th><th style={thS}>휴가</th><th style={thS}>인원</th><th style={{...thS,width:'34%'}}>외근 분포</th>
        </tr></thead>
        <tbody>
          {stat.map(s=>(
            <tr key={s.m} onClick={()=>onPickMonth(s.m)} style={{cursor:'pointer'}}>
              <td style={{...tdS,fontWeight:700}}>{Number(s.m.slice(5,7))}월</td>
              <td style={tdS}>{s.total?`${s.total}건`:'-'}</td>
              <td style={tdS}>{s.out?`${s.out}건`:'-'}</td>
              <td style={tdS}>{s.car?`${s.car}건`:'-'}</td>
              <td style={tdS}>{s.vac?`${s.vac}일`:'-'}</td>
              <td style={tdS}>{s.people?`${s.people}명`:'-'}</td>
              <td style={{...tdS,padding:'6px 10px'}}>
                <div style={{background:'#f1f5f9',borderRadius:4,height:12,overflow:'hidden'}}>
                  <div style={{width:`${s.out/max*100}%`,height:'100%',background:'#3b82f6'}}/>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{marginTop:10,fontSize:11,color:'#6b7280'}}>
        💡 읽는 법 — 「외근」은 사무실이 아닌 일정입니다. 월을 누르면 그 달 달력으로 갑니다.
      </div>
    </Card>
  )
}

// 장소 선택 창.
// 장소가 수십 개가 되면 콤보 상자로는 고를 수 없다. 검색과 관리를 함께 둔다.
function PlacePicker({places,onPick,onClose,onChanged,showToast}){
  const [q,setQ]=useState('')
  const [editing,setEditing]=useState(null)   // 수정 중인 장소
  const [adding,setAdding]=useState(null)     // 새 장소
  const [busy,setBusy]=useState(false)

  const norm=(s)=>String(s||'').toLowerCase().replace(/\s/g,'')
  const key=norm(q)
  const list=places.filter(p=>!key||norm(p.name).includes(key)||norm(p.address).includes(key))

  const inputS={padding:'7px 10px',border:'1px solid #e5e7eb',borderRadius:7,fontSize:13,width:'100%'}
  const smallBtn={padding:'4px 9px',borderRadius:6,fontSize:11,cursor:'pointer',fontWeight:600}

  async function saveEdit(){
    if(!editing.name?.trim()){showToast('장소 이름을 입력해 주세요');return}
    try{
      setBusy(true)
      await updatePlace(editing.id,{
        name:editing.name.trim(), address:editing.address||null,
        distance_km:editing.distance_km===''?null:editing.distance_km,
        travel_min:editing.travel_min===''?null:editing.travel_min,
        category:editing.category||null,
      })
      showToast('장소를 수정했습니다')
      setEditing(null); await onChanged()
    }catch(e){showToast('수정 실패: '+e.message)}
    finally{setBusy(false)}
  }

  async function hide(p){
    if(!confirm(`「${p.name}」을 목록에서 숨길까요?\n\n지난 계획·실적은 그대로 남습니다.`))return
    try{ setBusy(true); await hidePlace(p.id); showToast('숨겼습니다'); await onChanged() }
    catch(e){ showToast('실패: '+e.message) }
    finally{ setBusy(false) }
  }

  async function addNew(force=false){
    if(!adding?.name?.trim()){showToast('장소 이름을 입력해 주세요');return}
    try{
      setBusy(true)
      const created=await addPlace({...adding,name:adding.name.trim(),force})
      showToast(`장소 「${created.name}」 등록`)
      setAdding(null); await onChanged(); onPick(created)
    }catch(e){
      if(e.status===409&&e.similar?.length&&!force){
        const names=e.similar.map(s=>`· ${s.name}${s.distance_km!=null?` (${s.distance_km}km)`:''}`).join('\n')
        if(confirm(`비슷한 이름의 장소가 이미 있습니다.\n\n${names}\n\n같은 곳이면 「취소」를 누르고 위 장소를 골라 주세요.\n다른 곳이면 「확인」을 눌러 새로 등록합니다.`)){
          await addNew(true)
        }
      }else showToast('등록 실패: '+e.message)
    }finally{setBusy(false)}
  }

  return(
    <div onClick={onClose}
      style={{position:'fixed',inset:0,background:'rgba(17,24,39,.5)',zIndex:9500,
        display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'40px 16px',overflowY:'auto'}}>
      <div onClick={e=>e.stopPropagation()}
        style={{background:'#fff',borderRadius:12,width:'100%',maxWidth:640,padding:20,
          maxHeight:MODAL_MAX_H,overflowY:'auto',
          boxShadow:'0 20px 50px rgba(0,0,0,.3)'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
          <strong style={{fontSize:16}}>장소 선택</strong>
          <button onClick={onClose} style={{border:'none',background:'none',fontSize:20,cursor:'pointer',color:'#6b7280'}}>×</button>
        </div>

        {/* 사무실은 고정 항목 — 장소 목록에 넣지 않는다 */}
        <button onClick={()=>onPick({id:OFFICE_PLACE,name:'사무실 (내근)'})}
          style={{width:'100%',padding:'12px',borderRadius:8,marginBottom:12,cursor:'pointer',
            border:'1px solid #1a56db',background:'#eff6ff',color:'#1a56db',
            fontSize:14,fontWeight:700,textAlign:'left'}}>
          🏢 사무실 (내근) <span style={{fontWeight:500,fontSize:12,opacity:.8}}>— 이동 없음</span>
        </button>

        <div style={{display:'flex',gap:8,marginBottom:12}}>
          <input value={q} onChange={e=>setQ(e.target.value)} autoFocus
            placeholder="장소 이름·주소로 검색" style={inputS}/>
          <button onClick={()=>setAdding({name:q,category:'고객사'})}
            style={{...smallBtn,padding:'7px 14px',fontSize:12,border:'1px solid #1a56db',
              background:'#fff',color:'#1a56db',whiteSpace:'nowrap'}}>+ 새 장소</button>
        </div>

        {adding&&(
          <div style={{border:'1px dashed #93c5fd',borderRadius:8,padding:12,marginBottom:12,background:'#f8fbff'}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              <input placeholder="장소 이름" value={adding.name}
                onChange={e=>setAdding({...adding,name:e.target.value})} style={inputS}/>
              <select value={adding.category||''} onChange={e=>setAdding({...adding,category:e.target.value})} style={inputS}>
                {PLACE_CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
              </select>
              <input placeholder="주소 (선택)" value={adding.address||''}
                onChange={e=>setAdding({...adding,address:e.target.value})}
                style={{...inputS,gridColumn:'1 / -1'}}/>
              <input type="number" step="0.1" placeholder="편도 거리(km)" value={adding.distance_km||''}
                onChange={e=>setAdding({...adding,distance_km:e.target.value})} style={inputS}/>
              <input type="number" placeholder="편도 시간(분)" value={adding.travel_min||''}
                onChange={e=>setAdding({...adding,travel_min:e.target.value})} style={inputS}/>
            </div>
            <div style={{fontSize:11,color:'#6b7280',margin:'8px 0'}}>
              거리·시간은 한 번만 넣으면 다음부터 자동으로 채워집니다.
            </div>
            <div style={{display:'flex',gap:8}}>
              <button onClick={()=>addNew(false)} disabled={busy}
                style={{flex:1,...smallBtn,padding:'8px',border:'none',background:'#1a56db',color:'#fff',fontSize:12}}>
                등록하고 고르기
              </button>
              <button onClick={()=>setAdding(null)}
                style={{...smallBtn,padding:'8px 14px',border:'1px solid #e5e7eb',background:'#fff',color:'#6b7280',fontSize:12}}>취소</button>
            </div>
          </div>
        )}

        <div style={{maxHeight:340,overflowY:'auto',border:'1px solid #e5e7eb',borderRadius:8}}>
          {list.length===0
            ?<div style={{padding:'22px 14px',textAlign:'center',fontSize:12,color:'#6b7280'}}>
              {places.length===0?'등록된 장소가 없습니다. 「+ 새 장소」로 넣어 주세요.':'검색 결과가 없습니다.'}
            </div>
            :<table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr>
                <th style={{...thS,textAlign:'left'}}>장소</th>
                <th style={{...thS,width:70}}>거리</th>
                <th style={{...thS,width:60}}>시간</th>
                <th style={{...thS,width:110}}>관리</th>
              </tr></thead>
              <tbody>
                {list.map(p=>(
                  editing?.id===p.id
                    ?<tr key={p.id}><td colSpan={4} style={{padding:10,background:'#f8fbff'}}>
                      <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr',gap:6,marginBottom:6}}>
                        <input value={editing.name} onChange={e=>setEditing({...editing,name:e.target.value})} style={inputS}/>
                        <input type="number" step="0.1" placeholder="km" value={editing.distance_km??''}
                          onChange={e=>setEditing({...editing,distance_km:e.target.value})} style={inputS}/>
                        <input type="number" placeholder="분" value={editing.travel_min??''}
                          onChange={e=>setEditing({...editing,travel_min:e.target.value})} style={inputS}/>
                      </div>
                      <div style={{display:'grid',gridTemplateColumns:'2fr 1fr',gap:6,marginBottom:8}}>
                        <input placeholder="주소" value={editing.address||''}
                          onChange={e=>setEditing({...editing,address:e.target.value})} style={inputS}/>
                        <select value={editing.category||''} onChange={e=>setEditing({...editing,category:e.target.value})} style={inputS}>
                          {PLACE_CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div style={{display:'flex',gap:6}}>
                        <button onClick={saveEdit} disabled={busy}
                          style={{...smallBtn,border:'none',background:'#1a56db',color:'#fff'}}>저장</button>
                        <button onClick={()=>setEditing(null)}
                          style={{...smallBtn,border:'1px solid #e5e7eb',background:'#fff',color:'#6b7280'}}>취소</button>
                      </div>
                    </td></tr>
                    :<tr key={p.id} style={{cursor:'pointer'}}>
                      <td onClick={()=>onPick(p)} style={{...tdS,textAlign:'left'}}>
                        <strong style={{fontSize:12}}>{p.name}</strong>
                        {p.category&&<span style={{fontSize:10,color:'#6b7280',marginLeft:6}}>{p.category}</span>}
                        {p.address&&<div style={{fontSize:10,color:'#9ca3af'}}>{p.address}</div>}
                      </td>
                      <td onClick={()=>onPick(p)} style={tdS}>{p.distance_km!=null?`${p.distance_km}km`:'-'}</td>
                      <td onClick={()=>onPick(p)} style={tdS}>{p.travel_min!=null?`${p.travel_min}분`:'-'}</td>
                      <td style={{...tdS,whiteSpace:'nowrap'}}>
                        <button onClick={()=>setEditing({...p})}
                          style={{...smallBtn,border:'1px solid #e5e7eb',background:'#fff',color:'#374151',marginRight:4}}>수정</button>
                        <button onClick={()=>hide(p)}
                          style={{...smallBtn,border:'1px solid #fca5a5',background:'#fff',color:'#dc2626'}}>숨김</button>
                      </td>
                    </tr>
                ))}
              </tbody>
            </table>}
        </div>
        <div style={{marginTop:10,fontSize:11,color:'#6b7280'}}>
          줄을 누르면 그 장소가 선택됩니다. 「숨김」은 목록에서만 감추고 지난 기록은 그대로 남습니다.
        </div>
      </div>
    </div>
  )
}

// 로그인 창 — 정산 화면에만 필요하다.
// 계정·세션을 KPI 추적 시스템과 공유하므로, KPI 에서 이미 로그인했다면 이 창이 뜨지 않는다.
function LoginDialog({onClose,onLoggedIn,showToast}){
  const [id,setId]=useState('')
  const [pw,setPw]=useState('')
  const [busy,setBusy]=useState(false)
  const [err,setErr]=useState('')
  const inputS={padding:'9px 11px',border:'1px solid #e5e7eb',borderRadius:7,fontSize:13,width:'100%'}

  async function submit(){
    if(!id.trim()||!pw){setErr('아이디와 비밀번호를 입력해 주세요.');return}
    try{
      setBusy(true); setErr('')
      const me=await login(id.trim(),pw)
      showToast(`${me.name} 님으로 로그인했습니다`)
      onLoggedIn(me)
    }catch(e){ setErr(e.message) }
    finally{ setBusy(false) }
  }

  return(
    <div onClick={onClose}
      style={{position:'fixed',inset:0,background:'rgba(17,24,39,.5)',zIndex:9600,
        display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'80px 16px',overflowY:'auto'}}>
      <div onClick={e=>e.stopPropagation()}
        style={{background:'#fff',borderRadius:12,width:'100%',maxWidth:380,padding:24,
          maxHeight:'calc(100vh - 160px)',overflowY:'auto',
          boxShadow:'0 20px 50px rgba(0,0,0,.3)'}}>
        <strong style={{fontSize:16,display:'block',marginBottom:6}}>정산 화면 로그인</strong>
        <div style={{fontSize:12,color:'#6b7280',marginBottom:16}}>
          KPI 추적 시스템과 <strong>같은 계정</strong>을 씁니다 (회사 메일 주소).
        </div>
        <div style={{marginBottom:10}}>
          <input value={id} onChange={e=>setId(e.target.value)} autoFocus
            onKeyDown={e=>e.key==='Enter'&&submit()}
            placeholder="회사 메일 주소" style={inputS}/>
        </div>
        <div style={{marginBottom:12}}>
          <input type="password" value={pw} onChange={e=>setPw(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&submit()}
            placeholder="비밀번호" style={inputS}/>
        </div>
        {err&&<div style={{fontSize:12,color:'#b91c1c',marginBottom:12}}>{err}</div>}
        <div style={{display:'flex',gap:8}}>
          <button onClick={submit} disabled={busy}
            style={{flex:1,padding:'11px',borderRadius:8,border:'none',background:'#1a56db',
              color:'#fff',cursor:'pointer',fontSize:14,fontWeight:700}}>
            {busy?'확인 중…':'로그인'}
          </button>
          <button onClick={onClose} style={{padding:'11px 16px',borderRadius:8,
            border:'1px solid #e5e7eb',background:'#fff',cursor:'pointer',fontSize:14}}>취소</button>
        </div>
        <div style={{fontSize:11,color:'#9ca3af',marginTop:12}}>
          달력과 계획 입력에는 로그인이 필요 없습니다. 금액이 보이는 정산 화면만 막습니다.
        </div>
      </div>
    </div>
  )
}

// 정산 화면 — 월별로 «직원이 회사에 낼 돈» 과 «회사가 직원에게 줄 것» 을 모아 본다.
// 계산은 서버가 한다(현행 정산기준 문서를 그대로 따른다). 화면은 보여 주고 승인만 요청한다.
function ScheduleSettlement({me,onNeedLogin,onLogout,onOpenActual,showToast}){
  const [ym,setYm]=useState(()=>{
    // 기본은 «지난달» — 익월 초에 정산하는 현행 규칙에 맞춘다
    const d=new Date(); d.setDate(1); d.setMonth(d.getMonth()-1)
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
  })
  const [data,setData]=useState(null)
  const [loading,setLoading]=useState(false)
  const [busy,setBusy]=useState(false)

  const settled=data?.saved?.some(s=>s.status==='settled')
  const settledBy=data?.saved?.find(s=>s.settled_by_name)?.settled_by_name
  const settledAt=data?.saved?.find(s=>s.settled_at)?.settled_at

  async function load(target=ym){
    setLoading(true)
    try{ setData(await getSettlement(target)) }
    catch(e){
      if(e.status===401){ setData(null); onNeedLogin() }
      else showToast('정산 조회 실패: '+e.message)
    }
    finally{ setLoading(false) }
  }

  useEffect(()=>{ if(me) load(ym) /* eslint-disable-next-line react-hooks/exhaustive-deps */ },[me,ym])

  async function approve(){
    if(!confirm(`${ym} 정산을 확정할까요?\n\n· 이 달 금액이 승인 시점 값으로 저장됩니다\n· 이 달 실적은 수정할 수 없게 잠깁니다\n\n정정이 필요하면 나중에 잠금을 해제하고 다시 승인할 수 있습니다.`))return
    try{ setBusy(true); const r=await approveSettlement(ym)
      showToast(`정산 확정 — ${r.workers}명 · 실적 ${r.locked}건 잠금`); await load(ym)
    }catch(e){ showToast('승인 실패: '+e.message) }
    finally{ setBusy(false) }
  }

  async function reopen(){
    if(!confirm(`${ym} 정산 잠금을 해제할까요?\n\n실적을 다시 고칠 수 있게 되며, 정정 후 다시 승인해야 확정됩니다.`))return
    try{ setBusy(true); const r=await reopenSettlement(ym)
      showToast(`잠금 해제 — 실적 ${r.unlocked}건`); await load(ym)
    }catch(e){ showToast('해제 실패: '+e.message) }
    finally{ setBusy(false) }
  }

  // 로그인 전
  if(!me){
    return(
      <Card title="정산">
        <div style={{textAlign:'center',padding:'30px 10px'}}>
          <div style={{fontSize:13,color:'#374151',marginBottom:6}}>
            정산 화면은 <strong>로그인</strong>이 필요합니다.
          </div>
          <div style={{fontSize:12,color:'#6b7280',marginBottom:18}}>
            금액과 개인 사용 내역이 보이기 때문입니다. 달력·계획 입력은 그대로 쓰실 수 있습니다.
          </div>
          <button onClick={onNeedLogin}
            style={{padding:'10px 22px',borderRadius:8,border:'none',background:'#1a56db',
              color:'#fff',cursor:'pointer',fontSize:14,fontWeight:700}}>로그인</button>
        </div>
      </Card>
    )
  }

  const won=(n)=>Number(n||0).toLocaleString()
  const money=(n)=>n?`${won(n)}원`:'-'

  // 월 선택지 — 올해와 지난해
  const months=[]
  const now=new Date()
  for(let y=now.getFullYear();y>=now.getFullYear()-1;y--){
    for(let m=12;m>=1;m--) months.push(`${y}-${String(m).padStart(2,'0')}`)
  }

  const chargeTotal=(data?.workers||[]).reduce((s,w)=>s+w.charge_total,0)
  const literTotal=(data?.workers||[]).reduce((s,w)=>s+w.own_car_liter,0)
  const transitTotal=(data?.workers||[]).reduce((s,w)=>s+w.transit_amount,0)

  return(
    <div>
      <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,padding:'12px 16px',
        marginBottom:16,display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
        <select value={ym} onChange={e=>setYm(e.target.value)}
          style={{padding:'7px 10px',border:'1px solid #e5e7eb',borderRadius:7,fontSize:13}}>
          {months.map(m=><option key={m} value={m}>{m.slice(0,4)}년 {Number(m.slice(5,7))}월</option>)}
        </select>
        {settled
          ?<span style={{fontSize:12,fontWeight:700,color:'#065f46',background:'#ecfdf5',
            border:'1px solid #6ee7b7',borderRadius:20,padding:'4px 12px'}}>
            정산 완료{settledBy?` · ${settledBy}`:''}
            {settledAt?` · ${String(settledAt).slice(0,10)}`:''}
          </span>
          :<span style={{fontSize:12,fontWeight:700,color:'#9a3412',background:'#fff7ed',
            border:'1px solid #fdba74',borderRadius:20,padding:'4px 12px'}}>미정산</span>}
        <div style={{flex:1}}/>
        <span style={{fontSize:12,color:'#6b7280'}}>
          {me.name} ({me.role}{me.can_approve?' · 승인 권한':''})
        </span>
        <button onClick={onLogout}
          style={{padding:'6px 12px',borderRadius:7,border:'1px solid #e5e7eb',background:'#fff',
            color:'#6b7280',cursor:'pointer',fontSize:12}}>로그아웃</button>
      </div>

      {loading&&<div style={{fontSize:12,color:'#6b7280',marginBottom:10}}>불러오는 중…</div>}

      {/* 계획 대비 실적 현황 — 「왜 비어 있는지」를 화면이 설명해야 한다.
          정산은 «실적» 만 집계한다. 계획은 예정이고 금액 근거가 될 수 없다. */}
      {data&&(
        <div style={{background:'#f9fafb',border:'1px solid #e5e7eb',borderRadius:8,
          padding:'10px 14px',marginBottom:14,fontSize:12,lineHeight:1.8}}>
          <strong>계획 {data.plan_count ?? 0}건 · 실적 {data.actual_count}건</strong>
          <span style={{color:'#6b7280',marginLeft:8}}>
            정산은 실적만 집계합니다 (실제 주행거리·비용).
          </span>
          {(data.upcoming_count ?? 0)>0&&(
            <div style={{color:'#6b7280'}}>
              예정 {data.upcoming_count}건 — 날짜가 지난 뒤에 실적을 넣습니다.
            </div>
          )}
          {(data.pending?.length ?? 0)>0&&(
            <div style={{marginTop:8,padding:'8px 10px',background:'#fff7ed',
              border:'1px solid #fdba74',borderRadius:7,color:'#9a3412'}}>
              <strong>⚠ 실적을 넣지 않은 지난 일정 {data.pending.length}건</strong>
              <span style={{marginLeft:6,opacity:.85}}>— 지금 넣을 수 있습니다.</span>
              <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:8}}>
                {data.pending.slice(0,12).map(p=>(
                  <button key={p.id} onClick={()=>onOpenActual&&onOpenActual(p)}
                    style={{padding:'4px 9px',borderRadius:6,border:'1px solid #fdba74',
                      background:'#fff',color:'#9a3412',cursor:'pointer',fontSize:11,fontWeight:600}}>
                    {mdLabel(p.plan_date)} {p.worker_name}
                    {p.vehicle_name?` · ${p.vehicle_name}`:''}
                  </button>
                ))}
                {data.pending.length>12&&(
                  <span style={{fontSize:11,alignSelf:'center'}}>외 {data.pending.length-12}건</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {data&&data.actual_count===0
        ?<Card title={`${ym} 정산`}>
          <div style={{fontSize:12,color:'#6b7280',lineHeight:1.8}}>
            {(data.plan_count ?? 0)===0
              ?<>이 달에는 <strong>계획도 실적도 없습니다.</strong> 스케줄에서 일정을 먼저 등록해 주십시오.</>
              :(data.pending?.length ?? 0)>0
                ?<>계획은 있지만 <strong>실적이 아직 없습니다.</strong> 위의 미입력 일정을 눌러
                  주행거리·하이패스·주유비를 넣으면 이 화면에 금액이 나옵니다.</>
                :<>이 달 계획은 모두 <strong>아직 오지 않은 일정</strong>입니다.
                  다녀오신 뒤 실적을 넣으면 정산됩니다.</>}
          </div>
        </Card>
        :data&&(
        <>
          <Metrics items={[
            {label:'회사에 입금 (개인 사용)',value:won(chargeTotal),unit:'원',color:'#b45309'},
            {label:'주유 환급',value:Math.round(literTotal*100)/100,unit:'L',color:'#047857'},
            {label:'대중교통 실비',value:won(transitTotal),unit:'원'},
            {label:'실적',value:data.actual_count,unit:'건'},
          ]}/>

          <Card title="사람별">
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',minWidth:760}}>
                <thead><tr>
                  <th style={{...thS,textAlign:'left'}}>직원</th>
                  <th style={thS}>개인 사용</th>
                  <th style={thS}>단가 적용</th>
                  <th style={thS}>하이패스</th>
                  <th style={thS}>입금액</th>
                  <th style={thS}>자차 업무</th>
                  <th style={thS}>환급</th>
                  <th style={thS}>대중교통</th>
                </tr></thead>
                <tbody>
                  {data.workers.map(w=>(
                    <tr key={w.worker_id}>
                      <td style={{...tdS,textAlign:'left',fontWeight:700}}>
                        {w.worker_name}
                        {w.team&&<div style={{fontSize:10,color:'#6b7280',fontWeight:500}}>{w.team}</div>}
                      </td>
                      <td style={tdS}>{w.personal_km?`${w.personal_km}km`:'-'}</td>
                      <td style={tdS}>{money(w.personal_amount)}</td>
                      <td style={tdS}>{money(w.toll_amount)}</td>
                      <td style={{...tdS,fontWeight:700,color:w.charge_total?'#b45309':'#9ca3af'}}>
                        {money(w.charge_total)}
                      </td>
                      <td style={tdS}>{w.own_car_km?`${w.own_car_km}km`:'-'}</td>
                      <td style={{...tdS,fontWeight:700,color:w.own_car_liter?'#047857':'#9ca3af'}}>
                        {w.own_car_liter?`${w.own_car_liter}L`:'-'}
                        {w.own_car_missing_efficiency&&
                          <div style={{fontSize:10,color:'#c2410c',fontWeight:600}}>연비 미입력</div>}
                      </td>
                      <td style={tdS}>{money(w.transit_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{marginTop:10,fontSize:11,color:'#6b7280',lineHeight:1.8}}>
              💡 <strong>입금액</strong> = 개인 사용 거리 × 차량 단가 + 하이패스 — 직원이 회사 계좌로 입금합니다.<br/>
              💡 <strong>환급</strong> = 자차 업무 거리 ÷ 그 차의 연비 — 금액이 아니라 <strong>주유 한도(리터)</strong>로 지급합니다.
            </div>
          </Card>

          <Card title="차량별">
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr>
                <th style={{...thS,textAlign:'left'}}>차량</th>
                <th style={thS}>총 주행</th>
                <th style={thS}>업무</th>
                <th style={thS}>개인</th>
                <th style={thS}>하이패스</th>
                <th style={thS}>주유·충전</th>
              </tr></thead>
              <tbody>
                {data.vehicles.length===0
                  ?<tr><td colSpan={6} style={{...tdS,color:'#6b7280'}}>차량 사용 기록이 없습니다.</td></tr>
                  :data.vehicles.map(v=>(
                    <tr key={v.vehicle_id}>
                      <td style={{...tdS,textAlign:'left',fontWeight:600}}>
                        {v.name}
                        <div style={{fontSize:10,color:'#6b7280'}}>
                          {v.plate||''} {v.kind==='own'?'· 자차':''}
                        </div>
                      </td>
                      <td style={tdS}>{v.total_km}km</td>
                      <td style={tdS}>{v.business_km?`${v.business_km}km`:'-'}</td>
                      <td style={tdS}>{v.personal_km?`${v.personal_km}km`:'-'}</td>
                      <td style={tdS}>{money(v.toll_amount)}</td>
                      <td style={tdS}>{money(v.fuel_amount)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Card>

          <Card title="정산 확정">
            {data.can_approve
              ?<div>
                <div style={{fontSize:12,color:'#374151',marginBottom:12,lineHeight:1.7}}>
                  확정하면 이 달 금액이 <strong>승인 시점 값으로 저장</strong>되고 실적이 잠깁니다.
                  나중에 단가나 연비가 바뀌어도 지난 정산액은 흔들리지 않습니다.
                </div>
                <div style={{display:'flex',gap:8}}>
                  {!settled
                    ?<button onClick={approve} disabled={busy}
                      style={{padding:'11px 22px',borderRadius:8,border:'none',background:'#059669',
                        color:'#fff',cursor:'pointer',fontSize:14,fontWeight:700}}>
                      {busy?'처리 중…':`${ym} 정산 확정`}
                    </button>
                    :<button onClick={reopen} disabled={busy}
                      style={{padding:'11px 22px',borderRadius:8,border:'1px solid #fca5a5',
                        background:'#fff',color:'#dc2626',cursor:'pointer',fontSize:14,fontWeight:700}}>
                      {busy?'처리 중…':'잠금 해제 (정정)'}
                    </button>}
                </div>
              </div>
              :<div style={{fontSize:12,color:'#6b7280',lineHeight:1.7}}>
                정산 확정은 <strong>대표이사만</strong> 할 수 있습니다.
                {settled
                  ?<div style={{color:'#065f46',marginTop:6}}>이 달은 이미 정산이 완료되었습니다.</div>
                  :<div style={{marginTop:6}}>확정 전이므로 금액이 바뀔 수 있습니다.</div>}
              </div>}
            <div style={{marginTop:14,paddingTop:12,borderTop:'1px solid #e5e7eb',fontSize:11,color:'#6b7280',lineHeight:1.8}}>
              <strong>입금 계좌</strong> — 기업은행 456-010313-04-011 (주) 바이트론 이앤에스<br/>
              정산 주기는 매월 1회(익월 초)입니다.
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

// 실적 입력 창.
// 계획이 실제로 어땠는지 적는다. 여기에 적은 «주행거리·하이패스·주유·대중교통비» 가
// 월 정산의 근거가 된다(설계서 3장).
//   plan     대상 계획 (plan.actual_id 가 있으면 이미 실적이 있는 것)
//   actual   기존 실적 (없으면 새로 만든다)
function ActualDialog({plan,actual,places,vehicles,onClose,onSaved,showToast}){
  const isNew=!actual
  // 계획 거리를 기본값으로 채운다. 왕복이면 2배가 실제 주행거리다.
  const planned=plan.est_distance_km!=null
    ?(plan.round_trip?plan.est_distance_km*2:plan.est_distance_km):null
  const [asPlanned,setAsPlanned]=useState(actual?actual.as_planned:true)
  const [distance,setDistance]=useState(actual?.distance_km??planned??'')
  const [toll,setToll]=useState(actual?.toll_fee??'')
  const [fuel,setFuel]=useState(actual?.fuel_fee??'')
  const [transit,setTransit]=useState(actual?.transit_fee??'')
  const [memo,setMemo]=useState(actual?.memo||'')
  const [busy,setBusy]=useState(false)

  const vacation=plan.use_type==='vacation'
  const personal=plan.use_type==='personal'
  const atOffice=plan.transport==='office'
  const usesVehicle=!!plan.vehicle_id
  const isTransit=plan.transport==='transit'
  const vehicle=vehicles.find(v=>v.id===plan.vehicle_id)
  // 개인 사용이면 그 자리에서 청구액을 보여 준다 — 월말에 놀라지 않게
  const rate=vehicle?.rate_per_km??null
  const charge=(personal&&rate!=null&&distance!=='')
    ?Math.round(Number(distance)*rate)+Number(toll||0):null

  const inputS={padding:'8px 10px',border:'1px solid #e5e7eb',borderRadius:7,fontSize:13,width:'100%'}
  const labelS={fontSize:11,fontWeight:700,color:'#6b7280',marginBottom:4,display:'block'}
  const rowS={marginBottom:12}
  const num=(v)=>v===''||v==null?null:Number(v)

  async function save(){
    // 차량을 쓴 일정은 거리를 받아야 정산이 된다. 사무실·휴가는 필요 없다.
    if(usesVehicle&&(distance===''||Number(distance)<0)){
      showToast('주행거리를 입력해 주세요');return
    }
    const body={
      as_planned:asPlanned,
      distance_km:(atOffice||vacation)?null:num(distance),
      toll_fee:num(toll)??0, fuel_fee:num(fuel)??0, transit_fee:num(transit)??0,
      memo:memo||null,
    }
    try{
      setBusy(true)
      if(isNew) await addActual({plan_id:plan.id,...body})
      else      await updateActual(actual.id,body)
      showToast(isNew?'실적을 기록했습니다':'실적을 수정했습니다')
      await onSaved({focusDate:plan.plan_date})
      onClose()
    }catch(e){
      // 정산이 끝난 달은 서버가 409 로 막는다
      showToast((e.status===409?'':'실패: ')+e.message)
    }finally{setBusy(false)}
  }

  async function remove(){
    if(!confirm('이 실적을 지울까요?\n\n계획은 남고 「확인 필요」 상태로 돌아갑니다.'))return
    try{
      setBusy(true)
      await removeActual(actual.id)
      showToast('실적을 지웠습니다')
      await onSaved({focusDate:plan.plan_date})
      onClose()
    }catch(e){ showToast((e.status===409?'':'실패: ')+e.message) }
    finally{setBusy(false)}
  }

  return(
    <div onClick={onClose}
      style={{position:'fixed',inset:0,background:'rgba(17,24,39,.5)',zIndex:9400,
        display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'40px 16px',overflowY:'auto'}}>
      <div onClick={e=>e.stopPropagation()}
        style={{background:'#fff',borderRadius:12,width:'100%',maxWidth:480,padding:22,
          maxHeight:MODAL_MAX_H,overflowY:'auto',
          boxShadow:'0 20px 50px rgba(0,0,0,.3)'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
          <strong style={{fontSize:16}}>{isNew?'실적 기록':'실적 수정'}</strong>
          <button onClick={onClose} style={{border:'none',background:'none',fontSize:20,cursor:'pointer',color:'#6b7280'}}>×</button>
        </div>

        {/* 어떤 계획에 대한 실적인지 */}
        <div style={{background:'#f9fafb',border:'1px solid #e5e7eb',borderRadius:8,
          padding:'10px 12px',marginBottom:14,fontSize:12,lineHeight:1.7}}>
          <strong>{plan.plan_date} ({dayName(plan.plan_date)})</strong>
          <span style={{marginLeft:6}}>{plan.worker_name}</span>
          <span style={{marginLeft:6,color:'#6b7280'}}>{SLOT_MAP[plan.slot]}</span>
          <div>
            {vacation?`🌴 휴가 · ${plan.vacation_type||''}`
             :personal?'개인 사용'
             :atOffice?'🏢 사무실'
             :`${planIcon(plan)} ${plan.place_name||plan.place_text||'장소 미정'}`}
            {plan.vehicle_name&&<span style={{color:'#6b7280'}}> · {plan.vehicle_name} {plan.vehicle_plate||''}</span>}
          </div>
          {plan.purpose&&<div style={{color:'#6b7280'}}>{plan.purpose}</div>}
          {planned!=null&&<div style={{color:'#6b7280'}}>계획 거리 {planned}km{plan.round_trip?' (왕복)':''}</div>}
        </div>

        <div style={rowS}>
          <label style={labelS}>계획대로 되었습니까</label>
          <div style={{display:'flex',gap:8}}>
            {[{v:true,label:'계획대로'},{v:false,label:'달랐음'}].map(o=>(
              <button key={String(o.v)} onClick={()=>setAsPlanned(o.v)}
                style={{flex:1,padding:'9px',borderRadius:7,cursor:'pointer',fontSize:13,
                  fontWeight:asPlanned===o.v?700:500,
                  border:'1px solid '+(asPlanned===o.v?'#1a56db':'#e5e7eb'),
                  background:asPlanned===o.v?'#eff6ff':'#fff',
                  color:asPlanned===o.v?'#1a56db':'#6b7280'}}>{o.label}</button>
            ))}
          </div>
          {!asPlanned&&(
            <div style={{fontSize:11,color:'#92400e',marginTop:6}}>
              달력 배지에 ↺ 로 표시됩니다. 어떻게 달랐는지는 아래 비고에 적어 주십시오.
            </div>
          )}
        </div>

        {/* 차량을 쓴 일정만 거리를 받는다 */}
        {usesVehicle&&(
          <div style={rowS}>
            <label style={labelS}>주행거리 (km) — 정산 근거</label>
            <input type="number" step="0.1" value={distance} onChange={e=>setDistance(e.target.value)}
              placeholder={planned!=null?`계획 ${planned}km`:'실제 주행거리'} style={inputS}/>
            {planned!=null&&distance!==''&&Math.abs(Number(distance)-planned)>planned*0.3&&(
              <div style={{fontSize:11,color:'#c2410c',marginTop:5}}>
                계획({planned}km)과 30% 이상 차이가 납니다 — 맞는지 확인해 주십시오.
              </div>
            )}
          </div>
        )}

        {!vacation&&(
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,...rowS}}>
            {usesVehicle&&(
              <div>
                <label style={labelS}>하이패스 (원)</label>
                <input type="number" value={toll} onChange={e=>setToll(e.target.value)}
                  placeholder="0" style={inputS}/>
              </div>
            )}
            {usesVehicle&&!personal&&(
              <div>
                <label style={labelS}>주유·충전 (원)</label>
                <input type="number" value={fuel} onChange={e=>setFuel(e.target.value)}
                  placeholder="0" style={inputS}/>
              </div>
            )}
            {isTransit&&(
              <div style={{gridColumn:'1 / -1'}}>
                <label style={labelS}>대중교통비 (원)</label>
                <input type="number" value={transit} onChange={e=>setTransit(e.target.value)}
                  placeholder="0" style={inputS}/>
              </div>
            )}
          </div>
        )}

        {/* 개인 사용은 그 자리에서 청구액을 보여 준다 */}
        {personal&&(
          <div style={{...rowS,background:'#fffbeb',border:'1px solid #fcd34d',borderRadius:8,padding:'10px 12px'}}>
            <div style={{fontSize:12,color:'#92400e'}}>
              <strong>개인 사용 정산</strong>
              {rate!=null
                ?<div style={{marginTop:4}}>
                  {distance!==''?`${distance}km × ${rate}원`:'거리 입력 시 계산'}
                  {toll?` + 하이패스 ${Number(toll).toLocaleString()}원`:''}
                  {charge!=null&&<strong style={{marginLeft:6}}>= {charge.toLocaleString()}원</strong>}
                </div>
                :<div style={{marginTop:4}}>이 차량에 정산 단가가 없습니다 — 설정에서 확인해 주십시오.</div>}
              <div style={{marginTop:4,opacity:.85}}>월말에 합산되어 정산 화면에 나옵니다.</div>
            </div>
          </div>
        )}

        <div style={rowS}>
          <label style={labelS}>비고</label>
          <input value={memo} onChange={e=>setMemo(e.target.value)}
            placeholder="특이사항 (선택)" style={inputS}/>
        </div>

        <div style={{display:'flex',gap:8,marginTop:16}}>
          <button onClick={save} disabled={busy}
            style={{flex:1,padding:'11px',borderRadius:8,border:'none',background:'#059669',
              color:'#fff',cursor:'pointer',fontSize:14,fontWeight:700}}>
            {busy?'처리 중…':(isNew?'실적 기록':'수정 저장')}
          </button>
          {!isNew&&(
            <button onClick={remove} disabled={busy}
              style={{padding:'11px 16px',borderRadius:8,border:'1px solid #fca5a5',
                background:'#fff',color:'#dc2626',cursor:'pointer',fontSize:14}}>삭제</button>
          )}
          <button onClick={onClose} style={{padding:'11px 16px',borderRadius:8,
            border:'1px solid #e5e7eb',background:'#fff',cursor:'pointer',fontSize:14}}>취소</button>
        </div>
      </div>
    </div>
  )
}

// 계획 입력·확인 창.
//   editing=null           새 계획
//   editing=계획           기존 계획 — 실적이 없으면 그 자리에서 고칠 수 있다
//   copyFrom=계획          그 내용으로 채운 새 계획 (날짜만 비어 있다)
// 새 계획은 날짜를 «여러 개» 고를 수 있다 — 같은 일정을 여러 날 넣는 일이 잦다.
function PlanDialog({editing,copyFrom,defaultDate,defaultWorkerId,defaultPlaceId,defaultVehicleId,
                     defaultTransport,defaultKind,workers,places,vehicles,
                     onClose,onSaved,onCopy,onOpenActual,showToast}){
  const isNew=!editing
  const src=editing||copyFrom||null        // 값을 가져올 원본
  // 실적이 등록된 계획은 고칠 수 없다. 계획을 바꾸면 실적·정산 근거와 어긋난다.
  const locked=!!editing?.actual_id
  const canEdit=isNew||!locked
  const [workerId,setWorkerId]=useState(src?.worker_id||defaultWorkerId||workers[0]?.id||'')
  const [date,setDate]=useState(editing?.plan_date||defaultDate||today())
  // 새 계획에서 고른 날짜들. 수정 모드에서는 쓰지 않는다.
  const [dates,setDates]=useState(isNew?(defaultDate?[defaultDate]:[today()]):[])
  const [slot,setSlot]=useState(src?.slot||'allday')
  const [useType,setUseType]=useState(src?.use_type||'business')
  // 유형 — 무엇을 등록하는가. 이것이 최상위이고 뒤 칸은 여기에 따라 달라진다.
  // 달력에서 «차량 줄»·«휴가 줄» 의 칸을 눌러 들어오면 그 유형으로 시작한다.
  const [kind,setKind]=useState(
    src ? (src.use_type==='vacation'?'vacation':(src.use_type==='personal'?'vehicle':
          (src.place_id||src.transport==='office'?'work':'vehicle')))
        : (defaultKind||(defaultVehicleId?'vehicle':'work')))
  const [vacationType,setVacationType]=useState(src?.vacation_type||VACATION_TYPES[0])
  const [pickerOpen,setPickerOpen]=useState(false)   // 장소 선택 창
  // 장소가 상위 값이다. 사무실이면 이동 수단·차량·거리를 묻지 않는다.
  const [placeId,setPlaceId]=useState(
    src ? (src.transport==='office'?OFFICE_PLACE:(src.place_id||''))
        : (defaultPlaceId??OFFICE_PLACE))
  const [purpose,setPurpose]=useState(src?.purpose||'')
  const [transport,setTransport]=useState(
    src?.transport || defaultTransport ||
    // 달력에서 외부 장소 줄을 눌러 들어오면 이동 수단을 «미선택» 으로 둔다
    (defaultPlaceId&&defaultPlaceId!==OFFICE_PLACE?'':'office'))
  const [vehicleId,setVehicleId]=useState(src?.vehicle_id||defaultVehicleId||'')
  const [roundTrip,setRoundTrip]=useState(src?src.round_trip:true)
  const [busy,setBusy]=useState(false)

  const isWork=kind==='work'
  const isVehicleOnly=kind==='vehicle'
  const isVacation=kind==='vacation'
  const personal=isVehicleOnly&&useType==='personal'
  // 사무실 내근 — 장소가 「사무실」이면 이동이 없으므로 뒤 칸이 전부 필요 없다
  const atOffice=isWork&&placeId===OFFICE_PLACE
  const tp=TRANSPORT_MAP[atOffice?'office':transport]||TRANSPORT_MAP.office
  const place=places.find(p=>String(p.id)===String(placeId))
  // 장소를 고르면 거리·시간이 자동으로 들어온다 (한 번 입력해 두면 계속 재사용)
  const estKm=(atOffice||!isWork)?null:(place?.distance_km??null)
  const estMin=(atOffice||!isWork)?null:(place?.travel_min??null)
  const showKm=estKm!=null?(roundTrip?estKm*2:estKm):null
  const showMin=estMin!=null?(roundTrip?estMin*2:estMin):null
  // 외부 장소를 골랐는지 (이동 수단을 물어야 하는 상태)
  const needsTransport=isWork&&!atOffice&&!!placeId
  // 차량 예약은 이동 수단이 «법인차량 또는 자차» 뿐이다(대중교통은 차량이 아니다)
  const vehicleTransports=OUT_TRANSPORTS.filter(t=>t.needsVehicle)

  const inputS={padding:'7px 10px',border:'1px solid #e5e7eb',borderRadius:7,fontSize:13,width:'100%'}
  const labelS={fontSize:11,fontWeight:700,color:'#6b7280',marginBottom:4,display:'block'}
  const rowS={marginBottom:12}

  // 입력값 검사 — 유형에 따라 필요한 것만 본다
  function validate(){
    if(!workerId){showToast('이름을 선택해 주세요');return false}
    if(isNew&&dates.length===0){showToast('날짜를 하나 이상 골라 주세요');return false}
    if(isWork&&!placeId){showToast('장소를 선택해 주세요');return false}
    // 외부 장소면 이동 수단을 반드시 고르게 한다. 기본값을 넣어 두면
    // 실제와 다른 수단으로 정산될 수 있다.
    if(needsTransport&&!transport){showToast('이동 수단을 선택해 주세요');return false}
    if(isVehicleOnly&&!vehicleId){showToast('차량을 선택해 주세요');return false}
    if(isWork&&tp.needsVehicle&&!vehicleId){showToast('차량을 선택해 주세요');return false}
    if(isVacation&&!vacationType){showToast('휴가 종류를 선택해 주세요');return false}
    return true
  }

  // 계획 한 건의 본문. 유형에 따라 담는 값이 다르다.
  //   업무      장소 + (사무실이면 office / 외부면 이동수단·차량) + 업무 내용
  //   차량 예약  차량 + 용도(업무/개인). 장소·업무 없음
  //   휴가      종류만. 장소·차량·이동 없음(transport='none')
  function buildBody(planDate,placeIdToUse,km,min,force=false){
    const ut=isVacation?'vacation':(isVehicleOnly?(personal?'personal':'business'):'business')
    return {
      worker_id:Number(workerId), plan_date:planDate, slot, use_type:ut,
      place_id:isWork&&!atOffice&&placeIdToUse?Number(placeIdToUse):null,
      purpose:isWork?purpose:null,
      transport:isVacation?'none':(atOffice?'office':transport),
      vehicle_id:(isVehicleOnly||(isWork&&!atOffice&&tp.needsVehicle))?Number(vehicleId):null,
      est_distance_km:isWork?km:null, est_travel_min:isWork?min:null,
      round_trip:(isWork&&!atOffice)?roundTrip:false,
      vacation_type:isVacation?vacationType:null,
      force,
    }
  }

  async function submit(){
    if(!validate())return

    // 새 장소는 «장소 선택 창» 에서 등록하고 곧바로 선택된다.
    // 예전에는 이 창 안에 새 장소 입력칸이 있어, 「계획 등록」을 누르면 적은
    // 내용이 버려지는 문제가 있었다.
    const usePlaceId=atOffice?null:placeId
    const useKm=estKm, useMin=estMin

    try{
      setBusy(true)

      // ── 고치는 경우 ──
      if(!isNew){
        await updatePlan(editing.id,buildBody(date,usePlaceId,useKm,useMin))
        showToast('계획을 수정했습니다')
        await onSaved({focusDate:date})
        onClose()
        return
      }

      // ── 새로 넣는 경우 — 고른 날짜만큼 넣는다 ──
      const targets=[...dates].sort()
      const conflicts=[]   // 차량이 겹친 날짜
      let done=0
      for(const d of targets){
        try{
          await addPlan(buildBody(d,usePlaceId,useKm,useMin))
          done++
        }catch(e){
          if(e.status===409&&e.conflicts?.length){
            conflicts.push({date:d,names:e.conflicts.map(c=>c.worker_name)})
          }else throw e
        }
      }

      // 겹친 날짜는 «모아서 한 번만» 물어본다. 날짜마다 확인창이 뜨면 쓰기 어렵다.
      if(conflicts.length>0){
        const lines=conflicts.map(c=>`· ${c.date} — ${c.names.join('·')}`).join('\n')
        if(confirm(`아래 날짜는 그 차량이 이미 예약돼 있습니다.\n\n${lines}\n\n그래도 등록할까요?`)){
          for(const c of conflicts){
            await addPlan(buildBody(c.date,usePlaceId,useKm,useMin,true))
            done++
          }
        }
      }

      if(done>0){
        showToast(done===1?`${targets[0]} 계획을 등록했습니다`:`${done}건을 등록했습니다 (${targets[0]} 외)`)
        await onSaved({focusDate:targets[0]})
        onClose()
      }else{
        showToast('등록된 계획이 없습니다')
      }
    }catch(e){
      showToast('등록 실패: '+e.message)
    }finally{setBusy(false)}
  }

  // 날짜 태그 조작 — 새 계획에서만 쓴다
  function addDate(d){
    if(!d)return
    setDates(prev=>prev.includes(d)?prev:[...prev,d].sort())
  }
  function removeDate(d){ setDates(prev=>prev.filter(x=>x!==d)) }
  // 그 날짜가 속한 주의 평일(월~금)을 한 번에 넣는다
  function addWeekdays(){
    const week=calWeekDays(date).slice(0,5)
    setDates(prev=>[...new Set([...prev,...week])].sort())
  }

  async function handleDelete(){
    if(!confirm('이 계획을 삭제할까요?'))return
    try{
      setBusy(true)
      await removePlan(editing.id)
      showToast('삭제했습니다')
      await onSaved({}); onClose()
    }catch(e){showToast('삭제 실패: '+e.message)}
    finally{setBusy(false)}
  }

  // 「계획대로」 — 계획 내용을 그대로 실적으로 만든다.
  // 차량을 쓴 일정은 거리·비용을 받아야 정산이 되므로 실적 창을 연다.
  async function handleAsPlanned(){
    if(editing.vehicle_id||editing.transport==='transit'){
      onOpenActual&&onOpenActual(editing)
      onClose()
      return
    }
    try{
      setBusy(true)
      await addActual({plan_id:editing.id,as_planned:true})
      showToast('계획대로 완료 처리했습니다')
      await onSaved({}); onClose()
    }catch(e){showToast('처리 실패: '+e.message)}
    finally{setBusy(false)}
  }

  return(
    <div onClick={onClose}
      style={{position:'fixed',inset:0,background:'rgba(17,24,39,.45)',zIndex:9000,
        display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'40px 16px',overflowY:'auto'}}>
      <div onClick={e=>e.stopPropagation()}
        style={{background:'#fff',borderRadius:12,width:'100%',maxWidth:520,padding:22,
          maxHeight:MODAL_MAX_H,overflowY:'auto',
          boxShadow:'0 20px 50px rgba(0,0,0,.25)'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
          <strong style={{fontSize:16}}>
            {isNew?(copyFrom?'계획 복사':'계획 추가'):(locked?'계획 상세':'계획 수정')}
          </strong>
          <button onClick={onClose} style={{border:'none',background:'none',fontSize:20,cursor:'pointer',color:'#6b7280'}}>×</button>
        </div>

        {copyFrom&&(
          <div style={{background:'#eff6ff',border:'1px solid #93c5fd',borderRadius:8,padding:'8px 12px',
            marginBottom:14,fontSize:12,color:'#1e40af'}}>
            「{copyFrom.place_name||copyFrom.place_text||(copyFrom.transport==='office'?'사무실':'개인 사용')}」
            내용을 그대로 가져왔습니다. <strong>넣을 날짜만 고르면 됩니다.</strong>
          </div>
        )}

        {locked&&(
          <div style={{background:'#ecfdf5',border:'1px solid #6ee7b7',borderRadius:8,padding:'8px 12px',
            marginBottom:14,fontSize:12,color:'#065f46'}}>
            <strong>실적이 등록된 계획입니다</strong>{editing.as_planned===false?' (계획과 달랐음)':''}.
            {editing.actual_distance_km!=null&&` 주행 ${editing.actual_distance_km}km.`}
            <br/>정산 근거와 어긋나지 않도록 계획은 고칠 수 없습니다 — 고쳐야 하면 실적을 먼저 지워 주십시오.
            <div style={{marginTop:8}}>
              <button onClick={()=>{onOpenActual&&onOpenActual(editing);onClose()}}
                style={{padding:'6px 12px',borderRadius:7,border:'1px solid #059669',
                  background:'#fff',color:'#059669',cursor:'pointer',fontSize:12,fontWeight:700}}>
                실적 보기·수정
              </button>
            </div>
          </div>
        )}

        <div style={rowS}>
          <label style={labelS}>이름</label>
          <select value={workerId} onChange={e=>setWorkerId(e.target.value)} disabled={!canEdit} style={inputS}>
            <option value="">선택</option>
            {workers.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,...rowS}}>
          <div>
            <label style={labelS}>날짜</label>
            <input type="date" value={date} onChange={e=>{setDate(e.target.value);if(isNew)addDate(e.target.value)}}
              disabled={!canEdit} style={inputS}/>
          </div>
          <div>
            <label style={labelS}>시간대</label>
            <select value={slot} onChange={e=>setSlot(e.target.value)} disabled={!canEdit} style={inputS}>
              {SLOTS.map(s=><option key={s.v} value={s.v}>{s.label}</option>)}
            </select>
          </div>
        </div>

        {/* 같은 일정을 여러 날 넣는 일이 잦다. 고른 날짜가 태그로 쌓인다. */}
        {isNew&&(
          <div style={{...rowS,background:'#f9fafb',border:'1px solid #e5e7eb',borderRadius:8,padding:'10px 12px'}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8,flexWrap:'wrap'}}>
              <strong style={{fontSize:12}}>넣을 날짜 {dates.length}개</strong>
              <button onClick={()=>addDate(date)}
                style={{padding:'4px 10px',borderRadius:6,border:'1px solid #1a56db',background:'#eff6ff',
                  color:'#1a56db',cursor:'pointer',fontSize:11,fontWeight:600}}>+ 위 날짜 추가</button>
              <button onClick={addWeekdays}
                style={{padding:'4px 10px',borderRadius:6,border:'1px solid #1a56db',background:'#eff6ff',
                  color:'#1a56db',cursor:'pointer',fontSize:11,fontWeight:600}}>그 주 평일(월~금)</button>
              {dates.length>0&&(
                <button onClick={()=>setDates([])}
                  style={{padding:'4px 10px',borderRadius:6,border:'1px solid #e5e7eb',background:'#fff',
                    color:'#6b7280',cursor:'pointer',fontSize:11}}>모두 지우기</button>
              )}
            </div>
            {dates.length===0
              ?<div style={{fontSize:11,color:'#92400e'}}>날짜를 하나 이상 골라 주세요.</div>
              :<div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                {dates.map(d=>(
                  <span key={d} onClick={()=>removeDate(d)} title="누르면 제외됩니다"
                    style={{display:'inline-flex',alignItems:'center',gap:4,cursor:'pointer',
                      background:'#1a56db',color:'#fff',borderRadius:5,padding:'3px 8px',fontSize:11,fontWeight:600}}>
                    {mdLabel(d)} ({dayName(d)}) <span style={{opacity:.8}}>×</span>
                  </span>
                ))}
              </div>}
          </div>
        )}

        {/* ── 유형 — 무엇을 등록하는가. 이것을 먼저 고르면 뒤에 필요한 것만 나온다 ── */}
        <div style={rowS}>
          <label style={labelS}>유형</label>
          <div style={{display:'flex',gap:6}}>
            {PLAN_KINDS.map(k=>(
              <button key={k.v} onClick={()=>{
                  if(!canEdit)return
                  setKind(k.v)
                  // 유형을 바꾸면 그 유형에 없는 값은 비운다
                  if(k.v==='work'){ setPlaceId(OFFICE_PLACE); setTransport('office'); setVehicleId('') }
                  if(k.v==='vehicle'){ setPlaceId(''); setTransport('company_car'); setUseType('business') }
                  if(k.v==='vacation'){ setPlaceId(''); setTransport('none'); setVehicleId('') }
                }} disabled={!canEdit}
                style={{flex:1,padding:'10px 4px',borderRadius:7,cursor:canEdit?'pointer':'default',
                  border:'1px solid '+(kind===k.v?'#1a56db':'#e5e7eb'),
                  background:kind===k.v?'#eff6ff':'#fff',
                  color:kind===k.v?'#1a56db':'#6b7280'}}>
                <div style={{fontSize:13,fontWeight:kind===k.v?700:500}}>{k.icon} {k.label}</div>
                <div style={{fontSize:10,opacity:.8,marginTop:2}}>{k.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* ── 업무 — 장소를 먼저 고른다. 목록이 수십 개가 되므로 별도 창에서 검색한다 ── */}
        {isWork&&(
          <>
            <div style={rowS}>
              <label style={labelS}>장소</label>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <div style={{flex:1,padding:'9px 12px',border:'1px solid #e5e7eb',borderRadius:7,
                  fontSize:13,background:canEdit?'#fff':'#f9fafb',
                  color:placeId?'#111827':'#9ca3af'}}>
                  {atOffice
                    ?'🏢 사무실 (내근)'
                    :place
                      ?<>{place.name}
                        {place.distance_km!=null&&<span style={{color:'#6b7280'}}> · {place.distance_km}km</span>}</>
                      :'장소를 선택해 주세요'}
                </div>
                {canEdit&&(
                  <button onClick={()=>setPickerOpen(true)}
                    style={{padding:'9px 14px',borderRadius:7,border:'1px solid #1a56db',
                      background:'#eff6ff',color:'#1a56db',cursor:'pointer',fontSize:12,
                      fontWeight:700,whiteSpace:'nowrap'}}>장소 선택</button>
                )}
              </div>
              {atOffice&&(
                <div style={{fontSize:11,color:'#6b7280',marginTop:6}}>
                  사무실 내근은 이동이 없어 차량·거리를 입력하지 않습니다.
                </div>
              )}
            </div>

            <div style={rowS}>
              <label style={labelS}>업무 {atOffice&&<span style={{fontWeight:500}}>(선택)</span>}</label>
              <input value={purpose} onChange={e=>setPurpose(e.target.value)} disabled={!canEdit}
                placeholder="무엇을 할 계획인지 한 줄로" style={inputS}/>
            </div>
          </>
        )}

        {/* ── 업무: 외부 장소일 때만 이동 수단을 묻는다 ── */}
        {needsTransport&&(
          <div style={rowS}>
            <label style={labelS}>이동 수단</label>
            <div style={{display:'flex',gap:6}}>
              {OUT_TRANSPORTS.map(t=>(
                // ⚠ 이동 수단을 바꾸면 차량을 «항상» 비운다.
                //   법인차량 → 자차로 바꿀 때 비우지 않으면, 목록에 없는 법인차 id 가
                //   그대로 남아 «자차인데 법인차» 로 저장된다(실제로 그렇게 들어간 기록이 있었다).
                <button key={t.v} onClick={()=>{if(canEdit){setTransport(t.v);setVehicleId('')}}}
                  disabled={!canEdit}
                  style={{flex:1,padding:'8px 4px',borderRadius:7,cursor:canEdit?'pointer':'default',fontSize:12,
                    fontWeight:transport===t.v?700:500,
                    border:'1px solid '+(transport===t.v?'#1a56db':'#e5e7eb'),
                    background:transport===t.v?'#eff6ff':'#fff',
                    color:transport===t.v?'#1a56db':'#6b7280'}}>
                  {t.icon} {t.label}
                </button>
              ))}
            </div>
            {canEdit&&!transport&&(
              <div style={{fontSize:11,color:'#92400e',marginTop:6}}>이동 수단을 선택해 주세요.</div>
            )}
          </div>
        )}

        {/* ── 차량 예약 — 차량과 용도만 묻는다 ── */}
        {isVehicleOnly&&(
          <>
            <div style={rowS}>
              <label style={labelS}>차량 구분</label>
              <div style={{display:'flex',gap:6}}>
                {vehicleTransports.map(t=>(
                  <button key={t.v} onClick={()=>{if(canEdit){setTransport(t.v);setVehicleId('')}}}
                    disabled={!canEdit}
                    style={{flex:1,padding:'8px 4px',borderRadius:7,cursor:canEdit?'pointer':'default',fontSize:12,
                      fontWeight:transport===t.v?700:500,
                      border:'1px solid '+(transport===t.v?'#1a56db':'#e5e7eb'),
                      background:transport===t.v?'#eff6ff':'#fff',
                      color:transport===t.v?'#1a56db':'#6b7280'}}>
                    {t.icon} {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={rowS}>
              <label style={labelS}>용도</label>
              <div style={{display:'flex',gap:8}}>
                {[{v:'business',label:'업무'},{v:'personal',label:'개인 사용'}].map(o=>(
                  <button key={o.v} onClick={()=>canEdit&&setUseType(o.v)} disabled={!canEdit}
                    style={{flex:1,padding:'8px',borderRadius:7,cursor:canEdit?'pointer':'default',fontSize:13,
                      fontWeight:useType===o.v?700:500,
                      border:'1px solid '+(useType===o.v?'#1a56db':'#e5e7eb'),
                      background:useType===o.v?'#eff6ff':'#fff',
                      color:useType===o.v?'#1a56db':'#6b7280'}}>{o.label}</button>
                ))}
              </div>
              {personal&&(
                <div style={{fontSize:11,color:'#92400e',marginTop:6}}>
                  개인 사용은 월 정산 대상입니다 (주행거리 × 차량 단가 + 하이패스). 행선지는 적지 않습니다.
                </div>
              )}
            </div>
          </>
        )}

        {/* ── 휴가 — 종류만 묻는다 ── */}
        {isVacation&&(
          <div style={rowS}>
            <label style={labelS}>휴가 종류</label>
            <div style={{display:'flex',gap:6}}>
              {VACATION_TYPES.map(v=>(
                <button key={v} onClick={()=>canEdit&&setVacationType(v)} disabled={!canEdit}
                  style={{flex:1,padding:'9px 4px',borderRadius:7,cursor:canEdit?'pointer':'default',fontSize:13,
                    fontWeight:vacationType===v?700:500,
                    border:'1px solid '+(vacationType===v?'#1a56db':'#e5e7eb'),
                    background:vacationType===v?'#eff6ff':'#fff',
                    color:vacationType===v?'#1a56db':'#6b7280'}}>{v}</button>
              ))}
            </div>
            <div style={{fontSize:11,color:'#6b7280',marginTop:6}}>
              휴가는 장소·차량을 적지 않습니다. 달력에 🌴 로 표시됩니다.
            </div>
          </div>
        )}

        {/* ── 차량 (업무의 외부 이동 · 차량 예약 공용) ── */}
        {((isWork&&!atOffice&&tp.needsVehicle)||isVehicleOnly)&&(
          <div style={rowS}>
            <label style={labelS}>차량</label>
            <select value={vehicleId} onChange={e=>setVehicleId(e.target.value)} disabled={!canEdit} style={inputS}>
              <option value="">선택</option>
              {vehicles
                .filter(v=>transport==='company_car'?v.kind==='company':v.kind==='own')
                .map(v=>(
                  <option key={v.id} value={v.id}>
                    {v.name}{v.plate?' '+v.plate:''}{v.owner_name?' ('+v.owner_name+')':''}
                  </option>
                ))}
            </select>
            {transport==='own_car'&&vehicles.filter(v=>v.kind==='own').length===0&&(
              <div style={{fontSize:11,color:'#92400e',marginTop:5}}>
                등록된 자차가 없습니다. 설정에서 자차를 먼저 등록해 주세요.
              </div>
            )}
          </div>
        )}

        {/* ── 왕복·예상 거리 (외부 업무일 때만) ── */}
        {isWork&&!atOffice&&(
          <div style={{...rowS,background:'#f9fafb',border:'1px solid #e5e7eb',borderRadius:8,padding:'10px 12px'}}>
            <label style={{display:'flex',alignItems:'center',gap:7,fontSize:12,cursor:canEdit?'pointer':'default'}}>
              <input type="checkbox" checked={!!roundTrip} disabled={!canEdit}
                onChange={e=>setRoundTrip(e.target.checked)}/>
              왕복
            </label>
            <div style={{fontSize:12,color:'#374151',marginTop:6}}>
              {showKm!=null||showMin!=null
                ?<>예상 {showKm!=null&&<strong>{showKm}km</strong>}
                   {showMin!=null&&<> · 이동 <strong>{showMin}분</strong></>}
                   <span style={{color:'#6b7280'}}> (장소에 등록된 값)</span></>
                :<span style={{color:'#6b7280'}}>장소를 고르면 거리·시간이 표시됩니다.</span>}
            </div>
          </div>
        )}

        {isNew
          ?<div style={{display:'flex',gap:8,marginTop:18}}>
            <button onClick={submit} disabled={busy}
              style={{flex:1,padding:'11px',borderRadius:8,border:'none',background:'#1a56db',
                color:'#fff',cursor:'pointer',fontSize:14,fontWeight:700}}>
              {busy?'처리 중…'
                :(dates.length>1?`${dates.length}개 날짜에 등록`:'계획 등록')}
            </button>
            <button onClick={onClose} style={{padding:'11px 18px',borderRadius:8,
              border:'1px solid #e5e7eb',background:'#fff',cursor:'pointer',fontSize:14}}>취소</button>
          </div>
          :<>
            {/* 실적이 없는 계획은 그 자리에서 고칠 수 있다 */}
            {canEdit&&(
              <div style={{display:'flex',gap:8,marginTop:18}}>
                <button onClick={submit} disabled={busy}
                  style={{flex:1,padding:'11px',borderRadius:8,border:'none',background:'#1a56db',
                    color:'#fff',cursor:'pointer',fontSize:14,fontWeight:700}}>
                  {busy?'처리 중…':'수정 저장'}
                </button>
                {editing.plan_date<=today()&&(
                  <button onClick={handleAsPlanned} disabled={busy}
                    style={{padding:'11px 16px',borderRadius:8,border:'none',background:'#059669',
                      color:'#fff',cursor:'pointer',fontSize:14,fontWeight:700}}>계획대로 완료</button>
                )}
              </div>
            )}
            <div style={{display:'flex',gap:8,marginTop:8}}>
              {/* 복사 — 달력에서 붙일 날짜를 골라 여러 날에 넣을 수 있다 */}
              <button onClick={()=>{onCopy&&onCopy(editing);onClose()}} disabled={busy}
                style={{flex:1,padding:'10px',borderRadius:8,border:'1px solid #1a56db',
                  background:'#eff6ff',color:'#1a56db',cursor:'pointer',fontSize:13,fontWeight:700}}>
                복사 (다른 날짜에 붙이기)
              </button>
              <button onClick={handleDelete} disabled={busy}
                style={{padding:'10px 16px',borderRadius:8,border:'1px solid #fca5a5',
                  background:'#fff',color:'#dc2626',cursor:'pointer',fontSize:13}}>삭제</button>
              <button onClick={onClose} style={{padding:'10px 16px',borderRadius:8,
                border:'1px solid #e5e7eb',background:'#fff',cursor:'pointer',fontSize:13}}>닫기</button>
            </div>
          </>}
      </div>

      {/* 장소 선택 창 — 검색·수정·숨김·새 장소를 한곳에서 */}
      {pickerOpen&&(
        <PlacePicker places={places} showToast={showToast}
          onClose={()=>setPickerOpen(false)}
          onChanged={onSaved}
          onPick={p=>{
            setPlaceId(p.id)
            // 사무실을 고르면 이동이 없으므로 이동 수단·차량을 비운다.
            // 외부 장소면 이동 수단을 «미선택» 으로 두고 사용자가 고르게 한다.
            if(p.id===OFFICE_PLACE){ setTransport('office'); setVehicleId('') }
            else if(transport==='office'||transport==='none'){ setTransport(''); setVehicleId('') }
            setPickerOpen(false)
          }}/>
      )}
    </div>
  )
}

// ── 차량 관리 (설정 탭) ───────────────────────────────────
// 법인차는 목록만 보여 준다. 개인사용 정산 단가를 고치는 것은 금액에 직접
// 영향을 주므로 정산 화면에서 대표이사만 하도록 남겨 둔다(설계서 4.2절).
// 자차는 본인이 등록한다 — 등록해 두지 않으면 계획에서 「자차」를 골라도 고를 차가 없다.
const FUEL_TYPES=['가솔린','디젤','LPG','전기','하이브리드']

function VehicleManager({vehicles,workers,dupNames,onChanged,showToast}){
  const [adding,setAdding]=useState(false)
  const [form,setForm]=useState({owner_worker_id:'',name:'',plate:'',fuel_type:'가솔린',km_per_liter:''})
  const [editingId,setEditingId]=useState(null)
  const [edit,setEdit]=useState({})
  const [busy,setBusy]=useState(false)

  const company=vehicles.filter(v=>v.kind==='company')
  const own=vehicles.filter(v=>v.kind==='own')
  const inputS={padding:'7px 10px',border:'1px solid #e5e7eb',borderRadius:7,fontSize:13,width:'100%'}
  const smallBtn={padding:'4px 9px',borderRadius:6,fontSize:11,cursor:'pointer',fontWeight:600}
  const nameOf=id=>{const w=workers.find(x=>x.id===id);return w?workerLabel(w,dupNames):'-'}

  async function add(){
    if(!form.owner_worker_id){showToast('차량 소유 직원을 골라 주세요');return}
    if(!form.name.trim()){showToast('차종을 입력해 주세요');return}
    try{
      setBusy(true)
      await addVehicle({...form,kind:'own',name:form.name.trim(),
        owner_worker_id:Number(form.owner_worker_id),
        km_per_liter:form.km_per_liter===''?null:form.km_per_liter})
      showToast('자차를 등록했습니다')
      setForm({owner_worker_id:'',name:'',plate:'',fuel_type:'가솔린',km_per_liter:''})
      setAdding(false); await onChanged()
    }catch(e){showToast('등록 실패: '+e.message)}
    finally{setBusy(false)}
  }

  async function saveEdit(){
    try{
      setBusy(true)
      await updateVehicle(editingId,{
        name:edit.name?.trim()||null, plate:edit.plate||null, fuel_type:edit.fuel_type||null,
        km_per_liter:edit.km_per_liter===''?null:edit.km_per_liter,
      })
      showToast('차량 정보를 수정했습니다')
      setEditingId(null); await onChanged()
    }catch(e){showToast('수정 실패: '+e.message)}
    finally{setBusy(false)}
  }

  async function hide(v){
    if(!confirm(`「${v.name}」을 목록에서 숨길까요?\n\n지난 계획·실적은 그대로 남습니다.`))return
    try{ setBusy(true); await updateVehicle(v.id,{active:false}); showToast('숨겼습니다'); await onChanged() }
    catch(e){ showToast('실패: '+e.message) }
    finally{ setBusy(false) }
  }

  return(
    <Card title="차량 관리" style={{flex:1,minWidth:320}}>
      <div style={{fontSize:12,fontWeight:700,color:'#374151',marginBottom:6}}>법인차량 {company.length}대</div>
      <table style={{width:'100%',borderCollapse:'collapse',marginBottom:16}}>
        <thead><tr>
          <th style={{...thS,textAlign:'left'}}>차량</th>
          <th style={{...thS,width:70}}>연료</th>
          <th style={{...thS,width:96}}>개인사용 단가</th>
        </tr></thead>
        <tbody>
          {company.map(v=>(
            <tr key={v.id}>
              <td style={{...tdS,textAlign:'left'}}>
                <strong style={{fontSize:12}}>{v.name}</strong>
                <div style={{fontSize:10,color:'#6b7280'}}>{v.plate}</div>
              </td>
              <td style={tdS}>{v.fuel_type||'-'}</td>
              <td style={tdS}>{v.rate_per_km!=null?`${v.rate_per_km}원/km`:'-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{fontSize:11,color:'#6b7280',marginBottom:16}}>
        법인차량 단가는 정산 금액에 직접 영향을 주므로 <strong>정산 화면에서 대표이사만</strong> 고칠 수 있습니다.
      </div>

      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
        <div style={{fontSize:12,fontWeight:700,color:'#374151'}}>자차 {own.length}대</div>
        <button onClick={()=>setAdding(!adding)}
          style={{...smallBtn,border:'1px solid #1a56db',background:'#eff6ff',color:'#1a56db'}}>
          {adding?'취소':'+ 내 차 등록'}
        </button>
      </div>

      {adding&&(
        <div style={{border:'1px dashed #93c5fd',borderRadius:8,padding:12,marginBottom:12,background:'#f8fbff'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
            <select value={form.owner_worker_id} onChange={e=>setForm({...form,owner_worker_id:e.target.value})} style={inputS}>
              <option value="">소유 직원 선택</option>
              {workers.filter(w=>w.active).map(w=>(
                <option key={w.id} value={w.id}>{workerLabel(w,dupNames)}</option>
              ))}
            </select>
            <input placeholder="차종 (예: 쏘렌토)" value={form.name}
              onChange={e=>setForm({...form,name:e.target.value})} style={inputS}/>
            <input placeholder="번호판 (선택)" value={form.plate}
              onChange={e=>setForm({...form,plate:e.target.value})} style={inputS}/>
            <select value={form.fuel_type} onChange={e=>setForm({...form,fuel_type:e.target.value})} style={inputS}>
              {FUEL_TYPES.map(f=><option key={f} value={f}>{f}</option>)}
            </select>
            <input type="number" step="0.1" placeholder="연비 (km/L)" value={form.km_per_liter}
              onChange={e=>setForm({...form,km_per_liter:e.target.value})}
              style={{...inputS,gridColumn:'1 / -1'}}/>
          </div>
          <div style={{fontSize:11,color:'#92400e',margin:'8px 0'}}>
            연비는 <strong>주유 환급량</strong>을 계산하는 값입니다 (업무 주행거리 ÷ 연비 = 환급 리터).
            등록 후 정산 화면에서 대표이사가 확인·조정합니다.
          </div>
          <button onClick={add} disabled={busy}
            style={{width:'100%',...smallBtn,padding:'8px',border:'none',background:'#1a56db',color:'#fff',fontSize:12}}>
            등록
          </button>
        </div>
      )}

      {own.length===0
        ?<div style={{fontSize:12,color:'#6b7280',padding:'10px 0'}}>
          등록된 자차가 없습니다. 자차로 외근하려면 먼저 등록해 주십시오.
        </div>
        :<table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead><tr>
            <th style={{...thS,textAlign:'left'}}>소유·차종</th>
            <th style={{...thS,width:64}}>연료</th>
            <th style={{...thS,width:70}}>연비</th>
            <th style={{...thS,width:104}}>관리</th>
          </tr></thead>
          <tbody>
            {own.map(v=>(
              editingId===v.id
                ?<tr key={v.id}><td colSpan={4} style={{padding:10,background:'#f8fbff'}}>
                  <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr',gap:6,marginBottom:8}}>
                    <input value={edit.name||''} onChange={e=>setEdit({...edit,name:e.target.value})}
                      placeholder="차종" style={inputS}/>
                    <input value={edit.plate||''} onChange={e=>setEdit({...edit,plate:e.target.value})}
                      placeholder="번호판" style={inputS}/>
                    <input type="number" step="0.1" value={edit.km_per_liter??''}
                      onChange={e=>setEdit({...edit,km_per_liter:e.target.value})}
                      placeholder="연비" style={inputS}/>
                  </div>
                  <div style={{display:'flex',gap:6}}>
                    <button onClick={saveEdit} disabled={busy}
                      style={{...smallBtn,border:'none',background:'#1a56db',color:'#fff'}}>저장</button>
                    <button onClick={()=>setEditingId(null)}
                      style={{...smallBtn,border:'1px solid #e5e7eb',background:'#fff',color:'#6b7280'}}>취소</button>
                  </div>
                </td></tr>
                :<tr key={v.id}>
                  <td style={{...tdS,textAlign:'left'}}>
                    <strong style={{fontSize:12}}>{nameOf(v.owner_worker_id)}</strong>
                    <span style={{fontSize:12,marginLeft:6}}>{v.name}</span>
                    {v.plate&&<div style={{fontSize:10,color:'#6b7280'}}>{v.plate}</div>}
                  </td>
                  <td style={tdS}>{v.fuel_type||'-'}</td>
                  <td style={tdS}>
                    {v.km_per_liter!=null
                      ?`${v.km_per_liter}km/L`
                      :<span style={{color:'#c2410c',fontWeight:700}}>미입력</span>}
                  </td>
                  <td style={{...tdS,whiteSpace:'nowrap'}}>
                    <button onClick={()=>{setEditingId(v.id);setEdit({...v})}}
                      style={{...smallBtn,border:'1px solid #e5e7eb',background:'#fff',color:'#374151',marginRight:4}}>수정</button>
                    <button onClick={()=>hide(v)}
                      style={{...smallBtn,border:'1px solid #fca5a5',background:'#fff',color:'#dc2626'}}>숨김</button>
                  </td>
                </tr>
            ))}
          </tbody>
        </table>}
    </Card>
  )
}

// ── 설정 탭 ───────────────────────────────────────────────
// 직원 수정·삭제는 모두 id 로 대상을 지정한다 (동명이인 구분).
// editingWorkerId / resigningWorkerId 도 이름이 아니라 id 를 담는다.
// ── 장기 부재 관리 (장기출장·휴직·파견) ──────────────────────
// 등록해 두면 그 기간은 «가동일»에서 빠지고, 그 기간에 남은 기록도 집계에 넣지 않는다.
// 사람을 지우는 것이 아니라 «그 기간만» 빼는 것이라 과거 통계는 그대로 남는다.
function AbsenceManager({absences,setAbsences,workers,dupNames,showToast}){
  const [workerId,setWorkerId]=useState('')
  const [kind,setKind]=useState('장기출장')
  const [from,setFrom]=useState(today())
  const [to,setTo]=useState('')
  const [note,setNote]=useState('')
  const [busy,setBusy]=useState(false)
  const inputS={padding:'7px 10px',border:'1px solid #e5e7eb',borderRadius:7,fontSize:13}

  async function handleAdd(){
    if(!workerId){showToast('대상 직원을 골라 주세요');return}
    setBusy(true)
    try{
      const saved=await addAbsence({worker_id:Number(workerId),kind,from_date:from,
        to_date:to||null,note:note.trim()||null})
      const w=workers.find(x=>x.id===Number(workerId))
      setAbsences([{...saved,worker_name:w?.name},...absences])
      setNote('');setTo('')
      showToast('부재 등록 완료 — 집계에서 그 기간이 빠집니다')
    }catch(e){showToast('등록 실패: '+e.message,4000)}
    finally{setBusy(false)}
  }
  async function handleDel(a){
    if(!confirm(`${a.worker_name} 의 ${a.kind}(${a.from_date}~${a.to_date||'진행 중'}) 기록을 지울까요?\n지우면 그 기간이 다시 집계에 들어갑니다.`))return
    try{await removeAbsence(a.id);setAbsences(absences.filter(x=>x.id!==a.id));showToast('삭제 완료')}
    catch(e){showToast('삭제 실패: '+e.message,4000)}
  }

  return(
    <Card title="집계 제외 — 장기출장 · 휴직 · 파견 · 대상 아님" style={{flex:1,minWidth:320}}>
      <p style={{fontSize:11,color:'#6b7280',margin:'0 0 10px',lineHeight:1.7}}>
        입력을 할 수 없는 기간을 등록합니다. 그 기간은 <b>가동일에서 빠지고</b>, 그 기간에 남아 있는
        기록도 <b>집계에 넣지 않습니다.</b> 평균·최대·최소는 <b>하루당</b>으로 계산되므로
        한 사람의 부재가 전체 숫자를 흔들지 않습니다. <b>종료일을 비우면 «진행 중»</b> 입니다.
        <br />대표이사처럼 <b>애초에 집계 대상이 아닌 사람</b>은 사유를 <b>「집계 제외」</b> 로 두고
        기간을 열어 두십시오 (KPI 총괄 분석에도 함께 적용됩니다).
      </p>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:10}}>
        <select value={workerId} onChange={e=>setWorkerId(e.target.value)} style={{...inputS,minWidth:110}}>
          <option value="">직원 선택</option>
          {workers.filter(w=>w.active).map(w=>
            <option key={w.id} value={w.id}>{workerLabel(w,dupNames)}</option>)}
        </select>
        <select value={kind} onChange={e=>setKind(e.target.value)} style={inputS}>
          {Object.keys(ABSENCE_STYLE).map(k=><option key={k} value={k}>{k}</option>)}
        </select>
        <input type="date" value={from} onChange={e=>setFrom(e.target.value)} style={inputS}/>
        <span style={{alignSelf:'center',color:'#9ca3af'}}>~</span>
        <input type="date" value={to} onChange={e=>setTo(e.target.value)} style={inputS}
          title="비우면 진행 중"/>
        <input value={note} onChange={e=>setNote(e.target.value)} placeholder="비고 (선택)"
          style={{...inputS,flex:'1 1 140px',minWidth:120}}/>
        <button onClick={handleAdd} disabled={busy}
          style={{padding:'7px 14px',borderRadius:7,border:'none',background:'#1a56db',color:'#fff',
            cursor:busy?'default':'pointer',fontWeight:600,opacity:busy?0.6:1}}>등록</button>
      </div>
      {!absences.length
        ?<div style={{fontSize:12,color:'#9ca3af',padding:'10px 0'}}>등록된 부재가 없습니다.</div>
        :<div style={{overflowX:'auto'}}>
          <table style={{borderCollapse:'collapse',width:'100%',minWidth:520}}>
            <thead><tr>{['직원','사유','기간','비고',''].map(h=><th key={h} style={thS}>{h}</th>)}</tr></thead>
            <tbody>
              {absences.map(a=>{
                const st=ABSENCE_STYLE[a.kind]||ABSENCE_STYLE['파견']
                const ongoing=!a.to_date||a.to_date>=today()
                return(
                  <tr key={a.id}>
                    <td style={{...tdS,fontWeight:600}}>{a.worker_name}</td>
                    <td style={tdS}>
                      <span style={{color:st.fg,background:st.bg,padding:'2px 8px',borderRadius:10,
                        fontSize:11,fontWeight:700,whiteSpace:'nowrap'}}>{a.kind}</span>
                    </td>
                    <td style={{...tdS,whiteSpace:'nowrap'}}>
                      {a.from_date} ~ {a.to_date||<b style={{color:'#b45309'}}>진행 중</b>}
                      {ongoing&&<span style={{marginLeft:6,fontSize:10,color:'#b45309'}}>●</span>}
                    </td>
                    <td style={{...tdS,textAlign:'left',color:'#6b7280',fontSize:11}}>{a.note||''}</td>
                    <td style={tdS}>
                      <button onClick={()=>handleDel(a)}
                        style={{padding:'3px 9px',borderRadius:5,border:'1px solid #fecaca',
                          background:'#fff',color:'#dc2626',fontSize:11,cursor:'pointer'}}>삭제</button>
                    </td>
                  </tr>)
              })}
            </tbody>
          </table>
        </div>}
    </Card>
  )
}

function TabSettings({workers,setWorkers,dupNames=new Set(),jiraTree,jiraDone=new Set(),reloadJira,showToast,
                      tokenStatus={configured:false},vehicles=[],onVehiclesChanged,
                      absences=[],setAbsences=()=>{}}){
  const [newWorker,setNewWorker]=useState('')
  const [newHiredAt,setNewHiredAt]=useState(today())
  const [newEmail,setNewEmail]=useState('')
  const [resigningWorkerId,setResigningWorkerId]=useState(null)
  const [resignDate,setResignDate]=useState(today())
  const [editingWorkerId,setEditingWorkerId]=useState(null)
  const [editHiredAt,setEditHiredAt]=useState('')
  const [editResignedAt,setEditResignedAt]=useState('')
  const [editEmail,setEditEmail]=useState('')
  const [newJira,setNewJira]=useState('')
  const [newJiraParent,setNewJiraParent]=useState('')
  const [newFixed,setNewFixed]=useState('')
  const jiraParents=Object.keys(jiraTree)
  const fixedTasks=jiraTree[FIXED_PARENT]||[]
  const nameOf=id=>{const w=workers.find(x=>x.id===id);return w?workerLabel(w,dupNames):''}

  function startEdit(w) {
    setEditingWorkerId(w.id)
    setEditHiredAt(w.hired_at||'')
    setEditResignedAt(w.resigned_at||'')
    setEditEmail(w.email||'')
    setResigningWorkerId(null)
  }

  // 날짜와 메일 주소는 저장 API 가 따로다. 한 번에 눌러도 되도록 여기서 묶어 부른다.
  async function confirmEdit() {
    const label=nameOf(editingWorkerId)
    const target=workers.find(w=>w.id===editingWorkerId)
    try {
      await updateWorkerDates(editingWorkerId, editHiredAt||null, editResignedAt||null)
      // 메일 주소는 바뀌었을 때만 보낸다. 형식이 틀리면 서버가 막으므로 그 문구를 그대로 띄운다.
      if ((target?.email||'') !== editEmail) await updateWorkerEmail(editingWorkerId, editEmail)
      setWorkers(workers.map(w => w.id===editingWorkerId
        ? {...w, hired_at:editHiredAt||null, resigned_at:editResignedAt||null, email:editEmail||null}
        : w))
      showToast(label+' 정보 수정 완료')
      setEditingWorkerId(null)
    } catch(e) { showToast('수정 실패: '+e.message) }
  }

  async function handleAddWorker(){
    if(!newWorker.trim())return
    try{
      const w=await addWorker(newWorker.trim(),newHiredAt,newEmail.trim()||null)
      setWorkers([...workers,w]);setNewWorker('');setNewHiredAt(today());setNewEmail('')
      showToast(w.name+' 입사 등록 ('+newHiredAt+')')
    }catch(e){showToast('추가 실패: '+e.message)}
  }

  function handleToggle(id,active){
    if(!active){
      setResigningWorkerId(id);setResignDate(today());setEditingWorkerId(null)
    }else{
      setWorkerStatus(id,true,null)
        .then(()=>{setWorkers(workers.map(w=>w.id===id?{...w,active:true,resigned_at:null}:w));showToast(nameOf(id)+' 재직 처리')})
        .catch(()=>showToast('변경 실패'))
    }
  }

  async function confirmResign(){
    const label=nameOf(resigningWorkerId)
    try{
      await setWorkerStatus(resigningWorkerId,false,resignDate)
      setWorkers(workers.map(w=>w.id===resigningWorkerId?{...w,active:false,resigned_at:resignDate}:w))
      showToast(label+' 퇴사 처리 ('+resignDate+')')
      setResigningWorkerId(null)
    }catch(e){showToast('변경 실패')}
  }

  async function handleDelWorker(w){
    const label=workerLabel(w,dupNames)
    if(!confirm(label+' 완전 삭제합니까?\n(업무 기록은 그대로 남습니다)'))return
    try{await removeWorker(w.id);setWorkers(workers.filter(x=>x.id!==w.id));showToast(label+' 삭제 완료')}
    catch(e){showToast('삭제 실패')}
  }

  async function handleSyncJira(){
  showToast('동기화 중...', 0)
  try{
      await syncJira()
      const j=await reloadJira()
      showToast('✅ Jira 동기화 완료 ('+Object.keys(j.tree).length+'건)', 4000)
    }
    catch(e){showToast('❌ 동기화 실패: '+e.message, 4000)}
  }
  async function handleAddJira(){
    if(!newJira.trim())return
    try{await addJiraIssue(newJira.trim(),newJiraParent||null);await reloadJira();setNewJira('');showToast('추가 완료')}
    catch(e){showToast('추가 실패')}
  }
  async function handleDelJira(text){
    try{await removeJiraIssue(text);await reloadJira()}
    catch(e){showToast('삭제 실패')}
  }

  // ── 고정업무 (Jira 에 없는 반복 업무) ────────────────────────
  // 상위업무 「고정업무」 아래에 모아 둔다. 내부적으로는 수동 추가(MANUAL-…)와 같은 것이라
  // Jira 동기화가 지우지 않는다. 상위가 아직 없으면 처음 추가할 때 함께 만든다.
  async function handleAddFixed(){
    const name=newFixed.trim()
    if(!name)return
    try{
      if(jiraTree[FIXED_PARENT]===undefined) await addJiraIssue(FIXED_PARENT,null)
      await addJiraIssue(name,FIXED_PARENT)
      await reloadJira(); setNewFixed(''); showToast(name+' 추가 완료')
    }catch(e){showToast('추가 실패: '+e.message)}
  }

  return(
    <div>
      <div style={{display:'flex',gap:16,flexWrap:'wrap',marginBottom:16}}>
        <VehicleManager vehicles={vehicles} workers={workers} dupNames={dupNames}
          onChanged={onVehiclesChanged} showToast={showToast}/>
      </div>
      <div style={{display:'flex',gap:16,flexWrap:'wrap',marginBottom:16}}>
        <AbsenceManager absences={absences} setAbsences={setAbsences} workers={workers}
          dupNames={dupNames} showToast={showToast}/>
      </div>
      <div style={{display:'flex',gap:16,flexWrap:'wrap'}}>
        <Card title="직원 관리" style={{flex:1,minWidth:300}}>
          <div style={{display:'flex',gap:8,marginBottom:6,flexWrap:'wrap'}}>
            <input value={newWorker} onChange={e=>setNewWorker(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleAddWorker()} placeholder="직원명"
              style={{flex:'1 1 100px',minWidth:100,padding:'7px 10px',border:'1px solid #e5e7eb',borderRadius:7,fontSize:13}}/>
            <input type="date" value={newHiredAt} onChange={e=>setNewHiredAt(e.target.value)}
              style={{padding:'7px 10px',border:'1px solid #e5e7eb',borderRadius:7,fontSize:13}}/>
            <input type="email" value={newEmail} onChange={e=>setNewEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleAddWorker()} placeholder="회사 메일 주소"
              style={{flex:'1 1 180px',minWidth:160,padding:'7px 10px',border:'1px solid #e5e7eb',borderRadius:7,fontSize:13}}/>
            <button onClick={handleAddWorker} style={{padding:'7px 14px',borderRadius:7,border:'none',background:'#1a56db',color:'#fff',cursor:'pointer',fontWeight:600}}>추가</button>
          </div>
          <div style={{fontSize:11,color:'#6b7280',marginBottom:12}}>
            직원명 + 입사일 + 메일 주소 입력 후 추가 — 메일 주소는 KPI 추적 시스템의 로그인 아이디로 쓰입니다
          </div>

          {workers.map(w=>(
            <div key={w.id} style={{border:'1px solid #e5e7eb',borderRadius:8,marginBottom:6,overflow:'hidden'}}>

              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 14px',background:w.active?'#fff':'#f9fafb'}}>
                <div>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <span style={{fontWeight:600}}>{w.name}</span>
                    {dupNames.has(w.name)&&(
                      <span title="같은 이름의 직원이 둘 이상 있어 입사일로 구분합니다"
                        style={{fontSize:10,padding:'2px 6px',borderRadius:8,background:'#fffbeb',color:'#92400e',border:'1px solid #fcd34d'}}>
                        동명이인
                      </span>
                    )}
                    <span style={{fontSize:11,padding:'2px 8px',borderRadius:10,fontWeight:600,
                      background:w.active?'#f0fdf4':'#fef2f2',color:w.active?'#0d7a4e':'#b91c1c'}}>
                      {w.active?'재직':'퇴사'}
                    </span>
                  </div>
                  <div style={{fontSize:11,color:'#9ca3af',marginTop:3}}>
                    입사: {w.hired_at||'-'}
                    {w.resigned_at&&<span style={{color:'#b91c1c',marginLeft:8}}>퇴사: {w.resigned_at}</span>}
                    <span style={{marginLeft:8,color:w.email?'#6b7280':'#d1d5db'}}>
                      ✉ {w.email||'메일 주소 없음'}
                    </span>
                  </div>
                </div>
                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                  <button onClick={()=>editingWorkerId===w.id?setEditingWorkerId(null):startEdit(w)}
                    style={{padding:'4px 10px',borderRadius:6,border:'1px solid #e5e7eb',
                      background:editingWorkerId===w.id?'#f1f5f9':'#fff',cursor:'pointer',fontSize:11,color:'#6b7280'}}>
                    ✏️ 정보수정
                  </button>
                  <label style={{display:'flex',alignItems:'center',gap:4,cursor:'pointer',fontSize:12}}>
                    <input type="checkbox" checked={w.active} onChange={e=>handleToggle(w.id,e.target.checked)}/>재직
                  </label>
                  <span onClick={()=>handleDelWorker(w)} style={{cursor:'pointer',color:'#b91c1c',fontSize:18,fontWeight:700}}>&times;</span>
                </div>
              </div>

              {/* 날짜 수정 패널 */}
              {editingWorkerId===w.id&&(
                <div style={{background:'#f0f9ff',borderTop:'1px solid #bae6fd',padding:'12px 14px'}}>
                  <div style={{fontSize:11,fontWeight:700,color:'#0369a1',marginBottom:8}}>정보 수정</div>
                  <div style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'flex-end'}}>
                    <div>
                      <div style={{fontSize:11,color:'#6b7280',marginBottom:4}}>입사일</div>
                      <input type="date" value={editHiredAt} onChange={e=>setEditHiredAt(e.target.value)}
                        style={{padding:'6px 10px',border:'1px solid #7dd3fc',borderRadius:6,fontSize:13}}/>
                    </div>
                    <div>
                      <div style={{fontSize:11,color:'#6b7280',marginBottom:4}}>퇴사일 (없으면 비워두세요)</div>
                      <input type="date" value={editResignedAt} onChange={e=>setEditResignedAt(e.target.value)}
                        style={{padding:'6px 10px',border:'1px solid #fca5a5',borderRadius:6,fontSize:13}}/>
                    </div>
                    <div style={{flex:'1 1 200px',minWidth:180}}>
                      <div style={{fontSize:11,color:'#6b7280',marginBottom:4}}>회사 메일 주소 (KPI 로그인 아이디)</div>
                      <input type="email" value={editEmail} onChange={e=>setEditEmail(e.target.value)}
                        placeholder="예: hong@vi-tron.com"
                        style={{width:'100%',boxSizing:'border-box',padding:'6px 10px',border:'1px solid #7dd3fc',borderRadius:6,fontSize:13}}/>
                    </div>
                    <div style={{display:'flex',gap:6}}>
                      <button onClick={confirmEdit}
                        style={{padding:'6px 14px',borderRadius:6,border:'none',background:'#0369a1',color:'#fff',cursor:'pointer',fontSize:12,fontWeight:600}}>저장</button>
                      <button onClick={()=>setEditingWorkerId(null)}
                        style={{padding:'6px 14px',borderRadius:6,border:'1px solid #e5e7eb',background:'#fff',cursor:'pointer',fontSize:12}}>취소</button>
                    </div>
                  </div>
                </div>
              )}

              {/* 퇴사 처리 패널 */}
              {resigningWorkerId===w.id&&(
                <div style={{background:'#fef2f2',borderTop:'1px solid #fecaca',padding:'10px 14px',display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                  <span style={{fontSize:12,fontWeight:600,color:'#b91c1c'}}>퇴사일자:</span>
                  <input type="date" value={resignDate} onChange={e=>setResignDate(e.target.value)}
                    style={{padding:'5px 8px',border:'1px solid #fca5a5',borderRadius:6,fontSize:13}}/>
                  <button onClick={confirmResign}
                    style={{padding:'5px 12px',borderRadius:6,border:'none',background:'#b91c1c',color:'#fff',cursor:'pointer',fontSize:12,fontWeight:600}}>확인</button>
                  <button onClick={()=>setResigningWorkerId(null)}
                    style={{padding:'5px 12px',borderRadius:6,border:'1px solid #e5e7eb',background:'#fff',cursor:'pointer',fontSize:12}}>취소</button>
                </div>
              )}

            </div>
          ))}
        </Card>

        <Card title="Jira 동기화" style={{flex:1,minWidth:280}}>
          <button onClick={handleSyncJira} style={{padding:'8px 16px',borderRadius:7,border:'none',background:'#0d7a4e',color:'#fff',cursor:'pointer',fontWeight:600,marginBottom:12}}>Jira 동기화</button>
          <div style={{background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:8,padding:'10px 12px',fontSize:12,color:'#1e40af'}}>동기화 버튼을 눌러 Jira 이슈를 불러오세요.</div>
          {tokenStatus.configured&&(
            <div style={{marginTop:8,fontSize:12,color:tokenStatus.level==='ok'?'#6b7280':'#b45309'}}>
              API 토큰 만료: <strong>{tokenStatus.expiresAt}</strong>
              {tokenStatus.daysLeft>=0?` (${tokenStatus.daysLeft}일 남음)`:' (만료됨)'}
            </div>
          )}
        </Card>
      </div>

      <Card title="고정업무 — Jira 에 없는 반복 업무" style={{marginBottom:16}}>
        <div style={{background:'#fffbeb',border:'1px solid #fde68a',borderRadius:8,padding:'10px 12px',fontSize:12,color:'#92400e',marginBottom:10}}>
          주간회의처럼 <b>끝이 없어 Jira 일감으로 만들기 애매한 업무</b>를 여기에 등록합니다.
          <br />업무 입력 화면의 상위업무에서 <b>「{FIXED_PARENT}」</b> 를 고르면 하위에 나옵니다.
          <br /><b>Jira 동기화를 해도 지워지지 않습니다.</b>
        </div>
        <div style={{display:'flex',gap:8,marginBottom:10}}>
          <input value={newFixed} onChange={e=>setNewFixed(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleAddFixed()}
            placeholder="예: [주간회의]"
            style={{flex:1,padding:'7px 10px',border:'1px solid #e5e7eb',borderRadius:7,fontSize:13}}/>
          <button onClick={handleAddFixed} style={{padding:'7px 14px',borderRadius:7,border:'none',background:'#b45309',color:'#fff',cursor:'pointer',fontWeight:600}}>추가</button>
        </div>
        {fixedTasks.length===0
          ? <p style={{color:'#9ca3af',fontSize:12,padding:'8px 4px'}}>아직 등록된 고정업무가 없습니다.</p>
          : <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
              {fixedTasks.map(t=>(
                <span key={t} style={{display:'inline-flex',alignItems:'center',gap:8,padding:'5px 10px',background:'#fef3c7',border:'1px solid #fcd34d',borderRadius:999,fontSize:12,color:'#92400e'}}>
                  {t}
                  <span onClick={()=>handleDelJira(t)} style={{cursor:'pointer',color:'#b91c1c',fontWeight:700}}>&times;</span>
                </span>
              ))}
            </div>}
      </Card>

      <Card title="Jira 업무 목록">
        <div style={{display:'flex',gap:8,marginBottom:10}}>
          <input value={newJira} onChange={e=>setNewJira(e.target.value)} placeholder="예: VITRON-11 신규 기능"
            style={{flex:1,padding:'7px 10px',border:'1px solid #e5e7eb',borderRadius:7,fontSize:13}}/>
          <select value={newJiraParent} onChange={e=>setNewJiraParent(e.target.value)} style={{width:200,padding:'7px 10px',border:'1px solid #e5e7eb',borderRadius:7,fontSize:13}}>
            <option value="">상위업무로 추가</option>
            {jiraParents.map(p=><option key={p} value={p}>{p}</option>)}
          </select>
          <button onClick={handleAddJira} style={{padding:'7px 14px',borderRadius:7,border:'none',background:'#1a56db',color:'#fff',cursor:'pointer',fontWeight:600}}>추가</button>
        </div>
        <div style={{maxHeight:320,overflowY:'auto'}}>
          {jiraParents.length===0?<p style={{color:'#9ca3af',fontSize:12,padding:12}}>Jira 동기화 버튼을 눌러주세요.</p>
            :jiraParents.map(p=>(
              <div key={p} style={{marginBottom:6}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 10px',background:'#eff6ff',borderRadius:6,fontSize:12}}>
                  <span style={{fontWeight:600,color:jiraDone.has(p)?'#6b7280':'#1e40af'}}>{jiraDone.has(p)?'(완료) ':''}{p}</span>
                  <span onClick={()=>handleDelJira(p)} style={{cursor:'pointer',color:'#b91c1c',fontWeight:700}}>&times;</span>
                </div>
                {(jiraTree[p]||[]).map(s=>(
                  <div key={s} style={{display:'flex',justifyContent:'space-between',padding:'4px 8px 4px 24px',fontSize:11,background:'#f0fdf4',borderLeft:'2px solid #6ee7b7',margin:'2px 0 2px 8px',borderRadius:'0 4px 4px 0'}}>
                    <span style={{color:jiraDone.has(s)?'#9ca3af':'inherit'}}>↳ {jiraDone.has(s)?'(완료) ':''}{s}</span>
                    <span onClick={()=>handleDelJira(s)} style={{cursor:'pointer',color:'#b91c1c',fontWeight:700}}>&times;</span>
                  </div>
                ))}
              </div>
            ))
          }
        </div>
      </Card>
    </div>
  )
}