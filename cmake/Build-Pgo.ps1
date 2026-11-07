<#
.SYNOPSIS
Builds the engine with profile-guided optimisation, using the search itself as the
training workload.

.DESCRIPTION
Two passes over out/build/x64-Pgo. The first builds an instrumented ipvgo_game and
plays a spread of board sizes and factions through it, which writes the branch and
value profiles; the second rebuilds with /USEPROFILE, so the compiler lays out the
hot paths, splits the cold ones and decides inlining from real edge counts instead
of from static guesses.

The training workload is the in-game configuration (a 4 000-node budget per move)
across 5x5, 7x7, 9x9 and 13x13, plus the 25-game profileworkload, so the profit
does not come from one board size only.

.PARAMETER BuildType
Release (default) or RelWithDebInfo.

.PARAMETER Games
Scale factor for the training workload: each size plays this many games (the
default is 6, about two minutes in the instrumented build).

.EXAMPLE
./cmake/Build-Pgo.ps1
Produces out/build/x64-Pgo/bin/ipvgo_game.exe built from a collected profile.
#>
param(
  [ValidateSet('Release', 'RelWithDebInfo')]
  [string]$BuildType = 'Release',

  [int]$Games = 6
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$buildRoot = Join-Path $repoRoot 'out/build/x64-Pgo'
$exe = Join-Path $buildRoot 'bin/ipvgo_game.exe'
$buildScript = Join-Path $PSScriptRoot 'Build-Native.ps1'

function Invoke-Pass {
  param([string]$Mode, [string[]]$Targets = @())
  $args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $buildScript, '-BuildType', $BuildType, '-Pgo', $Mode)
  if ($Targets.Count -gt 0) { $args += @('-Target', ($Targets -join ',')) }
  & powershell @args
  if ($LASTEXITCODE -ne 0) { throw "PGO $Mode build failed" }
}

$binDir = Split-Path -Parent $exe
$pgd = Join-Path $buildRoot 'ipvgo.pgd'

# The instrumented binary needs the PGO runtime (pgort140.dll), which ships in the
# toolset's bin directory and not with the redistributable. Off PATH, every training
# run dies with 0xC0000135 (STATUS_DLL_NOT_FOUND) before writing a single counter,
# and the optimising pass then merges an empty profile without complaining.
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
$toolBin = Get-ChildItem (Join-Path $vsPath 'VC/Tools/MSVC') -Directory |
  Sort-Object Name -Descending |
  ForEach-Object { Join-Path $_.FullName 'bin/Hostx64/x64' } |
  Where-Object { Test-Path (Join-Path $_ 'pgort140.dll') } |
  Select-Object -First 1
if (-not $toolBin) { throw 'pgort140.dll not found; cannot run the instrumented build.' }
$pgomgr = Join-Path $toolBin 'pgomgr.exe'

# Start from a clean profile: stale counters from an older binary would be merged
# into the new one. Deleting the exe also forces the instrumented relink that writes
# the fresh .pgd skeleton.
Get-ChildItem (Join-Path $binDir '*.pgc') -ErrorAction SilentlyContinue | Remove-Item -Force
Remove-Item $pgd -ErrorAction SilentlyContinue
Remove-Item $exe -ErrorAction SilentlyContinue

Write-Host 'PGO pass 1/2: instrumented build' -ForegroundColor Cyan
Invoke-Pass -Mode Generate -Targets @('ipvgo_game')

if (-not (Test-Path $exe)) { throw "instrumented engine not found at $exe" }
if (-not (Test-Path $pgd)) { throw "instrumented link did not produce $pgd" }

Write-Host 'PGO training: the search plays the workload it is being optimised for' -ForegroundColor Cyan

$oldPath = $env:PATH
$env:PATH = "$toolBin;$env:PATH"
$env:IPVGO_NODE_LIMIT = '4000'
$env:IPVGO_DETERMINISTIC = '1'  # same training run every time
try {
  # Mixed sizes so the shared code paths (chain pass, eye analysis, patterns) are
  # trained on the shapes the game actually uses. The instrumented run writes
  # ipvgo!N.pgc beside the executable, one file per process.
  foreach ($spec in @(
      @('Illuminati', 9, 2),
      @('Slum Snakes', 7, 2),
      @('Netburners', 5, 3),
      @('Illuminati', 13, 1),
      @('Illuminati', 19, 1),
      @('The Black Hand', 9, 2),
      @('Tetrads', 7, 2)
    )) {
    $faction, $size, $count = $spec
    $games = $count * [Math]::Max(1, [int]($Games / 2))
    Write-Host ("  {0} {1}x{1}, {2} games" -f $faction, $size, $games)
    # Exit 1 is the normal "not every game won" result; only 2+ means the run broke.
    & $exe exploitplay $faction $size $games 2 1 *> $null
    if ($LASTEXITCODE -gt 1) { throw ("training run failed (exit 0x{0:X})" -f $LASTEXITCODE) }
  }
} finally {
  $env:PATH = $oldPath
  Remove-Item Env:IPVGO_NODE_LIMIT -ErrorAction SilentlyContinue
  Remove-Item Env:IPVGO_DETERMINISTIC -ErrorAction SilentlyContinue
}

$pgc = @(Get-ChildItem (Join-Path $binDir '*.pgc') -ErrorAction SilentlyContinue)
if ($pgc.Count -eq 0) { throw "training produced no .pgc counters in $binDir" }
Write-Host ("  collected {0} counter file(s), {1:N0} KB" -f $pgc.Count, (($pgc | Measure-Object Length -Sum).Sum / 1KB))

# Merge explicitly rather than relying on the optimising link to find the counters:
# it is the step that silently produces an empty profile when it does not.
& $pgomgr /merge $pgd @($pgc.FullName) | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'pgomgr /merge failed' }
$summary = (& $pgomgr /summary $pgd) -join "`n"
if ($LASTEXITCODE -ne 0) { throw 'pgomgr /summary failed' }
$dynamicLine = ($summary -split "`n" | Where-Object { $_ -match 'Dynamic instructions' } | Select-Object -First 1)
Write-Host ("  profile: {0}" -f ($dynamicLine -replace '^\s+', ''))
if ($summary -notmatch 'Dynamic instructions:\s*[1-9]') { throw 'collected profile carries no execution counts' }
foreach ($file in $pgc) { Remove-Item $file.FullName -Force }

Write-Host 'PGO pass 2/2: optimised build from the collected profile' -ForegroundColor Cyan
Invoke-Pass -Mode Optimize -Targets @('ipvgo_game')

Write-Host "PGO engine: $exe" -ForegroundColor Green
