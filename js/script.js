// Seeded RNG + helpers
function mulberry32(a) {
  return function () {
    var t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickRandom(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

function weightedPick(items, weights, rng) {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  let r = rng() * sum;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// ---- Scenario normalizer (accepts both shapes) ----
function normalizeScenario(raw) {
  if (!raw) return null;

  let options = Array.isArray(raw.options)
    ? raw.options.slice(0, 3)
    : [raw.option_a, raw.option_b, raw.option_c].filter(Boolean);

  if (!options || options.length !== 3) {
    console.warn("Scenario skipped due to invalid options:", raw);
    return null;
  }

  let correct = raw.correct;
  if (typeof correct === "number") {
    correct = ["A", "B", "C"][correct] || "A";
  }
  if (typeof correct === "string") {
    correct = correct.trim().toUpperCase();
    if (!["A", "B", "C"].includes(correct)) correct = "A";
  } else {
    correct = "A";
  }

  const rationale_correct =
    raw.rationale_correct || raw.rationaleCorrect || "Good call.";
  const rationale_wrong =
    raw.rationale_wrong ||
    raw.rationaleWrong ||
    "That creates risk — try again next time.";

  return {
    id: raw.id || "",
    prompt: raw.prompt || "",
    options,
    correct,
    rationale_correct,
    rationale_wrong
  };
}

const DIFF = {
  Easy: {
    innocent_error: 0.04,
    traitor_rate: 0.5,
    influence_scale: 0.7,
    vote_noise: 0.05,
    pattern_clarity: 1.0
  },
  Medium: {
    innocent_error: 0.12,
    traitor_rate: 0.4,
    influence_scale: 0.5,
    vote_noise: 0.12,
    pattern_clarity: 0.7
  },
  Hard: {
    innocent_error: 0.2,
    traitor_rate: 0.3,
    influence_scale: 0.3,
    vote_noise: 0.18,
    pattern_clarity: 0.5
  }
};

function defaultInfluence(d) {
  const m = {
    CEO: 0.75,
    CFO: 0.68,
    "Exec Assistant": 0.65,
    "Project Management": 0.62,
    Consultant: 0.6,
    Finance: 0.56,
    HR: 0.56,
    Legal: 0.56,
    Design: 0.52,
    Content: 0.52,
    Motion: 0.52,
    Ops: 0.54,
    Marketing: 0.54,
    "Business Development": 0.54,
    IT: 0.58
  };
  return m[d] ?? 0.55;
}

function defaultBehaviour(d) {
  const b = { safe: 0.7, risky: 0.2, decoy: 0.1 };
  if (d === "Finance") return { safe: 0.6, risky: 0.3, decoy: 0.1 };
  if (d === "Design" || d === "Content" || d === "Motion")
    return { safe: 0.65, risky: 0.2, decoy: 0.15 };
  if (d === "Project Management") return { safe: 0.62, risky: 0.25, decoy: 0.13 };
  return b;
}

const S = {
  allEmployees: [],
  actions: [],
  scenarios: [],
  availableScenarios: [],
  elimMsgs: {},
  endGameMessages: [],
  players: [],
  round: 0,
  rng: Math.random,
  youId: null,
  traitors: new Set(),
  analysis: true,
  difficulty: "Medium",
  numTraitors: 3,
  log: [],
  suspicion: {},
  alive: new Set(),
  eliminated: new Set(),
  elimReason: {},
  // anti-repetition state
  usedActionIds: new Set(),
  history: {},
  historyWindow: 3
};

async function loadData() {
  const [emps, acts, scens, elim, endGameMessages] = await Promise.all([
    fetch("data/employees.json").then((r) => r.json()),
    fetch("data/actions.json").then((r) => r.json()),
    fetch("data/scenarios.json").then((r) => r.json()),
    fetch("data/elimination_msgs.json").then((r) => r.json()),
    fetch("data/end_game_messages.json").then((r) => r.json())
  ]);

  S.allEmployees = emps;
  S.actions = acts;
  S.scenarios = (Array.isArray(scens) ? scens : [])
    .map(normalizeScenario)
    .filter(Boolean);

  if (!S.scenarios.length) {
    console.error("Scenario data error: 0 valid scenarios after normalization.");
    alert("No valid scenarios found. Please check data/scenarios.json formatting.");
  }

  S.elimMsgs = elim;
  S.endGameMessages = endGameMessages;

  // validate action buckets
  const VALID = new Set(["safe", "risky_innocent", "traitor_sabotage", "decoy", "red_herring"]);
  const bad = S.actions.filter((a) => !VALID.has(a.bucket));
  if (bad.length) logLine(`Data warning: unknown action buckets -> ${bad.map((b) => b.id).join(", ")}`);

  populatePlayerSelect(emps);
}

function populatePlayerSelect(emps) {
  const sel = document.getElementById("playerSelect");
  sel.innerHTML = emps
    .map(
      (e) => `<option value="${e.id}">${e.name} — ${e.department}</option>`
    )
    .join("");
}

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

  S.players = roster.map((e) => ({
    id: e.id,
    name: e.name,
    department: e.department,
    influence: defaultInfluence(e.department),
    behaviour: defaultBehaviour(e.department),
    role: "Innocent",
    status: "Alive",
    avatar: `assets/pngs/${e.id}.png`,
    avatarSad: `assets/gone/${e.id}-sad.png`,
    avatarTraitor: `assets/pngs/traitor-revealed.png`
  }));

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

  // set up scenario pool
  S.availableScenarios = [...S.scenarios];
  seededShuffle(S.availableScenarios, S.rng); // shuffle once at the start

  logLine(`Game started. Traitors assigned. Difficulty: ${S.difficulty}.`);
  renderAll();
  nextRound();
  document.body.dataset.gameReady = "true";
}

function nextRound() {
  if (checkEnd()) return;
  S.usedActionIds.clear();
  Object.keys(S.suspicion).forEach((id) => {
    S.suspicion[id] = (S.suspicion[id] || 0) * 0.9;
  });
  renderRoundInfo();
  doScenarioPhase();
}

function checkEnd() {
  const alivePlayers = [...S.alive].map((id) => S.players.find((p) => p.id === id));
  const aliveTraitors = alivePlayers.filter((p) => S.traitors.has(p.id)).length;

  if (!S.alive.has(S.youId)) {
    revealTraitors();
    announce(`You were eliminated. Traitors win.`);
    return true;
  }
  if (aliveTraitors === 0) {
    revealTraitors();
    announce(`All traitors eliminated. You win!`);
    return true;
  }
  if (aliveTraitors >= alivePlayers.length - aliveTraitors) {
    revealTraitors();
    announce(`Traitors took control. You lose.`);
    return true;
  }
  return false;
}

function doScenarioPhase() {
  const container = document.getElementById("scenario");

  // Anti-repetition: if we're out, reshuffle and start over
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
      // When wrong: show rationale before elimination
      logLine(`Scenario wrong: You picked ${pick}.`);
      if (S.analysis) logLine(`Analysis: ${sc.rationale_wrong}`);

      // Create an overlay message explaining why
      const you = S.players.find((p) => p.id === S.youId);
      const sadAvatarUrl = you ? you.avatarSad : "";

      const explainDiv = document.createElement("div");
      explainDiv.className = "explain-overlay";
      explainDiv.innerHTML = `
        <div class="explain-dialog with-character">
          <img src="${sadAvatarUrl}" alt="Your character, looking sad" class="explain-character-avatar">
          <div class="explain-text">
            <h3>Why that was unsafe</h3>
            <p>${sc.rationale_wrong}</p>
            <button id="continueBtn" class="btn">Continue</button>
          </div>
        </div>
      `;
      document.body.appendChild(explainDiv);

      // Wait for user to acknowledge before elimination
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

// ---------- Action generation with variety ----------
function poolBy(bucket) {
  return S.actions.filter((a) => a.bucket === bucket);
}

function deptMatches(action, dept) {
  if (!action.departments_hint) return false;
  return action.departments_hint
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .includes(dept.toLowerCase());
}

function chooseActionFor(playerId, rng) {
  const p = S.players.find((x) => x.id === playerId);
  const isTraitor = S.traitors.has(playerId);
  const d = DIFF[S.difficulty];

  let candidates = [];
  if (isTraitor) {
    const sabotage = rng() < d.traitor_rate;
    candidates = [sabotage ? "traitor_sabotage" : rng() < 0.5 ? "decoy" : "safe"];
  } else {
    const err = rng() < d.innocent_error;
    candidates = [err ? "risky_innocent" : rng() < p.behaviour.safe ? "safe" : "decoy"];
  }

  const fallback = isTraitor
    ? ["traitor_sabotage", "decoy", "safe", "risky_innocent", "red_herring"]
    : ["safe", "decoy", "risky_innocent", "red_herring", "traitor_sabotage"];

  const tryOrder = [...candidates, ...fallback.filter((b) => !candidates.includes(b))];

  const recent = new Set(S.history[playerId].slice(-S.historyWindow));

  function poolFilter(bucket) {
    const pool = poolBy(bucket).filter(
      (a) => !S.usedActionIds.has(a.id) && !recent.has(a.id)
    );
    if (pool.length) return pool;
    return poolBy(bucket).filter((a) => !S.usedActionIds.has(a.id)) || [];
  }

  for (const b of tryOrder) {
    let pool = poolFilter(b);
    if (pool.length) {
      const weights = pool.map((a) => {
        let w = 1;
        if (deptMatches(a, p.department)) w += 1.25;
        if (a.risk_level === 0 && b === "safe") w += 0.2;
        return w;
      });
      const act = weightedPick(pool, weights, rng);
      return { act, usedBucket: b, fellBack: b !== candidates[0] };
    }
  }

  return {
    act: {
      id: "_stub",
      description: "…did some uneventful work.",
      risk_level: 0,
      actually_suspicious: false
    },
    usedBucket: "safe",
    fellBack: true
  };
}

function doActionsPhase() {
  const aliveIds = [...S.alive];
  const items = [];

  aliveIds
    .filter((id) => id !== S.youId)
    .forEach((id) => {
      const { act, usedBucket, fellBack } = chooseActionFor(id, S.rng);
      if (act.id) S.usedActionIds.add(act.id);

      const h = S.history[id] || (S.history[id] = []);
      h.push(act.id || "_stub");
      if (h.length > S.historyWindow) h.shift();

      const add =
        act.risk_level * 0.8 +
        (act.actually_suspicious ? 1.2 : 0) * DIFF[S.difficulty].pattern_clarity;
      S.suspicion[id] = Math.max(0, (S.suspicion[id] || 0) * 0.75 + add);

      items.push({
        player: id,
        text: act.description,
        risk: act.risk_level,
        suspicious: !!act.actually_suspicious,
        usedBucket,
        fellBack
      });
    });

  const actionsDiv = document.getElementById("actions");
  actionsDiv.innerHTML = `
    <h2>Daily Activity</h2>
    <div class="actions-list">
      ${items
        .map((a) => {
          const cls = S.analysis ? `r${a.risk}` : "neutral";
          const hint = S.analysis
            ? `<div class="note">${
                a.suspicious
                  ? "Looks truly risky."
                  : a.risk > 0
                  ? "May look risky but could be benign."
                  : "Safe."
              }${a.fellBack ? " · (pool fallback used)" : ""}</div>`
            : "";
          return `<div class="action-item ${cls}"><strong>${nameOf(
            a.player
          )}</strong>: ${a.text} ${hint}</div>`;
        })
        .join("")}
    </div>
    <div class="note" style="margin-top:8px">Variety mode is on: actions won’t repeat in the same round and have a short cooldown per player.</div>
  `;

  doVotingPhase();
}

// ---------- Voting ----------
function doVotingPhase() {
  const voting = document.getElementById("voting");
  voting.innerHTML = `
    <h2>Voting</h2>
    <div class="note">Click a player card to cast your vote. Then watch the votes roll in.</div>
    <div class="tally" id="tally"></div>
    <div id="voteFeed" class="note"></div>
  `;

  document.querySelectorAll(".player-card").forEach((card) => {
    const id = card.dataset.id;
    card.querySelector(".vote-bubble")?.remove();
    const vb = document.createElement("div");
    vb.className = "vote-bubble";
    vb.textContent = "0";
    card.appendChild(vb);
    if (S.alive.has(id) && id !== S.youId) {
      card.style.cursor = "pointer";
      card.onclick = () => handlePlayerVote(id);
    } else {
      card.onclick = null;
      card.style.cursor = "default";
    }
  });
}

function renderTally(tally) {
  const t = document.getElementById("tally");
  const entries = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  t.innerHTML = entries
    .map(([id, v]) => `<span class="pill">${nameOf(id)}: ${v}</span>`)
    .join("");

  S.players.forEach((p) => {
    const card = document.querySelector(`.player-card[data-id="${p.id}"]`);
    if (!card) return;
    const vb = card.querySelector(".vote-bubble");
    if (!vb) return;
    const val = tally[p.id] || 0;
    vb.textContent = String(val);
    card.classList.toggle("voting", val > 0);
  });
}

function handlePlayerVote(targetId) {
  document.getElementById("actions").classList.add("is-disabled");
  document.querySelectorAll(".vote-bubble").forEach((v) => (v.textContent = "0"));

  const feed = document.getElementById("voteFeed");
  feed.innerHTML = "";

  const tally = {};

  function addVote(id, who) {
    tally[id] = (tally[id] || 0) + 1;
    renderTally(tally);
    feed.innerHTML += `• ${who} voted ${nameOf(id)}<br>`;
    feed.scrollTop = feed.scrollHeight;
  }

  addVote(targetId, "You");

  const diff = DIFF[S.difficulty];
  const aliveIds = [...S.alive];
  const voters = aliveIds.filter((id) => id !== S.youId);
  const candidates = aliveIds.filter((id) => id !== S.youId);
  const planned = [];

  // EASY/MEDIUM: exactly one traitor must vote for YOU (subtle clue), and no one else may.
  let forcedTraitor = null;
  if (S.youId && (S.difficulty === "Easy" || S.difficulty === "Medium")) {
    const aliveTraitors = voters.filter((id) => S.traitors.has(id));
    if (aliveTraitors.length) {
      forcedTraitor = aliveTraitors[Math.floor(S.rng() * aliveTraitors.length)];
      planned.push({ who: forcedTraitor, vote: S.youId, _forced: true });
    }
  }

  voters.forEach((id) => {
    if (id === forcedTraitor) return; // skip the forced traitor, already planned

    const p = S.players.find((x) => x.id === id);
    const sorted = candidates
      .filter((x) => x !== id)
      .sort((a, b) => (S.suspicion[b] || 0) - (S.suspicion[a] || 0));

    const baseTarget = sorted[0] ?? targetId;
    const follow = S.rng() < p.influence * diff.influence_scale;

    let vote;
    if (follow) {
      vote = targetId;
    } else {
      if (S.rng() < diff.vote_noise) {
        vote = sorted[Math.floor(S.rng() * Math.max(1, sorted.length))] || baseTarget;
      } else {
        vote = baseTarget;
      }
    }

    // EASY/MEDIUM safety: no one else may vote for the player
    if ((S.difficulty === "Easy" || S.difficulty === "Medium") && vote === S.youId) {
      const nonYou = sorted.filter((x) => x !== S.youId);
      vote = nonYou[0] || baseTarget || candidates.find((x) => x !== S.youId) || targetId;
      if (vote === S.youId && nonYou.length > 1) vote = nonYou[1];
    }

    planned.push({ who: id, vote });
  });

  let i = 0;
  (function step() {
    if (i < planned.length) {
      const { who, vote } = planned[i++];
      addVote(vote, nameOf(who));
      setTimeout(step, 550);
    } else {
      // Resolve outcome (with tie detection)
      let maxVotes = -1;
      let eliminated = null;

      Object.entries(tally).forEach(([id, v]) => {
        if (v > maxVotes) {
          maxVotes = v;
          eliminated = id;
        } else if (v === maxVotes) {
          if ((S.suspicion[id] || 0) > (S.suspicion[eliminated] || 0)) eliminated = id;
        }
      });

      const topCount = Math.max(...Object.values(tally));
      const numAtTop = Object.values(tally).filter((v) => v === topCount).length;
      const tieBreakUsed = numAtTop > 1;

      const isTraitor = S.traitors.has(eliminated);
      eliminate(eliminated, isTraitor, "VotedOut");
      renderAll();

      if (tieBreakUsed) logLine(`a deciding vote chose ${nameOf(eliminated)}.`);
      logLine(`Eliminated: ${nameOf(eliminated)} (${isTraitor ? "Traitor" : "Innocent"}).`);

      if (!isTraitor) {
        const innocents = [...S.alive].filter((id) => id !== S.youId && !S.traitors.has(id));
        if (innocents.length) {
          innocents.sort((a, b) => {
            const pa = S.players.find((p) => p.id === a);
            const pb = S.players.find((p) => p.id === b);
            return pb.influence - pa.influence || (S.suspicion[a] || 0) - (S.suspicion[b] || 0);
          });
          const struck = innocents[0];
          setTimeout(() => {
            eliminate(struck, false, "NightStrike");
            renderAll();
            logLine(`Night strike: ${nameOf(struck)} was eliminated by traitors.`);
            if (!checkEnd()) {
              S.round += 1;
              renderRoundInfo();
              doScenarioPhase();
            }
          }, 600);
          return;
        }
      }

      if (!checkEnd()) {
        S.round += 1;
        renderRoundInfo();
        doScenarioPhase();
      }
    }
  })();
}

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
    if (img) img.src = p.avatarSad;

    const x = card.querySelector(".xmark");
    if (x) x.textContent = "✕";
  }

  const msg = S.elimMsgs[p.department] || `${p.department} in turmoil.`;
  if (reason === "NightStrike") logLine(`${msg}`);
}

function nameOf(id) {
  return S.players.find((p) => p.id === id)?.name || id;
}

function renderRoundInfo() {
  const el = document.getElementById("roundInfo");
  el.innerHTML = `
    <h2>Round ${S.round}</h2>
    <div class="note">Alive: ${S.alive.size} · Traitors unknown · Keep your wits about you.</div>
  `;
}

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
      const img = S.eliminated.has(p.id) ? p.avatarSad : p.avatar;
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

function logLine(t) {
  S.log.push(t);
}

// Modal Log
function openLogModal() {
  const modal = document.getElementById("logModal");
  const body = document.getElementById("logBody");
  body.innerHTML = S.log.map((x) => `• ${x}`).join("<br>");
  modal.classList.add("open");
}

document.getElementById("closeLog").onclick = () =>
  document.getElementById("logModal").classList.remove("open");

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

  const playerAvatar = isWin ? you.avatar : you.avatarSad;
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

function renderAll() {
  renderTopbar();
}

window.addEventListener("DOMContentLoaded", async () => {
    await loadData();

    const startModal = document.getElementById("startModal");
    const optionsModal = document.getElementById("optionsModal");
    const howToPlayModal = document.getElementById("howToPlayModal");
    const infoModal = document.getElementById("infoModal");
    const playerSelect = document.getElementById("playerSelect");
    const characterImage = document.getElementById("character-preview-image");

    // Set a default character on load
    playerSelect.value = "pete-design-1";
    const defaultPlayer = S.allEmployees.find(e => e.id === playerSelect.value);
    if (defaultPlayer) {
        characterImage.src = `assets/pngs/${defaultPlayer.id}.png`;
    }

    document.getElementById("startGameBtn").onclick = () => {
        const you = playerSelect.value;
        const diff = document.getElementById("difficulty").value;
        const analysis = document.getElementById("analysisMode").value === "true";
        const numT = parseInt(document.getElementById("numTraitors").value, 10) || 3;

        S.rng = mulberry32(Math.floor(Math.random() * 1e9));
        S.youId = you;
        S.difficulty = diff;
        S.analysis = analysis;
        S.numTraitors = numT;

        startModal.classList.remove("open");
        startGame();
    };

    document.getElementById("optionsBtn").onclick = () => optionsModal.classList.add("open");
    document.getElementById("howToPlayBtn").onclick = () => howToPlayModal.classList.add("open");
    document.getElementById("infoBtn").onclick = () => infoModal.classList.add("open");

    document.getElementById("confirmOptionsBtn").onclick = () => optionsModal.classList.remove("open");
    document.getElementById("closeRulesBtn").onclick = () => howToPlayModal.classList.remove("open");
    document.getElementById("closeInfoBtn").onclick = () => infoModal.classList.remove("open");

    playerSelect.onchange = (event) => {
        const selectedPlayer = S.allEmployees.find(e => e.id === event.target.value);
        if (selectedPlayer) {
            characterImage.src = `assets/pngs/${selectedPlayer.id}.png`;
        }
    };

    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            [startModal, optionsModal, howToPlayModal, infoModal].forEach(modal => modal.classList.remove("open"));
        }
    });
});

// ---------- Reveal traitors (outline + optional image swap) ----------
function revealTraitors() {
  S.players.forEach((p) => {
    if (!S.traitors.has(p.id)) return;

    const card = document.querySelector(`.player-card[data-id="${p.id}"]`);
    if (!card) return;

    card.classList.add("revealed-traitor");

    if (!document.querySelector("style[data-traitor-reveal]")) {
      const st = document.createElement("style");
      st.setAttribute("data-traitor-reveal", "");
      st.textContent = `
        .player-card.revealed-traitor{outline:3px solid var(--red);box-shadow:0 0 0 4px rgba(204,31,42,.15);}
      `;
      document.head.appendChild(st);
    }

    const img = card.querySelector("img");
    if (img && p.avatarTraitor) {
      const originalSrc = img.src;
      img.onerror = () => {
        img.onerror = null;
        img.src = originalSrc;
      };
      img.src = p.avatarTraitor;
    }
  });
}
