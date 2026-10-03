---
Kategorien:
  - "[[Lehraufträge]]"
Fach: 
Stufe: 
Klasse:
Bild:
Schuljahre:
---

## Unterrichtseinheiten
![[Unterrichtseinheiten.base#Lehrauftrag]]

## GFS-Themen
![[GFS-Themen.base#Lehrauftrag]]

## Grundsätzliche Überlegungen

## Notenbildung

## Statistik
```dataviewjs
// Archivierte Stundennotizen (ersetzt oder auf der Plattform gelöscht) zählen nicht mit.
let stunden = dv.pages(`"${dv.current().file.folder}"`).where(p => p.Kategorien && p.Kategorien.some(k => k?.path === "UStunden")).where(p => p.uplan_status != "archiviert")
//
let stunden_u = stunden.where(p=> p.UArt != "Entfall")
//
let stunden_p = stunden.where(p=> p.UArt == "Prüfung")
//
let stunden_e = stunden.where(p=> p.UArt == "Entfall")
//
let stunden_pu = stunden.where(p=> p.UArt == "Puffer")
//
let out = "";
//
if(stunden_u.length != 1){
	out += "- / "+stunden_u.length+" Stunden Unterricht insgesamt\n"
} else {
	out += "- / "+stunden_u.length+" Stunde Unterricht insgesamt\n"
}
//
if(stunden_pu.length != 1){
	out +="- @ "+stunden_pu.length+" Stunden Puffer\n"
} else {
	out +="- @ "+stunden_pu.length+" Stunde Puffer\n"
}
//
if(stunden_p.length != 1){
	out += "- ~ "+stunden_p.length+" Stunden für Prüfungen\n"
} else {
	out += "- ~ "+stunden_p.length+" Stunden für Prüfungen\n"
}
//
if(stunden_e.length != 1){
	out += "- ! "+stunden_e.length+" Stunden Entfall\n"
} else {
	out += "- ! "+stunden_e.length+" Stunde Entfall\n"
}
dv.paragraph(out)
```