const THEME_KEY = 'haltester_theme_mode';
const STORAGE_KEY = 'haltester_progress_v2';

const DEFAULT_STORE = {
  mistakes: {},   // questionId -> true
  bookmarks: {},  // questionId -> true
  history: []     // completed session summaries
};

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STORE };
    const parsed = JSON.parse(raw);
    return {
      mistakes: parsed.mistakes && typeof parsed.mistakes === 'object' ? parsed.mistakes : {},
      bookmarks: parsed.bookmarks && typeof parsed.bookmarks === 'object' ? parsed.bookmarks : {},
      history: Array.isArray(parsed.history) ? parsed.history : []
    };
  } catch (e) {
    return { ...DEFAULT_STORE };
  }
}

function saveStore() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (e) {}
}

let store = loadStore();

function getSavedTheme() {
  try {
    return localStorage.getItem(THEME_KEY) || 'dark';
  } catch (e) {
    return 'dark';
  }
}

function applyTheme(mode) {
  const isDark = mode === 'dark';
  const root = document.documentElement;
  if (isDark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  const icon = document.getElementById('themeIcon');
  const label = document.getElementById('themeLabel');
  if (icon) icon.textContent = isDark ? '🌙' : '☀️';
  if (label) label.textContent = isDark ? 'Ночная' : 'Дневная';
  try {
    localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light');
  } catch (e) {}
}

function toggleTheme() {
  const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
  applyTheme(next);
}

applyTheme(getSavedTheme());

let launchMode = 'training'; // 'training' | 'exam' | 'mistakes'
let session = null;
let timerInterval = null;

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shuffleArray(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function getAllQuestions() {
  return Object.values(TESTS).flatMap((t) => t.questions);
}

function setLaunchMode(mode) {
  launchMode = mode;
  document.querySelectorAll('#modePills .mode-pill').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  populateChunkSelect();
}

function populateChunkSelect() {
  const sel = document.getElementById('chunkSelect');
  if (!sel) return;
  const maxLen = Math.max(...Object.values(TESTS).map((t) => t.questions.length));
  const step = 30;
  const prevVal = sel.value;
  sel.innerHTML = `<option value="all">Все вопросы теста</option>`;
  for (let start = 0; start < maxLen; start += step) {
    const end = Math.min(start + step, maxLen);
    sel.innerHTML += `<option value="${start}-${end}">Вопросы ${start + 1}–${end}</option>`;
  }
  if (prevVal && Array.from(sel.options).some((o) => o.value === prevVal)) {
    sel.value = prevVal;
  }
}

function getSubjectMistakeCount(testId) {
  const test = TESTS[testId];
  if (!test) return 0;
  return test.questions.filter((q) => store.mistakes[q.id]).length;
}

function renderHeroStats() {
  const allQs = getAllQuestions();
  const totalMistakes = allQs.filter((q) => store.mistakes[q.id]).length;
  document.getElementById('totalQuestionsCount').textContent = String(allQs.length);
  document.getElementById('totalMistakesCount').textContent = String(totalMistakes);
}

function renderMenu() {
  renderHeroStats();
  populateChunkSelect();
  const container = document.getElementById('testCards');
  container.innerHTML = '';

  Object.values(TESTS).forEach((test) => {
    const mistakesCount = getSubjectMistakeCount(test.id);
    const card = document.createElement('div');
    card.className = 'card subject-card';
    card.innerHTML = `
      <div>
        <span class="badge">${escapeHtml(test.badge)}</span>
        <h2 class="card-title">${escapeHtml(test.title)}</h2>
        <p class="card-meta">${escapeHtml(test.subtitle)}</p>
        <div class="card-stats-row">
          <span>Вопросов: <strong>${test.questions.length}</strong></span>
          <span>Ошибок: <strong>${mistakesCount}</strong></span>
        </div>
      </div>
      <button
        type="button"
        onclick="startTest('${test.id}')"
        class="btn btn-primary ${escapeHtml(test.accentClass)}"
      >
        Запустить (${modeLabel(launchMode)})
      </button>
    `;
    container.appendChild(card);
  });
}

function modeLabel(mode) {
  if (mode === 'exam') return 'Экзамен';
  if (mode === 'mistakes') return 'Над ошибками';
  return 'Обучение';
}

function showMenu() {
  stopTimer();
  session = null;
  document.getElementById('menuView').classList.remove('hidden');
  document.getElementById('quizView').classList.add('hidden');
  document.getElementById('resultView').classList.add('hidden');
  renderMenu();
}

function confirmExitToMenu() {
  showMenu();
}

function buildPreparedQuestions(sourceQuestions, shuffleQ, shuffleOpt) {
  let list = sourceQuestions.slice();
  if (shuffleQ) {
    list = shuffleArray(list);
  }
  return list.map((q) => {
    const indexedOptions = q.options.map((text, origIdx) => ({
      text,
      isCorrect: origIdx === q.correctIndex
    }));
    const finalOptions = shuffleOpt ? shuffleArray(indexedOptions) : indexedOptions;
    const correctIdx = finalOptions.findIndex((o) => o.isCorrect);
    return {
      ...q,
      options: finalOptions.map((o) => o.text),
      correctIndex: correctIdx >= 0 ? correctIdx : 0
    };
  });
}

function startTest(testId, overrideQuestions = null, overrideMode = null) {
  const test = TESTS[testId];
  if (!test) return;

  const activeMode = overrideMode || launchMode;
  const shuffleQ = document.getElementById('shuffleQuestionsCheck').checked;
  const shuffleOpt = document.getElementById('shuffleOptionsCheck').checked;
  const timerMinutes = parseInt(document.getElementById('timerSelect').value, 10) || 0;
  const chunkVal = document.getElementById('chunkSelect').value;

  let pool = overrideQuestions ? overrideQuestions.slice() : test.questions.slice();

  if (!overrideQuestions && chunkVal !== 'all') {
    const [s, e] = chunkVal.split('-').map(Number);
    pool = pool.slice(s, e);
  }

  if (activeMode === 'mistakes' && !overrideQuestions) {
    const mistakePool = pool.filter((q) => store.mistakes[q.id] || store.bookmarks[q.id]);
    if (mistakePool.length > 0) {
      pool = mistakePool;
    } else {
      alert('По выбранному фильтру пока нет сохранённых ошибок или закладок. Запускаем полный набор.');
    }
  }

  if (!pool.length) {
    alert('В выбранном диапазоне нет вопросов.');
    return;
  }

  const prepared = buildPreparedQuestions(pool, shuffleQ, shuffleOpt);

  session = {
    testId: test.id,
    testTitle: test.title,
    mode: activeMode,
    questions: prepared,
    currentIndex: 0,
    answers: {},
    secondsLeft: timerMinutes > 0 ? timerMinutes * 60 : null,
    startedAt: Date.now()
  };

  document.getElementById('menuView').classList.add('hidden');
  document.getElementById('resultView').classList.add('hidden');
  document.getElementById('quizView').classList.remove('hidden');

  setupTimer();
  renderQuestion();
  renderQuestionGrid();
}

function restartCurrentSession() {
  if (!session) return;
  const rawList = session.questions.map((pq) => {
    const orig = TESTS[session.testId].questions.find((q) => q.id === pq.id);
    return orig || pq;
  });
  startTest(session.testId, rawList, session.mode);
}

function retrySessionMistakes() {
  if (!session) return;
  const wrongOriginals = session.questions
    .filter((q, idx) => {
      const ans = session.answers[idx];
      return !ans || !ans.correct;
    })
    .map((pq) => {
      const orig = TESTS[session.testId].questions.find((q) => q.id === pq.id);
      return orig || pq;
    });

  if (!wrongOriginals.length) {
    showMenu();
    return;
  }
  startTest(session.testId, wrongOriginals, 'mistakes');
}

function setupTimer() {
  stopTimer();
  const timerBox = document.getElementById('timerBox');
  if (!session || session.secondsLeft === null) {
    timerBox.classList.add('hidden');
    return;
  }
  timerBox.classList.remove('hidden');
  updateTimerLabel();
  timerInterval = setInterval(() => {
    if (!session || session.secondsLeft === null) return;
    session.secondsLeft -= 1;
    updateTimerLabel();
    if (session.secondsLeft <= 0) {
      stopTimer();
      showResult();
    }
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function updateTimerLabel() {
  if (!session || session.secondsLeft === null) return;
  const sec = Math.max(0, session.secondsLeft);
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  document.getElementById('timerDisplay').textContent = `${m}:${s}`;
}

function renderQuestion() {
  if (!session) return;
  const q = session.questions[session.currentIndex];
  const total = session.questions.length;
  const correctCount = Object.values(session.answers).filter((a) => a.correct).length;

  document.getElementById('activeModeBadge').textContent = modeLabel(session.mode);
  document.getElementById('progressText').textContent = `Вопрос ${session.currentIndex + 1} из ${total}`;
  document.getElementById('scoreText').textContent = `Верно: ${correctCount}`;
  document.getElementById('progressBar').style.width = `${((session.currentIndex + 1) / total) * 100}%`;

  document.getElementById('qNumBadge').textContent = `Вопрос #${q.num}`;
  document.getElementById('qMetaBadge').textContent = q.meta || session.testTitle;
  document.getElementById('questionText').textContent = q.text;

  const markBtn = document.getElementById('markReviewBtn');
  const isMarked = Boolean(store.bookmarks[q.id] || store.mistakes[q.id]);
  markBtn.textContent = isMarked ? '★ В повторе' : '☆ В повтор';

  document.getElementById('prevBtn').disabled = session.currentIndex === 0;
  document.getElementById('nextBtn').textContent =
    session.currentIndex === total - 1 ? 'Завершить ✓' : 'Далее →';

  const list = document.getElementById('optionsList');
  list.innerHTML = '';

  const saved = session.answers[session.currentIndex];
  const feedback = document.getElementById('feedbackBox');
  feedback.className = 'feedback hidden';
  feedback.textContent = '';

  const revealNow = saved !== undefined && session.mode !== 'exam';

  q.options.forEach((opt, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    let cls = 'option-btn';

    if (session.mode === 'exam') {
      if (saved !== undefined && saved.chosen === idx) {
        cls += ' option-selected';
      }
    } else if (revealNow) {
      if (idx === q.correctIndex) {
        cls += ' option-correct';
      } else if (idx === saved.chosen) {
        cls += ' option-wrong';
      } else {
        cls += ' option-dim';
      }
    }

    btn.className = cls;
    btn.innerHTML = `<strong>${String.fromCharCode(65 + idx)}.</strong><span>${escapeHtml(opt)}</span>`;
    btn.onclick = () => selectOption(idx);
    list.appendChild(btn);
  });

  if (revealNow) {
    feedback.classList.remove('hidden');
    if (saved.correct) {
      feedback.classList.add('feedback-ok');
      feedback.textContent = 'Верно!';
    } else {
      feedback.classList.add('feedback-bad');
      feedback.textContent = `Неверно. Правильный ответ: ${q.options[q.correctIndex]}`;
    }
  }

  renderQuestionGrid();
}

function selectOption(idx) {
  if (!session) return;
  const q = session.questions[session.currentIndex];
  const isCorrect = idx === q.correctIndex;
  session.answers[session.currentIndex] = { chosen: idx, correct: isCorrect };

  if (isCorrect) {
    delete store.mistakes[q.id];
  } else {
    store.mistakes[q.id] = true;
  }
  saveStore();
  renderQuestion();
}

function toggleMarkCurrent() {
  if (!session) return;
  const q = session.questions[session.currentIndex];
  if (store.bookmarks[q.id]) {
    delete store.bookmarks[q.id];
  } else {
    store.bookmarks[q.id] = true;
  }
  saveStore();
  renderQuestion();
}

function jumpToQuestion(index) {
  if (!session || index < 0 || index >= session.questions.length) return;
  session.currentIndex = index;
  renderQuestion();
}

function prevQuestion() {
  if (session && session.currentIndex > 0) {
    session.currentIndex -= 1;
    renderQuestion();
  }
}

function nextQuestion() {
  if (!session) return;
  if (session.currentIndex < session.questions.length - 1) {
    session.currentIndex += 1;
    renderQuestion();
  } else {
    finishSessionNow();
  }
}

function finishSessionNow() {
  showResult();
}

function renderQuestionGrid() {
  if (!session) return;
  const grid = document.getElementById('questionGrid');
  grid.innerHTML = '';

  session.questions.forEach((q, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    let cls = 'q-nav-btn';
    if (idx === session.currentIndex) cls += ' is-current';
    const ans = session.answers[idx];
    if (ans !== undefined) {
      if (session.mode === 'exam') {
        cls += ' is-answered';
      } else {
        cls += ans.correct ? ' is-ok' : ' is-bad';
      }
    }
    btn.className = cls;
    btn.textContent = String(idx + 1);
    btn.onclick = () => jumpToQuestion(idx);
    grid.appendChild(btn);
  });
}

function showResult() {
  if (!session) return;
  stopTimer();

  const total = session.questions.length;
  const answeredCount = Object.keys(session.answers).length;
  const correct = Object.values(session.answers).filter((a) => a.correct).length;
  const wrong = answeredCount - correct;
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
  const elapsedSec = Math.max(1, Math.round((Date.now() - session.startedAt) / 1000));
  const mins = Math.floor(elapsedSec / 60);
  const secs = elapsedSec % 60;

  store.history.unshift({
    date: new Date().toLocaleString('ru-RU'),
    testTitle: session.testTitle,
    mode: modeLabel(session.mode),
    correct,
    total,
    pct
  });
  store.history = store.history.slice(0, 25);
  saveStore();

  document.getElementById('quizView').classList.add('hidden');
  document.getElementById('resultView').classList.remove('hidden');

  let grade = 'Нужно повторить';
  if (pct >= 90) grade = 'Отлично (A)';
  else if (pct >= 75) grade = 'Хорошо (B)';
  else if (pct >= 60) grade = 'Удовлетворительно (C)';

  document.getElementById('resultGradePill').textContent = `${grade} • ${pct}%`;
  document.getElementById('resultSummary').textContent =
    `${session.testTitle} (${modeLabel(session.mode)}): верных ответов ${correct} из ${total}.`;

  document.getElementById('resultMetrics').innerHTML = `
    <div class="metric-box"><strong>${correct}</strong><span>Правильно</span></div>
    <div class="metric-box"><strong>${wrong + (total - answeredCount)}</strong><span>Ошибок / без ответа</span></div>
    <div class="metric-box"><strong>${pct}%</strong><span>Точность</span></div>
    <div class="metric-box"><strong>${mins}м ${secs}с</strong><span>Время сессии</span></div>
  `;

  const retryBtn = document.getElementById('retryMistakesBtn');
  if (correct < total) {
    retryBtn.classList.remove('hidden');
  } else {
    retryBtn.classList.add('hidden');
  }

  const reviewCard = document.getElementById('reviewListCard');
  const reviewItems = document.getElementById('reviewItems');
  reviewItems.innerHTML = '';

  session.questions.forEach((q, idx) => {
    const ans = session.answers[idx];
    const isOk = ans && ans.correct;
    const item = document.createElement('div');
    item.className = `review-item ${isOk ? 'ok' : 'bad'}`;
    const chosenText = ans !== undefined ? q.options[ans.chosen] : 'Нет ответа';
    item.innerHTML = `
      <div class="review-q">${idx + 1}. ${escapeHtml(q.text)}</div>
      <div class="${isOk ? 'review-ans-ok' : 'review-ans-bad'}">Ваш ответ: ${escapeHtml(chosenText)}</div>
      ${!isOk ? `<div class="review-ans-ok">Правильный ответ: ${escapeHtml(q.options[q.correctIndex])}</div>` : ''}
    `;
    reviewItems.appendChild(item);
  });
  reviewCard.classList.remove('hidden');
}

function openStatsModal() {
  const modal = document.getElementById('statsModal');
  const body = document.getElementById('statsContent');
  const allQs = getAllQuestions();
  const mistakesTotal = allQs.filter((q) => store.mistakes[q.id]).length;
  const bookmarksTotal = allQs.filter((q) => store.bookmarks[q.id]).length;

  let historyHtml = '<p>История сессий пока пуста.</p>';
  if (store.history.length) {
    historyHtml = store.history
      .map(
        (h) => `
      <div class="stat-row">
        <div><strong>${escapeHtml(h.testTitle)}</strong> — ${escapeHtml(h.mode)}</div>
        <div>Результат: <strong>${h.correct}/${h.total} (${h.pct}%)</strong> • ${escapeHtml(h.date)}</div>
      </div>
    `
      )
      .join('');
  }

  body.innerHTML = `
    <div class="stat-row">
      <div>Вопросов в базе: <strong>${allQs.length}</strong></div>
      <div>Активных ошибок для повторения: <strong>${mistakesTotal}</strong></div>
      <div>Закладок («В повтор»): <strong>${bookmarksTotal}</strong></div>
    </div>
    <div><strong>Последние сессии:</strong></div>
    ${historyHtml}
  `;
  modal.classList.remove('hidden');
}

function closeStatsModal(event) {
  if (event && event.target !== document.getElementById('statsModal')) return;
  document.getElementById('statsModal').classList.add('hidden');
}

function clearSavedProgress() {
  store = { ...DEFAULT_STORE };
  saveStore();
  openStatsModal();
  renderMenu();
}

renderMenu();
