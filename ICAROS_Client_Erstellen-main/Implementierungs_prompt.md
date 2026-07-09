<!--
Datei: Implementierungs_prompt.md
Zweck: Liefert einen kompakten Prompt fuer LLMs, um die ICAROS Client-Systematik
in ein bestehendes Projekt zu integrieren.
Grenze: Der Prompt beschreibt nur Host-Verbindung, Handshake und Controller-Stream.
-->

# Prompt fuer LLMs: ICAROS Client-Systematik integrieren

Du bist ein pragmatischer Senior TypeScript Engineer. Integriere die ICAROS
Host-Kommunikation in ein bestehendes Browser-Projekt. Lies zuerst die
vorhandene Architektur des Projekts und verwende bestehende Module, Stores,
Services und Lifecycle-Funktionen, bevor du neue Abstraktionen erstellst.

## Ziel

Der Client soll sich mit dem ICAROS Host verbinden, als Launch-Ziel registrieren
und normalisierte Controller-Daten empfangen.

## Relevante Dateien als Vorlage

- `Handshake_Beispiel.ts`
- `Controller_Stream_Beispiel.ts`
- `Host_Verbindung_Anleitung.md`

## Muss umgesetzt werden

1. Host-Origin entgegennehmen, zum Beispiel `https://<host>:5183`.
2. Runtime-WebSocket oeffnen: `/ws/runtime`.
3. Direkt nach `open` eine `client.hello` Nachricht senden.
4. Nach `client.registered` alle 4 Sekunden `client.heartbeat` senden.
5. Bei `client.rejected` den Grund sichtbar machen und den Runtime-Socket schliessen.
6. Control-WebSocket oeffnen: `/ws/control/main`.
7. Nur `control.orientation` auswerten.
8. Externe WebSocket-Daten zuerst als `unknown` behandeln und validieren.
9. Nur validierte Werte `{ pitch, roll, quality, controllerType: 'm5' }` in den Client-State geben.
10. Cleanup-Funktionen bereitstellen, die Intervalle stoppen und WebSockets schliessen.

## Nicht bauen

- Keine direkte M5-Verbindung.
- Keine M5-Rohdaten auswerten.
- Kein Zugriff auf `/ws/device`.
- Kein Zugriff auf `/api/m5-pairing`.
- Kein eigenes Protokoll erfinden.
- Kein Reconnect, solange er nicht ausdruecklich verlangt wird.
- Keine neue globale Architektur, wenn bestehende Lifecycle-Funktionen reichen.

## Erwarteter Nachrichtenvertrag

`client.hello` braucht:

- `protocol: 'neural-flight.v1'`
- `type: 'client.hello'`
- `stationId: 'station-a'`
- `source: { role: 'experience', id: clientId }`
- `payload.role: 'experience'`
- `payload.clientId`
- `payload.experienceId`
- `payload.title`
- `payload.url`
- optional `payload.userAgent`

`client.heartbeat` braucht:

- `type: 'client.heartbeat'`
- `payload.clientId`

`control.orientation` liefert:

- `payload.pitch: number`
- `payload.roll: number`
- `payload.quality: number`
- `payload.controllerType: 'm5'`

## Code-Stil

Nutze kleine Funktionen mit klarer Verantwortung. Verwende Early Returns.
Halte Exportfunktionen klein: Sie sollen vorbereitete Einzelfunktionen nur
zusammensetzen. Keine Factory, kein Interface mit nur einer Implementierung,
keine Konfiguration fuer Werte, die sich nicht aendern.

## Ergebnis

Erzeuge oder aendere nur die Dateien, die fuer die Integration noetig sind.
Erklaere kurz, wo der Host-Origin gesetzt wird, wo die Controller-Daten in den
Client-State fliessen und wie Cleanup beim Verlassen der Seite funktioniert.
