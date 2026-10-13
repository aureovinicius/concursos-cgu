const DATA_URL = "/data/courses.json?v=concursos-3";
const STORAGE_KEY = "concursos-cgu-progress-v1";
const DAILY_GOAL = 50;
const MAX_LESSON_ERRORS = 3;

const modulePalette = { default: ["#4166d9", "#2e4dad"] };

const app = document.querySelector("#app");
const rail = document.querySelector("#right-rail");
const modal = document.querySelector("#lesson-modal");
const toast = document.querySelector("#toast");
const shell = document.querySelector(".shell");
let returnFocus = null;
let introModuleId = null;

let catalog;
let data;
let lessons = [];
let activeView = location.hash.slice(1) || "aprender";
let quiz = null;
let statsPeriod = "30";
let statsMode = "all";
let storageWarning = false;

function localDay() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function loadState() {
  const fallback = {
    xp: 0,
    todayXp: 0,
    dailyDay: localDay(),
    lastStudyDay: null,
    streak: 0,
    completed: [],
    introductionsRead: [],
    answered: [],
    missed: [],
    activeCourse: "desenvolvimento",
    attempts: [],
    favorites: [],
    practiceFilters: {},
    studyUnits: {},
    studyBlocks: {},
    syllabusRead: [],
    statsSince: new Date().toISOString(),
    legacyAnsweredCount: 0,
  };
  try {
    const saved = { ...fallback, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) };
    delete saved.hearts; // Attempts now have their own error limit; keep all study progress.
    for (const key of ["completed", "introductionsRead", "answered", "missed", "favorites", "syllabusRead"]) {
      saved[key] = Array.isArray(saved[key]) ? saved[key].filter(x => typeof x === "string") : [];
    }
    if (!saved.studyBlocks || typeof saved.studyBlocks !== "object" || Array.isArray(saved.studyBlocks)) saved.studyBlocks = {};
    if (!saved.studyUnits || typeof saved.studyUnits !== "object" || Array.isArray(saved.studyUnits)) saved.studyUnits = {};
    saved.attempts = Array.isArray(saved.attempts) ? saved.attempts.filter(a => a && typeof a.questionId === "string" && typeof a.correct === "boolean" && Number.isFinite(Date.parse(a.at))) : [];
    if (!saved.attempts.length && !saved.legacyAnsweredCount) saved.legacyAnsweredCount = saved.answered.length;
    if (!saved.practiceFilters || typeof saved.practiceFilters !== "object" || Array.isArray(saved.practiceFilters)) saved.practiceFilters = {};
    if (saved.dailyDay !== localDay()) {
      saved.todayXp = 0;
      saved.dailyDay = localDay();
    }
    return saved;
  } catch {
    return fallback;
  }
}

let state = loadState();

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); storageWarning = false; }
  catch { storageWarning = true; showToast("O navegador não conseguiu salvar. Mantenha esta página aberta para preservar a sessão."); }
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderMathText(value = "", formatPlain = escapeHtml) {
  const source = String(value);
  const expressions = /\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]/g;
  let html = "";
  let end = 0;
  for (const match of source.matchAll(expressions)) {
    html += formatPlain(source.slice(end, match.index));
    const display = match[2] !== undefined;
    const tex = match[1] ?? match[2];
    try {
      const math = window.katex.renderToString(tex, {
        displayMode: display, output: "htmlAndMathml", throwOnError: true,
        trust: false, strict: "ignore", maxExpand: 1000, maxSize: 12,
      });
      html += `<span class="math-${display ? "display" : "inline"}">${math}</span>`;
    } catch {
      // Keep content readable if a formula or the optional renderer is unavailable.
      html += `<code class="math-fallback">${escapeHtml(tex)}</code>`;
    }
    end = match.index + match[0].length;
  }
  return html + formatPlain(source.slice(end));
}

function renderPlainMarkdown(value) {
  const escaped = escapeHtml(value).replace(/\\([\[\]])/g, "$1");
  const withImages = escaped.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
    const safeUrl = url.startsWith("/assets/questions/") || url.startsWith("https://cdn.cebraspe.org.br/")
      ? url
      : "";
    return safeUrl ? `<img src="${safeUrl}" alt="${alt || "Imagem da questão"}" loading="lazy">` : "";
  });
  return withImages
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n\n+/g, "</p><p>")
    .replace(/\n/g, "<br>");
}

function renderMarkdown(value = "", proseOnly = false) {
  // The question source escapes quotation omissions as Markdown brackets.
  const prose = proseOnly ? String(value).replace(/\\([\[\]])/g, "$1") : String(value).replace(/\\\[\s*(…|\.{3})\s*\\\]/g, "[$1]");
  return `<p>${renderMathText(prose, renderPlainMarkdown)}</p>`;
}

function makeLessons() {
  let globalIndex = 0;
  lessons = data.modules.flatMap((module, moduleIndex) => {
    const questions = data.questions.filter((question) => question.moduleId === module.id);
    const byId = new Map(questions.map(q => [q.id, q]));
    const groups = data.lessonLayout?.[module.id] || Array.from({ length: Math.ceil(questions.length / 5) }, (_, i) => questions.slice(i * 5, i * 5 + 5).map(q => q.id));
    return groups.map((ids, index) => {
      const lessonQuestions = ids.map(id => byId.get(id)).filter(Boolean);
      const lesson = {
        id: `${module.id}-${index + 1}`,
        module,
        moduleIndex,
        index,
        globalIndex: globalIndex++,
        title: ["Fundamentos", "Aplicações", "Desafio CGU", "Domínio"][index] || `Prática ${index + 1}`,
        questions: lessonQuestions.length ? lessonQuestions : questions.slice(0, 5),
      };
      return lesson;
    });
  });
}

function isUnlocked(lesson) {
  return state.completed.includes(lesson.id) || lesson.index === 0 || state.completed.includes(lessons[lesson.globalIndex - 1]?.id);
}

function setCourse(courseId) {
  const course = catalog.courses.find((c) => c.id === courseId) || catalog.courses[0];
  const byId = new Map(catalog.questions.map((q) => [q.id, q]));
  data = { ...course, questions: course.questionIds.map((id) => {
    const question = byId.get(id);
    if (!course.integrated) return question;
    const module = course.modules.find((m) => course.integratedBy === "subject" ? m.subjectId === question.subjectId : m.competency === question.competency);
    return { ...question, moduleId: module.id, moduleTitle: module.title };
  }) };
  state.activeCourse = course.id;
  makeLessons();
  if (!data.modules.some(m => m.id === state.studyUnits[data.id]) && data.recommendedModule) {
    state.studyUnits[data.id] = data.recommendedModule;
  }
  const selectedModule = data.modules.find(m => m.id === state.studyUnits[data.id]);
  if (selectedModule) state.studyBlocks[data.id] = selectedModule.block;
  for (const [currentId, oldId] of Object.entries(course.legacyLessonCredits || {})) {
    if (state.completed.includes(oldId) && !state.completed.includes(currentId)) state.completed.push(currentId);
  }
  for (const lesson of lessons) {
    if (lessonCredits(lesson).length === lesson.questions.length && !state.completed.includes(lesson.id)) state.completed.push(lesson.id);
  }
  const filters = state.practiceFilters[course.id];
  if (filters?.module && !course.modules.some(m => m.id === filters.module)) filters.module = "";
  saveState();
}

function completedLessons() {
  return lessons.filter((lesson) => state.completed.includes(lesson.id)).length;
}

function courseSwitcher() {
  return `<div class="course-switcher"><label for="course-select">Especialidade</label><select id="course-select" aria-label="Especialidade">${catalog.courses.map(course => `<option value="${course.id}" ${course.id === data.id ? "selected" : ""}>${escapeHtml(course.title)}</option>`).join("")}</select><span>CGU 2026 · AFFC</span></div>`;
}

function referenceMarkup(module) {
  return `<details class="competency-reference"><summary>Conteúdo do edital · ${escapeHtml(module.block)} · item ${escapeHtml(module.section)}</summary><p><strong>${escapeHtml(module.officialTitle)}</strong></p><p>${escapeHtml(module.syllabusText)}</p><a class="source-link" href="${escapeHtml(catalog.exam.sourceUrl)}" target="_blank" rel="noreferrer">Consultar banca ↗</a></details>`;
}

function nextLesson() {
  return lessons.find((lesson) => isUnlocked(lesson) && !state.completed.includes(lesson.id)) || lessons[0];
}

function statMarkup() {
  return `
    <div class="stat-chip fire" title="Sequência diária">🔥 ${state.streak}</div>
    <div class="stat-chip xp" title="Pontos de experiência">✦ ${state.xp}</div>
  `;
}

function renderRail() {
  const goal = Math.min(100, (state.todayXp / DAILY_GOAL) * 100);
  const completed = completedLessons();
  const course = Math.round((data.studyGuide ? studiedQuestionIds().size / Math.max(data.total, 1) : completed / Math.max(lessons.length, 1)) * 100);
  rail.innerHTML = `
    <div class="stat-strip">${statMarkup()}</div>
    <section class="rail-card">
      <h3>Meta diária</h3>
      <p>Ganhe ${DAILY_GOAL} XP para fechar o dia.</p>
      <div class="progress-row"><span>Hoje</span><span>${state.todayXp} / ${DAILY_GOAL} XP</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${goal}%"></div></div>
    </section>
    <section class="rail-card">
      <h3>Seu curso</h3>
      <p>${data.studyGuide ? `${studiedQuestionIds().size} de ${data.total} questões em lições concluídas.` : `${completed} de ${lessons.length} lições concluídas.`}</p>
      <div class="progress-row"><span>${escapeHtml(data.title)}</span><span>${course}%</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${course}%;background:var(--green)"></div></div>
      <button class="button" data-action="continue">${data.studyGuide ? "Estudar tema" : "Continuar"}</button>
    </section>
    <section class="rail-card">
      <h3>Estudo dirigido</h3>
      <p class="tiny">${data.total} itens autorais de Certo ou Errado nesta especialidade, com explicação e fonte. Banco inicial em expansão.</p>
      <p class="tiny" style="margin-top:9px"><a class="source-link" href="${escapeHtml(catalog.exam.sourceUrl)}" target="_blank" rel="noreferrer">Edital CGU 2026 ↗</a></p>
    </section>
  `;
}

function pageHeader(kicker, title, subtitle) {
  return `
    <div class="mobile-stats">${statMarkup()}</div>
    ${courseSwitcher()}
    <p class="page-kicker">${kicker}</p>
    <h1 class="page-title">${title}</h1>
    <p class="page-subtitle">${subtitle}</p>
  `;
}

function lessonCredits(lesson) {
  return lesson.questions.filter(q => state.completed.includes(data.legacyQuestionCredits?.[q.id]));
}

function studiedQuestionIds() {
  return new Set(lessons.flatMap(lesson => state.completed.includes(lesson.id)
    ? lesson.questions.map(q => q.id) : lessonCredits(lesson).map(q => q.id)));
}

function selectedStudyModule() {
  return data.modules.find(m => m.id === state.studyUnits[data.id]) || nextLesson()?.module || data.modules[0];
}

function pendingUnitLesson(moduleId) {
  return lessons.find(l => l.module.id === moduleId && !state.completed.includes(l.id) && isUnlocked(l));
}

function selectStudyUnit(moduleId) {
  if (!data.modules.some(m => m.id === moduleId)) return;
  state.studyUnits[data.id] = moduleId;
  state.studyBlocks[data.id] = data.modules.find(m => m.id === moduleId).block;
  saveState(); renderLearn();
  app.querySelector('.study-detail h2')?.focus({ preventScroll: true });
  app.querySelector('.study-detail')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function practiceUnit(moduleId) {
  if (!data.modules.some(m => m.id === moduleId)) return;
  state.practiceFilters[data.id] = { ...defaultPracticeFilters(), module: moduleId };
  activeView = 'praticar'; history.replaceState(null, '', '#praticar');
  saveState(); renderPage();
}

function renderStudyTrail() {
  const module = selectedStudyModule();
  const unitLessons = lessons.filter(l => l.module.id === module.id);
  const next = pendingUnitLesson(module.id);
  const introRead = state.introductionsRead.includes(module.id);
  const studied = studiedQuestionIds();
  const currentQuestions = data.questions.filter(q => q.moduleId === module.id);
  const unitStudied = currentQuestions.filter(q => studied.has(q.id)).length;
  const complete = unitLessons.length > 0 && !next;
  const [color, dark] = module.color;
  const studyBlock = state.studyBlocks[data.id] || module.block;
  const nextLabel = !introRead ? 'Ler introdução' : next ? `Continuar lição ${next.index + 1} de ${unitLessons.length}` : 'Revisar introdução';
  app.innerHTML = `
    ${pageHeader('CGU 2026 · Trilha de estudo', 'Sua próxima conquista começa aqui.', escapeHtml(data.description))}
    ${examBanner()}
    <section class="study-overview" aria-label="Progresso da trilha">
      <div><strong>${studied.size} de ${data.total}</strong><span>questões em lições concluídas</span></div>
      <div><strong>${data.modules.length} disciplinas</strong><span>lições de até 5 questões</span></div>
      <progress max="${Math.max(data.total, 1)}" value="${studied.size}" aria-label="Questões concluídas nesta especialidade"></progress>
    </section>
    <section class="study-map" aria-labelledby="study-map-title">
      <div class="section-heading"><div><p class="page-kicker">Seu mapa de estudo</p><h2 id="study-map-title">Escolha seu foco</h2></div></div>
      <p class="study-help">Escolha uma disciplina do edital. Os conhecimentos básicos e complementares são comuns às quatro especialidades. Seu progresso nesses itens é compartilhado entre as trilhas.</p>
      <div class="block-tabs" role="group" aria-label="Blocos da prova">${catalog.exam.blocks.map(b => `<button data-study-block="${b.id}" aria-pressed="${studyBlock === b.id}">${b.id} · ${blockLabel(b.id)}</button>`).join("")}</div>
      <div class="study-grid">${data.modules.filter(m => m.block === studyBlock).map((m, i) => {
        const qs = data.questions.filter(q => q.moduleId === m.id);
        const done = qs.filter(q => studied.has(q.id)).length;
        return `<button class="study-unit ${m.id === module.id ? 'selected' : ''}" data-study-unit="${m.id}" aria-pressed="${m.id === module.id}">
          <span class="study-unit-top"><span aria-hidden="true">${m.emoji}</span><span>${m.block} · ${blockLabel(m.block)}</span>${qs.length && done === qs.length ? '<span class="study-done">✓ Concluído</span>' : ''}</span>
          <strong>${escapeHtml(m.title)}</strong><span>${done}/${qs.length} questões concluídas</span>
          <progress max="${Math.max(qs.length, 1)}" value="${done}" aria-label="Progresso de ${escapeHtml(m.title)}"></progress>
        </button>`;
      }).join('')}</div>
    </section>
    <section class="study-detail unit" id="unit-${module.id}" style="--unit-color:${color};--unit-dark:${dark}" aria-labelledby="study-unit-title">
      <div class="unit-banner"><div class="unit-title-wrap"><span class="unit-emoji">${module.emoji}</span><div><h2 id="study-unit-title" tabindex="-1">${escapeHtml(module.title)}</h2><p>${escapeHtml(module.description)}</p></div></div><span class="unit-count">${unitStudied}/${currentQuestions.length} questões</span></div>
      <div class="study-next"><div><p class="page-kicker">${complete ? 'Banco da unidade concluído' : 'Seu próximo passo'}</p><h3>${!introRead ? 'Comece pelos conceitos' : next ? `Lição ${next.index + 1}: coloque em prática` : 'Continue consolidando o que aprendeu'}</h3><p>${!introRead ? `${module.introduction.duration} para entender as ideias e ver um exemplo resolvido.` : next ? `${counted(next.questions.length - lessonCredits(next).length, 'questão', 'questões')} para concluir esta lição. Até ${MAX_LESSON_ERRORS} erros; ao reiniciar, as chances se renovam.` : 'Revise a introdução ou resolva questões aleatórias deste tema.'}</p></div>
        <div class="study-actions"><button class="button" ${!introRead || !next ? `data-intro="${module.id}"` : `data-lesson="${next.id}"`}>${nextLabel}</button><button class="button secondary" data-practice-unit="${module.id}" ${currentQuestions.length ? "" : "disabled"}>Praticar esta disciplina</button></div>
      </div>
      <button class="intro-card" data-intro="${module.id}" aria-label="Introdução conceitual de ${escapeHtml(module.title)}"><span class="intro-icon" aria-hidden="true">☰</span><span><strong>${introRead ? 'Revisar conceitos' : 'Introdução conceitual'}</strong><span>${escapeHtml(module.introduction.summary)}</span><small>${introRead ? '✓ Leitura concluída' : module.introduction.duration + ' de leitura'}</small></span><span aria-hidden="true">↗</span></button>
      ${referenceMarkup(module)}
      ${!unitLessons.length ? '<p class="notice">Questões em preparação para esta disciplina. Você já pode estudar a introdução e o programa oficial.</p>' : ""}
      <div class="study-lessons" aria-label="Lições de ${escapeHtml(module.title)}">${unitLessons.map(l => {
        const done = state.completed.includes(l.id);
        const credits = lessonCredits(l).length;
        const unlocked = isUnlocked(l);
        return `<button class="study-lesson ${done ? 'done' : ''}" ${unlocked ? `data-lesson="${l.id}"` : 'disabled'} aria-label="Lição ${l.index + 1}${done ? ', concluída, revisar' : unlocked ? '' : ', bloqueada'}"><span class="study-lesson-icon" aria-hidden="true">${done ? '✓' : unlocked ? '▶' : '🔒'}</span><span><strong>Lição ${l.index + 1}</strong><small>${done ? 'Concluída · Revisar' : credits ? `${credits}/${l.questions.length} questões já concluídas` : counted(l.questions.length, 'questão', 'questões')}</small></span><span>${!unlocked ? 'Conclua a anterior' : done ? 'Revisar' : 'Estudar'}</span></button>`;
      }).join('')}</div>
    </section>`;
}

function renderLearn() { renderStudyTrail(); }

function examBanner() {
  return `<section class="exam-banner" aria-label="Resumo do concurso"><div><span class="exam-label">SEU OBJETIVO</span><h2>CGU · ${escapeHtml(data.title)}</h2><p>Auditor Federal de Finanças e Controle</p></div><div class="exam-facts"><span><strong>13 dez 2026</strong>provas previstas</span><span><strong>${data.vacancies} vagas</strong>nesta especialidade</span><a href="#edital" data-view="edital">Explorar edital ↗</a></div></section><p class="catalog-note">Banco inicial: ${data.total} exercícios autorais comentados. Concluir este banco não significa cobrir todo o edital.</p>`;
}

function blockLabel(id) { return ({P1:"Básicos", P2:"Complementares", P3:"Específicos"})[id] || id; }

function defaultPracticeFilters() { return { module: "", block: "", status: "all", query: "" }; }

function practiceFilters() {
  return { ...defaultPracticeFilters(), ...state.practiceFilters[data.id] };
}

function questionMatches(question, filters) {
  if (filters.module && question.moduleId !== filters.module) return false;
  if (filters.block && question.block !== filters.block) return false;
  if (filters.status === "unanswered" && state.answered.includes(question.id)) return false;
  if (filters.status === "answered" && !state.answered.includes(question.id)) return false;
  if (filters.status === "wrong" && !state.missed.includes(question.id)) return false;
  if (filters.status === "favorites" && !state.favorites.includes(question.id)) return false;
  const query = String(filters.query || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  if (query) {
    const haystack = [question.id, question.context, question.alternativesIntroduction, question.moduleTitle, ...question.alternatives.map(a => a.text)].join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (!query.split(/\s+/).every(word => haystack.includes(word))) return false;
  }
  return true;
}

function filteredPracticeQuestions(filters = practiceFilters()) {
  return data.questions.filter(q => questionMatches(q, filters));
}

function filterOptions(values, selected, allLabel) {
  return `<option value="">${allLabel}</option>${values.map(([value, label]) => `<option value="${escapeHtml(value)}" ${String(value) === String(selected) ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}`;
}

function renderPractice() {
  const filters = practiceFilters();
  const pool = filteredPracticeQuestions(filters);
  const metrics = performanceMetrics(courseAttempts());
  app.innerHTML = `
    ${pageHeader("Questões · CGU 2026", "Treine no seu ritmo.", "Resolva itens de Certo ou Errado. Leia a justificativa, revise seus erros e continue pelo tempo que quiser.")}
    <div class="practice-overview"><span><strong>${metrics.total}</strong> respostas registradas</span><span><strong>${metrics.accuracy === null ? "—" : metrics.accuracy + "%"}</strong> de acerto</span><a href="#desempenho" data-view="desempenho">Ver desempenho ↗</a></div>
    <form id="practice-filters" class="filter-card"><div class="section-heading"><div><p class="page-kicker">Monte seu treino</p><h2>Filtros de questões</h2></div><button type="button" class="text-button" data-action="reset-filters">Limpar filtros</button></div>
      <div class="filter-grid">
        <label>Bloco da prova<select name="block">${filterOptions(catalog.exam.blocks.map(b => [b.id, b.id + " · " + b.title]), filters.block, "Todos os blocos")}</select></label>
        <label>Disciplina<select name="module">${filterOptions([...data.modules].sort((a,b) => a.title.localeCompare(b.title,"pt-BR")).map(m => [m.id, m.title]), filters.module, "Todas as disciplinas")}</select></label>
        <label>Minha resolução<select name="status">${[["all","Todas as questões"],["unanswered","Ainda não respondi"],["wrong","Erros para revisar"],["answered","Já respondi"],["favorites","Favoritas"]].map(([v,l]) => `<option value="${v}" ${filters.status === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label>Palavra-chave ou código<input name="query" type="search" maxlength="120" value="${escapeHtml(filters.query)}" placeholder="Ex.: integridade, dados, auditoria"></label>
      </div><button class="button secondary" type="submit">Aplicar filtros</button>
      <p class="filter-help">A especialidade é escolhida no seletor acima. Origem do banco: exercícios autorais de estudo, alinhados ao edital; não são itens oficiais da banca.</p>
    </form>
    <section class="practice-launch" aria-live="polite"><div><p class="page-kicker">Sua seleção</p><h2>${counted(pool.length,"questão encontrada","questões encontradas")}</h2><p>${pool.length ? "Sorteio sem repetição até percorrer a seleção." : "Nenhum item corresponde aos filtros. Amplie sua seleção."}</p></div><button class="button" data-action="practice" ${pool.length ? "" : "disabled"}>Iniciar prática →</button></section>
    <div class="notice">Prática sem limite de erros. Acerto vale +1 em P1/P2 e +2 em P3; erro desconta o mesmo valor. Pular não pontua nem registra resposta. O saldo deste treino não prevê sua nota na prova.</div>`;
}

function courseAttempts(period = "all", mode = "all") {
  const ids = new Set(data.questionIds);
  const earliest = period === "all" ? "" : new Date(new Date(`${localDay()}T12:00:00Z`).getTime() - (Number(period) - 1) * 86400000).toISOString().slice(0, 10);
  return state.attempts.filter(a => ids.has(a.questionId) && (mode === "all" || a.mode === mode) && (!earliest || a.day >= earliest));
}

function performanceMetrics(attempts) {
  const correct = attempts.filter(a => a.correct).length;
  const duration = attempts.reduce((sum, a) => sum + (Number.isFinite(a.durationMs) ? a.durationMs : 0), 0);
  const points = attempts.reduce((sum,a) => sum + (Number.isFinite(a.points) ? a.points : 0), 0);
  return { points, total: attempts.length, correct, wrong: attempts.length - correct, unique: new Set(attempts.map(a => a.questionId)).size, accuracy: attempts.length ? Math.round(correct / attempts.length * 100) : null, duration, average: attempts.length ? duration / attempts.length : 0 };
}

function formatDuration(ms) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}min`;
}

function counted(value, singular, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function renderPerformance() {
  const attempts = courseAttempts(statsPeriod, statsMode);
  const metrics = performanceMetrics(attempts);
  const questionById = new Map(data.questions.map(q => [q.id, q]));
  const rows = data.modules.map(module => ({ module, ...performanceMetrics(attempts.filter(a => questionById.get(a.questionId)?.moduleId === module.id)) }));
  const days = Array.from({ length: 7 }, (_, index) => new Date(new Date(`${localDay()}T12:00:00Z`).getTime() - (6 - index) * 86400000).toISOString().slice(0, 10));
  const daily = days.map(day => ({ day, ...performanceMetrics(attempts.filter(a => a.day === day)) }));
  const max = Math.max(1, ...daily.map(d => d.total));
  app.innerHTML = `
    ${pageHeader("Estatísticas", "Veja sua evolução.", "Acompanhe suas respostas e descubra os assuntos que merecem mais atenção.")}
    <div class="stats-controls"><label>Período<select id="stats-period">${[["7", "Últimos 7 dias"], ["30", "Últimos 30 dias"], ["all", "Todo o histórico"]].map(([v, l]) => `<option value="${v}" ${statsPeriod === v ? "selected" : ""}>${l}</option>`).join("")}</select></label><label>Modo<select id="stats-mode">${[["all", "Todos os modos"], ["practice", "Prática"], ["lesson", "Lições"]].map(([v, l]) => `<option value="${v}" ${statsMode === v ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
    ${storageWarning ? '<div class="notice">O navegador não conseguiu salvar o histórico. Os dados desta sessão estão apenas na memória; libere espaço para preservá-los.</div>' : ""}
    <div class="metric-grid">
      ${[[metrics.total, "Respostas", `${metrics.unique} ${metrics.unique === 1 ? "questão distinta" : "questões distintas"}`], [`${metrics.accuracy === null ? "—" : `${metrics.accuracy}%`}`, "Taxa de acerto", `${counted(metrics.correct, "acerto")} · ${counted(metrics.wrong, "erro")}`], [metrics.points, "Saldo do treino", "P1/P2: +1/−1 · P3: +2/−2"], [data.questions.filter(q => state.missed.includes(q.id)).length, "Erros para revisar", "Situação atual da matéria"]].map(([n, title, detail]) => `<article class="metric-card"><strong>${n}</strong><h2>${title}</h2><p>${detail}</p></article>`).join("")}
    </div>
    <p class="stats-note">Saldo acumulado das respostas deste período, incluindo repetições. Não é nota estimada de aprovação. Tempo: ${formatDuration(metrics.duration)} · média ${formatDuration(metrics.average)} por resposta.</p>
    ${!metrics.total ? '<div class="empty-state"><span aria-hidden="true">↗</span><h2>Seu próximo treino começa este gráfico.</h2><p>Responda uma questão na prática ou nas lições. O resultado aparece aqui assim que você verifica a resposta.</p><a class="button" href="#praticar" data-view="praticar">Escolher questões</a></div>' : ""}
    <section class="stats-card"><div class="section-heading"><h2>Ritmo nos últimos 7 dias</h2><span class="chart-legend"><i></i> Acertos <i class="wrong"></i> Erros</span></div><div class="activity-chart">${daily.map(d => `<div class="day-column"><span>${d.total}</span><div class="day-track" role="img" aria-label="${d.day}: ${counted(d.correct, "acerto")} e ${counted(d.wrong, "erro")}"><div class="day-wrong" style="height:${d.wrong / max * 100}%"></div><div class="day-correct" style="height:${d.correct / max * 100}%"></div></div><small>${d.day.slice(8)}/${d.day.slice(5, 7)}</small></div>`).join("")}</div></section>
    <section class="stats-card"><div class="section-heading"><h2>Desempenho por assunto</h2><span class="tiny">Cada tentativa conta</span></div><div class="performance-list">${rows.map(row => `<div class="performance-row"><div><strong>${escapeHtml(row.module.title)}</strong><small>${counted(row.total, "resposta")} · ${counted(row.correct, "acerto")} · ${counted(row.wrong, "erro")}</small></div><div class="performance-result"><strong>${row.accuracy === null ? "—" : `${row.accuracy}%`}</strong><div class="progress-track"><div class="progress-fill" style="width:${row.accuracy || 0}%"></div></div></div></div>`).join("")}</div></section>
    ${attempts.length ? `<section class="stats-card"><h2>Respostas recentes</h2><div class="recent-list">${attempts.slice(-10).reverse().map(a => { const q = questionById.get(a.questionId); return `<div class="recent-row"><span class="result-icon ${a.correct ? "" : "wrong"}">${a.correct ? "✓" : "×"}</span><div><strong>Item ${q.index} · ${q.block}</strong><small>${escapeHtml(q.moduleTitle)} · ${a.mode === "practice" ? "Prática" : "Lição"} · ${a.day.split("-").reverse().join("/")}</small></div><span>${formatDuration(a.durationMs || 0)}</span></div>`; }).join("")}</div></section>` : ""}
    <p class="stats-note">Histórico salvo neste navegador, sem sincronização entre dispositivos.${state.legacyAnsweredCount ? ` As ${state.legacyAnsweredCount} respostas anteriores permanecem no progresso, mas não entram nas taxas por não terem acerto e tempo registrados.` : ""} O tempo mede apenas a questão aberta e visível, até a correção; leitura da resolução e questões puladas não entram.</p>
  `;
}

function questionMeta(question) {
  return `<span class="origin-badge">Autoral · estudo dirigido</span><span class="block-badge">${question.block} · acerto +${question.weight} / erro −${question.weight}</span>`;
}

function answerLabel(question, letter) { return question.alternatives.find(a => a.letter === letter)?.text || letter; }

function markStudyDay() {
  const today = localDay();
  if (state.lastStudyDay === today) return;
  const yesterday = new Date(new Date(`${today}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
  state.streak = state.lastStudyDay === yesterday ? state.streak + 1 : 1;
  state.lastStudyDay = today;
}

function stopQuestionTimer() {
  if (!quiz || quiz.checked || quiz.timerStartedAt === null) return;
  quiz.elapsedMs += Math.max(0, Date.now() - quiz.timerStartedAt);
  quiz.timerStartedAt = null;
}

function startQuestionTimer() {
  if (quiz && !quiz.checked && !quiz.ended && !document.hidden && quiz.timerStartedAt === null) quiz.timerStartedAt = Date.now();
}

function resetQuestionTimer() {
  quiz.elapsedMs = 0;
  quiz.timerStartedAt = null;
  startQuestionTimer();
}

function recordAttempt(question, correct) {
  const at = new Date().toISOString();
  state.attempts.push({ questionId: question.id, answer: quiz.selected, correct, at, day: localDay(), durationMs: Math.round(quiz.elapsedMs), mode: quiz.practice ? "practice" : "lesson", courseId: data.id, block: question.block, points: correct ? question.weight : -question.weight });
  markStudyDay();
}

function drawPracticeQuestion() {
  const byId = new Map(data.questions.map(q => [q.id, q]));
  const previous = quiz.questions[quiz.index]?.id;
  while (quiz.queue.length) {
    const question = byId.get(quiz.queue.shift());
    if (question && questionMatches(question, quiz.filters)) return question;
  }
  const eligible = filteredPracticeQuestions(quiz.filters);
  if (!eligible.length) return null;
  quiz.cycle += 1;
  quiz.queue = shuffle(eligible).map(q => q.id);
  if (quiz.queue.length > 1 && quiz.queue[0] === previous) [quiz.queue[0], quiz.queue[1]] = [quiz.queue[1], quiz.queue[0]];
  showToast("Seleção percorrida. Começando uma nova rodada aleatória.");
  return byId.get(quiz.queue.shift());
}

function endPractice(exhausted = false) {
  if (!quiz?.practice) return;
  stopQuestionTimer();
  const answered = quiz.answeredCount;
  const accuracy = answered ? Math.round(quiz.correct / answered * 100) : null;
  quiz.ended = true;
  modal.innerHTML = `<div class="quiz-shell"><div class="finish-card"><div class="finish-burst">${exhausted ? "✓" : "↗"}</div><h1 tabindex="-1">${exhausted ? "Seleção concluída!" : "Prática encerrada"}</h1><p>${exhausted ? "Não restam questões que atendam aos filtros atuais. Ajuste sua seleção para continuar." : "Cada resposta corrigida já está salva no seu desempenho."}</p><div class="finish-stats"><div class="finish-stat"><strong>${answered}</strong><span>Respondidas</span></div><div class="finish-stat"><strong>${accuracy === null ? "—" : `${accuracy}%`}</strong><span>Acerto</span></div><div class="finish-stat"><strong>${quiz.skipped}</strong><span>Puladas</span></div></div><p>${counted(quiz.correct, "acerto")} · ${counted(answered - quiz.correct, "erro")} · ${formatDuration(quiz.totalDurationMs)} respondendo</p><div class="finish-actions"><button class="button" data-action="finish">Voltar aos filtros</button><button class="button secondary" data-action="view-performance">Ver desempenho</button></div></div></div>`;
  modal.querySelector("h1").focus();
}

function skipPracticeQuestion() {
  if (!quiz?.practice || quiz.checked || quiz.ended) return;
  quiz.skipped += 1;
  advancePractice();
}

function advancePractice() {
  const question = drawPracticeQuestion();
  if (!question) { endPractice(true); return; }
  quiz.questions.push(question);
  quiz.index += 1;
  quiz.selected = null;
  quiz.checked = false;
  resetQuestionTimer();
  renderQuestion();
  modal.querySelector("h1").focus({ preventScroll: true });
  modal.scrollTo({ top: 0, behavior: "smooth" });
}

function renderAchievements() {
  const achievements = [
    ["🚀", "Primeiro passo", "Conclua sua primeira lição.", state.completed.length >= 1],
    ["🔥", "Em chamas", "Mantenha uma sequência de 3 dias.", state.streak >= 3],
    ["⚡", "Em evolução", "Acumule 200 XP.", state.xp >= 200],
    ["🎯", "Precisão", "Responda 20 questões.", state.answered.length >= 20],
    ["🏅", "Meio caminho", `Conclua metade da trilha de ${data.title}.`, lessons.length > 0 && completedLessons() >= Math.ceil(lessons.length / 2)],
    ["🧠", `Domínio de ${data.title}`, "Conclua toda a trilha selecionada.", lessons.length > 0 && completedLessons() >= lessons.length],
  ];
  app.innerHTML = `
    ${pageHeader("Seu progresso", "Conquistas", "Cada marco registra a constância que você está construindo.")}
    <div class="achievement-grid">
      ${achievements.map(([icon, title, description, unlocked]) => `
        <article class="badge-card ${unlocked ? "" : "locked"}">
          <div class="badge-icon">${icon}</div>
          <div><h3>${title}</h3><p>${unlocked ? "Conquista desbloqueada!" : description}</p></div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderAbout() {
  app.innerHTML = `${pageHeader("Sobre o projeto", "Concursos", "Um treino diário com questões comentadas, trilhas por edital e progresso que acompanha seu esforço.")}
  <div class="about-grid"><article class="info-card"><div class="big-number">${catalog.total}</div><h3>itens autorais únicos</h3><p>Banco inicial de Certo ou Errado. Os itens comuns aparecem nas quatro especialidades, sem duplicar o histórico.</p></article><article class="info-card"><div class="big-number">4</div><h3>especialidades da CGU</h3><p>Auditoria, Ciência de Dados, Infraestrutura de TI e Desenvolvimento de Sistemas.</p></article></div>
  <div class="notice"><strong>Como estudar:</strong> leia a introdução, resolva uma lição de até cinco questões e consulte a justificativa. Lições permitem até três erros por tentativa; reiniciar renova as chances. Na prática, não há limite de erros.</div>
  <div class="notice"><strong>Origem do conteúdo:</strong> exercícios, comentários e introduções são autorais. Os vínculos ao programa são editoriais. O app não tem vínculo com a CGU ou o Cebraspe. A prova de 2026 ainda não foi aplicada. Este banco inicial não cobre todos os tópicos do edital, e a discursiva não possui correção automática.</div>
  <div class="notice"><strong>Instalar o Concursos:</strong> use “Instalar aplicativo” no menu do Chrome ou Edge. No iPhone/iPad, Compartilhar → Adicionar à Tela de Início. O conteúdo já carregado pode ser usado offline. Seu progresso fica neste navegador e é separado do ENEM.</div>
  <div class="notice"><strong>Fontes:</strong> <a href="${escapeHtml(catalog.exam.sourceUrl)}" class="source-link" target="_blank" rel="noreferrer">página oficial da banca</a> · <a href="/data/edital-cgu-2026.pdf" class="source-link" download>edital local em PDF</a> · <a href="/data/courses.json" class="source-link" download>baixar banco de estudo</a>. Verificação do edital: 13/10/2026. Consulte a banca para retificações.</div>`;
}

function renderEdital() {
  const exam = catalog.exam;
  const checked = data.modules.filter(m => state.syllabusRead.includes(m.id)).length;
  app.innerHTML = `${pageHeader("Edital nº 1 · 8 de outubro de 2026", "Conheça seu caminho.", "Programa oficial organizado por bloco. Marque as disciplinas que você já revisou e acompanhe o conteúdo disponível para treino.")}
  ${examBanner()}
  <div class="edital-links"><a class="button" href="/data/edital-cgu-2026.pdf" target="_blank" rel="noreferrer">Abrir edital completo ↗</a><a class="button secondary" href="${escapeHtml(exam.sourceUrl)}" target="_blank" rel="noreferrer">Banca e atualizações ↗</a></div>
  <div class="exam-summary"><p><strong>Inscrições:</strong> 10/10 a 04/11/2026.</p><p><strong>Objetivas:</strong> 170 itens C/E · 5h · manhã · até 260 pontos.</p><p><strong>Discursiva:</strong> 2 questões · 3h30 · tarde · até 100 pontos. Sem correção discursiva neste app.</p></div>
  <div class="exam-blocks">${exam.blocks.map(b => `<article><span>${b.id}</span><h2>${b.title}</h2><strong>${b.items} itens</strong><p>Acerto +${b.correctPoints} · erro ${b.wrongPoints}<br>Mínimo: ${b.minimumPoints} pontos</p></article>`).join("")}</div>
  <p class="stats-note">Branco e dupla marcação: 0. Mínimo total nas objetivas: 78; na discursiva: 50. Esses mínimos não garantem classificação. Confira todas as regras nos itens 8 e 9 do edital.</p>
  <section class="stats-card"><h2>Seu edital por disciplina</h2><p id="edital-progress" aria-live="polite">${checked}/${data.modules.length} disciplinas marcadas como revisadas. Este checklist é independente das lições.</p><div class="edital-list">${data.modules.map(m => {
    const count = data.questions.filter(q => q.moduleId === m.id).length;
    return `<details><summary><span class="block-badge">${m.block}</span><strong>${escapeHtml(m.title)}</strong><span>${count} itens de treino</span></summary><p><strong>${escapeHtml(m.officialTitle)}</strong></p><div class="syllabus-text">${escapeHtml(m.syllabusText).replace(/ (?=\d+\.\d* ?[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/g,"<br><br>")}</div><div class="edital-actions"><label class="check-label"><input type="checkbox" data-syllabus="${m.id}" ${state.syllabusRead.includes(m.id) ? "checked" : ""}> Já revisei esta disciplina</label><button class="button secondary" data-open-study="${m.id}">Estudar disciplina</button></div></details>`;
  }).join("")}</div></section><p class="stats-note">Texto do item 15.2 do edital de abertura. Os títulos curtos são editoriais. A marcação de revisão não representa cobertura completa do banco. Fonte conferida em 13/10/2026.</p>`;
}

function renderPage(resetScroll = true) {
  document.querySelectorAll("[data-view]").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === activeView);
  });
  if (activeView === "praticar") renderPractice();
  else if (activeView === "desempenho") renderPerformance();
  else if (activeView === "conquistas") renderAchievements();
  else if (activeView === "edital") renderEdital();
  else if (activeView === "sobre") renderAbout();
  else renderLearn();
  renderRail();
  if (resetScroll) window.scrollTo({ top: 0, behavior: "smooth" });
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function openModal(label) {
  returnFocus = document.activeElement;
  modal.setAttribute("aria-label", label);
  modal.hidden = false;
  shell.inert = true;
  document.body.style.overflow = "hidden";
  modal.scrollTop = 0;
}

function openIntroduction(moduleId) {
  const module = data.modules.find((item) => item.id === moduleId);
  if (!module) return;
  const intro = module.introduction;
  introModuleId = moduleId;
  const [color, dark] = modulePalette[moduleId] || module.color || modulePalette.default;
  openModal(`Introdução conceitual de ${module.title}`);
  modal.innerHTML = `
    <div class="intro-shell" style="--unit-color:${color};--unit-dark:${dark}">
      <header class="intro-topbar"><span>${module.emoji} ${module.title} · ${intro.duration}</span><button class="icon-button" data-action="close-intro" aria-label="Fechar introdução">×</button></header>
      <article class="intro-content">
        <p class="page-kicker">Introdução conceitual</p>
        <h1 class="page-title" tabindex="-1">${renderMathText(intro.title)}</h1>
        <p class="page-subtitle">${renderMathText(intro.summary)}</p>
        ${referenceMarkup(module)}
        ${intro.sections.map((section, index) => `<section class="concept-section"><span class="concept-number">0${index + 1}</span><div><h2>${renderMathText(section.title)}</h2><p>${renderMathText(section.text)}</p>${section.formula ? `<div class="formula">${renderMathText(section.formula)}</div>` : ""}${section.notation ? `<p class="notation">${renderMathText(section.notation)}</p>` : ""}</div></section>`).join("")}
        <section class="worked-example"><p class="page-kicker">Aplicando a ideia</p><h2>${renderMathText(intro.example.title)}</h2><ol>${intro.example.steps.map((step) => `<li>${renderMathText(step)}</li>`).join("")}</ol></section>
        <div class="notice"><strong>Evite esta confusão</strong><br>${renderMathText(intro.pitfall)}</div>
        <div class="intro-actions"><button class="button" data-action="complete-intro">${data.studyGuide && pendingUnitLesson(moduleId) ? "Concluir leitura e iniciar lição" : state.introductionsRead.includes(moduleId) ? "Voltar à unidade" : "Concluir introdução"}</button></div>
      </article>
    </div>`;
  modal.querySelector("h1").focus();
}

function completeIntroduction() {
  const next = data.studyGuide ? pendingUnitLesson(introModuleId) : null;
  if (!state.introductionsRead.includes(introModuleId)) {
    state.introductionsRead.push(introModuleId);
    saveState();
  }
  closeQuiz();
  if (next) startLesson(next.id);
}

function startLesson(lessonId, customQuestions) {
  const lesson = lessons.find((item) => item.id === lessonId) || {
    id: `practice-${Date.now()}`,
    title: "Prática personalizada",
    module: { title: "Revisão", id: "pratica" },
    questions: customQuestions,
  };
  if (data.studyGuide && lessons.some(l => l.id === lesson.id)) state.studyUnits[data.id] = lesson.module.id;
  quiz = {
    lesson,
    questions: customQuestions || (data.studyGuide && !state.completed.includes(lesson.id) ? lesson.questions.filter(q => !state.completed.includes(data.legacyQuestionCredits?.[q.id])) : lesson.questions),
    index: 0,
    selected: null,
    checked: false,
    correct: 0,
    errors: 0,
    practice: false,
  };
  if (!quiz.questions?.length) { quiz = null; return; }
  resetQuestionTimer();
  openModal(data.studyGuide && !customQuestions ? `${lesson.module.title} · Lição ${lesson.index + 1} de ${lessons.filter(l => l.module.id === lesson.module.id).length}` : lesson.title);
  renderQuestion();
  modal.querySelector("h1").focus();
}

function restartLesson() {
  if (!quiz || quiz.practice) return;
  startLesson(quiz.lesson.id, quiz.questions);
}

function startPractice() {
  const filters = practiceFilters();
  const pool = shuffle(filteredPracticeQuestions(filters));
  if (!pool.length) { showToast("Nenhuma questão corresponde aos filtros. Ajuste sua seleção."); return; }
  quiz = {
    practice: true, filters: { ...filters }, queue: pool.slice(1).map(q => q.id), cycle: 1,
    lesson: { title: "Prática contínua", module: { title: data.title } },
    questions: [pool[0]], index: 0, selected: null, checked: false, correct: 0,
    answeredCount: 0, skipped: 0, totalDurationMs: 0,
  };
  resetQuestionTimer();
  openModal("Prática contínua");
  renderQuestion();
  modal.querySelector("h1").focus();
}

function renderQuestion() {
  const question = quiz.questions[quiz.index];
  const progress = ((quiz.index + (quiz.checked ? 1 : 0)) / quiz.questions.length) * 100;
  modal.innerHTML = `
    <div class="quiz-shell">
      <div class="quiz-topbar">
        ${quiz.practice ? `<button class="text-button" data-action="end-practice">Encerrar prática</button><span class="session-counter">${counted(quiz.answeredCount, "respondida")} · ${counted(quiz.correct, "acerto")}</span><span class="session-round">Rodada ${quiz.cycle}</span>` : `<button class="icon-button" data-action="close-quiz" aria-label="Fechar lição">×</button><div class="quiz-progress" aria-label="Progresso da lição"><span style="width:${progress}%"></span></div><div class="quiz-errors" role="status" aria-label="${counted(quiz.errors, "erro")} nesta tentativa; limite de ${MAX_LESSON_ERRORS}">Erros ${quiz.errors}/${MAX_LESSON_ERRORS}</div>`}
      </div>
      ${quiz.practice ? "" : `<p class="lesson-rule">Até ${MAX_LESSON_ERRORS} erros para concluir. Ao reiniciar a lição, a contagem volta a zero.</p>`}
      <div class="question-wrap">
        <div class="question-meta"><span>${escapeHtml(question.moduleTitle || quiz.lesson.module.title)}</span><span>Item ${question.index} · ${question.block}</span></div>
        <div class="question-tools">${questionMeta(question)}<button class="text-button favorite-button" data-action="favorite" aria-pressed="${state.favorites.includes(question.id)}">${state.favorites.includes(question.id) ? "★ Favorita" : "☆ Favoritar"}</button></div>

        <h1 tabindex="-1">${renderMathText(question.alternativesIntroduction || "Qual é a alternativa correta?")}</h1>
        ${question.context ? `<div class="question-context" lang="${question.language === "ingles" ? "en" : question.language === "espanhol" ? "es" : "pt-BR"}">${renderMarkdown(question.context, question.areaId === "linguagens")}</div>` : ""}
        <div class="answers">
          ${question.alternatives.map((alternative) => {
            let status = quiz.selected === alternative.letter ? "selected" : "";
            if (quiz.checked && alternative.letter === question.correctAlternative) status = "correct";
            else if (quiz.checked && quiz.selected === alternative.letter) status = "wrong";
            const body = alternative.file
              ? `<img src="${escapeHtml(alternative.file)}" alt="Alternativa ${alternative.letter}" style="max-width:100%;max-height:180px">`
              : renderMathText(alternative.text || "Alternativa com imagem");
            return `<button class="answer ${status}" data-answer="${alternative.letter}" ${quiz.checked ? "disabled" : ""}><span class="answer-letter">${alternative.letter}</span><span class="answer-text">${body}</span></button>`;
          }).join("")}
        </div>
        ${quiz.checked ? renderExplanation(question) : ""}
      </div>
      ${renderQuizFooter(question)}
    </div>
  `;
}

function renderExplanation(question) {
  const explanation = question.explanation;
  const correctAnswer = question.alternatives.find((alternative) => alternative.letter === question.correctAlternative);
  return `<section class="explanation" aria-labelledby="explanation-title" tabindex="-1">
    <p class="page-kicker">${renderMathText(explanation.concept)}</p>
    <h2 id="explanation-title">Por que o item é ${escapeHtml(answerLabel(question, question.correctAlternative)).toLowerCase()}?</h2>
    <div class="correct-answer"><strong>Gabarito: ${escapeHtml(answerLabel(question, question.correctAlternative))}</strong>${correctAnswer.file ? `<img src="${escapeHtml(correctAnswer.file)}" alt="Resposta correta, alternativa ${question.correctAlternative}">` : ""}</div>
    <ol>${explanation.steps.map((step) => `<li>${renderMathText(step)}</li>`).join("")}</ol>
    <p class="reference-note">Tópico estudado: ${escapeHtml(question.topic)}</p>
    <p><a class="source-link" href="${escapeHtml(question.sourceUrl)}" target="_blank" rel="noreferrer">Referência: ${escapeHtml(question.sourceLabel)} ↗</a></p>
    <p class="takeaway"><strong>Guarde esta ideia:</strong> ${renderMathText(explanation.takeaway)}</p>
  </section>`;
}

function renderQuizFooter(question) {
  if (!quiz.checked) {
    return `<footer class="quiz-footer"><div class="quiz-footer-inner">${quiz.practice ? '<button class="text-button" data-action="skip-question">Pular questão</button>' : ""}<button class="button" data-action="check" ${quiz.selected ? "" : "disabled"}>Verificar</button></div></footer>`;
  }
  const correct = quiz.selected === question.correctAlternative;
  return `
    <footer class="quiz-footer ${correct ? "success" : "error"}">
      <div class="quiz-footer-inner">
        <div class="feedback-copy" role="status"><strong>${correct ? "Mandou bem! +10 XP" : `Gabarito: ${answerLabel(question, question.correctAlternative)}`}</strong><span>${!quiz.practice && quiz.errors > MAX_LESSON_ERRORS ? "Limite de erros excedido. Leia a resolução antes de reiniciar." : "Confira a resolução comentada antes de continuar."}</span></div>
        <button class="button ${correct ? "" : "danger"}" data-action="next-question">${quiz.practice ? "Próxima questão" : quiz.errors > MAX_LESSON_ERRORS ? "Ver resultado" : quiz.index === quiz.questions.length - 1 ? "Finalizar" : "Continuar"}</button>
      </div>
    </footer>
  `;
}

function selectAnswer(letter) {
  if (!quiz || quiz.checked || quiz.ended) return;
  quiz.selected = letter;
  renderQuestion();
}

function checkAnswer() {
  if (!quiz?.selected || quiz.checked || quiz.ended) return;
  const question = quiz.questions[quiz.index];
  const correct = quiz.selected === question.correctAlternative;
  stopQuestionTimer();
  recordAttempt(question, correct);
  quiz.checked = true;
  if (quiz.practice) { quiz.answeredCount += 1; quiz.totalDurationMs += quiz.elapsedMs; }
  state.answered.push(question.id);
  if (correct) {
    quiz.correct += 1;
    state.xp += 10;
    state.todayXp += 10;
    state.missed = state.missed.filter((id) => id !== question.id);
  } else {
    if (!quiz.practice) quiz.errors += 1;
    if (!state.missed.includes(question.id)) state.missed.push(question.id);
  }
  saveState();
  renderQuestion();
  const explanation = modal.querySelector(".explanation");
  explanation.focus({ preventScroll: true });
  explanation.scrollIntoView({ block: "start", behavior: "smooth" });
}

function nextQuestion() {
  if (!quiz?.checked || quiz.ended) return;
  if (quiz.practice) { advancePractice(); return; }
  if (quiz.errors > MAX_LESSON_ERRORS) { finishLesson(); return; }
  if (quiz.index < quiz.questions.length - 1) {
    quiz.index += 1;
    quiz.selected = null;
    quiz.checked = false;
    resetQuestionTimer();
    renderQuestion();
    modal.querySelector("h1").focus({ preventScroll: true });
    modal.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  finishLesson();
}

function finishLesson() {
  if (!quiz || quiz.practice || quiz.ended || !quiz.checked) return;
  const passed = quiz.errors <= MAX_LESSON_ERRORS;
  if (passed && quiz.index !== quiz.questions.length - 1) return;
  quiz.ended = true;
  quiz.passed = passed;
  const lesson = quiz.lesson;
  const isCourseLesson = lessons.some((item) => item.id === lesson.id);
  const newlyCompleted = passed && isCourseLesson && !state.completed.includes(lesson.id);
  const earnedBonus = newlyCompleted && lessonCredits(lesson).length === 0;
  if (newlyCompleted) state.completed.push(lesson.id);
  if (earnedBonus) {
    state.xp += 20;
    state.todayXp += 20;
  }
  const following = data.studyGuide && passed ? pendingUnitLesson(lesson.module.id) : null;
  markStudyDay();
  const accuracy = Math.round((quiz.correct / (quiz.index + 1)) * 100);
  saveState();
  modal.innerHTML = `
    <div class="quiz-shell">
      <div class="finish-card">
        <div class="finish-burst" aria-hidden="true">${passed ? accuracy >= 80 ? "🏆" : "🎯" : "↻"}</div>
        <h1 tabindex="-1">${passed ? "Lição concluída!" : "Limite de erros excedido"}</h1>
        <p>${passed ? `Aprovado com ${counted(quiz.errors, "erro")}.` : `Você cometeu ${quiz.errors} erros; o limite é ${MAX_LESSON_ERRORS}. Reinicie para tentar novamente com a contagem zerada.`}</p>
        ${passed ? "" : '<p>Suas respostas e os XP por acerto foram salvos. Esta tentativa não conclui a lição nem libera a próxima.</p>'}
        <div class="finish-stats">
          <div class="finish-stat"><strong>${accuracy}%</strong><span>Precisão</span></div>
          <div class="finish-stat"><strong>+${quiz.correct * 10 + (earnedBonus ? 20 : 0)}</strong><span>XP ganho</span></div>
        </div>
        ${passed ? "" : '<button class="button" data-action="restart-lesson">Reiniciar lição</button>'}
        ${data.studyGuide && passed ? `<p>${following ? "Seu progresso nesta unidade foi salvo." : "Unidade concluída! Escolha o próximo tema quando quiser."}</p>${following ? `<button class="button" data-lesson="${following.id}">Próxima lição</button>` : ""}` : ""}
        <button class="${passed && !following ? "button" : "text-button finish-back"}" data-action="finish">${data.studyGuide ? "Voltar aos temas" : "Voltar à trilha"}</button>
      </div>
    </div>
  `;
  modal.querySelector("h1").focus({ preventScroll: true });
  modal.scrollTo({ top: 0, behavior: "smooth" });
}

function closeQuiz() {
  modal.hidden = true;
  modal.innerHTML = "";
  document.body.style.overflow = "";
  shell.inert = false;
  quiz = null;
  introModuleId = null;
  const introId = returnFocus?.dataset?.intro;
  renderPage(!introId && !data.studyGuide);
  const focusTarget = data.studyGuide && activeView === "aprender" ? app.querySelector(".study-detail h2") : introId ? app.querySelector(`[data-intro="${introId}"]`) : app.querySelector("h1");
  if (focusTarget) { focusTarget.tabIndex = focusTarget.matches("button") ? 0 : -1; focusTarget.focus({ preventScroll: true }); }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

document.addEventListener("click", (event) => {
  const view = event.target.closest("[data-view]");
  if (view) {
    event.preventDefault();
    activeView = view.dataset.view;
    history.replaceState(null, "", `#${activeView}`);
    renderPage();
    return;
  }
  const blockButton = event.target.closest("[data-study-block]");
  if (blockButton) { state.studyBlocks[data.id] = blockButton.dataset.studyBlock; state.studyUnits[data.id] = data.modules.find(m => m.block === blockButton.dataset.studyBlock).id; saveState(); renderLearn(); app.querySelector(`[data-study-block="${blockButton.dataset.studyBlock}"]`).focus({preventScroll:true}); return; }
  const openStudy = event.target.closest("[data-open-study]");
  if (openStudy) { activeView = "aprender"; history.replaceState(null,"","#aprender"); state.studyUnits[data.id] = openStudy.dataset.openStudy; state.studyBlocks[data.id] = data.modules.find(m => m.id === openStudy.dataset.openStudy).block; saveState(); renderPage(); return; }
  const studyButton = event.target.closest("[data-study-unit]");
  if (studyButton) { selectStudyUnit(studyButton.dataset.studyUnit); return; }
  const practiceButton = event.target.closest("[data-practice-unit]");
  if (practiceButton) { practiceUnit(practiceButton.dataset.practiceUnit); return; }
  const lessonButton = event.target.closest("[data-lesson]");
  if (lessonButton) startLesson(lessonButton.dataset.lesson);
  const introButton = event.target.closest("[data-intro]");
  if (introButton) openIntroduction(introButton.dataset.intro);
  const answer = event.target.closest("[data-answer]");
  if (answer) selectAnswer(answer.dataset.answer);
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "continue") {
    if (data.studyGuide) {
      const module = selectedStudyModule();
      const next = pendingUnitLesson(module.id);
      if (!state.introductionsRead.includes(module.id) || !next) openIntroduction(module.id); else startLesson(next.id);
    } else startLesson(nextLesson().id);
  }
  if (action === "practice") startPractice();
  if (action === "reset-filters") { state.practiceFilters[data.id] = defaultPracticeFilters(); saveState(); renderPractice(); }
  if (action === "end-practice") endPractice();
  if (action === "skip-question") skipPracticeQuestion();
  if (action === "view-performance") { activeView = "desempenho"; history.replaceState(null, "", "#desempenho"); closeQuiz(); }
  if (action === "favorite" && quiz && !quiz.ended) {
    const id = quiz.questions[quiz.index].id;
    state.favorites = state.favorites.includes(id) ? state.favorites.filter(item => item !== id) : [...state.favorites, id];
    saveState(); renderQuestion(); modal.querySelector('[data-action="favorite"]').focus({ preventScroll: true });
  }
  if (action === "close-intro") closeQuiz();
  if (action === "complete-intro") completeIntroduction();
  if (action === "close-quiz") {
    closeQuiz();
    showToast("Respostas salvas. Conclua a lição para avançar na trilha.");
  }
  if (action === "check") checkAnswer();
  if (action === "next-question") nextQuestion();
  if (action === "restart-lesson") restartLesson();
  if (action === "finish") closeQuiz();
});

document.addEventListener("keydown", (event) => {
  if (modal.hidden) return;
  if (event.key === "Escape") { if (quiz?.practice && !quiz.ended) endPractice(); else closeQuiz(); return; }
  if (event.key !== "Tab") return;
  const focusable = [...modal.querySelectorAll('button:not(:disabled), a[href], summary, [tabindex="0"]')];
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && (document.activeElement === first || !focusable.includes(document.activeElement))) {
    event.preventDefault(); last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault(); first?.focus();
  }
});

document.addEventListener("change", (event) => {
  if (event.target.dataset.syllabus) {
    const id = event.target.dataset.syllabus;
    state.syllabusRead = event.target.checked ? [...new Set([...state.syllabusRead, id])] : state.syllabusRead.filter(x => x !== id);
    saveState(); app.querySelector("#edital-progress").textContent = `${data.modules.filter(m => state.syllabusRead.includes(m.id)).length}/${data.modules.length} disciplinas marcadas como revisadas. Este checklist é independente das lições.`; return;
  }
  if (event.target.id === "stats-period") { statsPeriod = event.target.value; renderPerformance(); app.querySelector("#stats-period").focus({ preventScroll: true }); return; }
  if (event.target.id === "stats-mode") { statsMode = event.target.value; renderPerformance(); app.querySelector("#stats-mode").focus({ preventScroll: true }); return; }
  if (event.target.id === "unit-select") {
    const unit = app.querySelector(`#unit-${event.target.value}`);
    if (unit) { unit.scrollIntoView({ block: "start", behavior: "smooth" }); unit.querySelector("h2").focus({ preventScroll: true }); }
    return;
  }
  if (event.target.id !== "course-select") return;
  setCourse(event.target.value);
  if (!["praticar", "desempenho", "edital"].includes(activeView)) activeView = "aprender";
  history.replaceState(null, "", `#${activeView}`);
  renderPage();
  app.querySelector("#course-select").focus({ preventScroll: true });
});

document.addEventListener("submit", (event) => {
  if (event.target.id !== "practice-filters") return;
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.target));
  state.practiceFilters[data.id] = { ...defaultPracticeFilters(), ...values };
  saveState(); renderPractice();
  app.querySelector(".practice-launch").scrollIntoView({ block: "nearest", behavior: "smooth" });
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopQuestionTimer(); else startQuestionTimer();
});

window.addEventListener("hashchange", () => {
  activeView = location.hash.slice(1) || "aprender";
  renderPage();
});

function initialCourseId() {
  const params = new URLSearchParams(location.search);
  const requested = params.get("especialidade");
  if (!catalog.courses.some(c => c.id === requested)) return state.activeCourse;
  params.delete("especialidade");
  const search = params.toString();
  history.replaceState(null, "", `${location.pathname}${search ? "?" + search : ""}${location.hash}`);
  return requested;
}

async function init() {
  app.innerHTML = `<div class="loading"><div><div class="loader"></div>Carregando sua trilha…</div></div>`;
  try {
    const response = await fetch(DATA_URL, { cache: "no-cache" });
    if (!response.ok) throw new Error("Não foi possível carregar as matérias.");
    catalog = await response.json();
    state.missed = state.missed.filter((id) => catalog.questions.some((question) => question.id === id));
    setCourse(initialCourseId());
    renderPage();
  } catch (error) {
    app.innerHTML = `<div class="notice" style="margin-top:40px"><strong>Falha ao iniciar.</strong><br>${escapeHtml(error.message)} Recarregue a página ou verifique se o site está sendo servido por HTTP.</div>`;
  }
}

init();
