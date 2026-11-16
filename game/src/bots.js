// The bots: four teammates and five opponents per round. Each bot is a
// small state machine — move to its objective along the waypoint graph,
// engage on line of sight, strafe and burst-fire, fall back when hurt,
// and play the bomb (the carrier plants, defenders defuse). Skill is
// seeded per bot so a capture replays the same behaviour.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { clamp, range, pick, angleDelta } from './util.js';

const BOT_SPEED = 4.2;
const BOT_ENGAGE_SPEED = 2.6;
const BOT_RADIUS = 0.34;
const BOT_HEIGHT = 1.72;
const SIGHT_RANGE = 42;
const NAMES_SABLE = ['JUNO', 'MARA', 'KITE', 'ORIN'];
const NAMES_VULTURE = ['HAVOC', 'DUSK', 'RASP', 'FANG', 'GRIM'];

function buildBody(scene, team) {
  const teamColor = team === 'sable' ? PALETTE.sable : PALETTE.vulture;
  const group = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor), roughness: 0.7, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.wallDark), roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.6 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), cloth);
  torso.position.y = 1.08;
  torso.userData.part = 'torso';
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), skin);
  head.position.y = 1.58;
  head.userData.part = 'head';
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.05), dark);
  visor.position.set(0, 1.6, -0.14);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.72, 0.2), dark);
  legL.position.set(-0.13, 0.36, 0);
  const legR = legL.clone();
  legR.position.x = 0.13;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.55), dark);
  gun.position.set(0.2, 1.18, -0.3);
  group.add(torso, head, visor, legL, legR, gun);
  scene.add(group);
  group.traverse((mesh) => {
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });

  // A small health bar that always faces the camera: the front bar is a
  // child of the back bar, so shrinking it from the left stays horizontal
  // on screen no matter where the camera is.
  const barBack = new THREE.Mesh(
    new THREE.PlaneGeometry(0.7, 0.09),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  const barFront = new THREE.Mesh(
    new THREE.PlaneGeometry(0.68, 0.06),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(teamColor), transparent: true, opacity: 0.95, depthWrite: false }),
  );
  barFront.position.z = 0.001;
  barBack.add(barFront);
  scene.add(barBack);
  return { group, torso, head, barBack, barFront };
}

export function createBots(scene, world, rng) {
  const bots = [];

  function makeBot(team, name, index) {
    const visuals = buildBody(scene, team);
    const bot = {
      team,
      name,
      index,
      weaponId: team === 'sable' ? (index % 2 === 0 ? 'rifle' : 'smg') : (index % 3 === 0 ? 'rifle' : index % 3 === 1 ? 'smg' : 'pistol'),
      hp: 100,
      armor: 0,
      alive: false,
      position: new THREE.Vector3(),
      yaw: 0,
      speed: BOT_SPEED,
      role: 'hold',
      site: 'A',
      path: [],
      pathIdx: 0,
      target: null,
      lastSeenAt: -99,
      lastSeenPos: new THREE.Vector3(),
      reactAt: 0,
      burstLeft: 0,
      nextShotAt: 0,
      strafeDir: 1,
      strafeUntil: 0,
      stuckTimer: 0,
      lastPos: new THREE.Vector3(),
      channel: null, // { kind: 'plant' | 'defuse', until }
      skill: {
        reaction: range(rng, 0.35, 0.65),
        accuracy: range(rng, 0.42, 0.6),
        burst: 3 + Math.floor(rng() * 3),
      },
      visuals,
    };
    visuals.torso.userData.bot = bot;
    visuals.head.userData.bot = bot;
    bots.push(bot);
    return bot;
  }

  for (let i = 0; i < 4; i += 1) makeBot('sable', NAMES_SABLE[i], i);
  for (let i = 0; i < 5; i += 1) makeBot('vulture', NAMES_VULTURE[i], i);

  const probe = new THREE.Box3();

  function pushOut(bot) {
    probe.min.set(bot.position.x - BOT_RADIUS, 0.04, bot.position.z - BOT_RADIUS);
    probe.max.set(bot.position.x + BOT_RADIUS, BOT_HEIGHT - 0.04, bot.position.z + BOT_RADIUS);
    for (const box of world.colliders) {
      if (!probe.intersectsBox(box)) continue;
      const dxMin = probe.max.x - box.min.x;
      const dxMax = box.max.x - probe.min.x;
      const dzMin = probe.max.z - box.min.z;
      const dzMax = box.max.z - probe.min.z;
      const push = Math.min(dxMin, dxMax, dzMin, dzMax);
      if (push === dxMin) bot.position.x = box.min.x - BOT_RADIUS - 0.01;
      else if (push === dxMax) bot.position.x = box.max.x + BOT_RADIUS + 0.01;
      else if (push === dzMin) bot.position.z = box.min.z - BOT_RADIUS - 0.01;
      else bot.position.z = box.max.z + BOT_RADIUS + 0.01;
      probe.min.set(bot.position.x - BOT_RADIUS, 0.04, bot.position.z - BOT_RADIUS);
      probe.max.set(bot.position.x + BOT_RADIUS, BOT_HEIGHT - 0.04, bot.position.z + BOT_RADIUS);
    }
  }

  function spawnRound(assignments) {
    // assignments: [{ bot, site, role, spawn:{x,z}, yaw }]
    for (const assignment of assignments) {
      const bot = assignment.bot;
      bot.alive = true;
      bot.hp = 100;
      bot.armor = assignment.armor ? 50 : 0;
      bot.position.set(assignment.spawn.x, 0, assignment.spawn.z);
      bot.yaw = assignment.yaw;
      bot.role = assignment.role;
      bot.site = assignment.site;
      bot.path = [];
      bot.pathIdx = 0;
      bot.target = null;
      bot.channel = null;
      bot.lastSeenAt = -99;
      bot.burstLeft = 0;
      bot.nextShotAt = 0;
      bot.stuckTimer = 0;
      bot.lastPos.copy(bot.position);
      bot.visuals.group.visible = true;
      bot.visuals.group.rotation.set(0, 0, 0);
      bot.visuals.group.position.copy(bot.position);
      bot.visuals.barFront.scale.x = 1;
      bot.visuals.barFront.visible = true;
      bot.visuals.barBack.visible = true;
    }
  }

  function kill(bot) {
    bot.alive = false;
    bot.channel = null;
    bot.visuals.group.rotation.x = -Math.PI / 2 + 0.08;
    bot.visuals.group.position.y = 0.25;
    bot.visuals.barFront.visible = false;
    bot.visuals.barBack.visible = false;
  }

  function step(dt, ctx) {
    for (const bot of bots) {
      if (!bot.alive) continue;
      const eye = new THREE.Vector3(bot.position.x, 1.55, bot.position.z);

      // --- target acquisition: nearest visible opponent ---
      let best = null;
      let bestDist = Infinity;
      for (const foe of ctx.opponentsOf(bot)) {
        if (!foe.alive) continue;
        const dx = foe.position.x - bot.position.x;
        const dz = foe.position.z - bot.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist > SIGHT_RANGE) continue;
        const foeEye = new THREE.Vector3(foe.position.x, foe.position.y + foe.eye, foe.position.z);
        if (!ctx.hasLOS(eye, foeEye)) continue;
        if (dist < bestDist) {
          bestDist = dist;
          best = { foe, dist };
        }
      }
      if (best) {
        bot.target = best.foe;
        bot.lastSeenAt = ctx.time;
        bot.lastSeenPos.set(best.foe.position.x, 0, best.foe.position.z);
        if (bot.reactAt === 0) bot.reactAt = ctx.time + bot.skill.reaction;
      } else if (ctx.time - bot.lastSeenAt > 2.5) {
        bot.target = null;
        bot.reactAt = 0;
      }

      // --- bomb duties override movement ---
      let moveTarget = null;
      let moveSpeed = BOT_SPEED;
      if (bot.channel) {
        // Channeling: stand still. Completion is checked by main.js.
        moveTarget = null;
      } else if (bot.target && ctx.time >= bot.reactAt) {
        // Engage: face the target, strafe, fire bursts.
        const targetPos = bot.target.position;
        const desiredYaw = Math.atan2(-(targetPos.x - bot.position.x), -(targetPos.z - bot.position.z));
        bot.yaw += angleDelta(bot.yaw, desiredYaw) * Math.min(1, dt * 10);
        if (ctx.time > bot.strafeUntil) {
          bot.strafeDir = rng() < 0.5 ? -1 : 1;
          bot.strafeUntil = ctx.time + range(rng, 0.6, 1.4);
        }
        const sin = Math.sin(bot.yaw);
        const cos = Math.cos(bot.yaw);
        bot.position.x += cos * bot.strafeDir * BOT_ENGAGE_SPEED * dt;
        bot.position.z += -sin * bot.strafeDir * BOT_ENGAGE_SPEED * dt;
        pushOut(bot);
        if (bot.burstLeft === 0 && ctx.time >= bot.nextShotAt) {
          bot.burstLeft = bot.skill.burst;
        }
        if (bot.burstLeft > 0 && ctx.time >= bot.nextShotAt) {
          ctx.fireShot(bot, bot.target);
          bot.burstLeft -= 1;
          bot.nextShotAt = ctx.time + (bot.burstLeft > 0 ? 0.11 : range(rng, 0.55, 1.0));
        }
        // Fall back when badly hurt.
        if (bot.hp < 30 && bot.role !== 'retreat') {
          bot.role = 'retreat';
          bot.path = world.findPath(bot.position.x, bot.position.z, bot.team === 'sable' ? world.spawnAttack.x : world.spawnDefend.x, bot.team === 'sable' ? world.spawnAttack.z : world.spawnDefend.z);
          bot.pathIdx = 0;
        }
      } else {
        // No target: follow the plan.
        if (bot.role === 'retreat' && bot.hp >= 55) bot.role = 'hold';
        const objective = ctx.objectiveFor(bot);
        if (objective) {
          if (bot.path.length === 0 || bot.pathIdx >= bot.path.length) {
            bot.path = world.findPath(bot.position.x, bot.position.z, objective.x, objective.z);
            bot.pathIdx = 0;
          }
          const node = bot.path[bot.pathIdx];
          if (node) {
            const dx = node[0] - bot.position.x;
            const dz = node[1] - bot.position.z;
            const dist = Math.hypot(dx, dz);
            if (dist < 0.6) {
              bot.pathIdx += 1;
            } else {
              const desiredYaw = Math.atan2(-dx, -dz);
              bot.yaw += angleDelta(bot.yaw, desiredYaw) * Math.min(1, dt * 6);
              bot.position.x += (dx / dist) * moveSpeed * dt;
              bot.position.z += (dz / dist) * moveSpeed * dt;
              pushOut(bot);
            }
          }
          // Stuck detection: repath if barely moving.
          if (bot.lastPos.distanceToSquared(bot.position) < 0.0004) {
            bot.stuckTimer += dt;
            if (bot.stuckTimer > 1.5) {
              bot.path = world.findPath(bot.position.x, bot.position.z, objective.x, objective.z);
              bot.pathIdx = 0;
              bot.stuckTimer = 0;
            }
          } else {
            bot.stuckTimer = 0;
          }
          bot.lastPos.copy(bot.position);
        }
        // Carrier plants when it reaches its site and the coast is clear.
        if (bot.role === 'carrier' && bot.pathIdx >= bot.path.length) {
          const site = world.sites[bot.site];
          const d = Math.hypot(site.x - bot.position.x, site.z - bot.position.z);
          if (d < site.radius && ctx.bomb.state === 'idle' && !bot.target) {
            bot.channel = { kind: 'plant', until: ctx.time + 3 };
            ctx.onChannelStart(bot, 'plant');
          }
        }
        // Defenders defuse when the bomb is planted and they reach it.
        if (bot.team === 'vulture' && ctx.bomb.state === 'planted') {
          const d = Math.hypot(ctx.bomb.x - bot.position.x, ctx.bomb.z - bot.position.z);
          if (d < 2.2 && !bot.target) {
            bot.channel = { kind: 'defuse', until: ctx.time + 5 };
            ctx.onChannelStart(bot, 'defuse');
          }
        }
      }

      // Channel completion / interruption.
      if (bot.channel) {
        if (bot.target || !bot.alive) {
          ctx.onChannelCancel(bot, bot.channel.kind);
          bot.channel = null;
        } else if (ctx.time >= bot.channel.until) {
          ctx.onChannelDone(bot, bot.channel.kind);
          bot.channel = null;
        }
      }

      // Sync visuals.
      const group = bot.visuals.group;
      group.position.set(bot.position.x, bot.position.y || 0, bot.position.z);
      group.rotation.y = bot.yaw;
      const hpFrac = clamp(bot.hp / 100, 0, 1);
      bot.visuals.barBack.position.set(bot.position.x, 1.95, bot.position.z);
      bot.visuals.barBack.lookAt(ctx.camera.position);
      bot.visuals.barFront.scale.x = Math.max(0.02, hpFrac);
      bot.visuals.barFront.position.x = -0.34 * (1 - hpFrac);
    }
  }

  return {
    bots,
    spawnRound,
    kill,
    step,
    aliveCount(team) {
      return bots.filter((bot) => bot.team === team && bot.alive).length;
    },
    hitMeshes() {
      const meshes = [];
      for (const bot of bots) {
        meshes.push(bot.visuals.torso, bot.visuals.head);
      }
      return meshes;
    },
    reset() {
      for (const bot of bots) {
        bot.alive = false;
        bot.visuals.group.visible = false;
        bot.visuals.barBack.visible = false;
      }
    },
  };
}
