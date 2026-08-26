import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 사내 업무 포털 전용 빌드.
// 🔑 대시보드와 «같은 저장소» 에 두는 이유 — 달력을 src/shared 에서 함께 쓰기 때문이다.
//    빌드만 따로 한다(포털은 별도 컨테이너로 뜬다).
//
// 🔑 base 를 './' 로 둔다. 포털은 두 주소로 열린다 —
//      http://vitron-nas/ERP/   (OMV nginx 가 넘겨주는 «진짜» 주소)
//      http://vitron-nas:8085/  (컨테이너 직접)
//    절대 경로('/ERP/')로 박으면 뒤엣것이 깨지고, '/' 로 두면 앞엣것이 깨진다.
// ⚠ root 를 portal 로 잡는다. 그러지 않으면 결과가 portal/dist/portal/ 로
//   한 겹 더 들어가 nginx 가 index.html 을 못 찾는다.
export default defineConfig({
  root: 'portal',
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  // 확인용 개발 서버. 운영에서는 컨테이너의 nginx 가 같은 일을 한다
  //   /api/dash → 대시보드 · /api/kpi → KPI
  server: {
    port: 5175,
    // ⚠ root 가 portal 이라 그 밖(src/shared)은 기본적으로 막힌다. 열어 준다.
    fs: { allow: ['..'] },
    proxy: {
      '/api/dash': { target: 'http://localhost:3001', changeOrigin: true,
        rewrite: p => p.replace(/^\/api\/dash/, '/api') },
      '/api/kpi': { target: 'http://localhost:3002', changeOrigin: true,
        rewrite: p => p.replace(/^\/api\/kpi/, '/api') },
    },
  },
})
