# 사내 업무 포털 배포 — portal 폴더만 보내고 그 스택만 갈아 끼운다.
#
#   .\push-portal.ps1            포털만 배포
#   .\push-portal.ps1 -WithOmv   NAS 의 /ERP 주소 설정(nginx)까지 다시 넣는다
#
# 🔑 대시보드·KPI 와 «별개 스택» 이라 이것을 돌려도 그 둘은 건드리지 않는다.
#    포털만 손볼 때 운영 중인 두 앱을 재배포하지 않으려고 나눠 두었다.
#
# ⚠ 빌드 단계가 없다(정적 HTML). 그래서 git archive 를 쓰지 않고 파일을 그대로 보낸다 —
#   커밋하지 않은 수정도 그대로 반영되므로, 확인용으로 빠르게 돌리기 좋다.

param([switch]$WithOmv)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# 🔴 PowerShell 5.1 의 함정 — native 명령의 stderr 가 «오류» 로 둔갑한다.
#    npx·ssh·scp 는 진행 상황을 stderr 로 내고, 특히 `nginx -t` 는 «성공 메시지»
#    ("test is successful") 조차 stderr 로 낸다. 그런데 5.1 은
#    $ErrorActionPreference='Stop' 일 때 그 줄들을 NativeCommandError 로 감싸
#    «종료 오류» 로 만든다 — 아래의 $LASTEXITCODE 검사는 거기까지 가 보지도 못한다.
#    push-to-nas.ps1 에서 실제로 배포가 한복판에서 끊겼다 (2026-08-29).
#
# 🔑 native 를 부르는 «그 구간만» Continue 로 낮추고, 성패는 stderr 가 아니라
#    «종료 코드» 로 판정한다. 그것이 원래 옳은 판정 기준이다.
#    ⚠ cmdlet 에 대한 Stop 은 그대로 살려 둔다 — 그쪽은 stderr 문제가 없다.
function Invoke-Native {
    param([scriptblock]$Command, [string]$What)
    $saved = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $Command } finally { $ErrorActionPreference = $saved }
    if ($LASTEXITCODE -ne 0) { throw "$What 실패 (exit $LASTEXITCODE)" }
}

$nas       = 'root@vitron-nas'
$remoteDir = '/volume1/docker-build-portal'
$omvConf   = '/etc/nginx/openmediavault-webgui.d/zz-vitron-erp.conf'

Write-Host "[1/4] 포털 빌드" -ForegroundColor Cyan
# ⚠ 빌드는 여기서 한다. 컨테이너 안에서 하려면 src/shared 까지 보내야 하고,
#   그러면 대시보드 소스 전체가 포털 이미지에 들어간다.
Invoke-Native { npx vite build --config vite.portal.config.js } '빌드'

Write-Host "[2/4] portal 폴더 전송" -ForegroundColor Cyan
Invoke-Native { ssh $nas "rm -rf $remoteDir/dist && mkdir -p $remoteDir" } '폴더 만들기'

Invoke-Native { scp .\portal\Dockerfile .\portal\deploy.sh .\portal\docker-compose.yml `
    .\portal\nginx.conf "${nas}:$remoteDir/" } '전송'
Invoke-Native { scp -r .\portal\dist "${nas}:$remoteDir/" } '빌드 결과 전송'

if ($WithOmv) {
    Write-Host "[3/4] NAS 주소 설정(/ERP) 갱신" -ForegroundColor Cyan
    Invoke-Native { scp .\portal\omv-erp.conf "${nas}:$omvConf" } '설정 전송'
    # 🔴 반드시 검사부터. 이 설정이 깨지면 NAS 관리 화면까지 함께 죽는다.
    # ⚠ nginx -t 는 «성공해도» stderr 로 말한다 — 그래서 Invoke-Native 가 꼭 필요하다.
    Invoke-Native { ssh $nas "nginx -t && systemctl reload nginx" } `
        'nginx 설정 검사 — 올바르지 않아 reload 하지 않았습니다'
}
else {
    Write-Host "[3/4] NAS 주소 설정은 건드리지 않습니다 (-WithOmv 로 갱신)" -ForegroundColor DarkGray
}

Write-Host "[4/4] 원격 이미지 교체" -ForegroundColor Cyan
Invoke-Native { ssh $nas "chmod +x $remoteDir/deploy.sh && cd $remoteDir && ./deploy.sh" } '원격 배포'

Write-Host ""
Write-Host "배포 완료 — http://vitron-nas/ERP" -ForegroundColor Green
