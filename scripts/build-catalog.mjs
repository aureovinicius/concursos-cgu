import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
const read = async p => JSON.parse(await readFile(p, 'utf8'));
const { exam, tracks, modules: syllabus } = await read('data/syllabus.json');
const content = await Promise.all(['common','auditoria','ti'].map(n => read(`data/${n}-content.json`)));
const lessons = content.flatMap(x => x.modules);
const sourceQuestions = content.flatMap(x => x.questions);
const titles = {
  estado:'Estado, democracia e direitos', sociedade:'Sociedade, diversidade e desenvolvimento', etica:'Ética pública', administracao:'Administração e políticas públicas', governanca:'Governança, riscos e integridade', transparencia:'Transparência e participação social', direito:'Direito público e responsabilização', evidencias:'Evidências, dados e IA', 'auditoria-fundamentos':'Fundamentos de auditoria',
  'aud-governamental':'Auditoria governamental', 'aud-financas':'Finanças, orçamento e contabilidade', 'aud-politicas':'Avaliação de políticas públicas', 'aud-contratacoes':'Contratações e transferências', 'aud-integridade':'Integridade e controle público',
  'dados-estatistica':'Estatística e análise de dados', 'dados-engenharia':'Engenharia e governança de dados', 'dados-ia':'Aprendizado de máquina e IA', 'dados-operacao':'Operação e gestão de dados e IA',
  'infra-redes':'Redes, sistemas e dados', 'infra-nuvem':'Nuvem e automação', 'infra-seguranca':'Cibersegurança e continuidade', 'infra-operacao':'Gestão de serviços digitais',
  'dev-engenharia':'Engenharia de software', 'dev-arquitetura':'Arquitetura e integração', 'dev-dados':'Persistência e proteção de dados', 'dev-seguranca':'Desenvolvimento seguro e entrega',
};
const colors = {P1:['#4166d9','#2e4dad'],P2:['#387e78','#215c57'],P3:['#8863bf','#634296']};
const modules = syllabus.map(m => {
  const authored = lessons.find(c => c.id === m.id);
  if (!authored?.introduction) throw Error(`Missing introduction: ${m.id}`);
  return {...m,...authored,officialTitle:m.title,title:titles[m.id],color:colors[m.block]};
});
const questions = sourceQuestions.map((q,i) => {
  const m = modules.find(m => m.id === q.moduleId);
  if (!m) throw Error(`Unknown module: ${q.moduleId}`);
  const correctAlternative = q.correct ? 'C' : 'E';
  return {id:`cgu26-autoral-${m.id}-${sourceQuestions.slice(0,i+1).filter(x => x.moduleId===m.id).length}`, index:i+1, year:2026, origin:'autoral', format:'certo-errado', examId:'cgu-2026', board:null, moduleId:m.id, moduleTitle:m.title, subjectTitle:m.title, block:m.block, track:m.track, weight:m.block==='P3'?2:1, topic:q.topic, context:q.statement, alternativesIntroduction:'Julgue o item a seguir.', alternatives:[{letter:'C',text:'Certo',isCorrect:q.correct},{letter:'E',text:'Errado',isCorrect:!q.correct}],correctAlternative,explanation:q.explanation,sourceUrl:q.sourceUrl,sourceLabel:q.sourceLabel};
});
const courses = [...tracks].sort((a,b) => Number(b.id === "desenvolvimento") - Number(a.id === "desenvolvimento")).map(t => {
  const selected = modules.filter(m => m.track === 'common' || m.track === t.id);
  const ids = questions.filter(q => selected.some(m => m.id===q.moduleId)).map(q => q.id);
  return {...t,emoji:'✓',recommendedModule:t.id==='desenvolvimento'?'dev-engenharia':null,description:t.id==='desenvolvimento'?'Comece pelos conhecimentos específicos: engenharia de software, arquitetura, dados e desenvolvimento seguro. Intercale com os blocos comuns P1 e P2.':'Do conceito à prática: estude por bloco do edital e consolide cada disciplina em lições curtas.',studyGuide:true,modules:selected,questionIds:ids,total:ids.length};
});
let official;
try { official = await read('data/official-content.json'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (official?.parts) {
  if (!Array.isArray(official.parts) || official.parts.some(p => !/^official-content\/part-\d+\.json$/.test(p))) throw Error('Invalid source bank parts');
  official.questions = (await Promise.all(official.parts.map(p => read(`data/${p}`)))).flatMap(p => p.questions);
}
if (official?.questions?.length) {
  const ids = new Set(questions.map(q => q.id));
  for (const q of official.questions) {
    if (ids.has(q.id)) throw Error(`Duplicate question: ${q.id}`);
    ids.add(q.id);
    if (q.origin !== 'oficial' || q.answerKeyStatus !== 'definitivo' || !q.sourceUrl || !q.answerKeyUrl) throw Error(`Missing official provenance: ${q.id}`);
    if (!q.alternatives.some(a => a.letter === q.correctAlternative) || q.annulled) throw Error(`Invalid official answer: ${q.id}`);
  }
  courses.push({
    id:'cebraspe-ti', title:'Provas anteriores · Cebraspe TI', shortTitle:'Cebraspe TI', emoji:'▤',
    description:'Questões originais de concursos para cargos de TI, com gabarito definitivo e páginas da prova. Pratique por concurso, ano e bloco.',
    practiceOnly:true, studyGuide:false, modules:official.modules,
    questionIds:official.questions.map(q => q.id), total:official.questions.length,
  });
  // Keep each deployable JSON below the static asset limit, and leave the bank
  // out of the initial application download and service-worker precache.
  const directory = 'dist/data/cebraspe-ti';
  await mkdir(directory, {recursive:true});
  const parts = [];
  let batch = [], bytes = 0;
  async function flush() {
    if (!batch.length) return;
    const name = `part-${String(parts.length+1).padStart(3,'0')}.json.gz`;
    await writeFile(`${directory}/${name}`, gzipSync(`{"questions":[${batch.join(',')}]}`+'\n', {level:9}));
    parts.push(`/data/cebraspe-ti/${name}?v=concursos-5`);
    batch = []; bytes = 0;
  }
  for (const q of official.questions) {
    const json = JSON.stringify(q), size = Buffer.byteLength(json)+1;
    if (bytes + size > 4*1024*1024) await flush();
    batch.push(json); bytes += size;
  }
  await flush();
  const names = new Set(parts.map(p => p.split('/').pop().split('?')[0]));
  for (const name of await readdir(directory)) if (/^part-\d+\.json(?:\.gz)?$/.test(name) && !names.has(name)) await unlink(`${directory}/${name}`);
  await writeFile('dist/data/cebraspe-ti-questions.json', JSON.stringify({schemaVersion:1,total:official.questions.length,parts,summary:official.summary})+'\n');
}
const officialCount = official?.questions?.length || 0;
const catalog = {schemaVersion:2,exam,total:questions.length+officialCount,origin:officialCount?'Questões autorais de preparação e questões oficiais de provas anteriores, identificadas pela origem.':'Banco autoral inicial. Não contém itens oficiais de provas anteriores.',courses,questions,
  ...(officialCount ? {officialBank:{url:'/data/cebraspe-ti-questions.json?v=concursos-5',total:officialCount},importSummary:official.summary} : {})};
await writeFile('dist/data/courses.json',JSON.stringify(catalog,null,2)+'\n');
console.log(JSON.stringify({questions:catalog.total,authored:questions.length,official:officialCount,modules:modules.length,tracks:courses.map(c=>({id:c.id,total:c.total}))}));
