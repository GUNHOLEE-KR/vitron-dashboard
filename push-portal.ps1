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

$nas       = 'root@vitron-nas'
$remoteDir = '/volume1/docker-build-portal'
$omvConf   = '/etc/nginx/openmediavault-webgui.d/zz-vitron-erp.conf'

Write-Host "[1/3] portal 폴더 전송" -ForegroundColor Cyan
ssh $nas "mkdir -p $remoteDir"
if ($LASTEXITCODE -ne 0) { throw "폴더 만들기 실패 (ssh exit $LASTEXITCODE)" }

scp .\portal\Dockerfile .\portal\deploy.sh .\portal\docker-compose.yml `
    .\portal\index.html .\portal\nginx.conf "${nas}:$remoteDir/"
if ($LASTEXITCODE -ne 0) { throw "전송 실패 (scp exit $LASTEXITCODE)" }

if ($WithOmv) {
    Write-Host "[2/3] NAS 주소 설정(/ERP) 갱신" -ForegroundColor Cyan
    scp .\portal\omv-erp.conf "${nas}:$omvConf"
    if ($LASTEXITCODE -ne 0) { throw "설정 전송 실패 (scp exit $LASTEXITCODE)" }
    # 🔴 반드시 검사부터. 이 설정이 깨지면 NAS 관리 화면까지 함께 죽는다.
    ssh $nas "nginx -t && systemctl reload nginx"
    if ($LASTEXITCODE -ne 0) { throw "nginx 설정이 올바르지 않습니다 — reload 하지 않았습니다" }
}
else {
    Write-Host "[2/3] NAS 주소 설정은 건드리지 않습니다 (-WithOmv 로 갱신)" -ForegroundColor DarkGray
}

Write-Host "[3/3] 원격 빌드 및 컨테이너 교체" -ForegroundColor Cyan
ssh $nas "chmod +x $remoteDir/deploy.sh && cd $remoteDir && ./deploy.sh"
if ($LASTEXITCODE -ne 0) { throw "원격 배포 실패 (ssh exit $LASTEXITCODE)" }

Write-Host ""
Write-Host "배포 완료 — http://vitron-nas/ERP" -ForegroundColor Green
