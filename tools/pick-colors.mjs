// 「가장 잘 갈라지는 N색」 을 고른다 — 사람이 눈으로 고르지 않는다.
//
// 🔴 네 번 틀리고 만든 규칙이다. 실패를 다 적어 둔다 — 다음 사람이 같은 길을 안 가도록.
//   1차 색상(hue)만 40도씩 벌리고 «명도·채도는 전부 같은 단계» → 「다 비슷하다」
//   2차 ΔE 가 모든 쌍 30 이상인데도 비슷했다. 지적받은 쌍이 전부 «같은 색 이름» —
//       파랑–보라 / 빨강–주황–분홍 / 초록–연두
//   3차 이름을 다르게 하고 ΔE 49 까지 올렸는데 남색(밝기27)·적갈(밝기28) 이 붙어 보였다
//       → **둘 다 어두우면 색상이 안 보이고 «검은 점» 둘이 된다**
//   4차 밝기를 45 이상으로 올렸더니 이번엔 주황(밝기57)·분홍(밝기57) 이 붙어 보였다
//       → **색상이 가까운데 밝기까지 같으면 붙는다.** ΔE 73.9 여도 그렇다.
//
// 🔑 그래서 «색상 간격» 과 «밝기 간격» 을 «함께» 본다. 하나만으로는 매번 뚫렸다.
//      색상이 멀면(≥55도)         밝기는 상관없다
//      색상이 어중간하면(35~55도)  밝기를 18 이상 벌린다
//      색상이 가까우면(<35도)      밝기를 30 이상 벌린다
//    ΔE 는 «큰 면적» 기준이라 12px 점에는 그대로 쓸 수 없다 — 보조 지표로만 쓴다.

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
const L=h=>lab(h)[0]
function hue(h){
  const [r,g,b]=hex2rgb(h), mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn
  if(d===0) return -1
  let x
  if(mx===r) x=((g-b)/d)%6; else if(mx===g) x=(b-r)/d+2; else x=(r-g)/d+4
  return (x*60+360)%360
}
const sat=h=>{const [r,g,b]=hex2rgb(h);const mx=Math.max(r,g,b),mn=Math.min(r,g,b)
  return mx===0?0:(mx-mn)/mx}
const hueGap=(a,b)=>{const d=Math.abs(hue(a)-hue(b)); return Math.min(d,360-d)}

// 🔑 이 함수가 이 도구의 전부다 — 「두 색이 작은 점에서 갈라지는가」
function ok(a,b){
  const dL=Math.abs(L(a)-L(b))
  const grayA=sat(a)<0.25, grayB=sat(b)<0.25
  // 회색끼리는 밝기로만 갈린다. 회색과 유채색은 채도 차이가 커서 눈에 바로 띈다.
  if(grayA&&grayB) return dL>=25
  if(grayA||grayB) return dL>=10||Math.abs(sat(a)-sat(b))>=0.45
  const hg=hueGap(a,b)
  if(hg>=55) return true          // 색상이 멀면 그것만으로 갈린다
  if(hg>=35) return dL>=16        // 어중간하면 밝기로 보탠다
  return dL>=26                   // 가까우면 밝기로 확실히 갈라야 한다
}

// 후보 — 이름마다 밝기 여러 단계. 어두운 것(밝기<45)은 애초에 넣지 않는다(3차 교훈).
const POOL=[
  '#f87171','#ef4444','#dc2626',                        // 빨강
  '#fdba74','#fb923c','#f97316','#ea580c',              // 주황
  '#fde047','#facc15','#eab308','#ca8a04',              // 노랑
  '#bef264','#a3e635','#84cc16','#65a30d',              // 라임
  '#86efac','#4ade80','#22c55e','#16a34a',              // 초록
  '#5eead4','#2dd4bf','#14b8a6','#0d9488',              // 민트
  '#67e8f9','#22d3ee','#06b6d4','#0891b2',              // 청록
  '#93c5fd','#60a5fa','#3b82f6','#2563eb',              // 파랑
  '#d8b4fe','#c084fc','#a855f7','#9333ea',              // 보라
  '#f0abfc','#e879f9','#d946ef','#c026d3',              // 자주
  '#f9a8d4','#f472b6','#ec4899','#db2777',              // 분홍
  '#cbd5e1','#94a3b8','#64748b',                        // 회색
]
// ⚠ 3차 교훈은 「둘 다 27~28 처럼 아주 어두우면 안 된다」 였지 «40 이 나쁘다» 가 아니다.
//   범위를 45~86 으로 좁혔더니 「밝기를 벌려라」 는 규칙과 부딪혀 답이 없어졌다.
//   40~88 로 넓힌다 — 밝기 40 은 색상이 충분히 보이는 선이다.
const L_MIN=40, L_MAX=88

// 🔑 탐욕으로는 못 찾는다 — 「지금 가장 먼 색」 을 집으면 뒤에서 막다른 길에 빠진다.
//    되짚어 찾기(백트래킹)로 «규칙을 지키는 조합» 을 전부 훑고 그중 ΔE 가 가장 큰 것을 고른다.
//    후보가 40여 개라 가지치기가 잘 들어 금방 끝난다.
// ⚠ 두 가지를 반드시 나눠야 한다 (한 번 뭉쳐 뒀다가 답이 0개가 됐다)
//    exclude  «이 색은 쓰지 않는다» — 목록에서 빼기만 한다
//    avoid    «이 색과 갈라져야 한다» — 규칙 검사까지 한다
//    회색을 avoid 에 넣었더니 `#64748b`(채도 0.29) 가 «회색» 이 아니라 «파랑» 으로 판정돼
//    진짜 파랑들이 통째로 후보에서 밀려났다. 그래서 7색 조합이 0개가 됐다.
function search(n, must=[], exclude=[], avoid=[], keepAway=[], keepAwayMin=0){
  const cand=POOL.filter(c=>L(c)>=L_MIN&&L(c)<=L_MAX
    &&!exclude.includes(c)&&!avoid.some(b=>!ok(b,c))
    // keepAway = 「규칙까지 걸면 답이 없지만, «거의 같은 색» 은 피하고 싶다」 는 자리
    &&!keepAway.some(b=>dE(b,c)<keepAwayMin))
  console.log(`   (후보 ${cand.length}개에서 ${n}개를 고른다)`)
  let best=null, seen=0
  const pick=[...must]
  ;(function dfs(from){
    if(seen>3_000_000) return                     // 안전망 — 폭주 방지
    if(pick.length===n){
      seen++
      let mn=1e9
      for(let i=0;i<pick.length;i++) for(let j=i+1;j<pick.length;j++) mn=Math.min(mn,dE(pick[i],pick[j]))
      if(!best||mn>best.min) best={min:mn,pick:[...pick]}
      return
    }
    // 남은 후보가 모자라면 더 볼 것 없다
    if(cand.length-from < n-pick.length) return
    for(let i=from;i<cand.length;i++){
      const c=cand[i]
      if(pick.includes(c)) continue
      if(!pick.every(p=>ok(p,c))) continue
      pick.push(c); dfs(i+1); pick.pop()
    }
  })(0)
  console.log(`   (규칙을 지키는 조합 ${seen.toLocaleString()}개)`)
  return best
}

function show(title,res){
  if(!res){ console.log(`\n=== ${title} — 찾지 못했습니다 (규칙이 너무 빡빡함) ===`); return }
  console.log(`\n=== ${title} — 가장 가까운 쌍 ΔE ${res.min.toFixed(1)} ===`)
  res.pick.forEach(c=>console.log(`   ${c}  색상 ${hue(c)<0?' 무채':String(Math.round(hue(c))).padStart(4)}  밝기 ${L(c).toFixed(0).padStart(3)}`))
  // 규칙을 실제로 다 지켰는지 되짚어 본다
  const bad=[]
  for(let i=0;i<res.pick.length;i++) for(let j=i+1;j<res.pick.length;j++){
    const a=res.pick[i],b=res.pick[j]
    if(!ok(a,b)) bad.push(`${a} vs ${b}`)
  }
  console.log(bad.length?`   ⚠ 규칙 위반 ${bad.length}: ${bad.join(', ')}`:'   ✅ 모든 쌍이 규칙 통과')
}

// 직원 7명 — 고광용은 일정을 넣지 않으므로 회색을 쓰고 팔레트에서 뺀다 (사용자 지시)
const GRAYS=['#cbd5e1','#94a3b8','#64748b']
const W=search(7,[],GRAYS)
show('직원 7색 (고광용 제외 · 회색 안 씀)', W)
// 차량 4대.
// ⚠ 직원 색과 «같은 규칙» 으로 갈라놓으려 했더니 후보가 2개로 줄어 답이 없었다 —
//   7색이 색상환을 이미 다 채웠기 때문이다.
//   🔑 차량 행(왼쪽 라벨)과 사람 배지(칸 안)는 «자리가 달라» 나란히 놓고 견주지 않는다.
//      그래서 직원 색과는 «똑같지만 않으면» 되고, 차량끼리만 확실히 갈리면 된다.
//      다만 «거의 같은 색» 은 피한다 — ΔE 30 은 띄운다.
const V=W?search(4,[],GRAYS.concat(W.pick),[],W.pick.concat(['#94a3b8']),30):null
show('차량 4색 (차량끼리 확실히 · 직원 색과 겹치지만 않게)', V)
if(W&&V){
  let mn=[1e9,'','']
  for(const a of V.pick) for(const b of W.pick){const d=dE(a,b); if(d<mn[0]) mn=[d,a,b]}
  console.log(`   참고 — 차량↔직원 가장 가까운 쌍 ${mn[1]} vs ${mn[2]} = ΔE ${mn[0].toFixed(1)}`)
}

console.log('\n--- 코드에 넣을 값 ---')
if(W) console.log('직원:', JSON.stringify(W.pick))
if(V) console.log('차량:', JSON.stringify(V.pick))
