"""Reproducible, timestamp-aware retention prototype. No sklearn dependency.

Run: python model/train.py --data ../work/data/heineken_challenge_dataset
Raw sources are never copied into the public directory.
"""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
args = argparse.ArgumentParser()
args.add_argument('--data', type=Path, required=True)
cfg = args.parse_args()
data = cfg.data
orders = pd.read_csv(data / 'orders.csv')
items = pd.read_csv(data / 'order_items.csv')
customers = pd.read_csv(data / 'customers.csv', dtype={'customer_zip_code_prefix':str})
products = pd.read_csv(data / 'products.csv')
reviews = pd.read_csv(data / 'order_reviews.csv')
for c in ['order_purchase_timestamp','order_delivered_customer_date','order_estimated_delivery_date']:
    orders[c] = pd.to_datetime(orders[c], errors='coerce')
reviews['review_answer_timestamp'] = pd.to_datetime(reviews['review_answer_timestamp'])
agg = items.groupby('order_id').agg(value=('price','sum'), item_count=('price','size'))
o = orders.join(agg,on='order_id')
# Purchase signal, NOT final fulfillment status: status history is unavailable.
o = o[o.item_count.notna()].copy()
o = o.merge(customers[['customer_id','customer_city','customer_state']],on='customer_id',validate='one_to_one')
o = o.sort_values(['account_id','order_purchase_timestamp'])
assert o.order_id.is_unique
rv = reviews.merge(o[['order_id','account_id']],on='order_id',validate='one_to_one')
lines = items.merge(products[['product_id','product_category']],on='product_id',validate='many_to_one').merge(o[['order_id','account_id','order_purchase_timestamp']],on='order_id',validate='many_to_one')
lines['product_category'] = lines.product_category.fillna('unknown')
END = pd.Timestamp('2018-08-31 23:59:59')

def snapshot(t, label=True):
    h = o[o.order_purchase_timestamp <= t].copy()
    a = h.groupby('account_id').agg(n=('order_id','size'), first=('order_purchase_timestamp','min'), last=('order_purchase_timestamp','max'), city=('customer_city','last'),state=('customer_state','last'),lifetime=('value','sum'))
    a['tenure']=(t-a['first']).dt.total_seconds()/86400
    a=a[(a.n>=10)&(a.tenure>=180)].copy()
    a['recency']=(t-a['last']).dt.total_seconds()/86400
    # Distinct purchase days prevent same-day orders from setting zero cadence.
    days = h[['account_id','order_purchase_timestamp']].copy()
    days['d']=days.order_purchase_timestamp.dt.normalize()
    days=days.drop_duplicates(['account_id','d']).sort_values(['account_id','d'])
    days['gap']=days.groupby('account_id').d.diff().dt.days
    a=a.join(days.groupby('account_id').gap.median().rename('cadence'))
    a['cadence']=a.cadence.clip(lower=1).fillna(30)
    a['cadence_ratio']=a.recency/a.cadence
    for name, start, stop in [('recent',90,0),('previous',180,90)]:
        w=h[(h.order_purchase_timestamp > t-pd.Timedelta(days=start))&(h.order_purchase_timestamp<=t-pd.Timedelta(days=stop))]
        a=a.join(w.groupby('account_id').agg(**{f'orders_{name}':('order_id','size'),f'value_{name}':('value','sum')}))
        a[[f'orders_{name}',f'value_{name}']]=a[[f'orders_{name}',f'value_{name}']].fillna(0)
    a['order_change']=np.log((a.orders_recent+.5)/(a.orders_previous+.5)).clip(-4,4)
    a['spend_change']=np.log((a.value_recent+1)/(a.value_previous+1)).clip(-5,5)
    # Only deliveries completed by this cutoff are observable, regardless of final status.
    dh=h[(h.order_delivered_customer_date<=t)&(h.order_purchase_timestamp>t-pd.Timedelta(days=90))].copy()
    dh['late']=(dh.order_delivered_customer_date.dt.normalize()>dh.order_estimated_delivery_date.dt.normalize()).astype(int)
    a=a.join(dh.groupby('account_id').late.mean().rename('late_rate'))
    rh=rv[(rv.review_answer_timestamp<=t)&(rv.review_answer_timestamp>t-pd.Timedelta(days=90))].copy()
    a=a.join(rh.groupby('account_id').agg(review=('review_score','mean'),reviews_n=('review_score','size'),last_review=('review_answer_timestamp','max')))
    a['review_missing']=a.review.isna().astype(int)
    a['late_missing']=a.late_rate.isna().astype(int)
    a['review']=a.review.fillna(3)
    a['late_rate']=a.late_rate.fillna(0)
    a['reviews_n']=a.reviews_n.fillna(0)
    if label:
        assert t+pd.Timedelta(days=90)<=END
        future=o[(o.order_purchase_timestamp>t)&(o.order_purchase_timestamp<=t+pd.Timedelta(days=90))]
        a['y']=(~a.index.isin(future.account_id)).astype(int)
    a['snapshot']=str(t.date())
    return a

FEATURES=['recency','cadence','cadence_ratio','orders_recent','orders_previous','order_change','spend_change','late_rate','review','review_missing','late_missing','n','tenure']
LOG=['recency','cadence','cadence_ratio','orders_recent','orders_previous','n','tenure']
def feature_matrix(df):
    x=df[FEATURES].astype(float).copy()
    for col in LOG:
        if col in x:x[col]=np.log1p(x[col].clip(lower=0))
    return x.values

def sigmoid(z):return 1/(1+np.exp(-np.clip(z,-35,35)))
def fit(x,y,reg=8.):
    # Penalised logistic regression, Newton optimisation; unweighted for probability fidelity.
    x=np.column_stack([np.ones(len(x)),x]);w=np.zeros(x.shape[1]);pen=np.eye(x.shape[1])*reg;pen[0,0]=0
    for _ in range(60):
        p=sigmoid(x@w);q=np.maximum(p*(1-p),1e-6)
        step=np.linalg.solve((x.T*q)@x+pen,x.T@(p-y)+pen@w)
        w-=step
        if np.max(np.abs(step))<1e-7:break
    return w
def predict(x,w):return sigmoid(np.column_stack([np.ones(len(x)),x])@w)
def auc(y,p):
    ranks=pd.Series(p).rank().values;n1=y.sum();n0=len(y)-n1
    return float((ranks[y==1].sum()-n1*(n1+1)/2)/(n1*n0))
def metrics(y,p):
    n=max(1,int(np.ceil(.1*len(y))));top=np.argsort(-p)[:n];base=float(y.mean())
    return {'n':len(y),'base_rate':base,'auc':auc(y,p),'brier':float(np.mean((p-y)**2)),'top10_precision':float(y[top].mean()),'top10_lift':float(y[top].mean()/base),'top10_recall':float(y[top].sum()/y.sum())}

print('Building historical snapshots…',flush=True)
train=pd.concat([snapshot(pd.Timestamp(d+' 23:59:59')) for d in ['2017-09-30','2017-10-31','2017-11-30']])
cal=snapshot(pd.Timestamp('2018-02-28 23:59:59'))
test=snapshot(pd.Timestamp('2018-05-31 23:59:59'))
candidate_features=[['recency'],['recency','cadence','n'],['recency','cadence','cadence_ratio','orders_recent','orders_previous','order_change'],FEATURES.copy()]
candidates=[]
for fs in candidate_features:
    FEATURES=fs
    raw=feature_matrix(train);cmu=raw.mean(axis=0);csd=np.maximum(raw.std(axis=0),1e-8)
    ww=fit((raw-cmu)/csd,train.y.values)
    vp=predict((feature_matrix(cal)-cmu)/csd,ww)
    candidates.append({'features':fs,'validation_auc':auc(cal.y.values,vp),'mu':cmu,'sd':csd,'w':ww})
best=max(candidates,key=lambda c:c['validation_auc'])
FEATURES=best['features'];mu=best['mu'];sd=best['sd'];w=best['w']
print('Selected on calibration-period AUC:',FEATURES,flush=True)
def raw_predict(df):return predict((feature_matrix(df)-mu)/sd,w)
cp=raw_predict(cal);cx=np.log(np.clip(cp,1e-6,1-1e-6)/(1-np.clip(cp,1e-6,1-1e-6)))[:,None]
cw=fit(cx,cal.y.values,reg=2.)
def score(df):
    p=raw_predict(df);z=np.log(np.clip(p,1e-6,1-1e-6)/(1-np.clip(p,1e-6,1-1e-6)))[:,None]
    return predict(z,cw)
tp=score(test);m=metrics(test.y.values,tp)
# Compare against cadence-only and recency-only ranking on the same untouched test snapshot.
m['recency_auc']=auc(test.y.values,test.recency.values)
m['cadence_auc']=auc(test.y.values,test.cadence_ratio.values)
m['train_n']=len(train);m['calibration_n']=len(cal)
m['selected_features']=FEATURES
m['selection']=[{'features':c['features'],'validation_auc':c['validation_auc']} for c in candidates]
m['coefficients']=[{'feature':f,'weight':float(c)} for f,c in zip(FEATURES,w[1:])]
print(json.dumps(m,indent=2),flush=True)
final=snapshot(END,label=False);final['risk']=score(final)
# Preserve historic value through decline: reference window precedes recent 90 days.
final['baseline']=final.value_previous/3
fallback=(final.value_previous+final.value_recent)/6
final['baseline']=np.where(final.baseline>0,final.baseline,fallback)
final['value_exposed']=final.risk*final.baseline
final['lifecycle']=np.where(final.recency>=90,'Inactive','Early warning')
final.loc[(final.risk<.3)&(final.recency<90),'lifecycle']='Stable'
final['priority']=final.value_exposed
final=final.sort_values('priority',ascending=False)

monthly=o.assign(month=o.order_purchase_timestamp.dt.strftime('%Y-%m')).groupby(['account_id','month']).agg(orders=('order_id','size'),value=('value','sum'))
allmonths=pd.period_range('2017-01','2018-08',freq='M').astype(str).tolist()
prevlines=lines[(lines.order_purchase_timestamp>END-pd.Timedelta(days=180))&(lines.order_purchase_timestamp<=END-pd.Timedelta(days=90))]
catprev=prevlines.groupby(['account_id','product_category']).agg(orders=('order_id','nunique'),last=('order_purchase_timestamp','max'),value=('price','sum'))
recentlines=lines[lines.order_purchase_timestamp>END-pd.Timedelta(days=90)]
catrecent=set(zip(recentlines.account_id,recentlines.product_category))
latestreview=rv[rv.review_answer_timestamp<=END].sort_values('review_answer_timestamp').groupby('account_id').last()
accounts=[]
for acc,row in final.iterrows():
    history=[]
    for month in allmonths:
        try:z=monthly.loc[(acc,month)];history.append({'month':month,'orders':int(z.orders),'value':round(float(z.value),2)})
        except KeyError:history.append({'month':month,'orders':0,'value':0})
    drops=[]
    if acc in catprev.index.get_level_values(0):
        for cat,z in catprev.loc[acc].iterrows():
            if z.orders>=3 and (acc,cat) not in catrecent:
                drops.append({'category':cat,'last':str(z['last'].date()),'previous_orders':int(z.orders),'previous_value':round(float(z.value),2)})
    drops.sort(key=lambda d:-d['previous_value'])
    decline=(1-row.orders_recent/row.orders_previous) if row.orders_previous>0 else None
    spenddecline=(1-row.value_recent/row.value_previous) if row.value_previous>0 else None
    reasons=[]
    if row.recency>=max(30,2*row.cadence):reasons.append('Cadence broken')
    if decline is not None and decline>=.5:reasons.append('Orders declining')
    if spenddecline is not None and spenddecline>=.5:reasons.append('Spend declining')
    if drops:reasons.append('Regular category missing')
    if row.late_missing==0 and row.late_rate>=.25:reasons.append('Delivery friction')
    if row.reviews_n>0 and row.review<=2:reasons.append('Low recent review')
    if not reasons:reasons=['Low recent activity' if row.orders_recent<=2 else 'Model pattern']
    accounts.append({'id':acc,'city':row.city,'state':row.state,'risk':round(float(row.risk),4),'baseline':round(float(row.baseline),2),'exposed':round(float(row.value_exposed),2),'priority':round(float(row.priority),2),'lifecycle':row.lifecycle,'recency':round(float(row.recency),1),'cadence':round(float(row.cadence),1),'cadence_ratio':round(float(row.cadence_ratio),2),'orders_recent':int(row.orders_recent),'orders_previous':int(row.orders_previous),'value_recent':round(float(row.value_recent),2),'value_previous':round(float(row.value_previous),2),'n':int(row.n),'last':str(row['last'].date()),'order_decline':None if decline is None else round(float(decline),3),'spend_decline':None if spenddecline is None else round(float(spenddecline),3),'late_rate':None if row.late_missing else round(float(row.late_rate),3),'review':None if row.review_missing else round(float(row.review),2),'review_date':None if pd.isna(row.last_review) else str(row.last_review.date()),'drops':drops[:4],'reasons':reasons,'history':history})
assert len(accounts)==len(final)
assert all(0<=a['risk']<=1 for a in accounts)
assert all(abs(a['risk']*a['baseline']-a['exposed'])<1 for a in accounts)
payload={'asof':'2018-08-31','week':['2018-09-03','2018-09-04','2018-09-05','2018-09-06','2018-09-07'],'metrics':m,'accounts':accounts,'total_orders':len(orders),'total_accounts':int(orders.account_id.nunique()),'eligible_accounts':len(accounts),'purchase_orders':len(o),'months':allmonths}
(ROOT/'dist'/'data.js').write_text('window.COMPASS_DATA = '+json.dumps(payload,ensure_ascii=False,allow_nan=False,separators=(',',':'))+';\n')
model={'features':FEATURES,'log_transformed':LOG,'mean':mu.tolist(),'std':sd.tolist(),'weights':w.tolist(),'calibration_weights':cw.tolist(),'metrics':m,'target':'No product-backed purchase in the next 90 days','eligibility':'At least 10 product-backed purchases and 180 days history','asof':str(END),'sources':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in data.glob('*.csv')}}
(ROOT/'model'/'model.json').write_text(json.dumps(model,indent=2,allow_nan=False))
print(f'Exported {len(accounts)} real scored accounts.',flush=True)
