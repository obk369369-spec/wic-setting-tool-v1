"use strict";
// Native startup: canonical reads precede generation. No remembered-state fallback.
const crypto = require('crypto');
const CENTRAL='obk369369-spec/20-operational-manual-viewer';
const TOOL='obk369369-spec/07-wic-setting-tool-v1';
const CUSTOMERS='obk369369-spec/41-wic-email-collection-master';
const SOURCES={
  release_gate:[CENTRAL,'customer_pipeline/customer_release_gate.py'],
  central_master:[CENTRAL,'CUSTOMER_WORKFLOW_MASTER.md'],
  copy_rules:[CENTRAL,'CUSTOMER_CALL_SCRIPT_LOCK.md'],
  feedback:[CENTRAL,'customer_pipeline/contact_copy_actual_cases.json'],
  central_checkpoint:[CENTRAL,'tool043/status.json'],
  master:[TOOL,'docs/UNIFIED_CUSTOMER_GUIDANCE_RULES.md'],
  checkpoint:[TOOL,'docs/CHAT_42_CUSTOMER_GUIDANCE_WORK_PROGRESS.md'],
  customer_master:[CUSTOMERS,'MASTER/COMMON_MASTER.md'],
  customer_checkpoint:[CUSTOMERS,'CHECKPOINT/CHECKPOINT.md'],
  customers:[CUSTOMERS,'DATA/CUSTOMER_MASTER.csv']
};
async function api(path){
  const headers={Accept:'application/vnd.github+json','User-Agent':'WIC-customer-preload'};
  const token=process.env.GH_TOKEN||process.env.GITHUB_TOKEN;
  if(token)headers.Authorization=`Bearer ${token}`;
  const response=await fetch(`https://api.github.com/repos/${path}`,{headers,signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw new Error(`CANONICAL_HTTP_${response.status}`);
  return response.json();
}
async function loadCanonical(read=api){
  const revisions={};
  for(const repo of new Set(Object.values(SOURCES).map(x=>x[0])))revisions[repo]=(await read(`${repo}/git/ref/heads/main`)).object.sha;
  const context={revisions,source_sha256:{}};
  for(const [key,[repo,path]] of Object.entries(SOURCES)){
    const blob=await read(`${repo}/contents/${path}?ref=${revisions[repo]}`);
    const text=Buffer.from(blob.content,'base64').toString('utf8').replace(/^\uFEFF/,'');
    context[key]=text;context.source_sha256[key]=crypto.createHash('sha256').update(text).digest('hex');
  }
  return context;
}
function parseCSV(text){
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
    else if(c===','&&!quoted){row.push(field);field='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(Boolean))rows.push(row);row=[];field='';}
    else field+=c;
  }
  if(quoted)throw new Error('INVALID_CSV');
  if(field||row.length){row.push(field);rows.push(row);}
  const header=rows.shift()||[];
  return rows.map(values=>Object.fromEntries(header.map((key,i)=>[key,values[i]||''])));
}
function generateInternal(request,context){
  const {prepareContactCopy,validateContactCopy}=require('./_customer_branch_internal');
  const feedback=JSON.parse(context.feedback);
  const receipt={revisions:context.revisions,source_sha256:context.source_sha256,feedback_ref:feedback.current_feedback_ref,manual_checkpoint_transfer_count:0};
  const hold=reason=>({status:'HOLD',reason,turns:[],phone_message:'',email_body:'',send_allowed:false,preload_receipt:receipt});
  const matches=parseCSV(context.customers).filter(row=>row['고유번호']===request.customer_id&&request.customer_id);
  if(matches.length!==1)return hold('CURRENT_MASTER_ID_NOT_UNIQUE');
  const customer=matches[0];
  if(!['PASS','VERIFIED'].includes(customer['검증상태']))return hold('CURRENT_MASTER_NOT_VERIFIED');
  if(['기관','이름','부서','이메일','공식출처','접촉이력'].some(k=>!customer[k]))return hold('CURRENT_CUSTOMER_OR_HISTORY_EVIDENCE_MISSING');
  // Do not accept caller-supplied verified flags or caller-authored copy context.
  const provenance=[customer['접촉이력'],customer['출처파일/URL'],customer['출처행/근거']].join('\n');
  const cases=feedback.cases.filter(item=>provenance.includes(item.context.source_ref));
  if(cases.length!==1)return hold('CANONICAL_COPY_CONTEXT_NOT_UNIQUE');
  if(request.materials_required!==false)return hold('ACTUAL_MATERIALS_SOURCE_NOT_CONNECTED');
  const actual=cases[0],state={current_affiliation_verified:true,contact_history_verified:true};
  // Only a historical, source-linked question; never a recommendation or send.
  const copy=prepareContactCopy(state,actual.context);
  const banned=feedback.cases.flatMap(item=>[item.old_excerpt,item.additional_wrong_excerpt].filter(Boolean));
  const issues=validateContactCopy(copy);
  if(banned.some(text=>copy.turns.join('\n').includes(text)))issues.push('ACTUAL_USER_FAIL_REUSED');
  if(issues.length)return hold('COPY_FAIL_AFTER_SINGLE_CANONICAL_REWRITE');
  return {...copy,preload_receipt:receipt,feedback_reused:actual.source_ref,
    generation_scope:'CANONICAL_HISTORY_QUESTION_ONLY_NOT_SALES_MATERIALS',
    semantic_eight_category_review:'NOT_UNIVERSALLY_PROVEN',send_allowed:false};
}
async function startCustomerWork(request,read=api){
  try{return generateFromContext(request,await loadCanonical(read));}
  catch(error){return require('./customer_release_bridge').release({}, {status:'HOLD',reason:'CANONICAL_PRELOAD_UNAVAILABLE'});}
}
function generateFromContext(request,context){
  return require('./customer_release_bridge').release(context,generateInternal(request,context));
}
module.exports={SOURCES,loadCanonical,parseCSV,generateFromContext,startCustomerWork};
if(require.main===module){startCustomerWork(JSON.parse(require('fs').readFileSync(0,'utf8'))).then(result=>{
  process.stdout.write(JSON.stringify(result)+'\n');process.exitCode=result.status==='DRAFT_VALIDATED'?0:2;
});}
