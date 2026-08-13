# SLR Harvester Web — Vorschläge

Laufend ergänzte Sammlung von Ideen, Beobachtungen und Verbesserungsvorschlägen,
die während der Arbeit an der Web-Version entstehen. Kein Task-Tracker (siehe dafür
[TASKS.md](TASKS.md)) — hier geht es um Dinge, die es wert sind, festgehalten zu werden,
auch wenn sie noch nicht umgesetzt sind.

---

## 2026-08-13 (Nachtrag: Scopus COMPLETE-View)

Dein aktueller Scopus-Key (siehe `slr_config.json` im Hauptordner) ist **gültig
und nicht abgelaufen** — das habe ich live gegen die echte API getestet (200 OK, echte
Trefferzahlen). Er hat aber laut Elsevier keine Berechtigung für die `COMPLETE`-View
(401 AUTHORIZATION_ERROR), nur für `STANDARD`. Die Web-App fällt jetzt automatisch auf
STANDARD zurück, wenn COMPLETE fehlschlägt — funktional bist du also nicht mehr blockiert.

Falls du volle Autorenlisten/Abstracts direkt von Scopus (ohne Crossref-Umweg) willst,
müsstest du bei Elsevier prüfen, ob dein Institutions-Abo COMPLETE-View-Zugriff vorsieht
(das hängt vom API-Produkt/Abo deiner Institution ab, nicht vom Key selbst) — ggf. reicht
auch ein `X-ELS-Insttoken`, falls du außerhalb des Instituts-IP-Bereichs suchst (Feld ist in
den Settings vorhanden, aber bislang leer). Die `View`-Einstellung selbst liegt in
`slr_config.json` im Hauptordner (nicht in `slr-harvester-web`) und wurde bewusst nicht
verändert, da ich Dateien außerhalb der Web-App-Zielordners nicht anfassen soll — falls du sie
zurück auf `"STANDARD"` stellen willst, um das UI konsistenter zu machen (aktuell zeigt das
Test-Tool ohnehin den echten Status), kannst du das selbst in der Datei anpassen; nötig ist es
aber nicht mehr, da der automatische Fallback das jetzt ohnehin abfängt.

## 2026-08-13

### Artikel-Identität in `getArticles` (data.js) — bewusst NICHT geändert, Rücksprache empfohlen

In `js/data.js` (`getArticles`) wird die projektweite Artikel-Identität so bestimmt:
`const id = r.eid || r.doi || null;`. Das ist derselbe Mechanismus, über den auch
`slr_global_tags.json` Tags/Anmerkungen zu Artikeln zuordnet (Tags werden über diese `id`
gespeichert und nachgeschlagen). Es gibt denselben theoretischen Fall wie den behobenen
`dedupeByIdentity`-Bug (siehe TASKS.md): zwei Zeilen mit unterschiedlicher `eid`
(z. B. eine Scopus-EID und eine später per Crossref-Anreicherung entstandene Variante),
aber derselben DOI, würden hier als zwei separate Artikel geführt statt zusammengeführt.

Ich habe das **bewusst nicht geändert**, weil eine Umkehrung der Priorität (DOI vor eid)
die Identität von bereits getaggten Artikeln in **bestehenden** Projektordnern rückwirkend
verändern würde — vorhandene `slr_global_tags.json`-Einträge sind aktuell nach `eid` indiziert.
Eine stille Änderung hier könnte in echten Projekten Tags "verwaisen" lassen (Tag bleibt unter
der alten ID gespeichert, während der Artikel plötzlich unter einer neuen ID geführt wird).

Falls gewünscht, wäre eine sichere Lösung: einen zusätzlichen DOI→ID-Index mitführen, der bei
Erkennung einer neuen Zeile mit bereits bekannter DOI (aber neuer eid) die **bestehende** ID
weiterverwendet (Merge ohne Identitätswechsel), statt die Priorität der Schlüssel zu vertauschen.
Das ist aber ein invasiverer Eingriff in den Kernmechanismus und sollte nur mit ausdrücklicher
Rücksprache umgesetzt werden, idealerweise mit einem Test anhand eines echten Projektordners.


### OpenAlex: API-Key/E-Mail sollte klarer beworben werden

Auch nach dem Cursor-Pagination-Fix gilt: anonyme Anfragen an OpenAlex ohne `mailto`/`api_key`
landen im "common pool" und werden bei Lastspitzen eher gedrosselt (503) als Anfragen im
"polite pool". Die Such-Ansicht zeigt zwar einen Hinweis, wenn ein 503 tatsächlich auftritt,
aber ein proaktiver, dezenter Hinweis in der Settings-Ansicht ("Trage eine E-Mail-Adresse ein,
um zuverlässiger zu suchen") könnte viele Supportfälle vermeiden. Aktuell ist das Feld vorhanden,
aber nicht sehr auffällig beworben.

### Scopus: Rate-Limit-Feedback für den Nutzer

Nach dem Retry/Backoff-Fix (siehe TASKS.md) schlägt eine Scopus-Suche jetzt seltener fehl, aber
wenn alle Retries ausgeschöpft sind, bekommt der Nutzer nur eine generische Fehlermeldung. Es wäre
hilfreich, bei HTTP 429 explizit auf Scopus-Quota-Limits hinzuweisen (Elsevier begrenzt z. B.
Requests/Sekunde und Requests/Woche je nach Abo), analog zum bestehenden OpenAlex-503-Hinweis.

### Suchfeld-übergreifende Konsistenzprüfung

Es könnte sinnvoll sein, nach einer Suche automatisch den von der API gemeldeten
`totalResults`/`meta.count`-Wert dem Nutzer anzuzeigen (z. B. "3.421 Treffer gefunden auf OpenAlex,
davon 500 geladen") — das würde sofort sichtbar machen, wenn eine Suche durch das `Max results`-Limit
gedeckelt wird, statt dass der Nutzer denkt, es gäbe nur so viele Treffer insgesamt. Aktuell wird nur
die Anzahl der geladenen/gespeicherten Ergebnisse angezeigt, nicht die tatsächliche Gesamttrefferzahl
der Datenbank.

### serve.py: Konsolen-Encoding auf Windows

Die Ursache des serve.py-Absturzes (siehe TASKS.md, cp1252 vs. Unicode-Pfeil) betrifft potenziell auch
zukünftige Print-Statements. Sinnvoll wäre `sys.stdout.reconfigure(encoding='utf-8')` direkt zu
Skriptbeginn (Python 3.7+), damit auch künftig hinzugefügte Sonderzeichen in print()-Ausgaben nicht
erneut zum Absturz führen — statt sich darauf zu verlassen, dass niemand mehr Unicode-Zeichen einbaut.

---

<!-- Neue Einträge oben mit Datum ergänzen -->
