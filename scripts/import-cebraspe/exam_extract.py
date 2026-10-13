"""Conservative, layout-aware extraction of official CESPE/CEBRASPE papers.

Original PDF pages are the canonical representation. Extracted text is a searchable
transcription, never a replacement for diagrams, formulas, source texts or code.
No answer is inferred by this module. A separate exact paper-code join is required.
"""
from __future__ import annotations
import argparse, collections, concurrent.futures, hashlib, json, os, re, sys, unicodedata
from pathlib import Path
try:
    import pymupdf as fitz
except ImportError:
    dependency_path=os.environ.get('CEBRASPE_PYMUPDF_PATH')
    if not dependency_path:
        raise RuntimeError('Install requirements.txt or set CEBRASPE_PYMUPDF_PATH to the PyMuPDF package directory.')
    sys.path.insert(0, dependency_path)
    import pymupdf as fitz

PAPER_CODE = re.compile(r'(?<![A-Z0-9])(?:\d{2,3})[ _]?[A-Z][A-Z0-9_]{1,35}[_](?:CB\d*|CE\d*|\d{3})[_]\d{2}(?:N\d+)?', re.I)
EXPLICIT = re.compile(r'\bQUEST[ÃA]O\s*(\d{1,3})\b', re.I)
HEADER = re.compile(r'CEBRASPE|CESPE\s*[|/–-]|CONHECIMENTOS (?:B[ÁA]SICOS|ESPEC[ÍI]FICOS)|Espa[çc]o livre|RASCUNHO', re.I)
ANSWER_KEY_PAGE = re.compile(r'GABARITOS?\s+(?:OFICIAIS?\s+)?(?:DEFINITIVOS?|PRELIMINARES?)',re.I)
EMBEDDED_ANSWERS = re.compile(r'\|\|\s*(?:JUSTIFICATIVAS?|[A-E])\s*\|\||\b(?:GABARITO|RESPOSTA\s+CORRETA)\s*[:–-]\s*(?:[A-E](?!\w)|CERTO|ERRADO)|(?:^|\n)\s*JUSTIFICATIVAS?\s*[:–\n-]',re.I)

def unsafe_page_reason(text):
    if EMBEDDED_ANSWERS.search(text):return 'embedded-answer-commentary'
    if ANSWER_KEY_PAGE.search(text):return 'answer-key-page'
    if re.search(r'PADR[ÃA]O\s+DE\s+RESPOSTA',text,re.I):return 'discursive-answer-standard'
    if re.search(r'PROVA\s+DISCURSIVA',text,re.I) and not re.search(r'PROVAS?\s+OBJETIVAS?',text,re.I):return 'discursive-only-page'
    return None

def normal(s):
    return ' '.join(s.replace('\x00','').split())

def code_normal(s):
    return re.sub(r'[^A-Z0-9]', '', re.sub(r'N\d+$', '',s.upper()))

def _span_rows(spans):
    rows=[]
    for s in sorted(spans,key=lambda s:(s['bbox'][1],s['bbox'][0])):
        mid=(s['bbox'][1]+s['bbox'][3])/2
        match=next((r for r in reversed(rows[-3:]) if abs(r['mid']-mid)<=3.2),None)
        if match is None:
            match={'mid':mid,'spans':[]};rows.append(match)
        match['spans'].append(s)
    for r in rows:
        r['spans'].sort(key=lambda s:s['bbox'][0])
        r['text']=normal(' '.join(s['text'] for s in r['spans']))
        r['bbox']=[min(s['bbox'][0] for s in r['spans']),min(s['bbox'][1] for s in r['spans']),max(s['bbox'][2] for s in r['spans']),max(s['bbox'][3] for s in r['spans'])]
    return sorted(rows,key=lambda r:(r['bbox'][1],r['bbox'][0]))

def page_data(page, index):
    width,height=page.rect.width,page.rect.height
    numeric_fonts=set()
    # A verified legacy subset font encodes 1..9,0 as control characters 1..10.
    # Decode only its exact PDF Encoding definition (not arbitrary bad glyphs).
    for font in page.get_fonts():
        obj=page.parent.xref_object(font[0])
        enc=re.search(r'/Encoding\s+(\d+)\s+0\s+R',obj)
        if enc:
            encoding=page.parent.xref_object(int(enc[1]))
            if re.search(r'/Differences\s*\[\s*1\s+/g19\s+/g20\s+/g21\s+/g22\s+/g23\s+/g24\s+/g25\s+/g26\s+/g27\s+/g18\s*\]',encoding):
                numeric_fonts.add(font[3].split('+')[-1])
    spans=[]; rawlines=[]
    for b in page.get_text('dict', flags=fitz.TEXTFLAGS_DICT & ~fitz.TEXT_PRESERVE_IMAGES)['blocks']:
        for l in b.get('lines',[]):
            ls=[]
            for s in l['spans']:
                value=s['text']
                if s['font'] in numeric_fonts and value and all(1<=ord(c)<=10 for c in value):
                    value=''.join(str(ord(c)%10) for c in value)
                if value.strip():ls.append({**s,'text':value.strip()})
            if not ls: continue
            rawlines.append({'text':normal(' '.join(s['text'] for s in ls)),'bbox':list(l['bbox']),'spans':ls})
            spans.extend(ls)
    text='\n'.join(x['text'] for x in rawlines)
    explicit=[]
    for l in rawlines:
        m=EXPLICIT.search(l['text'])
        if m and len(l['text'])<90:
            n=int(m[1]); x,y,x1,y1=l['bbox']
            if 0<n<=300 and y>30 and y<height-25:
                explicit.append({'number':n,'bbox':l['bbox'],'explicit':True,'font':l['spans'][0]['font'],'page':index})
    candidates=explicit[:]; pending=[]
    for s in spans:
        if not re.fullmatch(r'\d{1,3}',s['text']):continue
        n=int(s['text']);x,y,x1,y1=s['bbox']
        if not (0<n<=300 and y>35 and y<height-30):continue
        if not (x<width*.18 or width*.45<x<width*.66):continue
        # Item number is an independent typographic span with hanging-indented
        # statement to its right; table values and footer numbers do not qualify.
        right=[t for t in spans if t is not s and 0<=t['bbox'][0]-x1<42 and abs((t['bbox'][1]+t['bbox'][3]-y-y1)/2)<4.0 and re.search(r'[A-Za-zÀ-ÿ]',t['text'])]
        if not right:
            pending.append({'number':n,'bbox':list(s['bbox']),'explicit':False,'font':s['font'],'page':index})
            continue
        t=min(right,key=lambda z:z['bbox'][0])
        if t['bbox'][0]-x < 9:continue
        candidates.append({'number':n,'bbox':list(s['bbox']),'explicit':False,'font':s['font'],'bodyFont':t['font'],'page':index,'fontDifferent':s['font']!=t['font']})
    # Formula-only statements may have no alphabetic neighbor. Recover their
    # printed number only when two established markers on this very page share
    # its exact font and margin. No number is interpolated or guessed.
    for c in pending:
        matches=[a for a in candidates if not a['explicit'] and a.get('fontDifferent') and a['font']==c['font'] and abs(a['bbox'][0]-c['bbox'][0])<2]
        if len(matches)>=2:
            candidates.append({**c,'fontDifferent':True,'recoveredBy':'same-page-number-font-and-margin'})
    # Numeric marker locations reveal two-column papers without splitting single
    # column ledor/accessibility editions or full-width tables.
    left=sum(c['bbox'][0]<width*.3 for c in candidates)
    right=sum(c['bbox'][0]>width*.45 for c in candidates)
    # A passage may occupy the entire left column, with all numbered items on
    # the right. Requiring item numbers on both sides interleaves that passage.
    two=right>=1
    for c in candidates:
        c['column']=1 if two and c['bbox'][0]>=width*.45 else 0
    cols=[]
    for col in range(2 if two else 1):
        x0=0 if col==0 else width*.5
        x1=width*.5 if two and col==0 else width
        # Some centers deviate a few points. The marker position itself is the
        # column start; a narrow central gutter keeps text in its source column.
        ss=[s for s in spans if (s['bbox'][0]+s['bbox'][2])/2>=x0 and (s['bbox'][0]+s['bbox'][2])/2<x1 and s['bbox'][1]>40 and s['bbox'][3]<height-28]
        cols.append({'bbox':[x0,40,x1,height-28],'rows':_span_rows(ss)})
    candidates.sort(key=lambda c:(c['column'],c['bbox'][1],c['bbox'][0]))
    # Exact duplicate marker sightings (QUESTÃO line plus number span).
    ded=[]
    for c in candidates:
        if not any(c['number']==a['number'] and c['column']==a['column'] and abs(c['bbox'][1]-a['bbox'][1])<6 for a in ded):ded.append(c)
    return {'page':index,'width':width,'height':height,'text':text,'columns':cols,'candidates':ded,'twoColumns':two}

def select_markers(pages):
    candidates=[c for p in pages for c in p['candidates']]
    # True question numbers form the longest strictly consecutive sequence.
    # Passage line numbers (1,4,7...) and numbered code/table rows are rejected.
    # Reward explicit QUESTÃO and typography distinct from statement text.
    best={}; nodes=[]
    for c in candidates:
        prev=best.get(c['number']-1)
        score=(prev['score'] if prev else 0)+10+(1.5 if c.get('explicit') else .5 if c.get('fontDifferent') else 0)
        node={**c,'score':score,'length':(prev['length'] if prev else 0)+1,'prev':prev}
        nodes.append(node)
        if c['number'] not in best or score>=best[c['number']]['score']:
            best[c['number']]=node
    if not nodes:return [], {'reason':'no-numeric-question-markers','candidates':0}
    end=max(nodes,key=lambda c:(c['score'],c['number']))
    chain=[]
    while end:
        chain.append({k:v for k,v in end.items() if k not in ('prev','score','length')});end=end['prev']
    chain.reverse()
    if len(chain)<4:return [],{'reason':'no-confident-consecutive-numbering','candidates':len(candidates),'longestSequence':len(chain)}
    # If another equally long chain can alter a number at a different page or
    # column, visual-only import is still safe, but identity is flagged for root.
    return chain, {'candidates':len(candidates),'longestSequence':len(chain),'first':chain[0]['number'],'last':chain[-1]['number']}

def rows_between(pages,start,end):
    result=[]
    a=(start['page'],start['column'],start['bbox'][1]-3)
    b=(end['page'],end['column'],end['bbox'][1]-3) if end else (len(pages),0,0)
    for pi in range(start['page'],min((end['page'] if end else len(pages)-1)+1,len(pages))):
        for ci,col in enumerate(pages[pi]['columns']):
            for row in col['rows']:
                pos=(pi,ci,row['bbox'][1])
                if a<=pos<b:result.append({**row,'page':pi,'column':ci})
    return result

def extract_exam(path, record=None):
    path=Path(path); record=record or {}
    try:
        with fitz.open(path) as doc:
            pages=[page_data(page,i) for i,page in enumerate(doc)]
    except Exception as e:
        return {'file':record.get('file',str(path)),'questions':[],'status':'excluded','reason':'pdf-read-error','error':str(e)}
    text='\n'.join(p['text'] for p in pages)
    codes=sorted(set(code_normal(c) for c in PAPER_CODE.findall(text+'\n'+path.name)))
    markers,stats=select_markers(pages)
    unsafe={str(p['page']+1):reason for p in pages if (reason:=unsafe_page_reason(p['text']))}
    base={'file':record.get('file',str(path)),'event':record.get('event'),'paperCodes':codes,'pages':len(pages),'markerStats':stats,'unsafePages':unsafe}
    if not markers:return {**base,'questions':[],'status':'excluded','reason':stats['reason']}
    # Pre-2002 grouped C/E subitems need compound identities (question + subitem)
    # and cannot be silently converted to the later global item numbering.
    if re.search(r'quest[õo]es de 1 a \d+.*itens CERTOS',text[:5000],re.I|re.S) and markers[-1]['number']<60:
        return {**base,'questions':[],'status':'excluded','reason':'grouped-legacy-subitems-require-compound-answer-map'}
    style='multiple' if sum(m['explicit'] for m in markers)>=len(markers)*.7 else 'ce'
    questions=[]; last_context=[]; last_context_pages=[]
    first=markers[0]; p0=pages[first['page']]
    # Keep the complete initial source passage and instructions in visual source.
    for pi in range(0,first['page']+1):
        for ci,col in enumerate(pages[pi]['columns']):
            for row in col['rows']:
                if (pi,ci,row['bbox'][1])<(first['page'],first['column'],first['bbox'][1]-3) and not HEADER.search(row['text']):
                    last_context.append(row['text']);last_context_pages.append(pi+1)
    for idx,m in enumerate(markers):
        nxt=markers[idx+1] if idx+1<len(markers) else None
        rows=[r for r in rows_between(pages,m,nxt) if not HEADER.search(r['text'])]
        # New unindented prose after an item belongs to the next shared prompt.
        # We only split at full paragraphs following a terminated statement,
        # keeping indented code, numbered lists and mathematical notation intact.
        cut=len(rows); margin=m['bbox'][0]
        if style=='ce':
            for j in range(1,len(rows)):
                row=rows[j]; prev=rows[j-1]
                new_col=(row['page'],row['column'])!=(m['page'],m['column'])
                local_margin=margin
                if new_col:
                    colmarks=[k['bbox'][0] for k in markers if k['page']==row['page'] and k['column']==row['column']]
                    local_margin=min(colmarks) if colmarks else row['bbox'][0]
                same_margin=abs(row['bbox'][0]-local_margin)<4
                if same_margin and re.search(r'[A-Za-zÀ-ÿ]',row['text']) and not re.match(r'\d+\b',row['text']) and not HEADER.search(row['text']) and re.search(r'[.!?;:]\s*$',prev['text']):
                    cut=j;break
        bodyrows=rows[:cut]; upcoming=rows[cut:]
        body='\n'.join(r['text'] for r in bodyrows if not HEADER.search(r['text']))
        body=re.sub(r'^\s*(?:QUEST[ÃA]O\s*)?'+str(m['number'])+r'\b\s*','',body,flags=re.I)
        context='\n'.join(last_context)
        source_pages=sorted(set([m['page']+1]+[r['page']+1 for r in bodyrows]+last_context_pages))
        # Passage references can reach previous pages. Retain preceding page when
        # an item starts on a new page and no local prompt boundary is detected.
        source_pages=[p for p in source_pages if 0<p<=len(pages)]
        source_pages=[p for p in source_pages if str(p) not in unsafe]
        if str(m['page']+1) in unsafe:continue
        q={'number':m['number'],'type':style,'text':body,'context':context,'page':m['page']+1,'column':m['column'],'bbox':[round(v,2) for v in m['bbox']],'sourcePages':source_pages,'pageDimensions':{'width':round(pages[m['page']]['width'],2),'height':round(pages[m['page']]['height'],2)},'visualRequired':True,'extractionMode':'original-page-with-numbered-item','answer':None,'qualityWarnings':[]}
        section=re.findall(r'CONHECIMENTOS\s+(B[ÁA]SICOS|ESPEC[ÍI]FICOS|GERAIS|COMPLEMENTARES)', '\n'.join(p['text'] for p in pages[:m['page']+1]),re.I)
        if section:q['sectionTitle']='Conhecimentos '+section[-1].lower()
        if len(body)<10:q['qualityWarnings'].append('short-transcription-use-original-page')
        if '\ufffd' in body or '\x00' in body:q['qualityWarnings'].append('font-encoding-use-original-page')
        if style=='multiple':
            # Exact alternatives remain printed on the source page. No synthetic
            # or possibly incomplete option texts are generated.
            observed=set(re.findall(r'^([A-E])(?:\s|[.)]|$)',body,re.M))
            if set('ABCD')<=observed:
                q['alternatives']=[{'letter':l,'text':l} for l in 'ABCDE' if l in observed]
            else:
                q['alternatives']=[]
                q['qualityWarnings'].append('multiple-choice-options-not-identified')
        questions.append(q)
        if upcoming:
            last_context=[r['text'] for r in upcoming if not HEADER.search(r['text'])]
            last_context_pages=sorted(set(r['page']+1 for r in upcoming))
    return {**base,'status':'extracted','type':style,'questions':questions,'fullTextSha256':hashlib.sha256(text.encode()).hexdigest()}

def _worker(args):
    archive,record,outdir=args
    out=Path(outdir)/(record['sha256']+'.json')
    if out.exists():
        result=json.loads(out.read_text())
        if result.get('postprocessVersion')==4:return result
        if result.get('postprocessVersion')==3:
            result=repair_alternatives(result)
            result['postprocessVersion']=4
            out.write_text(json.dumps(result,ensure_ascii=False,indent=2))
            return result
        if result.get('postprocessVersion') is None and (result.get('status')=='excluded' or (record.get('collection') in ('legacy','pre2002') and len(result.get('questions',[]))<40)):
            result=extract_exam(Path(archive)/record['file'],record)
    else:
        result=extract_exam(Path(archive)/record['file'],record)
    result=finalize_result(Path(archive)/record['file'],result)
    out.write_text(json.dumps(result,ensure_ascii=False,indent=2))
    return result

def finalize_result(path,result):
    """Safety and schema pass also applied to extraction caches from earlier runs."""
    with fitz.open(path) as doc:
        unsafe={str(i+1):reason for i,p in enumerate(doc) if (reason:=unsafe_page_reason(p.get_text()))}
    result['unsafePages']=unsafe
    embedded=any(v=='embedded-answer-commentary' for v in unsafe.values()) or bool(re.search(r'com\s*justificativas|com[_ -]*gabarito',str(path),re.I))
    result['embeddedAnswers']=embedded
    if embedded:
        result['excludedItems']=[{'number':q['number'],'reason':'embedded-answer-commentary-needs-cropped-extraction'} for q in result.get('questions',[])]
        result['questions']=[]
        result['status']='excluded'
        result['reason']='embedded-answer-commentary-needs-cropped-extraction'
        result['postprocessVersion']=4
        return result
    kept=[];excluded=[]
    for q in result.get('questions',[]):
        # Shared passages are sometimes introduced once and cited by several
        # later command groups. A command change must not discard their pages.
        if re.search(r'\b(?:texto|trecho|figura|tabela|gr[áa]fico|diagrama|imagem|esquema)\b|\bc[óo]digo\b.*\b(?:acima|anterior|apresentado)|situa[çc][ãa]o\s+hipot[ée]tica',q.get('text','')+'\n'+q.get('context',''),re.I):
            q['sourcePages']=sorted(set(q['sourcePages'])|set(range(1,q['page']+1)))
            q['supportMode']='preceding-pages-preserved-for-shared-reference'
        q['sourcePages']=[p for p in q['sourcePages'] if str(p) not in unsafe]
        if str(q['page']) in unsafe:
            excluded.append({'number':q['number'],'reason':unsafe[str(q['page'])]});continue
        if q['type']=='multiple':
            observed=set(re.findall(r'^([A-E])(?:\s|[.)]|$)',q['text'],re.M))
            if set('ABCD')<=observed:
                q['alternatives']=[{'letter':l,'text':l} for l in 'ABCDE' if l in observed]
            else:
                q['alternatives']=[]
                if 'multiple-choice-options-not-identified' not in q['qualityWarnings']:
                    q['qualityWarnings'].append('multiple-choice-options-not-identified')
        kept.append(q)
    result['questions']=kept
    result['excludedItems']=excluded
    result['postprocessVersion']=4
    return result

def repair_alternatives(result):
    for q in result.get('questions',[]):
        if q['type']!='multiple':continue
        observed=set(re.findall(r'^([A-E])(?:\s|[.)]|$)',q['text'],re.M))
        if set('ABCD')<=observed:
            q['alternatives']=[{'letter':l,'text':l} for l in 'ABCDE' if l in observed]
            q['qualityWarnings']=[w for w in q['qualityWarnings'] if w!='multiple-choice-options-not-identified']
    return result

def main():
    default_archive=Path(__file__).resolve().parents[2]/'research'/'cebraspe-ti'
    ap=argparse.ArgumentParser();ap.add_argument('--archive',default=os.environ.get('CEBRASPE_ARCHIVE',str(default_archive)));ap.add_argument('--output',default=os.environ.get('CEBRASPE_IMPORT_OUTPUT',str(default_archive/'import'/'extracted-papers')));ap.add_argument('--workers',type=int,default=4);ap.add_argument('--limit',type=int);ap.add_argument('--file');a=ap.parse_args()
    archive=Path(a.archive);outdir=Path(a.output);outdir.mkdir(parents=True,exist_ok=True)
    files=json.loads((archive/'catalogue.json').read_text())['files']
    files=[r for r in files if r.get('localExists') and r['kind'].startswith('prova_objetiva')]
    if a.file:files=[r for r in files if a.file in r['file']]
    if a.limit:files=files[:a.limit]
    summaries=[]
    with concurrent.futures.ProcessPoolExecutor(max_workers=a.workers) as pool:
        for i,r in enumerate(pool.map(_worker,[(str(archive),r,str(outdir)) for r in files])):
            summaries.append({k:v for k,v in r.items() if k!='questions'}|{'questionCount':len(r['questions'])})
            if (i+1)%25==0:print(json.dumps({'processed':i+1,'total':len(files),'questions':sum(x['questionCount'] for x in summaries)}),flush=True)
    (outdir/'summary.json').write_text(json.dumps(summaries,ensure_ascii=False,indent=2))
    print(json.dumps({'files':len(summaries),'questions':sum(x['questionCount'] for x in summaries),'excluded':sum(x['status']=='excluded' for x in summaries)}),flush=True)

if __name__=='__main__':main()
