import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const context=vm.createContext({window:{},Intl,Date,Map});
for(const name of ['data','context','actions','commercial'])vm.runInContext(readFileSync(`dist/${name}.js`,'utf8'),context);
const engine=context.window.CompassCommercial,policy=engine.defaults;
assert.equal(policy.openingDiscount,5);assert.equal(policy.maxDiscount,10);assert.equal(policy.perOrderCap,100);
let q=engine.quote(500,5,null);
assert.equal(q.discount,25);assert.equal(q.net,475);assert.equal(q.marginKnown,false);assert.equal(q.grossProfitAfter,null);
q=engine.quote(3000,10,30);
assert.equal(q.discount,100);assert.equal(q.net,2900);assert.equal(q.capped,true);assert.equal(q.effectiveRate,3.33);assert.equal(q.grossProfitAfter,800);
assert.equal(engine.quote(500,5,5).blocked,true,'Zero gross profit blocks the draft');
assert.equal(engine.quote(500,10,5).blocked,true,'Negative gross profit blocks the draft');
assert.equal(engine.quote(500,10,20).blocked,false);
assert.equal(engine.quote(500,11,null).discount,null,'Cannot quote beyond ceiling');
for(const basket of [0,-1,null,NaN,Infinity])assert.equal(engine.quote(basket,5,null).blocked,true);
for(const margin of [-1,101,NaN,Infinity])assert.equal(engine.quote(500,5,margin).blocked,true);
for(const p of [{openingDiscount:11,maxDiscount:10,perOrderCap:100},{openingDiscount:5,maxDiscount:101,perOrderCap:100},{openingDiscount:5,maxDiscount:10,perOrderCap:0}])assert.throws(()=>engine.validatePolicy(p));
q=engine.quote(1000,8,null,{openingDiscount:4,maxDiscount:8,perOrderCap:50});assert.equal(q.discount,50);assert.equal(q.effectiveRate,5);
const accounts=context.window.COMPASS_DATA.accounts,C=context.window.COMPASS_CONTEXT;
for(const a of accounts){
 const action=engine.build(a,C);
 assert.ok(action.causes.length>=2&&action.causes.every(c=>c.evidence&&c.question&&c.remedy));
 const price=action.causes.find(c=>c.id==='price');assert.ok(price);assert.match(price.status,/confirmation/);assert.match(price.evidence,/No competitor prices/);
 assert.equal(action.commercial.inputs.driver,'unknown');assert.equal(action.commercial.preview.marginKnown,false);
 assert.ok(!JSON.stringify(action).includes('undefined'));
 if(action.commercial.draft){assert.match(action.commercial.draft,/Margin unknown/);assert.match(action.commercial.draft,/Only if price is confirmed/);assert.ok(action.commercial.preview.discount<=100);}
}
const service=accounts.find(a=>windowAction(a).kind==='service');
function windowAction(a){return context.window.CompassActions.forAccount(a,C);}
assert.equal(engine.build(service,C).causes[0].id,'service');
assert.ok(engine.build(service,C).commercial.remedy!==engine.build(service,C,policy,{driver:'demand'}).commercial.remedy);
const confirmed=engine.build(service,C,policy,{driver:'price',basket:3000,rate:10,margin:30});
assert.equal(confirmed.causes[0].id,'price');assert.match(confirmed.causes[0].status,/recorded by rep/);
assert.match(confirmed.talkingPoint,/10%/);assert.match(confirmed.commercial.draft,/3.33% effective/);
const blocked=engine.build(service,C,policy,{driver:'price',basket:500,rate:10,margin:5});
assert.equal(blocked.commercial.draft,null);assert.match(blocked.commercial.summary,/needs adjustment/);assert.ok(!blocked.talkingPoint.includes('10% off'));
const noValue={...service,orders_previous:0,value_previous:0,orders_recent:0,value_recent:0,history:[]};
assert.equal(engine.referenceBasket(noValue).amount,null);assert.equal(engine.build(noValue,C).commercial.preview.blocked,true);
console.log(`PASS: capped discount arithmetic, editable ceilings, missing inputs/margins, profit guard, conditional offer language and evidence/diagnostic advice for ${accounts.length} accounts.`);
