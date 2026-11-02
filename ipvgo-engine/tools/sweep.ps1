# Win-rate benchmark for the exploiter.
#
#   .\sweep.ps1 -Size 5 -Games 40 -Seeds 1,2
#   .\sweep.ps1 -Exe path\to\other\ipvgo_game.exe -Size 5 -Games 40 -Seeds 1,2   # A/B a build
#
# Pool across seeds before believing anything: at 9x9 a 24-game arm has a
# standard error near 10 percentage points, so identical code can swing 25 points
# between seeds. Measured power (see "Known limits" in README.md):
#   5x5, 240 games -> +/- 2.6 pp   (enough to catch a 6 pp change)
#   9x9,  24 games -> +/- 9.7 pp   (confirmatory only, never a screen)
param(
  [string]$Exe = "",
  [int]$Size = 5,
  [int]$Games = 40,
  [string]$Seeds = "1",      # comma-separated; -File cannot bind an array
  [long]$NodeLimit = 4000,   # what the in-game client actually allows
  [string]$Out = ""
)

$ErrorActionPreference = "Stop"
if (-not $Exe) { $Exe = Join-Path $PSScriptRoot "..\..\cmake-build\bin\Release\ipvgo_game.exe" }
$Exe = (Resolve-Path $Exe).Path

$factions = @("Netburners", "Slum Snakes", "The Black Hand", "Tetrads", "Daedalus", "Illuminati")
$seedList = @($Seeds.Split(",") | ForEach-Object { [int]$_.Trim() })

$env:IPVGO_NODE_LIMIT = if ($NodeLimit -gt 0) { "$NodeLimit" } else { $null }

$rows = @()
foreach ($seed in $seedList) {
  $wins = 0; $total = 0; $margin = 0.0; $ms = 0.0
  $per = @()
  foreach ($fac in $factions) {
    $line = (& $Exe exploitplay $fac $Size $Games 2 $seed 2>&1 |
      Select-String "^exploitplay: .*wins=").Line
    if (-not $line) { throw "no result for $fac (seed $seed)" }
    $w = [int]([regex]::Match($line, "wins=(\d+)/").Groups[1].Value)
    $g = [int]([regex]::Match($line, "wins=\d+/(\d+)").Groups[1].Value)
    $m = [double]([regex]::Match($line, "avgMargin=(-?[\d.]+)").Groups[1].Value)
    $t = [double]([regex]::Match($line, "avgBlackThinkMs=([\d.]+)").Groups[1].Value)
    $wins += $w; $total += $g; $margin += $m * $g; $ms += $t * $g
    $per += ("{0}:{1}" -f $fac.Substring(0, [Math]::Min(5, $fac.Length)), $w)
  }
  $p = $wins / [double][math]::Max($total, 1)
  $row = [pscustomobject]@{
    exe       = Split-Path $Exe -Leaf
    size      = $Size
    seed      = $seed
    games     = $total
    wins      = $wins
    winPct    = [math]::Round(100.0 * $p, 1)
    stderrPct = [math]::Round(100.0 * [math]::Sqrt($p * (1 - $p) / [math]::Max($total, 1)), 1)
    avgMargin = [math]::Round($margin / [math]::Max($total, 1), 2)
    msPerMove = [math]::Round($ms / [math]::Max($total, 1), 1)
    perFaction = ($per -join " ")
  }
  $rows += $row
  "{0,-20} {1}x{1} seed={2}  wins={3,3}/{4,-3} ({5,5}% +/-{6})  margin={7,7}  ms/move={8,6}  {9}" -f `
    $row.exe, $Size, $seed, $row.wins, $row.games, $row.winPct, $row.stderrPct, $row.avgMargin, $row.msPerMove, $row.perFaction
}

$tw = ($rows | Measure-Object -Property wins -Sum).Sum
$tg = ($rows | Measure-Object -Property games -Sum).Sum
$p = $tw / [double][math]::Max($tg, 1)
$se = 100.0 * [math]::Sqrt($p * (1 - $p) / [math]::Max($tg, 1))
"POOLED     {0}x{1} seeds={2}  wins={3}/{4} ({5:N1}% +/-{6:N1})" -f $Size, $Size, ($seedList -join ","), $tw, $tg, (100 * $p), $se

if ($Out) { $rows | Export-Csv -NoTypeInformation -Path $Out; "wrote $Out" }
