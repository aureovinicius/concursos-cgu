const DATA_URL = "/data/courses.json?v=concursos-7";
const OFFICIAL_PART_PREFIX = "/data/cebraspe-ti/";
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
let officialBankPromise = null;
let courseSelectionVersion = 0;

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
    activeSyllabusCourse: "desenvolvimento",
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
  if (data.practiceOnly || data.syllabusOnly) { lessons = []; return; }
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
        title: ["Fundamentos", "Aplicações", "Desafio", "Domínio"][index] || `Prática ${index + 1}`,
        questions: lessonQuestions.length ? lessonQuestions : questions.slice(0, 5),
      };
      return lesson;
    });
  });
}

function isUnlocked(lesson) {
  return state.completed.includes(lesson.id) || lesson.index === 0 || state.completed.includes(lessons[lesson.globalIndex - 1]?.id);
}

async function readQuestionPart(response, url) {
  if (!/\.json\.gz(?:\?|$)/.test(url)) return response.json();
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return JSON.parse(new TextDecoder().decode(bytes));
  if (typeof DecompressionStream === "undefined") throw new Error("Atualize seu navegador para abrir o banco de provas anteriores.");
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).json();
}

async function ensureCourseData(courseId) {
  const course = catalog.courses.find(c => c.id === courseId);
  if (!course?.practiceOnly) return;
  const loaded = new Set(catalog.questions.map(q => q.id));
  if (course.questionIds.every(id => loaded.has(id))) return;
  if (!catalog.officialBank?.url) throw new Error("O banco oficial não está disponível nesta versão.");
  if (!officialBankPromise) {
    officialBankPromise = (async () => {
      const response = await fetch(catalog.officialBank.url, { cache: "no-cache" });
      if (!response.ok) throw new Error("Não foi possível baixar o banco oficial. Conecte-se à internet e tente novamente.");
      const payload = await response.json();
      let questions = payload.questions;
      if (!Array.isArray(questions) && Array.isArray(payload.parts)) {
        if (!payload.parts.length || new Set(payload.parts).size !== payload.parts.length || payload.parts.some(url => typeof url !== "string" || !url.startsWith(OFFICIAL_PART_PREFIX) || !/^part-\d+\.json(?:\.gz)?\?v=concursos-7$/.test(url.slice(OFFICIAL_PART_PREFIX.length)))) throw new Error("O índice do banco oficial contém arquivos inválidos.");
        const parts = new Array(payload.parts.length);
        let next = 0;
        let failure = null;
        await Promise.all(Array.from({ length: Math.min(4, payload.parts.length) }, async () => {
          while (next < payload.parts.length && !failure) {
            const index = next++;
            try {
              const partResponse = await fetch(payload.parts[index], { cache: "no-cache" });
              if (!partResponse.ok) throw new Error("Uma parte do banco oficial não pôde ser baixada. Tente novamente quando estiver conectado.");
              const part = await readQuestionPart(partResponse, payload.parts[index]);
              if (!Array.isArray(part.questions)) throw new Error("Uma parte do banco oficial está incompleta.");
              parts[index] = part.questions;
            } catch (error) { failure = error; }
          }
        }));
        if (failure) throw failure;
        questions = parts.flat();
      }
      if (!Array.isArray(questions) || questions.some(q => !q || typeof q.id !== "string")) throw new Error("O arquivo de questões oficiais está incompleto.");
      const imported = new Map(questions.map(q => [q.id, q]));
      if (imported.size !== questions.length || course.questionIds.some(id => !loaded.has(id) && !imported.has(id))) throw new Error("O banco oficial e o catálogo têm versões diferentes. Recarregue a página.");
      for (const question of questions) if (!loaded.has(question.id)) catalog.questions.push(question);
    })().catch(error => { officialBankPromise = null; throw error; });
  }
  await officialBankPromise;
}

async function selectCourse(courseId) {
  const version = ++courseSelectionVersion;
  const requested = catalog.courses.find(c => c.id === courseId);
  if (!requested) return;
  app.innerHTML = `<div class="loading" role="status"><div><div class="loader"></div>Carregando ${escapeHtml(requested.title)}…</div></div>`;
  try {
    await ensureCourseData(courseId);
    if (version !== courseSelectionVersion) return;
    setCourse(courseId);
    if (data.practiceOnly || !["praticar", "desempenho", "edital"].includes(activeView)) activeView = data.practiceOnly ? "praticar" : "aprender";
    history.replaceState(null, "", `#${activeView}`);
    renderPage();
    app.querySelector("#course-select")?.focus({ preventScroll: true });
  } catch (error) {
    if (version !== courseSelectionVersion) return;
    app.innerHTML = `${pageHeader("Banco de questões", "Não foi possível abrir o banco.", escapeHtml(error.message))}<button class="button" data-select-course="${escapeHtml(courseId)}">Tentar novamente</button>`;
  }
}

function setCourse(courseId) {
  const course = catalog.courses.find((c) => c.id === courseId) || catalog.courses[0];
  const byId = new Map(catalog.questions.map((q) => [q.id, q]));
  data = { ...course, questions: course.questionIds.map((id) => {
    const question = byId.get(id);
    if (!course.integrated) return question;
    const module = course.modules.find((m) => course.integratedBy === "subject" ? m.subjectId === question.subjectId : m.competency === question.competency);
    return { ...question, moduleId: module.id, moduleTitle: module.title };
  }).filter(Boolean) };
  state.activeCourse = course.id;
  if (!course.practiceOnly) state.activeSyllabusCourse = course.id;
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

function currentExam() {
  const exam = catalog.exams?.find(e => e.id === data.examId) || catalog.exam;
  return { ...exam, ...data.examOverrides };
}

function examPdfUrl() { return currentExam().localPdfUrl || "/data/edital-cgu-2026.pdf"; }
function examLabel() { return currentExam().shortTitle || "CGU 2026"; }
function formatDate(value) { return value ? value.split("-").reverse().join("/") : "Não informada"; }
function reviewedModules() { return data.modules.filter(m => state.syllabusRead.includes(m.id)).length; }
function syllabusMarkup(module) {
  if (module.topLevelTopics?.length) return module.topLevelTopics.map(topic => `<p>${escapeHtml(topic.text)}</p>`).join('');
  return escapeHtml(module.syllabusText).replace(/ (?=\d+(?:\.\d+)*\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/g, "<br><br>");
}

function courseSwitcher() {
  const groups = new Map();
  for (const course of catalog.courses) {
    const title = course.practiceOnly ? "Banco de questões" : catalog.exams?.find(e => e.id === course.examId)?.shortTitle || "CGU 2026";
    if (!groups.has(title)) groups.set(title, []);
    groups.get(title).push(course);
  }
  return `<div class="course-switcher"><label for="course-select">Edital, cargo ou banco</label><select id="course-select" aria-label="Edital, cargo ou banco de questões">${[...groups].map(([title, courses]) => `<optgroup label="${escapeHtml(title)}">${courses.map(course => `<option value="${course.id}" ${course.id === data.id ? "selected" : ""}>${escapeHtml(course.title)}</option>`).join("")}</optgroup>`).join("")}</select><span>${data.practiceOnly ? "Provas anteriores · Cebraspe" : escapeHtml(examLabel()) + (data.syllabusOnly ? " · Programa e revisão" : " · Estudo e prática")}</span></div>`;
}

function referenceMarkup(module) {
  return `<details class="competency-reference"><summary>Conteúdo do edital · ${escapeHtml(module.block)} · item ${escapeHtml(module.section)}</summary><p><strong>${escapeHtml(module.officialTitle)}</strong></p><div class="syllabus-text">${syllabusMarkup(module)}</div><a class="source-link" href="${escapeHtml(examPdfUrl())}${module.sourcePage ? `#page=${module.sourcePage}` : ""}" target="_blank" rel="noreferrer">Consultar no PDF ↗</a></details>`;
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
  const answered = new Set(state.answered);
  const practiced = data.questions.filter(q => answered.has(q.id)).length;
  const course = Math.round((data.syllabusOnly ? reviewedModules() / Math.max(data.modules.length, 1) : data.practiceOnly ? practiced / Math.max(data.total, 1) : data.studyGuide ? studiedQuestionIds().size / Math.max(data.total, 1) : completed / Math.max(lessons.length, 1)) * 100);
  rail.innerHTML = `
    <div class="stat-strip">${statMarkup()}</div>
    <section class="rail-card">
      <h3>Meta diária</h3>
      <p>Ganhe ${DAILY_GOAL} XP para fechar o dia.</p>
      <div class="progress-row"><span>Hoje</span><span>${state.todayXp} / ${DAILY_GOAL} XP</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${goal}%"></div></div>
    </section>
    <section class="rail-card">
      <h3>${data.practiceOnly ? "Seu banco de questões" : "Seu curso"}</h3>
      <p>${data.syllabusOnly ? `${reviewedModules()} de ${data.modules.length} disciplinas revisadas.` : data.practiceOnly ? `${practiced} de ${data.total} questões respondidas.` : data.studyGuide ? `${studiedQuestionIds().size} de ${data.total} questões em lições concluídas.` : `${completed} de ${lessons.length} lições concluídas.`}</p>
      <div class="progress-row"><span>${escapeHtml(data.title)}</span><span>${course}%</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${course}%;background:var(--green)"></div></div>
      <button class="button" data-action="continue">${data.syllabusOnly ? "Continuar revisão" : data.practiceOnly ? "Escolher questões" : data.studyGuide ? "Estudar tema" : "Continuar"}</button>
    </section>
    <section class="rail-card">
      <h3>Estudo dirigido</h3>
      <p class="tiny">${data.syllabusOnly ? "Programa do edital organizado por disciplina. A revisão é marcada por você; ainda não há questões vinculadas a este cargo." : data.practiceOnly ? `${data.total} questões de provas anteriores, com gabarito oficial e acesso às fontes. Treino de acertos, sem ponderação de concurso.` : `${data.total} itens autorais de Certo ou Errado nesta especialidade, com explicação e fonte. Banco inicial em expansão.`}</p>
      ${!data.practiceOnly ? `<p class="tiny" style="margin-top:9px"><a class="source-link" href="${escapeHtml(examPdfUrl())}" target="_blank" rel="noreferrer">Edital ${escapeHtml(examLabel())} ↗</a></p>` : ""}
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
    ${pageHeader(escapeHtml(examLabel()) + ' · Trilha de estudo', 'Sua próxima conquista começa aqui.', escapeHtml(data.description))}
    ${examBanner()}
    <section class="study-overview" aria-label="Progresso da trilha">
      <div><strong>${studied.size} de ${data.total}</strong><span>questões em lições concluídas</span></div>
      <div><strong>${data.modules.length} disciplinas</strong><span>lições de até 5 questões</span></div>
      <progress max="${Math.max(data.total, 1)}" value="${studied.size}" aria-label="Questões concluídas nesta especialidade"></progress>
    </section>
    <section class="study-map" aria-labelledby="study-map-title">
      <div class="section-heading"><div><p class="page-kicker">Seu mapa de estudo</p><h2 id="study-map-title">Escolha seu foco</h2></div></div>
      <p class="study-help">Escolha uma disciplina do edital. Os conhecimentos básicos e complementares são comuns às quatro especialidades. Seu progresso nesses itens é compartilhado entre as trilhas.</p>
      <div class="block-tabs" role="group" aria-label="Blocos da prova">${currentExam().blocks.map(b => `<button data-study-block="${b.id}" aria-pressed="${studyBlock === b.id}">${b.id} · ${escapeHtml(blockLabel(b.id))}</button>`).join("")}</div>
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

function renderLearn() { if (data.practiceOnly) renderPractice(); else if (data.syllabusOnly) renderSyllabusTrail(); else renderStudyTrail(); }

function syllabusCheck(module) {
  return `<label class="check-label"><input type="checkbox" data-syllabus="${module.id}" ${state.syllabusRead.includes(module.id) ? "checked" : ""}> Já revisei esta disciplina</label>`;
}

function renderSyllabusTrail() {
  const module = selectedStudyModule();
  const block = state.studyBlocks[data.id] || module.block;
  const reviewed = reviewedModules();
  app.innerHTML = `${pageHeader(escapeHtml(examLabel()) + ' · Roteiro de estudo', 'Organize sua preparação.', 'Escolha uma disciplina, consulte o programa completo e registre suas revisões. Comece pelos conhecimentos comuns e intercale com os específicos do seu cargo.')}
    ${examBanner()}
    <section class="study-overview" aria-label="Progresso da revisão"><div><strong>${reviewed} de ${data.modules.length}</strong><span>disciplinas marcadas como revisadas</span></div><div><strong>Programa completo</strong><span>conhecimentos comuns e específicos</span></div><progress max="${data.modules.length}" value="${reviewed}" aria-label="Disciplinas revisadas"></progress></section>
    <section class="study-map" aria-labelledby="study-map-title"><h2 id="study-map-title">Escolha seu foco</h2><p class="study-help">A revisão dos conhecimentos comuns é compartilhada entre os cargos deste edital. As disciplinas específicas têm seu próprio acompanhamento.</p>
    <div class="block-tabs" role="group" aria-label="Blocos da prova">${currentExam().blocks.map(b => `<button data-study-block="${b.id}" aria-pressed="${block === b.id}">${b.id} · ${escapeHtml(blockLabel(b.id))}</button>`).join('')}</div>
    <div class="study-grid">${data.modules.filter(m => m.block === block).map(m => `<button class="study-unit ${m.id === module.id ? 'selected' : ''}" data-study-unit="${m.id}" aria-pressed="${m.id === module.id}"><span class="study-unit-top"><span aria-hidden="true">☷</span><span>${m.block}</span>${state.syllabusRead.includes(m.id) ? '<span class="study-done">✓ Revisada</span>' : ''}</span><strong>${escapeHtml(m.title)}</strong><span>Consultar programa da disciplina</span></button>`).join('')}</div></section>
    <section class="study-detail stats-card" aria-labelledby="study-unit-title"><p class="page-kicker">${escapeHtml(blockLabel(module.block))} · item ${escapeHtml(module.section)}</p><h2 id="study-unit-title" tabindex="-1">${escapeHtml(module.title)}</h2><div class="syllabus-text">${syllabusMarkup(module)}</div><div class="edital-actions">${syllabusCheck(module)}<a class="source-link" href="${escapeHtml(examPdfUrl())}${module.sourcePage ? `#page=${module.sourcePage}` : ''}" target="_blank" rel="noreferrer">Conferir no PDF ↗</a></div><p class="stats-note">A marcação registra sua revisão, não uma avaliação de domínio. Questões e introduções conceituais ainda não foram vinculadas a esta disciplina.</p></section>`;
}

function renderSyllabusProgress(title = "Acompanhe suas revisões.") {
  const count = reviewedModules();
  app.innerHTML = `${pageHeader(escapeHtml(examLabel()) + ' · Progresso', title, 'Seu checklist de revisão fica salvo neste navegador, separado das lições e respostas de outros editais.')}
    <section class="study-overview"><div><strong>${count}/${data.modules.length}</strong><span>disciplinas revisadas</span></div><div><strong>${Math.round(count / data.modules.length * 100)}%</strong><span>do checklist marcado por você</span></div><progress max="${data.modules.length}" value="${count}" aria-label="Disciplinas revisadas"></progress></section>
    <div class="notice"><strong>Sem questões vinculadas a este cargo.</strong> Taxas de acerto e pontuação ficarão disponíveis quando houver itens para praticar. A revisão do programa não concede XP nem aprovação em lições.</div>
    <section class="stats-card"><h2>Revisão por disciplina</h2><div class="performance-list">${data.modules.map(m => `<div class="performance-row"><div><strong>${escapeHtml(m.title)}</strong><small>${escapeHtml(blockLabel(m.block))}</small></div><button class="text-button" data-open-study="${m.id}">${state.syllabusRead.includes(m.id) ? '✓ Revisada' : 'Revisar'}</button></div>`).join('')}</div></section>`;
}

function renderSyllabusPractice() {
  const bank = catalog.courses.find(c => c.practiceOnly);
  app.innerHTML = `${pageHeader(escapeHtml(examLabel()) + ' · Prática', 'Prepare seu próximo treino.', escapeHtml(data.title))}
    <section class="empty-state"><span aria-hidden="true">☷</span><h2>Sem questões vinculadas a este cargo.</h2><p>O programa completo já está disponível para organizar suas revisões. O arquivo enviado é um edital e não contém questões de prova.</p><a class="button" href="#aprender" data-view="aprender">Abrir roteiro de estudo</a></section>
    ${bank ? `<section class="official-bank-link"><div><strong>Banco histórico da Cebraspe</strong><p>${counted(bank.total, 'questão oficial', 'questões oficiais')} de concursos para cargos de TI. Este banco ainda não está mapeado ao edital da Câmara; a seleção e as estatísticas são independentes desta trilha.</p></div><button class="button secondary" data-select-course="${bank.id}">Explorar banco histórico →</button></section>` : ''}`;
}

function examBanner() {
  const exam = currentExam();
  return `<section class="exam-banner" aria-label="Resumo do concurso"><div><span class="exam-label">${escapeHtml(examLabel())}</span><h2>${escapeHtml(data.title)}</h2><p>${escapeHtml(data.roleTitle || exam.roleTitle || exam.title)}</p></div><div class="exam-facts"><span><strong>${formatDate(exam.examDate)}</strong>provas previstas no edital</span>${Number.isFinite(data.vacancies) ? `<span><strong>${counted(data.vacancies, "vaga")}</strong>${Number.isFinite(data.reserveVacancies) ? `+ ${data.reserveVacancies} em cadastro de reserva` : 'nesta especialidade'}</span>` : ''}<a href="#edital" data-view="edital">Explorar edital ↗</a></div></section><p class="catalog-note">${data.syllabusOnly ? 'Edital importado: programa e checklist disponíveis. Ainda não há questões vinculadas a este cargo.' : `Banco inicial: ${data.total} exercícios autorais comentados. Concluir este banco não significa cobrir todo o edital.`}</p>`;
}

function blockLabel(id) { const block = currentExam().blocks.find(b => b.id === id); return block?.shortTitle || block?.title || id; }

function defaultPracticeFilters() { return { module: "", block: "", origin: "", year: "", exam: "", status: "all", query: "" }; }

function practiceFilters() {
  return { ...defaultPracticeFilters(), ...state.practiceFilters[data.id] };
}

function questionMatches(question, filters, history = null) {
  if (filters.module && question.moduleId !== filters.module) return false;
  if (filters.block && question.block !== filters.block) return false;
  if (filters.origin && question.origin !== filters.origin) return false;
  if (filters.year && String(question.year) !== String(filters.year)) return false;
  if (filters.exam && question.examId !== filters.exam) return false;
  if (filters.status === "unanswered" && (history ? history.answered.has(question.id) : state.answered.includes(question.id))) return false;
  if (filters.status === "answered" && !(history ? history.answered.has(question.id) : state.answered.includes(question.id))) return false;
  if (filters.status === "wrong" && !(history ? history.missed.has(question.id) : state.missed.includes(question.id))) return false;
  if (filters.status === "favorites" && !(history ? history.favorites.has(question.id) : state.favorites.includes(question.id))) return false;
  const query = String(filters.query || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  if (query) {
    const haystack = [question.id, question.context, question.alternativesIntroduction, question.moduleTitle, question.examName, question.cargo, question.year, ...question.alternatives.map(a => a.text)].join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (!query.split(/\s+/).every(word => haystack.includes(word))) return false;
  }
  return true;
}

function filteredPracticeQuestions(filters = practiceFilters()) {
  const history = { answered: new Set(state.answered), missed: new Set(state.missed), favorites: new Set(state.favorites) };
  return data.questions.filter(q => questionMatches(q, filters, history));
}

function filterOptions(values, selected, allLabel) {
  return `<option value="">${allLabel}</option>${values.map(([value, label]) => `<option value="${escapeHtml(value)}" ${String(value) === String(selected) ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}`;
}

function renderPractice() {
  if (data.syllabusOnly) { renderSyllabusPractice(); return; }
  const filters = practiceFilters();
  const pool = filteredPracticeQuestions(filters);
  const metrics = performanceMetrics(courseAttempts());
  const officialCourse = catalog.courses.find(c => c.practiceOnly);
  const examNames = [...new Map(data.questions.filter(q => q.examId).map(q => [q.examId, q.examName || q.examId]))];
  const nameCounts = new Map();
  for (const [, name] of examNames) nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
  const exams = examNames.map(([id, name]) => [id, nameCounts.get(name) > 1 ? `${name} · ${id}` : name]).sort((a,b) => a[1].localeCompare(b[1], "pt-BR"));
  const years = [...new Set(data.questions.map(q => q.year).filter(Boolean))].sort((a,b) => Number(b) - Number(a));
  const origins = [...new Set(data.questions.map(q => q.origin))].map(value => [value, value === "oficial" ? "Prova oficial" : "Exercício autoral"]);
  app.innerHTML = `
    ${pageHeader(data.practiceOnly ? "Provas anteriores · Cebraspe TI" : "Questões · " + escapeHtml(examLabel()), "Treine no seu ritmo.", data.practiceOnly ? "Resolva questões das provas baixadas, confira o gabarito oficial e acompanhe seu desempenho." : "Resolva itens de Certo ou Errado. Leia a justificativa, revise seus erros e continue pelo tempo que quiser.")}
    ${!data.practiceOnly && officialCourse ? `<div class="official-bank-link"><div><strong>Pratique com provas anteriores da Cebraspe</strong><p>${counted(officialCourse.total, "questão oficial disponível", "questões oficiais disponíveis")} no banco de cargos de TI.</p></div><button class="button secondary" data-select-course="${officialCourse.id}">Abrir banco oficial →</button></div>` : ""}
    <div class="practice-overview"><span><strong>${metrics.total}</strong> respostas registradas</span><span><strong>${metrics.accuracy === null ? "—" : metrics.accuracy + "%"}</strong> de acerto</span><a href="#desempenho" data-view="desempenho">Ver desempenho ↗</a></div>
    <form id="practice-filters" class="filter-card"><div class="section-heading"><div><p class="page-kicker">Monte seu treino</p><h2>Filtros de questões</h2></div><button type="button" class="text-button" data-action="reset-filters">Limpar filtros</button></div>
      <div class="filter-grid">
        ${data.practiceOnly ? `<label>Concurso<select name="exam">${filterOptions(exams, filters.exam, "Todos os concursos")}</select></label><label>Ano de referência<select name="year">${filterOptions(years.map(y => [y, y]), filters.year, "Todos os anos")}</select></label>` : `<label>Bloco da prova<select name="block">${filterOptions(currentExam().blocks.map(b => [b.id, b.id + " · " + b.title]), filters.block, "Todos os blocos")}</select></label>`}
        <label>Origem<select name="origin">${filterOptions(origins, filters.origin, "Todas as origens")}</select></label>
        <label>${data.practiceOnly ? "Bloco da prova" : "Disciplina"}<select name="module">${filterOptions([...data.modules].sort((a,b) => a.title.localeCompare(b.title,"pt-BR")).map(m => [m.id, m.title]), filters.module, data.practiceOnly ? "Todos os blocos" : "Todas as disciplinas")}</select></label>
        <label>Minha resolução<select name="status">${[["all","Todas as questões"],["unanswered","Ainda não respondi"],["wrong","Erros para revisar"],["answered","Já respondi"],["favorites","Favoritas"]].map(([v,l]) => `<option value="${v}" ${filters.status === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label>Palavra-chave ou código<input name="query" type="search" maxlength="120" value="${escapeHtml(filters.query)}" placeholder="Ex.: integridade, dados, auditoria"></label>
      </div><button class="button secondary" type="submit">Aplicar filtros</button>
      <p class="filter-help">${data.practiceOnly ? "Os itens mantêm a numeração da prova e o vínculo ao gabarito oficial. A imagem da página preserva textos, fórmulas e figuras; responda apenas ao item indicado. A seleção inclui conhecimentos comuns e específicos dos cargos de TI." : "A especialidade é escolhida no seletor acima. Este banco contém exercícios autorais de estudo, alinhados ao edital. As provas anteriores ficam no banco oficial."}</p>
    </form>
    <section class="practice-launch" aria-live="polite"><div><p class="page-kicker">Sua seleção</p><h2>${counted(pool.length,"questão encontrada","questões encontradas")}</h2><p>${pool.length ? "Sorteio sem repetição até percorrer a seleção." : "Nenhum item corresponde aos filtros. Amplie sua seleção."}</p></div><button class="button" data-action="practice" ${pool.length ? "" : "disabled"}>Iniciar prática →</button></section>
    <div class="notice">${data.practiceOnly ? "Prática sem limite de erros. O desempenho registra acertos, erros e tempo; não calcula nota de concurso. Os gabaritos oficiais não incluem necessariamente justificativas pedagógicas. Leis, normas e versões de tecnologias devem ser lidas no contexto do ano da prova." : "Prática sem limite de erros. Acerto vale +1 em P1/P2 e +2 em P3; erro desconta o mesmo valor. O saldo deste treino não prevê sua nota na prova."} Pular não pontua nem registra resposta.</div>`;
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
  if (data.syllabusOnly) { renderSyllabusProgress(); return; }
  const missed = new Set(state.missed);
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
      ${[[metrics.total, "Respostas", `${metrics.unique} ${metrics.unique === 1 ? "questão distinta" : "questões distintas"}`], [`${metrics.accuracy === null ? "—" : `${metrics.accuracy}%`}`, "Taxa de acerto", `${counted(metrics.correct, "acerto")} · ${counted(metrics.wrong, "erro")}`], [data.practiceOnly ? metrics.correct : metrics.points, data.practiceOnly ? "Acertos no período" : "Saldo do treino", data.practiceOnly ? "Sem ponderação ou desconto de concurso" : "P1/P2: +1/−1 · P3: +2/−2"], [data.questions.filter(q => missed.has(q.id)).length, "Erros para revisar", "Situação atual da matéria"]].map(([n, title, detail]) => `<article class="metric-card"><strong>${n}</strong><h2>${title}</h2><p>${detail}</p></article>`).join("")}
    </div>
    <p class="stats-note">${data.practiceOnly ? "Contagem das respostas deste período, incluindo repetições. A regra de pontuação varia por edital; este banco mede acertos e erros." : "Saldo acumulado das respostas deste período, incluindo repetições. Não é nota estimada de aprovação."} Tempo: ${formatDuration(metrics.duration)} · média ${formatDuration(metrics.average)} por resposta.</p>
    ${!metrics.total ? '<div class="empty-state"><span aria-hidden="true">↗</span><h2>Seu próximo treino começa este gráfico.</h2><p>Responda uma questão na prática ou nas lições. O resultado aparece aqui assim que você verifica a resposta.</p><a class="button" href="#praticar" data-view="praticar">Escolher questões</a></div>' : ""}
    <section class="stats-card"><div class="section-heading"><h2>Ritmo nos últimos 7 dias</h2><span class="chart-legend"><i></i> Acertos <i class="wrong"></i> Erros</span></div><div class="activity-chart">${daily.map(d => `<div class="day-column"><span>${d.total}</span><div class="day-track" role="img" aria-label="${d.day}: ${counted(d.correct, "acerto")} e ${counted(d.wrong, "erro")}"><div class="day-wrong" style="height:${d.wrong / max * 100}%"></div><div class="day-correct" style="height:${d.correct / max * 100}%"></div></div><small>${d.day.slice(8)}/${d.day.slice(5, 7)}</small></div>`).join("")}</div></section>
    <section class="stats-card"><div class="section-heading"><h2>Desempenho por assunto</h2><span class="tiny">Cada tentativa conta</span></div><div class="performance-list">${rows.map(row => `<div class="performance-row"><div><strong>${escapeHtml(row.module.title)}</strong><small>${counted(row.total, "resposta")} · ${counted(row.correct, "acerto")} · ${counted(row.wrong, "erro")}</small></div><div class="performance-result"><strong>${row.accuracy === null ? "—" : `${row.accuracy}%`}</strong><div class="progress-track"><div class="progress-fill" style="width:${row.accuracy || 0}%"></div></div></div></div>`).join("")}</div></section>
    ${attempts.length ? `<section class="stats-card"><h2>Respostas recentes</h2><div class="recent-list">${attempts.slice(-10).reverse().map(a => { const q = questionById.get(a.questionId); return `<div class="recent-row"><span class="result-icon ${a.correct ? "" : "wrong"}">${a.correct ? "✓" : "×"}</span><div><strong>Item ${q.index} · ${escapeHtml(q.origin === "oficial" ? q.examName || q.examId : q.block)}</strong><small>${escapeHtml(q.moduleTitle)} · ${a.mode === "practice" ? "Prática" : "Lição"} · ${a.day.split("-").reverse().join("/")}</small></div><span>${formatDuration(a.durationMs || 0)}</span></div>`; }).join("")}</div></section>` : ""}
    <p class="stats-note">Histórico salvo neste navegador, sem sincronização entre dispositivos.${state.legacyAnsweredCount ? ` As ${state.legacyAnsweredCount} respostas anteriores permanecem no progresso, mas não entram nas taxas por não terem acerto e tempo registrados.` : ""} O tempo mede apenas a questão aberta e visível, até a correção; leitura da resolução e questões puladas não entram.</p>
  `;
}

function questionMeta(question) {
  if (question.origin === "oficial") return `<span class="origin-badge official">Prova oficial · Cebraspe</span><span class="block-badge">${escapeHtml(question.year || "Ano não informado")}${question.yearBasis === "event" ? " (concurso)" : ""} · ${escapeHtml(question.examName || question.examId || "Prova anterior")}</span>`;
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
  state.attempts.push({ questionId: question.id, answer: quiz.selected, correct, at, day: localDay(), durationMs: Math.round(quiz.elapsedMs), mode: quiz.practice ? "practice" : "lesson", courseId: data.id, block: question.block, origin: question.origin, scoring: question.origin === "oficial" ? "accuracy" : "cgu-weighted", points: question.origin === "oficial" ? (correct ? 1 : 0) : (correct ? question.weight : -question.weight) });
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
  if (data.syllabusOnly) { renderSyllabusProgress("Seus marcos de revisão."); return; }
  const answered = new Set(state.answered);
  const practiced = data.questions.filter(q => answered.has(q.id)).length;
  const achievements = [
    ["🚀", "Primeiro passo", data.practiceOnly ? "Responda à primeira questão deste banco." : "Conclua sua primeira lição.", data.practiceOnly ? practiced > 0 : completedLessons() >= 1],
    ["🔥", "Em chamas", "Mantenha uma sequência de 3 dias.", state.streak >= 3],
    ["⚡", "Em evolução", "Acumule 200 XP.", state.xp >= 200],
    ["🎯", "Precisão", "Responda 20 questões.", state.answered.length >= 20],
    ["🏅", "Meio caminho", data.practiceOnly ? "Responda à metade das questões deste banco." : `Conclua metade da trilha de ${data.title}.`, data.practiceOnly ? data.total > 0 && practiced >= Math.ceil(data.total / 2) : lessons.length > 0 && completedLessons() >= Math.ceil(lessons.length / 2)],
    ["🧠", data.practiceOnly ? "Banco percorrido" : `Domínio de ${data.title}`, data.practiceOnly ? "Responda a todas as questões deste banco." : "Conclua toda a trilha selecionada.", data.practiceOnly ? data.total > 0 && practiced >= data.total : lessons.length > 0 && completedLessons() >= lessons.length],
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
  const authoredCount = catalog.questions.filter(q => q.origin === "autoral").length;
  const officialCount = catalog.courses.find(c => c.practiceOnly)?.total || 0;
  app.innerHTML = `${pageHeader("Sobre o projeto", "Concursos", "Um treino diário com questões comentadas, trilhas por edital e progresso que acompanha seu esforço.")}
  <section class="pwa-card" aria-labelledby="pwa-title">
    <div class="pwa-heading"><img src="/icons/icon-192.png" width="56" height="56" alt="" /><div><span class="eyebrow">Sempre à mão</span><h2 id="pwa-title">Seu estudo em um aplicativo</h2></div></div>
    <p>Adicione o Concursos à tela inicial ou ao computador e abra sua trilha em uma janela própria.</p>
    <p data-pwa-status role="status">A instalação está disponível pelo menu dos navegadores compatíveis.</p>
    <button class="button" type="button" data-pwa-install hidden>Instalar aplicativo</button>
    <div data-pwa-instructions>
      <details class="pwa-help" open><summary>Como instalar pelo navegador</summary><ul>
        <li><strong>Chrome e Edge:</strong> abra o menu ⋮ ou ⋯ e procure “Instalar aplicativo” ou “Instalar esta página como app”. No Android, a opção também pode aparecer em “Adicionar à tela inicial”.</li>
        <li><strong>iPhone e iPad:</strong> no Safari, toque em Compartilhar → Adicionar à Tela de Início. Ative “Abrir como App” se essa opção aparecer.</li>
        <li><strong>Safari no Mac:</strong> use Arquivo → Adicionar ao Dock, quando disponível.</li>
      </ul><p>Se estiver no navegador interno de outro aplicativo, abra este endereço no Chrome, Edge ou Safari para instalar.</p></details>
    </div>
    <p class="pwa-offline" data-pwa-offline role="status">Acesse uma vez com internet para preparar o conteúdo principal para uso offline.</p>
    <p class="pwa-note">As questões oficiais, imagens e PDFs precisam ter sido carregados com internet para serem consultados offline. Seu progresso fica neste navegador e dispositivo; não há sincronização entre aparelhos.</p>
  </section>
  <div class="about-grid"><article class="info-card"><div class="big-number">${authoredCount}</div><h3>itens autorais únicos</h3><p>Banco inicial de Certo ou Errado. Os itens comuns aparecem nas quatro especialidades, sem duplicar o histórico.</p></article><article class="info-card"><div class="big-number">${officialCount}</div><h3>questões oficiais importadas</h3><p>Provas anteriores de cargos de TI da Cebraspe, com fonte e gabarito. Disponíveis no banco de prática.</p></article></div>
  <div class="notice"><strong>Como estudar:</strong> leia a introdução, resolva uma lição de até cinco questões e consulte a justificativa. Lições permitem até três erros por tentativa; reiniciar renova as chances. Na prática, não há limite de erros.</div>
  <div class="notice"><strong>Origem do conteúdo:</strong> as quatro trilhas da CGU contêm exercícios, comentários e introduções autorais. O banco de provas anteriores contém questões oficiais da Cebraspe, identificadas em cada item. Quando não há comentário, a correção apresenta somente o gabarito e a fonte. Os vínculos ao programa são editoriais. As trilhas da Câmara dos Deputados apresentam o programa do PDF enviado e um checklist, sem questões vinculadas. O app é independente das instituições e das bancas. Este banco inicial não cobre todos os tópicos do edital, e a discursiva não possui correção automática.</div>
  <div class="notice"><strong>Fontes:</strong> <a href="${sourceHref(currentExam().sourceUrl)}" class="source-link" target="_blank" rel="noreferrer">página da banca</a> · <a href="${escapeHtml(examPdfUrl())}" class="source-link" download>edital selecionado em PDF</a> · <a href="/data/courses.json" class="source-link" download>baixar banco de estudo</a>. Verificação do edital: 13/10/2026. Consulte a banca para retificações.</div>`;
  window.concursosPwa?.refresh();
}

function renderEdital() {
  const exam = currentExam();
  const discursive = exam.discursive;
  const hours = minutes => `${Math.floor(minutes / 60)}h${minutes % 60 ? String(minutes % 60).padStart(2, '0') : ''}`;
  const source = sourceHref(exam.sourceUrl);
  app.innerHTML = `${pageHeader(escapeHtml(exam.edital), "Conheça seu caminho.", "Programa organizado por bloco e cargo. Consulte as regras da seleção e marque as disciplinas que você já revisou.")}
  ${examBanner()}
  <div class="edital-links"><a class="button" href="${escapeHtml(examPdfUrl())}" target="_blank" rel="noreferrer">Abrir edital completo ↗</a>${source ? `<a class="button secondary" href="${source}" target="_blank" rel="noreferrer">Banca e atualizações ↗</a>` : ''}</div>
  ${data.requirements ? `<details class="competency-reference"><summary>Requisitos do cargo</summary><p>${escapeHtml(data.requirements)}</p><a class="source-link" href="${escapeHtml(examPdfUrl())}#page=${data.requirementsSourcePage}" target="_blank" rel="noreferrer">Conferir requisitos no PDF ↗</a></details>` : ''}
  <div class="exam-summary"><p><strong>Inscrições:</strong> ${formatDate(exam.registrationStart)} a ${formatDate(exam.registrationEnd)}${exam.registrationStartTime ? `, das ${escapeHtml(exam.registrationStartTime)} do primeiro dia às ${escapeHtml(exam.registrationEndTime)} do último dia (Brasília)` : ''}.</p>
  ${exam.registrationFee ? `<p><strong>Taxa:</strong> R$ ${Number(exam.registrationFee).toFixed(2).replace('.', ',')} · pagamento até ${formatDate(exam.registrationPaymentDeadline)}.</p>` : ''}
  <p><strong>Objetivas:</strong> ${exam.blocks.reduce((n, block) => n + block.items, 0)} itens C/E · ${hours(exam.objectiveDurationMinutes)} · ${escapeHtml(exam.objectiveShift)} · até ${exam.objectiveTotalPoints} pontos.</p>
  <p><strong>Discursiva:</strong> ${discursive.items} itens · ${hours(discursive.durationMinutes)} · ${escapeHtml(discursive.shift)} · até ${discursive.totalPoints} pontos. Sem correção discursiva neste app.</p>
  ${discursive.summary ? `<p>${escapeHtml(discursive.summary)}</p>` : `<ul>${discursive.questions.map((q, i) => `<li>Questão ${i+1} · ${q.block} · até ${q.maxLines} linhas · ${q.points} pontos.</li>`).join('')}</ul>`}</div>
  <div class="exam-blocks">${exam.blocks.map(b => `<article><span>${b.id}</span><h2>${escapeHtml(b.title)}</h2><strong>${b.items} itens</strong><p>Acerto +${b.correctPoints} · erro ${b.wrongPoints}<br>Mínimo: ${b.minimumPoints} pontos</p></article>`).join("")}</div>
  <p class="stats-note">Branco e dupla marcação: 0. Mínimo total nas objetivas: ${exam.objectiveMinimumTotal}; na discursiva: ${discursive.minimumPoints}. Esses mínimos não garantem classificação. Confira as demais condições no edital.</p>
  ${exam.vacancyNote ? `<p class="notice">${escapeHtml(exam.vacancyNote)}</p>` : ''}
  ${exam.schedule?.length ? `<details class="competency-reference"><summary>Cronograma completo · Anexo I</summary><p>${escapeHtml(exam.scheduleNote)}</p><dl class="schedule-list">${exam.schedule.map(item => `<div><dt>${escapeHtml(item.title)}</dt><dd>${escapeHtml(item.datesText)}</dd></div>`).join('')}</dl></details>` : ''}
  <section class="stats-card"><h2>Seu edital por disciplina</h2><p id="edital-progress" aria-live="polite">${reviewedModules()}/${data.modules.length} disciplinas marcadas como revisadas. Este checklist é independente das lições.</p><div class="edital-list">${data.modules.map(m => {
    const count = data.questions.filter(q => q.moduleId === m.id).length;
    return `<details><summary><span class="block-badge">${m.block}</span><strong>${escapeHtml(m.title)}</strong><span>${data.syllabusOnly ? `${m.topLevelTopics.length} tópicos` : `${count} itens de treino`}</span></summary><p><strong>${escapeHtml(m.officialTitle)}</strong> · item ${escapeHtml(m.section)}</p><div class="syllabus-text">${syllabusMarkup(m)}</div><div class="edital-actions">${syllabusCheck(m)}<button class="button secondary" data-open-study="${m.id}">${data.syllabusOnly ? 'Abrir no roteiro' : 'Estudar disciplina'}</button>${m.sourcePage ? `<a class="source-link" href="${escapeHtml(examPdfUrl())}#page=${m.sourcePage}" target="_blank" rel="noreferrer">Página ${m.sourcePage} do PDF ↗</a>` : ''}</div></details>`;
  }).join("")}</div></section><p class="stats-note">Programa dos itens ${escapeHtml(exam.syllabusSection)}. ${exam.sourceKind === 'user-provided-pdf' ? 'Transcrito do PDF enviado, sem incorporar retificações externas.' : 'Os títulos curtos são editoriais.'} A revisão não representa cobertura completa de questões. Fonte conferida em ${formatDate(exam.checkedAt)}.</p>`;
}

function renderPage(resetScroll = true) {
  if (data.practiceOnly && activeView === "edital") {
    const previous = catalog.courses.find(c => c.id === state.activeSyllabusCourse && !c.practiceOnly);
    setCourse(previous?.id || "desenvolvimento");
  }
  if (data.practiceOnly && activeView === "aprender") { activeView = "praticar"; history.replaceState(null, "", "#praticar"); }
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
  if (!module?.introduction) return;
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
        <div class="question-meta"><span>${escapeHtml(question.moduleTitle || quiz.lesson.module.title)}</span><span>Item ${question.index}${question.origin === "oficial" ? " da prova" : ` · ${question.block}`}</span></div>
        <div class="question-tools">${questionMeta(question)}<button class="text-button favorite-button" data-action="favorite" aria-pressed="${state.favorites.includes(question.id)}">${state.favorites.includes(question.id) ? "★ Favorita" : "☆ Favoritar"}</button></div>

        <h1 tabindex="-1">${question.origin === "oficial" ? `Responda apenas ao item ${escapeHtml(question.index)}` : renderMathText(question.alternativesIntroduction || "Qual é a alternativa correta?")}</h1>
        ${question.origin === "oficial" ? renderOfficialStatement(question) : ""}
        ${question.context && question.origin !== "oficial" ? `<div class="question-context" lang="${question.language === "ingles" ? "en" : question.language === "espanhol" ? "es" : "pt-BR"}">${renderMarkdown(question.context, question.areaId === "linguagens")}</div>` : ""}
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

function sourceHref(url, page) {
  if (!/^https?:\/\//i.test(String(url || ""))) return "";
  return escapeHtml(`${String(url).split("#")[0]}${Number.isInteger(page) && page > 0 ? `#page=${page}` : ""}`);
}

function officialSourceLinks(question, includeAnswerKey = false) {
  const exam = sourceHref(question.sourceUrl, question.sourcePage);
  const key = sourceHref(question.answerKeyUrl, question.answerKeyPage);
  return `<div class="official-sources">${exam ? `<a class="source-link" href="${exam}" target="_blank" rel="noreferrer">Prova original${question.sourcePage ? ` · página ${question.sourcePage}` : ""} ↗</a>` : ""}${includeAnswerKey && key ? `<a class="source-link" href="${key}" target="_blank" rel="noreferrer">Gabarito oficial${question.answerKeyPage ? ` · página ${question.answerKeyPage}` : ""} ↗</a>` : ""}</div>`;
}

function officialItemMarker(marker) {
  if (!marker || !["left", "top", "width", "height"].every(key => Number.isFinite(marker[key]) && marker[key] >= 0 && marker[key] <= 100)) return "";
  if (!marker.width || !marker.height || marker.left + marker.width > 100 || marker.top + marker.height > 100) return "";
  return `<span class="exam-item-marker" aria-hidden="true" style="left:${marker.left}%;top:${marker.top}%;width:${marker.width}%;height:${marker.height}%"></span>`;
}

function officialImageMarkup(image, question) {
  return `<figure><a href="${escapeHtml(image.src)}" target="_blank" rel="noreferrer" aria-label="Ampliar ${escapeHtml(image.alt || `página da prova com o item ${question.index}`)}"><img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt || `Prova original com o item ${question.index}`)}" loading="lazy">${officialItemMarker(image.marker)}</a>${image.page ? `<figcaption>Página ${escapeHtml(image.page)} da prova original</figcaption>` : ""}</figure>`;
}

function renderOfficialStatement(question) {
  const images = (question.images || []).filter(image => typeof image.src === "string" && image.src.startsWith("/assets/questions/") && !image.src.includes("..") && !/[\\\s]/.test(image.src));
  const support = images.filter(image => image.support);
  const main = images.filter(image => !image.support).sort((a,b) => (a.page === question.sourcePage ? -1 : b.page === question.sourcePage ? 1 : (a.page || 0) - (b.page || 0)));
  const text = question.context ? `<div class="question-context official-transcript">${escapeHtml(question.context).replace(/\n/g, "<br>")}</div>` : "";
  const supportMarkup = support.length ? `<details class="exam-support"><summary>Material de apoio · ${support.length === 1 ? "página" : "páginas"} ${support.map(image => escapeHtml(image.page)).join(", ")}</summary><p class="tiny">Páginas anteriores preservadas para consultar textos, figuras, tabelas e código citados no item.</p><div class="exam-pages">${support.map(image => officialImageMarkup(image, question)).join("")}</div></details>` : "";
  return `<div class="official-question"><p class="official-instruction">${escapeHtml(question.alternativesIntroduction || "Leia o enunciado e selecione a resposta.")}</p>${question.paperTitle ? `<p class="reference-note">${escapeHtml(question.paperTitle)}</p>` : ""}${question.cargo && question.cargo !== question.paperTitle ? `<details class="paper-roles"><summary>Cargos associados ao caderno</summary><p>${escapeHtml(question.cargo)}</p></details>` : ""}${images.length ? `<p class="notice compact">A página pode conter outros itens e textos de apoio. Responda somente ao <strong>item ${escapeHtml(question.index)}</strong>. Abra a imagem para ampliar.${support.length ? ' Revise o <strong>material de apoio abaixo</strong> quando o item mencionar texto, figura, tabela ou código das páginas anteriores.' : ""}</p><div class="exam-pages">${main.map(image => officialImageMarkup(image, question)).join("")}</div>${supportMarkup}${text ? `<details class="transcript"><summary>Transcrição auxiliar · item ${escapeHtml(question.index)}</summary><p class="tiny">Texto extraído do PDF, que pode incluir outros itens e textos de apoio. A página original é a referência para enunciados, fórmulas, tabelas e figuras.</p>${text}</details>` : ""}` : text}${officialSourceLinks(question)}</div>`;
}

function renderExplanation(question) {
  const explanation = question.explanation;
  if (question.origin === "oficial") {
    const hasComment = Boolean(explanation?.steps?.length);
    return `<section class="explanation" aria-labelledby="explanation-title" tabindex="-1"><p class="page-kicker">Correção pela banca</p><h2 id="explanation-title">Gabarito oficial${question.answerKeyStatus ? ` · ${escapeHtml(question.answerKeyStatus)}` : ""}</h2><div class="correct-answer"><strong>Resposta: ${escapeHtml(answerLabel(question, question.correctAlternative))}</strong></div>${hasComment ? `<h3>${escapeHtml(explanation.label || "Comentário de estudo")}</h3><ol>${explanation.steps.map(step => `<li>${renderMathText(step)}</li>`).join("")}</ol>` : '<p>O gabarito confirma a resposta, mas não traz uma justificativa pedagógica para este item. Consulte a prova e o gabarito nas fontes abaixo.</p>'}${officialSourceLinks(question, true)}<p class="reference-note">Item ${escapeHtml(question.index)} · ${escapeHtml(question.examName || question.examId)}${question.year ? ` · ${escapeHtml(question.year)}` : ""}. Considere o contexto e as normas vigentes na data da prova.</p></section>`;
  }
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
        <div class="feedback-copy" role="status"><strong>${correct ? "Mandou bem! +10 XP" : `Gabarito: ${answerLabel(question, question.correctAlternative)}`}</strong><span>${!quiz.practice && quiz.errors > MAX_LESSON_ERRORS ? "Limite de erros excedido. Leia a resolução antes de reiniciar." : (question.origin === "oficial" ? "Confira o gabarito oficial e as fontes antes de continuar." : "Confira a resolução comentada antes de continuar.")}</span></div>
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
    courseSelectionVersion += 1;
    event.preventDefault();
    activeView = view.dataset.view;
    history.replaceState(null, "", `#${activeView}`);
    renderPage();
    return;
  }
  const courseButton = event.target.closest("[data-select-course]");
  if (courseButton) { activeView = "praticar"; void selectCourse(courseButton.dataset.selectCourse); return; }
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
    if (data.syllabusOnly) { activeView = "aprender"; history.replaceState(null, "", "#aprender"); renderPage(); return; }
    if (data.practiceOnly) { activeView = "praticar"; history.replaceState(null, "", "#praticar"); renderPage(); return; }
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
    if (!data.modules.some(m => m.id === id)) return;
    state.syllabusRead = event.target.checked ? [...new Set([...state.syllabusRead, id])] : state.syllabusRead.filter(x => x !== id);
    saveState();
    if (data.syllabusOnly && activeView === "aprender") {
      renderPage(false); app.querySelector(`[data-syllabus="${id}"]`)?.focus({preventScroll:true});
    } else {
      const progress = app.querySelector("#edital-progress");
      if (progress) progress.textContent = `${reviewedModules()}/${data.modules.length} disciplinas marcadas como revisadas. Este checklist é independente das lições.`;
      renderRail();
    }
    return;
  }
  if (event.target.id === "stats-period") { statsPeriod = event.target.value; renderPerformance(); app.querySelector("#stats-period").focus({ preventScroll: true }); return; }
  if (event.target.id === "stats-mode") { statsMode = event.target.value; renderPerformance(); app.querySelector("#stats-mode").focus({ preventScroll: true }); return; }
  if (event.target.id === "unit-select") {
    const unit = app.querySelector(`#unit-${event.target.value}`);
    if (unit) { unit.scrollIntoView({ block: "start", behavior: "smooth" }); unit.querySelector("h2").focus({ preventScroll: true }); }
    return;
  }
  if (event.target.id !== "course-select") return;
  void selectCourse(event.target.value);
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
  courseSelectionVersion += 1;
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
    const knownIds = new Set(catalog.courses.flatMap(course => course.questionIds));
    state.missed = state.missed.filter(id => knownIds.has(id));
    const requested = initialCourseId();
    try {
      await ensureCourseData(requested);
      setCourse(requested);
      renderPage();
    } catch (error) {
      setCourse("desenvolvimento");
      renderPage();
      showToast(error.message);
    }
  } catch (error) {
    app.innerHTML = `<div class="notice" style="margin-top:40px"><strong>Falha ao iniciar.</strong><br>${escapeHtml(error.message)} Recarregue a página ou verifique se o site está sendo servido por HTTP.</div>`;
  }
}

init();
