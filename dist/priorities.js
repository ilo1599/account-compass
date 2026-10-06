'use strict';
// Editable planning assumptions. Risk is a separate, frozen 90-day model prediction.
window.CompassPriority=(()=>{
 const defaults=Object.freeze({issueBoost:1.25,silencePenalty:0.6,silenceGaps:4});
 function validate(p){
  if(!p||!['issueBoost','silencePenalty','silenceGaps'].every(k=>Number.isFinite(p[k])))throw new Error('Enter a number for every planning weight.');
  if(p.issueBoost<1||p.issueBoost>3)throw new Error('Issue boost must be between 1 and 3. Use 1 to switch it off.');
  if(p.silencePenalty<0.1||p.silencePenalty>1)throw new Error('Long-silence weight must be between 0.1 and 1. Use 1 to switch it off.');
  if(p.silenceGaps<2||p.silenceGaps>10)throw new Error('Long-silence threshold must be between 2 and 10 normal order gaps.');
  return {...p};
 }
 const daysBetween=(later,earlier)=>(Date.parse(later+'T12:00:00Z')-Date.parse(earlier+'T12:00:00Z'))/86400000;
 function assess(a,asof,policy=defaults){
  if(!a)throw new Error('Unknown account');
  const p=validate(policy),signals=[];
  const reviewAge=a.review_date?daysBetween(asof,a.review_date):null;
  if(Number.isFinite(a.review)&&a.review<=2&&reviewAge!==null&&reviewAge>=0&&reviewAge<=90)signals.push({id:'review',driver:'service',label:`Average recent rating ${a.review}/5; latest ${a.review_date}`,remedy:'Verify the service experience and agree a remedy with an owner.'});
  if(Number.isFinite(a.late_rate)&&a.late_rate>0)signals.push({id:'late',driver:'service',label:`${Math.round(a.late_rate*100)}% of known deliveries on recent purchases were late`,remedy:'Verify the delivery problem and agree a feasible delivery commitment.'});
  if(a.drops?.length)signals.push({id:'category',driver:'category',label:`Regular product line missing: ${a.drops[0].category.replaceAll('_',' ')}`,remedy:'Check demand and availability of the missing line; propose a relevant basket.'});
  const ratio=a.cadence>0?a.recency/a.cadence:null,overdue=ratio!==null&&ratio>p.silenceGaps;
  const weight=(signals.length?p.issueBoost:1)*(overdue?p.silencePenalty:1);
  const annualValue=a.baseline*12,annualValueAtRisk=a.exposed*12;
  const reasons=[];
  if(signals.length)reasons.push(`×${p.issueBoost} issue boost, applied once: ${signals.map(s=>s.label).join('; ')}. Confirm whether the issue remains unresolved.`);
  if(overdue)reasons.push(`×${p.silencePenalty} long-silence weight: ${ratio.toFixed(1)}× the usual order gap, beyond the ${p.silenceGaps}× planning threshold.`);
  if(!reasons.length)reasons.push('×1 standard weight: no qualifying recent service/category signal or long-silence penalty.');
  return {annualValue,annualValueAtRisk,monthlyValueAtRisk:a.exposed,score:annualValueAtRisk*weight,weight,signals,primaryDriver:signals[0]?.driver||null,overdue,overdueRatio:ratio,reasons,policy:p,eligible:a.recency<90};
 }
 function adviceInputs(a,context,assessment,asof){
  if(!assessment.eligible||!assessment.primaryDriver)return {account:a,context};
  const issues=assessment.primaryDriver==='category'?[]:(context.issues?.[a.id]||[]).filter(i=>daysBetween(asof,i.last)>=0&&daysBetween(asof,i.last)<=90);
  const reasons=[...a.reasons];
  if(assessment.signals.some(s=>s.id==='late')&&!reasons.includes('Delivery friction'))reasons.push('Delivery friction');
  if(assessment.signals.some(s=>s.id==='review')&&!reasons.includes('Low recent review'))reasons.push('Low recent review');
  return {account:{...a,reasons},context:{...context,issues:{...context.issues,[a.id]:issues}}};
 }
 return {defaults,validate,assess,adviceInputs};
})();
