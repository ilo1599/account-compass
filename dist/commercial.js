'use strict';
// Transparent rules for diagnosis and demo offers; this is not a causal/uplift model.
window.CompassCommercial=(()=>{
 const defaults=Object.freeze({openingDiscount:5,maxDiscount:10,perOrderCap:100});
 const brl=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n);
 const round=n=>Math.round((n+Number.EPSILON)*100)/100;
 function validatePolicy(p){
  if(!p||!['openingDiscount','maxDiscount','perOrderCap'].every(k=>Number.isFinite(p[k])))throw new Error('Enter a number for each demo limit.');
  if(p.openingDiscount<=0||p.maxDiscount<=0||p.maxDiscount>100||p.openingDiscount>p.maxDiscount)throw new Error('Opening discount must be above 0% and at or below the ceiling; ceiling cannot exceed 100%.');
  if(p.perOrderCap<=0||p.perOrderCap>1000000)throw new Error('Enter a positive cap of up to R$1,000,000 per order.');
  return {...p,perOrderCap:round(p.perOrderCap)};
 }
 function referenceBasket(a){
  if(a.orders_previous>0&&a.value_previous>0)return {amount:round(a.value_previous/a.orders_previous),source:'Average purchase value in the previous 90-day window'};
  if(a.orders_recent>0&&a.value_recent>0)return {amount:round(a.value_recent/a.orders_recent),source:'Average purchase value in the recent 90-day window'};
  const orders=a.history.reduce((n,h)=>n+h.orders,0),value=a.history.reduce((n,h)=>n+h.value,0);
  return {amount:orders&&value>0?round(value/orders):null,source:orders&&value>0?'Average purchase value across recorded history':'No usable purchase value; enter the proposed basket'};
 }
 function quote(basket,rate,margin,policy=defaults){
  const p=validatePolicy(policy),errors=[];
  if(!Number.isFinite(basket)||basket<=0||basket>100000000)errors.push('Enter a positive basket value of up to R$100,000,000.');
  if(!Number.isFinite(rate)||rate<=0||rate>p.maxDiscount)errors.push(`Discount must be above 0% and within the ${p.maxDiscount}% demo ceiling.`);
  const hasMargin=margin!==null&&margin!==undefined&&margin!=='';
  if(hasMargin&&(!Number.isFinite(margin)||margin<0||margin>100))errors.push('Gross margin must be between 0% and 100%, or left blank.');
  if(errors.length)return {blocked:true,errors,discount:null,net:null,marginKnown:hasMargin};
  const discount=round(Math.min(basket*rate/100,p.perOrderCap)),net=round(basket-discount),effectiveRate=round(discount/basket*100);
  const before=hasMargin?round(basket*margin/100):null,after=hasMargin?round(before-discount):null;
  if(discount===0)errors.push('The calculated discount rounds to zero; adjust the basket or rate.');
  if(hasMargin&&after<=0)errors.push('This draft leaves no positive gross profit under the margin you entered. Reduce the discount or choose a service remedy.');
  return {basket,rate,discount,net,effectiveRate,capped:discount<round(basket*rate/100),marginKnown:hasMargin,grossProfitBefore:before,grossProfitAfter:after,blocked:errors.length>0,errors};
 }
 function build(a,context={},policy=defaults,input={}){
  const base=window.CompassActions.forAccount(a,context),p=validatePolicy(policy),reference=referenceBasket(a);
  const basket=Object.hasOwn(input,'basket')?input.basket:reference.amount,rate=Object.hasOwn(input,'rate')?input.rate:p.openingDiscount,margin=input.margin??null,preview=quote(basket,rate,margin,p);
  const change=`${a.orders_previous} → ${a.orders_recent} purchases across consecutive 90-day windows; ${Math.round(a.recency)} days since the last purchase.`;
  const drivers={
   service:{id:'service',title:'Service experience may be discouraging reorders',status:'Supported by service history; cause unconfirmed',evidence:base.kind==='service'?base.signal:'No direct service complaint identified in this brief. Ask before attributing the change to service.',question:'Is any order still unresolved, and is that affecting your decision to reorder?',remedy:base.kind==='service'?base.steps[1].body:'Verify the affected order, involve fulfilment and agree a correction, replacement or credit review within policy.',opener:base.kind==='service'?base.talkingPoint:'Can we identify the unresolved order and agree who will put it right before planning the next purchase?'},
   category:{id:'category',title:'Product mix or availability may have changed',status:'Purchase gap observed; cause unconfirmed',evidence:a.drops.length?`${a.drops[0].category.replaceAll('_',' ')} was bought ${a.drops[0].previous_orders} times in the previous window and is absent from the last 90 days.`:'No regular-category gap identified; confirm which products remain relevant.',question:'Is the missing line still needed, unavailable, or being bought elsewhere?',remedy:'Check availability of the missing line. If demand remains, propose a small trial basket or a customer-approved substitute; confirm stock and price first.',opener:'If that product line is still useful, could we try a smaller basket or review an available substitute together?'},
   demand:{id:'demand',title:'Lower demand or excess stock may explain the slowdown',status:'Pattern only; stock and demand unknown',evidence:change+' Stock levels and customer demand are not recorded.',question:'How much stock remains, and has sell-through or your buying budget changed?',remedy:'Propose a smaller replenishment basket or split ordering dates around actual stock needs. Confirm fulfilment feasibility; avoid pushing excess stock.',opener:'Would a smaller basket or split replenishment fit your current stock and demand better?'},
   price:{id:'price',title:'Price or a competing offer may be a barrier',status:'Needs customer confirmation',evidence:'No competitor prices or customer price objections in the structured data. Purchase slowdown alone does not prove price sensitivity.',question:'If we resolve the practical issues, is price still the reason you would not place an order? What comparable offer are you considering?',remedy:preview.blocked?'Review a feasible basket and discount before quoting terms. '+preview.errors.join(' '):`If price is confirmed as the remaining barrier, review a ${rate}% one-order discount, capped at ${brl(p.perOrderCap)}. Escalate only within the editable ${p.maxDiscount}% demo ceiling.`,opener:`If price is the remaining barrier, I can explore a ${p.openingDiscount}% discount on one agreed order, capped at ${brl(p.perOrderCap)}, subject to commercial review. Would that make the proposed basket workable?`}
  };
  const candidates=[];
  if(base.kind==='service')candidates.push(drivers.service);
  if(a.drops.length)candidates.push(drivers.category);
  candidates.push(drivers.demand,drivers.price);
  const confirmed=Object.hasOwn(drivers,input.driver)?input.driver:null;
  let causes=[...new Map(candidates.map(c=>[c.id,c])).values()];
  if(confirmed)causes=[{...drivers[confirmed],status:'Customer-confirmed · recorded by rep',evidence:'Rep-recorded explanation for this conversation. Historical signals remain unchanged.'},...causes.filter(c=>c.id!==confirmed)].slice(0,4);
  const primary=causes[0];
  if(confirmed==='price'&&preview.blocked)primary.remedy='Review the basket and a feasible remedy before quoting terms. '+preview.errors.join(' ');
  const offerSummary=`If price remains a confirmed barrier: ${rate}% off one agreed order, capped at ${brl(p.perOrderCap)}. Demo draft; commercial review required.`;
  const draft=preview.blocked?null:`Conditional demo proposal for ${a.id}: ${rate}% discount on one agreed basket of ${brl(basket)}, capped at ${brl(p.perOrderCap)}. Actual discount ${brl(preview.discount)} (${preview.effectiveRate}% effective); net order value ${brl(preview.net)}. No stacking or recurring discount. Only if price is confirmed as a barrier and commercial terms are approved.${!preview.marginKnown?' Margin unknown: review costs before committing.':` Rep-entered gross margin ${margin}%; estimated gross profit after discount ${brl(preview.grossProfitAfter)}, before other costs.`} Agree an order date and check the next purchase and subsequent repeat order; no retention outcome is guaranteed.`;
  const openingPoint=preview.blocked?'Let’s review the basket and a feasible remedy before quoting commercial terms.':`If price is the remaining barrier, I can explore ${rate}% off one agreed basket of ${brl(basket)}, capped at ${brl(p.perOrderCap)}. That means a ${brl(preview.discount)} discount and ${brl(preview.net)} net order value, subject to commercial review. Would that make this basket workable?`;
  const actions=confirmed?{title:{service:'Resolve the confirmed service issue',category:'Restore the relevant product mix',demand:'Fit replenishment to current demand',price:'Prepare a conditional commercial offer'}[confirmed],basis:'Rep-recorded cause',signal:'Customer explanation recorded by the rep. '+change,nextStep:primary.remedy,talkingPoint:confirmed==='price'?openingPoint:primary.opener,questions:[primary.question,'What specific order or next step would you commit to if we address this?'],steps:[{title:'Confirm the agreed cause',body:'Record the customer’s explanation and the affected order or basket. The rep’s input does not retrain the risk model.'},{title:'Make the remedy concrete',body:primary.remedy},{title:'Agree and measure the next step',body:'Agree the basket, order date, owner and follow-up date. Check purchase completion and a subsequent repeat order, rather than treating acceptance of an offer as retained revenue.'}],successCheck:'A concrete remedy, owner, order date and follow-up agreed; actual purchases checked.'}:{};
  return {...base,...actions,causes,commercial:{policy:p,reference,inputs:{driver:confirmed||'unknown',basket,rate,margin},preview,summary:preview.blocked?'Commercial draft needs adjustment before use. '+preview.errors.join(' '):offerSummary,draft,openingPoint,remedy:primary.remedy,alternatives:[{title:'Fix the service failure',body:drivers.service.remedy,condition:'Use when the issue is verified. Replacement or credit costs require review.'},{title:'Reduce commitment instead of price',body:drivers.demand.remedy,condition:'Use when demand or stock is the constraint; confirm any split-delivery cost.'},{title:'Restore the relevant product mix',body:drivers.category.remedy,condition:'Use when the line is still needed; no free stock or substitute is promised.'}],followUp:'Before closing: agree the order or remedy, named owner and follow-up date. Check fulfilment after delivery and whether the account buys again at its usual interval.'}};
 }
 return {defaults,validatePolicy,referenceBasket,quote,build,brl};
})();
