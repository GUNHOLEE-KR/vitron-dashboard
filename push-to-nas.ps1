# 사내 NAS 배포 — 압축·전송·원격 빌드까지 한 번에 수행한다.
#
#   .\push-to-nas.ps1          커밋된 내용을 배포
#   .\push-to-nas.ps1 -Force   커밋 안 된 변경이 있어도 확인 없이 진행
#
# 커밋된 내용(git HEAD)만 배포되므로 node_modules 와 .env 는 전송되지 않는다.
# NAS 의 .env 는 그대로 유지된다.
#
# SSH 키가 등록돼 있어 비밀번호는 묻지 않는다. 만약 비밀번호를 묻는다면
# ~/.ssh/id_ed25519 가 사라졌거나 NAS 의 authorized_keys 가 초기화된 경우다.

param([switch]$Force)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$nas       = 'root@vitron-nas'
$remoteDir = '/volume1/docker-build'
$archive   = 'vitron-src.tar.gz'

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
git archive --format=tar.gz -o $archive HEAD

try {
    Write-Host "[2/3] NAS 전송" -ForegroundColor Cyan
    scp ".\$archive" "${nas}:$remoteDir/"
    if ($LASTEXITCODE -ne 0) { throw "전송 실패 (scp exit $LASTEXITCODE)" }

    Write-Host "[3/3] 원격 빌드 및 컨테이너 교체" -ForegroundColor Cyan
    ssh $nas "cd $remoteDir && tar -xzf $archive && ./deploy.sh"
    if ($LASTEXITCODE -ne 0) { throw "원격 배포 실패 (ssh exit $LASTEXITCODE)" }
}
finally {
    if (Test-Path $archive) { Remove-Item $archive }
}

Write-Host ""
Write-Host "배포 완료 (커밋 $commit) — http://vitron-nas:8082" -ForegroundColor Green
