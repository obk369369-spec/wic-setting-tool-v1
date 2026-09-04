'use strict';
// Canonical requests use the preload/release boundary.  The established
// (state, candidates) contract remains a synchronous branch API.
const internal=require('./_customer_branch_internal');
const start=request=>require('./customer_work_start').startCustomerWork(request);
module.exports={
  branchCustomer:(state,candidates)=>Array.isArray(candidates)?internal.branchCustomer(state,candidates):start(state),
  prepareContactCopy:(state,context,reply)=>context!==undefined?internal.prepareContactCopy(state,context,reply):start(state),
  validateContactCopy:internal.validateContactCopy
};
if(require.main===module){
  start(JSON.parse(require('fs').readFileSync(0,'utf8'))).then(result=>{
    process.stdout.write(JSON.stringify(result)+'\n');process.exitCode=result.output_allowed===true?0:2;
  });
}
