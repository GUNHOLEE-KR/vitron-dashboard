import { useState, useEffect } from 'react'
import { BarChart, Bar, PieChart, Pie, Cell, LineChart, Line,
         ComposedChart, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { getWorkers, addWorker, setWorkerStatus, removeWorker, updateWorkerDates } from './repositories/workerRepo'
import { getHistory, getHistoryByDate, saveWorkerHistory } from './repositories/historyRepo'
import { getJiraTree, syncJira, addJiraIssue, removeJiraIssue } from './repositories/jiraRepo'

const WORK_HOURS=[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23]
const COLORS=['#3b82f6','#10b981','#f59e0b','#8b5cf6','#06b6d4','#ec4899','#84cc16','#f97316']
const TABS=['today','daily','weekly','monthly','yearly','settings']
const TAB_LABELS={today:'오늘 업무',daily:'일간',weekly:'주간',monthly:'월간',yearly:'연간',settings:'설정'}
const thS={background:'#f9fafb',padding:'8px 10px',textAlign:'center',fontWeight:700,border:'1px solid #e5e7eb',fontSize:11,color:'#6b7280',whiteSpace:'nowrap'}
const tdS={padding:'6px 10px',border:'1px solid #e5e7eb',textAlign:'center',verticalAlign:'middle',fontSize:12}

function today(){return new Date().toISOString().slice(0,10)}
function toMonth(d){return d.slice(0,7)}
function toYear(d){return parseInt(d.slice(0,4))}
function weekNum(d){return Math.ceil(new Date(d).getDate()/7)}
function dayName(d){return['일','월','화','수','목','금','토'][new Date(d).getDay()]}

// 기간별 직원 필터 헬퍼
function workersForPeriod(workers, periodStart, periodEnd) {
  return workers.filter(w => {
    const hiredOk = !w.hired_at || w.hired_at <= periodEnd
    const resignedOk = !w.resigned_at || w.resigned_at >= periodStart
    return hiredOk && resignedOk
  })
}
function monthEnd(ym) {
  const [y,m]=ym.split('-').map(Number)
  return new Date(y,m,0).toISOString().slice(0,10)
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

function aggByWorker(rows){
  const m={}
  rows.forEach(r=>{
    if(!m[r.worker_name])m[r.worker_name]={total:0,works:{}}
    m[r.worker_name].total++
    m[r.worker_name].works[r.work_text]=(m[r.worker_name].works[r.work_text]||0)+1
  })
  return m
}
function aggByWork(rows){const m={};rows.forEach(r=>{m[r.work_text]=(m[r.work_text]||0)+1});return m}
function top8(rows){
  return Object.entries(aggByWork(rows)).sort((a,b)=>b[1]-a[1]).slice(0,8)
    .map(([name,value])=>({name:name.length>15?name.slice(0,15)+'…':name,value}))
}
function buildParentSel(rows,jiraTree){
  const ps={}
  rows.forEach(r=>{
    const key=`${r.work_hour}_${r.worker_name}`,val=r.work_text
    if(jiraTree[val]!==undefined){ps[key]=val}
    else{for(const[p,s]of Object.entries(jiraTree)){if(s.includes(val)){ps[key]=p;break}}}
  })
  return ps
}

// ── 직원별 업무 분석 ──────────────────────────────────
function WorkerAnalysis({rows,workers}){
  if(!rows.length)return null
  const wNames=workers.map(w=>w.name).filter(n=>rows.some(r=>r.worker_name===n))
  const topTasks=Object.entries(aggByWork(rows)).sort((a,b)=>b[1]-a[1]).slice(0,8).map(e=>e[0])
  const taskLabels=topTasks.map(t=>t.length>16?t.slice(0,16)+'…':t)
  const barData=wNames.map(w=>{
    const wRows=rows.filter(r=>r.worker_name===w)
    const obj={name:w,total:wRows.length}
    topTasks.forEach((t,i)=>{obj[taskLabels[i]]=wRows.filter(r=>r.work_text===t).length})
    return obj
  })
  const tableRows=[]
  wNames.forEach(w=>{
    const wRows=rows.filter(r=>r.worker_name===w)
    const total=wRows.length;if(!total)return
    const tg={}; wRows.forEach(r=>{tg[r.work_text]=(tg[r.work_text]||0)+1})
    Object.entries(tg).sort((a,b)=>b[1]-a[1]).forEach(([task,hours])=>{
      tableRows.push({worker:w,task,hours,ratio:Math.round(hours/total*100),wi:wNames.indexOf(w)})
    })
  })
  return(
    <div style={{display:'flex',gap:16,flexWrap:'wrap',marginBottom:16}}>
      <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,padding:18,flex:2,minWidth:300}}>
        <div style={{fontSize:14,fontWeight:700,marginBottom:14}}>직원별 업무 구성</div>
        <ResponsiveContainer width="100%" height={Math.max(200,wNames.length*52+60)}>
          <BarChart data={barData} layout="vertical">
            <XAxis type="number" tick={{fontSize:11}}/>
            <YAxis type="category" dataKey="name" tick={{fontSize:12}} width={55}/>
            <Tooltip/><Legend wrapperStyle={{fontSize:10}}/>
            {taskLabels.map((t,i)=><Bar key={t} dataKey={t} stackId="a" fill={COLORS[i%COLORS.length]} radius={i===taskLabels.length-1?[0,4,4,0]:[0,0,0,0]}/>)}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,padding:18,flex:1.5,minWidth:280,overflowX:'auto'}}>
        <div style={{fontSize:14,fontWeight:700,marginBottom:14}}>직원별 업무 상세</div>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead><tr>
            <th style={thS}>직원</th><th style={{...thS,textAlign:'left'}}>업무</th>
            <th style={thS}>시간</th><th style={{...thS,minWidth:120}}>비율</th>
          </tr></thead>
          <tbody>
            {tableRows.map((r,i)=>(
              <tr key={i} style={{background:i%2===0?'#f9fafb':'#fff'}}>
                <td style={{...tdS,fontWeight:600,color:COLORS[r.wi%COLORS.length]}}>{r.worker}</td>
                <td style={{...tdS,textAlign:'left',maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={r.task}>{r.task}</td>
                <td style={tdS}><span style={{background:'#eff6ff',color:'#1a56db',padding:'2px 8px',borderRadius:12,fontWeight:700}}>{r.hours}h</span></td>
                <td style={tdS}>
                  <div style={{display:'flex',alignItems:'center',gap:5}}>
                    <div style={{flex:1,height:7,background:'#e5e7eb',borderRadius:4}}>
                      <div style={{width:r.ratio+'%',height:'100%',background:COLORS[r.wi%COLORS.length],borderRadius:4}}/>
                    </div>
                    <span style={{fontSize:11,minWidth:34,fontWeight:600}}>{r.ratio}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── 프로젝트 집중도 분석 ──────────────────────────────
function ProjectAnalysis({rows,allHistory}){
  if(!rows.length)return null
  const periodAgg=aggByWork(rows),totalAgg=aggByWork(allHistory)
  const data=Object.entries(periodAgg).sort((a,b)=>b[1]-a[1]).slice(0,10)
    .map(([name,ph])=>{
      const th=totalAgg[name]||ph
      return{name:name.length>16?name.slice(0,16)+'…':name,fullName:name,기간:ph,누적:th,집중도:Math.round(ph/th*100)}
    })
  return(
    <div style={{display:'flex',gap:16,flexWrap:'wrap',marginBottom:16}}>
      <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,padding:18,flex:2,minWidth:300}}>
        <div style={{fontSize:14,fontWeight:700,marginBottom:14}}>프로젝트 기간/누적 비교</div>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={data}>
            <XAxis dataKey="name" tick={{fontSize:10}} interval={0} angle={-20} textAnchor="end" height={55}/>
            <YAxis yAxisId="left" orientation="left" tick={{fontSize:11}}/>
            <YAxis yAxisId="right" orientation="right" unit="%" domain={[0,100]} tick={{fontSize:11}}/>
            <Tooltip/><Legend wrapperStyle={{fontSize:11}}/>
            <Bar yAxisId="left" dataKey="기간" fill="#3b82f6" barSize={18} radius={[4,4,0,0]}/>
            <Bar yAxisId="left" dataKey="누적" fill="#e5e7eb" barSize={18} radius={[4,4,0,0]}/>
            <Line yAxisId="right" type="monotone" dataKey="집중도" stroke="#f59e0b" strokeWidth={2} dot={{r:4}}/>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,padding:18,flex:1.5,minWidth:280,overflowX:'auto'}}>
        <div style={{fontSize:14,fontWeight:700,marginBottom:14}}>프로젝트 집중도 상세</div>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead><tr>
            <th style={{...thS,textAlign:'left'}}>프로젝트</th>
            <th style={thS}>기간(h)</th><th style={thS}>누적(h)</th>
            <th style={{...thS,minWidth:120}}>집중도</th>
          </tr></thead>
          <tbody>
            {data.map((r,i)=>(
              <tr key={i} style={{background:i%2===0?'#f9fafb':'#fff'}}>
                <td style={{...tdS,textAlign:'left',maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={r.fullName}>{r.name}</td>
                <td style={tdS}><span style={{background:'#eff6ff',color:'#1a56db',padding:'2px 8px',borderRadius:12,fontWeight:700}}>{r.기간}h</span></td>
                <td style={tdS}><span style={{background:'#f9fafb',color:'#6b7280',padding:'2px 8px',borderRadius:12}}>{r.누적}h</span></td>
                <td style={tdS}>
                  <div style={{display:'flex',alignItems:'center',gap:5}}>
                    <div style={{flex:1,height:7,background:'#e5e7eb',borderRadius:4}}>
                      <div style={{width:r.집중도+'%',height:'100%',background:'#f59e0b',borderRadius:4}}/>
                    </div>
                    <span style={{fontSize:11,minWidth:34,fontWeight:700,color:'#b45309'}}>{r.집중도}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function App(){
  const [tab,setTab]=useState('today')
  const [workers,setWorkers]=useState([])
  const [history,setHistory]=useState([])
  const [jiraTree,setJiraTree]=useState({})
  const [grid,setGrid]=useState({})
  const [parentSel,setParentSel]=useState({})
  const [selWorker,setSelWorker]=useState('')
  const [viewDate,setViewDate]=useState(today())
  const [viewMonth,setViewMonth]=useState(toMonth(today()))
  const [viewYear,setViewYear]=useState(toYear(today()))
  const [loading,setLoading]=useState(true)
  const [toast,setToast]=useState('')

  // 오늘 기준 재직 중인 직원만 (입사일 이후 + 퇴사 전)
  const td=today()
  const activeWorkers=workers.filter(w=>
    w.active &&
    (!w.hired_at || w.hired_at<=td) &&
    (!w.resigned_at || w.resigned_at>=td)
  )
  const jiraParents=Object.keys(jiraTree)

  function showToast(msg){setToast(msg);setTimeout(()=>setToast(''),2500)}

  useEffect(()=>{
    Promise.all([getWorkers(),getHistory(),getJiraTree()])
      .then(([w,h,j])=>{
        setWorkers(w);setHistory(h);setJiraTree(j)
        const tr=h.filter(r=>r.work_date===today())
        const g={}; tr.forEach(r=>{g[`${r.work_hour}_${r.worker_name}`]=r.work_text})
        setGrid(g); setParentSel(buildParentSel(tr,j))
      }).finally(()=>setLoading(false))
  },[])

  async function handleSave(){
    if(!selWorker){showToast('이름을 먼저 선택하세요');return}
    const ds=today()
    const rows=WORK_HOURS.filter(h=>grid[`${h}_${selWorker}`])
      .map(h=>({work_date:ds,work_hour:h,worker_name:selWorker,work_text:grid[`${h}_${selWorker}`]}))
    try{
      await saveWorkerHistory(selWorker,rows)
      setHistory([...history.filter(r=>!(r.work_date===ds&&r.worker_name===selWorker)),...rows])
      showToast(`${selWorker} 저장 완료 (${rows.length}건)`)
    }catch(e){showToast('저장 실패: '+e.message)}
  }

  async function handleLoadDate(date){
    try{
      showToast('조회 중...')
      const rows=await getHistoryByDate(date)
      const g={}; rows.forEach(r=>{g[`${r.work_hour}_${r.worker_name}`]=r.work_text})
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
      <nav style={{background:'#fff',borderBottom:'1px solid #e5e7eb',display:'flex',padding:'0 20px',overflowX:'auto'}}>
        {TABS.map(t=>(
          <button key={t} onClick={()=>setTab(t)}
            style={{padding:'10px 16px',fontSize:13,fontWeight:tab===t?700:500,
              color:tab===t?'#1a56db':'#6b7280',background:'none',border:'none',
              borderBottom:tab===t?'2px solid #1a56db':'2px solid transparent',
              cursor:'pointer',whiteSpace:'nowrap'}}>{TAB_LABELS[t]}</button>
        ))}
      </nav>
      <main style={{padding:20,maxWidth:1400,margin:'0 auto'}}>
        {tab==='today'   &&<TabToday   workers={activeWorkers} grid={grid} setGrid={setGrid}
          jiraTree={jiraTree} selWorker={selWorker} setSelWorker={setSelWorker}
          onSave={handleSave} onLoadDate={handleLoadDate} parentSel={parentSel} setParentSel={setParentSel}/>}
        {tab==='daily'   &&<TabDaily   history={history} workers={workers} viewDate={viewDate} setViewDate={setViewDate}/>}
        {tab==='weekly'  &&<TabWeekly  history={history} workers={workers} viewDate={viewDate} setViewDate={setViewDate}/>}
        {tab==='monthly' &&<TabMonthly history={history} workers={workers} viewMonth={viewMonth} setViewMonth={setViewMonth}/>}
        {tab==='yearly'  &&<TabYearly  history={history} workers={workers} viewYear={viewYear} setViewYear={setViewYear}/>}
        {tab==='settings'&&<TabSettings workers={workers} setWorkers={setWorkers}
          jiraTree={jiraTree} setJiraTree={setJiraTree} showToast={showToast}/>}
      </main>
      {toast&&(
        <div style={{position:'fixed',bottom:24,left:'50%',transform:'translateX(-50%)',
          background:'#111827',color:'#fff',padding:'10px 22px',borderRadius:24,
          fontSize:13,fontWeight:700,zIndex:9999,whiteSpace:'nowrap'}}>{toast}</div>
      )}
    </div>
  )
}

// ── 오늘 업무 탭 ─────────────────────────────────────────
function TabToday({workers,grid,setGrid,jiraTree,selWorker,setSelWorker,onSave,onLoadDate,parentSel,setParentSel}){
  const [ldDate,setLdDate]=useState(today())
  const curH=new Date().getHours()
  const jiraParents=Object.keys(jiraTree)
  function onParentChange(h,w,val){const k=`${h}_${w}`;setParentSel(p=>({...p,[k]:val}));setGrid(g=>({...g,[k]:val}))}
  function onSubChange(h,w,val){setGrid(g=>({...g,[`${h}_${w}`]:val}))}
  function onDirectInput(h,w,val){const k=`${h}_${w}`;setParentSel(p=>({...p,[k]:''}));setGrid(g=>({...g,[k]:val}))}
  return(
    <div>
      <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,padding:'14px 18px',marginBottom:16,display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:12}}>
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          <strong>오늘 업무 입력</strong>
          <input type="date" value={ldDate} onChange={e=>setLdDate(e.target.value)} style={{padding:'6px 10px',border:'1px solid #e5e7eb',borderRadius:7,fontSize:13}}/>
          <button onClick={()=>onLoadDate(ldDate)} style={{padding:'6px 14px',borderRadius:7,border:'1px solid #e5e7eb',background:'#fff',cursor:'pointer',fontSize:13}}>조회</button>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={()=>{if(!selWorker)return;const g={...grid};WORK_HOURS.forEach(h=>delete g[`${h}_${selWorker}`]);setGrid(g);const ps={...parentSel};WORK_HOURS.forEach(h=>delete ps[`${h}_${selWorker}`]);setParentSel(ps)}}
            style={{padding:'6px 14px',borderRadius:7,border:'1px solid #e5e7eb',background:'#fff',cursor:'pointer',fontSize:13}}>초기화</button>
          <button onClick={onSave} style={{padding:'6px 14px',borderRadius:7,border:'none',background:'#0d7a4e',color:'#fff',cursor:'pointer',fontSize:13,fontWeight:600}}>
            {selWorker?`${selWorker} 저장`:'이름 선택 후 저장'}
          </button>
        </div>
      </div>
      <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,padding:'12px 16px',marginBottom:16}}>
        <div style={{fontSize:12,color:'#6b7280',marginBottom:8}}>내 이름을 선택하면 해당 열만 편집됩니다</div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          {workers.map(w=>(
            <button key={w.name} onClick={()=>setSelWorker(w.name)}
              style={{padding:'6px 16px',borderRadius:20,fontSize:13,cursor:'pointer',
                border:`2px solid ${selWorker===w.name?'#1a56db':'#e5e7eb'}`,
                background:selWorker===w.name?'#1a56db':'#fff',
                color:selWorker===w.name?'#fff':'#6b7280',fontWeight:selWorker===w.name?700:500}}>
              {selWorker===w.name?'✎ ':''}{w.name}{selWorker===w.name?' (나)':''}
            </button>
          ))}
        </div>
      </div>
      <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,padding:16,overflowX:'auto'}}>
        <div style={{fontSize:11,color:'#6b7280',marginBottom:8,display:'flex',gap:16}}>
          <span><span style={{background:'#dbeafe',padding:'1px 8px',borderRadius:4,marginRight:4}}>①</span>상위업무</span>
          <span><span style={{background:'#dcfce7',padding:'1px 8px',borderRadius:4,marginRight:4}}>②</span>하위업무</span>
          <span><span style={{background:'#fffbeb',padding:'1px 8px',borderRadius:4,marginRight:4}}>③</span>직접 입력</span>
        </div>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
          <thead><tr>
            <th style={{background:'#1e3a5f',color:'#fff',padding:'8px 10px',width:60,border:'1px solid #e5e7eb'}}>시간</th>
            {workers.map(w=>(
              <th key={w.name} style={{background:selWorker===w.name?'#1a56db':'#64748b',color:'#fff',padding:'8px 12px',minWidth:180,border:'1px solid #e5e7eb'}}>
                {selWorker===w.name?'✎ ':''}{w.name}{selWorker===w.name?' (나)':''}
              </th>
            ))}
          </tr></thead>
          <tbody>
            {WORK_HOURS.map(h=>(
              <tr key={h} style={{background:h===curH?'#fef9c3':'#fff'}}>
                <td style={{background:h===curH?'#fef08a':'#f9fafb',fontWeight:700,fontSize:11,color:'#6b7280',padding:'4px 8px',border:'1px solid #e5e7eb',textAlign:'center',whiteSpace:'nowrap'}}>
                  {String(h).padStart(2,'0')}:00{h===curH?' ▶':''}
                </td>
                {workers.map(w=>{
                  const key=`${h}_${w.name}`,val=grid[key]||'',isMe=selWorker===w.name
                  const pVal=parentSel[key]||'',subs=pVal?(jiraTree[pVal]||[]):[]
                  return isMe?(
                    <td key={w.name} style={{border:'1px solid #e5e7eb',padding:4,verticalAlign:'top',minWidth:180}}>
                      <div style={{display:'flex',flexDirection:'column',gap:3}}>
                        <select value={pVal} onChange={e=>onParentChange(h,w.name,e.target.value)} style={{width:'100%',fontSize:11,padding:'3px 5px',border:'1px solid #93c5fd',borderRadius:5,background:'#eff6ff'}}>
                          <option value="">① 상위업무 선택</option>
                          {jiraParents.map(p=><option key={p} value={p}>{p.length>30?p.slice(0,30)+'…':p}</option>)}
                        </select>
                        <select value={subs.includes(val)?val:''} onChange={e=>onSubChange(h,w.name,e.target.value)} disabled={subs.length===0}
                          style={{width:'100%',fontSize:11,padding:'3px 5px',borderRadius:5,border:'1px solid #6ee7b7',background:subs.length===0?'#f9fafb':'#f0fdf4',color:subs.length===0?'#9ca3af':'#111827'}}>
                          <option value="">{subs.length===0?'② 하위업무 없음':'② 하위업무 선택'}</option>
                          {subs.map(s=><option key={s} value={s}>{s.length>30?s.slice(0,30)+'…':s}</option>)}
                        </select>
                        <input value={(!pVal&&!subs.includes(val))?val:''} onChange={e=>onDirectInput(h,w.name,e.target.value)} placeholder="③ 직접 입력"
                          style={{width:'100%',fontSize:11,padding:'3px 5px',border:'1px dashed #fcd34d',borderRadius:5,background:'#fffbeb'}}/>
                        {val&&<div style={{fontSize:10,color:'#374151',background:'#f1f5f9',padding:'2px 6px',borderRadius:4}}>✓ {val.length>28?val.slice(0,28)+'…':val}</div>}
                      </div>
                    </td>
                  ):(
                    <td key={w.name} style={{border:'1px solid #e5e7eb',padding:'6px 8px',background:val?'#f8fafc':'#fff',verticalAlign:'top'}}>
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
function Metrics({items}){
  return<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:10,marginBottom:16}}>
    {items.map(({label,value,color})=>(
      <div key={label} style={{background:'#f9fafb',border:'1px solid #e5e7eb',borderRadius:8,padding:'14px 16px',textAlign:'center'}}>
        <div style={{fontSize:26,fontWeight:700,color:color||'#1a56db'}}>{value}</div>
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
function TabDaily({history,workers,viewDate,setViewDate}){
  const rows=history.filter(r=>r.work_date===viewDate)
  const periodWorkers=workersForPeriod(workers,viewDate,viewDate)
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
        {label:'총 업무 기록',value:total,color:'#1a56db'},{label:'활동 직원',value:Object.keys(agg).length,color:'#0d7a4e'},
        {label:'업무 종류',value:Object.keys(aggByWork(rows)).length,color:'#b45309'},
        {label:'1인 평균',value:Object.keys(agg).length>0?Math.round(total/Object.keys(agg).length):0,color:'#6d28d9'}
      ]}/>
      <div style={{display:'flex',gap:16,flexWrap:'wrap',marginBottom:16}}>
        <Card title="직원별 업무량" style={{flex:2,minWidth:280}}>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={barData}><XAxis dataKey="name" tick={{fontSize:12}}/><YAxis/><Tooltip/>
              <Bar dataKey="업무수" radius={[4,4,0,0]}>{barData.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        {t8.length>0&&<Card title="업무 비중" style={{flex:1,minWidth:240}}>
          <ResponsiveContainer width="100%" height={230}>
            <PieChart><Pie data={t8} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
              {t8.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}</Pie>
              <Tooltip/><Legend wrapperStyle={{fontSize:11}}/></PieChart>
          </ResponsiveContainer>
        </Card>}
      </div>
      <SectionTitle>직원별 업무 분석</SectionTitle>
      <WorkerAnalysis rows={rows} workers={periodWorkers}/>
      <SectionTitle>프로젝트 집중도 분석</SectionTitle>
      <ProjectAnalysis rows={rows} allHistory={history}/>
    </div>
  )
}

// ── 주간 탭 ───────────────────────────────────────────────
function TabWeekly({history,workers,viewDate,setViewDate}){
  const ym=toMonth(viewDate),wk=weekNum(viewDate)
  const wS=weekStart(viewDate),wE=weekEnd(viewDate)
  const rows=history.filter(r=>toMonth(r.work_date)===ym&&weekNum(r.work_date)===wk)
  const periodWorkers=workersForPeriod(workers,wS,wE)
  const total=rows.length
  const days=[...new Set(rows.map(r=>r.work_date))].sort()
  const wNames=periodWorkers.map(w=>w.name)
  const dm={}
  rows.forEach(r=>{if(!dm[r.work_date])dm[r.work_date]={};dm[r.work_date][r.worker_name]=(dm[r.work_date][r.worker_name]||0)+1})
  const barData=days.map(d=>({name:d.slice(5)+'('+dayName(d)+')',...dm[d]}))
  return(
    <div>
      <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,padding:'14px 18px',marginBottom:16,display:'flex',gap:10,alignItems:'center'}}>
        <strong>주간 리포트</strong>
        <input type="date" value={viewDate} onChange={e=>setViewDate(e.target.value)} style={{padding:'6px 10px',border:'1px solid #e5e7eb',borderRadius:7,fontSize:13}}/>
        <span style={{fontSize:12,background:'#ede9fe',color:'#6d28d9',padding:'2px 10px',borderRadius:12,fontWeight:700}}>{ym.slice(5)}월 {wk}주차</span>
      </div>
      <Metrics items={[
        {label:'총 업무 기록',value:total,color:'#1a56db'},{label:'근무일수',value:days.length,color:'#0d7a4e'},
        {label:'일평균',value:days.length>0?Math.round(total/days.length):0,color:'#b45309'},
        {label:'1인 합계',value:wNames.length>0?Math.round(total/wNames.length):0,color:'#6d28d9'}
      ]}/>
      <Card title="일별 분포">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={barData}><XAxis dataKey="name" tick={{fontSize:11}}/><YAxis/><Tooltip/><Legend wrapperStyle={{fontSize:11}}/>
            {wNames.map((n,i)=><Bar key={n} dataKey={n} stackId="a" fill={COLORS[i%COLORS.length]} radius={i===wNames.length-1?[3,3,0,0]:[0,0,0,0]}/>)}
          </BarChart>
        </ResponsiveContainer>
      </Card>
      <SectionTitle>직원별 업무 분석</SectionTitle>
      <WorkerAnalysis rows={rows} workers={periodWorkers}/>
      <SectionTitle>프로젝트 집중도 분석</SectionTitle>
      <ProjectAnalysis rows={rows} allHistory={history}/>
    </div>
  )
}

// ── 월간 탭 ───────────────────────────────────────────────
function TabMonthly({history,workers,viewMonth,setViewMonth}){
  const mS=viewMonth+'-01',mE=monthEnd(viewMonth)
  const rows=history.filter(r=>toMonth(r.work_date)===viewMonth)
  const periodWorkers=workersForPeriod(workers,mS,mE)
  const total=rows.length,agg=aggByWorker(rows)
  const days=[...new Set(rows.map(r=>r.work_date))]
  const wm={}
  rows.forEach(r=>{const w=weekNum(r.work_date)+'주';if(!wm[w])wm[w]={};wm[w][r.worker_name]=(wm[w][r.worker_name]||0)+1})
  const wNames=periodWorkers.map(w=>w.name)
  const wData=Object.entries(wm).sort((a,b)=>a[0].localeCompare(b[0])).map(([name,d])=>({name,...d}))
  const t8=top8(rows)
  return(
    <div>
      <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,padding:'14px 18px',marginBottom:16,display:'flex',gap:10,alignItems:'center'}}>
        <strong>월간 분석</strong>
        <input type="month" value={viewMonth} onChange={e=>setViewMonth(e.target.value)} style={{padding:'6px 10px',border:'1px solid #e5e7eb',borderRadius:7,fontSize:13}}/>
      </div>
      <Metrics items={[
        {label:'총 업무 기록',value:total,color:'#1a56db'},{label:'근무일수',value:days.length,color:'#0d7a4e'},
        {label:'업무 종류',value:Object.keys(aggByWork(rows)).length,color:'#b45309'},
        {label:'1인 총 업무',value:wNames.length>0?Math.round(total/wNames.length):0,color:'#6d28d9'}
      ]}/>
      <div style={{display:'flex',gap:16,flexWrap:'wrap',marginBottom:16}}>
        <Card title="주차별 분포" style={{flex:2,minWidth:280}}>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={wData}><XAxis dataKey="name" tick={{fontSize:12}}/><YAxis/><Tooltip/><Legend wrapperStyle={{fontSize:11}}/>
              {wNames.map((n,i)=><Bar key={n} dataKey={n} stackId="a" fill={COLORS[i%COLORS.length]} radius={i===wNames.length-1?[3,3,0,0]:[0,0,0,0]}/>)}
            </BarChart>
          </ResponsiveContainer>
        </Card>
        {t8.length>0&&<Card title="업무 유형" style={{flex:1,minWidth:240}}>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart><Pie data={t8} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
              {t8.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}</Pie>
              <Tooltip/><Legend wrapperStyle={{fontSize:10}}/></PieChart>
          </ResponsiveContainer>
        </Card>}
      </div>
      <SectionTitle>직원별 업무 분석</SectionTitle>
      <WorkerAnalysis rows={rows} workers={periodWorkers}/>
      <SectionTitle>프로젝트 집중도 분석</SectionTitle>
      <ProjectAnalysis rows={rows} allHistory={history}/>
    </div>
  )
}

// ── 연간 탭 ───────────────────────────────────────────────
function TabYearly({history,workers,viewYear,setViewYear}){
  const yS=viewYear+'-01-01',yE=viewYear+'-12-31'
  const rows=history.filter(r=>toYear(r.work_date)===viewYear)
  const periodWorkers=workersForPeriod(workers,yS,yE)
  const total=rows.length,agg=aggByWorker(rows)
  const days=[...new Set(rows.map(r=>r.work_date))]
  const mm={}
  rows.forEach(r=>{const m=r.work_date.slice(5,7)+'월';if(!mm[m])mm[m]={};mm[m][r.worker_name]=(mm[m][r.worker_name]||0)+1})
  const wNames=periodWorkers.map(w=>w.name)
  const mData=Object.entries(mm).sort((a,b)=>parseInt(a[0])-parseInt(b[0])).map(([name,d])=>({name,...d}))
  const t8=top8(rows)
  const wbData=wNames.map((n,i)=>({name:n,업무수:agg[n]?.total||0,fill:COLORS[i%COLORS.length]}))
  return(
    <div>
      <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,padding:'14px 18px',marginBottom:16,display:'flex',gap:10,alignItems:'center'}}>
        <strong>연간 분석</strong>
        <input type="number" value={viewYear} min="2020" max="2099" onChange={e=>setViewYear(parseInt(e.target.value))} style={{width:90,padding:'6px 10px',border:'1px solid #e5e7eb',borderRadius:7,fontSize:13}}/>
      </div>
      <Metrics items={[
        {label:'총 업무 기록',value:total.toLocaleString(),color:'#1a56db'},{label:'연간 근무일',value:days.length,color:'#0d7a4e'},
        {label:'업무 종류',value:Object.keys(aggByWork(rows)).length,color:'#b45309'},
        {label:'1인 연간 합계',value:wNames.length>0?Math.round(total/wNames.length):0,color:'#6d28d9'}
      ]}/>
      <Card title="월별 업무량 추이">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={mData}><XAxis dataKey="name" tick={{fontSize:11}}/><YAxis/><Tooltip/><Legend wrapperStyle={{fontSize:11}}/>
            {wNames.map((n,i)=><Line key={n} type="monotone" dataKey={n} stroke={COLORS[i%COLORS.length]} strokeWidth={2} dot={{r:3}}/>)}
          </LineChart>
        </ResponsiveContainer>
      </Card>
      <div style={{display:'flex',gap:16,flexWrap:'wrap',marginBottom:16}}>
        <Card title="직원별 연간 실적" style={{flex:1.5,minWidth:280}}>
          <ResponsiveContainer width="100%" height={wNames.length*44+60}>
            <BarChart data={wbData} layout="vertical">
              <XAxis type="number"/><YAxis type="category" dataKey="name" tick={{fontSize:12}} width={60}/><Tooltip/>
              <Bar dataKey="업무수" radius={[0,4,4,0]}>{wbData.map((d,i)=><Cell key={i} fill={d.fill}/>)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        {t8.length>0&&<Card title="연간 업무 비중" style={{flex:1,minWidth:240}}>
          <ResponsiveContainer width="100%" height={wNames.length*44+60}>
            <PieChart><Pie data={t8} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
              {t8.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}</Pie>
              <Tooltip/><Legend wrapperStyle={{fontSize:10}}/></PieChart>
          </ResponsiveContainer>
        </Card>}
      </div>
      <SectionTitle>직원별 업무 분석</SectionTitle>
      <WorkerAnalysis rows={rows} workers={periodWorkers}/>
      <SectionTitle>프로젝트 집중도 분석</SectionTitle>
      <ProjectAnalysis rows={rows} allHistory={history}/>
    </div>
  )
}

// ── 설정 탭 ───────────────────────────────────────────────
function TabSettings({workers,setWorkers,jiraTree,setJiraTree,showToast}){
  const [newWorker,setNewWorker]=useState('')
  const [newHiredAt,setNewHiredAt]=useState(today())
  const [resigningWorker,setResigningWorker]=useState(null)
  const [resignDate,setResignDate]=useState(today())
  const [editingWorker,setEditingWorker]=useState(null)
  const [editHiredAt,setEditHiredAt]=useState('')
  const [editResignedAt,setEditResignedAt]=useState('')
  const [newJira,setNewJira]=useState('')
  const [newJiraParent,setNewJiraParent]=useState('')
  const jiraParents=Object.keys(jiraTree)

  function startEdit(w) {
    setEditingWorker(w.name)
    setEditHiredAt(w.hired_at||'')
    setEditResignedAt(w.resigned_at||'')
    setResigningWorker(null)
  }

  async function confirmEdit() {
    try {
      await updateWorkerDates(editingWorker, editHiredAt||null, editResignedAt||null)
      setWorkers(workers.map(w => w.name===editingWorker
        ? {...w, hired_at:editHiredAt||null, resigned_at:editResignedAt||null}
        : w))
      showToast(editingWorker+' 날짜 수정 완료')
      setEditingWorker(null)
    } catch(e) { showToast('수정 실패') }
  }

  async function handleAddWorker(){
    if(!newWorker.trim())return
    try{
      const w=await addWorker(newWorker.trim(),newHiredAt)
      setWorkers([...workers,w]);setNewWorker('');setNewHiredAt(today())
      showToast(w.name+' 입사 등록 ('+newHiredAt+')')
    }catch(e){showToast('추가 실패: '+e.message)}
  }

  function handleToggle(name,active){
    if(!active){
      setResigningWorker(name);setResignDate(today());setEditingWorker(null)
    }else{
      setWorkerStatus(name,true,null)
        .then(()=>{setWorkers(workers.map(w=>w.name===name?{...w,active:true,resigned_at:null}:w));showToast(name+' 재직 처리')})
        .catch(()=>showToast('변경 실패'))
    }
  }

  async function confirmResign(){
    try{
      await setWorkerStatus(resigningWorker,false,resignDate)
      setWorkers(workers.map(w=>w.name===resigningWorker?{...w,active:false,resigned_at:resignDate}:w))
      showToast(resigningWorker+' 퇴사 처리 ('+resignDate+')')
      setResigningWorker(null)
    }catch(e){showToast('변경 실패')}
  }

  async function handleDelWorker(name){
    if(!confirm(name+' 완전 삭제합니까?'))return
    try{await removeWorker(name);setWorkers(workers.filter(w=>w.name!==name));showToast(name+' 삭제 완료')}
    catch(e){showToast('삭제 실패')}
  }

  async function handleSyncJira(){
    showToast('동기화 중...')
    try{await syncJira();const tree=await getJiraTree();setJiraTree(tree);showToast('Jira 동기화 완료 ('+Object.keys(tree).length+'건)')}
    catch(e){showToast('동기화 실패: '+e.message)}
  }
  async function handleAddJira(){
    if(!newJira.trim())return
    try{await addJiraIssue(newJira.trim(),newJiraParent||null);const tree=await getJiraTree();setJiraTree(tree);setNewJira('');showToast('추가 완료')}
    catch(e){showToast('추가 실패')}
  }
  async function handleDelJira(text){
    try{await removeJiraIssue(text);const tree=await getJiraTree();setJiraTree(tree)}
    catch(e){showToast('삭제 실패')}
  }

  return(
    <div>
      <div style={{display:'flex',gap:16,flexWrap:'wrap'}}>
        <Card title="직원 관리" style={{flex:1,minWidth:300}}>
          <div style={{display:'flex',gap:8,marginBottom:6,flexWrap:'wrap'}}>
            <input value={newWorker} onChange={e=>setNewWorker(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleAddWorker()} placeholder="직원명"
              style={{flex:1,minWidth:100,padding:'7px 10px',border:'1px solid #e5e7eb',borderRadius:7,fontSize:13}}/>
            <input type="date" value={newHiredAt} onChange={e=>setNewHiredAt(e.target.value)}
              style={{padding:'7px 10px',border:'1px solid #e5e7eb',borderRadius:7,fontSize:13}}/>
            <button onClick={handleAddWorker} style={{padding:'7px 14px',borderRadius:7,border:'none',background:'#1a56db',color:'#fff',cursor:'pointer',fontWeight:600}}>추가</button>
          </div>
          <div style={{fontSize:11,color:'#6b7280',marginBottom:12}}>직원명 + 입사일 입력 후 추가</div>

          {workers.map(w=>(
            <div key={w.name} style={{border:'1px solid #e5e7eb',borderRadius:8,marginBottom:6,overflow:'hidden'}}>

              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 14px',background:w.active?'#fff':'#f9fafb'}}>
                <div>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <span style={{fontWeight:600}}>{w.name}</span>
                    <span style={{fontSize:11,padding:'2px 8px',borderRadius:10,fontWeight:600,
                      background:w.active?'#f0fdf4':'#fef2f2',color:w.active?'#0d7a4e':'#b91c1c'}}>
                      {w.active?'재직':'퇴사'}
                    </span>
                  </div>
                  <div style={{fontSize:11,color:'#9ca3af',marginTop:3}}>
                    입사: {w.hired_at||'-'}
                    {w.resigned_at&&<span style={{color:'#b91c1c',marginLeft:8}}>퇴사: {w.resigned_at}</span>}
                  </div>
                </div>
                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                  <button onClick={()=>editingWorker===w.name?setEditingWorker(null):startEdit(w)}
                    style={{padding:'4px 10px',borderRadius:6,border:'1px solid #e5e7eb',
                      background:editingWorker===w.name?'#f1f5f9':'#fff',cursor:'pointer',fontSize:11,color:'#6b7280'}}>
                    ✏️ 날짜수정
                  </button>
                  <label style={{display:'flex',alignItems:'center',gap:4,cursor:'pointer',fontSize:12}}>
                    <input type="checkbox" checked={w.active} onChange={e=>handleToggle(w.name,e.target.checked)}/>재직
                  </label>
                  <span onClick={()=>handleDelWorker(w.name)} style={{cursor:'pointer',color:'#b91c1c',fontSize:18,fontWeight:700}}>&times;</span>
                </div>
              </div>

              {/* 날짜 수정 패널 */}
              {editingWorker===w.name&&(
                <div style={{background:'#f0f9ff',borderTop:'1px solid #bae6fd',padding:'12px 14px'}}>
                  <div style={{fontSize:11,fontWeight:700,color:'#0369a1',marginBottom:8}}>날짜 수정</div>
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
                    <div style={{display:'flex',gap:6}}>
                      <button onClick={confirmEdit}
                        style={{padding:'6px 14px',borderRadius:6,border:'none',background:'#0369a1',color:'#fff',cursor:'pointer',fontSize:12,fontWeight:600}}>저장</button>
                      <button onClick={()=>setEditingWorker(null)}
                        style={{padding:'6px 14px',borderRadius:6,border:'1px solid #e5e7eb',background:'#fff',cursor:'pointer',fontSize:12}}>취소</button>
                    </div>
                  </div>
                </div>
              )}

              {/* 퇴사 처리 패널 */}
              {resigningWorker===w.name&&(
                <div style={{background:'#fef2f2',borderTop:'1px solid #fecaca',padding:'10px 14px',display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                  <span style={{fontSize:12,fontWeight:600,color:'#b91c1c'}}>퇴사일자:</span>
                  <input type="date" value={resignDate} onChange={e=>setResignDate(e.target.value)}
                    style={{padding:'5px 8px',border:'1px solid #fca5a5',borderRadius:6,fontSize:13}}/>
                  <button onClick={confirmResign}
                    style={{padding:'5px 12px',borderRadius:6,border:'none',background:'#b91c1c',color:'#fff',cursor:'pointer',fontSize:12,fontWeight:600}}>확인</button>
                  <button onClick={()=>setResigningWorker(null)}
                    style={{padding:'5px 12px',borderRadius:6,border:'1px solid #e5e7eb',background:'#fff',cursor:'pointer',fontSize:12}}>취소</button>
                </div>
              )}

            </div>
          ))}
        </Card>

        <Card title="Jira 동기화" style={{flex:1,minWidth:280}}>
          <button onClick={handleSyncJira} style={{padding:'8px 16px',borderRadius:7,border:'none',background:'#0d7a4e',color:'#fff',cursor:'pointer',fontWeight:600,marginBottom:12}}>Jira 동기화</button>
          <div style={{background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:8,padding:'10px 12px',fontSize:12,color:'#1e40af'}}>동기화 버튼을 눌러 Jira 이슈를 불러오세요.</div>
        </Card>
      </div>

      <Card title="Jira 업무 목록">
        <div style={{display:'flex',gap:8,marginBottom:10}}>
          <input value={newJira} onChange={e=>setNewJira(e.target.value)} placeholder="예: VITRON-11 신규 기능"
            style={{flex:1,padding:'7px 10px',border:'1px solid #e5e7eb',borderRadius:7,fontSize:13}}/>
          <select value={newJiraParent} onChange={e=>setNewJiraParent(e.target.value)} style={{width:200,padding:'7px 10px',border:'1px solid #e5e7eb',borderRadius:7,fontSize:13}}>
            <option value="">상위업무로 추가</option>
            {jiraParents.map(p=><option key={p} value={p}>{p.length>28?p.slice(0,28)+'…':p}</option>)}
          </select>
          <button onClick={handleAddJira} style={{padding:'7px 14px',borderRadius:7,border:'none',background:'#1a56db',color:'#fff',cursor:'pointer',fontWeight:600}}>추가</button>
        </div>
        <div style={{maxHeight:320,overflowY:'auto'}}>
          {jiraParents.length===0?<p style={{color:'#9ca3af',fontSize:12,padding:12}}>Jira 동기화 버튼을 눌러주세요.</p>
            :jiraParents.map(p=>(
              <div key={p} style={{marginBottom:6}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 10px',background:'#eff6ff',borderRadius:6,fontSize:12}}>
                  <span style={{fontWeight:600,color:'#1e40af'}}>{p}</span>
                  <span onClick={()=>handleDelJira(p)} style={{cursor:'pointer',color:'#b91c1c',fontWeight:700}}>&times;</span>
                </div>
                {(jiraTree[p]||[]).map(s=>(
                  <div key={s} style={{display:'flex',justifyContent:'space-between',padding:'4px 8px 4px 24px',fontSize:11,background:'#f0fdf4',borderLeft:'2px solid #6ee7b7',margin:'2px 0 2px 8px',borderRadius:'0 4px 4px 0'}}>
                    <span>↳ {s}</span>
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