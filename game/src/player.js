// Player movement: acceleration, friction, gravity, crouch and jump,
// resolved as a box against the world's colliders one axis at a time so
// a wall never swallows the player. The player is a capsule of air: the
// collision probe lifts its feet and crown out of the horizontal tests,
// so standing on the floor never reads as walking into a wall.
import * as THREE from 'three';

const RADIUS = 0.34;
const HEIGHT_STAND = 1.72;
const HEIGHT_CROUCH = 1.12;
const EYE_STAND = 1.6;
const EYE_CROUCH = 1.02;
const SPEED_WALK = 5.2;
const SPEED_CROUCH = 2.4;
const ACCEL_GROUND = 42;
const ACCEL_AIR = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP = 6.2;

export function createPlayer(colliders, spawn) {
  const body = {
    position: new THREE.Vector3(spawn.x, 0, spawn.z),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: EYE_STAND,
    height: HEIGHT_STAND,
    onGround: true,
    crouching: false,
    hp: 100,
    armor: 0,
  };
  const probe = new THREE.Box3();
  const wish = new THREE.Vector3();

  function hitsBox(x, y, z, height, lift) {
    probe.min.set(x - RADIUS, y + lift, z - RADIUS);
    probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
    for (const box of colliders) {
      if (probe.intersectsBox(box)) return box;
    }
    return null;
  }

  function look(dx, dy, sensitivity = 0.0022) {
    body.yaw -= dx * sensitivity;
    body.pitch = Math.max(-1.45, Math.min(1.45, body.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    body.pitch = Math.min(1.45, body.pitch + pitchKick);
    body.yaw += yawKick;
  }

  function step(dt, keys) {
    const wantCrouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (wantCrouch && !body.crouching) {
      body.crouching = true;
      body.height = HEIGHT_CROUCH;
    } else if (!wantCrouch && body.crouching && !hitsBox(body.position.x, body.position.y, body.position.z, HEIGHT_STAND, 0.02)) {
      body.crouching = false;
      body.height = HEIGHT_STAND;
    }
    const eyeGoal = body.crouching ? EYE_CROUCH : EYE_STAND;
    body.eye += (eyeGoal - body.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(body.yaw);
      const cos = Math.cos(body.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }

    const speed = body.crouching ? SPEED_CROUCH : SPEED_WALK;
    const blend = Math.min(1, ((body.onGround ? ACCEL_GROUND : ACCEL_AIR) * dt) / speed);
    body.velocity.x += (wish.x * speed - body.velocity.x) * blend;
    body.velocity.z += (wish.z * speed - body.velocity.z) * blend;
    if (body.onGround && wish.lengthSq() === 0) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      body.velocity.x *= damp;
      body.velocity.z *= damp;
    }

    if (keys.has('Space') && body.onGround) {
      body.velocity.y = JUMP;
      body.onGround = false;
    }
    body.velocity.y -= GRAVITY * dt;

    const nextX = body.position.x + body.velocity.x * dt;
    if (!hitsBox(nextX, body.position.y, body.position.z, body.height, 0.04)) body.position.x = nextX;
    else body.velocity.x = 0;
    const nextZ = body.position.z + body.velocity.z * dt;
    if (!hitsBox(body.position.x, body.position.y, nextZ, body.height, 0.04)) body.position.z = nextZ;
    else body.velocity.z = 0;

    body.position.y += body.velocity.y * dt;
    body.onGround = false;
    const floor = hitsBox(body.position.x, body.position.y, body.position.z, body.height, 0);
    if (floor && body.velocity.y <= 0) {
      body.position.y = floor.max.y;
      body.velocity.y = 0;
      body.onGround = true;
    } else if (floor) {
      body.position.y = floor.min.y - body.height;
      body.velocity.y = 0;
    }
    if (body.position.y < 0) {
      body.position.y = 0;
      body.velocity.y = 0;
      body.onGround = true;
    }
    body.velocity.y = Math.max(-30, body.velocity.y);
  }

  function respawn(spawnPoint, yaw) {
    body.position.set(spawnPoint.x, 0, spawnPoint.z);
    body.velocity.set(0, 0, 0);
    body.yaw = yaw;
    body.pitch = 0;
    body.hp = 100;
    body.armor = 0;
    body.crouching = false;
    body.height = HEIGHT_STAND;
    body.eye = EYE_STAND;
  }

  return {
    state: body,
    step,
    look,
    recoil,
    respawn,
    groundSpeed() {
      return Math.hypot(body.velocity.x, body.velocity.z);
    },
  };
}
