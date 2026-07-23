import React, { useState, useEffect, useRef, useMemo } from "react";

/* ============================================================
   PONTO RENOVAR — Sistema de Ponto Eletrônico (Protótipo)
   Renovar Tech Ltda · arquivo único JSX · sem build pipeline
   Simulados neste protótipo: OAuth Google, persistência
   Reais neste protótipo: biometria nativa via WebAuthn (Face ID/digital), geolocalização,
   regras de férias, banco de horas, feedback engine, auditoria, AFD
   ============================================================ */

const EMPRESA = {
  nome: "Renovar Tech Ltda",
  cnpj: "41.206.506/0001-39",
  endereco: "Rua Antônio de Albuquerque, 145 - Funcionários, Belo Horizonte - MG",
  cep: "30112-010",
  cidade: "Belo Horizonte/MG",
  ramo: "Assistência técnica e comércio de peças e acessórios pra fones e caixas de som bluetooth (JBL, Bose, Harman Kardon)",
};
/* Calendário de expediente:
   seg-sex 8:00→18:00 com 1h de intervalo (presença 10h − 1h = 9h efetivas; jornada normal 8h,
           o excedente diário vai pro banco de horas · CLT art. 71 exige mínimo de 1h)
   sábado  8:00→13:00 (turno único de 5h, sem intervalo)
   domingo e feriado nacional: empresa fechada (sem cobrança de atraso/falta; trabalho vira crédito integral no banco)
   Feriados vêm da tabela feriados_nacionais no login (FERIADOS_SET, módulo-level pra não replumbar todos os motores). */
/* Intervalo intrajornada REAL da empresa: 1 hora (corrigido em 23/07/2026 — o sistema
   assumia 2h). Consequência aritmética: com presença das 8h às 18h e 1h de intervalo,
   a jornada efetiva é de 9h/dia, enquanto a jornada normal (CLT art. 58) é de 8h —
   a diferença vira crédito no banco de horas, como manda a lei. */
const EXPEDIENTE = { entradaMin: 8 * 60, saidaMin: 18 * 60, intervaloMin: 60, toleranciaMin: 10 };
// Marco da correção: usado pra sinalizar ao gestor que saldos históricos foram recalculados.
const MUDANCA_INTERVALO = { data: "2026-07-23", de: 120, para: 60 };
const JORNADA_MIN = 8 * 60; // referência de dia cheio (usada na conversão de folga: 1 dia = 8h)
let FERIADOS_SET = new Set();
let FERIADOS_NOMES = {};
const setFeriadosGlobal = (lista) => { FERIADOS_SET = new Set(lista.map(f => f.data)); FERIADOS_NOMES = Object.fromEntries(lista.map(f => [f.data, f.nome])); };
const dataISO = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
function expedienteDoDia(dt) {
  const dow = dt.getDay();
  if (dow === 0) return { jornadaMin: 0, entradaMin: null, saidaMin: null, intervaloMin: 0, rotulo: "domingo — fechado" };
  const feriado = FERIADOS_NOMES[dataISO(dt)];
  if (feriado) return { jornadaMin: 0, entradaMin: null, saidaMin: null, intervaloMin: 0, rotulo: `feriado — ${feriado}` };
  if (dow === 6) return { jornadaMin: 5 * 60, entradaMin: 8 * 60, saidaMin: 13 * 60, intervaloMin: 0, rotulo: "sábado 8:00–13:00" };
  return { jornadaMin: 8 * 60, entradaMin: 8 * 60, saidaMin: 18 * 60, intervaloMin: EXPEDIENTE.intervaloMin, rotulo: "8:00–18:00 (1h de intervalo)" };
}
// Minutos após o horário de entrada (negativo = chegou antes)
const minutosAposEntrada = (dt) => dt.getHours() * 60 + dt.getMinutes() - EXPEDIENTE.entradaMin;
// Dia sem expediente nunca gera atraso
const entradaPontual = (dt) => expedienteDoDia(dt).jornadaMin === 0 ? true : minutosAposEntrada(dt) <= EXPEDIENTE.toleranciaMin;
// FONTE ÚNICA do atraso computável (usada pelo Prêmio E pela folha — nunca duplicar essa regra):
// conta APENAS o excedente da tolerância por ocorrência (8:25 → 15 min). Política da Renovar Tech,
// mais favorável ao empregado que o desconto integral que a CLT art. 58 §1º permitiria — registrar no regulamento.
const minutosAtrasoDia = (dt) => {
  if (expedienteDoDia(dt).jornadaMin === 0) return 0;
  const min = minutosAposEntrada(dt);
  return min > EXPEDIENTE.toleranciaMin ? min - EXPEDIENTE.toleranciaMin : 0;
};

/* Configuração fiscal (Portaria 671/2021)
   ⚠ nrInpi é PLACEHOLDER: o nº real sai do registro do programa no INPI.
   ⚠ A assinatura digital real (.p7s, certificado ICP-Brasil) é etapa externa ao protótipo. */
const CONFIG_FISCAL = {
  tpIdtEmpregador: "1", idtEmpregador: "41206506000139", cnoCaepf: "", caepf: "", cno: "",
  razaoSocial: "Renovar Tech Ltda",
  nrInpi: "00000000000000000", // PLACEHOLDER — substituir pelo nº de registro no INPI
  tpIdtDesenv: "1", idtDesenv: "41206506000139",
  ptrp: { nome: "PONTO RENOVAR", versao: "1.0.0", tpIdtDesenv: "1", idtDesenv: "41206506000139", razaoNome: "Renovar Tech Ltda", email: "dev@renovartech.com.br" },
};
const HORARIOS_CONTRATUAIS = [
  { cod: "H0818", durMin: 480, pares: [["0800", "1200"], ["1400", "1800"]] }, // seg-sex: 8h produtivas, intervalo 12-14
  { cod: "H0813", durMin: 300, pares: [["0800", "1300"]] },                    // sábado: turno único de 5h
];
const codHorarioDe = (dt) => (new Date(dt).getDay() === 6 ? "H0813" : "H0818");

/* ============================================================
   SUPABASE — backend real
   Client leve via REST (PostgREST + GoTrue): mesmas chamadas HTTP
   que o supabase-js faz por baixo. Pra migrar pro SDK oficial num
   build próprio: npm i @supabase/supabase-js e troque os helpers.
   A chave abaixo é a PUBLISHABLE (pública por design) — a segurança
   vem do RLS já configurado no banco.
   ============================================================ */
const SUPA = {
  url: "https://bdbxjdkjeeobaxulfqkb.supabase.co",
  anonKey: "sb_publishable_8oqs0Oa4Rk95YzsXvPlFhA_xppfWWim",
};

/* ============================================================
   FÉRIAS — FRACIONAMENTO (CLT art. 134 §1º), validação travada:
   no máximo 3 períodos por período aquisitivo; um deles com no mínimo 14 dias
   corridos; os demais com no mínimo 5 dias corridos cada.
   ============================================================ */
const FRAC = { maxPeriodos: 3, minMaior: 14, minDemais: 5, totalAnual: 30 };

// Período aquisitivo: ciclo de 12 meses contado da admissão (CLT art. 130).
function periodoAquisitivo(admissao, dataInicio) {
  const adm = dataLocal(admissao), ini = dataLocal(dataInicio);
  let ciclo = 0, comeco = addMeses(adm, 12);   // 1º aquisitivo completo
  while (addMeses(comeco, 12) <= ini) { comeco = addMeses(comeco, 12); ciclo++; }
  return { ciclo, inicio: comeco, fim: addMeses(comeco, 12) };
}

/* Valida o conjunto (períodos já existentes + o novo) contra o art. 134 §1º.
   Recebe as férias em dias; devolve { ok, msg }. */
function validarFracionamento(periodosExistentes, novoDias, totalJaUsado) {
  const todos = [...periodosExistentes, novoDias];
  if (todos.length > FRAC.maxPeriodos) {
    return { ok: false, msg: `A CLT (art. 134 §1º) permite no máximo ${FRAC.maxPeriodos} períodos de férias por período aquisitivo. Você já tem ${periodosExistentes.length} agendado(s)/aprovado(s) neste ciclo.` };
  }
  if (novoDias < FRAC.minDemais) {
    return { ok: false, msg: `Cada período fracionado precisa ter no mínimo ${FRAC.minDemais} dias corridos (CLT art. 134 §1º). Você pediu ${novoDias} dia(s).` };
  }
  if (totalJaUsado + novoDias > FRAC.totalAnual) {
    return { ok: false, msg: `O total de férias do período aquisitivo é de ${FRAC.totalAnual} dias. Você já tem ${totalJaUsado} dia(s) neste ciclo e pediu mais ${novoDias}.` };
  }
  // Se este é o último período possível (ou já fecha os 30 dias), algum deles precisa ter ≥14 dias
  const fechaCiclo = todos.length === FRAC.maxPeriodos || totalJaUsado + novoDias === FRAC.totalAnual;
  if (fechaCiclo && !todos.some(d => d >= FRAC.minMaior)) {
    const restante = FRAC.totalAnual - totalJaUsado;
    return { ok: false, msg: `Um dos períodos precisa ter no mínimo ${FRAC.minMaior} dias corridos (CLT art. 134 §1º), e nenhum dos seus tem. Neste pedido você ainda pode usar até ${restante} dia(s) — escolha ${FRAC.minMaior} ou mais.` };
  }
  // Se ainda restarem dias mas nenhum período longo foi usado, avisa que o próximo terá de ser ≥14
  const restanteDepois = FRAC.totalAnual - (totalJaUsado + novoDias);
  if (!todos.some(d => d >= FRAC.minMaior) && restanteDepois < FRAC.minMaior) {
    return { ok: false, msg: `Com ${novoDias} dia(s) agora, sobrariam ${restanteDepois} dia(s) — não seria mais possível cumprir a exigência de um período com ${FRAC.minMaior}+ dias (CLT art. 134 §1º). Aumente este período.` };
  }
  return { ok: true, aviso: !todos.some(d => d >= FRAC.minMaior) ? `Atenção: nenhum período tem ${FRAC.minMaior}+ dias ainda — um dos próximos precisará ter, por exigência da CLT.` : null };
}

/* Impacto histórico da correção do intervalo: dias ANTERIORES à mudança em que o
   colaborador bateu só um par (entrada/saída) tinham 2h descontadas em vez de 1h,
   então o saldo daqueles dias estava 60 min menor do que o correto. Dias com batida
   de almoço (4 marcações) não eram afetados. Aqui quantificamos pra revisão do gestor. */
function impactoMudancaIntervalo(userId, registros) {
  const corte = new Date(MUDANCA_INTERVALO.data + "T00:00:00");
  let diasAfetados = 0;
  Object.values(agruparPorDia(registros, userId)).forEach(regs => {
    const dt = new Date(regs[0].ts);
    if (dt >= corte) return;
    const exp = expedienteDoDia(dt);
    if (exp.intervaloMin === 0) return; // sábado/domingo/feriado não tinham intervalo
    const pares = Math.min(regs.filter(r => r.tipo === "entrada").length, regs.filter(r => r.tipo === "saida").length);
    if (pares <= 1) diasAfetados++; // só nesses dias o desconto de intervalo era aplicado
  });
  return { diasAfetados, minutosDiferenca: diasAfetados * (MUDANCA_INTERVALO.de - MUDANCA_INTERVALO.para) };
}

/* ============================================================
   MENSAGENS DE ERRO AMIGÁVEIS
   O PostgREST/Supabase responde em inglês e em JSON (ex.:
   {"code":"42501","message":"new row violates row-level security policy"}).
   Isso não pode chegar ao colaborador. Aqui traduzimos para linguagem clara,
   dizendo o que houve E o que fazer — o detalhe técnico vai só pro console.
   ============================================================ */
const REGRAS_ERRO = [
  // --- autenticação ---
  [/invalid login credentials|invalid_grant/i, "E-mail ou senha incorretos. Confira e tente de novo — se esqueceu a senha, use 'Esqueci minha senha'."],
  [/email not confirmed/i, "Seu e-mail ainda não foi confirmado. Procure a mensagem de confirmação na caixa de entrada (e no spam)."],
  [/user already registered|already been registered/i, "Já existe uma conta com este e-mail. Use 'Entrar' ou recupere a senha."],
  [/password should be at least|weak.?password/i, "A senha precisa ter pelo menos 8 caracteres. Escolha uma senha mais forte."],
  [/pwned|leaked|compromised/i, "Esta senha aparece em vazamentos públicos e não pode ser usada. Escolha outra."],
  [/for security purposes|rate limit|too many requests|429/i, "Muitas tentativas seguidas. Aguarde alguns instantes e tente de novo."],
  [/sess(ã|a)o (inv(á|a)lida|expirou|expirada)|jwt (expired|invalid)|token.*expired/i, "Sua sessão expirou. Entre novamente pra continuar."],
  // --- permissão e integridade (PostgREST) ---
  [/row-level security|42501|permission denied|insufficient_privilege/i, "Você não tem permissão pra fazer isso. Se acredita que deveria ter, fale com o gestor."],
  [/duplicate key|23505|already exists/i, "Este registro já existe — provavelmente já foi salvo. Atualize a tela pra conferir."],
  [/violates foreign key|23503/i, "Não foi possível salvar: um dado relacionado não existe mais. Recarregue a página e tente de novo."],
  [/violates check constraint|23514/i, "Algum valor informado está fora do permitido. Revise os campos e tente de novo."],
  [/not-null|23502/i, "Faltou preencher um campo obrigatório."],
  [/invalid input syntax|22P02/i, "Um dos valores informados está em formato inválido. Revise os campos."],
  // --- rede e servidor ---
  [/failed to fetch|networkerror|network request failed|load failed|sem conex(ã|a)o/i, "Sem conexão com a internet. Verifique sua rede — se você bateu o ponto, ele fica salvo e será enviado sozinho quando a conexão voltar."],
  [/tempo esgotado|timeout|abort/i, "O servidor demorou pra responder. Tente de novo em alguns segundos."],
  [/(^|\D)5\d\d(\D|$)|service unavailable|bad gateway/i, "O servidor está indisponível no momento. Aguarde alguns minutos e tente de novo."],
  [/payload too large|413|file too large/i, "Arquivo grande demais. O limite é 8 MB."],
  [/(^|\D)404(\D|$)|not found/i, "Recurso não encontrado. Se o problema continuar, avise o gestor."],
  // --- storage ---
  [/bucket|storage/i, "Não foi possível enviar o arquivo agora. Tente de novo em instantes."],
];

function mensagemAmigavel(erro, contexto = "") {
  const bruto = typeof erro === "string" ? erro : (erro?.message || "");
  if (bruto) console.warn(`[erro técnico]${contexto ? " " + contexto + ":" : ""}`, bruto);
  // Mensagens que o próprio app escreve (já em português) passam direto.
  // Detecção explícita: acento OU palavra funcional do português — não adianta heurística
  // genérica de "parece frase", porque erro em inglês também parece frase.
  const temMarcadorPT = /[áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ]/.test(bruto)
    || /\b(n(ã|a)o|voc(ê|e)|pra|para|informe|escolha|aguarde|tente|preencha|confira|saldo|senha|hor(á|a)rio|arquivo|campo|gestor|dias?|minutos?|conclu(í|i)|dispon(í|i)vel|inv(á|a)lid[ao])\b/i.test(bruto);
  const pareceTecnico = /^supabase \d|^upload falhou|\{"code"|"message":|violates|null value in column|unexpected token|is not a function|undefined|cannot read/i.test(bruto);
  const jaAmigavel = bruto && temMarcadorPT && !pareceTecnico;
  for (const [re, msg] of REGRAS_ERRO) if (re.test(bruto)) return msg;
  if (jaAmigavel) return bruto;
  return `Não foi possível concluir${contexto ? " " + contexto : " a ação"}. Tente de novo — se continuar, avise o gestor.`;
}

/* ============================================================
   GEOLOCALIZAÇÃO: diagnóstico honesto e recuperação
   O navegador devolve um código de erro que dizia tudo e era descartado:
   1 = permissão negada · 2 = posição indisponível · 3 = tempo esgotado.
   Cada um pede uma orientação diferente pro colaborador.
   ============================================================ */
const GEO_MOTIVOS = {
  permissao_negada: {
    titulo: "Permissão de localização negada",
    msg: "Seu navegador está bloqueando o acesso à localização deste site.",
    comoResolver: "No iPhone (Safari): toque em 'aA' na barra de endereço → Configurações do Site → Localização → Permitir. No Android (Chrome): toque no cadeado 🔒 ao lado do endereço → Permissões → Localização → Permitir. Depois volte aqui e toque em 'Tentar de novo'.",
  },
  indisponivel: {
    titulo: "GPS sem sinal",
    msg: "A permissão está liberada, mas o aparelho não conseguiu obter a posição.",
    comoResolver: "Costuma acontecer dentro de prédios, subsolo ou com o GPS desligado. Ative a localização do aparelho, chegue perto de uma janela ou saia por alguns segundos e tente de novo.",
  },
  timeout: {
    titulo: "Tempo esgotado ao localizar",
    msg: "O aparelho demorou demais pra encontrar a posição.",
    comoResolver: "Sinal fraco de GPS. Tente de novo — na segunda tentativa o app já usa um modo mais rápido e menos preciso.",
  },
  contexto_inseguro: {
    titulo: "Conexão não segura",
    msg: "Os navegadores só liberam localização em páginas HTTPS.",
    comoResolver: "Abra o app pelo endereço oficial com https:// (não por arquivo local nem http://). Avise o gestor se o link estiver errado.",
  },
  sem_suporte: {
    titulo: "Sem suporte a localização",
    msg: "Este navegador não oferece geolocalização.",
    comoResolver: "Use o navegador padrão do celular (Safari no iPhone, Chrome no Android) atualizado.",
  },
};
const codigoGeoParaMotivo = (err) => {
  if (!err) return "indisponivel";
  if (err.code === 1) return "permissao_negada";
  if (err.code === 3) return "timeout";
  return "indisponivel";
};
// Tenta em duas etapas: alta precisão (rápido) e, se falhar, precisão baixa com mais tempo.
// Sem isso, GPS de prédio fechado falha muito mais do que precisaria.
function obterLocalizacao() {
  return new Promise((resolve) => {
    if (typeof window !== "undefined" && !window.isSecureContext) return resolve({ lat: null, lng: null, motivo: "contexto_inseguro" });
    if (!navigator.geolocation) return resolve({ lat: null, lng: null, motivo: "sem_suporte" });
    const sucesso = (p) => resolve({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), precisao: Math.round(p.coords.accuracy) });
    navigator.geolocation.getCurrentPosition(
      sucesso,
      (e1) => {
        if (e1.code === 1) return resolve({ lat: null, lng: null, motivo: "permissao_negada" }); // negou: insistir não adianta
        navigator.geolocation.getCurrentPosition( // 2ª tentativa: mais tolerante
          sucesso,
          (e2) => resolve({ lat: null, lng: null, motivo: codigoGeoParaMotivo(e2) }),
          { timeout: 20000, enableHighAccuracy: false, maximumAge: 60000 },
        );
      },
      { timeout: 8000, enableHighAccuracy: true, maximumAge: 0 },
    );
  });
}
// Estado da permissão (quando o navegador suporta): permite avisar ANTES de tentar
async function permissaoGeo() {
  try { return (await navigator.permissions?.query({ name: "geolocation" }))?.state ?? null; } catch { return null; }
}

/* ============================================================
   FILA OFFLINE DE BATIDAS
   O app roda no celular do colaborador, que perde sinal (elevador, subsolo, 4G ruim).
   A batida NUNCA pode se perder: se o envio falha, ela entra numa fila persistente e
   é reenviada sozinha quando a conexão volta.

   Persistência: localStorage quando disponível, com fallback automático pra memória
   (alguns ambientes bloqueiam storage). Sem persistência, a fila só sobrevive enquanto
   a aba estiver aberta — o app avisa isso na tela.

   Idempotência: cada batida carrega um UUID gerado no cliente. O banco tem índice único
   nessa coluna, então reenvio repetido não cria batida duplicada.
   ============================================================ */
const FILA_KEY = "pontorenovar.fila.v1";
let _filaMemoria = [];
let _storageOk = null;
function storageDisponivel() {
  if (_storageOk !== null) return _storageOk;
  try {
    const k = "__t"; window.localStorage.setItem(k, "1"); window.localStorage.removeItem(k);
    _storageOk = true;
  } catch { _storageOk = false; }
  return _storageOk;
}
function lerFila() {
  if (!storageDisponivel()) return _filaMemoria;
  try { return JSON.parse(window.localStorage.getItem(FILA_KEY) || "[]"); } catch { return []; }
}
function gravarFila(itens) {
  _filaMemoria = itens;
  if (!storageDisponivel()) return;
  try { window.localStorage.setItem(FILA_KEY, JSON.stringify(itens)); } catch { /* cota cheia: segue em memória */ }
}
const enfileirar = (item) => { const f = lerFila(); f.push(item); gravarFila(f); return f; };
const removerDaFila = (uuid) => { const f = lerFila().filter(i => i.cliente_uuid !== uuid); gravarFila(f); return f; };
const atualizarItemFila = (uuid, patch) => {
  const f = lerFila().map(i => i.cliente_uuid === uuid ? { ...i, ...patch } : i);
  gravarFila(f); return f;
};
// Erro de rede (não de regra de negócio) = candidato à fila
const ehFalhaDeRede = (e) =>
  e instanceof TypeError || /failed to fetch|networkerror|tempo esgotado|load failed|network request failed/i.test(e?.message || "");

/* Sessão expirada: o JWT do Supabase vence (1h por padrão). Sem tratamento, o app
   passava a falhar com erros crus. Agora existe um aviso claro e logout controlado. */
let _aoExpirarSessao = null;
const registrarHandlerSessao = (fn) => { _aoExpirarSessao = fn; };
function jwtExpiraEm(token) {
  try {
    const p = JSON.parse(atob(String(token).split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return p.exp ? p.exp * 1000 : null;
  } catch { return null; }
}

async function sbFetch(token, path, { method = "GET", body, headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000); // request pendurada não pode parecer travamento de tela
  try {
    const r = await fetch(`${SUPA.url}${path}`, {
      method,
      headers: { apikey: SUPA.anonKey, Authorization: `Bearer ${token || SUPA.anonKey}`, "Content-Type": "application/json", ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const txt = await r.text();
      if (r.status === 401 && /jwt|token|expired/i.test(txt)) {
        if (_aoExpirarSessao) _aoExpirarSessao();
        throw Object.assign(new Error("Sua sessão expirou. Entre novamente pra continuar."), { sessaoExpirada: true });
      }
      throw new Error(`Supabase ${r.status}: ${txt}`);
    }
    // return=minimal responde 201 com corpo VAZIO (não 204) — corpo vazio é sucesso, nunca erro de parse
    const texto = await r.text();
    if (!texto) return null;
    try { return JSON.parse(texto); } catch { return texto; }
  } catch (e) {
    if (e.name === "AbortError") throw new Error(`Tempo esgotado (12s) em ${method} ${path.split("?")[0]} — o banco pode estar com lock ou a rede instável.`);
    throw e;
  } finally { clearTimeout(timer); }
}
const sbSelect = (t, tab, q = "select=*") => sbFetch(t, `/rest/v1/${tab}?${q}`);
const sbInsert = (t, tab, rows, minimal = false) => sbFetch(t, `/rest/v1/${tab}`, { method: "POST", body: rows, headers: { Prefer: minimal ? "return=minimal" : "return=representation" } });
const sbUpsert = (t, tab, rows, conflict, ignoreDup = false) => sbFetch(t, `/rest/v1/${tab}?on_conflict=${conflict}`, { method: "POST", body: rows, headers: { Prefer: `resolution=${ignoreDup ? "ignore" : "merge"}-duplicates,return=representation` } });
const sbUpdate = (t, tab, filtro, patch) => sbFetch(t, `/rest/v1/${tab}?${filtro}`, { method: "PATCH", body: patch, headers: { Prefer: "return=representation" } });
// Upload pro bucket privado "anexos" com path {uid}/{timestamp}_{nome} (padrão das policies via storage.foldername).
// POST cria objeto novo (o path é sempre único pelo timestamp); PUT é pra sobrescrever path existente.
async function sbUpload(token, uid, file) {
  const problema = validarArquivo(file); // tipo e tamanho conferidos antes de qualquer upload
  if (problema) throw new Error(problema);
  const nomeLimpo = nomeArquivoSeguro(file.name.normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
  const path = `${uid}/${Date.now()}_${nomeLimpo}`;
  const r = await fetch(`${SUPA.url}/storage/v1/object/anexos/${path}`, {
    method: "POST",
    headers: { apikey: SUPA.anonKey, Authorization: `Bearer ${token}`, "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!r.ok) throw new Error(`Upload falhou (${r.status}): ${await r.text()}`);
  return path; // gravado em anexo_url; leitura via URL assinada (gestor/dono, conforme policies)
}
const sbRpc = (t, fn, args) => sbFetch(t, `/rest/v1/rpc/${fn}`, { method: "POST", body: args });
async function sbSignUp(email, password) {
  const r = await fetch(`${SUPA.url}/auth/v1/signup`, {
    method: "POST", headers: { apikey: SUPA.anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || j.msg || "Falha no cadastro");
  return j; // com confirmação de e-mail desativada: { access_token, user }; ativada: só { user }
}
// Chamada às Edge Functions do Supabase (rodam no servidor; service_role fica lá, nunca aqui)
async function sbFuncao(token, nome, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(`${SUPA.url}/functions/v1/${nome}`, {
      method: "POST",
      headers: { apikey: SUPA.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: ctrl.signal,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || `Falha no servidor de verificação (HTTP ${r.status}).`);
    return j;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("O servidor de verificação não respondeu (20s).");
    throw e;
  } finally { clearTimeout(timer); }
}

/* ============================================================
   BIOMETRIA NATIVA VIA WEBAUTHN (Face ID / digital do próprio aparelho — BYOD)
   O dado biométrico NUNCA sai do sensor do dispositivo: o aparelho faz a checagem
   localmente e devolve só uma assinatura criptográfica. Guardamos apenas
   credential ID + chave PÚBLICA + contador.
   ============================================================ */
const bufToB64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlToBuf = (s) => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
};
const randomChallenge = () => crypto.getRandomValues(new Uint8Array(32));

const bioSuportado = () => typeof window !== "undefined" && !!window.PublicKeyCredential;
const bioContextoSeguro = () => typeof window !== "undefined" && window.isSecureContext;
// Diagnóstico único usado em toda a UI — mensagens honestas, sem promessa falsa
function bioDiagnostico() {
  if (!bioSuportado()) return { ok: false, motivo: "sem_suporte", msg: "Este navegador/dispositivo não suporta WebAuthn (biometria nativa). Use o navegador padrão do celular (Safari no iOS, Chrome no Android) atualizado." };
  if (!bioContextoSeguro()) return { ok: false, motivo: "inseguro", msg: "A biometria exige conexão segura (HTTPS). Abrindo o app por HTTP ou por arquivo local, o navegador bloqueia o Face ID/digital por segurança." };
  return { ok: true };
}
async function bioPlataformaDisponivel() {
  try { return await window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.() ?? false; }
  catch { return false; }
}

// Cadastro da credencial (navigator.credentials.create)
async function bioRegistrar(user, token, demo) {
  const d = bioDiagnostico();
  if (!d.ok) throw new Error(d.msg);
  // Challenge vem do BACKEND (anti-replay). Em modo demo não há backend: usa local.
  let challengeBytes;
  if (demo) challengeBytes = randomChallenge();
  else {
    const { challenge } = await sbFuncao(token, "verificar-biometria", { acao: "challenge", tipo: "create" });
    challengeBytes = new Uint8Array(b64urlToBuf(challenge));
  }
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: challengeBytes,
      rp: { name: "PONTO RENOVAR", id: window.location.hostname },
      user: { id: new TextEncoder().encode(user.id), name: user.email || user.nome, displayName: user.nome },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
      timeout: 60000,
      attestation: "none", // não pedimos atestado do fabricante: menos dado pessoal trafegando
    },
  });
  if (!cred) throw new Error("O cadastro da biometria foi cancelado.");
  let chavePublica = null, algoritmo = null;
  try { const pk = cred.response.getPublicKey?.(); if (pk) chavePublica = bufToB64url(pk); } catch {}
  try { algoritmo = cred.response.getPublicKeyAlgorithm?.() ?? null; } catch {}
  if (!chavePublica && !demo) {
    throw new Error("Seu navegador não expôs a chave pública da credencial, então a validação no servidor não seria possível. Atualize o navegador do celular e tente de novo.");
  }
  return { credentialId: bufToB64url(cred.rawId), chavePublica, algoritmo };
}

// Verificação no momento da batida (navigator.credentials.get)
async function bioVerificar(credenciais, token, demo) {
  const d = bioDiagnostico();
  if (!d.ok) throw Object.assign(new Error(d.msg), { motivo: d.motivo });
  if (!credenciais.length) throw Object.assign(new Error("Você ainda não cadastrou a biometria neste aparelho. Abra 🔐 LGPD → Biometria pra configurar."), { motivo: "sem_credencial" });
  // 1) desafio gerado NO SERVIDOR (validade 2 min, uso único) — impede replay
  let challengeBytes;
  if (demo) challengeBytes = randomChallenge();
  else {
    try {
      const { challenge } = await sbFuncao(token, "verificar-biometria", { acao: "challenge", tipo: "get" });
      challengeBytes = new Uint8Array(b64urlToBuf(challenge));
    } catch (e) { throw Object.assign(new Error(`Não foi possível falar com o servidor de verificação. ${mensagemAmigavel(e)}`), { motivo: "servidor_indisponivel" }); }
  }
  try {
    const asrt = await navigator.credentials.get({
      publicKey: {
        challenge: challengeBytes,
        rpId: window.location.hostname,
        allowCredentials: credenciais.map(c => ({ type: "public-key", id: b64urlToBuf(c.credentialId), transports: ["internal"] })),
        userVerification: "required", // exige Face ID/digital/PIN — não aceita só presença
        timeout: 60000,
      },
    });
    if (!asrt) throw new Error("Verificação cancelada.");
    const credentialId = bufToB64url(asrt.rawId);
    // 2) modo demo: sem backend, fica só a checagem local do aparelho (rotulada com honestidade)
    if (demo) return { credentialId, metodo: "webauthn_local" };
    // 3) VALIDAÇÃO CRIPTOGRÁFICA NO SERVIDOR: challenge, origem, rpIdHash, flags, assinatura e signCount
    const resp = await sbFuncao(token, "verificar-biometria", {
      acao: "verificar",
      credentialId,
      clientDataJSON: bufToB64url(asrt.response.clientDataJSON),
      authenticatorData: bufToB64url(asrt.response.authenticatorData),
      signature: bufToB64url(asrt.response.signature),
    });
    if (!resp.aprovado) {
      throw Object.assign(new Error(resp.erro || "O servidor não aprovou a verificação biométrica."), { motivo: resp.alertaClone ? "clone" : "servidor_rejeitou" });
    }
    return { credentialId, metodo: "webauthn_servidor", origemFixada: !!resp.origemFixada };
  } catch (e) {
    if (e.name === "NotAllowedError") throw Object.assign(new Error("Biometria não confirmada (cancelada ou tempo esgotado). Tente de novo."), { motivo: "cancelado" });
    if (e.motivo) throw e;
    throw Object.assign(new Error(`A verificação biométrica não pôde ser concluída. ${mensagemAmigavel(e)}`), { motivo: "erro" });
  }
}

const mapCred = (r) => ({ id: r.id, userId: r.usuario_id, credentialId: r.credential_id, dispositivo: r.dispositivo, criadoEm: r.criado_em, ultimoUso: r.ultimo_uso });

async function sbResetSenha(email) {
  // Método nativo do Supabase Auth: envia e-mail de recuperação. redirectTo volta pro próprio app.
  const r = await fetch(`${SUPA.url}/auth/v1/recover`, {
    method: "POST", headers: { apikey: SUPA.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, redirect_to: typeof window !== "undefined" ? window.location.origin + window.location.pathname : undefined }),
  });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.msg || j.error_description || "Não foi possível enviar o e-mail de recuperação."); }
  return true; // Supabase sempre responde ok pra não revelar se o e-mail existe
}

async function sbLogin(email, password) {
  const r = await fetch(`${SUPA.url}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: SUPA.anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || j.msg || "Falha no login");
  return j; // { access_token, user: { id, email } }
}

/* Mapas linha do banco ↔ formato interno do app */
const hojeStr = () => new Date().toISOString().slice(0, 10);

/* ============================================================
   SANITIZAÇÃO E VALIDAÇÃO DE ENTRADAS
   O React já escapa tudo que renderiza (não usamos innerHTML em lugar nenhum),
   então XSS por renderização não se aplica. Estas funções cuidam do resto:
   limitam tamanho, removem caracteres de controle/invisíveis usados em ataques
   de homoglifo e injeção, e validam formato antes de gravar no banco.
   ============================================================ */
const LIMITES = { nome: 80, email: 120, cargo: 60, texto: 2000, obs: 300, dispositivo: 60, valorMax: 1000000 };
function limparTexto(v, max = LIMITES.texto) {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/[\u0000-\u001F\u007F]/g, " ")     // caracteres de controle
    .replace(/[\u200B-\u200F\u2028-\u202E\uFEFF]/g, "") // invisíveis / bidi override
    .trim()
    .slice(0, max);
}
const emailValido = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || "").trim()) && String(v).length <= LIMITES.email;
const uuidValido = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ""));
const dataValida = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) && !isNaN(new Date(v + "T12:00:00"));
function numeroValido(v, { min = 0, max = LIMITES.valorMax } = {}) {
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}
// Uploads: tipo e tamanho conferidos ANTES de subir pro Storage
const UPLOAD = { maxBytes: 8 * 1024 * 1024, tipos: ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"] };
function validarArquivo(file) {
  if (!file) return "Nenhum arquivo selecionado.";
  if (file.size > UPLOAD.maxBytes) return `Arquivo muito grande (${(file.size / 1048576).toFixed(1)} MB). O limite é 8 MB.`;
  const tipo = (file.type || "").toLowerCase();
  const extOk = /\.(jpe?g|png|webp|heic|pdf)$/i.test(file.name || "");
  if (!UPLOAD.tipos.includes(tipo) && !extOk) return "Formato não aceito. Envie imagem (JPG, PNG, WEBP, HEIC) ou PDF.";
  return null;
}
// nome de arquivo seguro pro Storage (evita path traversal e caracteres estranhos)
const nomeArquivoSeguro = (nome) => String(nome || "arquivo")
  .replace(/[\/\\]/g, "_").replace(/\.{2,}/g, ".").replace(/[^\w.\-]/g, "_").slice(0, 80);
const mapMarc = (r) => ({ nsr: r.nsr, userId: r.usuario_id, tipo: r.tipo, ts: r.ts, lat: r.lat, lng: r.lng, foto: null, facialOk: !!r.facial_ok, metodo: r.metodo_verificacao || null, offline: !!r.offline, criadoEm: r.criado_em || null, geoStatus: r.geo_status || null });
const mapFalta = (r) => ({ id: r.id, userId: r.usuario_id, data: r.data, justificada: !!r.justificada, motivo: r.motivo });
const mapJust = (r) => ({ id: r.id, userId: r.usuario_id, data: r.criado_em, texto: r.descricao, anexo: r.anexo_url ? { nome: r.anexo_url.split("/").pop().replace(/^\d+_/, ""), path: r.anexo_url } : null, status: r.status });
const mapAte = (r) => ({ id: r.id, userId: r.usuario_id, data: r.criado_em, nome: r.anexo_url ? r.anexo_url.split("/").pop().replace(/^\d+_/, "") : "atestado", path: r.anexo_url, preview: null, obs: r.cid, status: r.status });
const mapFer = (r) => ({ id: r.id, userId: r.usuario_id, inicio: r.data_inicio, dias: r.dias, status: r.status });
const mapLog = (r) => ({ ts: r.ts, userId: r.usuario_id || "sistema", acao: r.acao, detalhe: r.detalhe });
const mapLocal = (r) => ({ id: r.id, nome: r.nome, latitude: r.latitude, longitude: r.longitude, raio: r.raio_metros, ativo: r.ativo });
const mapConvite = (r) => ({ id: r.id, token: r.token, nome: r.nome, email: r.email, cargo: r.cargo, tipo: r.tipo, usado: r.usado, expiraEm: r.expira_em, dataAdmissao: r.data_admissao });
const mapFolga = (r) => ({ id: r.id, userId: r.usuario_id, horas: +r.horas_solicitadas, dataFolga: r.data_folga_pretendida, status: r.status, decididoEm: r.decidido_em });
/* Saldo do banco de horas: apurado nas marcações − debitado em folgas aprovadas */
function saldoBanco(userId, registros, faltas, folgas) {
  const apurado = analisarAssiduidade(userId, registros, faltas).saldoMin;
  const debitado = folgas.filter(f => f.userId === userId && f.status === "aprovada").reduce((s, f) => s + Math.round(f.horas * 60), 0);
  return { apurado, debitado, disponivel: apurado - debitado };
}
// Distância em metros entre dois pontos (fórmula de Haversine)
function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
/* ============================================================
   FOLHA DE PAGAMENTO 2026 — conferência gerencial
   Fontes: INSS Portaria Interministerial MPS/MF (vigência jan/2026);
   IRRF: Art. 3º da Lei 9.250/1995 alterado pela Lei 15.270/2025 (Reforma da Renda).
   Valores conferidos em fontes contábeis (Contabilizei, CRC) em 17/07/2026.
   ⚠ Editar aqui quando as tabelas mudarem (reajuste anual).
   ============================================================ */
const TABELAS_2026 = {
  inss: { // progressivo por faixa; teto de desconto R$ 988,09
    faixas: [
      { ate: 1621.00, aliq: 0.075 },
      { ate: 2902.84, aliq: 0.09 },
      { ate: 4354.27, aliq: 0.12 },
      { ate: 8475.55, aliq: 0.14 },
    ],
  },
  irrf: { // tabela de incidência mensal (mesma de mai/2025)
    faixas: [
      { ate: 2428.80, aliq: 0, deduz: 0 },
      { ate: 2826.65, aliq: 0.075, deduz: 182.16 },
      { ate: 3751.05, aliq: 0.15, deduz: 394.16 },
      { ate: 4664.68, aliq: 0.225, deduz: 675.49 },
      { ate: Infinity, aliq: 0.275, deduz: 908.73 },
    ],
    porDependente: 189.59,
    // Camada da Lei 15.270/2025 sobre o RENDIMENTO TRIBUTÁVEL mensal:
    reforma: { isentoAte: 5000.00, reducaoAte: 7350.00, a: 978.62, b: 0.133145 }, // redução = a − b×rendimento
  },
  fgtsPatronal: 0.08, // encargo do empregador (não desconta do colaborador; só vai na guia)
  divisorHoras: 220,  // salário-hora = salário/220 (CLT, jornada 44h semanais)
};
const r2 = (v) => Math.round((+v + Number.EPSILON) * 100) / 100;
const brl = (v) => (+v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function calcINSS(base) {
  let total = 0, piso = 0;
  for (const f of TABELAS_2026.inss.faixas) {
    if (base <= piso) break;
    total += (Math.min(base, f.ate) - piso) * f.aliq;
    piso = f.ate;
  }
  return r2(total);
}

function calcIRRF(rendimentoTributavel, inss, dependentes) {
  const T = TABELAS_2026.irrf;
  const base = Math.max(0, rendimentoTributavel - inss - dependentes * T.porDependente);
  const fx = T.faixas.find(f => base <= f.ate);
  const tradicional = Math.max(0, base * fx.aliq - fx.deduz);
  // Reforma da Renda: isenção total até 5 mil; redução linear até 7.350 (sobre o rendimento tributável)
  const R = T.reforma;
  if (rendimentoTributavel <= R.isentoAte) return 0;
  if (rendimentoTributavel <= R.reducaoAte) {
    const reducao = Math.max(0, R.a - R.b * rendimentoTributavel);
    return r2(Math.max(0, tradicional - reducao));
  }
  return r2(tradicional);
}

const mesmaComp = (dataStr, comp) => (dataStr || "").slice(0, 7) === comp.slice(0, 7);
// Chave da semana (segunda-feira) pra apurar o DSR perdido: 1 falta injustificada = perde o DSR daquela semana
const chaveSemana = (dt) => { const d = new Date(dt); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dataISO(d); };

function calcularFolhaColaborador(u, comp, registros, faltas, adiantamentos) {
  const salContratual = +u.salario || 0;
  // Admissão no meio da competência: o mês é proporcional aos dias de vínculo (salário/30 × dias),
  // prática padrão da folha brasileira. Sem isso, quem entrou no dia 16 recebia mês cheio.
  const [anoC, mesC] = comp.split("-").map(Number);
  const ultimoDiaMes = new Date(anoC, mesC, 0).getDate();
  const adm = u.admissao ? dataLocal(u.admissao) : null;
  let diasProporcionais = 30, proporcional = false;
  if (adm && adm.getFullYear() === anoC && adm.getMonth() + 1 === mesC && adm.getDate() > 1) {
    // Mês comercial de 30 dias (convenção da folha brasileira): dias de vínculo contados
    // da admissão até o fim do mês, com teto de 30 — em mês de 31 dias não paga a mais.
    diasProporcionais = Math.min(30, ultimoDiaMes - adm.getDate() + 1);
    proporcional = true;
  }
  const sal = proporcional ? r2(salContratual / 30 * diasProporcionais) : salContratual;
  // Faltas injustificadas do mês (só dias com expediente): salário/30 por dia + DSR da semana (CLT art. 64/65 + Lei 605/49)
  const faltasMes = faltas.filter(f => f.userId === u.id && !f.justificada && mesmaComp(f.data, comp) && expedienteDoDia(dataLocal(f.data)).jornadaMin > 0);
  const diasFaltas = faltasMes.length;
  const semanasComFalta = new Set(faltasMes.map(f => chaveSemana(dataLocal(f.data)))).size;
  const descFaltas = r2((sal / 30) * (diasFaltas + semanasComFalta));
  // Atrasos: tolerância de 10min/dia, desconto SÓ sobre o excedente, a salário/220 por hora
  // (minutosAtrasoDia é a mesma função do Prêmio R1 — módulos nunca divergem)
  let atrasoMin = 0;
  Object.values(agruparPorDia(registros.filter(r => mesmaComp(r.ts, comp)), u.id)).forEach(regs => {
    const ent = regs.find(r => r.tipo === "entrada");
    if (ent) atrasoMin += minutosAtrasoDia(new Date(ent.ts));
  });
  const horasAtraso = r2(atrasoMin / 60);
  const descAtrasos = r2((sal / TABELAS_2026.divisorHoras) * horasAtraso);
  // Rendimento tributável do mês = salário − faltas − atrasos
  const rendimento = Math.max(0, r2(sal - descFaltas - descAtrasos));
  const inss = calcINSS(rendimento);
  const irrf = calcIRRF(rendimento, inss, +u.dependentes || 0);
  const vt = u.vtAtivo ? r2(Math.min(0.06 * sal, +u.vtValor || 0)) : 0; // min(6% do bruto, custo do VT) — Lei 7.418/85
  const adiant = r2(adiantamentos.filter(a => a.userId === u.id && a.status === "pendente" && mesmaComp(a.competenciaDesconto, comp)).reduce((s, a) => s + (+a.valor || 0), 0));
  const liquido = r2(sal - descFaltas - descAtrasos - inss - irrf - vt - adiant);
  return {
    proporcional, diasProporcionais, salarioContratual: salContratual,
    row: {
      salario_bruto: sal, desconto_inss: inss, desconto_irrf: irrf, desconto_vale_transporte: vt,
      desconto_faltas: descFaltas, desconto_atrasos: descAtrasos, desconto_adiantamento: adiant,
      valor_liquido: liquido, dias_faltas_nao_justificadas: diasFaltas, horas_atraso_total: horasAtraso, status: "rascunho",
    },
  };
}

const mapFolhaPg = (r) => ({
  id: r.id, userId: r.usuario_id, competencia: (r.competencia || "").slice(0, 10),
  salario: +r.salario_bruto, inss: +r.desconto_inss, irrf: +r.desconto_irrf, vt: +r.desconto_vale_transporte,
  faltas: +r.desconto_faltas, atrasos: +r.desconto_atrasos, adiantamento: +r.desconto_adiantamento,
  liquido: +r.valor_liquido, diasFaltas: r.dias_faltas_nao_justificadas, horasAtraso: +r.horas_atraso_total,
  status: r.status, fechadoEm: r.fechado_em,
});
const mapAdiant = (r) => ({ id: r.id, userId: r.usuario_id, valor: +r.valor, dataSolicitacao: r.data_solicitacao, competenciaDesconto: (r.competencia_desconto || "").slice(0, 10), status: r.status, observacao: r.observacao });
const mapGuia = (r) => ({ id: r.id, competencia: (r.competencia || "").slice(0, 10), tipo: r.tipo, valor: +r.valor_total, vencimento: r.vencimento, status: r.status });

const mapUser = (r, consentiu) => ({
  id: r.id, nome: r.nome, email: r.email, cpf: r.cpf, papel: r.tipo, cargo: r.cargo, matricula: r.matricula, ativo: r.ativo,
  admissao: r.data_admissao || "2020-01-01",
  salario: +r.salario_bruto || 0, vtAtivo: !!r.vale_transporte_ativo, vtValor: +r.vale_transporte_valor_mensal || 0, dependentes: r.dependentes_irrf || 0, // preenchidos só pro gestor (view usuarios_remuneracao)
  avatar: (r.nome || "?").split(" ").filter(Boolean).map(p => p[0]).slice(0, 2).join("").toUpperCase(),
  consentimentoLGPD: !!consentiu,
});

const hoje = new Date();
const d = (offsetDias, h = 8, m = 0) => {
  const x = new Date(hoje); x.setDate(x.getDate() + offsetDias); x.setHours(h, m, 0, 0); return x;
};
const iso = (dt) => dt.toISOString();

// CPFs FICTÍCIOS de teste (dígitos verificadores válidos, não associados a pessoas reais — em produção a empresa cadastra os CPFs reais)
const USUARIOS_SEED = [
  { id: "u1", nome: "Cleiton Fernandes", email: "cleiton@renovartech.com.br", cpf: "52784193691", papel: "gestor", admissao: "2019-03-01", avatar: "CF", consentimentoLGPD: true, salario: 8000, vtAtivo: false, vtValor: 0, dependentes: 2 },
  { id: "u2", nome: "Marina Souza", email: "marina@renovartech.com.br", cpf: "31865924709", papel: "colaborador", admissao: "2023-05-10", avatar: "MS", consentimentoLGPD: true, salario: 3200, vtAtivo: true, vtValor: 240, dependentes: 1 },
  { id: "u3", nome: "Rafael Lima", email: "rafael@renovartech.com.br", cpf: "74219563873", papel: "colaborador", admissao: "2024-11-01", avatar: "RL", consentimentoLGPD: true, salario: 2400, vtAtivo: true, vtValor: 220, dependentes: 0 },
  { id: "u4", nome: "Juliana Prates", email: "juliana@renovartech.com.br", cpf: "61938475291", papel: "colaborador", admissao: "2025-12-01", avatar: "JP", consentimentoLGPD: false, salario: 1800, vtAtivo: false, vtValor: 0, dependentes: 0 },
];

// Histórico seed: Marina pontual, Rafael com atrasos recorrentes
const REGISTROS_SEED = [];
let NSR = 1;
const pushDia = (uid, off, entradaH, entradaM, saidaH, saidaM, falta = false) => {
  if (falta) return;
  REGISTROS_SEED.push(
    { nsr: NSR++, userId: uid, tipo: "entrada", ts: iso(d(off, entradaH, entradaM)), lat: -19.9245, lng: -43.9352, foto: null, facialOk: true },
    { nsr: NSR++, userId: uid, tipo: "saida", ts: iso(d(off, saidaH, saidaM)), lat: -19.9245, lng: -43.9352, foto: null, facialOk: true },
  );
};
for (let i = 10; i >= 1; i--) {
  pushDia("u2", -i, 7, 58, 18, 6);                       // Marina: sempre pontual, expediente cheio 8-18
  pushDia("u3", -i, i % 3 === 0 ? 8 : 8, i % 3 === 0 ? 40 : (i % 2 === 0 ? 25 : 2), 18, 0, i === 4); // Rafael: atrasos e 1 falta
}

const FALTAS_SEED = [{ userId: "u3", data: iso(d(-4)), motivo: "sem justificativa" }];

const RECOMENDACOES = {
  pontualidade: {
    livros: ["Os 7 Hábitos das Pessoas Altamente Eficazes — Stephen Covey", "Hábitos Atômicos — James Clear", "A Tríade do Tempo — Christian Barbosa"],
    filmes: ["Whiplash (2014) — disciplina e excelência", "À Procura da Felicidade (2006) — constância sob pressão"],
  },
  produtividade: {
    livros: ["Trabalho Focado (Deep Work) — Cal Newport", "Essencialismo — Greg McKeown", "A Única Coisa — Gary Keller"],
    filmes: ["Moneyball (2011) — foco no que gera resultado", "O Fundador (2016) — execução implacável"],
  },
  lideranca: {
    livros: ["Líderes se Servem por Último — Simon Sinek", "Pipeline de Liderança — Ram Charan", "Extreme Ownership — Jocko Willink"],
    filmes: ["Invictus (2009) — liderança que une", "Fome de Poder (2016) — visão e ambição"],
  },
};

// Data pura (DATE, sem hora): formata direto da string — new Date("YYYY-MM-DD") é UTC 00:00
// e retrocede 1 dia no fuso local (UTC-3), o clássico off-by-one.
const fmtData = (s) => {
  if (typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) && s.length === 10) {
    const [a, m, d] = s.split("-");
    return `${d}/${m}/${a}`;
  }
  return new Date(s).toLocaleDateString("pt-BR");
};
// Parsing pra CÁLCULO: data pura vira meio-dia LOCAL (imune a fuso e horário de verão)
const dataLocal = (s) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + "T12:00:00") : new Date(s));
const fmtHora = (s) => new Date(s).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const fmtDataHora = (s) => `${fmtData(s)} ${fmtHora(s)}`;
const mesesEntre = (a, b) => (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
// Soma meses com precisão de DIA (mesesEntre compara só mês do calendário e libera até 29 dias antes do prazo real)
const addMeses = (dt, n) => {
  const x = new Date(dt);
  const dia = x.getDate();
  x.setMonth(x.getMonth() + n);
  if (x.getDate() < dia) x.setDate(0); // clamp: 31/jul + 2m vira 30/set, não 01/out
  x.setHours(0, 0, 0, 0);
  return x;
};
const minutosDia = (regs) => {
  let total = 0;
  const ent = regs.filter(r => r.tipo === "entrada").map(r => new Date(r.ts));
  const sai = regs.filter(r => r.tipo === "saida").map(r => new Date(r.ts));
  for (let i = 0; i < Math.min(ent.length, sai.length); i++) total += Math.max(0, (sai[i] - ent[i]) / 60000);
  return Math.round(total);
};
const hmm = (min) => `${min < 0 ? "-" : ""}${Math.floor(Math.abs(min) / 60)}h${String(Math.abs(min) % 60).padStart(2, "0")}`;

function agruparPorDia(registros, userId) {
  const dias = {};
  registros.filter(r => r.userId === userId).forEach(r => {
    const k = new Date(r.ts).toLocaleDateString("pt-BR");
    (dias[k] = dias[k] || []).push(r);
  });
  // ORDENAÇÃO OBRIGATÓRIA: os motores identificam a primeira entrada do dia por posição
  // (regs.find(tipo === "entrada")) e pareiam entrada[i] com saída[i]. Se as marcações
  // chegarem do banco em ordem decrescente, a "primeira entrada" viraria a volta do almoço —
  // gerando atraso fantasma, perda de prêmio e desconto indevido na folha.
  // Ordenar aqui torna todo o sistema imune à ordem em que os dados são carregados.
  Object.values(dias).forEach(regs => regs.sort((a, b) => new Date(a.ts) - new Date(b.ts)));
  return dias;
}

function analisarAssiduidade(userId, registros, faltas) {
  const dias = agruparPorDia(registros, userId);
  let atrasos = 0, diasTrab = 0, saldoMin = 0;
  Object.values(dias).forEach(regs => {
    const exp = expedienteDoDia(new Date(regs[0].ts));
    if (exp.jornadaMin > 0) diasTrab++; // domingo/feriado trabalhado não conta como dia de expediente
    const ent = regs.find(r => r.tipo === "entrada");
    if (exp.jornadaMin > 0 && ent && !entradaPontual(new Date(ent.ts))) atrasos++; // tolerância de 10min sobre as 8:00 (CLT art. 58 §1º)
    // Desconto do intervalo: só em dia com intervalo previsto (seg-sex) e batida em par único que o engloba;
    // sábado (turno único) e dom/feriado não têm intervalo. Dia fechado: tudo trabalhado vira crédito.
    const pares = Math.min(regs.filter(r => r.tipo === "entrada").length, regs.filter(r => r.tipo === "saida").length);
    const descontoIntervalo = exp.intervaloMin > 0 && pares <= 1 ? exp.intervaloMin : 0;
    saldoMin += minutosDia(regs) - descontoIntervalo - exp.jornadaMin;
  });
  const nFaltas = faltas.filter(f => f.userId === userId && !f.justificada).length;
  return { atrasos, faltas: nFaltas, diasTrab, saldoMin };
}

function gerarFeedback(user, registros, faltas) {
  const a = analisarAssiduidade(user.id, registros, faltas);
  const fb = [];
  if (a.atrasos >= 3) fb.push({
    tipo: "alerta", tema: "pontualidade", titulo: `${a.atrasos} atrasos nos últimos ${a.diasTrab} dias trabalhados`,
    msg: `${user.nome.split(" ")[0]}, notamos atrasos recorrentes. Pequenos ajustes na rotina da manhã têm impacto direto no seu banco de horas e na operação da equipe. Que tal definir um horário-âncora 30min antes da entrada?`,
    rec: RECOMENDACOES.pontualidade,
  });
  if (a.faltas >= 1) fb.push({
    tipo: "alerta", tema: "produtividade", titulo: `${a.faltas} falta(s) sem justificativa no período`,
    msg: "Faltas sem justificativa impactam banco de horas e podem gerar desconto (CLT art. 473 lista as ausências legais). Se houve imprevisto, registre a justificativa ou envie atestado — o fluxo leva 2 minutos.",
    rec: RECOMENDACOES.produtividade,
  });
  if (a.atrasos === 0 && a.faltas === 0 && a.diasTrab >= 5) fb.push({
    tipo: "elogio", tema: "lideranca", titulo: "Assiduidade exemplar 🏆",
    msg: `${user.nome.split(" ")[0]}, ${a.diasTrab} dias sem nenhum atraso ou falta e saldo positivo de ${hmm(a.saldoMin)} no banco de horas. Consistência é o que separa profissionais fora da curva — continue assim. Preparamos recomendações pra sua próxima etapa: liderança.`,
    rec: RECOMENDACOES.lideranca,
  });
  if (fb.length === 0) fb.push({
    tipo: "neutro", tema: "produtividade", titulo: "Tudo em dia",
    msg: "Sem pendências relevantes no período. Recomendações pra manter o ritmo:",
    rec: RECOMENDACOES.produtividade,
  });
  return { analise: a, feedbacks: fb };
}

/* ============================================================
   PRÊMIO PERFORMANCE — elegibilidade (CLT art. 457 §4º)
   Prêmio = liberalidade por desempenho superior, condicionada a
   critérios objetivos, prospectivos e divulgados. NÃO é desconto
   de salário/comissão contratual (vedado pelo art. 462).
   Faltas justificadas (atestado aceito / ausências legais do
   art. 473) NUNCA contam contra o colaborador.
   ============================================================ */
// toleranciaMin herdada do EXPEDIENTE: fonte ÚNICA da tolerância de atraso (CLT art. 58 §1º)
// — mudar em EXPEDIENTE.toleranciaMin propaga pra pontualidade, gamificação, assiduidade, prêmio E folha.
const PREMIO = { limiteAtrasoMin: 60, limiteFaltas: 2, toleranciaMin: EXPEDIENTE.toleranciaMin, bonusPontualidade: 0.10 };

const REGRAS_PREMIO = [
  { id: "R1", corte: true, titulo: "Atrasos até 60 min no mês", desc: `Soma dos minutos de atraso na entrada deve ficar em até ${PREMIO.limiteAtrasoMin} min no mês — contando, em cada ocorrência, apenas os minutos que EXCEDEM a tolerância de ${PREMIO.toleranciaMin} min (ex.: chegar 8:25 soma 15 min, não 25). Acima do limite, o prêmio do mês não é devido, mesmo com meta batida.` },
  { id: "R2", corte: true, titulo: "Menos de 2 faltas injustificadas", desc: "Duas ou mais faltas sem atestado ou documento aceito no mês tornam o prêmio do mês não devido. Faltas com atestado aceito e ausências legais (CLT art. 473) não contam." },
  { id: "R3", corte: true, titulo: "Meta individual atingida (≥100%)", desc: "O prêmio é calculado sobre o atingimento da meta do mês: 100% paga o prêmio integral; 110% e 120% destravam multiplicadores de 1,15x e 1,3x." },
  { id: "R4", corte: true, titulo: "Documentação em até 48h", desc: "Justificativas e atestados devem ser enviados no sistema em até 48h da ocorrência. Documento aceito neutraliza a falta pra fins do prêmio." },
  { id: "R5", corte: true, titulo: "Espelho de ponto íntegro", desc: "Todas as marcações do mês com pares entrada/saída completos ou regularizados até o fechamento. Marcação pendente sem regularização suspende a apuração até resolver." },
  { id: "R6", corte: false, titulo: "Bônus pontualidade perfeita (+10%)", desc: "Mês sem nenhum atraso (zero minutos acumulados) adiciona 10% ao valor do prêmio. Incentivo positivo — não reduz nada de quem não atingir." },
];

function elegibilidadePremio(userId, registros, faltas) {
  const agora = new Date();
  const mesmoMes = (s) => { const dt = dataLocal(s); return dt.getMonth() === agora.getMonth() && dt.getFullYear() === agora.getFullYear(); };
  let atrasoMin = 0;
  Object.values(agruparPorDia(registros, userId)).forEach(regs => {
    const ent = regs.find(r => r.tipo === "entrada");
    if (!ent || !mesmoMes(ent.ts)) return;
    atrasoMin += minutosAtrasoDia(new Date(ent.ts)); // função compartilhada com a folha — mesma régua por construção
  });
  // Falta lançada em domingo/feriado não pode punir: não havia expediente pra faltar.
  // Mesma regra da folha e da gamificação — os três motores usam a mesma peneira.
  const faltasInj = faltas.filter(f => f.userId === userId && !f.justificada && mesmoMes(f.data)
    && expedienteDoDia(dataLocal(f.data)).jornadaMin > 0).length;
  const medidores = [
    { id: "R1", label: "Atrasos acumulados no mês", valor: atrasoMin, limite: PREMIO.limiteAtrasoMin, unidade: " min", regraTexto: `perde o prêmio acima de ${PREMIO.limiteAtrasoMin} min`, estourou: atrasoMin > PREMIO.limiteAtrasoMin },
    { id: "R2", label: "Faltas injustificadas no mês", valor: faltasInj, limite: PREMIO.limiteFaltas, unidade: "", regraTexto: `perde o prêmio com ${PREMIO.limiteFaltas} ou mais`, estourou: faltasInj >= PREMIO.limiteFaltas },
  ];
  const bonusPontualidade = atrasoMin === 0;
  return { atrasoMin, faltasInj, medidores, elegivel: !medidores.some(m => m.estourou), bonusPontualidade };
}

const corMedidor = (pct) => (pct >= 1 ? C.vermelho : pct >= 0.7 ? C.amarelo : C.verde);

/* ============================================================
   GAMIFICAÇÃO — sistema de pontos
   Regras transparentes e apenas sobre métricas positivas/neutras
   (faltas justificadas e atestados NUNCA pontuam negativo nem
   aparecem — só a ausência de falta injustificada pontua).
   ============================================================ */
const GAME = {
  ptsDiaPontual: 10,        // entrada dentro da tolerância (até 08:10)
  ptsBonusStreak: 5,        // bônus por dia pontual a partir do 3º dia consecutivo
  marcosStreak: { 5: 30, 10: 75, 20: 200 },  // marcos de sequência (pagos 1x por sequência)
  ptsMesSemFalta: 50,       // mês corrente sem falta injustificada
  ptsMetaAssiduidade: 200,  // meta de assiduidade do mês = critérios R1+R2 do Prêmio ok no fechamento
};

const NIVEIS = [
  { nome: "Bronze",   min: 0,   icone: "🥉", cor: "#CD7F32" },
  { nome: "Prata",    min: 200, icone: "🥈", cor: "#C0C0C0" },
  { nome: "Ouro",     min: 450, icone: "🥇", cor: "#FFD600" },
  { nome: "Diamante", min: 800, icone: "💎", cor: "#7FDBFF" },
];

function nivelDe(pontos) {
  const idx = NIVEIS.map(n => n.min <= pontos).lastIndexOf(true);
  const atual = NIVEIS[idx];
  const proximo = NIVEIS[idx + 1] || null;
  const progresso = proximo ? (pontos - atual.min) / (proximo.min - atual.min) : 1;
  return { atual, proximo, progresso, faltam: proximo ? proximo.min - pontos : 0 };
}

function calcularGamificacao(userId, registros, faltas) {
  const eventos = Object.values(agruparPorDia(registros, userId)).map(regs => {
    const ent = regs.find(r => r.tipo === "entrada");
    if (!ent) return null;
    const dt = new Date(ent.ts);
    if (expedienteDoDia(dt).jornadaMin === 0) return null; // dom/feriado: fora da régua de pontualidade
    return { data: dt, pontual: entradaPontual(dt) };
  }).filter(Boolean);
  faltas.filter(f => f.userId === userId && !f.justificada && expedienteDoDia(new Date(f.data + (f.data.length === 10 ? "T12:00:00" : ""))).jornadaMin > 0)
    .forEach(f => eventos.push({ data: new Date(f.data), pontual: false, falta: true }));
  eventos.sort((a, b) => a.data - b.data);

  let streak = 0, melhorStreak = 0, ptsPontual = 0, ptsStreak = 0, ptsMarcos = 0;
  const marcosBatidos = [];
  eventos.forEach(e => {
    if (e.falta || !e.pontual) { streak = 0; return; }
    streak++;
    melhorStreak = Math.max(melhorStreak, streak);
    ptsPontual += GAME.ptsDiaPontual;
    if (streak >= 3) ptsStreak += GAME.ptsBonusStreak;
    if (GAME.marcosStreak[streak]) { ptsMarcos += GAME.marcosStreak[streak]; marcosBatidos.push(streak); }
  });

  const eleg = elegibilidadePremio(userId, registros, faltas);
  const temDias = eventos.some(e => !e.falta);
  const mesSemFalta = temDias && eleg.faltasInj === 0;
  const metaAssiduidade = temDias && eleg.elegivel; // apuração parcial; consolida no fechamento do mês

  const linhas = [
    { label: `Dias com entrada pontual (${GAME.ptsDiaPontual} pts/dia)`, pts: ptsPontual },
    { label: `Bônus de sequência (+${GAME.ptsBonusStreak}/dia a partir do 3º dia seguido)`, pts: ptsStreak },
    { label: `Marcos de sequência batidos${marcosBatidos.length ? ` (${marcosBatidos.map(m => m + " dias").join(", ")})` : ""}`, pts: ptsMarcos },
    { label: "Mês corrente sem falta injustificada", pts: mesSemFalta ? GAME.ptsMesSemFalta : 0 },
    { label: "Meta de assiduidade do mês (projetado — consolida no fechamento)", pts: metaAssiduidade ? GAME.ptsMetaAssiduidade : 0, projetado: true },
  ];
  const diasTrab = eventos.filter(e => !e.falta).length;
  const diasPontuais = ptsPontual / GAME.ptsDiaPontual;
  return { total: linhas.reduce((s, l) => s + l.pts, 0), linhas, streak, melhorStreak, mesSemFalta, metaAssiduidade, diasTrab, diasPontuais };
}

/* ---------- Badges / conquistas ----------
   Cada badge define uma métrica {valor, alvo}; conquistada quando valor >= alvo.
   Só métricas positivas — nada de expor faltas ou atestados. */
const BADGES = [
  { id: "b1", icone: "🌱", nome: "Primeira batida", desc: "Registrou o primeiro ponto no sistema", m: (g) => ({ valor: g.diasTrab, alvo: 1 }) },
  { id: "b2", icone: "⏰", nome: "Aquecendo", desc: "3 dias seguidos sem atraso", m: (g) => ({ valor: g.melhorStreak, alvo: 3 }) },
  { id: "b3", icone: "🔥", nome: "7 dias sem atraso", desc: "Uma semana inteira de pontualidade", m: (g) => ({ valor: g.melhorStreak, alvo: 7 }) },
  { id: "b4", icone: "🚀", nome: "15 dias de streak", desc: "Quinzena impecável", m: (g) => ({ valor: g.melhorStreak, alvo: 15 }) },
  { id: "b5", icone: "🏔", nome: "30 dias de streak", desc: "Um mês inteiro de sequência — elite", m: (g) => ({ valor: g.melhorStreak, alvo: 30 }) },
  { id: "b6", icone: "✨", nome: "Mês perfeito", desc: "Mês dentro da meta de assiduidade e sem nenhum atraso", m: (g) => ({ valor: g.metaAssiduidade && g.diasTrab >= 5 && g.diasPontuais === g.diasTrab ? 1 : 0, alvo: 1 }) },
  { id: "b7", icone: "🎯", nome: "Sempre no horário", desc: "100% das entradas pontuais com 10+ dias trabalhados", m: (g) => ({ valor: g.diasTrab >= 10 && g.diasPontuais === g.diasTrab ? 1 : 0, alvo: 1, progresso: g.diasTrab ? g.diasPontuais / Math.max(10, g.diasTrab) : 0 }) },
  { id: "b8", icone: "🥇", nome: "Clube dos 500", desc: "Acumulou 500 pontos", m: (g) => ({ valor: g.total, alvo: 500 }) },
  { id: "b9", icone: "💎", nome: "Elite Diamante", desc: "Alcançou o nível Diamante", m: (g) => ({ valor: g.total, alvo: NIVEIS[3].min }) },
];

function calcularBadges(g) {
  return BADGES.map(b => {
    const { valor, alvo, progresso } = b.m(g);
    const pct = progresso !== undefined ? progresso : Math.min(1, alvo ? valor / alvo : 0);
    return { ...b, valor, alvo, pct, conquistada: valor >= alvo };
  });
}


/* ============================================================
   GERADOR FISCAL — AFD (leiaute 003) e AEJ (leiaute 001)
   Portaria MTP 671/2021 · transcrito do módulo afd-aej-generator.js
   ============================================================ */
const CRLF = "\r\n";
const padA = (v, len) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").slice(0, len).padEnd(len, " ");
const padN = (v, len) => String(v ?? "").replace(/\D/g, "").slice(-len).padStart(len, "0");
const soDigitos = (v) => String(v ?? "").replace(/\D/g, "");
const fmtDfis = (dt) => {
  if (typeof dt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dt)) return dt;
  const x = new Date(dt);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const fmtDH = (dt) => {
  const x = new Date(dt);
  const off = -x.getTimezoneOffset();
  const zz = `${off >= 0 ? "+" : "-"}${String(Math.floor(Math.abs(off) / 60)).padStart(2, "0")}${String(Math.abs(off) % 60).padStart(2, "0")}`;
  return `${fmtDfis(x)}T${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}:00${zz}`;
};
const fmtHfis = (hhmm) => soDigitos(hhmm).padStart(4, "0").slice(0, 4);

// CRC-16/KERMIT (CCITT-TRUE) — registros tipos 1 a 5 do AFD. Vetor oficial: "123456789" → "2189"
function crc16Kermit(str) {
  let crc = 0x0000;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) & 0xff;
    for (let j = 0; j < 8; j++) crc = crc & 1 ? (crc >>> 1) ^ 0x8408 : crc >>> 1;
  }
  return (crc & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function gerarAFDReal(config, marcacoes, eventos = []) {
  const linhas = [];
  const datas = marcacoes.map((m) => new Date(m.tsMarcacao));
  const dataIni = datas.length ? new Date(Math.min(...datas)) : new Date();
  const dataFim = datas.length ? new Date(Math.max(...datas)) : new Date();
  // Tipo 1 · Cabeçalho (302 posições)
  let cab = padN("0", 9) + "1" + padN(config.tpIdtEmpregador, 1) + padN(config.idtEmpregador, 14) +
    padN(config.cnoCaepf || "0", 14) + padA(config.razaoSocial, 150) + padN(config.nrInpi, 17) +
    fmtDfis(dataIni) + fmtDfis(dataFim) + fmtDH(new Date()) + "003" +
    padN(config.tpIdtDesenv, 1) + padN(config.idtDesenv, 14) + padA("", 30);
  cab += crc16Kermit(cab);
  linhas.push(cab);
  // Tipo 6 · Eventos sensíveis
  for (const e of eventos) linhas.push(padN(e.nsr, 9) + "6" + fmtDH(e.ts) + padN(e.tipo, 2));
  // Tipo 7 · Marcações REP-P com cadeia SHA-256
  let hashAnterior = "";
  for (const m of [...marcacoes].sort((a, b) => a.nsr - b.nsr)) {
    const campos1a7 = padN(m.nsr, 9) + "7" + fmtDH(m.tsMarcacao) + padN(soDigitos(m.cpf), 12) +
      fmtDH(m.tsGravacao || m.tsMarcacao) + padN(m.coletor || "02", 2) + (m.offline ? "1" : "0");
    const hash = await sha256Hex(campos1a7 + hashAnterior);
    linhas.push(campos1a7 + hash);
    hashAnterior = hash;
  }
  // Tipo 9 · Trailer + assinatura
  const qtd = (t) => padN(linhas.filter((l) => l[9] === t).length, 9);
  linhas.push(padN("999999999", 9) + qtd("2") + qtd("3") + qtd("4") + qtd("5") + qtd("6") + qtd("7") + "9");
  linhas.push(padA("ASSINATURA_DIGITAL_EM_ARQUIVO_P7S", 100));
  return { conteudo: linhas.join(CRLF) + CRLF, nomeArquivo: `AFD${soDigitos(config.nrInpi)}${soDigitos(config.idtEmpregador)}REP_P.txt` };
}

function gerarAEJReal(config, vinculos, horarios, marcacoes, ausencias, periodo) {
  const L = [];
  const j = (...campos) => campos.join("|");
  L.push(j("01", config.tpIdtEmpregador, soDigitos(config.idtEmpregador), soDigitos(config.caepf || ""), soDigitos(config.cno || ""), config.razaoSocial, fmtDfis(periodo.ini), fmtDfis(periodo.fim), fmtDH(new Date()), "001"));
  L.push(j("02", "1", "3", padN(config.nrInpi, 17)));
  for (const v of vinculos) L.push(j("03", v.id, padN(soDigitos(v.cpf), 11), v.nome));
  for (const h of horarios) L.push(j("04", h.cod, h.durMin, ...h.pares.flat().map(fmtHfis)));
  for (const m of marcacoes) {
    L.push(j("05", m.vinculoId, fmtDH(m.ts), "1", m.tpMarc, padN(m.seq, 3), m.fonte || "O",
      m.tpMarc === "E" && m.seq === 1 ? (m.codHor || horarios[0]?.cod || "") : "",
      m.tpMarc === "D" || m.fonte === "I" ? (m.motivo || "ajuste") : ""));
  }
  for (const v of vinculos.filter((v) => v.matEsocial)) L.push(j("06", v.id, v.matEsocial));
  for (const a of ausencias) L.push(j("07", a.vinculoId, a.tipo, fmtDfis(a.data), a.tipo === "3" ? String(a.qtMinutos ?? 0) : "", a.tipo === "3" ? String(a.tipoMovBH ?? "1") : ""));
  const p = config.ptrp;
  L.push(j("08", p.nome, p.versao, p.tpIdtDesenv, soDigitos(p.idtDesenv), p.razaoNome, p.email));
  const q = (t) => String(L.filter((l) => l.startsWith(t + "|")).length);
  L.push(j("99", q("01"), q("02"), q("03"), q("04"), q("05"), q("06"), q("07"), q("08")));
  L.push(padA("ASSINATURA_DIGITAL_EM_ARQUIVO_P7S", 100));
  return { conteudo: L.join(CRLF) + CRLF, nomeArquivo: `AEJ_${soDigitos(config.idtEmpregador)}_${fmtDfis(periodo.ini)}_${fmtDfis(periodo.fim)}.txt` };
}

// Download em ISO 8859-1, conforme o leiaute (não UTF-8)
function baixarArquivo(conteudo, nome) {
  const bytes = new Uint8Array([...conteudo].map((c) => Math.min(c.charCodeAt(0), 255)));
  const blob = new Blob([bytes], { type: "text/plain;charset=ISO-8859-1" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  a.click();
  URL.revokeObjectURL(a.href);
}


function MedidorPremio({ m }) {
  const pct = Math.min(1, m.limite ? m.valor / m.limite : 0);
  const cor = m.estourou ? C.vermelho : corMedidor(pct);
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
        <span>{m.label}</span>
        <b style={{ color: cor }}>{m.valor}{m.unidade} / {m.limite}{m.unidade}</b>
      </div>
      <div style={{ background: "#1E3450", borderRadius: 999, height: 10, marginTop: 6, overflow: "hidden" }}>
        <div style={{ width: `${pct * 100}%`, background: cor, height: "100%", transition: "width .4s" }} />
      </div>
      <div style={{ fontSize: 11, color: m.estourou ? C.vermelho : C.cinza, marginTop: 4 }}>
        {m.estourou ? `⛔ Limite ultrapassado — ${m.regraTexto}` : pct >= 0.7 ? `⚠️ Atenção: você está a ${m.limite - m.valor}${m.unidade || ""} do limite (${m.regraTexto})` : `Regra: ${m.regraTexto}`}
      </div>
    </div>
  );
}

/* ================= UI base ================= */
/* Paleta "alta performance" v2 — azul-marinho (base), laranja neon (ações/destaque),
   marrom escuro (superfícies secundárias: inputs/painéis internos), branco (texto).
   As chaves mantêm os nomes antigos pra não tocar o arquivo inteiro:
   preto=fundo navy · carvao=card navy · grafite=marrom secundário · amarelo=LARANJA de destaque */
/* Contrastes verificados (WCAG 2.1 AA — mínimo 4.5 para texto normal, 3.0 para texto grande/UI):
   branco/fundo 16.2 · branco/card 14.8 · cinza/card 6.2 · laranja/card 6.1 · verde/card 6.9 ·
   vermelho/card 5.7 · texto escuro sobre botão laranja 7.2.
   O vermelho anterior (#E5484D) reprovava em AA (4.05 no card) — trocado por #F87171. */
const C = { preto: "#0D1B2A", carvao: "#10233B", grafite: "#2E1D12", amarelo: "#FF7A1A", vermelho: "#F87171", verde: "#35C26E", cinza: "#8FA3BF", branco: "#F5F7FA" };
const S = {
  app: { minHeight: "100vh", background: C.preto, color: C.branco, fontFamily: "'Inter','Segoe UI',system-ui,sans-serif" },
  display: { fontFamily: "'Oswald','Arial Narrow',sans-serif", textTransform: "uppercase", letterSpacing: "0.04em" },
  card: { background: C.carvao, border: "1px solid #1E3450", borderRadius: 14, padding: 20 },
  btn: { background: C.amarelo, color: "#111", fontWeight: 700, border: "none", borderRadius: 10, padding: "12px 20px", cursor: "pointer", fontSize: 15 },
  btnGhost: { background: "transparent", color: C.branco, border: "1px solid #2A4568", borderRadius: 10, padding: "10px 16px", cursor: "pointer" },
  input: { background: C.grafite, border: "1px solid #2A4568", borderRadius: 10, padding: "12px 14px", color: C.branco, width: "100%", fontSize: 15 },
  tag: (bg, fg) => ({ background: bg, color: fg || "#111", borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 700, display: "inline-block" }),
};

const Badge = ({ st }) => {
  const map = { pendente: [C.amarelo, "#111", "PENDENTE"], aprovado: [C.verde, "#fff", "APROVADO"], aprovada: [C.verde, "#fff", "APROVADA"], recusado: [C.vermelho, "#fff", "RECUSADO"], rejeitado: [C.vermelho, "#fff", "REJEITADO"], rejeitada: [C.vermelho, "#fff", "REJEITADA"] };
  const [bg, fg, tx] = map[st] || map.pendente;
  return <span style={S.tag(bg, fg)}>{tx}</span>;
};

function BiometriaCheck({ credenciais, onAprovado, onSemVerificacao, onIrConfigurar, token, demo }) {
  const [estado, setEstado] = useState("pronto"); // pronto | verificando | erro
  const [erro, setErro] = useState(null);
  const [motivo, setMotivo] = useState(null);
  const diag = bioDiagnostico();
  const semCredencial = credenciais.length === 0;

  const verificar = async () => {
    setEstado("verificando"); setErro(null); setMotivo(null);
    try {
      const r = await bioVerificar(credenciais, token, demo);
      onAprovado({ ok: true, metodo: r.metodo, credentialId: r.credentialId });
    } catch (e) {
      setErro(e.message); setMotivo(e.motivo || "erro"); setEstado("erro");
    }
  };

  // Bloqueios de ambiente: não adianta nem tentar — explica e oferece o caminho controlado
  if (!diag.ok || semCredencial) {
    const m = semCredencial
      ? "Você ainda não configurou a biometria neste aparelho."
      : diag.msg;
    return (
      <div style={{ marginTop: 16, textAlign: "left", background: C.grafite, borderRadius: 12, padding: 16 }}>
        <div style={{ ...S.display, fontSize: 14, color: C.amarelo }}>🔐 Verificação de identidade indisponível</div>
        <p style={{ fontSize: 13, color: C.branco, marginTop: 8, lineHeight: 1.6 }}>{m}</p>
        <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          {semCredencial && diag.ok && <button style={{ ...S.btn, padding: "10px 16px", fontSize: 13 }} onClick={onIrConfigurar}>Configurar biometria agora</button>}
          <button style={{ ...S.btnGhost, padding: "10px 16px", fontSize: 13 }} onClick={() => onSemVerificacao(semCredencial ? "sem_credencial" : diag.motivo)}>
            Registrar ponto sem verificação
          </button>
        </div>
        <p style={{ fontSize: 11.5, color: C.cinza, marginTop: 10, lineHeight: 1.5 }}>
          ⚠️ A batida sem verificação <b>é registrada normalmente</b> (sua jornada não fica prejudicada), mas fica <b>sinalizada pro gestor</b> no espelho e na trilha de auditoria como "sem verificação biométrica".
        </p>
      </div>
    );
  }

  return (
    <div role="group" aria-label="Verificação de identidade" style={{ marginTop: 16, textAlign: "center" }}>
      <div style={{ fontSize: 46 }} aria-hidden="true">🔒</div>
      <p style={{ fontSize: 14, color: C.branco, marginTop: 6 }}>Confirme sua identidade com <b>Face ID / digital do seu aparelho</b></p>
      <p style={{ fontSize: 11.5, color: C.cinza, marginTop: 4, lineHeight: 1.5 }}>A checagem acontece no próprio celular — a empresa não recebe nem guarda sua face ou digital. {demo ? "(modo demonstração: sem validação no servidor)" : "A assinatura é validada no servidor antes do ponto ser gravado."}</p>
      <button aria-label="Confirmar identidade com a biometria do aparelho e registrar o ponto" style={{ ...S.btn, marginTop: 14, fontSize: 16, padding: "14px 28px", opacity: estado === "verificando" ? 0.6 : 1 }} disabled={estado === "verificando"} onClick={verificar}>
        {estado === "verificando" ? "⏳ Aguardando biometria…" : "Verificar e registrar ponto"}
      </button>
      {erro && (
        <div style={{ marginTop: 14, textAlign: "left", background: C.grafite, borderRadius: 10, padding: 14 }}>
          <p style={{ fontSize: 13, color: C.vermelho, lineHeight: 1.55 }}>{erro}</p>
          <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
            <button style={{ ...S.btnGhost, padding: "8px 14px", fontSize: 12 }} onClick={verificar}>Tentar de novo</button>
            <button style={{ ...S.btnGhost, padding: "8px 14px", fontSize: 12 }} onClick={() => onSemVerificacao(motivo)}>Registrar sem verificação</button>
          </div>
          <p style={{ fontSize: 11, color: C.cinza, marginTop: 8 }}>Registrar sem verificação não bloqueia sua jornada, mas fica sinalizado pro gestor.</p>
        </div>
      )}
    </div>
  );
}

function CameraCapture({ onCapture, onSkip }) {
  const videoRef = useRef(null);
  const [erro, setErro] = useState(null);
  const [stream, setStream] = useState(null);
  useEffect(() => {
    let st;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: "user" } })
      .then(s => { st = s; setStream(s); if (videoRef.current) videoRef.current.srcObject = s; })
      .catch(() => setErro("Câmera indisponível ou permissão negada. Você pode registrar sem foto (será marcado no log)."));
    return () => st?.getTracks().forEach(t => t.stop());
  }, []);
  const capturar = () => {
    const v = videoRef.current;
    const cv = document.createElement("canvas");
    cv.width = v.videoWidth || 480; cv.height = v.videoHeight || 360;
    cv.getContext("2d").drawImage(v, 0, 0);
    stream?.getTracks().forEach(t => t.stop());
    onCapture(cv.toDataURL("image/jpeg", 0.7));
  };
  return (
    <div style={{ textAlign: "center" }}>
      {erro ? <p style={{ color: C.vermelho, fontSize: 14 }}>{erro}</p> : (
        <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", maxWidth: 380, borderRadius: 12, border: `2px solid ${C.amarelo}` }} />
      )}
      <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 14 }}>
        {!erro && <button style={S.btn} onClick={capturar}>📸 Capturar e validar</button>}
        <button style={S.btnGhost} onClick={onSkip}>Registrar sem foto</button>
      </div>
      <p style={{ fontSize: 12, color: C.cinza, marginTop: 10 }}>Reconhecimento facial: neste protótipo a validação é simulada — a foto fica vinculada ao registro. Em produção: AWS Rekognition / FaceIO.</p>
    </div>
  );
}

function RecCard({ rec }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
      <div>
        <div style={{ ...S.display, fontSize: 13, color: C.amarelo }}>📚 Livros</div>
        {rec.livros.map((l, i) => <div key={i} style={{ fontSize: 13, color: "#C7D2E4", marginTop: 4 }}>• {l}</div>)}
      </div>
      <div>
        <div style={{ ...S.display, fontSize: 13, color: C.amarelo }}>🎬 Filmes</div>
        {rec.filmes.map((f, i) => <div key={i} style={{ fontSize: 13, color: "#C7D2E4", marginTop: 4 }}>• {f}</div>)}
      </div>
    </div>
  );
}

/* ================= App ================= */
export default function App() {
  const [demo, setDemo] = useState(false);
  const [sessao, setSessao] = useState(null); // { token, uid }
  const [user, setUser] = useState(null);
  const [usuarios, setUsuarios] = useState([]);
  const [registros, setRegistros] = useState([]);
  const [faltas, setFaltas] = useState([]);
  const [justificativas, setJustificativas] = useState([]);
  const [atestados, setAtestados] = useState([]);
  const [ferias, setFerias] = useState([]);
  const [logs, setLogs] = useState([]);
  const [locais, setLocais] = useState([]);
  const [bloqueioGeo, setBloqueioGeo] = useState(null);
  const [convites, setConvites] = useState([]);
  const [folgas, setFolgas] = useState([]);
  const [feriados, setFeriados] = useState([]);
  const [saidasPend, setSaidasPend] = useState([]); // registros_ponto com saida_automatica e sem confirmação
  const [folhasPg, setFolhasPg] = useState([]);
  const [adiantamentos, setAdiantamentos] = useState([]);
  const [guias, setGuias] = useState([]);
  const [rankingUsuarios, setRankingUsuarios] = useState([]); // nomes públicos p/ ranking de gamificação (todos veem)
  const [credenciais, setCredenciais] = useState([]); // credenciais WebAuthn (dados públicos)
  const [sessaoExpirada, setSessaoExpirada] = useState(false);
  const [carregandoSecundarios, setCarregandoSecundarios] = useState(false);
  const [aviso, setAviso] = useState(null); // { tipo: "erro"|"ok", texto }
  const avisar = (texto, tipo = "erro") => setAviso({ tipo, texto });
  const [fila, setFila] = useState([]);
  const [enviandoFila, setEnviandoFila] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [lembrete, setLembrete] = useState(null);
  const [notifStatus, setNotifStatus] = useState(typeof Notification !== "undefined" ? Notification.permission : "unsupported");
  const lembretesDisparados = useRef({});
  const [conviteToken] = useState(() => { try { return new URLSearchParams(window.location.search).get("convite"); } catch { return null; } });
  const [tela, setTela] = useState("ponto");
  const [fluxoPonto, setFluxoPonto] = useState(null);
  const [geo, setGeo] = useState(null);
  const [comprovante, setComprovante] = useState(null);
  const [relogio, setRelogio] = useState(new Date());
  const [salvando, setSalvando] = useState(false);
  const [erroDados, setErroDados] = useState(null);
  useEffect(() => { const t = setInterval(() => setRelogio(new Date()), 1000); return () => clearInterval(t); }, []);

  const log = (acao, detalhe) => {
    setLogs(l => [{ ts: iso(new Date()), userId: user?.id || "anon", acao, detalhe }, ...l]);
    if (!demo && sessao) sbInsert(sessao.token, "auditoria", [{ usuario_id: user?.id ?? null, acao, detalhe }], true).catch(e => console.warn("[auditoria]", e.message));
  };

  // Auditoria crítica (confirmação/correção de saída automática e afins): AGUARDADA, com 1 retry.
  // Diferente do log() comum, aqui a falha não é engolida — quem chamar decide como reagir.
  const auditar = async (acao, detalhe) => {
    setLogs(l => [{ ts: iso(new Date()), userId: user?.id || "anon", acao, detalhe }, ...l]);
    if (demo || !sessao) return;
    try {
      await sbInsert(sessao.token, "auditoria", [{ usuario_id: user?.id ?? null, acao, detalhe }], true);
    } catch (e1) {
      await new Promise(r => setTimeout(r, 800)); // retry único após falha transitória
      await sbInsert(sessao.token, "auditoria", [{ usuario_id: user?.id ?? null, acao, detalhe }], true);
    }
  };

  /* ---------- login ---------- */
  const entrarSupabase = async (email, senha) => {
    const auth = await sbLogin(email, senha); // lança erro se credencial inválida
    const token = auth.access_token, uid = auth.user.id;
    const [perfis, consents] = await Promise.all([
      sbSelect(token, "usuarios", `select=*&id=eq.${uid}`),
      sbSelect(token, "consentimentos_lgpd", `select=*&usuario_id=eq.${uid}`),
    ]);
    if (!perfis.length) throw new Error("Perfil não encontrado na tabela usuarios.");
    if (perfis[0].ativo === false) throw new Error("Usuário inativo. Fale com o RH.");
    const perfil = mapUser(perfis[0], consents[0]?.aceito);
    setSessao({ token, uid });
    setUser(perfil);
    await carregarDados(token, perfil);
    setTela("ponto");
  };

  /* Carregamento em DUAS FASES.
     Antes: 18 consultas antes de mostrar qualquer coisa — o colaborador esperava a folha de
     pagamento e a auditoria carregarem só pra bater o ponto.
     Agora: fase 1 traz o essencial pra registrar ponto e libera a tela; o resto (relatórios,
     folha, auditoria, gestão) chega em segundo plano, com indicador discreto. */
  const carregarDados = async (token, perfil) => {
    setErroDados(null);
    try {
      // ---------- FASE 1: o mínimo pra bater ponto ----------
      const [us, marcs, cons, locs, fds, rps, creds] = await Promise.all([
        // Colunas explícitas: as de remuneração foram revogadas de "authenticated" no banco
        // e só chegam ao gestor pela view usuarios_remuneracao (carregada na fase 2).
        sbSelect(token, "usuarios", "select=id,nome,email,cpf,cargo,tipo,matricula,data_admissao,ativo,criado_em&order=nome"),
        sbSelect(token, "marcacoes", "select=*&order=nsr.desc&limit=400"), // fase 1: recentes bastam pra abrir a tela; a fase 2 completa o histórico
        sbSelect(token, "consentimentos_lgpd", "select=*"),
        sbSelect(token, "locais_trabalho", "select=*&order=criado_em"),
        sbSelect(token, "feriados_nacionais", "select=*&order=data"),
        sbSelect(token, "registros_ponto", "select=*&saida_automatica=eq.true&order=data.desc"),
        sbSelect(token, "credenciais_biometricas", "select=*&order=criado_em.desc"),
      ]);
      const consentDe = (uid) => cons.find(c => c.usuario_id === uid)?.aceito;
      setUsuarios(us.map(u => mapUser(u, consentDe(u.id))));
      setFeriadosGlobal(fds);
      setFeriados(fds);
      // Marcações com override de saída corrigida: espelho/banco usam o horário corrigido,
      // mas o AFD preserva o timestamp original (tsOriginal) — marcação fiscal é imutável.
      let regsMap = marcs.map(r => ({ ...mapMarc(r), automatica: !!r.automatica }));
      rps.filter(rp => rp.editado_manualmente && rp.saida).forEach(rp => {
        const doDiaSaidas = regsMap.filter(x => x.userId === rp.usuario_id && x.tipo === "saida" && dataISO(new Date(x.ts)) === rp.data);
        const ultima = doDiaSaidas[doDiaSaidas.length - 1];
        if (ultima) { ultima.tsOriginal = ultima.tsOriginal || ultima.ts; ultima.ts = `${rp.data}T${rp.saida}`; ultima.ajustada = true; }
      });
      setRegistros(regsMap);
      setSaidasPend(rps.map(rp => ({ id: rp.id, userId: rp.usuario_id, data: rp.data, saida: (rp.saida || "").slice(0, 5), confirmada: !!rp.saida_confirmada })));
      setLocais(locs.map(mapLocal));
      setCredenciais(creds.map(mapCred));
      setCarregandoSecundarios(true);

      // ---------- FASE 2: complementos (não bloqueiam a tela de ponto) ----------
      (async () => {
        try {
          const [marcsCompleto, flts, justs, ates, fers, auds, convs, flgs, fpgs, adts, gfs, rkg, remun] = await Promise.all([
            sbSelect(token, "marcacoes", "select=*&order=nsr"), // histórico completo: AFD/AEJ e relatórios exigem o período inteiro
            sbSelect(token, "faltas", "select=*&order=data"),
            sbSelect(token, "justificativas", "select=*&order=criado_em.desc"),
            sbSelect(token, "atestados", "select=*&order=criado_em.desc"),
            sbSelect(token, "ferias", "select=*&order=criado_em.desc"),
            perfil.papel === "gestor" ? sbSelect(token, "auditoria", "select=*&order=ts.desc&limit=300") : Promise.resolve([]),
            perfil.papel === "gestor" ? sbSelect(token, "convites", "select=*&order=criado_em.desc") : Promise.resolve([]),
            sbSelect(token, "solicitacoes_folga", "select=*&order=criado_em.desc"),
            perfil.papel === "gestor" ? sbSelect(token, "folha_pagamento", "select=*&order=competencia.desc") : Promise.resolve([]),
            sbSelect(token, "adiantamentos_salariais", "select=*&order=criado_em.desc"),
            perfil.papel === "gestor" ? sbSelect(token, "guias_fiscais", "select=*&order=competencia.desc") : Promise.resolve([]),
            sbSelect(token, "ranking_pontos_publico", "select=*"),
            perfil.papel === "gestor" ? sbSelect(token, "usuarios_remuneracao", "select=*") : Promise.resolve([]),
          ]);
          // Substitui o recorte da fase 1 pelo histórico completo, preservando batidas
          // que ainda estão na fila (sem NSR) e correções de saída já aplicadas em memória.
          setRegistros(atuais => {
            const pendentes = atuais.filter(r => r.pendente);
            const ajustes = new Map(atuais.filter(r => r.ajustada && r.nsr).map(r => [r.nsr, r]));
            const completos = marcsCompleto.map(r => {
              const base = { ...mapMarc(r), automatica: !!r.automatica };
              const aj = ajustes.get(base.nsr);
              return aj ? { ...base, ts: aj.ts, tsOriginal: aj.tsOriginal, ajustada: true } : base;
            });
            return [...completos, ...pendentes];
          });
          setFaltas(flts.map(mapFalta));
          setJustificativas(justs.map(mapJust));
          setAtestados(ates.map(mapAte));
          setFerias(fers.map(mapFer));
          setLogs(auds.map(mapLog));
          setConvites(convs.map(mapConvite));
          setFolgas(flgs.map(mapFolga));
          setFolhasPg(fpgs.map(mapFolhaPg));
          setAdiantamentos(adts.map(mapAdiant));
          setGuias(gfs.map(mapGuia));
          setRankingUsuarios(rkg.map(r => ({ id: r.id, nome: r.nome, papel: r.tipo, pontos: +r.pontos_total || 0, streak: +r.streak_atual || 0 })));
          // Remuneração só existe na memória do gestor; pro colaborador a lista vem vazia.
          if (remun.length) setUsuarios(us => us.map(u => {
            const r = remun.find(x => x.id === u.id);
            return r ? { ...u, salario: +r.salario_bruto || 0, vtAtivo: !!r.vale_transporte_ativo, vtValor: +r.vale_transporte_valor_mensal || 0, dependentes: r.dependentes_irrf || 0 } : u;
          }));
        } catch (e) {
          console.warn("[fase 2]", e.message);
          setErroDados(`${mensagemAmigavel(e, "ao carregar dados complementares")} O registro de ponto funciona normalmente.`);
        } finally { setCarregandoSecundarios(false); }
      })();
    } catch (e) {
      setErroDados(mensagemAmigavel(e, "ao carregar seus dados"));
    }
  };

  const concluirConvite = async (conv, senha) => {
    // 1) cria a conta (ou reaproveita se já existir e a senha bater)
    let token, uid;
    try {
      const cad = await sbSignUp(conv.email, senha);
      token = cad.access_token; uid = cad.user?.id;
    } catch (e) {
      if (!/already|registered|exists/i.test(e.message)) throw e; // conta já existe → tenta logar com a senha informada
    }
    if (!token) {
      try { const lg = await sbLogin(conv.email, senha); token = lg.access_token; uid = lg.user.id; }
      catch (e) {
        if (/confirm/i.test(e.message)) throw new Error("Conta criada, mas o projeto exige confirmação de e-mail. Confirme pelo link enviado ao seu e-mail e abra este convite de novo pra concluir.");
        throw e;
      }
    }
    // 2) resgata o convite (function SECURITY DEFINER valida, aplica nome/cargo/tipo e marca usado=true, tudo atômico)
    await sbRpc(token, "resgatar_convite", { p_token: conv.token });
    // 3) entra no app como um login normal
    const [perfis, consents] = await Promise.all([
      sbSelect(token, "usuarios", `select=*&id=eq.${uid}`),
      sbSelect(token, "consentimentos_lgpd", `select=*&usuario_id=eq.${uid}`),
    ]);
    const perfil = mapUser(perfis[0], consents[0]?.aceito);
    setSessao({ token, uid });
    setUser(perfil);
    await carregarDados(token, perfil);
    try { window.history.replaceState({}, "", window.location.pathname); } catch {}
    setTela("ponto");
  };

  /* ---------- CRUD de colaboradores e convites (gestor) ---------- */
  const criarConvite = async (dados) => {
    const nome = limparTexto(dados.nome, LIMITES.nome);
    const email = limparTexto(dados.email, LIMITES.email).toLowerCase();
    const cargo = limparTexto(dados.cargo, LIMITES.cargo);
    if (nome.length < 2) throw new Error("Informe o nome completo do colaborador.");
    if (!emailValido(email)) throw new Error("E-mail inválido.");
    if (!dataValida(dados.dataAdmissao)) throw new Error("Data de admissão inválida.");
    if (!["colaborador", "gestor"].includes(dados.tipo)) throw new Error("Tipo de acesso inválido.");
    dados = { ...dados, nome, email, cargo };
    if (demo) {
      const c = { id: Date.now(), token: crypto.randomUUID(), ...dados, dataAdmissao: dados.dataAdmissao, usado: false, expiraEm: iso(d(7)) };
      setConvites(cs => [c, ...cs]); return c;
    }
    const [row] = await sbInsert(sessao.token, "convites", [{ nome, email, cargo: cargo || null, tipo: dados.tipo, data_admissao: dados.dataAdmissao, criado_por: user.id }]);
    const c = mapConvite(row);
    setConvites(cs => [c, ...cs]);
    try {
      await auditar("convite_criado", `${user.nome} criou convite ${c.tipo === "gestor" ? "de GESTOR (acesso total)" : "de colaborador"} pra ${nome} <${email}> · admissão ${fmtData(dados.dataAdmissao)} · expira ${fmtData(c.expiraEm)}`);
    } catch (e) { setErroDados(`Convite criado, mas a trilha de auditoria falhou (${mensagemAmigavel(e)}).`); }
    return c;
  };

  const salvarUsuario = async (id, patch) => {
    if (!uuidValido(id) && !demo) throw new Error("Identificador de usuário inválido.");
    const p = { ...patch };
    if (p.nome !== undefined) { p.nome = limparTexto(p.nome, LIMITES.nome); if (p.nome.length < 2) throw new Error("Nome inválido."); }
    if (p.cargo !== undefined) p.cargo = limparTexto(p.cargo, LIMITES.cargo) || null;
    if (p.tipo !== undefined && !["colaborador", "gestor"].includes(p.tipo)) throw new Error("Tipo de acesso inválido.");
    if (p.data_admissao !== undefined && !dataValida(p.data_admissao)) throw new Error("Data de admissão inválida.");
    for (const campo of ["salario_bruto", "vale_transporte_valor_mensal"]) {
      if (p[campo] !== undefined) { const n = numeroValido(p[campo]); if (n === null) throw new Error("Valor monetário inválido."); p[campo] = n; }
    }
    if (p.dependentes_irrf !== undefined) { const n = numeroValido(p.dependentes_irrf, { min: 0, max: 20 }); if (n === null) throw new Error("Número de dependentes inválido."); p.dependentes_irrf = Math.floor(n); }
    patch = p;
    // Trilha ANTES → DEPOIS: sem isso, a auditoria dizia só "campo salário alterado",
    // sem permitir saber se foi de 3.000 pra 3.500 ou pra 30.000.
    const antes = usuarios.find(u => u.id === id) || {};
    const rotulos = { nome: "nome", cargo: "cargo", tipo: "papel de acesso", data_admissao: "admissão",
      salario_bruto: "salário bruto", vale_transporte_ativo: "VT ativo", vale_transporte_valor_mensal: "valor do VT",
      dependentes_irrf: "dependentes IRRF", ativo: "situação" };
    const atual = { nome: antes.nome, cargo: antes.cargo, tipo: antes.papel, data_admissao: (antes.admissao || "").slice(0, 10),
      salario_bruto: antes.salario, vale_transporte_ativo: antes.vtAtivo, vale_transporte_valor_mensal: antes.vtValor,
      dependentes_irrf: antes.dependentes, ativo: antes.ativo };
    const fmtVal = (k, v) => v === undefined || v === null || v === "" ? "(vazio)"
      : /salario|valor_mensal/.test(k) ? brl(v) : typeof v === "boolean" ? (v ? "sim" : "não") : String(v);
    const mudancas = Object.keys(patch)
      .filter(k => String(atual[k] ?? "") !== String(patch[k] ?? ""))
      .map(k => `${rotulos[k] || k}: ${fmtVal(k, atual[k])} → ${fmtVal(k, patch[k])}`);

    if (!demo) await sbUpdate(sessao.token, "usuarios", `id=eq.${id}`, patch);
    setUsuarios(us => us.map(u => u.id === id ? { ...u, nome: patch.nome ?? u.nome, cargo: patch.cargo ?? u.cargo, papel: patch.tipo ?? u.papel, ativo: patch.ativo ?? u.ativo, admissao: patch.data_admissao ?? u.admissao, salario: patch.salario_bruto ?? u.salario, vtAtivo: patch.vale_transporte_ativo ?? u.vtAtivo, vtValor: patch.vale_transporte_valor_mensal ?? u.vtValor, dependentes: patch.dependentes_irrf ?? u.dependentes } : u));
    if (mudancas.length) {
      const sensiveis = ["salario_bruto", "tipo", "ativo", "data_admissao", "vale_transporte_valor_mensal", "dependentes_irrf"];
      const critica = Object.keys(patch).some(k => sensiveis.includes(k));
      const texto = `Cadastro de ${antes.nome || id} alterado por ${user.nome} — ${mudancas.join(" · ")}`;
      if (critica) { try { await auditar("cadastro_alterado", texto); } catch (e) { setErroDados(`Alteração salva, mas a trilha de auditoria falhou (${mensagemAmigavel(e)}) — avise o gestor.`); } }
      else log("equipe", texto);
    }
  };

  const entrarDemo = (u) => {
    setDemo(true);
    setUsuarios(USUARIOS_SEED);
    setRegistros(REGISTROS_SEED);
    setFaltas(FALTAS_SEED.map((f, i) => ({ id: `fd${i}`, ...f, justificada: false })));
    setJustificativas([{ id: 1, userId: "u3", data: iso(d(-2)), texto: "Trânsito parado na Av. Cristiano Machado por acidente.", anexo: null, status: "pendente" }]);
    setAtestados([]); setFerias([]); setLocais([]); setFolgas([]); setSaidasPend([]);
    setFolhasPg([]); setAdiantamentos([]); setGuias([]); setCredenciais([]);
    setRankingUsuarios(USUARIOS_SEED.map(u => { const gg = calcularGamificacao(u.id, REGISTROS_SEED, FALTAS_SEED.map((f, i) => ({ id: i, ...f, justificada: false }))); return { id: u.id, nome: u.nome, papel: u.papel, pontos: gg.total, streak: gg.streak }; }));
    const fdsDemo = [{ data: "2026-01-01", nome: "Confraternização Universal" }, { data: "2026-09-07", nome: "Independência do Brasil" }, { data: "2026-12-25", nome: "Natal" }];
    setFeriadosGlobal(fdsDemo); setFeriados(fdsDemo);
    setLogs([{ ts: iso(new Date()), userId: "sistema", acao: "boot", detalhe: "Modo demonstração (dados locais, nada é persistido)" }]);
    setUser(u); setTela("ponto");
  };

  const sair = () => {
    setUser(null); setSessao(null); setDemo(false);
    setUsuarios([]); setRegistros([]); setFaltas([]); setJustificativas([]); setAtestados([]); setFerias([]); setLogs([]);
    setFluxoPonto(null); setComprovante(null);
  };

  /* ---------- sincronização pós-batida: gamificação + prêmio ---------- */
  const sincronizarDerivados = async (uid, regs, flts) => {
    if (demo || !sessao) return;
    try {
      const g = calcularGamificacao(uid, regs, flts);
      await sbUpsert(sessao.token, "gamificacao_estado",
        [{ usuario_id: uid, pontos_total: g.total, streak_atual: g.streak, streak_recorde: g.melhorStreak, atualizado_em: iso(new Date()) }], "usuario_id");
      const conquistadas = calcularBadges(g).filter(b => b.conquistada).map(b => ({ usuario_id: uid, badge_id: b.id }));
      if (conquistadas.length) await sbUpsert(sessao.token, "badges_conquistadas", conquistadas, "usuario_id,badge_id", true);
      const e = elegibilidadePremio(uid, regs, flts);
      const mesRef = hojeStr().slice(0, 8) + "01";
      const motivo = e.elegivel ? null : e.medidores.filter(m => m.estourou).map(m => `${m.label}: ${m.valor}${m.unidade}`).join("; ");
      const linha = { usuario_id: uid, mes_referencia: mesRef, elegivel: e.elegivel, minutos_atraso_mes: e.atrasoMin, faltas_injustificadas_mes: e.faltasInj, motivo_perda: motivo, atualizado_em: iso(new Date()) };
      const existente = await sbSelect(sessao.token, "premio_performance", `select=id&usuario_id=eq.${uid}&mes_referencia=eq.${mesRef}`);
      if (existente.length) await sbUpdate(sessao.token, "premio_performance", `id=eq.${existente[0].id}`, linha);
      else await sbInsert(sessao.token, "premio_performance", [linha]);
    } catch (e) { console.warn("[sync derivados]", e.message); }
  };

  /* ---------- fluxo de batida ---------- */
  const iniciarBatida = async () => {
    if (!user.consentimentoLGPD) { setTela("lgpd"); setBloqueioGeo({ motivo: "lgpd", msg: "Antes da primeira batida é necessário aceitar o Termo de Consentimento LGPD. Você foi levado pra aba 🔐 LGPD." }); return; }
    setBloqueioGeo(null);
    setFluxoPonto("geo");
    const ativos = locais.filter(l => l.ativo);
    const g = await obterLocalizacao();

    // --- Sem posição ---
    if (g.lat == null) {
      const info = GEO_MOTIVOS[g.motivo] || GEO_MOTIVOS.indisponivel;
      setGeo({ lat: null, lng: null, erro: info.titulo, motivo: g.motivo });
      if (ativos.length === 0) {
        // Não há cerca configurada: a localização é opcional — segue e registra o porquê
        setFluxoPonto("biometria");
        return;
      }
      // Há cerca configurada: não dá pra confirmar o local. Explica, oferece nova tentativa
      // e (sem travar o trabalhador) permite registrar com justificativa, sinalizado ao gestor.
      setBloqueioGeo({ motivo: g.motivo, titulo: info.titulo, msg: info.msg, comoResolver: info.comoResolver, permiteDispensa: true });
      setFluxoPonto(null);
      log("batida_bloqueada", `Sem localização (${g.motivo}) com cerca configurada`);
      return;
    }

    // --- Com posição ---
    if (ativos.length === 0) { setGeo({ ...g, status: "sem_geofence" }); setFluxoPonto("biometria"); return; }
    const dists = ativos.map(l => ({ l, d: haversineM(g.lat, g.lng, l.latitude, l.longitude) })).sort((a, b) => a.d - b.d);
    const maisPerto = dists[0];
    if (maisPerto.d <= maisPerto.l.raio + (g.precisao || 0) * 0.5) { // tolera metade da margem de erro do GPS
      setGeo({ ...g, local: maisPerto.l.nome, dist: Math.round(maisPerto.d), raio: maisPerto.l.raio, status: "ok_dentro_raio" });
      setFluxoPonto("biometria");
    } else {
      setBloqueioGeo({
        motivo: "fora_do_raio", titulo: "Fora da área de trabalho",
        msg: `Você está a ${Math.round(maisPerto.d)} metros de "${maisPerto.l.nome}" — o máximo permitido é ${maisPerto.l.raio} metros (margem do GPS: ±${g.precisao || "?"} m).`,
        comoResolver: "Aproxime-se do local de trabalho e toque em 'Tentar de novo'. Se você já está no local, o GPS pode estar impreciso dentro do prédio — chegue perto de uma janela e tente outra vez.",
        permiteDispensa: false,
      });
      setFluxoPonto(null);
      log("batida_bloqueada", `Fora do raio: ${Math.round(maisPerto.d)}m de "${maisPerto.l.nome}" (raio ${maisPerto.l.raio}m)`);
    }
  };

  // Saída controlada: colaborador presente cujo GPS falhou não pode ficar impedido de bater ponto.
  // Registra com justificativa obrigatória e sinaliza pro gestor.
  const registrarSemLocalizacao = (justificativa) => {
    const just = limparTexto(justificativa, LIMITES.obs);
    if (just.length < 5) throw new Error("Descreva em poucas palavras por que não foi possível obter a localização (mínimo 5 caracteres).");
    setGeo(g => ({ ...(g || {}), lat: null, lng: null, status: "dispensado_por_falha", justificativa: just }));
    setBloqueioGeo(null);
    setFluxoPonto("biometria");
  };


  /* ---------- locais de trabalho (gestor) ---------- */
  const criarLocal = (nome, raio) => new Promise((resolve, reject) => {
    const nomeLimpo = limparTexto(nome, LIMITES.nome);
    if (nomeLimpo.length < 2) return reject(new Error("Dê um nome ao local (mínimo 2 caracteres)."));
    const raioNum = numeroValido(raio, { min: 10, max: 5000 });
    if (raioNum === null) return reject(new Error("Raio inválido — use um valor entre 10 e 5000 metros."));
    if (!navigator.geolocation) return reject(new Error("Sem suporte a geolocalização neste navegador."));
    navigator.geolocation.getCurrentPosition(async (p) => {
      try {
        const linha = { nome: nomeLimpo, latitude: +p.coords.latitude.toFixed(6), longitude: +p.coords.longitude.toFixed(6), raio_metros: Math.round(raioNum), ativo: true, criado_por: user.id };
        if (demo) {
          setLocais(ls => [...ls, { id: Date.now(), ...linha, raio: linha.raio_metros }]);
        } else {
          const [row] = await sbInsert(sessao.token, "locais_trabalho", [linha]);
          setLocais(ls => [...ls, mapLocal(row)]);
        }
        auditar("local_criado", `${user.nome} criou o local "${linha.nome}" — raio ${linha.raio_metros}m, coordenadas ${linha.latitude},${linha.longitude} (±${Math.round(p.coords.accuracy)}m na captura)`).catch(e => console.warn("[auditoria local]", e.message));
        resolve(Math.round(p.coords.accuracy));
      } catch (e) { reject(e); }
    }, (err) => reject(new Error("Não foi possível obter sua posição: " + err.message)), { enableHighAccuracy: true, timeout: 10000 });
  });

  const desativarLocal = async (id) => {
    try {
      if (!demo) await sbUpdate(sessao.token, "locais_trabalho", `id=eq.${id}`, { ativo: false }); // update em vez de delete: preserva histórico
      setLocais(ls => ls.map(l => l.id === id ? { ...l, ativo: false } : l));
      const loc = locais.find(l => l.id === id);
      auditar("local_desativado", `${user.nome} desativou o local "${loc?.nome || id}" (raio ${loc?.raio || "?"}m) — batidas deixam de exigir esse perímetro`).catch(e => console.warn("[auditoria local]", e.message));
    } catch (e) { avisar(mensagemAmigavel(e, "ao desativar o local")); }
  };

  // verificacao: { ok: true, metodo: "webauthn" } | { ok: false, metodo: "sem_verificacao", motivo }
  const concluirBatida = async (verificacao) => {
    const v = verificacao && typeof verificacao === "object" ? verificacao : { ok: false, metodo: "sem_verificacao", motivo: "nao_informado" };
    const doDia = agruparPorDia(registros, user.id)[new Date().toLocaleDateString("pt-BR")] || [];
    const tipo = doDia.length % 2 === 0 ? "entrada" : "saida";
    setSalvando(true);
    try {
      let reg;
      if (demo) {
        const nsr = registros.reduce((m, r) => Math.max(m, r.nsr), 0) + 1;
        reg = { nsr, userId: user.id, tipo, ts: iso(new Date()), lat: geo?.lat, lng: geo?.lng, foto: null, facialOk: v.ok, metodo: v.metodo, geoStatus: geo?.status };
      } else {
        // ts NÃO é enviado no caminho ONLINE de propósito: quem carimba a hora é o banco
        // (default now()) — o relógio do aparelho é falsificável.
        const clienteUuid = crypto.randomUUID();
        const payload = {
          cliente_uuid: clienteUuid, usuario_id: user.id, tipo, lat: geo?.lat ?? null, lng: geo?.lng ?? null,
          precisao_m: geo?.precisao ?? null, facial_ok: v.ok, metodo_verificacao: v.metodo, coletor: "02", offline: false,
          geo_status: geo?.status || (geo?.lat != null ? "ok_dentro_raio" : (geo?.motivo || "indisponivel")),
          geo_justificativa: geo?.justificativa || null,
        };
        let row = null;
        try {
          if (!navigator.onLine) throw new TypeError("Sem conexão"); // atalho: nem tenta se o SO diz que está offline
          [row] = await sbInsert(sessao.token, "marcacoes", payload && [payload]);
        } catch (eEnvio) {
          if (!ehFalhaDeRede(eEnvio)) throw eEnvio; // erro de regra/permissão continua sendo erro de verdade
          // ---- SEM REDE: a batida entra na fila com a hora do APARELHO e a marca offline ----
          const tsLocal = iso(new Date());
          enfileirar({ ...payload, ts: tsLocal, offline: true, cliente_uuid: clienteUuid, criadoEm: tsLocal, tentativas: 0, ultimoErro: null });
          setFila(lerFila());
          const regPend = { nsr: null, pendente: true, clienteUuid, userId: user.id, tipo, ts: tsLocal, lat: geo?.lat, lng: geo?.lng, facialOk: v.ok, metodo: v.metodo, offline: true };
          setRegistros(rs => [...rs, regPend]);
          setLembrete(null);
          setComprovante(regPend);
          setFluxoPonto("comprovante");
          log("batida", `Batida ${tipo} registrada SEM REDE (na fila, será enviada automaticamente) · ${tsLocal}`);
          setSalvando(false);
          return;
        }
        reg = { ...mapMarc(row), metodo: v.metodo };
        // Divergência entre relógio do aparelho e do servidor: registra na auditoria (não bloqueia).
        const desvioSeg = Math.round(Math.abs(new Date(row.ts).getTime() - Date.now()) / 1000);
        if (desvioSeg > 120) {
          console.warn("[relógio] desvio de", desvioSeg, "s entre aparelho e servidor");
          auditar("relogio_divergente", `Relógio do aparelho difere ${desvioSeg}s do servidor na batida NSR ${row.nsr} (o horário gravado é o do servidor)`).catch(() => {});
        }
        // atualiza o último uso da credencial (telemetria, não bloqueia a batida)
        if (v.ok && v.credentialId) {
          const cred = credenciais.find(c => c.credentialId === v.credentialId);
          if (cred) sbUpdate(sessao.token, "credenciais_biometricas", `id=eq.${cred.id}`, { ultimo_uso: iso(new Date()), contador: v.contador || 0 }).catch(e => console.warn("[cred ultimo_uso]", e.message));
        }
      }
      const novos = [...registros, reg];
      setRegistros(novos);
      if (geo?.status === "dispensado_por_falha") {
        auditar("batida_sem_localizacao", `Batida ${tipo} registrada SEM localização (${geo?.motivo || "falha de GPS"}) · justificativa do colaborador: ${geo.justificativa}`).catch(() => {});
      }
      log("batida", `NSR ${reg.nsr} · ${tipo} · geo ${geo?.lat ?? "—"},${geo?.lng ?? "—"}${geo?.status === "dispensado_por_falha" ? " (SEM localização — justificada)" : ""} · identidade: ${v.metodo === "webauthn_servidor" ? "biometria validada no servidor (WebAuthn, assinatura conferida)" : v.metodo === "webauthn_local" ? "biometria conferida localmente (demo)" : `SEM verificação biométrica (${v.motivo || "n/d"})`}`);
      if (!demo && tipo === "entrada") {
        const pontual = entradaPontual(new Date(reg.ts));
        if (pontual) {
          const g = calcularGamificacao(user.id, novos, faltas);
          const pts = GAME.ptsDiaPontual + (g.streak >= 3 ? GAME.ptsBonusStreak : 0) + (GAME.marcosStreak[g.streak] || 0);
          sbInsert(sessao.token, "gamificacao_extrato", [{ usuario_id: user.id, data: hojeStr(), pontos: pts, motivo: `Entrada pontual${g.streak >= 3 ? ` · streak ${g.streak} dias` : ""}${GAME.marcosStreak[g.streak] ? " · marco batido" : ""}` }]).catch(e => console.warn("[gamificacao_extrato]", e.message));
        }
      }
      sincronizarDerivados(user.id, novos, faltas);
      setLembrete(null); // a batida resolve o lembrete pendente
      setComprovante(reg);
      setFluxoPonto("comprovante");
    } catch (e) {
      avisar(mensagemAmigavel(e, "ao registrar a batida"));
      setFluxoPonto(null);
    } finally { setSalvando(false); }
  };

  /* ---------- justificativas / atestados / férias ---------- */
  const enviarJustificativa = async (texto, arquivo) => {
    if (demo) {
      setJustificativas(j => [{ id: Date.now(), userId: user.id, data: iso(new Date()), texto, anexo: arquivo ? { nome: arquivo.name } : null, status: "pendente" }, ...j]);
    } else {
      const path = arquivo ? await sbUpload(sessao.token, user.id, arquivo) : null; // upload real no bucket "anexos"
      const [row] = await sbInsert(sessao.token, "justificativas", [{ usuario_id: user.id, data: hojeStr(), tipo: "atraso", descricao: limparTexto(texto, LIMITES.texto), anexo_url: path }]);
      setJustificativas(j => [mapJust(row), ...j]);
    }
    log("justificativa", "Nova justificativa de atraso enviada" + (arquivo ? " (com anexo no Storage)" : ""));
  };

  const enviarAtestado = async (arquivo, obs, preview) => {
    if (demo) {
      setAtestados(a => [{ id: Date.now(), userId: user.id, data: iso(new Date()), nome: arquivo.name, preview, obs, status: "pendente" }, ...a]);
    } else {
      const path = await sbUpload(sessao.token, user.id, arquivo); // upload real no bucket "anexos"
      const [row] = await sbInsert(sessao.token, "atestados", [{ usuario_id: user.id, data_inicio: hojeStr(), data_fim: hojeStr(), cid: limparTexto(obs, LIMITES.obs) || null, anexo_url: path }]);
      setAtestados(a => [{ ...mapAte(row), preview }, ...a]);
    }
    log("atestado", `Atestado enviado: ${arquivo.name}`);
  };

  const agendarFerias = (inicio, dias) => {
    const adm = dataLocal(user.admissao);
    const agora = new Date();
    const liberaAquisitivo = addMeses(adm, 12);
    if (agora < liberaAquisitivo) return { ok: false, msg: `Você completa 12 meses de empresa em ${fmtData(liberaAquisitivo)}. Agendamento liberado a partir dessa data (CLT art. 130: período aquisitivo).` };
    const ini = new Date(inicio + "T00:00:00");
    const minInicio = addMeses(agora, 5); // 5 meses contados DIA a DIA a partir de hoje
    if (ini < minInicio) {
      const diasFaltando = Math.ceil((minInicio - ini) / 86400000);
      return { ok: false, msg: `Antecedência mínima de 5 meses: a data mais próxima que você pode solicitar é ${fmtData(minInicio)} (a escolhida está ${diasFaltando} dia(s) antes). Contexto: o mínimo legal de aviso é 30 dias (CLT art. 135), mas a política interna da Renovar Tech é mais restritiva e prevalece.` };
    }
    // ---- CLT art. 134 §1º: fracionamento (bloqueio duro) ----
    const nDias = Math.floor(+dias);
    if (!Number.isFinite(nDias) || nDias < 1) return { ok: false, msg: "Informe quantos dias de férias você quer tirar." };
    const aq = periodoAquisitivo(user.admissao, inicio);
    const doCiclo = ferias.filter(f => f.userId === user.id && f.status !== "rejeitado" && f.status !== "rejeitada"
      && (() => { const p = periodoAquisitivo(user.admissao, f.inicio); return p.ciclo === aq.ciclo; })());
    const vf = validarFracionamento(doCiclo.map(f => +f.dias), nDias, doCiclo.reduce((s, f) => s + (+f.dias || 0), 0));
    if (!vf.ok) return { ok: false, msg: vf.msg };

    (async () => {
      try {
        if (demo) {
          setFerias(x => [{ id: Date.now(), userId: user.id, inicio, dias: +dias, status: "pendente" }, ...x]);
        } else {
          const fim = new Date(ini); fim.setDate(fim.getDate() + (+dias) - 1);
          const [row] = await sbInsert(sessao.token, "ferias", [{ usuario_id: user.id, data_inicio: inicio, data_fim: fim.toISOString().slice(0, 10), dias: +dias }]);
          setFerias(x => [mapFer(row), ...x]);
        }
        log("ferias", `Solicitação: ${dias} dias a partir de ${fmtData(ini)}`);
      } catch (e) { avisar(mensagemAmigavel(e, "ao solicitar férias")); }
    })();
    const inicioDt = dataLocal(inicio);
    const avisoInicio = [5, 6, 0].includes(inicioDt.getDay())
      ? " ⚠️ A CLT (art. 134 §3º) proíbe iniciar férias nos 2 dias que antecedem feriado ou repouso semanal — a data escolhida cai numa sexta/sábado/domingo. Combine com o gestor antes de aprovar."
      : "";
    return { ok: true, msg: `Solicitação enviada pra aprovação do gestor (período ${doCiclo.length + 1} de até ${FRAC.maxPeriodos} neste ciclo aquisitivo).${vf.aviso ? " " + vf.aviso : ""} Lembrete: o aviso legal mínimo ao empregador é de 30 dias (CLT art. 135); a regra interna de 5 meses é mais restritiva e prevalece.${avisoInicio}` };
  };

  /* ---------- saída automática: confirmar / corrigir ---------- */
  const confirmarSaida = async (id) => {
    const pend = saidasPend.find(x => x.id === id);
    if (!demo) await sbUpdate(sessao.token, "registros_ponto", `id=eq.${id}`, { saida_confirmada: true }); // erro sobe pro banner tratar
    setSaidasPend(sp => sp.map(x => x.id === id ? { ...x, confirmada: true } : x));
    try {
      await auditar("saida_auto", `Saída automática #${id} (${pend ? fmtData(pend.data + "T12:00:00") + " " + pend.saida : ""}) CONFIRMADA pelo colaborador`);
    } catch (eAud) {
      setErroDados(`Confirmação salva, mas o registro na trilha de auditoria falhou (${mensagemAmigavel(eAud)}) — avise o gestor.`);
    }
  };

  const corrigirSaida = async (id, novaSaida, justificativa) => {
    if (!/^\d{2}:\d{2}$/.test(novaSaida)) throw new Error("Informe o horário no formato HH:MM.");
    if (!justificativa || justificativa.trim().length < 5) throw new Error("A justificativa é obrigatória (mínimo 5 caracteres).");
    const pend = saidasPend.find(x => x.id === id);
    const patch = { saida: `${novaSaida}:00`, saida_confirmada: true, editado_manualmente: true, justificativa_edicao: limparTexto(justificativa, LIMITES.obs) };
    if (!demo) await sbUpdate(sessao.token, "registros_ponto", `id=eq.${id}`, patch);
    setSaidasPend(sp => sp.map(x => x.id === id ? { ...x, saida: novaSaida, confirmada: true } : x));
    // aplica o override em memória (espelho/banco); AFD mantém tsOriginal
    if (pend) setRegistros(rs => {
      const copia = rs.map(r => ({ ...r }));
      const saidasDia = copia.filter(x => x.userId === pend.userId && x.tipo === "saida" && dataISO(new Date(x.tsOriginal || x.ts)) === pend.data);
      const ultima = saidasDia[saidasDia.length - 1];
      if (ultima) { ultima.tsOriginal = ultima.tsOriginal || ultima.ts; ultima.ts = `${pend.data}T${novaSaida}:00`; ultima.ajustada = true; }
      return copia;
    });
    try {
      await auditar("saida_auto_corrigida", `Saída automática #${id} (${pend ? fmtData(pend.data + "T12:00:00") : ""}) — horário automático original: ${pend?.saida || "?"} · horário corrigido: ${novaSaida} · justificativa: ${justificativa.trim()}`);
    } catch (eAud) {
      setErroDados(`Correção salva, mas o registro na trilha de auditoria falhou (${mensagemAmigavel(eAud)}) — avise o gestor.`);
    }
  };

  /* ---------- lembretes de batida (enquanto o app estiver aberto) ---------- */
  const pedirPermissaoNotif = async () => {
    try { const p = await Notification.requestPermission(); setNotifStatus(p); } catch { setNotifStatus("denied"); }
  };
  useEffect(() => {
    if (!user || user.papel === "gestor" && false) return; // lembretes valem pra todos os logados
    const checar = () => {
      const agora = new Date();
      const exp = expedienteDoDia(agora);
      if (exp.jornadaMin === 0) return; // domingo/feriado: sem lembrete
      const chaveDia = dataISO(agora);
      const fired = (lembretesDisparados.current[chaveDia] = lembretesDisparados.current[chaveDia] || new Set());
      const doDia = registros.filter(r => r.userId === user.id && new Date(r.ts).toLocaleDateString("pt-BR") === agora.toLocaleDateString("pt-BR"));
      const total = doDia.length;
      const h = agora.getHours(), dow = agora.getDay();
      const disparar = (id, titulo, corpo) => {
        if (fired.has(id)) return;
        fired.add(id);
        setLembrete({ id, titulo, corpo });
        if (notifStatus === "granted") { try { new Notification(titulo, { body: corpo }); } catch {} }
      };
      if (h === 8 && total === 0) disparar("ent8", "⏰ Hora de bater o ponto", "Seu expediente começou às 8:00 — registre sua entrada.");
      if (h === 9 && total === 0) disparar("ent9", "⏰ Entrada ainda não registrada", "Já passa das 9:00 e sua entrada de hoje não foi registrada.");
      if (dow >= 1 && dow <= 5) { // almoço só seg-sex (sábado é turno único)
        if (h === 12 && total === 1) disparar("alm12", "🍽 Saída pro almoço", "Lembre de registrar a saída pro intervalo.");
        if (h === 13 && total === 2) disparar("alm13", "🍽 Volta do almoço", "Lembre de registrar o retorno do intervalo.");
      }
    };
    checar();
    const t = setInterval(checar, 60000); // verifica a cada minuto se a batida correspondente já aconteceu
    return () => clearInterval(t);
  }, [user, registros, notifStatus, demo]);

  /* ---------- banco de horas → folga ---------- */
  const solicitarFolga = async (horas, dataFolga) => {
    const h = +horas;
    if (!h || h <= 0) throw new Error("Informe uma quantidade de horas válida.");
    const sb = saldoBanco(user.id, registros, faltas, folgas);
    const pendentesMin = folgas.filter(f => f.userId === user.id && f.status === "pendente").reduce((s, f) => s + f.horas * 60, 0);
    if (h * 60 > sb.disponivel - pendentesMin) throw new Error(`Saldo insuficiente: você tem ${hmm(sb.disponivel)} disponíveis${pendentesMin ? ` (com ${hmm(pendentesMin)} já em solicitações pendentes)` : ""}.`);
    if (!dataFolga || new Date(dataFolga + "T00:00:00") <= new Date()) throw new Error("Escolha uma data futura pra folga.");
    if (demo) {
      setFolgas(fs => [{ id: Date.now(), userId: user.id, horas: h, dataFolga, status: "pendente" }, ...fs]);
    } else {
      const [row] = await sbInsert(sessao.token, "solicitacoes_folga", [{ usuario_id: user.id, horas_solicitadas: h, data_folga_pretendida: dataFolga, criado_por: user.id }]);
      setFolgas(fs => [mapFolga(row), ...fs]);
    }
    log("folga", `Solicitou converter ${h}h do banco em folga em ${fmtData(dataFolga + "T00:00:00")}`);
  };

  const decidirFolga = async (id, aprovar) => {
    const f = folgas.find(x => x.id === id);
    if (!f) return;
    if (aprovar) {
      const sb = saldoBanco(f.userId, registros, faltas, folgas);
      if (f.horas * 60 > sb.disponivel) { avisar(`Saldo insuficiente do colaborador: disponível ${hmm(sb.disponivel)}, solicitado ${hmm(f.horas * 60)}. Rejeite ou aguarde mais saldo.`); return; }
    }
    const patch = { status: aprovar ? "aprovada" : "rejeitada", decidido_por: user.id, decidido_em: iso(new Date()) };
    try {
      if (!demo) await sbUpdate(sessao.token, "solicitacoes_folga", `id=eq.${id}`, patch);
      setFolgas(fs => fs.map(x => x.id === id ? { ...x, status: patch.status, decididoEm: patch.decidido_em } : x));
      const nomeCol = usuarios.find(u => u.id === f.userId)?.nome || f.userId;
      try { await auditar("folga_decidida", `${user.nome} ${aprovar ? "APROVOU" : "REJEITOU"} folga de ${nomeCol}: ${hmm(f.horas * 60)} em ${fmtData(f.dataFolga + "T12:00:00")}${aprovar ? " — horas debitadas do banco" : ""}`); }
      catch (e) { console.warn("[auditoria folga]", e.message); }
    } catch (e) { avisar(mensagemAmigavel(e, "ao decidir a solicitação")); }
  };

  /* ---------- fila offline: envio automático quando a rede volta ---------- */
  const enviarFila = async (silencioso = true) => {
    if (demo || !sessao?.token || enviandoFila) return;
    const pendentes = lerFila();
    if (!pendentes.length) return;
    setEnviandoFila(true);
    let enviados = 0, falhas = 0;
    for (const item of pendentes) {
      const { criadoEm, tentativas, ultimoErro, ...payload } = item;
      try {
        const [row] = await sbInsert(sessao.token, "marcacoes", [payload]);
        removerDaFila(item.cliente_uuid);
        enviados++;
        // troca a marcação provisória pela definitiva (com NSR real do banco)
        setRegistros(rs => rs.map(r => r.clienteUuid === item.cliente_uuid ? { ...mapMarc(row), metodo: payload.metodo_verificacao, offline: true } : r));
        auditar("batida_offline_sincronizada", `Batida ${payload.tipo} de ${fmtData(payload.ts)} ${fmtHora(payload.ts)} (registrada sem rede) sincronizada · NSR ${row.nsr}`).catch(() => {});
      } catch (e) {
        // 409/23505 = já existe no banco (reenvio de algo que na verdade passou): tira da fila
        if (/duplicate key|23505|409/i.test(e.message || "")) { removerDaFila(item.cliente_uuid); enviados++; continue; }
        if (e.sessaoExpirada) { falhas++; break; }
        falhas++;
        atualizarItemFila(item.cliente_uuid, { tentativas: (item.tentativas || 0) + 1, ultimoErro: e.message });
        if (!ehFalhaDeRede(e)) continue; // erro permanente: mantém na fila e sinaliza
        break; // ainda sem rede: para e tenta de novo depois
      }
    }
    setFila(lerFila());
    setEnviandoFila(false);
    if (enviados && !silencioso) setErroDados(null);
    return { enviados, falhas };
  };

  useEffect(() => {
    setFila(lerFila());
    const aoVoltar = () => { setOnline(true); enviarFila(); };
    const aoCair = () => setOnline(false);
    window.addEventListener("online", aoVoltar);
    window.addEventListener("offline", aoCair);
    const t = setInterval(() => { if (navigator.onLine) enviarFila(); }, 45000); // rede pode voltar sem disparar evento
    return () => { window.removeEventListener("online", aoVoltar); window.removeEventListener("offline", aoCair); clearInterval(t); };
  }, [sessao, demo, enviandoFila]);

  // tenta esvaziar a fila assim que a sessão fica pronta (ex.: app reaberto depois de um dia sem rede)
  useEffect(() => { if (sessao?.token && !demo) enviarFila(); }, [sessao, demo]);

  /* ---------- sessão: expiração tratada com aviso claro ---------- */
  useEffect(() => {
    registrarHandlerSessao(() => setSessaoExpirada(true));
    if (demo || !sessao?.token) return;
    const exp = jwtExpiraEm(sessao.token);
    if (!exp) return;
    const checar = () => { if (Date.now() >= exp - 5000) setSessaoExpirada(true); };
    checar();
    const t = setInterval(checar, 30000);
    return () => clearInterval(t);
  }, [sessao, demo]);

  /* ---------- biometria WebAuthn ---------- */
  const cadastrarBiometria = async (rotuloDispositivo) => {
    const { credentialId, chavePublica, algoritmo } = await bioRegistrar(user, sessao?.token, demo);
    const linha = { usuario_id: user.id, credential_id: credentialId, chave_publica: chavePublica, algoritmo, dispositivo: limparTexto(rotuloDispositivo, LIMITES.dispositivo) || "Aparelho pessoal" };
    if (demo) setCredenciais(cs => [mapCred({ id: `c${Date.now()}`, ...linha, criado_em: iso(new Date()) }), ...cs]);
    else { const [row] = await sbInsert(sessao.token, "credenciais_biometricas", [linha]); setCredenciais(cs => [mapCred(row), ...cs]); }
    try { await auditar("biometria", `Credencial biométrica cadastrada (${linha.dispositivo}) · id ${credentialId.slice(0, 12)}…`); }
    catch (e) { console.warn("[auditoria biometria]", e.message); }
  };

  const removerBiometria = async (id) => {
    const c = credenciais.find(x => x.id === id);
    if (!demo) await sbFetch(sessao.token, `/rest/v1/credenciais_biometricas?id=eq.${id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    setCredenciais(cs => cs.filter(x => x.id !== id));
    try { await auditar("biometria", `Credencial biométrica removida (${c?.dispositivo || id})`); } catch (e) { console.warn("[auditoria biometria]", e.message); }
  };

  /* ---------- folha de pagamento (gestor) ---------- */
  const gerarFolha = async (comp) => {
    const fimComp = new Date(+comp.slice(0, 4), +comp.slice(5, 7), 0, 23, 59);
    const alvo = usuarios.filter(u => u.ativo !== false && (u.salario || 0) > 0
      && (!u.admissao || dataLocal(u.admissao) <= fimComp)); // admitido depois do mês não entra na folha
    if (!alvo.length) throw new Error("Nenhum colaborador ativo com salário cadastrado — preencha os salários na seção Equipe.");
    const jaFechadas = folhasPg.filter(f => f.competencia === comp && f.status === "fechada").map(f => f.userId);
    const linhas = alvo.filter(u => !jaFechadas.includes(u.id)).map(u => {
      const r = calcularFolhaColaborador(u, comp, registros, faltas, adiantamentos);
      if (r.proporcional) log("folha", `${u.nome}: salário proporcional à admissão (${r.diasProporcionais}/30 dias) — ${brl(r.row.salario_bruto)} de ${brl(r.salarioContratual)}`);
      return { usuario_id: u.id, competencia: comp, ...r.row };
    });
    if (!linhas.length) throw new Error("Todas as folhas dessa competência já estão fechadas.");
    if (demo) {
      setFolhasPg(fs => [...fs.filter(f => !(f.competencia === comp && f.status === "rascunho")), ...linhas.map((l, i) => mapFolhaPg({ id: `d${Date.now()}${i}`, ...l }))]);
    } else {
      const rows = await sbUpsert(sessao.token, "folha_pagamento", linhas, "usuario_id,competencia");
      setFolhasPg(fs => [...fs.filter(f => !(f.competencia === comp && f.status === "rascunho")), ...rows.map(mapFolhaPg)]);
    }
    const totalBruto = linhas.reduce((s, l) => s + (+l.salario_bruto || 0), 0);
    const totalLiq = linhas.reduce((s, l) => s + (+l.valor_liquido || 0), 0);
    try {
      await auditar("folha_gerada", `${user.nome} gerou a folha de ${comp.slice(0, 7)} (rascunho) pra ${linhas.length} colaborador(es) · bruto ${brl(totalBruto)} · líquido ${brl(totalLiq)}${jaFechadas.length ? ` · ${jaFechadas.length} já fechada(s) preservada(s)` : ""}`);
    } catch (e) { console.warn("[auditoria folha_gerada]", e.message); }
    return linhas.length;
  };

  const editarFolha = async (id, patchNums) => {
    const f = folhasPg.find(x => x.id === id);
    if (!f || f.status === "fechada") return;
    const novo = { ...f, ...patchNums };
    const liquido = r2(novo.salario - novo.faltas - novo.atrasos - novo.inss - novo.irrf - novo.vt - novo.adiantamento);
    const patch = {
      desconto_inss: novo.inss, desconto_irrf: novo.irrf, desconto_vale_transporte: novo.vt,
      desconto_faltas: novo.faltas, desconto_atrasos: novo.atrasos, desconto_adiantamento: novo.adiantamento,
      valor_liquido: liquido,
    };
    if (!demo) await sbUpdate(sessao.token, "folha_pagamento", `id=eq.${id}`, patch);
    setFolhasPg(fs => fs.map(x => x.id === id ? { ...novo, liquido } : x));
    const nomeCol = usuarios.find(u => u.id === f.userId)?.nome || f.userId;
    const difs = Object.keys(patchNums)
      .filter(k => r2(+f[k] || 0) !== r2(+patchNums[k] || 0))
      .map(k => `${k}: ${brl(f[k])} → ${brl(patchNums[k])}`);
    try {
      await auditar("folha_ajustada", `${user.nome} ajustou manualmente a folha de ${nomeCol} (${f.competencia.slice(0, 7)}) — ${difs.join(" · ") || "sem alteração de valores"} · líquido: ${brl(f.liquido)} → ${brl(liquido)}`);
    } catch (e) { setErroDados(`Ajuste salvo, mas a trilha de auditoria falhou (${mensagemAmigavel(e)}).`); }
  };

  const fecharFolha = async (comp) => {
    const abertas = folhasPg.filter(f => f.competencia === comp && f.status === "rascunho");
    if (!abertas.length) throw new Error("Não há rascunho pra fechar nessa competência.");
    const agora = iso(new Date());
    if (!demo) {
      await sbUpdate(sessao.token, "folha_pagamento", `competencia=eq.${comp}&status=eq.rascunho`, { status: "fechada", fechado_em: agora });
      await sbUpdate(sessao.token, "adiantamentos_salariais", `competencia_desconto=eq.${comp}&status=eq.pendente`, { status: "descontado" });
    }
    setFolhasPg(fs => fs.map(f => f.competencia === comp && f.status === "rascunho" ? { ...f, status: "fechada", fechadoEm: agora } : f));
    setAdiantamentos(as => as.map(a => a.competenciaDesconto === comp && a.status === "pendente" ? { ...a, status: "descontado" } : a));
    // Guias fiscais automáticas da competência (vencimento dia 20 do mês seguinte)
    const todas = folhasPg.filter(f => f.competencia === comp).map(f => f.status === "rascunho" ? { ...f, status: "fechada" } : f);
    const [ano, mes] = comp.split("-").map(Number);
    const venc = `${mes === 12 ? ano + 1 : ano}-${String(mes === 12 ? 1 : mes + 1).padStart(2, "0")}-20`;
    const totais = [
      ["GPS/INSS retido", r2(todas.reduce((s, f) => s + f.inss, 0))],
      ["DARF IRRF retido", r2(todas.reduce((s, f) => s + f.irrf, 0))],
      ["FGTS (8% patronal)", r2(todas.reduce((s, f) => s + f.salario * TABELAS_2026.fgtsPatronal, 0))],
    ].filter(([, v]) => v > 0);
    const novas = totais.filter(([tipo]) => !guias.some(g => g.competencia === comp && g.tipo === tipo))
      .map(([tipo, valor]) => ({ competencia: comp, tipo, valor_total: valor, vencimento: venc }));
    if (novas.length) {
      if (demo) setGuias(gs => [...gs, ...novas.map((g, i) => mapGuia({ id: `g${Date.now()}${i}`, ...g, status: "gerada" }))]);
      else { const rows = await sbInsert(sessao.token, "guias_fiscais", novas); setGuias(gs => [...gs, ...rows.map(mapGuia)]); }
    }
    try { await auditar("folha_fechada", `Folha ${comp.slice(0, 7)} FECHADA (${abertas.length} colaborador(es)) · guias geradas: ${novas.map(n => `${n.tipo} ${brl(n.valor_total)}`).join(" · ") || "nenhuma nova"}`); }
    catch (e) { setErroDados(`Folha fechada, mas o registro na trilha de auditoria falhou (${mensagemAmigavel(e)}).`); }
  };

  const marcarGuiaPaga = async (id) => {
    if (!demo) await sbUpdate(sessao.token, "guias_fiscais", `id=eq.${id}`, { status: "paga" });
    setGuias(gs => gs.map(g => g.id === id ? { ...g, status: "paga" } : g));
    const gg = guias.find(x => x.id === id);
    try { await auditar("guia_paga", `${user.nome} marcou como PAGA a guia ${gg?.tipo || id} de ${gg ? brl(gg.valor) : "?"} (competência ${gg?.competencia?.slice(0, 7) || "?"})`); }
    catch (e) { console.warn("[auditoria guia]", e.message); }
  };

  const criarAdiantamento = async (dados) => {
    const valor = numeroValido(dados.valor, { min: 0.01 });
    if (valor === null) throw new Error("Informe um valor válido (maior que zero).");
    if (!dataValida(dados.competenciaDesconto)) throw new Error("Informe a competência do desconto.");
    if (!uuidValido(dados.userId) && !demo) throw new Error("Colaborador inválido.");
    const linha = { usuario_id: dados.userId, valor, competencia_desconto: dados.competenciaDesconto, observacao: limparTexto(dados.observacao, LIMITES.obs) || null };
    if (demo) setAdiantamentos(as => [mapAdiant({ id: `a${Date.now()}`, ...linha, status: "pendente", data_solicitacao: hojeStr() }), ...as]);
    else { const [row] = await sbInsert(sessao.token, "adiantamentos_salariais", [linha]); setAdiantamentos(as => [mapAdiant(row), ...as]); }
    const nomeCol = usuarios.find(u => u.id === dados.userId)?.nome || dados.userId;
    try { await auditar("adiantamento_criado", `${user.nome} registrou adiantamento de ${brl(valor)} pra ${nomeCol} · desconto em ${dados.competenciaDesconto.slice(0, 7)}${linha.observacao ? ` · ${linha.observacao}` : ""}`); }
    catch (e) { console.warn("[auditoria adiantamento]", e.message); }
  };

  const cancelarAdiantamento = async (id) => {
    const a = adiantamentos.find(x => x.id === id);
    if (!a || a.status !== "pendente") return;
    if (!demo) await sbUpdate(sessao.token, "adiantamentos_salariais", `id=eq.${id}`, { status: "cancelado" });
    setAdiantamentos(as => as.map(x => x.id === id ? { ...x, status: "cancelado" } : x));
    const nomeC = usuarios.find(u => u.id === a.userId)?.nome || a.userId;
    try { await auditar("adiantamento_cancelado", `${user.nome} cancelou adiantamento de ${brl(a.valor)} de ${nomeC} (competência ${a.competenciaDesconto.slice(0, 7)})`); }
    catch (e) { console.warn("[auditoria adiantamento]", e.message); }
  };

  /* ---------- aprovações do gestor ---------- */
  const decidir = async (categoria, id, aprovar) => {
    const mapa = {
      "Justificativas": { tabela: "justificativas", setLista: setJustificativas, lista: justificativas, status: aprovar ? "aprovada" : "rejeitada" },
      "Atestados": { tabela: "atestados", setLista: setAtestados, lista: atestados, status: aprovar ? "aprovado" : "rejeitado" },
      "Férias": { tabela: "ferias", setLista: setFerias, lista: ferias, status: aprovar ? "aprovado" : "rejeitado" },
    };
    const m = mapa[categoria];
    if (!m) return;
    const registro = m.lista.find(i => i.id === id); // o item decidido (pra saber DE QUEM é)
    try {
      if (!demo) await sbUpdate(sessao.token, m.tabela, `id=eq.${id}`, { status: m.status });
      m.setLista(l => l.map(i => i.id === id ? { ...i, status: m.status } : i));
      const alvo = usuarios.find(u => u.id === registro?.userId)?.nome || "colaborador";
      try { await auditar("aprovacao", `${user.nome} ${m.status === "aprovada" || m.status === "aprovado" ? "APROVOU" : "REJEITOU"} ${categoria} de ${alvo} (#${id})`); }
      catch (e) { console.warn("[auditoria aprovacao]", e.message); }
    } catch (e) { avisar(mensagemAmigavel(e, "ao atualizar")); }
  };

  /* ---------- LGPD ---------- */
  const consentir = async (aceito) => {
    try {
      if (!demo) await sbUpsert(sessao.token, "consentimentos_lgpd", [{ usuario_id: user.id, aceito, atualizado_em: iso(new Date()) }], "usuario_id");
      setUser(u => ({ ...u, consentimentoLGPD: aceito }));
      setUsuarios(us => us.map(u => u.id === user.id ? { ...u, consentimentoLGPD: aceito } : u));
      log("lgpd", aceito ? "Consentimento registrado" : "Consentimento revogado");
    } catch (e) { avisar(mensagemAmigavel(e, "ao registrar o consentimento")); }
  };

  /* ---------- exportações fiscais ---------- */
  const cpfDe = (userId) => usuarios.find(u => u.id === userId)?.cpf || "";

  const exportarAFD = async () => {
    // Portaria 671: em batida offline, tsMarcacao (quando bateu) difere de tsGravacao (quando gravou).
    const marcacoes = registros.filter(r => r.nsr).map(r => ({
      nsr: r.nsr, cpf: cpfDe(r.userId),
      tsMarcacao: r.tsOriginal || r.ts,
      tsGravacao: r.criadoEm || r.tsOriginal || r.ts,
      coletor: "02", offline: !!r.offline,
    }));
    const { conteudo, nomeArquivo } = await gerarAFDReal(CONFIG_FISCAL, marcacoes);
    baixarArquivo(conteudo, nomeArquivo);
    log("export", `AFD gerado (leiaute 003): ${nomeArquivo} · ${marcacoes.length} marcações tipo 7 com cadeia SHA-256`);
  };

  const exportarAEJ = () => {
    const vinculos = usuarios.map((u, i) => ({ id: i + 1, cpf: u.cpf, nome: u.nome }));
    const vincDe = (userId) => vinculos[usuarios.findIndex(u => u.id === userId)]?.id;
    const marcacoesAej = [];
    usuarios.forEach(u => {
      const dias = agruparPorDia(registros, u.id);
      Object.values(dias).forEach(regs => {
        let seqE = 0, seqS = 0;
        [...regs].sort((a, b) => new Date(a.ts) - new Date(b.ts)).forEach(r => {
          const seq = r.tipo === "entrada" ? ++seqE : ++seqS;
          marcacoesAej.push({ vinculoId: vincDe(u.id), ts: r.ts, tpMarc: r.tipo === "entrada" ? "E" : "S", seq, fonte: r.ajustada ? "I" : "O", codHor: codHorarioDe(r.ts), motivo: r.ajustada ? "Saída automática corrigida com justificativa" : "" });
        });
      });
    });
    const ausencias = [
      ...faltas.filter(f => !f.justificada).map(f => ({ vinculoId: vincDe(f.userId), tipo: "2", data: f.data })),
      ...folgas.filter(f => f.status === "aprovada").map(f => ({ vinculoId: vincDe(f.userId), tipo: "3", data: f.dataFolga, qtMinutos: Math.round(f.horas * 60), tipoMovBH: 2 })), // compensação do BH
    ];
    const ts = registros.map(r => new Date(r.ts));
    const periodo = { ini: ts.length ? new Date(Math.min(...ts)) : new Date(), fim: ts.length ? new Date(Math.max(...ts)) : new Date() };
    const { conteudo, nomeArquivo } = gerarAEJReal(CONFIG_FISCAL, vinculos, HORARIOS_CONTRATUAIS, marcacoesAej, ausencias, periodo);
    baixarArquivo(conteudo, nomeArquivo);
    log("export", `AEJ gerado (leiaute 001): ${nomeArquivo} · ${vinculos.length} vínculos · ${marcacoesAej.length} marcações`);
  };

  if (!user && conviteToken) return <TelaConvite token={conviteToken} onConcluir={concluirConvite} onVoltar={() => { try { window.history.replaceState({}, "", window.location.pathname); } catch {} window.location.reload(); }} />;
  if (!user) return <Login onSupabase={entrarSupabase} onDemo={entrarDemo} onReset={(email) => sbResetSenha(email)} />;

  if (sessaoExpirada) return (
    <div style={{ ...S.app, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ ...S.card, maxWidth: 420, textAlign: "center", padding: 30 }}>
        <div style={{ fontSize: 40 }}>🔒</div>
        <div style={{ ...S.display, fontSize: 20, color: C.amarelo, marginTop: 8 }}>Sessão expirada</div>
        <p style={{ fontSize: 13.5, color: C.branco, marginTop: 10, lineHeight: 1.6 }}>
          Por segurança, o acesso expira depois de um tempo de inatividade. Entre de novo pra continuar — nada do que você registrou foi perdido.
        </p>
        <button style={{ ...S.btn, width: "100%", marginTop: 18 }} onClick={() => { setSessaoExpirada(false); sair(); }}>Entrar novamente</button>
      </div>
    </div>
  );

  // Gate LGPD: colaborador sem consentimento registrado vê o termo ANTES de qualquer tela (primeiro acesso).
  // Gestor não coleta biometria/geo pra si, então não é bloqueado.
  if (user.papel !== "gestor" && !user.consentimentoLGPD) return <GateConsentimentoLGPD user={user} onAceitar={() => consentir(true)} onSair={sair} />;

  const menu = [
    ["ponto", "⏱ Bater ponto"], ["espelho", "📋 Espelho de ponto"], ["justificar", "✍️ Justificativas"],
    ["atestados", "🩺 Atestados"], ["ferias", "🏖 Férias"], ["banco", "⏳ Banco de horas"],
    ...(user.papel === "gestor" ? [["holerite", "💰 Holerite"]] : []), ["premio", "🏆 Prêmio"], ["game", "🎮 Gamificação"], ["feedback", "💬 Meu feedback"], ["lgpd", "🔐 LGPD"],
    ...(user.papel === "gestor" ? [["gestor", "👑 Painel do gestor"]] : []),
  ];

  return (
    <div style={S.app}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;700&family=Inter:wght@400;600;700&display=swap');
        @media print { .no-print { display:none!important } body { background:#fff } }
        /* ---- Responsivo: o celular é o aparelho principal (batida com biometria é no telefone) ---- */
        @media (max-width: 820px) {
          .layout { flex-direction: column !important; }
          .sidebar { width: 100% !important; border-right: none !important; border-bottom: 1px solid #1E3450; padding: 14px !important; }
          .sidebar .menu { flex-direction: row !important; flex-wrap: wrap !important; gap: 8px !important; }
          .sidebar .menu button { flex: 1 1 auto; min-width: 42%; font-size: 13px !important; }
          .sidebar .rodape-empresa { display: none; }
          .conteudo { padding: 16px !important; max-width: 100% !important; }
          .conteudo h1 { font-size: 21px !important; }
          table { font-size: 11.5px !important; }
        }
        /* tabelas largas (folha, espelho) rolam em vez de estourar a tela */
        .rolagem-x { overflow-x: auto; -webkit-overflow-scrolling: touch; }
        /* Área de toque: WCAG 2.2 (2.5.8) pede 24x24 CSS px; iOS recomenda 44 e Android 48.
           Botões pequenos do painel ficavam em ~22px de altura — difícil de acertar no celular. */
        button, select, input[type="checkbox"], input[type="file"] + label, label > input[type="checkbox"] {
          min-height: 44px;
        }
        input[type="checkbox"] { min-width: 22px; width: 22px; height: 22px; }
        @media (max-width: 820px) {
          button { min-height: 48px; }         /* alvo confortável no celular */
          input, select { min-height: 46px; font-size: 16px !important; } /* 16px evita zoom automático no iOS */
        }
        /* foco visível para navegação por teclado (acessibilidade) */
        button:focus-visible, input:focus-visible, select:focus-visible, a:focus-visible {
          outline: 3px solid ${C.amarelo}; outline-offset: 2px; border-radius: 6px;
        }`}</style>
      <div className="layout" style={{ display: "flex", minHeight: "100vh" }}>
        <aside className="no-print sidebar" style={{ width: 230, background: C.carvao, borderRight: "1px solid #1E3450", padding: 18, flexShrink: 0 }}>
          <div style={{ ...S.display, fontSize: 22, color: C.amarelo, lineHeight: 1 }}>PONTO<br /><span style={{ color: C.branco }}>RENOVAR</span></div>
          <div style={{ fontSize: 11, color: C.cinza, marginTop: 6 }}>{EMPRESA.nome}</div>
          <div style={{ marginTop: 8 }}>
            {demo
              ? <span style={S.tag(C.grafite, C.amarelo)}>⚡ demonstração (local)</span>
              : <span style={S.tag(C.grafite, C.verde)}>● conectado ao Supabase</span>}
          </div>
          <div className="menu" role="navigation" aria-label="Menu principal" style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 6 }}>
            {menu.map(([k, label]) => (
              <button key={k} onClick={() => setTela(k)} style={{ ...S.btnGhost, textAlign: "left", background: tela === k ? C.grafite : "transparent", borderColor: tela === k ? C.amarelo : "#2A4568" }}>{label}</button>
            ))}
          </div>
          <div style={{ marginTop: 26, borderTop: "1px solid #1E3450", paddingTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: C.amarelo, color: "#111", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>{user.avatar}</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{user.nome}</div>
                <div style={{ fontSize: 11, color: C.cinza }}>{user.papel === "gestor" ? "Gestor" : "Colaborador"}{user.matricula ? ` · ${user.matricula}` : ""}</div>
              </div>
            </div>
            <button style={{ ...S.btnGhost, marginTop: 12, width: "100%", fontSize: 13 }} aria-label="Sair da conta" onClick={sair}>Sair</button>
            <div className="rodape-empresa" style={{ marginTop: 14, fontSize: 10, color: C.cinza, lineHeight: 1.6, borderTop: "1px solid #1E3450", paddingTop: 10 }}>
              <b style={{ color: C.branco }}>{EMPRESA.nome}</b><br />
              CNPJ {EMPRESA.cnpj}<br />
              {EMPRESA.endereco}<br />
              CEP {EMPRESA.cep}
            </div>
          </div>
        </aside>
        <main className="conteudo" role="main" style={{ flex: 1, padding: 28, maxWidth: 980 }}>
          {erroDados && <div role="alert" style={{ ...S.card, marginBottom: 14, padding: 12, borderLeft: `4px solid ${C.vermelho}`, fontSize: 13 }}>⚠️ {erroDados} <button style={{ ...S.btnGhost, marginLeft: 10, padding: "4px 10px", fontSize: 12 }} onClick={() => carregarDados(sessao?.token, user)}>Tentar de novo</button></div>}
          <div aria-live="polite" aria-atomic="false" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
            {fila.length > 0 ? `${fila.length} batidas aguardando envio.` : ""}
            {sessaoExpirada ? "Sessão expirada." : ""}
            {erroDados || ""}
          </div>
          {aviso && (
            <div role="alert" style={{ ...S.card, marginBottom: 14, padding: 12, borderLeft: `4px solid ${aviso.tipo === "ok" ? C.verde : C.vermelho}`, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ flex: 1, fontSize: 13, lineHeight: 1.55 }}>{aviso.tipo === "ok" ? "✔" : "⚠️"} {aviso.texto}</div>
              <button style={{ ...S.btnGhost, padding: "6px 12px", fontSize: 12 }} onClick={() => setAviso(null)} aria-label="Fechar aviso">Fechar</button>
            </div>
          )}
          {carregandoSecundarios && (
            <div style={{ ...S.card, marginBottom: 14, padding: 9, fontSize: 12, color: C.cinza, display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: C.amarelo, opacity: 0.8 }} />
              Carregando relatórios, folha e histórico em segundo plano — você já pode bater o ponto normalmente.
            </div>
          )}
          {(fila.length > 0 || !online) && (
            <div style={{ ...S.card, marginBottom: 14, padding: 12, borderLeft: `4px solid ${fila.length ? C.amarelo : C.cinza}` }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ flex: 1, fontSize: 13, lineHeight: 1.55 }}>
                  {!online && <div style={{ color: C.amarelo, fontWeight: 700 }}>📴 Sem conexão no momento</div>}
                  {fila.length > 0 ? (
                    <>
                      <b>{fila.length} batida(s) aguardando envio.</b> Elas <b>já estão registradas</b> com o horário do momento em que você bateu — vão pro servidor sozinhas assim que a rede voltar.
                      {!storageDisponivel() && <div style={{ color: C.vermelho, marginTop: 4 }}>⚠️ Este navegador bloqueia o armazenamento local: mantenha o app aberto até a fila esvaziar, senão as batidas pendentes se perdem.</div>}
                      {fila.some(i => i.tentativas > 2) && <div style={{ color: C.cinza, marginTop: 4, fontSize: 12 }}>Última falha: {fila.find(i => i.ultimoErro)?.ultimoErro}</div>}
                    </>
                  ) : <span style={{ color: C.cinza }}>Nenhuma batida pendente.</span>}
                </div>
                {fila.length > 0 && (
                  <button style={{ ...S.btn, padding: "7px 14px", fontSize: 12, opacity: enviandoFila ? 0.6 : 1 }} disabled={enviandoFila} onClick={() => enviarFila(false)}>
                    {enviandoFila ? "⏳ Enviando…" : "Tentar enviar agora"}
                  </button>
                )}
              </div>
              {fila.length > 0 && (
                <div style={{ marginTop: 8, borderTop: "1px solid #1E3450", paddingTop: 8 }}>
                  {fila.slice(0, 4).map(i => (
                    <div key={i.cliente_uuid} style={{ fontSize: 12, color: C.cinza, padding: "3px 0" }}>
                      ⏳ {i.tipo === "entrada" ? "Entrada" : "Saída"} · {fmtData(i.ts)} às {fmtHora(i.ts)}{i.tentativas ? ` · ${i.tentativas} tentativa(s)` : ""}
                    </div>
                  ))}
                  {fila.length > 4 && <div style={{ fontSize: 12, color: C.cinza }}>+ {fila.length - 4} outra(s)</div>}
                </div>
              )}
            </div>
          )}
          {lembrete && (
            <div style={{ ...S.card, marginBottom: 14, padding: 12, borderLeft: `4px solid ${C.amarelo}`, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ flex: 1, fontSize: 13 }}><b>{lembrete.titulo}</b> — {lembrete.corpo}</div>
              <button style={{ ...S.btn, padding: "6px 14px", fontSize: 12 }} onClick={() => { setLembrete(null); setTela("ponto"); }}>Bater ponto</button>
              <button style={{ ...S.btnGhost, padding: "6px 12px", fontSize: 12 }} onClick={() => setLembrete(null)}>Dispensar</button>
            </div>
          )}
          {saidasPend.some(p => p.userId === user.id && !p.confirmada) && (
            <BannerSaidasAuto pendencias={saidasPend.filter(p => p.userId === user.id && !p.confirmada)} onConfirmar={confirmarSaida} onCorrigir={corrigirSaida} />
          )}
          {salvando && <div style={{ ...S.card, marginBottom: 14, padding: 10, fontSize: 13, color: C.cinza }}>⏳ Salvando no banco…</div>}
          {tela === "ponto" && <TelaPonto {...{ user, relogio, registros, faltas, fluxoPonto, setFluxoPonto, geo, comprovante, iniciarBatida, concluirBatida, locais, bloqueioGeo, notifStatus, onPedirNotif: pedirPermissaoNotif, credenciais: credenciais.filter(c => c.userId === user.id), onIrConfigurar: () => setTela("lgpd"), token: sessao?.token, demo, onRegistrarSemLocalizacao: registrarSemLocalizacao }} />}
          {tela === "espelho" && <TelaEspelho user={user} registros={registros} exportarAFD={exportarAFD} exportarAEJ={exportarAEJ} />}
          {tela === "justificar" && <TelaJustificar {...{ user, justificativas, onEnviar: enviarJustificativa }} />}
          {tela === "atestados" && <TelaAtestados {...{ user, atestados, onEnviar: enviarAtestado }} />}
          {tela === "ferias" && <TelaFerias {...{ user, ferias, agendarFerias }} />}
          {tela === "banco" && <TelaBanco {...{ user, registros, faltas, folgas, onSolicitar: solicitarFolga }} />}
          {tela === "holerite" && <TelaHolerite user={user} folhasPg={folhasPg.filter(f => f.userId === user.id)} adiantamentos={adiantamentos.filter(a => a.userId === user.id)} />}
          {tela === "premio" && <TelaPremio user={user} registros={registros} faltas={faltas} />}
          {tela === "game" && <TelaGame user={user} registros={registros} faltas={faltas} rankingUsuarios={rankingUsuarios} />}
          {tela === "feedback" && <TelaFeedback user={user} registros={registros} faltas={faltas} />}
          {tela === "lgpd" && <TelaLGPD user={user} onConsentir={consentir} credenciais={credenciais.filter(c => c.userId === user.id)} onCadastrarBio={cadastrarBiometria} onRemoverBio={removerBiometria} />}
          {tela === "gestor" && user.papel === "gestor" && (
            /* acesso pelo papel real do usuário autenticado (tipo=gestor no banco, garantido por RLS) — sem senha extra */
            <TelaGestor {...{ usuarios, registros, faltas, justificativas, atestados, ferias, logs, decidir, locais, onCriarLocal: criarLocal, onDesativarLocal: desativarLocal, convites, onCriarConvite: criarConvite, onSalvarUsuario: salvarUsuario, gestorId: user.id, folgas, onDecidirFolga: decidirFolga, folhasPg, adiantamentos, guias, onGerarFolha: gerarFolha, onEditarFolha: editarFolha, onFecharFolha: fecharFolha, onMarcarGuiaPaga: marcarGuiaPaga, onCriarAdiant: criarAdiantamento, onCancelarAdiant: cancelarAdiantamento }} />
          )}
        </main>
      </div>
    </div>
  );
}

/* ================= Telas ================= */
function BannerSaidasAuto({ pendencias, onConfirmar, onCorrigir }) {
  const [corrigindo, setCorrigindo] = useState(null); // { id, hora, just }
  const [erro, setErro] = useState(null);
  const [salvandoId, setSalvandoId] = useState(null);
  const confirmar = async (id) => {
    if (salvandoId) return;
    setSalvandoId(id); setErro(null);
    try { await onConfirmar(id); }
    catch (e) { setErro(mensagemAmigavel(e, "ao confirmar")); }
    finally { setSalvandoId(null); }
  };
  const salvarCorrecao = async () => {
    if (salvandoId) return;
    setSalvandoId(corrigindo.id); setErro(null);
    try { await onCorrigir(corrigindo.id, corrigindo.hora, corrigindo.just); setCorrigindo(null); }
    catch (e) { setErro(mensagemAmigavel(e)); }
    finally { setSalvandoId(null); }
  };
  return (
    <div style={{ ...S.card, marginBottom: 14, borderLeft: `4px solid ${C.amarelo}` }}>
      <div style={{ ...S.display, fontSize: 14, color: C.amarelo }}>⚠️ Saída preenchida automaticamente — confirme ou corrija</div>
      <p style={{ fontSize: 12, color: C.cinza, margin: "6px 0 0" }}>Você não registrou a saída nesses dias e o sistema preencheu o horário oficial de fechamento. Confirmar (ou corrigir com justificativa) evita disputa sobre um horário que foi apenas estimado.</p>
      {pendencias.map(p => (
        <div key={p.id} style={{ borderTop: "1px solid #1E3450", padding: "9px 0" }}>
          {corrigindo?.id === p.id ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 13 }}><b>{fmtData(p.data + "T12:00:00")}</b> — saía real:</span>
              <input type="time" style={{ ...S.input, width: 120 }} value={corrigindo.hora} onChange={e => setCorrigindo({ ...corrigindo, hora: e.target.value })} />
              <input style={{ ...S.input, width: 260 }} placeholder="Justificativa (obrigatória)" value={corrigindo.just} onChange={e => setCorrigindo({ ...corrigindo, just: e.target.value })} />
              <button style={{ ...S.btn, padding: "8px 14px", fontSize: 13, opacity: salvandoId ? 0.6 : 1 }} disabled={!!salvandoId} onClick={salvarCorrecao}>{salvandoId === corrigindo.id ? "⏳ Salvando…" : "Salvar correção"}</button>
              <button style={{ ...S.btnGhost, padding: "8px 14px", fontSize: 13 }} onClick={() => { setCorrigindo(null); setErro(null); }}>Cancelar</button>
            </div>
          ) : (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13 }}><b>{fmtData(p.data + "T12:00:00")}</b> — saída automática registrada às <b>{p.saida}</b></span>
              <span style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button style={{ ...S.btnGhost, borderColor: C.verde, color: C.verde, padding: "6px 12px", fontSize: 12, opacity: salvandoId ? 0.6 : 1 }} disabled={!!salvandoId} onClick={() => confirmar(p.id)}>{salvandoId === p.id ? "⏳ Salvando…" : "✔ Confirmar horário"}</button>
                <button style={{ ...S.btnGhost, padding: "6px 12px", fontSize: 12 }} aria-label="Corrigir horário da saída automática" onClick={() => setCorrigindo({ id: p.id, hora: p.saida, just: "" })}>✎ Corrigir</button>
              </span>
            </div>
          )}
        </div>
      ))}
      {erro && <p style={{ fontSize: 12, color: C.vermelho, marginTop: 6 }}>{erro}</p>}
    </div>
  );
}

function TelaConvite({ token, onConcluir, onVoltar }) {
  const [conv, setConv] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [senha, setSenha] = useState("");
  const [senha2, setSenha2] = useState("");
  const [erro, setErro] = useState(null);
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        // Busca por RPC com o token exato: a view pública foi revogada porque permitia
        // a qualquer anônimo LISTAR todos os convites pendentes (nome, e-mail, tipo e token).
        if (!uuidValido(token)) throw new Error("Link de convite inválido.");
        const rows = await sbRpc(null, "convite_por_token", { p_token: token });
        if (!rows.length) setErro("Convite não encontrado, já utilizado ou expirado. Peça um novo link ao gestor.");
        else setConv(mapConvite(rows[0]));
      } catch (e) { setErro(mensagemAmigavel(e, "ao verificar o convite")); }
      finally { setCarregando(false); }
    })();
  }, [token]);
  const concluir = async () => {
    if (enviando) return;
    if (senha.length < 8) { setErro("A senha precisa ter no mínimo 8 caracteres."); return; }
    if (senha !== senha2) { setErro("As senhas não conferem."); return; }
    setEnviando(true); setErro(null);
    try { await onConcluir(conv, senha); }
    catch (e) { setErro(mensagemAmigavel(e)); }
    finally { setEnviando(false); }
  };
  return (
    <div style={{ ...S.app, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ ...S.card, width: 440, padding: 36 }}>
        <div style={{ ...S.display, fontSize: 30, color: C.amarelo, lineHeight: 1, textAlign: "center" }}>PONTO<span style={{ color: C.branco }}>RENOVAR</span></div>
        <div style={{ fontSize: 13, color: C.cinza, marginTop: 8, textAlign: "center" }}>Convite pra criar sua conta</div>
        {carregando && <p style={{ textAlign: "center", color: C.cinza, marginTop: 24 }}>Verificando convite…</p>}
        {!carregando && conv && (
          <div style={{ marginTop: 20 }}>
            <div style={{ background: C.grafite, borderRadius: 10, padding: 14, fontSize: 14, lineHeight: 1.8 }}>
              👤 <b>{conv.nome}</b><br />
              ✉️ {conv.email}<br />
              {conv.cargo && <>💼 {conv.cargo}<br /></>}
              {conv.dataAdmissao && <>📅 Admissão: {fmtData(conv.dataAdmissao)}<br /></>}
              🏷 {conv.tipo === "gestor" ? "Gestor" : "Colaborador"} · expira em {fmtData(conv.expiraEm)}
            </div>
            <input type="password" style={{ ...S.input, marginTop: 12 }} placeholder="Crie uma senha (mínimo 8 caracteres)" value={senha} onChange={e => { setSenha(e.target.value); setErro(null); }} />
            <input type="password" style={{ ...S.input, marginTop: 10 }} placeholder="Repita a senha" value={senha2} onChange={e => { setSenha2(e.target.value); setErro(null); }} onKeyDown={e => e.key === "Enter" && concluir()} />
            <button style={{ ...S.btn, marginTop: 12, width: "100%", opacity: enviando ? 0.6 : 1 }} disabled={enviando} onClick={concluir}>
              {enviando ? "Criando conta…" : "Criar minha conta e entrar"}
            </button>
          </div>
        )}
        {erro && <p role="alert" style={{ color: C.vermelho, fontSize: 13, marginTop: 12, lineHeight: 1.5 }}>{erro}</p>}
        <button style={{ ...S.btnGhost, fontSize: 12, width: "100%", marginTop: 16 }} onClick={onVoltar}>← Ir pro login normal</button>
      </div>
    </div>
  );
}

/* Backoff local de login. IMPORTANTE (honestidade): isto é uma barreira de USABILIDADE
   contra tentativa manual repetida — some se a página for recarregada e não protege
   contra ataque direto à API. A proteção real contra força bruta é do lado do servidor:
   os limites nativos do Supabase Auth (por IP/e-mail) + "Leaked password protection". */
const _tentativasLogin = { n: 0, bloqueadoAte: 0 };

function Login({ onSupabase, onDemo, onReset }) {
  /* Modo PRODUÇÃO por padrão: login real por e-mail + senha, sem contas pré-listadas
     (não expor e-mails da equipe numa página pública). Demonstração fica discreta, opt-in. */
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [mostrarDemo, setMostrarDemo] = useState(false);
  const [segundosBloqueio, setSegundosBloqueio] = useState(Math.max(0, Math.ceil((_tentativasLogin.bloqueadoAte - Date.now()) / 1000)));
  useEffect(() => {
    if (segundosBloqueio <= 0) return;
    const t = setInterval(() => setSegundosBloqueio(s => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(t);
  }, [segundosBloqueio]);
  const [modoReset, setModoReset] = useState(false);
  const [msgReset, setMsgReset] = useState(null);
  const enviarReset = async () => {
    const e = email.trim().toLowerCase();
    if (!e) { setMsgReset({ ok: false, txt: "Informe seu e-mail acima pra receber o link de redefinição." }); return; }
    setCarregando(true); setMsgReset(null);
    try { await onReset(e); setMsgReset({ ok: true, txt: `Se houver conta para ${e}, enviamos um link de redefinição. Confira seu e-mail (inclusive spam).` }); }
    catch (err) { setMsgReset({ ok: false, txt: mensagemAmigavel(err) }); }
    finally { setCarregando(false); }
  };
  const entrar = async () => {
    const e = limparTexto(email, LIMITES.email).toLowerCase();
    if (!e || !senha) { setErro("Preencha e-mail e senha."); return; }
    if (!emailValido(e)) { setErro("E-mail inválido."); return; }
    if (segundosBloqueio > 0) return;
    setCarregando(true); setErro(null);
    try {
      await onSupabase(e, senha);
      _tentativasLogin.n = 0; _tentativasLogin.bloqueadoAte = 0;
    } catch (err) {
      _tentativasLogin.n += 1;
      if (_tentativasLogin.n >= 3) {
        // 3ª falha: 15s · 4ª: 30s · 5ª: 60s … teto de 5 min
        const espera = Math.min(15 * Math.pow(2, _tentativasLogin.n - 3), 300);
        _tentativasLogin.bloqueadoAte = Date.now() + espera * 1000;
        setSegundosBloqueio(espera);
      }
      const rede = err instanceof TypeError || /fetch|network/i.test(err.message);
      setErro(rede
        ? "Não foi possível conectar ao servidor. Verifique sua internet e tente de novo. (Se estiver abrindo o arquivo dentro de um preview, use o endereço publicado.)"
        : mensagemAmigavel(err, "ao entrar"));
    } finally { setCarregando(false); }
  };
  return (
    <div style={{ ...S.app, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ ...S.card, width: 440, textAlign: "center", padding: 36 }}>
        <div style={{ ...S.display, fontSize: 34, color: C.amarelo, lineHeight: 1 }}>PONTO<span style={{ color: C.branco }}>RENOVAR</span></div>
        <div style={{ fontSize: 13, color: C.cinza, marginTop: 8 }}>Entre com sua conta corporativa</div>
        <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 10 }}>
          <input style={{ ...S.input, fontSize: 14 }} type="email" placeholder="E-mail corporativo" value={email} autoFocus
            onChange={e => { setEmail(e.target.value); setErro(null); }} onKeyDown={e => e.key === "Enter" && entrar()} />
          <label htmlFor="campo-senha" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Senha</label>
          <input id="campo-senha" name="password" autoComplete="current-password" type="password" aria-label="Senha" style={{ ...S.input, fontSize: 14 }} placeholder="Senha" value={senha}
            onChange={e => { setSenha(e.target.value); setErro(null); }} onKeyDown={e => e.key === "Enter" && entrar()} />
          <button style={{ ...S.btn, width: "100%", opacity: carregando || segundosBloqueio > 0 ? 0.6 : 1 }} disabled={carregando || segundosBloqueio > 0} onClick={entrar}>
            {carregando ? "Autenticando…" : segundosBloqueio > 0 ? `Aguarde ${segundosBloqueio}s` : "Entrar"}
          </button>
          {segundosBloqueio > 0 && <p style={{ fontSize: 11.5, color: C.cinza, textAlign: "center", lineHeight: 1.5 }}>Muitas tentativas seguidas. Espere o contador zerar — se esqueceu a senha, use o link abaixo.</p>}
          {!modoReset ? (
            <button style={{ background: "none", border: "none", color: C.cinza, fontSize: 12, cursor: "pointer", textDecoration: "underline", marginTop: 2 }} onClick={() => { setModoReset(true); setMsgReset(null); }}>Esqueci minha senha</button>
          ) : (
            <div style={{ marginTop: 4, padding: 10, background: C.grafite, borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: C.cinza, marginBottom: 6 }}>Digite seu e-mail no campo acima e receba um link de redefinição por e-mail (Supabase Auth).</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button style={{ ...S.btn, flex: 1, padding: "8px 12px", fontSize: 13, opacity: carregando ? 0.6 : 1 }} disabled={carregando} onClick={enviarReset}>{carregando ? "Enviando…" : "Enviar link de redefinição"}</button>
                <button style={{ ...S.btnGhost, padding: "8px 12px", fontSize: 13 }} onClick={() => { setModoReset(false); setMsgReset(null); }}>Cancelar</button>
              </div>
              {msgReset && <p style={{ fontSize: 12, color: msgReset.ok ? C.verde : C.vermelho, marginTop: 8, lineHeight: 1.5 }}>{msgReset.txt}</p>}
            </div>
          )}
        </div>
        {erro && <p role="alert" style={{ color: C.vermelho, fontSize: 13, marginTop: 12, lineHeight: 1.5 }}>{erro}</p>}
        <p style={{ fontSize: 11, color: C.cinza, marginTop: 14 }}>🔒 Autenticação real via Supabase Auth (e-mail + senha) com RLS no banco. A chave publishable é pública por design — a segurança vem das políticas de acesso.</p>
        <div style={{ marginTop: 14, borderTop: "1px solid #1E3450", paddingTop: 10 }}>
          {!mostrarDemo ? (
            <button style={{ background: "none", border: "none", color: C.cinza, fontSize: 11, cursor: "pointer", textDecoration: "underline" }} onClick={() => setMostrarDemo(true)}>
              Conhecer o sistema com dados fictícios (demonstração)
            </button>
          ) : (
            <div>
              <div style={{ fontSize: 11, color: C.cinza, marginBottom: 8 }}>⚡ Demonstração — dados 100% fictícios, sem backend:</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                {USUARIOS_SEED.map(u => (
                  <button key={u.id} style={{ ...S.btnGhost, fontSize: 11, padding: "6px 10px" }} onClick={() => onDemo(u)}>
                    {u.avatar} {u.nome.split(" ")[0]}{u.papel === "gestor" ? " (gestor)" : ""}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div style={{ fontSize: 10, color: C.cinza, marginTop: 12, lineHeight: 1.6, borderTop: "1px solid #1E3450", paddingTop: 10 }}>
          <b style={{ color: C.branco }}>{EMPRESA.nome}</b> · CNPJ {EMPRESA.cnpj}<br />
          {EMPRESA.endereco} · CEP {EMPRESA.cep}<br />
          {EMPRESA.ramo}
        </div>
      </div>
    </div>
  );
}

function TelaPonto({ user, relogio, registros, faltas, fluxoPonto, setFluxoPonto, geo, comprovante, iniciarBatida, concluirBatida, locais, bloqueioGeo, notifStatus, onPedirNotif, credenciais = [], onIrConfigurar, token, demo, onRegistrarSemLocalizacao }) {
  // Trava anti-duplicidade: 60s de espera após uma batida (evita duplo toque e registro repetido)
  const ultima = registros.filter(r => r.userId === user.id).reduce((m, r) => Math.max(m, new Date(r.ts).getTime()), 0);
  const [batidaRecente, setBatidaRecente] = useState(0);
  const [dispensando, setDispensando] = useState(false);
  const [justGeo, setJustGeo] = useState("");
  const [erroDispensa, setErroDispensa] = useState(null);
  const [permGeo, setPermGeo] = useState(null);
  useEffect(() => { permissaoGeo().then(setPermGeo); }, [fluxoPonto]);
  useEffect(() => {
    const calc = () => setBatidaRecente(Math.max(0, 60 - Math.floor((Date.now() - ultima) / 1000)));
    calc();
    const t = setInterval(calc, 1000);
    return () => clearInterval(t);
  }, [ultima]);
  const temLocais = locais.some(l => l.ativo);
  const doDia = agruparPorDia(registros, user.id)[new Date().toLocaleDateString("pt-BR")] || [];
  const proxTipo = doDia.length % 2 === 0 ? "ENTRADA" : "SAÍDA";
  const a = analisarAssiduidade(user.id, registros, faltas);
  const eleg = elegibilidadePremio(user.id, registros, faltas);
  const emAlerta = eleg.medidores.filter(m => m.estourou || (m.limite && m.valor / m.limite >= 0.7));
  return (
    <div>
      <h1 style={{ ...S.display, fontSize: 26, margin: 0 }}>Registro de ponto</h1>
      {!temLocais && (
        <p style={{ fontSize: 12, color: C.cinza, margin: "10px 0 0" }}>📍 Local de trabalho ainda não configurado pelo gestor — batida liberada sem verificação de raio.</p>
      )}
      {permGeo === "denied" && (
        <div style={{ ...S.card, marginTop: 12, padding: 12, borderLeft: `4px solid ${C.amarelo}`, textAlign: "left" }}>
          <div style={{ fontSize: 13, color: C.amarelo, fontWeight: 700 }}>📍 Localização bloqueada neste navegador</div>
          <p style={{ fontSize: 12.5, color: C.branco, marginTop: 6, lineHeight: 1.6 }}>{GEO_MOTIVOS.permissao_negada.comoResolver}</p>
        </div>
      )}
      {notifStatus === "default" && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
          <button style={{ ...S.btnGhost, fontSize: 12, padding: "8px 14px" }} onClick={onPedirNotif}>🔔 Ativar notificações do navegador (lembretes de ponto)</button>
        </div>
      )}
      <p style={{ fontSize: 11, color: C.cinza, margin: "8px 0 0" }}>
        ⏰ Lembretes de batida (8h/9h entrada; 12h/13h almoço em dias de semana) funcionam <b>enquanto o app estiver aberto no navegador</b> — não são notificações push de celular.{notifStatus === "granted" ? " Notificações do navegador: ativas ✔" : notifStatus === "denied" ? " Notificações do navegador: bloqueadas (o banner interno continua funcionando)." : ""}
      </p>
      {bloqueioGeo && (
        <div role="alert" style={{ ...S.card, marginTop: 14, padding: 16, borderLeft: `4px solid ${C.vermelho}`, textAlign: "left" }}>
          <div style={{ ...S.display, fontSize: 15, color: C.vermelho }}>📍 {bloqueioGeo.titulo || "Localização indisponível"}</div>
          <p style={{ fontSize: 13.5, color: C.branco, marginTop: 8, lineHeight: 1.6 }}>{bloqueioGeo.msg}</p>
          {bloqueioGeo.comoResolver && (
            <div style={{ background: C.grafite, borderRadius: 8, padding: 12, marginTop: 10, fontSize: 12.5, color: C.branco, lineHeight: 1.6 }}>
              <b style={{ color: C.amarelo }}>Como resolver:</b> {bloqueioGeo.comoResolver}
            </div>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            <button style={{ ...S.btn, padding: "9px 16px", fontSize: 13 }} onClick={iniciarBatida}>🔄 Tentar de novo</button>
            {bloqueioGeo.permiteDispensa && !dispensando && (
              <button style={{ ...S.btnGhost, padding: "9px 16px", fontSize: 13 }} onClick={() => setDispensando(true)}>Registrar sem localização</button>
            )}
          </div>
          {dispensando && (
            <div style={{ marginTop: 12, borderTop: "1px solid #1E3450", paddingTop: 12 }}>
              <p style={{ fontSize: 12.5, color: C.branco, lineHeight: 1.6 }}>
                Sua jornada não pode ficar sem registro por falha de GPS. Explique rapidamente o motivo — a batida será registrada
                <b> sem localização e sinalizada pro gestor</b>, com sua justificativa na trilha de auditoria.
              </p>
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <input style={{ ...S.input, flex: 1, minWidth: 200 }} placeholder="Ex: estou na oficina, sem sinal de GPS" value={justGeo} onChange={e => setJustGeo(e.target.value)} aria-label="Justificativa para registrar sem localização" />
                <button style={{ ...S.btn, padding: "9px 16px", fontSize: 13 }} onClick={() => {
                  try { onRegistrarSemLocalizacao(justGeo); setDispensando(false); setJustGeo(""); setErroDispensa(null); }
                  catch (e) { setErroDispensa(mensagemAmigavel(e)); }
                }}>Continuar</button>
                <button style={{ ...S.btnGhost, padding: "9px 14px", fontSize: 13 }} onClick={() => { setDispensando(false); setErroDispensa(null); }}>Cancelar</button>
              </div>
              {erroDispensa && <p style={{ fontSize: 12.5, color: C.vermelho, marginTop: 8 }}>{erroDispensa}</p>}
            </div>
          )}
        </div>
      )}
      {emAlerta.length > 0 && (
        <div style={{ ...S.card, marginTop: 14, padding: 14, borderLeft: `4px solid ${eleg.elegivel ? C.amarelo : C.vermelho}`, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 22 }}>{eleg.elegivel ? "⚠️" : "⛔"}</span>
          <div style={{ flex: 1, fontSize: 13 }}>
            <b>{eleg.elegivel ? "Atenção ao Prêmio Performance:" : "Prêmio Performance deste mês não elegível:"}</b>{" "}
            {emAlerta.map(m => `${m.label.toLowerCase()}: ${m.valor}${m.unidade} de ${m.limite}${m.unidade}`).join(" · ")}
            {eleg.elegivel && " — ainda dá pra segurar dentro do limite até o fechamento."}
          </div>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, marginTop: 18 }}>
        <div style={{ ...S.card, textAlign: "center", padding: 34 }}>
          <div style={{ ...S.display, fontSize: 64, color: C.amarelo, lineHeight: 1 }}>{relogio.toLocaleTimeString("pt-BR")}</div>
          <div style={{ color: C.cinza, marginTop: 6 }}>{relogio.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}</div>
          {!fluxoPonto && <button style={{ ...S.btn, marginTop: 24, fontSize: 18, padding: "16px 34px", opacity: batidaRecente ? 0.5 : 1 }} disabled={!!batidaRecente} onClick={iniciarBatida} aria-label={batidaRecente ? `Aguarde ${batidaRecente} segundos para registrar novamente` : `Registrar ${proxTipo} agora`}>
            {batidaRecente ? `Aguarde ${batidaRecente}s` : `Registrar ${proxTipo}`}
          </button>}
          {batidaRecente > 0 && <p style={{ fontSize: 12, color: C.cinza, marginTop: 10 }}>Você acabou de registrar um ponto. A pausa evita batida duplicada por toque acidental.</p>}
          {fluxoPonto === "geo" && (
            <div style={{ marginTop: 20 }}>
              <p style={{ color: C.cinza, fontSize: 14 }}>📍 Obtendo sua localização…</p>
              <p style={{ color: C.cinza, fontSize: 11.5, marginTop: 4 }}>Se o aparelho perguntar, toque em "Permitir". Dentro de prédios pode levar alguns segundos.</p>
            </div>
          )}
          {fluxoPonto === "biometria" && (
            <div style={{ marginTop: 20 }}>
              <p style={{ fontSize: 13, color: geo?.erro ? C.vermelho : C.verde }}>
                {geo?.erro ? `⚠️ ${geo.erro}` : geo?.local
                  ? `📍 Dentro do raio de "${geo.local}" — ${geo.dist} m de ${geo.raio} m permitidos (±${geo.precisao}m)`
                  : `📍 Localização capturada: ${geo.lat}, ${geo.lng} (±${geo.precisao}m)`}
              </p>
              <BiometriaCheck
                credenciais={credenciais}
                onAprovado={concluirBatida}
                onSemVerificacao={(motivo) => concluirBatida({ ok: false, metodo: "sem_verificacao", motivo })}
                onIrConfigurar={onIrConfigurar}
                token={token}
                demo={demo}
              />
            </div>
          )}
          {fluxoPonto === "comprovante" && comprovante && (
            <div style={{ marginTop: 20, background: C.grafite, borderRadius: 12, padding: 18, textAlign: "left" }}>
              <div style={{ ...S.display, color: comprovante.pendente ? C.cinza : C.verde, fontSize: 15 }}>
                {comprovante.pendente ? "⏳ Registrado no aparelho — envio pendente" : "✔ Registro confirmado no servidor"}
              </div>
              <div style={{ ...S.display, color: C.amarelo, fontSize: 13, marginTop: 2 }}>Comprovante (Portaria 671/2021)</div>
              {comprovante.pendente && (
                <div style={{ fontSize: 12, color: C.branco, background: "#3A2A08", borderRadius: 8, padding: 10, marginTop: 8, lineHeight: 1.55 }}>
                  Sua batida foi salva <b>neste aparelho</b> com o horário de agora e será enviada automaticamente quando a rede voltar.
                  O NSR (número sequencial oficial) é gerado no envio.
                </div>
              )}
              <div style={{ fontSize: 13, marginTop: 8, lineHeight: 1.7 }}>
                NSR: <b>{String(comprovante.nsr).padStart(9, "0")}</b><br />
                {EMPRESA.nome} · CNPJ {EMPRESA.cnpj}<br />
                Colaborador: {user.nome}<br />
                Marcação: <b>{comprovante.tipo.toUpperCase()}</b> em {fmtDataHora(comprovante.ts)}<br />
                Geo: {comprovante.lat != null ? `${comprovante.lat}, ${comprovante.lng}` : (comprovante.geoStatus === "dispensado_por_falha" ? "sem localização (justificada) ⚠️" : comprovante.geoStatus === "sem_geofence" ? "não exigida" : "indisponível")}{geo?.local ? ` · dentro do raio de "${geo.local}"` : ""} · Identidade: {comprovante.metodo === "webauthn_servidor" ? "biometria validada no servidor ✔" : comprovante.metodo === "webauthn_local" ? "biometria conferida localmente (demo) ✔" : "sem verificação biométrica ⚠️"}
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 12 }} className="no-print">
                <button style={S.btnGhost} aria-label="Imprimir holerite" onClick={() => window.print()}>🖨 Imprimir comprovante</button>
                <button style={S.btn} onClick={() => setFluxoPonto(null)}>OK</button>
              </div>
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={S.card}>
            <div style={{ ...S.display, fontSize: 14, color: C.cinza }}>Hoje</div>
            <div style={{ fontSize: 11, color: C.cinza, marginBottom: 4 }}>expediente de hoje: {expedienteDoDia(new Date()).rotulo}</div>
            {doDia.length === 0 ? <p style={{ fontSize: 14, color: C.cinza }}>Nenhuma marcação ainda.</p> :
              doDia.map(r => <div key={r.nsr} style={{ fontSize: 14, marginTop: 6 }}>{r.tipo === "entrada" ? "🟢" : "🔴"} {r.tipo} — {fmtHora(r.ts)}</div>)}
          </div>
          <div style={S.card}>
            <div style={{ ...S.display, fontSize: 14, color: C.cinza }}>Banco de horas (10 dias)</div>
            <div style={{ ...S.display, fontSize: 30, color: a.saldoMin >= 0 ? C.verde : C.vermelho }}>{hmm(a.saldoMin)}</div>
            <div style={{ fontSize: 13, color: C.cinza }}>{a.atrasos} atraso(s) · {a.faltas} falta(s)</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TelaEspelho({ user, registros, exportarAFD, exportarAEJ }) {
  const dias = agruparPorDia(registros, user.id);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <h1 style={{ ...S.display, fontSize: 26, margin: 0 }}>Espelho de ponto</h1>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }} className="no-print">
          <button style={S.btnGhost} onClick={exportarAFD}>⬇ Exportar AFD (leiaute 003)</button>
          <button style={S.btnGhost} onClick={exportarAEJ}>⬇ Exportar AEJ (leiaute 001)</button>
          <button style={S.btn} onClick={() => window.print()}>🖨 Exportar PDF</button>
        </div>
      </div>
      <div className="no-print" style={{ ...S.card, marginTop: 14, padding: 12, fontSize: 12, color: C.cinza, borderLeft: `4px solid ${C.amarelo}` }}>
        ⚠️ <b style={{ color: C.branco }}>Arquivos fiscais no formato oficial da Portaria 671/2021</b> — AFD com marcações tipo 7 (cadeia de hash SHA-256) e AEJ delimitado por pipe, ambos em ISO 8859-1 com CR+LF. Dois itens são <b style={{ color: C.branco }}>placeholders pendentes de etapas externas ao protótipo</b>: (1) o nº de registro no INPI (campo 7 do cabeçalho do AFD e nrRep do AEJ) está zerado até o registro do programa ser feito; (2) a linha "ASSINATURA_DIGITAL_EM_ARQUIVO_P7S" é o texto literal previsto no leiaute — a assinatura real exige arquivo .p7s gerado com certificado ICP-Brasil do desenvolvedor. Sem esses dois itens, os arquivos ainda não têm valor fiscal.
      </div>
      <div style={{ ...S.card, marginTop: 16 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead><tr style={{ color: C.cinza, textAlign: "left" }}><th style={{ padding: 8 }}>Data</th><th>Marcações</th><th>Trabalhado</th><th>Saldo do dia</th></tr></thead>
          <tbody>
            {Object.entries(dias).map(([dia, regs]) => {
              const exp = expedienteDoDia(new Date(regs[0].ts));
              const min = minutosDia(regs);
              const pares = Math.min(regs.filter(r => r.tipo === "entrada").length, regs.filter(r => r.tipo === "saida").length);
              const saldo = min - (exp.intervaloMin > 0 && pares <= 1 ? exp.intervaloMin : 0) - exp.jornadaMin;
              return (
                <tr key={dia} style={{ borderTop: "1px solid #1E3450" }}>
                  <td style={{ padding: 8, fontWeight: 700 }}>{dia} <span style={{ fontSize: 10, color: C.cinza, fontWeight: 400 }}>{exp.rotulo}</span></td>
                  <td>{regs.map(r => fmtHora(r.ts) + (r.ajustada ? "*" : r.automatica ? "ᴬ" : "") + (r.metodo === "sem_verificacao" ? "⚠" : "") + (r.pendente ? "⏳" : r.offline ? "ᶠ" : "") + (r.geoStatus === "dispensado_por_falha" ? "📍" : "")).join(" · ")}</td>
                  <td>{hmm(min)}</td>
                  <td style={{ color: saldo >= 0 ? C.verde : C.vermelho, fontWeight: 700 }}>{hmm(saldo)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p style={{ fontSize: 12, color: C.cinza, marginTop: 10 }}>Legenda: ᴬ = saída preenchida automaticamente pelo sistema · * = horário corrigido com justificativa · ⚠ = batida sem verificação biométrica · ⏳ = aguardando envio ao servidor · ᶠ = registrada sem rede (horário do aparelho) · 📍 = registrada sem localização, com justificativa. Expediente oficial: seg-sex 8:00 às 18:00; sábado 8:00 às 13:00 (turno único); domingos e feriados nacionais a empresa não abre (8h produtivas + 2h de intervalo intrajornada). Se o dia tiver um único par entrada/saída, as 2h de intervalo são descontadas da presença; batendo o ponto na saída e volta do intervalo, a apuração usa os pares reais. Horas além das 8h produtivas entram no banco de horas (acordo individual escrito, CLT art. 59 §5º) ou são pagas como extra com adicional mínimo de 50%.</p>
      </div>
    </div>
  );
}

function TelaJustificar({ user, justificativas, onEnviar }) {
  const [texto, setTexto] = useState("");
  const [anexo, setAnexo] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState(null);
  const minhas = justificativas.filter(j => j.userId === user.id);
  const enviar = async () => {
    if (!texto.trim() || enviando) return;
    setEnviando(true);
    setErroEnvio(null);
    try { await onEnviar(texto, anexo?.file || null); setTexto(""); setAnexo(null); }
    catch (e) { setErroEnvio(mensagemAmigavel(e, "ao enviar o arquivo")); }
    finally { setEnviando(false); }
  };
  return (
    <div>
      <h1 style={{ ...S.display, fontSize: 26, margin: 0 }}>Justificativas de atraso</h1>
      <div style={{ ...S.card, marginTop: 16 }}>
        <textarea style={{ ...S.input, minHeight: 90 }} placeholder="Descreva o motivo do atraso…" value={texto} onChange={e => setTexto(e.target.value)} />
        <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center" }}>
          <label style={{ ...S.btnGhost, cursor: "pointer" }}>📎 {anexo ? anexo.nome : "Anexar evidência"}
            <input type="file" accept="image/*,.pdf" style={{ display: "none" }} onChange={e => { const f = e.target.files[0]; if (!f) return; const p = validarArquivo(f); if (p) { setErroEnvio(p); return; } setErroEnvio(null); setAnexo({ nome: f.name, tamanho: f.size, file: f }); }} />
            {erroEnvio && <span role="alert" style={{ fontSize: 13, color: C.vermelho, display: "block", marginTop: 8 }}>{erroEnvio}</span>}
          </label>
          <button style={{ ...S.btn, opacity: enviando ? 0.6 : 1 }} disabled={enviando} onClick={enviar}>{enviando ? "Enviando…" : "Enviar pra aprovação"}</button>
        </div>
      </div>
      {minhas.map(j => (
        <div key={j.id} style={{ ...S.card, marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <b style={{ fontSize: 14 }}>{fmtDataHora(j.data)}</b><Badge st={j.status} />
          </div>
          <p style={{ fontSize: 14, color: "#C7D2E4", margin: "8px 0 0" }}>{j.texto}</p>
          {j.anexo && <div style={{ fontSize: 12, color: C.cinza, marginTop: 6 }}>📎 {j.anexo.nome}</div>}
        </div>
      ))}
    </div>
  );
}

function TelaAtestados({ user, atestados, onEnviar }) {
  const meus = atestados.filter(a => a.userId === user.id);
  const [obs, setObs] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState(null);
  const anexar = (f) => {
    if (!f || enviando) return;
    const problema = validarArquivo(f); // valida antes de ler: feedback imediato
    if (problema) { setErroEnvio(problema); return; }
    setErroEnvio(null);
    const r = new FileReader();
    r.onload = async () => {
      setEnviando(true);
      try { await onEnviar(f, obs, f.type.startsWith("image") ? r.result : null); setObs(""); }
      catch (e) { setErroEnvio(mensagemAmigavel(e, "ao enviar o arquivo")); }
      finally { setEnviando(false); }
    };
    r.readAsDataURL(f);
  };
  return (
    <div>
      <h1 style={{ ...S.display, fontSize: 26, margin: 0 }}>Atestados médicos</h1>
      <div style={{ ...S.card, marginTop: 16 }}>
        <input style={S.input} placeholder="Observação (opcional): CID, dias de afastamento…" value={obs} onChange={e => setObs(e.target.value)} />
        <label style={{ ...S.btn, display: "inline-block", marginTop: 10, cursor: "pointer", opacity: enviando ? 0.6 : 1 }}>{enviando ? "⏳ Enviando…" : "📤 Enviar atestado (foto ou PDF)"}
          <input type="file" accept="image/*,.pdf" style={{ display: "none" }} onChange={e => anexar(e.target.files[0])} />
          {erroEnvio && <p role="alert" style={{ fontSize: 13, color: C.vermelho, marginTop: 8 }}>{erroEnvio}</p>}
        </label>
        <p style={{ fontSize: 12, color: C.cinza, marginTop: 10 }}>Dado de saúde = dado sensível (LGPD art. 5º, II). O arquivo sobe pro bucket privado "anexos" do Supabase Storage — leitura restrita ao dono e ao gestor pelas policies; o caminho fica gravado no registro.</p>
      </div>
      {meus.map(a => (
        <div key={a.id} style={{ ...S.card, marginTop: 12, display: "flex", gap: 14, alignItems: "center" }}>
          {a.preview ? <img src={a.preview} alt="" style={{ width: 70, height: 70, objectFit: "cover", borderRadius: 8 }} /> : <div style={{ fontSize: 34 }}>📄</div>}
          <div style={{ flex: 1 }}>
            <b style={{ fontSize: 14 }}>{a.nome}</b>
            <div style={{ fontSize: 12, color: C.cinza }}>{fmtDataHora(a.data)} {a.obs && `· ${a.obs}`}</div>
          </div>
          <Badge st={a.status} />
        </div>
      ))}
    </div>
  );
}

function TelaFerias({ user, ferias, agendarFerias }) {
  const [inicio, setInicio] = useState("");
  const [dias, setDias] = useState(30);
  const [msg, setMsg] = useState(null);
  const minhas = ferias.filter(f => f.userId === user.id);
  const adm = dataLocal(user.admissao);
  const elegivel = new Date() >= addMeses(adm, 12);
  return (
    <div>
      <h1 style={{ ...S.display, fontSize: 26, margin: 0 }}>Agendamento de férias</h1>
      <div style={{ ...S.card, marginTop: 16 }}>
        <div style={{ fontSize: 14, color: C.cinza }}>Admissão: <b style={{ color: C.branco }}>{fmtData(user.admissao)}</b> · {elegivel ? <span style={{ color: C.verde }}>✔ período aquisitivo completo</span> : <span style={{ color: C.vermelho }}>✖ ainda no período aquisitivo (12 meses)</span>}</div>
        <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <input type="date" style={{ ...S.input, width: 190 }} value={inicio} onChange={e => setInicio(e.target.value)} />
          <select style={{ ...S.input, width: 150 }} value={dias} onChange={e => setDias(e.target.value)}>
            <option value={30}>30 dias</option><option value={20}>20 dias</option><option value={15}>15 dias</option><option value={10}>10 dias</option>
          </select>
          <button style={S.btn} onClick={() => { if (!inicio) return; setMsg(agendarFerias(inicio, dias)); }}>Solicitar</button>
        </div>
        {msg && <p style={{ marginTop: 12, fontSize: 14, color: msg.ok ? C.verde : C.vermelho }}>{msg.msg}</p>}
        <p style={{ fontSize: 12, color: C.cinza, marginTop: 10 }}>Regras: 12 meses de casa pra liberar (CLT art. 130) + antecedência mínima de <b style={{ color: C.branco }}>5 meses</b> contada dia a dia a partir de hoje (política interna da Renovar Tech — o mínimo legal é 30 dias, CLT art. 135, mas a regra interna é mais restritiva e prevalece). <b style={{ color: C.branco }}>Fracionamento validado pelo sistema</b> (CLT art. 134 §1º): no máximo 3 períodos por ciclo aquisitivo, um deles com 14+ dias corridos e os demais com 5+ dias cada, somando até 30 dias.</p>
      </div>
      {minhas.map(f => (
        <div key={f.id} style={{ ...S.card, marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div><b>{fmtData(f.inicio + "T00:00:00")}</b> · {f.dias} dias</div><Badge st={f.status} />
        </div>
      ))}
    </div>
  );
}

function TelaGame({ user, registros, faltas, rankingUsuarios = [] }) {
  const g = useMemo(() => calcularGamificacao(user.id, registros, faltas), [user, registros, faltas]);
  const badges = useMemo(() => calcularBadges(g), [g]);
  const nv = nivelDe(g.total);
  const proximoMarco = Object.keys(GAME.marcosStreak).map(Number).find(m => m > g.streak);
  // Ranking da equipe — pontos/streak vêm da view pública (gamificacao_estado sincronizado),
  // pois o RLS não deixa o colaborador recalcular pelas marcações dos colegas.
  // Exceção: a linha do próprio usuário usa o cálculo ao vivo (mais fresco que o estado sincronizado).
  const ranking = useMemo(() => rankingUsuarios
    .filter(u => u.papel !== "gestor")
    .map(u => {
      const pontos = u.id === user.id ? g.total : u.pontos;
      const streak = u.id === user.id ? g.streak : u.streak;
      return { id: u.id, nome: u.nome, pontos, streak, nv: nivelDe(pontos) };
    })
    .sort((a, b) => b.pontos - a.pontos), [rankingUsuarios, user, g]);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ ...S.display, fontSize: 26, margin: 0 }}>Gamificação</h1>
      {ranking.length > 0 && (
        <div style={{ ...S.card, marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
            <div style={{ ...S.display, fontSize: 15, color: C.amarelo }}>🏆 Ranking da equipe</div>
            <div style={{ fontSize: 11, color: C.cinza }}>competição saudável · reconhecimento interno · sem impacto salarial</div>
          </div>
          {ranking.map((r, i) => {
            const eu = r.id === user.id;
            return (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, borderTop: "1px solid #1E3450", padding: "9px 0", background: eu ? "#12233B" : "transparent", borderRadius: eu ? 8 : 0, paddingLeft: eu ? 8 : 0, paddingRight: eu ? 8 : 0 }}>
                <div style={{ ...S.display, fontSize: 18, width: 34, color: i === 0 ? C.amarelo : C.cinza }}>{i === 0 ? "🏆" : `${i + 1}º`}</div>
                <div style={{ fontSize: 22 }}>{r.nv.atual.icone}</div>
                <div style={{ flex: 1 }}>
                  <b style={{ fontSize: 14 }}>{r.nome}{eu ? " (você)" : ""}</b>
                  <div style={{ fontSize: 11, color: C.cinza }}>{r.nv.atual.nome}{r.streak >= 3 ? ` · 🔥 ${r.streak} dias` : ""}</div>
                  <div style={{ background: "#1E3450", borderRadius: 999, height: 5, marginTop: 4, maxWidth: 260, overflow: "hidden" }}>
                    <div style={{ width: `${Math.min(100, r.nv.progresso * 100)}%`, background: r.nv.atual.cor, height: "100%" }} />
                  </div>
                </div>
                <b style={{ ...S.display, fontSize: 18, color: C.amarelo }}>{r.pontos} pts</b>
              </div>
            );
          })}
          <div style={{ fontSize: 10, color: C.cinza, marginTop: 10 }}>Todos os colaboradores veem este ranking. É reconhecimento interno e motivacional — não afeta salário, Prêmio Performance ou avaliação formal.</div>
        </div>
      )}
        <span style={S.tag(C.grafite, C.cinza)}>🎖 Reconhecimento interno · sem impacto salarial</span>
      </div>
      <div style={{ ...S.card, marginTop: 16, borderLeft: `4px solid ${nv.atual.cor}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ fontSize: 46 }}>{nv.atual.icone}</div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ ...S.display, fontSize: 20 }}>Nível <span style={{ color: nv.atual.cor }}>{nv.atual.nome}</span></div>
            <div style={{ background: "#1E3450", borderRadius: 999, height: 12, marginTop: 8, overflow: "hidden" }}>
              <div style={{ width: `${Math.min(100, nv.progresso * 100)}%`, background: `linear-gradient(90deg, ${nv.atual.cor}, ${nv.proximo ? nv.proximo.cor : nv.atual.cor})`, height: "100%", transition: "width .5s" }} />
            </div>
            <div style={{ fontSize: 12, color: C.cinza, marginTop: 6 }}>
              {nv.proximo
                ? <>Faltam <b style={{ color: C.branco }}>{nv.faltam} pts</b> pro nível {nv.proximo.icone} {nv.proximo.nome} ({nv.proximo.min} pts)</>
                : <>Nível máximo alcançado — referência da equipe 💎</>}
            </div>
          </div>
          <div style={{ fontSize: 11, color: C.cinza, textAlign: "right" }}>
            {NIVEIS.map(n => <div key={n.nome} style={{ color: n.nome === nv.atual.nome ? n.cor : C.cinza, fontWeight: n.nome === nv.atual.nome ? 700 : 400 }}>{n.icone} {n.nome} · {n.min}+ pts</div>)}
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 14, marginTop: 14 }}>
        <div style={{ ...S.card, textAlign: "center", padding: 24 }}>
          <div style={{ fontSize: 12, color: C.cinza, ...S.display }}>Total acumulado</div>
          <div style={{ ...S.display, fontSize: 52, color: C.amarelo, lineHeight: 1.1 }}>{g.total}</div>
          <div style={{ fontSize: 12, color: C.cinza }}>pts</div>
        </div>
        <div style={{ ...S.card, textAlign: "center", padding: 24 }}>
          <div style={{ fontSize: 12, color: C.cinza, ...S.display }}>Sequência atual</div>
          <div style={{ ...S.display, fontSize: 52, color: g.streak >= 3 ? C.vermelho : C.branco, lineHeight: 1.1 }}>{g.streak >= 3 ? "🔥" : ""}{g.streak}</div>
          <div style={{ fontSize: 12, color: C.cinza }}>{proximoMarco ? `próximo marco: ${proximoMarco} dias (+${GAME.marcosStreak[proximoMarco]} pts)` : "todos os marcos batidos 🏅"}</div>
        </div>
        <div style={{ ...S.card, textAlign: "center", padding: 24 }}>
          <div style={{ fontSize: 12, color: C.cinza, ...S.display }}>Melhor sequência</div>
          <div style={{ ...S.display, fontSize: 52, color: C.branco, lineHeight: 1.1 }}>{g.melhorStreak}</div>
          <div style={{ fontSize: 12, color: C.cinza }}>dias pontuais seguidos</div>
        </div>
      </div>
      <div style={{ ...S.card, marginTop: 14 }}>
        <div style={{ ...S.display, fontSize: 15, color: C.amarelo }}>Extrato de pontos</div>
        {g.linhas.map((l, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #1E3450", padding: "9px 0", fontSize: 14 }}>
            <span style={{ color: "#C7D2E4" }}>{l.label}</span>
            <b style={{ color: l.pts > 0 ? (l.projetado ? C.amarelo : C.verde) : C.cinza }}>{l.pts > 0 ? `+${l.pts}` : "—"}</b>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", borderTop: `2px solid ${C.amarelo}`, padding: "9px 0", fontSize: 15 }}>
          <b>Total</b><b style={{ color: C.amarelo }}>{g.total} pts</b>
        </div>
      </div>
      <div style={{ ...S.card, marginTop: 14 }}>
        <div style={{ ...S.display, fontSize: 15, color: C.amarelo }}>Conquistas · {badges.filter(b => b.conquistada).length}/{badges.length}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10, marginTop: 12 }}>
          {badges.filter(b => b.conquistada).map(b => (
            <div key={b.id} title={b.desc} style={{ background: C.grafite, border: `1px solid ${C.amarelo}`, borderRadius: 12, padding: 12, textAlign: "center" }}>
              <div style={{ fontSize: 30 }}>{b.icone}</div>
              <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>{b.nome}</div>
              <div style={{ fontSize: 11, color: C.cinza, marginTop: 2 }}>{b.desc}</div>
            </div>
          ))}
          {badges.filter(b => b.conquistada).length === 0 && <p style={{ fontSize: 13, color: C.cinza }}>Nenhuma conquista ainda — a primeira batida de ponto já destrava a primeira. 🌱</p>}
        </div>
        {badges.some(b => !b.conquistada) && <>
          <div style={{ ...S.display, fontSize: 13, color: C.cinza, marginTop: 16 }}>Próximas conquistas</div>
          {badges.filter(b => !b.conquistada).sort((a, b) => b.pct - a.pct).map(b => (
            <div key={b.id} style={{ display: "flex", gap: 12, alignItems: "center", borderTop: "1px solid #1E3450", padding: "10px 0" }}>
              <div style={{ fontSize: 26, filter: "grayscale(1)", opacity: 0.6 }}>{b.icone}</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <b>{b.nome}</b>
                  <span style={{ color: C.cinza }}>{b.alvo > 1 ? `${Math.min(b.valor, b.alvo)}/${b.alvo}` : `${Math.round(b.pct * 100)}%`}</span>
                </div>
                <div style={{ fontSize: 11, color: C.cinza }}>{b.desc}</div>
                <div style={{ background: "#1E3450", borderRadius: 999, height: 6, marginTop: 5, overflow: "hidden" }}>
                  <div style={{ width: `${b.pct * 100}%`, background: b.pct >= 0.7 ? C.amarelo : "#555", height: "100%" }} />
                </div>
              </div>
            </div>
          ))}
        </>}
      </div>
      <div style={{ ...S.card, marginTop: 14, fontSize: 12, color: C.cinza, lineHeight: 1.7 }}>
        <b style={{ color: C.branco }}>Como pontuar:</b> entrada dentro da tolerância vale {GAME.ptsDiaPontual} pts/dia; a partir do 3º dia pontual seguido cada dia vale +{GAME.ptsBonusStreak} de bônus; marcos de sequência pagam extra (5 dias +30 · 10 dias +75 · 20 dias +200); mês sem falta injustificada vale +{GAME.ptsMesSemFalta}; e fechar o mês dentro da meta de assiduidade (mesmos critérios do Prêmio Performance) vale +{GAME.ptsMetaAssiduidade}. Atraso ou falta injustificada zera a sequência — mas nunca desconta pontos já ganhos. Faltas justificadas, atestados aceitos e ausências legais não zeram a sequência nem afetam sua pontuação.
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #1E3450" }}>
          <b style={{ color: C.branco }}>🎖 Natureza da gamificação:</b> pontos, níveis, sequências e conquistas são <b style={{ color: C.branco }}>exclusivamente ferramenta motivacional e de reconhecimento interno</b>. Não constituem verba salarial, prêmio, comissão ou benefício de qualquer natureza; não geram direito adquirido, expectativa de remuneração, promoção, cargo ou obrigação contratual; e não são critério de avaliação de desempenho formal. Não confundir com o <b style={{ color: C.branco }}>Prêmio Performance</b> (aba 🏆 Prêmio), que é o benefício financeiro real, regido por regulamento próprio nos termos do art. 457, §4º, da CLT. A empresa pode ajustar ou descontinuar a gamificação a qualquer momento, sem reflexo em salário ou contrato.
        </div>
      </div>
    </div>
  );
}

function TelaBanco({ user, registros, faltas, folgas, onSolicitar }) {
  const sb = useMemo(() => saldoBanco(user.id, registros, faltas, folgas), [user, registros, faltas, folgas]);
  const minhas = folgas.filter(f => f.userId === user.id);
  const pendentesMin = minhas.filter(f => f.status === "pendente").reduce((s, f) => s + f.horas * 60, 0);
  const [horas, setHoras] = useState(8);
  const [dataFolga, setDataFolga] = useState("");
  const [msg, setMsg] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const solicitar = async () => {
    if (enviando) return;
    setEnviando(true); setMsg(null);
    try { await onSolicitar(horas, dataFolga); setMsg({ ok: true, txt: "Solicitação enviada pra aprovação do gestor." }); setDataFolga(""); }
    catch (e) { setMsg({ ok: false, txt: mensagemAmigavel(e) }); }
    finally { setEnviando(false); }
  };
  return (
    <div>
      <h1 style={{ ...S.display, fontSize: 26, margin: 0 }}>Banco de horas</h1>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginTop: 16 }}>
        {[["Apurado nas marcações", sb.apurado, C.branco], ["Debitado em folgas", -sb.debitado, C.cinza], ["Disponível", sb.disponivel, sb.disponivel >= 0 ? C.verde : C.vermelho]].map(([l, v, cor]) => (
          <div key={l} style={{ ...S.card, textAlign: "center", padding: 20 }}>
            <div style={{ ...S.display, fontSize: 30, color: cor }}>{hmm(v)}</div>
            <div style={{ fontSize: 12, color: C.cinza, marginTop: 4 }}>{l}</div>
          </div>
        ))}
      </div>
      <div style={{ ...S.card, marginTop: 14 }}>
        <div style={{ ...S.display, fontSize: 15, color: C.amarelo }}>Converter horas extras em folga</div>
        <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input type="number" min="1" step="0.5" aria-label="Quantidade de horas a converter em folga" style={{ ...S.input, width: 110 }} value={horas} onChange={e => setHoras(e.target.value)} />
          <span style={{ fontSize: 12, color: C.cinza }}>horas na folga de</span>
          <input type="date" aria-label="Data pretendida da folga" style={{ ...S.input, width: 180 }} value={dataFolga} onChange={e => setDataFolga(e.target.value)} />
          <button style={{ ...S.btn, opacity: enviando ? 0.6 : 1 }} disabled={enviando} onClick={solicitar}>{enviando ? "Enviando…" : "Solicitar folga"}</button>
        </div>
        {pendentesMin > 0 && <p style={{ fontSize: 12, color: C.cinza, marginTop: 8 }}>Você já tem {hmm(pendentesMin)} em solicitações pendentes — elas contam contra o disponível pra novas solicitações.</p>}
        {msg && <p style={{ fontSize: 13, color: msg.ok ? C.verde : C.vermelho, marginTop: 8 }}>{msg.txt}</p>}
        <p style={{ fontSize: 11, color: C.cinza, marginTop: 8 }}>A conversão só é efetivada com a aprovação do gestor — aí as horas são debitadas do seu banco. Dica: um dia inteiro de folga = 8 horas (a jornada produtiva). Base legal: compensação do banco de horas por acordo individual escrito, CLT art. 59 §§ 5º-6º.</p>
      </div>
      {minhas.map(f => (
        <div key={f.id} style={{ ...S.card, marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 14 }}><b>{hmm(f.horas * 60)}</b> · folga em <b>{fmtData(f.dataFolga + "T00:00:00")}</b>{f.decididoEm ? ` · decidido em ${fmtData(f.decididoEm)}` : ""}</div>
          <Badge st={f.status} />
        </div>
      ))}
    </div>
  );
}

function TelaPremio({ user, registros, faltas }) {
  const e = useMemo(() => elegibilidadePremio(user.id, registros, faltas), [user, registros, faltas]);
  return (
    <div>
      <h1 style={{ ...S.display, fontSize: 26, margin: 0 }}>Prêmio Performance</h1>
      <div style={{ ...S.card, marginTop: 16, borderLeft: `4px solid ${e.elegivel ? C.verde : C.vermelho}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div>
            <div style={{ ...S.display, fontSize: 18 }}>Status do mês: {e.elegivel ? <span style={{ color: C.verde }}>ELEGÍVEL ✔</span> : <span style={{ color: C.vermelho }}>NÃO ELEGÍVEL ⛔</span>}</div>
            <div style={{ fontSize: 13, color: C.cinza, marginTop: 4 }}>
              {e.elegivel
                ? (e.bonusPontualidade ? "Zero atrasos até aqui — você está a caminho do bônus de +10% por pontualidade perfeita. 🏆" : "Mantenha os medidores abaixo dos limites até o fechamento do mês.")
                : "Os critérios de elegibilidade do prêmio deste mês não foram atendidos. O prêmio volta a valer normalmente no próximo mês — nada é descontado do seu salário."}
            </div>
          </div>
        </div>
        {e.medidores.map(m => <MedidorPremio key={m.id} m={m} />)}
      </div>
      <div style={{ ...S.card, marginTop: 14 }}>
        <div style={{ ...S.display, fontSize: 15, color: C.amarelo }}>Regras de elegibilidade — resumo</div>
        {REGRAS_PREMIO.map(r => (
          <div key={r.id} style={{ borderTop: "1px solid #1E3450", padding: "10px 0" }}>
            <b style={{ fontSize: 14 }}>{r.corte ? "🎯" : "➕"} {r.titulo}</b>
            <p style={{ fontSize: 13, color: "#C7D2E4", margin: "4px 0 0" }}>{r.desc}</p>
          </div>
        ))}
      </div>
      <div style={{ ...S.card, marginTop: 14, fontSize: 12, color: C.cinza, lineHeight: 1.7 }}>
        <b style={{ color: C.branco }}>Natureza jurídica do Prêmio Performance:</b> liberalidade concedida pela {EMPRESA.nome} em razão de desempenho superior ao ordinariamente esperado, nos termos do art. 457, §4º, da CLT. Não integra o salário, não constitui comissão contratual e sua não concessão por critério de elegibilidade <b style={{ color: C.branco }}>não é desconto salarial</b> (art. 462). Critérios objetivos, prospectivos e divulgados antecipadamente neste painel. Faltas justificadas, atestados aceitos e ausências legais do art. 473 da CLT não afetam a elegibilidade. Regulamento completo disponível com o RH.
      </div>
    </div>
  );
}

function TelaFeedback({ user, registros, faltas }) {
  const { analise, feedbacks } = useMemo(() => gerarFeedback(user, registros, faltas), [user, registros, faltas]);
  return (
    <div>
      <h1 style={{ ...S.display, fontSize: 26, margin: 0 }}>Meu feedback</h1>
      <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
        {[["Dias", analise.diasTrab], ["Atrasos", analise.atrasos], ["Faltas", analise.faltas], ["Banco", hmm(analise.saldoMin)]].map(([l, v]) => (
          <div key={l} style={{ ...S.card, flex: 1, textAlign: "center", padding: 14 }}>
            <div style={{ ...S.display, fontSize: 24, color: C.amarelo }}>{v}</div>
            <div style={{ fontSize: 12, color: C.cinza }}>{l}</div>
          </div>
        ))}
      </div>
      {feedbacks.map((f, i) => (
        <div key={i} style={{ ...S.card, marginTop: 14, borderLeft: `4px solid ${f.tipo === "elogio" ? C.verde : f.tipo === "alerta" ? C.vermelho : C.amarelo}` }}>
          <div style={{ ...S.display, fontSize: 16 }}>{f.titulo}</div>
          <p style={{ fontSize: 14, color: "#C7D2E4", marginTop: 6 }}>{f.msg}</p>
          <RecCard rec={f.rec} />
        </div>
      ))}
    </div>
  );
}

function GateConsentimentoLGPD({ user, onAceitar, onSair }) {
  const [lido, setLido] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const aceitar = async () => { setEnviando(true); try { await onAceitar(); } finally { setEnviando(false); } };
  return (
    <div style={{ ...S.app, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ ...S.card, maxWidth: 560, width: "100%" }}>
        <div style={{ ...S.display, fontSize: 22, color: C.amarelo }}>🔐 Consentimento de dados — LGPD</div>
        <p style={{ fontSize: 13, color: C.branco, marginTop: 6 }}>Olá, {user.nome.split(" ")[0]}. Antes de usar o ponto eletrônico, precisamos do seu consentimento livre e informado (Lei 13.709/2018).</p>
        <div style={{ background: C.grafite, borderRadius: 10, padding: 16, marginTop: 12, fontSize: 13, lineHeight: 1.6, maxHeight: 320, overflowY: "auto" }}>
          <b style={{ color: C.amarelo }}>O que coletamos ao bater ponto:</b>
          <ul style={{ margin: "6px 0 12px", paddingLeft: 18, color: C.branco }}>
            <li><b>Confirmação de identidade pela biometria do seu próprio celular</b> (Face ID ou impressão digital). A checagem é feita <b>localmente pelo aparelho</b>: sua face e sua digital <b>nunca saem do sensor do celular</b> — a empresa <b>não recebe nem armazena</b> imagem facial nem impressão digital. Guardamos apenas o identificador público da credencial e a confirmação de que o aparelho autenticou você.</li>
            <li><b>Geolocalização</b> (latitude/longitude) — pra confirmar que a batida ocorreu no local de trabalho autorizado (cerca geográfica).</li>
            <li><b>Data, hora e sequência (NSR)</b> de cada marcação — exigência da Portaria MTP 671/2021.</li>
          </ul>
          <b style={{ color: C.amarelo }}>Finalidade:</b> registro eletrônico de jornada, apuração de horas, banco de horas, folha e cumprimento de obrigações trabalhistas. Não vendemos nem compartilhamos seus dados com terceiros para fins de marketing.
          <br /><br />
          <b style={{ color: C.amarelo }}>Por quanto tempo guardamos:</b> os registros de ponto por <b>5 anos</b> (prazo legal); a <b>credencial biométrica</b> (identificador público, sem imagem) enquanto durar o vínculo ou até você removê-la na aba 🔐 LGPD. A geolocalização fica vinculada só à marcação correspondente.
          <br /><br />
          <b style={{ color: C.amarelo }}>Seus direitos:</b> você pode revogar este consentimento a qualquer momento na aba 🔐 LGPD (a revogação impede novas batidas pelo app, mas não apaga registros já exigidos por lei). Encarregado de dados (DPO): <b>dpo@renovartech.com.br</b>.
          <br /><br />
          <span style={{ color: C.cinza, fontSize: 12 }}>{EMPRESA.nome} · CNPJ {EMPRESA.cnpj} · {EMPRESA.endereco}</span>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={lido} onChange={e => setLido(e.target.checked)} style={{ width: 18, height: 18 }} />
          Li e entendi as informações acima sobre verificação por biometria do meu aparelho, geolocalização, finalidade e prazo de guarda.
        </label>
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button style={{ ...S.btn, flex: 1, opacity: lido && !enviando ? 1 : 0.5 }} disabled={!lido || enviando} onClick={aceitar}>{enviando ? "Registrando…" : "Li e concordo"}</button>
          <button style={{ ...S.btnGhost, padding: "10px 16px" }} onClick={onSair} disabled={enviando}>Sair</button>
        </div>
        <p style={{ fontSize: 11, color: C.cinza, marginTop: 10 }}>Ao clicar em "Li e concordo", seu aceite é registrado com data e hora no sistema. Sem o consentimento não é possível bater ponto pelo app.</p>
      </div>
    </div>
  );
}

function SecaoBiometria({ credenciais, onCadastrar, onRemover }) {
  const [rotulo, setRotulo] = useState("");
  const [msg, setMsg] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [plataforma, setPlataforma] = useState(null);
  const diag = bioDiagnostico();
  useEffect(() => { bioPlataformaDisponivel().then(setPlataforma); }, []);
  const cadastrar = async () => {
    setOcupado(true); setMsg(null);
    try { await onCadastrar(rotulo.trim()); setRotulo(""); setMsg({ ok: true, txt: "Biometria configurada! A partir de agora suas batidas pedem Face ID/digital." }); }
    catch (e) { setMsg({ ok: false, txt: e.name === "NotAllowedError" ? "Cadastro cancelado ou tempo esgotado. Tente de novo." : mensagemAmigavel(e) }); }
    finally { setOcupado(false); }
  };
  return (
    <div style={{ ...S.card, marginTop: 14 }}>
      <div style={{ ...S.display, fontSize: 15, color: C.amarelo }}>🔐 Biometria do seu aparelho (Face ID / digital)</div>
      <p style={{ fontSize: 12.5, color: C.branco, marginTop: 8, lineHeight: 1.6 }}>
        Configure uma vez por aparelho. A checagem é feita <b>pelo próprio celular</b>: sua face ou digital <b>nunca sai do sensor</b> e a empresa não recebe nem armazena imagem alguma — só a confirmação criptográfica de que o aparelho autenticou você, que é <b>conferida no servidor</b> a cada batida.
      </p>
      {!diag.ok && <p style={{ fontSize: 12.5, color: C.vermelho, marginTop: 10, lineHeight: 1.55 }}>⚠️ {diag.msg}</p>}
      {diag.ok && plataforma === false && <p style={{ fontSize: 12, color: C.cinza, marginTop: 10 }}>ℹ️ Este aparelho não reportou um sensor biométrico interno disponível. O cadastro pode falhar ou pedir outro método (PIN do aparelho, chave de segurança).</p>}
      {credenciais.length > 0 && credenciais.map(c => (
        <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #1E3450", padding: "9px 0", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13 }}>✅ <b>{c.dispositivo || "Aparelho"}</b> <span style={{ color: C.cinza, fontSize: 11 }}>· cadastrado em {fmtData(c.criadoEm)}{c.ultimoUso ? ` · último uso ${fmtData(c.ultimoUso)}` : ""}</span></span>
          <button style={{ ...S.btnGhost, borderColor: C.vermelho, color: C.vermelho, padding: "5px 12px", fontSize: 12 }} aria-label="Remover credencial biométrica deste aparelho" onClick={() => onRemover(c.id)}>Remover</button>
        </div>
      ))}
      {diag.ok && (
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
          <input style={{ ...S.input, width: 220 }} placeholder="Nome do aparelho (ex: meu iPhone)" value={rotulo} onChange={e => setRotulo(e.target.value)} />
          <button style={{ ...S.btn, padding: "9px 16px", fontSize: 13, opacity: ocupado ? 0.6 : 1 }} disabled={ocupado} onClick={cadastrar}>
            {ocupado ? "⏳ Aguardando o aparelho…" : credenciais.length ? "Cadastrar outro aparelho" : "Configurar biometria"}
          </button>
        </div>
      )}
      {msg && <p style={{ fontSize: 13, color: msg.ok ? C.verde : C.vermelho, marginTop: 10, lineHeight: 1.5 }}>{msg.txt}</p>}
      <p style={{ fontSize: 11, color: C.cinza, marginTop: 10, lineHeight: 1.5 }}>
        Trocou de celular? Cadastre o novo aparelho e remova o antigo. Sem biometria configurada você ainda consegue bater ponto, mas a marcação fica sinalizada como "sem verificação" pro gestor.
      </p>
    </div>
  );
}

function TelaLGPD({ user, onConsentir, credenciais = [], onCadastrarBio, onRemoverBio }) {
  const [aceito, setAceito] = useState(user.consentimentoLGPD);
  useEffect(() => setAceito(user.consentimentoLGPD), [user.consentimentoLGPD]);
  return (
    <div>
      <h1 style={{ ...S.display, fontSize: 26, margin: 0 }}>Privacidade e LGPD</h1>
      <div style={{ ...S.card, marginTop: 16, fontSize: 14, lineHeight: 1.8, color: "#C7D2E4" }}>
        <b style={{ color: C.branco }}>Termo de consentimento — tratamento de dados pessoais</b>
        <p>O PONTO RENOVAR coleta, com a finalidade específica de controle de jornada (Portaria MTP 671/2021): <b>confirmação de identidade pela biometria nativa do seu aparelho</b> (Face ID/digital — processada <b>localmente pelo celular</b>; a empresa <b>não recebe nem armazena</b> imagem facial ou impressão digital, apenas o identificador público da credencial e a confirmação da autenticação); <b>geolocalização</b> da marcação; e registros de horários. Os dados são usados exclusivamente pra validação de identidade, apuração de jornada e obrigações legais trabalhistas. Retenção: registros de ponto por no mínimo 5 anos; credenciais biométricas enquanto durar o vínculo ou até você removê-las. Você pode solicitar acesso, correção ou exclusão (quando não houver obrigação legal de guarda) ao encarregado de dados (DPO): dpo@renovartech.com.br.</p>
        <label style={{ display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={aceito} onChange={e => { setAceito(e.target.checked); onConsentir(e.target.checked); }} />
          <span>Li e <b style={{ color: C.amarelo }}>consinto</b> com o tratamento descrito acima.</span>
        </label>
      </div>
      <SecaoBiometria credenciais={credenciais} onCadastrar={onCadastrarBio} onRemover={onRemoverBio} />
    </div>
  );
}

function SecaoEquipe({ usuarios, convites, onCriarConvite, onSalvarUsuario, gestorId }) {
  const [form, setForm] = useState({ nome: "", email: "", cargo: "", tipo: "colaborador", dataAdmissao: "" });
  const [linkGerado, setLinkGerado] = useState(null);
  const [msg, setMsg] = useState(null);
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState(null); // { id, nome, cargo, tipo }
  const linkDe = (tk) => `${window.location.origin}${window.location.pathname}?convite=${tk}`;
  const copiar = async (txt) => { try { await navigator.clipboard.writeText(txt); setMsg({ ok: true, txt: "Link copiado! Compartilhe com o colaborador." }); } catch { setMsg({ ok: false, txt: "Não deu pra copiar automático — selecione o link e copie manual." }); } };
  const criar = async () => {
    if (!form.nome.trim() || !/.+@.+\..+/.test(form.email) || !form.dataAdmissao || criando) { setMsg({ ok: false, txt: "Preencha nome, e-mail válido e a data de admissão (obrigatória)." }); return; }
    setCriando(true); setMsg(null);
    try { const c = await onCriarConvite(form); setLinkGerado(linkDe(c.token)); setForm({ nome: "", email: "", cargo: "", tipo: "colaborador", dataAdmissao: "" }); }
    catch (e) { setMsg({ ok: false, txt: mensagemAmigavel(e) }); }
    finally { setCriando(false); }
  };
  const salvarEdicao = async () => {
    if (!editando.admissao) { setMsg({ ok: false, txt: "A data de admissão é obrigatória." }); return; }
    try { await onSalvarUsuario(editando.id, { nome: editando.nome, cargo: editando.cargo, tipo: editando.tipo, data_admissao: editando.admissao, salario_bruto: +editando.salario || 0, vale_transporte_ativo: !!editando.vtAtivo, vale_transporte_valor_mensal: +editando.vtValor || 0, dependentes_irrf: +editando.dependentes || 0 }); setEditando(null); }
    catch (e) { setMsg({ ok: false, txt: mensagemAmigavel(e) }); }
  };
  const statusConvite = (c) => c.usado ? ["USADO", "#2A4568", "#C7D2E4"] : new Date(c.expiraEm) < new Date() ? ["EXPIRADO", C.vermelho, "#fff"] : ["PENDENTE", C.amarelo, "#111"];
  return (
    <div style={{ ...S.card, marginTop: 14 }}>
      <div style={{ ...S.display, fontSize: 15, color: C.cinza }}>👥 Equipe — colaboradores e convites</div>

      {usuarios.map(u => (
        <div key={u.id} style={{ borderTop: "1px solid #1E3450", padding: "9px 0" }}>
          {editando?.id === u.id ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input style={{ ...S.input, width: 180 }} value={editando.nome} onChange={e => setEditando({ ...editando, nome: e.target.value })} />
              <input style={{ ...S.input, width: 150 }} placeholder="Cargo" value={editando.cargo || ""} onChange={e => setEditando({ ...editando, cargo: e.target.value })} />
              <select style={{ ...S.input, width: 140 }} value={editando.tipo} onChange={e => setEditando({ ...editando, tipo: e.target.value })} disabled={u.id === gestorId}>
                <option value="colaborador">Colaborador</option><option value="gestor">Gestor</option>
              </select>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.cinza }}>Admissão
                <input type="date" style={{ ...S.input, width: 160 }} value={editando.admissao || ""} onChange={e => setEditando({ ...editando, admissao: e.target.value })} />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.cinza }}>Salário bruto R$
                <input type="number" min="0" step="0.01" style={{ ...S.input, width: 130 }} value={editando.salario} onChange={e => setEditando({ ...editando, salario: e.target.value })} />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.cinza }}>
                <input type="checkbox" checked={!!editando.vtAtivo} onChange={e => setEditando({ ...editando, vtAtivo: e.target.checked })} /> VT
              </label>
              {editando.vtAtivo && <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.cinza }}>VT mensal R$
                <input type="number" min="0" step="0.01" style={{ ...S.input, width: 110 }} value={editando.vtValor} onChange={e => setEditando({ ...editando, vtValor: e.target.value })} />
              </label>}
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.cinza }}>Dep. IRRF
                <input type="number" min="0" step="1" style={{ ...S.input, width: 70 }} value={editando.dependentes} onChange={e => setEditando({ ...editando, dependentes: e.target.value })} />
              </label>
              <button style={{ ...S.btn, padding: "8px 14px", fontSize: 13 }} onClick={salvarEdicao}>Salvar</button>
              <button style={{ ...S.btnGhost, padding: "8px 14px", fontSize: 13 }} onClick={() => setEditando(null)}>Cancelar</button>
            </div>
          ) : (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div style={{ fontSize: 14, opacity: u.ativo === false ? 0.45 : 1 }}>
                <b>{u.nome}</b> <span style={{ color: C.cinza, fontSize: 12 }}>· {u.email}{u.cargo ? ` · ${u.cargo}` : ""} · {u.papel === "gestor" ? "Gestor" : "Colaborador"} · admissão {fmtData((u.admissao || "").slice(0, 10)) || "—"}</span>
              </div>
              <span style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                {u.ativo === false ? <span style={S.tag("#1A2F4A", "#C7D2E4")}>INATIVO</span> : <span style={S.tag(C.verde, "#fff")}>ATIVO</span>}
                <button style={{ ...S.btnGhost, padding: "6px 12px", fontSize: 12 }} onClick={() => setEditando({ id: u.id, nome: u.nome, cargo: u.cargo, tipo: u.papel, admissao: (u.admissao || "").slice(0, 10), salario: u.salario || 0, vtAtivo: !!u.vtAtivo, vtValor: u.vtValor || 0, dependentes: u.dependentes || 0 })}>Editar</button>
                {u.id !== gestorId && (u.ativo === false
                  ? <button style={{ ...S.btnGhost, borderColor: C.verde, color: C.verde, padding: "6px 12px", fontSize: 12 }} onClick={() => onSalvarUsuario(u.id, { ativo: true })}>Reativar</button>
                  : <button style={{ ...S.btnGhost, borderColor: C.vermelho, color: C.vermelho, padding: "6px 12px", fontSize: 12 }} onClick={() => onSalvarUsuario(u.id, { ativo: false })}>Desativar</button>)}
              </span>
            </div>
          )}
        </div>
      ))}

      <div style={{ ...S.display, fontSize: 13, color: C.amarelo, marginTop: 16 }}>➕ Convidar novo colaborador</div>
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <input style={{ ...S.input, width: 170 }} placeholder="Nome completo" value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} />
        <input style={{ ...S.input, width: 210 }} placeholder="email@renovartech.com.br" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
        <input style={{ ...S.input, width: 140 }} placeholder="Cargo" value={form.cargo} onChange={e => setForm({ ...form, cargo: e.target.value })} />
        <select style={{ ...S.input, width: 140 }} value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}>
          <option value="colaborador">Colaborador</option><option value="gestor">Gestor</option>
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.cinza }}>Admissão*
          <input type="date" style={{ ...S.input, width: 160 }} value={form.dataAdmissao} onChange={e => setForm({ ...form, dataAdmissao: e.target.value })} />
        </label>
        <button style={{ ...S.btn, opacity: criando ? 0.6 : 1 }} disabled={criando} onClick={criar}>{criando ? "Gerando…" : "Gerar convite"}</button>
      </div>
      {linkGerado && (
        <div style={{ background: C.grafite, borderRadius: 10, padding: 12, marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <code style={{ fontSize: 12, color: C.amarelo, wordBreak: "break-all", flex: 1 }}>{linkGerado}</code>
          <button style={{ ...S.btnGhost, padding: "6px 12px", fontSize: 12 }} onClick={() => copiar(linkGerado)}>📋 Copiar link</button>
        </div>
      )}
      {msg && <p style={{ fontSize: 13, color: msg.ok ? C.verde : C.vermelho, marginTop: 8 }}>{msg.txt}</p>}
      {convites.length > 0 && <>
        <div style={{ ...S.display, fontSize: 13, color: C.cinza, marginTop: 14 }}>Convites emitidos</div>
        {convites.map(c => {
          const [tx, bg, fg] = statusConvite(c);
          return (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #1E3450", padding: "7px 0", gap: 10 }}>
              <div style={{ fontSize: 13 }}><b>{c.nome}</b> <span style={{ color: C.cinza, fontSize: 12 }}>· {c.email} · {c.tipo}{c.dataAdmissao ? ` · admissão ${fmtData(c.dataAdmissao)}` : ""} · expira {fmtData(c.expiraEm)}</span></div>
              <span style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                <span style={S.tag(bg, fg)}>{tx}</span>
                {tx === "PENDENTE" && <button style={{ ...S.btnGhost, padding: "5px 10px", fontSize: 12 }} onClick={() => copiar(linkDe(c.token))}>📋 Link</button>}
              </span>
            </div>
          );
        })}
      </>}
      <p style={{ fontSize: 11, color: C.cinza, marginTop: 10 }}>Desativar bloqueia o login (o app checa ativo=false), mas a conta de autenticação permanece — exclusão definitiva exigiria a service_role key, que jamais vai pro client. Convites expiram em 7 dias e são de uso único (resgate atômico via function no banco).</p>
    </div>
  );
}

function SecaoFolgas({ folgas, usuarios, registros, faltas, onDecidir }) {
  const nome = (id) => usuarios.find(u => u.id === id)?.nome || id;
  const pendentes = folgas.filter(f => f.status === "pendente");
  const decididas = folgas.filter(f => f.status !== "pendente").slice(0, 8);
  return (
    <div style={{ ...S.card, marginTop: 14 }}>
      <div style={{ ...S.display, fontSize: 15, color: C.cinza }}>⏳ Banco de horas — solicitações de folga</div>
      {pendentes.length === 0 && <p style={{ fontSize: 13, color: C.cinza }}>Nenhuma solicitação pendente.</p>}
      {pendentes.map(f => {
        const sb = saldoBanco(f.userId, registros, faltas, folgas);
        const cabe = f.horas * 60 <= sb.disponivel;
        return (
          <div key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #1E3450", padding: "8px 0", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 14 }}>
              <b>{nome(f.userId)}</b> — {hmm(f.horas * 60)} em {fmtData(f.dataFolga + "T00:00:00")}
              <span style={{ fontSize: 12, color: cabe ? C.verde : C.vermelho }}> · saldo disponível: {hmm(sb.disponivel)}{cabe ? "" : " ⚠ insuficiente"}</span>
            </div>
            <span style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <button style={{ ...S.btnGhost, borderColor: C.verde, color: C.verde, padding: "6px 12px", fontSize: 12, opacity: cabe ? 1 : 0.5 }} onClick={() => onDecidir(f.id, true)}>Aprovar e debitar</button>
              <button style={{ ...S.btnGhost, borderColor: C.vermelho, color: C.vermelho, padding: "6px 12px", fontSize: 12 }} onClick={() => onDecidir(f.id, false)}>Rejeitar</button>
            </span>
          </div>
        );
      })}
      {decididas.length > 0 && decididas.map(f => (
        <div key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #1A2F4A", padding: "6px 0", gap: 10, opacity: 0.6 }}>
          <div style={{ fontSize: 13 }}>{nome(f.userId)} — {hmm(f.horas * 60)} em {fmtData(f.dataFolga + "T00:00:00")}</div>
          <Badge st={f.status} />
        </div>
      ))}
    </div>
  );
}

function ModalConfirm({ titulo, texto, rotuloOk = "Confirmar", onConfirmar, onCancelar, ocupado }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(4,10,18,0.78)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }} onClick={e => { if (e.target === e.currentTarget && !ocupado) onCancelar(); }}>
      <div style={{ ...S.card, maxWidth: 460, width: "100%", borderLeft: `4px solid ${C.amarelo}` }}>
        <div style={{ ...S.display, fontSize: 16, color: C.amarelo }}>{titulo}</div>
        <p style={{ fontSize: 13, color: C.branco, marginTop: 10, lineHeight: 1.55 }}>{texto}</p>
        <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end" }}>
          <button style={{ ...S.btnGhost, padding: "9px 16px", fontSize: 13 }} onClick={onCancelar} disabled={ocupado}>Cancelar</button>
          <button style={{ ...S.btn, padding: "9px 16px", fontSize: 13, opacity: ocupado ? 0.6 : 1 }} onClick={onConfirmar} disabled={ocupado}>{ocupado ? "⏳ Processando…" : rotuloOk}</button>
        </div>
      </div>
    </div>
  );
}

/* Ações administrativas sensíveis: gravadas com auditoria CRÍTICA (aguardada, com retry e
   falha visível) e destacadas na trilha. São as que mexem em dinheiro, acesso ou registro de jornada. */
const ACOES_SENSIVEIS = ["cadastro_alterado", "convite_criado", "folha_gerada", "folha_ajustada", "folha_fechada",
  "adiantamento_criado", "adiantamento_cancelado", "guia_paga", "saida_auto_corrigida", "saida_auto",
  "aprovacao", "folga_decidida", "local_criado", "local_desativado", "biometria", "batida_sem_localizacao"];

const AVISO_FOLHA = "⚠️ Conferência gerencial: cálculo com as tabelas 2026 (INSS Portaria MPS/MF · IRRF Lei 15.270/2025). Não substitui a folha oficial do contador (eSocial, guias e obrigações acessórias).";

function SecaoFolha({ usuarios, folhasPg, adiantamentos, guias, onGerarFolha, onEditarFolha, onFecharFolha, onMarcarGuiaPaga, onCriarAdiant, onCancelarAdiant }) {
  const hoje = new Date();
  const [comp, setComp] = useState(`${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`);
  const compData = comp + "-01";
  const [msg, setMsg] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [editRow, setEditRow] = useState(null); // { id, faltas, atrasos, inss, irrf, vt, adiantamento }
  const [confirmandoFechar, setConfirmandoFechar] = useState(false);
  const [adForm, setAdForm] = useState({ userId: "", valor: "", competenciaDesconto: "", observacao: "" });
  const nome = (id) => usuarios.find(u => u.id === id)?.nome || id;
  const doMes = folhasPg.filter(f => f.competencia === compData).sort((a, b) => nome(a.userId).localeCompare(nome(b.userId)));
  const temRascunho = doMes.some(f => f.status === "rascunho");
  const guiasMes = guias.filter(g => g.competencia === compData);
  const rodar = async (fn, okMsg) => {
    if (ocupado) return;
    setOcupado(true); setMsg(null);
    try { const r = await fn(); setMsg({ ok: true, txt: typeof okMsg === "function" ? okMsg(r) : okMsg }); }
    catch (e) { setMsg({ ok: false, txt: mensagemAmigavel(e) }); }
    finally { setOcupado(false); }
  };
  const salvarEdit = () => rodar(async () => {
    await onEditarFolha(editRow.id, { faltas: +editRow.faltas || 0, atrasos: +editRow.atrasos || 0, inss: +editRow.inss || 0, irrf: +editRow.irrf || 0, vt: +editRow.vt || 0, adiantamento: +editRow.adiantamento || 0 });
    setEditRow(null);
  }, "Rascunho ajustado.");
  return (
    <div style={{ ...S.card, marginTop: 14 }}>
      <div style={{ ...S.display, fontSize: 15, color: C.cinza }}>💰 Folha de pagamento</div>
      <p style={{ fontSize: 11, color: C.cinza, margin: "6px 0 0" }}>{AVISO_FOLHA}</p>
      <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input type="month" aria-label="Competência da folha (mês/ano)" style={{ ...S.input, width: 170 }} value={comp} onChange={e => setComp(e.target.value)} />
        <button style={{ ...S.btn, padding: "8px 14px", fontSize: 13, opacity: ocupado ? 0.6 : 1 }} disabled={ocupado} onClick={() => rodar(() => onGerarFolha(compData), n => `Rascunho gerado pra ${n} colaborador(es). Confira e feche quando estiver certo.`)}>{ocupado ? "⏳…" : "Gerar folha (rascunho)"}</button>
        {temRascunho && <button style={{ ...S.btnGhost, borderColor: C.verde, color: C.verde, padding: "8px 14px", fontSize: 13 }} disabled={ocupado} onClick={() => setConfirmandoFechar(true)}>Fechar folha ✓</button>}
      </div>
      {msg && <p style={{ fontSize: 13, color: msg.ok ? C.verde : C.vermelho, marginTop: 8 }}>{msg.txt}</p>}
      {confirmandoFechar && (
        <ModalConfirm
          titulo={`Fechar a folha de ${comp}?`}
          texto="Isso trava os valores, marca os adiantamentos como descontados e gera as guias fiscais."
          rotuloOk="Fechar folha ✓"
          ocupado={ocupado}
          onCancelar={() => setConfirmandoFechar(false)}
          onConfirmar={async () => { await rodar(() => onFecharFolha(compData), "Folha fechada e guias geradas."); setConfirmandoFechar(false); }}
        />
      )}
      {doMes.length > 0 && (
        <div className="rolagem-x" style={{ marginTop: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr style={{ color: C.cinza, textAlign: "right" }}>
              <th style={{ textAlign: "left", padding: 6 }}>Colaborador</th><th>Bruto</th><th>Faltas</th><th>Atrasos</th><th>INSS</th><th>IRRF</th><th>VT</th><th>Adiant.</th><th>Líquido</th><th></th>
            </tr></thead>
            <tbody>
              {doMes.map(f => (
                <tr key={f.id} style={{ borderTop: "1px solid #1E3450", textAlign: "right" }}>
                  <td style={{ textAlign: "left", padding: 6, fontWeight: 700 }}>{nome(f.userId)} {f.status === "fechada" ? <span style={S.tag("#123B24", C.verde)}>FECHADA</span> : <span style={S.tag("#3A2A08", C.amarelo)}>RASCUNHO</span>}</td>
                  {editRow?.id === f.id ? (
                    <>
                      <td>{brl(f.salario)}</td>
                      {["faltas", "atrasos", "inss", "irrf", "vt", "adiantamento"].map(k => (
                        <td key={k}><input type="number" step="0.01" style={{ ...S.input, width: 84, padding: 6, fontSize: 12 }} value={editRow[k]} onChange={e => setEditRow({ ...editRow, [k]: e.target.value })} /></td>
                      ))}
                      <td style={{ fontWeight: 700 }}>{brl((f.salario) - ["faltas", "atrasos", "inss", "irrf", "vt", "adiantamento"].reduce((s, k) => s + (+editRow[k] || 0), 0))}</td>
                      <td style={{ whiteSpace: "nowrap" }}><button style={{ ...S.btn, padding: "4px 10px", fontSize: 11 }} onClick={salvarEdit}>Salvar</button> <button style={{ ...S.btnGhost, padding: "4px 8px", fontSize: 11 }} onClick={() => setEditRow(null)}>✕</button></td>
                    </>
                  ) : (
                    <>
                      <td>{brl(f.salario)}</td>
                      <td title={`${f.diasFaltas} dia(s) + DSR`}>{brl(f.faltas)}</td>
                      <td title={`${f.horasAtraso}h além da tolerância`}>{brl(f.atrasos)}</td>
                      <td>{brl(f.inss)}</td><td>{brl(f.irrf)}</td><td>{brl(f.vt)}</td><td>{brl(f.adiantamento)}</td>
                      <td style={{ fontWeight: 700, color: C.verde }}>{brl(f.liquido)}</td>
                      <td>{f.status === "rascunho" && <button style={{ ...S.btnGhost, padding: "4px 10px", fontSize: 11 }} onClick={() => setEditRow({ id: f.id, faltas: f.faltas, atrasos: f.atrasos, inss: f.inss, irrf: f.irrf, vt: f.vt, adiantamento: f.adiantamento })}>✎</button>}</td>
                    </>
                  )}
                </tr>
              ))}
              <tr style={{ borderTop: "2px solid #2A4568", textAlign: "right", fontWeight: 700 }}>
                <td style={{ textAlign: "left", padding: 6 }}>TOTAIS</td>
                <td>{brl(doMes.reduce((s, f) => s + f.salario, 0))}</td>
                <td>{brl(doMes.reduce((s, f) => s + f.faltas, 0))}</td>
                <td>{brl(doMes.reduce((s, f) => s + f.atrasos, 0))}</td>
                <td>{brl(doMes.reduce((s, f) => s + f.inss, 0))}</td>
                <td>{brl(doMes.reduce((s, f) => s + f.irrf, 0))}</td>
                <td>{brl(doMes.reduce((s, f) => s + f.vt, 0))}</td>
                <td>{brl(doMes.reduce((s, f) => s + f.adiantamento, 0))}</td>
                <td style={{ color: C.verde }}>{brl(doMes.reduce((s, f) => s + f.liquido, 0))}</td><td></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {guiasMes.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ ...S.display, fontSize: 13, color: C.cinza }}>Guias fiscais de {comp}</div>
          {guiasMes.map(g => (
            <div key={g.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #1E3450", padding: "7px 0", fontSize: 13 }}>
              <span><b>{g.tipo}</b> · {brl(g.valor)} · vence {fmtData(g.vencimento)}</span>
              {g.status === "paga" ? <span style={S.tag("#123B24", C.verde)}>PAGA</span> : <button style={{ ...S.btnGhost, borderColor: C.verde, color: C.verde, padding: "5px 12px", fontSize: 12 }} onClick={() => rodar(() => onMarcarGuiaPaga(g.id), "Guia marcada como paga.")}>Marcar paga</button>}
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: 14, borderTop: "1px solid #1E3450", paddingTop: 10 }}>
        <div style={{ ...S.display, fontSize: 13, color: C.cinza }}>Adiantamentos salariais</div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select style={{ ...S.input, width: 180 }} value={adForm.userId} onChange={e => setAdForm({ ...adForm, userId: e.target.value })}>
            <option value="">Colaborador…</option>
            {usuarios.filter(u => u.ativo !== false).map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
          <input type="number" min="0" step="0.01" placeholder="Valor R$" style={{ ...S.input, width: 110 }} value={adForm.valor} onChange={e => setAdForm({ ...adForm, valor: e.target.value })} />
          <input type="month" style={{ ...S.input, width: 160 }} value={adForm.competenciaDesconto} onChange={e => setAdForm({ ...adForm, competenciaDesconto: e.target.value })} title="Competência do desconto" />
          <input placeholder="Observação" style={{ ...S.input, width: 180 }} value={adForm.observacao} onChange={e => setAdForm({ ...adForm, observacao: e.target.value })} />
          <button style={{ ...S.btn, padding: "8px 14px", fontSize: 13 }} disabled={ocupado} onClick={() => rodar(async () => { if (!adForm.userId) throw new Error("Escolha o colaborador."); await onCriarAdiant({ ...adForm, competenciaDesconto: adForm.competenciaDesconto ? adForm.competenciaDesconto + "-01" : "" }); setAdForm({ userId: "", valor: "", competenciaDesconto: "", observacao: "" }); }, "Adiantamento registrado — será descontado na folha da competência.")}>Registrar</button>
        </div>
        {adiantamentos.slice(0, 8).map(a => (
          <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #1A2F4A", padding: "6px 0", fontSize: 12 }}>
            <span>{nome(a.userId)} · {brl(a.valor)} · desconto em {a.competenciaDesconto.slice(0, 7)}{a.observacao ? ` · ${a.observacao}` : ""}</span>
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Badge st={a.status} />
              {a.status === "pendente" && <button style={{ ...S.btnGhost, borderColor: C.vermelho, color: C.vermelho, padding: "4px 10px", fontSize: 11 }} onClick={() => rodar(() => onCancelarAdiant(a.id), "Adiantamento cancelado.")}>Cancelar</button>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TelaHolerite({ user, folhasPg, adiantamentos }) {
  const minhas = [...folhasPg].sort((a, b) => b.competencia.localeCompare(a.competencia));
  return (
    <div>
      <h1 style={{ ...S.display, fontSize: 26, margin: 0 }}>Holerite</h1>
      <p style={{ fontSize: 11, color: C.cinza, marginTop: 6 }}>{AVISO_FOLHA}</p>
      {minhas.length === 0 && <div style={{ ...S.card, marginTop: 14, fontSize: 13, color: C.cinza }}>Nenhuma folha gerada ainda. O gestor gera a folha no fim de cada mês.</div>}
      {minhas.map(f => (
        <div key={f.id} style={{ ...S.card, marginTop: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ ...S.display, fontSize: 16, color: C.amarelo }}>{EMPRESA.nome} · competência {f.competencia.slice(0, 7)}</div>
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {f.status === "fechada" ? <span style={S.tag("#123B24", C.verde)}>FECHADA</span> : <span style={S.tag("#3A2A08", C.amarelo)}>RASCUNHO — sujeito a ajustes</span>}
              <button style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 12 }} onClick={() => window.print()}>🖨 Imprimir</button>
            </span>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 10 }}>
            <tbody>
              {[["Salário bruto", f.salario, C.branco],
                [`Desconto faltas (${f.diasFaltas} dia(s) + DSR)`, -f.faltas],
                [`Desconto atrasos (${f.horasAtraso}h)`, -f.atrasos],
                ["INSS", -f.inss], ["IRRF", -f.irrf], ["Vale-transporte", -f.vt], ["Adiantamento", -f.adiantamento]]
                .filter(([, v]) => v !== 0)
                .map(([l, v, cor]) => (
                  <tr key={l} style={{ borderTop: "1px solid #1A2F4A" }}>
                    <td style={{ padding: 6 }}>{l}</td>
                    <td style={{ padding: 6, textAlign: "right", color: cor || (v < 0 ? C.vermelho : C.branco) }}>{brl(v)}</td>
                  </tr>
                ))}
              <tr style={{ borderTop: "2px solid #2A4568", fontWeight: 700 }}>
                <td style={{ padding: 6 }}>LÍQUIDO A RECEBER</td>
                <td style={{ padding: 6, textAlign: "right", color: C.verde, fontSize: 16 }}>{brl(f.liquido)}</td>
              </tr>
            </tbody>
          </table>
          <p style={{ fontSize: 10, color: C.cinza, marginTop: 8 }}>{EMPRESA.nome} · CNPJ {EMPRESA.cnpj} · {EMPRESA.endereco}</p>
        </div>
      ))}
      {adiantamentos.some(a => a.status === "pendente") && (
        <div style={{ ...S.card, marginTop: 14, fontSize: 13 }}>
          <b>Adiantamentos pendentes:</b> {adiantamentos.filter(a => a.status === "pendente").map(a => `${brl(a.valor)} (desconto em ${a.competenciaDesconto.slice(0, 7)})`).join(" · ")}
        </div>
      )}
    </div>
  );
}

function SecaoLocais({ locais, onCriar, onDesativar }) {
  const [nome, setNome] = useState("");
  const [raio, setRaio] = useState(50);
  const [capturando, setCapturando] = useState(false);
  const [msg, setMsg] = useState(null);
  const salvar = async () => {
    if (!nome.trim() || capturando) return;
    setCapturando(true); setMsg(null);
    try {
      const precisao = await onCriar(nome, raio);
      setMsg({ ok: true, txt: `Local "${nome}" salvo com sua posição atual (precisão do GPS na captura: ±${precisao}m).` });
      setNome(""); setRaio(50);
    } catch (e) { setMsg({ ok: false, txt: mensagemAmigavel(e) }); }
    finally { setCapturando(false); }
  };
  return (
    <div style={{ ...S.card, marginTop: 14 }}>
      <div style={{ ...S.display, fontSize: 15, color: C.cinza }}>📍 Local de trabalho (restrição de raio nas batidas)</div>
      <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input style={{ ...S.input, width: 220 }} placeholder="Nome do local (ex: Oficina BH)" value={nome} onChange={e => setNome(e.target.value)} />
        <input type="number" min="10" style={{ ...S.input, width: 110 }} value={raio} onChange={e => setRaio(e.target.value)} title="Raio em metros" />
        <span style={{ fontSize: 12, color: C.cinza }}>metros</span>
        <button style={{ ...S.btn, opacity: capturando ? 0.6 : 1 }} disabled={capturando} onClick={salvar}>
          {capturando ? "📡 Capturando posição…" : "📍 Capturar minha posição e salvar"}
        </button>
      </div>
      {msg && <p style={{ fontSize: 13, color: msg.ok ? C.verde : C.vermelho, marginTop: 8 }}>{msg.txt}</p>}
      <p style={{ fontSize: 11, color: C.cinza, marginTop: 8 }}>Sem nenhum local ativo, as batidas ficam liberadas sem verificação. Dica: cadastre estando dentro do local e considere a precisão do GPS ao definir o raio (50 m cobre bem a maioria dos casos urbanos).</p>
      {locais.length > 0 && locais.map(l => (
        <div key={l.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #1E3450", padding: "8px 0", gap: 10 }}>
          <div style={{ fontSize: 14, opacity: l.ativo ? 1 : 0.45 }}>
            <b>{l.nome}</b> <span style={{ color: C.cinza, fontSize: 12 }}>· {(+l.latitude).toFixed(5)}, {(+l.longitude).toFixed(5)} · raio {l.raio} m</span>
          </div>
          <span style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
            {l.ativo ? <span style={S.tag(C.verde, "#fff")}>ATIVO</span> : <span style={S.tag("#1A2F4A", "#C7D2E4")}>INATIVO</span>}
            {l.ativo && <button style={{ ...S.btnGhost, borderColor: C.vermelho, color: C.vermelho, padding: "6px 12px", fontSize: 12 }} onClick={() => onDesativar(l.id)}>Desativar</button>}
          </span>
        </div>
      ))}
    </div>
  );
}

function TelaGestor({ usuarios, registros, faltas, justificativas, atestados, ferias, logs, decidir, locais, onCriarLocal, onDesativarLocal, convites, onCriarConvite, onSalvarUsuario, gestorId, folgas, onDecidirFolga, folhasPg, adiantamentos, guias, onGerarFolha, onEditarFolha, onFecharFolha, onMarcarGuiaPaga, onCriarAdiant, onCancelarAdiant }) {
  const equipe = usuarios.map(u => ({ u, a: analisarAssiduidade(u.id, registros, faltas) }));
  const ranking = usuarios
    .map(u => ({ u, g: calcularGamificacao(u.id, registros, faltas) }))
    .map(x => ({ ...x, nv: nivelDe(x.g.total) }))
    .sort((a, b) => b.g.total - a.g.total);
  const pend = justificativas.filter(j => j.status === "pendente").length + atestados.filter(a => a.status === "pendente").length + ferias.filter(f => f.status === "pendente").length + folgas.filter(f => f.status === "pendente").length;
  const nome = (id) => usuarios.find(u => u.id === id)?.nome || id;
  const [filtroAcao, setFiltroAcao] = useState("");
  const [filtroAutor, setFiltroAutor] = useState("");
  const [buscaLog, setBuscaLog] = useState("");
  const acoesDisponiveis = useMemo(() => [...new Set(logs.map(l => l.acao))].sort(), [logs]);
  const logsFiltrados = useMemo(() => logs.filter(l =>
    (!filtroAcao || (filtroAcao === "__sensiveis" ? ACOES_SENSIVEIS.includes(l.acao) : l.acao === filtroAcao))
    && (!filtroAutor || l.userId === filtroAutor)
    && (!buscaLog || `${l.acao} ${l.detalhe} ${nome(l.userId)}`.toLowerCase().includes(buscaLog.toLowerCase()))
  ), [logs, filtroAcao, filtroAutor, buscaLog, usuarios]);
  return (
    <div>
      <h1 style={{ ...S.display, fontSize: 26, margin: 0 }}>Painel do gestor {pend > 0 && <span style={S.tag(C.vermelho, "#fff")}>{pend} pendência(s)</span>}</h1>
      {(() => {
        const afetados = usuarios.filter(u => u.papel !== "gestor").map(u => ({ u, imp: impactoMudancaIntervalo(u.id, registros) })).filter(x => x.imp.diasAfetados > 0);
        if (!afetados.length) return null;
        return (
          <div style={{ ...S.card, marginTop: 14, borderLeft: `4px solid ${C.vermelho}`, padding: 14 }}>
            <div style={{ ...S.display, fontSize: 14, color: C.vermelho }}>📌 Revisão necessária: regra de intervalo corrigida</div>
            <p style={{ fontSize: 12.5, color: C.branco, margin: "8px 0 0", lineHeight: 1.6 }}>
              Até {fmtData(MUDANCA_INTERVALO.data)} o sistema descontava <b>2 horas</b> de intervalo por dia; o intervalo real da empresa é de <b>1 hora</b>.
              O banco de horas é recalculado ao vivo, então os saldos <b>já estão corrigidos</b> — mas isso significa que os valores exibidos antes dessa data estavam <b>menores</b> que o devido.
              Confira se alguma decisão tomada com o saldo antigo (folga negada, hora extra não paga) precisa ser revista.
            </p>
            <div style={{ marginTop: 10 }}>
              {afetados.map(({ u, imp }) => (
                <div key={u.id} style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #1E3450", padding: "6px 0", fontSize: 13, gap: 10, flexWrap: "wrap" }}>
                  <span><b>{u.nome}</b> <span style={{ color: C.cinza, fontSize: 12 }}>· {imp.diasAfetados} dia(s) afetado(s)</span></span>
                  <span style={{ color: C.verde, fontWeight: 700 }}>+{hmm(imp.minutosDiferenca)} a mais no saldo</span>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 11, color: C.cinza, marginTop: 10, lineHeight: 1.5 }}>
              Só entram nesta conta os dias em que o colaborador bateu <b>um único par</b> de marcações (sem registrar a saída/volta do almoço) — nos demais o desconto de intervalo não era aplicado, então nada muda.
            </p>
          </div>
        );
      })()}
      <div style={{ ...S.card, marginTop: 14, borderLeft: `4px solid ${C.amarelo}`, padding: 14 }}>
        <div style={{ ...S.display, fontSize: 14, color: C.amarelo }}>⚠️ Como funcionam os lembretes e a saída automática</div>
        <p style={{ fontSize: 12.5, color: C.branco, margin: "8px 0 0", lineHeight: 1.6 }}>
          Este app roda 100% no navegador do colaborador, <b>sem servidor próprio rodando o tempo todo</b>. Por isso:
        </p>
        <ul style={{ fontSize: 12.5, color: C.branco, margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
          <li><b>Jornada efetiva de 9h/dia:</b> com presença das 8h às 18h e 1 hora de intervalo, sobram <b>9 horas trabalhadas</b>, enquanto a jornada normal da CLT é de 8h. A diferença vira crédito no banco de horas todo dia útil. Se a intenção for jornada de 8h, o expediente precisaria terminar às 17h — fale comigo pra ajustar.</li>
          <li><b>Lembretes de bater ponto (8h/9h e almoço):</b> só disparam <b>enquanto o colaborador estiver com o app aberto</b> no navegador. Se o app estiver fechado no horário, o lembrete daquele momento não aparece (e não vira notificação push de celular).</li>
          <li><b>Batida automática de saída (fecha o dia às 18h/13h se esqueceram de bater):</b> depende de uma rotina agendada <b>no banco de dados (Supabase/pg_cron)</b>, que roda independente do navegador. Se esse agendamento estiver ativo no backend, funciona sozinho; se não, a saída não será preenchida automaticamente. Confirme com quem administra o banco se o agendamento das 23h está ligado.</li>
        </ul>
        <p style={{ fontSize: 11.5, color: C.cinza, margin: "8px 0 0" }}>Recomendação: oriente a equipe a manter o app aberto durante o expediente pra receber os lembretes, e trate-os como apoio — a responsabilidade de bater o ponto é sempre do colaborador.</p>
      </div>
      <div style={{ ...S.card, marginTop: 14, borderLeft: `4px solid ${C.amarelo}`, padding: 14 }}>
        <div style={{ ...S.display, fontSize: 14, color: C.amarelo }}>⚠️ O que a biometria do celular comprova (e o que NÃO comprova)</div>
        <p style={{ fontSize: 12.5, color: C.branco, margin: "8px 0 0", lineHeight: 1.6 }}>
          A verificação usa <b>WebAuthn</b> com o Face ID / digital do aparelho do colaborador. É importante entender o alcance real dessa tecnologia:
        </p>
        <ul style={{ fontSize: 12.5, color: C.branco, margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
          <li><b>O que comprova:</b> que quem bateu o ponto <b>tem o aparelho cadastrado em mãos</b> e passou pela checagem biométrica configurada <b>naquele aparelho</b>.</li>
          <li><b>O que NÃO comprova:</b> não é reconhecimento facial contra uma foto de referência da empresa. O celular apenas responde "a biometria cadastrada neste aparelho foi reconhecida" — então <b>qualquer pessoa cujo rosto ou digital esteja cadastrado naquele celular</b> (um familiar no Face ID alternativo, uma digital adicional) <b>conseguiria bater o ponto</b>. O sistema não distingue.</li>
          <li><b>Validação criptográfica: feita no servidor ✔</b> — a assinatura devolvida pelo aparelho é conferida por uma função no servidor (Supabase Edge Function) antes de a marcação ser gravada: desafio de uso único gerado no backend (impede replay), conferência de origem e domínio, exigência do flag de verificação biométrica, validação da assinatura contra a chave pública cadastrada e checagem do contador do autenticador (detecta clonagem de credencial).</li>
        </ul>
        <p style={{ fontSize: 11.5, color: C.cinza, margin: "8px 0 0", lineHeight: 1.5 }}>
          Como mitigar a limitação que resta: combine a biometria com a <b>cerca geográfica</b> (já ativa) e oriente a equipe a não cadastrar terceiros no Face ID/digital do aparelho usado pro ponto — de preferência, registre isso no regulamento interno. Marcações feitas <b>sem</b> verificação biométrica aparecem sinalizadas no espelho e na trilha de auditoria.
        </p>
      </div>
      <div style={{ ...S.card, marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
          <div style={{ ...S.display, fontSize: 15, color: C.cinza }}>🎮 Ranking de gamificação</div>
          <div style={{ fontSize: 11, color: C.cinza }}>🎖 reconhecimento interno · somente leitura · sem impacto salarial, no Prêmio Performance ou em avaliação formal</div>
        </div>
        {ranking.map((r, i) => (
          <div key={r.u.id} style={{ display: "flex", alignItems: "center", gap: 12, borderTop: "1px solid #1E3450", padding: "9px 0" }}>
            <div style={{ ...S.display, fontSize: 18, width: 34, color: i === 0 ? C.amarelo : C.cinza }}>{i === 0 ? "🏆" : `${i + 1}º`}</div>
            <div style={{ fontSize: 22 }}>{r.nv.atual.icone}</div>
            <div style={{ flex: 1 }}>
              <b style={{ fontSize: 14 }}>{r.u.nome}</b>
              <div style={{ fontSize: 11, color: C.cinza }}>{r.nv.atual.nome}{r.g.streak >= 3 ? ` · 🔥 streak de ${r.g.streak} dias` : ""}</div>
              <div style={{ background: "#1E3450", borderRadius: 999, height: 5, marginTop: 4, maxWidth: 260, overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, r.nv.progresso * 100)}%`, background: r.nv.atual.cor, height: "100%" }} />
              </div>
            </div>
            <b style={{ ...S.display, fontSize: 18, color: C.amarelo }}>{r.g.total} pts</b>
          </div>
        ))}
      </div>
      <div style={{ ...S.card, marginTop: 16 }}>
        <div style={{ ...S.display, fontSize: 15, color: C.cinza }}>Equipe — assiduidade (últimos 10 dias)</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, marginTop: 8 }}>
          <thead><tr style={{ color: C.cinza, textAlign: "left" }}><th style={{ padding: 6 }}>Colaborador</th><th>Dias</th><th>Atrasos</th><th>Faltas</th><th>Banco</th><th>Prêmio</th><th>Status</th></tr></thead>
          <tbody>
            {equipe.map(({ u, a }) => {
              const e = elegibilidadePremio(u.id, registros, faltas);
              return (
              <tr key={u.id} style={{ borderTop: "1px solid #1E3450" }}>
                <td style={{ padding: 6, fontWeight: 700 }}>{u.nome}</td>
                <td>{a.diasTrab}</td>
                <td style={{ color: a.atrasos >= 3 ? C.vermelho : C.branco }}>{a.atrasos}</td>
                <td style={{ color: a.faltas > 0 ? C.vermelho : C.branco }}>{a.faltas}</td>
                <td style={{ color: a.saldoMin >= 0 ? C.verde : C.vermelho }}>{hmm(a.saldoMin)}</td>
                <td>{e.elegivel ? <span style={S.tag(C.verde, "#fff")}>ELEGÍVEL{e.bonusPontualidade ? " +10%" : ""}</span> : <span style={S.tag(C.vermelho, "#fff")}>NÃO ELEGÍVEL</span>}</td>
                <td>{a.atrasos >= 3 || a.faltas > 0 ? <span style={S.tag(C.vermelho, "#fff")}>ATENÇÃO</span> : a.diasTrab === 0 ? <span style={S.tag("#1A2F4A", "#C7D2E4")}>SEM DADOS</span> : <span style={S.tag(C.verde, "#fff")}>OK</span>}</td>
              </tr>
            );})}
          </tbody>
        </table>
      </div>
      <SecaoEquipe usuarios={usuarios} convites={convites} onCriarConvite={onCriarConvite} onSalvarUsuario={onSalvarUsuario} gestorId={gestorId} />
      <SecaoFolgas folgas={folgas} usuarios={usuarios} registros={registros} faltas={faltas} onDecidir={onDecidirFolga} />
      <SecaoFolha {...{ usuarios, folhasPg, adiantamentos, guias, onGerarFolha, onEditarFolha, onFecharFolha, onMarcarGuiaPaga, onCriarAdiant, onCancelarAdiant }} />
      <SecaoLocais locais={locais} onCriar={onCriarLocal} onDesativar={onDesativarLocal} />
      {[
        ["Justificativas", justificativas, (j) => `${nome(j.userId)} — ${j.texto}`],
        ["Atestados", atestados, (a) => `${nome(a.userId)} — ${a.nome}${a.obs ? " · " + a.obs : ""}`],
        ["Férias", ferias, (f) => `${nome(f.userId)} — ${f.dias} dias a partir de ${fmtData(f.inicio + "T00:00:00")}`],
      ].map(([titulo, lista, render]) => (
        <div key={titulo} style={{ ...S.card, marginTop: 14 }}>
          <div style={{ ...S.display, fontSize: 15, color: C.cinza }}>{titulo}</div>
          {lista.length === 0 ? <p style={{ fontSize: 13, color: C.cinza }}>Nada por aqui.</p> : lista.map(item => (
            <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #1E3450", padding: "8px 0", gap: 10 }}>
              <span style={{ fontSize: 14 }}>{render(item)}</span>
              <span style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                <Badge st={item.status} />
                {item.status === "pendente" && <>
                  <button style={{ ...S.btnGhost, borderColor: C.verde, color: C.verde, padding: "6px 12px" }} onClick={() => decidir(titulo, item.id, true)}>Aprovar</button>
                  <button style={{ ...S.btnGhost, borderColor: C.vermelho, color: C.vermelho, padding: "6px 12px" }} onClick={() => decidir(titulo, item.id, false)}>Recusar</button>
                </>}
              </span>
            </div>
          ))}
        </div>
      ))}
      <div style={{ ...S.card, marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <div style={{ ...S.display, fontSize: 15, color: C.cinza }}>Trilha de auditoria</div>
          <div style={{ fontSize: 11, color: C.cinza }}>{logsFiltrados.length} de {logs.length} evento(s)</div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <select aria-label="Filtrar por tipo de ação" style={{ ...S.input, width: 200, fontSize: 12 }} value={filtroAcao} onChange={e => setFiltroAcao(e.target.value)}>
            <option value="">Todas as ações</option>
            <option value="__sensiveis">⚠ Só ações sensíveis</option>
            {acoesDisponiveis.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select aria-label="Filtrar por autor" style={{ ...S.input, width: 180, fontSize: 12 }} value={filtroAutor} onChange={e => setFiltroAutor(e.target.value)}>
            <option value="">Qualquer autor</option>
            {usuarios.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
          <input aria-label="Buscar na trilha de auditoria" placeholder="Buscar no texto…" style={{ ...S.input, flex: 1, minWidth: 160, fontSize: 12 }} value={buscaLog} onChange={e => setBuscaLog(e.target.value)} />
          <button style={{ ...S.btnGhost, padding: "8px 14px", fontSize: 12 }} onClick={() => {
            const linhas = [["data_hora", "acao", "autor", "detalhe"], ...logsFiltrados.map(l => [fmtDataHora(l.ts), l.acao, nome(l.userId), l.detalhe])];
            const csv = "\uFEFF" + linhas.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
            const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
            const a = document.createElement("a"); a.href = url; a.download = `auditoria-${hojeStr()}.csv`; a.click(); URL.revokeObjectURL(url);
          }}>⬇ Exportar CSV</button>
        </div>
        <div style={{ maxHeight: 300, overflowY: "auto", marginTop: 8 }}>
          {logsFiltrados.length === 0 && <p style={{ fontSize: 12, color: C.cinza, padding: "8px 0" }}>Nenhum evento com esses filtros.</p>}
          {logsFiltrados.map((l, i) => (
            <div key={i} style={{ fontSize: 12, color: "#B3C2DA", borderTop: "1px solid #1A2F4A", padding: "6px 0", fontFamily: "monospace", borderLeft: ACOES_SENSIVEIS.includes(l.acao) ? `3px solid ${C.amarelo}` : "none", paddingLeft: ACOES_SENSIVEIS.includes(l.acao) ? 8 : 0 }}>
              {fmtDataHora(l.ts)} · <span style={{ color: ACOES_SENSIVEIS.includes(l.acao) ? C.amarelo : C.cinza }}>{l.acao}</span> · <b>{nome(l.userId)}</b> · {l.detalhe}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
