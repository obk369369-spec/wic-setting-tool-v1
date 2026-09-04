"use strict";

function branchCustomer(state, candidates) {
  if(state.customer_reply?.code==="STOP" && state.customer_reply.verified===true && state.customer_reply.source_ref) return result("FAIL","EXPLICIT_STOP_OR_REJECTION",[],"추가 연락을 진행하지 않습니다.",[],"DO_NOT_CONTACT");
  const missing = ["institution","name","current_affiliation_verified","department","position","business_directions","contact_history_verified","current_interests"]
    .filter(k => state[k] === undefined || state[k] === null || state[k] === "" || Array.isArray(state[k]) && !state[k].length);
  if (missing.length || state.current_affiliation_verified !== true) return result("HOLD","VERIFY_CUSTOMER_STATE",missing,"고객 현재 상태를 확인한 뒤 안내 방향을 정합니다.",[],"VERIFY_CUSTOMER_STATE");
  if (state.explicit_stop_or_rejection === true) return result("FAIL","EXPLICIT_STOP_OR_REJECTION",[],"추가 연락을 진행하지 않습니다.",[],"DO_NOT_CONTACT");
  if (state.contact_history_verified !== true) return result("HOLD","PRIOR_CONTACT_HISTORY_UNVERIFIED",["contact_history"],"기존 문의·견적·구매·발송 이력을 확인한 뒤 중복 없이 안내합니다.",[],"VERIFY_HISTORY");

  const type = state.customer_type || (/정책|지원|연구|진흥|공공/.test([state.department,...state.business_directions].join(" ")) ? "RESEARCH_POLICY" : "ENTERPRISE");
  const axes = [...state.business_directions,...state.current_interests].map(x=>String(x).toLowerCase());
  const prior = new Set((state.prior_sent_titles||[]).map(x=>String(x).toLowerCase()));
  const eligible = (candidates||[]).filter(x => x.verified === true && x.paid === true && x.tradable === true && ['title','publisher','publication_date','link','source_ref'].every(k=>typeof x[k]==='string'&&x[k].trim()) && /^https:\/\//.test(x.link) && !prior.has(String(x.title).toLowerCase()) && (x.direct_match === true || (x.topics||[]).some(t=>axes.some(a=>a.includes(String(t).toLowerCase())||String(t).toLowerCase().includes(a)))));
  const distinct=[] , publishers=new Set();
  for(const item of eligible){if(!publishers.has(item.publisher)){publishers.add(item.publisher);distinct.push(item);}}
  const required=Number(state.required_recommendation_count||3);
  if(distinct.length<required) return result("HOLD","INSUFFICIENT_VERIFIED_DIRECT_RECOMMENDATIONS",["verified_distinct_publishers"],"확인된 관심 방향과 직접 맞는 자료를 추가 검증한 뒤 안내합니다.",distinct,"VERIFY_RECOMMENDATIONS");
  const followup=(state.prior_inquiry||state.prior_quote||state.prior_purchase) ? "FOLLOW_UP" : "NEW_CONTACT";
  const copy=prepareContactCopy(state,state.copy_context,state.customer_reply);
  return {
    decision:copy.status==="DRAFT_VALIDATED"?"PASS":"HOLD",contact:copy.status!=="DRAFT_VALIDATED"?"NO_CONTACT":copy.channel==="EMAIL"?"EMAIL_ONLY":"CONTACT",customer_type:type,contact_mode:followup,
    phone_message:copy.status==="DRAFT_VALIDATED"?copy.phone_message:"",
    guidance_message:copy.status==="DRAFT_VALIDATED"?copy.email_body:"",
    contact_copy:copy,send_allowed:false,
    recommendations:distinct.slice(0,required),recommendation_decision:"PASS",next_action:copy.status==="DRAFT_VALIDATED"?copy.next_action:"VERIFY_COPY_EVIDENCE",reason:"VERIFIED_STATE_HISTORY_INTEREST_MATCH"
  };
}
function result(decision,reason,missing,message,recommendations,next){return {decision,contact:"NO_CONTACT",reason,missing_evidence:missing,phone_message:"",guidance_message:message,recommendations,next_action:next};}
function prepareContactCopy(state,ctx,reply){
  const hold=reason=>({status:"HOLD",issues:[reason],turns:[],phone_message:"",email_body:""});
  if(state.explicit_stop_or_rejection===true)return hold("DO_NOT_CONTACT");
  if(state.current_affiliation_verified!==true||state.contact_history_verified!==true)return hold("CUSTOMER_STATE_UNVERIFIED");
  if(!ctx||ctx.evidence_verified!==true||["source_ref","history_kind","plain_topic","addressee"].some(k=>!ctx[k]))return hold("COPY_EVIDENCE_MISSING");
  const kind=ctx.history_kind,topic=ctx.plain_topic;
  const histories={one_way:"지난번 회사소개서를 보내드렸습니다.",response:`지난 통화에서 ${ctx.requested_format||topic}를 말씀해 주셨는데요.`,quote:`문의하신 ${topic} 견적 건으로 연락드렸습니다.`,purchase:`전에 구매하신 ${topic} 건으로 연락드렸습니다.`,none:"자료 검토 방향을 짧게 여쭤보려고 연락드렸습니다."};
  if(!histories[kind])return hold("UNKNOWN_HISTORY_KIND");
  const question=kind==="response"&&ctx.two_options?`${topic}, 두 분야 모두 보면 될까요?`:kind==="quote"?"견적에서 더 확인하실 내용이 있을까요?":['response','purchase'].includes(kind)?"지금도 그쪽 자료를 보고 계실까요?":ctx.two_options?`${topic} 중 요즘 더 살펴보시는 쪽이 있을까요?`:`요즘 ${topic} 쪽도 살펴보고 계실까요?`;
  let turns=[`${ctx.addressee}, 안녕하세요. 월드산업정보센터입니다.`,histories[kind],question],next="WAIT_FOR_CUSTOMER_REPLY";
  if(reply){
    if(reply.verified!==true||!reply.source_ref)return hold("REPLY_EVIDENCE_MISSING");
    if(reply.code==="STOP"){turns=["알겠습니다. 더 연락드리지 않겠습니다."];next="DO_NOT_CONTACT";}
    else if(reply.code==="OTHER"){turns=["그렇군요. 요즘은 어떤 쪽을 보고 계실까요?"];next="WAIT_FOR_CUSTOMER_SCOPE";}
    else if(reply.code==="LATER"){turns=["알겠습니다. 지금은 여기까지 말씀드리겠습니다."];next="WAIT_FOR_REQUESTED_FOLLOWUP";}
    else if(reply.code==="SCOPE"&&reply.plain_scope){turns=[`말씀하신 범위는 ${reply.plain_scope} 쪽이 맞을까요?`];next="WAIT_FOR_SCOPE_CONFIRMATION";}
    else if(reply.code==="CONFIRMED"&&reply.plain_scope){turns=[`네, ${reply.plain_scope} 범위에 맞춰 자료를 확인하겠습니다.`];next="SELECT_VERIFIED_MATERIALS_FOR_CONFIRMED_SCOPE";}
    else return hold("REPLY_SCOPE_UNCONFIRMED");
  }
  const r={status:"DRAFT",turns,email_body:turns.join("\n\n"),phone_message:ctx.landline_unavailable?"":turns.join("\n"),channel:ctx.landline_unavailable?"EMAIL":"CONTACT_DECISION_REQUIRED",next_action:next,recommendation_allowed:next==="SELECT_VERIFIED_MATERIALS_FOR_CONFIRMED_SCOPE",source_ref:ctx.source_ref,history_kind:kind,cue_card:{start:turns[0],ask:turns[turns.length-1],then:next==="SELECT_VERIFIED_MATERIALS_FOR_CONFIRMED_SCOPE"?"확인된 범위만 자료 검증":"답변을 기다립니다."},quality_scope:"AUTOMATED_CONSTRAINTS_ONLY_NOT_ACTUAL_CALL_RECEPTION"};
  r.send_allowed=false;
  r.issues=validateContactCopy(r);r.status=r.issues.length?"HOLD":"DRAFT_VALIDATED";
  if(r.issues.length){r.recommendation_allowed=false;r.next_action="VERIFY_COPY_EVIDENCE";r.phone_message="";r.email_body="";r.turns=[];r.cue_card={};}
  return r;
}
function validateContactCopy(r){
  const turns=r.turns||[],text=turns.join(" "),issues=[];
  if(!turns.length||turns.some(t=>t.length>100||t.trim().split(/\s+/).length>20))issues.push("TURN_TOO_LONG_OR_EMPTY");
  if((text.match(/\?/g)||[]).length>1)issues.push("MULTIPLE_QUESTIONS_BEFORE_REPLY");
  if(/정기적으로|꾸준히|지속적으로|보내드려도|휴대전화 번호|핸드폰 번호|연구하고 계시|현재 관심|업무 기준으로|방향과 직접 관련/.test(text))issues.push("PRESSURE_OR_UNVERIFIED_ASSERTION");
  if(/·|고신뢰성|실증 기반구축|소자공정/.test(text))issues.push("JARGON_LIST");
  if(['one_way','none'].includes(r.history_kind)&&/문의하신|구매하신|말씀해 주셨/.test(text))issues.push("OUTBOUND_HISTORY_AS_CUSTOMER_RESPONSE");
  return issues;
}
module.exports={branchCustomer,prepareContactCopy,validateContactCopy};

