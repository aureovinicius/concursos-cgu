#!/usr/bin/env python3
"""Conservative official definitive key extraction, retaining exact booklet identity."""
import sys,os,re,json,hashlib,unicodedata,concurrent.futures,collections
from pathlib import Path
import pymupdf as fitz
PROJECT=Path(__file__).resolve().parents[2]
BASE=Path(os.environ.get('CEBRASPE_ARCHIVE',str(PROJECT/'research'/'cebraspe-ti')))
OUT=Path(os.environ.get('CEBRASPE_IMPORT_OUTPUT',str(BASE/'import')))
OUT.mkdir(parents=True,exist_ok=True)

def normalize_code(s):
 s=unicodedata.normalize('NFKD',s).encode('ascii','ignore').decode().upper()
 s=re.sub(r'^(?:GAB(?:ARITO)?[_ -]?(?:OFICIAL[_ -]?)?(?:DEFINITIVO|DEF|PRELIMINAR|PREL)?[_ -]*)','',s)
 s=re.sub(r'^MATRIZ[_ -]*','',s)
 s=re.sub(r'(?:_(?:ADAPTADA|SUPER|MATRIZ))+$','',s)
 s=re.sub(r'_PAG[_ ]+\d+$','',s)
 return re.sub(r'[^A-Z0-9]','',s)

def extract_codes(text, filename=''):
 # Match the full official booklet ID; never remove the final variant suffix.
 pats=[r'(?<![A-Z0-9_])(?:MATRIZ_)?(?:\d{2,4}_?)?[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(?:[A-Z]{1,4}\d{1,3}|\d{2,3})_\d{1,3}(?:_(?:ADAPTADA|SUPER|MATRIZ|PAG[_ ]\d+))*(?![A-Z0-9_])',
       r'(?<![A-Z0-9_])\d{3}[_-]\d{2}(?![A-Z0-9_])']
 hits=[]
 for source,s in [('pdf',text),('filename',Path(filename).stem)]:
  s=s.upper()
  s=re.sub(r'GAB(?:ARITO)?[_ -]?(?:OFICIAL[_ -]?)?(?:DEFINITIVO|DEF|PRELIMINAR|PREL)[_ -]*','',s)
  for pat in pats:
   for m in re.finditer(pat,s):
    raw=m.group(); n=normalize_code(raw)
    if n not in [h['normalized'] for h in hits]:hits.append({'raw':raw,'normalized':n,'evidence':source})
 # Matrices use a distinct identity namespace. The published matrix files often
 # omit variant 00 and append PAG (page count); never equate a numbered booklet.
 for source,rawsource in [('pdf',text),('filename',Path(filename).stem)]:
  upper=rawsource.upper()
  candidates=[]
  for m in re.finditer(r'MATRIZ[_ -]+([0-9]{2,4}_?[A-Z][A-Z0-9_]*)',upper):
   candidates.append(m.group(1))
  for h in list(hits):
   if h['evidence']==source and '_MATRIZ' in h['raw']:
    candidates.append(h['raw'].split('_MATRIZ')[0])
  for candidate in candidates:
   body=re.split(r'_+(?:PAG|COM|ATUALIZ|JUSTIFIC)',candidate)[0].rstrip('_')
   variant=re.search(r'_(\d{2})$',body)
   if variant and variant.group(1)!='00':continue
   body=re.sub(r'_00$','',body)
   # Require numeric event prefix, organization and a block/role ending in digits.
   if not re.fullmatch(r'\d{2,4}_?[A-Z][A-Z0-9_]*\d',body):continue
   n='MATRIX'+re.sub(r'[^A-Z0-9]','',body)
   if n not in [h['normalized'] for h in hits]:hits.append({'raw':'MATRIX'+re.sub(r'[^A-Z0-9]','',body),'normalized':n,'evidence':source,'matrix':True})
 return hits

def parse_rows(text):
 lines=[l.strip() for l in text.splitlines() if l.strip()]
 ans={}; evidence=[]; conflicts=[]
 def add(n,c):
  if n in ans and ans[n]!=c:conflicts.append(n)
  ans[n]=c
 for i,line in enumerate(lines):
  # Legacy vertical columns: '1 C 41 E 81 C'. Restrict entire row.
  if re.fullmatch(r'(?:\d{1,3}\s+[A-EX*]\s*){1,8}',line):
   pairs=re.findall(r'(\d{1,3})\s+([A-EX*])',line)
   for n,c in pairs:
    if int(n)>0:add(int(n),'X' if c=='*' else c)
   evidence.append({'style':'vertical','numbers':[int(n) for n,c in pairs]})
   continue
  digits=re.sub(r'\s+','',re.sub(r'^(?:Item|Quest[aã]o)\s*','',line,flags=re.I))
  if not re.fullmatch(r'\d{5,}',digits):continue
  for offset in (1,2):
   if i+offset>=len(lines):continue
   nxt=re.sub(r'^(?:Gabarito)\s*','',lines[i+offset],flags=re.I)
   if not re.fullmatch(r'[A-EX*0\s]+',nxt) or not re.search(r'[A-EX*]',nxt):continue
   letters=re.sub(r'[0\s]','',nxt).replace('*','X')
   if len(letters)<2:continue
   starts=[]
   for start in range(1,301):
    expected=''.join(str(n) for n in range(start,start+len(letters)))
    if digits.startswith(expected) and not digits[len(expected):].strip('0'):starts.append(start)
   if len(starts)==1:
    nums=list(range(starts[0],starts[0]+len(letters)))
    for n,c in zip(nums,letters):add(n,c)
    evidence.append({'style':'horizontal','first':nums[0],'last':nums[-1],'count':len(nums)})
    break
 return {str(k):v for k,v in sorted(ans.items())},evidence,conflicts

def extract_doc(d):
 path=BASE/d['file']; blocks=[]; rejects=[]
 try:
  doc=fitz.open(path)
  for pn,page in enumerate(doc):
   # Sort fixes some old PDFs whose content stream prints the answer before the number.
   variants=[page.get_text(),page.get_text(sort=True)]
   parsed=[]
   for text in variants:
    ans,ev,conflicts=parse_rows(text)
    parsed.append((ans,ev,conflicts,text))
   best=max(parsed,key=lambda p:len(p[0]));ans,ev,conflicts,text=best
   fulltext='\n'.join(variants)
   codes=extract_codes(fulltext,Path(d['file']).name if len(doc)==1 else '')
   definite=bool(re.search(r'definitiv',fulltext,re.I))
   application=re.search(r'Aplica[çc][aã]o\s*:?\s*(\d{1,2}/\d{1,2}/\d{2,4})',fulltext,re.I)
   if len(ans)<5 or conflicts or not definite:
    rejects.append({'file':d['file'],'page':pn+1,'reason':'too-few-answers' if len(ans)<5 else 'conflicting-rows' if conflicts else 'not-confirmed-definitive','answerCount':len(ans)})
    continue
   # If both text order variants fully parse their overlapping answers, agreement is mandatory.
   disagree=sorted(k for k,v in parsed[0][0].items() if k in parsed[1][0] and parsed[1][0][k]!=v)
   if disagree:
    rejects.append({'file':d['file'],'page':pn+1,'reason':'extraction-order-disagreement','numbers':disagree});continue
   blocks.append({'event':d['event'],'codes':codes,'answers':ans,'answerCount':len(ans),'sourceFile':d['file'],'sourceUrl':d['url'],'page':pn+1,'applicationDate':application.group(1) if application else None,'definitive':True,'publicationDate':d.get('publicationDate'),'description':d['description'],'updated':d.get('isUpdated',False),'evidence':ev,'hasCode':bool(codes),'sha256':d.get('sha256')})
  doc.close()
  return blocks,rejects
 except Exception as e:return [],[{'file':d['file'],'reason':'parse-error','error':str(e)}]

def main():
 docs=[d for d in json.load(open(BASE/'catalogue.json'))['files'] if d.get('localExists') and d['kind']=='gabarito_definitivo']
 blocks=[];rejects=[]
 with concurrent.futures.ProcessPoolExecutor(max_workers=4) as pool:
  for i,(bs,rs) in enumerate(pool.map(extract_doc,docs),1):
   blocks.extend(bs);rejects.extend(rs)
   if i%25==0:print(i,len(blocks),len(rejects),flush=True)
 out={'schemaVersion':1,'policy':'Only explicit definitive answer keys; exact full booklet code matching; annulled answers X retained for exclusion from scoring.','keyBlocks':blocks,'rejectedPages':rejects,'statistics':{'documentsExamined':len(docs),'keyBlocks':len(blocks),'answerEntries':sum(len(b['answers']) for b in blocks),'codedBlocks':sum(bool(b['codes']) for b in blocks),'rejectedPages':len(rejects)}}
 (OUT/'answerkeys.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
 print(out['statistics'],flush=True)
if __name__=='__main__':main()
