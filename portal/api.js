// 포털이 뒤쪽 두 앱을 부르는 곳.
// 🔑 언제나 «상대 경로» 다. 이 쪽은 /ERP/ 아래에도, :8085/ 아래에도 놓이므로
//    앞에 «/» 를 붙이면 한쪽이 깨진다.
// 🔑 백엔드를 새로 만들지 않는다 — 컨테이너 안 nginx 가 넘겨준다
//    (/api/dash → 대시보드 3001 · /api/kpi → KPI 3002).

async function call(path) {
  const res = await fetch('api/' + path, { credentials: 'same-origin' })
  if (!res.ok) {
    // 🔑 «상태» 를 실어 보낸다. 404(그런 API 가 없다 = 아직 배포 전)와 진짜 고장을
    //    같은 문구로 보여 주면 멀쩡한 화면이 온통 오류처럼 읽힌다.
    const e = new Error('HTTP ' + res.status)
    e.status = res.status
    throw e
  }
  return res.json()
}

// 🔴 «어느 대시보드를 보고 있는가» — 운영인가 테스트인가.
//    포털은 nginx 설정 한 줄로 뒤쪽이 바뀌는데, 그 사실이 화면에 드러나지 않으면
//    시험 자료를 운영으로 착각하게 된다.
export const health = () => call('dash/health')
export const whoAmI = () => call('dash/auth/me')
export const getWorkers = () => call('dash/workers')
export const getVehicles = () => call('dash/schedule/vehicles')
export const getPlaces = () => call('dash/schedule/places')
export const getPlans = (from, to) => call(`dash/schedule/plans?from=${from}&to=${to}`)
export const getVacation = () => call('dash/schedule/vacation-summary')
export const getPurchases = () => call('dash/purchases')
export const getHistoryOn = (date) => call('dash/history/date/' + date)

// 바깥 주소는 한 곳에 모아 둔다. 포트가 바뀌면 여기만 고친다.
export const URLS = {
  dashboard: 'http://vitron-nas:8082',
  kpi: 'http://vitron-nas:8083',
  confluence: 'https://vi-tron.atlassian.net/wiki/spaces/ViTron',
  jira: 'https://vi-tron.atlassian.net/jira',
  gitea: 'http://vitron-nas:8084',
  // UR 로봇 시뮬레이터 — 화면이 바로 뜨도록 자동 접속·크기 맞춤을 붙인다
  ursim: 'http://vitron-nas:6080/vnc.html?autoconnect=true&resize=scale',
}
