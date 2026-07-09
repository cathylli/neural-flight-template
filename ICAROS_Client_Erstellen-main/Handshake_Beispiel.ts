/**
 * Beispielskript fuer den ICAROS Handshake.
 * Zweck: Ein Client meldet sich beim Host an und sendet danach Heartbeats.
 * Grenze: Kein Reconnect, keine Host-Suche, keine VR- oder Rendering-Logik.
 */

// --- Protokollwerte: Diese Werte muessen zum Host passen. -------------------
const PROTOCOL = 'neural-flight.v1';
const STATION_ID = 'station-a';
const RUNTIME_PATH = '/ws/runtime';
const HEARTBEAT_MS = 4_000;

export type HandshakeOptions = Readonly<{
	hostOrigin: string;
	clientId: string;
	experienceId: string;
	title: string;
	clientUrl: string;
	onRegistered?: () => void;
	onRejected?: (reason: string) => void;
}>;

type Runtime = { options: HandshakeOptions; socket: WebSocket; heartbeatId?: number };
type RuntimeResult = { type: 'registered'; clientId: string } | { type: 'rejected'; reason: string };

// --- Nachrichten: Hier entstehen die JSON-Objekte fuer den Host. ------------
function createHello(options: HandshakeOptions): object {
	return {
		protocol: PROTOCOL,
		type: 'client.hello',
		stationId: STATION_ID,
		source: { role: 'experience', id: options.clientId },
		timestamp: Date.now(),
		payload: {
			role: 'experience',
			clientId: options.clientId,
			experienceId: options.experienceId,
			title: options.title,
			url: options.clientUrl,
			userAgent: navigator.userAgent
		}
	};
}

function createHeartbeat(clientId: string): object {
	return {
		protocol: PROTOCOL,
		type: 'client.heartbeat',
		stationId: STATION_ID,
		source: { role: 'experience', id: clientId },
		timestamp: Date.now(),
		payload: { clientId }
	};
}

// --- WebSocket und JSON: Browser-APIs reichen hier aus. ---------------------
function createWebSocketUrl(hostOrigin: string): string {
	const url = new URL(hostOrigin.includes('://') ? hostOrigin : `https://${hostOrigin}`);
	url.protocol = url.protocol === 'http:' || url.protocol === 'ws:' ? 'ws:' : 'wss:';
	url.pathname = RUNTIME_PATH;
	url.port ||= '5183';
	return url.toString();
}

function sendJson(socket: WebSocket, message: object): void {
	if (socket.readyState !== WebSocket.OPEN) {
		return;
	}

	socket.send(JSON.stringify(message));
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

function readRuntimeResult(rawValue: string): RuntimeResult | null {
	const message = parseJson(rawValue);
	if (!isRecord(message) || message.protocol !== PROTOCOL || message.stationId !== STATION_ID) {
		return null;
	}

	const payload = isRecord(message.payload) ? message.payload : {};
	if (message.type === 'client.registered' && typeof payload.clientId === 'string') {
		return { type: 'registered', clientId: payload.clientId };
	}

	if (message.type !== 'client.rejected') {
		return null;
	}

	return { type: 'rejected', reason: String(payload.reason ?? 'Handshake wurde abgelehnt') };
}

// --- Ablauf: Jede Funktion erledigt genau einen kleinen Schritt. ------------
function startHeartbeat(runtime: Runtime): void {
	window.clearInterval(runtime.heartbeatId);
	runtime.heartbeatId = window.setInterval(
		() => sendJson(runtime.socket, createHeartbeat(runtime.options.clientId)),
		HEARTBEAT_MS
	);
}

function handleHostMessage(runtime: Runtime, rawValue: string): void {
	const result = readRuntimeResult(rawValue);
	if (result === null) {
		return;
	}

	if (result.type === 'registered' && result.clientId === runtime.options.clientId) {
		runtime.options.onRegistered?.();
		startHeartbeat(runtime);
		return;
	}

	if (result.type !== 'rejected') {
		return;
	}

	runtime.options.onRejected?.(result.reason);
	runtime.socket.close();
}

function attachEvents(runtime: Runtime): void {
	runtime.socket.addEventListener('open', () => sendJson(runtime.socket, createHello(runtime.options)));
	runtime.socket.addEventListener('message', (event: MessageEvent<string>) =>
		handleHostMessage(runtime, event.data)
	);
	runtime.socket.addEventListener('close', () => window.clearInterval(runtime.heartbeatId));
}

// --- Export: Diese Funktion darf von anderen Dateien importiert werden. -----
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
