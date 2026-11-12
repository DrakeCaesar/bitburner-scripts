<#
.SYNOPSIS
Builds the engine with profile-guided optimisation, using the search itself as the
training workload.

.DESCRIPTION
Two passes over out/build/x64-Pgo with clang-cl. The first builds an instrumented
ipvgo_game (-fprofile-generate) and plays a spread of board sizes and factions
through it, which writes LLVM .profraw counter files; llvm-profdata merges them into
ipvgo.profdata, and the second pass rebuilds with -fprofile-use, so the compiler
decides branch weights, inlining and code layout from real edge counts instead of
from static guesses.

The training workload is the in-game configuration (a 4 000-node budget per move)
across 5x5, 7x7, 9x9, 13x13 and 19x19, plus the 25-game profileworkload, so the
profit does not come from one board size only.

It is measured neutral on this codebase - see the README - because the hot loops are
branch-light and the optimiser already handles what a profile can tell it. The script
stays so the experiment is repeatable after a structural change.

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
$profDir = Join-Path $buildRoot 'prof'
$profDataPath = Join-Path $buildRoot 'ipvgo.profdata'

function Invoke-Pass {
  param([string]$Mode, [string[]]$Targets = @())
  $args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $buildScript, '-BuildType', $BuildType, '-Pgo', $Mode)
  if ($Targets.Count -gt 0) { $args += @('-Target', ($Targets -join ',')) }
  & powershell @args
  if ($LASTEXITCODE -ne 0) { throw "PGO $Mode build failed" }
}

# llvm-profdata ships beside clang-cl, which the presets take from PATH, so this
# script locates the tool in the same toolset.
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
$llvmProfdata = Join-Path $vsPath 'VC/Tools/Llvm/x64/bin/llvm-profdata.exe'
if (-not (Test-Path $llvmProfdata)) { throw "llvm-profdata.exe not found at $llvmProfdata" }

# Counters from an older binary would be merged into the new one, and -fprofile-use
# will not compile against a missing profile, so both are cleared first.
if (Test-Path $profDir) { Remove-Item -Recurse -Force $profDir }
Remove-Item $profDataPath -ErrorAction SilentlyContinue
Remove-Item $exe -ErrorAction SilentlyContinue

Write-Host 'PGO pass 1/2: instrumented build' -ForegroundColor Cyan
Invoke-Pass -Mode Generate -Targets @('ipvgo_game')
if (-not (Test-Path $exe)) { throw "instrumented engine not found at $exe" }

Write-Host 'PGO training: the search plays the workload it is being optimised for' -ForegroundColor Cyan

$oldProfile = $env:LLVM_PROFILE_FILE
$env:LLVM_PROFILE_FILE = (Join-Path $profDir 'train_%p.profraw')
$env:IPVGO_NODE_LIMIT = '4000'
$env:IPVGO_DETERMINISTIC = '1'  # same training run every time
# The training runs write progress to stderr, which PowerShell turns into a
# terminating NativeCommandError under 'Stop', so the error action is relaxed for
# the duration and the exit codes are checked instead.
$oldErrorAction = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  # One .profraw per process, named by pid. Without %p every run writes the same
  # default file name and each training run overwrites the previous counters.
  & $exe profileworkload (2 * [Math]::Max(1, [int]($Games / 2))) 1 *> $null
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
  $ErrorActionPreference = $oldErrorAction
  if ($null -eq $oldProfile) { Remove-Item Env:LLVM_PROFILE_FILE -ErrorAction SilentlyContinue }
  else { $env:LLVM_PROFILE_FILE = $oldProfile }
  Remove-Item Env:IPVGO_NODE_LIMIT -ErrorAction SilentlyContinue
  Remove-Item Env:IPVGO_DETERMINISTIC -ErrorAction SilentlyContinue
}

# A run that exits without flushing its counters leaves a zero-length .profraw
# behind, and llvm-profdata refuses the whole merge when one is in the list.
$raw = @(Get-ChildItem (Join-Path $profDir '*.profraw') -ErrorAction SilentlyContinue | Where-Object { $_.Length -gt 0 })
if ($raw.Count -eq 0) { throw "training produced no .profraw counters in $profDir" }
Write-Host ("  collected {0} counter file(s), {1:N0} KB" -f $raw.Count, (($raw | Measure-Object Length -Sum).Sum / 1KB))

& $llvmProfdata merge -o $profDataPath @($raw.FullName)
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $profDataPath)) { throw 'llvm-profdata merge failed' }
# An empty profile still links and compiles, so the counts are checked explicitly.
$summary = (& $llvmProfdata show --counts --all-functions $profDataPath 2>&1 | Out-String)
$functions = ([regex]::Match($summary, 'Total functions: (\d+)')).Groups[1].Value
$maxCount = ([regex]::Match($summary, 'Maximum function count: (\d+)')).Groups[1].Value
Write-Host ("  profile: {0} functions, maximum function count {1}" -f $functions, $maxCount)
if (-not $maxCount -or [long]$maxCount -le 0) { throw 'collected profile carries no execution counts' }

Write-Host 'PGO pass 2/2: optimised build from the collected profile' -ForegroundColor Cyan
Invoke-Pass -Mode Optimize -Targets @('ipvgo_game')

Write-Host "PGO engine: $exe" -ForegroundColor Green
