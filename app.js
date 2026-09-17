(function () {
  "use strict";

  const VOCAB = Array.isArray(window.HSK3_VOCAB) ? window.HSK3_VOCAB : [];
  const STORAGE_KEY = "hsk3-review-cards-state-v1";
  const DECK_VERSION = "classic-hsk3-600-clean-v1";
  const EXAM_ISO = "2026-11-07";
  const CONTENT_DATES = buildWeekdays("2026-09-17", "2026-10-14");
  const byId = new Map(VOCAB.map((word) => [word.id, word]));
  const intervals = [0, 1, 2, 4, 7, 14, 30];

  let state = loadState();
  let session = null;
  let toastTimer = null;
  let pendingConfirm = null;
  let storageWarningShown = false;

  const $ = (id) => document.getElementById(id);
  const elements = {
    themeToggle: $("themeToggle"),
    daysToExam: $("daysToExam"),
    todayLabel: $("todayLabel"),
    dashboardTitle: $("dashboardTitle"),
    todayGuidance: $("todayGuidance"),
    todayAction: $("todayAction"),
    smartReviewAction: $("smartReviewAction"),
    statLearned: $("statLearned"),
    statLearnedDetail: $("statLearnedDetail"),
    statDue: $("statDue"),
    statWeak: $("statWeak"),
    statToday: $("statToday"),
    masteryPercent: $("masteryPercent"),
    masteryBar: $("masteryBar"),
    legendLearned: $("legendLearned"),
    legendNew: $("legendNew"),
    legendStrong: $("legendStrong"),
    sessionSetup: $("sessionSetup"),
    sessionActive: $("sessionActive"),
    sessionSummary: $("sessionSummary"),
    sessionMode: $("sessionMode"),
    sessionDirection: $("sessionDirection"),
    sessionSize: $("sessionSize"),
    startConfiguredSession: $("startConfiguredSession"),
    activeModeLabel: $("activeModeLabel"),
    sessionProgressText: $("sessionProgressText"),
    sessionProgressBar: $("sessionProgressBar"),
    endSessionButton: $("endSessionButton"),
    cardNumber: $("cardNumber"),
    directionChip: $("directionChip"),
    promptLabel: $("promptLabel"),
    cardPrompt: $("cardPrompt"),
    guessInput: $("guessInput"),
    answerPanel: $("answerPanel"),
    answerHanzi: $("answerHanzi"),
    answerPinyin: $("answerPinyin"),
    answerMeaning: $("answerMeaning"),
    speakButton: $("speakButton"),
    revealButton: $("revealButton"),
    ratingButtons: $("ratingButtons"),
    summaryReviewed: $("summaryReviewed"),
    summaryAccuracy: $("summaryAccuracy"),
    summaryMinutes: $("summaryMinutes"),
    mistakeListWrap: $("mistakeListWrap"),
    mistakeList: $("mistakeList"),
    reviewMistakesButton: $("reviewMistakesButton"),
    returnDashboardButton: $("returnDashboardButton"),
    vocabSearch: $("vocabSearch"),
    vocabFilter: $("vocabFilter"),
    vocabResultCount: $("vocabResultCount"),
    vocabTableBody: $("vocabTableBody"),
    exportCsvButton: $("exportCsvButton"),
    defaultDirection: $("defaultDirection"),
    defaultSize: $("defaultSize"),
    autoSpeak: $("autoSpeak"),
    exportBackupButton: $("exportBackupButton"),
    importBackupButton: $("importBackupButton"),
    importBackupInput: $("importBackupInput"),
    resetProgressButton: $("resetProgressButton"),
    confirmDialog: $("confirmDialog"),
    confirmTitle: $("confirmTitle"),
    confirmMessage: $("confirmMessage"),
    confirmAccept: $("confirmAccept"),
    toast: $("toast")
  };

  init();

  function init() {
    if (VOCAB.length !== 600) {
      showToast(`Deck error: expected 600 cards, found ${VOCAB.length}.`);
    }
    applyTheme();
    bindNavigation();
    bindStudyControls();
    bindVocabularyControls();
    bindDataControls();
    syncSettingsControls();
    updateDashboard();
    renderVocabulary();
  }

  function defaultState() {
    return {
      schema: 1,
      deckVersion: DECK_VERSION,
      wordStatus: {},
      cardProgress: {},
      logs: [],
      lastMistakes: [],
      settings: {
        theme: "system",
        direction: "mixed",
        size: "20",
        autoSpeak: false
      }
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      return sanitizeState(JSON.parse(raw)) || defaultState();
    } catch (_error) {
      return defaultState();
    }
  }

  function sanitizeState(saved) {
    if (!isPlainObject(saved) || saved.schema !== 1 || saved.deckVersion !== DECK_VERSION) return null;
    if (!isPlainObject(saved.wordStatus) || !isPlainObject(saved.cardProgress)) return null;
    const clean = defaultState();

    for (const [id, status] of Object.entries(saved.wordStatus)) {
      if (!byId.has(id) || !isPlainObject(status)) continue;
      clean.wordStatus[id] = { learnedAt: isValidDateTime(status.learnedAt) ? status.learnedAt : null };
    }

    for (const [key, progress] of Object.entries(saved.cardProgress)) {
      if (!isPlainObject(progress)) continue;
      const match = /^(hsk3-\d{3}):(hanzi|meaning)$/.exec(key);
      if (!match || !byId.has(match[1]) || !clean.wordStatus[match[1]]) continue;
      clean.cardProgress[key] = {
        box: clampInteger(progress.box, 0, 6),
        due: isValidISODate(progress.due) ? progress.due : todayISO(),
        correct: clampInteger(progress.correct, 0, 1000000),
        incorrect: clampInteger(progress.incorrect, 0, 1000000),
        lapses: clampInteger(progress.lapses, 0, 1000000),
        lastReviewed: isValidDateTime(progress.lastReviewed) ? progress.lastReviewed : null,
        lastRating: ["again", "hard", "good", "easy"].includes(progress.lastRating) ? progress.lastRating : null
      };
    }

    clean.logs = (Array.isArray(saved.logs) ? saved.logs : []).filter((log) => {
      return isPlainObject(log) && byId.has(log.wordId) && ["hanzi", "meaning"].includes(log.direction) && ["again", "hard", "good", "easy"].includes(log.rating) && isValidDateTime(log.reviewedAt);
    }).slice(-2500).map((log) => ({
      wordId: log.wordId,
      direction: log.direction,
      rating: log.rating,
      reviewedAt: log.reviewedAt,
      previousBox: clampInteger(log.previousBox, 0, 6),
      resultingBox: clampInteger(log.resultingBox, 0, 6)
    }));
    clean.lastMistakes = unique((Array.isArray(saved.lastMistakes) ? saved.lastMistakes : []).filter((id) => byId.has(id)));

    const settings = isPlainObject(saved.settings) ? saved.settings : {};
    clean.settings.theme = ["system", "light", "dark"].includes(settings.theme) ? settings.theme : "system";
    clean.settings.direction = ["mixed", "hanzi", "meaning"].includes(settings.direction) ? settings.direction : "mixed";
    clean.settings.size = ["10", "20", "30", "60", "100"].includes(String(settings.size)) ? String(settings.size) : "20";
    clean.settings.autoSpeak = settings.autoSpeak === true;
    return clean;
  }

  function saveState() {
    state.deckVersion = DECK_VERSION;
    state.logs = state.logs.slice(-2500);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_error) {
      if (!storageWarningShown) {
        storageWarningShown = true;
        showToast("Progress could not be saved. Export a backup before closing.");
      }
    }
  }

  function bindNavigation() {
    document.querySelectorAll("[data-view-target]").forEach((button) => {
      button.addEventListener("click", () => showView(button.dataset.viewTarget));
    });
    elements.themeToggle.addEventListener("click", toggleTheme);
  }

  function showView(name) {
    let activeView = null;
    document.querySelectorAll(".view").forEach((view) => {
      const active = view.dataset.view === name;
      view.classList.toggle("active", active);
      if (active) activeView = view;
    });
    document.querySelectorAll("[data-view-target]").forEach((button) => {
      const active = button.dataset.viewTarget === name;
      button.classList.toggle("active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });
    if (name === "vocabulary") renderVocabulary();
    if (name === "dashboard") updateDashboard();
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (activeView && typeof activeView.querySelector === "function") {
      const heading = activeView.querySelector("h1");
      if (heading) {
        heading.setAttribute("tabindex", "-1");
        heading.focus({ preventScroll: true });
      }
    }
  }

  function bindStudyControls() {
    document.querySelectorAll("[data-start-mode]").forEach((button) => {
      button.addEventListener("click", () => openStudy(button.dataset.startMode));
    });
    elements.smartReviewAction.addEventListener("click", () => openStudy("smart"));
    elements.todayAction.addEventListener("click", startTodayTask);
    elements.startConfiguredSession.addEventListener("click", () => {
      const sizeValue = elements.sessionSize.value;
      startSession(elements.sessionMode.value, {
        direction: elements.sessionDirection.value,
        size: sizeValue === "all" ? Infinity : Number(sizeValue)
      });
    });
    elements.revealButton.addEventListener("click", revealAnswer);
    elements.guessInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        revealAnswer();
      }
    });
    elements.ratingButtons.addEventListener("click", (event) => {
      const button = event.target.closest("[data-rating]");
      if (button) rateCard(button.dataset.rating);
    });
    elements.speakButton.addEventListener("click", speakCurrentWord);
    elements.endSessionButton.addEventListener("click", async () => {
      const confirmed = await askConfirm("End this session?", "Your ratings so far are saved. Unanswered cards will not be kept as a resumable session, but you can start a new session later.", "End session");
      if (confirmed) finishSession();
    });
    elements.reviewMistakesButton.addEventListener("click", () => startSession("mistakes", { size: Infinity, direction: state.settings.direction }));
    elements.returnDashboardButton.addEventListener("click", () => showView("dashboard"));
    document.addEventListener("keydown", handleStudyKeyboard);
  }

  function openStudy(mode) {
    showView("review");
    showStudyPanel("setup");
    elements.sessionMode.value = mode;
    elements.sessionDirection.value = state.settings.direction;
    elements.sessionSize.value = mode === "learn" ? "30" : state.settings.size;
    if (mode === "mistakes" && !state.lastMistakes.length) showToast("No saved mistakes yet.");
  }

  function showStudyPanel(panel) {
    elements.sessionSetup.hidden = panel !== "setup";
    elements.sessionActive.hidden = panel !== "active";
    elements.sessionSummary.hidden = panel !== "summary";
  }

  function startTodayTask() {
    const plan = planForDate(todayISO());
    if (plan.mode === "none") {
      showView("plan");
      return;
    }
    showView("review");
    startSession(plan.mode, {
      size: plan.size,
      direction: plan.direction || state.settings.direction,
      range: plan.range
    });
  }

  function startSession(mode, options = {}) {
    const direction = options.direction || state.settings.direction || "mixed";
    const requestedSize = Number.isFinite(options.size) ? options.size : Number(state.settings.size || 20);
    const items = buildSessionItems(mode, requestedSize, direction, options.range);
    if (!items.length) {
      showStudyPanel("setup");
      if (mode === "smart") showToast("Nothing is due yet. Try random practice or learn new words.");
      else if (mode === "random") showToast("Mark or study some words first; random practice uses the review pool only.");
      else if (mode === "learn") showToast("Every word is already in your learned pool.");
      else if (mode === "mistakes") showToast("There are no mistakes saved from the last session.");
      else showToast("No cards are available for this session.");
      return;
    }

    session = {
      mode,
      direction,
      queue: items,
      target: items.length,
      current: null,
      startedAt: Date.now(),
      attempts: 0,
      successfulAttempts: 0,
      completedWordIds: new Set(),
      mistakeIds: new Set(),
      initialWordIds: new Set(items.map((item) => item.wordId))
    };
    elements.activeModeLabel.textContent = modeLabel(mode);
    showStudyPanel("active");
    showNextCard();
  }

  function buildSessionItems(mode, requestedSize, direction, range) {
    const limit = requestedSize === Infinity ? Number.MAX_SAFE_INTEGER : Math.max(1, requestedSize || 20);
    if (!VOCAB.length) return [];

    if (mode === "batch" && Array.isArray(range)) {
      return VOCAB.filter((word) => word.number >= range[0] && word.number <= range[1])
        .slice(0, limit)
        .map((word, index) => ({ wordId: word.id, direction: chooseDirection(direction, index), repeats: 0 }));
    }

    if (mode === "learn") {
      return VOCAB.filter((word) => !isLearned(word.id))
        .slice(0, limit)
        .map((word, index) => ({ wordId: word.id, direction: chooseDirection(direction, index), repeats: 0 }));
    }

    if (mode === "diagnostic" || mode === "checkpoint") {
      return shuffle(VOCAB.slice()).slice(0, Math.min(limit, VOCAB.length))
        .map((word, index) => ({ wordId: word.id, direction: chooseDirection(direction, index), repeats: 0 }));
    }

    if (mode === "mistakes") {
      return shuffle(unique(state.lastMistakes).map((id) => byId.get(id)).filter(Boolean))
        .slice(0, limit)
        .map((word, index) => ({ wordId: word.id, direction: chooseDirection(direction, index), repeats: 0 }));
    }

    const learnedWords = VOCAB.filter((word) => isLearned(word.id));
    if (mode === "random") {
      return shuffle(learnedWords).slice(0, Math.min(limit, learnedWords.length))
        .map((word, index) => ({ wordId: word.id, direction: chooseDirection(direction, index), repeats: 0 }));
    }

    if (mode === "smart") {
      const candidates = learnedWords.map((word, index) => smartCandidate(word, direction, index));
      const due = candidates.filter((item) => item.due).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.box - b.box);
      const weak = shuffle(candidates.filter((item) => !item.due && item.weak));
      const other = shuffle(candidates.filter((item) => !item.due && !item.weak));
      const desired = Math.min(limit, candidates.length);
      const selected = [];
      takeUnique(selected, due, Math.min(desired, selected.length + Math.ceil(desired * 0.60)));
      takeUnique(selected, weak, Math.min(desired, selected.length + Math.ceil(desired * 0.25)));
      takeUnique(selected, other, Math.min(desired, selected.length + Math.ceil(desired * 0.15)));
      takeUnique(selected, due, desired);
      takeUnique(selected, weak, desired);
      takeUnique(selected, other, desired);
      return selected.slice(0, desired).map((item) => ({ wordId: item.wordId, direction: item.direction, repeats: 0 }));
    }
    return [];
  }

  function smartCandidate(word, direction, index) {
    const directions = direction === "mixed" ? ["hanzi", "meaning"] : [direction];
    let selectedDirection = directions[0];
    if (direction === "mixed") {
      const a = progressFor(word.id, "hanzi", false);
      const b = progressFor(word.id, "meaning", false);
      if (!a && !b) selectedDirection = index % 2 ? "meaning" : "hanzi";
      else if (!a) selectedDirection = "hanzi";
      else if (!b) selectedDirection = "meaning";
      else selectedDirection = scoreCardForPriority(a) >= scoreCardForPriority(b) ? "hanzi" : "meaning";
    }
    const progress = progressFor(word.id, selectedDirection, true);
    return {
      wordId: word.id,
      direction: selectedDirection,
      due: progress.due <= todayISO(),
      dueDate: progress.due,
      weak: progressIsWeak(progress),
      box: progress.box
    };
  }

  function scoreCardForPriority(progress) {
    let score = 0;
    if (progress.due <= todayISO()) score += 100;
    score += progress.lapses * 12 + progress.incorrect * 4 - progress.box;
    return score;
  }

  function takeUnique(target, source, targetLength) {
    const used = new Set(target.map((item) => item.wordId));
    for (const item of source) {
      if (target.length >= targetLength) break;
      if (!used.has(item.wordId)) {
        target.push(item);
        used.add(item.wordId);
      }
    }
  }

  function chooseDirection(direction, index) {
    if (direction === "mixed") return index % 2 === 0 ? "hanzi" : "meaning";
    return direction === "meaning" ? "meaning" : "hanzi";
  }

  function showNextCard() {
    if (!session) return;
    if (!session.queue.length) {
      finishSession();
      return;
    }
    session.current = session.queue.shift();
    const word = byId.get(session.current.wordId);
    if (!word) {
      showNextCard();
      return;
    }
    const isHanziPrompt = session.current.direction === "hanzi";
    elements.cardNumber.textContent = `Word ${word.number} of 600`;
    elements.directionChip.textContent = isHanziPrompt ? "Hanzi → meaning" : "Meaning → Hanzi";
    elements.promptLabel.textContent = isHanziPrompt ? "What does this mean?" : "Which Chinese word is this?";
    elements.cardPrompt.textContent = isHanziPrompt ? word.hanzi : word.meaning;
    elements.cardPrompt.classList.toggle("hanzi", isHanziPrompt);
    elements.cardPrompt.classList.toggle("meaning", !isHanziPrompt);
    elements.cardPrompt.lang = isHanziPrompt ? "zh-Hans" : "en";
    elements.answerHanzi.textContent = word.hanzi;
    elements.answerPinyin.textContent = word.pinyin;
    elements.answerMeaning.textContent = word.meaning;
    elements.guessInput.value = "";
    elements.answerPanel.hidden = true;
    elements.ratingButtons.hidden = true;
    elements.revealButton.hidden = false;
    elements.guessInput.disabled = false;
    const completed = session.completedWordIds.size;
    elements.sessionProgressText.textContent = `Card ${Math.min(completed + 1, session.target)} of ${session.target}`;
    elements.sessionProgressBar.style.width = `${Math.round((completed / session.target) * 100)}%`;
    setTimeout(() => elements.guessInput.focus(), 20);
  }

  function revealAnswer() {
    if (!session || !session.current || !elements.answerPanel.hidden) return;
    elements.answerPanel.hidden = false;
    elements.ratingButtons.hidden = false;
    elements.revealButton.hidden = true;
    elements.guessInput.disabled = true;
    if (state.settings.autoSpeak) speakCurrentWord();
  }

  function rateCard(rating) {
    if (!session || !session.current || elements.answerPanel.hidden) return;
    const item = session.current;
    const word = byId.get(item.wordId);
    if (!word) return;
    markLearned(word.id);
    const key = cardKey(word.id, item.direction);
    const progress = progressFor(word.id, item.direction, true);
    const oldBox = progress.box;

    if (rating === "again") {
      progress.box = 0;
      progress.incorrect += 1;
      progress.lapses += 1;
      progress.due = todayISO();
      session.mistakeIds.add(word.id);
      if (item.repeats < 1) {
        const repeated = { ...item, repeats: item.repeats + 1 };
        session.queue.splice(Math.min(5, session.queue.length), 0, repeated);
      }
    } else if (rating === "hard") {
      progress.box = Math.max(1, oldBox);
      progress.incorrect += 1;
      progress.due = cappedDueFromDays(Math.max(1, Math.floor(intervalForBox(progress.box) / 2)));
      session.mistakeIds.add(word.id);
    } else if (rating === "good") {
      progress.box = Math.min(6, oldBox + 1);
      progress.correct += 1;
      progress.due = cappedDueDate(progress.box);
      session.successfulAttempts += 1;
    } else if (rating === "easy") {
      progress.box = Math.min(6, oldBox + 2);
      progress.correct += 1;
      progress.due = cappedDueDate(progress.box);
      session.successfulAttempts += 1;
    } else {
      return;
    }
    progress.lastReviewed = new Date().toISOString();
    progress.lastRating = rating;
    state.cardProgress[key] = progress;
    state.logs.push({
      wordId: word.id,
      direction: item.direction,
      rating,
      reviewedAt: new Date().toISOString(),
      previousBox: oldBox,
      resultingBox: progress.box
    });
    session.attempts += 1;
    session.completedWordIds.add(word.id);
    saveState();
    showNextCard();
  }

  function cappedDueDate(box) {
    return cappedDueFromDays(intervalForBox(box));
  }

  function cappedDueFromDays(requestedDays) {
    const today = todayISO();
    const exam = parseISO(EXAM_ISO);
    const remaining = Math.max(0, daysBetween(parseISO(today), exam));
    const cap = remaining > 0 ? Math.max(1, remaining - 2) : requestedDays;
    const interval = Math.min(requestedDays, cap);
    return addDaysISO(today, interval);
  }

  function intervalForBox(box) {
    return intervals[Math.max(0, Math.min(6, box))];
  }

  function finishSession() {
    if (!session) {
      showStudyPanel("setup");
      return;
    }
    const elapsedMinutes = Math.max(1, Math.round((Date.now() - session.startedAt) / 60000));
    state.lastMistakes = [...session.mistakeIds];
    saveState();
    elements.summaryReviewed.textContent = String(session.completedWordIds.size);
    elements.summaryAccuracy.textContent = `${session.attempts ? Math.round((session.successfulAttempts / session.attempts) * 100) : 0}%`;
    elements.summaryMinutes.textContent = String(elapsedMinutes);
    const mistakes = [...session.mistakeIds].map((id) => byId.get(id)).filter(Boolean);
    elements.mistakeListWrap.hidden = mistakes.length === 0;
    elements.mistakeList.innerHTML = mistakes.map((word) => `<span class="mistake-chip"><b>${escapeHtml(word.hanzi)}</b> · ${escapeHtml(word.meaning)}</span>`).join("");
    elements.reviewMistakesButton.hidden = mistakes.length === 0;
    session = null;
    showStudyPanel("summary");
    updateDashboard();
  }

  function handleStudyKeyboard(event) {
    if (!session || elements.sessionActive.hidden) return;
    const tag = event.target && event.target.tagName;
    if (["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A", "LABEL"].includes(tag)) return;
    if (event.code === "Space") {
      event.preventDefault();
      revealAnswer();
      return;
    }
    const ratings = { Digit1: "again", Digit2: "hard", Digit3: "good", Digit4: "easy", Numpad1: "again", Numpad2: "hard", Numpad3: "good", Numpad4: "easy" };
    if (ratings[event.code] && !elements.answerPanel.hidden) {
      event.preventDefault();
      rateCard(ratings[event.code]);
    }
  }

  function speakCurrentWord() {
    if (!session || !session.current || !("speechSynthesis" in window)) {
      showToast("Speech is not available in this browser.");
      return;
    }
    const word = byId.get(session.current.wordId);
    if (!word) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word.hanzi.replaceAll("/", "，"));
    utterance.lang = "zh-CN";
    utterance.rate = 0.82;
    const voices = window.speechSynthesis.getVoices();
    const chineseVoice = voices.find((voice) => /^zh([-_]|$)/i.test(voice.lang));
    if (chineseVoice) utterance.voice = chineseVoice;
    window.speechSynthesis.speak(utterance);
  }

  function bindVocabularyControls() {
    elements.vocabSearch.addEventListener("input", renderVocabulary);
    elements.vocabFilter.addEventListener("change", renderVocabulary);
    elements.vocabTableBody.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-word-id]");
      if (!button) return;
      const id = button.dataset.wordId;
      if (!byId.has(id)) return;
      if (isLearned(id)) {
        const word = byId.get(id);
        const confirmed = await askConfirm("Move this word back to New?", `This will remove saved review progress for ${word.hanzi}.`, "Move to New");
        if (!confirmed) return;
        unmarkLearned(id);
      } else {
        markLearned(id);
      }
      saveState();
      renderVocabulary();
      updateDashboard();
    });
    elements.exportCsvButton.addEventListener("click", exportProgressCsv);
  }

  function renderVocabulary() {
    const query = normalizeSearch(elements.vocabSearch.value || "");
    const filter = elements.vocabFilter.value || "all";
    const filtered = VOCAB.filter((word) => {
      const haystack = normalizeSearch(`${word.hanzi} ${word.pinyin} ${word.meaning}`);
      if (query && !haystack.includes(query)) return false;
      if (filter === "new") return !isLearned(word.id);
      if (filter === "learned") return isLearned(word.id);
      if (filter === "weak") return isWeakWord(word.id);
      if (filter === "strong") return isStrongWord(word.id);
      return true;
    });

    elements.vocabResultCount.textContent = `Showing ${filtered.length} of ${VOCAB.length} words`;
    elements.vocabTableBody.innerHTML = filtered.map((word) => {
      const learned = isLearned(word.id);
      let label = "Add to review";
      if (learned) label = isStrongWord(word.id) ? "Strong" : isWeakWord(word.id) ? "Weak" : "Learning";
      return `<tr>
        <td>${word.number}</td>
        <td class="hanzi-cell" lang="zh-Hans">${escapeHtml(word.hanzi)}</td>
        <td class="pinyin-cell">${escapeHtml(word.pinyin)}</td>
        <td>${escapeHtml(word.meaning)}</td>
        <td><button type="button" class="status-button ${learned ? "learned" : ""}" data-word-id="${escapeHtml(word.id)}">${label}</button></td>
      </tr>`;
    }).join("");
  }

  function bindDataControls() {
    elements.defaultDirection.addEventListener("change", () => {
      state.settings.direction = elements.defaultDirection.value;
      elements.sessionDirection.value = state.settings.direction;
      saveState();
    });
    elements.defaultSize.addEventListener("change", () => {
      state.settings.size = elements.defaultSize.value;
      elements.sessionSize.value = state.settings.size;
      saveState();
    });
    elements.autoSpeak.addEventListener("change", () => {
      state.settings.autoSpeak = elements.autoSpeak.checked;
      saveState();
    });
    elements.exportBackupButton.addEventListener("click", exportBackup);
    elements.importBackupButton.addEventListener("click", () => elements.importBackupInput.click());
    elements.importBackupInput.addEventListener("change", importBackup);
    elements.resetProgressButton.addEventListener("click", resetProgress);
    elements.confirmDialog.addEventListener("close", () => {
      if (pendingConfirm) {
        pendingConfirm(elements.confirmDialog.returnValue === "confirm");
        pendingConfirm = null;
      }
    });
  }

  function syncSettingsControls() {
    elements.defaultDirection.value = state.settings.direction;
    elements.defaultSize.value = state.settings.size;
    elements.autoSpeak.checked = Boolean(state.settings.autoSpeak);
    elements.sessionDirection.value = state.settings.direction;
    elements.sessionSize.value = state.settings.size;
  }

  function exportBackup() {
    const payload = {
      app: "HSK 3 Review Cards",
      exportedAt: new Date().toISOString(),
      deckVersion: DECK_VERSION,
      state
    };
    downloadText(`HSK3_backup_${todayISO()}.json`, JSON.stringify(payload, null, 2), "application/json");
    showToast("Backup exported.");
  }

  async function importBackup(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const candidate = parsed && parsed.state;
      if (!candidate || parsed.deckVersion !== DECK_VERSION || candidate.deckVersion !== DECK_VERSION) throw new Error("Invalid backup");
      const cleaned = sanitizeState(candidate);
      if (!cleaned) throw new Error("Invalid backup");
      const confirmed = await askConfirm("Replace current progress?", "Importing this backup will replace the progress currently stored in this browser. Export your current data first if needed.", "Import backup");
      if (!confirmed) return;
      state = cleaned;
      saveState();
      syncSettingsControls();
      applyTheme();
      updateDashboard();
      renderVocabulary();
      showToast("Backup imported successfully.");
    } catch (_error) {
      showToast("That file is not a valid HSK 3 Review Cards backup.");
    }
  }

  async function resetProgress() {
    const confirmed = await askConfirm("Reset all progress?", "This removes every rating, learned word, and review log from this browser profile. This cannot be undone without a backup.", "Reset everything");
    if (!confirmed) return;
    const settings = { ...state.settings };
    state = defaultState();
    state.settings = settings;
    saveState();
    updateDashboard();
    renderVocabulary();
    showToast("Progress reset.");
  }

  function exportProgressCsv() {
    const header = ["number", "hanzi", "pinyin", "meaning", "status", "hanzi_box", "hanzi_due", "meaning_box", "meaning_due"];
    const lines = [header.map(csvCell).join(",")];
    for (const word of VOCAB) {
      const a = progressFor(word.id, "hanzi", false);
      const b = progressFor(word.id, "meaning", false);
      const status = !isLearned(word.id) ? "new" : isStrongWord(word.id) ? "strong" : isWeakWord(word.id) ? "weak" : "learning";
      lines.push([
        word.number, word.hanzi, word.pinyin, word.meaning, status,
        a ? a.box : "", a ? a.due : "", b ? b.box : "", b ? b.due : ""
      ].map(csvCell).join(","));
    }
    downloadText(`HSK3_progress_${todayISO()}.csv`, `\uFEFF${lines.join("\r\n")}`, "text/csv;charset=utf-8");
  }

  function updateDashboard() {
    const today = todayISO();
    const learned = VOCAB.filter((word) => isLearned(word.id)).length;
    const due = Object.values(state.cardProgress).filter((progress) => progress && progress.due && progress.due <= today).length;
    const weak = VOCAB.filter((word) => isWeakWord(word.id)).length;
    const strong = VOCAB.filter((word) => isStrongWord(word.id)).length;
    const todayAnswers = state.logs.filter((log) => {
      if (!log.reviewedAt) return false;
      const reviewed = new Date(log.reviewedAt);
      return !Number.isNaN(reviewed.getTime()) && formatISO(reviewed) === today;
    }).length;
    const percent = VOCAB.length ? Math.round((learned / VOCAB.length) * 100) : 0;
    const days = Math.max(0, daysBetween(parseISO(today), parseISO(EXAM_ISO)));
    const plan = planForDate(today);

    elements.daysToExam.textContent = String(days);
    elements.todayLabel.textContent = plan.eyebrow;
    elements.dashboardTitle.textContent = plan.title;
    elements.todayGuidance.textContent = plan.guidance;
    elements.todayAction.textContent = plan.button;
    elements.todayAction.dataset.mode = plan.mode;
    elements.statLearned.textContent = String(learned);
    elements.statLearnedDetail.textContent = `of ${VOCAB.length || 600} introduced`;
    elements.statDue.textContent = String(due);
    elements.statWeak.textContent = String(weak);
    elements.statToday.textContent = String(todayAnswers);
    elements.masteryPercent.textContent = `${percent}%`;
    elements.masteryBar.style.width = `${percent}%`;
    elements.legendLearned.textContent = String(learned);
    elements.legendNew.textContent = String(Math.max(0, VOCAB.length - learned));
    elements.legendStrong.textContent = String(strong);
  }

  function planForDate(iso) {
    if (iso < "2026-09-16") {
      return { eyebrow: "PLAN PREVIEW", title: "Your plan starts on 16 September.", guidance: "Use the Plan tab to preview the full schedule.", button: "Open study plan", mode: "none" };
    }
    if (iso === "2026-09-16") {
      return { eyebrow: "DAY 1 · DIAGNOSTIC", title: "Start by measuring what remains.", guidance: "Use 60 mixed-direction cards to separate confident recall from words that need rebuilding. Do not try to relearn the whole deck today.", button: "Start 60-card diagnostic", mode: "diagnostic", size: 60, direction: "mixed" };
    }
    const contentIndex = CONTENT_DATES.indexOf(iso);
    if (contentIndex >= 0) {
      const start = contentIndex * 30 + 1;
      const end = start + 29;
      return { eyebrow: `VOCABULARY SESSION ${contentIndex + 1} OF 20`, title: `Screen words ${start}–${end} today.`, guidance: "Treat 30 as a screening batch. Actively relearn no more than 15–20 genuine gaps, and let spaced review handle the rest.", button: `Study words ${start}–${end}`, mode: "batch", size: 30, direction: "hanzi", range: [start, end] };
    }
    if (iso >= "2026-09-16" && iso < "2026-10-15") {
      return { eyebrow: "RECOVERY DAY", title: "Rest—or clear a small review queue.", guidance: "Your main schedule uses five weekdays. If you missed a session, use today to catch up without doubling tomorrow’s load.", button: "Review 20 cards", mode: "smart", size: 20 };
    }
    if (iso === "2026-10-15") {
      return { eyebrow: "PHASE 1 CHECKPOINT", title: "Test the deck before full-time study.", guidance: "Run a 100-card checkpoint drawn from the full deck, including anything you missed. The mistakes become your priority list for the intensive phase.", button: "Start 100-card checkpoint", mode: "checkpoint", size: 100, direction: "mixed" };
    }
    if (iso >= "2026-10-16" && iso <= "2026-10-18") {
      const mock = iso === "2026-10-18" ? " Complete your first timed mock after review." : "";
      return { eyebrow: "INTENSIVE PHASE · ERROR REPAIR", title: "Turn weak words into fast recall.", guidance: `Review about 120 prompts, then spend one hour each on listening, reading/grammar, and writing.${mock}`, button: "Start 120-card review", mode: "smart", size: 120 };
    }
    if (iso >= "2026-10-19" && iso <= "2026-10-25") {
      const mock = iso === "2026-10-23" ? " Today is also Mock 2." : "";
      return { eyebrow: "INTENSIVE PHASE · CONSOLIDATE", title: "Keep the red and yellow words moving.", guidance: `Aim for 120–150 review prompts across the day, plus the three exam-skill hours.${mock}`, button: "Start 150-card review", mode: "smart", size: 150 };
    }
    if (iso >= "2026-10-26" && iso <= "2026-11-01") {
      const mock = iso === "2026-10-28" || iso === "2026-11-01" ? " Today is a timed mock day." : "";
      return { eyebrow: "INTENSIVE PHASE · EXAM PRACTICE", title: "Protect accuracy under time pressure.", guidance: `Review 100–120 prompts and drill the weakest exam section.${mock}`, button: "Start 120-card review", mode: "smart", size: 120 };
    }
    if (iso >= "2026-11-02" && iso <= "2026-11-06") {
      const mock = iso === "2026-11-04" ? " Complete your final full mock today." : iso >= "2026-11-05" ? " Do not add new material; taper and protect sleep." : "";
      return { eyebrow: "FINAL WEEK", title: "Review mistakes, not everything.", guidance: `Use 60–100 prompts from the weak deck, then focus on calm, accurate exam practice.${mock}`, button: "Start 80-card review", mode: "smart", size: 80 };
    }
    if (iso === EXAM_ISO) {
      return { eyebrow: "EXAM DAY", title: "Trust the work you have done.", guidance: "Use only a short warm-up if it settles you. Avoid a heavy review session before the exam.", button: "Warm up with 10 cards", mode: "smart", size: 10 };
    }
    return { eyebrow: "PLAN COMPLETE", title: "Your exam date has passed.", guidance: "Your saved deck and review history remain available whenever you want to continue.", button: "Open study plan", mode: "none" };
  }

  function markLearned(id) {
    if (!byId.has(id)) return;
    if (!state.wordStatus[id]) state.wordStatus[id] = { learnedAt: new Date().toISOString() };
    progressFor(id, "hanzi", true);
    progressFor(id, "meaning", true);
  }

  function unmarkLearned(id) {
    delete state.wordStatus[id];
    delete state.cardProgress[cardKey(id, "hanzi")];
    delete state.cardProgress[cardKey(id, "meaning")];
    state.lastMistakes = state.lastMistakes.filter((wordId) => wordId !== id);
  }

  function isLearned(id) {
    return Boolean(state.wordStatus[id]);
  }

  function progressFor(id, direction, create) {
    const key = cardKey(id, direction);
    if (!state.cardProgress[key] && create) {
      state.cardProgress[key] = { box: 0, due: todayISO(), correct: 0, incorrect: 0, lapses: 0, lastReviewed: null, lastRating: null };
    }
    return state.cardProgress[key] || null;
  }

  function cardKey(id, direction) {
    return `${id}:${direction}`;
  }

  function isWeakWord(id) {
    if (!isLearned(id)) return false;
    return ["hanzi", "meaning"].some((direction) => {
      const progress = progressFor(id, direction, false);
      return progressIsWeak(progress);
    });
  }

  function isStrongWord(id) {
    if (!isLearned(id)) return false;
    const cards = [progressFor(id, "hanzi", false), progressFor(id, "meaning", false)];
    return cards.every((progress) => progress && progress.box >= 4 && !progressIsWeak(progress));
  }

  function progressIsWeak(progress) {
    if (!progress) return false;
    return progress.lastRating === "again" || progress.lastRating === "hard" || (progress.box < 3 && progress.lapses > 0) || (progress.box < 3 && progress.incorrect > progress.correct);
  }

  function modeLabel(mode) {
    return ({ smart: "Smart review", random: "Random practice", learn: "New words", diagnostic: "Diagnostic", checkpoint: "100-card checkpoint", mistakes: "Mistake review", batch: "Scheduled batch" })[mode] || "Study session";
  }

  function applyTheme() {
    const preference = state.settings.theme;
    const dark = preference === "dark" || (preference === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    elements.themeToggle.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  }

  function toggleTheme() {
    const currentlyDark = document.documentElement.dataset.theme === "dark";
    state.settings.theme = currentlyDark ? "light" : "dark";
    applyTheme();
    saveState();
  }

  function askConfirm(title, message, acceptLabel) {
    if (!elements.confirmDialog || typeof elements.confirmDialog.showModal !== "function") return Promise.resolve(window.confirm(`${title}\n\n${message}`));
    elements.confirmTitle.textContent = title;
    elements.confirmMessage.textContent = message;
    elements.confirmAccept.textContent = acceptLabel;
    elements.confirmDialog.returnValue = "cancel";
    elements.confirmDialog.showModal();
    return new Promise((resolve) => { pendingConfirm = resolve; });
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("show");
    toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 3200);
  }

  function downloadText(filename, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function csvCell(value) {
    const text = String(value ?? "");
    return `"${text.replaceAll('"', '""')}"`;
  }

  function normalizeSearch(value) {
    return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[’']/g, "").toLowerCase().trim();
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
  }

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function isValidDateTime(value) {
    return typeof value === "string" && value.length <= 40 && !Number.isNaN(new Date(value).getTime());
  }

  function isValidISODate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    return formatISO(parseISO(value)) === value;
  }

  function clampInteger(value, minimum, maximum) {
    const number = Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : minimum;
    return Math.max(minimum, Math.min(maximum, number));
  }

  function unique(items) {
    return [...new Set(items)];
  }

  function shuffle(items) {
    for (let index = items.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
    }
    return items;
  }

  function todayISO() {
    const now = new Date();
    return formatISO(now);
  }

  function formatISO(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function parseISO(iso) {
    const [year, month, day] = iso.split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
  }

  function addDaysISO(iso, days) {
    const date = parseISO(iso);
    date.setDate(date.getDate() + days);
    return formatISO(date);
  }

  function daysBetween(start, end) {
    const utcStart = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
    const utcEnd = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
    return Math.round((utcEnd - utcStart) / 86400000);
  }

  function buildWeekdays(startISO, endISO) {
    const dates = [];
    let cursor = parseISO(startISO);
    const end = parseISO(endISO);
    while (cursor <= end) {
      const day = cursor.getDay();
      if (day !== 0 && day !== 6) dates.push(formatISO(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
  }
})();
