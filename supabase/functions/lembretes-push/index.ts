/* =========================================================================
   PONTO RENOVAR - lembretes-push
   Manda o lembrete de batida como AVISO DO CELULAR mesmo com o app fechado.
   Quem chama e o pg_cron (8h, 9h, 12h e 13h de Brasilia); a funcao decide
   quem esta devendo batida e dispara o Web Push para os aparelhos inscritos.

   Regras espelhadas do app (ponto-renovar.jsx):
     8h  sem nenhuma batida  -> "Hora de bater o ponto"
     9h  sem nenhuma batida  -> "Entrada ainda nao registrada"
     12h com 1 batida        -> "Saida pro almoco"   (so seg-sex)
     13h com 2 batidas       -> "Volta do almoco"    (so seg-sex)
   Domingo e feriado nacional nao geram lembrete.

   Alem das batidas, esta funcao manda o aviso das reunioes do time. O cron
   chama com {"etapa":"reuniao_saida"} no fim da tarde e com
   {"etapa":"reuniao_chegada"} de manha: assim cada reuniao avisa duas vezes,
   ao sair no dia anterior e ao chegar no dia, sempre dizendo o horario, a
   duracao e a pauta prevista. O calendario e o mesmo do app (RITUAIS).

   Trava: push_lembretes_log tem chave (usuario_id, dia, etapa), entao ninguem
   recebe o mesmo aviso duas vezes, mesmo que o cron rode repetido.
   Segredos usados: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
   ========================================================================= */
import webpush from "npm:web-push@3.6.7";

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const VAPID_PUB = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIV = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJ = Deno.env.get("VAPID_SUBJECT") ?? "mailto:cleitonfernandes.ceo@gmail.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ETAPAS = {
  ent8: { titulo: "⏰ Hora de bater o ponto", corpo: "Seu expediente comecou as 8:00 — registre sua entrada.", batidas: 0 },
  ent9: { titulo: "⏰ Entrada ainda nao registrada", corpo: "Ja passa das 9:00 e sua entrada de hoje nao foi registrada.", batidas: 0 },
  alm12: { titulo: "🍽 Saida pro almoco", corpo: "Lembre de registrar a saida pro intervalo.", batidas: 1 },
  alm13: { titulo: "🍽 Volta do almoco", corpo: "Lembre de registrar o retorno do intervalo.", batidas: 2 },
};
const ETAPA_DA_HORA = { 8: "ent8", 9: "ent9", 12: "alm12", 13: "alm13" };

/* ---------- reunioes do time ----------
   Espelho de RITUAIS/reunioesDoDia do ponto-renovar.jsx. O calendario e
   deterministico (nao ha tabela de agenda): segunda tem o planejamento,
   segunda de semana ISO par tem tambem a quinzenal, e a ultima sexta do mes
   tem a retrospectiva. Se mudar no app, mude aqui - os testes conferem. */
const RITUAIS = [
  { id: "semanal", icone: "🗓", nome: "Planejamento da semana", inicio: "09:15", duracaoMin: 45,
    pauta: "check-in de energia, metas da semana e dependencias" },
  { id: "quinzenal", icone: "🧩", nome: "Resolucao de problemas - 3 Pilares", inicio: "14:00", duracaoMin: 60,
    pauta: "o maior gargalo dos ultimos 15 dias visto pelos tres pilares" },
  { id: "mensal", icone: "📊", nome: "Retrospectiva do mes", inicio: "15:00", duracaoMin: 60,
    pauta: "numeros do mes e elogios profissionais direcionados" },
];
const QUINZENAL_PARIDADE = 0; // semanas ISO pares levam a quinzenal

const DIAS = ["domingo", "segunda-feira", "terca-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sabado"];
const emUTC = (iso) => new Date(iso + "T12:00:00Z");
const somaDias = (iso, n) => { const d = emUTC(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function semanaISO(iso) {
  const a = emUTC(iso);
  const dia = a.getUTCDay() || 7;
  a.setUTCDate(a.getUTCDate() + 4 - dia);
  const ini = Date.UTC(a.getUTCFullYear(), 0, 1);
  return Math.ceil(((a.getTime() - ini) / 86400000 + 1) / 7);
}
function ehUltimaSexta(iso) {
  const d = emUTC(iso);
  const fim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12));
  while (fim.getUTCDay() !== 5) fim.setUTCDate(fim.getUTCDate() - 1);
  return fim.getUTCDate() === d.getUTCDate();
}
function reunioesDoDia(iso) {
  const out = [];
  const d = emUTC(iso);
  if (d.getUTCDay() === 1) {
    out.push(RITUAIS[0]);
    if (semanaISO(iso) % 2 === QUINZENAL_PARIDADE) out.push(RITUAIS[1]);
  }
  if (ehUltimaSexta(iso)) out.push(RITUAIS[2]);
  return out;
}
/* Primeiro dia com reuniao na janela, pulando domingo e feriado. */
function proximaReuniao(isoInicio, dias, feriados) {
  for (let i = 0; i < dias; i++) {
    const d = somaDias(isoInicio, i);
    if (emUTC(d).getUTCDay() === 0 || feriados.has(d)) continue;
    const lista = reunioesDoDia(d);
    if (lista.length) return { dia: d, reunioes: lista };
  }
  return null;
}
/* Na sexta o aviso diz "segunda-feira, 10/08" - nunca "amanha" mentindo. */
function rotuloDia(alvo, base) {
  const dif = Math.round((emUTC(alvo).getTime() - emUTC(base).getTime()) / 86400000);
  if (dif === 0) return "hoje";
  if (dif === 1) return "amanha";
  const d = emUTC(alvo);
  return DIAS[d.getUTCDay()] + ", " + String(d.getUTCDate()).padStart(2, "0") + "/" + String(d.getUTCMonth() + 1).padStart(2, "0");
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

async function rest(path, init = {}) {
  const r = await fetch(SB_URL + "/rest/v1/" + path, {
    ...init,
    headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(path + " -> " + r.status + " " + txt);
  return txt ? JSON.parse(txt) : [];
}

/* O banco roda em UTC; o expediente e em horario de Brasilia. */
function agoraSP() {
  const p = {};
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date()).forEach((x) => { p[x.type] = x.value; });
  const dia = p.year + "-" + p.month + "-" + p.day;
  return { dia, hora: Number(p.hour), minuto: Number(p.minute), dow: new Date(dia + "T12:00:00Z").getUTCDay() };
}

const quantasBatidas = (r) => ["entrada", "saida_almoco", "retorno_almoco", "saida"].filter((c) => r && r[c]).length;

async function enviar(inscricoes, payload) {
  let ok = 0;
  for (const i of inscricoes) {
    const alvo = { endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth } };
    try {
      await webpush.sendNotification(alvo, JSON.stringify(payload), { TTL: 1800, urgency: "high" });
      ok++;
      await rest("push_inscricoes?id=eq." + i.id, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ visto_em: new Date().toISOString(), falhas: 0 }),
      }).catch(() => {});
    } catch (e) {
      const st = e && e.statusCode;
      /* 404/410 = aparelho desinstalou o app ou revogou o aviso: limpa a inscricao */
      if (st === 404 || st === 410) {
        await rest("push_inscricoes?id=eq." + i.id, { method: "DELETE", headers: { Prefer: "return=minimal" } }).catch(() => {});
      } else {
        await rest("push_inscricoes?id=eq." + i.id, {
          method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ falhas: (i.falhas ?? 0) + 1 }),
        }).catch(() => {});
      }
    }
  }
  return ok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!VAPID_PUB || !VAPID_PRIV) return json({ erro: "faltam os segredos VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY" }, 500);
  webpush.setVapidDetails(VAPID_SUBJ, VAPID_PUB, VAPID_PRIV);

  let corpo = {};
  try { corpo = await req.json(); } catch (e) { corpo = {}; }

  /* Modo teste: manda um aviso so para os aparelhos de quem chamou. */
  if (corpo && corpo.teste) {
    let uid = "";
    try {
      const jwt = (req.headers.get("Authorization") ?? "").split(" ").pop() ?? "";
      const meio = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      uid = JSON.parse(atob(meio)).sub ?? "";
    } catch (e) { uid = ""; }
    if (!uid) return json({ erro: "o teste exige o token de um usuario logado" }, 401);
    const insc = await rest("push_inscricoes?select=*&usuario_id=eq." + uid);
    const enviados = await enviar(insc, {
      titulo: "🔔 Teste de aviso", corpo: "Deu certo: o Ponto Renovar consegue avisar voce com o app fechado.",
      etapa: "teste", url: "./",
    });
    return json({ modo: "teste", aparelhos: insc.length, enviados });
  }

  const { dia, hora, dow } = agoraSP();
  const etapa = (corpo && corpo.etapa) || ETAPA_DA_HORA[hora];

  /* ---------- aviso das reunioes do time ----------
     Cada reuniao avisa duas vezes: ao sair no dia anterior e ao chegar no
     dia. Os dois avisos dizem qual ritual, a que horas, quanto dura e a
     pauta prevista - o objetivo e ninguem chegar sem saber o que sera
     alinhado. Chamado pelo cron com {"etapa":"reuniao_saida"} no fim da
     tarde e {"etapa":"reuniao_chegada"} de manha. */
  if (etapa === "reuniao_saida" || etapa === "reuniao_chegada") {
    if (dow === 0) return json({ dia, etapa, ignorado: "domingo" });
    const feriadosLista = await rest("feriados_nacionais?select=data&data=gte." + dia + "&data=lte." + somaDias(dia, 6));
    const feriados = new Set(feriadosLista.map((f) => f.data));
    if (feriados.has(dia)) return json({ dia, etapa, ignorado: "feriado" });

    /* Chegada olha o proprio dia; saida olha os 3 dias seguintes, para que a
       sexta ja enxergue a segunda sem depender de feriado nenhum. */
    const doDia = reunioesDoDia(dia);
    const alvo = etapa === "reuniao_chegada"
      ? (doDia.length ? { dia, reunioes: doDia } : null)
      : proximaReuniao(somaDias(dia, 1), 3, feriados);
    if (!alvo) return json({ dia, etapa, ignorado: "nenhuma reuniao na janela" });

    const rotulo = rotuloDia(alvo.dia, dia);
    const nomes = alvo.reunioes.map((r) => r.icone + " " + r.nome).join(" + ");
    const pauta = alvo.reunioes
      .map((r) => r.nome + " as " + r.inicio + ", " + r.duracaoMin + " min - pauta: " + r.pauta)
      .join(" | ");
    const titulo = etapa === "reuniao_chegada" ? "🗓 Hoje tem " + nomes : "📌 Antes de ir: " + nomes;
    const corpoAviso = (etapa === "reuniao_chegada" ? "Comeca hoje: " : "Fica pra " + rotulo + ": ") + pauta + ".";

    const [pessoas, regs, jaAvisados, todasInsc] = await Promise.all([
      rest("usuarios?select=id,nome&ativo=is.true"),
      rest("registros_ponto?select=usuario_id,entrada,saida&data=eq." + dia),
      rest("push_lembretes_log?select=usuario_id&etapa=eq." + etapa + "&dia=eq." + dia),
      rest("push_inscricoes?select=*"),
    ]);
    const jaFoi = new Set(jaAvisados.map((r) => r.usuario_id));
    const porPessoa = {};
    for (const i of todasInsc) (porPessoa[i.usuario_id] = porPessoa[i.usuario_id] || []).push(i);

    /* O aviso de saida procura quem ja bateu a saida; quem nunca bate recebe
       na ultima passada do dia. O de chegada segue a mesma logica na entrada. */
    const naHora = (reg) => etapa === "reuniao_saida"
      ? (!!(reg && reg.saida) || hora >= 19)
      : (!!(reg && reg.entrada) || hora >= 9);

    const feitos = [];
    for (const p of pessoas) {
      if (jaFoi.has(p.id)) continue;
      if (!naHora(regs.find((r) => r.usuario_id === p.id))) continue;
      const insc = porPessoa[p.id] || [];
      if (!insc.length) continue;
      const gravou = await rest("push_lembretes_log?on_conflict=usuario_id,dia,etapa", {
        method: "POST",
        headers: { Prefer: "return=representation,resolution=ignore-duplicates" },
        body: JSON.stringify([{ usuario_id: p.id, dia, etapa, aparelhos: insc.length }]),
      });
      if (!gravou.length) continue;
      const enviados = await enviar(insc, { titulo, corpo: corpoAviso, etapa, url: "./?ir=time" });
      feitos.push({ nome: p.nome, aparelhos: insc.length, enviados });
    }
    return json({ dia, hora, etapa, reuniao: alvo.dia, avisados: feitos.length, detalhe: feitos });
  }

  if (!etapa || !ETAPAS[etapa]) return json({ dia, hora, ignorado: "fora das faixas de lembrete (8h, 9h, 12h e 13h)" });
  if (dow === 0) return json({ dia, etapa, ignorado: "domingo" });
  if ((etapa === "alm12" || etapa === "alm13") && dow === 6) return json({ dia, etapa, ignorado: "sabado e turno unico" });
  const feriado = await rest("feriados_nacionais?select=nome&data=eq." + dia);
  if (feriado.length) return json({ dia, etapa, ignorado: "feriado: " + feriado[0].nome });

  const cfg = ETAPAS[etapa];
  const [usuarios, regs, jaAvisados, inscricoes] = await Promise.all([
    rest("usuarios?select=id,nome&ativo=is.true"),
    rest("registros_ponto?select=usuario_id,entrada,saida_almoco,retorno_almoco,saida&data=eq." + dia),
    rest("push_lembretes_log?select=usuario_id&etapa=eq." + etapa + "&dia=eq." + dia),
    rest("push_inscricoes?select=*"),
  ]);
  const feito = new Set(jaAvisados.map((r) => r.usuario_id));
  const porUsuario = {};
  for (const i of inscricoes) (porUsuario[i.usuario_id] = porUsuario[i.usuario_id] || []).push(i);

  const detalhe = [];
  for (const u of usuarios) {
    if (feito.has(u.id)) continue;
    const reg = regs.find((r) => r.usuario_id === u.id);
    if (quantasBatidas(reg) !== cfg.batidas) continue;
    const insc = porUsuario[u.id] || [];
    if (!insc.length) continue;
    /* Grava a trava ANTES de mandar: se outra execucao ja gravou, ninguem repete. */
    const gravou = await rest("push_lembretes_log?on_conflict=usuario_id,dia,etapa", {
      method: "POST",
      headers: { Prefer: "return=representation,resolution=ignore-duplicates" },
      body: JSON.stringify([{ usuario_id: u.id, dia, etapa, aparelhos: insc.length }]),
    });
    if (!gravou.length) continue;
    const enviados = await enviar(insc, { titulo: cfg.titulo, corpo: cfg.corpo, etapa, url: "./" });
    detalhe.push({ nome: u.nome, aparelhos: insc.length, enviados });
  }
  return json({ dia, hora, etapa, avisados: detalhe.length, detalhe });
});
