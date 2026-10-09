# Sammelt Day-Ahead-Preise (APG) und Erzeugungsmix (Energy-Charts) und speichert sie
# dauerhaft in preishistorie.json und erzeugung.json in diesem Repository.
# Laeuft mehrmals taeglich als GitHub Action, unabhaengig von jedem lokalen Geraet.
# Holt HEUTE und MORGEN (nicht nur den Vortag): Day-Ahead-Preise fuer "heute" stehen
# schon den ganzen Vortag fest, daher ist "heute" schon zu Tagesbeginn vollstaendig.
# Mehrfache Laeufe pro Tag sind unschaedlich (Zusammenfuehrung je Kalendertag, keine
# Duplikate) und sorgen dafuer, dass "morgen" bald nach Veroeffentlichung (meist
# nachmittags) in der Datei auftaucht, ohne auf den naechsten Tag warten zu muessen.
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
function WienDatum($unixSekunden) {
  $utc = [DateTimeOffset]::FromUnixTimeSeconds($unixSekunden).UtcDateTime
  $lokal = [System.TimeZoneInfo]::ConvertTimeFromUtc($utc, $wienTz)
  return $lokal.ToString("yyyy-MM-dd")
}

function MitWiederholung([scriptblock]$aktion, [string]$beschreibung) {
  $letzterFehler = $null
  for ($versuch = 1; $versuch -le 3; $versuch++) {
    try { return & $aktion }
    catch {
      $letzterFehler = $_
      Write-Output "Versuch $versuch fehlgeschlagen ($beschreibung): $($_.Exception.Message)"
      if ($versuch -lt 3) { Start-Sleep -Seconds (10 * $versuch) }
    }
  }
  throw $letzterFehler
}

function HoleAPGTag($datumIso) {
  $start = $datumIso + "T000000"
  $ende = ([DateTime]::ParseExact($datumIso, "yyyy-MM-dd", $null)).AddDays(1).ToString("yyyy-MM-dd") + "T000000"
  $uri = "https://transparency.apg.at/api/v1/EXAAD1P/Data/German/PT15M/$start/$ende/EXAA_Full?p_exaaMode=EXAA_Full&resolution=PT15M"
  return MitWiederholung -beschreibung "APG $datumIso" -aktion {
    $resp = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 45
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
}

function HoleErzeugung {
  return MitWiederholung -beschreibung "Energy-Charts Erzeugungsmix" -aktion {
    $resp = Invoke-WebRequest -Uri 'https://api.energy-charts.info/public_power?country=at' -UseBasicParsing -TimeoutSec 45
    $daten = $resp.Content | ConvertFrom-Json
    $n = $daten.unix_seconds.Count
    $ergebnis = @()
    for ($i = 0; $i -lt $n; $i++) {
      $gesamt = 0.0; $erneuerbar = 0.0; $lastWert = $null; $windWert = 0.0; $solarWert = 0.0; $residualDirekt = $null
      foreach ($typ in $daten.production_types) {
        $v = $typ.data[$i]
        if ($null -eq $v) { continue }
        if ($v -ge 0) {
          $gesamt += $v
          if ($typ.name -imatch 'wind|solar|photovoltaic|hydro|wasser|biomass|geothermal' -and $typ.name -notmatch 'storage') { $erneuerbar += $v }
        }
        if ($typ.name -imatch '^load$|load \(|gesamtlast|total.*load') { $lastWert = $v }
        if ($typ.name -imatch 'wind') { $windWert += $v }
        if ($typ.name -imatch 'solar|photovoltaic') { $solarWert += $v }
        if ($typ.name -imatch 'residual') { $residualDirekt = $v }
      }
      $oeko = if ($gesamt -gt 0) { [Math]::Round($erneuerbar / $gesamt, 4) } else { $null }
      $residual = if ($null -ne $residualDirekt) { $residualDirekt } elseif ($null -ne $lastWert) { $lastWert - $windWert - $solarWert } else { $null }
      $ergebnis += [PSCustomObject]@{ unix = $daten.unix_seconds[$i]; oeko = $oeko; residual = $residual }
    }
    return ,$ergebnis
  }
}

function LiesArchiv($pfad) {
  if (Test-Path $pfad) {
    $bestehend = Get-Content $pfad -Raw | ConvertFrom-Json
    $tage = @{}
    foreach ($t in $bestehend.tage) { $tage[$t.datum] = $t }
    return $tage
  }
  return @{}
}
function SchreibeArchiv($pfad, $tage, $quelle) {
  $ausgabe = [PSCustomObject]@{
    aktualisiert = (Get-Date).ToUniversalTime().ToString("o")
    quelle       = $quelle
    tage         = @($tage.Values | Sort-Object datum)
  }
  $ausgabe | ConvertTo-Json -Depth 8 | Set-Content $pfad -Encoding utf8
}

# ---- Preise: heute und morgen (morgen evtl. noch nicht veroeffentlicht) ----
$preisDatei = Join-Path $PSScriptRoot "preishistorie.json"
$preisTage = LiesArchiv $preisDatei
$jetztWien = [System.TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $wienTz)
foreach ($offset in 0, 1) {
  $datumIso = $jetztWien.AddDays($offset).ToString("yyyy-MM-dd")
  try {
    $werte = HoleAPGTag $datumIso
    if ($werte.Count -ge 90) {
      $mittel = [Math]::Round((($werte | ForEach-Object { $_.preis } | Measure-Object -Average).Average), 2)
      $preisTage[$datumIso] = [PSCustomObject]@{ datum = $datumIso; n = $werte.Count; mittelEurMwh = $mittel; werte = $werte }
      Write-Output "Preise gespeichert: $datumIso ($($werte.Count) Viertelstunden, Mittel $mittel EUR/MWh)"
    } else {
      Write-Output "Preise fuer $datumIso noch nicht (vollstaendig) verfuegbar ($($werte.Count) Werte) -- kein Fehler, naechster Lauf versucht es erneut."
    }
  } catch {
    Write-Output "Fehler beim Preisabruf fuer $datumIso`: $($_.Exception.Message) -- bestehender Eintrag bleibt unveraendert."
  }
}
SchreibeArchiv $preisDatei $preisTage "APG Transparency (Market Coupling Auktionspreis), https://transparency.apg.at"
Write-Output "preishistorie.json enthaelt jetzt $($preisTage.Count) Tage."

# ---- Erzeugungsmix (Oekostrom-Anteil, Residuallast) ----
$erzDatei = Join-Path $PSScriptRoot "erzeugung.json"
$erzTage = LiesArchiv $erzDatei
try {
  $punkte = HoleErzeugung
  $gruppen = $punkte | Group-Object { WienDatum $_.unix }
  foreach ($g in $gruppen) {
    if ($g.Group.Count -lt 4) { continue }
    $erzTage[$g.Name] = [PSCustomObject]@{ datum = $g.Name; n = $g.Group.Count; werte = @($g.Group) }
  }
  Write-Output "Erzeugungsmix gespeichert fuer: $($gruppen.Name -join ', ')"
} catch {
  Write-Output "Fehler beim Erzeugungsabruf: $($_.Exception.Message) -- bestehende erzeugung.json bleibt unveraendert."
}
SchreibeArchiv $erzDatei $erzTage "Energy-Charts (Fraunhofer ISE) public_power, Gebotszone AT"
Write-Output "erzeugung.json enthaelt jetzt $($erzTage.Count) Tage."
