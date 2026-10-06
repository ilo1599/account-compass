import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const ctx=vm.createContext({window:{},AbortController,console,setTimeout,clearTimeout,Date,fetch:async()=>{throw new Error('offline');}});
for(const name of ['data','context','priorities','planner'])vm.runInContext(readFileSync(`dist/${name}.js`,'utf8'),ctx);
const D=ctx.window.COMPASS_DATA,C=ctx.window.COMPASS_CONTEXT,P=ctx.window.CompassPlanner;
const b=C.bases.find(b=>b.state==='SP'&&b.city==='sao paulo');
const profile={baseId:b.id,visitDays:[1,3],mode:'car',radius:50,start:'09:00',end:'17:00',duration:45};
const score=a=>ctx.window.CompassPriority.assess(a,D.asof).score;
const accounts=D.accounts.filter(a=>a.state==='SP'&&a.recency<90).sort((a,b)=>score(b)-score(a));
const ids=accounts.slice(0,6).map(a=>a.id);
function verify(plan,p){
 const contacts=plan.events.filter(e=>e.type!=='travel');
 assert.equal(new Set(contacts.map(e=>e.id)).size,contacts.length);
 for(const day of D.week){const events=plan.events.filter(e=>e.date===day);for(let i=0;i<events.length;i++){const e=events[i];assert.ok(e.from>=P.minutes(p.start)&&e.to<=P.minutes(p.end));assert.ok(!(e.from<780&&e.to>720),'Lunch reserved');if(i)assert.ok(events[i-1].to<=e.from,'No event overlaps');}}
 for(const route of plan.routes){assert.ok(p.visitDays.includes(D.week.indexOf(route.date)));assert.equal(route.events[0].origin,'BASE');assert.equal(route.events.at(-1).destination,'BASE');for(const id of route.visits){assert.ok(P.distance(b,C.geo[id])<=p.radius);assert.equal(D.accounts.find(a=>a.id===id).state,b.state);}}
 assert.equal(contacts.length+plan.unscheduled.length,ids.length);
}
let plan=P.createPlan(D.accounts,C,profile,ids);verify(plan,profile);
assert.ok(plan.events.some(e=>e.type==='visit')&&plan.events.some(e=>e.type==='call'));
const remote=ids.find(id=>P.distance(b,C.geo[id])>profile.radius);
assert.equal(plan.decisions.find(d=>d.id===remote).type,'call');
assert.ok(plan.decisions.find(d=>d.id===remote).reason.includes('nearer rep'));
for(const p of [{...profile,visitDays:[]},{...profile,radius:1},{...profile,mode:'transit'},{...profile,start:'09:00',end:'11:00',duration:120}]){plan=P.createPlan(D.accounts,C,p,ids);verify(plan,p);if(!p.visitDays.length||p.radius===1)assert.ok(plan.events.every(e=>e.type==='call'));}
const tiny={...profile,start:'11:00',end:'13:00',visitDays:[]};const tooMany=P.createPlan(D.accounts,C,tiny,accounts.slice(0,20).map(a=>a.id));assert.ok(tooMany.unscheduled.length>0);
const missing=JSON.parse(JSON.stringify(C));delete missing.geo[ids[1]];plan=P.createPlan(D.accounts,missing,profile,ids,{[ids[1]]:'visit'});assert.equal(plan.decisions.find(d=>d.id===ids[1]).type,'call');
const forced=P.createPlan(D.accounts,C,profile,ids,{[remote]:'visit'});assert.equal(forced.decisions.find(d=>d.id===remote).type,'call','Rep override cannot bypass reach');
const noRoute={ids:['BASE',...ids],durations:Array.from({length:7},()=>Array(7).fill(null)),distances:Array.from({length:7},()=>Array(7).fill(null))};plan=P.createPlan(D.accounts,C,profile,ids,{},noRoute);assert.ok(plan.events.every(e=>e.type==='call'));verify(plan,profile);
assert.throws(()=>P.validate({...profile,baseId:'invalid'},C),/base city/);
assert.throws(()=>P.validate({...profile,end:'08:00'},C),/workday/);
assert.throws(()=>P.validate({...profile,visitDays:[1,1]},C),/visit days/);
assert.throws(()=>P.validate({...profile,radius:2000},C),/radius/);
for(const comments of Object.values(C.reviews))for(const r of comments){assert.ok(r.date<=D.asof);assert.ok(!/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(r.text));assert.ok(!/\b\d{6,}\b/.test(r.text));}
await assert.rejects(P.roadMatrix(D.accounts,C,profile,ids),/offline/);
// Exercise successful routing response parsing and its BASE index, without a network dependency.
ctx.fetch=async url=>({ok:true,json:async()=>url.includes('/table/')?{code:'Ok',durations:Array.from({length:1+ids.filter(id=>C.geo[id]&&P.distance(b,C.geo[id])<=profile.radius).length},()=>Array(1+ids.filter(id=>C.geo[id]&&P.distance(b,C.geo[id])<=profile.radius).length).fill(600)),distances:Array.from({length:1+ids.filter(id=>C.geo[id]&&P.distance(b,C.geo[id])<=profile.radius).length},()=>Array(1+ids.filter(id=>C.geo[id]&&P.distance(b,C.geo[id])<=profile.radius).length).fill(5000))}:{code:'Ok',routes:[{geometry:{type:'LineString',coordinates:[[b.lng,b.lat],[b.lng+.01,b.lat+.01]]}}]}});
const matrix=await P.roadMatrix(D.accounts,C,profile,ids);assert.equal(matrix.ids[0],'BASE');
const live=P.createPlan(D.accounts,C,profile,ids,{},matrix);verify(live,profile);assert.ok(live.events.some(e=>e.type==='travel'&&e.source.includes('OSRM')));
assert.equal((await P.roadGeometry(live.routes[0],C,b)).type,'LineString');
console.log('PASS: reach and territory, mixed channels, workday/lunch/return bounds, no overlaps, capacity overflow, missing coordinates, no road route, transit estimates, safe dated comments and road API parsing.');
