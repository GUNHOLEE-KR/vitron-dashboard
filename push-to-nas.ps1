# 사내 NAS 배포 — 압축·전송·원격 빌드까지 한 번에 수행한다.
#
#   .\push-to-nas.ps1          «운영» 에 배포 (http://vitron-nas:8082)
#   .\push-to-nas.ps1 -Test    «테스트» 에 배포 (http://vitron-nas:8092)
#   .\push-to-nas.ps1 -Force   커밋 안 된 변경이 있어도 확인 없이 진행
#
# 🔑 테스트는 DB 도 다르다(vitron_dashboard_test). 거기서 넣고 지운 것은
#    운영에 반영되지 않는다. 화면 맨 위에 빨간 띠가 뜬다.
#
# 커밋된 내용(git HEAD)만 배포되므로 node_modules 와 .env 는 전송되지 않는다.
# NAS 의 .env 는 그대로 유지된다.
#
# SSH 키가 등록돼 있어 비밀번호는 묻지 않는다. 만약 비밀번호를 묻는다면
# ~/.ssh/id_ed25519 가 사라졌거나 NAS 의 authorized_keys 가 초기화된 경우다.

param([switch]$Force, [switch]$Test)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# 🔴 PowerShell 5.1 의 함정 — native 명령의 stderr 가 «오류» 로 둔갑한다 (2026-08-29 겪음).
#    ssh·scp·git 은 진행 상황을 stderr 로 낸다. docker 의 "Image ... Building" 도 그렇다.
#    그런데 5.1 은 $ErrorActionPreference='Stop' 일 때 그 줄들을 NativeCommandError 로
#    감싸 «종료 오류» 로 만든다. 실제로 배포가 [3/3] 한복판에서 끊겨,
#    «전송은 됐는데 빌드는 안 된» 상태로 남았다. 화면에는 오류가 떴지만 컨테이너는
#    옛것 그대로였다 — 「실패했다」와 「반쯤 됐다」를 구분할 수 없는 것이 가장 나쁘다.
#
# 🔑 그래서 native 를 부르는 «그 구간만» Continue 로 낮추고, 성패는 stderr 가 아니라
#    «종료 코드» 로 판정한다. 그것이 원래 옳은 판정 기준이다.
#    ⚠ cmdlet 에 대한 Stop 은 그대로 살려 둔다 — 그쪽은 stderr 문제가 없다.
function Invoke-Native {
    param([scriptblock]$Command, [string]$What)
    $saved = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $Command } finally { $ErrorActionPreference = $saved }
    if ($LASTEXITCODE -ne 0) { throw "$What 실패 (exit $LASTEXITCODE)" }
}

$nas     = 'root@vitron-nas'
$archive = 'vitron-src.tar.gz'

# 🔑 테스트와 운영은 «같은 소스» 를 쓰고 폴더·프로젝트 이름만 다르다.
#    그 폴더의 .env 가 포트·이미지 태그·DB 이름을 정한다.
if ($Test) {
    $remoteDir = '/volume1/docker-build-dashboard-test'
    $project   = 'vitron-dashboard-test'
    $url       = 'http://vitron-nas:8092'
    Write-Host "대상: 테스트 서버 ($url)" -ForegroundColor Yellow
}
else {
    $remoteDir = '/volume1/docker-build'
    $project   = 'vitron-dashboard'
    $url       = 'http://vitron-nas:8082'
    Write-Host "대상: 운영 서버 ($url)" -ForegroundColor Red
}

# 커밋하지 않은 변경은 배포에 포함되지 않으므로 미리 알린다
$dirty = git status --porcelain
if ($dirty -and -not $Force) {
    Write-Host ""
    Write-Host "경고: 커밋되지 않은 변경이 있습니다. 아래 내용은 배포되지 않습니다." -ForegroundColor Yellow
    Write-Host $dirty
    Write-Host ""
    $answer = Read-Host "커밋된 내용만으로 계속할까요? (y/N)"
    if ($answer -ne 'y') {
        Write-Host "취소했습니다. 먼저 커밋해 주세요." -ForegroundColor Yellow
        exit 1
    }
}

$commit = (git rev-parse --short HEAD).Trim()
Write-Host "[1/3] 압축 (커밋 $commit)" -ForegroundColor Cyan
Invoke-Native { git archive --format=tar.gz -o $archive HEAD } '압축'

try {
    Write-Host "[2/3] NAS 전송" -ForegroundColor Cyan
    Invoke-Native { scp ".\$archive" "${nas}:$remoteDir/" } '전송'

    Write-Host "[3/3] 원격 빌드 및 컨테이너 교체" -ForegroundColor Cyan
    Invoke-Native { ssh $nas "cd $remoteDir && tar -xzf $archive && ./deploy.sh $project" } '원격 배포'
}
finally {
    if (Test-Path $archive) { Remove-Item $archive }
}

Write-Host ""
Write-Host "배포 완료 (커밋 $commit) — $url" -ForegroundColor Green
