"use strict";
const fs=require("fs"), path=require("path"), {execFileSync}=require("child_process");
const root=__dirname;
const checks=[];
const file=(name)=>fs.existsSync(path.join(root,name));
function add(name,ok,detail){checks.push({name,status:ok?"PASS":"FAIL",detail});}
add("AI server",file("server-v2.js"),"server-v2.js present");
add("Quant engine",file("quant-pipeline.py"),"quant-pipeline.py present");
add("News/Sentiment",file("sentiment.js"),"sentiment.js present");
add("Quarterly results",file("quarterly-results.py"),"quarterly-results.py present");
try { execFileSync("python",[path.join(root,"quant-pipeline.py"),"--help"],{stdio:"pipe",timeout:15000}); add("Quant Python runtime",true,"python executable and pipeline start successfully"); }
catch(e){ add("Quant Python runtime",false,String(e.message||e).slice(0,200)); }
for(const [name,key] of [["Gemini","GEMINI_API_KEY"],["Groq","GROQ_API_KEY"]]) add(name,!!process.env[key],process.env[key]?"key configured in runtime":"key not configured (not stored in GitHub)");
const failed=checks.filter(x=>x.status==="FAIL");
console.log(JSON.stringify({status:failed.length?"FAIL":"PASS",checks},null,2));
process.exitCode=failed.length?1:0;
