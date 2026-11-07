// 06/11/2026: GitHub Models foi descontinuado (30/07/2026). Tira das cadeias do motor (o motor continua definido, so nao e chamado).
const fs = require('fs');
const ARQ = 'C:\\IA-Renovar\\motor.js';
let s = fs.readFileSync(ARQ, 'utf8');
const ini = s.indexOf('const CADEIAS = {');
const fim = s.indexOf('};', ini);
if (ini < 0 || fim < 0) { console.error('CADEIAS nao achada'); process.exit(1); }
const bloco = s.slice(ini, fim);
const novo = bloco.replace(/,\s*'github(Codigo|Raciocinio)?'/g, '').replace(/'github(Codigo|Raciocinio)?',\s*/g, '');
if (novo === bloco) { console.log('nada a tirar'); process.exit(0); }
fs.writeFileSync(ARQ + '.antes-0611-github', s);
s = s.slice(0, ini) + '// 06/11/2026: GitHub Models saiu das cadeias (descontinuado pela Microsoft em 30/07/2026).\n' + novo + s.slice(fim);
fs.writeFileSync(ARQ, s);
console.log('OK: github fora das cadeias');
