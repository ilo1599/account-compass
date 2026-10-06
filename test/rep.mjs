import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const elements=new Map(),registered=[],microtasks=[],downloads=[];
let exportedBlob, noteInput;
const element=id=>{
 if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}},addEventListener(){}});
 return elements.get(id);
};
const context=vm.createContext({console,Intl,Date,Set,Map,AbortController,TextEncoder,Blob,
 setTimeout:()=>0,clearTimeout(){},queueMicrotask:fn=>microtasks.push(fn),
 window:{scrollTo(){},addEventListener(){},confirm:()=>true},
 localStorage:{getItem:()=>null},
 URL:{createObjectURL:blob=>{exportedBlob=blob;return 'blob:test-calendar';},revokeObjectURL(){}},
 document:{getElementById:element,querySelectorAll:selector=>selector==='[data-note]'&&noteInput?[noteInput]:[],
 createElement:()=>{const anchor={click(){downloads.push({href:this.href,download:this.download});}};return anchor;},
 modelContext:{registerTool:tool=>registered.push(tool)}}});
const run=source=>vm.runInContext(source,context);
for(const name of ['data','context','priorities','planner','actions','commercial'])run(readFileSync(`dist/${name}.js`,'utf8'));
context.localStorage.getItem=()=>run(`JSON.stringify({baseId:window.COMPASS_CONTEXT.bases.find(b=>b.city==='sao paulo'&&b.state==='SP').id,visitDays:[1,3],mode:'car',radius:50,start:'09:00',end:'17:00',duration:45})`);
for(const name of ['app','rep'])run(readFileSync(`dist/${name}.js`,'utf8'));
for(const fn of microtasks)fn();
const planHtml=run('renderPlan()');
assert.equal((planHtml.match(/class="contact-card"/g)||[]).length,6);
assert.ok(run('selected().some(a=>a.id==="A04144"&&a.risk<.3)'));
assert.ok(planHtml.includes('Annualised value at risk in plan')&&planHtml.includes('no risk cutoff'));
for(const account of run('selected()')){
 const action=run(`adviceFor(find('${account.id}'))`);
 assert.ok(planHtml.includes(run(`esc(${JSON.stringify(action.nextStep)})`)));
 assert.ok(planHtml.includes(run(`esc(${JSON.stringify(action.talkingPoint)})`)));
 const detail=run(`accountActionHtml(find('${account.id}'))`);
 assert.ok(detail.includes(run(`esc(${JSON.stringify(action.talkingPoint)})`)));
 assert.equal((detail.match(/class="action-item"/g)||[]).length,3);
}
for(const account of run('D.accounts')){
 const action=context.window.CompassActions.forAccount(account,context.window.COMPASS_CONTEXT);
 assert.ok(action.nextStep&&action.talkingPoint&&action.successCheck);
 assert.ok(!JSON.stringify(action).includes('undefined'));
}
run('approve();approve()');
assert.equal(run('state.events.filter(e=>e.type!=="travel").length'),6);
assert.ok(run('state.events.some(e=>e.type==="visit")&&state.events.some(e=>e.type==="call")&&state.events.some(e=>e.type==="travel")'));
const id=run('state.events.find(e=>e.type==="call").id');
noteInput={dataset:{note:id},value:'Confirm stock, then reorder; agreed'};
run('bind()');noteInput.oninput();
assert.equal(run(`find('${id}').id`),id);
assert.equal(run(`state.events.find(e=>e.id==='${id}').note`),noteInput.value,'Draft notes survive without a blur');
run(`state.events.find(e=>e.id==='${id}').follow='2018-09-10'`);
const raw=run('calendarText()'),unfolded=raw.replace(/\r\n /g,'');
assert.ok(raw.split('\r\n').every(line=>new TextEncoder().encode(line).length<=75));
assert.equal((unfolded.match(/BEGIN:VEVENT/g)||[]).length,run('state.events.length+1'));
const uids=[...unfolded.matchAll(/^UID:(.*)$/gm)].map(m=>m[1]);assert.equal(new Set(uids).size,uids.length);
assert.ok(unfolded.includes('Account visit:')&&unfolded.includes('Retention call:')&&unfolded.includes('Return to base'));
assert.ok(unfolded.includes('DTSTART:20180910T100000'));
assert.ok(unfolded.includes('Confirm stock\\, then reorder\\; agreed'));
assert.ok(unfolded.includes('Talking point:')&&unfolded.includes('Aim:'));
for(const event of unfolded.split('BEGIN:VEVENT').slice(1)){const start=event.match(/DTSTART:(\d+T\d+)/)[1],end=event.match(/DTEND:(\d+T\d+)/)[1];assert.ok(end>start);}
run('exportCalendar()');assert.equal(await exportedBlob.text(),raw);assert.equal(downloads[0].download,'Account_Compass_Week_2018-09-03.ics');
const payload=registered[0].execute();assert.equal(payload.approved,true);assert.equal(payload.outreach.length,6);assert.ok(payload.schedule.some(e=>e.type==='travel'));
assert.ok(payload.accounts.every(a=>a.suggestedAction.nextStep&&a.suggestedAction.talkingPoint));
assert.ok(payload.accounts.every(a=>a.annualValueAtRisk===run(`find('${a.id}').exposed*12`)&&a.riskHorizonDays===90));
assert.ok(unfolded.includes('Annualised value at risk')&&!unfolded.includes('Monthly value exposed'));
// A rep-confirmed cause and entered terms reach every surface without changing ranking or schedule.
const beforeRanking=run('selected().map(a=>a.id).join()'),beforeSchedule=run('JSON.stringify(state.events.map(e=>[e.id,e.date,e.time]))');
run(`window.CompassRep.setOfferInput('${id}',{driver:'price',basket:3000,rate:10,margin:30})`);
const offer=run(`adviceFor(find('${id}'))`);
assert.equal(offer.commercial.preview.discount,100);assert.equal(offer.commercial.preview.grossProfitAfter,800);
assert.ok(run('renderPlan()').includes('10% off one agreed order'));
assert.ok(run(`accountActionHtml(find('${id}'))`).includes('3.33%'));
assert.ok(run('renderAgenda()').includes('10% off one agreed order'));
assert.ok(run('calendarText()').replace(/\r\n /g,'').includes('10% discount on one agreed basket'));
assert.equal(registered[0].execute().accounts.find(a=>a.id===id).suggestedAction.commercial.preview.discount,100);
assert.equal(run('selected().map(a=>a.id).join()'),beforeRanking);assert.equal(run('JSON.stringify(state.events.map(e=>[e.id,e.date,e.time]))'),beforeSchedule);
// Proposal edits invalidate copy/agenda actions until refreshed, then preserve existing notes.
const briefNode={outerHTML:''};element('detail').querySelector=()=>briefNode;
const controls=['offer-driver','offer-basket','offer-rate','offer-margin'].map(element);
element('offer-form').querySelectorAll=()=>controls;
element('offer-driver').value='price';element('offer-basket').value='3000';element('offer-rate').value='10';element('offer-margin').value='30';
run(`bindActionBrief(find('${id}'))`);controls[1].oninput();
assert.equal(element('copy-offer').disabled,true);assert.equal(element('note-offer').disabled,true);
element('offer-form').onsubmit({preventDefault(){}});
assert.ok(briefNode.outerHTML.includes('3.33%'));
element('note-offer').onclick();element('note-offer').onclick();
const offerNote=run(`state.events.find(e=>e.id==='${id}').note`);
assert.ok(offerNote.startsWith(noteInput.value));assert.equal((offerNote.match(/Draft offer:/g)||[]).length,1);
assert.equal(run(`state.events.find(e=>e.id==='${id}').status`),'Planned','Draft is not customer acceptance');
assert.ok(run('calendarText()').replace(/\r\n /g,'').includes('Draft offer:'));
// Invalid limits leave the prior policy intact; valid edits persist without clearing appointments.
let persisted;context.localStorage.setItem=(key,value)=>{persisted={key,value};};run('bind()');
element('policy-opening').value='15';element('policy-ceiling').value='10';element('policy-cap').value='100';
element('offer-policy-form').onsubmit({preventDefault(){}});
assert.equal(run('window.CompassRep.getOfferPolicy().openingDiscount'),5);assert.ok(element('policy-error').textContent.includes('at or below'));
element('policy-opening').value='4';element('policy-ceiling').value='8';element('policy-cap').value='50';
element('offer-policy-form').onsubmit({preventDefault(){}});
assert.equal(persisted.key,'compass.offer-policy.v1');assert.equal(JSON.parse(persisted.value).perOrderCap,50);
assert.equal(run(`adviceFor(find('${id}')).commercial.preview.blocked`),true,'Existing draft must comply with new ceiling');
assert.equal(run('JSON.stringify(state.events.map(e=>[e.id,e.date,e.time]))'),beforeSchedule);
// Approved plans cannot be reordered by weight edits; pending plans persist weights and reselect contacts.
run('bind()');element('planning-boost').value='1';element('planning-penalty').value='1';element('planning-gaps').value='4';
element('planning-policy-form').onsubmit({preventDefault(){}});
assert.equal(run('window.CompassRep.getPlanningPolicy().issueBoost'),1.25);
assert.equal(run('JSON.stringify(state.events.map(e=>[e.id,e.date,e.time]))'),beforeSchedule);
const modelRisk=run('D.accounts.map(a=>a.risk).join()');
run('state.approved=false;state.events=[];window.CompassRep.getProfile().visitDays=[]');
element('planning-boost').value='0.5';element('planning-policy-form').onsubmit({preventDefault(){}});
assert.ok(element('planning-error').textContent.includes('between 1 and 3'));assert.equal(run('window.CompassRep.getPlanningPolicy().issueBoost'),1.25);
element('planning-boost').value='1';element('planning-policy-form').onsubmit({preventDefault(){}});
assert.equal(persisted.key,'compass.planning-policy.v1');assert.equal(JSON.parse(persisted.value).silencePenalty,1);
assert.equal(run('selected().findIndex(a=>a.id==="A04144")'),4,'Unweighted exposure places A04144 fifth');
assert.equal(run('selected().some(a=>a.id==="A13142")'),true,'Turning off the silence penalty restores this exposure priority');
assert.equal(run('D.accounts.map(a=>a.risk).join()'),modelRisk,'Planning changes do not modify model probabilities');
console.log('PASS: mixed-plan approval, draft note persistence, calendar contact/travel/follow-up blocks, unique UIDs, end times, escaping/folding, download wiring and agent schedule payload.');
