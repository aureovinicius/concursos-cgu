#!/usr/bin/env python3
"""Join extracted PDF items to exact definitive keys and build the study bank.

PDF pages, not imperfect text extraction, are the canonical question rendering.
Run after key_extract.py, pair_keys.py and exam_extract.py. No model or external
question API is called. Raw downloads and intermediate results remain local.
"""
import argparse
import collections
import concurrent.futures
import hashlib
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path):
    return json.loads(Path(path).read_text())


def normalized(text):
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFKD', str(text)).encode('ascii', 'ignore').decode().lower()).strip()


def paper_family(paper):
    code = paper['matchedCode']['raw']
    if paper['matchedCode'].get('matrix'):
        return code.upper()
    code = re.sub(r'_(?:ADAPTADA|LEDOR|SUPER.*)$', '', code, flags=re.I)
    # A final edition suffix is removed only for choosing one accessible edition;
    # the actual answer join has already used its complete, unmodified code.
    return re.sub(r'[_-]0\d{1,2}$', '', code.upper())


def rank_paper(paper, extracted):
    label = normalized(paper['description'] + ' ' + paper['file'])
    accessible = bool(re.search(r'ledor|ampliad|adaptad|brail|libras|super', label))
    return (not accessible, len(extracted.get('questions', [])), len(paper.get('answers', {})))


def module_for(paper, question):
    label = normalized(question.get('sectionTitle') or paper['description'])
    if re.search(r'conhecimentos\s+(basicos|gerais)', label):
        return 'cebraspe-basicos', 'Conhecimentos básicos e gerais'
    if re.search(r'conhecimentos\s+(especificos|complementares)', label):
        return 'cebraspe-especificos', 'Conhecimentos específicos'
    return 'cebraspe-mistos', 'Provas completas e blocos mistos'


def render_document(task):
    import pymupdf
    from PIL import Image
    archive, record, pages, assets, width = task
    outputs = []
    with pymupdf.open(Path(archive) / record['file']) as doc:
        for pn in sorted(pages):
            filename = f"{record['sha256'][:20]}-p{pn}.webp"
            path = Path(assets) / filename
            valid = False
            if path.exists():
                with Image.open(path) as existing:
                    valid = existing.width == width
            if not valid:
                page = doc[pn - 1]
                pix = page.get_pixmap(matrix=pymupdf.Matrix(width / page.rect.width, width / page.rect.width), alpha=False)
                pix.pil_save(str(path), format='WEBP', lossless=True, method=4)
            outputs.append({'file':filename,'sourceFile':record['file'],'page':pn,'bytes':path.stat().st_size})
    return outputs


def build(args):
    archive = Path(args.archive)
    work = Path(args.work)
    extraction = Path(args.extracted)
    archive_rows = read(archive / 'catalogue.json')['files']
    documents = {r['file']:r for r in archive_rows if r.get('localExists')}
    pairing = read(work / 'pairingmanifest.json')
    key_blocks = read(work / 'answerkeys.json')['keyBlocks']
    report = {'schemaVersion':1,'createdAt':'2026-10-13','policy':{
        'answers':'Exact full booklet code and event; explicit definitive keys only.',
        'visual':'Original PDF pages are canonical; extracted text is an auxiliary transcription.',
        'scope':'Historical practice bank, without inferred alignment to the CGU syllabus.',
        'annulled':'Excluded from practice.',
        'editions':'One preferred edition per booklet family; its own exact key is used.',
    },'papers':[],'excludedItems':[],'deduplicatedEditions':[]}
    families = collections.defaultdict(list)
    for p in pairing['papers']:
        record = documents[p['file']]
        xfile = extraction / (record['sha256'] + '.json')
        x = read(xfile) if xfile.exists() else {'questions':[],'reason':'extraction-unavailable'}
        reason = None
        if record['kind'] == 'prova_objetiva_com_gabarito':
            reason = 'booklet-contains-answer-key'
        elif p.get('conflicts'):
            reason = 'conflicting-definitive-key-identity'
        elif not p.get('answers'):
            reason = 'no-unambiguous-definitive-key'
        elif not x.get('questions'):
            reason = x.get('reason', 'no-confident-question-markers')
        else:
            key_codes = {c['normalized'] for i in p.get('keyBlockIndices', []) for c in key_blocks[i].get('codes', [])}
            matches = {c['normalized']:c for c in p.get('codes', []) if c['normalized'] in key_codes}
            if len(matches) != 1:
                reason = 'ambiguous-matched-booklet-code'
            else:
                p['matchedCode'] = next(iter(matches.values()))
        if reason:
            report['papers'].append({'file':p['file'],'event':p['event'],'status':'excluded','reason':reason})
            continue
        families[(p['event'].upper(), paper_family(p))].append((p,x,record))

    selected = []
    for candidates in families.values():
        ordered = sorted(candidates, key=lambda v:rank_paper(v[0],v[1]), reverse=True)
        selected.append(ordered[0])
        for p,x,r in ordered[1:]:
            report['deduplicatedEditions'].append({'file':p['file'],'preferred':ordered[0][0]['file'],'reason':'alternate-booklet-edition'})
            report['papers'].append({'file':p['file'],'event':p['event'],'status':'excluded','reason':'alternate-booklet-edition'})

    questions = []
    pages_by_file = collections.defaultdict(set)
    used_modules = {}
    seen = set()
    for paper, extracted, record in sorted(selected,key=lambda item:item[0]['file']):
        before = len(questions)
        unsafe_pages = extracted.get('unsafePages', {})
        unsafe = {int(v) if isinstance(unsafe_pages, dict) else int(v['page']) for v in unsafe_pages}
        for item in extracted['questions']:
            num = str(item['number'])
            answer = paper['answers'].get(num)
            source = paper.get('answerSources', {}).get(num)
            reason = None
            if not answer or not source:
                reason = 'missing-or-conflicting-definitive-answer'
            elif answer == 'X':
                reason = 'annulled'
            elif item['type'] == 'ce' and answer not in ('C','E'):
                reason = 'question-format-answer-mismatch'
            elif item['type'] == 'multiple' and (not item.get('alternatives') or answer not in [a['letter'] for a in item['alternatives']]):
                reason = 'incomplete-choice-identification'
            elif any(p in unsafe for p in item['sourcePages']):
                reason = 'source-pages-include-answer-key-or-discursive'
            elif any('alternatives' in w for w in item.get('qualityWarnings', [])):
                reason = 'incomplete-choice-identification'
            if reason:
                report['excludedItems'].append({'file':paper['file'],'number':item['number'],'reason':reason})
                continue
            identity = paper['event'].upper() + '|' + paper_family(paper) + '|' + num
            qid = 'cebraspe-' + hashlib.sha256(identity.encode()).hexdigest()[:24]
            if qid in seen:
                raise ValueError('Duplicate official item identity: ' + identity)
            seen.add(qid)
            module_id, title = module_for(paper, item)
            used_modules[module_id] = title
            source_pages = sorted(set(item['sourcePages']))
            images = []
            for pn in sorted(source_pages, key=lambda pn:(pn < item['page'], pn)):
                im = {'src':f"/assets/questions/cebraspe/{record['sha256'][:20]}-p{pn}.webp",'alt':f"Prova original, página {pn}. Responda ao item {num}.",'page':pn,'support':pn < item['page']}
                if pn == item['page']:
                    w,h = item['pageDimensions']['width'],item['pageDimensions']['height']
                    x0,y0,x1,y1 = item['bbox']
                    im['marker'] = {'left':round(max(0,x0-3)/w*100,3),'top':round(max(0,y0-3)/h*100,3),'width':round((x1-x0+6)/w*100,3),'height':round((y1-y0+6)/h*100,3)}
                images.append(im)
            date = source.get('applicationDate') or paper.get('applicationDate') or ''
            year_match = re.search(r'/(\d{2}|\d{4})$', date)
            # If the application date is unavailable, mark the fallback year as
            # the event identifier's year rather than claiming an application date.
            event_year = re.findall(r'(20\d{2}|19\d{2})',paper['event'])
            short_year = re.search(r'[_-](\d{2})(?:_|$)',paper['event'])
            if year_match:
                year = int(year_match[1])
                if year < 100: year += 1900 if year > 70 else 2000
            else:
                year = int(event_year[-1]) if event_year else 2000+int(short_year[1]) if short_year else None
            roles = record.get('tiRoles', [])
            # Legacy string entries are OCR search evidence, sometimes joining
            # several unrelated cargos. Only structured titles are displayed.
            role_titles = [r.get('title','') for r in roles if isinstance(r,dict)]
            body = item.get('text','').strip()
            alternatives = [{'letter':'C','text':'Certo'},{'letter':'E','text':'Errado'}] if item['type']=='ce' else [{'letter':a['letter'],'text':'Alternativa '+a['letter']} for a in item['alternatives']]
            for a in alternatives:
                a['isCorrect'] = a['letter'] == answer
            questions.append({
                'id':qid,'index':item['number'],'year':year,'yearBasis':'application' if year_match else 'event',
                'origin':'oficial','board':'Cebraspe / Cespe','format':'certo-errado' if item['type']=='ce' else 'multipla-escolha',
                'examId':paper['event'],'examName':record.get('eventName') or paper['event'],
                'cargo':'; '.join(role_titles),'paperTitle':paper['description'],'paperCode':paper['matchedCode']['raw'],
                'moduleId':module_id,'moduleTitle':title,'subjectTitle':title,'track':'cebraspe-ti','block':None,'weight':1,
                'topic':paper['description'],'context':body[:12000],
                'transcriptionTruncated':len(body)>12000,'visualRequired':True,'images':images,
                'alternativesIntroduction':f'Responda apenas ao item {num} da prova original.',
                'alternatives':alternatives,'correctAlternative':answer,'annulled':False,'explanation':None,
                'sourceUrl':record['url'],'sourceLabel':'Caderno original da banca','sourcePage':item['page'],'sourcePages':source_pages,
                'answerKeyUrl':source['url'],'answerKeyPage':source['page'],'answerKeyStatus':'definitivo',
                'sourceSha256':record['sha256'],'answerKeySha256':documents[source['file']]['sha256'],
            })
            pages_by_file[paper['file']].update(source_pages)
        report['papers'].append({'file':paper['file'],'event':paper['event'],'url':record['url'],'status':'imported' if len(questions)>before else 'excluded','importedQuestions':len(questions)-before,'detectedQuestions':len(extracted['questions']),'reason':None if len(questions)>before else 'no-eligible-items'})

    summary = {'importedQuestions':len(questions),'examDocuments':len(pages_by_file),'events':len({q['examId'].upper() for q in questions}),'sourcePages':sum(map(len,pages_by_file.values())),
        'excludedAnnulled':sum(x['reason']=='annulled' for x in report['excludedItems']),
        'excludedItems':len(report['excludedItems']),'excludedPapers':sum(x['status']=='excluded' for x in report['papers']),
        'deduplicatedEditions':len(report['deduplicatedEditions']),'examDocumentsExamined':len(pairing['papers']),
        'hasPedagogicalExplanations':False,'answerKeyStatus':'definitivo','createdAt':'2026-10-13'}
    report['summary'] = summary
    modules = [{'id':k,'title':v,'track':'cebraspe-ti','block':None,'color':['#387e78','#215c57']} for k,v in sorted(used_modules.items())]
    assets = ROOT / 'dist/assets/questions/cebraspe'
    assets.mkdir(parents=True,exist_ok=True)
    if not args.skip_render:
        tasks = [(str(archive),documents[f],list(pages),str(assets),args.width) for f,pages in pages_by_file.items()]
        renders = []
        with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
            for i,result in enumerate(pool.map(render_document,tasks),1):
                renders.extend(result)
                if i%20==0:print(json.dumps({'renderedPapers':i,'total':len(tasks),'pages':len(renders)}),flush=True)
        report['renderedPages'] = renders
        summary['imageBytes'] = sum(x['bytes'] for x in renders)
    summary['imageEncoding'] = 'webp-lossless'
    summary['imageWidth'] = args.width
    source_directory = ROOT/'data/official-content'
    source_directory.mkdir(parents=True,exist_ok=True)
    parts = []
    batch, size = [], 0
    def flush():
        nonlocal batch, size
        if not batch: return
        name = f'part-{len(parts)+1:03d}.json'
        (source_directory/name).write_text('{"questions":['+','.join(batch)+']}\n')
        parts.append('official-content/'+name)
        batch, size = [], 0
    for question in questions:
        item = json.dumps(question,ensure_ascii=False,separators=(',',':'))
        if size+len(item.encode())+1 > 4*1024*1024: flush()
        batch.append(item)
        size += len(item.encode())+1
    flush()
    for old in source_directory.glob('part-*.json'):
        if 'official-content/'+old.name not in parts: old.unlink()
    (ROOT/'data/official-content.json').write_text(json.dumps({'schemaVersion':1,'parts':parts,'modules':modules,'summary':summary},ensure_ascii=False,separators=(',',':'))+'\n')
    (ROOT/'data/cebraspe-import-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(summary,ensure_ascii=False,indent=2),flush=True)


if __name__=='__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--archive',default=str(ROOT/'research/cebraspe-ti'))
    ap.add_argument('--work',required=True)
    ap.add_argument('--extracted',required=True)
    ap.add_argument('--width',type=int,default=1150)
    ap.add_argument('--workers',type=int,default=4)
    ap.add_argument('--skip-render',action='store_true')
    build(ap.parse_args())
