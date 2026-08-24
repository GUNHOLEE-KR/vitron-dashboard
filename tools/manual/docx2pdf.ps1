# docx -> PDF 변환 (Word COM)
#
#   .\docx2pdf.ps1 -In ..\..\docs\manual\KPI_추적_시스템_사용자매뉴얼.docx
#
# Word 가 설치된 PC 에서만 됩니다. 매뉴얼 생성기(build_kpi_manual.py)가 docx 만
# 만들고, PDF 는 이 스크립트로 따로 굽습니다.
#
# ⚠ 이 파일은 UTF-8 BOM 으로 저장해야 합니다. BOM 이 없으면 PowerShell 5.1 이
#   ANSI 로 읽어 한글이 깨지고 파싱 오류가 납니다.
param(
    [Parameter(Mandatory = $true)][string]$In,
    [string]$Out
)

$ErrorActionPreference = 'Stop'
$src = (Resolve-Path $In).Path
if (-not $Out) { $Out = [System.IO.Path]::ChangeExtension($src, '.pdf') }

$word = $null
try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    # 변환 중 대화상자가 뜨면 무인 실행이 멈춘다
    $word.DisplayAlerts = 0
    $doc = $word.Documents.Open($src, $false, $true)   # ReadOnly
    $doc.SaveAs([ref]$Out, [ref]17)                    # 17 = wdFormatPDF
    $doc.Close($false)
    Write-Host "생성: $Out"
}
finally {
    if ($word) {
        $word.Quit()
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
    }
}
