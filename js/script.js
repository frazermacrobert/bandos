// Seeded RNG + helpers
function mulberry32(a){
  return function(){
    var t=(a+=0x6D2B79F5);
    t=Math.imul(t^(t>>>15),t|1);
    t^=t+Math.imul(t^(t>>>7),t|61);
    return((t^(t>>>14))>>>0)/4294967296;
  };
}
function seededShuffle(arr,rng){
  const a=arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(rng()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}
function pickRandom(arr,rng){
  return arr[Math.floor(rng()*arr.length)];
}
function weightedPick(items,weights,rng){
  const sum=weights.reduce((a,b)=>a+b,0)||1;
  let r=rng()*sum;
  for(let i=0;i<items.length;i++){
    r-=weights[i];
    if(r<=0) return items[i];
  }
  return items[items.length-1];
}

// Preload images with a basic progress overlay
function preloadImages(urls){
  return new Promise((resolve)=>{
    const total=urls.length;
    if(total===0){ resolve(); return; }

    let loadedCount=0;
    let errorCount=0;

    const loader=document.createElement('div');
    loader.id='loading-indicator';
    loader.style.position='fixed';
    loader.style.inset='0';
    loader.style.background='rgba(255,255,255,0.95)';
    loader.style.display='flex';
    loader.style.alignItems='center';
    loader.style.justifyContent='center';
    loader.style.zIndex='9999';
    loader.style.color='#1c1a1a';
    loader.style.fontSize='1.2em';
    loader.style.fontFamily='Inter,ui-sans-serif,system-ui,sans-serif';
    loader.innerHTML=`<div>Loading assets (0 / ${total})</div>`;
    document.body.appendChild(loader);

    const progressText=loader.querySelector('div');

    function checkCompletion(){
      if(loadedCount+errorCount===total){
        if(errorCount>0){
          console.warn(`Preloading finished with ${errorCount} image errors.`);
        }
        setTimeout(()=>{
          if(loader.parentNode) loader.parentNode.removeChild(loader);
          resolve();
        },150);
      }
    }

    urls.forEach(url=>{
      const img=new Image();
      img.onload=()=>{
        loadedCount++;
        progressText.textContent=`Loading assets (${loadedCount} / ${total})`;
        checkCompletion();
      };
      img.onerror=()=>{
        errorCount++;
        console.warn(`Failed to load image: ${url}`);
        checkCompletion();
      };
      img.src=url;
    });
  });
}

// Scenario normalization
function normalizeScenario(raw){
  if(!raw) return null;

  let options=Array.isArray(raw.options)
    ? raw.options.slice(0,3)
    : [raw.option_a,raw.option_b,raw.option_c].filter(Boolean);

  if(!options || options.length!==3){
    console.warn("Scenario skipped due to invalid options:",raw);
    return null;
  }

  let correct=raw.correct;
  if(typeof correct==="number"){
    correct=["A","B","C"][correct]||"A";
  }
  if(typeof correct==="string"){
    correct=correct.trim().toUpperCase();
    if(!["A","B","C"].includes(correct)) correct="A";
  } else {
    correct="A";
  }

  const rationale_correct=raw.rationale_correct||raw.rationaleCorrect||"Good call.";
  const rationale_wrong=raw.rationale_wrong||raw.rationaleWrong||"That creates risk. Try again next time.";

  return {
    id:raw.id||"",
    prompt:raw.prompt||"",
    options,
    correct,
    rationale_correct,
    rationale_wrong
  };
}

// Difficulty tuning
const DIFF={
  Easy:{innocent_error:0.04,traitor_rate:0.5,influence_scale:0.7,vote_noise:0.05,pattern_clarity:1.0},
  Medium:{innocent_error:0.12,traitor_rate:0.4,influence_scale:0.5,vote_noise:0.12,pattern_clarity:0.7},
  Hard:{innocent_error:0.2,traitor_rate:0.3,influence_scale:0.3,vote_noise:0.18,pattern_clarity:0.5}
};

function defaultInfluence(d){
  const m={
    CEO:0.75,CFO:0.68,"Exec Assistant":0.65,"Project Management":0.62,
    Consultant:0.6,Finance:0.56,HR:0.56,Legal:0.56,
    Design:0.52,Content:0.52,Motion:0.52,Ops:0.54,
    Marketing:0.54,"Business Development":0.54,IT:0.58
  };
  return m[d]??0.55;
}
function defaultBehaviour(d){
  const b={safe:0.7,risky:0.2,decoy:0.1};
  if(d==="Finance") return {safe:0.6,risky:0.3,decoy:0.1};
  if(d==="Design"||d==="Content"||d==="Motion") return {safe:0.65,risky:0.2,decoy:0.15};
  if(d==="Project Management") return {safe:0.62,risky:0.25,decoy:0.13};
  return b;
}

// State
const S={
  allEmployees:[],
  actions:[],
  scenarios:[],
  availableScenarios:[],
  elimMsgs:{},
  endGameMessages:[],
  players:[],
  round:0,
  rng:Math.random,
  youId:null,
  traitors:new Set(),
  analysis:true,
  difficulty:"Medium",
  numTraitors:3,
  log:[],
  suspicion:{},
  alive:new Set(),
  eliminated:new Set(),
  elimReason:{},
  usedActionIds:new Set(),
  history:{},
  historyWindow:3,
  christmasMode:false,
  tutorialEnabled:true,
  tutorialStep:0,
  currentScenario:null
};

async function loadData(){
  const [emps,acts,scens,elim,endGameMessages]=await Promise.all([
    fetch("data/employees.json").then(r=>r.json()),
    fetch("data/actions.json").then(r=>r.json()),
    fetch("data/scenarios.json").then(r=>r.json()),
    fetch("data/elimination_msgs.json").then(r=>r.json()),
    fetch("data/end_game_messages.json").then(r=>r.json())
  ]);

  S.allEmployees=Array.isArray(emps)?emps:[];
  S.actions=Array.isArray(acts)?acts:[];
  S.scenarios=(Array.isArray(scens)?scens:[]).map(normalizeScenario).filter(Boolean);
  S.elimMsgs=elim||{};
  S.endGameMessages=Array.isArray(endGameMessages)?endGameMessages:[];

  if(!S.scenarios.length){
    console.error("Scenario data error: 0 valid scenarios after normalization.");
    alert("No valid scenarios found. Please check data/scenarios.json formatting.");
  }

  const VALID=new Set(["safe","risky_innocent","traitor_sabotage","decoy","red_herring"]);
  const bad=S.actions.filter(a=>!VALID.has(a.bucket));
  if(bad.length) logLine(`Data warning: unknown action buckets -> ${bad.map(b=>b.id).join(", ")}`);

  populatePlayerSelect(S.allEmployees);
}

function populatePlayerSelect(emps){
  const sel=document.getElementById("playerSelect");
  if(!sel) return;
  sel.innerHTML=emps.map(e=>`<option value="${e.id}">${e.name}</option>`).join("");
}

function nameOf(id){
  return S.players.find(p=>p.id===id)?.name||id;
}

function logLine(t){
  S.log.push(t);
}

function renderAll(){
  renderTopbar();
}

function renderRoundInfo(){
  const el=document.getElementById("roundInfo");
  if(!el) return;
  el.innerHTML=`<h2>Round ${S.round}</h2><div class="note">Alive: ${S.alive.size} · Traitors unknown · Keep your wits about you.</div>`;
}

function renderTopbar(){
  const top=document.getElementById("topbar");
  if(!top) return;

  top.innerHTML=S.players.map(p=>{
    const cls=["player-card"];
    if(S.eliminated.has(p.id)) cls.push("eliminated");

    if(S.eliminated.has(p.id)){
      cls.push(S.traitors.has(p.id) ? "traitor" : "innocent");
      cls.push(S.elimReason[p.id]==="NightStrike" ? "by-traitors" : "by-vote");
    }

    const tag=p.id===S.youId?`<div class="tag">You</div>`:"";
    const img=S.eliminated.has(p.id) ? p.avatarGone : p.avatar;

    return `
      <div class="${cls.join(" ")}" data-id="${p.id}">
        ${tag}
        <img src="${img}" alt="${p.name} avatar">
        <div class="name">${p.name}</div>
        <div class="xmark">✕</div>
      </div>
    `;
  }).join("");
}

function startGame(){
  S.log=[];
  S.round=1;
  S.players=[];
  S.suspicion={};
  S.alive=new Set();
  S.eliminated=new Set();
  S.traitors=new Set();
  S.elimReason={};
  S.usedActionIds=new Set();
  S.history={};
  S.tutorialStep=0;
  S.currentScenario=null;

  const you=S.allEmployees.find(e=>e.id===S.youId);
  if(!you){
    alert("Selected player not found in employees.json");
    return;
  }

  const others=seededShuffle(
    S.allEmployees.filter(e=>e.id!==S.youId),
    S.rng
  ).slice(0,9);

  const roster=[you,...others];

  S.players=roster.map(e=>{
    const avatarName=S.christmasMode?`${e.id}_xmas`:e.id;
    const goneAvatarName=S.christmasMode?`${e.id}_xmas_gone`:`${e.id}_gone`;

    return {
      id:e.id,
      name:e.name,
      department:e.department,
      influence:defaultInfluence(e.department),
      behaviour:defaultBehaviour(e.department),
      role:"Innocent",
      status:"Alive",
      avatar:`assets/pngs/${avatarName}.png`,
      avatarGone:`assets/gone/${goneAvatarName}.png`,
      avatarTraitor:`assets/pngs/traitor-revealed.png`
    };
  });

  document.body.classList.toggle("christmas-mode",S.christmasMode);

  S.players.forEach(p=>{
    S.alive.add(p.id);
    S.history[p.id]=[];
  });

  const botIds=S.players.map(p=>p.id).filter(id=>id!==S.youId);
  seededShuffle(botIds,S.rng).slice(0,S.numTraitors).forEach(id=>S.traitors.add(id));

  S.players.forEach(p=>{
    if(S.traitors.has(p.id)) p.role="Traitor";
  });

  S.players.forEach(p=>{ S.suspicion[p.id]=0; });

  S.availableScenarios=[...S.scenarios];
  seededShuffle(S.availableScenarios,S.rng);

  logLine(`Game started. Traitors assigned. Difficulty: ${S.difficulty}.`);
  renderAll();
  nextRound();
  document.body.dataset.gameReady="true";
}

function nextRound(){
  if(checkEnd()) return;

  S.usedActionIds.clear();
  Object.keys(S.suspicion).forEach(id=>{
    S.suspicion[id]=(S.suspicion[id]||0)*0.9;
  });

  renderRoundInfo();
  doScenarioPhase();
}

// End checks now call announce with explicit outcome
function checkEnd(){
  const alivePlayers=[...S.alive].map(id=>S.players.find(p=>p.id===id)).filter(Boolean);
  const aliveTraitors=alivePlayers.filter(p=>S.traitors.has(p.id)).length;

  if(!S.alive.has(S.youId)){
    revealTraitors();
    announce({ outcome:"lose", msg:"You were eliminated. Traitors win." });
    return true;
  }

  if(aliveTraitors===0){
    revealTraitors();
    announce({ outcome:"win", msg:"All traitors eliminated. You win!" });
    return true;
  }

  if(aliveTraitors>=alivePlayers.length-aliveTraitors){
    revealTraitors();
    announce({ outcome:"lose", msg:"Traitors took control. You lose." });
    return true;
  }

  return false;
}

function doScenarioPhase(){
  const container=document.getElementById("scenario");
  if(!container) return;

  if(S.availableScenarios.length===0){
    if(S.scenarios.length>0){
      logLine("Reshuffling scenarios for a new round.");
      S.availableScenarios=[...S.scenarios];
      seededShuffle(S.availableScenarios,S.rng);
    }
  }

  S.currentScenario=S.availableScenarios.pop();
  const sc=S.currentScenario;

  if(!sc){
    container.innerHTML=`<h2>Scenario</h2><div class="note">No scenarios available.</div>`;
    return;
  }

  container.innerHTML=`
    <h2>Scenario</h2>
    <div>${sc.prompt}</div>
    ${sc.options.map((opt,i)=>{
      const letter=String.fromCharCode(65+i);
      return `<label class="option"><input type="radio" name="scopt" value="${letter}"><strong>${letter}.</strong> ${opt}</label>`;
    }).join("")}
    <div class="scenario-actions" style="margin-top:16px;">
      <button id="openLogBtn" class="btn secondary">Open Game Log</button>
      <button id="restartBtn" class="btn secondary">Restart game</button>
      <button id="answerBtn" class="btn">Submit</button>
    </div>
  `;

  const openLogBtn=document.getElementById("openLogBtn");
  if(openLogBtn) openLogBtn.onclick=openLogModal;

  const restartBtn=document.getElementById("restartBtn");
  if(restartBtn) restartBtn.onclick=()=>location.reload();

  const submitBtn=document.getElementById("answerBtn");
  if(!submitBtn) return;

  if(S.tutorialEnabled && S.round===1 && S.tutorialStep===0){
    showTutorial(1);
  }

  submitBtn.onclick=()=>{
    if(submitBtn.disabled) return;

    const sel=document.querySelector('input[name="scopt"]:checked');
    if(!sel){
      submitBtn.classList.add("shake");
      setTimeout(()=>submitBtn.classList.remove("shake"),300);
      return;
    }

    submitBtn.disabled=true;
    submitBtn.textContent="Submitted";

    const pick=sel.value;

    if(pick===sc.correct){
      const actionsEl=document.getElementById("actions");
      if(actionsEl) actionsEl.classList.remove("is-disabled");
      logLine(`Scenario answered correctly.`);
      if(S.analysis) logLine(`Analysis: ${sc.rationale_correct}`);
      doActionsPhase();
      return;
    }

    // Wrong answer means player loses immediately
    logLine(`Scenario wrong: You picked ${pick}.`);
    if(S.analysis) logLine(`Analysis: ${sc.rationale_wrong}`);

    const you=S.players.find(p=>p.id===S.youId);
    const goneAvatarUrl=you?you.avatarGone:"";

    const explainDiv=document.createElement("div");
    explainDiv.className="explain-overlay";
    explainDiv.innerHTML=`
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

    const continueBtn=document.getElementById("continueBtn");
    if(continueBtn){
      continueBtn.onclick=()=>{
        explainDiv.remove();
        eliminate(S.youId, "VotedOut");
        renderAll();
        revealTraitors();
        announce({ outcome:"lose", msg:"Your mistake led to your elimination. You lose." });
      };
    }
  };
}

function poolBy(bucket){
  return S.actions.filter(a=>a.bucket===bucket);
}
function deptMatches(action,dept){
  if(!action.departments_hint) return false;
  return action.departments_hint
    .split(",")
    .map(s=>s.trim().toLowerCase())
    .includes((dept||"").toLowerCase());
}

function chooseActionFor(playerId,rng){
  const p=S.players.find(x=>x.id===playerId);
  const isTraitor=S.traitors.has(playerId);
  const d=DIFF[S.difficulty];

  let candidates=[];
  if(isTraitor){
    const sabotage=rng()<d.traitor_rate;
    candidates=[sabotage ? "traitor_sabotage" : (rng()<0.5 ? "decoy" : "safe")];
  } else {
    const err=rng()<d.innocent_error;
    candidates=[err ? "risky_innocent" : (rng()<p.behaviour.safe ? "safe" : "decoy")];
  }

  const fallback=isTraitor
    ? ["traitor_sabotage","decoy","safe","risky_innocent","red_herring"]
    : ["safe","decoy","risky_innocent","red_herring","traitor_sabotage"];

  const tryOrder=[...candidates,...fallback.filter(b=>!candidates.includes(b))];
  const recent=new Set((S.history[playerId]||[]).slice(-S.historyWindow));

  function poolFilter(bucket){
    const pool=poolBy(bucket).filter(a=>!S.usedActionIds.has(a.id) && !recent.has(a.id));
    if(pool.length) return pool;
    return poolBy(bucket).filter(a=>!S.usedActionIds.has(a.id)) || [];
  }

  for(const b of tryOrder){
    const pool=poolFilter(b);
    if(pool.length){
      const weights=pool.map(a=>{
        let w=1;
        if(deptMatches(a,p.department)) w+=1.25;
        if(a.risk_level===0 && b==="safe") w+=0.2;
        return w;
      });
      const act=weightedPick(pool,weights,rng);
      return { act, usedBucket:b, fellBack:b!==candidates[0] };
    }
  }

  return {
    act:{id:"_stub",description:"…did some uneventful work.",risk_level:0,actually_suspicious:false},
    usedBucket:"safe",
    fellBack:true
  };
}

function doActionsPhase(){
  const aliveIds=[...S.alive];
  const items=[];

  aliveIds.filter(id=>id!==S.youId).forEach(id=>{
    const { act, usedBucket, fellBack } = chooseActionFor(id,S.rng);

    if(act.id) S.usedActionIds.add(act.id);

    const h=S.history[id]||(S.history[id]=[]);
    h.push(act.id||"_stub");
    if(h.length>S.historyWindow) h.shift();

    const add=act.risk_level*0.8 + (act.actually_suspicious?1.2:0)*DIFF[S.difficulty].pattern_clarity;
    S.suspicion[id]=Math.max(0,(S.suspicion[id]||0)*0.75+add);

    items.push({
      player:id,
      text:act.description,
      risk:act.risk_level,
      suspicious:!!act.actually_suspicious,
      usedBucket,
      fellBack
    });
  });

  const actionsDiv=document.getElementById("actions");
  if(!actionsDiv) return;

  actionsDiv.innerHTML=`
    <h2>Daily Activity</h2>
    <div class="actions-list">
      ${items.map(a=>{
        const cls=S.analysis?`r${a.risk}`:"neutral";
        const hint=S.analysis
          ? `<div class="note">${a.suspicious ? "Looks truly risky." : (a.risk>0 ? "May look risky but could be benign." : "Safe.")}${a.fellBack ? " · (pool fallback used)" : ""}</div>`
          : "";
        return `<div class="action-item ${cls}"><strong>${nameOf(a.player)}</strong>: ${a.text} ${hint}</div>`;
      }).join("")}
    </div>
    <div class="note" style="margin-top:8px">Variety mode is on: actions won't repeat in the same round and have a short cooldown per player.</div>
  `;

  if(S.tutorialEnabled && S.round===1 && S.tutorialStep===1){
    showTutorial(2);
  }

  doVotingPhase();
}

function doVotingPhase(){
  const voting=document.getElementById("voting");
  if(!voting) return;

  voting.innerHTML=`
    <h2>Voting</h2>
    <div class="note">Click a player card to cast your vote. Then watch the votes roll in.</div>
    <div class="tally" id="tally"></div>
    <div id="voteFeed" class="note"></div>
  `;

  document.querySelectorAll(".player-card").forEach(card=>{
    const id=card.dataset.id;
    const existing=card.querySelector(".vote-bubble");
    if(existing) existing.remove();

    const vb=document.createElement("div");
    vb.className="vote-bubble";
    vb.textContent="0";
    card.appendChild(vb);

    if(S.alive.has(id) && id!==S.youId){
      card.style.cursor="pointer";
      card.onclick=()=>handlePlayerVote(id);
    } else {
      card.onclick=null;
      card.style.cursor="default";
    }
  });
}

function renderTally(tally){
  const t=document.getElementById("tally");
  if(!t) return;

  const entries=Object.entries(tally).sort((a,b)=>b[1]-a[1]);
  t.innerHTML=entries.map(([id,v])=>`<span class="pill">${nameOf(id)}: ${v}</span>`).join("");

  S.players.forEach(p=>{
    const card=document.querySelector(`.player-card[data-id="${p.id}"]`);
    if(!card) return;
    const vb=card.querySelector(".vote-bubble");
    if(!vb) return;
    const val=tally[p.id]||0;
    vb.textContent=String(val);
    card.classList.toggle("voting",val>0);
  });
}

function handlePlayerVote(targetId){
  const actionsEl=document.getElementById("actions");
  if(actionsEl) actionsEl.classList.add("is-disabled");

  document.querySelectorAll(".vote-bubble").forEach(v=>v.textContent="0");
  const feed=document.getElementById("voteFeed");
  if(feed) feed.innerHTML="";

  const tally={};

  function addVote(id,who){
    tally[id]=(tally[id]||0)+1;
    renderTally(tally);
    if(feed){
      feed.innerHTML+=`• ${who} voted ${nameOf(id)}<br>`;
      feed.scrollTop=feed.scrollHeight;
    }
  }

  addVote(targetId,"You");

  const diff=DIFF[S.difficulty];
  const aliveIds=[...S.alive];
  const voters=aliveIds.filter(id=>id!==S.youId);
  const candidates=aliveIds.filter(id=>id!==S.youId);

  const planned=[];
  let forcedTraitor=null;

  // Training wheels: in Easy/Medium, sometimes force one traitor to vote "You"
  // This creates drama but we later prevent the group from actually eliminating you.
  if(S.youId && (S.difficulty==="Easy" || S.difficulty==="Medium")){
    const aliveTraitors=voters.filter(id=>S.traitors.has(id));
    if(aliveTraitors.length){
      forcedTraitor=aliveTraitors[Math.floor(S.rng()*aliveTraitors.length)];
      planned.push({ who:forcedTraitor, vote:S.youId, _forced:true });
    }
  }

  voters.forEach(id=>{
    if(id===forcedTraitor) return;

    const p=S.players.find(x=>x.id===id);
    const sorted=candidates
      .filter(x=>x!==id)
      .sort((a,b)=>(S.suspicion[b]||0)-(S.suspicion[a]||0));

    const baseTarget=sorted[0] ?? targetId;
    const follow=S.rng() < (p.influence * diff.influence_scale);

    let vote;
    if(follow){
      vote=targetId;
    } else {
      if(S.rng() < diff.vote_noise){
        vote=sorted[Math.floor(S.rng()*Math.max(1,sorted.length))] || baseTarget;
      } else {
        vote=baseTarget;
      }
    }

    // Prevent bots from actually voting you out in Easy/Medium
    if((S.difficulty==="Easy" || S.difficulty==="Medium") && vote===S.youId){
      const nonYou=sorted.filter(x=>x!==S.youId);
      vote=nonYou[0] || baseTarget || candidates.find(x=>x!==S.youId) || targetId;
      if(vote===S.youId && nonYou.length>1) vote=nonYou[1];
    }

    planned.push({ who:id, vote });
  });

  let i=0;
  (function step(){
    if(i<planned.length){
      const { who, vote } = planned[i++];
      addVote(vote,nameOf(who));
      setTimeout(step,550);
      return;
    }

    // Determine elimination
    let maxVotes=-1;
    let eliminated=null;

    Object.entries(tally).forEach(([id,v])=>{
      if(v>maxVotes){
        maxVotes=v;
        eliminated=id;
      } else if(v===maxVotes){
        if((S.suspicion[id]||0)>(S.suspicion[eliminated]||0)) eliminated=id;
      }
    });

    const topCount=Math.max(...Object.values(tally));
    const numAtTop=Object.values(tally).filter(v=>v===topCount).length;
    const tieBreakUsed=numAtTop>1;

    const isTraitor=S.traitors.has(eliminated);

    eliminate(eliminated, "VotedOut");
    renderAll();

    if(tieBreakUsed) logLine(`A deciding vote chose ${nameOf(eliminated)}.`);
    logLine(`Eliminated: ${nameOf(eliminated)} (${isTraitor ? "Traitor" : "Innocent"}).`);

    if(S.tutorialEnabled && S.round===1 && S.tutorialStep===2){
      setTimeout(()=>showTutorial(3),800);
    }

    // Night strike if wrong elimination
    if(!isTraitor){
      const innocents=[...S.alive].filter(id=>id!==S.youId && !S.traitors.has(id));
      if(innocents.length){
        innocents.sort((a,b)=>{
          const pa=S.players.find(p=>p.id===a);
          const pb=S.players.find(p=>p.id===b);
          return (pb.influence-pa.influence) || ((S.suspicion[a]||0)-(S.suspicion[b]||0));
        });
        const struck=innocents[0];

        setTimeout(()=>{
          eliminate(struck,"NightStrike");
          renderAll();
          logLine(`Night strike: ${nameOf(struck)} was eliminated by traitors.`);
          if(!checkEnd()){
            S.round+=1;
            renderRoundInfo();
            doScenarioPhase();
          }
        },600);
        return;
      }
    }

    if(!checkEnd()){
      S.round+=1;
      renderRoundInfo();
      doScenarioPhase();
    }
  }());
}

function eliminate(id,reason){
  if(!S.alive.has(id)) return;

  S.alive.delete(id);
  S.eliminated.add(id);
  S.elimReason[id]=reason;

  const p=S.players.find(x=>x.id===id);
  if(p) p.status="Eliminated";

  const card=document.querySelector(`.player-card[data-id="${id}"]`);
  if(card && p){
    card.classList.add("eliminated");
    card.classList.toggle("traitor",S.traitors.has(id));
    card.classList.toggle("innocent",!S.traitors.has(id));
    card.classList.remove("by-vote","by-traitors");
    card.classList.add(reason==="NightStrike" ? "by-traitors" : "by-vote");

    const img=card.querySelector("img");
    if(img) img.src=p.avatarGone;

    const x=card.querySelector(".xmark");
    if(x) x.textContent="✕";
  }

  // Department elimination message
  if(p){
    const msg=S.elimMsgs[p.department] || `${p.department} in turmoil.`;
    if(reason==="NightStrike") logLine(`${msg}`);
  }
}

function openLogModal(){
  const modal=document.getElementById("logModal");
  const body=document.getElementById("logBody");
  if(!modal || !body) return;

  body.innerHTML=S.log.map(x=>`• ${x}`).join("<br>");
  modal.classList.add("open");
}

// Close log modal safely
(function wireLogClose(){
  const closeBtn=document.getElementById("closeLog");
  if(closeBtn){
    closeBtn.onclick=()=>{
      const modal=document.getElementById("logModal");
      if(modal) modal.classList.remove("open");
    };
  }
}());

// Explicit end-game rendering
function announce({ outcome, msg }){
  const scenario=document.getElementById("scenario");
  if(!scenario) return;

  const isWin = outcome === "win";
  const you = S.players.find(p=>p.id===S.youId);

  const alivePlayers=S.players.filter(p=>S.alive.has(p.id));
  if(!alivePlayers.length){
    scenario.innerHTML=`<h2>Game Over</h2><div class="note">${msg}</div>`;
    return;
  }

  let character;
  if(isWin){
    const innocentSurvivors=alivePlayers.filter(p=>!S.traitors.has(p.id) && p.id!==S.youId);
    character=pickRandom(innocentSurvivors.length ? innocentSurvivors : alivePlayers,S.rng);
  } else {
    const traitorSurvivors=alivePlayers.filter(p=>S.traitors.has(p.id));
    character=pickRandom(traitorSurvivors.length ? traitorSurvivors : alivePlayers,S.rng);
  }

  const messageData=S.endGameMessages.find(m=>m.id===character.id);
  const message=messageData ? (isWin ? messageData.win : messageData.lose) : msg;

  const playerAvatar = isWin ? (you?.avatar||"") : (you?.avatarGone||"");
  const characterAvatar = S.traitors.has(character.id) ? (character.avatarTraitor||"") : (character.avatar||"");

  const traitorNames=S.players.filter(p=>S.traitors.has(p.id)).map(p=>p.name);
  const traitorList=traitorNames.length
    ? `<div class="note" style="margin-top:12px;"><strong>The traitors were:</strong> ${traitorNames.join(", ")}.</div>`
    : "";

  scenario.innerHTML=`
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
    </div>
  `;
}

function revealTraitors(){
  S.players.forEach(p=>{
    if(!S.traitors.has(p.id)) return;

    const card=document.querySelector(`.player-card[data-id="${p.id}"]`);
    if(!card) return;

    card.classList.add("revealed-traitor");

    if(!document.querySelector("style[data-traitor-reveal]")){
      const st=document.createElement("style");
      st.setAttribute("data-traitor-reveal","");
      st.textContent=`.player-card.revealed-traitor{outline:3px solid var(--red);box-shadow:0 0 0 4px rgba(204,31,42,.15);}`;
      document.head.appendChild(st);
    }

    const img=card.querySelector("img");
    if(img && p.avatarTraitor){
      const originalSrc=img.src;
      img.onerror=()=>{
        img.onerror=null;
        img.src=originalSrc;
      };
      img.src=p.avatarTraitor;
    }
  });
}

function showTutorial(step){
  const overlay=document.getElementById(`tutorialOverlay${step}`);
  const btn=document.getElementById(`tutorialBtn${step}`);
  if(!overlay || !btn) return;

  document.body.classList.add("tutorial-active");
  overlay.classList.add("open");
  overlay.style.zIndex = "3500";


  // Special handling for step 2 mobile arrow
  if(step===2){
    const isMobile=window.innerWidth<=640;
    const arrow=document.getElementById("scrollArrow");
    if(!isMobile && arrow) arrow.style.display="none";
  }

  btn.onclick=()=>{
    document.body.classList.remove("tutorial-active");
    overlay.classList.remove("open");
    S.tutorialStep=step; // Update step *after* completion
  };
}

// Boot
window.addEventListener("DOMContentLoaded",async()=>{
  const startModal=document.getElementById("startModal");
  const optionsModal=document.getElementById("optionsModal");
  const howToPlayModal=document.getElementById("howToPlayModal");
  const infoModal=document.getElementById("infoModal");
  const playerSelect=document.getElementById("playerSelect");
  const characterImage=document.getElementById("character-preview-image");
  const startGameBtn=document.getElementById("startGameBtn");

  if(startGameBtn){
    startGameBtn.textContent='Loading...';
    startGameBtn.disabled=true;
  }

  await loadData();

  // Build image URL list for preload
  const imageUrls=[
    'assets/cyberteurs.png',
    'assets/favicon.png',
    'assets/bg_office.jpg',
    'assets/bg_xmas.jpg',
    'assets/bg_polish.jpg',
    'assets/pngs/traitor-revealed.png'
  ];

  S.allEmployees.forEach(e=>{
    imageUrls.push(`assets/pngs/${e.id}.png`);
    imageUrls.push(`assets/gone/${e.id}_gone.png`);
    imageUrls.push(`assets/pngs/${e.id}_xmas.png`);
    imageUrls.push(`assets/gone/${e.id}_xmas_gone.png`);
  });

  const uniqueImageUrls=[...new Set(imageUrls)];
  await preloadImages(uniqueImageUrls);

  if(startGameBtn){
    startGameBtn.textContent='Start Game';
    startGameBtn.disabled=false;
  }

  // Default selected player
  if(playerSelect){
    playerSelect.value = playerSelect.value || "michael";
    const defaultPlayer=S.allEmployees.find(e=>e.id===playerSelect.value);
    if(defaultPlayer && characterImage){
      characterImage.src=`assets/pngs/${defaultPlayer.id}.png`;
    }

    playerSelect.onchange=(event)=>{
      const selected=S.allEmployees.find(e=>e.id===event.target.value);
      if(selected && characterImage){
        characterImage.src=`assets/pngs/${selected.id}.png`;
      }
    };
  }

  // Start game click
  if(startGameBtn){
    startGameBtn.onclick=()=>{
      const you = playerSelect ? playerSelect.value : null;
      if(!you){
        alert("No player selected.");
        return;
      }

      const diffEl=document.getElementById("difficulty");
      const analysisEl=document.getElementById("analysisMode");
      const numTraitorsEl=document.getElementById("numTraitors");
      const christmasEl=document.getElementById("christmasMode");
      const tutorialEl=document.getElementById("tutorialMode");

      const diff = diffEl ? diffEl.value : "Medium";
      const analysis = analysisEl ? (analysisEl.value==="true") : true;
      const numT = numTraitorsEl ? (parseInt(numTraitorsEl.value,10)||3) : 3;
      const christmasMode = christmasEl ? !!christmasEl.checked : false;
      const tutorialMode = tutorialEl ? (tutorialEl.value==="true") : true;

      S.rng=mulberry32(Math.floor(Math.random()*1e9));
      S.youId=you;
      S.difficulty=diff;
      S.analysis=analysis;
      S.numTraitors=numT;
      S.christmasMode=christmasMode;
      S.tutorialEnabled=tutorialMode;

      if(startModal) startModal.classList.remove("open");
      startGame();
    };
  }

  // Modal wiring (guarded)
  const optionsBtn=document.getElementById("optionsBtn");
  if(optionsBtn && optionsModal) optionsBtn.onclick=()=>optionsModal.classList.add("open");

  const howToPlayBtn=document.getElementById("howToPlayBtn");
  if(howToPlayBtn && howToPlayModal) howToPlayBtn.onclick=()=>howToPlayModal.classList.add("open");

  const infoBtn=document.getElementById("infoBtn");
  if(infoBtn && infoModal) infoBtn.onclick=()=>infoModal.classList.add("open");

  const confirmOptionsBtn=document.getElementById("confirmOptionsBtn");
  if(confirmOptionsBtn && optionsModal) confirmOptionsBtn.onclick=()=>optionsModal.classList.remove("open");

  const closeRulesBtn=document.getElementById("closeRulesBtn");
  if(closeRulesBtn && howToPlayModal) closeRulesBtn.onclick=()=>howToPlayModal.classList.remove("open");

  const closeInfoBtn=document.getElementById("closeInfoBtn");
  if(closeInfoBtn && infoModal) closeInfoBtn.onclick=()=>infoModal.classList.remove("open");

  // Escape closes modals
  window.addEventListener("keydown",(e)=>{
    if(e.key==="Escape"){
      [startModal,optionsModal,howToPlayModal,infoModal].forEach(m=>{
        if(m) m.classList.remove("open");
      });
    }
  });
});
