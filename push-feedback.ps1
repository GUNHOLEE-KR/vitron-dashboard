# 의견 접수 서비스 배포 — feedback 폴더만 보내고 그 스택만 갈아 끼운다.
#
#   .\push-feedback.ps1
#
# 🔑 대시보드·KPI·포털과 «별개 스택» 이라 이것을 돌려도 그 셋은 건드리지 않는다.
#
# ⚠ 빌드 단계가 없다(순수 JS + Node). 그래서 git archive 를 쓰지 않고 파일을 그대로
#   보낸다 — 커밋하지 않은 수정도 반영되므로 확인용으로 빠르게 돌리기 좋다.

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# 🔴 PowerShell 5.1 의 함정 — native 명령의 stderr 가 «오류» 로 둔갑한다.
#    ssh·scp 는 진행 상황을, docker 는 「Image ... Building」을 stderr 로 낸다.
#    5.1 은 $ErrorActionPreference='Stop' 일 때 그것을 종료 오류로 감싸 스크립트를
#    멈춘다 — 아래의 $LASTEXITCODE 검사는 실행되지도 못한다.
#    2026-08-29 에 배포가 한복판에서 끊겨 «전송은 됐고 빌드는 안 된» 상태가 남았다.
# 🔑 native 구간만 낮추고 성패는 «종료 코드» 로 판정한다.
function Invoke-Native {
    param([scriptblock]$Command, [string]$What)
    $saved = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $Command } finally { $ErrorActionPreference = $saved }
    if ($LASTEXITCODE -ne 0) { throw "$What 실패 (exit $LASTEXITCODE)" }
}

$nas       = 'root@vitron-nas'
$remoteDir = '/volume1/docker-build-feedback'

Write-Host "[1/3] NAS 폴더 확인" -ForegroundColor Cyan
# .env 가 없으면 메일을 못 보낸다. 빌드 뒤에 알면 시간을 버리므로 먼저 본다.
$envCheck = Invoke-Native {
    ssh $nas "mkdir -p $remoteDir && ([ -f $remoteDir/.env ] && echo OK || echo MISSING)"
} 'NAS 접속'
if ($envCheck -match 'MISSING') {
    Write-Host ""
    Write-Host "오류: NAS 에 .env 가 없습니다." -ForegroundColor Red
    Write-Host "아래 내용으로 $remoteDir/.env 를 먼저 만들어 주세요." -ForegroundColor Yellow
    Write-Host "  MAIL_HOST=smtp.daum.net"
    Write-Host "  MAIL_PORT=465"
    Write-Host "  MAIL_SMTP_USER=<접속 아이디>"
    Write-Host "  MAIL_PASS=<앱 비밀번호>"
    Write-Host "  MAIL_FROM=<보내는 주소>"
    Write-Host "  FEEDBACK_MAIL_TO=gunholee@vi-tron.com"
    exit 1
}

Write-Host "[2/3] feedback 폴더 전송" -ForegroundColor Cyan
Invoke-Native { ssh $nas "rm -rf $remoteDir/public && mkdir -p $remoteDir" } '폴더 비우기'
Invoke-Native { scp .\feedback\Dockerfile .\feedback\deploy.sh .\feedback\docker-compose.yml `
    .\feedback\package.json .\feedback\server.js "${nas}:$remoteDir/" } '전송'
Invoke-Native { scp -r .\feedback\public "${nas}:$remoteDir/" } '위젯 전송'

Write-Host "[3/3] 원격 이미지 교체" -ForegroundColor Cyan
Invoke-Native { ssh $nas "chmod +x $remoteDir/deploy.sh && cd $remoteDir && ./deploy.sh" } '원격 배포'

Write-Host ""
Write-Host "배포 완료 — http://vitron-nas:8086/widget.js" -ForegroundColor Green
Write-Host "붙이는 법: <script src=`"http://vitron-nas:8086/widget.js`" data-product=`"제품명`"></script>" -ForegroundColor DarkGray
