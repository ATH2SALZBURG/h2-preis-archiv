/* =====================================================================
   Berechnungsmodell 5-MW-Elektrolyseur Salzburg (Masterarbeit J. Grasl)
   ---------------------------------------------------------------------
   Viertelstundenmodell fuer die Kalenderjahre 2022 bis 2025.
   Laeuft unveraendert im Browser (Parameter-Rechner.html) und mit
   Node.js (berechnung.js). Alle Rechenschritte sind hier dokumentiert;
   die Gleichungen entsprechen Kapitel 4 der Arbeit.

   Einheiten: Leistung MW, Energie MWh, Wasserstoff kg, Kosten EUR.
   Ein Zeitschritt = 0,25 h (Viertelstunde).
   ===================================================================== */

var MODELL_VERSION = '3.1 (19.10.2026, wie 3.0; Bereitschaftsverbrauch 2 % der Nennleistung im Stillstand im Basisfall)';

/* ---------------------------------------------------------------------
   1. Standardparameter (Basisfall). Jeder Wert mit Herkunft.
   --------------------------------------------------------------------- */
var STANDARD = {
  // --- Anlage und Nachfrage ---
  P_nenn: 4.568,          // MW elektrische Anschlussleistung: 2 x Enapter AEM Nexus 2500 zu je 2 266 kW inkl. Nebenanlagen + je ca. 18 kW Trockner fuer 99,999 % (Datenblatt rev08)
  ziel_kg_tag: 1000,      // kg H2 je Tag (AFIR-Mindestkapazitaet, Art 6 VO (EU) 2023/1804)
  sec_nenn: 51.674,       // kWh/kg bei Nennlast, Systemebene: (2 266 + 18) kW / 44,2 kg/h je Modul; Datenblatt 51,3 kWh/kg bei 99,5 % zzgl. Trockner fuer Tankstellenqualitaet
  teillast: false,        // Basisfall: konstanter spezifischer Energiebedarf; true = Sensitivitaet mit Teillastvorteil
  // Sensitivitaet Teillastvorteil: relativer spezifischer Energiebedarf ueber relativer Last (linear interpoliert).
  // Groessenordnung nach Kopp et al. (2017): Wirkungsgrad 64 % bei Nennleistung (4 MW), 59 % bei Spitzenleistung (6 MW)
  // -> Verhaeltnis 59/64 = 0,922, uebertragen auf 2/3 bzw. 100 % der Leistung (Naeherung, eigene Annahme).
  teillast_kurve: [[0.0, 0.921875], [0.6667, 0.921875], [1.0, 1.0]],
  min_last: 0.05,         // Mindestlast Anteil der Anlagenleistung: ein Modul bei 10 % (Dauerbetrieb nach Datenblatt; 3,5 % nur bis 24 h) = rund 5 % der Anlagenleistung; ESMAP 2026: 5 %
  bereitschaft: 0.02,     // Bereitschaftsleistung im warmen Stillstand (heisser Standby), Anteil der Nennleistung: 2 % wie Eisele et al. (2026, Tab. S. 7); Janke et al. (2020, Tab. 2): 41 kW bei 1 074 kW = rund 4 %

  // --- Investition und Finanzierung ---
  capex: 2500,            // EUR/kW Gesamtprojekt 5 MW (Kap. 2.4.2: Bandbreite 2.000–3.000)
  opex_fix: 0.03,         // Anteil der Investition pro Jahr (IEA 2025)
  zins: 0.07,             // realer Kalkulationszinssatz (Kap. 2.4.1)
  nutzungsdauer: 25,      // Jahre (Orsolits et al. 2026)
  stack_kosten: 420,      // EUR/kW Stacktausch AEM: PEM-Stackkosten 2024 563 EUR/kW (Bolard et al. 2026) x (1 - 0,259) nach Kim et al. 2024 (eigene Abschaetzung)
  stack_lebensdauer: 20000, // h AEM: obere Grenze 10 000-20 000 h (ESMAP 2026, Tab. ES.1; Bolard et al. 2026); Herstellerangabe > 35 000 h als Sensitivitaet
  stack_basis: 'betriebsstunden', // 'betriebsstunden' (Literaturangabe) oder 'volllaststunden'
  stack_restwert: true,   // Restwert des zuletzt eingesetzten Stacks am Ende der Nutzungsdauer abziehen
  wasser: 0.09,           // EUR/kg H2 (Povacz & Bhandari 2023)

  // --- Netzentgelte, Abgaben (Netzebene 4, Netzbereich Salzburg, Kap. 2.4.3) ---
  netzebene: 'NE4',       // 'NE4', 'NE5' oder 'ElWG' (Freistellung nach § 127 Abs 3 ElWG)
  leistungspreis: 45.60,  // EUR/kW und Jahr, auf Mittel der monatlichen Viertelstundenhoechstwerte (§ 52 Abs 1 ElWOG 2010)
  arbeitspreis: 9.9,      // EUR/MWh (0,99 ct/kWh)
  netzverlust: 1.59,      // EUR/MWh (0,159 ct/kWh)
  foerderbeitrag: 0.0732, // Anteil auf Netznutzungs- und Netzverlustentgelt
  foerderpauschale: 60524.03, // EUR je Zaehlpunkt und Jahr (NE4)
  elektrizitaetsabgabe: 15.0, // EUR/MWh (1,5 ct/kWh ab 2027, § 4 Abs 2 EAbgG)

  // --- Verdichtung und Pufferspeicher ---
  druck_ein: 30, druck_aus: 200, // bar (Austrittsdruck Elektrolyseur bis 31 barg laut Datenblatt; 30 bar als vorsichtiger Wert)
  verdichter_energie: 1.3,   // kWh je kg gespeicherten Wasserstoffs (30 -> 200 bar, eigene Umrechnung nach Ortiz Cebolla et al. 2022)
  verdichter_capex: 11750,   // EUR je kg/h Verdichterleistung (33 kg/h fuer 515.000 USD (2013), Parks et al. 2014; 1,3281 USD/EUR)
  verdichter_om: 0.04,       // Anteil der Investition pro Jahr (Parks et al. 2014)
  speicher_capex: 1370,      // EUR je kg Speicherkapazitaet (Mitte 930–2.200 USD/kg, Ortiz Cebolla et al. 2022, 1,1422 USD/EUR)
  speicher_om: 0.02,         // Anteil der Investition pro Jahr (Moran et al. 2024)
  speicher_reserve: 0.15,    // nicht entnehmbarer Restinhalt: Entleerung bis 30 bar bei 200 bar Speicherdruck (30/200, ideales Gas, eigene Berechnung)

  // --- Fahrweisen ---
  ruhe_stunden: [2, 3],      // gleichmaessiger Betrieb: taegliches Ruhefenster abwechselnd 2 und 3 h (Stundengrenze Art 4 Abs 1)
  ruhe_versatz: 7,           // Verschiebung des Ruhefensters je Tag in Stunden (rotiert ueber alle Tagesstunden)
  ruhe_fest: false,          // zweite Referenz: Ruhefenster an festen Uhrzeiten (ruhe_fest_stunden) statt rotierend
  ruhe_fest_stunden: { 2: [19, 20], 3: [18, 19, 20] }, // Uhrzeitstunden mit den im Mittel 2022-2025 hoechsten Day-Ahead-Preisen (eigene Auswertung, berechnung.js)
  tp_fenster: 1,             // Tagesplanung (Nr. 3): Bilanzierungsfenster 1 Tag (Planung mit den am Vortag bekannten Day-Ahead-Preisen), volle Leistung
  ee_anteil: 0.90065,        // EE-Anteil 2024 fuer die Stundengrenze (Eurostat, 90,065 %)

  // --- Regime II ---
  eua: {2022: 80.32, 2023: 83.66, 2024: 65.00, 2025: 73.86}, // EUR/t, Jahresmittel (DEHSt)
  niedrigpreis_basis: 'viertelstunde', // 'viertelstunde' oder 'stundenmittel' (nur ab 1.10.2025 relevant)
  aufpreis: 0.0,             // EUR/MWh Gruenstromaufpreis auf das gesamte Vertragsvolumen
  ppa_profil: 'windpv',      // 'windpv' (Regime II), 'laufwasser' (Nr. 7) oder 'misch25'/'misch50'/'misch75' (Nr. 8, Anteil Laufwasser)
  // --- Auslegung Regime II (Nr. 5, Version 3.0): Vertragsgroesse und Speicher werden mit der Regel Nr. 6 ausgelegt ---
  ausl_faktoren: [1.5, 2.0, 3.0], // Vertragsvolumen als Vielfaches des Jahresstrombedarfs bei Nennlast (eigene Festlegung)
  ausl_misch: [0.25, 0.5, 0.75], // Nr. 8: Anteil Laufwasser an der Vertragsmenge
  ausl_aufpreise: [0, 10, 25]  // EUR/MWh Gruenstromaufpreis (Kap. 4)
};

/* ---------------------------------------------------------------------
   2. Hilfsfunktionen
   --------------------------------------------------------------------- */
function kopiere(o) { return JSON.parse(JSON.stringify(o)); }
function mitParametern(basis, aend) { var p = kopiere(basis); for (var k in aend) p[k] = aend[k]; return p; }

// Kapitalwiedergewinnungsfaktor (Gl. 2.2)
function annuitaet(i, n) { return i === 0 ? 1 / n : i * Math.pow(1 + i, n) / (Math.pow(1 + i, n) - 1); }

// relativer spezifischer Energiebedarf bei relativer Last l (0..1)
function secRel(l, p) {
  if (!p.teillast) return 1.0;
  var k = p.teillast_kurve;
  if (l <= k[0][0]) return k[0][1];
  for (var j = 1; j < k.length; j++) {
    if (l <= k[j][0]) { var a = k[j - 1], b = k[j]; return a[1] + (b[1] - a[1]) * (l - a[0]) / (b[0] - a[0]); }
  }
  return k[k.length - 1][1];
}
// Wasserstoff in kg aus Leistung P (MW) ueber eine Viertelstunde
function wasserstoff(P, p) { if (P <= 0) return 0; return P * 0.25 * 1000 / (p.sec_nenn * secRel(P / p.P_nenn, p)); }
// Leistung P (MW), die in einer Viertelstunde m kg erzeugt (Bisektion, P <= Pmax)
function leistungFuer(m, Pmax, p) {
  if (m <= 0) return 0;
  var lo = 0, hi = Pmax;
  if (wasserstoff(hi, p) < m) return -1;
  for (var it = 0; it < 50; it++) { var mid = (lo + hi) / 2; if (wasserstoff(mid, p) < m) lo = mid; else hi = mid; }
  return hi;
}
// variable Entgelte und Abgaben je MWh sowie leistungs- und zaehlpunktbezogene Anteile
function entgelte(p) {
  var ap = p.arbeitspreis, nv = p.netzverlust, lp = p.leistungspreis, pausch = p.foerderpauschale, fb = p.foerderbeitrag;
  if (p.netzebene === 'NE5') { ap = 16.8; nv = 1.98; lp = 64.20; pausch = 8992.14; }      // Kap. 2.4.3 (Netzebene 5)
  if (p.netzebene === 'ElWG') { ap = 0; nv = 0; lp = 0; fb = 0; }                         // Freistellung § 127 Abs 3 ElWG
  return { fvar: (ap + nv) * (1 + fb) + p.elektrizitaetsabgabe, lp: lp * (1 + fb), pauschale: pausch };
}

/* ---------------------------------------------------------------------
   3. Jahresdaten vorbereiten
   --------------------------------------------------------------------- */
function jahresdaten(DATEN, jahr, p) {
  var J = DATEN.jahre[String(jahr)], n = J.n, d = { jahr: jahr, n: n };
  ['preis', 'residual', 'wind', 'pv', 'laufwasser', 'tag', 'stunde', 'monat', 'uhstunde'].forEach(function (k) { d[k] = J[k]; });
  // Tage (Ortszeit): Start- und Endindex
  d.tage = []; var s = 0;
  for (var i = 1; i <= n; i++) if (i === n || J.tag[i] !== J.tag[i - 1]) { d.tage.push([s, i]); s = i; }
  d.anzahlTage = d.tage.length;
  // Tagesmedian der Residuallast -> Kennzeichen "Residuallast unter Tagesmedian"
  d.resUnter = new Array(n);
  d.tage.forEach(function (t) {
    var v = J.residual.slice(t[0], t[1]).slice().sort(function (a, b) { return a - b; });
    var m = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
    for (var i = t[0]; i < t[1]; i++) d.resUnter[i] = J.residual[i] < m;
  });
  // Robustheit H2: Residuallast einschliesslich Laufwasser (Tagesmedian) und Wochenmedian (7-Tage-Bloecke)
  function unterMedian(werte, gruppen) {
    var aus = new Array(n);
    gruppen.forEach(function (g) {
      var v = []; for (var i = g[0]; i < g[1]; i++) v.push(werte[i]); v.sort(function (a, b) { return a - b; });
      var m = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
      for (var k = g[0]; k < g[1]; k++) aus[k] = werte[k] < m;
    });
    return aus;
  }
  var resLw = J.residual.map(function (x, i) { return x - J.laufwasser[i]; });
  d.resLwUnter = unterMedian(resLw, d.tage);
  var wochen = []; for (var w = 0; w < d.tage.length; w += 7) wochen.push([d.tage[w][0], d.tage[Math.min(w + 7, d.tage.length) - 1][1]]);
  d.resWocheUnter = unterMedian(J.residual, wochen);
  // Naeherung Netzdienlichkeit: 100 Viertelstunden mit der hoechsten Last bzw. Residuallast, Winterabende
  var last = J.residual.map(function (x, i) { return x + J.wind[i] + J.pv[i]; });
  function top(werte, k) { return werte.map(function (x, i) { return [x, i]; }).sort(function (a, b) { return b[0] - a[0]; }).slice(0, k).map(function (a) { return a[1]; }); }
  d.topLast = top(last, 100); d.topRes = top(J.residual, 100);
  d.winterAbend = J.monat.map(function (mo, i) { return (mo === 11 || mo === 12 || mo === 1 || mo === 2) && J.stunde[i] >= 17 && J.stunde[i] < 21; });
  // Niedrigpreisregel Art 6 Abs 3: Preis <= 20 EUR/MWh oder < 0,36 x EUA-Preis
  var schwelle = 0.36 * p.eua[jahr];
  d.schwelle = Math.max(20, schwelle);
  var ref = J.preis.slice();
  if (p.niedrigpreis_basis === 'stundenmittel') {
    var sum = {}, cnt = {};
    for (i = 0; i < n; i++) { var h = J.uhstunde[i]; sum[h] = (sum[h] || 0) + J.preis[i]; cnt[h] = (cnt[h] || 0) + 1; }
    for (i = 0; i < n; i++) ref[i] = sum[J.uhstunde[i]] / cnt[J.uhstunde[i]];
  }
  d.niedrig = ref.map(function (x) { return x <= 20 || x < schwelle; });
  // Profile fuer Strombezugsvertraege, normiert auf Jahressumme 1
  function norm(a) { var t = 0; for (var i = 0; i < n; i++) t += Math.max(0, a[i]); return a.map(function (x) { return Math.max(0, x) / t; }); }
  var wp = new Array(n); for (i = 0; i < n; i++) wp[i] = J.wind[i] + J.pv[i];
  d.profil = { windpv: norm(wp), laufwasser: norm(J.laufwasser) };
  // Mischvertraege (Nr. 8): Anteil beta der Vertragsmenge folgt dem Laufwasserprofil, der Rest Wind + PV
  [0.25, 0.5, 0.75].forEach(function (beta) {
    var m = new Array(n); for (var q = 0; q < n; q++) m[q] = beta * d.profil.laufwasser[q] + (1 - beta) * d.profil.windpv[q];
    d.profil['misch' + Math.round(beta * 100)] = m;
  });
  d.stundenJahr = (n / 4);
  return d;
}

/* ---------------------------------------------------------------------
   4. Fahrplaene
   Rueckgabe: Array Pel (MW Elektrolyse je Viertelstunde) und Hk (kg je Viertelstunde)
   --------------------------------------------------------------------- */

// 4.1 Gleichmaessiger Betrieb: konstante Leistung, taegliches rotierendes Ruhefenster
function fahrplanGleichmaessig(d, p) {
  var Pel = new Array(d.n).fill(0), Hk = new Array(d.n).fill(0), ok = true;
  d.tage.forEach(function (t, di) {
    var r = p.ruhe_stunden[di % p.ruhe_stunden.length], ruhe = {};
    if (p.ruhe_fest) {
      // zweite Referenz (Nr. 2): Ruhe an festen Uhrzeiten mit den im Jahresmittel hoechsten Preisen
      p.ruhe_fest_stunden[r].forEach(function (h) { for (var i0 = t[0]; i0 < t[1]; i0++) if (d.stunde[i0] === h) ruhe[d.uhstunde[i0]] = 1; });
    } else {
      var h0 = (di * p.ruhe_versatz) % 24;
      for (var i2 = t[0]; i2 < t[1]; i2++) if (((d.stunde[i2] - h0 + 24) % 24) < r) ruhe[d.uhstunde[i2]] = 1;
    }
    var idx = [];
    for (var j = t[0]; j < t[1]; j++) if (!ruhe[d.uhstunde[j]]) idx.push(j);
    var mTag = p.ziel_kg_tag / 96 * (t[1] - t[0]);             // konstante Abnahme je Viertelstunde
    var P = leistungFuer(mTag / idx.length, p.P_nenn, p);
    if (P < 0) { ok = false; P = p.P_nenn; }
    idx.forEach(function (i) { Pel[i] = P; Hk[i] = wasserstoff(P, p); });
  });
  return { Pel: Pel, Hk: Hk, machbar: ok, art: p.ruhe_fest ? 'gleichmaessig_fest' : 'gleichmaessig' };
}

// 4.2 Preisorientierter Betrieb: je Bilanzierungsfenster von D Tagen die kostenguenstigsten
// Viertelstunden bis zur Fenstermenge; verf[i] = hoechstzulaessige Leistung je Viertelstunde (MW).
function fahrplanPreis(d, p, D, verf) {
  var Pel = new Array(d.n).fill(0), Hk = new Array(d.n).fill(0), fehl = 0, e = entgelte(p);
  // Fenstereinteilung: ganzzahlige Anzahl Fenster, der Rest des Jahres wird dem letzten Fenster zugeschlagen
  var nF = Math.max(1, Math.floor(d.anzahlTage / D));
  for (var f = 0; f < nF; f++) {
    var w = f * D, wEnde = (f === nF - 1) ? d.anzahlTage : w + D;
    var a = d.tage[w][0], b = d.tage[wEnde - 1][1];
    var bedarf = p.ziel_kg_tag / 96 * (b - a);                  // konstante Abnahme je Viertelstunde
    var idx = [];
    for (var i = a; i < b; i++) if (verf[i] > 0) idx.push(i);
    // Reihung nach Kosten je kg: (Preis + variable Entgelte) x relativer spez. Bedarf bei der zulaessigen Leistung
    idx.sort(function (x, y) {
      return (d.preis[x] + e.fvar) * secRel(verf[x] / p.P_nenn, p) - (d.preis[y] + e.fvar) * secRel(verf[y] / p.P_nenn, p);
    });
    for (var k = 0; k < idx.length && bedarf > 1e-9; k++) {
      var j = idx[k], m = wasserstoff(verf[j], p);
      if (m <= bedarf) { Pel[j] = verf[j]; Hk[j] = m; bedarf -= m; }
      else {
        var P = leistungFuer(bedarf, verf[j], p);
        P = Math.max(P, Math.min(verf[j], p.min_last * p.P_nenn)); // Mindestlast einhalten
        Pel[j] = P; Hk[j] = wasserstoff(P, p); bedarf = 0;
      }
    }
    if (bedarf > 1e-6) fehl += bedarf;
  }
  return { Pel: Pel, Hk: Hk, machbar: fehl < 1e-3, fehlmenge: fehl, art: 'preisorientiert', D: D };
}

/* ---------------------------------------------------------------------
   5. Bewertung eines Fahrplans (Kosten und Kennzahlen)
   --------------------------------------------------------------------- */
function bewerte(d, p, plan, zusatz) {
  zusatz = zusatz || {};
  var n = d.n, e = entgelte(p), i;
  // Abnahme: konstant 1.000 kg je Tag, gleichmaessig ueber die Viertelstunden des Tages
  var ab = new Array(n).fill(p.ziel_kg_tag / 96);                  // konstante Abnahme je Viertelstunde
  // Speicherbilanz, Verdichter
  var L = 0, Lmax = 0, Lmin = 0, zuMax = 0, Eel = 0, Ev = 0, Esb = 0, H = 0;
  var kEl = 0, kV = 0, kSb = 0, monMax = {}, hStd = {}, bstd = 0;
  var eUnter = 0, eNiedrig = 0, eNeg = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, eLw = 0, eWo = 0, eWA = 0, starts = 0, pges_arr = new Array(n);
  for (i = 0; i < n; i++) {
    var zu = Math.max(plan.Hk[i] - ab[i], 0);
    L += plan.Hk[i] - ab[i]; if (L > Lmax) Lmax = L; if (L < Lmin) Lmin = L;
    if (zu * 4 > zuMax) zuMax = zu * 4;                    // kg/h
    var eel = plan.Pel[i] * 0.25;                          // MWh
    var ev = zu * p.verdichter_energie / 1000;             // MWh
    var esb = plan.Pel[i] > 0 ? 0 : p.bereitschaft * p.P_nenn * 0.25;
    var pges = plan.Pel[i] + ev * 4 + esb * 4;             // MW am Netzanschluss
    Eel += eel; Ev += ev; Esb += esb; H += plan.Hk[i];
    kEl += eel * d.preis[i]; kV += ev * d.preis[i]; kSb += esb * d.preis[i];
    var mo = d.monat[i]; if (!(mo in monMax) || pges > monMax[mo]) monMax[mo] = pges;
    if (plan.Pel[i] > 0) { hStd[d.uhstunde[i]] = 1; bstd += 0.25; }
    var eg = eel + ev + esb;
    if (d.resUnter[i]) eUnter += eg;
    if (d.resLwUnter[i]) eLw += eg;
    if (d.resWocheUnter[i]) eWo += eg;
    if (d.winterAbend[i]) eWA += eg;
    if (plan.Pel[i] > 0 && (i === 0 || plan.Pel[i - 1] <= 0)) starts++;
    pges_arr[i] = pges;
    if (d.niedrig[i]) eNiedrig += eg;
    if (d.preis[i] < 0) eNeg += eg;
    sx += pges; sy += d.residual[i]; sxx += pges * pges; syy += d.residual[i] * d.residual[i]; sxy += pges * d.residual[i];
  }
  var Eges = Eel + Ev + Esb;
  var speicherNetto = Lmax - Lmin;                                  // kg, notwendiges Arbeitsvolumen
  var speicherKap = speicherNetto / (1 - p.speicher_reserve);        // kg, Nennkapazitaet
  var monate = Object.keys(monMax), Pbill = 0;
  monate.forEach(function (m) { Pbill += monMax[m]; }); Pbill = Pbill / monate.length; // MW, § 52 Abs 1 ElWOG
  var uhStd = Object.keys(hStd).length;
  var vlh = Eel / p.P_nenn;
  var ann = annuitaet(p.zins, p.nutzungsdauer);
  var PkW = p.P_nenn * 1000;
  // Stacktausch
  var hBasis = (p.stack_basis === 'volllaststunden') ? vlh : bstd;
  var intervall = hBasis > 0 ? p.stack_lebensdauer / hBasis : 1e9, pvStack = 0, anzahlTausch = 0, tLetzt = 0;
  for (var t = intervall; t < p.nutzungsdauer - 1e-9; t += intervall) { pvStack += p.stack_kosten * PkW / Math.pow(1 + p.zins, t); anzahlTausch++; tLetzt = t; }
  // Restwert des am Ende der Nutzungsdauer eingesetzten Stacks (linear nach verbleibender Lebensdauer), abgezinst;
  // vermeidet Spruenge der Kosten an den Grenzen der Tauschanzahl (eigene Festlegung)
  var restAnteil = Math.max(0, 1 - (p.nutzungsdauer - tLetzt) / intervall);
  var pvRest = p.stack_restwert === false ? 0 : p.stack_kosten * PkW * restAnteil / Math.pow(1 + p.zins, p.nutzungsdauer);
  pvStack -= pvRest;
  var K = {};
  K.kapital = p.capex * PkW * ann;
  K.stack = pvStack * ann;
  K.betrieb = p.opex_fix * p.capex * PkW;
  K.energie = kEl + kSb;
  K.entgelteArbeit = e.fvar * (Eel + Esb);
  K.leistungspreis = e.lp * Pbill * 1000;
  K.pauschale = e.pauschale;
  K.wasser = p.wasser * H;
  K.aufpreis = (zusatz.ppaVolumen || 0) * (zusatz.aufpreis || 0);
  K.verdEnergie = kV + e.fvar * Ev;
  K.verdichter = p.verdichter_capex * zuMax * (ann + p.verdichter_om);
  K.speicher = p.speicher_capex * speicherKap * (ann + p.speicher_om);
  var lcohKosten = K.kapital + K.stack + K.betrieb + K.energie + K.entgelteArbeit + K.leistungspreis + K.pauschale + K.wasser + K.aufpreis;
  var zusatzKosten = K.verdEnergie + K.verdichter + K.speicher;
  var nn = n, korr = (nn * sxy - sx * sy) / Math.sqrt((nn * sxx - sx * sx) * (nn * syy - sy * sy));
  var grenze = d.stundenJahr * p.ee_anteil;
  return {
    art: plan.art, D: plan.D || null, kappung: zusatz.kappung || null, machbar: plan.machbar !== false,
    H_kg: H, E_el_MWh: Eel, E_verd_MWh: Ev, E_ges_MWh: Eges,
    volllaststunden: vlh, betriebsstunden: bstd, stunden_mit_erzeugung: uhStd, stundengrenze: grenze, stundengrenze_ok: uhStd <= grenze,
    P_abrechnung_MW: Pbill, speicher_kg: speicherKap, speicher_netto_kg: speicherNetto, verdichter_kg_h: zuMax,
    stacktausch_anzahl: anzahlTausch,
    mittl_energiepreis: (kEl + kV + kSb) / Eges,
    anteil_residual_unter_median: eUnter / Eges, anteil_niedrigpreis: eNiedrig / Eges, anteil_negativ: eNeg / Eges,
    korrelation_residual: korr,
    anteil_res_lw_unter_median: eLw / Eges, anteil_res_woche_unter_median: eWo / Eges, anteil_winterabend: eWA / Eges,
    P_top100_last: d.topLast.reduce(function (s, i) { return s + pges_arr[i]; }, 0) / d.topLast.length,
    P_top100_residual: d.topRes.reduce(function (s, i) { return s + pges_arr[i]; }, 0) / d.topRes.length,
    starts: starts, spez_energiebedarf: Eel * 1000 / H,
    kosten: K, lcoh: lcohKosten / H, bereitstellung: (lcohKosten + zusatzKosten) / H,
    ppa_volumen_MWh: zusatz.ppaVolumen || 0
  };
}

/* ---------------------------------------------------------------------
   6. Regime I: Netzstrom voll anrechenbar (Art 4 Abs 1), Stundengrenze
   Nr. 1 Referenzfall (rotierende Pause), Nr. 2 zweite Referenz (feste Pause),
   Nr. 3 Tagesplanung (je Tag die guenstigsten Viertelstunden mit voller Leistung).
   Nr. 4 (Optimierung) wird extern gerechnet (lp_lauf.py) und mit bewerteExtern bewertet.
   --------------------------------------------------------------------- */
function rechneRegimeI(d, p) {
  var gl = bewerte(d, p, fahrplanGleichmaessig(d, p));
  var glf = bewerte(d, p, fahrplanGleichmaessig(d, mitParametern(p, { ruhe_fest: true })));
  var tp = bewerte(d, p, fahrplanPreis(d, p, p.tp_fenster, new Array(d.n).fill(p.P_nenn)));
  return { referenz: gl, referenz_fest: glf, tagesplanung: tp };
}

/* ---------------------------------------------------------------------
   7. Regime II: Strombezugsvertrag mit zeitlicher Korrelation (hier je Viertelstunde,
   Art 6 Abs 2 DelVO 2023/1184 ab 2030 stuendlich); Niedrigpreis-Viertelstunden nach
   Art 6 Abs 3 gelten stets als korreliert. Vertragsvolumen V (MWh/a) mit Erzeugungsprofil;
   zulaessige Leistung je Viertelstunde: Niedrigpreis: Nennleistung, sonst
   min(Nennleistung, Vertragsleistung). Mengenbedingung Art 5: Elektrolyseenergie <= V.
   --------------------------------------------------------------------- */
/* Tagesplanung mit Speicherziel (Nr. 6, mit anderen Profilen Nr. 7 und 8; Auslegung Nr. 5)
   Tagesplanung mit Speicherziel: Der Betreiber kennt am Vortag die Day-Ahead-Preise
   und die Lieferung des Strombezugsvertrags (Wind/PV- bzw. Laufwasserprognose) fuer
   den Folgetag. Je Tag werden die verfuegbaren Viertelstunden nach dem Preis gereiht
   und so viele belegt, dass die Tagesmenge entsteht und der Speicher am Tagesende
   wieder voll ist (Speicherziel = voller Speicher). Reicht die Lieferung nicht, wird
   der Speicher geleert (Flaute) und an den folgenden Tagen wieder aufgefuellt.
   Die Groesse des Speichers ist keine Vorgabe, sondern folgt aus der groessten
   Entleerung im Jahr (Auslegung mit dem historischen Jahr, wie in der Praxis).
   D0 = Entleerung (kg) zu Jahresbeginn; sie wird in auslegungII so gewaehlt, dass sie
   der Entleerung am Jahresende entspricht (das Jahr wiederholt sich, Anfangs- = Endfuellstand).
   --------------------------------------------------------------------- */
function fahrplanSpeicherziel(d, p, verf, D0) {
  var n = d.n, e = entgelte(p), a = p.ziel_kg_tag / 96;
  var Pel = new Array(n).fill(0), Hk = new Array(n).fill(0), Df = D0 || 0, Dmax = Df, fehl = 0, tageFehl = 0;
  d.tage.forEach(function (t) {
    var bedarf = Df + a * (t[1] - t[0]);              // Tagesmenge plus Auffuellen des Speichers
    var idx = []; for (var i = t[0]; i < t[1]; i++) if (verf[i] > 0) idx.push(i);
    idx.sort(function (x, y) { return (d.preis[x] + e.fvar) * secRel(verf[x] / p.P_nenn, p) - (d.preis[y] + e.fvar) * secRel(verf[y] / p.P_nenn, p); });
    for (var k = 0; k < idx.length && bedarf > 1e-9; k++) {
      var j = idx[k], m = wasserstoff(verf[j], p);
      if (m <= bedarf) { Pel[j] = verf[j]; Hk[j] = m; bedarf -= m; }
      else {
        var P = leistungFuer(bedarf, verf[j], p);
        P = Math.max(P, Math.min(verf[j], p.min_last * p.P_nenn)); // Mindestlast einhalten
        Pel[j] = P; Hk[j] = wasserstoff(P, p); bedarf = 0;
      }
    }
    if (bedarf > 1e-6) { fehl += bedarf; tageFehl++; }  // Lieferung reichte nicht: Speicher wird geleert
    for (i = t[0]; i < t[1]; i++) { Df += a - Hk[i]; if (Df > Dmax) Dmax = Df; }
  });
  return { Pel: Pel, Hk: Hk, machbar: true, D0: D0 || 0, Dmax: Dmax, Dende: Df, fehlmenge: fehl, tage_mit_fehlmenge: tageFehl, art: 'speicherziel' };
}
// zulaessige Leistung je Viertelstunde fuer Vertragsvolumen V und Profil (mit Niedrigpreisregel Art 6 Abs 3).
// Liefert der Vertrag weniger als die Mindestlast, kann der Elektrolyseur in dieser Viertelstunde nicht
// korreliert betrieben werden (ein Betrieb mit Mindestlast laege ueber der Vertragslieferung): zulaessig = 0.
function verfuegbarkeitVertrag(d, p, V, profil) {
  var prof = d.profil[profil], a = new Array(d.n), pmin = p.min_last * p.P_nenn;
  for (var i = 0; i < d.n; i++) {
    if (d.niedrig[i]) { a[i] = p.P_nenn; continue; }
    var lief = V * prof[i] * 4;
    a[i] = lief < pmin ? 0 : Math.min(p.P_nenn, lief);
  }
  return a;
}
// Regel mit zyklischem Jahr: Entleerung am Jahresende = Entleerung am Jahresanfang (hoechstens 6 Durchlaeufe)
function fahrplanSpeicherzielZyklisch(d, p, verf) {
  var D0 = 0, plan;
  for (var it = 0; it < 6; it++) { plan = fahrplanSpeicherziel(d, p, verf, D0); if (Math.abs(plan.Dende - D0) < 1e-6) break; D0 = plan.Dende; }
  plan.zyklisch_abw = plan.Dende - plan.D0; plan.durchlaeufe = it + 1;
  return plan;
}
/* Auslegung (Nr. 5): fuer jedes Vertragsvolumen (Vielfaches des Jahresstrombedarfs) und jedes Profil
   wird die Regel gerechnet und bewertet; der Speicher folgt aus der groessten Entleerung.
   Je Aufpreis wird die guenstigste Kombination gewaehlt (Aufpreis = alpha x V, aendert den Fahrplan nicht). */
function auslegungII(d, p, profile) {
  var Ebedarf = p.ziel_kg_tag * d.anzahlTage * p.sec_nenn / 1000, varianten = [];
  profile.forEach(function (prof) {
    p.ausl_faktoren.forEach(function (f) {
      var V = f * Ebedarf, verf = verfuegbarkeitVertrag(d, p, V, prof), plan = fahrplanSpeicherzielZyklisch(d, p, verf);
      var r0 = bewerte(d, mitParametern(p, { ppa_profil: prof }), plan, { ppaVolumen: V, aufpreis: 0 });
      var v = { profil: prof, faktor: f, V: V, D0: plan.D0, Dmax: plan.Dmax, Dende: plan.Dende, zyklisch_abw: plan.zyklisch_abw, durchlaeufe: plan.durchlaeufe,
                fehlmenge: plan.fehlmenge, tage_mit_fehlmenge: plan.tage_mit_fehlmenge, H_kg: r0.H_kg, E_el_MWh: r0.E_el_MWh,
                speicher_kg: r0.speicher_kg, speicher_netto_kg: r0.speicher_netto_kg, bereitstellung: {}, lcoh: {},
                mengenbedingung_ok: r0.E_el_MWh <= V + 1e-6, plan: plan, bewertung0: r0 };
      p.ausl_aufpreise.forEach(function (al) { v.bereitstellung[al] = r0.bereitstellung + al * V / r0.H_kg; v.lcoh[al] = r0.lcoh + al * V / r0.H_kg; });
      varianten.push(v);
    });
  });
  var wahl = {};
  p.ausl_aufpreise.forEach(function (al) {
    var best = null; varianten.forEach(function (v) { if (v.mengenbedingung_ok && (!best || v.bereitstellung[al] < best.bereitstellung[al])) best = v; });
    wahl[al] = best;
  });
  return { varianten: varianten, wahl: wahl, Ebedarf: Ebedarf };
}

/* ---------------------------------------------------------------------
   8. Preisstatistik je Jahr (fuer H1, Teil 2)
   --------------------------------------------------------------------- */
function preisstatistik(d, p) {
  var n = d.n, s = 0, ss = 0, i;
  for (i = 0; i < n; i++) { s += d.preis[i]; ss += d.preis[i] * d.preis[i]; }
  var mw = s / n, sd = Math.sqrt(ss / n - mw * mw);
  // mittlere taegliche Preisdifferenz: Tagesmittel minus Mittel der guenstigsten Viertelstunden,
  // die bei Nennlast fuer die Tagesmenge noetig sind
  var kNoetig = Math.ceil(p.ziel_kg_tag / wasserstoff(p.P_nenn, p)), dsum = 0;
  d.tage.forEach(function (t) {
    var v = d.preis.slice(t[0], t[1]), m = v.reduce(function (a, b) { return a + b; }, 0) / v.length;
    v.sort(function (a, b) { return a - b; });
    var g = v.slice(0, kNoetig).reduce(function (a, b) { return a + b; }, 0) / kNoetig;
    dsum += m - g;
  });
  var nNied = 0, nNeg = 0; for (i = 0; i < n; i++) { if (d.niedrig[i]) nNied++; if (d.preis[i] < 0) nNeg++; }
  return { mittel: mw, stdabw: sd, varkoeff: sd / mw, tagesdifferenz: dsum / d.anzahlTage,
           stunden_niedrigpreis: nNied / 4, stunden_negativ: nNeg / 4, schwelle: d.schwelle };
}

/* ---------------------------------------------------------------------
   9. Gesamtrechnung fuer ein Jahr (Parameter-Rechner.html)
   --------------------------------------------------------------------- */
function rechneJahr(DATEN, jahr, p, optionen) {
  optionen = optionen || {};
  var d = jahresdaten(DATEN, jahr, p);
  var out = { jahr: jahr, preis: preisstatistik(d, p) };
  out.regime1 = rechneRegimeI(d, p);
  if (optionen.regime2 !== false) out.regime2 = auslegungII(d, p, optionen.profile || ['windpv', 'laufwasser', 'misch25', 'misch50', 'misch75']);
  return out;
}

/* ---------------------------------------------------------------------
   10. Bewertung eines extern ermittelten Fahrplans (lineares Programm, Nr. 4)
   --------------------------------------------------------------------- */
function bewerteExtern(DATEN, jahr, p, Pel, Hk, zusatz, art) {
  var d = jahresdaten(DATEN, jahr, p);
  var plan = { Pel: Pel, Hk: Hk || Pel.map(function (x) { return wasserstoff(x, p); }), machbar: true, art: art || 'optimiert' };
  return bewerte(d, p, plan, zusatz);
}

if (typeof module !== 'undefined') module.exports = {
  bewerteExtern: bewerteExtern,
  STANDARD: STANDARD, MODELL_VERSION: MODELL_VERSION, mitParametern: mitParametern, kopiere: kopiere,
  jahresdaten: jahresdaten, fahrplanGleichmaessig: fahrplanGleichmaessig, fahrplanPreis: fahrplanPreis,
  bewerte: bewerte, rechneRegimeI: rechneRegimeI,
  fahrplanSpeicherziel: fahrplanSpeicherziel, fahrplanSpeicherzielZyklisch: fahrplanSpeicherzielZyklisch, verfuegbarkeitVertrag: verfuegbarkeitVertrag, auslegungII: auslegungII,
  preisstatistik: preisstatistik, rechneJahr: rechneJahr, annuitaet: annuitaet, secRel: secRel, entgelte: entgelte,
  wasserstoff: wasserstoff, leistungFuer: leistungFuer
};
