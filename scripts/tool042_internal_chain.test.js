'use strict';
const assert=require('assert'),crypto=require('crypto'),fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process');
const root=path.join(__dirname,'..');

// A: legacy synchronous metadata survives beside the canonical async entry.
require('./customer_branch_engine.test');

// C + GROUP-D: candidate data renders the byte-normalized canonical body and
// the strict gate checks every complete TOC (37/106/76), order and final hash.
const expected=JSON.parse(fs.readFileSync(path.join(root,'fixtures/customer_guidance_actual_kmg_expected.json'),'utf8'));
const {renderCustomerGuidance,validateCustomerGuidanceOutput}=require('./customer_guidance_output_gate');
const rendererSource=fs.readFileSync(path.join(__dirname,'customer_guidance_output_gate.js'),'utf8');
const runtimeSource=fs.readFileSync(path.join(__dirname,'customer_work_start.js'),'utf8');
assert(!rendererSource.includes('김명곤'));
assert(!runtimeSource.includes('김명곤'));
assert(!rendererSource.includes('customer_guidance_actual_kmg'));
const rendered=renderCustomerGuidance(expected),format=validateCustomerGuidanceOutput(rendered,expected);
assert.equal(format.status,'PASS');
assert.equal(format.output_sha256,expected.user_visible_output_sha256);

// B: the semantic boundary promotes only an exact source-bound replay of an
// existing user correction; an unapproved customer remains fail-closed.
const gate=path.join(__dirname,'customer_release_gate.py'),gateText=fs.readFileSync(gate,'utf8').replace(/\r\n/g,'\n');
const feedback={current_feedback_ref:'fixture:current',cases:[{id:'APPROVED-CORRECTION',context:{source_ref:'fixture:approved'},expected_question:'요즘 어느 쪽을 살펴보고 계실까요?'}]};
const values={central_master:'central',master:'master',checkpoint:'checkpoint',central_checkpoint:'central-checkpoint',feedback:JSON.stringify(feedback),customers:'customers',release_gate:gateText};
const digest=x=>crypto.createHash('sha256').update(x.replace(/\r\n/g,'\n')).digest('hex');
const context={...values,source_sha256:Object.fromEntries(Object.entries(values).map(([k,v])=>[k,digest(v)]))};
const draft={status:'DRAFT_VALIDATED',source_ref:'fixture:approved',turns:['안녕하세요.','요즘 어느 쪽을 살펴보고 계실까요?'],phone_message:'',email_body:'요즘 어느 쪽을 살펴보고 계실까요?',cue_card:{}};
const payload=JSON.stringify({context,draft});
const code=`import importlib.util,json,sys\np=sys.argv[1];s=importlib.util.spec_from_file_location('g',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nx=json.load(sys.stdin);print(json.dumps(m.evaluate(x),ensure_ascii=False))`;
const python=process.env.WIC_BUNDLED_PYTHON||'python';
const run=input=>{const r=spawnSync(python,['-X','utf8','-c',code,gate],{input,encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(r.stderr);return JSON.parse(r.stdout)};
const approved=run(payload);assert.equal(approved.status,'DRAFT_VALIDATED');assert.equal(approved.output_allowed,true);assert.equal(approved.send_allowed,false);
const missing=run(JSON.stringify({context,draft:{...draft,source_ref:'fixture:kmg-unapproved'}}));
assert.equal(missing.status,'HOLD');assert.equal(missing.reason,'APPROVED_CUSTOMER_COPY_EVIDENCE_MISSING');
console.log(JSON.stringify({status:'REPRESENTATIVE_1_ONLY_PASS',wrapper_contract:'PASS',semantic_runtime:'PASS',renderer_runtime:'PASS',strict_full:format.status,toc_lines:expected.reports.map(x=>x.toc_lines.length),full_body_sha256:format.output_sha256,no_customer_name_hardcoding:'PASS',no_customer_specific_path:'PASS',no_fixture_specific_exception:'PASS',common_runtime_path:'PASS',common_format_contract:'PASS',format_stability:'HOLD_REQUIRES_SECOND_ACTUAL_CUSTOMER',remaining_external_inputs:[missing.reason,'SECOND_ACTUAL_CUSTOMER_COMPLETE_EXPECTED_OUTPUT_FIXTURE']},null,2));
