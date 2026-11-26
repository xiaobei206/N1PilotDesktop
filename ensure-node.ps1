$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Windows PowerShell 5.1 may otherwise negotiate an old TLS version.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$projectRoot = $PSScriptRoot
$nodeHome = Join-Path $projectRoot '.tools\node'
$tempZip = $null
$tempExtract = $null

try {
    Write-Host '[Node.js] Checking the official Node.js distribution index...'
    $releases = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -TimeoutSec 45
    $release = $releases |
        Where-Object { $_.lts -and ($_.files -contains 'win-x64-zip') } |
        Select-Object -First 1

    if (-not $release) {
        throw 'No Windows x64 ZIP package was found in the official Node.js LTS index.'
    }

    $version = [string]$release.version
    $archiveName = "node-$version-win-x64.zip"
    $downloadUrl = "https://nodejs.org/dist/$version/$archiveName"
    $tempZip = Join-Path $env:TEMP $archiveName
    $tempExtract = Join-Path $env:TEMP ( 'n1pilot-node-' + [guid]::NewGuid().ToString('N') )

    Write-Host "[Node.js] Downloading $downloadUrl"
    Invoke-WebRequest -Uri $downloadUrl -OutFile $tempZip -UseBasicParsing -TimeoutSec 300

    Write-Host '[Node.js] Extracting portable runtime...'
    Expand-Archive -LiteralPath $tempZip -DestinationPath $tempExtract -Force
    $sourceDir = Join-Path $tempExtract "node-$version-win-x64"

    if (-not (Test-Path (Join-Path $sourceDir 'node.exe'))) {
        throw "node.exe was not found in the downloaded archive: $sourceDir"
    }
    if (-not (Test-Path (Join-Path $sourceDir 'npm.cmd'))) {
        throw "npm.cmd was not found in the downloaded archive: $sourceDir"
    }

    New-Item -ItemType Directory -Path $nodeHome -Force | Out-Null
    Copy-Item -Path (Join-Path $sourceDir '*') -Destination $nodeHome -Recurse -Force

    if (-not (Test-Path (Join-Path $nodeHome 'node.exe'))) {
        throw 'Copying the portable Node.js runtime failed.'
    }

    Write-Host "[Node.js] Portable runtime ready at: $nodeHome"
}
catch {
    Write-Host ''
    Write-Host '[Node.js] Automatic download failed.' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host 'Check access to https://nodejs.org/ . Alternatively, install the official Node.js LTS Windows x64 package, reopen the terminal, and run build.bat again.'
    exit 1
}
finally {
    if ($tempExtract -and (Test-Path $tempExtract)) {
        Remove-Item -LiteralPath $tempExtract -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($tempZip -and (Test-Path $tempZip)) {
        Remove-Item -LiteralPath $tempZip -Force -ErrorAction SilentlyContinue
    }
}
