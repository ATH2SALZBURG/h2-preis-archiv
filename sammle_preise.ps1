# Sammelt die Day-Ahead-Preise eines Tages (APG-Transparenzplattform, Market-Coupling-
# Auktionspreis) und speichert sie dauerhaft in preishistorie.json in diesem Repository.
# Laeuft taeglich als GitHub Action, unabhaengig von jedem lokalen Geraet.
# Holt den GESTRIGEN Tag (Wien-Zeit) -- der ist zum Laufzeitpunkt sicher vollstaendig
# veroeffentlicht, auch wenn der Lauf durch GitHub etwas verzoegert startet.
$ErrorActionPreference = 'Stop'

# Auf Linux-Runnern (ubuntu-latest) wird die IANA-Zeitzone "Europe/Vienna" verwendet,
# nicht die Windows-Bezeichnung "W. Europe Standard Time" (die hier nicht existiert).
$wienTz = [System.TimeZoneInfo]::FindSystemTimeZoneById("Europe/Vienna")

function KonvertiereVienna($datumStr, $zeitStr) {
  $lokal = [DateTime]::ParseExact("$datumStr $zeitStr", "dd.MM.yyyy HH:mm", [System.Globalization.CultureInfo]::InvariantCulture)
  $lokal = [DateTime]::SpecifyKind($lokal, [DateTimeKind]::Unspecified)
  $utc = [System.TimeZoneInfo]::ConvertTimeToUtc($lokal, $wienTz)
  return [DateTimeOffset]::new($utc, [TimeSpan]::Zero).ToUnixTimeSeconds()
}

function HoleAPGTag($datumIso) {
  $start = $datumIso + "T000000"
  $ende = ([DateTime]::ParseExact($datumIso, "yyyy-MM-dd", $null)).AddDays(1).ToString("yyyy-MM-dd") + "T000000"
  $uri = "https://transparency.apg.at/api/v1/EXAAD1P/Data/German/PT15M/$start/$ende/EXAA_Full?p_exaaMode=EXAA_Full&resolution=PT15M"
  $resp = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 20
  $daten = $resp.Content | ConvertFrom-Json
  $ergebnis = @()
  foreach ($row in $daten.ResponseData.ValueRows) {
    $preis = $row.V[3].V   # MCPrice_Chart: Market-Coupling-Auktionspreis (bei Full-Decoupling Referenzpreis)
    if ($null -eq $preis) { continue }
    $sek = KonvertiereVienna $row.DF $row.TF
    $ergebnis += [PSCustomObject]@{ unix = $sek; preis = $preis }
  }
  return ,$ergebnis
}

$jetztWien = [System.TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $wienTz)
$zielDatum = $jetztWien.AddDays(-1).ToString("yyyy-MM-dd")

$datei = Join-Path $PSScriptRoot "preishistorie.json"
if (Test-Path $datei) {
  $bestehend = Get-Content $datei -Raw | ConvertFrom-Json
  $tage = @{}
  foreach ($t in $bestehend.tage) { $tage[$t.datum] = $t }
} else {
  $tage = @{}
}

try {
  $werte = HoleAPGTag $zielDatum
  if ($werte.Count -ge 90) {
    $mittel = [Math]::Round((($werte | ForEach-Object { $_.preis } | Measure-Object -Average).Average), 2)
    $tage[$zielDatum] = [PSCustomObject]@{ datum = $zielDatum; n = $werte.Count; mittelEurMwh = $mittel; werte = $werte }
    Write-Output "Gespeichert: $zielDatum ($($werte.Count) Viertelstunden, Mittel $mittel EUR/MWh)"
  } else {
    Write-Output "Zu wenige Werte fuer $zielDatum ($($werte.Count) von erwartet ~96) -- nicht gespeichert, naechster Lauf versucht es erneut."
  }
} catch {
  Write-Output "Fehler beim Abruf fuer $zielDatum`: $($_.Exception.Message)"
  Write-Output "Kein Abbruch -- vorhandene preishistorie.json bleibt unveraendert, naechster Lauf versucht es erneut."
}

$ausgabe = [PSCustomObject]@{
  aktualisiert = (Get-Date).ToUniversalTime().ToString("o")
  quelle       = "APG Transparency (Market Coupling Auktionspreis), https://transparency.apg.at"
  tage         = @($tage.Values | Sort-Object datum)
}
$ausgabe | ConvertTo-Json -Depth 6 | Set-Content $datei -Encoding utf8
Write-Output "preishistorie.json enthaelt jetzt $($tage.Count) Tage."
