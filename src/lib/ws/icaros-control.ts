import type { ControlOrientation } from "./icaros-types";

const PROTOCOL = "neural-flight.v1";
const STATION_ID = "station-a";
const CONTROL_PATH = "/ws/control/main";

function createWebSocketUrl(hostOrigin: string): string {
	const url = new URL(
		hostOrigin.includes("://") ? hostOrigin : `https://${hostOrigin}`,
	);
	url.protocol =
		url.protocol === "http:" || url.protocol === "ws:" ? "ws:" : "wss:";
	url.pathname = CONTROL_PATH;
	url.port ||= "5183";
	return url.toString();
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

function isControlPayload(value: unknown): value is ControlOrientation {
	return (
		isRecord(value) &&
		typeof value.pitch === "number" &&
		typeof value.roll === "number" &&
		typeof value.quality === "number" &&
		value.controllerType === "m5"
	);
}

function readOrientation(rawValue: string): ControlOrientation | null {
	const message = parseJson(rawValue);
	if (
		!isRecord(message) ||
		message.protocol !== PROTOCOL ||
		message.stationId !== STATION_ID
	) {
		return null;
	}

	if (
		message.type !== "control.orientation" ||
		!isControlPayload(message.payload)
	) {
		return null;
	}

	return message.payload;
}

function handleControlMessage(
	rawValue: string,
	applyToClient: (orientation: ControlOrientation) => void,
): void {
	const orientation = readOrientation(rawValue);
	if (orientation === null) return;

	applyToClient(orientation);
}

function attachEvents(
	socket: WebSocket,
	applyToClient: (orientation: ControlOrientation) => void,
): void {
	socket.addEventListener("open", () => {
		console.log("[icaros-control] WebSocket opened", { url: socket.url });
	});
	socket.addEventListener("message", (event: MessageEvent<string>) =>
		handleControlMessage(event.data, applyToClient),
	);
	socket.addEventListener("close", (event: CloseEvent) => {
		console.log("[icaros-control] WebSocket closed", {
			code: event.code,
			reason: event.reason,
			wasClean: event.wasClean,
		});
	});
	socket.addEventListener("error", () => {
		console.error("[icaros-control] WebSocket error", { url: socket.url });
	});
}

export function startControllerStream(
	hostOrigin: string,
	applyToClient: (orientation: ControlOrientation) => void,
): () => void {
	const url = createWebSocketUrl(hostOrigin);
	console.log("[icaros-control] Connecting to", url);
	const socket = new WebSocket(url);
	attachEvents(socket, applyToClient);
	return () => {
		console.log("[icaros-control] Stopping");
		socket.close();
	};
}
