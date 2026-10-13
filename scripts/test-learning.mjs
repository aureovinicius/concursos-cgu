import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const catalog = JSON.parse(readFileSync('dist/data/courses.json','utf8'));
const source = readFileSync('dist/app.js','utf8').replace(/\ninit\(\);\s*$/,'');
function harness(saved, customCatalog=catalog) {
 const nodes=new Map();
 const node=()=>({innerHTML:'',hidden:true,dataset:{},setAttribute(){},focus(){},matches(){return false},scrollIntoView(){},scrollTo(){},querySelector(){return node()},classList:{add(){},remove(){}}});
 const store=new Map([['fisio-progress-v1',JSON.stringify({xp:999,completed:['mecanica-1']})]]);
 if(saved) store.set('concursos-cgu-progress-v1',JSON.stringify(saved));
 const ctx=vm.createContext({document:{querySelector(s){if(!nodes.has(s))nodes.set(s,node());return nodes.get(s)},querySelectorAll(){return[]},addEventListener(){},body:{style:{}},activeElement:node()},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},location:{hash:''},window:{addEventListener(){},scrollTo(){}},history:{replaceState(){}},Intl,Date,setTimeout(){},structuredClone});
 vm.runInContext(source,ctx);ctx.input=customCatalog;vm.runInContext('catalog=input;setCourse(state.activeCourse);',ctx);
 return {run:s=>vm.runInContext(s,ctx),nodes,store};
}
test('all four specialities match official syllabus with authored, sourced C/E items',()=>{
 assert.equal(catalog.courses.length,4);assert.equal(catalog.questions.length,130);
 assert.equal(new Set(catalog.questions.map(q=>q.id)).size,130);
 const syllabus=JSON.parse(readFileSync('data/syllabus.json','utf8'));
 assert.equal(syllabus.modules.length,26);
 for(const m of syllabus.modules){assert.equal(catalog.questions.filter(q=>q.moduleId===m.id).length,5,m.id);}
 for(const c of catalog.courses){
  assert.equal(c.total,c.questionIds.length);
  assert.ok(c.modules.every(m=>m.track==='common'||m.track===c.id));
  for(const m of c.modules){assert.ok(m.syllabusText.length>150);assert.equal(m.introduction.sections.length,3);assert.ok(m.introduction.example.steps.length>=2);}
 }
 for(const q of catalog.questions){assert.equal(q.origin,'autoral');assert.equal(q.alternatives.length,2);assert.ok(['C','E'].includes(q.correctAlternative));assert.ok(q.context.length>45);assert.ok(q.explanation.steps.length>=2);assert.ok(q.sourceUrl.startsWith('https://'));assert.equal(q.weight,q.block==='P3'?2:1);}
});
test('fork isolates ENEM progress, and persists its own progress',()=>{
 const a=harness();assert.equal(a.run('state.xp'),0);a.run('state.xp=20;saveState()');
 assert.equal(JSON.parse(a.store.get('fisio-progress-v1')).xp,999);
 assert.equal(harness(JSON.parse(a.store.get('concursos-cgu-progress-v1'))).run('state.xp'),20);
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
 for(const c of catalog.courses){a.run(`setCourse(${JSON.stringify(c.id)})`);for(const view of ['aprender','edital','praticar','desempenho','conquistas','sobre']){a.run(`activeView=${JSON.stringify(view)};renderPage()`);assert.ok(!a.nodes.get('#app').innerHTML.includes('NaN'));}}
 a.run('state.syllabusRead=["etica"];saveState()');const b=harness(JSON.parse(a.store.get('concursos-cgu-progress-v1')));assert.equal(b.run('state.syllabusRead[0]'),'etica');
});
test('an empty bank has a useful study view and no false completion',()=>{
 const empty=structuredClone(catalog);empty.questions=[];empty.courses=empty.courses.map(c=>({...c,total:0,questionIds:[]}));
 const a=harness(null,empty);a.run('renderPage()');const html=a.nodes.get('#app').innerHTML;
 assert.ok(html.includes('Questões em preparação'));assert.ok(!html.includes('NaN'));assert.ok(!html.includes('✓ Concluído'));a.run('startPractice()');assert.equal(a.run('quiz'),null);
});
