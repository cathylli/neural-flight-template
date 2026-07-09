const PROTOCOL = "neural-flight.v1";
const STATION_ID = "station-a";
const RUNTIME_PATH = "/ws/runtime";
const HEARTBEAT_MS = 4_000;

export type HandshakeOptions = Readonly<{
	hostOrigin: string;
	clientId: string;
	experienceId: string;
	title: string;
	clientUrl: string;
	onRejected?: (reason: string) => void;
}>;

type Runtime = {
	options: HandshakeOptions;
	socket: WebSocket;
	heartbeatId?: ReturnType<typeof setInterval>;
};

type RuntimeResult =
	| { type: "registered"; clientId: string }
	| { type: "rejected"; reason: string };

function createWebSocketUrl(hostOrigin: string): string {
	const url = new URL(
		hostOrigin.includes("://") ? hostOrigin : `https://${hostOrigin}`,
	);
	url.protocol =
		url.protocol === "http:" || url.protocol === "ws:" ? "ws:" : "wss:";
	url.pathname = RUNTIME_PATH;
	url.port ||= "5183";
	return url.toString();
}

function createHello(options: HandshakeOptions): object {
	return {
		protocol: PROTOCOL,
		type: "client.hello",
		stationId: STATION_ID,
		source: { role: "experience", id: options.clientId },
		timestamp: Date.now(),
		payload: {
			role: "experience",
			clientId: options.clientId,
			experienceId: options.experienceId,
			title: options.title,
			url: options.clientUrl,
			userAgent: navigator.userAgent,
		},
	};
}

function createHeartbeat(clientId: string): object {
	return {
		protocol: PROTOCOL,
		type: "client.heartbeat",
		stationId: STATION_ID,
		source: { role: "experience", id: clientId },
		timestamp: Date.now(),
		payload: { clientId },
	};
}

function sendJson(socket: WebSocket, message: object): void {
	if (socket.readyState !== WebSocket.OPEN) return;
	socket.send(JSON.stringify(message));
}

function parseJson(rawValue: string): unknown {
	try {
		return JSON.parse(rawValue) as unknown;
	} catch {
		return null;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRuntimeResult(rawValue: string): RuntimeResult | null {
	const message = parseJson(rawValue);
	if (
		!isRecord(message) ||
		message.protocol !== PROTOCOL ||
		message.stationId !== STATION_ID
	) {
		return null;
	}

	const payload = isRecord(message.payload) ? message.payload : {};
	if (
		message.type === "client.registered" &&
		typeof payload.clientId === "string"
	) {
		return { type: "registered", clientId: payload.clientId };
	}

	if (message.type !== "client.rejected") return null;

	return {
		type: "rejected",
		reason: String(payload.reason ?? "Handshake wurde abgelehnt"),
	};
}

function startHeartbeat(runtime: Runtime): void {
	clearInterval(runtime.heartbeatId);
	runtime.heartbeatId = setInterval(
		() => sendJson(runtime.socket, createHeartbeat(runtime.options.clientId)),
		HEARTBEAT_MS,
	);
}

function handleHostMessage(runtime: Runtime, rawValue: string): void {
	const result = readRuntimeResult(rawValue);
	if (result === null) return;

	if (
		result.type === "registered" &&
		result.clientId === runtime.options.clientId
	) {
		console.log("[icaros-handshake] Registered successfully");
		startHeartbeat(runtime);
		return;
	}

	if (result.type !== "rejected") return;

	console.error("[icaros-handshake] Client rejected:", result.reason);
	runtime.options.onRejected?.(result.reason);
	runtime.socket.close();
}

function attachEvents(runtime: Runtime): void {
	runtime.socket.addEventListener("open", () => {
		console.log("[icaros-handshake] WebSocket opened, sending client.hello", {
			url: runtime.socket.url,
			clientId: runtime.options.clientId,
			experienceId: runtime.options.experienceId,
			title: runtime.options.title,
			clientUrl: runtime.options.clientUrl,
		});
		sendJson(runtime.socket, createHello(runtime.options));
	});
	runtime.socket.addEventListener("message", (event: MessageEvent<string>) =>
		handleHostMessage(runtime, event.data),
	);
	runtime.socket.addEventListener("close", (event: CloseEvent) => {
		console.log("[icaros-handshake] WebSocket closed", {
			code: event.code,
			reason: event.reason,
			wasClean: event.wasClean,
		});
		clearInterval(runtime.heartbeatId);
	});
	runtime.socket.addEventListener("error", () => {
		console.error("[icaros-handshake] WebSocket error", {
			url: runtime.socket.url,
		});
	});
}

export function startHandshake(options: HandshakeOptions): () => void {
	const url = createWebSocketUrl(options.hostOrigin);
	console.log("[icaros-handshake] Connecting to", url);
	const socket = new WebSocket(url);
	const runtime: Runtime = { options, socket };
	attachEvents(runtime);
	return () => {
		console.log("[icaros-handshake] Stopping");
		clearInterval(runtime.heartbeatId);
		socket.close();
	};
}
