"use strict";
const crypto=require("crypto");
const uniq=a=>[...new Set(a)];
const shaOk=v=>/^[0-9a-f]{40}$/i.test(String(v||""));
const hash=s=>crypto.createHash("sha256").update(String(s).replace(/\r\n/g,"\n"),"utf8").digest("hex");

function validateCustomerGuidanceOutput(output,expected){
 const errors=[],holds=[],checks=[];
 const add=(id,status,detail="")=>checks.push({id,status,detail});
 const fail=(id,detail="")=>{errors.push(id);add(id,"FAIL",detail)};
 const hold=(id,detail="")=>{holds.push(id);add(id,"HOLD",detail)};
 const pass=(id,detail="")=>add(id,"PASS",detail);
 const text=String(output||"").replace(/\r\n/g,"\n"),lines=text.split("\n"),nonempty=lines.filter(x=>x.trim());
 const ev=expected.evidence||{};
 if(!shaOk(ev.work_start_rules_sha)||!shaOk(ev.work_start_checkpoint_sha)||!shaOk(ev.pre_output_rules_sha)||!shaOk(ev.pre_output_checkpoint_sha)) fail("READBACK_EVIDENCE","master/checkpoint SHA missing"); else pass("READBACK_EVIDENCE");
 const f=expected.feedback_evidence||{};
 if(expected.feedback_evidence&&(!shaOk(f.master_commit_sha)||!shaOk(f.checkpoint_commit_sha)||f.remote_readback_match!==true)) fail("FEEDBACK_EVIDENCE","feedback evidence invalid"); else pass("FEEDBACK_EVIDENCE");
 if(expected.prior_send_history_verified!==true) hold("PRIOR_SEND_HISTORY","unverified"); else pass("PRIOR_SEND_HISTORY");
 if(expected.validation_contract!=="STRICT_FULL_V1") fail("STRICT_VALIDATION_CONTRACT","validation_contract must be STRICT_FULL_V1"); else pass("STRICT_VALIDATION_CONTRACT");
 if(!/^[0-9a-f]{64}$/i.test(String(expected.user_visible_output_sha256||""))) fail("USER_VISIBLE_OUTPUT_HASH_REQUIRED","64-char sha256 required"); else pass("USER_VISIBLE_OUTPUT_HASH_REQUIRED");
 const reports=Array.isArray(expected.reports)?expected.reports:[];
 const requiredCount=Number.isInteger(expected.required_report_count)?expected.required_report_count:reports.length;
 if(requiredCount<1) fail("REPORT_COUNT","required_report_count must be >=1");
 else if(reports.length!==requiredCount) fail("REPORT_COUNT",`expected reports ${reports.length}/${requiredCount}`); else pass("REPORT_COUNT",`${reports.length}/${requiredCount}`);
 const publishers=reports.map(r=>String(r.publisher||"").trim()).filter(Boolean);
 if(publishers.length!==reports.length) hold("PUBLISHER_SET_COMPLETE","publisher missing"); else pass("PUBLISHER_SET_COMPLETE",`${publishers.length}/${reports.length}`);
 if(new Set(publishers.map(x=>x.toLowerCase())).size!==publishers.length) fail("PUBLISHER_DUPLICATE","all N reports must use different publishers"); else pass("PUBLISHER_DUPLICATE","all unique");
 reports.forEach((r,i)=>{
  const n=i+1;
  if(r.toc_match_mode!==undefined||r.toc_min_lines!==undefined) fail(`R${n}_LOOSE_TOC_FIELDS_FORBIDDEN`,`toc_match_mode/toc_min_lines forbidden`); else pass(`R${n}_LOOSE_TOC_FIELDS_FORBIDDEN`);
  if(r.toc_contract!=="EXACT_FULL") fail(`R${n}_TOC_CONTRACT`,`toc_contract must be EXACT_FULL`); else pass(`R${n}_TOC_CONTRACT`);
  if(r.toc_source_verified!==true) hold(`R${n}_TOC_SOURCE`,`not verified`); else pass(`R${n}_TOC_SOURCE`);
  if(!r.english_title||!r.korean_title||!r.publisher||!r.url) hold(`R${n}_CORE_FIELDS`,`missing core field`); else pass(`R${n}_CORE_FIELDS`);
  if(!Array.isArray(r.toc_lines)||!r.toc_lines.length) hold(`R${n}_FULL_TOC_EXPECTED`,`full toc_lines missing`); else pass(`R${n}_FULL_TOC_EXPECTED`,`${r.toc_lines.length} lines`);
 });
 if(expected.mode==="preflight")return{status:errors.length?"FAIL":holds.length?"HOLD":"PASS",errors:uniq(errors),holds:uniq(holds),checks};
 const subject=`메일 제목: [해외시장자료 안내] ${expected.institution} ${expected.name}님`,email=`이메일 주소: ${expected.email}`;
 if(nonempty[0]!==subject)fail("MAIL_SUBJECT","mismatch");else pass("MAIL_SUBJECT");
 if(nonempty[1]!==email)fail("EMAIL","mismatch");else pass("EMAIL");
 const starts=Array.from({length:requiredCount},(_,i)=>i+1).map(n=>lines.findIndex(x=>x.trim()===`추천자료 ${n}`)),headers=lines.filter(x=>/^추천자료\s+\d+\s*$/.test(x.trim()));
 const ordered=starts.every((x,i)=>x>=0&&(i===0||starts[i-1]<x));
 if(starts.some(x=>x<0)||headers.length!==requiredCount||!ordered)fail("ACTUAL_REPORT_COUNT",`not exactly ${requiredCount} ordered blocks`);else pass("ACTUAL_REPORT_COUNT",`${requiredCount}/${requiredCount}`);
 for(let i=0;i<reports.length;i++){
  const n=i+1,r=reports[i],start=starts[i],next=i<reports.length-1&&starts[i+1]>=0?starts[i+1]:lines.length;if(start<0)continue;
  const block=lines.slice(start,next),find=rx=>block.findIndex(x=>rx.test(x.trim()));
  const e=find(/^##\s+영문 제목:/),k=find(/^##\s+한글 제목(?:\(참고 번역\))?:/),p=find(/^◇ 발행사:/),d=find(/^◇ 발행일:/),u=find(/^자세한 내용의 링크:/),t=find(/^목차:$/),info=find(/^보고서 정보:\s*$/);
  if([e,k,p,d,u,t,info].some(x=>x<0))fail(`R${n}_FIELD_ORDER_OR_MISSING`);else if(!(e<k&&k<p&&p<d&&d<u&&u<t&&t<info))fail(`R${n}_FIELD_ORDER_OR_MISSING`,`wrong order`);else pass(`R${n}_FIELD_ORDER_OR_MISSING`);
  if(e<0||block[e].trim().replace(/^##\s+영문 제목:\s*/,"")!==r.english_title)fail(`R${n}_OFFICIAL_ENGLISH_TITLE`);else pass(`R${n}_OFFICIAL_ENGLISH_TITLE`);
  if(k<0||block[k].trim().replace(/^##\s+한글 제목(?:\(참고 번역\))?:\s*/,"")!==r.korean_title)fail(`R${n}_FULL_KOREAN_TITLE`);else pass(`R${n}_FULL_KOREAN_TITLE`);
  if(p<0){fail(`R${n}_BOOK_INFO_LINE1`)}else{const v=block[p].trim();if(!v.includes(`◇ 발행사: ${r.publisher}`))fail(`R${n}_PUBLISHER`);else pass(`R${n}_PUBLISHER`);if(r.pages&&!v.includes(`( ${r.pages} Pages )`))fail(`R${n}_PAGES`);else pass(`R${n}_PAGES`);if(r.price_display&&!v.includes(`◇ 정가: ${r.price_display}`))fail(`R${n}_PRICE`);else pass(`R${n}_PRICE`);if(!/^◇ 발행사:.*\(\s*[^)]*Pages\s*\).*◇ 정가:/.test(v))fail(`R${n}_BOOK_INFO_LINE1`);else pass(`R${n}_BOOK_INFO_LINE1`);}
  if(d<0){fail(`R${n}_BOOK_INFO_LINE2`)}else{const v=block[d].trim();if(r.publication_date_display&&!v.includes(`◇ 발행일: ${r.publication_date_display}`))fail(`R${n}_PUBLICATION_DATE`);else pass(`R${n}_PUBLICATION_DATE`);if(!/-PDF-.*◆ 공급가격:/.test(v))fail(`R${n}_BOOK_INFO_LINE2`);else pass(`R${n}_BOOK_INFO_LINE2`);}
  if(u<0){fail(`R${n}_URL_EXACT`);fail(`R${n}_TRACKING_URL`)}else{const url=block[u].trim().replace(/^자세한 내용의 링크:\s*/,"");if(url!==r.url)fail(`R${n}_URL_EXACT`);else pass(`R${n}_URL_EXACT`);if(/[?&](?:utm_[^=]+|fbclid|gclid|mc_cid|mc_eid|_ga|_gl)=|chatgpt\.com/i.test(url))fail(`R${n}_TRACKING_URL`);else pass(`R${n}_TRACKING_URL`,`stored/output URL clean`);}
  if(t<0||info<=t){fail(`R${n}_TOC_SECTION`)}else{
   pass(`R${n}_TOC_SECTION`);
   const toc=block.slice(t+1,info).filter(x=>x.trim()).map(x=>x.replace(/\s+$/, ""));
   const exp=(r.toc_lines||[]).map(x=>String(x).replace(/\s+$/, ""));
   if(toc.length!==exp.length)fail(`R${n}_TOC_FULL_LENGTH`,`${toc.length}/${exp.length}`);else pass(`R${n}_TOC_FULL_LENGTH`,`${toc.length}/${exp.length}`);
   if(toc.join("\n")!==exp.join("\n"))fail(`R${n}_TOC_EXACT_ALL_LINES`);else pass(`R${n}_TOC_EXACT_ALL_LINES`);
   if(!exp.length||toc.at(-1)!==exp.at(-1))fail(`R${n}_TOC_LAST_ITEM`);else pass(`R${n}_TOC_LAST_ITEM`,exp.at(-1));
   let numberingOK=true,indentOK=true;
   for(let j=0;j<Math.max(toc.length,exp.length);j++){
    const ex=exp[j]??"",ac=toc[j]??"";
    const expNum=(ex.trim().match(/^(\d+(?:\.\d+)*\.?|Chapter-\s*\d+)/i)||[,""])[1];
    const actNum=(ac.trim().match(/^(\d+(?:\.\d+)*\.?|Chapter-\s*\d+)/i)||[,""])[1];
    if(expNum!==actNum)numberingOK=false;
    if((ac.match(/^\s*/)||[""])[0].length!==(ex.match(/^\s*/)||[""])[0].length)indentOK=false;
   }
   if(!numberingOK)fail(`R${n}_TOC_NUMBER_COPYABLE`);else pass(`R${n}_TOC_NUMBER_COPYABLE`);
   if(!indentOK)fail(`R${n}_TOC_INDENTATION`);else pass(`R${n}_TOC_INDENTATION`);
   const subExp=exp.filter(x=>/^\s+\S/.test(x)),subAct=toc.filter(x=>/^\s+\S/.test(x));
   if(subAct.length!==subExp.length||subAct.join("\n")!==subExp.join("\n"))fail(`R${n}_TOC_SUBHEADINGS_ALL_PRESENT`,`${subAct.length}/${subExp.length}`);else pass(`R${n}_TOC_SUBHEADINGS_ALL_PRESENT`,`${subAct.length}/${subExp.length}`);
  }
  if(info<0){fail(`R${n}_REPORT_INFO_LABEL_SEPARATE`);fail(`R${n}_REPORT_INFO_BODY`)}else{const body=(block[info+1]||"").trim();if(block[info].trim()!=="보고서 정보:")fail(`R${n}_REPORT_INFO_LABEL_SEPARATE`);else pass(`R${n}_REPORT_INFO_LABEL_SEPARATE`);if(!body)fail(`R${n}_REPORT_INFO_BODY`);else pass(`R${n}_REPORT_INFO_BODY`);if(r.report_info_ko_exact!==undefined&&body!==r.report_info_ko_exact)fail(`R${n}_REPORT_INFO_EXACT`);else pass(`R${n}_REPORT_INFO_EXACT`);}
 }
 const actualHash=hash(text);
 if(!/^[0-9a-f]{64}$/i.test(String(expected.user_visible_output_sha256||""))) fail("USER_VISIBLE_OUTPUT_EXACT","expected hash missing");
 else if(actualHash!==expected.user_visible_output_sha256)fail("USER_VISIBLE_OUTPUT_EXACT","final user-visible body differs from validated fixture");else pass("USER_VISIBLE_OUTPUT_EXACT",actualHash);
 return{status:errors.length?"FAIL":holds.length?"HOLD":"PASS",errors:uniq(errors),holds:uniq(holds),checks,output_sha256:actualHash};
}

function renderCustomerGuidance(expected){
 const blocks=(expected.reports||[]).map((r,i)=>[
  `추천자료 ${i+1}`,
  `## 영문 제목: ${r.english_title}`,
  `## 한글 제목: ${r.korean_title}`,
  `◇ 발행사: ${r.publisher}${' '.repeat(25)}( ${r.pages||''} Pages )${' '.repeat(8)}◇ 정가: ${r.price_display||''}`,
  `◇ 발행일: ${r.publication_date_display||''}${' '.repeat(18)}-PDF-${' '.repeat(8)}◆ 공급가격: `,
  `자세한 내용의 링크: ${r.url}`,
  '목차:',...(r.toc_lines||[]),'보고서 정보:',r.report_info_ko_exact||''
 ].join('\n'));
 return [`메일 제목: [해외시장자료 안내] ${expected.institution} ${expected.name}님`,
  `이메일 주소: ${expected.email}`,blocks.join('\n\n')].join('\n')+'\n';
}

function selfTest(){
 const s="a".repeat(40);
 const makeBase=count=>({institution:"기관",name:"고객",email:"a@b.com",required_report_count:count,prior_send_history_verified:true,validation_contract:"STRICT_FULL_V1",evidence:{work_start_rules_sha:s,work_start_checkpoint_sha:s,pre_output_rules_sha:s,pre_output_checkpoint_sha:s},feedback_evidence:{master_commit_sha:s,checkpoint_commit_sha:s,remote_readback_match:true},reports:Array.from({length:count},(_,i)=>{const n=i+1;return{english_title:`Title ${n}`,korean_title:`제목 ${n}`,publisher:`Pub ${n}`,pages:"100",price_display:"$ 1",publication_date_display:"2026년",url:`https://example.com/${n}`,toc_contract:"EXACT_FULL",toc_source_verified:true,toc_lines:["1. Main","  1.1 Sub","2. End"],report_info_ko_exact:"정보"}})});
 const report=(n,r)=>[`추천자료 ${n}`,`## 영문 제목: ${r.english_title}`,`## 한글 제목: ${r.korean_title}`,`◇ 발행사: ${r.publisher} ( ${r.pages} Pages ) ◇ 정가: ${r.price_display}`,`◇ 발행일: ${r.publication_date_display} -PDF- ◆ 공급가격: `,`자세한 내용의 링크: ${r.url}`,"목차:",...r.toc_lines,"보고서 정보:",r.report_info_ko_exact].join("\n");
 const makeRaw=base=>[`메일 제목: [해외시장자료 안내] 기관 고객님`,`이메일 주소: a@b.com`,...base.reports.map((r,i)=>report(i+1,r))].join("\n");
 const tests=[];
 const run=(name,out,exp,want)=>{const got=validateCustomerGuidanceOutput(out,exp).status;tests.push({name,got,want});if(got!==want)throw new Error(`${name}:${got}!=${want}`)};
 const base3=makeBase(3),raw3=makeRaw(base3);base3.user_visible_output_sha256=hash(raw3);
 run("exact_full_3_pass",raw3,base3,"PASS");
 run("subheading_removed",raw3.replace("  1.1 Sub\n",""),base3,"FAIL");
 run("tracking_added",raw3.replace("https://example.com/1","https://example.com/1?utm_source=chatgpt.com"),base3,"FAIL");
 run("third_report_removed",raw3.replace(/추천자료 3[\s\S]*$/,""),base3,"FAIL");
 const loose=JSON.parse(JSON.stringify(base3));loose.reports[0].toc_match_mode="required";run("loose_mode_forbidden",raw3,loose,"FAIL");
 const nohash=JSON.parse(JSON.stringify(base3));delete nohash.user_visible_output_sha256;run("hash_required",raw3,nohash,"FAIL");
 const base4=makeBase(4),raw4=makeRaw(base4);base4.user_visible_output_sha256=hash(raw4);run("exact_full_4_pass",raw4,base4,"PASS");
 const dup=JSON.parse(JSON.stringify(base4));dup.reports[3].publisher=dup.reports[0].publisher;const dupRaw=makeRaw(dup);dup.user_visible_output_sha256=hash(dupRaw);run("publisher_duplicate_4_fail",dupRaw,dup,"FAIL");
 return{status:"PASS",tests};
}

if(typeof module!=="undefined")module.exports={validateCustomerGuidanceOutput,renderCustomerGuidance};
if(typeof require!=="undefined"&&require.main===module){
 const fs=require("fs"),a=process.argv.slice(2);
 if(a[0]==="--self-test"){process.stdout.write(JSON.stringify(selfTest(),null,2)+"\n");process.exit(0);}
 if(a[0]==="--render"){
  const expected=JSON.parse(fs.readFileSync(a[1],"utf8")),rendered=renderCustomerGuidance(expected);
  if(a[2])fs.writeFileSync(a[2],rendered,"utf8");else process.stdout.write(rendered);
  process.exit(0);
 }
 const emit=a[0]==="--emit-if-pass",o=emit?a[1]:a[0],e=emit?a[2]:a[1];
 if(!o||!e){process.stderr.write("Usage: node customer_guidance_output_gate.js [--emit-if-pass] <output.txt> <expected.json> | --self-test\n");process.exit(2);}
 const raw=fs.readFileSync(o,"utf8"),r=validateCustomerGuidanceOutput(raw,JSON.parse(fs.readFileSync(e,"utf8")));
 if(emit){
  const expected=JSON.parse(fs.readFileSync(e,"utf8"));
  require('./customer_work_start').loadCanonical().then(context=>{
    const result=require('./customer_release_bridge').release(context,{text:raw,format_check:r,customer_id:expected.customer_id});
    process.stdout.write(JSON.stringify(result)+"\n");process.exitCode=2;
  }).catch(()=>{process.stdout.write(JSON.stringify(require('./customer_release_bridge').release({},{}))+"\n");process.exitCode=2;});
 }else{
  process.stdout.write(JSON.stringify({...r,output_allowed:false,scope:"FORMAT_DIAGNOSTIC_ONLY_NOT_CUSTOMER_RELEASE"},null,2)+"\n");
  process.exitCode=r.status==="PASS"?0:1;
 }
}
