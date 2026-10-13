#!/usr/bin/env python3
import sys,json,re,collections,concurrent.futures
from pathlib import Path
from key_extract import BASE,OUT,fitz,extract_codes,normalize_code

def paper_info(d):
 try:
  doc=fitz.open(BASE/d['file']);texts=[]
  for pn in range(min(3,len(doc))):texts.append(doc[pn].get_text())
  codes=extract_codes('\n'.join(texts),Path(d['file']).name)
  text='\n'.join(texts)
  dt=re.search(r'Aplica[çc][aã]o\s*:?\s*(\d{1,2}/\d{1,2}/\d{2,4})',text,re.I)
  return {'file':d['file'],'event':d['event'],'sourceUrl':d['url'],'description':d['description'],'codes':codes,'pages':len(doc),'applicationDate':dt.group(1) if dt else None,'kind':d['kind'],'reviewRequired':d.get('reviewRequired',False)}
 except Exception as e:return {'file':d['file'],'event':d['event'],'error':str(e),'codes':[]}

def main():
 data=json.load(open(BASE/'catalogue.json'))['files']
 ds=[d for d in data if d.get('localExists') and d['kind'] in ('prova_objetiva','prova_objetiva_e_discursiva','prova_objetiva_com_gabarito')]
 raw=json.load(open(OUT/'answerkeys.json'));keys=raw['keyBlocks'];bycode=collections.defaultdict(list)
 for i,b in enumerate(keys):
  for c in b['codes']:
   bycode[b['event'],c['normalized']].append(i)
 cache_path=OUT/'paper-codes.json'
 if not cache_path.exists() and (OUT/'pairingmanifest.json').exists():
  cached=json.load(open(OUT/'pairingmanifest.json'))['papers']
 else:cached=json.load(open(cache_path)) if cache_path.exists() else []
 cached_by_file={p['file']:p for p in cached}
 papers=[]; missing=[d for d in ds if d['file'] not in cached_by_file]
 with concurrent.futures.ProcessPoolExecutor(max_workers=4) as pool:
  for i,p in enumerate(pool.map(paper_info,missing),1):
   cached_by_file[p['file']]=p
   if i%50==0:
    cache_path.write_text(json.dumps(list(cached_by_file.values()),ensure_ascii=False))
    print('Code extraction',i,'/',len(missing),flush=True)
 for d in ds:
  p=cached_by_file[d['file']]
  for c in p['codes']:c['normalized']=normalize_code(c['raw'])
  for c in extract_codes('',Path(p['file']).name):
   if c['normalized'] not in [a['normalized'] for a in p['codes']]:p['codes'].append(c)
  papers.append(p)
 cache_path.write_text(json.dumps(papers,ensure_ascii=False))
 for p in papers:
  indices=sorted(set(i for c in p['codes'] for i in bycode.get((p['event'],c['normalized']),[])))
  cand=[keys[i] for i in indices]
  # A conflicting retification replaces an older key only when it is explicitly marked
  # updated and has a later publication date. Otherwise retain the conflict for review.
  maps=collections.defaultdict(list)
  for b in cand:
   for num,ans in b['answers'].items():maps[num].append((ans,b))
  conflicts=[];merged={};sources={}
  for num,vals in maps.items():
   answers=set(a for a,b in vals)
   if len(answers)>1:
    newest=sorted(vals,key=lambda v:v[1].get('publicationDate') or '')[-1]
    if newest[1].get('updated') and newest[1].get('publicationDate') and all(newest[1]['publicationDate']>(b.get('publicationDate') or '') for a,b in vals if a!=newest[0]): vals=[newest]
    else:conflicts.append(num);continue
   chosen=sorted(vals,key=lambda v:v[1].get('publicationDate') or '')[-1]
   merged[num]=chosen[0]
   sources[num]={'file':chosen[1]['sourceFile'],'url':chosen[1]['sourceUrl'],'page':chosen[1]['page'],'applicationDate':chosen[1]['applicationDate']}
  p['keyBlockIndices']=indices;p['answers']=merged;p['answerSources']=sources;p['conflicts']=conflicts
  p['pairingStatus']='paired' if merged and not conflicts else 'partial-conflict' if merged else 'no-exact-definitive-key'
 stats={'papersExamined':len(papers),'papersPaired':sum(bool(p['answers']) for p in papers),'pairedAnswerEntries':sum(len(p['answers']) for p in papers),'withoutKey':sum(not bool(p['answers']) for p in papers),'conflictedPapers':sum(bool(p['conflicts']) for p in papers)}
 (OUT/'pairingmanifest.json').write_text(json.dumps({'schemaVersion':1,'statistics':stats,'papers':papers},ensure_ascii=False,indent=2)); print(stats)
if __name__=='__main__':main()
