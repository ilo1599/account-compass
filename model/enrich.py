"""Add postal-area coordinates and sanitised review excerpts; leave fitted scores unchanged."""
import argparse, hashlib, json, re, unicodedata
from pathlib import Path
import pandas as pd

ROOT=Path(__file__).resolve().parents[1]
def normal(s):return ''.join(c for c in unicodedata.normalize('NFKD',str(s).lower()) if not unicodedata.combining(c))
parser=argparse.ArgumentParser();parser.add_argument('--data',type=Path,required=True);cfg=parser.parse_args()
src=cfg.data
payload=json.loads((ROOT/'dist/data.js').read_text().removeprefix('window.COMPASS_DATA = ').rstrip(';\n'))
ids={a['id'] for a in payload['accounts']}
g=pd.read_csv(src/'geolocation.csv').dropna(subset=['lat','lng'])
g=g[g.lat.between(-90,90)&g.lng.between(-180,180)]
assert g.account_id.is_unique
geo={r.account_id:{'lat':round(r.lat,5),'lng':round(r.lng,5)} for r in g[g.account_id.isin(ids)].itertuples()}
# Base is an approximate city centre, never the rep's home or an invented depot.
bases=[]
g['base_city']=g.city.map(normal)
for (state,city),rows in g.groupby(['state','base_city'],sort=True):
    bases.append({'id':hashlib.sha256((state+'|'+city).encode()).hexdigest()[:12],'city':city,'state':state,'lat':round(rows.lat.median(),5),'lng':round(rows.lng.median(),5)})
o=pd.read_csv(src/'orders.csv',usecols=['order_id','account_id','order_purchase_timestamp','order_delivered_customer_date','order_estimated_delivery_date'])
rv=pd.read_csv(src/'order_reviews.csv').merge(o[['order_id','account_id']],on='order_id',validate='one_to_one')
rv['submitted']=pd.to_datetime(rv.review_answer_timestamp,errors='coerce')
cut=pd.Timestamp('2018-08-31 23:59:59');recent=cut-pd.Timedelta(days=180)
rv=rv[(rv.account_id.isin(ids))&(rv.submitted<=cut)].copy()

RULES=[('Delivery delay',r'atras|demor|fora do prazo'),('Not received',r'nao.{0,20}(recebi|chegou|entreg|recebid)|ainda.{0,12}(aguard|esper)'),('Damage / defect',r'avaria|quebrad|danificad|amassad|defeito'),('Wrong / missing item',r'errad|diferente|faltan|incomplet|trocad'),('Support / refund',r'estorn|reembols|reclam|atendimento|devolu')]
def tags(text,score):
    s=normal(text)
    if score>3:return [] # Avoid interpreting positive delivery praise as a complaint.
    return [label for label,pattern in RULES if re.search(pattern,s)]
def excerpt(s):
    s=re.sub(r'\s+',' ',str(s)).strip()
    # Do not publish contact information, long identifiers, links or address-bearing comments.
    if re.search(r'\b(?:rua|avenida|av\.|cep|cpf|rg|telefone|celular|whatsapp|zap|email|e-mail|meu nome)\b',normal(s)):return None
    s=re.sub(r'https?://\S+|www\.\S+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}','[redacted]',s,flags=re.I)
    s=re.sub(r'\+?\d[\d\s()./-]{5,}\d','[redacted]',s)
    s=re.sub(r'\b\d{4,}\b','[redacted]',s)
    s=re.split(r'\b(?:atenciosamente|att\.?|me chamo)\b',s,flags=re.I)[0].strip()
    if not s or len(s)<5:return None
    # Keep a readable, bounded excerpt; original raw records are not exported.
    truncated=len(s)>350
    return {'text':s[:350]+('…' if truncated else ''),'truncated':truncated}

rv['clean']=rv.review_comment_message.fillna('').map(excerpt)
rv['tags']=[tags(t,s) for t,s in zip(rv.review_comment_message.fillna(''),rv.review_score)]
reviews={};issues={}
for acc,rows in rv.groupby('account_id'):
    visible=rows[rows.clean.notna()].sort_values('submitted',ascending=False)
    chosen=visible.head(2)
    negative=visible[(visible.review_score<=2)&(~visible.index.isin(chosen.index))].head(1)
    if negative.empty:negative=visible[~visible.index.isin(chosen.index)].head(1)
    chosen=pd.concat([chosen,negative]).sort_values('submitted',ascending=False)
    reviews[acc]=[{'id':f'{acc}-r{i}','date':str(r.submitted.date()),'score':int(r.review_score),**r.clean,'tags':r.tags} for i,r in enumerate(chosen.itertuples())]
    observed=rows[(rows.submitted>recent)&rows.clean.notna()]
    issue=[]
    for name,_ in RULES:
        matched=observed[observed.tags.map(lambda t:name in t)]
        if not matched.empty:issue.append({'tag':name,'count':len(matched),'first':str(matched.submitted.min().date()),'last':str(matched.submitted.max().date())})
    issues[acc]=issue
delivery={}
for c in ['order_purchase_timestamp','order_delivered_customer_date','order_estimated_delivery_date']:o[c]=pd.to_datetime(o[c],errors='coerce')
known=o[(o.account_id.isin(ids))&(o.order_delivered_customer_date<=cut)&o.order_estimated_delivery_date.notna()]
known=known[(known.order_purchase_timestamp>recent)&(known.order_purchase_timestamp<=cut)].copy()
known['late']=known.order_delivered_customer_date.dt.normalize()>known.order_estimated_delivery_date.dt.normalize()
for acc,rows in known.groupby('account_id'):
    late=rows[rows.late]
    delivery[acc]={'known':len(rows),'late':len(late),'first':None if late.empty else str(late.order_delivered_customer_date.min().date()),'last':None if late.empty else str(late.order_delivered_customer_date.max().date())}
out={'geo':geo,'bases':bases,'reviews':reviews,'issues':issues,'delivery':delivery,'asof':'2018-08-31','review_policy':'Up to two latest safe comment excerpts plus the latest additional negative comment; dates and age are always shown. Issue counts cover safe commented reviews submitted in the last 180 days.','source_hashes':{name:hashlib.sha256((src/name).read_bytes()).hexdigest() for name in ['geolocation.csv','order_reviews.csv','orders.csv']}}
(ROOT/'dist/context.js').write_text('window.COMPASS_CONTEXT = '+json.dumps(out,ensure_ascii=False,allow_nan=False,separators=(',',':'))+';\n')
print(f'Enriched {len(geo)} coordinates, {len(bases)} city bases, {sum(len(v) for v in reviews.values())} sanitised review excerpts.')
