(function () {
    "use strict";

    const MIN_CHARS_PER_TEXT = 30;
    const COMBO_EVERY = 20;
    const BADGES = [
        { at: 10, icon: "🌱", name: "Typekiem" },
        { at: 25, icon: "🥉", name: "Bronzen Typer" },
        { at: 50, icon: "🥈", name: "Zilveren Typer" },
        { at: 100, icon: "🥇", name: "Gouden Typer" },
        { at: 150, icon: "💎", name: "Diamanten Vingers" },
        { at: 250, icon: "👑", name: "Typekoning" },
    ];
    const STORAGE_KEY = "typekoning-v1";

    const $ = (id) => document.getElementById(id);

    const state = {
        durationMin: 1,
        allowDigits: true,
        allowPunct: true,
        texts: [],
        lastTextIndex: -1,
        display: "", // filtered text currently shown
        statuses: [], // 'pending' | 'correct' | 'incorrect' per char
        pos: 0,
        correctChars: 0,
        incorrectChars: 0,
        streak: 0,
        maxStreak: 0,
        startedAt: 0,
        endsAt: 0,
        timerId: 0,
        running: false,
        muted: false,
        comboKey: "",
        saved: { combos: {} },
    };

    // ---------- Persistence ----------

    function load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) Object.assign(state.saved, JSON.parse(raw));
        } catch (e) {
            /* storage unavailable */
        }
    }

    function save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state.saved));
        } catch (e) {
            /* storage unavailable */
        }
    }

    // Badges and best score are tracked per combination of duration + filters,
    // so switching settings shows a fresh set of goals.
    function comboKey(durationMin, allowDigits, allowPunct) {
        return `${durationMin}:${allowDigits ? 1 : 0}:${allowPunct ? 1 : 0}`;
    }

    function getCombo(key) {
        return (
            state.saved.combos[key] || { badges: {}, bestWpm: 0, bestAcc: 0 }
        );
    }

    // ---------- Screens ----------

    function show(name) {
        document
            .querySelectorAll(".screen")
            .forEach((s) => s.classList.remove("active"));
        $("screen-" + name).classList.add("active");
    }

    // ---------- Start screen ----------

    function buildDurations() {
        $("durations").addEventListener("click", (e) => {
            const btn = e.target.closest(".duration");
            if (!btn) return;
            state.durationMin = Number(btn.dataset.min);
            document
                .querySelectorAll(".duration")
                .forEach((b) => b.classList.toggle("active", b === btn));
            renderBadges();
        });
    }

    function buildFilters() {
        $("filters").addEventListener("click", (e) => {
            const btn = e.target.closest(".filter-toggle");
            if (!btn) return;
            const key =
                btn.dataset.filter === "digits" ? "allowDigits" : "allowPunct";
            state[key] = !state[key];
            btn.classList.toggle("on", state[key]);
            renderBadges();
        });
    }

    function renderBadges() {
        const combo = getCombo(
            comboKey(state.durationMin, state.allowDigits, state.allowPunct),
        );
        $("badges").innerHTML = BADGES.map((b) => {
            const got = combo.badges[b.at];
            return `<div class="badge${got ? " got" : ""}"><span class="ico">${b.icon}</span>${b.name}<br>(${b.at})</div>`;
        }).join("");
        $("best").textContent = combo.bestWpm
            ? `Beste score bij deze instelling: ${combo.bestWpm} WPM, ${combo.bestAcc}% accuraat`
            : "Nog geen score met deze instelling";
    }

    // ---------- Text selection & filtering ----------

    // Strips characters the player has disabled and collapses the resulting
    // whitespace, so the same source texts adapt to any filter combination.
    function filterText(raw) {
        let out = raw;
        if (!state.allowDigits) out = out.replace(/[0-9]/gu, "");
        if (!state.allowPunct) out = out.replace(/[^\p{L}\p{N}\s]/gu, "");
        out = out.replace(/[ \t]+/g, " ").trim();
        return out;
    }

    function pickNextText() {
        const pool = state.texts;
        let idx;
        do {
            idx = Math.floor(Math.random() * pool.length);
        } while (pool.length > 1 && idx === state.lastTextIndex);
        state.lastTextIndex = idx;
        const filtered = filterText(pool[idx].text);
        return filtered.length >= MIN_CHARS_PER_TEXT
            ? filtered
            : filtered + " " + filterText(pool[(idx + 1) % pool.length].text);
    }

    function loadNextText() {
        state.display = pickNextText();
        state.statuses = new Array(state.display.length).fill("pending");
        state.pos = 0;
        renderText();
    }

    function renderText() {
        const el = $("text-display");
        el.innerHTML = state.display
            .split("")
            .map((ch, i) => {
                const st = state.statuses[i];
                const cls =
                    i === state.pos
                        ? "cur"
                        : st === "correct"
                          ? "ok"
                          : st === "incorrect"
                            ? "bad"
                            : "";
                // A real space (not &nbsp;) so the browser can still wrap
                // the line at word boundaries.
                return `<span class="${cls}">${escapeHtml(ch)}</span>`;
            })
            .join("");
        // Keep the current line centered so the reader can always see a
        // line or two ahead, instead of the cursor sitting at the bottom edge.
        const cur = el.querySelector(".cur");
        if (cur)
            cur.scrollIntoView({
                block: "center",
                inline: "nearest",
                behavior: "smooth",
            });
    }

    function escapeHtml(ch) {
        return ch === "<" ? "&lt;" : ch === "&" ? "&amp;" : ch;
    }

    function renderNextBadge() {
        const next = BADGES.find((b) => b.at > state.maxStreak);
        $("next-badge").textContent = next
            ? `Volgende: ${next.icon} bij ${next.at} juiste op rij`
            : "🌟 Alle badges gehaald!";
    }

    // ---------- Game flow ----------

    function startRound() {
        if (!state.texts.length) return;
        state.correctChars = 0;
        state.incorrectChars = 0;
        state.streak = 0;
        state.maxStreak = 0;
        state.running = true;
        state.comboKey = comboKey(
            state.durationMin,
            state.allowDigits,
            state.allowPunct,
        );
        $("wpm").textContent = "0";
        $("accuracy").textContent = "100%";
        $("time").textContent = state.durationMin * 60;
        loadNextText();
        renderNextBadge();
        show("game");
        const input = $("type-input");
        input.value = "";
        input.focus();
        state.startedAt = performance.now();
        state.endsAt = state.startedAt + state.durationMin * 60 * 1000;
        clearInterval(state.timerId);
        state.timerId = setInterval(tick, 200);
        tick();
    }

    function tick() {
        const now = performance.now();
        const left = Math.max(0, state.endsAt - now);
        const total = state.durationMin * 60 * 1000;
        const frac = left / total;
        const fill = $("time-fill");
        fill.style.width = frac * 100 + "%";
        fill.style.background =
            frac > 0.5
                ? "var(--good)"
                : frac > 0.2
                  ? "var(--accent)"
                  : "var(--bad)";
        const secs = Math.ceil(left / 1000);
        $("time").textContent = secs;
        $("time").classList.toggle("low", secs <= 10);

        const elapsedMin = (now - state.startedAt) / 60000;
        if (elapsedMin > 0) {
            const wpm = Math.round(state.correctChars / 5 / elapsedMin);
            $("wpm").textContent = wpm;
        }
        const attempted = state.correctChars + state.incorrectChars;
        const acc = attempted
            ? Math.round((state.correctChars / attempted) * 100)
            : 100;
        $("accuracy").textContent = acc + "%";

        if (left <= 0) endRound();
    }

    function endRound() {
        clearInterval(state.timerId);
        state.running = false;
        $("type-input").blur();

        const elapsedMin = state.durationMin;
        const wpm = Math.round(state.correctChars / 5 / elapsedMin);
        const attempted = state.correctChars + state.incorrectChars;
        const acc = attempted
            ? Math.round((state.correctChars / attempted) * 100)
            : 100;

        const combo = getCombo(state.comboKey);
        const record = wpm > combo.bestWpm;
        if (record) {
            combo.bestWpm = wpm;
            combo.bestAcc = acc;
        }
        state.saved.combos[state.comboKey] = combo;
        save();

        $("final-wpm").textContent = wpm;
        $("final-accuracy").textContent = acc + "%";
        $("final-chars").textContent = state.correctChars;
        $("final-errors").textContent = state.incorrectChars;
        $("final-record").textContent =
            record && wpm > 0
                ? "🎉 Nieuw persoonlijk record voor deze instelling!"
                : `Beste score voor deze instelling: ${combo.bestWpm} WPM`;

        const got = BADGES.filter((b) => b.at <= state.maxStreak).pop();
        $("final-badge").innerHTML = got
            ? `<span class="ico">${got.icon}</span>${got.name}`
            : "Typ 10 tekens op rij zonder fout voor je eerste badge!";

        show("end");
        if (wpm > 0) burst(innerWidth / 2, innerHeight / 3, 60);
        playTone([440, 330, 262], 0.15);
    }

    // ---------- Input handling ----------

    function handleKeydown(e) {
        if (!state.running) return;
        if (e.key === "Backspace") {
            e.preventDefault();
            if (state.pos > 0) {
                state.pos--;
                const prevStatus = state.statuses[state.pos];
                if (prevStatus === "correct") state.correctChars--;
                else if (prevStatus === "incorrect") state.incorrectChars--;
                state.statuses[state.pos] = "pending";
                state.streak = 0;
                renderText();
            }
            return;
        }
        if (e.key.length !== 1) return; // ignore modifier/navigation keys
        e.preventDefault();
        typeChar(e.key);
    }

    function typeChar(key) {
        const expected = state.display[state.pos];
        if (key === expected) {
            state.statuses[state.pos] = "correct";
            state.correctChars++;
            state.streak++;
            state.maxStreak = Math.max(state.maxStreak, state.streak);
            playTone([600], 0.03);

            const badge = BADGES.find((b) => b.at === state.streak);
            if (badge) awardBadge(badge);
            else if (state.streak % COMBO_EVERY === 0) combo();
        } else {
            state.statuses[state.pos] = "incorrect";
            state.incorrectChars++;
            state.streak = 0;
            playTone([200, 150], 0.1);
            document.body.classList.remove("shake-mini");
            void document.body.offsetWidth;
            document.body.classList.add("shake-mini");
        }
        state.pos++;
        renderNextBadge();

        if (state.pos >= state.display.length) {
            const oldLen = state.display.length;
            const more = pickNextText();
            state.display += " " + more;
            state.statuses = state.statuses.concat(
                new Array(more.length + 1).fill("pending"),
            );
        }
        renderText();
    }

    // ---------- Celebrations ----------

    function combo() {
        toast(`🔥 Combo x${state.streak}!`);
        burst(innerWidth / 2, innerHeight * 0.35, 40);
        playTone([523, 659, 784], 0.08);
    }

    function toast(text) {
        const t = document.createElement("div");
        t.className = "toast";
        t.textContent = text;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 1000);
    }

    function awardBadge(badge) {
        const combo = getCombo(state.comboKey);
        combo.badges[badge.at] = true;
        state.saved.combos[state.comboKey] = combo;
        save();

        const c = $("celebrate");
        c.querySelector(".celebrate-badge").textContent = badge.icon;
        c.querySelector(".celebrate-name").textContent =
            `${badge.name}! (${badge.at} juiste op rij)`;
        c.classList.remove("show");
        void c.offsetWidth;
        c.classList.add("show");

        document.body.classList.remove("shake");
        void document.body.offsetWidth;
        document.body.classList.add("shake");

        const level = BADGES.indexOf(badge) + 1;
        for (let i = 0; i < 2 + level; i++) {
            setTimeout(() => {
                burst(
                    innerWidth * (0.15 + Math.random() * 0.7),
                    innerHeight * (0.15 + Math.random() * 0.5),
                    70,
                );
            }, i * 220);
        }
        playTone([523, 659, 784, 1047], 0.12);
    }

    // ---------- Particles ----------

    const canvas = $("fx");
    const ctx = canvas.getContext("2d");
    let particles = [];
    let animating = false;

    function resize() {
        canvas.width = innerWidth;
        canvas.height = innerHeight;
    }

    function burst(x, y, count) {
        const hue = Math.random() * 360;
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 2 + Math.random() * 9;
            particles.push({
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 1,
                decay: 0.008 + Math.random() * 0.012,
                size: 3 + Math.random() * 5,
                color: `hsl(${(hue + Math.random() * 90) % 360} 100% 60%)`,
                star: Math.random() < 0.2,
            });
        }
        if (!animating) {
            animating = true;
            requestAnimationFrame(frame);
        }
    }

    function frame() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles = particles.filter((p) => p.life > 0);
        for (const p of particles) {
            p.x += p.vx;
            p.y += p.vy;
            p.vx *= 0.98;
            p.vy = p.vy * 0.98 + 0.15;
            p.life -= p.decay;
            ctx.globalAlpha = Math.max(p.life, 0);
            ctx.fillStyle = p.color;
            if (p.star) {
                ctx.font = `${p.size * 3}px sans-serif`;
                ctx.fillText("✨", p.x, p.y);
            } else {
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.globalAlpha = 1;
        if (particles.length) requestAnimationFrame(frame);
        else {
            animating = false;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }

    // ---------- Sound ----------

    let audio = null;

    function playTone(freqs, step) {
        if (state.muted) return;
        try {
            audio =
                audio ||
                new (window.AudioContext || window.webkitAudioContext)();
            freqs.forEach((f, i) => {
                const o = audio.createOscillator();
                const g = audio.createGain();
                const t = audio.currentTime + i * step;
                o.type = "triangle";
                o.frequency.value = f;
                g.gain.setValueAtTime(0.15, t);
                g.gain.exponentialRampToValueAtTime(0.001, t + step * 1.8);
                o.connect(g).connect(audio.destination);
                o.start(t);
                o.stop(t + step * 2);
            });
        } catch (e) {
            /* audio unavailable */
        }
    }

    // ---------- Wiring ----------

    async function loadTexts() {
        try {
            const res = await fetch("texts.json");
            state.texts = await res.json();
        } catch (e) {
            state.texts = [
                {
                    cat: "fallback",
                    text: "De typeteksten konden niet geladen worden. Probeer de pagina te herladen.",
                },
            ];
        }
    }

    function init() {
        load();
        resize();
        addEventListener("resize", resize);
        buildDurations();
        buildFilters();
        renderBadges();
        loadTexts();

        $("start").addEventListener("click", startRound);
        $("again").addEventListener("click", startRound);
        $("menu").addEventListener("click", () => {
            renderBadges();
            show("start");
        });

        const input = $("type-input");
        input.addEventListener("keydown", handleKeydown);
        // Suppress the native input value so mobile autocorrect/autocomplete
        // never desyncs from our own per-character tracking.
        input.addEventListener("input", () => {
            input.value = "";
        });
        $("text-display").addEventListener("click", () => input.focus());
        document
            .querySelector(".tap-hint")
            .addEventListener("click", () => input.focus());

        $("mute").addEventListener("click", () => {
            state.muted = !state.muted;
            $("mute").textContent = state.muted ? "🔇" : "🔊";
        });

        if ("serviceWorker" in navigator && location.protocol !== "file:") {
            navigator.serviceWorker.register("sw.js").catch(() => {});
        }
    }

    init();
})();
