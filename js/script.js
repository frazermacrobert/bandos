// Find the startGame() function and update the player initialization section:

function startGame() {
  S.log = [];
  S.round = 1;
  S.players = [];
  S.suspicion = {};
  S.alive = new Set();
  S.eliminated = new Set();
  S.traitors = new Set();
  S.elimReason = {};
  S.usedActionIds = new Set();
  S.history = {};

  const you = S.allEmployees.find((e) => e.id === S.youId);
  const others = seededShuffle(
    S.allEmployees.filter((e) => e.id !== S.youId),
    S.rng
  ).slice(0, 9);
  const roster = [you, ...others];

  S.players = roster.map((e) => {
    const avatarName = S.christmasMode ? `${e.id}_xmas` : e.id;
    // FIX: Use _gone.png instead of -sad.png
    const goneAvatarName = S.christmasMode ? `${e.id}_xmas_gone` : `${e.id}_gone`;
    
    return {
      id: e.id,
      name: e.name,
      department: e.department,
      influence: defaultInfluence(e.department),
      behaviour: defaultBehaviour(e.department),
      role: "Innocent",
      status: "Alive",
      avatar: `assets/pngs/${avatarName}.png`,
      avatarGone: `assets/gone/${goneAvatarName}.png`, // FIXED: Changed from avatarSad
      avatarTraitor: `assets/pngs/traitor-revealed.png`
    };
  });

  document.body.classList.toggle("christmas-mode", S.christmasMode);

  S.players.forEach((p) => {
    S.alive.add(p.id);
    S.history[p.id] = [];
  });

  const botIds = S.players.map((p) => p.id).filter((id) => id !== S.youId);
  seededShuffle(botIds, S.rng)
    .slice(0, S.numTraitors)
    .forEach((id) => S.traitors.add(id));
  S.players.forEach((p) => {
    if (S.traitors.has(p.id)) p.role = "Traitor";
  });

  S.players.forEach((p) => (S.suspicion[p.id] = 0));

  S.availableScenarios = [...S.scenarios];
  seededShuffle(S.availableScenarios, S.rng);

  logLine(`Game started. Traitors assigned. Difficulty: ${S.difficulty}.`);
  renderAll();
  nextRound();
  document.body.dataset.gameReady = "true";
}

// Also update the eliminate() function to use avatarGone:

function eliminate(id, wasTraitorFlag, reason) {
  if (!S.alive.has(id)) return;

  S.alive.delete(id);
  S.eliminated.add(id);
  S.elimReason[id] = reason;

  const p = S.players.find((x) => x.id === id);
  p.status = "Eliminated";

  const card = document.querySelector(`.player-card[data-id="${id}"]`);
  if (card) {
    card.classList.add("eliminated");
    card.classList.toggle("traitor", S.traitors.has(id));
    card.classList.toggle("innocent", !S.traitors.has(id));
    card.classList.remove("by-vote", "by-traitors");
    card.classList.add(reason === "NightStrike" ? "by-traitors" : "by-vote");

    const img = card.querySelector("img");
    // FIXED: Use avatarGone instead of avatarSad
    if (img) img.src = p.avatarGone;

    const x = card.querySelector(".xmark");
    if (x) x.textContent = "✕";
  }

  const msg = S.elimMsgs[p.department] || `${p.department} in turmoil.`;
  if (reason === "NightStrike") logLine(`${msg}`);
}

// Also update renderTopbar() function:

function renderTopbar() {
  const top = document.getElementById("topbar");
  top.innerHTML = S.players
    .map((p) => {
      const cls = ["player-card"];
      if (S.eliminated.has(p.id)) cls.push("eliminated");
      if (S.eliminated.has(p.id)) {
        cls.push(S.traitors.has(p.id) ? "traitor" : "innocent");
        cls.push(S.elimReason[p.id] === "NightStrike" ? "by-traitors" : "by-vote");
      }
      const tag = p.id === S.youId ? `<div class="tag">You</div>` : "";
      // FIXED: Use avatarGone instead of avatarSad
      const img = S.eliminated.has(p.id) ? p.avatarGone : p.avatar;
      return `
        <div class="${cls.join(" ")}" data-id="${p.id}">
          ${tag}
          <img src="${img}" alt="${p.name} avatar">
          <div class="name">${p.name}</div>
          <div class="xmark">✕</div>
        </div>
      `;
    })
    .join("");
}

// Also update the doScenarioPhase() function where it shows the explanation overlay:

function doScenarioPhase() {
  const container = document.getElementById("scenario");

  if (S.availableScenarios.length === 0) {
    if (S.scenarios.length > 0) {
      logLine("Reshuffling scenarios for a new round.");
      S.availableScenarios = [...S.scenarios];
      seededShuffle(S.availableScenarios, S.rng);
    }
  }

  S.currentScenario = S.availableScenarios.pop();
  const sc = S.currentScenario;

  if (!sc) {
    container.innerHTML = `<h2>Scenario</h2><div class="note">No scenarios available.</div>`;
    return;
  }

  container.innerHTML = `
    <h2>Scenario</h2>
    <div>${sc.prompt}</div>
    ${sc.options
      .map((opt, i) => {
        const letter = String.fromCharCode(65 + i);
        return `<label class="option">
          <input type="radio" name="scopt" value="${letter}">
          <strong>${letter}.</strong> ${opt}
        </label>`;
      })
      .join("")}
    <div class="scenario-actions" style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;">
      <button id="openLogBtn" class="btn secondary">Open Game Log</button>
      <button id="restartBtn" class="btn secondary">Restart game</button>
      <button id="answerBtn" class="btn">Submit</button>
    </div>
  `;

  document.getElementById("openLogBtn").onclick = openLogModal;
  document.getElementById("restartBtn").onclick = () => location.reload();
  const submitBtn = document.getElementById("answerBtn");

  submitBtn.onclick = () => {
    if (submitBtn.disabled) return;

    const sel = document.querySelector('input[name="scopt"]:checked');
    if (!sel) {
      submitBtn.classList.add("shake");
      setTimeout(() => submitBtn.classList.remove("shake"), 300);
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Submitted";

    const pick = sel.value;

    if (pick === sc.correct) {
      document.getElementById("actions").classList.remove("is-disabled");
      logLine(`Scenario answered correctly.`);
      if (S.analysis) logLine(`Analysis: ${sc.rationale_correct}`);
      doActionsPhase();
    } else {
      logLine(`Scenario wrong: You picked ${pick}.`);
      if (S.analysis) logLine(`Analysis: ${sc.rationale_wrong}`);

      const you = S.players.find((p) => p.id === S.youId);
      // FIXED: Use avatarGone instead of avatarSad
      const goneAvatarUrl = you ? you.avatarGone : "";

      const explainDiv = document.createElement("div");
      explainDiv.className = "explain-overlay";
      explainDiv.innerHTML = `
        <div class="explain-dialog with-character">
          <img src="${goneAvatarUrl}" alt="Your character, eliminated" class="explain-character-avatar">
          <div class="explain-text">
            <h3>Why that was unsafe</h3>
            <p>${sc.rationale_wrong}</p>
            <button id="continueBtn" class="btn">Continue</button>
          </div>
        </div>
      `;
      document.body.appendChild(explainDiv);

      document.getElementById("continueBtn").onclick = () => {
        explainDiv.remove();
        eliminate(S.youId, false, "VotedOut");
        renderAll();
        revealTraitors();
        announce(`Your mistake led to your elimination. You lose.`);
      };
    }
  };
}

// Also update the announce() function:

function announce(msg) {
  const scenario = document.getElementById("scenario");
  const isWin = msg.includes("win");
  const you = S.players.find((p) => p.id === S.youId);

  let character;
  const alivePlayers = S.players.filter((p) => S.alive.has(p.id));

  if (isWin) {
    const innocentSurvivors = alivePlayers.filter(
      (p) => !S.traitors.has(p.id) && p.id !== S.youId
    );
    character = pickRandom(
      innocentSurvivors.length > 0 ? innocentSurvivors : alivePlayers,
      S.rng
    );
  } else {
    const traitorSurvivors = alivePlayers.filter((p) => S.traitors.has(p.id));
    character = pickRandom(
      traitorSurvivors.length > 0 ? traitorSurvivors : alivePlayers,
      S.rng
    );
  }

  const messageData = S.endGameMessages.find((m) => m.id === character.id);
  const message = messageData ? (isWin ? messageData.win : messageData.lose) : msg;

  // FIXED: Use avatarGone instead of avatarSad for losses
  const playerAvatar = isWin ? you.avatar : you.avatarGone;
  const characterAvatar = S.traitors.has(character.id) ? character.avatarTraitor : character.avatar;

  const traitorNames = S.players.filter((p) => S.traitors.has(p.id)).map((p) => p.name);
  const traitorList = traitorNames.length
    ? `<div class="note" style="margin-top:12px;"><strong>The traitors were:</strong> ${traitorNames.join(", ")}.</div>`
    : "";

  scenario.innerHTML = `
    <div class="end-game-modal">
      <div class="avatars">
        <img src="${playerAvatar}" alt="Your avatar">
        <img src="${characterAvatar}" alt="${character.name}'s avatar">
      </div>
      <div class="message">
        <h3>${character.name} says:</h3>
        <p>"${message}"</p>
        ${traitorList}
        <div class="footer">
          <button class="btn" onclick="location.reload()">Play Again</button>
        </div>
      </div>
    </div>`;
}

// Also update the image preloading section in DOMContentLoaded:

window.addEventListener("DOMContentLoaded", async () => {
    const startModal = document.getElementById("startModal");
    const optionsModal = document.getElementById("optionsModal");
    const howToPlayModal = document.getElementById("howToPlayModal");
    const infoModal = document.getElementById("infoModal");
    const playerSelect = document.getElementById("playerSelect");
    const characterImage = document.getElementById("character-preview-image");
    const startGameBtn = document.getElementById("startGameBtn");

    startGameBtn.textContent = 'Loading...';
    startGameBtn.disabled = true;

    await loadData();

    // --- Image Preloading ---
    const imageUrls = [
      'assets/cyberteurs.png',
      'assets/favicon.png',
      'assets/bg_office.jpg',
      'assets/bg_xmas.jpg',
      'assets/bg_polish.jpg',
      'assets/pngs/traitor-revealed.png'
    ];
    S.allEmployees.forEach(e => {
      imageUrls.push(`assets/pngs/${e.id}.png`);
      // FIXED: Use _gone.png instead of -sad.png
      imageUrls.push(`assets/gone/${e.id}_gone.png`);
      imageUrls.push(`assets/pngs/${e.id}_xmas.png`);
      // FIXED: Also preload Christmas gone variants if they exist
      imageUrls.push(`assets/gone/${e.id}_xmas_gone.png`);
    });
    const uniqueImageUrls = [...new Set(imageUrls)];
    await preloadImages(uniqueImageUrls);

    startGameBtn.textContent = 'Start Game';
    startGameBtn.disabled = false;
    // --- End Preloading ---

    // ... rest of the DOMContentLoaded code remains the same
});