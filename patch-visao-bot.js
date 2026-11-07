// 06/11/2026: foto no Telegram -> JARVIS le com IA gratis (visao.js). Copia antes.
const fs = require('fs');
const ARQ = 'C:\\IA-Renovar\\index.js';
let s = fs.readFileSync(ARQ, 'utf8');
if (s.includes("require('./visao.js')")) { console.log('ja tinha visao'); process.exit(0); }
const velho = "        const isAudio = Boolean(msg.voice || msg.audio);";
if (!s.includes(velho)) { console.error('NAO ACHEI o ponto'); process.exit(1); }
fs.writeFileSync(ARQ + '.antes-0611-visao', s);
s = s.replace(velho, `        // 06/11/2026: foto (ou imagem mandada como arquivo) -> visao gratis (NVIDIA, reserva Gemini API). Legenda = pergunta.
        const docImagem = msg.document && /^image\\//.test(msg.document.mime_type || '') ? msg.document : null;
        if (msg.photo || docImagem) {
          const fid = docImagem ? docImagem.file_id : msg.photo[msg.photo.length - 1].file_id;
          const mime = docImagem ? docImagem.mime_type : 'image/jpeg';
          await sendSafeMessage(chatId, 'Analisando a foto...');
          const link = await bot.getFileLink(fid);
          const buf = Buffer.from(await (await fetch(link)).arrayBuffer());
          const r = await require('./visao.js').analisarImagem(buf, mime, msg.caption || '');
          await sendSafeMessage(chatId, r.ok ? r.text : 'Nao consegui ler a foto agora: ' + String(r.erro).slice(0, 200));
          return;
        }
${velho}`);
fs.writeFileSync(ARQ, s);
console.log('OK: visao ligada no bot');
