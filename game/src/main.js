// SABLE LINE — boot, the one loop, and the match state machine.
// A 5v5 round-based tactical FPS: attackers (SABLE, the player's team)
// plant the bomb at A or B, defenders (VULTURE) stop them. Rounds end on
// elimination, the clock, a detonation or a defuse; first to 5 takes it.
// ?shot=start|play|buy|end with &seed=N sets up a deterministic frame
// for a capture, renders it twice, then freezes it and sets
// window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32, clamp, range, pick, formatMoney } from './util.js';
import { createWorld } from './world.js';
import { createPlayer } from './player.js';
import { createInput } from './input.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createBots } from './bots.js';
import { WEAPONS, WEAPON_ORDER, createViewModel, createWeaponState } from './weapons.js';

const FIXED_STEP = 1 / 60;
const ROUND_TIME = 100;
const FREEZE_TIME = 8;
const BOMB_TIMER = 40;
const WIN_ROUNDS = 5;
const MAX_ROUNDS = 9;
const PLANT_TIME = 3;
const KILL_REWARD = 300;
const WIN_REWARD = 3250;
const LOSS_REWARD = 1900;
const PLANT_REWARD = 300;
const ARMOR_PRICE = 650;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const rng = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.sky), 26, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const hud = createHud();
const audio = createAudio();
const bots = createBots(scene, world, rng);
const player = createPlayer(world.colliders, world.spawnAttack);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 140;

const shootables = world.shootables.concat(bots.hitMeshes());

// ---- match state -------------------------------------------------------
const match = {
  phase: 'menu', // menu | freeze | live | roundEnd | matchEnd
  round: 1,
  scoreSable: 0,
  scoreVulture: 0,
  timer: FREEZE_TIME,
  money: 800,
  kills: 0,
  deaths: 0,
  owned: new Set(['pistol']),
  primaryId: 'pistol',
  armor: false,
  plan: 'A',
  bomb: {
    state: 'carried', // carried | dropped | planted | gone
    carrier: 'player', // 'player' | bot | null
    site: null,
    x: 0,
    z: 0,
    timer: 0,
  },
  plantProgress: 0,
  roundWinner: null,
  roundReason: '',
};

const playerState = player.state;
let viewModel = null;
let weaponState = null;
let elapsed = 0;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let buyOpen = false;
let lastMinimapAt = 0;

// Tracers and impact sparks, pooled.
const tracers = [];
const tracerMaterial = new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
function spawnTracer(from, to) {
  const geometry = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
  const line = new THREE.Line(geometry, tracerMaterial.clone());
  scene.add(line);
  tracers.push({ line, life: 0.09 });
  if (tracers.length > 24) {
    const old = tracers.shift();
    scene.remove(old.line);
    old.line.geometry.dispose();
    old.line.material.dispose();
  }
}
const SPARK_COUNT = 14;
const sparkGeometry = new THREE.BufferGeometry();
const sparkPositions = new Float32Array(SPARK_COUNT * 3);
sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
const sparkPoints = new THREE.Points(sparkGeometry, new THREE.PointsMaterial({ color: new THREE.Color(PALETTE.accent), size: 0.09, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
sparkPoints.visible = false;
sparkPoints.frustumCulled = false;
scene.add(sparkPoints);
let sparkLife = 0;
const sparkVelocities = [];
for (let i = 0; i < SPARK_COUNT; i += 1) sparkVelocities.push(new THREE.Vector3());
function spawnSparks(point, normal) {
  for (let i = 0; i < SPARK_COUNT; i += 1) {
    sparkPositions[i * 3] = point.x;
    sparkPositions[i * 3 + 1] = point.y;
    sparkPositions[i * 3 + 2] = point.z;
    const v = sparkVelocities[i];
    v.set(range(rng, -1, 1), range(rng, 0, 1.4), range(rng, -1, 1)).normalize().multiplyScalar(range(rng, 1.5, 4));
    v.addScaledVector(normal, 1.5);
  }
  sparkGeometry.attributes.position.needsUpdate = true;
  sparkPoints.visible = true;
  sparkLife = 0.28;
}

// Bomb prop: shown when planted or dropped.
const bombMesh = new THREE.Group();
const bombBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.38, 0.24, 0.26),
  new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hazard), roughness: 0.5, metalness: 0.2 }),
);
const bombLight = new THREE.PointLight(new THREE.Color(PALETTE.vulture), 0, 6);
bombLight.position.y = 0.4;
bombMesh.add(bombBody, bombLight);
bombMesh.visible = false;
scene.add(bombMesh);

// ---- weapons -----------------------------------------------------------
function equip(id) {
  if (!match.owned.has(id)) return;
  if (viewModel) viewModel.dispose();
  match.primaryId = id;
  const def = WEAPONS[id];
  weaponState = createWeaponState(def);
  viewModel = createViewModel(camera, def);
  hud.setWeapon(def.name);
  hud.setAmmo(weaponState.mag, weaponState.reserve);
}

function switchWeapon(id) {
  if (id === match.primaryId || !match.owned.has(id)) return;
  equip(id);
  audio.click();
}

// ---- helpers -----------------------------------------------------------
function eyePosition() {
  return new THREE.Vector3(playerState.position.x, playerState.position.y + playerState.eye, playerState.position.z);
}

function hasLOS(from, to) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const dist = dir.length();
  if (dist < 0.01) return true;
  dir.normalize();
  raycaster.set(from, dir);
  raycaster.far = dist - 0.25;
  return raycaster.intersectObjects(world.shootables, false).length === 0;
}

function applyDamage(target, amount, attackerName, weaponName, isHead) {
  // Armor soaks half of every hit until it breaks.
  let remaining = amount;
  if (target.armor > 0) {
    const soaked = Math.min(target.armor, amount * 0.5);
    target.armor -= soaked;
    remaining -= soaked;
  }
  target.hp -= remaining;
  return target.hp <= 0;
}

function describeKill(attackerName, victimName, weaponName, isHead) {
  return `${attackerName} ▸ ${victimName}  [${weaponName}${isHead ? ' · HEADSHOT' : ''}]`;
}

function onFighterKilled(victim, killerName, weaponName, isHead) {
  if (victim.kind === 'player') {
    match.deaths += 1;
    audio.hurt();
    if (match.bomb.carrier === 'player') {
      match.bomb.state = 'dropped';
      match.bomb.carrier = null;
      match.bomb.x = playerState.position.x;
      match.bomb.z = playerState.position.z;
      bombMesh.visible = true;
      bombMesh.position.set(match.bomb.x, 0.14, match.bomb.z);
      hud.showBanner('BOMB DROPPED', 'A teammate must recover it', 2200);
    }
  } else {
    bots.kill(victim.bot);
    if (killerName === 'YOU') {
      match.kills += 1;
      match.money += KILL_REWARD;
      hud.setMoney(match.money);
    }
  }
  hud.killfeedAdd(describeKill(killerName, victim.name, weaponName, isHead));
  hud.setAlive(bots.aliveCount('sable') + (playerState.hp > 0 ? 1 : 0), bots.aliveCount('vulture'));
}

function damageFighter(target, amount, attackerName, weaponName, isHead) {
  const killed = applyDamage(target, amount, attackerName, weaponName, isHead);
  if (killed) {
    onFighterKilled(target, attackerName, weaponName, isHead);
    return true;
  }
  if (target.kind === 'player') {
    audio.hurt();
  }
  return false;
}

function opponentsOf(bot) {
  const foes = [];
  if (playerState.hp > 0) {
    foes.push({
      kind: 'player',
      ref: playerState,
      name: 'YOU',
      position: playerState.position,
      y: playerState.position.y,
      eye: playerState.eye,
      alive: true,
      get hp() {
        return playerState.hp;
      },
      armor: playerState.armor,
    });
  }
  for (const other of bots.bots) {
    if (other.team === bot.team || !other.alive) continue;
    foes.push({
      kind: 'bot',
      bot: other,
      ref: other,
      name: other.name,
      position: other.position,
      y: 0,
      eye: 1.55,
      alive: true,
      hp: other.hp,
      armor: other.armor,
    });
  }
  return foes;
}

// A bot fires at its target: main.js resolves the shot so tracers,
// damage and the killfeed all agree.
function fireBotShot(shooter, target) {
  const def = WEAPONS[shooter.weaponId];
  const muzzle = new THREE.Vector3(shooter.position.x, 1.45, shooter.position.z);
  const targetPoint = new THREE.Vector3(target.position.x, target.position.y + target.eye * 0.85, target.position.z);
  const dist = muzzle.distanceTo(targetPoint);
  const moving = target.kind === 'player' ? player.groundSpeed() > 1.5 : true;
  let chance = shooter.skill.accuracy * (1 - dist / 70) * (moving ? 0.85 : 1);
  chance = clamp(chance, 0.05, 0.9);
  const hit = rng() < chance;
  const isHead = rng() < 0.12;
  let end;
  if (hit) {
    const falloff = clamp(1 - (dist / def.range) * (1 - def.falloff), def.falloff, 1);
    const amount = def.damage * (isHead ? def.headMult : 1) * falloff;
    end = targetPoint.clone();
    const victim = target.kind === 'player'
      ? { kind: 'player', name: 'YOU', hp: playerState.hp, armor: playerState.armor }
      : { kind: 'bot', bot: target.bot, name: target.bot.name, hp: target.bot.hp, armor: target.bot.armor };
    // Route damage through the shared resolver so armour/kills agree.
    const killed = applyDamage(
      target.kind === 'player' ? playerState : target.bot,
      amount,
      shooter.name,
      def.name,
      isHead,
    );
    if (killed) {
      onFighterKilled(victim, shooter.name, def.name, isHead);
    } else if (target.kind === 'player') {
      audio.hurt();
      const angle = Math.atan2(playerState.position.x - shooter.position.x, playerState.position.z - shooter.position.z);
      const rel = angle - playerState.yaw;
      hud.damageFrom((rel * 180) / Math.PI);
    }
  } else {
    end = targetPoint.clone();
    end.x += range(rng, -1.2, 1.2);
    end.y += range(rng, -0.6, 0.9);
    end.z += range(rng, -1.2, 1.2);
  }
  spawnTracer(muzzle, end);
  if (dist < 40) audio.shot(def.id);
}

// ---- player shooting ----------------------------------------------------
const shootDirection = new THREE.Vector3();
function playerShoot() {
  if (!weaponState || !weaponState.ready()) {
    if (weaponState && weaponState.mag === 0 && weaponState.cooldown === 0) audio.dryFire();
    return;
  }
  if (!weaponState.takeRound()) return;
  const def = weaponState.def;
  camera.getWorldDirection(shootDirection);
  const spread = def.spreadStill + Math.min(1, player.groundSpeed() / 5.2) * def.spreadMove + (playerState.crouching ? -def.spreadStill * 0.4 : 0);
  shootDirection.x += (rng() * 2 - 1) * spread;
  shootDirection.y += (rng() * 2 - 1) * spread;
  shootDirection.z += (rng() * 2 - 1) * spread;
  shootDirection.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, shootDirection);
  const hit = raycaster.intersectObjects(shootables, false)[0];
  const muzzleWorld = new THREE.Vector3(0.24, -0.18, -0.95).applyMatrix4(camera.matrixWorld);
  if (hit) {
    spawnTracer(muzzleWorld, hit.point);
    const bot = hit.object.userData.bot;
    if (bot && bot.alive) {
      const isHead = hit.object.userData.part === 'head';
      const dist = camera.position.distanceTo(hit.point);
      const falloff = clamp(1 - (dist / def.range) * (1 - def.falloff), def.falloff, 1);
      const amount = def.damage * (isHead ? def.headMult : 1) * falloff;
      const victim = { kind: 'bot', bot, name: bot.name, hp: bot.hp, armor: bot.armor };
      const killed = applyDamage(bot, amount, 'YOU', def.name, isHead);
      if (killed) {
        onFighterKilled(victim, 'YOU', def.name, isHead);
        hud.hitMarker(true, 4000);
        audio.kill();
      } else {
        hud.hitMarker(false);
        audio.hit();
      }
    } else {
      const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
      spawnSparks(hit.point, normal);
    }
  } else {
    spawnTracer(muzzleWorld, camera.position.clone().addScaledVector(shootDirection, 80));
  }
  viewModel.fire();
  audio.shot(def.id);
  player.recoil(0.009 + rng() * 0.004, (rng() * 2 - 1) * 0.004);
  hud.setAmmo(weaponState.mag, weaponState.reserve);
}

// ---- rounds --------------------------------------------------------------
function pickPlan() {
  match.plan = pick(rng, ['A', 'A', 'B', 'B', 'split']);
}

function spawnPositions(team, count) {
  const base = team === 'sable' ? world.spawnAttack : world.spawnDefend;
  const spots = [];
  for (let i = 0; i < count; i += 1) {
    spots.push({ x: base.x + (i - (count - 1) / 2) * 1.6, z: base.z + (i % 2 === 0 ? 0 : 1.2) });
  }
  return spots;
}

function startRound() {
  pickPlan();
  player.respawn(world.spawnAttack, 0);
  match.bomb = { state: 'carried', carrier: 'player', site: null, x: 0, z: 0, timer: 0 };
  bombMesh.visible = false;
  match.plantProgress = 0;
  hud.setPlant(null);

  const sableBots = bots.bots.filter((b) => b.team === 'sable');
  const vultureBots = bots.bots.filter((b) => b.team === 'vulture');
  const sableSpawns = spawnPositions('sable', 4);
  const vultureSpawns = spawnPositions('vulture', 5);
  const assignments = [];
  const sableSites = match.plan === 'A' ? ['A', 'A', 'A', 'mid'] : match.plan === 'B' ? ['B', 'B', 'B', 'mid'] : ['A', 'A', 'B', 'B'];
  sableBots.forEach((bot, i) => {
    assignments.push({
      bot,
      site: sableSites[i],
      role: 'push',
      spawn: sableSpawns[i],
      yaw: 0,
      armor: false,
    });
  });
  const vultureSites = ['A', 'A', 'B', 'B', 'mid'];
  vultureBots.forEach((bot, i) => {
    assignments.push({
      bot,
      site: vultureSites[i],
      role: 'hold',
      spawn: vultureSpawns[i],
      yaw: Math.PI,
      armor: i % 2 === 0,
    });
  });
  bots.spawnRound(assignments);

  // Fresh magazine each round; the buy menu decides the rest.
  weaponState.refill();
  hud.setAmmo(weaponState.mag, weaponState.reserve);
  hud.setHealth(playerState.hp, playerState.armor);
  hud.setMoney(match.money);
  hud.setScore(match.scoreSable, match.scoreVulture);
  hud.setRound(match.round);
  hud.setAlive(5, 5);
  hud.setWeapon(WEAPONS[match.primaryId].name + (match.bomb.carrier === 'player' ? ' · BOMB' : ''));
  match.phase = 'freeze';
  match.timer = FREEZE_TIME;
  openBuy();
}

function openBuy() {
  if (match.phase !== 'freeze') return;
  buyOpen = true;
  hud.showBuy(WEAPON_ORDER.map((id) => WEAPONS[id]), match.money, match.owned);
}

function closeBuy() {
  buyOpen = false;
  hud.hideBuy();
}

function endRound(winner, reason) {
  match.phase = 'roundEnd';
  match.roundWinner = winner;
  match.roundReason = reason;
  match.timer = 3.5;
  closeBuy();
  hud.setPlant(null);
  if (winner === 'sable') {
    match.scoreSable += 1;
    match.money += WIN_REWARD;
    audio.roundWin();
  } else {
    match.scoreVulture += 1;
    match.money += LOSS_REWARD;
    audio.roundLose();
  }
  hud.setScore(match.scoreSable, match.scoreVulture);
  hud.setMoney(match.money);
  hud.showBanner(
    winner === 'sable' ? 'ROUND WON' : 'ROUND LOST',
    reason,
    3400,
  );
}

function endMatch() {
  match.phase = 'matchEnd';
  const won = match.scoreSable > match.scoreVulture;
  hud.showOverlay('matchEnd', `Final score ${match.scoreSable} — ${match.scoreVulture}. ${won ? 'SABLE takes the match.' : 'VULTURE takes the match.'}`);
  if (document.pointerLockElement) document.exitPointerLock();
}

function objectiveFor(bot) {
  const bomb = match.bomb;
  if (bot.team === 'sable') {
    if (bomb.state === 'planted') return { x: world.sites[bomb.site].x, z: world.sites[bomb.site].z };
    if (bomb.state === 'dropped') return { x: bomb.x, z: bomb.z };
    if (bot.role === 'carrier') return { x: world.sites[bot.site].x, z: world.sites[bot.site].z };
    if (bot.site === 'mid') return { x: 0, z: 0 };
    return { x: world.sites[bot.site].x, z: world.sites[bot.site].z };
  }
  // VULTURE defends.
  if (bomb.state === 'planted') return { x: bomb.x, z: bomb.z };
  if (bot.site === 'mid') return { x: range(rng, -4, 4), z: range(rng, -4, 4) };
  return { x: world.sites[bot.site].x, z: world.sites[bot.site].z };
}

function checkRoundEnd() {
  if (match.phase !== 'live') return;
  const sableAlive = bots.aliveCount('sable') + (playerState.hp > 0 ? 1 : 0);
  const vultureAlive = bots.aliveCount('vulture');
  const planted = match.bomb.state === 'planted';
  if (!planted) {
    if (sableAlive === 0) {
      endRound('vulture', 'SABLE eliminated');
      return;
    }
    if (vultureAlive === 0) {
      endRound('sable', 'VULTURE eliminated');
      return;
    }
    if (match.timer <= 0) {
      endRound('vulture', 'Time expired — site held');
      return;
    }
  } else {
    if (match.bomb.timer <= 0) {
      audio.explode();
      endRound('sable', 'Bomb detonated');
    }
  }
}

// ---- per-frame update ------------------------------------------------------
function syncCamera() {
  camera.position.set(playerState.position.x, playerState.position.y + playerState.eye, playerState.position.z);
  camera.rotation.set(playerState.pitch, playerState.yaw, 0, 'YXZ');
}

function step(dt) {
  elapsed += dt;
  const live = match.phase === 'live';

  if (match.phase === 'freeze') {
    match.timer -= dt;
    if (match.timer <= 0) {
      match.phase = 'live';
      match.timer = ROUND_TIME;
      closeBuy();
      hud.showBanner(`ROUND ${match.round}`, match.plan === 'split' ? 'Split push — A and B' : `Push ${match.plan}`, 2000);
    }
  } else if (match.phase === 'live') {
    match.timer -= dt;
    if (match.bomb.state === 'planted') {
      match.bomb.timer -= dt;
      bombLight.intensity = (Math.sin(elapsed * 10) > 0 ? 14 : 2);
    }
  } else if (match.phase === 'roundEnd') {
    match.timer -= dt;
    if (match.timer <= 0) {
      if (match.scoreSable >= WIN_ROUNDS || match.scoreVulture >= WIN_ROUNDS || match.round >= MAX_ROUNDS) {
        endMatch();
      } else {
        match.round += 1;
        startRound();
      }
    }
  }

  // Player movement and look (frozen during freeze/roundEnd).
  const look = input.takeLook();
  if (live || match.phase === 'freeze') player.look(look.x, look.y);
  if (live) player.step(dt, input.state.keys);
  else if (match.phase === 'freeze') player.step(dt, new Set());

  // Weapon.
  if (weaponState) weaponState.step(dt);
  if (viewModel) viewModel.step(dt, weaponState ? weaponState.reloading : false, weaponState ? 1 - weaponState.reloadLeft / weaponState.def.reloadTime : 0);

  // Shooting and reload.
  if (live && playerState.hp > 0) {
    if (input.state.firing && weaponState) playerShoot();
    if (input.pressed('KeyR') && weaponState && weaponState.reload()) audio.reload();
    if (input.pressed('Digit1')) switchWeapon('pistol');
    if (input.pressed('Digit2')) switchWeapon('smg');
    if (input.pressed('Digit3')) switchWeapon('rifle');
    if (input.pressed('Digit4')) switchWeapon('sniper');
  }

  // Buy menu toggle during freeze.
  if (input.pressed('KeyB') && match.phase === 'freeze') {
    if (buyOpen) closeBuy();
    else openBuy();
  }

  // Bomb plant (player carries it).
  if (live && match.bomb.state === 'carried' && match.bomb.carrier === 'player' && playerState.hp > 0) {
    const site = Object.values(world.sites).find((s) => Math.hypot(s.x - playerState.position.x, s.z - playerState.position.z) < s.radius);
    if (site && input.state.keys.has('KeyE') && player.groundSpeed() < 0.5) {
      match.plantProgress += dt / PLANT_TIME;
      hud.setPlant(match.plantProgress, 'PLANTING THE BOMB');
      if (Math.floor(match.plantProgress * 6) !== Math.floor((match.plantProgress - dt / PLANT_TIME) * 6)) audio.plantTick();
      if (match.plantProgress >= 1) {
        match.bomb.state = 'planted';
        match.bomb.site = site.letter;
        match.bomb.x = playerState.position.x;
        match.bomb.z = playerState.position.z;
        match.bomb.timer = BOMB_TIMER;
        match.money += PLANT_REWARD;
        hud.setMoney(match.money);
        hud.setPlant(null);
        bombMesh.visible = true;
        bombMesh.position.set(match.bomb.x, 0.14, match.bomb.z);
        audio.plantDone();
        hud.showBanner('BOMB PLANTED', `Detonation in ${BOMB_TIMER}s — hold ${site.letter}`, 2600);
        hud.setWeapon(WEAPONS[match.primaryId].name);
      }
    } else {
      if (match.plantProgress > 0) hud.setPlant(null);
      match.plantProgress = 0;
    }
  }

  // Dropped bomb pickup by a nearby teammate bot.
  if (match.bomb.state === 'dropped') {
    for (const bot of bots.bots) {
      if (bot.team !== 'sable' || !bot.alive) continue;
      if (Math.hypot(bot.position.x - match.bomb.x, bot.position.z - match.bomb.z) < 1.6) {
        match.bomb.state = 'carried';
        match.bomb.carrier = bot;
        bot.role = 'carrier';
        bombMesh.visible = false;
        hud.killfeedAdd(`${bot.name} picked up the bomb`);
        break;
      }
    }
    // The player can also walk back over it.
    if (playerState.hp > 0 && Math.hypot(playerState.position.x - match.bomb.x, playerState.position.z - match.bomb.z) < 1.6) {
      match.bomb.state = 'carried';
      match.bomb.carrier = 'player';
      bombMesh.visible = false;
      hud.setWeapon(WEAPONS[match.primaryId].name + ' · BOMB');
      hud.killfeedAdd('YOU picked up the bomb');
    }
  }

  // Bots only act while the round is live: during freeze they hold at
  // spawn, and after the round ends they stand down.
  if (live) {
    const ctx = {
    time: elapsed,
    camera,
    bomb: match.bomb,
    opponentsOf,
    hasLOS,
    fireShot: fireBotShot,
    objectiveFor,
    onChannelStart(bot, kind) {
      hud.setPlant(0, kind === 'plant' ? `${bot.name.toUpperCase()} IS PLANTING` : `${bot.name.toUpperCase()} IS DEFUSING`);
    },
    onChannelCancel(bot, kind) {
      hud.setPlant(null);
    },
    onChannelDone(bot, kind) {
      hud.setPlant(null);
      if (kind === 'plant') {
        match.bomb.state = 'planted';
        match.bomb.site = bot.site;
        match.bomb.x = bot.position.x;
        match.bomb.z = bot.position.z;
        match.bomb.timer = BOMB_TIMER;
        bombMesh.visible = true;
        bombMesh.position.set(match.bomb.x, 0.14, match.bomb.z);
        audio.plantDone();
        hud.showBanner('BOMB PLANTED', `${bot.name} planted at ${bot.site} — ${BOMB_TIMER}s`, 2600);
      } else {
        match.bomb.state = 'gone';
        bombMesh.visible = false;
        audio.roundLose();
        endRound('vulture', 'Bomb defused');
      }
    },
    };
    bots.step(dt, ctx);
  }

  // Tracers and sparks fade.
  for (let i = tracers.length - 1; i >= 0; i -= 1) {
    const tracer = tracers[i];
    tracer.life -= dt;
    tracer.line.material.opacity = Math.max(0, tracer.life / 0.09) * 0.9;
    if (tracer.life <= 0) {
      scene.remove(tracer.line);
      tracer.line.geometry.dispose();
      tracer.line.material.dispose();
      tracers.splice(i, 1);
    }
  }
  if (sparkLife > 0) {
    sparkLife -= dt;
    for (let i = 0; i < SPARK_COUNT; i += 1) {
      sparkPositions[i * 3] += sparkVelocities[i].x * dt;
      sparkPositions[i * 3 + 1] += sparkVelocities[i].y * dt;
      sparkPositions[i * 3 + 2] += sparkVelocities[i].z * dt;
      sparkVelocities[i].y -= 6 * dt;
    }
    sparkGeometry.attributes.position.needsUpdate = true;
    sparkPoints.material.opacity = Math.max(0, sparkLife / 0.28) * 0.95;
    if (sparkLife <= 0) sparkPoints.visible = false;
  }

  // HUD (throttle the minimap).
  hud.setTimer(match.phase === 'freeze' || match.phase === 'live' ? match.timer : match.timer);
  hud.setHealth(playerState.hp, playerState.armor);
  if (weaponState) hud.setAmmo(weaponState.mag, weaponState.reserve);
  if (elapsed - lastMinimapAt > 0.12) {
    lastMinimapAt = elapsed;
    const dots = [{ x: playerState.position.x, z: playerState.position.z, yaw: playerState.yaw, color: '#ffffff', player: true }];
    for (const bot of bots.bots) {
      if (!bot.alive) continue;
      dots.push({ x: bot.position.x, z: bot.position.z, color: bot.team === 'sable' ? PALETTE.sable : PALETTE.vulture });
    }
    const bombDot = match.bomb.state === 'planted' || match.bomb.state === 'dropped' ? { x: match.bomb.x, z: match.bomb.z } : null;
    hud.drawMinimap(world, dots, bombDot);
  }

  checkRoundEnd();
  syncCamera();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
  }
  renderer.render(scene, camera);
}

function onLockChange(locked) {
  if (shot) return;
  audio.unlock();
  if (locked) {
    started = true;
    hud.hideOverlay();
    if (match.phase === 'menu') {
      startRound();
    }
  } else if (match.phase === 'live' || match.phase === 'freeze') {
    hud.showOverlay('paused');
  }
}

hud.onPlay(() => {
  if (shot) return;
  if (match.phase === 'matchEnd') {
    match.round = 1;
    match.scoreSable = 0;
    match.scoreVulture = 0;
    match.money = 800;
    match.owned = new Set(['pistol']);
    match.kills = 0;
    match.deaths = 0;
    equip('pistol');
    startRound();
  }
  input.requestLock();
});

hud.onBuy((id) => {
  if (match.phase !== 'freeze') return;
  if (id === 'armor') {
    if (match.money < ARMOR_PRICE || match.armor) return;
    match.money -= ARMOR_PRICE;
    match.armor = true;
    playerState.armor = 50;
    audio.buy();
  } else {
    const def = WEAPONS[id];
    if (match.money < def.price || match.owned.has(id)) return;
    match.money -= def.price;
    match.owned.add(id);
    audio.buy();
    equip(id);
  }
  hud.setMoney(match.money);
  hud.setHealth(playerState.hp, playerState.armor);
  openBuy();
});

// ---- screenshot captures -------------------------------------------------
function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function aimAt(point) {
  const dx = point.x - playerState.position.x;
  const dy = point.y - (playerState.position.y + playerState.eye);
  const dz = point.z - playerState.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  playerState.yaw = Math.atan2(-dx, -dz);
  playerState.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBuy();
  buyOpen = false;
  if (name === 'start') {
    startRound();
    closeBuy();
    playerState.position.set(0, 0, 11);
    playerState.yaw = 0.35;
    playerState.pitch = 0.02;
    settle(30);
    hud.showOverlay('start');
    hud.setMoney(800);
  } else if (name === 'buy') {
    startRound();
    match.money = 3850;
    hud.setMoney(3850);
    playerState.position.set(-2, 0, 10);
    playerState.yaw = -0.2;
    settle(20);
    openBuy();
  } else if (name === 'play') {
    startRound();
    closeBuy();
    match.phase = 'live';
    match.timer = 72;
    match.scoreSable = 2;
    match.scoreVulture = 1;
    match.money = 3850;
    hud.setScore(2, 1);
    hud.setMoney(3850);
    hud.setRound(4);
    match.owned.add('rifle');
    equip('rifle');
    // Stage a firefight: the player mid-aims at a VULTURE bot at mid,
    // another bot crosses left, a teammate holds the right lane. The
    // staging happens after the last settle so the bots are exactly
    // where the camera expects them when the shot fires.
    const foes = bots.bots.filter((b) => b.team === 'vulture' && b.alive);
    const friends = bots.bots.filter((b) => b.team === 'sable' && b.alive);
    playerState.position.set(-1, 0, 3);
    settle(10);
    foes[0].position.set(1.5, 0, -1.5);
    foes[0].yaw = Math.PI;
    foes[1].position.set(-7, 0, -1);
    foes[1].yaw = Math.PI * 0.75;
    friends[0].position.set(5.5, 0, 2);
    friends[0].yaw = -Math.PI * 0.5;
    aimAt(new THREE.Vector3(1.5, 1.2, -1.5));
    playerShoot();
    hud.killfeedAdd('JUNO ▸ HAVOC  [AR-77]');
    settle(1);
  } else {
    // end: round just won at site A, two defenders down.
    startRound();
    closeBuy();
    match.phase = 'roundEnd';
    match.timer = 3.5;
    match.scoreSable = 3;
    match.scoreVulture = 2;
    match.round = 6;
    hud.setScore(3, 2);
    hud.setRound(6);
    const foes = bots.bots.filter((b) => b.team === 'vulture' && b.alive);
    foes[0].position.set(-15, 0, -7);
    bots.kill(foes[0]);
    foes[1].position.set(-13.5, 0, -9.5);
    bots.kill(foes[1]);
    // Dead bots are skipped by step(), so their groups are never
    // re-synced to the staged positions — place them by hand.
    foes[0].visuals.group.position.set(-15, 0.25, -7);
    foes[1].visuals.group.position.set(-13.5, 0.25, -9.5);
    playerState.position.set(-11, 0, -4);
    aimAt(new THREE.Vector3(-15, 1.0, -7));
    hud.showBanner('ROUND WON', 'Site A secured — VULTURE eliminated', 4000);
    settle(10);
  }
  hud.setAmmo(weaponState.mag, weaponState.reserve);
  hud.setHealth(playerState.hp, playerState.armor);
  hud.setAlive(bots.aliveCount('sable') + (playerState.hp > 0 ? 1 : 0), bots.aliveCount('vulture'));
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- boot ----------------------------------------------------------------
equip('pistol');
hud.setAmmo(weaponState.mag, weaponState.reserve);
hud.setHealth(100, 0);
hud.setMoney(800);
hud.setScore(0, 0);
hud.setRound(1);
hud.setAlive(5, 5);
syncCamera();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
