import * as THREE from 'three';

export const WORLD = {
	CHUNK_SIZE: 256,
	CHUNK_VIEW_DISTANCE: 2,
	CUBE_HEIGHT_VARIATION: 100,
	CUBE_BASE_Y: 0
};

export const CUBE_TYPES = {
	ENDUSER: {
		id: 'enduser',
		size: 5,
		baseColor: new THREE.Color(0xADD8E6), // Light Blue
		emissiveColor: new THREE.Color(0x00BFFF), // Deep Sky Blue
		densityMultiplier: 1.0
	},
	SERVER: {
		id: 'server',
		size: 15,
		baseColor: new THREE.Color(0xFFD700), // Gold
		emissiveColor: new THREE.Color(0xFFA500), // Orange
		densityMultiplier: 0.6
	},
	AI_DATA_CENTER: {
		id: 'ai_data_center',
		size: 40,
		baseColor: new THREE.Color(0xFF00FF), // Magenta
		emissiveColor: new THREE.Color(0xFF0000), // Red
		densityMultiplier: 0.2
	}
};

export const NETWORK = {
	NODE_DENSITY_PER_CHUNK: 0.005,
	LINE_COLOR: new THREE.Color(0x00FFFF), // Cyan
	LINE_EMISSIVE: new THREE.Color(0x00CED1), // Dark Turquoise
	MAX_LINE_LENGTH: WORLD.CHUNK_SIZE * 1.5,
	LINE_SEGMENTS: 10,
	TUNNEL_RADIUS: 5,
	TUNNEL_SEGMENTS: 8
};

export const NOISE = {
	SCALE: 0.02,
	DENSITY_THRESHOLD: 0.5
};