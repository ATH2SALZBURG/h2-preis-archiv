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

function MitWiederholung([scriptblock]$aktion, [string]$beschreibung, [int]$versuche = 3, [int]$timeoutSek = 45) {
  $letzterFehler = $null
  for ($versuch = 1; $versuch -le $versuche; $versuch++) {
    try { return & $aktion $timeoutSek }
    catch {
      $letzterFehler = $_
      Write-Output "Versuch $versuch fehlgeschlagen ($beschreibung): $($_.Exception.Message)"
      if ($versuch -lt $versuche) { Start-Sleep -Seconds (8 * $versuch) }
    }
  }
  throw $letzterFehler
}

function HoleAPGTag($datumIso) {
  $start = $datumIso + "T000000"
  $ende = ([DateTime]::ParseExact($datumIso, "yyyy-MM-dd", $null)).AddDays(1).ToString("yyyy-MM-dd") + "T000000"
  $uri = "https://transparency.apg.at/api/v1/EXAAD1P/Data/German/PT15M/$start/$ende/EXAA_Full?p_exaaMode=EXAA_Full&resolution=PT15M"
  # Nur 2 kurze Versuche: GitHub-Runner erreichen die APG manchmal nur langsam/gar nicht;
  # bei Fehlschlag uebernimmt HoleTagMitFallback() sofort Energy-Charts als Ausweichquelle,
  # statt lange auf APG zu warten.
  return MitWiederholung -beschreibung "APG $datumIso" -versuche 2 -timeoutSek 25 -aktion {
    param($timeoutSek)
    $resp = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec $timeoutSek
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

# Ausweichquelle, falls APG nicht rechtzeitig antwortet: Energy-Charts liefert denselben
# Market-Coupling-Auktionspreis. Stichprobenvergleich 09.10.2026 (96 Viertelstunden): APG
# MCPrice_Chart und Energy-Charts sind EXAKT identisch (0 EUR/MWh Abweichung) -- zum
# Vergleich weicht der EXAA-10:15-Auktionspreis (APG V[0]) an demselben Tag um bis zu
# 65 EUR/MWh ab. Das bestaetigt: MCPrice_Chart ist der Market-Coupling/SDAC-Preis, nicht
# der EXAA-Preis, und Energy-Charts ist dafuer eine gueltige Ausweichquelle.
# WICHTIG: Ohne start/end liefert die API nur den heutigen Tag der Gebotszone (laut
# https://api.energy-charts.info/openapi.json), nie die Zukunft -- "morgen" kam dadurch
# nie an. Darum hier immer explizit mit Datum abfragen; der Wien-Datumsfilter bleibt als
# zusaetzliche Absicherung bestehen.
function HoleEnergyChartsTag($datumIso) {
  return MitWiederholung -beschreibung "Energy-Charts $datumIso" -versuche 2 -timeoutSek 30 -aktion {
    param($timeoutSek)
    $uri = "https://api.energy-charts.info/price?bzn=AT&start=$datumIso&end=$datumIso"
    $resp = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec $timeoutSek
    $daten = $resp.Content | ConvertFrom-Json
    $ergebnis = @()
    for ($i = 0; $i -lt $daten.unix_seconds.Count; $i++) {
      if ((WienDatum $daten.unix_seconds[$i]) -ne $datumIso) { continue }  # Sicherheitsnetz
      $ergebnis += [PSCustomObject]@{ unix = $daten.unix_seconds[$i]; preis = $daten.price[$i] }
    }
    return ,$ergebnis
  }
}
function HoleTagMitFallback($datumIso) {
  try { return @{ werte = (HoleAPGTag $datumIso); quelle = "APG" } }
  catch {
    Write-Output "APG endgueltig fehlgeschlagen fuer $datumIso, versuche Energy-Charts als Ausweichquelle..."
    try { return @{ werte = (HoleEnergyChartsTag $datumIso); quelle = "Energy-Charts" } }
    catch { throw }
  }
}

function HoleErzeugung {
  return MitWiederholung -beschreibung "Energy-Charts Erzeugungsmix" -aktion {
    param($timeoutSek)
    $resp = Invoke-WebRequest -Uri 'https://api.energy-charts.info/public_power?country=at' -UseBasicParsing -TimeoutSec $timeoutSek
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

# Ein vollstaendiger APG-Eintrag ist immer vorrangig: Energy-Charts ersetzt ihn nie, aber
# ein Energy-Charts-Eintrag wird beim naechsten Erfolg von APG automatisch nachgezogen.
# "APG" wird als Praefix verglichen (-like "APG*"), weil bereits nachtraeglich eingespielte
# Tage als "APG (nachtraeglich eingespielt)" markiert sind, nicht nur als exaktes "APG".
function IstApgQuelle($quelle) { return $quelle -like "APG*" }
function SollteAktualisieren($bisherigerEintrag, $neueQuelle) {
  if ($null -eq $bisherigerEintrag) { return $true }
  if ((IstApgQuelle $bisherigerEintrag.quelle) -and -not (IstApgQuelle $neueQuelle)) { return $false }
  return $true
}

# ---- Preise: heute und morgen, dazu gestern nur zum Nachziehen auf APG ----
# (gestern ist in jeder Hinsicht laengst veroeffentlicht; wir fragen es nur erneut ab,
# falls der bisherige Eintrag fehlt oder noch von der Ausweichquelle stammt.)
$preisDatei = Join-Path $PSScriptRoot "preishistorie.json"
$preisTage = LiesArchiv $preisDatei
$jetztWien = [System.TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $wienTz)

$zuPruefen = @($jetztWien.ToString("yyyy-MM-dd"), $jetztWien.AddDays(1).ToString("yyyy-MM-dd"))
$gesternIso = $jetztWien.AddDays(-1).ToString("yyyy-MM-dd")
$gesternEintrag = $preisTage[$gesternIso]
if ($null -eq $gesternEintrag -or -not (IstApgQuelle $gesternEintrag.quelle)) { $zuPruefen += $gesternIso }

foreach ($datumIso in $zuPruefen) {
  try {
    $ergebnis = HoleTagMitFallback $datumIso
    $werte = $ergebnis.werte
    if ($werte.Count -ge 90) {
      $bisher = $preisTage[$datumIso]
      if (SollteAktualisieren $bisher $ergebnis.quelle) {
        $mittel = [Math]::Round((($werte | ForEach-Object { $_.preis } | Measure-Object -Average).Average), 2)
        $preisTage[$datumIso] = [PSCustomObject]@{ datum = $datumIso; n = $werte.Count; mittelEurMwh = $mittel; quelle = $ergebnis.quelle; werte = $werte }
        Write-Output "Preise gespeichert: $datumIso ($($werte.Count) Viertelstunden, Mittel $mittel EUR/MWh, Quelle $($ergebnis.quelle))"
      } else {
        Write-Output "Preise fuer $datumIso`: Ergebnis von Energy-Charts verworfen, bestehender APG-Eintrag ist vorrangig und bleibt unveraendert."
      }
    } else {
      Write-Output "Preise fuer $datumIso noch nicht (vollstaendig) verfuegbar ($($werte.Count) Werte von $($ergebnis.quelle)) -- kein Fehler, naechster Lauf versucht es erneut."
    }
  } catch {
    Write-Output "Fehler beim Preisabruf fuer $datumIso (APG und Energy-Charts)`: $($_.Exception.Message) -- bestehender Eintrag bleibt unveraendert."
  }
}
SchreibeArchiv $preisDatei $preisTage "APG Transparency (Market-Coupling-Auktionspreis), primaer https://transparency.apg.at; Ausweichquelle Energy-Charts (Fraunhofer ISE) bei APG-Ausfall, Quelle je Tag im Feld 'quelle'"
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
