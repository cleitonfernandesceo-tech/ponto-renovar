// 06/11/2026: liga a NVIDIA (gratis) no motor do JARVIS. Faz copia antes. Uso: node patch-nvidia-motor.js
const fs = require('fs');
const ARQ = 'C:\\IA-Renovar\\motor.js';
let s = fs.readFileSync(ARQ, 'utf8');
if (s.includes("tipo: 'nvidia'")) { console.log('ja tinha NVIDIA, nada feito'); process.exit(0); }
fs.writeFileSync(ARQ + '.antes-0611-nvidia', s);
function troca(velho, novo) {
  if (!s.includes(velho)) { console.error('NAO ACHEI: ' + velho.slice(0, 80)); process.exit(1); }
  s = s.replace(velho, novo);
}
// 1) motores
troca("  // Nivel 4: IA Local do PC", `  // 06/11/2026: NVIDIA build.nvidia.com (gratis, chave em C:\\renovar\\segredos\\nvidia.txt). Modelos testados vivos em 06/11.
  // 404/410 = modelo saiu (fica 24h fora); 429 = limite (fica fora o tempo pedido ou 15 min). Nunca trava a cadeia.
  nvidia: { tipo: 'nvidia', modelos: ['nvidia/nemotron-3-ultra-550b-a55b', 'mistralai/mistral-large-4-1t-a52b', 'minimaxai/minimax-m3.1-flash', 'google/gemma-4-31b-it', 'nvidia/nemotron-3.5-lightning-30b-a3b'], provedorId: 'nvidia', nome: 'NVIDIA (gratis)' },
  nvidiaCodigo: { tipo: 'nvidia', modelos: ['mistralai/mistral-large-4-1t-a52b', 'minimaxai/minimax-m3.1-flash', 'nvidia/nemotron-3-ultra-550b-a55b'], provedorId: 'nvidia', nome: 'NVIDIA codigo (gratis)' },
  nvidiaRapido: { tipo: 'nvidia', modelos: ['nvidia/nemotron-3.5-lightning-30b-a3b', 'google/gemma-4-31b-it', 'nvidia/nemotron-3-ultra-550b-a55b'], provedorId: 'nvidia', nome: 'NVIDIA rapida (gratis)' },

  // Nivel 4: IA Local do PC`);
// 2) cadeias: NVIDIA logo depois do Groq; OpenRouter gratis antes do Pollinations
const CAD = {
  "padrao: ['flash', 'sonnet', 'geminiApi', 'groq', 'nuvem', 'github', 'pollinations', 'local']": "padrao: ['flash', 'sonnet', 'geminiApi', 'groq', 'nvidia', 'nuvem', 'github', 'openrouterFree', 'pollinations', 'local']",
  "forte: ['opus', 'sonnet', 'geminiApi', 'groq', 'nuvemRaciocinio',": "forte: ['opus', 'sonnet', 'geminiApi', 'groq', 'nvidia', 'nuvemRaciocinio',",
  "rapido: ['flash', 'geminiApi', 'groq', 'nuvem', 'github', 'pollinations', 'gemma3']": "rapido: ['flash', 'geminiApi', 'groq', 'nvidiaRapido', 'nuvem', 'github', 'pollinations', 'gemma3']",
  "raciocinio: ['flash', 'geminiApi', 'groq', 'nuvemRaciocinio',": "raciocinio: ['flash', 'geminiApi', 'groq', 'nvidia', 'nuvemRaciocinio',",
  "codigo: ['flash', 'geminiApi', 'groq', 'nuvemCodigo',": "codigo: ['flash', 'geminiApi', 'groq', 'nvidiaCodigo', 'nuvemCodigo',",
  "criativo: ['flash', 'geminiApi', 'groq', 'nuvem', 'github', 'pollinations', 'hermes', 'local']": "criativo: ['flash', 'geminiApi', 'groq', 'nvidia', 'nuvem', 'github', 'openrouterFree', 'pollinations', 'hermes', 'local']",
  "codigoReal: ['flash', 'sonnet', 'nuvemCodigo',": "codigoReal: ['flash', 'sonnet', 'nvidiaCodigo', 'nuvemCodigo',",
  "forteCodigo: ['opus', 'sonnet', 'nuvemCodigo',": "forteCodigo: ['opus', 'sonnet', 'nvidiaCodigo', 'nuvemCodigo',",
  "soNuvem: ['nuvem', 'nuvemRaciocinio', 'github']": "soNuvem: ['nvidia', 'nuvem', 'nuvemRaciocinio', 'github']",
  "soNuvemCodigo: ['nuvemCodigo', 'githubCodigo']": "soNuvemCodigo: ['nvidiaCodigo', 'nuvemCodigo', 'githubCodigo']",
  "soLocal: ['groq', 'nuvem',": "soLocal: ['groq', 'nvidiaRapido', 'nuvem',",
};
for (const [a, b] of Object.entries(CAD)) troca(a, b);
// 3) chamada
troca("async function chamarOllama(motor, prompt, timeoutMs) {", `// 06/11/2026: NVIDIA gratis (API igual a da OpenAI). Chave lida do arquivo, nunca escrita em log.
const pausaNvidia = {};
async function chamarNvidiaMotor(motor, prompt) {
  let k = '';
  try { k = fs.readFileSync('C:\\\\renovar\\\\segredos\\\\nvidia.txt', 'utf8').trim(); } catch {}
  if (!k) return { ok: false, erro: 'chave NVIDIA ausente (NVIDIA desligada)' };
  let ultimoErro = 'sem modelo NVIDIA livre agora';
  for (const m of motor.modelos) {
    if (pausaNvidia[m] && Date.now() < pausaNvidia[m]) continue;
    try {
      const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': \`Bearer \${k}\` },
        body: JSON.stringify({ model: m, max_tokens: 4096, messages: [{ role: 'system', content: 'Responda sempre em portugues do Brasil, simples e direto.' }, { role: 'user', content: prompt }] }),
        signal: AbortSignal.timeout(120000)
      });
      if (res.status === 402) return { ok: false, cobranca: true, erro: 'NVIDIA pediu pagamento (402)' };
      if ([404, 410, 429, 503].includes(res.status)) {
        const ra = Number(res.headers.get('retry-after')) || 0;
        pausaNvidia[m] = Date.now() + (res.status === 404 || res.status === 410 ? 24 * 3600000 : Math.max(ra * 1000, 15 * 60000));
        ultimoErro = \`\${m}: HTTP \${res.status}\`; continue;
      }
      const j = await res.json().catch(() => ({}));
      const text = String(j?.choices?.[0]?.message?.content || '').replace(/<think>[\\s\\S]*?<\\/think>/g, '').trim();
      if (res.ok && text) return { ok: true, text };
      ultimoErro = \`\${m}: HTTP \${res.status}\`;
    } catch (e) { ultimoErro = \`\${m}: \${e.message}\`; }
  }
  return { ok: false, erro: ultimoErro };
}

async function chamarOllama(motor, prompt, timeoutMs) {`);
troca("    } else if (motor.tipo === 'groq') {\n      r = await chamarGroqMotor(motor, prompt);", "    } else if (motor.tipo === 'groq') {\n      r = await chamarGroqMotor(motor, prompt);\n    } else if (motor.tipo === 'nvidia') {\n      r = await chamarNvidiaMotor(motor, prompt);");
fs.writeFileSync(ARQ, s);
console.log('OK: NVIDIA ligada no motor (copia em motor.js.antes-0611-nvidia)');
