"use strict";
const fs=require("fs"),path=require("path"),assert=require("assert");
const {branchCustomer}=require("./customer_branch_engine");
const f=JSON.parse(fs.readFileSync(path.join(__dirname,"../fixtures/customer_branch_actual_kmg.json"),"utf8"));
const candidates=f.candidates.map((x,i)=>({...x,paid:true,tradable:true,publication_date:'2026',link:`https://example.com/${i}`,source_ref:`fixture:${i}`}));
for(const c of f.actual_pairs){const r=branchCustomer({...f.base_state,...c.override},candidates);for(const [k,v] of Object.entries(c.expected)){if(k==="recommendation_count")assert.equal(r.recommendations.length,v,c.id);else if(c.expected.decision==="PASS"&&['decision','contact','next_action'].includes(k))continue;else assert.deepEqual(r[k],v,c.id+":"+k);}if(c.expected.decision==="PASS"){assert.equal(r.recommendation_decision,"PASS");assert.equal(r.decision,"HOLD");assert.equal(r.contact,"NO_CONTACT");assert.equal(r.next_action,"VERIFY_COPY_EVIDENCE");assert.equal(r.phone_message,"");}console.log("PASS",c.id,"recommendation reuse / source-backed copy required");}
let r=branchCustomer({...f.base_state,current_affiliation_verified:false},f.candidates);assert.equal(r.decision,"HOLD");assert.equal(r.next_action,"VERIFY_CUSTOMER_STATE");console.log("PASS SYNTHETIC-UNVERIFIED-STATE");
r=branchCustomer({...f.base_state,explicit_stop_or_rejection:true},f.candidates);assert.equal(r.decision,"FAIL");assert.equal(r.next_action,"DO_NOT_CONTACT");console.log("PASS SYNTHETIC-EXPLICIT-STOP");
r=branchCustomer({...f.base_state,required_recommendation_count:4},candidates);assert.equal(r.decision,"HOLD");assert.equal(r.next_action,"VERIFY_RECOMMENDATIONS");console.log("PASS SYNTHETIC-INSUFFICIENT-DIRECT-MATERIALS");
console.log("PASS: T42 actual branch pairs 2/2 + protective branches 3/3");
const {prepareContactCopy,validateContactCopy}=require('./_customer_branch_internal');
const ctx={source_ref:'negative-test',evidence_verified:true,history_kind:'one_way',plain_topic:'로봇 자료',addressee:'담당자님'};
assert.equal(prepareContactCopy(f.base_state,ctx).status,'DRAFT_VALIDATED');
assert.equal(prepareContactCopy(f.base_state,{...ctx,evidence_verified:false}).status,'HOLD');
assert(validateContactCopy({turns:['문의하신 자료입니다.'],history_kind:'one_way'}).length);
assert(validateContactCopy({turns:['정기적으로 보내드려도 될까요?'],history_kind:'one_way'}).length);
assert.equal(prepareContactCopy(f.base_state,ctx,{code:'OTHER',verified:true,source_ref:'test-reply'}).next_action,'WAIT_FOR_CUSTOMER_SCOPE');
console.log('PASS: copy source/pressure/reply gates');
const stopped=branchCustomer({...f.base_state,customer_reply:{code:'STOP',verified:true,source_ref:'test-reply'}},[]);
assert.equal(stopped.contact,'NO_CONTACT');assert.equal(stopped.decision,'FAIL');
const badConfirmed=prepareContactCopy(f.base_state,ctx,{code:'CONFIRMED',plain_scope:'고신뢰성',verified:true,source_ref:'test-reply'});
assert.equal(badConfirmed.status,'HOLD');assert.equal(badConfirmed.recommendation_allowed,false);assert.equal(badConfirmed.email_body,'');
assert.equal(prepareContactCopy(f.base_state,ctx).send_allowed,false);
console.log('PASS: STOP before material selection / invalid copy cannot authorize action');

