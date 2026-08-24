# 문서를 사내 공용 폴더에도 함께 놓는다 (정본 → 사본)
#
#   .\sync-docs.ps1
#
# 왜 있는가
# ---------
# 매뉴얼·TC 를 저장소 안에만 두면 "그 파일 어디 있어요" 를 매번 묻게 된다.
# 2026-08-24 사용자 지시로 «문서를 만들면 항상 아래 폴더에도 같이 놓는다».
#   D:\Vitron\DASHBOARD + KPI
# 하지 말라는 말씀이 없으면 문서를 새로 만들 때마다 이 스크립트를 돌린다.
#
# 무엇을 옮기나
# -------------
#   <저장소>\docs\manual\*     매뉴얼 docx·pdf
#   <저장소>\docs\testcase\*   TC 엑셀
#
# ⚠ 날짜가 아니라 SHA256 으로 대조한다. 날짜만 보면 «내용은 같은데 다시 만든» 파일을
#   바뀐 것으로 세고, 반대로 시계가 어긋난 파일은 안 바뀐 것으로 넘긴다.
# ⚠ 이 파일은 UTF-8 BOM 으로 저장해야 한다. BOM 이 없으면 PowerShell 5.1 이
#   ANSI 로 읽어 한글이 깨진다.
param(
    [string]$Dest = 'D:\Vitron\DASHBOARD + KPI'
)

$ErrorActionPreference = 'Stop'

# <저장소>\tools\manual\sync-docs.ps1 → 저장소 뿌리는 두 단계 위
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$sources = @(
    (Join-Path $repo 'docs\manual'),
    (Join-Path $repo 'docs\testcase')
)

if (-not (Test-Path $Dest)) {
    New-Item -ItemType Directory -Path $Dest | Out-Null
    Write-Host "폴더를 만들었습니다: $Dest"
}

$copied = 0
$same = 0
foreach ($dir in $sources) {
    if (-not (Test-Path $dir)) { continue }
    # 완성된 «문서» 만 옮긴다. 같은 폴더에 있는 작업 메모(.md)나 임시 파일까지 옮기면
    # 공용 폴더가 내부 메모로 지저분해진다 (2026-08-24 에 촬영목록.md 가 실려 걸렀다).
    foreach ($f in Get-ChildItem $dir -File | Where-Object { $_.Extension -in '.docx', '.pdf', '.xlsx', '.pptx' }) {
        $target = Join-Path $Dest $f.Name
        $needCopy = $true
        if (Test-Path $target) {
            $a = (Get-FileHash $f.FullName -Algorithm SHA256).Hash
            $b = (Get-FileHash $target -Algorithm SHA256).Hash
            if ($a -eq $b) { $needCopy = $false }
        }
        if ($needCopy) {
            Copy-Item $f.FullName $target -Force
            Write-Host ("  갱신  {0}  ({1:N0} KB)" -f $f.Name, ($f.Length / 1KB))
            $copied++
        }
        else {
            $same++
        }
    }
}

Write-Host ""
Write-Host ("완료 — 갱신 {0}개 · 같아서 넘김 {1}개" -f $copied, $same)
Write-Host "  정본: $repo\docs"
Write-Host "  사본: $Dest"
