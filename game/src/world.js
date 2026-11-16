// The map: FOUNDRY, a 40 x 30 m industrial yard with two bomb sites.
// Attackers spawn south, defenders north; A sits west, B sits east, and
// three lanes (A-long, mid, B-long) join them. All geometry is boxes:
// every box is a collider for movement and a surface bullets stop on.
// A waypoint graph rides on top so bots can path between lanes.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Waypoint nodes: [x, z]. Indices are referenced by the bot AI.
const NODES = [
  [0, 12.5], // 0 attacker spawn
  [0, 7], // 1 mid south
  [0, 0], // 2 mid
  [0, -7], // 3 mid north
  [0, -12.5], // 4 defender spawn
  [-14, -12], // 5 A-long west
  [-13, -8], // 6 A entry
  [-16.5, -8], // 7 site A
  [14, 12], // 8 B-long east
  [13, 8], // 9 B entry
  [16.5, 8], // 10 site B
  [-8, -6], // 11 A mid
  [8, 6], // 12 B mid
  [-10, 2], // 13 west mid
  [10, -2], // 14 east mid
  [-17, -11], // 15 A corner
  [17, 11], // 16 B corner
  [-7, 0], // 17 mid west crate
  [7, 0], // 18 mid east crate
  [-8, 11], // 19 attacker west
  [8, 11], // 20 attacker east
  [-8, -11], // 21 defender west
  [8, -11], // 22 defender east
  [-8, -12], // 23 A-long mid
  [8, 12], // 24 B-long mid
];

const EDGES = [
  [0, 1], [0, 19], [0, 20], [1, 2], [1, 19], [1, 20], [1, 13], [1, 12],
  [2, 3], [2, 17], [2, 18], [2, 13], [2, 14],
  [3, 4], [3, 21], [3, 22], [3, 11], [3, 23], [3, 14],
  [11, 5], [11, 13], [5, 23], [5, 6], [6, 7], [6, 15], [7, 15],
  [13, 17], [13, 19], [14, 18], [14, 20], [14, 12],
  [12, 9], [9, 10], [9, 16], [10, 16], [8, 9], [8, 20], [8, 24],
  [24, 12], [19, 13], [20, 14], [21, 23], [22, 3], [17, 11], [18, 12],
];

function letterTexture(letter, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  ctx.strokeStyle = color;
  ctx.lineWidth = 10;
  ctx.strokeRect(14, 14, 228, 228);
  ctx.fillStyle = color;
  ctx.font = 'bold 150px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 128, 138);
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  return texture;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.03,
    });
  }

  const colliders = [];
  const shootables = [];
  // Flat wall footprints for the minimap: [x, z, w, d].
  const footprints = [];

  function box(w, h, d, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    footprints.push([x, z, w, d]);
    return mesh;
  }

  // Floor and outer walls (5 m high, open sky so the key light reaches in).
  box(40.8, 0.4, 30.8, 0, -0.2, 0, 'ground');
  box(0.4, 5, 30.8, -20.2, 2.5, 0, 'wall');
  box(0.4, 5, 30.8, 20.2, 2.5, 0, 'wall');
  box(40.8, 5, 0.4, 0, 2.5, -15.2, 'wall');
  box(40.8, 5, 0.4, 0, 2.5, 15.2, 'wall');

  // Interior walls: they carve the three lanes.
  box(0.4, 3.4, 9, -10, 1.7, -10.5, 'wallDark'); // A-long divider
  box(0.4, 3.4, 9, 10, 1.7, 10.5, 'wallDark'); // B-long divider
  box(6, 3.4, 0.4, -14, 1.7, -3, 'wallDark'); // A site south lip
  box(6, 3.4, 0.4, 14, 1.7, 3, 'wallDark'); // B site north lip
  box(0.4, 3.4, 6, -4, 1.7, -9, 'wallDark'); // mid north block
  box(0.4, 3.4, 6, 4, 1.7, 9, 'wallDark'); // mid south block

  // Containers and crates: cover that breaks sight lines.
  box(3.2, 2.4, 1.6, -4.5, 1.2, 0, 'containerRust');
  box(3.2, 2.4, 1.6, 4.5, 1.2, 0, 'containerTeal');
  box(1.2, 1.1, 1.2, -6, 0.55, -6.2, 'crate');
  box(1.2, 1.1, 1.2, 6, 0.55, 6.2, 'crate');
  box(1.2, 1.1, 1.2, -14, 0.55, -10.4, 'crate');
  box(1.2, 1.1, 1.2, 14, 0.55, 10.4, 'crate');
  box(1.6, 0.7, 1.6, -16, 0.35, -4.5, 'crate');
  box(1.6, 0.7, 1.6, 16, 0.35, 4.5, 'crate');
  box(2.4, 0.9, 1.2, -2.5, 0.45, 11.5, 'crate');
  box(2.4, 0.9, 1.2, 2.5, 0.45, -10.2, 'crate');
  box(1.2, 1.1, 1.2, -11, 0.55, 6.5, 'crate');
  box(1.2, 1.1, 1.2, 11, 0.55, -6.5, 'crate');

  // Bomb sites: lettered floor plates, slightly emissive so they read at a glance.
  function sitePlate(letter, x, z) {
    const mat = new THREE.MeshBasicMaterial({
      map: letterTexture(letter, PALETTE.hazard),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), mat);
    plate.rotation.x = -Math.PI / 2;
    plate.position.set(x, 0.03, z);
    group.add(plate);
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(7.6, 7.6),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.hazard), transparent: true, opacity: 0.07, depthWrite: false }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(x, 0.02, z);
    group.add(glow);
  }
  sitePlate('A', -16.5, -8);
  sitePlate('B', 16.5, 8);

  // Light: a warm key from the south-east, a cool fill from the north-west, sky gradient.
  const sky = new THREE.HemisphereLight(new THREE.Color(PALETTE.wall), new THREE.Color(PALETTE.sky), 1.7);
  scene.add(sky);
  const key = new THREE.DirectionalLight(new THREE.Color(PALETTE.ink), 2.9);
  key.position.set(12, 16, 10);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -24;
  key.shadow.camera.right = 24;
  key.shadow.camera.top = 20;
  key.shadow.camera.bottom = -20;
  key.shadow.camera.far = 60;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.muted), 0.8);
  fill.position.set(-10, 10, -12);
  scene.add(fill);

  // Waypoint adjacency for BFS pathing.
  const adjacency = NODES.map(() => []);
  for (const [a, b] of EDGES) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }

  function nearestNode(x, z) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < NODES.length; i += 1) {
      const dx = NODES[i][0] - x;
      const dz = NODES[i][1] - z;
      const d = dx * dx + dz * dz;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  function findPath(fromX, fromZ, toX, toZ) {
    const start = nearestNode(fromX, fromZ);
    const goal = nearestNode(toX, toZ);
    if (start === goal) return [[toX, toZ]];
    const prev = new Array(NODES.length).fill(-1);
    const queue = [start];
    prev[start] = start;
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === goal) break;
      for (const next of adjacency[current]) {
        if (prev[next] === -1) {
          prev[next] = current;
          queue.push(next);
        }
      }
    }
    if (prev[goal] === -1) return [[toX, toZ]];
    const path = [];
    let node = goal;
    while (node !== start) {
      path.unshift(NODES[node]);
      node = prev[node];
    }
    path.push([toX, toZ]);
    return path;
  }

  return {
    colliders,
    shootables,
    group,
    footprints,
    nodes: NODES,
    sites: {
      A: { x: -16.5, z: -8, radius: 4.2, letter: 'A' },
      B: { x: 16.5, z: 8, radius: 4.2, letter: 'B' },
    },
    spawnAttack: { x: 0, z: 12.5 },
    spawnDefend: { x: 0, z: -12.5 },
    bounds: { minX: -19.4, maxX: 19.4, minZ: -14.4, maxZ: 14.4 },
    findPath,
    nearestNode,
  };
}
