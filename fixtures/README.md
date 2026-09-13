# Fixtures

Aufgezeichnete Antworten der Plattform, adressiert über `METHOD /pfad`.

Aufnehmen (Dev-Instanz, YAML-Auth-Adapter):

```bash
export GGD=https://localhost:8000/api
export PAT=ggd_pat_…
curl -s -H "Authorization: Bearer $PAT" "$GGD/groups/me"                   > fixtures/groups-me.json
curl -s -H "Authorization: Bearer $PAT" "$GGD/planning/groups/1/overview"  > fixtures/overview-group1.json
```

Danach in `tests/*.test.ts` unter dem passenden Schlüssel eintragen. Die Dateien sind
**Testdaten** — keine echten Schüler:innendaten aufnehmen.
