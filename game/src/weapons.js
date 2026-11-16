// The armoury: four buyable weapons plus the starting sidearm. Each entry
// owns the numbers that make it feel different — damage, headshot bonus,
// fire cadence, magazine, reload, spread and price. Accuracy is the skill:
// spread grows with movement and shrinks when still or crouched.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol',
    name: 'P2000',
    price: 0,
    damage: 34,
    headMult: 2.0,
    fireGap: 0.16,
    auto: false,
    mag: 12,
    reserve: 48,
    reloadTime: 1.4,
    spreadStill: 0.0035,
    spreadMove: 0.02,
    falloff: 0.55,
    range: 60,
  },
  smg: {
    id: 'smg',
    name: 'VK-9',
    price: 1500,
    damage: 22,
    headMult: 1.8,
    fireGap: 0.075,
    auto: true,
    mag: 30,
    reserve: 120,
    reloadTime: 1.7,
    spreadStill: 0.008,
    spreadMove: 0.03,
    falloff: 0.45,
    range: 45,
  },
  rifle: {
    id: 'rifle',
    name: 'AR-77',
    price: 2700,
    damage: 36,
    headMult: 2.0,
    fireGap: 0.1,
    auto: true,
    mag: 30,
    reserve: 90,
    reloadTime: 1.9,
    spreadStill: 0.0022,
    spreadMove: 0.028,
    falloff: 0.7,
    range: 80,
  },
  sniper: {
    id: 'sniper',
    name: 'LONGSHOT',
    price: 4750,
    damage: 105,
    headMult: 2.2,
    fireGap: 1.1,
    auto: false,
    mag: 5,
    reserve: 20,
    reloadTime: 2.6,
    spreadStill: 0.0004,
    spreadMove: 0.05,
    falloff: 0.9,
    range: 120,
  },
};

export const WEAPON_ORDER = ['pistol', 'smg', 'rifle', 'sniper'];

// A low-poly view model per weapon: receiver, barrel, stock and grip in
// different proportions, plus a muzzle flash quad and a flash light.
export function createViewModel(camera, def) {
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const metal = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.45, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.15 });

  const model = new THREE.Group();
  const scale = def.id === 'pistol' ? 0.7 : def.id === 'smg' ? 0.85 : def.id === 'sniper' ? 1.25 : 1;
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09 * scale, 0.1, 0.42 * scale), metal);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.42 * scale), dark);
  barrel.position.set(0, 0.025, -0.38 * scale);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22 * scale), dark);
  stock.position.set(0, -0.02, 0.3 * scale);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.08), accent);
  grip.position.set(0, -0.1, 0.12);
  model.add(receiver, barrel, stock, grip);
  if (def.id === 'sniper') {
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 12), dark);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.09, 0);
    model.add(scope);
  }
  model.position.set(0.24, -0.2, -0.42);
  camera.add(model);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);

  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const state = { kick: 0, flash: 0 };

  return {
    model,
    state,
    step(dt, reloading, reloadFrac) {
      state.kick += (0 - state.kick) * Math.min(1, dt * 14);
      state.flash = Math.max(0, state.flash - dt);
      model.position.z = -0.42 + state.kick;
      model.rotation.x = state.kick * 2.2 + (reloading ? -0.55 * Math.min(1, reloadFrac * 2) : 0);
      flash.visible = state.flash > 0;
      flash.rotation.z = state.flash * 30;
      flashLight.intensity = state.flash > 0 ? 18 : 0;
    },
    fire() {
      state.kick = 0.055;
      state.flash = 0.06;
    },
    dispose() {
      camera.remove(model, flash, flashLight);
    },
  };
}

// One live weapon instance: ammo, cooldown, reload timer.
export function createWeaponState(def) {
  return {
    def,
    mag: def.mag,
    reserve: def.reserve,
    cooldown: 0,
    reloadLeft: 0,
    get reloading() {
      return this.reloadLeft > 0;
    },
    ready() {
      return this.mag > 0 && this.cooldown === 0 && this.reloadLeft === 0;
    },
    step(dt) {
      this.cooldown = Math.max(0, this.cooldown - dt);
      if (this.reloadLeft > 0) {
        this.reloadLeft = Math.max(0, this.reloadLeft - dt);
        if (this.reloadLeft === 0) {
          const need = this.def.mag - this.mag;
          const take = Math.min(need, this.reserve);
          this.mag += take;
          this.reserve -= take;
        }
      }
    },
    takeRound() {
      if (this.mag <= 0) return false;
      this.mag -= 1;
      this.cooldown = this.def.fireGap;
      return true;
    },
    reload() {
      if (this.reloadLeft > 0 || this.mag === this.def.mag || this.reserve === 0) return false;
      this.reloadLeft = this.def.reloadTime;
      return true;
    },
    refill() {
      this.mag = this.def.mag;
      this.reserve = this.def.reserve;
      this.cooldown = 0;
      this.reloadLeft = 0;
    },
  };
}
