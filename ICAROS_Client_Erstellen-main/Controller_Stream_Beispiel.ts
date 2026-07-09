/**
 * Beispielskript fuer den ICAROS Controller-Stream.
 * Zweck: Controller-Daten vom Host lesen und typisiert an den Client weitergeben.
 * Grenze: Keine Kalibrierung, kein Reconnect, keine VR- oder Rendering-Logik.
 */

// --- Protokollwerte: Diese Werte muessen zum Host passen. -------------------
const PROTOCOL = 'neural-flight.v1';
const STATION_ID = 'station-a';
const CONTROL_PATH = '/ws/control/main';

export type ControlOrientation = Readonly<{
	pitch: number;
	roll: number;
	quality: number;
	controllerType: 'm5';
}>;

// --- WebSocket und JSON: Browser-APIs reichen hier aus. ---------------------
function createWebSocketUrl(hostOrigin: string): string {
	const url = new URL(hostOrigin.includes('://') ? hostOrigin : `https://${hostOrigin}`);
	url.protocol = url.protocol === 'http:' || url.protocol === 'ws:' ? 'ws:' : 'wss:';
	url.pathname = CONTROL_PATH;
	url.port ||= '5183';
	return url.toString();
}

function parseJson(rawValue: string): unknown {
	try {
		return JSON.parse(rawValue) as unknown;
	} catch {
		return null;
	}
}

// --- Pruefung: Externe Daten bleiben unknown, bis sie geprueft sind. --------
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isControlPayload(value: unknown): value is ControlOrientation {
	return (
		isRecord(value) &&
		typeof value.pitch === 'number' &&
		typeof value.roll === 'number' &&
		typeof value.quality === 'number' &&
		value.controllerType === 'm5'
	);
}

function readOrientation(rawValue: string): ControlOrientation | null {
	const message = parseJson(rawValue);
	if (!isRecord(message) || message.protocol !== PROTOCOL || message.stationId !== STATION_ID) {
		return null;
	}

	if (message.type !== 'control.orientation' || !isControlPayload(message.payload)) {
		return null;
	}

	return message.payload;
}

// --- Ablauf: Jede Funktion erledigt genau einen kleinen Schritt. ------------
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

function attachEvents(
	socket: WebSocket,
	applyToClient: (orientation: ControlOrientation) => void
): void {
	socket.addEventListener('message', (event: MessageEvent<string>) =>
		handleControlMessage(event.data, applyToClient)
	);
}

// --- Export: Diese Funktion darf von anderen Dateien importiert werden. -----
export function startControllerStream(
	hostOrigin: string,
	applyToClient: (orientation: ControlOrientation) => void
): () => void {
	// Der Export setzt die oben definierten Einzelfunktionen zum Controller-Stream zusammen.
	const socket = new WebSocket(createWebSocketUrl(hostOrigin));
	attachEvents(socket, applyToClient);
	return () => socket.close();
}
