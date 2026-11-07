// 06/11/2026: Bancada le foto da placa primeiro pela NVIDIA gratis (Nemotron VL 120B), depois Cloudflare, depois PC. Copia antes.
const fs = require('fs');
const ARQ = 'C:\\renovar\\bancada\\src\\visaoPlaca.js';
let s = fs.readFileSync(ARQ, 'utf8');
if (s.includes('IA-Renovar/visao.js')) { console.log('ja tinha'); process.exit(0); }
const marca = '  // 1. Tenta Nuvem Workers AI';
if (!s.includes(marca)) { console.error('NAO ACHEI'); process.exit(1); }
fs.writeFileSync(ARQ + '.antes-0611-nvidia', s);
s = s.replace(marca, `  // 0. (06/11/2026) NVIDIA gratis, modelo forte que le imagem (Nemotron VL 120B); reserva interna: Gemini API.
  try {
    const { createRequire } = await import('module');
    const req = createRequire(import.meta.url);
    const visao = req('C:/IA-Renovar/visao.js');
    const buf = Buffer.isBuffer(bufferOuBase64) ? bufferOuBase64 : Buffer.from(String(bufferOuBase64).replace(/^data:image\\/[a-zA-Z0-9+.-]+;base64,/, ''), 'base64');
    const r0 = await visao.analisarImagem(buf, 'image/jpeg', prompt);
    if (r0.ok && r0.text) {
      return { sucesso: true, motor: 'NVIDIA gratis (' + r0.modelo + ')', resposta: r0.text, nuvem: true, geminiNoLimite };
    }
  } catch (errNv) {
    console.warn('[Bancada] NVIDIA falhou:', errNv.message);
  }

${marca}`);
fs.writeFileSync(ARQ, s);
console.log('OK: NVIDIA na visao da Bancada');
