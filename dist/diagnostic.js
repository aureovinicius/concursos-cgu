// A balanced sample of existing knowledge, not a psychometric or vocational test.
export const DIAGNOSTIC_VERSION = 1;
export const DEFAULT_DIAGNOSTIC_PER_COURSE = 10;

const isCount = n => Number.isInteger(n) && n > 0 && n <= 100;
const isId = value => typeof value === 'string' && value.length > 0 && value.length <= 300;

function shuffle(values, random) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i--) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('Gerador aleatório inválido.');
    const j = Math.floor(value * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function poolsForExam(catalog, examId) {
  const questions = new Map();
  const duplicateIds = new Set();
  for (const question of catalog?.questions || []) {
    if (questions.has(question.id)) duplicateIds.add(question.id);
    questions.set(question.id, question);
  }
  return (catalog?.courses || []).filter(course => course.examId === examId).map(course => {
    const allowed = new Set(course.questionIds || []);
    const modules = (course.modules || []).filter(module => module.track === course.id).map(module => ({
      id: module.id, title: module.title,
      questions: [...allowed].map(id => questions.get(id)).filter(question =>
        question && isId(question.id) && !duplicateIds.has(question.id)
        && question.examId === examId && question.track === course.id
        && question.moduleId === module.id && question.format === 'certo-errado'
        && ['C', 'E'].includes(question.correctAlternative)
        && typeof question.context === 'string' && question.context.trim().length > 0
        && Array.isArray(question.alternatives) && question.alternatives.length === 2
        && ['C', 'E'].every(letter => question.alternatives.some(alternative => alternative.letter === letter
          && alternative.isCorrect === (letter === question.correctAlternative)))
      )
    }));
    return {id: course.id, title: course.title, modules};
  });
}

export function getDiagnosticCoverage(catalog, examId, perCourse = DEFAULT_DIAGNOSTIC_PER_COURSE) {
  const pools = poolsForExam(catalog, examId);
  const validCount = isCount(perCourse);
  const courses = pools.map(course => {
    const required = validCount && course.modules.length ? Math.floor(perCourse / course.modules.length) : 0;
    const modules = course.modules.map(module => ({
      id: module.id, title: module.title, available: module.questions.length,
      required, ready: required > 0 && module.questions.length >= required
    }));
    const remaining = perCourse - required * modules.length;
    const available = modules.reduce((sum, module) => sum + module.available, 0);
    const ready = validCount && modules.length > 0 && modules.every(module => module.ready)
      && modules.filter(module => module.available > required).length >= remaining;
    return {id: course.id, title: course.title, available, required: perCourse, ready, modules};
  });
  const distinctCourses = new Set(courses.map(course => course.id)).size === courses.length;
  const distinctModules = pools.every(course => new Set(course.modules.map(module => module.id)).size === course.modules.length);
  const ready = validCount && courses.length >= 2 && distinctCourses && distinctModules && courses.every(course => course.ready);
  const reason = ready ? '' : !validCount ? 'A quantidade por cargo deve ser um inteiro entre 1 e 100.'
    : courses.length < 2 ? 'É preciso ter pelo menos dois cargos do mesmo edital para comparar.'
    : !distinctCourses || !distinctModules ? 'O catálogo contém identificadores de cargos ou disciplinas repetidos.'
    : 'Ainda não há questões específicas suficientes em todas as disciplinas de todos os cargos deste edital.';
  return {examId, perCourse, ready, reason, courses, total: validCount ? courses.length * perCourse : 0};
}

// Find near-equal module quotas and the closest possible C/E balance together.
// This never substitutes questions from another subject just to balance the key.
function chooseCourseQuestions(course, count, random) {
  const modules = shuffle(course.modules, random);
  const minimum = Math.floor(count / modules.length);
  const maximum = Math.ceil(count / modules.length);
  let states = new Map([['0:0', {total: 0, correct: 0, choices: []}]]);
  for (const module of modules) {
    const correct = module.questions.filter(question => question.correctAlternative === 'C');
    const wrong = module.questions.filter(question => question.correctAlternative === 'E');
    const possibilities = [];
    for (let quota = minimum; quota <= maximum; quota++) {
      for (let c = Math.max(0, quota - wrong.length); c <= Math.min(quota, correct.length); c++) {
        possibilities.push({quota, c});
      }
    }
    const next = new Map();
    for (const choice of shuffle(possibilities, random)) {
      for (const state of states.values()) {
        const total = state.total + choice.quota;
        if (total > count) continue;
        const numberCorrect = state.correct + choice.c;
        const key = `${total}:${numberCorrect}`;
        if (!next.has(key)) next.set(key, {total, correct: numberCorrect, choices: [...state.choices, choice]});
      }
    }
    states = next;
  }
  const candidates = shuffle([...states.values()].filter(state => state.total === count), random)
    .sort((a, b) => Math.abs(count - 2 * a.correct) - Math.abs(count - 2 * b.correct));
  if (!candidates.length) throw new Error('Não foi possível montar uma amostra equilibrada por disciplina.');
  const queues = modules.map((module, index) => {
    const choice = candidates[0].choices[index];
    const correct = shuffle(module.questions.filter(question => question.correctAlternative === 'C'), random).slice(0, choice.c);
    const wrong = shuffle(module.questions.filter(question => question.correctAlternative === 'E'), random).slice(0, choice.quota - choice.c);
    return shuffle([...correct, ...wrong], random).map(question => ({questionId: question.id, courseId: course.id, moduleId: module.id}));
  });
  const selected = [];
  while (selected.length < count) for (const queue of queues) if (queue.length) selected.push(queue.shift());
  return selected;
}

export function createDiagnosticSession(catalog, examId, options = {}) {
  const {perCourse = DEFAULT_DIAGNOSTIC_PER_COURSE, random = Math.random, now = () => new Date().toISOString()} = options;
  const coverage = getDiagnosticCoverage(catalog, examId, perCourse);
  if (!coverage.ready) throw new Error(coverage.reason);
  const pools = poolsForExam(catalog, examId);
  const selected = pools.map(course => chooseCourseQuestions(course, perCourse, random));
  const entries = [];
  for (let index = 0; index < perCourse; index++) {
    for (const queue of shuffle(selected, random)) entries.push(queue[index]);
  }
  const startedAt = now();
  if (typeof startedAt !== 'string' || !Number.isFinite(Date.parse(startedAt))) throw new Error('Data de início inválida.');
  const fingerprint = entries.map(entry => entry.questionId).join('|').split('')
    .reduce((hash, character) => Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0, 2166136261).toString(36);
  return {
    version: DIAGNOSTIC_VERSION,
    id: `diagnostic-${Date.parse(startedAt)}-${fingerprint}`,
    examId, perCourse, courseIds: pools.map(course => course.id), entries, answers: [], startedAt
  };
}

export function validateDiagnosticSession(catalog, session) {
  const fail = reason => ({valid: false, reason});
  if (!session || session.version !== DIAGNOSTIC_VERSION || !isId(session.id)
    || !isId(session.examId) || !isCount(session.perCourse)
    || typeof session.startedAt !== 'string' || !Number.isFinite(Date.parse(session.startedAt))) return fail('Sessão de diagnóstico inválida.');
  const coverage = getDiagnosticCoverage(catalog, session.examId, session.perCourse);
  if (!coverage.ready) return fail(coverage.reason);
  const pools = poolsForExam(catalog, session.examId);
  const courseIds = pools.map(course => course.id);
  if (!Array.isArray(session.courseIds) || session.courseIds.length !== courseIds.length
    || new Set(session.courseIds).size !== courseIds.length || session.courseIds.some(id => !courseIds.includes(id))) return fail('A sessão precisa incluir todos os cargos do edital.');
  if (!Array.isArray(session.entries) || session.entries.length !== coverage.total
    || new Set(session.entries.map(entry => entry?.questionId)).size !== coverage.total) return fail('A amostra contém questões repetidas ou quantidade inválida.');
  const allowed = new Map();
  for (const course of pools) for (const module of course.modules) for (const question of module.questions) {
    allowed.set(`${course.id}:${module.id}:${question.id}`, question);
  }
  for (const entry of session.entries) {
    if (!entry || !allowed.has(`${entry.courseId}:${entry.moduleId}:${entry.questionId}`)) return fail('A amostra contém questão ausente ou fora dos conhecimentos específicos do cargo.');
  }
  for (const course of pools) {
    const entries = session.entries.filter(entry => entry.courseId === course.id);
    if (entries.length !== session.perCourse) return fail('Todos os cargos precisam ter a mesma quantidade de questões.');
    for (const module of course.modules) {
      const count = entries.filter(entry => entry.moduleId === module.id).length;
      if (count < Math.floor(session.perCourse / course.modules.length) || count > Math.ceil(session.perCourse / course.modules.length)) return fail('A amostra não cobre de forma equilibrada as disciplinas do cargo.');
    }
  }
  if (!Array.isArray(session.answers) || session.answers.length > session.entries.length
    || new Set(session.answers.map(answer => answer?.questionId)).size !== session.answers.length) return fail('Há respostas repetidas ou inválidas.');
  const entryIds = new Set(session.entries.map(entry => entry.questionId));
  for (const answer of session.answers) {
    if (!answer || !entryIds.has(answer.questionId) || !['C', 'E', null].includes(answer.answer)) return fail('Uma resposta não corresponde à sessão de diagnóstico.');
  }
  return {valid: true, reason: ''};
}

function summarize(entries, answers, questions) {
  let correct = 0, wrong = 0, blank = 0, unanswered = 0;
  for (const entry of entries) {
    if (!answers.has(entry.questionId)) unanswered++;
    else if (answers.get(entry.questionId) === null) blank++;
    else if (answers.get(entry.questionId) === questions.get(entry.questionId).correctAlternative) correct++;
    else wrong++;
  }
  const total = entries.length;
  return {total, correct, wrong, blank, unanswered, answered: total - unanswered, attempted: correct + wrong,
    accuracy: total ? 100 * correct / total : 0,
    netScore: total ? (correct - wrong) / total : 0,
    netPercent: total ? 100 * (correct - wrong) / total : 0};
}

export function scoreDiagnosticSession(catalog, session) {
  const validation = validateDiagnosticSession(catalog, session);
  if (!validation.valid) throw new Error(validation.reason);
  const questions = new Map(catalog.questions.map(question => [question.id, question]));
  const answers = new Map(session.answers.map(answer => [answer.questionId, answer.answer]));
  const pools = poolsForExam(catalog, session.examId);
  const courses = pools.map(course => {
    const entries = session.entries.filter(entry => entry.courseId === course.id);
    return {id: course.id, title: course.title, ...summarize(entries, answers, questions),
      modules: course.modules.map(module => ({id: module.id, title: module.title,
        ...summarize(entries.filter(entry => entry.moduleId === module.id), answers, questions)}))};
  });
  const total = session.entries.length;
  const answered = session.answers.length;
  const complete = answered === total;
  // A provisional ranking is withheld so it cannot guide answers still in progress.
  const highest = complete ? Math.max(...courses.map(course => course.correct - course.wrong)) : null;
  const leaders = complete ? courses.filter(course => course.correct - course.wrong === highest) : [];
  const enoughEvidence = complete && highest > 0 && leaders.every(course => course.attempted >= Math.ceil(session.perCourse / 2));
  const recommendation = !complete ? null : !enoughEvidence
    ? {status: 'insufficient', courseIds: [], reason: 'O resultado ainda não oferece evidência suficiente para sugerir um cargo: é necessário saldo positivo e responder Certo ou Errado em pelo menos metade das questões dos cargos líderes.'}
    : {status: leaders.length > 1 ? 'tie' : 'recommended', courseIds: leaders.map(course => course.id),
      reason: leaders.length > 1 ? 'Há empate no desempenho líquido. Explore as trilhas desses cargos antes de escolher.' : 'Este cargo teve o melhor desempenho líquido na amostra de conhecimentos específicos.'};
  return {complete, total, answered, unanswered: total - answered, courses, leaderIds: leaders.map(course => course.id), recommendation};
}
