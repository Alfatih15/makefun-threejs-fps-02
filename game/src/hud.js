// The DOM HUD: crosshair, hit marker, damage direction, health, ammo,
// money, timer, round score, team pips, killfeed, the minimap, the buy
// menu and the overlay panels. It never touches the simulation; main.js
// pushes numbers in and reads the buy callback out.
import { formatClock, formatMoney } from './util.js';

const COPY = {
  start: {
    title: 'SABLE LINE',
    copy: 'Five attackers. Five defenders. One bomb. First to 5 rounds takes the match — plant at A or B, or wipe the other team.',
    action: 'Click to play',
  },
  paused: {
    title: 'SABLE LINE',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  roundEnd: {
    title: 'Round over',
    copy: '',
    action: 'Next round',
  },
  matchEnd: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const ammoBox = $('ammo');
  const healthValue = $('health-value');
  const healthBar = $('health-fill');
  const armorValue = $('armor-value');
  const moneyValue = $('money-value');
  const timerValue = $('timer-value');
  const scoreSable = $('score-sable');
  const scoreVulture = $('score-vulture');
  const roundValue = $('round-value');
  const pipsSable = $('pips-sable');
  const pipsVulture = $('pips-vulture');
  const killfeed = $('killfeed');
  const hitmarker = $('hitmarker');
  const damageArc = $('damage-arc');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const buyPanel = $('buy');
  const buyItems = $('buy-items');
  const buyMoney = $('buy-money');
  const plantBar = $('plant');
  const plantFill = $('plant-fill');
  const plantLabel = $('plant-label');
  const minimap = $('minimap');
  const mapCtx = minimap.getContext('2d');
  const weaponName = $('weapon-name');

  let lastMag = -1;
  let lastReserve = -1;
  let lastHp = -1;
  let lastArmor = -1;
  let lastMoney = -1;
  let lastTimer = '';
  let lastScore = '';
  let lastRound = -1;
  let lastWeapon = '';
  let hitTimer = 0;
  let damageTimer = 0;
  let bannerTimer = 0;
  let buyHandler = null;

  function setPips(container, alive, total, team) {
    if (container.childElementCount !== total) {
      container.innerHTML = '';
      for (let i = 0; i < total; i += 1) {
        const pip = document.createElement('i');
        pip.className = team;
        container.appendChild(pip);
      }
    }
    [...container.children].forEach((pip, i) => {
      pip.classList.toggle('dead', i >= alive);
    });
  }

  return {
    setAmmo(mag, reserve) {
      if (mag === lastMag && reserve === lastReserve) return;
      lastMag = mag;
      lastReserve = reserve;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      ammoBox.classList.toggle('empty', mag === 0);
    },
    setWeapon(name) {
      if (name === lastWeapon) return;
      lastWeapon = name;
      weaponName.textContent = name;
    },
    setHealth(hp, armor) {
      if (hp === lastHp && armor === lastArmor) return;
      lastHp = hp;
      lastArmor = armor;
      healthValue.textContent = String(Math.max(0, Math.ceil(hp)));
      healthBar.style.width = `${Math.max(0, Math.min(100, hp))}%`;
      armorValue.textContent = armor > 0 ? `+${Math.ceil(armor)}` : '';
    },
    setMoney(amount) {
      if (amount === lastMoney) return;
      lastMoney = amount;
      moneyValue.textContent = formatMoney(amount);
    },
    setTimer(seconds) {
      const text = formatClock(seconds);
      if (text === lastTimer) return;
      lastTimer = text;
      timerValue.textContent = text;
      timerValue.classList.toggle('low', seconds <= 15);
    },
    setScore(sable, vulture) {
      const text = `${sable}-${vulture}`;
      if (text === lastScore) return;
      lastScore = text;
      scoreSable.textContent = String(sable);
      scoreVulture.textContent = String(vulture);
    },
    setRound(round) {
      if (round === lastRound) return;
      lastRound = round;
      roundValue.textContent = `ROUND ${round}`;
    },
    setAlive(sableAlive, vultureAlive) {
      setPips(pipsSable, sableAlive, 5, 'sable');
      setPips(pipsVulture, vultureAlive, 5, 'vulture');
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFrom(angleDeg) {
      damageArc.style.transform = `translate(-50%, -50%) rotate(${angleDeg}deg)`;
      damageArc.classList.add('on');
      clearTimeout(damageTimer);
      damageTimer = setTimeout(() => damageArc.classList.remove('on'), 450);
    },
    killfeedAdd(text) {
      const entry = document.createElement('div');
      entry.textContent = text;
      killfeed.prepend(entry);
      while (killfeed.childElementCount > 5) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => entry.remove(), 6000);
    },
    showBanner(titleText, subText, holdMs = 2600) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText;
      banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => {
        banner.hidden = true;
      }, holdMs);
    },
    hideBanner() {
      banner.hidden = true;
      clearTimeout(bannerTimer);
    },
    showOverlay(mode, detail = '') {
      const text = COPY[mode];
      title.textContent = text.title;
      copy.textContent = detail || text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
    showBuy(weapons, money, owned) {
      buyMoney.textContent = formatMoney(money);
      buyItems.innerHTML = '';
      for (const weapon of weapons) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'buy-item';
        button.disabled = owned.has(weapon.id) || money < weapon.price;
        button.innerHTML = `<b>${weapon.name}</b><span>${weapon.price === 0 ? 'OWNED' : formatMoney(weapon.price)}</span><small>${weapon.damage} dmg · ${weapon.mag} rnd</small>`;
        button.addEventListener('click', () => {
          if (buyHandler) buyHandler(weapon.id);
        });
        buyItems.appendChild(button);
      }
      const armorButton = document.createElement('button');
      armorButton.type = 'button';
      armorButton.className = 'buy-item';
      armorButton.disabled = owned.has('armor') || money < 650;
      armorButton.innerHTML = `<b>KEVLAR VEST</b><span>${formatMoney(650)}</span><small>+50 armor</small>`;
      armorButton.addEventListener('click', () => {
        if (buyHandler) buyHandler('armor');
      });
      buyItems.appendChild(armorButton);
      buyPanel.hidden = false;
    },
    hideBuy() {
      buyPanel.hidden = true;
    },
    onBuy(handler) {
      buyHandler = handler;
    },
    setPlant(frac, label) {
      if (frac === null) {
        plantBar.hidden = true;
        return;
      }
      plantBar.hidden = false;
      plantLabel.textContent = label;
      plantFill.style.width = `${Math.max(0, Math.min(100, frac * 100))}%`;
    },
    drawMinimap(world, dots, bomb) {
      const size = minimap.width;
      const scale = size / 44;
      const ox = size / 2;
      const oy = size / 2;
      mapCtx.clearRect(0, 0, size, size);
      mapCtx.fillStyle = 'rgba(20, 22, 26, 0.85)';
      mapCtx.fillRect(0, 0, size, size);
      // Walls.
      mapCtx.fillStyle = '#4a5058';
      for (const [x, z, w, d] of world.footprints) {
        if (w > 30 || d > 30) continue; // outer bounds are the frame
        mapCtx.fillRect(ox + (x - w / 2) * scale, oy + (z - d / 2) * scale, Math.max(1, w * scale), Math.max(1, d * scale));
      }
      mapCtx.strokeStyle = '#4a5058';
      mapCtx.lineWidth = 2;
      mapCtx.strokeRect(ox - 20 * scale, oy - 15 * scale, 40 * scale, 30 * scale);
      // Sites.
      mapCtx.fillStyle = '#f5a623';
      mapCtx.font = 'bold 11px system-ui, sans-serif';
      mapCtx.textAlign = 'center';
      mapCtx.textBaseline = 'middle';
      mapCtx.fillText('A', ox - 16.5 * scale, oy - 8 * scale);
      mapCtx.fillText('B', ox + 16.5 * scale, oy + 8 * scale);
      // Bomb.
      if (bomb) {
        mapCtx.fillStyle = '#ffe14d';
        mapCtx.beginPath();
        mapCtx.arc(ox + bomb.x * scale, oy + bomb.z * scale, 4, 0, Math.PI * 2);
        mapCtx.fill();
      }
      // Dots: teammates teal, enemies red, player white with a facing tick.
      for (const dot of dots) {
        mapCtx.fillStyle = dot.color;
        mapCtx.beginPath();
        mapCtx.arc(ox + dot.x * scale, oy + dot.z * scale, dot.player ? 4 : 3, 0, Math.PI * 2);
        mapCtx.fill();
        if (dot.player) {
          mapCtx.strokeStyle = '#ffffff';
          mapCtx.lineWidth = 1.5;
          mapCtx.beginPath();
          mapCtx.moveTo(ox + dot.x * scale, oy + dot.z * scale);
          mapCtx.lineTo(ox + (dot.x - Math.sin(dot.yaw) * 2.2) * scale, oy + (dot.z - Math.cos(dot.yaw) * 2.2) * scale);
          mapCtx.stroke();
        }
      }
    },
  };
}
