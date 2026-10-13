import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getDiagnosticCoverage, createDiagnosticSession, validateDiagnosticSession, scoreDiagnosticSession} from '../dist/diagnostic.js';

const catalog = JSON.parse(readFileSync(new URL('../dist/data/courses.json', import.meta.url), 'utf8'));
const now = () => '2026-10-13T12:00:00.000Z';
function random(seed = 1) {
  return () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32;};
}
function fixture() {
  const courses = ['alpha', 'beta'].map(id => ({id, title: id, examId: 'test',
    modules: ['first', 'second'].map(suffix => ({id: `${id}-${suffix}`, title: suffix, track: id})), questionIds: []}));
  const questions = [];
  for (const course of courses) for (const module of course.modules) for (let index = 0; index < 8; index++) {
    const correctAlternative = index % 2 ? 'E' : 'C';
    const id = `${module.id}-${index}`;
    questions.push({id, examId: 'test', moduleId: module.id, track: course.id,
      format: 'certo-errado', context: `Enunciado ${id}`, correctAlternative,
      alternatives: ['C', 'E'].map(letter => ({letter, isCorrect: letter === correctAlternative}))});
    course.questionIds.push(id);
  }
  return {courses, questions};
}
function create(input = fixture(), options = {}) {
  return createDiagnosticSession(input, input.courses[0].examId, {now, random: random(42), ...options});
}
function fill(input, session, choose) {
  const questions = new Map(input.questions.map(question => [question.id, question]));
  const indexes = new Map();
  session.answers = session.entries.map(entry => {
    const index = indexes.get(entry.courseId) || 0;
    indexes.set(entry.courseId, index + 1);
    const answer = choose(entry.courseId, index);
    const correct = questions.get(entry.questionId).correctAlternative;
    return {questionId: entry.questionId, answer: answer === 'correct' ? correct : answer === 'wrong' ? (correct === 'C' ? 'E' : 'C') : answer};
  });
  return scoreDiagnosticSession(input, session);
}

test('CGU has equal samples for all four roles; Câmara cannot produce a partial ranking', () => {
  const cgu = getDiagnosticCoverage(catalog, 'cgu-2026');
  assert.equal(cgu.ready, true);
  assert.equal(cgu.total, 40);
  assert.equal(cgu.courses.length, 4);
  assert.equal(cgu.courses.reduce((sum, course) => sum + course.available, 0), 85);
  const camara = getDiagnosticCoverage(catalog, 'camara-2026');
  assert.equal(camara.courses.length, 11);
  assert.equal(camara.ready, false);
  assert.ok(camara.courses.every(course => !course.ready));
  assert.throws(() => createDiagnosticSession(catalog, 'camara-2026'), /suficientes/);
  assert.equal(getDiagnosticCoverage(catalog, 'missing').ready, false);
});

test('sampling is reproducible, interleaves all roles and covers their modules evenly', () => {
  const a = create(catalog);
  assert.deepEqual(a, create(catalog));
  assert.notDeepEqual(a.entries, create(catalog, {random: random(99)}).entries);
  assert.equal(validateDiagnosticSession(catalog, a).valid, true);
  assert.equal(new Set(a.entries.map(entry => entry.questionId)).size, 40);
  for (let index = 0; index < a.entries.length; index += 4) {
    assert.equal(new Set(a.entries.slice(index, index + 4).map(entry => entry.courseId)).size, 4);
  }
  for (const course of catalog.courses.filter(course => course.examId === 'cgu-2026')) {
    const entries = a.entries.filter(entry => entry.courseId === course.id);
    assert.equal(entries.length, 10);
    const counts = course.modules.filter(module => module.track === course.id).map(module => entries.filter(entry => entry.moduleId === module.id).length);
    assert.ok(Math.min(...counts) >= 2);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
  }
  assert.deepEqual(a.answers, []);
});

test('C/E keys are balanced where feasible without reducing module coverage', () => {
  const map = new Map(catalog.questions.map(question => [question.id, question]));
  for (let seed = 0; seed < 30; seed++) {
    const session = create(catalog, {random: random(seed)});
    assert.equal(validateDiagnosticSession(catalog, session).valid, true);
    for (const courseId of session.courseIds) {
      const entries = session.entries.filter(entry => entry.courseId === courseId);
      assert.equal(entries.filter(entry => map.get(entry.questionId).correctAlternative === 'C').length, 5);
    }
  }
  const input = fixture();
  for (const question of input.questions) {
    question.correctAlternative = 'C';
    question.alternatives = [{letter: 'C', isCorrect: true}, {letter: 'E', isCorrect: false}];
  }
  assert.equal(validateDiagnosticSession(input, create(input)).valid, true);
});

test('commons, foreign exams, generic-bank and malformed questions never enter the sample', () => {
  const input = fixture();
  const course = input.courses[0];
  course.modules.push({id: 'common', title: 'Common', track: 'common'});
  const original = input.questions[0];
  const additions = [
    {...original, id: 'common-question', moduleId: 'common', track: 'common'},
    {...original, id: 'other-exam-question', examId: 'another-exam'},
    {...original, id: 'official-bank-question', track: 'cebraspe-ti', origin: 'official'},
    {...original, id: 'unknown-module', moduleId: 'not-in-syllabus'},
    {...original, id: 'multiple-choice', format: 'multipla-escolha'},
    {...original, id: 'bad-key', correctAlternative: 'A'},
    {...original, id: 'bad-options', alternatives: []},
    {...original, id: 'no-stem', context: ''}
  ];
  input.questions.push(...additions);
  course.questionIds.push(...additions.map(question => question.id));
  const coverage = getDiagnosticCoverage(input, 'test');
  assert.equal(coverage.courses[0].available, 16);
  assert.ok(create(input).entries.every(entry => !additions.some(question => question.id === entry.questionId)));
});

test('duplicate catalog IDs are excluded rather than silently replacing the answer key', () => {
  const input = fixture();
  input.questions.push({...input.questions[0], correctAlternative: 'E'});
  assert.equal(getDiagnosticCoverage(input, 'test').courses[0].available, 15);
  assert.ok(create(input).entries.every(entry => entry.questionId !== input.questions[0].id));
});

test('missing coverage in any role or module blocks the whole comparison', () => {
  const input = fixture();
  input.questions = input.questions.filter(question => question.moduleId !== 'beta-second');
  const coverage = getDiagnosticCoverage(input, 'test');
  assert.equal(coverage.courses[0].ready, true);
  assert.equal(coverage.courses[1].ready, false);
  assert.equal(coverage.ready, false);
  assert.throws(() => create(input), /sufis?cientes|suficientes/);
  assert.equal(getDiagnosticCoverage(fixture(), 'test', 1).ready, false);
  assert.equal(getDiagnosticCoverage(fixture(), 'test', -1).ready, false);
});

test('complete scoring includes blanks, normalizes scores and reports module performance', () => {
  const input = fixture();
  const result = fill(input, create(input), (course, index) => course === 'alpha'
    ? index < 7 ? 'correct' : index < 9 ? 'wrong' : null
    : index < 5 ? 'correct' : 'wrong');
  assert.equal(result.complete, true);
  assert.equal(result.total, 20);
  assert.equal(result.answered, 20);
  const alpha = result.courses.find(course => course.id === 'alpha');
  assert.equal(alpha.correct, 7); assert.equal(alpha.wrong, 2); assert.equal(alpha.blank, 1);
  assert.equal(alpha.accuracy, 70); assert.equal(alpha.attempted, 9);
  assert.equal(alpha.netScore, 0.5); assert.equal(alpha.netPercent, 50);
  assert.equal(alpha.modules.reduce((sum, module) => sum + module.correct, 0), 7);
  assert.deepEqual(result.leaderIds, ['alpha']);
  assert.deepEqual(result.recommendation.courseIds, ['alpha']);
  assert.equal(result.recommendation.status, 'recommended');
});

test('incomplete sessions cannot reveal a recommendation or provisional leader', () => {
  const input = fixture();
  const session = create(input);
  fill(input, session, () => 'correct');
  session.answers.pop();
  const result = scoreDiagnosticSession(input, session);
  assert.equal(result.complete, false);
  assert.equal(result.unanswered, 1);
  assert.deepEqual(result.leaderIds, []);
  assert.equal(result.recommendation, null);
});

test('a blank answer is distinct from an unanswered item and cannot win by omission', () => {
  const input = fixture();
  const result = fill(input, create(input), course => course === 'alpha' ? null : 'wrong');
  assert.equal(result.complete, true);
  assert.equal(result.courses[0].blank, 10);
  assert.equal(result.courses[0].unanswered, 0);
  assert.deepEqual(result.leaderIds, ['alpha']);
  assert.equal(result.recommendation.status, 'insufficient');
  assert.deepEqual(result.recommendation.courseIds, []);
  const allBlank = fill(input, create(input), () => null);
  assert.equal(allBlank.recommendation.status, 'insufficient');
});

test('a positive leader still needs at least half the questions attempted', () => {
  const input = fixture();
  const result = fill(input, create(input), (course, index) => course === 'alpha' && index < 4 ? 'correct' : course === 'alpha' ? null : 'wrong');
  assert.equal(result.courses[0].netPercent, 40);
  assert.equal(result.recommendation.status, 'insufficient');
});

test('equal positive scores yield co-leaders without arbitrary tie-breaking', () => {
  const input = fixture();
  const result = fill(input, create(input), (_course, index) => index < 7 ? 'correct' : 'wrong');
  assert.equal(result.recommendation.status, 'tie');
  assert.deepEqual(result.leaderIds, ['alpha', 'beta']);
  assert.deepEqual(result.recommendation.courseIds, ['alpha', 'beta']);
});

test('restored sessions reject missing roles, duplicate/foreign entries and altered module assignments', () => {
  const input = fixture();
  const mutations = [
    session => {session.version = 2;},
    session => {session.courseIds.pop();},
    session => {session.entries[0] = {...session.entries[1]};},
    session => {session.entries[0].questionId = 'invented-question';},
    session => {session.entries[0].courseId = 'foreign-course';},
    session => {session.entries[0].moduleId = 'foreign-module';},
    session => {session.entries.pop();},
    session => {session.startedAt = 'not-a-date';}
  ];
  for (const mutation of mutations) {
    const session = create(input);
    mutation(session);
    assert.equal(validateDiagnosticSession(input, session).valid, false);
    assert.throws(() => scoreDiagnosticSession(input, session));
  }
});

test('restored answers reject duplicates, nonexistent questions and invalid choices', () => {
  const input = fixture();
  const session = create(input);
  const answer = {questionId: session.entries[0].questionId, answer: 'C'};
  for (const answers of [[answer, answer], [{...answer, answer: 'A'}], [{...answer, answer: undefined}], [{...answer, questionId: 'outside'}], [null]]) {
    session.answers = answers;
    assert.equal(validateDiagnosticSession(input, session).valid, false);
  }
  session.answers = [answer];
  assert.equal(validateDiagnosticSession(input, JSON.parse(JSON.stringify(session))).valid, true);
});

test('building and scoring never mutate the catalog or the saved session', () => {
  const input = fixture();
  const original = structuredClone(input);
  const session = create(input);
  const saved = structuredClone(session);
  scoreDiagnosticSession(input, session);
  assert.deepEqual(input, original);
  assert.deepEqual(session, saved);
});
