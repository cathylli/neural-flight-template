<!--
Datei: Host_Verbindung_Anleitung.md
Zweck: Erklaert die Verbindung eines eigenen Clients mit dem ICAROS Host.
Grenze: Beschreibt nur Handshake und Controller-Stream, keine Projektarchitektur.
-->

# Verbindung zum ICAROS Host

Diese Anleitung gehoert zu den zwei Beispielskripten in diesem Repository:

- `Handshake_Beispiel.ts`
- `Controller_Stream_Beispiel.ts`

Die beiden Skripte zeigen nur die Host-Kommunikation. Rendering, VR-Logik,
Szenen, Physik, UI und Asset-Loading gehoeren in dein eigenes Projekt.

```txt
M5 Controller -> ICAROS Host -> dein Client
```

Der Client verbindet sich niemals direkt mit dem M5 Controller. Der Host liest
die Rohdaten, normalisiert sie und sendet deinem Client einfache Werte wie
`pitch`, `roll` und `quality`.

## Die zwei Aufgaben des Clients

| Aufgabe | WebSocket | Beispielskript |
| --- | --- | --- |
| Launch-Handshake | `wss://<host>:5183/ws/runtime` | `Handshake_Beispiel.ts` |
| Controller-Daten lesen | `wss://<host>:5183/ws/control/main` | `Controller_Stream_Beispiel.ts` |

Die Host-Origin kommt aus der Host-WebUI:

```txt
https://<host-lan-ip-oder-name>:5183
```

Aus dieser HTTPS-Origin werden die WebSocket-URLs abgeleitet.

Zitat aus `Handshake_Beispiel.ts`:

```ts
const RUNTIME_PATH = '/ws/runtime';
const HEARTBEAT_MS = 4_000;
```

Zitat aus `Controller_Stream_Beispiel.ts`:

```ts
const CONTROL_PATH = '/ws/control/main';
```

## Handshake

Das Handshake-Skript verbindet sich mit `/ws/runtime`. Direkt nach dem Oeffnen
des WebSockets sendet der Client `client.hello`. Nach `client.registered`
sendet er regelmaessig `client.heartbeat`.

Zitat aus `Handshake_Beispiel.ts`:

```ts
function attachEvents(runtime: Runtime): void {
	runtime.socket.addEventListener('open', () => sendJson(runtime.socket, createHello(runtime.options)));
	runtime.socket.addEventListener('message', (event: MessageEvent<string>) =>
		handleHostMessage(runtime, event.data)
	);
	runtime.socket.addEventListener('close', () => window.clearInterval(runtime.heartbeatId));
}
```

Die Export-Funktion steht unten und setzt nur vorbereitete Einzelfunktionen
zusammen.

Zitat aus `Handshake_Beispiel.ts`:

```ts
export function startHandshake(options: HandshakeOptions): () => void {
	// Der Export setzt die oben definierten Einzelfunktionen zum Handshake zusammen.
	const socket = new WebSocket(createWebSocketUrl(options.hostOrigin));
	const runtime: Runtime = { options, socket };
	attachEvents(runtime);
	return () => {
		window.clearInterval(runtime.heartbeatId);
		socket.close();
	};
}
```

## `client.hello`

Der Client meldet sich mit diesen Kerndaten an:

| Feld | Bedeutung |
| --- | --- |
| `clientId` | Eindeutige ID dieser laufenden Browser- oder Client-Instanz. |
| `experienceId` | Stabile Projekt-ID, zum Beispiel `icaros-demo-flight`. |
| `title` | Anzeigename in der Host-Konsole. |
| `url` | HTTPS-Adresse, zu der `/launch` weiterleiten darf. |
| `userAgent` | Optionaler Hinweis auf Browser oder Umgebung. |

Die `url` muss eine echte HTTPS-URL sein. `http://`, leere URLs oder lokale
Adressen, die die VR-Brille nicht erreichen kann, werden vom Host abgelehnt.

Nach `client.hello` sind zwei Antworten relevant:

| Antwort | Bedeutung |
| --- | --- |
| `client.registered` | Registrierung ist gueltig, Heartbeats koennen starten. |
| `client.rejected` | Registrierung ist ungueltig, der Grund steht im Payload. |

Wenn keine Heartbeats mehr kommen, markiert der Host den Client als `stale`.
Ein stale Client ist kein gueltiges Launch-Ziel.

## Controller-Stream

Das Controller-Skript verbindet sich mit `/ws/control/main`. Es sendet selbst
keine Nachricht an den Host. Es liest nur `control.orientation`, validiert die
Nachricht und gibt die typisierten Werte an den Client weiter.

Zitat aus `Controller_Stream_Beispiel.ts`:

```ts
function handleControlMessage(
	rawValue: string,
	applyToClient: (orientation: ControlOrientation) => void
): void {
	const orientation = readOrientation(rawValue);
	if (orientation === null) {
		return;
	}

	// Ab hier sind die Host-Daten geprueft und fuer den Client sicher nutzbar.
	applyToClient(orientation);
}
```

## `control.orientation`

Der Host sendet normalisierte Controller-Daten:

```json
{
  "protocol": "neural-flight.v1",
  "type": "control.orientation",
  "stationId": "station-a",
  "source": { "role": "host", "id": "icaros-host" },
  "timestamp": 1760000000000,
  "payload": {
    "pitch": 0.12,
    "roll": -0.35,
    "quality": 1,
    "controllerType": "m5"
  }
}
```

| Feld | Bereich | Bedeutung |
| --- | --- | --- |
| `pitch` | `-1..1` | Neigung nach vorne oder hinten. |
| `roll` | `-1..1` | Neigung nach links oder rechts. |
| `quality` | `0..1` | Qualitaet des Controller-Signals. |
| `controllerType` | `m5` | Quelle der normalisierten Steuerung. |

`quality: 0` bedeutet: neutral weiterlaufen, nicht abstuerzen, keine M5-Rohdaten
suchen.

## Nicht in den Client einbauen

| Endpunkt oder Daten | Warum nicht? |
| --- | --- |
| `/ws/device` | Nur fuer den M5 Controller mit Pairing-Token. |
| `/api/m5-pairing` | Diagnose und Setup fuer Host, CLI und Konsole. |
| M5-Rohdaten | Werden nur im Host ausgewertet und vom Client nicht benoetigt. |
| `runtime.clients` | Fuer Operator-Konsole und Diagnose, nicht fuer normale Steuerung. |

## Merksatz

Der Host kennt nur zwei Dinge von deinem Client: Wo er per HTTPS erreichbar ist
und wie er normalisierte Controller-Daten empfaengt. Alles andere bleibt frei in
deinem Projekt.
