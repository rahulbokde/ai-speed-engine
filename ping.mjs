// ============================================================================
//  ping.mjs  —  CalcCopilot AI Speed Engine
//  Measures Time-To-First-Token (TTFT) and tokens/second for free-tier LLMs
//  and writes data.json.  Runs on GitHub Actions (Node 20+, zero npm deps).
//  API keys are read from environment variables (GitHub Actions Secrets).
//  Nothing here is secret — safe to keep in a PUBLIC repo.
// ============================================================================

import { readFile, writeFile } from "node:fs/promises";

const PROMPT     = "In exactly one paragraph of about 120 words, explain how a bicycle stays upright when it is moving. Write plain prose, no lists.";
const MAX_TOKENS = 220;   // fixed output length => fair tokens/sec
const SAMPLES    = 3;     // median of 3 kills network blips
const TIMEOUT_MS = 30000;
const HISTORY_CAP = 96;   // 96 snapshots ~= 48h at 30-min cadence

// Free-tier line-up (verified current 2026-09-04). `price` = approx published
// OUTPUT $/1M tokens (value column only — free-tier testing itself is free).
// ⚠️ Providers deprecate models often: Groq killed llama-3.1/3.3 (Aug 16 2026);
// Cerebras narrowed to gpt-oss-120b/gemma. If a model errors, the reason is now
// saved in data.json ("note") and the Actions log — swap in a current model ID.
// Cerebras free tier = 5 requests/min, so only ONE Cerebras model here to be safe.
const MODELS = [
  { id:"cere-gptoss",    label:"GPT-OSS 120B", provider:"Cerebras", price:0.75,
    base:"https://api.cerebras.ai/v1/chat/completions", model:"gpt-oss-120b", keyEnv:"CEREBRAS_API_KEY" },
  { id:"groq-gptoss120", label:"GPT-OSS 120B", provider:"Groq", price:0.60,
    base:"https://api.groq.com/openai/v1/chat/completions", model:"openai/gpt-oss-120b", keyEnv:"GROQ_API_KEY" },
  { id:"groq-gptoss20",  label:"GPT-OSS 20B", provider:"Groq", price:0.30,
    base:"https://api.groq.com/openai/v1/chat/completions", model:"openai/gpt-oss-20b", keyEnv:"GROQ_API_KEY" },
  { id:"gem-flash20",    label:"Gemini 2.0 Flash", provider:"Google", price:0.40,
    base:"https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", model:"gemini-2.0-flash", keyEnv:"GEMINI_API_KEY" },
  { id:"gem-flash25",    label:"Gemini 2.5 Flash", provider:"Google", price:2.50,
    base:"https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", model:"gemini-2.5-flash", keyEnv:"GEMINI_API_KEY" },
  { id:"or-deepseek",    label:"DeepSeek R1", provider:"OpenRouter (free)", price:0.55,
    base:"https://openrouter.ai/api/v1/chat/completions", model:"deepseek/deepseek-r1:free", keyEnv:"OPENROUTER_API_KEY" },
  { id:"or-qwen72",      label:"Qwen 2.5 72B", provider:"OpenRouter (free)", price:0.40,
    base:"https://openrouter.ai/api/v1/chat/completions", model:"qwen/qwen-2.5-72b-instruct:free", keyEnv:"OPENROUTER_API_KEY" },
];

function median(a){
  if(!a.length) return null;
  const s = a.slice().sort((x,y)=>x-y), m = Math.floor(s.length/2);
  return s.length % 2 ? s[m] : (s[m-1]+s[m]) / 2;
}

// One streamed request. Returns { ttft, tps } in seconds / tokens-per-second.
async function measureOnce(m, key){
  const ctrl = new AbortController();
  const to = setTimeout(()=>ctrl.abort(), TIMEOUT_MS);
  const start = performance.now();
  let firstAt = null, text = "", completionTokens = null;
  try {
    const res = await fetch(m.base, {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: m.model, stream: true,
        temperature: 0, max_tokens: MAX_TOKENS,
        messages: [{ role: "user", content: PROMPT }]
      }),
      signal: ctrl.signal
    });
    if(!res.ok || !res.body){
      let detail = "";
      try { detail = (await res.text()).replace(/\s+/g, " ").slice(0, 160); } catch {}
      throw new Error("HTTP " + res.status + (detail ? ": " + detail : ""));
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for(;;){
      const { done, value } = await reader.read();
      if(done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while((idx = buf.indexOf("\n")) >= 0){
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if(!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if(payload === "[DONE]") continue;
        let j; try { j = JSON.parse(payload); } catch { continue; }
        const c = j.choices && j.choices[0];
        const delta = c && c.delta && c.delta.content;
        if(delta){ if(firstAt === null) firstAt = performance.now(); text += delta; }
        if(j.usage && j.usage.completion_tokens) completionTokens = j.usage.completion_tokens;
      }
    }
  } finally { clearTimeout(to); }

  const end = performance.now();
  if(firstAt === null || !text) throw new Error("no output");
  const ttft   = (firstAt - start) / 1000;
  const genSec = Math.max((end - firstAt) / 1000, 0.001);
  const toks   = completionTokens || Math.max(1, Math.round(text.length / 4));
  return { ttft, tps: toks / genSec };
}

async function measure(m){
  const key = process.env[m.keyEnv];
  if(!key) return { id:m.id, label:m.label, provider:m.provider, price:m.price, status:"skipped" };
  const ttfts = [], tpss = [];
  let lastErr = "";
  for(let i = 0; i < SAMPLES; i++){
    try { const r = await measureOnce(m, key); ttfts.push(r.ttft); tpss.push(r.tps); }
    catch(e) { lastErr = String((e && e.message) || e); }
    await new Promise(r => setTimeout(r, 400));
  }
  if(!tpss.length){
    console.log(`  └ ${m.id} error: ${lastErr}`);
    return { id:m.id, label:m.label, provider:m.provider, price:m.price, status:"error", note: lastErr.slice(0,160) };
  }
  return {
    id:m.id, label:m.label, provider:m.provider, price:m.price, status:"ok",
    ttft: +median(ttfts).toFixed(2),
    tps:  +median(tpss).toFixed(0)
  };
}

// ---- run all models sequentially (gentle on free rate limits) --------------
const results = [];
for(const m of MODELS){
  const r = await measure(m);
  console.log(`${r.id}: ${r.status === "ok" ? r.tps + " tok/s, " + r.ttft + "s TTFT" : r.status}`);
  results.push(r);
}

// ---- append to rolling history --------------------------------------------
let prev = {};
try { prev = JSON.parse(await readFile("data.json", "utf8")); } catch { /* first run */ }
const history = Array.isArray(prev.history) ? prev.history : [];
const now = new Date();
const scores = {};
results.forEach(r => { if(r.status === "ok") scores[r.id] = r.tps; });
history.push({ t: now.toISOString().slice(11,16) + " UTC", scores });
while(history.length > HISTORY_CAP) history.shift();

const out = {
  updated: now.toISOString().replace("T"," ").slice(0,16) + " UTC",
  vantage: process.env.VANTAGE || "GitHub Actions runner (US)",
  sample: false,
  models: results,
  history
};
await writeFile("data.json", JSON.stringify(out, null, 2));
console.log("Wrote data.json with " + results.filter(r=>r.status==="ok").length + " live models.");
