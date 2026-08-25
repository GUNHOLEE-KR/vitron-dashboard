// 「가장 잘 갈라지는 N색」 을 고른다 — 내가 눈으로 고르지 않는다.
//
// 🔴 두 번 실패해서 만든 도구다.
//   1차 = 색상(hue)만 40도씩 벌리고 명도는 전부 같은 단계로 뒀다 → 「다 비슷하다」
//   2차 = ΔE 를 재 봤더니 전부 30 이상인데도 여전히 비슷했다.
//         지적받은 쌍이 전부 «같은 색 이름 계열» (파랑–보라, 빨강–주황–분홍, 초록–연두).
//   → 12px 점을 볼 때 사람은 «미세한 거리» 가 아니라 «색 이름» 으로 분류한다.
//
// 그래서 후보를 넓게 깔고 «가장 가까운 쌍의 ΔE 를 최대로» 만드는 조합을 찾는다.
// 이름이 겹치는 조합은 아예 후보에서 뺀다.
const hex2rgb = h => [1,3,5].map(i=>parseInt(h.slice(i,i+2),16))
function rgb2lab([r,g,b]){
  const f=v=>{v/=255; return v>0.04045?((v+0.055)/1.055)**2.4:v/12.92}
  const [R,G,B]=[f(r),f(g),f(b)]
  let x=(R*0.4124+G*0.3576+B*0.1805)/0.95047
  let y=(R*0.2126+G*0.7152+B*0.0722)/1.00000
  let z=(R*0.0193+G*0.1192+B*0.9505)/1.08883
  const g2=v=>v>0.008856?Math.cbrt(v):(7.787*v+16/116)
  ;[x,y,z]=[g2(x),g2(y),g2(z)]
  return [116*y-16, 500*(x-y), 200*(y-z)]
}
const LAB=new Map()
const lab=h=>{ if(!LAB.has(h)) LAB.set(h,rgb2lab(hex2rgb(h))); return LAB.get(h) }
const dE=(a,b)=>{const A=lab(a),B=lab(b)
  return Math.sqrt((A[0]-B[0])**2+(A[1]-B[1])**2+(A[2]-B[2])**2)}

function hue(h){
  const [r,g,b]=hex2rgb(h), mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn
  if(d===0) return -1
  let x
  if(mx===r) x=((g-b)/d)%6; else if(mx===g) x=(b-r)/d+2; else x=(r-g)/d+4
  return (x*60+360)%360
}
const sat=h=>{const [r,g,b]=hex2rgb(h);const mx=Math.max(r,g,b),mn=Math.min(r,g,b)
  return mx===0?0:(mx-mn)/mx}
const L=h=>lab(h)[0]
function name(h){
  const H=hue(h), l=L(h), S=sat(h)
  if(S<0.22||H<0) return '회색'
  if(H<16)  return l<45?'적갈':'빨강'
  if(H<42)  return l<50?'갈색':'주황'
  if(H<70)  return '노랑'
  if(H<160) return '초록'
  if(H<200) return '청록'
  if(H<250) return '파랑'
  if(H<292) return '보라'
  if(H<340) return '자주'
  return l>58?'분홍':'빨강'
}

// 후보 — 색 이름마다 밝기 여러 단계 (Tailwind 계열에서 뽑았다)
const POOL=[
  // 빨강 / 적갈
  '#f87171','#ef4444','#dc2626','#b91c1c','#7f1d1d',
  // 주황 / 갈색
  '#fdba74','#fb923c','#ea580c','#c2410c','#a16207','#92400e','#78350f',
  // 노랑
  '#fde047','#facc15','#eab308','#ca8a04',
  // 초록
  '#86efac','#4ade80','#22c55e','#16a34a','#15803d','#166534','#4d7c0f','#65a30d','#84cc16',
  // 청록
  '#67e8f9','#22d3ee','#06b6d4','#0891b2','#0e7490','#155e75','#14b8a6','#0d9488','#0f766e',
  // 파랑
  '#93c5fd','#60a5fa','#3b82f6','#2563eb','#1d4ed8','#1e40af','#1e3a8a',
  // 보라 / 자주
  '#d8b4fe','#c084fc','#a855f7','#9333ea','#7e22ce','#6b21a8','#d946ef','#a21caf','#86198f',
  // 분홍
  '#f9a8d4','#f472b6','#ec4899','#db2777','#be185d',
  // 회색 계열
  '#cbd5e1','#94a3b8','#64748b','#475569','#334155',
]

// 🔴 3차 실패에서 배운 것 — ΔE 가 59.8 인데도 「너무 비슷하다」 는 말을 들었다.
//    남색(밝기 27)과 적갈(밝기 28). **둘 다 아주 어두우면 12px 점에서는
//    색상이 보이지 않고 그냥 «검은 점» 둘로 보인다.**
//    ΔE 는 큰 화면 기준이라 작은 점에는 그대로 쓸 수 없다.
// → 후보를 «밝기 45~85» 로 자른다. 어두운 색은 아예 쓰지 않는다.
const L_MIN=45, L_MAX=85

function search(n, must=[], ban=[], uniqueName=true){
  let best=null
  // 무작위 재시작 + 탐욕 교체 — 후보 46개에서 8개를 고르는 조합은 다 훑기엔 크다
  for(let trial=0;trial<4000;trial++){
    let pick=[...must]
    // ⚠ 「쓰면 안 되는 색」 — 차량 색은 직원 색과 겹치면 안 된다.
    //   주 뷰의 차량 기준에서는 행(차량)과 배지(사람)가 «동시에» 보인다.
    const rest=POOL.filter(c=>!pick.includes(c)&&!ban.includes(c)
      &&!ban.some(b=>dE(b,c)<25)
      &&L(c)>=L_MIN&&L(c)<=L_MAX)
    // 첫 색은 무작위, 이후는 «지금까지 고른 것에서 가장 먼 색» 을 고른다
    if(pick.length<n) pick.push(rest[(trial*7+3)%rest.length])
    while(pick.length<n){
      let bestC=null,bestD=-1
      for(const c of rest){
        if(pick.includes(c)) continue
        if(uniqueName&&pick.some(p=>name(p)===name(c))) continue   // 이름이 겹치면 탈락
        const d=Math.min(...pick.map(p=>dE(p,c)))
        if(d>bestD){bestD=d;bestC=c}
      }
      if(!bestC) break
      pick.push(bestC)
    }
    if(pick.length<n) continue
    let mn=1e9
    for(let i=0;i<pick.length;i++) for(let j=i+1;j<pick.length;j++) mn=Math.min(mn,dE(pick[i],pick[j]))
    if(!best||mn>best.min) best={min:mn,pick:[...pick]}
  }
  return best
}

function show(title,res){
  console.log(`\n=== ${title} — 가장 가까운 쌍 ΔE ${res.min.toFixed(1)} ===`)
  res.pick.forEach(c=>console.log(`   ${c}  ${name(c).padEnd(4)} 밝기 ${L(c).toFixed(0).padStart(3)}`))
}

// 직원 8명 — 고광용은 회색으로 «고정» 한다 (일정을 넣지 않으므로 좋은 색을 쓰지 않는다)
const W=search(8,['#94a3b8'])
show('직원 8색 (회색 고정)', W)
// 차량 4대 — 직원 색과 겹치면 안 된다
const V=search(4,[],W.pick)
show('차량 4색 (직원 색 제외)', V)
// 자동 배정용 여유분 — 새로 들어온 사람/차량이 쓸 색. 이름 유일 제약은 푼다(이름이 11개뿐)
show('자동 배정 12색', search(12,[],[],false))
console.log('\n--- 코드에 넣을 값 ---')
console.log('직원:', JSON.stringify(W.pick))
console.log('차량:', JSON.stringify(V.pick))

// 고광용은 일정을 넣지 않으므로 «팔레트에서 아예 뺀다» (사용자 지시).
// 회색을 한 자리로 잡아 두는 대신, 실제로 쓰는 7명에게 7색을 최대로 벌린다.
const W7=search(7,[],['#94a3b8','#cbd5e1','#64748b'])
show('직원 7색 (고광용 제외 · 회색 안 씀)', W7)
const V7=search(4,[],W7.pick.concat(['#94a3b8']))
show('차량 4색 (그 7색과도 떨어뜨림)', V7)
console.log('\n직원7:', JSON.stringify(W7.pick))
console.log('차량4:', JSON.stringify(V7.pick))
