'use strict';
// Geographic planning is a transparent business rule, separate from trained inactivity risk.
window.CompassPlanner=(()=>{
 const minutes=s=>Number(s.slice(0,2))*60+Number(s.slice(3,5));
 const clock=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(Math.round(m%60)).padStart(2,'0');
 const rad=d=>d*Math.PI/180;
 const distance=(a,b)=>{const x=Math.sin(rad(b.lat-a.lat)/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(rad(b.lng-a.lng)/2)**2;return 6371*2*Math.atan2(Math.sqrt(x),Math.sqrt(Math.max(0,1-x)));};
 const round5=n=>Math.ceil(n/5)*5;
 function validate(p,C){
  if(!p||!C.bases.some(b=>b.id===p.baseId))throw new Error('Choose a base city from the dataset.');
  if(!['car','transit'].includes(p.mode))throw new Error('Choose car or public transport.');
  if(!Array.isArray(p.visitDays)||p.visitDays.some(d=>!Number.isInteger(d)||d<0||d>4)||new Set(p.visitDays).size!==p.visitDays.length)throw new Error('Choose valid visit days.');
  if(!Number.isFinite(p.radius)||p.radius<1||p.radius>250)throw new Error('Choose a visit radius between 1 and 250 km.');
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.end)||minutes(p.start)<360||minutes(p.end)>1320||minutes(p.end)-minutes(p.start)<120)throw new Error('Choose a workday of at least two hours, between 06:00 and 22:00.');
  if(!Number.isFinite(p.duration)||p.duration<15||p.duration>120)throw new Error('Choose a visit duration between 15 and 120 minutes.');
  return p;
 }
 function estimate(a,b,mode){const km=distance(a,b)*(mode==='car'?1.35:1.45);return {km,minutes:round5(km/(mode==='car'?35:22)*60+(mode==='car'?10:15)),source:mode==='car'?'Estimated driving':'Estimated public transport'};}
 function createPlan(accounts,C,p,ids,overrides={},road=null,policy=window.CompassPriority.defaults,asof=window.COMPASS_DATA.asof){
  validate(p,C);const score=a=>window.CompassPriority.assess(a,asof,policy).score;const base=C.bases.find(b=>b.id===p.baseId), start=minutes(p.start),end=minutes(p.end);
  const all=accounts.filter(a=>a.state===base.state&&a.recency<90).sort((a,b)=>score(b)-score(a)||a.id.localeCompare(b.id));
  const values=all.map(a=>score(a)).sort((a,b)=>a-b),threshold=values[Math.floor(Math.max(0,values.length-1)*.7)]||0;
  const chosen=accounts.filter(a=>ids.includes(a.id)&&a.state===base.state).sort((a,b)=>score(b)-score(a)||a.id.localeCompare(b.id));
  const locate=a=>a?.id==='BASE'?base:C.geo[a?.id];
  const baseNode={id:'BASE'};
  function leg(a,b){
   const ai=road?.ids.indexOf(a.id),bi=road?.ids.indexOf(b.id);
   if(road&&ai>=0&&bi>=0){const secs=road.durations[ai]?.[bi],metres=road.distances[ai]?.[bi];if(secs===null||metres===null||!Number.isFinite(secs)||!Number.isFinite(metres))return {minutes:Infinity,km:Infinity,source:'No road route'};return {minutes:round5(secs/60*1.2+10),km:metres/1000,source:'OSRM road times + buffer'};}
   return estimate(locate(a),locate(b),p.mode);
  }
  const canReach=a=>!!C.geo[a.id]&&distance(base,C.geo[a.id])<=p.radius;
  const reason=new Map(), remaining=[];
  chosen.forEach(a=>{
   if(overrides[a.id]==='call')reason.set(a.id,'Call chosen by rep.');
   else if(!C.geo[a.id])reason.set(a.id,'Coordinates missing: call first; confirm the address before a visit.');
   else if(!canReach(a))reason.set(a.id,`${Math.round(distance(base,C.geo[a.id]))} km from base, outside the ${p.radius} km radius. Call now; coordinate a nearer rep for an in-person visit.`);
   else if(!p.visitDays.length)reason.set(a.id,'No visit days allocated; call this week.');
   else if(score(a)<threshold&&overrides[a.id]!=='visit')reason.set(a.id,'Below the territory’s top 30% by planning score; start by phone.');
   else remaining.push(a);
  });
  const events=[],routes=[];let serial=0;
  const advance=(t,d)=>t<780&&t+d>720?780:t;
  const makeContact=(a,date,from,type,why)=>({id:a.id,accountId:a.id,date,time:clock(from),end:clock(from+(type==='visit'?p.duration:30)),from,to:from+(type==='visit'?p.duration:30),duration:type==='visit'?p.duration:30,type,status:'Planned',note:'',follow:'',reason:why});
  const makeTravel=(date,from,travel,a,b)=>({id:`travel-${date}-${++serial}`,accountId:b.id==='BASE'?null:b.id,date,time:clock(from),end:clock(from+travel.minutes),from,to:from+travel.minutes,duration:travel.minutes,type:'travel',status:'Travel',note:'',follow:'',origin:a.id,destination:b.id,km:travel.km,source:travel.source});
  for(const d of [...p.visitDays].sort()){
   const date=['2018-09-03','2018-09-04','2018-09-05','2018-09-06','2018-09-07'][d];
   let current=baseNode,t=start;const dayEvents=[],visits=[];
   while(remaining.length){
    const fits=remaining.map(a=>{const go=leg(current,a),back=leg(a,baseNode);const depart=advance(t,go.minutes),arrive=depart+go.minutes,meet=advance(arrive,p.duration),done=meet+p.duration;const returnAt=advance(done,back.minutes);return {a,go,back,depart,meet,done,fits:Number.isFinite(go.minutes)&&Number.isFinite(back.minutes)&&returnAt+back.minutes<=end,benefit:score(a)/(p.duration+go.minutes)};}).filter(v=>v.fits).sort((a,b)=>b.benefit-a.benefit||score(b.a)-score(a.a));
    if(!fits.length)break;const v=fits[0];
    dayEvents.push(makeTravel(date,v.depart,v.go,current,v.a));
    const why=overrides[v.a.id]==='visit'?'Visit chosen by rep, within reach and time budget.':`Within ${p.radius} km and in the territory’s top 30% by annualised value at risk × actionability. ${Math.round(distance(base,C.geo[v.a.id]))} km from base.`;
    const e=makeContact(v.a,date,v.meet,'visit',why);dayEvents.push(e);visits.push(e);reason.set(v.a.id,why);current=v.a;t=v.done;remaining.splice(remaining.indexOf(v.a),1);
   }
   if(visits.length){const back=leg(current,baseNode);dayEvents.push(makeTravel(date,advance(t,back.minutes),back,current,baseNode));events.push(...dayEvents);routes.push({date,day:d,visits:visits.map(e=>e.id),events:dayEvents,km:dayEvents.filter(e=>e.type==='travel').reduce((n,e)=>n+e.km,0),travelMinutes:dayEvents.filter(e=>e.type==='travel').reduce((n,e)=>n+e.duration,0),source:road?'OSRM road times + buffer':p.mode==='car'?'Estimated driving':'Estimated public transport',geometry:null});}
  }
  remaining.forEach(a=>reason.set(a.id,'Visit would exceed the allocated workday or no road route is available; call first this week.'));
  const unscheduled=[];
  for(const a of chosen.filter(a=>!events.some(e=>e.id===a.id))){
   let booked=false;
   for(const date of ['2018-09-03','2018-09-04','2018-09-05','2018-09-06','2018-09-07']){
    const busy=events.filter(e=>e.date===date);
    for(let t=start;t+30<=end;t+=5){if((t<780&&t+30>720)||busy.some(e=>t<e.to&&t+30>e.from))continue;events.push(makeContact(a,date,t,'call',reason.get(a.id)||'Start by phone.'));booked=true;break;}
    if(booked)break;
   }
   if(!booked)unscheduled.push({id:a.id,reason:'No free 30-minute slot within working hours. Reduce contact capacity or extend the workday.'});
  }
  events.sort((a,b)=>a.date.localeCompare(b.date)||a.from-b.from);
  return {events,routes,unscheduled,threshold,source:road?'OSRM road times + buffer':p.mode==='car'?'Estimated driving':'Estimated public transport',base,decisions:chosen.map(a=>{const e=events.find(e=>e.id===a.id);return {id:a.id,type:e?.type||'unscheduled',reason:e?.reason||unscheduled.find(u=>u.id===a.id)?.reason,distance:C.geo[a.id]?distance(base,C.geo[a.id]):null};})};
 }
 // Best-effort public demo API: cache per session, serialise and space requests.
 const cache=new Map();let nextAt=0,queue=Promise.resolve();
 function request(url){
  if(cache.has(url))return Promise.resolve(cache.get(url));
  const task=queue.catch(()=>{}).then(async()=>{const wait=Math.max(0,nextAt-Date.now());if(wait)await new Promise(r=>setTimeout(r,wait));nextAt=Date.now()+1150;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);try{const response=await fetch(url,{signal:controller.signal});if(!response.ok)throw new Error('Routing unavailable');const json=await response.json();if(json.code!=='Ok')throw new Error('No road route');cache.set(url,json);return json;}finally{clearTimeout(timer);}});queue=task;return task;
 }
 async function roadMatrix(accounts,C,p,ids){
  const base=C.bases.find(b=>b.id===p.baseId);const nodes=[{...base,id:'BASE'},...accounts.filter(a=>ids.includes(a.id)&&C.geo[a.id]&&distance(base,C.geo[a.id])<=p.radius).map(a=>({id:a.id,...C.geo[a.id]}))];
  if(nodes.length<2)throw new Error('No reachable visit coordinates');
  const coords=nodes.map(n=>n.lng+','+n.lat).join(';');
  const json=await request('https://router.project-osrm.org/table/v1/driving/'+coords+'?annotations=duration,distance&generate_hints=false');
  if(json.durations?.length!==nodes.length||json.distances?.length!==nodes.length)throw new Error('Incomplete travel matrix');
  return {ids:nodes.map(n=>n.id),durations:json.durations,distances:json.distances};
 }
 async function roadGeometry(route,C,base){
  const points=[base,...route.visits.map(id=>C.geo[id]),base];
  const coords=points.map(n=>n.lng+','+n.lat).join(';');
  const json=await request('https://router.project-osrm.org/route/v1/driving/'+coords+'?overview=full&geometries=geojson&steps=false&generate_hints=false');
  const geometry=json.routes?.[0]?.geometry;
  if(!geometry||geometry.type!=='LineString')throw new Error('Route shape unavailable');
  return geometry;
 }
 return {minutes,clock,distance,validate,estimate,createPlan,roadMatrix,roadGeometry};
})();
