import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {gzipSync} from 'node:zlib';
import {getDiagnosticCoverage,createDiagnosticSession,validateDiagnosticSession,scoreDiagnosticSession} from '../dist/diagnostic.js';
const catalog = JSON.parse(readFileSync('dist/data/courses.json','utf8'));
const source = readFileSync('dist/app.js','utf8').replace(/^import\s*\{[^}]+\}\s*from\s*["']\.\/diagnostic\.js[^"']*["'];?\s*/,'').replace(/\ninit\(\);\s*$/,'');
function harness(saved, customCatalog=catalog, search="", fetchImpl=async()=>{throw new Error("Offline")},savedDiagnosticStore) {
 const nodes=new Map();
 const listeners=new Map();
 const node=()=>({innerHTML:'',hidden:true,dataset:{},setAttribute(){},focus(){},matches(){return false},scrollIntoView(){},scrollTo(){},querySelector(){return node()},classList:{add(){},remove(){}}});
 const store=new Map([['fisio-progress-v1',JSON.stringify({xp:999,completed:['mecanica-1']})]]);
 if(saved) store.set('concursos-cgu-progress-v1',JSON.stringify(saved));
 if(savedDiagnosticStore!==undefined) store.set('concursos-diagnostic-v1',typeof savedDiagnosticStore==='string'?savedDiagnosticStore:JSON.stringify(savedDiagnosticStore));
 const ctx=vm.createContext({getDiagnosticCoverage,createDiagnosticSession,validateDiagnosticSession,scoreDiagnosticSession,fetch:fetchImpl,Blob,Response,DecompressionStream,TextDecoder,Uint8Array,document:{querySelector(s){if(!nodes.has(s))nodes.set(s,node());return nodes.get(s)},querySelectorAll(){return[]},addEventListener(type,listener){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(listener)},body:{style:{}},activeElement:node()},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},location:{hash:'#aprender',search,pathname:'/concursos-cgu/'},window:{addEventListener(){},scrollTo(){}},history:{replaceState(_s,_title,url){ctx.lastReplacedUrl=url;ctx.location.search=new URL(url,"https://example.test").search;}},URLSearchParams,Intl,Date,setTimeout(){},structuredClone});
 vm.runInContext(source,ctx);ctx.input=structuredClone(customCatalog);vm.runInContext('catalog=input;setCourse(state.activeCourse);',ctx);
 return {run:s=>vm.runInContext(s,ctx),nodes,store,dispatch(type,event){for(const listener of listeners.get(type)||[])listener(event)}};
}
test('all four specialities match official syllabus with authored, sourced C/E items',()=>{
 const authored = catalog.questions.filter(q=>q.origin==="autoral");
 const tracks = catalog.courses.filter(c=>c.examId==='cgu-2026');
 assert.equal(tracks.length,4);assert.equal(authored.length,130);
 assert.equal(new Set(authored.map(q=>q.id)).size,130);
 const syllabus=JSON.parse(readFileSync('data/syllabus.json','utf8'));
 assert.equal(syllabus.modules.length,26);
 for(const m of syllabus.modules){assert.equal(authored.filter(q=>q.moduleId===m.id).length,5,m.id);}
 for(const c of tracks){
  assert.equal(c.total,c.questionIds.length);
  assert.ok(c.modules.every(m=>m.track==='common'||m.track===c.id));
  for(const m of c.modules){assert.ok(m.syllabusText.length>150);assert.equal(m.introduction.sections.length,3);assert.ok(m.introduction.example.steps.length>=2);}
 }
 for(const q of authored){assert.equal(q.origin,'autoral');assert.equal(q.alternatives.length,2);assert.ok(['C','E'].includes(q.correctAlternative));assert.ok(q.context.length>45);assert.ok(q.explanation.steps.length>=2);assert.ok(q.sourceUrl.startsWith('https://'));assert.equal(q.weight,q.block==='P3'?2:1);}
});
test('fork isolates ENEM progress, and persists its own progress',()=>{
 const a=harness();assert.equal(a.run('state.xp'),0);a.run('state.xp=20;saveState()');
 assert.equal(JSON.parse(a.store.get('fisio-progress-v1')).xp,999);
 assert.equal(harness(JSON.parse(a.store.get('concursos-cgu-progress-v1'))).run('state.xp'),20);
});

function openDiagnostic(app) {
 app.run('activeView="diagnostico";diagnosticExamId="cgu-2026";renderPage();startDiagnostic()');
}
function completeDiagnostic(app,answerExpression) {
 // Exercise the same answer/navigation actions as the UI, including its final review step.
 for(let index=0;index<40;index++) {
  app.run(`answerDiagnostic(${answerExpression});handleDiagnosticAction("next")`);
 }
 assert.equal(app.run('diagnosticScreen'),'submit');
 app.run('handleDiagnosticAction("finish")');
}
function restoreDiagnostic(app,customCatalog=catalog) {
 return harness(JSON.parse(app.store.get('concursos-cgu-progress-v1')),customCatalog,'',undefined,JSON.parse(app.store.get('concursos-diagnostic-v1')));
}

test('diagnostic starts a balanced mixed CGU sample and withholds feedback until submission',()=>{
 const a=harness();openDiagnostic(a);
 const session=JSON.parse(a.run('JSON.stringify(savedDiagnostic().session)'));
 assert.equal(session.entries.length,40);
 assert.equal(new Set(session.entries.map(item=>item.questionId)).size,40);
 for(const course of catalog.courses.filter(course=>course.examId==='cgu-2026')) {
  const entries=session.entries.filter(item=>item.courseId===course.id);
  assert.equal(entries.length,10);
  for(const module of course.modules.filter(module=>module.track===course.id)) {
   const amount=entries.filter(item=>item.moduleId===module.id).length;
   assert.ok(amount>=2&&amount<=3,`${course.id}/${module.id}`);
  }
  const questions=entries.map(item=>catalog.questions.find(q=>q.id===item.questionId));
  assert.ok(questions.every(q=>q.block==='P3'&&q.track===course.id));
  assert.equal(questions.filter(q=>q.correctAlternative==='C').length,5);
 }
 for(let i=0;i<40;i+=4) assert.equal(new Set(session.entries.slice(i,i+4).map(item=>item.courseId)).size,4);
 for(const answer of ['C','E','blank']) {
  a.run(`answerDiagnostic(${JSON.stringify(answer)})`);
  const html=a.nodes.get('#app').innerHTML;
  assert.match(html,/data-diag-answer="C"/);assert.match(html,/data-diag-answer="E"/);assert.match(html,/data-diag-answer="blank"/);
  assert.doesNotMatch(html,/class="explanation"|class="diagnostic-table"|Seu melhor resultado:|class="answer correct"|class="answer wrong"/);
  assert.equal(a.run('scoreDiagnosticSession(catalog,savedDiagnostic().session).recommendation'),null);
 }
});

test('diagnostic supports answer edits, pause, navigation and reload without changing the sample',()=>{
 const a=harness();openDiagnostic(a);
 const entries=a.run('JSON.stringify(savedDiagnostic().session.entries)');
 a.run('answerDiagnostic("C");handleDiagnosticAction("next");answerDiagnostic("blank");handleDiagnosticAction("previous");answerDiagnostic("E");handleDiagnosticAction("next");handleDiagnosticAction("pause")');
 assert.equal(a.run('diagnosticScreen'),'home');
 assert.match(a.nodes.get('#app').innerHTML,/Retomar simulado/);
 assert.equal(a.run('savedDiagnostic().session.answers.length'),2);
 assert.equal(a.run('savedDiagnostic().session.answers.find(answer=>answer.questionId===savedDiagnostic().session.entries[0].questionId).answer'),'E');
 const b=restoreDiagnostic(a);
 b.run('activeView="diagnostico";renderPage();handleDiagnosticAction("resume")');
 assert.equal(b.run('diagnosticScreen'),'questions');assert.equal(b.run('savedDiagnostic().index'),1);
 assert.equal(b.run('JSON.stringify(savedDiagnostic().session.entries)'),entries);
 assert.equal(b.run('savedDiagnostic().session.answers.find(answer=>answer.questionId===savedDiagnostic().session.entries[1].questionId).answer'),null);
 assert.match(b.nodes.get('#app').innerHTML,/data-diag-answer="blank"[^>]*aria-pressed="true"/);
 b.run('activeView="edital";renderPage();activeView="diagnostico";renderPage()');
 assert.equal(b.run('savedDiagnostic().index'),1);assert.equal(b.run('savedDiagnostic().session.answers.length'),2);
});

test('diagnostic completion and review do not modify lesson, practice or XP progress',()=>{
 const a=harness({xp:130,todayXp:30,streak:4,completed:['etica-1'],answered:['cgu26-autoral-etica-1'],missed:['cgu26-autoral-etica-2'],favorites:['cgu26-autoral-etica-3']});
 const before=a.run('JSON.stringify(state)');const persisted=a.store.get('concursos-cgu-progress-v1');
 openDiagnostic(a);
 completeDiagnostic(a,'catalog.questions.find(q=>q.id===savedDiagnostic().session.entries[savedDiagnostic().index].questionId).correctAlternative');
 assert.equal(a.run('diagnosticScreen'),'result');
 assert.equal(a.run('JSON.stringify(state)'),before);
 assert.equal(a.store.get('concursos-cgu-progress-v1'),persisted);
 assert.equal(a.run('state.attempts.length'),0);assert.equal(a.run('quiz'),null);
 assert.ok(a.store.has('concursos-diagnostic-v1'));
 assert.equal(JSON.parse(a.store.get('fisio-progress-v1')).xp,999);
});

test('diagnostic finalization requires an explicit response or Não sei for every question',()=>{
 const a=harness();openDiagnostic(a);
 a.run('answerDiagnostic("C");savedDiagnostic().index=39;handleDiagnosticAction("next")');
 assert.equal(a.run('diagnosticScreen'),'submit');
 assert.match(a.nodes.get('#app').innerHTML,/39 questões ainda pendentes/);
 assert.match(a.nodes.get('#app').innerHTML,/data-diag-action="finish" disabled/);
 a.run('handleDiagnosticAction("finish")');
 assert.equal(a.run('savedDiagnostic().completedAt'),null);assert.equal(a.run('diagnosticScreen'),'submit');
 assert.doesNotMatch(a.nodes.get('#app').innerHTML,/class="explanation"|class="diagnostic-table"/);
 a.run('handleDiagnosticAction("result")');assert.notEqual(a.run('diagnosticScreen'),'result');
});

test('diagnostic result ranks performance, reveals unique labelled explanations and survives reload',()=>{
 const a=harness();openDiagnostic(a);
 completeDiagnostic(a,'savedDiagnostic().session.entries[savedDiagnostic().index].courseId==="desenvolvimento" ? catalog.questions.find(q=>q.id===savedDiagnostic().session.entries[savedDiagnostic().index].questionId).correctAlternative : "blank"');
 const html=a.nodes.get('#app').innerHTML;
 const result=a.run('scoreDiagnosticSession(catalog,savedDiagnostic().session)');
 assert.equal(result.recommendation.status,'recommended');assert.deepEqual(result.recommendation.courseIds,['desenvolvimento']);
 assert.match(html,/Seu melhor resultado: TI — Desenvolvimento de Sistemas/);
 assert.match(html,/<tbody><tr><th scope="row">TI — Desenvolvimento de Sistemas<\/th><td>10\/10<\/td>/);
 assert.equal((html.match(/class="explanation"/g)||[]).length,40);
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
 assert.equal(new Set(ids).size,ids.length,'review headings must not repeat element IDs');
 assert.equal(ids.filter(id=>id.startsWith('diagnostic-explanation-')).length,40);
 for(const id of ids.filter(id=>id.startsWith('diagnostic-explanation-'))) assert.ok(html.includes(`aria-labelledby="${id}"`));
 assert.match(html,/não uma probabilidade de aprovação/);assert.match(html,/dificuldade não calibrada/);
 const entry=a.run('JSON.stringify(savedDiagnostic())');
 a.run('answerDiagnostic("E");handleDiagnosticAction("previous");handleDiagnosticAction("finish")');
 assert.equal(a.run('JSON.stringify(savedDiagnostic())'),entry,'completed responses remain immutable');
 const b=restoreDiagnostic(a);b.run('activeView="diagnostico";renderPage();handleDiagnosticAction("result")');
 assert.equal(b.run('diagnosticScreen'),'result');assert.match(b.nodes.get('#app').innerHTML,/Seu melhor resultado: TI — Desenvolvimento de Sistemas/);
});

test('all unknown answers produce an inconclusive result rather than an arbitrary recommendation',()=>{
 const a=harness();openDiagnostic(a);completeDiagnostic(a,'"blank"');
 const html=a.nodes.get('#app').innerHTML;
 assert.match(html,/Resultado inconclusivo/);assert.doesNotMatch(html,/Seu melhor resultado:|Seu resultado aponta um empate/);
 const result=a.run('scoreDiagnosticSession(catalog,savedDiagnostic().session)');
 assert.equal(result.recommendation.status,'insufficient');assert.deepEqual(result.recommendation.courseIds,[]);
 assert.ok(result.courses.every(course=>course.blank===10&&course.netScore===0));
 const hero=html.match(/<section class="diagnostic-result-hero">([\s\S]*?)<\/section>/)[1];
 assert.doesNotMatch(hero,/data-diag-study/);
});

test('equal positive performances remain tied and offer all leading tracks',()=>{
 const a=harness();openDiagnostic(a);
 completeDiagnostic(a,'catalog.questions.find(q=>q.id===savedDiagnostic().session.entries[savedDiagnostic().index].questionId).correctAlternative');
 const result=a.run('scoreDiagnosticSession(catalog,savedDiagnostic().session)');
 assert.equal(result.recommendation.status,'tie');assert.equal(result.recommendation.courseIds.length,4);
 const html=a.nodes.get('#app').innerHTML;
 assert.match(html,/Seu resultado aponta um empate/);assert.doesNotMatch(html,/Seu melhor resultado:/);
 const hero=html.match(/<section class="diagnostic-result-hero">([\s\S]*?)<\/section>/)[1];
 for(const courseId of result.recommendation.courseIds) assert.ok(hero.includes(`data-diag-study="${courseId}"`));
});

test('Câmara diagnostic is unavailable and switching notices preserves the CGU session',()=>{
 const a=harness();openDiagnostic(a);a.run('answerDiagnostic("C");handleDiagnosticAction("next");handleDiagnosticAction("pause")');
 const original=a.run('JSON.stringify(savedDiagnostic())');
 a.dispatch('change',{target:{id:'diagnostic-exam',value:'camara-2026',dataset:{}}});
 assert.equal(a.run('diagnosticExamId'),'camara-2026');assert.equal(a.run('savedDiagnostic()'),null);
 const html=a.nodes.get('#app').innerHTML;
 assert.match(html,/Diagnóstico indisponível para Câmara/);assert.doesNotMatch(html,/data-diag-action="start"|class="diagnostic-table"/);
 assert.match(html,/href="\/data\/edital-camara\.pdf"/);assert.doesNotMatch(html,/href="\/data\/edital-cgu-2026\.pdf"/);
 a.run('startDiagnostic()');assert.equal(a.run('diagnosticStore.sessions["camara-2026"]'),undefined);
 a.dispatch('change',{target:{id:'diagnostic-exam',value:'cgu-2026',dataset:{}}});
 assert.equal(a.run('JSON.stringify(savedDiagnostic())'),original);assert.match(a.nodes.get('#app').innerHTML,/Retomar simulado/);
 a.dispatch('change',{target:{id:'diagnostic-exam',value:'untrusted-exam',dataset:{}}});
 assert.equal(a.run('diagnosticExamId'),'cgu-2026');
});

test('old Sobre links open the diagnostic and retain installation and content information',()=>{
 const a=harness();
 a.run('window.pwaRefreshes=0;window.concursosPwa={refresh(){window.pwaRefreshes++}};activeView="sobre";renderPage()');
 assert.equal(a.run('activeView'),'diagnostico');assert.equal(a.run('lastReplacedUrl'),'#diagnostico');
 assert.equal(a.run('window.pwaRefreshes'),1);
 const html=a.nodes.get('#app').innerHTML;
 assert.match(html,/Instalar aplicativo e informações do projeto/);
 for(const name of ['install','status','instructions','offline']) assert.ok(html.includes(`data-pwa-${name}`));
 assert.match(html,/Origem do conteúdo/);assert.match(html,/Adicione o Concursos/);assert.match(html,/não há sincronização/);
});

test('course selection keeps the diagnostic view and changes the relevant exam',async()=>{
 const a=harness();openDiagnostic(a);a.run('answerDiagnostic("E");handleDiagnosticAction("pause")');
 const original=a.run('JSON.stringify(savedDiagnostic())');
 await a.run('selectCourse("camara-jornalismo")');
 assert.equal(a.run('activeView'),'diagnostico');assert.equal(a.run('diagnosticExamId'),'camara-2026');
 assert.match(a.nodes.get('#app').innerHTML,/Diagnóstico indisponível/);
 await a.run('selectCourse("infra")');
 assert.equal(a.run('activeView'),'diagnostico');assert.equal(a.run('diagnosticExamId'),'cgu-2026');
 assert.equal(a.run('JSON.stringify(savedDiagnostic())'),original);
});

test('malformed and outdated diagnostic sessions recover without losing study progress',()=>{
 for(const saved of ['{broken',{}, {version:1,sessions:[]}, {version:99,sessions:{}}]) {
  const a=harness({xp:70},catalog,'',undefined,saved);
  a.run('activeView="diagnostico";renderPage()');
  assert.equal(a.run('state.xp'),70);assert.equal(a.run('savedDiagnostic()'),null);
  assert.match(a.nodes.get('#app').innerHTML,/Iniciar simulado/);
 }
 const original=harness({xp:90});openDiagnostic(original);original.run('answerDiagnostic("C");handleDiagnosticAction("next")');
 const missingId=original.run('savedDiagnostic().session.entries[0].questionId');
 const updated=structuredClone(catalog);updated.questions=updated.questions.filter(q=>q.id!==missingId);
 const recovered=restoreDiagnostic(original,updated);
 recovered.run('activeView="diagnostico";diagnosticScreen="questions";renderPage()');
 assert.equal(recovered.run('savedDiagnostic()'),null);assert.equal(recovered.run('diagnosticScreen'),'home');
 assert.match(recovered.nodes.get('#app').innerHTML,/tentativa salva mudaram/);assert.equal(recovered.run('state.xp'),90);
 recovered.run('startDiagnostic()');assert.equal(recovered.run('savedDiagnostic().session.entries.length'),40);
 assert.equal(recovered.run(`savedDiagnostic().session.entries.some(item=>item.questionId===${JSON.stringify(missingId)})`),false);
 const invalidAnswer=JSON.parse(original.store.get('concursos-diagnostic-v1'));
 invalidAnswer.sessions['cgu-2026'].session.answers[0].answer='invalid';
 const damaged=harness(undefined,catalog,'',undefined,invalidAnswer);damaged.run('activeView="diagnostico";renderPage()');
 assert.equal(damaged.run('savedDiagnostic()'),null);assert.equal(damaged.run('diagnosticScreen'),'home');
});
for(const correct of [true,false])test(`C/E correction reveals justification and records once: ${correct}`,()=>{
 const a=harness();a.run('startLesson(lessons[0].id)');assert.ok(!a.nodes.get('#lesson-modal').innerHTML.includes('class="explanation"'));
 a.run(correct?'selectAnswer(quiz.questions[0].correctAlternative)':'selectAnswer(quiz.questions[0].correctAlternative==="C"?"E":"C")');a.run('checkAnswer();checkAnswer()');
 assert.equal(a.run('state.attempts.length'),1);assert.equal(a.run('state.attempts[0].correct'),correct);
 assert.equal(a.run('state.attempts[0].points'),correct?1:-1);assert.ok(a.nodes.get('#lesson-modal').innerHTML.includes('Por que o item é'));assert.ok(a.nodes.get('#lesson-modal').innerHTML.includes('Referência:'));
});
test('specific items use weight 2, while XP remains separate',()=>{
 const a=harness();a.run('startLesson(lessons.find(l=>l.module.block==="P3").id);selectAnswer(quiz.questions[0].correctAlternative);checkAnswer()');
 assert.equal(a.run('state.attempts[0].points'),2);assert.equal(a.run('state.xp'),10);
 a.run('nextQuestion();selectAnswer(quiz.questions[1].correctAlternative==="C"?"E":"C");checkAnswer()');
 assert.equal(a.run('performanceMetrics(state.attempts).points'),0);
});
test('fourth error stops the lesson and restart renews chances',()=>{
 const a=harness();a.run('startLesson(lessons[0].id)');
 for(let i=0;i<4;i++)a.run('selectAnswer(quiz.questions[quiz.index].correctAlternative==="C"?"E":"C");checkAnswer();nextQuestion()');
 assert.equal(a.run('quiz.passed'),false);assert.equal(a.run('state.completed.length'),0);a.run('restartLesson()');assert.equal(a.run('quiz.errors'),0);assert.equal(a.run('quiz.index'),0);
});
test('practice filters intersect and answered items exhaust the unanswered pool',()=>{
 const a=harness();a.run('state.practiceFilters[data.id]={...defaultPracticeFilters(),block:"P1",module:"etica",status:"unanswered"};startPractice()');
 assert.equal(a.run('quiz.questions[0].moduleId'),'etica');
 for(let i=0;i<5;i++)a.run('selectAnswer(quiz.questions[quiz.index].correctAlternative);checkAnswer();nextQuestion()');
 assert.equal(a.run('quiz.ended'),true);assert.equal(a.run('new Set(state.attempts.map(a=>a.questionId)).size'),5);
 a.run('closeQuiz();state.practiceFilters[data.id]={...defaultPracticeFilters(),block:"P3",module:"etica"};');assert.equal(a.run('filteredPracticeQuestions().length'),0);
});
test('practice is unlimited; skipping records neither attempt nor points',()=>{
 const a=harness();a.run('startPractice();skipPracticeQuestion()');assert.equal(a.run('state.attempts.length'),0);assert.equal(a.run('quiz.skipped'),1);
 for(let i=0;i<6;i++)a.run('selectAnswer(quiz.questions[quiz.index].correctAlternative==="C"?"E":"C");checkAnswer();nextQuestion()');
 assert.equal(a.run('quiz.answeredCount'),6);assert.ok(!a.run('quiz.ended'));
});
test('common question history is shared; specific questions do not leak between tracks',()=>{
 const a=harness();a.run('startLesson(lessons[0].id);selectAnswer(quiz.questions[0].correctAlternative);checkAnswer();closeQuiz();setCourse("dados")');
 assert.equal(a.run('courseAttempts().length'),1);assert.equal(a.run('data.questions.some(q=>q.track==="auditoria")'),false);
});
test('all views render across all tracks; syllabus checklist survives persistence',()=>{
 const a=harness();
 for(const c of catalog.courses.filter(c=>!c.practiceOnly)){a.run(`setCourse(${JSON.stringify(c.id)})`);for(const view of ['aprender','edital','praticar','desempenho','conquistas','sobre']){a.run(`activeView=${JSON.stringify(view)};renderPage()`);assert.ok(!a.nodes.get('#app').innerHTML.includes('NaN'));}}
 a.run('state.syllabusRead=["etica"];saveState()');const b=harness(JSON.parse(a.store.get('concursos-cgu-progress-v1')));assert.equal(b.run('state.syllabusRead[0]'),'etica');
});
test('an empty bank has a useful study view and no false completion',()=>{
 const empty=structuredClone(catalog);empty.questions=[];empty.courses=empty.courses.map(c=>({...c,total:0,questionIds:[]}));
 const a=harness(null,empty);a.run('renderPage()');const html=a.nodes.get('#app').innerHTML;
 assert.ok(html.includes('Questões em preparação'));assert.ok(!html.includes('NaN'));assert.ok(!html.includes('✓ Concluído'));a.run('startPractice()');assert.equal(a.run('quiz'),null);
});


test('Development is the initial track, with P3 selected, while saved choices survive',()=>{
 const fresh=harness();assert.equal(fresh.run('data.id'),'desenvolvimento');assert.equal(fresh.run('selectedStudyModule().id'),'dev-engenharia');assert.equal(fresh.run('state.studyBlocks.desenvolvimento'),'P3');
 const saved=harness({activeCourse:'auditoria',xp:200,completed:['etica-1']});assert.equal(saved.run('data.id'),'auditoria');assert.equal(saved.run('state.xp'),200);
 const chosen=harness({activeCourse:'desenvolvimento',studyUnits:{desenvolvimento:'etica'},studyBlocks:{desenvolvimento:'P3'}});assert.equal(chosen.run('selectedStudyModule().id'),'etica');assert.equal(chosen.run('state.studyBlocks.desenvolvimento'),'P1');
});
test('an explicit specialty link selects Development once, preserving progress and other URL parameters',()=>{
 const a=harness({activeCourse:'auditoria',xp:200,completed:['etica-1']},catalog,'?especialidade=desenvolvimento&origem=link');
 a.run('setCourse(initialCourseId())');assert.equal(a.run('data.id'),'desenvolvimento');assert.equal(a.run('state.xp'),200);assert.ok(a.run('state.completed.includes("etica-1")'));assert.equal(a.run('lastReplacedUrl'),'/concursos-cgu/?origem=link#aprender');
 a.run('setCourse("infra");setCourse(initialCourseId())');assert.equal(a.run('data.id'),'infra');
 const invalid=harness({activeCourse:'dados'},catalog,'?especialidade=unknown');assert.equal(invalid.run('initialCourseId()'),'dados');
});

function camaraTracks() {
 const tracks=catalog.courses.filter(c=>c.examId==='camara-2026');
 assert.equal(tracks.length,11,'the uploaded notice must expose all eleven positions');
 return tracks;
}

function withoutSelectors(html) { return html.replace(/<select\b[^>]*>[\s\S]*?<\/select>/g,''); }

test('multiple notices preserve the CGU catalog and add eleven Câmara syllabus tracks without invented questions',()=>{
 assert.ok(Array.isArray(catalog.exams));
 assert.equal(new Set(catalog.exams.map(exam=>exam.id)).size,catalog.exams.length);
 assert.ok(catalog.exams.some(exam=>exam.id==='cgu-2026'));
 assert.ok(catalog.exams.some(exam=>exam.id==='camara-2026'));
 assert.equal(catalog.exam.id,'cgu-2026');
 const cguIds=new Set(catalog.courses.filter(c=>c.examId==='cgu-2026').flatMap(c=>c.modules.map(m=>m.id)));
 const ids=new Set();
 for(const course of camaraTracks()){
  assert.ok(course.id.startsWith('camara-'),course.id);
  assert.ok(!ids.has(course.id));ids.add(course.id);
  assert.equal(course.syllabusOnly,true,course.id);
  assert.equal(course.total,0,course.id);
  assert.deepEqual(course.questionIds,[],course.id);
  assert.ok(course.modules.length>0,course.id);
  for(const module of course.modules){
   assert.ok(module.id.startsWith('camara-'),module.id);
   assert.ok(!cguIds.has(module.id),module.id);
   assert.ok(typeof module.syllabusText==='string'&&module.syllabusText.trim().length>0,module.id);
  }
 }
 assert.equal(catalog.questions.filter(q=>q.examId==='camara-2026'||q.moduleId?.startsWith('camara-')).length,0);
 assert.equal(catalog.questions.filter(q=>q.origin==='autoral').length,130);
});

test('all Câmara views render with their own notice and no empty lessons or fabricated performance',()=>{
 const a=harness();
 for(const course of camaraTracks()){
  a.run(`setCourse(${JSON.stringify(course.id)})`);
  assert.equal(a.run('currentExam().id'),'camara-2026',course.id);
  assert.equal(a.run('lessons.length'),0,course.id);
  assert.equal(a.run('data.questions.length'),0,course.id);
  for(const view of ['aprender','edital','praticar','desempenho','conquistas','sobre']){
   a.run(`activeView=${JSON.stringify(view)};renderPage()`);
   for(const selector of ['#app','#right-rail']){
    const html=a.nodes.get(selector).innerHTML;
    assert.ok(html.length>0,`${course.id}/${view}/${selector}`);
    assert.doesNotMatch(html,/\b(?:NaN|undefined)\b/,`${course.id}/${view}/${selector}`);
   }
  }
  a.run('startPractice()');assert.equal(a.run('quiz'),null,course.id);
  assert.equal(a.run('courseAttempts().length'),0,course.id);
 }
 assert.equal(a.run('state.xp'),0);
 assert.equal(a.run('state.completed.length'),0);
 assert.equal(a.run('state.attempts.length'),0);
});

test('Câmara notice, practice, performance and rail do not inherit CGU dates, sources or scoring',()=>{
 const a=harness();
 for(const course of camaraTracks()){
  a.run(`setCourse(${JSON.stringify(course.id)});activeView='edital';renderPage()`);
  const html=withoutSelectors(a.nodes.get('#app').innerHTML);
  const rail=a.nodes.get('#right-rail').innerHTML;
  for(const content of [html,rail]){
   assert.doesNotMatch(content,/CGU|cgu_26|edital-cgu-2026\.pdf|Auditor Federal de Finanças e Controle/,course.id);
   assert.doesNotMatch(content,/13 dez 2026|10\/10 a 04\/11\/2026|170 itens|260 pontos|Mínimo total nas objetivas: 78/,course.id);
  }
  assert.match(a.run('blockLabel("P2")'),/específicos/i,course.id);
  const secondBlock=a.run('currentExam().blocks.find(block=>block.id==="P2").title');
  assert.match(secondBlock,/específicos/i,course.id);
  assert.ok(html.includes(secondBlock),course.id);
  for(const view of ['praticar','desempenho']){
   a.run(`activeView=${JSON.stringify(view)};renderPage()`);
   const content=withoutSelectors(a.nodes.get('#app').innerHTML);
   assert.doesNotMatch(content,/P1\/P2: \+1|\+2 em P3|P3: \+2|erro desconta o mesmo valor/,`${course.id}/${view}`);
  }
 }
});

test('Câmara checklist persists independently of CGU lessons and grants neither XP nor question credit',()=>{
 const course=camaraTracks()[0],moduleId=course.modules[0].id;
 const original={xp:120,todayXp:20,completed:['etica-1'],introductionsRead:['etica'],syllabusRead:['etica'],answered:[],attempts:[]};
 const a=harness(original);
 a.run(`setCourse(${JSON.stringify(course.id)});activeView='edital';renderPage()`);
 a.dispatch('change',{target:{dataset:{syllabus:moduleId},checked:true}});
 assert.equal(a.run('state.xp'),120);assert.equal(a.run('state.todayXp'),20);
 assert.equal(a.run('JSON.stringify(state.completed)'),JSON.stringify(['etica-1']));
 assert.equal(a.run('JSON.stringify(state.introductionsRead)'),JSON.stringify(['etica']));
 assert.equal(a.run('state.answered.length'),0);assert.equal(a.run('state.attempts.length'),0);
 assert.ok(a.run(`state.syllabusRead.includes(${JSON.stringify(moduleId)})`));
 const b=harness(JSON.parse(a.store.get('concursos-cgu-progress-v1')));
 assert.equal(b.run('data.id'),course.id);
 assert.ok(b.run(`state.syllabusRead.includes(${JSON.stringify(moduleId)})`));
 assert.ok(b.run('state.syllabusRead.includes("etica")'));
 b.run('setCourse("desenvolvimento")');
 assert.equal(b.run('data.modules.filter(m=>state.syllabusRead.includes(m.id)).length'),1);
 assert.equal(b.run('completedLessons()'),1);
 b.run(`setCourse(${JSON.stringify(course.id)});activeView='edital';renderPage()`);
 b.dispatch('change',{target:{dataset:{syllabus:moduleId},checked:false}});
 assert.equal(b.run('JSON.stringify(state.syllabusRead)'),JSON.stringify(['etica']));
 assert.equal(b.run('state.xp'),120);
});

test('a direct Câmara link selects its position once while preserving CGU progress',()=>{
 const course=camaraTracks()[0];
 const a=harness({activeCourse:'desenvolvimento',completed:['etica-1'],xp:200},catalog,`?especialidade=${encodeURIComponent(course.id)}&origem=link`);
 a.run('setCourse(initialCourseId())');
 assert.equal(a.run('data.id'),course.id);
 assert.equal(a.run('currentExam().id'),'camara-2026');
 assert.equal(a.run('state.activeSyllabusCourse'),course.id);
 assert.equal(a.run('state.xp'),200);
 assert.ok(a.run('state.completed.includes("etica-1")'));
 assert.equal(a.run('lastReplacedUrl'),'/concursos-cgu/?origem=link#aprender');
 a.run('setCourse("dados");setCourse(initialCourseId())');assert.equal(a.run('data.id'),'dados');
});

test('opening the notice from the historical bank returns to the last chosen syllabus, including after reload',()=>{
 const course=camaraTracks()[0],fixture=officialFixture();
 const a=harness(null,fixture);
 a.run(`setCourse(${JSON.stringify(course.id)});setCourse('cebraspe-ti');activeView='praticar';renderPage()`);
 assert.equal(a.run('data.id'),'cebraspe-ti');
 assert.equal(a.run('state.activeSyllabusCourse'),course.id);
 const b=harness(JSON.parse(a.store.get('concursos-cgu-progress-v1')),fixture);
 b.run('activeView="edital";renderPage()');
 assert.equal(b.run('data.id'),course.id);assert.equal(b.run('currentExam().id'),'camara-2026');
 b.run('setCourse("auditoria");setCourse("cebraspe-ti");activeView="edital";renderPage()');
 assert.equal(b.run('data.id'),'auditoria');assert.equal(b.run('currentExam().id'),'cgu-2026');
 for(const invalid of [undefined,'missing-course','cebraspe-ti']){
  const fallback=harness({activeCourse:'cebraspe-ti',activeSyllabusCourse:invalid},fixture);
  fallback.run('activeView="edital";renderPage()');
  assert.equal(fallback.run('data.id'),'desenvolvimento');
 }
});


function officialFixture() {
 const result=structuredClone(catalog);
 result.questions=result.questions.filter(q=>q.origin==='autoral');
 result.courses=result.courses.filter(c=>!c.practiceOnly);
 const base={moduleId:'oficial-ti',moduleTitle:'Conhecimentos de TI',block:null,weight:1,origin:'oficial',context:'Julgue o item a seguir sobre sistemas distribuídos.',alternativesIntroduction:'Julgue o item como certo ou errado.',alternatives:[{letter:'C',text:'Certo'},{letter:'E',text:'Errado'}],correctAlternative:'C',explanation:null,cargo:'Analista de tecnologia',sourceUrl:'https://cdn.cebraspe.org.br/prova.pdf',sourcePage:3,answerKeyUrl:'https://cdn.cebraspe.org.br/gabarito.pdf',answerKeyPage:2,answerKeyStatus:'definitivo',images:[{src:'/assets/questions/oficial/p3.webp',alt:'Prova original · página 3 · item 51',page:3,marker:{left:3,top:20,width:5,height:2}}]};
 const questions=[{...base,id:'oficial-a-51',index:51,examId:'concurso-a',examName:'Órgão A',year:2024},{...base,id:'oficial-b-52',index:52,examId:'concurso-b',examName:'Órgão B',year:2025,correctAlternative:'E'}];
 result.questions.push(...questions);
 result.courses.push({id:'cebraspe-ti',title:'Provas anteriores · Cebraspe TI',practiceOnly:true,questionIds:questions.map(q=>q.id),total:2,modules:[{id:'oficial-ti',title:'Conhecimentos de TI'}]});
 result.officialBank={url:'/data/cebraspe-ti-questions.json?v=concursos-8'};
 return result;
}

test('official practice filters use provenance, year and exam together',()=>{
 const a=harness(null,officialFixture());a.run('setCourse("cebraspe-ti")');
 assert.equal(a.run('filteredPracticeQuestions({...defaultPracticeFilters(),origin:"oficial",year:"2024",exam:"concurso-a",query:"orgao tecnologia"}).length'),1);
 assert.equal(a.run('filteredPracticeQuestions({...defaultPracticeFilters(),year:"2025",exam:"concurso-a"}).length'),0);
 assert.equal(a.run('filteredPracticeQuestions({...defaultPracticeFilters(),origin:"autoral"}).length'),0);
 a.run('renderPractice()');const html=a.nodes.get('#app').innerHTML;
 assert.ok(html.includes('Todos os concursos'));assert.ok(html.includes('Todos os anos'));assert.ok(!html.includes('erro desconta'));
});

test('official questions preserve original page and show sourced key without inventing explanations',()=>{
 const a=harness(null,officialFixture());a.run('setCourse("cebraspe-ti");state.practiceFilters[data.id]={...defaultPracticeFilters(),exam:"concurso-a"};startPractice()');
 let html=a.nodes.get('#lesson-modal').innerHTML;
 assert.ok(html.includes('Responda apenas ao item 51'));assert.ok(html.includes('p3.webp'));assert.ok(html.includes('exam-item-marker'));assert.ok(html.includes('left:3%;top:20%;width:5%;height:2%'));assert.ok(html.includes('Transcrição auxiliar · item 51'));assert.ok(html.includes('prova.pdf#page=3'));assert.ok(!html.includes('gabarito.pdf'));
 a.run('selectAnswer("C");checkAnswer()');html=a.nodes.get('#lesson-modal').innerHTML;
 assert.ok(html.includes('Gabarito oficial · definitivo'));assert.ok(html.includes('gabarito.pdf#page=2'));assert.ok(html.includes('não traz uma justificativa pedagógica'));assert.ok(!html.includes('Por que o item é'));
});

test('official history measures accuracy without CGU penalties and preserves lesson progress',()=>{
 const a=harness({completed:['etica-1'],missed:['oficial-a-51']},officialFixture());
 const initial=a.run('JSON.stringify(lessons.map(l=>l.id))');
 a.run('setCourse("cebraspe-ti");state.practiceFilters[data.id]={...defaultPracticeFilters(),exam:"concurso-a"};startPractice();selectAnswer("E");checkAnswer();nextQuestion();selectAnswer("C");checkAnswer()');
 assert.equal(a.run('lessons.length'),0);assert.equal(a.run('state.attempts[0].points'),0);assert.equal(a.run('state.attempts[1].points'),1);assert.equal(a.run('performanceMetrics(courseAttempts()).accuracy'),50);
 a.run('closeQuiz();renderPerformance()');const html=a.nodes.get('#app').innerHTML;assert.ok(html.includes('Acertos no período'));assert.ok(!html.includes('P1/P2:'));
 a.run('setCourse("desenvolvimento")');assert.equal(a.run('courseAttempts().length'),0);assert.equal(a.run('JSON.stringify(lessons.map(l=>l.id))'),initial);assert.ok(a.run('state.completed.includes("etica-1")'));
});

test('official data loads once on demand and persists its IDs without loading on authored startup',async()=>{
 const complete=officialFixture();const payload={questions:complete.questions.filter(q=>q.origin==='oficial')};
 const metadata=structuredClone(complete);metadata.questions=metadata.questions.filter(q=>q.origin==='autoral');
 const calls=[];const fetchImpl=async url=>{calls.push(url);return {ok:true,json:async()=>structuredClone(url.includes('cebraspe-ti-questions')?payload:metadata)}};
 const a=harness({missed:['oficial-a-51']},metadata,'',fetchImpl);
 await a.run('init()');assert.equal(calls.length,1);assert.ok(a.run('state.missed.includes("oficial-a-51")'));assert.equal(a.run('catalog.questions.length'),130);
 await a.run('ensureCourseData("cebraspe-ti")');await a.run('ensureCourseData("cebraspe-ti")');
 assert.equal(calls.length,2);assert.equal(a.run('catalog.questions.length'),132);
 a.run('setCourse("cebraspe-ti");renderPage()');assert.equal(a.run('activeView'),'praticar');
});

test('a failed or inconsistent official download can be retried without losing authored data',async()=>{
 const complete=officialFixture();const payload={questions:complete.questions.filter(q=>q.origin==='oficial')};
 const metadata=structuredClone(complete);metadata.questions=metadata.questions.filter(q=>q.origin==='autoral');
 let attempts=0;const a=harness(null,metadata,'',async()=>({ok:true,json:async()=>++attempts===1?{questions:[]}:structuredClone(payload)}));
 await assert.rejects(a.run('ensureCourseData("cebraspe-ti")'),/versões diferentes/);assert.equal(a.run('catalog.questions.length'),130);
 await a.run('ensureCourseData("cebraspe-ti")');assert.equal(a.run('catalog.questions.length'),132);
});


test('previous support pages remain available without hiding the numbered item below them',()=>{
 const fixture=officialFixture();const question=fixture.questions.find(q=>q.id==='oficial-a-51');
 question.images.unshift({src:'/assets/questions/oficial/p1.webp',alt:'Texto de apoio da prova',page:1,support:true});
 question.images.push({src:'/assets/questions/oficial/p4.webp',alt:'Continuação do item',page:4});
 const a=harness(null,fixture);a.run('setCourse("cebraspe-ti");state.practiceFilters[data.id]={...defaultPracticeFilters(),exam:"concurso-a"};startPractice()');
 const html=a.nodes.get('#lesson-modal').innerHTML;
 assert.ok(html.indexOf('p3.webp')<html.indexOf('p4.webp'));
 assert.ok(html.indexOf('p4.webp')<html.indexOf('p1.webp'));
 assert.ok(html.includes('<details class="exam-support"><summary>Material de apoio · página 1'));
 assert.ok(html.includes('material de apoio abaixo'));
});


test('official manifest parts load atomically and without duplicate requests',async()=>{
 const full=officialFixture();const questions=full.questions.filter(q=>q.origin==='oficial');const metadata=structuredClone(full);metadata.questions=metadata.questions.filter(q=>q.origin==='autoral');
 const parts=['/data/cebraspe-ti/part-001.json?v=concursos-8','/data/cebraspe-ti/part-002.json?v=concursos-8'];const calls=[];
 const a=harness(null,metadata,'',async url=>{calls.push(url);return {ok:true,json:async()=>url===metadata.officialBank.url?{parts,total:2}:{questions:[questions[parts.indexOf(url)]]}}});
 await Promise.all([a.run('ensureCourseData("cebraspe-ti")'),a.run('ensureCourseData("cebraspe-ti")')]);
 assert.equal(calls.length,3);assert.equal(new Set(calls).size,3);assert.equal(a.run('catalog.questions.length'),132);
});

test('missing official part never imports a partial bank and a retry stays unique',async()=>{
 const full=officialFixture();const questions=full.questions.filter(q=>q.origin==='oficial');const metadata=structuredClone(full);metadata.questions=metadata.questions.filter(q=>q.origin==='autoral');
 const parts=['/data/cebraspe-ti/part-001.json?v=concursos-8','/data/cebraspe-ti/part-002.json?v=concursos-8'];let fails=true;
 const a=harness(null,metadata,'',async url=>({ok:!(fails&&url===parts[1]),json:async()=>url===metadata.officialBank.url?{parts}:{questions:[questions[parts.indexOf(url)]]}}));
 await assert.rejects(a.run('ensureCourseData("cebraspe-ti")'),/parte do banco/);assert.equal(a.run('catalog.questions.length'),130);
 fails=false;await a.run('ensureCourseData("cebraspe-ti")');await a.run('ensureCourseData("cebraspe-ti")');assert.equal(a.run('catalog.questions.length'),132);assert.equal(a.run('new Set(catalog.questions.map(q=>q.id)).size'),132);
});

test('official manifest rejects external paths before fetching a part',async()=>{
 const metadata=officialFixture();metadata.questions=metadata.questions.filter(q=>q.origin==='autoral');const calls=[];
 const a=harness(null,metadata,'',async url=>{calls.push(url);return {ok:true,json:async()=>({parts:['https://example.test/private.json']})}});
 await assert.rejects(a.run('ensureCourseData("cebraspe-ti")'),/arquivos inválidos/);assert.equal(calls.length,1);assert.equal(a.run('catalog.questions.length'),130);
});


test('official filters identify coarse blocks and disambiguate identical exam names',()=>{
 const fixture=officialFixture();for(const q of fixture.questions.filter(q=>q.origin==='oficial')) q.examName='Mesmo órgão';
 const a=harness(null,fixture);a.run('setCourse("cebraspe-ti");renderPractice()');const html=a.nodes.get('#app').innerHTML;
 assert.ok(html.includes('Bloco da prova'));assert.ok(!html.includes('<label>Disciplina'));
 assert.ok(html.includes('Mesmo órgão · concurso-a'));assert.ok(html.includes('Mesmo órgão · concurso-b'));
});

for (const decoded of [false,true]) test(`compressed official parts load correctly with server decoding=${decoded}`,async()=>{
 const fixture=officialFixture(), questions=fixture.questions.filter(q=>q.origin==='oficial');fixture.questions=fixture.questions.filter(q=>q.origin==='autoral');
 const part='/data/cebraspe-ti/part-001.json.gz?v=concursos-8';
 const content=JSON.stringify({questions});
 const a=harness(null,fixture,'',async url=>url===fixture.officialBank.url?{ok:true,json:async()=>({parts:[part]})}:new Response(decoded?content:gzipSync(content)));
 await a.run('ensureCourseData("cebraspe-ti")');
 assert.equal(a.run('catalog.questions.length'),132);
 assert.equal(a.run('catalog.questions.filter(q=>q.origin==="oficial").length'),2);
});

test('a corrupted compressed part remains atomic and can be retried',async()=>{
 const fixture=officialFixture(), questions=fixture.questions.filter(q=>q.origin==='oficial');fixture.questions=fixture.questions.filter(q=>q.origin==='autoral');
 const part='/data/cebraspe-ti/part-001.json.gz?v=concursos-8';let broken=true;
 const a=harness(null,fixture,'',async url=>url===fixture.officialBank.url?{ok:true,json:async()=>({parts:[part]})}:new Response(broken?new Uint8Array([31,139,8,0]):gzipSync(JSON.stringify({questions}))));
 await assert.rejects(a.run('ensureCourseData("cebraspe-ti")'));assert.equal(a.run('catalog.questions.length'),130);
 broken=false;await a.run('ensureCourseData("cebraspe-ti")');assert.equal(a.run('catalog.questions.length'),132);
});
