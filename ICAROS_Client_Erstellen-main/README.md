<!--
Datei: README.md
Zweck: Gibt einen schnellen Ueberblick ueber die Inhalte dieses Repositories.
Grenze: Keine vollstaendige ICAROS-Dokumentation, sondern Einstiegspunkt.
-->

# ICAROS Client erstellen 🚀

Dieses Repository zeigt Euch wie ihr einen Client mit dem ICAROS Host zu verbindet.

## Was ist drin? 📦

- 🤝 `Handshake_Beispiel.ts` - Beispielskript fuer Anmeldung beim Host und Heartbeats.
- 🎮 `Controller_Stream_Beispiel.ts` - Beispielskript fuer Controller-Daten per WebSocket.
- 📘 `Host_Verbindung_Anleitung.md` - Anleitung zu Endpunkten, Nachrichten und typischen Fehlern.
- 🧠 `Implementierungs_prompt.md` - Prompt fuer LLMs, um die Systematik in ein bestehendes Projekt zu integrieren.

## Was ist nicht drin? ✂️

Keine VR-Logik, kein Rendering, keine Szenen, keine Physik und keine Framework-Vorgabe.
Der Host-Teil soll klein bleiben: Handshake, Heartbeat, Controller-Stream.

## Startpunkt 🧭

Lies zuerst `Host_Verbindung_Anleitung.md`. Danach kannst du die zwei TypeScript-Dateien
in dein Projekt uebernehmen oder als Vorlage fuer deine eigene Struktur nutzen.
