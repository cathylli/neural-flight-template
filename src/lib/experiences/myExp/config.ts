import * as THREE from 'three';

export const WORLD = {
	CHUNK_SIZE: 100,
	CHUNK_VIEW_DISTANCE: 3,
	CUBE_HEIGHT_VARIATION: 100,
	CUBE_BASE_Y: 0,
	TERRAIN_COLOR: 0x050510,
	GRID_COLOR: 0x27F5EB,
	GRID_SECONDARY_COLOR: 0x111133,
	GRID_DIVISIONS: 32
};

export const CUBE_TYPES = {
	ENDUSER: {
		id: 'enduser',
		size: 10,
		baseColor: new THREE.Color(0x00f3ff), // Electric Cyan
		emissiveColor: new THREE.Color(0x00f3ff),
		densityMultiplier: 1.0
	},
	SERVER: {
		id: 'server',
		size: 30,
		baseColor: new THREE.Color(0xdf95ff), // Lilac
		emissiveColor: new THREE.Color(0xdf95ff),
		densityMultiplier: 0.7
	},
	AI_DATA_CENTER: {
		id: 'ai_data_center',
		size: 50,
		baseColor: new THREE.Color(0xff0000), // Bright Fire Red
		emissiveColor: new THREE.Color(0xff0000),
		densityMultiplier: 0.3
	}
};

export const NOISE = {
	SCALE: 0.006, // Lower scale = larger clusters (islands)
	DENSITY_THRESHOLD: 0.5 // Higher threshold = more empty space between clusters
};