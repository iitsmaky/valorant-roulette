const API_URL = "https://valorant-api.com/v1/agents?isPlayableCharacter=true";
const SPIN_DURATION_MS = 5000;
const REPEAT_COUNT = 160;
const MIN_CYCLES_AWAY = 4;
const JITTER_PX = 16;

const dom = {
  viewport: document.getElementById("rouletteViewport"),
  strip: document.getElementById("rouletteStrip"),
  spinBtn: document.getElementById("spinBtn"),
  resultText: document.getElementById("resultText"),
  status: document.getElementById("status"),
  banGrid: document.getElementById("banGrid"),
  banMeta: document.getElementById("banMeta"),
  roleList: document.getElementById("roleList"),
};

const state = {
  agents: [],
  agentIndex: new Map(),
  banned: new Set(),
  offset: 0,
  baseShift: 0,
  cardWidth: 0,
  cardStride: 0,
  isSpinning: false,
  tickBias: 0,
  nextTickOffset: null,
  nextTickIndex: null,
  tickTone: 1,
  noiseBuffer: null,
  audioCtx: null,
};

function setStatus(text) {
  dom.status.textContent = text;
}

function setResult(text) {
  dom.resultText.textContent = text;
}

async function fetchAgents() {
  const response = await fetch(API_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("API request failed");
  }
  const payload = await response.json();
  return payload.data
    .filter((agent) => agent.isPlayableCharacter && agent.displayIcon)
    .map((agent) => ({
      uuid: agent.uuid,
      displayName: agent.displayName,
      displayIcon: agent.displayIcon,
      displayIconSmall: agent.displayIconSmall || agent.displayIcon,
      roleIcon: agent.role ? agent.role.displayIcon : null,
      roleName: agent.role ? agent.role.displayName : null,
      roleDescription: agent.role ? agent.role.description : null,
    }));
}

function createAgentCard(agent) {
  const card = document.createElement("div");
  card.className = "agent-card";
  card.dataset.agentId = agent.uuid;
  card.dataset.agentName = agent.displayName;

  const portrait = document.createElement("img");
  portrait.className = "agent-card__portrait";
  portrait.src = agent.displayIcon;
  portrait.alt = agent.displayName;
  portrait.loading = "lazy";

  const name = document.createElement("div");
  name.className = "agent-card__name";
  name.textContent = agent.displayName.toUpperCase();

  card.append(portrait, name);

  const icon = document.createElement("img");
  icon.className = "agent-card__icon";
  icon.src = agent.displayIconSmall;
  icon.alt = "";
  icon.loading = "lazy";
  icon.setAttribute("aria-hidden", "true");
  card.appendChild(icon);

  if (agent.roleIcon) {
    const role = document.createElement("img");
    role.className = "agent-card__role";
    role.src = agent.roleIcon;
    role.alt = "";
    role.loading = "lazy";
    role.setAttribute("aria-hidden", "true");
    card.appendChild(role);
  }

  return card;
}

function buildStrip() {
  dom.strip.innerHTML = "";
  const fragment = document.createDocumentFragment();

  for (let repeat = 0; repeat < REPEAT_COUNT; repeat += 1) {
    for (const agent of state.agents) {
      fragment.appendChild(createAgentCard(agent));
    }
  }

  dom.strip.appendChild(fragment);
  measureCards();
  setInitialShift();
  updateTransform();
}

function measureCards() {
  const sample = dom.strip.querySelector(".agent-card");
  if (!sample) {
    return;
  }
  const rect = sample.getBoundingClientRect();
  const styles = getComputedStyle(dom.strip);
  const gap = parseFloat(styles.columnGap || styles.gap || "0");

  state.cardWidth = rect.width;
  state.cardStride = rect.width + gap;
}

function setInitialShift() {
  const totalCards = state.agents.length * REPEAT_COUNT;
  const indicatorX = dom.viewport.clientWidth / 2;
  const startIndex = Math.floor(totalCards * 0.8);
  const startCoord = startIndex * state.cardStride + state.cardWidth / 2;

  state.baseShift = indicatorX - startCoord;
  state.offset = 0;
}

function updateTransform() {
  const transformX = state.baseShift - state.offset;
  dom.strip.style.transform = `translate3d(${transformX}px, 0, 0)`;
}

function buildBanGrid() {
  dom.banGrid.innerHTML = "";

  for (const agent of state.agents) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ban-card";
    button.dataset.agentId = agent.uuid;
    button.title = agent.displayName;

    const img = document.createElement("img");
    img.src = agent.displayIcon;
    img.alt = agent.displayName;
    img.loading = "lazy";

    button.appendChild(img);
    button.addEventListener("click", () => toggleBan(agent.uuid, button));
    dom.banGrid.appendChild(button);
  }

  updateBanMeta();
}

function buildRoleList() {
  if (!dom.roleList) {
    return;
  }

  const roleMap = new Map();
  for (const agent of state.agents) {
    if (agent.roleName && agent.roleIcon) {
      roleMap.set(agent.roleName, {
        name: agent.roleName,
        icon: agent.roleIcon,
        description: agent.roleDescription || "",
      });
    }
  }

  const roles = Array.from(roleMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  dom.roleList.innerHTML = "";
  for (const role of roles) {
    const item = document.createElement("div");
    item.className = "role-item";

    const icon = document.createElement("img");
    icon.className = "role-item__icon";
    icon.src = role.icon;
    icon.alt = role.name;
    icon.loading = "lazy";

    const text = document.createElement("div");

    const label = document.createElement("div");
    label.className = "role-item__label";
    label.textContent = role.name;

    text.appendChild(label);

    if (role.description) {
      const desc = document.createElement("div");
      desc.className = "role-item__desc";
      desc.textContent = role.description;
      text.appendChild(desc);
    }

    item.append(icon, text);
    dom.roleList.appendChild(item);
  }
}

function setBanStateInStrip(agentId, isBanned) {
  const cards = dom.strip.querySelectorAll(`[data-agent-id="${agentId}"]`);
  cards.forEach((card) => {
    card.classList.toggle("is-banned", isBanned);
  });
}

function toggleBan(agentId, button) {
  if (state.banned.has(agentId)) {
    state.banned.delete(agentId);
    button.classList.remove("is-banned");
    setBanStateInStrip(agentId, false);
  } else {
    state.banned.add(agentId);
    button.classList.add("is-banned");
    setBanStateInStrip(agentId, true);
  }

  updateBanMeta();
}

function updateBanMeta() {
  dom.banMeta.textContent = `Бан: ${state.banned.size}`;
}

function getAvailableAgentIndices() {
  const indices = [];
  for (let i = 0; i < state.agents.length; i += 1) {
    if (!state.banned.has(state.agents[i].uuid)) {
      indices.push(i);
    }
  }
  return indices;
}

function getIndicatorIndex() {
  const indicatorX = dom.viewport.clientWidth / 2;
  const transformX = state.baseShift - state.offset;
  const indicatorCoord = indicatorX - transformX;
  return Math.floor(indicatorCoord / state.cardStride);
}

function getNearestIndicatorIndex() {
  const indicatorX = dom.viewport.clientWidth / 2;
  const transformX = state.baseShift - state.offset;
  const indicatorCoord = indicatorX - transformX;
  if (!state.cardStride) {
    return Math.floor(indicatorCoord);
  }
  const rawIndex = (indicatorCoord - state.cardWidth / 2) / state.cardStride;
  return Math.round(rawIndex);
}

function computeTargetOffsetForIndex(baseIndex) {
  const indicatorX = dom.viewport.clientWidth / 2;
  const currentIndex = getIndicatorIndex();
  const minSteps = Math.max(state.agents.length * MIN_CYCLES_AWAY, 80);
  const maxK = Math.floor((currentIndex - minSteps - baseIndex) / state.agents.length);

  if (maxK < MIN_CYCLES_AWAY) {
    return null;
  }

  const backoff = Math.floor(Math.random() * 3);
  const chosenK = Math.max(MIN_CYCLES_AWAY, maxK - backoff);
  const targetIndex = baseIndex + chosenK * state.agents.length;
  const maxJitter = Math.min(JITTER_PX, state.cardWidth * 0.35);
  const jitter = (Math.random() * 2 - 1) * maxJitter;
  const center = targetIndex * state.cardStride + state.cardWidth / 2;
  let targetOffset = center + state.baseShift - indicatorX - jitter;

  if (targetOffset >= state.offset) {
    targetOffset -= state.agents.length * state.cardStride;
  }

  return targetOffset;
}

function pickTargetOffset() {
  const availableIndices = getAvailableAgentIndices();
  if (!availableIndices.length) {
    return null;
  }

  const attempts = Math.min(availableIndices.length, 10);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const baseIndex = availableIndices[Math.floor(Math.random() * availableIndices.length)];
    const offset = computeTargetOffsetForIndex(baseIndex);
    if (offset !== null) {
      return offset;
    }
  }

  for (const baseIndex of availableIndices) {
    const offset = computeTargetOffsetForIndex(baseIndex);
    if (offset !== null) {
      return offset;
    }
  }

  return null;
}

function getAgentAtIndicator() {
  const index = getNearestIndicatorIndex();
  const total = state.agents.length;
  if (!total) {
    return null;
  }
  const normalized = ((index % total) + total) % total;
  return state.agents[normalized] || null;
}

function ensureAudioContext() {
  if (!state.audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    state.audioCtx = new AudioContext();
  }
  if (state.audioCtx.state === "suspended") {
    state.audioCtx.resume();
  }
  if (!state.noiseBuffer) {
    state.noiseBuffer = createNoiseBuffer(state.audioCtx, 0.07);
  }
}

function createNoiseBuffer(context, durationSeconds) {
  const length = Math.floor(context.sampleRate * durationSeconds);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i += 1) {
    const fade = 1 - i / length;
    data[i] = (Math.random() * 2 - 1) * fade;
  }

  return buffer;
}

function playTick(tone = 1) {
  if (!state.audioCtx || state.audioCtx.state !== "running" || !state.noiseBuffer) {
    return;
  }
  const now = state.audioCtx.currentTime;
  const toneValue = Math.max(0.55, Math.min(1.3, tone));
  const noise = state.audioCtx.createBufferSource();
  const filter = state.audioCtx.createBiquadFilter();
  const gain = state.audioCtx.createGain();
  const osc = state.audioCtx.createOscillator();
  const oscGain = state.audioCtx.createGain();

  noise.buffer = state.noiseBuffer;
  noise.playbackRate.setValueAtTime(0.9 + Math.random() * 0.2, now);
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(1400 * toneValue + 300, now);
  filter.Q.setValueAtTime(0.7, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.045 * toneValue, now + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);

  osc.type = "triangle";
  osc.frequency.setValueAtTime(520 * toneValue + Math.random() * 60, now);
  oscGain.gain.setValueAtTime(0.0001, now);
  oscGain.gain.exponentialRampToValueAtTime(0.02 * toneValue, now + 0.004);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);

  noise.connect(filter);
  osc.connect(oscGain);
  oscGain.connect(gain);
  filter.connect(gain);
  gain.connect(state.audioCtx.destination);
  noise.start(now);
  osc.start(now);
  noise.stop(now + 0.08);
  osc.stop(now + 0.07);
}

function playWin() {
  if (!state.audioCtx || state.audioCtx.state !== "running") {
    return;
  }
  const now = state.audioCtx.currentTime;
  const gain = state.audioCtx.createGain();
  const filter = state.audioCtx.createBiquadFilter();

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.14, now + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(2200, now);
  filter.Q.setValueAtTime(0.7, now);

  const oscA = state.audioCtx.createOscillator();
  const oscB = state.audioCtx.createOscillator();

  oscA.type = "triangle";
  oscB.type = "sine";
  oscA.frequency.setValueAtTime(520, now);
  oscA.frequency.exponentialRampToValueAtTime(760, now + 0.45);
  oscB.frequency.setValueAtTime(780, now);
  oscB.frequency.exponentialRampToValueAtTime(1040, now + 0.45);

  oscA.connect(filter);
  oscB.connect(filter);
  filter.connect(gain);
  gain.connect(state.audioCtx.destination);

  oscA.start(now);
  oscB.start(now + 0.02);
  oscA.stop(now + 1);
  oscB.stop(now + 1);

  if (state.noiseBuffer) {
    const sparkle = state.audioCtx.createBufferSource();
    const sparkleFilter = state.audioCtx.createBiquadFilter();
    const sparkleGain = state.audioCtx.createGain();

    sparkle.buffer = state.noiseBuffer;
    sparkle.playbackRate.setValueAtTime(1.6, now);
    sparkleFilter.type = "highpass";
    sparkleFilter.frequency.setValueAtTime(2600, now);
    sparkleFilter.Q.setValueAtTime(0.9, now);
    sparkleGain.gain.setValueAtTime(0.0001, now);
    sparkleGain.gain.exponentialRampToValueAtTime(0.04, now + 0.02);
    sparkleGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);

    sparkle.connect(sparkleFilter);
    sparkleFilter.connect(sparkleGain);
    sparkleGain.connect(state.audioCtx.destination);
    sparkle.start(now);
    sparkle.stop(now + 0.25);
  }
}

function resetTickSchedule() {
  const indicatorX = dom.viewport.clientWidth / 2;
  state.tickBias = indicatorX - state.baseShift;
  const currentIndex = Math.floor((state.offset + state.tickBias) / state.cardStride);
  state.nextTickIndex = currentIndex - 1;
  state.nextTickOffset = state.nextTickIndex * state.cardStride - state.tickBias;
}

function updateTick() {
  if (state.nextTickOffset === null) {
    return;
  }
  while (state.offset <= state.nextTickOffset) {
    playTick(state.tickTone);
    state.nextTickIndex -= 1;
    state.nextTickOffset = state.nextTickIndex * state.cardStride - state.tickBias;
  }
}

function easeOutExpo(t) {
  if (t === 1) {
    return 1;
  }
  return 1 - Math.pow(2, -10 * t);
}

function spin() {
  if (state.isSpinning) {
    return;
  }

  const availableIndices = getAvailableAgentIndices();
  if (!availableIndices.length) {
    setResult("Все агенты в бан-листе");
    return;
  }

  const targetOffset = pickTargetOffset();
  if (targetOffset === null) {
    setResult("Лента исчерпана, обновите страницу");
    return;
  }

  state.isSpinning = true;
  dom.spinBtn.disabled = true;
  setResult("Крутится...");
  setStatus("Крутится");
  ensureAudioContext();

  const startOffset = state.offset;
  const distance = startOffset - targetOffset;
  if (distance <= 0) {
    setResult("Ошибка расчета движения");
    state.isSpinning = false;
    dom.spinBtn.disabled = false;
    setStatus("Готово");
    return;
  }
  const startTime = performance.now();

  resetTickSchedule();

  const step = (now) => {
    const elapsed = Math.min(now - startTime, SPIN_DURATION_MS);
    const progress = elapsed / SPIN_DURATION_MS;
    const eased = easeOutExpo(progress);
    state.tickTone = 0.7 + 0.5 * (1 - progress);
    const proposed = startOffset - distance * eased;
    state.offset = Math.min(state.offset, proposed);
    updateTransform();
    updateTick();

    if (elapsed < SPIN_DURATION_MS) {
      requestAnimationFrame(step);
      return;
    }

    state.isSpinning = false;
    dom.spinBtn.disabled = false;
    setStatus("Готово");
    const resultAgent = getAgentAtIndicator();
    setResult(resultAgent ? resultAgent.displayName : "—");
    playWin();
  };

  requestAnimationFrame(step);
}

async function init() {
  try {
    setStatus("Загрузка агентов...");
    const agents = await fetchAgents();
    if (!agents.length) {
      setStatus("Агенты не найдены");
      setResult("Нет данных для рулетки");
      return;
    }
    state.agents = agents;
    state.agentIndex = new Map(agents.map((agent, index) => [agent.uuid, index]));
    buildStrip();
    buildBanGrid();
    buildRoleList();
    setStatus("Готово");
    dom.spinBtn.disabled = false;
    dom.spinBtn.addEventListener("click", spin);
  } catch (error) {
    console.error(error);
    setStatus("Ошибка загрузки");
    setResult("Проверьте подключение к API");
  }
}

init();
