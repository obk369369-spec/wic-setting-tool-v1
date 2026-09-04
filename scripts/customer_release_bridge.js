'use strict';
const path=require('path'),{spawnSync}=require('child_process');
function release(context,draft){
  const python=process.env.WIC_BUNDLED_PYTHON||'python';
  const run=spawnSync(python,['-X','utf8',path.join(__dirname,'customer_release_gate.py')],{
    input:JSON.stringify({context,draft}),encoding:'utf8',timeout:90000,maxBuffer:1024*1024,windowsHide:true});
  try{
    const result=JSON.parse(run.stdout);
    const hold=result.output_allowed===false&&result.status==='HOLD';
    const evidencePass=result.output_allowed===true&&result.status==='DRAFT_VALIDATED'&&result.send_allowed===false;
    if(!hold&&!evidencePass)throw Error('UNEXPECTED_RELEASE');
    return result;
  }catch(error){return {status:'HOLD',reason:'COMMON_RELEASE_GATE_UNAVAILABLE',output_allowed:false,rows:[],turns:[],phone_message:'',email_body:'',guidance_message:'',recommendations:[],cue_card:{},send_allowed:false};}
}
module.exports={release};
