import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const catalog = JSON.parse(readFileSync('dist/data/courses.json','utf8'));
const source = readFileSync('dist/app.js','utf8').replace(/\ninit\(\);\s*$/,'');
function harness(saved, customCatalog=catalog, search="", fetchImpl=async()=>{throw new Error("Offline")}) {
 const nodes=new Map();
 const node=()=>({innerHTML:'',hidden:true,dataset:{},setAttribute(){},focus(){},matches(){return false},scrollIntoView(){},scrollTo(){},querySelector(){return node()},classList:{add(){},remove(){}}});
 const store=new Map([['fisio-progress-v1',JSON.stringify({xp:999,completed:['mecanica-1']})]]);
 if(saved) store.set('concursos-cgu-progress-v1',JSON.stringify(saved));
 const ctx=vm.createContext({fetch:fetchImpl,document:{querySelector(s){if(!nodes.has(s))nodes.set(s,node());return nodes.get(s)},querySelectorAll(){return[]},addEventListener(){},body:{style:{}},activeElement:node()},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},location:{hash:'#aprender',search,pathname:'/concursos-cgu/'},window:{addEventListener(){},scrollTo(){}},history:{replaceState(_s,_title,url){ctx.lastReplacedUrl=url;ctx.location.search=new URL(url,"https://example.test").search;}},URLSearchParams,Intl,Date,setTimeout(){},structuredClone});
 vm.runInContext(source,ctx);ctx.input=structuredClone(customCatalog);vm.runInContext('catalog=input;setCourse(state.activeCourse);',ctx);
 return {run:s=>vm.runInContext(s,ctx),nodes,store};
}
test('all four specialities match official syllabus with authored, sourced C/E items',()=>{
 const authored = catalog.questions.filter(q=>q.origin==="autoral");
 const tracks = catalog.courses.filter(c=>!c.practiceOnly);
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


function officialFixture() {
 const result=structuredClone(catalog);
 result.questions=result.questions.filter(q=>q.origin==='autoral');
 result.courses=result.courses.filter(c=>!c.practiceOnly);
 const base={moduleId:'oficial-ti',moduleTitle:'Conhecimentos de TI',block:null,weight:1,origin:'oficial',context:'Julgue o item a seguir sobre sistemas distribuídos.',alternativesIntroduction:'Julgue o item como certo ou errado.',alternatives:[{letter:'C',text:'Certo'},{letter:'E',text:'Errado'}],correctAlternative:'C',explanation:null,cargo:'Analista de tecnologia',sourceUrl:'https://cdn.cebraspe.org.br/prova.pdf',sourcePage:3,answerKeyUrl:'https://cdn.cebraspe.org.br/gabarito.pdf',answerKeyPage:2,answerKeyStatus:'definitivo',images:[{src:'/assets/questions/oficial/p3.webp',alt:'Prova original · página 3 · item 51',page:3,marker:{left:3,top:20,width:5,height:2}}]};
 const questions=[{...base,id:'oficial-a-51',index:51,examId:'concurso-a',examName:'Órgão A',year:2024},{...base,id:'oficial-b-52',index:52,examId:'concurso-b',examName:'Órgão B',year:2025,correctAlternative:'E'}];
 result.questions.push(...questions);
 result.courses.push({id:'cebraspe-ti',title:'Provas anteriores · Cebraspe TI',practiceOnly:true,questionIds:questions.map(q=>q.id),total:2,modules:[{id:'oficial-ti',title:'Conhecimentos de TI'}]});
 result.officialBank={url:'/data/cebraspe-ti-questions.json?v=concursos-4'};
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
 const parts=['/data/cebraspe-ti/part-001.json?v=concursos-4','/data/cebraspe-ti/part-002.json?v=concursos-4'];const calls=[];
 const a=harness(null,metadata,'',async url=>{calls.push(url);return {ok:true,json:async()=>url===metadata.officialBank.url?{parts,total:2}:{questions:[questions[parts.indexOf(url)]]}}});
 await Promise.all([a.run('ensureCourseData("cebraspe-ti")'),a.run('ensureCourseData("cebraspe-ti")')]);
 assert.equal(calls.length,3);assert.equal(new Set(calls).size,3);assert.equal(a.run('catalog.questions.length'),132);
});

test('missing official part never imports a partial bank and a retry stays unique',async()=>{
 const full=officialFixture();const questions=full.questions.filter(q=>q.origin==='oficial');const metadata=structuredClone(full);metadata.questions=metadata.questions.filter(q=>q.origin==='autoral');
 const parts=['/data/cebraspe-ti/part-001.json?v=concursos-4','/data/cebraspe-ti/part-002.json?v=concursos-4'];let fails=true;
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
