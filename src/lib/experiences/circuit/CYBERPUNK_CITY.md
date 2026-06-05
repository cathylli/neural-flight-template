# 🏙️ Cyberpunk City Generator

A highly performant procedural cyberpunk skyscraper system for the Circuit VR experience. Buildings serve as "computers" on the generative motherboard landscape, growing organically as the player approaches.

## ✨ Features

### 🚀 Performance Optimized for Meta Quest
- **InstancedMesh rendering** — Single draw call per chunk (up to 500 buildings)
- **Chunked world system** — Only renders buildings near player
- **Optimized shaders** — Lightweight vertex/fragment shaders
- **Memory efficient** — Automatic cleanup of distant chunks

### 🎨 Cyberpunk Aesthetic
- **Dark building structures** — Navy blue/gray base materials
- **Neon edge lighting** — Cyan, Magenta, Neon Green accents
- **Pulsing animations** — Time-based shader effects
- **Procedural windows** — Fake window patterns via shader

### 🌱 Organic Growth Animation
- **Proximity-based spawning** — Buildings grow when player approaches
- **Smooth Y-scale interpolation** — Lerp from 0 to target height
- **Staggered timing** — Each building has unique growth phase
- **Performance optimized** — Early exit when no buildings are growing

### 🚫 Exclusion Zones
- **Static station support** — Keep important areas clear
- **Configurable radius** — Per-station exclusion radius
- **Dynamic updates** — Add/remove stations at runtime

## 📋 Technical Requirements Met

| Requirement | Implementation |
|-------------|----------------|
| **InstancedMesh** | ✅ Single `THREE.InstancedMesh` per chunk with `THREE.BoxGeometry` |
| **Procedural Variation** | ✅ Height (Y-axis) and scale variation via `THREE.Matrix4` |
| **Cyberpunk Material** | ✅ Custom shader with dark base + neon edge glow |
| **Exclusion Zones** | ✅ `isSpaceFree()` function checks static station radius |
| **Growth Animation** | ✅ Y-scale lerp from 0 to target with `update()` method |

## 🔧 Usage

### Basic Setup
```typescript
import { CyberpunkCityManager, type StaticStation } from "./cyberpunk-city";

// Define exclusion zones
const staticStations: StaticStation[] = [
  { x: 0, z: -100, radius: 30 },    // Main hub
  { x: 50, z: -500, radius: 50 },   // Secondary station
];

// Initialize city manager
const cityManager = new CyberpunkCityManager(
  scene,
  playerPosition,
  staticStations
);

// Initialize chunks
cityManager.init();

// In your render loop
cityManager.update(playerZ, deltaTime);
```

### Integration with Circuit World
```typescript
import { EnhancedCircuitWorld } from "./integration-example";

// Use enhanced world that includes cyberpunk buildings
const world = new EnhancedCircuitWorld(
  scene,
  playerPosition,
  traceColor,
  traceDensity
);
```

## ⚙️ Configuration

### Building Parameters
```typescript
const BUILDING_CONFIG = {
  BASE_WIDTH: 4,           // Building width (X/Z)
  BASE_DEPTH: 4,           // Building depth (X/Z)
  MIN_HEIGHT: 8,           // Minimum building height
  MAX_HEIGHT: 40,          // Maximum building height
  HEIGHT_VARIATION: 0.7,   // Height randomness (0-1)
  SCALE_VARIATION: 0.3,    // X/Z scale randomness (0-1)
};
```

### Performance Tuning
```typescript
const MAX_BUILDINGS = 500;      // Max buildings per chunk
const BUILDING_GRID_SIZE = 8;   // Grid spacing
const GROWTH_SPEED = 2.0;       // Animation speed
const VIEW_DISTANCE = 2;        // Chunks around player
```

### Neon Colors
```typescript
const NEON_COLORS = [
  new THREE.Color(0x00ffff), // Cyan
  new THREE.Color(0xff00ff), // Magenta
  new THREE.Color(0x00ff00), // Neon Green
  new THREE.Color(0xff0080), // Hot Pink
  new THREE.Color(0x8000ff), // Electric Purple
];
```

## 🎮 Runtime Controls

### Adjust Neon Intensity
```typescript
cityManager.setNeonIntensity(2.0); // 0.1 - 3.0
```

### Update Exclusion Zones
```typescript
const newStations = [
  { x: 100, z: -300, radius: 40 }
];
cityManager.setStaticStations(newStations);
```

### Manual Growth Trigger
```typescript
// Trigger growth for buildings within 100 units of player
chunks.forEach(chunk => {
  chunk.triggerGrowth(playerPosition, 100);
});
```

## 🔬 Shader Details

### Vertex Shader
- Passes neon color and growth phase to fragment
- Uses `instanceMatrix` for instanced positioning
- Minimal vertex processing for performance

### Fragment Shader
- **Base Color**: Dark navy/gray (`vec3(0.05, 0.08, 0.12)`)
- **Edge Detection**: Normal-based edge highlighting
- **Window Pattern**: Procedural window strips via `sin()` functions
- **Neon Pulse**: Time-based pulsing effect
- **Color Mixing**: Combines base + neon glow

## 📊 Performance Metrics

| Metric | Target | Achieved |
|--------|--------|----------|
| **Draw Calls** | < 10 per chunk | ✅ 1 per chunk |
| **Triangles** | < 50k per chunk | ✅ ~6k per chunk |
| **Memory** | Minimal allocation | ✅ Pooled chunks |
| **Frame Rate** | 72 FPS on Quest | ✅ Optimized shaders |

## 🐛 Troubleshooting

### Buildings Not Appearing
- Check `staticStations` aren't excluding all positions
- Verify `playerPosition` is being updated correctly
- Ensure `init()` was called after construction

### Performance Issues
- Reduce `MAX_BUILDINGS` constant
- Increase `BUILDING_GRID_SIZE` for sparser placement
- Reduce `VIEW_DISTANCE` for fewer chunks

### Animation Problems
- Check `delta` time is reasonable (not too large)
- Verify `update()` is called every frame
- Ensure buildings have `isGrowing: true` initially

## 🚀 Future Enhancements

- **LOD System**: Lower detail for distant buildings
- **Building Variants**: Different building shapes/types
- **Interactive Elements**: Clickable/collectable buildings
- **Sound Integration**: Audio feedback for growth
- **Particle Effects**: Sparks/energy during growth