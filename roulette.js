const API = "https://valorant-api.com/v1/agents?isPlayableCharacter=true&language=ru-RU";

const track = document.getElementById("track");
const spinBtn = document.getElementById("spinBtn");
const banGrid = document.getElementById("banAgents");
const resultText = document.getElementById("resultText");

let agents = [];
let banned = new Set();

let offset = 0;
let spinning = false;

const SPIN_DURATION_MS = 5000;
const EXTRA_SETS = 20;

let stepPx = 150;
let lastTickStep = 0;

/* ---------------- AUDIO (WebAudio, no files) ---------------- */
let audioCtx = null;
function ensureAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    return audioCtx;
}

function tick() {
    const ctx = ensureAudio();
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = "square";
    osc.frequency.value = 1200;

    filter.type = "bandpass";
    filter.frequency.value = 1400;
    filter.Q.value = 6;

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.05, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(t);
    osc.stop(t + 0.035);
}

function winSound() {
    const ctx = ensureAudio();
    const t = ctx.currentTime;

    const o = ctx.createOscillator();
    const g = ctx.createGain();

    o.type = "sine";
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(860, t + 0.15);

    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);

    o.connect(g);
    g.connect(ctx.destination);

    o.start(t);
    o.stop(t + 0.22);
}

/* ---------------- HELPERS ---------------- */
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function getIndicatorX() {
    const frame = document.querySelector(".roulette-frame");
    const r = frame.getBoundingClientRect();
    return r.left + r.width / 2;
}

function highlightCenter() {
    const cards = [...track.querySelectorAll(".agent")];
    const ix = getIndicatorX();

    let best = null;
    let bestDist = Infinity;

    for (const c of cards) {
        c.classList.remove("active");
        const r = c.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const d = Math.abs(cx - ix);
        if (d < bestDist) {
            bestDist = d;
            best = c;
        }
    }

    if (best) best.classList.add("active");
    return best;
}

/* ---------------- BUILD ---------------- */
function buildTrack() {
    track.innerHTML = "";

    const extended = [];
    for (let i = 0; i < EXTRA_SETS; i++) extended.push(...agents);

    for (const a of extended) {
        const el = document.createElement("div");
        el.className = "agent";
        el.dataset.uuid = a.uuid;
        el.dataset.name = a.displayName;
        el.innerHTML = `
            <img src="${a.displayIcon}">
            <span>${a.displayName}</span>
        `;
        track.appendChild(el);
    }

    requestAnimationFrame(() => {
        const first = track.querySelector(".agent");
        if (!first) return;

        const w = first.getBoundingClientRect().width;
        const gap = parseFloat(getComputedStyle(track).gap || "18");
        stepPx = Math.round(w + gap);

        offset = -Math.floor(agents.length * 8 * stepPx);
        track.style.transform = `translateX(${offset}px)`;
        lastTickStep = Math.floor((-offset) / stepPx);
    });
}

function buildBanlist() {
    banGrid.innerHTML = "";

    for (const a of agents) {
        const el = document.createElement("div");
        el.className = "ban-item";
        el.innerHTML = `<img src="${a.displayIcon}">`;

        el.onclick = () => {
            if (banned.has(a.uuid)) {
                banned.delete(a.uuid);
                el.classList.remove("banned");
            } else {
                banned.add(a.uuid);
                el.classList.add("banned");
            }
        };

        banGrid.appendChild(el);
    }
}

/* ---------------- SPIN (FIXED DURATION) ---------------- */
function spin() {
    if (spinning) return;

    const pool = agents.filter(a => !banned.has(a.uuid));
    if (!pool.length) {
        resultText.textContent = "Нет доступных агентов";
        return;
    }

    ensureAudio();

    spinning = true;
    spinBtn.disabled = true;
    resultText.textContent = "Прокрутка";

    const winner = pool[Math.floor(Math.random() * pool.length)];

    const cards = [...track.querySelectorAll(".agent")];

    /* КЛЮЧЕВОЙ МОМЕНТ:
       берём ТОЛЬКО ДАЛЬНИЕ копии победителя */
    const farFrom = Math.floor(cards.length * 0.65);
    const farTo   = Math.floor(cards.length * 0.9);

    const targets = [];
    for (let i = farFrom; i < farTo; i++) {
        if (cards[i].dataset.uuid === winner.uuid) {
            targets.push(cards[i]);
        }
    }

    const target = targets[Math.floor(Math.random() * targets.length)];
    const ix = getIndicatorX();
    const tr = target.getBoundingClientRect();
    const targetCenter = tr.left + tr.width / 2;

    const finalOffset = offset + (ix - targetCenter);

    const startOffset = offset;
    const startTime = performance.now();

    function easeOut(t) {
        return 1 - Math.pow(1 - t, 3);
    }

    function animate(now) {
        const p = Math.min((now - startTime) / SPIN_DURATION_MS, 1);
        const e = easeOut(p);

        offset = startOffset + (finalOffset - startOffset) * e;
        track.style.transform = `translateX(${offset}px)`;

        const stepNow = Math.floor((-offset) / stepPx);
        if (stepNow !== lastTickStep) {
            tick();
            lastTickStep = stepNow;
        }

        if (p < 1) {
            requestAnimationFrame(animate);
        } else {
            const picked = highlightCenter();
            resultText.textContent = picked.dataset.name;
            winSound();
            spinning = false;
            spinBtn.disabled = false;
        }
    }

    requestAnimationFrame(animate);
}

/* ---------------- INIT ---------------- */
async function init() {
    spinBtn.disabled = true;
    spinBtn.textContent = "Загрузка";

    const res = await fetch(API, { cache: "no-store" });
    const json = await res.json();

    agents = json.data
        .filter(a => a.isPlayableCharacter)
        .map(a => ({
            uuid: a.uuid,
            displayName: a.displayName,
            displayIcon: a.displayIcon
        }));

    shuffle(agents);
    buildTrack();
    buildBanlist();

    spinBtn.textContent = "Крутить";
    spinBtn.disabled = false;
    resultText.textContent = "Готово";

    spinBtn.onclick = spin;
}

init();
