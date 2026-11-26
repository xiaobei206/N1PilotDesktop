param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Output
)
$ErrorActionPreference = 'Stop'
$sourceText = Get-Content -LiteralPath $Source -Raw
$outDir = Split-Path -Parent $Output
if (-not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
Add-Type -TypeDefinition $sourceText -OutputAssembly $Output -OutputType WindowsApplication -Language CSharp
if (-not (Test-Path -LiteralPath $Output)) { throw "Native properties launcher was not created: $Output" }
Write-Host "Native properties launcher built: $Output"
