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

var MODELL_VERSION = '2.0 (01.10.2026, Datenblatt Enapter AEM Nexus 2500)';

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
  bereitschaft: 0.0,      // Bereitschaftsleistung im Stillstand, Anteil der Nennleistung (eigene Annahme)

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
  fenster_tage: [1, 2, 3, 4, 7, 14, 28], // untersuchte Bilanzierungsfenster (Varianten; Fenster > 1 Tag setzen Voraussicht voraus)
  tp_fenster: 1,             // Tagesplanung: Bilanzierungsfenster 1 Tag (Planung mit den am Vortag bekannten Preisen)
  kappungen: [1.0, 0.9, 0.8, 0.7, 0.6, 0.5], // untersuchte Leistungskappungen (Anteil der Nennleistung)
  ee_anteil: 0.90065,        // EE-Anteil 2024 fuer die Stundengrenze (Eurostat, 90,065 %)

  // --- Regime II ---
  eua: {2022: 80.32, 2023: 83.66, 2024: 65.00, 2025: 73.86}, // EUR/t, Jahresmittel (DEHSt)
  niedrigpreis_basis: 'viertelstunde', // 'viertelstunde' oder 'stundenmittel' (nur ab 1.10.2025 relevant)
  aufpreis: 0.0,             // EUR/MWh Gruenstromaufpreis auf das gesamte Vertragsvolumen
  ppa_profil: 'windpv',      // 'windpv' (Regime II) oder 'laufwasser' (Zwischenvariante Art 4 Abs 2)
  ppa_faktoren: [1.0, 1.15, 1.3, 1.5, 2.0], // untersuchte Vielfache des kleinsten zulaessigen Vertragsvolumens
  ppa_max_faktor: 2.0,       // groesstes Vertragsvolumen als Vielfaches des Jahresstrombedarfs bei Nennlast (eigene Festlegung)
  fenster_tage_II: [1, 2, 3, 4, 7, 14, 28, 56], // Bilanzierungsfenster im Regime II
  kappungen_II: [1.0, 0.8, 0.7], // Leistungskappungen im Regime II
  ruhe_preisorientiert: false, // gleichmaessiger Betrieb: Ruhefenster in die teuersten Stunden des Tages legen (zweite Referenz)
  sperrfenster: null,        // z. B. [17, 21]: kein Bezug zwischen 17 und 21 Uhr (eingeschraenkter Netzzugang)
  wechsel_jahre_regime1: 4   // Wechselfall: Betriebsjahre 2028–2031 im Regime I, danach Regime II
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
    if (p.ruhe_preisorientiert) {
      // die r teuersten Uhrzeitstunden des Tages (Day-Ahead-Preise des Folgetags sind bekannt)
      var st = {};
      for (var i = t[0]; i < t[1]; i++) { var u = d.uhstunde[i]; st[u] = (st[u] || 0) + d.preis[i]; }
      Object.keys(st).sort(function (a, b) { return st[b] - st[a]; }).slice(0, r).forEach(function (u) { ruhe[u] = 1; });
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
  return { Pel: Pel, Hk: Hk, machbar: ok, art: p.ruhe_preisorientiert ? 'gleichmaessig_preisbewusst' : 'gleichmaessig' };
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
   6. Regime I: Netzstrom voll anrechenbar (Art 4 Abs 1)
   --------------------------------------------------------------------- */
function rechneRegimeI(d, p) {
  var gl = bewerte(d, p, fahrplanGleichmaessig(d, p));
  var varianten = [];
  p.kappungen.forEach(function (c) {
    var verf = new Array(d.n).fill(c * p.P_nenn);
    if (p.sperrfenster) for (var i = 0; i < d.n; i++) if (d.stunde[i] >= p.sperrfenster[0] && d.stunde[i] < p.sperrfenster[1]) verf[i] = 0;
    p.fenster_tage.forEach(function (D) {
      var r = bewerte(d, p, fahrplanPreis(d, p, D, verf), { kappung: c });
      if (r.machbar && r.stundengrenze_ok) varianten.push(r);
    });
  });
  varianten.sort(function (a, b) { return a.bereitstellung - b.bereitstellung; });
  // Tagesplanung: guenstigste Kappung beim Fenster von einem Tag; laengere Fenster nur als Varianten
  var tp = varianten.filter(function (v) { return v.D === p.tp_fenster; })[0] || varianten[0];
  return { gleichmaessig: gl, preisorientiert: tp, bestes_fenster: varianten[0], varianten: varianten };
}

/* ---------------------------------------------------------------------
   7. Regime II: Strombezugsvertrag mit stuendlicher (hier viertelstuendlicher)
   Korrelation; Niedrigpreisstunden nach Art 6 Abs 3 zeitlich stets korreliert.
   Vertragsvolumen V (MWh/a) mit Profil; zulaessige Leistung je Viertelstunde:
   Niedrigpreis: Kappung x Nennleistung, sonst min(Kappung x Nennleistung, Vertragsleistung).
   Mengenbedingung Art 5: Elektrolyseenergie im Jahr <= Vertragsvolumen.
   --------------------------------------------------------------------- */
function verfuegbarkeitII(d, p, V, c) {
  var prof = d.profil[p.ppa_profil], a = new Array(d.n);
  for (var i = 0; i < d.n; i++) a[i] = d.niedrig[i] ? c * p.P_nenn : Math.min(c * p.P_nenn, V * prof[i] * 4);
  return a;
}
function machbarII(d, p, V, D, c) {
  var plan = fahrplanPreis(d, p, D, verfuegbarkeitII(d, p, V, c));
  var E = 0; for (var i = 0; i < d.n; i++) E += plan.Pel[i] * 0.25;
  return { ok: plan.machbar && E <= V + 1e-6, plan: plan };
}
function rechneRegimeII(d, p) {
  var varianten = [];
  var Ebedarf = p.ziel_kg_tag * d.anzahlTage * p.sec_nenn / 1000;   // MWh/a bei Nennlast-Bedarf
  var Vmax = p.ppa_max_faktor * Ebedarf;                              // groesstes zulaessiges Vertragsvolumen
  p.kappungen_II.forEach(function (c) {
    p.fenster_tage_II.forEach(function (D) {
      if (!machbarII(d, p, Vmax, D, c).ok) return;                   // mit groesstem Vertrag nicht machbar
      var lo = 0.5 * Ebedarf, hi = Vmax;
      for (var it = 0; it < 22; it++) { var mid = (lo + hi) / 2; if (machbarII(d, p, mid, D, c).ok) hi = mid; else lo = mid; }
      var Vs = p.ppa_faktoren.map(function (f) { return Math.min(hi * f, Vmax); });
      Vs.push(Vmax);
      Vs.filter(function (v, k) { return Vs.indexOf(v) === k; }).forEach(function (V) {
        var m = machbarII(d, p, V, D, c);
        if (!m.ok) return;
        var r = bewerte(d, p, m.plan, { ppaVolumen: V, aufpreis: p.aufpreis, kappung: c });
        r.ppa_faktor_bedarf = V / Ebedarf; r.ppa_min_MWh = hi;
        varianten.push(r);
      });
    });
  });
  varianten.sort(function (a, b) { return a.bereitstellung - b.bereitstellung; });
  return { bester: varianten[0] || null, varianten: varianten, machbar: varianten.length > 0 };
}

/* ---------------------------------------------------------------------
   8. Wechselfall: Betriebsjahre 1..m im Regime I, danach Regime II.
   Speicher und Verdichter werden zunaechst fuer den Bedarf der Regime-I-Fahrweise
   errichtet; die Erweiterung auf den Regime-II-Bedarf wird am Ende des Jahres m
   investiert. Barwertrechnung: LCOH = Barwert aller Kosten / Barwert der Menge.
   --------------------------------------------------------------------- */
function rechneWechsel(rI, rII, p) {
  var n = p.nutzungsdauer, m = p.wechsel_jahre_regime1, i = p.zins;
  var H = rI.H_kg, PkW = p.P_nenn * 1000;
  // laufende Kosten je Jahr ohne Investitionen in Speicher und Verdichter
  var laufL = function (r) { var K = r.kosten; return K.energie + K.entgelteArbeit + K.leistungspreis + K.pauschale + K.wasser + K.aufpreis + K.betrieb + K.stack; };
  var laufV = function (r) { return r.kosten.verdEnergie; };
  var invSp = function (kg) { return p.speicher_capex * kg; }, invV = function (kgh) { return p.verdichter_capex * kgh; };
  var sp1 = rI.speicher_kg, v1 = rI.verdichter_kg_h;
  var sp2 = Math.max(rI.speicher_kg, rII.speicher_kg), v2 = Math.max(rI.verdichter_kg_h, rII.verdichter_kg_h);
  var pvL = 0, pvV = 0, pvH = 0;
  for (var t = 1; t <= n; t++) {
    var df = 1 / Math.pow(1 + i, t), r = t <= m ? rI : rII;
    var om = p.speicher_om * invSp(t <= m ? sp1 : sp2) + p.verdichter_om * invV(t <= m ? v1 : v2);
    pvL += df * laufL(r); pvV += df * (laufV(r) + om); pvH += df * H;
  }
  var inv0 = p.capex * PkW, invSV0 = invSp(sp1) + invV(v1);
  var invSVm = m < n ? (invSp(sp2) - invSp(sp1) + invV(v2) - invV(v1)) / Math.pow(1 + i, m) : 0;
  // Erweiterung wird zum Ende der Nutzungsdauer nicht vollstaendig abgeschrieben: Restwert nicht angesetzt (vorsichtig)
  var lcoh = (inv0 + pvL) / pvH;
  var bereit = (inv0 + invSV0 + invSVm + pvL + pvV) / pvH;
  return { bereitstellung: bereit, lcoh: lcoh, speicher_kg: sp2, verdichter_kg_h: v2, jahre_regime1: m };
}

/* ---------------------------------------------------------------------
   9. Preisstatistik je Jahr (fuer H1, Teil 2)
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
   10. Gesamtrechnung fuer ein Jahr
   --------------------------------------------------------------------- */
function rechneJahr(DATEN, jahr, p, optionen) {
  optionen = optionen || {};
  var d = jahresdaten(DATEN, jahr, p);
  var out = { jahr: jahr, preis: preisstatistik(d, p) };
  out.regime1 = rechneRegimeI(d, p);
  if (optionen.regime2 !== false) {
    out.regime2 = rechneRegimeII(d, mitParametern(p, { ppa_profil: 'windpv' }));
    if (optionen.zwischen !== false) out.zwischen = rechneRegimeII(d, mitParametern(p, { ppa_profil: 'laufwasser' }));
    var besterI = out.regime1.preisorientiert.bereitstellung < out.regime1.gleichmaessig.bereitstellung ? out.regime1.preisorientiert : out.regime1.gleichmaessig;
    if (out.regime2.bester) out.wechsel = rechneWechsel(besterI, out.regime2.bester, p);
  }
  return out;
}

/* ---------------------------------------------------------------------
   11. Bewertung eines extern ermittelten Fahrplans (lineares Programm)
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
  bewerte: bewerte, rechneRegimeI: rechneRegimeI, rechneRegimeII: rechneRegimeII, rechneWechsel: rechneWechsel,
  preisstatistik: preisstatistik, rechneJahr: rechneJahr, annuitaet: annuitaet, secRel: secRel, entgelte: entgelte,
  wasserstoff: wasserstoff
};
