// ============================================================
// CHRISTMAS CARNAGE - game.js
// Vampire Survivors-style arena shooter with custom characters
// ============================================================

(function () {
  'use strict';

  // --- CONSTANTS ---
  const PLAYER_SPEED = 3.2;
  const PLAYER_MAX_HP = 100;
  const BULLET_SPEED = 8;
  const BULLET_SIZE = 5;
  const BASE_FIRE_RATE = 500; // ms between shots
  const XP_ATTRACT_RANGE = 80;
  const XP_ATTRACT_SPEED = 5;
  const ARENA_PADDING = 40;
  const ENEMY_SPAWN_MARGIN = 60;
  const JOYSTICK_MAX_RADIUS = 50;
  const JOYSTICK_DEAD_ZONE = 8;

  // --- CHARACTER DATA ---
  const CHARACTERS = [
    { id: 'michael', name: 'Michael' },
    { id: 'stefan', name: 'Stefan' },
    { id: 'gerry', name: 'Gerry' },
    { id: 'ally', name: 'Ally' },
    { id: 'chuckie', name: 'Chuckie' },
    { id: 'elliot', name: 'Elliot' },
    { id: 'chris', name: 'Chris' },
    { id: 'gavin', name: 'Gavin' },
    { id: 'nathan', name: 'Nathan' },
    { id: 'frazer', name: 'Frazer' },
    { id: 'kirky', name: 'Kirky' },
    { id: 'andy', name: 'Andy' },
  ];

  // --- ENEMY TYPES ---
  const ENEMY_TYPES = {
    bauble: { name: 'Bauble', hp: 15, speed: 1.8, size: 16, color: '#ff4444', score: 10, xp: 1, emoji: '🔴' },
    bauble_gold: { name: 'Gold Bauble', hp: 20, speed: 2.2, size: 16, color: '#ffd700', score: 15, xp: 1, emoji: '🟡' },
    mince_pie: { name: 'Mince Pie', hp: 40, speed: 1.0, size: 22, color: '#d4890e', score: 25, xp: 2, emoji: '🥧' },
    caroler: { name: 'Caroler', hp: 30, speed: 1.5, size: 20, color: '#44cc44', score: 20, xp: 2, emoji: '🎤' },
    snowman: { name: 'Snowman', hp: 60, speed: 0.8, size: 26, color: '#e8e8ff', score: 35, xp: 3, emoji: '☃️' },
    turkey: { name: 'Turkey', hp: 100, speed: 0.7, size: 32, color: '#8B4513', score: 50, xp: 5, emoji: '🦃' },
    santa: { name: 'Inflatable Santa', hp: 200, speed: 0.5, size: 40, color: '#ff0000', score: 100, xp: 10, emoji: '🎅' },
    cracker: { name: 'Cracker', hp: 25, speed: 2.5, size: 14, color: '#ff69b4', score: 15, xp: 1, emoji: '🎉' },
  };

  // --- UPGRADE DEFINITIONS ---
  const UPGRADES = [
    { id: 'fire_rate', icon: '⚡', label: 'Fire Rate', desc: '+25% speed', apply: s => { s.fireRateMult *= 0.75; } },
    { id: 'damage', icon: '💥', label: 'Damage', desc: '+30% damage', apply: s => { s.damage *= 1.3; } },
    { id: 'speed', icon: '👟', label: 'Speed', desc: '+15% move speed', apply: s => { s.speedMult *= 1.15; } },
    { id: 'multi', icon: '✴️', label: 'Multi Shot', desc: '+1 projectile', apply: s => { s.projectiles = Math.min(s.projectiles + 1, 8); } },
    { id: 'size', icon: '🔵', label: 'Big Shots', desc: '+40% bullet size', apply: s => { s.bulletSize *= 1.4; } },
    { id: 'heal', icon: '❤️', label: 'Heal', desc: 'Restore 40 HP', apply: s => { s.hp = Math.min(s.hp + 40, s.maxHp); } },
    { id: 'max_hp', icon: '🛡️', label: 'Tough', desc: '+20 max HP', apply: s => { s.maxHp += 20; s.hp += 20; } },
    { id: 'magnet', icon: '🧲', label: 'Magnet', desc: '+50% pickup range', apply: s => { s.magnetRange *= 1.5; } },
  ];

  // --- ROASTS ---
  const ROASTS = [
    "That was embarrassing.",
    "Even a mince pie could've lasted longer.",
    "Your nan could do better. With her eyes closed.",
    "Absolutely pathetic. Try again.",
    "The Christmas tree put up more of a fight.",
    "That turkey had a family, and you still lost.",
    "Wave {wave}? That's it? Really?",
    "Score of {score}. My condolences.",
    "You survived {time}s. A cracker lasts longer.",
    "Santa's not bringing you any presents after that.",
    "The baubles are literally stationary. How.",
    "Delete the app. Actually don't, try again.",
  ];

  // --- CANVAS SETUP ---
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');
  let W, H, dpr;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  // --- IMAGE LOADING ---
  const images = {};
  let imagesLoaded = 0;
  const totalImages = CHARACTERS.length * 3;

  function loadImage(key, src) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => { images[key] = img; imagesLoaded++; resolve(); };
      img.onerror = () => { imagesLoaded++; resolve(); };
      img.src = src;
    });
  }

  function loadAllImages() {
    const promises = [];
    for (const c of CHARACTERS) {
      promises.push(loadImage(c.id, `../assets/pngs/${c.id}.png`));
      promises.push(loadImage(c.id + '_xmas', `../assets/pngs/${c.id}_xmas.png`));
      promises.push(loadImage(c.id + '_gone', `../assets/gone/${c.id}_gone.png`));
    }
    return Promise.all(promises);
  }

  // --- GAME STATE ---
  let state = 'LOADING';
  let selectedChar = null;
  let player = null;
  let enemies = [];
  let bullets = [];
  let particles = [];
  let xpGems = [];
  let floatingTexts = [];
  let wave = 1;
  let score = 0;
  let gameTime = 0;
  let lastFireTime = 0;
  let enemiesRemaining = 0;
  let enemiesSpawned = 0;
  let enemiesTotal = 0;
  let spawnTimer = 0;
  let killedBy = null;
  let shakeAmount = 0;
  let shakeDecay = 0.9;
  let waveAnnounceTimer = 0;
  let waveAnnounceFade = 0;
  let lastTime = 0;
  let dt = 0;

  // --- JOYSTICK STATE ---
  let joystick = { active: false, startX: 0, startY: 0, currentX: 0, currentY: 0, dx: 0, dy: 0 };

  // --- PLAYER STATS ---
  function createPlayer() {
    return {
      x: W / 2,
      y: H / 2,
      size: 24,
      hp: PLAYER_MAX_HP,
      maxHp: PLAYER_MAX_HP,
      damage: 10,
      fireRateMult: 1,
      speedMult: 1,
      projectiles: 1,
      bulletSize: BULLET_SIZE,
      magnetRange: XP_ATTRACT_RANGE,
      xp: 0,
      level: 1,
      invincibleTimer: 0,
      aimAngle: 0,
    };
  }

  // --- WAVE CONFIG ---
  function getWaveConfig(w) {
    const baseCount = 5 + w * 3;
    const types = [];

    types.push({ type: 'bauble', weight: Math.max(10 - w, 2) });
    if (w >= 2) types.push({ type: 'bauble_gold', weight: 4 });
    if (w >= 2) types.push({ type: 'mince_pie', weight: 3 });
    if (w >= 3) types.push({ type: 'caroler', weight: 4 });
    if (w >= 3) types.push({ type: 'cracker', weight: 3 });
    if (w >= 4) types.push({ type: 'snowman', weight: 2 });
    if (w >= 5) types.push({ type: 'turkey', weight: 2 });
    if (w >= 6 && w % 3 === 0) types.push({ type: 'santa', weight: 1 });

    const hpScale = 1 + (w - 1) * 0.15;
    const speedScale = 1 + (w - 1) * 0.05;

    // Add a friend as mini-boss every 2 waves from wave 3+
    let friendBoss = null;
    if (w >= 3 && w % 2 === 1) {
      const others = CHARACTERS.filter(c => c.id !== (selectedChar && selectedChar.id));
      friendBoss = others[Math.floor(Math.random() * others.length)];
    }

    return { count: Math.min(baseCount, 40), types, hpScale, speedScale, friendBoss };
  }

  function pickEnemyType(types) {
    const totalWeight = types.reduce((s, t) => s + t.weight, 0);
    let r = Math.random() * totalWeight;
    for (const t of types) {
      r -= t.weight;
      if (r <= 0) return t.type;
    }
    return types[0].type;
  }

  // --- SPAWNING ---
  function spawnEnemy(typeKey, hpScale, speedScale) {
    const def = ENEMY_TYPES[typeKey];
    if (!def) return;

    // Spawn from edges
    let x, y;
    const side = Math.floor(Math.random() * 4);
    if (side === 0) { x = -ENEMY_SPAWN_MARGIN; y = Math.random() * H; }
    else if (side === 1) { x = W + ENEMY_SPAWN_MARGIN; y = Math.random() * H; }
    else if (side === 2) { x = Math.random() * W; y = -ENEMY_SPAWN_MARGIN; }
    else { x = Math.random() * W; y = H + ENEMY_SPAWN_MARGIN; }

    enemies.push({
      x, y,
      hp: def.hp * hpScale,
      maxHp: def.hp * hpScale,
      speed: def.speed * speedScale,
      size: def.size,
      color: def.color,
      score: def.score,
      xp: def.xp,
      type: typeKey,
      emoji: def.emoji,
      name: def.name,
      hitFlash: 0,
      isFriend: false,
    });
  }

  function spawnFriendBoss(char, hpScale) {
    let x, y;
    const side = Math.floor(Math.random() * 4);
    if (side === 0) { x = -ENEMY_SPAWN_MARGIN; y = Math.random() * H; }
    else if (side === 1) { x = W + ENEMY_SPAWN_MARGIN; y = Math.random() * H; }
    else if (side === 2) { x = Math.random() * W; y = -ENEMY_SPAWN_MARGIN; }
    else { x = Math.random() * W; y = H + ENEMY_SPAWN_MARGIN; }

    enemies.push({
      x, y,
      hp: 150 * hpScale,
      maxHp: 150 * hpScale,
      speed: 1.2,
      size: 36,
      color: '#ff4444',
      score: 75,
      xp: 8,
      type: 'friend',
      emoji: '',
      name: char.name,
      charId: char.id,
      hitFlash: 0,
      isFriend: true,
    });
  }

  // --- BULLETS ---
  function fireBullet() {
    if (!player) return;
    const now = performance.now();
    const rate = BASE_FIRE_RATE * player.fireRateMult;
    if (now - lastFireTime < rate) return;
    lastFireTime = now;

    // Find nearest enemy
    let nearest = null;
    let nearDist = Infinity;
    for (const e of enemies) {
      const dx = e.x - player.x;
      const dy = e.y - player.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < nearDist) { nearDist = d; nearest = e; }
    }

    let angle;
    if (nearest) {
      angle = Math.atan2(nearest.y - player.y, nearest.x - player.x);
    } else {
      angle = player.aimAngle;
    }
    player.aimAngle = angle;

    const spread = player.projectiles > 1 ? 0.3 : 0;
    for (let i = 0; i < player.projectiles; i++) {
      let a = angle;
      if (player.projectiles > 1) {
        a = angle - spread / 2 + (spread / (player.projectiles - 1)) * i;
      }
      bullets.push({
        x: player.x,
        y: player.y,
        vx: Math.cos(a) * BULLET_SPEED,
        vy: Math.sin(a) * BULLET_SPEED,
        size: player.bulletSize,
        damage: player.damage,
        life: 80,
      });
    }
  }

  // --- PARTICLES ---
  function spawnParticles(x, y, color, count, speed) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = (0.5 + Math.random()) * (speed || 3);
      particles.push({
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        size: 2 + Math.random() * 3,
        color,
        life: 20 + Math.random() * 20,
        maxLife: 40,
      });
    }
  }

  function spawnXpGem(x, y, value) {
    xpGems.push({
      x: x + (Math.random() - 0.5) * 10,
      y: y + (Math.random() - 0.5) * 10,
      value,
      size: 4 + value,
    });
  }

  function addFloatingText(x, y, text, color, big) {
    floatingTexts.push({
      x, y,
      text,
      color: color || '#fff',
      life: 40,
      maxLife: 40,
      vy: -2,
      size: big ? 20 : 14,
    });
  }

  // --- SCREEN SHAKE ---
  function shake(amount) {
    shakeAmount = Math.min(shakeAmount + amount, 15);
  }

  // --- HAPTIC ---
  function haptic(ms) {
    if (navigator.vibrate) navigator.vibrate(ms || 10);
  }

  // --- SCREENS ---
  const screens = {
    title: document.getElementById('title-screen'),
    select: document.getElementById('select-screen'),
    upgrade: document.getElementById('upgrade-screen'),
    gameover: document.getElementById('gameover-screen'),
  };
  const hud = document.getElementById('hud');

  function showScreen(name) {
    for (const [k, el] of Object.entries(screens)) {
      el.classList.toggle('hidden', k !== name);
    }
    hud.classList.toggle('visible', name === null);
  }

  // --- CHARACTER SELECT ---
  function buildCharGrid() {
    const grid = document.getElementById('char-grid');
    grid.innerHTML = '';
    for (const c of CHARACTERS) {
      const cell = document.createElement('div');
      cell.className = 'char-cell';
      cell.dataset.id = c.id;

      const img = document.createElement('img');
      img.src = `../assets/pngs/${c.id}_xmas.png`;
      img.alt = c.name;
      img.loading = 'eager';
      cell.appendChild(img);

      const name = document.createElement('div');
      name.className = 'char-name';
      name.textContent = c.name;
      cell.appendChild(name);

      cell.addEventListener('click', () => selectCharacter(c, cell));
      grid.appendChild(cell);
    }
  }

  function selectCharacter(char, cell) {
    selectedChar = char;
    document.querySelectorAll('.char-cell').forEach(c => c.classList.remove('selected'));
    cell.classList.add('selected');
    haptic(15);
    setTimeout(() => startGame(), 400);
  }

  // --- WAVE ANNOUNCE ---
  const waveAnnounceEl = document.getElementById('wave-announce');
  function announceWave(w) {
    waveAnnounceEl.textContent = w === 1 ? 'SURVIVE' : `WAVE ${w}`;
    waveAnnounceEl.style.opacity = '1';
    waveAnnounceEl.style.transform = 'translate(-50%,-50%) scale(1.5)';
    waveAnnounceEl.style.transition = 'none';
    requestAnimationFrame(() => {
      waveAnnounceEl.style.transition = 'opacity 1.5s ease, transform 1.5s ease';
      waveAnnounceEl.style.opacity = '0';
      waveAnnounceEl.style.transform = 'translate(-50%,-50%) scale(1)';
    });
  }

  // --- START GAME ---
  function startGame() {
    player = createPlayer();
    enemies = [];
    bullets = [];
    particles = [];
    xpGems = [];
    floatingTexts = [];
    wave = 1;
    score = 0;
    gameTime = 0;
    lastFireTime = 0;
    killedBy = null;
    shakeAmount = 0;
    startWave(1);
    showScreen(null);
    state = 'PLAYING';
    announceWave(1);
  }

  function startWave(w) {
    wave = w;
    const config = getWaveConfig(w);
    enemiesTotal = config.count + (config.friendBoss ? 1 : 0);
    enemiesSpawned = 0;
    enemiesRemaining = enemiesTotal;
    spawnTimer = 0;

    document.getElementById('hud-wave').textContent = `WAVE ${w}`;
  }

  // --- UPGRADE SCREEN ---
  function showUpgrades() {
    state = 'UPGRADING';
    // Pick 3 random upgrades
    const shuffled = [...UPGRADES].sort(() => Math.random() - 0.5);
    const picks = shuffled.slice(0, 3);

    const container = document.getElementById('upgrade-cards');
    container.innerHTML = '';
    for (const up of picks) {
      const card = document.createElement('div');
      card.className = 'upgrade-card';
      card.innerHTML = `
        <div class="upgrade-icon">${up.icon}</div>
        <div class="upgrade-label">${up.label}</div>
        <div class="upgrade-desc">${up.desc}</div>
      `;
      card.addEventListener('click', () => {
        up.apply(player);
        haptic(20);
        showScreen(null);
        wave++;
        startWave(wave);
        state = 'PLAYING';
        announceWave(wave);
      });
      container.appendChild(card);
    }
    showScreen('upgrade');
  }

  // --- GAME OVER ---
  function gameOver() {
    state = 'GAME_OVER';
    const time = Math.floor(gameTime / 1000);
    document.getElementById('go-score').textContent = score;

    // Roast
    let roast = ROASTS[Math.floor(Math.random() * ROASTS.length)];
    roast = roast.replace('{wave}', wave).replace('{score}', score).replace('{time}', time);
    document.getElementById('go-roast').textContent = roast;

    // Killed by
    if (killedBy) {
      document.getElementById('go-killer').textContent = killedBy.isFriend
        ? `Killed by ${killedBy.name}'s ghost`
        : `Killed by a ${killedBy.name}`;
    } else {
      document.getElementById('go-killer').textContent = '';
    }

    showScreen('gameover');
  }

  // --- INPUT ---
  function onTouchStart(e) {
    if (state === 'TITLE') {
      showScreen('select');
      state = 'SELECT';
      return;
    }
    if (state !== 'PLAYING') return;
    e.preventDefault();
    const t = e.touches[0];
    joystick.active = true;
    joystick.startX = t.clientX;
    joystick.startY = t.clientY;
    joystick.currentX = t.clientX;
    joystick.currentY = t.clientY;
    joystick.dx = 0;
    joystick.dy = 0;
  }

  function onTouchMove(e) {
    if (!joystick.active || state !== 'PLAYING') return;
    e.preventDefault();
    const t = e.touches[0];
    joystick.currentX = t.clientX;
    joystick.currentY = t.clientY;

    let dx = joystick.currentX - joystick.startX;
    let dy = joystick.currentY - joystick.startY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > JOYSTICK_MAX_RADIUS) {
      dx = (dx / dist) * JOYSTICK_MAX_RADIUS;
      dy = (dy / dist) * JOYSTICK_MAX_RADIUS;
    }

    if (dist < JOYSTICK_DEAD_ZONE) {
      joystick.dx = 0;
      joystick.dy = 0;
    } else {
      joystick.dx = dx / JOYSTICK_MAX_RADIUS;
      joystick.dy = dy / JOYSTICK_MAX_RADIUS;
    }
  }

  function onTouchEnd(e) {
    joystick.active = false;
    joystick.dx = 0;
    joystick.dy = 0;
  }

  // Title screen tap
  window._onTitleTap = function () {
    if (state === 'TITLE') {
      showScreen('select');
      state = 'SELECT';
    }
  };
  screens.title.addEventListener('touchstart', function (e) {
    e.preventDefault();
    window._onTitleTap();
  }, { passive: false });

  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd, { passive: false });
  canvas.addEventListener('touchcancel', onTouchEnd);

  // Mouse fallback for desktop testing
  let mouseDown = false;
  canvas.addEventListener('mousedown', e => {
    if (state === 'TITLE') { showScreen('select'); state = 'SELECT'; return; }
    if (state !== 'PLAYING') return;
    mouseDown = true;
    joystick.active = true;
    joystick.startX = e.clientX;
    joystick.startY = e.clientY;
    joystick.dx = 0;
    joystick.dy = 0;
  });
  canvas.addEventListener('mousemove', e => {
    if (!mouseDown || state !== 'PLAYING') return;
    let dx = e.clientX - joystick.startX;
    let dy = e.clientY - joystick.startY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > JOYSTICK_MAX_RADIUS) { dx = (dx / dist) * JOYSTICK_MAX_RADIUS; dy = (dy / dist) * JOYSTICK_MAX_RADIUS; }
    if (dist < JOYSTICK_DEAD_ZONE) { joystick.dx = 0; joystick.dy = 0; }
    else { joystick.dx = dx / JOYSTICK_MAX_RADIUS; joystick.dy = dy / JOYSTICK_MAX_RADIUS; }
  });
  canvas.addEventListener('mouseup', () => { mouseDown = false; joystick.active = false; joystick.dx = 0; joystick.dy = 0; });

  // Retry button
  document.getElementById('btn-retry').addEventListener('click', () => {
    haptic(15);
    startGame();
  });

  // --- UPDATE ---
  function update(dt) {
    if (state !== 'PLAYING' || !player) return;

    gameTime += dt;

    // Player movement
    const speed = PLAYER_SPEED * player.speedMult;
    player.x += joystick.dx * speed;
    player.y += joystick.dy * speed;
    player.x = Math.max(player.size, Math.min(W - player.size, player.x));
    player.y = Math.max(player.size, Math.min(H - player.size, player.y));

    // Invincibility
    if (player.invincibleTimer > 0) player.invincibleTimer -= dt;

    // Auto-fire
    fireBullet();

    // Spawn enemies
    const config = getWaveConfig(wave);
    spawnTimer -= dt;
    if (spawnTimer <= 0 && enemiesSpawned < config.count) {
      const typeKey = pickEnemyType(config.types);
      spawnEnemy(typeKey, config.hpScale, config.speedScale);
      enemiesSpawned++;
      spawnTimer = Math.max(200, 1000 - wave * 50);
    }
    // Spawn friend boss once midway through the wave
    if (config.friendBoss && enemiesSpawned === Math.floor(config.count / 2) && !enemies.some(e => e.isFriend)) {
      spawnFriendBoss(config.friendBoss, config.hpScale);
    }

    // Update enemies
    for (const e of enemies) {
      const dx = player.x - e.x;
      const dy = player.y - e.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0) {
        e.x += (dx / dist) * e.speed;
        e.y += (dy / dist) * e.speed;
      }
      if (e.hitFlash > 0) e.hitFlash -= dt;

      // Collision with player
      if (dist < player.size + e.size * 0.6 && player.invincibleTimer <= 0) {
        const dmg = 8 + wave * 2;
        player.hp -= dmg;
        player.invincibleTimer = 300;
        shake(4);
        haptic(30);
        addFloatingText(player.x, player.y - 20, `-${dmg}`, '#ff4444', false);
        spawnParticles(player.x, player.y, '#ff4444', 5, 2);

        if (player.hp <= 0) {
          player.hp = 0;
          killedBy = e;
          shake(10);
          haptic(50);
          spawnParticles(player.x, player.y, '#ff4444', 20, 5);
          gameOver();
          return;
        }
      }
    }

    // Update bullets
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx;
      b.y += b.vy;
      b.life--;

      if (b.life <= 0 || b.x < -50 || b.x > W + 50 || b.y < -50 || b.y > H + 50) {
        bullets.splice(i, 1);
        continue;
      }

      // Hit enemies
      for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j];
        const dx = b.x - e.x;
        const dy = b.y - e.y;
        if (dx * dx + dy * dy < (b.size + e.size) * (b.size + e.size)) {
          e.hp -= b.damage;
          e.hitFlash = 100;
          bullets.splice(i, 1);

          addFloatingText(e.x, e.y - e.size, Math.round(b.damage).toString(), '#fff', false);
          spawnParticles(b.x, b.y, e.color, 3, 2);

          if (e.hp <= 0) {
            score += e.score;
            enemiesRemaining--;
            spawnParticles(e.x, e.y, e.color, 10, 4);
            spawnXpGem(e.x, e.y, e.xp);
            addFloatingText(e.x, e.y - e.size - 10, `+${e.score}`, '#ffd700', true);
            if (e.size >= 30) shake(6);
            else shake(2);
            haptic(15);
            enemies.splice(j, 1);
          }
          break;
        }
      }
    }

    // Update XP gems
    for (let i = xpGems.length - 1; i >= 0; i--) {
      const g = xpGems[i];
      const dx = player.x - g.x;
      const dy = player.y - g.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < player.magnetRange) {
        const speed = XP_ATTRACT_SPEED * (1 - dist / player.magnetRange + 0.3);
        g.x += (dx / dist) * speed;
        g.y += (dy / dist) * speed;
      }

      if (dist < player.size) {
        player.xp += g.value;
        xpGems.splice(i, 1);
      }
    }

    // Update particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.95;
      p.vy *= 0.95;
      p.life--;
      if (p.life <= 0) particles.splice(i, 1);
    }

    // Update floating texts
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
      const t = floatingTexts[i];
      t.y += t.vy;
      t.life--;
      if (t.life <= 0) floatingTexts.splice(i, 1);
    }

    // Update HUD
    document.getElementById('hud-score').textContent = score;
    document.getElementById('hp-fill').style.width = `${(player.hp / player.maxHp) * 100}%`;

    // Screen shake decay
    shakeAmount *= shakeDecay;
    if (shakeAmount < 0.5) shakeAmount = 0;

    // Check wave complete
    if (enemiesRemaining <= 0 && enemiesSpawned >= getWaveConfig(wave).count) {
      showUpgrades();
    }
  }

  // --- RENDER ---
  function render() {
    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = '#1a0a2e';
    ctx.fillRect(0, 0, W, H);

    if (state === 'LOADING' || state === 'TITLE' || state === 'SELECT') return;
    if (!player) return;

    // Apply screen shake
    ctx.save();
    if (shakeAmount > 0) {
      const sx = (Math.random() - 0.5) * shakeAmount * 2;
      const sy = (Math.random() - 0.5) * shakeAmount * 2;
      ctx.translate(sx, sy);
    }

    // Arena floor - subtle grid
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    const gridSize = 50;
    for (let x = 0; x < W; x += gridSize) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += gridSize) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // XP gems
    for (const g of xpGems) {
      ctx.fillStyle = '#4fc3f7';
      ctx.shadowColor = '#4fc3f7';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Bullets
    ctx.fillStyle = '#ffdd44';
    ctx.shadowColor = '#ffdd44';
    ctx.shadowBlur = 6;
    for (const b of bullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    // Enemies
    for (const e of enemies) {
      ctx.save();
      ctx.translate(e.x, e.y);

      if (e.isFriend && images[e.charId + '_gone']) {
        // Draw friend character image
        const img = images[e.charId + '_gone'];
        const s = e.size * 2;
        if (e.hitFlash > 0) {
          ctx.globalAlpha = 0.6;
          ctx.filter = 'brightness(3)';
        }
        ctx.drawImage(img, -s / 2, -s / 2, s, s);
        ctx.filter = 'none';
        ctx.globalAlpha = 1;

        // Name tag
        ctx.fillStyle = '#ff4444';
        ctx.font = `bold ${Math.max(10, e.size * 0.35)}px system-ui`;
        ctx.textAlign = 'center';
        ctx.fillText(e.name, 0, -e.size - 4);
      } else {
        // Draw colored circle body
        const flash = e.hitFlash > 0;
        if (flash) {
          ctx.shadowColor = '#fff';
          ctx.shadowBlur = 15;
        }
        ctx.fillStyle = flash ? '#fff' : e.color;
        ctx.beginPath();
        ctx.arc(0, 0, e.size, 0, Math.PI * 2);
        ctx.fill();

        // Inner highlight
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.beginPath();
        ctx.arc(-e.size * 0.2, -e.size * 0.25, e.size * 0.5, 0, Math.PI * 2);
        ctx.fill();

        // Emoji overlay
        ctx.font = `${e.size * 1.2}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(e.emoji, 0, 2);
        ctx.shadowBlur = 0;
      }

      // HP bar for big enemies
      if (e.maxHp >= 50 && e.hp < e.maxHp) {
        const bw = e.size * 1.5;
        const bh = 3;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(-bw / 2, e.size + 4, bw, bh);
        ctx.fillStyle = '#ff4444';
        ctx.fillRect(-bw / 2, e.size + 4, bw * (e.hp / e.maxHp), bh);
      }

      ctx.restore();
    }

    // Player
    ctx.save();
    ctx.translate(player.x, player.y);

    // Invincibility flash
    if (player.invincibleTimer > 0 && Math.floor(player.invincibleTimer / 50) % 2) {
      ctx.globalAlpha = 0.4;
    }

    // Draw player character
    const charImg = images[selectedChar.id + '_xmas'];
    if (charImg) {
      const s = player.size * 2.2;
      ctx.drawImage(charImg, -s / 2, -s / 2, s, s);
    } else {
      ctx.fillStyle = '#4fc3f7';
      ctx.beginPath();
      ctx.arc(0, 0, player.size, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;

    // Aim indicator
    ctx.strokeStyle = 'rgba(255,221,68,0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(
      Math.cos(player.aimAngle) * (player.size + 5),
      Math.sin(player.aimAngle) * (player.size + 5)
    );
    ctx.lineTo(
      Math.cos(player.aimAngle) * (player.size + 18),
      Math.sin(player.aimAngle) * (player.size + 18)
    );
    ctx.stroke();

    ctx.restore();

    // Particles
    for (const p of particles) {
      const alpha = p.life / p.maxLife;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Floating texts
    for (const t of floatingTexts) {
      const alpha = t.life / t.maxLife;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = t.color;
      ctx.font = `bold ${t.size}px system-ui`;
      ctx.textAlign = 'center';
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;

    // Joystick visual
    if (joystick.active && state === 'PLAYING') {
      // Base
      ctx.beginPath();
      ctx.arc(joystick.startX, joystick.startY, JOYSTICK_MAX_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Nub
      const nx = joystick.startX + joystick.dx * JOYSTICK_MAX_RADIUS;
      const ny = joystick.startY + joystick.dy * JOYSTICK_MAX_RADIUS;
      ctx.beginPath();
      ctx.arc(nx, ny, 20, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fill();
    }

    ctx.restore();
  }

  // --- GAME LOOP ---
  function gameLoop(timestamp) {
    dt = Math.min(timestamp - (lastTime || timestamp), 50);
    lastTime = timestamp;

    update(dt);
    render();
    requestAnimationFrame(gameLoop);
  }

  // --- INIT ---
  // Expose for testing
  window._gameState = () => ({ state, player, wave, score, enemies: enemies.length, gameTime });

  loadAllImages().then(() => {
    buildCharGrid();
    state = 'TITLE';
    showScreen('title');
    requestAnimationFrame(gameLoop);
  });
})();
