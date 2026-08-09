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
/* Jornada contratual da Renovar Tech (confirmada pela gestão em 23/07/2026):
     seg-sex  8:00 → 18:00 com 1 hora de intervalo = 9h de trabalho por dia
     sábado   8:00 → 13:00, turno único = 5h
   Total contratual: 50h por semana.
   ⚠ NOTA JURÍDICA (para o regulamento e o advogado trabalhista): a CF/88 art. 7º XIII
   fixa o limite de 44h semanais. As 6h que excedem devem estar amparadas por acordo de
   compensação/banco de horas ou pagas como extraordinárias. O sistema apenas reflete a
   jornada informada; a validação jurídica do arranjo é externa a ele. */
const EXPEDIENTE = { entradaMin: 8 * 60, saidaMin: 18 * 60, intervaloMin: 60, toleranciaMin: 10 };
// Marco da correção: usado pra sinalizar ao gestor que saldos históricos foram recalculados.
const MUDANCA_INTERVALO = { data: "2026-07-23", de: 120, para: 60, jornadaAntiga: 8 * 60, jornadaNova: 9 * 60 };
const JORNADA_MIN = 9 * 60; // dia cheio de trabalho (usado na conversão de folga: 1 dia = 9h)
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
  // Jornada contratual de 9h/dia (decisão da empresa): presença 8h→18h menos 1h de intervalo.
  // Fechando em zero o dia normal — sem crédito nem débito automático no banco de horas.
  return { jornadaMin: 9 * 60, entradaMin: 8 * 60, saidaMin: 18 * 60, intervaloMin: EXPEDIENTE.intervaloMin, rotulo: "8:00–18:00 (9h + 1h de intervalo)" };
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
  { cod: "H0818", durMin: 540, pares: [["0800", "1200"], ["1300", "1800"]] }, // seg-sex: 9h de jornada, intervalo 12-13
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

/* Impacto histórico da correção (intervalo 2h→1h E jornada 8h→9h, aplicadas juntas):
     • dias com UM par de marcações: 600−120−480 = 0 antes; 600−60−540 = 0 agora → nada muda;
     • dias com o almoço batido (4 marcações): 540−0−480 = +60 antes; 540−0−540 = 0 agora
       → o crédito de 1h/dia que existia era indevido (a jornada real sempre foi de 9h).
   Quantificamos aqui pra o gestor revisar decisões tomadas com o saldo inflado. */
function impactoMudancaIntervalo(userId, registros) {
  const corte = new Date(MUDANCA_INTERVALO.data + "T00:00:00");
  let diasAfetados = 0, minutosDiferenca = 0;
  Object.values(agruparPorDia(registros, userId)).forEach(regs => {
    const dt = new Date(regs[0].ts);
    if (dt >= corte) return;
    const exp = expedienteDoDia(dt);
    if (exp.jornadaMin === 0 || exp.intervaloMin === 0) return; // sábado/domingo/feriado não mudaram
    const min = minutosDia(regs);
    const pares = Math.min(regs.filter(r => r.tipo === "entrada").length, regs.filter(r => r.tipo === "saida").length);
    const saldoAntigo = min - (pares <= 1 ? MUDANCA_INTERVALO.de : 0) - MUDANCA_INTERVALO.jornadaAntiga;
    const saldoNovo = min - (pares <= 1 ? MUDANCA_INTERVALO.para : 0) - exp.jornadaMin;
    const dif = saldoNovo - saldoAntigo;
    if (dif !== 0) { diasAfetados++; minutosDiferenca += dif; }
  });
  return { diasAfetados, minutosDiferenca };
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
  // Falha de ENVIO de e-mail no servidor de auth: o Supabase devolve 500/unexpected_failure,
  // a conta NAO e criada e a msg vem em ingles. Antes caia na mensagem generica e a pessoa
  // achava que era erro dela. Agora diz o que houve e quem resolve: o remetente SMTP do projeto.
  [/error sending|could not send email|gomail|smtp|verify a domain/i, "A conta não pôde ser criada porque o servidor não conseguiu enviar o e-mail de confirmação. Não é erro seu: avise o gestor pra conferir o remetente de e-mail SMTP do projeto no Supabase."],
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
  // --- estrutura do banco ---
  // Tabela que o app usa e que ainda nao existe no Supabase: PostgREST responde 404
  // com PGRST205. Antes caia na regra generica de 404 e o colaborador lia "Recurso nao
  // encontrado", sem saber o que fazer. Agora a mensagem diz o que falta e quem resolve.
  [/pgrst205|could not find the table|schema cache|42P01|relation .* does not exist/i, "Esta parte do app precisa de uma tabela que ainda não foi criada no banco. Avise o gestor: em Painel do gestor, no Diagnóstico do sistema, está o SQL pronto pra criar as tabelas que faltam."],
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
// O bucket "anexos" e privado: pra abrir um arquivo o app pede uma URL assinada,
// que vale poucos minutos. Assim o link nao pode ser repassado por engano nem
// indexado, e a leitura continua valendo as policies (dono da pasta ou gestor).
async function sbUrlAssinada(token, path, segundos = 120) {
  const r = await fetch(`${SUPA.url}/storage/v1/object/sign/anexos/${path}`, {
    method: "POST",
    headers: { apikey: SUPA.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: segundos }),
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  const d = await r.json();
  const rel = d.signedURL || d.signedUrl;
  if (!rel) throw new Error("O servidor não devolveu o link do arquivo.");
  return `${SUPA.url}/storage/v1${rel.startsWith("/") ? "" : "/"}${rel}`;
}
const sbRpc = (t, fn, args) => sbFetch(t, `/rest/v1/rpc/${fn}`, { method: "POST", body: args });
async function sbSignUp(email, password) {
  const r = await fetch(`${SUPA.url}/auth/v1/signup`, {
    method: "POST", headers: { apikey: SUPA.anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || j.msg || j.error || `Falha no cadastro (HTTP ${r.status})`);
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
    const bruto = String(e?.message || e || "");
     if (/failed to fetch|load failed|network ?error|ERR_INTERNET_DISCONNECTED|networkrequest/i.test(bruto)) {
        throw Object.assign(new Error("Sem conexão com o servidor. Verifique sua internet e tente de novo."), { motivo: "rede" });
     }
     throw Object.assign(new Error(`A verificação biométrica não pôde ser concluída. ${mensagemAmigavel(e)} [ref: ${e && e.name} - ${bruto.slice(0,140)}]`), { motivo: "erro" });
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
/* ---- Radar de conformidade da jornada -------------------------------------
   Varre as marcações e aponta os limites legais que mais geram passivo:
   interjornada de 11h (CLT art. 66), 2h de extras no dia (CLT art. 59),
   extras acima do contratual na semana (CF art. 7º XIII), intervalo
   intrajornada (CLT art. 71), 7 dias seguidos sem repouso (CLT art. 67) e
   dia sem par entrada/saída (CLT art. 74 §2º). É informativo: não bloqueia
   marcação nenhuma e não substitui a análise do contador/jurídico. */
const CONF = { interjornada: 11 * 60, extrasDia: 2 * 60, extrasSemana: 2 * 60, intervalo: 60, seguidos: 6 };
// Minutos produtivos do dia: presença menos o intervalo descontado (mesma regra do banco de horas)
function produtivasDoDia(regs, exp) {
  const pares = Math.min(regs.filter((r) => r.tipo === "entrada").length, regs.filter((r) => r.tipo === "saida").length);
  const desconto = exp.intervaloMin > 0 && pares <= 1 ? exp.intervaloMin : 0;
  return { pares, min: minutosDia(regs) - desconto };
}
function alertasConformidade(userId, registros) {
  const dias = agruparPorDia(registros, userId);
  const chaves = Object.keys(dias).sort((a, b) => new Date(dias[a][0].ts) - new Date(dias[b][0].ts));
  const alertas = [], semanas = {};
  let seq = 0, anterior = null;
  chaves.forEach((k, idx) => {
    const regs = dias[k];
    const dt = new Date(regs[0].ts);
    const exp = expedienteDoDia(dt);
    const info = produtivasDoDia(regs, exp);
    const min = info.min, iso = dataISO(dt);
    const add = (tipo, texto, base) => alertas.push({ userId, data: iso, dia: k, tipo, texto, base });
    const ent = regs.filter((r) => r.tipo === "entrada").map((r) => new Date(r.ts));
    const sai = regs.filter((r) => r.tipo === "saida").map((r) => new Date(r.ts));
    if (ent.length !== sai.length) add("marcacao", ent.length + " entrada(s) e " + sai.length + " saída(s): dia sem par completo", "CLT art. 74 §2º");
    if (exp.jornadaMin > 0 && min - exp.jornadaMin > CONF.extrasDia) add("extras", hmm(min - exp.jornadaMin) + " de horas extras no dia", "CLT art. 59: limite de 2h por dia");
    if (exp.jornadaMin === 0 && min > 0) add("repouso", hmm(min) + " trabalhados em " + String(exp.rotulo).replace(" — fechado", ""), "CLT art. 67 e 70: compensar ou pagar em dobro");
    if (info.pares >= 2 && min > 6 * 60 && ent[1] && sai[0]) {
      const pausa = Math.round((ent[1] - sai[0]) / 60000);
      if (pausa < CONF.intervalo) add("intervalo", "intervalo de " + pausa + " min em jornada de " + hmm(min), "CLT art. 71: mínimo de 1h acima de 6h");
    }
    if (idx > 0) {
      const saiAnt = dias[chaves[idx - 1]].filter((r) => r.tipo === "saida").map((r) => new Date(r.ts)).pop();
      if (saiAnt && ent[0]) {
        const descanso = Math.round((ent[0] - saiAnt) / 60000);
        if (descanso > 0 && descanso < CONF.interjornada) add("interjornada", hmm(descanso) + " entre a saída de " + chaves[idx - 1] + " e a entrada deste dia", "CLT art. 66: mínimo de 11h");
      }
    }
    const meiaNoite = new Date(iso + "T00:00:00");
    seq = anterior && Math.round((meiaNoite - anterior) / 86400000) === 1 ? seq + 1 : 1;
    anterior = meiaNoite;
    if (seq === CONF.seguidos + 1) add("repouso", seq + "º dia seguido de trabalho, sem repouso semanal", "CLT art. 67: 1 dia de descanso a cada 7");
    const sem = chaveSemana(dt);
    semanas[sem] = semanas[sem] || { min: 0, prev: 0 };
    semanas[sem].min += min;
    semanas[sem].prev += exp.jornadaMin;
  });
  Object.keys(semanas).forEach((ini) => {
    const s = semanas[ini];
    if (s.min - s.prev > CONF.extrasSemana) alertas.push({
      userId, data: ini, dia: "semana de " + fmtData(ini), tipo: "semana",
      texto: hmm(s.min - s.prev) + " além do contratual na semana (" + hmm(s.min) + " trabalhados)",
      base: "CF art. 7º XIII e CLT art. 59: banco de horas ou pagamento como extra",
    });
  });
  return alertas.sort((a, b) => (a.data < b.data ? -1 : 1));
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

/* ============================================================
RESCISAO - calculo de verbas trabalhistas (conferencia gerencial)
Base: CLT arts. 477, 478, 487; Lei 12.506/2011 (aviso proporcional);
Lei 8.036/90 art. 18 par.1 (multa FGTS 40%); CLT art. 484-A (acordo).
Aviso: calculo simplificado de apoio a decisao do gestor - nao substitui
o TRCT oficial, a homologacao (quando exigida) nem o calculo definitivo
do contador, que tem acesso ao extrato real de depositos do FGTS.
============================================================ */
const MOTIVOS_RESCISAO = {
   dispensa_sem_justa_causa: { label: "Dispensa sem justa causa", avisoDevido: true, multaFgts: 1, direitoFeriasProp: true, direito13Prop: true, saqueFgts: true, saqueFgtsPct: 1, seguroDesemprego: true },
   dispensa_com_justa_causa: { label: "Dispensa por justa causa", avisoDevido: false, multaFgts: 0, direitoFeriasProp: false, direito13Prop: false, saqueFgts: false, saqueFgtsPct: 0, seguroDesemprego: false },
   pedido_demissao: { label: "Pedido de demissao (a pedido do colaborador)", avisoDevido: false, multaFgts: 0, direitoFeriasProp: true, direito13Prop: true, saqueFgts: false, saqueFgtsPct: 0, seguroDesemprego: false },
   acordo_484a: { label: "Acordo (CLT art. 484-A)", avisoDevido: true, multaFgts: 0.5, direitoFeriasProp: true, direito13Prop: true, saqueFgts: true, saqueFgtsPct: 0.8, seguroDesemprego: false },
   termino_experiencia: { label: "Termino de contrato de experiencia", avisoDevido: false, multaFgts: 0, direitoFeriasProp: true, direito13Prop: true, saqueFgts: true, saqueFgtsPct: 1, seguroDesemprego: false },
};
function diasAvisoPrevio(mesesServico) {
   const anosCompletos = Math.floor(mesesServico / 12);
   return Math.min(90, 30 + anosCompletos * 3);
}
function mesesProporcionais(dataInicio, dataFim) {
   let meses = mesesEntre(dataInicio, dataFim);
   if (dataFim.getDate() >= 15) meses += 1;
   return Math.max(0, Math.min(12, meses));
}
function calcRescisao(u, dataDesligStr, motivoKey, avisoTipo) {
   const motivo = MOTIVOS_RESCISAO[motivoKey];
   if (!motivo) throw new Error("Motivo de desligamento invalido.");
   const sal = +u.salario || 0;
   const dataDeslig = dataLocal(dataDesligStr);
   const adm = dataLocal(u.admissao);
   const diaDeslig = dataDeslig.getDate();
   const saldoSalario = r2((sal / 30) * diaDeslig);
   const mesesServico = mesesEntre(adm, dataDeslig);
   const diasAviso = motivo.avisoDevido ? diasAvisoPrevio(mesesServico) : 0;
   const avisoIndenizado = motivo.avisoDevido && avisoTipo === "indenizado";
   const valorAviso = avisoIndenizado ? r2((sal / 30) * diasAviso) : 0;
   const mesesAnoCorrente = motivo.direito13Prop ? Math.min(12, dataDeslig.getMonth() + (diaDeslig >= 15 ? 1 : 0)) : 0;
   const decimoProp = r2((sal / 12) * mesesAnoCorrente);
   const aq = periodoAquisitivo(u.admissao, dataDesligStr);
   const mesesPeriodoAtual = motivo.direitoFeriasProp ? mesesProporcionais(aq.inicio, dataDeslig) : 0;
   const feriasProp = r2((sal / 12) * mesesPeriodoAtual);
   const tercoFeriasProp = r2(feriasProp / 3);
   const feriasVencidas = 0, tercoFeriasVencidas = 0;
   const fgtsEstimado = r2(sal * TABELAS_2026.fgtsPatronal * mesesServico);
   const multaFgts = r2(fgtsEstimado * (motivo.multaFgts || 0));
   const baseInssRescisao = r2(saldoSalario + decimoProp);
   const inssRescisao = calcINSS(baseInssRescisao);
   const irrfRescisao = calcIRRF(baseInssRescisao, inssRescisao, +u.dependentes || 0);
   const totalProventos = r2(saldoSalario + valorAviso + decimoProp + feriasProp + tercoFeriasProp + feriasVencidas + tercoFeriasVencidas + multaFgts);
   const totalDescontos = r2(inssRescisao + irrfRescisao);
   const liquido = r2(totalProventos - totalDescontos);
   return {
      motivo: motivoKey, motivoLabel: motivo.label, mesesServico, diasAviso, avisoIndenizado,
      verbas: { saldoSalario, valorAviso, decimoProp, feriasProp, tercoFeriasProp, feriasVencidas, tercoFeriasVencidas, fgtsEstimado, multaFgts, inssRescisao, irrfRescisao },
      totalProventos, totalDescontos, liquido,
      direitos: { saqueFgts: !!motivo.saqueFgts, saqueFgtsPct: motivo.saqueFgtsPct ?? (motivo.saqueFgts ? 1 : 0), seguroDesemprego: !!motivo.seguroDesemprego },
   };
}
const AVISO_RESCISAO = "Calculo de apoio a decisao gerencial (CLT arts. 477/478/487, Lei 12.506/2011, Lei 8.036/90 art. 18 par.1). Ferias vencidas nao gozadas devem ser confirmadas manualmente pelo gestor. Nao substitui o TRCT oficial, a homologacao (quando exigida) nem o calculo definitivo do contador com o extrato real do FGTS.";
/* --------- custo real da equipe: encargos e provisoes ---------
   O liquido do holerite nao e o que a empresa gasta. Alem do bruto entram FGTS,
   provisao de 13o e de ferias com 1/3 e - fora do Simples - INSS patronal, RAT
   e terceiros. O regime e escolhido na tela porque muda tudo: no Simples
   Nacional a parte patronal do INSS ja esta dentro do DAS, entao somar 20% ali
   inventaria um custo que a empresa nao tem. Numeros de apoio: quem fecha a
   apuracao e a contabilidade. */
const REGIMES_EMPRESA = {
  simples: { label: "Simples Nacional — INSS patronal já vai no DAS", inssPatronal: 0, rat: 0, terceiros: 0 },
  normal: { label: "Lucro presumido ou real — INSS patronal por fora", inssPatronal: 0.2, rat: 0.02, terceiros: 0.058 },
};
function custoDaEquipe(folhas = [], regimeKey = "simples") {
  const reg = REGIMES_EMPRESA[regimeKey] || REGIMES_EMPRESA.simples;
  const soma = (campo) => r2(folhas.reduce((s, f) => s + (+f[campo] || 0), 0));
  const bruto = soma("salario");
  const aliquotaPatronal = TABELAS_2026.fgtsPatronal + reg.inssPatronal + reg.rat + reg.terceiros;
  const fgts = r2(bruto * TABELAS_2026.fgtsPatronal);
  const inssPatronal = r2(bruto * reg.inssPatronal);
  const rat = r2(bruto * reg.rat);
  const terceiros = r2(bruto * reg.terceiros);
  const encargos = r2(fgts + inssPatronal + rat + terceiros);
  // Provisao mensal: 1/12 do bruto pro 13o, 1/12 pras ferias e 1/36 pro terco.
  const decimo = r2(bruto / 12);
  const ferias = r2(bruto / 12);
  const tercoFerias = r2(bruto / 36);
  const encargosProvisao = r2((decimo + ferias + tercoFerias) * aliquotaPatronal);
  const provisoes = r2(decimo + ferias + tercoFerias + encargosProvisao);
  return {
    pessoas: folhas.length, regime: regimeKey, regimeLabel: reg.label,
    bruto, liquido: soma("liquido"), inssRetido: soma("inss"), irrfRetido: soma("irrf"),
    fgts, inssPatronal, rat, terceiros, encargos,
    decimo, ferias, tercoFerias, encargosProvisao, provisoes,
    custoCaixa: r2(bruto + encargos), custoTotal: r2(bruto + encargos + provisoes),
  };
}
const TIPOS_EXAME = { admissional: "Admissional", periodico: "Periódico", retorno_trabalho: "Retorno ao trabalho", mudanca_funcao: "Mudança de função", demissional: "Demissional" };
const RESULTADOS_EXAME = { apto: "Apto", apto_com_restricao: "Apto com restricao", inapto: "Inapto" };
/* --------- recrutamento, documentos e agendamento de exame ---------
   Curriculo e documentos vao pro bucket privado "anexos", igual aos atestados.
   Candidato nao tem login, entao o arquivo dele fica na pasta do gestor que subiu. */
const STATUS_CANDIDATO = { recebido: "Currículo recebido", entrevista: "Em entrevista", aprovado: "Aprovado", contratado: "Contratado", reprovado: "Não seguiu" };
const ORDEM_CANDIDATO = ["recebido", "entrevista", "aprovado", "contratado", "reprovado"];
const TIPOS_DOCUMENTO = { curriculo: "Currículo", identidade: "RG ou CNH", cpf: "CPF", ctps: "Carteira de trabalho", residencia: "Comprovante de residência", contrato: "Contrato assinado", aso: "ASO do exame", dependentes: "Documento de dependente", outro: "Outro documento" };
// Pasta de admissao: o minimo que a empresa precisa guardar de cada contratacao.
const DOCS_ADMISSAO = ["identidade", "cpf", "ctps", "residencia", "contrato"];
const STATUS_EXAME = { agendado: "Agendado", realizado: "Realizado" };

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
const mapRescisao = (r) => ({ id: r.id, userId: r.usuario_id, dataDeslig: (r.data_desligamento || "").slice(0, 10), motivo: r.motivo, motivoLabel: MOTIVOS_RESCISAO[r.motivo]?.label || r.motivo, avisoTipo: r.aviso_tipo, calculo: r.calculo || null, totalProventos: +r.total_proventos || 0, totalDescontos: +r.total_descontos || 0, liquido: +r.valor_liquido || 0, status: r.status, criadoEm: r.criado_em, confirmadoEm: r.confirmado_em });
const mapExame = (r) => ({ id: r.id, userId: r.usuario_id, tipo: r.tipo, tipoLabel: TIPOS_EXAME[r.tipo] || r.tipo, data: (r.data_exame || "").slice(0, 10), resultado: r.resultado, resultadoLabel: r.resultado ? (RESULTADOS_EXAME[r.resultado] || r.resultado) : null, clinica: r.clinica, anexo: r.anexo_url ? { nome: r.anexo_url.split("/").pop().replace(/^\d+_/, ""), path: r.anexo_url } : null, observacao: r.observacao, status: r.status || "realizado", dataPrevista: (r.data_prevista || "").slice(0, 10), criadoEm: r.criado_em });
const mapGuia = (r) => ({ id: r.id, competencia: (r.competencia || "").slice(0, 10), tipo: r.tipo, valor: +r.valor_total, vencimento: r.vencimento, status: r.status, pagoEm: (r.pago_em || "").slice(0, 10), linhaDigitavel: r.linha_digitavel || "", valorPago: r.valor_pago == null ? null : +r.valor_pago, comprovante: r.comprovante_url ? { nome: r.comprovante_url.split("/").pop().replace(/^\d+_/, ""), path: r.comprovante_url } : null, observacao: r.observacao || "" });
const mapCandidato = (r) => ({ id: r.id, nome: r.nome, email: r.email || "", telefone: r.telefone || "", cargo: r.cargo || "", origem: r.origem || "", status: r.status || "recebido", statusLabel: STATUS_CANDIDATO[r.status] || r.status, curriculo: r.curriculo_url ? { nome: r.curriculo_url.split("/").pop().replace(/^\d+_/, ""), path: r.curriculo_url } : null, observacao: r.observacao || "", contratadoUserId: r.contratado_usuario_id || null, criadoEm: r.criado_em, atualizadoEm: r.atualizado_em });
const mapDocumento = (r) => ({ id: r.id, userId: r.usuario_id || null, candidatoId: r.candidato_id || null, tipo: r.tipo, tipoLabel: TIPOS_DOCUMENTO[r.tipo] || r.tipo, arquivo: { nome: r.nome_original || String(r.arquivo_url).split("/").pop().replace(/^\d+_/, ""), path: r.arquivo_url }, observacao: r.observacao || "", criadoEm: r.criado_em });

const mapConsImagem = (r) => ({ userId: r.usuario_id, cftvCiente: !!r.cftv_ciente, autorizada: !!r.imagem_autorizada, atualizadoEm: r.atualizado_em });

/* Aceites com trilha de data/hora. tipo 'conduta' -> referencia = versao do codigo;
   tipo 'espelho' -> referencia = competencia AAAA-MM. status: 'aceito' | 'contestado'. */
const mapAceite = (r) => ({ userId: r.usuario_id, tipo: r.tipo, ref: r.referencia, status: r.status, obs: r.observacao || '', em: r.criado_em });

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
/* Consentimentos de imagem no modo demonstracao: Rafael NAO autorizou - serve pra
   mostrar como o gestor enxerga quem nao pode aparecer em foto/video. */
const CONS_IMAGEM_SEED = [
  { userId: "u1", cftvCiente: true, autorizada: true, atualizadoEm: iso(d(-120)) },
  { userId: "u2", cftvCiente: true, autorizada: true, atualizadoEm: iso(d(-90)) },
  { userId: "u3", cftvCiente: true, autorizada: false, atualizadoEm: iso(d(-45)) },
];

/* Versao vigente do codigo de conduta. Se o texto mudar, subir a versao faz o app
   pedir um novo aceite - o aceite anterior continua guardado no historico. */
const CONDUTA_VERSAO = '2026.1';
const compDe = (dt) => dataISO(dt).slice(0, 7);
const compAtual = () => compDe(new Date());
const rotuloComp = (c) => { const p = String(c || '').split('-'); return p[1] ? p[1] + '/' + p[0] : String(c || ''); };

/* Modo demonstracao: Marina conferiu o espelho do mes; Rafael contestou (mostra pro
   gestor como aparece uma divergencia aberta) e Juliana ainda nao aceitou a conduta. */
const ACEITES_SEED = [
  { userId: 'u1', tipo: 'conduta', ref: CONDUTA_VERSAO, status: 'aceito', obs: '', em: iso(d(-100)) },
  { userId: 'u2', tipo: 'conduta', ref: CONDUTA_VERSAO, status: 'aceito', obs: '', em: iso(d(-80)) },
  { userId: 'u3', tipo: 'conduta', ref: CONDUTA_VERSAO, status: 'aceito', obs: '', em: iso(d(-60)) },
  { userId: 'u2', tipo: 'espelho', ref: compAtual(), status: 'aceito', obs: '', em: iso(d(-2)) },
  { userId: 'u3', tipo: 'espelho', ref: compAtual(), status: 'contestado', obs: 'A saída do dia 20 foi preenchida pelo sistema; saí às 18h20.', em: iso(d(-1)) },
];

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
  });
  if (a.faltas >= 1) fb.push({
    tipo: "alerta", tema: "produtividade", titulo: `${a.faltas} falta(s) sem justificativa no período`,
    msg: "Faltas sem justificativa impactam banco de horas e podem gerar desconto (CLT art. 473 lista as ausências legais). Se houve imprevisto, registre a justificativa ou envie atestado — o fluxo leva 2 minutos.",
  });
  if (a.atrasos === 0 && a.faltas === 0 && a.diasTrab >= 5) fb.push({
    tipo: "elogio", tema: "lideranca", titulo: "Assiduidade exemplar 🏆",
    msg: `${user.nome.split(" ")[0]}, ${a.diasTrab} dias sem nenhum atraso ou falta e saldo positivo de ${hmm(a.saldoMin)} no banco de horas. Consistência é o que separa profissionais fora da curva — continue assim.`,
  });
  if (fb.length === 0) fb.push({
    tipo: "neutro", tema: "produtividade", titulo: "Tudo em dia",
    msg: "Sem pendências relevantes no período. Continue mantendo o ritmo.",
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
/* ================== PDF de verdade, sem biblioteca externa ==================
   Monta um A4 (uma pagina por colaborador) usando as fontes base do formato
   (Helvetica/Helvetica-Bold + WinAnsiEncoding). E o mesmo desenho do recibo de
   pagamento de salario que sai dos sistemas de contabilidade: da pra imprimir,
   arquivar e mandar pro contador sem depender de nada instalado. */
const PDF_W = 595, PDF_H = 842;
const PDF_MAP = { "–": "-", "—": "-", "‘": "'", "’": "'", "“": "'", "”": "'", "•": "-", "…": "..." };
const pdfEsc = (s) => String(s == null ? "" : s).split("").map((ch) => {
  const c = ch.charCodeAt(0);
  if (ch === "(" || ch === ")" || ch === "\\") return "\\" + ch;
  if (c < 32) return " ";
  if (c < 127) return ch;
  if (c <= 255) return "\\" + c.toString(8).padStart(3, "0");
  return PDF_MAP[ch] || "";
}).join("");
const pdfLargura = (s, size, bold) => {
  let w = 0;
  for (const ch of String(s == null ? "" : s)) {
    let u;
    if (ch >= "0" && ch <= "9") u = 556;
    else if (" .,:;|'".indexOf(ch) >= 0) u = 278;
    else if ("()[]-/".indexOf(ch) >= 0) u = 333;
    else if (ch === "%") u = 889;
    else if ("ijlt".indexOf(ch) >= 0) u = 255;
    else if (ch === ch.toUpperCase() && ch !== ch.toLowerCase()) u = bold ? 722 : 667;
    else u = bold ? 580 : 545;
    w += u;
  }
  return (w * (size || 9)) / 1000;
};
function pdfPagina() {
  const ops = [];
  const api = {
    txt(x, y, t, size, bold) { ops.push(`BT /${bold ? "F2" : "F1"} ${size || 9} Tf 1 0 0 1 ${r2(x)} ${r2(PDF_H - y)} Tm (${pdfEsc(t)}) Tj ET`); return api; },
    dir(x, y, t, size, bold) { return api.txt(x - pdfLargura(t, size, bold), y, t, size, bold); },
    centro(x, y, t, size, bold) { return api.txt(x - pdfLargura(t, size, bold) / 2, y, t, size, bold); },
    linha(x1, y1, x2, y2, esp) { ops.push(`${esp || 0.6} w ${r2(x1)} ${r2(PDF_H - y1)} m ${r2(x2)} ${r2(PDF_H - y2)} l S`); return api; },
    caixa(x, y, w, h, esp) { ops.push(`${esp || 0.6} w ${r2(x)} ${r2(PDF_H - y - h)} ${r2(w)} ${r2(h)} re S`); return api; },
    fundo(x, y, w, h, cinza) { ops.push(`${cinza == null ? 0.9 : cinza} g ${r2(x)} ${r2(PDF_H - y - h)} ${r2(w)} ${r2(h)} re f 0 g`); return api; },
    conteudo() { return ops.join("\n"); },
  };
  return api;
}
function pdfArquivo(paginas) {
  const objs = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "",
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>",
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>",
  ];
  const kids = [];
  paginas.forEach((c, i) => {
    const pag = 5 + i * 2;
    kids.push(`${pag} 0 R`);
    objs.push(`<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${PDF_W} ${PDF_H}]/Resources<</Font<</F1 3 0 R/F2 4 0 R>>>>/Contents ${pag + 1} 0 R>>`);
    objs.push(`<</Length ${c.length}>>\nstream\n${c}\nendstream`);
  });
  objs[1] = `<</Type/Pages/Kids[${kids.join(" ")}]/Count ${paginas.length}>>`;
  let pdf = "%PDF-1.4\n";
  const offs = [];
  objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const inicioXref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  pdf += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${inicioXref}\n%%EOF`;
  return pdf;
}
function baixarPDF(conteudo, nome) {
  const bytes = new Uint8Array(conteudo.length);
  for (let i = 0; i < conteudo.length; i++) bytes[i] = conteudo.charCodeAt(i) & 255;
  const blob = new Blob([bytes], { type: "application/pdf" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
/* Recibo de pagamento de salario: identificacao das partes, verbas com codigo e
   referencia, totais, bases de INSS/FGTS/IRRF e linha de assinatura (CLT art. 464). */
function pdfReciboFolha(f, u, compISO) {
  const p = pdfPagina();
  const x0 = 36, x1 = 559, larg = x1 - x0;
  const cDesc = x0 + 46, cRef = 352, cVenc = 458, cDesconto = x1 - 6;
  const comp = (compISO || "").slice(0, 7);
  const mes = comp.slice(5, 7), ano = comp.slice(0, 4);
  const bruto = +f.salario || 0;
  const base = r2(bruto - (+f.faltas || 0) - (+f.atrasos || 0));
  const fgts = r2(base * TABELAS_2026.fgtsPatronal);
  const dep = +u?.dependentes || 0;
  const baseIrrf = r2(Math.max(0, base - (+f.inss || 0) - dep * TABELAS_2026.irrf.porDependente));
  const dias = +u?.salario > 0 ? Math.min(30, Math.max(1, Math.round(bruto / (+u.salario / 30)))) : 30;
  const pct = (v) => (base > 0 ? `${((v / base) * 100).toFixed(2).replace(".", ",")}%` : "");
  const linhas = [
    { cod: "0001", d: "SALARIO BASE", ref: `${dias} dias`, venc: bruto },
    { cod: "0550", d: "FALTAS E DSR", ref: `${f.diasFaltas || 0} dia(s)`, dsc: +f.faltas || 0 },
    { cod: "0551", d: "ATRASOS ACIMA DA TOLERANCIA", ref: hmm(Math.round((+f.horasAtraso || 0) * 60)), dsc: +f.atrasos || 0 },
    { cod: "0941", d: "ADIANTAMENTO SALARIAL", ref: "", dsc: +f.adiantamento || 0 },
    { cod: "0950", d: "VALE-TRANSPORTE", ref: "6,00%", dsc: +f.vt || 0 },
    { cod: "0998", d: "INSS SOBRE SALARIO", ref: pct(+f.inss || 0), dsc: +f.inss || 0 },
    { cod: "0999", d: "IRRF SOBRE SALARIO", ref: "", dsc: +f.irrf || 0 },
  ].filter((l) => l.cod === "0001" || l.venc || l.dsc);
  const totVenc = r2(linhas.reduce((s, l) => s + (l.venc || 0), 0));
  const totDsc = r2(linhas.reduce((s, l) => s + (l.dsc || 0), 0));
  // cabecalho: empregador + titulo + competencia
  p.caixa(x0, 34, larg, 58);
  p.txt(x0 + 8, 50, EMPRESA.nome, 11, true);
  p.txt(x0 + 8, 63, `CNPJ ${EMPRESA.cnpj}`, 8);
  p.txt(x0 + 8, 74, `${EMPRESA.endereco} - CEP ${EMPRESA.cep}`, 7.5);
  p.txt(x0 + 8, 85, EMPRESA.ramo.slice(0, 92), 7);
  p.dir(x1 - 8, 50, "RECIBO DE PAGAMENTO DE SALARIO", 10.5, true);
  p.dir(x1 - 8, 65, `Competencia ${mes}/${ano}`, 9.5, true);
  p.dir(x1 - 8, 77, `Emitido em ${fmtDataHora(new Date())}`, 7.5);
  p.dir(x1 - 8, 88, f.status === "fechada" ? "FOLHA FECHADA" : "RASCUNHO - CONFERENCIA", 7.5, true);
  // identificacao do colaborador
  p.caixa(x0, 98, larg, 52);
  p.linha(x0, 124, x1, 124, 0.4);
  const campo = (x, y, rot, val, size) => { p.txt(x, y, rot, 6.5); p.txt(x, y + 11, val || "-", size || 9); };
  campo(x0 + 8, 108, "MATRICULA", u?.matricula);
  campo(x0 + 88, 108, "NOME DO COLABORADOR", u?.nome, 9.5);
  campo(x0 + 340, 108, "CPF", u?.cpf);
  campo(x0 + 430, 108, "ADMISSAO", u?.admissao ? fmtData(u.admissao) : "-");
  campo(x0 + 8, 134, "FUNCAO", u?.cargo || "-");
  campo(x0 + 200, 134, "JORNADA CONTRATUAL", "9h/dia seg-sex + sabado 5h");
  campo(x0 + 340, 134, "DEPENDENTES IRRF", String(dep));
  campo(x0 + 430, 134, "DIAS TRABALHADOS", `${dias}`);
  // tabela de verbas
  let y = 162;
  p.fundo(x0, y, larg, 15);
  p.caixa(x0, y, larg, 15);
  p.txt(x0 + 6, y + 10.5, "COD", 7.5, true);
  p.txt(cDesc, y + 10.5, "DESCRICAO", 7.5, true);
  p.dir(cRef, y + 10.5, "REFERENCIA", 7.5, true);
  p.dir(cVenc, y + 10.5, "VENCIMENTOS", 7.5, true);
  p.dir(cDesconto, y + 10.5, "DESCONTOS", 7.5, true);
  y += 15;
  const yIni = y;
  linhas.forEach((l) => {
    y += 14;
    p.txt(x0 + 6, y, l.cod, 8.5);
    p.txt(cDesc, y, l.d, 8.5);
    p.dir(cRef, y, l.ref || "", 8.5);
    if (l.venc) p.dir(cVenc, y, brl(l.venc), 8.5);
    if (l.dsc) p.dir(cDesconto, y, brl(l.dsc), 8.5);
  });
  const yFim = Math.max(y + 6, yIni + 250);
  p.caixa(x0, yIni, larg, yFim - yIni);
  p.linha(cRef + 6, yIni, cRef + 6, yFim, 0.4);
  p.linha(cVenc + 6, yIni, cVenc + 6, yFim, 0.4);
  // totais
  let yt = yFim;
  p.fundo(x0, yt, larg, 16);
  p.caixa(x0, yt, larg, 16);
  p.txt(cDesc, yt + 11, "TOTAIS DO MES", 8, true);
  p.dir(cVenc, yt + 11, brl(totVenc), 9, true);
  p.dir(cDesconto, yt + 11, brl(totDsc), 9, true);
  yt += 16;
  p.caixa(x0, yt, larg, 22);
  p.txt(cDesc, yt + 15, "VALOR LIQUIDO A RECEBER", 10, true);
  p.dir(cDesconto, yt + 15, brl(f.liquido), 13, true);
  // bases de calculo
  yt += 32;
  p.caixa(x0, yt, larg, 34);
  const bases = [
    ["SALARIO CONTRATUAL", brl(+u?.salario || bruto)],
    ["BASE INSS", brl(base)],
    ["BASE FGTS", brl(base)],
    ["FGTS DO MES (8%)", brl(fgts)],
    ["BASE IRRF", brl(baseIrrf)],
  ];
  bases.forEach((b, i) => {
    const x = x0 + 8 + i * (larg / bases.length);
    p.txt(x, yt + 12, b[0], 6.5);
    p.txt(x, yt + 25, b[1], 9, true);
  });
  // declaracao e assinatura
  yt += 52;
  p.txt(x0, yt, "Declaro ter recebido a importancia liquida discriminada neste recibo, referente ao meu salario do mes acima.", 8.5);
  yt += 44;
  p.linha(x0 + 10, yt, x0 + 250, yt, 0.7);
  p.txt(x0 + 10, yt + 11, "Assinatura do colaborador", 7.5);
  p.linha(x0 + 300, yt, x1, yt, 0.7);
  p.txt(x0 + 300, yt + 11, `${EMPRESA.cidade}, ____ de _______________ de ${ano}`, 7.5);
  // rodape
  p.txt(x0, PDF_H - 54, "Documento gerencial gerado pelo Ponto Renovar a partir das marcacoes do periodo.", 7);
  p.txt(x0, PDF_H - 44, "Nao substitui a folha oficial do contador (eSocial, guias e obrigacoes acessorias). Tabelas 2026: INSS Portaria MPS/MF e IRRF Lei 15.270/2025.", 7);
  p.txt(x0, PDF_H - 34, `${EMPRESA.nome} - CNPJ ${EMPRESA.cnpj}`, 7);
  return p.conteudo();
}

/* Espelho de ponto em PDF: marcacoes do mes, jornada prevista, saldo, legenda das
   ressalvas e o aceite eletronico do colaborador (quando houver). Multipagina. */
function pdfEspelhoPonto(u, dias, comp, aceite) {
  const x0 = 36, x1 = 559, larg = x1 - x0;
  const cData = x0 + 6, cExp = x0 + 62, cMarc = x0 + 152, cTrab = 404, cPrev = 470, cSaldo = x1 - 6;
  const itens = Object.entries(dias).map(([dia, regs]) => {
    const dt = new Date(regs[0].ts);
    const exp = expedienteDoDia(dt);
    const min = minutosDia(regs);
    const pares = Math.min(regs.filter((r) => r.tipo === "entrada").length, regs.filter((r) => r.tipo === "saida").length);
    const desc = exp.intervaloMin > 0 && pares <= 1 ? exp.intervaloMin : 0;
    const rot = exp.jornadaMin === 0 ? (exp.rotulo.indexOf("feriado") === 0 ? "FERIADO" : "DOMINGO") : (exp.jornadaMin <= 300 ? "SABADO 8-13h" : "SEG-SEX 8-18h");
    const marcas = regs.map((r) => fmtHora(r.ts)
      + (r.ajustada ? "*" : r.automatica ? "A" : "")
      + (r.metodo === "sem_verificacao" ? "!" : "")
      + (r.offline ? "F" : "")
      + (r.geoStatus === "dispensado_por_falha" ? "G" : "")).join("  ");
    return { dia, dt, rot, min, prev: exp.jornadaMin, saldo: min - desc - exp.jornadaMin, marcas };
  }).sort((a, b) => a.dt - b.dt);
  const somaTrab = itens.reduce((s, i) => s + i.min, 0);
  const somaPrev = itens.reduce((s, i) => s + i.prev, 0);
  const somaSaldo = itens.reduce((s, i) => s + i.saldo, 0);
  const todos = Object.values(dias).reduce((ac, v) => ac.concat(v), []);
  const legenda = [];
  if (todos.some((r) => r && r.ajustada)) legenda.push("*  horario corrigido com justificativa (marcacao original preservada na auditoria)");
  if (todos.some((r) => r && r.automatica)) legenda.push("A  saida preenchida automaticamente pelo sistema no fim do expediente");
  if (todos.some((r) => r && r.metodo === "sem_verificacao")) legenda.push("!  batida registrada sem verificacao biometrica do aparelho");
  if (todos.some((r) => r && r.offline)) legenda.push("F  registrada sem rede - horario do proprio aparelho");
  if (todos.some((r) => r && r.geoStatus === "dispensado_por_falha")) legenda.push("G  registrada sem localizacao, com justificativa do colaborador");
  if (!legenda.length) legenda.push("Nenhuma marcacao com ressalva neste periodo.");
  const paginas = [];
  let p = null, y = 0;
  const cabecalho = () => {
    p = pdfPagina();
    p.caixa(x0, 34, larg, 58);
    p.txt(x0 + 8, 50, EMPRESA.nome, 11, true);
    p.txt(x0 + 8, 63, "CNPJ " + EMPRESA.cnpj, 8);
    p.txt(x0 + 8, 74, EMPRESA.endereco + " - CEP " + EMPRESA.cep, 7.5);
    p.txt(x0 + 8, 85, "Controle de jornada - CLT art. 74 e Portaria MTP 671/2021", 7);
    p.dir(x1 - 8, 50, "ESPELHO DE PONTO", 10.5, true);
    p.dir(x1 - 8, 65, "Competencia " + rotuloComp(comp), 9.5, true);
    p.dir(x1 - 8, 77, "Emitido em " + fmtDataHora(new Date()), 7.5);
    p.dir(x1 - 8, 88, "Pagina " + (paginas.length + 1), 7.5);
    p.caixa(x0, 98, larg, 52);
    p.linha(x0, 124, x1, 124, 0.4);
    const campo = (x, yy, rt, val, size) => { p.txt(x, yy, rt, 6.5); p.txt(x, yy + 11, val || "-", size || 9); };
    campo(x0 + 8, 108, "MATRICULA", u && u.matricula);
    campo(x0 + 88, 108, "NOME DO COLABORADOR", u && u.nome, 9.5);
    campo(x0 + 340, 108, "CPF", u && u.cpf);
    campo(x0 + 430, 108, "ADMISSAO", u && u.admissao ? fmtData(u.admissao) : "-");
    campo(x0 + 8, 134, "FUNCAO", (u && u.cargo) || "-");
    campo(x0 + 200, 134, "JORNADA CONTRATUAL", "9h/dia seg-sex + sabado 5h");
    campo(x0 + 430, 134, "DIAS COM MARCACAO", String(itens.length));
    y = 160;
    p.fundo(x0, y, larg, 16, 0.88);
    p.caixa(x0, y, larg, 16);
    p.txt(cData, y + 11, "DATA", 7.5, true);
    p.txt(cExp, y + 11, "EXPEDIENTE", 7.5, true);
    p.txt(cMarc, y + 11, "MARCACOES", 7.5, true);
    p.dir(cTrab, y + 11, "TRABALHADO", 7.5, true);
    p.dir(cPrev, y + 11, "PREVISTO", 7.5, true);
    p.dir(cSaldo, y + 11, "SALDO", 7.5, true);
    y += 16;
  };
  itens.forEach((it) => {
    if (!p || y > 700) { if (p) paginas.push(p.conteudo()); cabecalho(); }
    p.txt(cData, y + 9.5, it.dia, 8);
    p.txt(cExp, y + 9.5, it.rot, 7);
    p.txt(cMarc, y + 9.5, it.marcas, 8);
    p.dir(cTrab, y + 9.5, hmm(it.min), 8);
    p.dir(cPrev, y + 9.5, hmm(it.prev), 8);
    p.dir(cSaldo, y + 9.5, hmm(it.saldo), 8, true);
    p.linha(x0, y + 13, x1, y + 13, 0.3);
    y += 13.5;
  });
  if (!p) { cabecalho(); p.txt(cData, y + 12, "Nenhuma marcacao registrada nesta competencia.", 8.5); y += 20; }
  if (y > 600) { paginas.push(p.conteudo()); cabecalho(); }
  p.fundo(x0, y, larg, 18, 0.88);
  p.caixa(x0, y, larg, 18);
  p.txt(cData, y + 12, "TOTAIS DO PERIODO", 8, true);
  p.dir(cTrab, y + 12, hmm(somaTrab), 9, true);
  p.dir(cPrev, y + 12, hmm(somaPrev), 9, true);
  p.dir(cSaldo, y + 12, hmm(somaSaldo), 9, true);
  y += 32;
  p.txt(x0, y, "LEGENDA DAS MARCACOES", 7, true);
  y += 11;
  legenda.forEach((l) => { p.txt(x0, y, l, 7); y += 10; });
  y += 6;
  p.caixa(x0, y, larg, 64);
  p.txt(x0 + 8, y + 14, "CONFERENCIA DO COLABORADOR", 7, true);
  if (aceite) {
    p.txt(x0 + 8, y + 29, aceite.status === "aceito"
      ? "Espelho conferido e ACEITO em " + fmtDataHora(aceite.em) + " pelo proprio colaborador, no aplicativo."
      : "Espelho CONTESTADO em " + fmtDataHora(aceite.em) + " pelo colaborador, no aplicativo.", 8.5);
    if (aceite.obs) p.txt(x0 + 8, y + 42, ("Observacao: " + aceite.obs).slice(0, 120), 7.5);
    p.txt(x0 + 8, y + 56, "O aceite eletronico registra a ciencia do colaborador; nao convalida erro nem impede correcao posterior.", 7);
  } else {
    p.txt(x0 + 8, y + 29, "Sem aceite eletronico registrado para esta competencia - conferir e assinar abaixo.", 8);
    p.linha(x0 + 10, y + 50, x0 + 250, y + 50, 0.7);
    p.txt(x0 + 10, y + 60, "Assinatura do colaborador", 6.5);
    p.linha(x0 + 300, y + 50, x1 - 10, y + 50, 0.7);
    p.txt(x0 + 300, y + 60, EMPRESA.cidade + ", ____ de _______________ de " + String(comp).slice(0, 4), 6.5);
  }
  p.txt(x0, PDF_H - 54, "Documento gerado pelo Ponto Renovar a partir das marcacoes originais do periodo.", 7);
  p.txt(x0, PDF_H - 44, "Correcoes de horario ficam registradas com justificativa, autor e data na auditoria do sistema.", 7);
  p.txt(x0, PDF_H - 34, EMPRESA.nome + " - CNPJ " + EMPRESA.cnpj, 7);
  paginas.push(p.conteudo());
  return pdfArquivo(paginas);
}

function baixarArquivo(conteudo, nome) {
  const bytes = new Uint8Array([...conteudo].map((c) => Math.min(c.charCodeAt(0), 255)));
  const blob = new Blob([bytes], { type: "text/plain;charset=ISO-8859-1" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  a.click();
  URL.revokeObjectURL(a.href);
}


/* ---------- notificacao real no aparelho ----------
   No iPhone o construtor new Notification() não existe (nem instalado): só o
   service worker consegue exibir aviso do sistema. Por isso tentamos primeiro
   o registration.showNotification e caímos pro construtor no desktop. */
const TELAS_ATALHO = ["ponto", "espelho", "banco", "holerite", "ferias", "time"];

function telaInicial() {
  try {
    const t = new URLSearchParams(window.location.search).get("ir");
    return TELAS_ATALHO.indexOf(t) >= 0 ? t : "ponto";
  } catch { return "ponto"; }
}

async function notificarAparelho(titulo, corpo, marca) {
  const opcoes = {
    body: corpo,
    tag: marca || "ponto-renovar",
    lang: "pt-BR",
    icon: "icon-192.png",
    badge: "icon-192.png",
    data: { url: "./" },
  };
  try {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && typeof reg.showNotification === "function") {
        await reg.showNotification(titulo, opcoes);
        return "aparelho";
      }
    }
  } catch {}
  try { new Notification(titulo, opcoes); return "janela"; } catch {}
  return "nenhum";
}

function appInstalado() {
  try {
    if (window.__APP_PWA && typeof window.__APP_PWA.instalado === "boolean") return window.__APP_PWA.instalado;
    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
    if (window.navigator && window.navigator.standalone === true) return true;
  } catch {}
  return false;
}

function legendaLembretes(status, instalado) {
  if (status === "granted") return "chegam como aviso do celular \u2714 \u2014 push de servidor: chega mesmo com o app fechado.";
  if (status === "denied") return "aviso do celular bloqueado nas configura\u00e7\u00f5es do navegador \u2014 o lembrete continua aparecendo dentro do app.";
  if (status === "unsupported") return instalado
    ? "este aparelho n\u00e3o permite aviso do sistema \u2014 o lembrete aparece dentro do app."
    : "adicione o app \u00e0 tela de in\u00edcio para receber aviso do celular; sem isso o lembrete s\u00f3 aparece dentro do app.";
  return "toque em Ativar para receber aviso do celular; sem isso o lembrete s\u00f3 aparece dentro do app.";
}

/* ================= Momentos: a frase certa na hora certa =================
   Bater ponto e obrigacao; abrir o app com gosto, nao. Uma linha curta na
   chegada, outra na saida, e um recado decente no primeiro e no ultimo dia
   de casa custam zero de banco de dados e mudam o jeito que o app soa.

   Regra que nao se quebra: NADA de sorteio a cada render. A frase sai do
   dia do ano somado ao nome da pessoa, entao ela le a MESMA frase o dia
   inteiro e uma diferente amanha. Com Math.random() a frase ficaria
   piscando a cada tique do relogio, que roda de segundo em segundo. */
const FRASES_CHEGADA = [
  "Comece pelo mais fácil — o resto engrena depois.",
  "Chegou, já é meio caminho: o dia rende mais quando começa sem correria.",
  "Um dia de cada vez, e hoje é este.",
  "Antes de tudo, respire fundo uma vez. Agora sim.",
  "Feito é melhor que perfeito.",
  "Time que chega junto entrega junto.",
  "Comece devagar que o ritmo vem sozinho.",
  "O que sai daqui vira o serviço de alguém lá fora.",
  "Hoje também dá pra aprender alguma coisa nova.",
  "Sua presença conta mais do que parece por aqui.",
];
const FRASES_SAIDA = [
  "Encerrado. O que ficou pra amanhã pode esperar — descanse.",
  "Bom descanso. Amanhã o assunto continua.",
  "Fechou o dia. Desligue de verdade: o expediente acabou.",
  "Obrigado pelo dia de hoje. Vá com calma na volta.",
  "O trabalho fica, você vai.",
  "Dia cumprido. Aproveite o resto dele com quem você gosta.",
  "Ponto batido, consciência tranquila. Até amanhã!",
  "Descansar também é parte do trabalho.",
  "Fim de expediente: guarde energia pra amanhã.",
  "Vá bem. E chegue bem.",
];
const FRASES_BOAS_VINDAS = [
  "Que bom ter você aqui. Pergunte tudo o que precisar — ninguém nasce sabendo o caminho da casa.",
  "Bem-vindo(a) ao time. Comece no seu ritmo: os primeiros dias são pra entender, não pra correr.",
  "Sua chegada fecha uma lacuna no serviço e abre uma cadeira na equipe. Seja bem-vindo(a)!",
  "A partir de hoje você faz parte disso. Conte com a gente.",
  "Aqui o ponto é simples: registre a jornada e o resto a gente combina conversando.",
  "Feliz começo. Que este seja um lugar onde você cresça.",
];
/* Desligamento nao pede frase motivacional — pede respeito e sobriedade.
   Estas linhas sao SUGESTAO pro gestor copiar, nunca envio automatico. */
const FRASES_DESPEDIDA = [
  "Obrigado pelo tempo e pelo trabalho dedicados à empresa. Desejamos sucesso no próximo passo.",
  "O ciclo aqui se encerra e o respeito fica. Boa sorte no que vem.",
  "Agradecemos cada dia trabalhado. As portas seguem abertas pro futuro.",
  "Toda passagem deixa marca. Obrigado pela sua, e sucesso adiante.",
  "Fica o reconhecimento pelo trabalho entregue. Desejamos o melhor daqui pra frente.",
  "Obrigado por ter feito parte do time. Que o próximo caminho seja bom.",
];

function diaDoAno(dt) {
  const d = dt || new Date();
  const ini = new Date(d.getFullYear(), 0, 1);
  return Math.floor((d.getTime() - ini.getTime()) / 86400000);
}
function sementeTexto(txt) {
  const t = String(txt || "");
  let s = 7;
  for (let i = 0; i < t.length; i++) s = (s * 31 + t.charCodeAt(i)) % 100003;
  return s;
}
/* Determinista: mesma pessoa + mesmo dia = mesma frase, sempre. */
function fraseDoDia(lista, chave, dt) {
  if (!lista || !lista.length) return "";
  return lista[(diaDoAno(dt) + sementeTexto(chave)) % lista.length];
}
function saudacaoDaHora(dt) {
  const h = (dt || new Date()).getHours();
  if (h < 5) return "Boa madrugada";
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}
function primeiroNome(nome) {
  const p = String(nome || "").trim().split(/\s+/);
  return p[0] || "";
}

/* ================= Hidratacao e pausas =================
   Onde o dado fica: SO no aparelho (localStorage). Quantos copos alguem bebeu
   nao e dado de jornada, nao vira coluna no banco e nao aparece pro gestor —
   isso seria vigiar saude alheia. Se a pessoa limpar o navegador, o contador
   zera, e esta tudo bem: e um empurraozinho, nao registro legal.
   Nao e recomendacao medica. A meta usa a referencia popular de 8 copos e da
   pra ajustar no proprio cartao; quem tem restricao medica ajusta ou ignora. */
const AGUA_META_PADRAO = 8;
const AGUA_COPO_ML = 250;
const AGUA_INTERVALO_MIN = 90;
const DICAS_PAUSA = [
  "Olhe pra algo distante por 20 segundos — descansa a vista da tela.",
  "Levante e ande um pouco: o corpo cobra caro cada hora sentado.",
  "Solte os ombros e gire o pescoço devagar, sem forçar.",
  "Se der, coma algo de verdade no intervalo — café não é almoço.",
  "Confira a postura: pés no chão, costas apoiadas.",
];
function aguaChaveDoDia(userId, dt) {
  const d = dt || new Date();
  const dia = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  return "pr_agua_" + (userId || "anon") + "_" + dia;
}
function aguaLer(userId, dt) {
  try {
    const v = parseInt(localStorage.getItem(aguaChaveDoDia(userId, dt)) || "0", 10);
    return v > 0 ? v : 0;
  } catch { return 0; }
}
function aguaGravar(userId, copos, dt) {
  const v = copos > 0 ? copos : 0;
  try { localStorage.setItem(aguaChaveDoDia(userId, dt), String(v)); } catch {}
  return v;
}
/* Meta escolhida pela pessoa (some junto se ela limpar o navegador). */
function aguaLerMeta(userId) {
  try {
    const v = parseInt(localStorage.getItem("pr_agua_meta_" + (userId || "anon")) || "0", 10);
    return v >= 4 && v <= 16 ? v : AGUA_META_PADRAO;
  } catch { return AGUA_META_PADRAO; }
}
function aguaGravarMeta(userId, meta) {
  const v = meta < 4 ? 4 : (meta > 16 ? 16 : meta);
  try { localStorage.setItem("pr_agua_meta_" + (userId || "anon"), String(v)); } catch {}
  return v;
}

/* ---------- Rituais do time: reuniões, pauta e combinados ----------
   O calendário é determinístico: a mesma data devolve sempre as mesmas
   reuniões, sem sorteio e sem consultar o banco. Assim o aviso funciona
   offline e todo mundo vê exatamente o mesmo horário e a mesma pauta. */
const RITUAL_QUINZENAL_PARIDADE = 0; // semanas ISO pares levam a quinzenal

const RITUAIS = [
  {
    id: "semanal",
    icone: "🗓️",
    nome: "Planejamento da semana",
    quando: "toda segunda-feira",
    inicio: "09:15",
    duracaoMin: 45,
    resumo: "Começa pelas pessoas e só depois pelas tarefas: energia, metas e dependências.",
    blocos: [
      { min: 10, tipo: "energia", titulo: "Check-in de energia",
        detalhe: "Cada um dá uma nota de 1 a 10 para o próprio ânimo e explica o motivo em uma frase. Os outros pensam em como aliviar a carga desse colega na semana." },
      { min: 25, tipo: "metas", titulo: "Metas da semana",
        detalhe: "Definição das metas e divisão exata das tarefas no gerenciador que a equipe usa (Trello, Notion e afins). Aqui se responde: o que entreguei na semana passada e no que vou focar agora." },
      { min: 10, tipo: "acoes", titulo: "Dependências",
        detalhe: "O que eu preciso que você me entregue para conseguir avançar? Cada dependência vira um combinado com dono e prazo." },
    ],
  },
  {
    id: "quinzenal",
    icone: "🧩",
    nome: "Resolução de problemas · 3 Pilares",
    quando: "uma segunda sim, outra não",
    inicio: "14:00",
    duracaoMin: 60,
    resumo: "O time escolhe o maior gargalo dos últimos 15 dias e ataca ele por três ângulos.",
    blocos: [
      { min: 10, tipo: "gargalo", titulo: "Escolher o gargalo",
        detalhe: "Qual foi o maior travamento operacional dos últimos 15 dias? Escolham um só, o que mais doeu." },
      { min: 15, tipo: "criativo", titulo: "Pilar Criativo",
        detalhe: "Quem assume este papel propõe saídas sem filtro, inclusive as improváveis. Ninguém critica nesta etapa." },
      { min: 15, tipo: "pratico", titulo: "Pilar Prático",
        detalhe: "Quem assume este papel traduz as ideias em passos possíveis: quem faz, com o quê e em quanto tempo." },
      { min: 10, tipo: "critico", titulo: "Pilar Crítico",
        detalhe: "Quem assume este papel procura onde o plano quebra: risco, custo, efeito colateral, o que já falhou antes." },
      { min: 10, tipo: "acoes", titulo: "Decisão definitiva",
        detalhe: "A solução escolhida vira combinados com dono e prazo. Sem dono e sem data, não foi decidido." },
    ],
  },
  {
    id: "mensal",
    icone: "📊",
    nome: "Retrospectiva do mês",
    quando: "última sexta-feira do mês",
    inicio: "15:00",
    duracaoMin: 60,
    resumo: "Metade do tempo nos números, metade no reconhecimento de quem fez os números acontecerem.",
    blocos: [
      { min: 30, tipo: "numeros", titulo: "Análise fria dos números",
        detalhe: "Resultados coletivos do mês que passou, sem justificativa e sem defesa: o que os dados mostram." },
      { min: 30, tipo: "elogios", titulo: "Elogios profissionais direcionados",
        detalhe: "Cada um reconhece um colega por algo concreto: quero reconhecer fulano por ter resolvido o problema X, isso salvou nosso prazo." },
    ],
  },
];

/* Semana ISO: é ela que sustenta a regra "uma segunda sim, outra não". */
function semanaISO(dt) {
  const a = new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
  const dia = a.getUTCDay() || 7;
  a.setUTCDate(a.getUTCDate() + 4 - dia);
  const ini = new Date(Date.UTC(a.getUTCFullYear(), 0, 1));
  return Math.ceil(((a - ini) / 86400000 + 1) / 7);
}

function ultimaSextaDoMes(dt) {
  const d = new Date(dt.getFullYear(), dt.getMonth() + 1, 0);
  while (d.getDay() !== 5) d.setDate(d.getDate() - 1);
  return d;
}

function ritualPorId(id) { return RITUAIS.filter((r) => r.id === id)[0] || null; }

/* Reuniões de uma data. Dia sem expediente (domingo ou feriado) não tem
   reunião: o app não chama ninguém para trabalhar em dia de folga. */
function reunioesDoDia(dt) {
  const out = [];
  try {
    const exp = expedienteDoDia(dt);
    if (!exp || !exp.jornadaMin) return out;
  } catch { return out; }
  if (dt.getDay() === 1) {
    out.push(ritualPorId("semanal"));
    if (semanaISO(dt) % 2 === RITUAL_QUINZENAL_PARIDADE) out.push(ritualPorId("quinzenal"));
  }
  const us = ultimaSextaDoMes(dt);
  if (us.getMonth() === dt.getMonth() && us.getDate() === dt.getDate()) out.push(ritualPorId("mensal"));
  return out.filter(Boolean);
}

/* Primeira data com reunião a partir de "base". Olhando 21 dias para frente
   o aviso de sexta já enxerga a segunda, sem depender de feriado nenhum. */
function proximasReunioes(base, dias) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const limite = dias || 21;
  for (let i = 0; i < limite; i++) {
    const lista = reunioesDoDia(d);
    if (lista.length) return { data: new Date(d), reunioes: lista };
    d.setDate(d.getDate() + 1);
  }
  return null;
}

function inicioEmMinutos(hhmm) {
  const p = String(hhmm || "").split(":");
  return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
}

const DIAS_POR_EXTENSO = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

/* Rótulo honesto: na sexta o aviso diz "segunda-feira, 10/08", não "amanhã". */
function rotuloDiaReuniao(alvo, base) {
  const a = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const b = new Date(alvo.getFullYear(), alvo.getMonth(), alvo.getDate());
  const dif = Math.round((b - a) / 86400000);
  if (dif === 0) return "hoje";
  if (dif === 1) return "amanhã";
  return DIAS_POR_EXTENSO[b.getDay()] + ", " + String(b.getDate()).padStart(2, "0") + "/" + String(b.getMonth() + 1).padStart(2, "0");
}

function textoAvisoReuniao(ritual, rotulo, assuntos) {
  const extra = (assuntos || []).filter(Boolean);
  /* Com tres assuntos, "a e b e c" fica ruim de ler na tela de bloqueio. */
  const lista = extra.length > 1
    ? extra.slice(0, -1).join(", ") + " e " + extra[extra.length - 1]
    : extra.join("");
  return ritual.nome + " " + rotulo + " às " + ritual.inicio + " (" + ritual.duracaoMin + " min). Pauta: " + ritual.blocos.map((b) => b.titulo).join(" · ") + "."
    + (extra.length ? " Já na mesa: " + lista + "." : "");
}

/* Guarda no próprio aparelho (localStorage), como a hidratação. Hoje só o
   check-in de energia PARA aqui: combinados, respostas das três perguntas e
   atas já sobem para o banco quando as tabelas opcionais existem, e este
   armazenamento passou a ser a rede de segurança de quem está sem tabela ou
   sem internet. A nota de ânimo continua fora do banco de propósito — humor
   de pessoa virando histórico consultável muda a nota, não o humor. */
const RIT_PREFIXO = "pr_ritual_";
function ritLer(chave, padrao) {
  try {
    const v = localStorage.getItem(RIT_PREFIXO + chave);
    if (v === null || v === undefined) return padrao;
    const o = JSON.parse(v);
    return o === null || o === undefined ? padrao : o;
  } catch { return padrao; }
}
function ritGravar(chave, valor) {
  try { localStorage.setItem(RIT_PREFIXO + chave, JSON.stringify(valor)); } catch {}
  return valor;
}

/* Combinados: o que foi acordado vira tarefa com dono e prazo. Sem dono e
   sem data não é combinado, é conversa. */
function acoesLer(userId) {
  const l = ritLer("acoes_" + (userId || "anon"), []);
  return Array.isArray(l) ? l : [];
}
function acoesGravar(userId, lista) {
  return ritGravar("acoes_" + (userId || "anon"), (lista || []).slice(0, 200));
}
function acaoNova(texto, dono, prazo, origem) {
  return {
    id: "a" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
    texto: String(texto || "").trim().slice(0, 280),
    dono: String(dono || "").trim().slice(0, 80),
    prazo: String(prazo || "").slice(0, 10),
    origem: String(origem || "").slice(0, 40),
    criadoEm: new Date().toISOString(),
    feito: false,
    feitoEm: "",
  };
}
function acoesAbertas(lista) { return (lista || []).filter((a) => a && !a.feito); }
function acoesAtrasadas(lista, hojeIso) { return acoesAbertas(lista).filter((a) => a.prazo && a.prazo < hojeIso); }
function acoesConcluidasDesde(lista, iso) { return (lista || []).filter((a) => a && a.feito && a.feitoEm && a.feitoEm >= iso); }

/* ---------- Numeros da retrospectiva do mes --------------------------------
   Regra de ouro daqui: sai time, nao sai pessoa. Estas funcoes devolvem soma
   e media do grupo e nunca uma lista de quem chegou tarde ou de quem faltou.
   Retrospectiva com nome de atrasado no telao deixa de ser retrospectiva e
   vira tribunal - e no mes seguinte ninguem mais fala a verdade na reuniao.
   Quando o mes nao tem marcacao nenhuma, `vazio` volta true pra tela poder
   dizer "ainda nao ha dados" em vez de exibir uma parede de zeros.
   `compDe` e `compAtual` ja existem la em cima, na parte do holerite: mes de
   competencia e o mesmo conceito nos dois lugares, entao nao se duplica. */
function compAnterior(comp) {
  const p = String(comp || "").split("-");
  const ano = parseInt(p[0], 10);
  const mes = parseInt(p[1], 10);
  if (!ano || !mes || mes < 1 || mes > 12) return "";
  return compDe(new Date(ano, mes - 2, 15)); // dia 15 evita virada de fuso
}

const MESES_EXTENSO = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function compExtenso(comp) {
  const p = String(comp || "").split("-");
  const m = parseInt(p[1], 10);
  return MESES_EXTENSO[m - 1] ? MESES_EXTENSO[m - 1] + " de " + p[0] : String(comp || "");
}

function numerosDoMes(usuarios, registros, faltas, acoes, comp) {
  const mes = String(comp || "").slice(0, 7);
  const ativos = (usuarios || []).filter((u) => u && u.ativo !== false);
  const regsMes = (registros || []).filter((r) => r && r.ts && dataISO(new Date(r.ts)).slice(0, 7) === mes);
  const faltasMes = (faltas || []).filter((f) => f && String(f.data || "").slice(0, 7) === mes);
  let diasTrab = 0, saldoMin = 0, atrasos = 0, faltasN = 0, trabalhadoMin = 0;
  ativos.forEach((u) => {
    const a = analisarAssiduidade(u.id, regsMes, faltasMes);
    diasTrab += a.diasTrab;
    saldoMin += a.saldoMin;
    atrasos += a.atrasos;
    faltasN += a.faltas;
    const dias = agruparPorDia(regsMes, u.id);
    Object.keys(dias).forEach((k) => { trabalhadoMin += minutosDia(dias[k]); });
  });
  const noMes = (iso) => String(iso || "").slice(0, 7) === mes;
  const lista = acoes || [];
  const criados = lista.filter((a) => a && noMes(a.criadoEm)).length;
  const feitos = lista.filter((a) => a && a.feito && noMes(a.feitoEm)).length;
  return {
    mes,
    pessoas: ativos.length,
    diasTrab,
    trabalhadoMin,
    saldoMin,
    atrasos,
    faltas: faltasN,
    // Pontualidade do grupo, em percentual de dias de expediente sem atraso.
    pontualidadePct: diasTrab > 0 ? Math.round(((diasTrab - atrasos) / diasTrab) * 100) : 0,
    combCriados: criados,
    combFeitos: feitos,
    combAbertos: acoesAbertas(lista).length,
    // Quanto do que foi combinado no mes realmente fechou. E o unico numero
    // aqui que fala de compromisso, e ainda assim fala do time inteiro.
    combFechamentoPct: criados > 0 ? Math.round((feitos / criados) * 100) : 0,
    vazio: diasTrab === 0 && criados === 0 && feitos === 0,
  };
}

/* Media do proprio check-in de energia no mes. Fica de fora do painel
   coletivo de proposito: a nota de animo e de quem escreveu. */
function energiaMediaMes(userId, comp) {
  const mes = String(comp || "").slice(0, 7);
  const l = energiaLer(userId).filter((e) => e && String(e.data || "").slice(0, 7) === mes);
  if (!l.length) return null;
  const soma = l.reduce((acc, e) => acc + (parseInt(e.nota, 10) || 0), 0);
  return { media: Math.round((soma / l.length) * 10) / 10, registros: l.length };
}

/* ---------- combinados no banco (tabela opcional) ----------
   A primeira versao guardava combinado so no aparelho de quem escreveu, e
   por isso o colega nunca via a tarefa que sobrou pra ele. Com a tabela
   `combinados` criada, o app le e grava no Supabase; sem ela tudo continua
   no localStorage, igual antes. Tabela que falta nao pode quebrar tela. */
function mapCombinado(r) {
  return {
    id: r.id,
    texto: r.texto || "",
    dono: r.dono_nome || "",
    donoId: r.dono_id || "",
    prazo: r.prazo || "",
    origem: r.origem || "",
    feito: !!r.feito,
    feitoEm: r.feito_em || "",
    criadoEm: r.criado_em || "",
    criadoPor: r.criado_por || "",
  };
}
async function combinadosBaixar(token) {
  const linhas = await sbSelect(token, "combinados", "select=*&order=criado_em.desc&limit=300");
  return (linhas || []).map(mapCombinado);
}
async function combinadoInserir(token, autorId, acao, donoId) {
  const linhas = await sbInsert(token, "combinados", [{
    texto: acao.texto,
    dono_id: donoId || null,
    dono_nome: acao.dono || null,
    prazo: acao.prazo || null,
    origem: acao.origem || null,
    criado_por: autorId,
  }]);
  return mapCombinado((linhas && linhas[0]) || {});
}
function combinadoMarcar(token, id, feito) {
  const patch = { feito: !!feito, feito_em: feito ? new Date().toISOString() : null };
  return sbUpdate(token, "combinados", "id=eq." + encodeURIComponent(id), patch);
}

/* Ajuste do time mora numa tabela chave/valor: o gestor grava uma vez e todo
   mundo enxerga o mesmo. Hoje guarda os enderecos das salas (geral e um por
   ritual) e a semente usada para sugerir endereco. Antes isso ficava no
   localStorage do gestor, ou seja, ninguem mais via. */
async function configBaixar(token) {
  const linhas = await sbSelect(token, "config_time", "select=chave,valor");
  const o = {};
  (linhas || []).forEach((r) => { o[r.chave] = r.valor || ""; });
  return o;
}
function configGravar(token, userId, chave, valor) {
  const linha = { chave, valor: valor || "", atualizado_por: userId || null, atualizado_em: new Date().toISOString() };
  return sbUpsert(token, "config_time", [linha], "chave");
}

/* ---------- mural de conquistas e circulo de elogios (tabelas opcionais) ----------
   Vitoria que ninguem conta vira rotina esquecida, e elogio que fica so na
   cabeca nao chega em ninguem. As tabelas `conquistas` e `elogios` deixam os
   dois visiveis pro time inteiro. Sem elas nada quebra: o mural volta pro
   aparelho de quem escreveu e a tela avisa isso com todas as letras.
   Regra que nao muda: nada daqui vira ponto de premio nem de gamificacao.
   Reconhecimento que vale nota deixa de ser reconhecimento e vira meta. */
function ritVazio() {
  return {
    conquistas: [], conquistasNoBanco: false,
    elogios: [], elogiosNoBanco: false,
    motivadores: [], motivaNoBanco: false,
    anjo: null, anjoNoBanco: false,
    atas: [], atasNoBanco: false,
    respostas: [], respostasNoBanco: false,
  };
}
function conquistaNova(texto, tipo, autor, autorId) {
  return {
    id: "c" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
    texto: String(texto || "").trim().slice(0, 400),
    tipo: tipo === "superacao" ? "superacao" : "vitoria",
    autor: String(autor || "").trim().slice(0, 80),
    autorId: autorId || "",
    criadoEm: new Date().toISOString(),
  };
}
function conquistasLer(userId) {
  const l = ritLer("conquistas_" + (userId || "anon"), []);
  return Array.isArray(l) ? l : [];
}
function conquistasGravar(userId, lista) {
  return ritGravar("conquistas_" + (userId || "anon"), (lista || []).slice(0, 120));
}
function mapConquista(r) {
  return {
    id: r.id,
    texto: r.texto || "",
    tipo: r.tipo === "superacao" ? "superacao" : "vitoria",
    autor: r.autor_nome || "",
    autorId: r.autor_id || "",
    criadoEm: r.criado_em || "",
  };
}
async function conquistasBaixar(token) {
  const linhas = await sbSelect(token, "conquistas", "select=*&order=criado_em.desc&limit=60");
  return (linhas || []).map(mapConquista);
}
async function conquistaInserir(token, autorId, autorNome, item) {
  const linhas = await sbInsert(token, "conquistas", [{
    texto: item.texto,
    tipo: item.tipo,
    autor_id: autorId,
    autor_nome: autorNome || null,
  }]);
  return mapConquista((linhas && linhas[0]) || {});
}

function elogioNovo(texto, de, deId, para, paraId, origem) {
  return {
    id: "e" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
    texto: String(texto || "").trim().slice(0, 300),
    de: String(de || "").trim().slice(0, 80),
    deId: deId || "",
    para: String(para || "").trim().slice(0, 80),
    paraId: paraId || "",
    origem: String(origem || "").slice(0, 40),
    criadoEm: new Date().toISOString(),
  };
}
function elogiosLer(userId) {
  const l = ritLer("elogios_" + (userId || "anon"), []);
  return Array.isArray(l) ? l : [];
}
function elogiosGravar(userId, lista) {
  return ritGravar("elogios_" + (userId || "anon"), (lista || []).slice(0, 120));
}
function mapElogio(r) {
  return {
    id: r.id,
    texto: r.texto || "",
    de: r.de_nome || "",
    deId: r.de_id || "",
    para: r.para_nome || "",
    paraId: r.para_id || "",
    origem: r.origem || "",
    criadoEm: r.criado_em || "",
  };
}
async function elogiosBaixar(token) {
  const linhas = await sbSelect(token, "elogios", "select=*&order=criado_em.desc&limit=80");
  return (linhas || []).map(mapElogio);
}
async function elogioInserir(token, deId, deNome, item) {
  const linhas = await sbInsert(token, "elogios", [{
    texto: item.texto,
    de_id: deId,
    de_nome: deNome || null,
    para_id: item.paraId,
    para_nome: item.para || null,
    origem: item.origem || null,
  }]);
  return mapElogio((linhas && linhas[0]) || {});
}
/* ---------- o que me motiva (tabela opcional) ----------
   Tres fatores que fazem a pessoa querer trabalhar, escritos por ela mesma.
   Diferente da nota de animo, isto nasceu pra ser conversado com a lideranca:
   por isso existe um botao separado de compartilhar e a tela diz, antes de
   qualquer coisa, quem vai ler. Enquanto ninguem aperta o botao o texto fica
   so no aparelho. Compartilhar de novo com os campos vazios desfaz. */
function motivaLer(userId) {
  const l = ritLer("motiva_" + (userId || "anon"), ["", "", ""]);
  return Array.isArray(l) ? [l[0] || "", l[1] || "", l[2] || ""] : ["", "", ""];
}
function motivaGravar(userId, fatores) {
  const f = fatores || [];
  return ritGravar("motiva_" + (userId || "anon"), [f[0] || "", f[1] || "", f[2] || ""]);
}
function mapMotivador(r) {
  return {
    userId: r.usuario_id || "",
    nome: r.nome || "",
    fatores: [r.fator_1, r.fator_2, r.fator_3].map((x) => String(x || "").trim()).filter(Boolean),
    atualizadoEm: r.atualizado_em || "",
  };
}
async function motivadoresBaixar(token) {
  const linhas = await sbSelect(token, "motivadores", "select=*&order=atualizado_em.desc");
  return (linhas || []).map(mapMotivador);
}
function motivadorGravar(token, userId, nome, fatores) {
  const f = (fatores || []).map((x) => String(x || "").trim().slice(0, 160));
  return sbUpsert(token, "motivadores", [{
    usuario_id: userId,
    nome: nome || null,
    fator_1: f[0] || null,
    fator_2: f[1] || null,
    fator_3: f[2] || null,
    atualizado_em: new Date().toISOString(),
  }], "usuario_id");
}

/* ---------- dinamica do anjo (tabelas opcionais) ----------
   Cada pessoa cuida em silencio de um colega por uma ou duas semanas: reparar
   no que falta, elogiar, dar suporte. Presente caro fica de fora de proposito,
   o combinado e sobre atencao e nao sobre dinheiro.
   O sorteio embaralha a lista e roda uma casa: assim ninguem tira a si mesmo e
   todo mundo e cuidado por alguem, sem precisar sortear de novo ate dar certo
   (que e justamente o que trava quando o time e pequeno). */
const ANJO_DIAS_PADRAO = 14; // uma a duas semanas: mais que isso o time cansa
function sortearAnjos(ids, aleatorio) {
  const u = [];
  (ids || []).forEach((x) => { if (x && u.indexOf(x) < 0) u.push(x); });
  if (u.length < 2) return [];
  const r = typeof aleatorio === "function" ? aleatorio : Math.random;
  for (let i = u.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = u[i]; u[i] = u[j]; u[j] = t;
  }
  return u.map((anjo, i) => ({ anjo, protegido: u[(i + 1) % u.length] }));
}
function anjoPeriodoPadrao(hoje) {
  const ini = hoje instanceof Date ? hoje : new Date();
  const fim = new Date(ini.getTime());
  fim.setDate(fim.getDate() + ANJO_DIAS_PADRAO - 1);
  return { inicio: dataISO(ini), fim: dataISO(fim) };
}
function anjoLer(userId) {
  const o = ritLer("anjo_" + (userId || "anon"), null);
  return o && o.inicio ? o : null;
}
function anjoGravar(userId, dados) {
  return ritGravar("anjo_" + (userId || "anon"), dados);
}
function mapAnjoRodada(r) {
  return { id: r.id, inicio: r.inicio || "", fim: r.fim || "", criadoPor: r.criado_por || "" };
}
async function anjoRodadaAtual(token, hojeIso) {
  const linhas = await sbSelect(token, "anjo_rodada", "select=*&fim=gte." + hojeIso + "&order=inicio.desc&limit=1");
  const r = (linhas || [])[0];
  return r ? mapAnjoRodada(r) : null;
}
/* A policy de leitura do anjo_par so devolve a linha de quem esta perguntando:
   e o banco, e nao a tela, que guarda o segredo de quem cuida de quem. */
async function anjoProtegidoDaRodada(token, rodadaId) {
  const linhas = await sbSelect(token, "anjo_par", "select=protegido_nome&rodada_id=eq." + rodadaId + "&limit=1");
  const r = (linhas || [])[0];
  return r ? (r.protegido_nome || "") : "";
}
async function anjoSortear(token, gestorId, pessoas, inicio, fim) {
  const linhas = await sbInsert(token, "anjo_rodada", [{ inicio, fim, criado_por: gestorId }]);
  const rodada = mapAnjoRodada((linhas && linhas[0]) || {});
  const nomes = {};
  (pessoas || []).forEach((p) => { nomes[p.id] = p.nome; });
  const pares = sortearAnjos((pessoas || []).map((p) => p.id));
  if (!pares.length) throw new Error("Precisa de pelo menos duas pessoas ativas pra sortear.");
  await sbInsert(token, "anjo_par", pares.map((p) => ({
    rodada_id: rodada.id,
    anjo_id: p.anjo,
    protegido_id: p.protegido,
    protegido_nome: nomes[p.protegido] || null,
  })), true); // return=minimal: nem quem sorteia recebe os pares de volta
  return rodada;
}
/* ---------- ata automatica da reuniao (tabela opcional) ----------
   Combinado sem registro morre na semana seguinte: ninguem lembra quem ficou
   de fazer o que, e a reuniao vira teatro. A ata amarra cada rodada de
   roteiro a um dia, um ritual e a lista de combinados que nasceram ali.
   Ela e montada pelo proprio app, sem ninguem digitar resumo.
   Participante aqui NAO e controle de presenca: o app so olha quem bateu
   ponto naquele dia pra saber quem estava trabalhando. Nao existe chamada,
   nao existe falta de reuniao e nada disso encosta em premio ou avaliacao. */
function ataNova(ritual, diaIso, participantes, combinados, numeros, autor, autorId, respostas) {
  return {
    id: "t" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
    data: String(diaIso || "").slice(0, 10),
    ritualId: String((ritual && ritual.id) || "").slice(0, 30),
    ritualNome: String((ritual && ritual.nome) || "").slice(0, 80),
    participantes: (participantes || []).slice(0, 40).map((p) => String(p || "").slice(0, 80)),
    combinados: (combinados || []).slice(0, 40).map((c) => ({
      texto: String((c && c.texto) || "").slice(0, 280),
      dono: String((c && c.dono) || "").slice(0, 80),
      prazo: String((c && c.prazo) || "").slice(0, 10),
    })),
    respostas: (respostas || []).slice(0, 40).map((x) => ({
      autor: String((x && x.autor) || "").slice(0, 80),
      entreguei: String((x && x.entreguei) || "").slice(0, 500),
      foco: String((x && x.foco) || "").slice(0, 500),
      impedimento: String((x && x.impedimento) || "").slice(0, 500),
      /* Guardado dentro da propria resposta, sem coluna nova no banco: ata que
         nao mostra repeticao deixa o mesmo travamento parecer novidade. */
      travado: !!(x && x.travado),
    })),
    numeros: numeros || null,
    autor: String(autor || "").trim().slice(0, 80),
    autorId: autorId || "",
    criadoEm: new Date().toISOString(),
  };
}
function atasLer(userId) {
  const l = ritLer("atas_" + (userId || "anon"), []);
  return Array.isArray(l) ? l : [];
}
function atasGravar(userId, lista) {
  return ritGravar("atas_" + (userId || "anon"), (lista || []).slice(0, 60));
}
/* Quem estava trabalhando no dia, pela marcacao de ponto que ja existe.
   E uma inferencia, nao uma lista de chamada - por isso a tela diz isso. */
function participantesDoDia(usuarios, registros, diaIso) {
  const ativos = (usuarios || []).filter((u) => u && u.ativo !== false);
  const bateram = {};
  (registros || []).forEach((r) => {
    if (r && r.ts && dataISO(new Date(r.ts)) === diaIso) bateram[r.userId] = true;
  });
  return ativos.filter((u) => bateram[u.id]).map((u) => u.nome);
}
/* Os combinados que nasceram naquela reuniao: mesmo dia e mesma origem. */
function combinadosDaReuniao(acoes, ritualNome, diaIso) {
  return (acoes || []).filter((a) => a && a.origem === ritualNome
    && String(a.criadoEm || "").slice(0, 10) === diaIso);
}
function mapAta(r) {
  return {
    id: r.id,
    data: r.data || "",
    ritualId: r.ritual_id || "",
    ritualNome: r.ritual_nome || "",
    participantes: Array.isArray(r.participantes) ? r.participantes : [],
    combinados: Array.isArray(r.combinados) ? r.combinados : [],
    respostas: Array.isArray(r.respostas) ? r.respostas : [],
    numeros: r.numeros || null,
    autor: r.autor_nome || "",
    autorId: r.autor_id || "",
    criadoEm: r.criado_em || "",
  };
}
async function atasBaixar(token) {
  const linhas = await sbSelect(token, "atas", "select=*&order=data.desc&limit=60");
  return (linhas || []).map(mapAta);
}
async function ataInserir(token, autorId, autorNome, ata) {
  const linhas = await sbInsert(token, "atas", [{
    data: ata.data,
    ritual_id: ata.ritualId,
    ritual_nome: ata.ritualNome,
    participantes: ata.participantes,
    combinados: ata.combinados,
    respostas: ata.respostas || [],
    numeros: ata.numeros,
    autor_id: autorId,
    autor_nome: autorNome || null,
  }]);
  return mapAta((linhas && linhas[0]) || {});
}

/* Videochamada: o app nao hospeda video. Ele guarda o endereco da sala, abre
   em aba nova e mostra quem ja entrou. So aceita https para nao virar porta
   de entrada para qualquer endereco que alguem cole aqui. */
function salaValida(url) {
  try { return new URL(String(url || "")).protocol === "https:"; } catch { return false; }
}
function salaLer() { const v = ritLer("sala", ""); return typeof v === "string" && salaValida(v) ? v : ""; }
function salaGravar(url) {
  const v = String(url || "").trim();
  return ritGravar("sala", salaValida(v) ? v : "");
}
function abrirSala(url) {
  if (!salaValida(url)) return false;
  try { window.open(url, "_blank", "noopener,noreferrer"); return true; } catch { return false; }
}

/* Uma sala por ritual. Planejamento da semana e retrospectiva do mes quase
   sempre acontecem em salas diferentes, e obrigar o time a lembrar qual link
   vale hoje e o jeito mais barato de fazer alguem entrar no lugar errado.
   Ritual sem sala propria cai no link geral, que era o comportamento antigo. */
const SALAS_RITUAIS = ["semanal", "quinzenal", "mensal"];
const SALA_CHAVE_BANCO = { geral: "sala_video", semanal: "sala_semanal", quinzenal: "sala_quinzenal", mensal: "sala_mensal" };
/* Sem batida nova nesse tempo a pessoa sumiu da sala. Curto de proposito:
   presenca velha na tela e pior que presenca nenhuma. */
const PRESENCA_MIN = 8;

function chaveSalaNoBanco(qual) {
  return SALA_CHAVE_BANCO[String(qual || "")] || "";
}
function salaDoRitual(salas, ritualId) {
  const s = salas || {};
  const propria = String(s[String(ritualId || "")] || "").trim();
  if (salaValida(propria)) return propria;
  const geral = String(s.geral || "").trim();
  return salaValida(geral) ? geral : "";
}
function salasLer() {
  const guardado = ritLer("salas", null);
  const o = guardado && typeof guardado === "object" ? guardado : {};
  const saida = { geral: salaLer() };
  SALAS_RITUAIS.forEach((k) => {
    const v = String(o[k] || "").trim();
    saida[k] = salaValida(v) ? v : "";
  });
  return saida;
}
function salasGravar(mapa) {
  const o = mapa || {};
  const limpo = {};
  SALAS_RITUAIS.forEach((k) => {
    const v = String(o[k] || "").trim();
    limpo[k] = salaValida(v) ? v : "";
  });
  ritGravar("salas", limpo);
  if (Object.prototype.hasOwnProperty.call(o, "geral")) salaGravar(o.geral);
  return salasLer();
}

/* O app nao cria a sala: ele monta um endereco dificil de adivinhar a partir
   de uma semente sorteada uma unica vez e guardada no ajuste do time. Sala com
   nome obvio e sala onde estranho entra. Se o gestor preferir Meet ou Zoom,
   e so colar o link e ignorar a sugestao. */
function enderecoSalaSugerido(semente, ritualId) {
  const s = String(semente || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (s.length < 10) return "";
  const r = String(ritualId || "").replace(/[^a-z0-9]/gi, "").toLowerCase() || "time";
  return "https://meet.jit.si/renovar-" + r + "-" + s.slice(0, 18);
}
function sortearSementeSala() {
  const letras = "abcdefghijkmnopqrstuvwxyz23456789";
  let s = "";
  try {
    const c = typeof crypto !== "undefined" ? crypto : null;
    if (c && c.getRandomValues) {
      const b = new Uint8Array(24);
      c.getRandomValues(b);
      for (let i = 0; i < b.length; i++) s += letras[b[i] % letras.length];
    }
  } catch { s = ""; }
  while (s.length < 24) s += letras[Math.floor(Math.random() * letras.length)];
  return s.slice(0, 24);
}

/* Presenca na chamada. Cada aparelho bate a propria presenca de tempos em
   tempos enquanto a sala esta aberta, e o cartao mostra quem ja entrou. Serve
   para ninguem cair numa sala vazia achando que se atrasou. Nada disso vira
   ficha de frequencia: linha sem batida recente some sozinha da tela e o app
   nunca conta quem faltou na chamada. */
function mapPresenca(r) {
  return {
    usuarioId: r.usuario_id || "",
    nome: r.nome || "",
    ritualId: r.ritual_id || "",
    dia: r.dia || "",
    vistoEm: r.visto_em || "",
  };
}
async function presencaBaixar(token, diaIso) {
  const linhas = await sbSelect(token, "presenca_chamada",
    "select=*&dia=eq." + String(diaIso || "").slice(0, 10) + "&order=visto_em.asc&limit=80");
  return (linhas || []).map(mapPresenca);
}
function presencaBater(token, userId, nome, diaIso, ritualId) {
  return sbUpsert(token, "presenca_chamada", [{
    usuario_id: userId,
    nome: String(nome || "").slice(0, 80) || null,
    dia: String(diaIso || "").slice(0, 10),
    ritual_id: String(ritualId || "").slice(0, 30),
    visto_em: new Date().toISOString(),
  }], "usuario_id,dia,ritual_id");
}
/* Quem esta na sala agora, do mais antigo para o mais novo: quem chegou
   primeiro aparece primeiro, que e a ordem que a pessoa espera ver. */
function presencaAtiva(linhas, ritualId, diaIso, agoraMs, minutos) {
  const limite = (minutos || PRESENCA_MIN) * 60000;
  const t = typeof agoraMs === "number" && isFinite(agoraMs) ? agoraMs : Date.now();
  const visto = {};
  (linhas || []).forEach((l) => {
    if (!l) return;
    if (String(l.dia || "") !== String(diaIso || "")) return;
    if (String(l.ritualId || "") !== String(ritualId || "")) return;
    const q = Date.parse(String(l.vistoEm || ""));
    if (!isFinite(q) || t - q > limite) return;
    const id = String(l.usuarioId || "");
    if (!id) return;
    if (!visto[id] || q > visto[id].vistoEm) visto[id] = { usuarioId: id, nome: String(l.nome || ""), vistoEm: q };
  });
  return Object.keys(visto).map((k) => visto[k]).sort((a, b) => a.vistoEm - b.vistoEm);
}
function textoPresenca(presentes, meuId) {
  const lista = (presentes || []).filter(Boolean);
  const outros = lista.filter((p) => String(p.usuarioId) !== String(meuId || ""))
    .map((p) => String(p.nome || "").trim() || "alguém do time");
  const euDentro = lista.filter((p) => String(p.usuarioId) === String(meuId || "")).length > 0;
  if (!outros.length) return euDentro ? "Você é a única pessoa na sala agora." : "Ninguém entrou na sala ainda.";
  const nomes = outros.length > 1
    ? outros.slice(0, -1).join(", ") + " e " + outros[outros.length - 1]
    : outros[0];
  return nomes + (outros.length > 1 ? " já estão na sala." : " já está na sala.");
}

/* Trava de aviso: uma notificação por pessoa, por reunião e por etapa —
   a mesma ideia do push_lembretes_log que o servidor já usa. */
function avisoJaDado(userId, diaIso, ritualId, etapa) {
  return ritLer("aviso_" + (userId || "anon") + "_" + diaIso + "_" + ritualId + "_" + etapa, false) === true;
}
function marcarAviso(userId, diaIso, ritualId, etapa) {
  return ritGravar("aviso_" + (userId || "anon") + "_" + diaIso + "_" + ritualId + "_" + etapa, true);
}

/* Check-in de energia: nota de 1 a 10 do próprio ânimo, com motivo opcional. */
function energiaLer(userId) {
  const l = ritLer("energia_" + (userId || "anon"), []);
  return Array.isArray(l) ? l : [];
}
function energiaGravar(userId, diaIso, nota, motivo, ajuda) {
  const l = energiaLer(userId).filter((e) => e && e.data !== diaIso);
  l.push({ data: diaIso, nota: Math.max(1, Math.min(10, parseInt(nota, 10) || 0)), motivo: String(motivo || "").trim().slice(0, 280), ajuda: String(ajuda || "").trim().slice(0, 280) });
  l.sort((a, b) => String(a.data).localeCompare(String(b.data)));
  return ritGravar("energia_" + (userId || "anon"), l.slice(-26));
}
function corEnergia(n) { return n >= 8 ? C.verde : n >= 5 ? C.amarelo : C.vermelho; }

/* As três perguntas do planejamento, uma resposta por semana. */
function respostasLer(userId, diaIso) { const o = ritLer("resp_" + (userId || "anon") + "_" + diaIso, null); return o && typeof o === "object" ? o : { entreguei: "", foco: "", impedimento: "" }; }
function respostasGravar(userId, diaIso, o) { return ritGravar("resp_" + (userId || "anon") + "_" + diaIso, { entreguei: String(o.entreguei || "").slice(0, 500), foco: String(o.foco || "").slice(0, 500), impedimento: String(o.impedimento || "").slice(0, 500) }); }

/* As tres perguntas no banco (tabela opcional respostas). Isto e conteudo de
   trabalho, nao diario pessoal: o proprio ritual manda dizer em voz alta o que
   entreguei, no que vou focar e onde travei. Por isso o time inteiro le. A nota
   de energia continua FORA daqui, so no aparelho de quem deu a nota - animo de
   pessoa virando historico consultavel muda a nota, nao o animo. */
function mapResposta(r) {
  return {
    id: r.id,
    data: r.data || "",
    ritualId: r.ritual_id || "",
    entreguei: r.entreguei || "",
    foco: r.foco || "",
    impedimento: r.impedimento || "",
    autor: r.autor_nome || "",
    autorId: r.autor_id || "",
    atualizadoEm: r.atualizado_em || "",
  };
}
async function respostasBaixar(token) {
  const linhas = await sbSelect(token, "respostas", "select=*&order=data.desc&limit=200");
  return (linhas || []).map(mapResposta);
}
function respostaSubir(token, autorId, autorNome, diaIso, ritualId, o) {
  return sbUpsert(token, "respostas", [{
    autor_id: autorId,
    autor_nome: autorNome || null,
    data: String(diaIso || "").slice(0, 10),
    ritual_id: String(ritualId || "").slice(0, 30),
    entreguei: String((o && o.entreguei) || "").slice(0, 500),
    foco: String((o && o.foco) || "").slice(0, 500),
    impedimento: String((o && o.impedimento) || "").slice(0, 500),
    atualizado_em: new Date().toISOString(),
  }], "autor_id,data,ritual_id");
}
/* O que o time respondeu para aquela reuniao. Resposta antiga de ritual que
   nao gravou id entra tambem, senao o historico do aparelho ficava invisivel. */
function respostasDoDia(lista, diaIso, ritualId) {
  return (lista || []).filter((r) => r && r.data === diaIso
    && (!ritualId || !r.ritualId || r.ritualId === ritualId));
}
function respostaVazia(r) {
  return !String((r && r.entreguei) || "").trim()
    && !String((r && r.foco) || "").trim()
    && !String((r && r.impedimento) || "").trim();
}
/* Quem pediu ajuda. Isto e pauta, nao ficha: sobe para o inicio da reuniao
   para o impedimento nao aparecer so no dia do prazo estourado. */
function impedimentosDoDia(lista, diaIso, ritualId) {
  return respostasDoDia(lista, diaIso, ritualId)
    .filter((r) => String(r.impedimento || "").trim())
    .map((r) => ({ autor: r.autor || "alguem do time", autorId: r.autorId || "", texto: String(r.impedimento).trim() }));
}
/* Combinado que vence ate o dia da reuniao (ou ja venceu) e o assunto mais
   concreto que existe para levar para a pauta. */
function combinadosNaPauta(acoes, diaIso) {
  return acoesAbertas(acoes || [])
    .filter((a) => a && a.prazo && String(a.prazo).slice(0, 10) <= diaIso);
}
/* Os assuntos previstos, em frase curta, para os dois avisos. Aqui NAO entra o
   texto do impedimento nem nome de ninguem: aviso de celular aparece na tela de
   bloqueio, e pedido de ajuda e assunto de reuniao, nao de tela de bloqueio. */
function assuntosDaReuniao(ritual, respostas, acoes, diaIso) {
  const fora = [];
  const imp = impedimentosDoDia(respostas, diaIso, ritual && ritual.id).length;
  const venc = combinadosNaPauta(acoes, diaIso).length;
  /* Repetido da reuniao passada entra como assunto separado: e a diferenca
     entre "temos pedidos de ajuda" e "temos pedido de ajuda que nao andou". */
  const trav = impedimentosTravados(respostas, ritual && ritual.id, diaIso).length;
  if (imp) fora.push(imp + (imp > 1 ? " pedidos de ajuda" : " pedido de ajuda"));
  if (trav) fora.push(trav + (trav > 1 ? " repetidos da reunião passada" : " repetido da reunião passada"));
  if (venc) fora.push(venc + (venc > 1 ? " combinados vencendo" : " combinado vencendo"));
  return fora;
}

/* ---------- impedimento que nao anda ----------
   Perguntar "tem impedimento?" toda semana e facil. O que corroi um time e o
   impedimento que a pessoa repete na reuniao seguinte e ninguem move. Quando
   isso acontece quase nunca e falta de esforco: falta uma decisao que a pessoa
   sozinha nao pode tomar. Por isso o app marca o ASSUNTO travado, nunca a
   pessoa, e oferece a unica saida honesta - virar combinado com dono e prazo. */
function chaveAutorResposta(r) {
  return String((r && (r.autorId || r.autor)) || "").trim().toLowerCase();
}
/* Dia da ocorrencia anterior do MESMO ritual. O limite de 45 dias cobre o
   mensal com folga e evita varrer o ano inteiro quando o ritual nao existe. */
function reuniaoAnteriorDoRitual(ritualId, diaIso, dias) {
  const iso = String(diaIso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || !ritualId) return "";
  const base = dataLocal(iso);
  if (!base || isNaN(base.getTime())) return "";
  const limite = dias || 45;
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  for (let i = 0; i < limite; i++) {
    d.setDate(d.getDate() - 1);
    if (reunioesDoDia(d).some((r) => r && r.id === ritualId)) return dataISO(d);
  }
  return "";
}
/* O dia de reuniao que vale para olhar agora: hoje, se hoje tem esse ritual;
   senao a ultima vez que ele aconteceu. E assim que uma terca-feira consegue
   falar do que travou na segunda, em vez de mostrar tela vazia. */
function ocorrenciaRitualAteHoje(ritualId, diaIso, dias) {
  const iso = String(diaIso || "").slice(0, 10);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? dataLocal(iso) : null;
  if (d && !isNaN(d.getTime()) && reunioesDoDia(d).some((r) => r && r.id === ritualId)) return iso;
  return reuniaoAnteriorDoRitual(ritualId, diaIso, dias);
}
/* Mesma pessoa pediu ajuda na reuniao passada deste ritual e pediu de novo
   agora. Comparar por pessoa, e nao por texto, e de proposito: quem esta
   travado raramente descreve o problema com as mesmas palavras duas vezes. */
function impedimentosTravados(respostas, ritualId, diaIso, diaAnteriorIso) {
  const ant = diaAnteriorIso || reuniaoAnteriorDoRitual(ritualId, diaIso);
  if (!ant) return [];
  const antes = respostasDoDia(respostas, ant, ritualId).filter((r) => String(r.impedimento || "").trim());
  if (!antes.length) return [];
  return respostasDoDia(respostas, diaIso, ritualId)
    .filter((r) => String(r.impedimento || "").trim())
    .map((r) => {
      const par = antes.filter((x) => chaveAutorResposta(x) === chaveAutorResposta(r))[0];
      if (!par) return null;
      return {
        autor: r.autor || "alguem do time",
        autorId: r.autorId || "",
        texto: String(r.impedimento).trim(),
        anterior: String(par.impedimento).trim(),
        desde: ant,
      };
    })
    .filter(Boolean);
}
/* Os pedidos de ajuda do dia, cada um sabendo se ja veio da reuniao passada. */
function impedimentosComHistorico(respostas, ritualId, diaIso) {
  const trav = {};
  impedimentosTravados(respostas, ritualId, diaIso).forEach((x) => { trav[chaveAutorResposta(x)] = x; });
  return impedimentosDoDia(respostas, diaIso, ritualId).map((x) => {
    const t = trav[chaveAutorResposta(x)];
    return {
      autor: x.autor,
      autorId: x.autorId || "",
      texto: x.texto,
      travado: !!t,
      anterior: t ? t.anterior : "",
      desde: t ? t.desde : "",
    };
  });
}
/* Acompanhamento COLETIVO dos combinados. Nao tem nome, nao tem ranking e nao
   tem nada por pessoa: o gestor precisa saber se o time esta afogado, nao quem
   esta devendo. Quem ficou com o que continua visivel so no roteiro, onde o
   proprio time olha junto. Numero por pessoa aqui viraria placar, e placar de
   tarefa atrasada e o caminho mais curto para o time parar de pedir ajuda. */
function acompanhamentoCombinados(acoes, respostas, hojeIso) {
  const abertas = acoesAbertas(acoes);
  const comPrazo = abertas.filter((a) => String(a.prazo || "").trim());
  const atrasados = comPrazo.filter((a) => String(a.prazo).slice(0, 10) < hojeIso);
  const vencemHoje = comPrazo.filter((a) => String(a.prazo).slice(0, 10) === hojeIso);
  let atrasoMaiorDias = 0;
  const ref = /^\d{4}-\d{2}-\d{2}$/.test(String(hojeIso || "")) ? dataLocal(hojeIso) : null;
  if (ref) {
    atrasados.forEach((a) => {
      const d = dataLocal(String(a.prazo).slice(0, 10));
      const dif = Math.round((ref - d) / 86400000);
      if (dif > atrasoMaiorDias) atrasoMaiorDias = dif;
    });
  }
  const travados = RITUAIS.reduce((soma, r) => {
    const dia = ocorrenciaRitualAteHoje(r.id, hojeIso);
    return soma + (dia ? impedimentosTravados(respostas, r.id, dia).length : 0);
  }, 0);
  return {
    abertos: abertas.length,
    semPrazo: abertas.length - comPrazo.length,
    semDono: abertas.filter((a) => !String(a.dono || "").trim()).length,
    atrasados: atrasados.length,
    vencemHoje: vencemHoje.length,
    atrasoMaiorDias,
    travados,
    vazio: abertas.length === 0 && travados === 0,
  };
}

/* ---------- resumo da semana do gestor ----------
   Junta num lugar so o que estava espalhado por quatro telas: quais rituais
   aconteceram nos ultimos sete dias, quantas pessoas escreveram as tres
   perguntas, qual reuniao ficou sem ata e o que os combinados estao dizendo.
   A nota do check-in de energia fica de fora DE PROPOSITO. A tela de quem
   responde promete que o gestor nao le a nota de animo, e time de tres pessoas
   nao tem media anonima: qualquer numero ali entregaria a pessoa. Resumo que
   quebra promessa feita ao colaborador nao e resumo, e vigilancia. */
const RESUMO_JANELA_DIAS = 7;

/* Ocorrencias de ritual dentro da janela que termina em hojeIso, da mais
   recente para a mais antiga. Dia sem expediente nao gera reuniao, entao
   feriado nao vira "reuniao que o time faltou". */
function rituaisDaJanela(hojeIso, dias) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(hojeIso || ""))) return [];
  const fim = dataLocal(hojeIso);
  const janela = dias > 0 ? dias : RESUMO_JANELA_DIAS;
  const out = [];
  for (let i = 0; i < janela; i++) {
    const d = new Date(fim.getFullYear(), fim.getMonth(), fim.getDate() - i);
    reunioesDoDia(d).forEach((r) => { if (r) out.push({ ritual: r, data: dataISO(d) }); });
  }
  return out;
}

/* Quantas PESSOAS escreveram alguma das tres perguntas naquele dia. Conta
   gente, e nao linha: a mesma pessoa respondendo duas vezes continua sendo um. */
function autoresQueResponderam(respostas, diaIso, ritualId) {
  const vistos = {};
  respostasDoDia(respostas, diaIso, ritualId)
    .filter((r) => !respostaVazia(r))
    .forEach((r) => { vistos[chaveAutorResposta(r)] = true; });
  return Object.keys(vistos).length;
}

/* Ata daquele dia. Ata antiga pode nao ter ritualId gravado; nesse caso a data
   sozinha ja vale, para versao velha nao aparecer como reuniao sem ata. */
function temAtaDaReuniao(atas, diaIso, ritualId) {
  return (atas || []).some((a) => a
    && String(a.data || "").slice(0, 10) === diaIso
    && (!a.ritualId || !ritualId || a.ritualId === ritualId));
}

/* Uma frase so, a mais urgente. Painel que acende cinco alarmes de uma vez
   vira papel de parede e o gestor para de olhar; por isso aqui sai no maximo
   um "comece por aqui", na ordem que respeita quem pediu ajuda primeiro. */
function prioridadeDaSemana(r) {
  const c = (r && r.combinados) || {};
  if (c.travados > 0) return {
    chave: "travado",
    titulo: "Comece pelo pedido de ajuda que voltou",
    texto: "Alguém levantou a mesma dificuldade em duas reuniões seguidas e nada mudou no meio. Antes de cobrar prazo, pergunte o que travou.",
  };
  if (r.semRegistro > 0) return {
    chave: "sem-registro",
    titulo: "Teve reunião sem nada escrito",
    texto: "O ritual aconteceu na agenda, mas ninguém registrou entrega, foco ou impedimento. Ou a reunião não rolou, ou rolou e não virou combinado nenhum.",
  };
  if (c.atrasados > 0) return {
    chave: "atrasado",
    titulo: "Tem prazo estourado esperando conversa",
    texto: "Combinado vencido costuma ser sinal de escopo maior do que o tempo, e não de desleixo. Vale renegociar a data em vez de repetir a cobrança.",
  };
  if (c.semDono + c.semPrazo > 0) return {
    chave: "sem-dono",
    titulo: "Tem combinado sem dono ou sem data",
    texto: "Combinado que não diz quem faz e até quando some sozinho. Fechar isso na próxima reunião custa dois minutos.",
  };
  if (r.semAta > 0) return {
    chave: "sem-ata",
    titulo: "Teve reunião que ninguém encerrou no app",
    texto: "A ata sai pronta quando alguém clica em encerrar. Sem esse clique, o que foi combinado fica só na memória de quem estava na sala.",
  };
  if (r.encontros === 0) return {
    chave: "sem-encontro",
    titulo: "Nenhum ritual caiu nesta janela",
    texto: "Não houve reunião prevista nos últimos dias. Nada a fazer aqui.",
  };
  return null;
}

/* O resumo em si. Devolve numero e frase juntos para a tela nao ter que
   reinterpretar nada, e devolve a lista de rituais para o gestor ver dia a dia. */
function resumoDaSemana(acoes, respostas, atas, usuarios, hojeIso, dias) {
  const time = (usuarios || []).filter((u) => u && u.papel !== "gestor").length;
  const janela = dias > 0 ? dias : RESUMO_JANELA_DIAS;
  const rituais = rituaisDaJanela(hojeIso, janela).map((o) => {
    const responderam = autoresQueResponderam(respostas, o.data, o.ritual.id);
    return {
      id: o.ritual.id,
      icone: o.ritual.icone,
      nome: o.ritual.nome,
      data: o.data,
      responderam,
      time,
      semRegistro: responderam === 0,
      semAta: !temAtaDaReuniao(atas, o.data, o.ritual.id),
    };
  });
  const valido = /^\d{4}-\d{2}-\d{2}$/.test(String(hojeIso || ""));
  let inicio = "";
  if (valido) {
    const f = dataLocal(hojeIso);
    inicio = dataISO(new Date(f.getFullYear(), f.getMonth(), f.getDate() - (janela - 1)));
  }
  const combinados = acompanhamentoCombinados(acoes, respostas, hojeIso);
  const base = {
    inicio,
    fim: valido ? hojeIso : "",
    dias: janela,
    rituais,
    encontros: rituais.length,
    semRegistro: rituais.filter((r) => r.semRegistro).length,
    semAta: rituais.filter((r) => !r.semRegistro && r.semAta).length,
    combinados,
  };
  base.vazio = base.encontros === 0 && combinados.vazio;
  base.prioridade = prioridadeDaSemana(base);
  return base;
}

/* ---------- push de servidor: o aviso chega com o app FECHADO ----------
   A chave publica VAPID abaixo diz ao navegador QUEM pode mandar aviso pra
   este aparelho; a privada mora so nos segredos do Supabase. A inscricao do
   navegador (endpoint + chaves) vai pra tabela push_inscricoes, e a Edge
   Function lembretes-push percorre essa lista nos horarios de batida.
   Sem inscricao, o lembrete volta a depender do app aberto. */
const VAPID_PUBLICA = "BNN_ZavXeLShPczVpCz0WWFXR77-IoZ4qgJ7bGDjN92NMU5aIwnoAJVsCELo1n7vYha6fF8B_BRpIAgpTV_2Z5M";

function b64UrlParaBytes(txt) {
  const b64 = (txt + "=".repeat((4 - txt.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesParaB64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let txt = "";
  for (let i = 0; i < bytes.length; i++) txt += String.fromCharCode(bytes[i]);
  return btoa(txt).split("+").join("-").split("/").join("_").replace(/=+$/, "");
}

/* Grava (ou atualiza) a inscricao deste aparelho. Devolve um rotulo curto pra
   log: ok, demo, sem-sessao, sem-suporte, sem-permissao, sem-chaves ou erro. */
async function registrarPush(token, uid, demo) {
  if (demo) return "demo";
  if (!token || !uid) return "sem-sessao";
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return "sem-suporte";
    if (typeof window === "undefined" || !("PushManager" in window)) return "sem-suporte";
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return "sem-permissao";
    const reg = await navigator.serviceWorker.ready;
    if (!reg || !reg.pushManager) return "sem-suporte";
    let insc = await reg.pushManager.getSubscription();
    // se a chave VAPID mudou, a inscricao antiga nao serve mais
    if (insc && insc.options && insc.options.applicationServerKey) {
      if (bytesParaB64Url(insc.options.applicationServerKey) !== VAPID_PUBLICA) {
        try { await insc.unsubscribe(); } catch {}
        insc = null;
      }
    }
    if (!insc) {
      insc = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64UrlParaBytes(VAPID_PUBLICA) });
    }
    const dados = insc.toJSON ? insc.toJSON() : {};
    const chaves = dados.keys || {};
    if (!insc.endpoint || !chaves.p256dh || !chaves.auth) return "sem-chaves";
    await sbUpsert(token, "push_inscricoes", [{
      usuario_id: uid,
      endpoint: insc.endpoint,
      p256dh: chaves.p256dh,
      auth: chaves.auth,
      aparelho: appInstalado() ? "app na tela de inicio" : "navegador",
      visto_em: new Date().toISOString(),
      falhas: 0
    }], "endpoint");
    return "ok";
  } catch (e) {
    console.warn("[push]", e && e.message);
    return "erro";
  }
}

/* ---------- agenda do RH: o que vence nos proximos dias ----------
   Funcao PURA: recebe as listas e a data de referencia e devolve os itens
   ordenados. Nao consulta o banco e nao grava nada - so calcula prazos que
   o dono da loja costuma perder de vista.
   Bases legais usadas: CLT art. 130/134/137 (ferias e periodo concessivo),
   CLT art. 135 (aviso de 30 dias), CLT art. 168 e NR-7 (exames ocupacionais),
   CLT art. 445 par. unico e 451 (contrato de experiencia). */
const AGENDA_JANELA_DIAS = 120;      // olha 4 meses pra frente
const AGENDA_PCMSO_MESES = 12;       // periodicidade padrao do exame periodico
const AGENDA_MAX_FERIAS_POR_PESSOA = 2;
const EXAMES_QUE_VALEM_COMO_CLINICO = ["admissional", "periodico", "retorno_trabalho", "mudanca_funcao"];

function agendaRH({ usuarios = [], exames = [], ferias = [], hoje = new Date() } = {}) {
  const ref = dataLocal(dataISO(hoje));
  const dias = (dt) => Math.round((dataLocal(dataISO(dt)) - ref) / 86400000);
  const itens = [];
  const juntar = (quando, item) => {
    const d = dias(quando);
    if (d > AGENDA_JANELA_DIAS) return null;
    const reg = { ...item, data: dataISO(quando), dias: d, atrasado: d < 0 };
    itens.push(reg);
    return reg;
  };

  usuarios.filter((u) => u && u.ativo !== false && u.papel !== "gestor").forEach((u) => {
    /* 1) exames ocupacionais */
    const meus = exames.filter((e) => e.userId === u.id && e.data && EXAMES_QUE_VALEM_COMO_CLINICO.indexOf(e.tipo) >= 0);
    const ultimo = meus.slice().sort((a, b) => (a.data < b.data ? 1 : -1))[0];
    if (!ultimo && u.admissao) {
      juntar(dataLocal(u.admissao), {
        assunto: "exame", quem: u.nome, userId: u.id,
        titulo: "Exame admissional não registrado no sistema",
        base: "CLT art. 168, I e NR-7 — o admissional é feito ANTES do início do trabalho",
      });
    } else if (ultimo) {
      juntar(addMeses(dataLocal(ultimo.data), AGENDA_PCMSO_MESES), {
        assunto: "exame", quem: u.nome, userId: u.id,
        titulo: "Exame periódico a vencer",
        detalhe: "último exame clínico em " + fmtData(ultimo.data) + " (" + (ultimo.tipoLabel || ultimo.tipo) + ")",
        base: "NR-7 — a periodicidade real é a do PCMSO da empresa; confirme com o médico do trabalho",
      });
    }

    /* 2) ferias: periodo concessivo (12 meses depois do aquisitivo fechar) */
    if (u.admissao) {
      const minhas = ferias.filter((f) => f.userId === u.id && f.status !== "rejeitada" && f.inicio);
      const pendentes = [];
      let fimAquis = addMeses(dataLocal(u.admissao), 12);
      let guarda = 0;
      while (fimAquis <= ref && guarda++ < 60) {
        const limite = addMeses(fimAquis, 12);
        const gozados = minhas
          .filter((f) => { const i = dataLocal(f.inicio); return i >= fimAquis && i < addMeses(limite, 2); })
          .reduce((s, f) => s + (+f.dias || 0), 0);
        if (gozados < 30) {
          pendentes.push({ limite, gozados, aquisitivoFecha: fimAquis });
        }
        fimAquis = addMeses(fimAquis, 12);
      }
      pendentes
        .sort((a, b) => a.limite - b.limite)
        .slice(0, AGENDA_MAX_FERIAS_POR_PESSOA)
        .forEach((p) => juntar(p.limite, {
          assunto: "ferias", quem: u.nome, userId: u.id,
          titulo: p.gozados > 0
            ? "Faltam " + (30 - p.gozados) + " dia(s) de férias do período que fechou em " + fmtData(dataISO(p.aquisitivoFecha))
            : "Férias do período que fechou em " + fmtData(dataISO(p.aquisitivoFecha)) + " ainda não concedidas",
          base: "CLT art. 134 — conceder dentro dos 12 meses seguintes; passado o prazo, o pagamento é em dobro (art. 137)",
        }));

      /* 3) aviso de ferias com 30 dias de antecedencia */
      minhas
        .filter((f) => f.status === "aprovada" && dataLocal(f.inicio) > ref)
        .forEach((f) => juntar(new Date(dataLocal(f.inicio).getTime() - 30 * 86400000), {
          assunto: "aviso", quem: u.nome, userId: u.id,
          titulo: "Entregar o aviso de férias (início em " + fmtData(f.inicio) + ")",
          base: "CLT art. 135 — aviso por escrito com pelo menos 30 dias de antecedência",
        }));

      /* 4) contrato de experiencia (so pra quem entrou ha pouco) */
      const naCasa = -dias(dataLocal(u.admissao));
      if (naCasa >= 0 && naCasa <= 120) {
        juntar(addMeses(dataLocal(u.admissao), 3), {
          assunto: "experiencia", quem: u.nome, userId: u.id,
          titulo: "Se o contrato for de experiência, ele chega ao limite de 90 dias",
          detalhe: "admissão em " + fmtData(u.admissao) + " · " + naCasa + " dia(s) de casa",
          base: "CLT art. 445, parágrafo único (máx. 90 dias) e art. 451 — a prorrogação é única e precisa ocorrer antes do fim do 1º período",
        });
      }
    }
  });

  itens.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : String(a.quem).localeCompare(String(b.quem))));
  return itens;
}

function urgenciaAgenda(item) {
  if (item.atrasado) return "atrasado";
  if (item.dias <= 30) return "perto";
  return "tranquilo";
}

function prazoEmPalavras(d) {
  if (d < -1) return "atrasado há " + (-d) + " dias";
  if (d === -1) return "venceu ontem";
  if (d === 0) return "vence hoje";
  if (d === 1) return "vence amanhã";
  return "faltam " + d + " dias";
}

/* Agendamento automatico de exames (NR-7 / PCMSO).
   Admissional antes do primeiro dia, periodico na periodicidade do PCMSO e
   demissional junto do desligamento. Esta funcao e pura: calcula o que precisa
   existir e ainda nao existe. Quem grava e o gestor, com um clique. */
const ESOCIAL_JANELA_DIAS = 120;
function examesQueFaltam({ usuarios = [], exames = [], rescisoes = [], hoje = new Date() } = {}) {
  const ref = dataLocal(dataISO(hoje));
  const pend = [];
  const aberto = (uid, tipo) => exames.some((e) => e.userId === uid && e.tipo === tipo && e.status === "agendado");
  usuarios.forEach((u) => {
    if (u.ativo === false) return;
    const clinicos = exames.filter((e) => e.userId === u.id && e.status !== "agendado" && e.data && EXAMES_QUE_VALEM_COMO_CLINICO.includes(e.tipo));
    if (clinicos.length === 0) {
      if (!u.admissao || aberto(u.id, "admissional")) return;
      const d = dataLocal(u.admissao);
      pend.push({ userId: u.id, quem: u.nome, tipo: "admissional", tipoLabel: TIPOS_EXAME.admissional, data: dataISO(d < ref ? ref : d), motivo: "nenhum exame clinico registrado" });
      return;
    }
    if (aberto(u.id, "periodico")) return;
    const ultimo = clinicos.slice().sort((a, b) => (a.data < b.data ? 1 : -1))[0];
    const proximo = addMeses(dataLocal(ultimo.data), AGENDA_PCMSO_MESES);
    if (Math.round((proximo - ref) / 86400000) > AGENDA_JANELA_DIAS) return;
    pend.push({ userId: u.id, quem: u.nome, tipo: "periodico", tipoLabel: TIPOS_EXAME.periodico, data: dataISO(proximo < ref ? ref : proximo), motivo: "ultimo exame clinico em " + ultimo.data });
  });
  rescisoes.forEach((r) => {
    if (!r.dataDeslig || aberto(r.userId, "demissional")) return;
    if (exames.some((e) => e.userId === r.userId && e.tipo === "demissional" && e.status !== "agendado")) return;
    if (pend.some((p) => p.userId === r.userId && p.tipo === "demissional")) return;
    const u = usuarios.find((x) => x.id === r.userId);
    pend.push({ userId: r.userId, quem: u ? u.nome : "colaborador", tipo: "demissional", tipoLabel: TIPOS_EXAME.demissional, data: r.dataDeslig, motivo: "desligamento em " + r.dataDeslig });
  });
  return pend;
}

/* eSocial: a carteira digital e assinada quando o S-2200 e transmitido e a baixa
   acontece com o S-2299. O envio e feito pela contabilidade (ou pelo gestor no
   portal) - o app nao transmite nada. Aqui ele so mostra o que esta em aberto e
   o prazo de cada evento, pra nenhum vencer sem ninguem ver. */
/* Linha digitavel: 48 numeros nas guias de arrecadacao (DARF, GPS, FGTS) e 47 num
   boleto comum. Agrupar em blocos ajuda a conferir numero por numero. */
const agruparLinhaDigitavel = (v) => {
  const so = String(v || "").replace(/\D/g, "");
  const passo = so.length === 48 ? 12 : 4;
  const partes = [];
  for (let i = 0; i < so.length; i += passo) partes.push(so.slice(i, i + passo));
  return partes.join(" ");
};

const EVENTOS_ESOCIAL = {
  S2200: { codigo: "S-2200", nome: "Admissao do trabalhador", base: "enviar ate o dia imediatamente anterior ao inicio das atividades - e o evento que assina a carteira digital" },
  S2299: { codigo: "S-2299", nome: "Desligamento", base: "enviar ate 10 dias corridos do desligamento - e o evento que da baixa na carteira" },
  S2230: { codigo: "S-2230", nome: "Afastamento temporario", base: "atestado acima de 3 dias: ate o dia 15 do mes seguinte (acidente de trabalho e imediato)" },
  S1200: { codigo: "S-1200 / S-1210", nome: "Remuneracao e pagamentos", base: "fechamento mensal: ate o dia 15 do mes seguinte a competencia" },
};
function eventosESocial({ usuarios = [], rescisoes = [], atestados = [], folhasPg = [], hoje = new Date() } = {}) {
  const ref = dataLocal(dataISO(hoje));
  const dias = (dt) => Math.round((dt - ref) / 86400000);
  const dia15 = (d) => { const b = dataLocal(String(d).slice(0, 10)); return new Date(b.getFullYear(), b.getMonth() + 1, 15); };
  const itens = [];
  const juntar = (chave, prazo, extra) => {
    const d = dias(prazo);
    itens.push({ ...EVENTOS_ESOCIAL[chave], chave, prazo: dataISO(prazo), dias: d, atrasado: d < 0, ...extra });
  };
  usuarios.forEach((u) => {
    if (!u.admissao || dias(dataLocal(u.admissao)) < -ESOCIAL_JANELA_DIAS) return;
    juntar("S2200", new Date(dataLocal(u.admissao).getTime() - 86400000), { quem: u.nome, userId: u.id, detalhe: "admissao em " + fmtData(u.admissao) });
  });
  rescisoes.forEach((r) => {
    if (!r.dataDeslig || dias(dataLocal(r.dataDeslig)) < -ESOCIAL_JANELA_DIAS) return;
    const u = usuarios.find((x) => x.id === r.userId);
    juntar("S2299", new Date(dataLocal(r.dataDeslig).getTime() + 10 * 86400000), { quem: u ? u.nome : "colaborador", userId: r.userId, detalhe: "desligamento em " + fmtData(r.dataDeslig) + (r.status === "confirmado" ? "" : " (rascunho)") });
  });
  atestados.forEach((a) => {
    if (a.status !== "aprovado" || !a.data) return;
    const d = String(a.data).slice(0, 10);
    if (dias(dataLocal(d)) < -ESOCIAL_JANELA_DIAS) return;
    const u = usuarios.find((x) => x.id === a.userId);
    juntar("S2230", dia15(d), { quem: u ? u.nome : "colaborador", userId: a.userId, detalhe: "atestado de " + fmtData(d) + " - confira os dias no documento" });
  });
  Array.from(new Set(folhasPg.filter((f) => f.status === "fechada").map((f) => f.competencia))).forEach((c) => {
    const qtd = folhasPg.filter((f) => f.competencia === c && f.status === "fechada").length;
    juntar("S1200", dia15(c), { quem: qtd + " colaborador(es)", detalhe: "folha fechada da competencia " + rotuloComp(c) });
  });
  itens.sort((a, b) => (a.prazo < b.prazo ? -1 : a.prazo > b.prazo ? 1 : 0));
  return itens;
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
/* Paleta. As chaves antigas seguem valendo em todas as telas: o que mudou e
   que "grafite" deixou de ser marrom (era um tom terroso, provavel engano de
   digitacao) e virou o azul-ardosia do tema; e entraram tokens de borda,
   sombra e vidro pra nao ficar cor solta espalhada pelo arquivo. */
const C = { preto: "#0D1B2A", carvao: "#10233B", grafite: "#152840", amarelo: "#FF7A1A", vermelho: "#F87171", verde: "#35C26E", cinza: "#8FA3BF", branco: "#F5F7FA", azul: "#4C9AFF", dourado: "#F5C36B", borda: "#1E3450", bordaForte: "#2A4568", vidro: "rgba(255,255,255,0.04)", sombra: "0 10px 28px rgba(0,0,0,0.30)", sombraForte: "0 18px 44px rgba(0,0,0,0.45)",
  /* Camada de relevo. Um lugar so pra definir "3D": luz no topo (como se a luz
     viesse de cima), corte escuro no pe, e duas sombras de distancia diferente
     — perto pra dar contato e longe pra dar altura. Mudar aqui muda o app todo. */
  luzTopo: "inset 0 1px 0 rgba(255,255,255,0.10)",
  sombra3d: "inset 0 1px 0 rgba(255,255,255,0.10), inset 0 -1px 0 rgba(0,0,0,0.30), 0 2px 4px rgba(0,0,0,0.20), 0 14px 30px -10px rgba(0,0,0,0.52)",
  sombra3dForte: "inset 0 1px 0 rgba(255,255,255,0.14), inset 0 -2px 0 rgba(0,0,0,0.34), 0 4px 10px rgba(0,0,0,0.26), 0 28px 60px -16px rgba(0,0,0,0.64)",
  brilhoLaranja: "0 0 0 1px rgba(255,122,26,0.28), 0 12px 34px -8px rgba(255,122,26,0.45)",
  vidroForte: "rgba(255,255,255,0.075)",
  agua: "#38BDF8" };
/* Estilos base. Mexer aqui muda o app todo de uma vez: cartao, botao e campo
   ganharam profundidade (degrade sutil + sombra) e canto um pouco mais macio. */
const S = {
  /* isolation:isolate faz deste div um contexto proprio de empilhamento. Sem isso
     o brilho animado (#root>div::before, z-index -1 na folha de estilo global)
     ficaria ATRAS deste fundo opaco e ninguem veria nada. */
  app: { minHeight: "100vh", isolation: "isolate", background: "radial-gradient(1100px 520px at 50% -8%, rgba(255,122,26,0.13), transparent 60%), radial-gradient(900px 460px at 8% 4%, rgba(76,154,255,0.09), transparent 62%), radial-gradient(820px 520px at 96% 90%, rgba(56,189,248,0.07), transparent 64%), linear-gradient(180deg, #0F2136, " + C.preto + " 55%, #0A1522), " + C.preto, color: C.branco, fontFamily: "-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',system-ui,sans-serif" },
  display: { fontFamily: "'Oswald','Arial Narrow',-apple-system,'Segoe UI',system-ui,sans-serif", textTransform: "uppercase", letterSpacing: "0.02em", fontWeight: 700 },
  card: { background: "linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.010) 44%, rgba(0,0,0,0.10)), " + C.carvao, border: "1px solid " + C.borda, borderRadius: 18, padding: 20, boxShadow: C.sombra3d },
  btn: { background: "linear-gradient(180deg, #FFA85E, #FF8A2B 46%, #E9620A)", color: "#141007", fontWeight: 800, border: "none", borderRadius: 14, padding: "12px 20px", cursor: "pointer", fontSize: 15, textShadow: "0 1px 0 rgba(255,255,255,0.22)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.45), inset 0 -2px 0 rgba(0,0,0,0.20), 0 8px 20px rgba(255,122,26,0.26), 0 18px 36px -14px rgba(255,122,26,0.38)" },
  btnGhost: { background: "linear-gradient(180deg, " + C.vidroForte + ", rgba(255,255,255,0.015))", color: C.branco, border: "1px solid " + C.bordaForte, borderRadius: 14, padding: "10px 16px", cursor: "pointer", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.07), 0 8px 18px -10px rgba(0,0,0,0.60)" },
  input: { background: C.grafite, border: "1px solid " + C.bordaForte, borderRadius: 14, padding: "12px 14px", color: C.branco, width: "100%", fontSize: 15, boxShadow: "inset 0 2px 6px rgba(0,0,0,0.28)" },
  tag: (bg, fg) => ({ background: bg, color: fg || "#111", borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 700, letterSpacing: "0.03em", display: "inline-block" }),
  /* Cartao de destaque: mais alto que um card comum. */
  heroi: { position: "relative", overflow: "hidden", borderRadius: 22, padding: 28, background: "linear-gradient(180deg, rgba(255,255,255,0.065), rgba(255,255,255,0.010) 42%, rgba(0,0,0,0.14)), " + C.carvao, border: "1px solid " + C.bordaForte, boxShadow: C.sombra3dForte },
  /* Etiqueta redonda de apoio (contadores, status curtos). */
  pilula: { display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999, padding: "5px 12px", fontSize: 12, fontWeight: 700, color: C.branco, background: C.vidroForte, border: "1px solid " + C.bordaForte, boxShadow: C.luzTopo },
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

/* ================= App ================= */
/* ═══════════════════════════════════════════════════════════════
   REDE DE SEGURANÇA — se algum pedaço da tela quebrar, o app mostra um
   aviso legível em vez de ficar com a tela branca. O erro fica só na
   memória do aparelho (nada é enviado pra ninguém) e as batidas já
   gravadas não são afetadas.
   ═══════════════════════════════════════════════════════════════ */
function descreveErro(erro) {
  if (!erro) return "erro desconhecido";
  const nome = erro.name || "Erro";
  const msg = erro.message || String(erro);
  return nome + " - " + msg;
}

class RedeDeSeguranca extends React.Component {
  constructor(props) {
    super(props);
    this.state = { erro: null };
    this.copiar = this.copiar.bind(this);
  }
  static getDerivedStateFromError(erro) { return { erro: erro }; }
  componentDidCatch(erro, info) {
    try { console.error("Ponto Renovar — a tela quebrou:", erro, info && info.componentStack); } catch (e) {}
  }
  copiar() {
    const texto = [
      "Ponto Renovar — falha na tela",
      "quando: " + new Date().toLocaleString("pt-BR"),
      "versão do app: " + ((typeof window !== "undefined" && window.__APP_VERSAO) || "não informada"),
      "erro: " + descreveErro(this.state.erro),
    ].join("\n");
    try { navigator.clipboard.writeText(texto); } catch (e) {}
  }
  render() {
    if (!this.state.erro) return this.props.children;
    return (
      <div style={{ ...S.app, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
        <div style={{ ...S.card, maxWidth: 420, borderLeft: "4px solid " + C.amarelo }}>
          <div style={{ ...S.display, fontSize: 18, color: C.amarelo }}>A tela travou</div>
          <p style={{ fontSize: 13.5, color: C.branco, lineHeight: 1.6, margin: "10px 0 0" }}>
            Deu um problema ao montar esta parte do app. <b>Suas batidas já registradas continuam salvas</b> — nada foi perdido.
          </p>
          <p style={{ fontSize: 12.5, color: C.cinza, lineHeight: 1.6, margin: "8px 0 0" }}>
            Recarregue para voltar. Se travar de novo, copie os detalhes e mande pro gestor — assim dá pra corrigir a causa.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
            <button style={{ ...S.btn }} onClick={() => { try { window.location.reload(); } catch (e) {} }}>Recarregar o app</button>
            <button style={{ ...S.btnGhost, fontSize: 12.5 }} onClick={this.copiar}>Copiar detalhes</button>
          </div>
          <p style={{ fontSize: 11, color: C.cinza, margin: "12px 0 0", lineHeight: 1.5, wordBreak: "break-word" }}>
            [ref: {descreveErro(this.state.erro)}]
          </p>
        </div>
      </div>
    );
  }
}

/* O App exportado é só a casca protegida: quem monta as telas é o AppInterno. */
export default function App() {
  return (
    <RedeDeSeguranca>
      <AppInterno />
    </RedeDeSeguranca>
  );
}

function AppInterno() {
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
   const [rescisoes, setRescisoes] = useState([]);
   const [examesOcupacionais, setExamesOcupacionais] = useState([]);
  const [candidatos, setCandidatos] = useState([]); // recrutamento: curriculo e etapas
  const [documentosRH, setDocumentosRH] = useState([]); // pasta de documentos por pessoa
  const [rankingUsuarios, setRankingUsuarios] = useState([]); // nomes públicos p/ ranking de gamificação (todos veem)
  const [credenciais, setCredenciais] = useState([]); // credenciais WebAuthn (dados públicos)
  const [consImagem, setConsImagem] = useState([]); // termo de imagem: ciência do CFTV + autorização pra divulgação
  const [aceites, setAceites] = useState([]); // aceites do codigo de conduta e do espelho mensal
  /* Combinados e link da sala: tabelas opcionais. Enquanto elas nao existirem
     no banco, acoesNoBanco fica falso e tudo continua no localStorage. */
  const [acoes, setAcoes] = useState([]);
  const [acoesNoBanco, setAcoesNoBanco] = useState(false);
  const [salas, setSalas] = useState(() => salasLer());
  const [semente, setSemente] = useState("");
  /* Presenca na chamada: tabela opcional. Sem ela o botao de entrar continua
     funcionando, so nao aparece quem ja esta la dentro. */
  const [presencas, setPresencas] = useState([]);
  const [presencaNoBanco, setPresencaNoBanco] = useState(false);
  const batidaSala = useRef(null);
  /* Mural, elogios, motivadores e anjo tambem moram em tabelas opcionais. Um
     objeto so guarda a lista e o "isto esta no banco?" de cada ritual, entao
     nenhuma tela precisa perguntar de onde o dado veio. */
  const [rit, setRit] = useState(() => ritVazio());
  const mudarRit = (p) => setRit((r) => ({ ...r, ...p }));
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
  const [tela, setTela] = useState(telaInicial);
  const [fluxoPonto, setFluxoPonto] = useState(null);
  const [geo, setGeo] = useState(null);
  const [comprovante, setComprovante] = useState(null);
  const [relogio, setRelogio] = useState(new Date());
  const [salvando, setSalvando] = useState(false);
  const [erroDados, setErroDados] = useState(null);
  /* O service worker avisa quando acabou de baixar uma versao nova do app
     (ATUALIZACAO_PRONTA). Nao recarregamos sozinhos: quem esta batendo ponto
     nao pode ter a tela trocada no meio - quem escolhe a hora e o usuario. */
  const [atualizacaoPronta, setAtualizacaoPronta] = useState(false);
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const ouvir = (ev) => { if (ev.data && ev.data.tipo === "ATUALIZACAO_PRONTA") setAtualizacaoPronta(true); };
    navigator.serviceWorker.addEventListener("message", ouvir);
    return () => navigator.serviceWorker.removeEventListener("message", ouvir);
  }, []);

  /* Este tick nao serve pra mostrar as horas (quem mostra e o componente do
     relogio, que se atualiza sozinho): ele so mantem frescas as contas que
     olham o "agora" durante o render. 20s em vez de 1s = 20x menos re-render. */
  useEffect(() => { const t = setInterval(() => setRelogio(new Date()), 20000); return () => clearInterval(t); }, []);

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
    setTela(telaInicial());   // respeita o atalho ./?ir=<tela> da tela de inicio
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
          const [marcsCompleto, flts, justs, ates, fers, auds, convs, flgs, fpgs, adts, gfs, rkg, remun, rescs, exms] = await Promise.all([
            sbSelect(token, "marcacoes", "select=*&order=nsr"), // histórico completo: AFD/AEJ e relatórios exigem o período inteiro
            sbSelect(token, "faltas", "select=*&order=data"),
            sbSelect(token, "justificativas", "select=*&order=criado_em.desc"),
            sbSelect(token, "atestados", "select=*&order=criado_em.desc"),
            sbSelect(token, "ferias", "select=*&order=criado_em.desc"),
            perfil.papel === "gestor" ? sbSelect(token, "auditoria", "select=*&order=ts.desc&limit=300") : Promise.resolve([]),
            perfil.papel === "gestor" ? sbSelect(token, "convites", "select=*&order=criado_em.desc") : Promise.resolve([]),
            sbSelect(token, "solicitacoes_folga", "select=*&order=criado_em.desc"),
            sbSelect(token, "folha_pagamento", "select=*&order=competencia.desc"), // RLS entrega só a própria folha ao colaborador
            sbSelect(token, "adiantamentos_salariais", "select=*&order=criado_em.desc"),
            perfil.papel === "gestor" ? sbSelect(token, "guias_fiscais", "select=*&order=competencia.desc") : Promise.resolve([]),
            sbSelect(token, "ranking_pontos_publico", "select=*"),
            perfil.papel === "gestor" ? sbSelect(token, "usuarios_remuneracao", "select=*") : Promise.resolve([]),
             sbSelect(token, "rescisoes", "select=*&order=criado_em.desc"),
             sbSelect(token, "exames_ocupacionais", "select=*&order=criado_em.desc"),
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
           setRescisoes(rescs.map(mapRescisao));
           setExamesOcupacionais(exms.map(mapExame));
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
      // Termo de imagem: tabela opcional (consentimentos_imagem). Se ainda nao existir no
      // banco, o carregamento principal nao pode quebrar por causa disso.
      (async () => {
        try {
          const rows = await sbSelect(token, "consentimentos_imagem", "select=*");
          setConsImagem(rows.map(mapConsImagem));
        } catch (e) { console.warn("[termo de imagem]", e.message); }
      })();
      // Aceites (codigo de conduta e espelho mensal): tabela opcional (aceites).
      // Enquanto nao existir no banco, o app segue funcionando sem trilha de aceite.
      (async () => {
        try {
          const rows = await sbSelect(token, "aceites", "select=*");
          setAceites(rows.map(mapAceite));
        } catch (e) { console.warn("[aceites]", e.message); }
      })();
      // Combinados das reunioes: tabela opcional (combinados). Sem ela o app
      // volta pro caderno local do aparelho, que foi como a primeira versao saiu.
      (async () => {
        try {
          setAcoes(await combinadosBaixar(token));
          setAcoesNoBanco(true);
        } catch (e) {
          console.warn("[combinados]", e.message);
          setAcoes(acoesLer(perfil.id));
          setAcoesNoBanco(false);
        }
      })();
      // Link da sala de videochamada: tabela opcional (config_time). O gestor
      // grava uma vez e o time inteiro passa a ver o mesmo link.
      (async () => {
        try {
          const cfg = await configBaixar(token);
          const temSala = !!cfg.sala_video || SALAS_RITUAIS.filter((k) => cfg[chaveSalaNoBanco(k)]).length > 0;
          if (temSala) {
            const mapa = { geral: cfg.sala_video || "" };
            SALAS_RITUAIS.forEach((k) => { mapa[k] = cfg[chaveSalaNoBanco(k)] || ""; });
            setSalas(salasGravar(mapa));
          }
          if (cfg.sala_semente) setSemente(String(cfg.sala_semente));
        } catch (e) { console.warn("[config do time]", e.message); }
      })();
      // Mural, elogios, motivadores e anjo: tabelas opcionais tambem. Cada uma
      // cai sozinha pro aparelho se nao existir - uma nao derruba as outras.
      (async () => {
        try {
          mudarRit({ conquistas: await conquistasBaixar(token), conquistasNoBanco: true });
        } catch (e) {
          console.warn("[conquistas]", e.message);
          mudarRit({ conquistas: conquistasLer(perfil.id), conquistasNoBanco: false });
        }
      })();
      (async () => {
        try {
          mudarRit({ elogios: await elogiosBaixar(token), elogiosNoBanco: true });
        } catch (e) {
          console.warn("[elogios]", e.message);
          mudarRit({ elogios: elogiosLer(perfil.id), elogiosNoBanco: false });
        }
      })();
      (async () => {
        try {
          mudarRit({ motivadores: await motivadoresBaixar(token), motivaNoBanco: true });
        } catch (e) { console.warn("[motivadores]", e.message); }
      })();
      // O par do anjo vem numa consulta separada: a policy so devolve a linha
      // de quem esta perguntando, entao ninguem baixa a lista dos outros.
      (async () => {
        try {
          const rodada = await anjoRodadaAtual(token, dataISO(new Date()));
          if (!rodada) { mudarRit({ anjo: null, anjoNoBanco: true }); return; }
          const protegido = await anjoProtegidoDaRodada(token, rodada.id);
          mudarRit({ anjo: { inicio: rodada.inicio, fim: rodada.fim, protegido }, anjoNoBanco: true });
        } catch (e) {
          console.warn("[anjo]", e.message);
          mudarRit({ anjo: anjoLer(perfil.id), anjoNoBanco: false });
        }
      })();
      // Atas das reunioes: tabela opcional (atas). Sem ela a ata do dia fica
      // no aparelho de quem encerrou a reuniao, e a tela avisa isso.
      (async () => {
        try {
          mudarRit({ atas: await atasBaixar(token), atasNoBanco: true });
        } catch (e) {
          console.warn("[atas]", e.message);
          mudarRit({ atas: atasLer(perfil.id), atasNoBanco: false });
        }
      })();
      // As tres perguntas: tabela opcional (respostas). Sem ela cada pessoa ve
      // somente a propria resposta, guardada no proprio aparelho.
      (async () => {
        try {
          mudarRit({ respostas: await respostasBaixar(token), respostasNoBanco: true });
        } catch (e) {
          console.warn("[respostas]", e.message);
          mudarRit({ respostas: [], respostasNoBanco: false });
        }
      })();
      // Recrutamento e documentos: tabelas opcionais (candidatos, documentos_rh).
      // Sem elas o painel mostra o aviso com o SQL, e o resto do app nao sente.
      (async () => {
        try {
          const rows = await sbSelect(token, "candidatos", "select=*&order=criado_em.desc");
          setCandidatos(rows.map(mapCandidato));
        } catch (e) { console.warn("[candidatos]", e.message); }
      })();
      (async () => {
        try {
          const rows = await sbSelect(token, "documentos_rh", "select=*&order=criado_em.desc");
          setDocumentosRH(rows.map(mapDocumento));
        } catch (e) { console.warn("[documentos rh]", e.message); }
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
    setConsImagem(CONS_IMAGEM_SEED); setAceites(ACEITES_SEED);
    setRankingUsuarios(USUARIOS_SEED.map(u => { const gg = calcularGamificacao(u.id, REGISTROS_SEED, FALTAS_SEED.map((f, i) => ({ id: i, ...f, justificada: false }))); return { id: u.id, nome: u.nome, papel: u.papel, pontos: gg.total, streak: gg.streak }; }));
    const fdsDemo = [{ data: "2026-01-01", nome: "Confraternização Universal" }, { data: "2026-09-07", nome: "Independência do Brasil" }, { data: "2026-12-25", nome: "Natal" }];
    setFeriadosGlobal(fdsDemo); setFeriados(fdsDemo);
    setLogs([{ ts: iso(new Date()), userId: "sistema", acao: "boot", detalhe: "Modo demonstração (dados locais, nada é persistido)" }]);
    setUser(u); setTela(telaInicial());
  };

  const sair = () => {
    setUser(null); setSessao(null); setDemo(false);
    setAcoes([]); setAcoesNoBanco(false); setRit(ritVazio());
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
    try { const p = await Notification.requestPermission(); setNotifStatus(p);
      if (p === "granted") registrarPush(sessao?.token, user?.id, demo); } catch { setNotifStatus("denied"); }
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
        if (notifStatus === "granted") notificarAparelho(titulo, corpo, id + "-" + chaveDia);
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
  /* Inscreve o aparelho no push de servidor. Roda no login e quando a
     permissao de aviso muda; se o navegador trocar a inscricao sozinho, a
     proxima abertura do app regrava. */
  useEffect(() => {
    if (!user || demo || notifStatus !== "granted") return;
    registrarPush(sessao?.token, user.id, demo);
  }, [user, sessao, notifStatus, demo]);

  /* ---------- combinados das reunioes ----------
     Com a tabela no banco o combinado vale pro time todo; sem ela cai de
     volta pro aparelho. As duas rotas devolvem a mesma lista pra tela, entao
     nenhuma parte da UI precisa saber onde o dado foi parar. */
  const criarCombinado = async (acao) => {
    if (demo || !acoesNoBanco) {
      const lista = [acao].concat(acoes);
      if (!demo) acoesGravar(user.id, lista);
      setAcoes(lista);
      return;
    }
    const alvo = usuarios.filter((u) => u.nome === acao.dono)[0];
    const salva = await combinadoInserir(sessao.token, user.id, acao, alvo ? alvo.id : null);
    setAcoes((l) => [salva].concat(l));
  };
  const alternarCombinado = async (id) => {
    const alvo = acoes.filter((a) => a.id === id)[0];
    if (!alvo) return;
    const feito = !alvo.feito;
    const feitoEm = feito ? new Date().toISOString() : "";
    if (!demo && acoesNoBanco) await combinadoMarcar(sessao.token, id, feito);
    const lista = acoes.map((a) => (a.id === id ? { ...a, feito, feitoEm } : a));
    if (!demo && !acoesNoBanco) acoesGravar(user.id, lista);
    setAcoes(lista);
  };
  /* Sala de videochamada: o gestor grava e a frase de volta diz, sem enfeite,
     se o time inteiro passou a enxergar ou se ficou so neste aparelho. */
  /* Quem esta na sala agora. Tabela opcional (presenca_chamada): se ela nao
     existir o app so deixa de mostrar a lista, e o botao de entrar continua
     igual. So pergunta em dia de reuniao, para nao bater no banco a toa. */
  useEffect(() => {
    if (demo || !sessao || !sessao.token || !user) return;
    if (!reunioesDoDia(new Date()).length) return;
    let vivo = true;
    let timer = null;
    let avisou = false;
    const puxar = async () => {
      try {
        const lista = await presencaBaixar(sessao.token, dataISO(new Date()));
        if (!vivo) return;
        setPresencas(lista);
        setPresencaNoBanco(true);
      } catch (e) {
        if (!vivo) return;
        if (!avisou) { avisou = true; console.warn("[presenca]", e.message); }
        setPresencaNoBanco(false);
        if (timer) { clearInterval(timer); timer = null; }
      }
    };
    puxar();
    timer = setInterval(puxar, 60000);
    return () => { vivo = false; if (timer) clearInterval(timer); };
  }, [demo, sessao && sessao.token, user && user.id]);

  /* Salas de videochamada. Cada ritual pode ter a sua; o campo geral e a
     reserva de quem nao tem. A frase de volta diz, sem enfeite, se o time
     inteiro passou a enxergar ou se ficou so neste aparelho. */
  const salvarSalas = async (mapa, sementeNova) => {
    const antes = mapa || {};
    const invalidos = Object.keys(antes)
      .filter((k) => String(antes[k] || "").trim() && !salaValida(String(antes[k]).trim()));
    const limpo = salasGravar(antes);
    setSalas(limpo);
    if (invalidos.length) return "Endereço inválido: " + invalidos.length + " campo(s) não foram salvos.";
    if (demo) return "Demonstração: nada é gravado de verdade.";
    try {
      await configGravar(sessao.token, user.id, "sala_video", limpo.geral || "");
      for (const k of SALAS_RITUAIS) {
        await configGravar(sessao.token, user.id, chaveSalaNoBanco(k), limpo[k] || "");
      }
      if (sementeNova) {
        await configGravar(sessao.token, user.id, "sala_semente", sementeNova);
        setSemente(sementeNova);
      }
      return "Salas salvas — o time inteiro passa a ver os mesmos endereços.";
    } catch (e) {
      return "Salvo só neste aparelho. " + mensagemAmigavel(e, "ao gravar no banco");
    }
  };

  /* Entrar na sala: abre a chamada e passa a bater a propria presenca a cada
     quatro minutos enquanto esta aba continuar aberta, no maximo por duas
     horas. Fechou a aba, a batida para, e em oito minutos a pessoa some da
     lista sozinha. Isto e para o time saber quem ja chegou, nunca para virar
     controle de frequencia: o app nao guarda quem faltou na chamada. */
  const entrarNaSala = (ritualId, url) => {
    const abriu = abrirSala(url);
    if (demo || !sessao || !sessao.token || !user) return abriu;
    const diaIso = dataISO(new Date());
    let restam = 30;
    const parar = () => {
      if (batidaSala.current) { clearInterval(batidaSala.current); batidaSala.current = null; }
    };
    const bater = async () => {
      try {
        await presencaBater(sessao.token, user.id, user.nome, diaIso, ritualId);
        setPresencaNoBanco(true);
        setPresencas((lista) => (lista || [])
          .filter((x) => !(String(x.usuarioId) === String(user.id) && x.ritualId === ritualId && x.dia === diaIso))
          .concat([{ usuarioId: user.id, nome: user.nome, ritualId, dia: diaIso, vistoEm: new Date().toISOString() }]));
      } catch (e) {
        console.warn("[presenca]", e.message);
        setPresencaNoBanco(false);
        parar();
        return;
      }
      if (--restam <= 0) parar();
    };
    parar();
    bater();
    batidaSala.current = setInterval(bater, 240000);
    return abriu;
  };

  /* ---------- rituais do time: mural, elogios, motivadores e anjo ----------
     Mesma ideia dos combinados: com a tabela no banco o registro vale pro time
     inteiro; sem ela cai pro aparelho de quem escreveu. Quem chama daqui de
     dentro nao precisa saber a diferenca. */
  const publicarConquista = async (texto, tipo) => {
    const item = conquistaNova(texto, tipo, user.nome, user.id);
    if (demo || !rit.conquistasNoBanco) {
      const lista = [item].concat(rit.conquistas);
      if (!demo) conquistasGravar(user.id, lista);
      mudarRit({ conquistas: lista });
      return;
    }
    const salva = await conquistaInserir(sessao.token, user.id, user.nome, item);
    setRit((r) => ({ ...r, conquistas: [salva].concat(r.conquistas) }));
  };
  const registrarElogio = async (alvo, texto) => {
    const item = elogioNovo(texto, user.nome, user.id, alvo.nome, alvo.id, "circulo");
    if (demo || !rit.elogiosNoBanco) {
      const lista = [item].concat(rit.elogios);
      if (!demo) elogiosGravar(user.id, lista);
      mudarRit({ elogios: lista });
      return;
    }
    const salvo = await elogioInserir(sessao.token, user.id, user.nome, item);
    setRit((r) => ({ ...r, elogios: [salvo].concat(r.elogios) }));
  };
  /* Guardar e compartilhar sao coisas diferentes de proposito: o texto so sobe
     pro banco quando a pessoa aperta o botao que avisa que a lideranca le. */
  const salvarMotivadores = async (fatores, compartilhar) => {
    motivaGravar(user.id, fatores);
    if (!compartilhar) return "Guardado só neste aparelho.";
    if (demo) return "Demonstração: nada é gravado de verdade.";
    try {
      await motivadorGravar(sessao.token, user.id, user.nome, fatores);
      const limpos = (fatores || []).map((x) => String(x || "").trim()).filter(Boolean);
      setRit((r) => ({
        ...r,
        motivaNoBanco: true,
        motivadores: r.motivadores.filter((m) => m.userId !== user.id).concat(
          limpos.length ? [{ userId: user.id, nome: user.nome, fatores: limpos, atualizadoEm: new Date().toISOString() }] : []),
      }));
      return limpos.length ? "Compartilhado com a liderança." : "Compartilhamento desfeito.";
    } catch (e) {
      return "Guardado só neste aparelho: " + mensagemAmigavel(e, "ao gravar no banco");
    }
  };
  /* O gestor abre a rodada; o sorteio acontece aqui e sobe sem devolver a
     lista. Depois o app pergunta de volta so o par de quem esta logado. */
  const sortearAnjoRodada = async (inicio, fim) => {
    if (!inicio || !fim || fim < inicio) return "Confira as datas: o fim não pode ser antes do início.";
    const ativos = usuarios.filter((u) => u && u.ativo !== false);
    if (ativos.length < 2) return "Precisa de pelo menos duas pessoas ativas pra sortear.";
    if (demo || !rit.anjoNoBanco) {
      const pares = sortearAnjos(ativos.map((u) => u.id));
      const meu = pares.filter((p) => p.anjo === user.id)[0];
      const alvo = meu ? ativos.filter((u) => u.id === meu.protegido)[0] : null;
      const dados = { inicio, fim, protegido: alvo ? alvo.nome : "" };
      if (!demo) anjoGravar(user.id, dados);
      mudarRit({ anjo: dados });
      return demo ? "Demonstração: o sorteio ficou só nesta tela." : "Sorteio feito só neste aparelho: as tabelas do anjo ainda não existem no banco.";
    }
    await anjoSortear(sessao.token, user.id, ativos, inicio, fim);
    const rodada = await anjoRodadaAtual(sessao.token, dataISO(new Date()));
    const protegido = rodada ? await anjoProtegidoDaRodada(sessao.token, rodada.id) : "";
    mudarRit({ anjo: rodada ? { inicio: rodada.inicio, fim: rodada.fim, protegido } : null });
    return "Rodada aberta. Cada pessoa enxerga só quem ela cuida.";
  };
  /* As tres perguntas. Guarda sempre no aparelho primeiro - se o banco estiver
     fora, a pessoa nao perde o texto que acabou de escrever - e depois tenta
     subir. O retorno e a frase que a tela mostra, sem enfeite. */
  const responderPerguntas = async (ritualId, resp) => {
    const diaIso = dataISO(new Date());
    respostasGravar(user.id, diaIso, resp);
    if (demo) return "Demonstração: nada é gravado de verdade.";
    if (!rit.respostasNoBanco) return "Guardado só neste aparelho: a tabela respostas ainda não existe no banco.";
    try {
      await respostaSubir(sessao.token, user.id, user.nome, diaIso, ritualId, resp);
      const minha = {
        id: user.id + "_" + diaIso + "_" + ritualId,
        data: diaIso, ritualId: ritualId,
        entreguei: String(resp.entreguei || ""), foco: String(resp.foco || ""),
        impedimento: String(resp.impedimento || ""),
        autor: user.nome, autorId: user.id, atualizadoEm: new Date().toISOString(),
      };
      setRit((r) => ({
        ...r,
        respostas: (r.respostas || []).filter((x) => !(x.autorId === user.id && x.data === diaIso && x.ritualId === ritualId)).concat([minha]),
      }));
      return "O time já vê suas respostas.";
    } catch (e) {
      return "Guardado só neste aparelho: " + mensagemAmigavel(e, "ao enviar suas respostas");
    }
  };
  /* A ata sai pronta do proprio app: ele ja sabe o ritual, o dia, quem bateu
     ponto e quais combinados nasceram naquela reuniao. Ninguem digita resumo,
     porque resumo digitado a mao e a primeira coisa que o time abandona. */
  const gerarAta = async (ritual, diaIso) => {
    const participantes = participantesDoDia(usuarios, registros, diaIso);
    const combinados = combinadosDaReuniao(acoes, ritual.nome, diaIso);
    const numeros = ritual.id === "mensal"
      ? numerosDoMes(usuarios, registros, faltas, acoes, compAnterior(compDe(new Date())))
      : null;
    /* A ata leva o que o time respondeu naquele dia: sem isso ela viraria uma
       lista de tarefas sem contexto, e em dois meses ninguem lembra o porque. */
    const respostas = respostasDoDia(rit.respostas || [], diaIso, ritual.id);
    /* Marca quem ja tinha pedido a mesma ajuda na reuniao anterior deste
       ritual. Sem isso a ata de cada mes parece um problema novo. */
    const travados = {};
    impedimentosTravados(rit.respostas || [], ritual.id, diaIso).forEach((x) => { travados[chaveAutorResposta(x)] = true; });
    const respostasAta = respostas.map((r) => ({ ...r, travado: !!travados[chaveAutorResposta(r)] }));
    const nova = ataNova(ritual, diaIso, participantes, combinados, numeros, user.nome, user.id, respostasAta);
    if (demo || !rit.atasNoBanco) {
      if (!demo) atasGravar(user.id, [nova].concat(rit.atas || []));
      mudarRit({ atas: [nova].concat(rit.atas || []) });
      return;
    }
    const gravada = await ataInserir(sessao.token, user.id, user.nome, nova);
    mudarRit({ atas: [gravada].concat((rit.atas || []).filter((a) => a.id !== gravada.id)) });
  };
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
      salario_bruto: novo.salario,
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

  /* ---------- rescisao e exames ocupacionais (gestor) ---------- */
   const criarRescisao = async (dados) => {
      if (!uuidValido(dados.userId) && !demo) throw new Error("Colaborador invalido.");
      if (!dataValida(dados.dataDeslig)) throw new Error("Data de desligamento invalida.");
      if (!MOTIVOS_RESCISAO[dados.motivo]) throw new Error("Motivo de desligamento invalido.");
      const u = usuarios.find(x => x.id === dados.userId);
      if (!u) throw new Error("Colaborador nao encontrado.");
      const motivoInfo = MOTIVOS_RESCISAO[dados.motivo];
      const avisoTipo = motivoInfo.avisoDevido ? (dados.avisoTipo === "indenizado" ? "indenizado" : "trabalhado") : null;
      const calc = calcRescisao(u, dados.dataDeslig, dados.motivo, avisoTipo);
      const linha = {
         usuario_id: u.id, data_desligamento: dados.dataDeslig, motivo: dados.motivo, aviso_tipo: avisoTipo,
         calculo: calc, total_proventos: calc.totalProventos, total_descontos: calc.totalDescontos, valor_liquido: calc.liquido,
         status: "rascunho", criado_por: user.id,
      };
      let novo;
      if (demo) novo = mapRescisao({ id: `r${Date.now()}`, ...linha, criado_em: iso(new Date()) });
      else { const [row] = await sbInsert(sessao.token, "rescisoes", [linha]); novo = mapRescisao(row); }
      setRescisoes(rs => [novo, ...rs]);
      try { await auditar("rescisao_criada", `${user.nome} calculou rescisao de ${u.nome} - motivo: ${motivoInfo.label} - desligamento ${fmtData(dados.dataDeslig)} - liquido estimado ${brl(calc.liquido)} (rascunho)`); }
      catch (e) { setErroDados(`Calculo salvo, mas a trilha de auditoria falhou (${mensagemAmigavel(e)}).`); }
      // O demissional entra na agenda sozinho: a NR-7 exige ASO no desligamento.
      await agendarExameAuto({ userId: u.id, tipo: "demissional", data: dados.dataDeslig, observacao: "Agendado automaticamente pela rescisao" });
      return novo;
   };
   
   const confirmarRescisao = async (id) => {
      const r = rescisoes.find(x => x.id === id);
      if (!r || r.status !== "rascunho") return;
      const agora = iso(new Date());
      if (!demo) await sbUpdate(sessao.token, "rescisoes", `id=eq.${id}`, { status: "confirmado", confirmado_em: agora });
      setRescisoes(rs => rs.map(x => x.id === id ? { ...x, status: "confirmado", confirmadoEm: agora } : x));
      try { await salvarUsuario(r.userId, { ativo: false }); } catch (e) { setErroDados(`Rescisao confirmada, mas a desativacao do cadastro falhou (${mensagemAmigavel(e)}) - desative manualmente em Equipe.`); }
      const nomeCol = usuarios.find(u => u.id === r.userId)?.nome || r.userId;
      try { await auditar("rescisao_confirmada", `${user.nome} CONFIRMOU a rescisao de ${nomeCol} - liquido ${brl(r.liquido)} - colaborador desativado`); }
      catch (e) { setErroDados(`Rescisao confirmada, mas a trilha de auditoria falhou (${mensagemAmigavel(e)}).`); }
   };
   
   const criarExame = async (dados) => {
      if (!uuidValido(dados.userId) && !demo) throw new Error("Colaborador invalido.");
      if (!TIPOS_EXAME[dados.tipo]) throw new Error("Tipo de exame invalido.");
      if (!dataValida(dados.data)) throw new Error("Data do exame invalida.");
      if (dados.resultado && !RESULTADOS_EXAME[dados.resultado]) throw new Error("Resultado de exame invalido.");
      const clinica = limparTexto(dados.clinica, LIMITES.nome) || null;
      const observacao = limparTexto(dados.observacao, LIMITES.obs) || null;
      const path = dados.anexo ? await sbUpload(sessao.token, dados.userId, dados.anexo) : null;
      const linha = { usuario_id: dados.userId, tipo: dados.tipo, data_exame: dados.data, resultado: dados.resultado || null, clinica, anexo_url: path, observacao, criado_por: user.id };
      let novo;
      if (demo) novo = mapExame({ id: `ex${Date.now()}`, ...linha, criado_em: iso(new Date()) });
      else { const [row] = await sbInsert(sessao.token, "exames_ocupacionais", [linha]); novo = mapExame(row); }
      setExamesOcupacionais(ex => [novo, ...ex]);
      const nomeCol = usuarios.find(u => u.id === dados.userId)?.nome || dados.userId;
      try { await auditar("exame_ocupacional_criado", `${user.nome} registrou exame ${TIPOS_EXAME[dados.tipo]} de ${nomeCol}${dados.resultado ? ` - resultado: ${RESULTADOS_EXAME[dados.resultado]}` : " - resultado pendente"}`); }
      catch (e) { setErroDados(`Exame registrado, mas a trilha de auditoria falhou (${mensagemAmigavel(e)}).`); }
      // Exame clinico lancado: o proximo periodico ja nasce agendado (PCMSO).
      if (EXAMES_QUE_VALEM_COMO_CLINICO.includes(dados.tipo) && dados.resultado && dados.resultado !== "inapto") {
         await agendarExameAuto({ userId: dados.userId, tipo: "periodico", data: dataISO(addMeses(dataLocal(dados.data), AGENDA_PCMSO_MESES)), observacao: "Proximo periodico agendado automaticamente (PCMSO)" });
      }
      return novo;
   };
   
   /* ---------- recrutamento, documentos e agenda de exame ---------- */
   // O curriculo e os documentos vao pro bucket privado. O candidato nao tem
   // login, entao o arquivo dele fica na pasta do gestor que subiu — e so o
   // gestor abre. Documento nunca e apagado por aqui: some do painel, fica no banco.
   const registrarDocumento = async (dados) => {
     if (!dados.tipo || !TIPOS_DOCUMENTO[dados.tipo]) throw new Error("Escolha o tipo do documento.");
     if (!dados.userId && !dados.candidatoId) throw new Error("Escolha de quem é o documento.");
     const path = dados.path || (dados.arquivo ? await sbUpload(sessao.token, user.id, dados.arquivo) : null);
     if (!path) throw new Error("Anexe o arquivo do documento.");
     const linha = { usuario_id: dados.userId || null, candidato_id: dados.candidatoId || null, tipo: dados.tipo, arquivo_url: path, nome_original: (dados.nomeOriginal || dados.arquivo?.name || "").slice(0, 180) || null, observacao: limparTexto(dados.observacao, LIMITES.obs) || null, criado_por: user.id };
     let novo;
     if (demo) novo = mapDocumento({ id: `d${Date.now()}`, ...linha, criado_em: iso(new Date()) });
     else { const [row] = await sbInsert(sessao.token, "documentos_rh", [linha]); novo = mapDocumento(row); }
     setDocumentosRH((ds) => [novo, ...ds]);
     const dono = dados.userId ? (usuarios.find((u) => u.id === dados.userId)?.nome || "colaborador") : (candidatos.find((c) => c.id === dados.candidatoId)?.nome || "candidato");
     try { await auditar("documento_anexado", `${user.nome} anexou ${TIPOS_DOCUMENTO[dados.tipo]} de ${dono}`); }
     catch (e) { console.warn("[auditoria documento]", e.message); }
     return novo;
   };

   const abrirDocumento = async (path) => {
     if (demo) throw new Error("Na demonstração os arquivos são fictícios: não há nada pra abrir.");
     const url = await sbUrlAssinada(sessao.token, path);
     window.open(url, "_blank", "noopener,noreferrer");
   };

   const criarCandidato = async (dados) => {
     const nome = limparTexto(dados.nome, LIMITES.nome);
     if (!nome || nome.length < 2) throw new Error("Informe o nome do candidato.");
     const email = limparTexto(dados.email, LIMITES.email).toLowerCase();
     if (email && !emailValido(email)) throw new Error("E-mail do candidato inválido.");
     const path = dados.curriculo ? await sbUpload(sessao.token, user.id, dados.curriculo) : null;
     const linha = { nome, email: email || null, telefone: limparTexto(dados.telefone, 40) || null, cargo: limparTexto(dados.cargo, LIMITES.cargo) || null, origem: limparTexto(dados.origem, LIMITES.cargo) || null, status: "recebido", curriculo_url: path, observacao: limparTexto(dados.observacao, LIMITES.obs) || null, criado_por: user.id };
     let novo;
     if (demo) novo = mapCandidato({ id: `c${Date.now()}`, ...linha, criado_em: iso(new Date()), atualizado_em: iso(new Date()) });
     else { const [row] = await sbInsert(sessao.token, "candidatos", [linha]); novo = mapCandidato(row); }
     setCandidatos((cs) => [novo, ...cs]);
     if (path) { try { await registrarDocumento({ candidatoId: novo.id, tipo: "curriculo", path, nomeOriginal: dados.curriculo.name }); } catch (e) { console.warn("[curriculo na pasta]", e.message); } }
     try { await auditar("candidato_criado", `${user.nome} cadastrou o candidato ${nome}${linha.cargo ? " para " + linha.cargo : ""}${path ? " com currículo anexado" : " sem currículo"}`); }
     catch (e) { console.warn("[auditoria candidato]", e.message); }
     return novo;
   };

   const mudarStatusCandidato = async (id, status) => {
     if (!STATUS_CANDIDATO[status]) throw new Error("Etapa inválida.");
     const agora = iso(new Date());
     if (!demo) await sbUpdate(sessao.token, "candidatos", `id=eq.${id}`, { status, atualizado_em: agora });
     setCandidatos((cs) => cs.map((c) => c.id === id ? { ...c, status, statusLabel: STATUS_CANDIDATO[status], atualizadoEm: agora } : c));
     const c = candidatos.find((x) => x.id === id);
     try { await auditar("candidato_etapa", `${user.nome} moveu ${c?.nome || id} para ${STATUS_CANDIDATO[status]}`); }
     catch (e) { console.warn("[auditoria etapa]", e.message); }
   };

   // Contratar = criar o convite ja com os dados do candidato. O acesso nasce
   // quando a pessoa usa o convite e escolhe a propria senha: o app nunca
   // cria conta por ela nem guarda senha de ninguem.
   const contratarCandidato = async (cand, dados) => {
     const conv = await criarConvite({ nome: cand.nome, email: dados.email || cand.email, cargo: dados.cargo || cand.cargo, tipo: "colaborador", dataAdmissao: dados.dataAdmissao });
     await mudarStatusCandidato(cand.id, "contratado");
     return conv;
   };

   // Exame agendado: data prevista, sem resultado. Vira realizado quando o ASO chega.
   const agendarExame = async (dados) => {
     if (!uuidValido(dados.userId) && !demo) throw new Error("Colaborador inválido.");
     if (!TIPOS_EXAME[dados.tipo]) throw new Error("Tipo de exame inválido.");
     if (!dataValida(dados.data)) throw new Error("Data prevista inválida.");
     const linha = { usuario_id: dados.userId, tipo: dados.tipo, data_exame: dados.data, data_prevista: dados.data, status: "agendado", resultado: null, clinica: limparTexto(dados.clinica, LIMITES.nome) || null, observacao: limparTexto(dados.observacao, LIMITES.obs) || null, criado_por: user.id };
     let novo;
     if (demo) novo = mapExame({ id: `ex${Date.now()}`, ...linha, criado_em: iso(new Date()) });
     else { const [row] = await sbInsert(sessao.token, "exames_ocupacionais", [linha]); novo = mapExame(row); }
     setExamesOcupacionais((es) => [novo, ...es]);
     const nomeCol = usuarios.find((u) => u.id === dados.userId)?.nome || dados.userId;
     try { await auditar("exame_agendado", `${user.nome} agendou exame ${TIPOS_EXAME[dados.tipo]} de ${nomeCol} para ${fmtData(dados.data)}${linha.clinica ? " na " + linha.clinica : ""}`); }
     catch (e) { console.warn("[auditoria exame agendado]", e.message); }
     return novo;
   };

   // Agendamento automatico: so cria se ainda nao existir um exame do mesmo tipo em aberto.
   const agendarExameAuto = async (dados) => {
      const { ignorarId, ...linha } = dados;
      const jaTem = examesOcupacionais.some((e) => e.id !== ignorarId && e.userId === linha.userId && e.tipo === linha.tipo && e.status === "agendado");
      if (jaTem) return null;
      try { return await agendarExame(linha); } catch (e) { console.warn("[exame automatico]", e.message); return null; }
   };
   const concluirExame = async (id, dados) => {
     if (!dataValida(dados.data)) throw new Error("Informe a data em que o exame foi feito.");
     if (!RESULTADOS_EXAME[dados.resultado]) throw new Error("Informe o resultado do exame.");
     const path = dados.anexo ? await sbUpload(sessao.token, user.id, dados.anexo) : null;
     const patch = { status: "realizado", data_exame: dados.data, resultado: dados.resultado };
     if (path) patch.anexo_url = path;
     if (!demo) await sbUpdate(sessao.token, "exames_ocupacionais", `id=eq.${id}`, patch);
     setExamesOcupacionais((es) => es.map((e) => e.id === id ? { ...e, status: "realizado", data: dados.data, resultado: dados.resultado, resultadoLabel: RESULTADOS_EXAME[dados.resultado], anexo: path ? { nome: dados.anexo.name, path } : e.anexo } : e));
     const ex = examesOcupacionais.find((e) => e.id === id);
     if (ex?.userId && path) { try { await registrarDocumento({ userId: ex.userId, tipo: "aso", path, nomeOriginal: dados.anexo.name }); } catch (e) { console.warn("[aso na pasta]", e.message); } }
     const nomeCol = usuarios.find((u) => u.id === ex?.userId)?.nome || "colaborador";
     try { await auditar("exame_concluido", `${user.nome} lançou o resultado do exame ${ex?.tipoLabel || ""} de ${nomeCol}: ${RESULTADOS_EXAME[dados.resultado]}`); }
     catch (e) { console.warn("[auditoria exame concluido]", e.message); }
     // Fechou um exame clinico: o proximo periodico ja nasce agendado (PCMSO).
     if (ex && EXAMES_QUE_VALEM_COMO_CLINICO.includes(ex.tipo) && dados.resultado !== "inapto") {
        await agendarExameAuto({ userId: ex.userId, tipo: "periodico", data: dataISO(addMeses(dataLocal(dados.data), AGENDA_PCMSO_MESES)), observacao: "Proximo periodico agendado automaticamente (PCMSO)", ignorarId: id });
     }
   };

   // A guia nao e paga aqui dentro: o pagamento acontece no banco ou com a
   // contabilidade. O app guarda a prova (data, valor e comprovante).
   const registrarPagamentoGuia = async (id, dados) => {
     const g = guias.find((x) => x.id === id);
     if (!dataValida(dados.pagoEm)) throw new Error("Informe a data do pagamento.");
     const valor = numeroValido(dados.valorPago, { min: 0.01 });
     if (valor === null) throw new Error("Informe o valor pago (maior que zero).");
     const path = dados.comprovante ? await sbUpload(sessao.token, user.id, dados.comprovante) : null;
     const patch = { status: "paga", pago_em: dados.pagoEm, valor_pago: valor, observacao: limparTexto(dados.observacao, LIMITES.obs) || null };
     if (path) patch.comprovante_url = path;
     if (!demo) await sbUpdate(sessao.token, "guias_fiscais", `id=eq.${id}`, patch);
     setGuias((gs) => gs.map((x) => x.id === id ? { ...x, status: "paga", pagoEm: dados.pagoEm, valorPago: valor, observacao: patch.observacao || "", comprovante: path ? { nome: dados.comprovante.name, path } : x.comprovante } : x));
     try { await auditar("guia_paga", `${user.nome} registrou o pagamento da guia ${g?.tipo || id} de ${brl(valor)} em ${fmtData(dados.pagoEm)}${path ? " com comprovante anexado" : " sem comprovante"}`); }
     catch (e) { console.warn("[auditoria pagamento guia]", e.message); }
   };
   // A linha digitavel vem da guia emitida no eSocial/DCTFWeb/Conectividade Social.
   // O app guarda o numero e deixa copiar: o pagamento acontece no banco, com o gestor.
   const salvarLinhaGuia = async (id, valor) => {
      const so = String(valor || "").replace(/\D/g, "");
      if (so && so.length !== 47 && so.length !== 48) throw new Error("A linha digitável tem 47 números (boleto) ou 48 (guia de arrecadação). Confira e tente de novo.");
      const g = guias.find((x) => x.id === id);
      if (!demo) await sbUpdate(sessao.token, "guias_fiscais", `id=eq.${id}`, { linha_digitavel: so || null });
      setGuias((gs) => gs.map((x) => x.id === id ? { ...x, linhaDigitavel: so } : x));
      try { await auditar("guia_linha_salva", `${user.nome} ${so ? "guardou" : "apagou"} a linha digitável da guia ${g?.tipo || id}`); }
      catch (e) { console.warn("[auditoria linha da guia]", e.message); }
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
  const salvarConsImagem = async (cftvCiente, autorizada) => {
    const agora = iso(new Date());
    if (!demo) await sbUpsert(sessao.token, "consentimentos_imagem", [{ usuario_id: user.id, cftv_ciente: cftvCiente, imagem_autorizada: autorizada, atualizado_em: agora }], "usuario_id");
    setConsImagem((cs) => [...cs.filter((c) => c.userId !== user.id), { userId: user.id, cftvCiente, autorizada, atualizadoEm: agora }]);
    log("lgpd", `Termo de imagem: CFTV ${cftvCiente ? "ciente" : "sem ciência"} · divulgação ${autorizada ? "AUTORIZADA" : "NÃO autorizada"}`);
  };

  const salvarAceite = async (tipo, ref, status, obs) => {
    const agora = iso(new Date());
    if (!demo) await sbUpsert(sessao.token, 'aceites', [{ usuario_id: user.id, tipo, referencia: ref, status, observacao: obs || null, criado_em: agora }], 'usuario_id,tipo,referencia');
    setAceites((as) => [...as.filter((a) => !(a.userId === user.id && a.tipo === tipo && a.ref === ref)), { userId: user.id, tipo, ref, status, obs: obs || '', em: agora }]);
    log('aceite', tipo === 'conduta'
      ? `Código de conduta aceito (versão ${ref})`
      : `Espelho de ${rotuloComp(ref)}: ${status === 'aceito' ? 'conferido e aceito' : 'CONTESTADO'}${obs ? ' — ' + obs : ''}`);
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
    ["atestados", "🩺 Atestados"], ["ferias", "🏖 Férias"], ["banco", "⏳ Banco de horas"], ["holerite", "💰 Holerite"], ["premio", "🏆 Prêmio"], ["game", "🎮 Gamificação"], ["time", "🤝 Nosso time"],
            ["feedback", "💬 Meu feedback"], ["lgpd", "🔐 LGPD"],
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
          {atualizacaoPronta && (
            <div style={{ ...S.card, marginBottom: 14, padding: 12, borderLeft: "4px solid " + C.azul, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ flex: 1, fontSize: 13, lineHeight: 1.55 }}>Uma versão nova do app já está pronta neste aparelho.</div>
              <button style={{ ...S.btn, padding: "6px 14px", fontSize: 12 }} onClick={() => window.location.reload()}>Atualizar agora</button>
              <button style={{ ...S.btnGhost, padding: "6px 12px", fontSize: 12 }} onClick={() => setAtualizacaoPronta(false)} aria-label="Adiar atualização">Depois</button>
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
          {tela === "ponto" && <TelaPonto {...{ user, relogio, registros, faltas, fluxoPonto, setFluxoPonto, geo, comprovante, iniciarBatida, concluirBatida, locais, bloqueioGeo, notifStatus, onPedirNotif: pedirPermissaoNotif, credenciais: credenciais.filter(c => c.userId === user.id), onIrConfigurar: () => setTela("lgpd"), onAbrirRoteiro: () => setTela("time"), acoes, onAlternarCombinado: alternarCombinado, token: sessao?.token, demo, onRegistrarSemLocalizacao: registrarSemLocalizacao, respostas: rit.respostas || [], salas, presencas, presencaNoBanco, onEntrarSala: entrarNaSala }} />}
          {tela === "espelho" && <TelaEspelho user={user} registros={registros} exportarAFD={exportarAFD} exportarAEJ={exportarAEJ} aceites={aceites} onAceitar={salvarAceite} />}
          {tela === "justificar" && <TelaJustificar {...{ user, justificativas, onEnviar: enviarJustificativa }} />}
          {tela === "atestados" && <TelaAtestados {...{ user, atestados, onEnviar: enviarAtestado }} />}
          {tela === "ferias" && <TelaFerias {...{ user, ferias, agendarFerias }} />}
          {tela === "banco" && <TelaBanco {...{ user, registros, faltas, folgas, onSolicitar: solicitarFolga }} />}
          {tela === "holerite" && <TelaHolerite user={user} folhasPg={folhasPg.filter(f => f.userId === user.id)} adiantamentos={adiantamentos.filter(a => a.userId === user.id)} />}
          {tela === "premio" && <TelaPremio user={user} registros={registros} faltas={faltas} />}
          {tela === "game" && <TelaGame user={user} registros={registros} faltas={faltas} rankingUsuarios={rankingUsuarios} />}
          {tela === "time" && <TelaTime user={user} usuarios={usuarios} acoes={acoes} onCriar={criarCombinado} onAlternar={alternarCombinado} acoesNoBanco={acoesNoBanco} salas={salas} onSalvarSalas={salvarSalas} semente={semente} registros={registros} faltas={faltas} onGerarAta={gerarAta} rit={rit} onConquista={publicarConquista} onElogio={registrarElogio} onMotivadores={salvarMotivadores} onSortearAnjo={sortearAnjoRodada} onResponder={responderPerguntas} />}
          {tela === "feedback" && <TelaFeedback user={user} registros={registros} faltas={faltas} />}
          {tela === "lgpd" && <TelaLGPD user={user} onConsentir={consentir} credenciais={credenciais.filter(c => c.userId === user.id)} onCadastrarBio={cadastrarBiometria} onRemoverBio={removerBiometria} imagem={consImagem.find((c) => c.userId === user.id)} onSalvarImagem={salvarConsImagem} aceiteConduta={aceites.find((a) => a.userId === user.id && a.tipo === "conduta")} onAceitar={salvarAceite} />}
          {tela === "gestor" && user.papel === "gestor" && (
            /* acesso pelo papel real do usuário autenticado (tipo=gestor no banco, garantido por RLS) — sem senha extra */
            <TelaGestor {...{ acoes, respostas: rit.respostas || [], atas: rit.atas || [], usuarios, registros, faltas, justificativas, atestados, ferias, logs, decidir, locais, onCriarLocal: criarLocal, onDesativarLocal: desativarLocal, convites, onCriarConvite: criarConvite, onSalvarUsuario: salvarUsuario, gestorId: user.id, folgas, onDecidirFolga: decidirFolga, folhasPg, adiantamentos, guias, onGerarFolha: gerarFolha, onEditarFolha: editarFolha, onFecharFolha: fecharFolha, onCriarAdiant: criarAdiantamento, onCancelarAdiant: cancelarAdiantamento, rescisoes, examesOcupacionais, onCriarRescisao: criarRescisao, onConfirmarRescisao: confirmarRescisao, onCriarExame: criarExame, onAgendarExame: agendarExame, onConcluirExame: concluirExame, candidatos, documentosRH, onCriarCandidato: criarCandidato, onMudarStatusCandidato: mudarStatusCandidato, onContratarCandidato: contratarCandidato, onAnexarDocumento: registrarDocumento, onAbrirArquivo: abrirDocumento, onRegistrarPagamentoGuia: registrarPagamentoGuia, onSalvarLinhaGuia: salvarLinhaGuia, consImagem, aceites, demo }} />
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
            <CartaoBoasVindas nome={conv.nome} />
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
        <p style={{ fontSize: 11, color: C.cinza, marginTop: 14 }}>🔒 Acesso protegido: autenticação no servidor e permissões por usuário.</p>
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

/* Relogio com vida propria. Antes o horario ficava no estado do topo do app,
   entao o app INTEIRO era redesenhado 1x por segundo - em celular fraco e isso
   que da a sensacao de travamento. Agora so este pedacinho pisca a cada
   segundo; o resto da tela redesenha a cada 20 segundos. */
/* ================= Pecas visuais com relevo =================
   O app e escuro e chapado por natureza. Estas pecas dao volume sem imagem
   nenhuma: tudo e gradiente, sombra interna e sombra externa — ou seja, zero
   download extra, nada pra CSP barrar e funciona offline igual. */

/* Anel de progresso com conic-gradient: um circulo pintado ate X graus e um
   disco escuro por cima deixando so a borda a mostra. Mais leve que SVG. */
function AnelProgresso({ pct, tamanho, espessura, cor, children }) {
  const t = tamanho || 210;
  const e = espessura || 11;
  const p = Math.max(0, Math.min(100, pct || 0));
  const cc = cor || C.amarelo;
  return (
    <div className="pr-anel" style={{ position: "relative", width: t, height: t, margin: "0 auto", borderRadius: "50%", background: `conic-gradient(from -90deg, ${cc} ${p * 3.6}deg, rgba(255,255,255,0.055) 0deg)`, boxShadow: `0 0 0 1px ${C.borda}, 0 22px 44px -20px rgba(0,0,0,0.8)` }}>
      <div style={{ position: "absolute", top: e, right: e, bottom: e, left: e, borderRadius: "50%", background: `radial-gradient(130% 130% at 50% 0%, ${C.grafite}, ${C.preto})`, boxShadow: "inset 0 3px 12px rgba(0,0,0,0.6), inset 0 -1px 0 rgba(255,255,255,0.05)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3 }}>
        {children}
      </div>
    </div>
  );
}

/* Cartao do momento: chegou, esta em jornada ou encerrou o dia. */
function CartaoMomento({ nome, doDia }) {
  const agora = new Date();
  const lista = doDia || [];
  const ult = lista.reduce((m, r) => (!m || new Date(r.ts).getTime() > new Date(m.ts).getTime() ? r : m), null);
  const fase = !ult ? "chegada" : (ult.tipo === "entrada" ? "jornada" : "saida");
  const pn = primeiroNome(nome);
  const cor = fase === "saida" ? C.azul : (fase === "jornada" ? C.verde : C.amarelo);
  /* Aceno em vez de sol: o cartao aparece de madrugada tambem e sol as 22h fica ridiculo. */
  const icone = fase === "saida" ? "\uD83C\uDF19" : (fase === "jornada" ? "\u26A1" : "\uD83D\uDC4B");
  const titulo = fase === "chegada"
    ? `${saudacaoDaHora(agora)}${pn ? ", " + pn : ""}!`
    : fase === "jornada"
      ? `Em jornada desde ${fmtHora(ult.ts)}`
      : `Expediente encerrado \u00e0s ${fmtHora(ult.ts)}`;
  const frase = fase === "saida"
    ? fraseDoDia(FRASES_SAIDA, nome, agora)
    : fase === "jornada"
      ? fraseDoDia(DICAS_PAUSA, nome + "|pausa", agora)
      : fraseDoDia(FRASES_CHEGADA, nome, agora);
  return (
    <div className="pr-relevo" style={{ ...S.card, marginTop: 14, padding: 16, display: "flex", gap: 14, alignItems: "center", borderLeft: `3px solid ${cor}` }}>
      <div className="pr-medalha" aria-hidden="true" style={{ background: `radial-gradient(130% 130% at 30% 18%, ${cor}, rgba(0,0,0,0.42))` }}>{icone}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...S.display, fontSize: 15, color: cor }}>{titulo}</div>
        <p style={{ fontSize: 13, color: C.branco, margin: "4px 0 0", lineHeight: 1.6 }}>{frase}</p>
      </div>
    </div>
  );
}

/* Hidratacao e pausa. Contador do dia guardado SO no aparelho; o aviso do
   celular sai do proprio app e nada disso chega ao gestor nem ao servidor. */
/* ================= Detalhe recolhido =================
   Aviso legal e explicacao longa nao podem sumir: protegem a empresa e
   informam quem quiser ler. Mas nao precisam gritar em toda abertura de
   tela. Ficam atras de um toque, no <details> nativo do HTML - acessivel,
   sem estado, funciona com teclado e ate com JS quebrado. */
function Detalhes({ titulo, children }) {
  return (
    <details className="pr-detalhes">
      <summary>{titulo}</summary>
      <div className="pr-detalhes-corpo">{children}</div>
    </details>
  );
}

function CartaoBemEstar({ userId }) {
  const [meta, setMeta] = useState(() => aguaLerMeta(userId));
  const [copos, setCopos] = useState(() => aguaLer(userId));
  useEffect(() => { setMeta(aguaLerMeta(userId)); setCopos(aguaLer(userId)); }, [userId]);
  useEffect(() => {
    const t = setInterval(() => {
      const hr = new Date().getHours();
      if (hr < 8 || hr >= 18) return;
      if (aguaLer(userId) >= aguaLerMeta(userId)) return;
      try {
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          notificarAparelho("Hora de beber \u00e1gua \uD83D\uDCA7", "Um copo agora e o dia rende melhor. Toque pra marcar no app.", "agua");
        }
      } catch {}
    }, AGUA_INTERVALO_MIN * 60000);
    return () => clearInterval(t);
  }, [userId]);
  const hr = new Date().getHours();
  const esperado = hr <= 8 ? 0 : Math.min(meta, Math.round(((hr - 8) / 10) * meta));
  const atrasado = copos < esperado;
  const pct = meta > 0 ? Math.min(100, (copos / meta) * 100) : 0;
  /* Nada de texto embaixo da barra: o cartao inteiro se explica pelos copos. */
  return (
    <div className="pr-relevo" style={{ ...S.card, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ ...S.display, fontSize: 14, color: C.agua }}>💧 Hidratação de hoje</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }} title="Meta de copos por dia">
          <button style={{ ...S.btnGhost, padding: "1px 9px", fontSize: 14, lineHeight: 1.5 }} aria-label="Diminuir a meta de copos" onClick={() => setMeta(aguaGravarMeta(userId, meta - 1))}>−</button>
          <span style={{ fontSize: 11, color: C.cinza, minWidth: 62, textAlign: "center" }}>meta {meta} copos</span>
          <button style={{ ...S.btnGhost, padding: "1px 9px", fontSize: 14, lineHeight: 1.5 }} aria-label="Aumentar a meta de copos" onClick={() => setMeta(aguaGravarMeta(userId, meta + 1))}>+</button>
        </div>
      </div>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 14 }}>
        {Array.from({ length: meta }, (_, i) => (
          <button key={i} className="pr-copo" aria-pressed={i < copos} aria-label={`Marcar ${i + 1} copo(s) de \u00e1gua`}
            onClick={() => setCopos(aguaGravar(userId, i < copos ? i : i + 1))}
            style={{ width: 26, height: 34, borderRadius: "6px 6px 11px 11px", cursor: "pointer", border: "1px solid " + (i < copos ? C.agua : C.bordaForte),
              background: i < copos ? "linear-gradient(180deg, rgba(56,189,248,0.30), #0EA5E9)" : "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(0,0,0,0.20))",
              boxShadow: i < copos ? "inset 0 1px 0 rgba(255,255,255,0.55), 0 8px 16px -8px rgba(56,189,248,0.85)" : "inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -2px 6px rgba(0,0,0,0.35)" }} />
        ))}
      </div>
      <div style={{ textAlign: "right", fontSize: 11, color: atrasado ? C.agua : C.cinza, marginTop: 12 }}>{copos * AGUA_COPO_ML} / {meta * AGUA_COPO_ML} ml</div>
      <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 999, height: 7, marginTop: 6, overflow: "hidden", boxShadow: "inset 0 1px 3px rgba(0,0,0,0.55)" }}>
        <div style={{ width: pct + "%", height: "100%", borderRadius: 999, background: "linear-gradient(90deg, #0EA5E9, " + C.agua + ")", boxShadow: "0 0 14px rgba(56,189,248,0.65)" }} />
      </div>
    </div>
  );
}

/* Primeiro contato de quem foi contratado: a tela do convite. */
function CartaoBoasVindas({ nome }) {
  const pn = primeiroNome(nome);
  return (
    <div className="pr-relevo" style={{ marginTop: 16, borderRadius: 16, padding: 16, background: "linear-gradient(180deg, rgba(255,122,26,0.18), rgba(255,122,26,0.04))", border: "1px solid rgba(255,122,26,0.35)", boxShadow: C.brilhoLaranja }}>
      <div style={{ ...S.display, fontSize: 15, color: C.amarelo }}>🎉 Bem-vindo(a){pn ? ", " + pn : ""}!</div>
      <p style={{ fontSize: 13, color: C.branco, margin: "6px 0 0", lineHeight: 1.65 }}>{fraseDoDia(FRASES_BOAS_VINDAS, nome, new Date())}</p>
    </div>
  );
}

/* Desligamento: o app nao manda nada pra ninguem. Oferece um texto sobrio pro
   gestor copiar e enviar do jeito dele. Despedida e conversa de pessoa. */
function CartaoDespedida({ usuarios = [], rescisoes = [] }) {
  const [copiado, setCopiado] = useState(null);
  const nomeDe = (id) => (usuarios.find((u) => u.id === id) || {}).nome || id;
  const recentes = rescisoes.slice().sort((a, b) => String(b.dataDeslig).localeCompare(String(a.dataDeslig))).slice(0, 3);
  if (!recentes.length) return null;
  return (
    <div style={{ ...S.card, marginTop: 14 }}>
      <div style={{ ...S.display, fontSize: 15, color: C.branco }}>🤝 Mensagem de despedida (sugestão)</div>
      <p style={{ fontSize: 12, color: C.cinza, margin: "6px 0 10px", lineHeight: 1.6 }}>
        O sistema não envia nada por conta própria. Se fizer sentido, copie o texto e mande você mesmo — desligamento é conversa de pessoa, não de software.
      </p>
      {recentes.map((r) => {
        const nm = nomeDe(r.userId);
        const txt = primeiroNome(nm) + ", " + fraseDoDia(FRASES_DESPEDIDA, nm, new Date());
        return (
          <div key={r.id} style={{ borderTop: "1px solid " + C.borda, padding: "10px 0", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <b style={{ fontSize: 13.5 }}>{nm}</b>
              <p style={{ fontSize: 12.5, color: C.branco, margin: "4px 0 0", lineHeight: 1.6 }}>{txt}</p>
            </div>
            <button style={{ ...S.btnGhost, padding: "7px 12px", fontSize: 12 }} onClick={async () => {
              try { await navigator.clipboard.writeText(txt); setCopiado(r.id); } catch { setCopiado("erro"); }
            }}>{copiado === r.id ? "\u2714 Copiada" : "Copiar"}</button>
          </div>
        );
      })}
      {copiado === "erro" && <p style={{ fontSize: 11.5, color: C.vermelho, margin: "8px 0 0" }}>Não foi possível copiar neste navegador — selecione o texto na mão.</p>}
    </div>
  );
}

function RelogioVivo() {
  const [agora, setAgora] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  /* Quanto do expediente de hoje ja passou. Sem prop nenhuma de proposito: o
     componente se resolve sozinho e o pai nao redesenha por causa do relogio. */
  const exp = expedienteDoDia(agora);
  const minAgora = agora.getHours() * 60 + agora.getMinutes();
  const temJanela = exp.entradaMin != null && exp.saidaMin != null && exp.saidaMin > exp.entradaMin;
  const pct = temJanela ? ((minAgora - exp.entradaMin) / (exp.saidaMin - exp.entradaMin)) * 100 : 0;
  const hh = (m) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
  const legenda = !temJanela
    ? "sem expediente hoje"
    : minAgora < exp.entradaMin
      ? "come\u00e7a \u00e0s " + hh(exp.entradaMin)
      : minAgora >= exp.saidaMin
        ? "expediente encerrado"
        : "faltam " + hh(exp.saidaMin - minAgora) + " pra " + hh(exp.saidaMin);
  const corAnel = !temJanela ? C.cinza : (pct >= 100 ? C.verde : C.amarelo);
  return (
    <>
      <AnelProgresso pct={pct} tamanho={216} espessura={12} cor={corAnel}>
        <div className="pr-relogio" style={{ ...S.display, fontSize: 40, color: C.amarelo, lineHeight: 1 }}>{agora.toLocaleTimeString("pt-BR")}</div>
        <div style={{ fontSize: 11, color: C.cinza, letterSpacing: "0.04em" }}>{legenda}</div>
      </AnelProgresso>
      <div style={{ color: C.cinza, marginTop: 14 }}>{agora.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}</div>
    </>
  );
}

function TelaPonto({ user, relogio, registros, faltas, fluxoPonto, setFluxoPonto, geo, comprovante, iniciarBatida, concluirBatida, locais, bloqueioGeo, notifStatus, onPedirNotif, credenciais = [], onIrConfigurar, token, demo, onRegistrarSemLocalizacao, onAbrirRoteiro, acoes, onAlternarCombinado, respostas = [],
  salas = {}, presencas = [], presencaNoBanco = false, onEntrarSala }) {
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
      <CartaoMomento nome={user.nome} doDia={doDia} />
      <CartaoReuniao user={user} doDia={doDia} onAbrirRoteiro={onAbrirRoteiro} acoes={acoes} respostas={respostas}
        salas={salas} presencas={presencas} presencaNoBanco={presencaNoBanco} onEntrarSala={onEntrarSala} />
      {!temLocais && (
        <p style={{ fontSize: 12, color: C.cinza, margin: "10px 0 0" }}>📍 Local de trabalho ainda não configurado pelo gestor — batida liberada sem verificação de raio.</p>
      )}
      {permGeo === "denied" && (
        <div style={{ ...S.card, marginTop: 12, padding: 12, borderLeft: `4px solid ${C.amarelo}`, textAlign: "left" }}>
          <div style={{ fontSize: 13, color: C.amarelo, fontWeight: 700 }}>📍 Localização bloqueada neste navegador</div>
          <p style={{ fontSize: 12.5, color: C.branco, marginTop: 6, lineHeight: 1.6 }}>{GEO_MOTIVOS.permissao_negada.comoResolver}</p>
        </div>
      )}
      {(notifStatus === "default" || notifStatus === "unsupported") && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
          {notifStatus === "default"
            ? <button style={{ ...S.btnGhost, fontSize: 12, padding: "8px 14px" }} onClick={onPedirNotif}>🔔 Ativar aviso de lembrete no celular</button>
            : !appInstalado() && <span style={{ fontSize: 12, color: C.cinza }}>🔔 Para receber aviso do celular, adicione o app à tela de início.</span>}
        </div>
      )}
      {(notifStatus === "denied" || notifStatus === "unsupported") && (
        <p style={{ fontSize: 11, color: C.cinza, margin: "8px 0 0" }}>
          ⏰ {legendaLembretes(notifStatus, appInstalado())}
        </p>
      )}
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
          <RelogioVivo />
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
          <CartaoBemEstar userId={user.id} />
      <CartaoCombinados acoes={acoes} onAlternar={onAlternarCombinado} onAbrirRoteiro={onAbrirRoteiro} />
        </div>
      </div>
    </div>
  );
}

function TelaEspelho({ user, registros, exportarAFD, exportarAEJ, aceites = [], onAceitar }) {
  const todosDias = agruparPorDia(registros, user.id);
  // O espelho e o aceite sao MENSAIS: lista as competencias com marcacao, mais recente primeiro.
  const comps = Array.from(new Set(Object.values(todosDias).map((regs) => compDe(new Date(regs[0].ts))))).sort().reverse();
  const [comp, setComp] = useState(comps[0] || compAtual());
  const chaveComps = comps.join(",");
  useEffect(() => { if (comps.length && comps.indexOf(comp) < 0) setComp(comps[0]); }, [chaveComps]);
  const dias = {};
  Object.entries(todosDias).forEach(([dia, regs]) => { if (compDe(new Date(regs[0].ts)) === comp) dias[dia] = regs; });
  const aceite = aceites.find((a) => a.userId === user.id && a.tipo === "espelho" && a.ref === comp);
  const totais = Object.values(dias).reduce((ac, regs) => {
    const exp = expedienteDoDia(new Date(regs[0].ts));
    const min = minutosDia(regs);
    const pares = Math.min(regs.filter((r) => r.tipo === "entrada").length, regs.filter((r) => r.tipo === "saida").length);
    const desc = exp.intervaloMin > 0 && pares <= 1 ? exp.intervaloMin : 0;
    return { dias: ac.dias + 1, trab: ac.trab + min, prev: ac.prev + exp.jornadaMin, saldo: ac.saldo + (min - desc - exp.jornadaMin) };
  }, { dias: 0, trab: 0, prev: 0, saldo: 0 });
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <h1 style={{ ...S.display, fontSize: 26, margin: 0 }}>Espelho de ponto</h1>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }} className="no-print">
          <button style={S.btnGhost} onClick={exportarAFD}>⬇ Exportar AFD (leiaute 003)</button>
          <button style={S.btnGhost} onClick={exportarAEJ}>⬇ Exportar AEJ (leiaute 001)</button>
          <select style={{ ...S.input, width: "auto", padding: "10px 12px", fontSize: 14 }} value={comp} onChange={(e) => setComp(e.target.value)}>
            {(comps.length ? comps : [comp]).map((c) => <option key={c} value={c}>{rotuloComp(c)}</option>)}
          </select>
          <button style={S.btn} onClick={() => baixarPDF(pdfEspelhoPonto(user, dias, comp, aceite), `espelho-${comp}.pdf`)}>🖨 Espelho em PDF</button>
        </div>
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
        {(() => {
          const todosRegs = Object.values(dias).reduce((ac, v) => ac.concat(v), []);
          const marcas = [
            { s: "ᴬ", d: "saída preenchida automaticamente pelo sistema", tem: todosRegs.some(r => r && r.automatica) },
            { s: "*", d: "horário corrigido com justificativa", tem: todosRegs.some(r => r && r.ajustada) },
            { s: "⚠", d: "batida sem verificação biométrica", tem: todosRegs.some(r => r && r.metodo === "sem_verificacao") },
            { s: "⏳", d: "aguardando envio ao servidor", tem: todosRegs.some(r => r && r.pendente) },
            { s: "ᶠ", d: "registrada sem rede (horário do aparelho)", tem: todosRegs.some(r => r && r.offline) },
            { s: "📍", d: "registrada sem localização, com justificativa", tem: todosRegs.some(r => r && r.geoStatus === "dispensado_por_falha") },
          ].filter(m => m.tem);
          return (
            <div style={{ fontSize: 12, color: C.cinza, marginTop: 10 }}>
              {marcas.length > 0 && <p style={{ margin: "0 0 6px" }}>Legenda: {marcas.map(m => m.s + " = " + m.d).join(" · ")}</p>}
              <Detalhes titulo="Regras da jornada"><p style={{ margin: 0 }}>Expediente: seg-sex 8:00 às 18:00 (9h produtivas + 1h de intervalo intrajornada, CLT art. 71) · sábado 8:00 às 13:00 · domingos e feriados nacionais fechado. Com um único par entrada/saída no dia, a 1h de intervalo é descontada da presença. Horas além das 9h produtivas entram no banco de horas (acordo individual escrito, CLT art. 59 §5º) ou são pagas como extra com adicional mínimo de 50%.</p></Detalhes>
            </div>
          );
        })()}
      </div>
      <div style={{ ...S.card, marginTop: 14, display: "flex", gap: 22, flexWrap: "wrap" }}>
        {[["Dias com marcação", String(totais.dias)], ["Trabalhado", hmm(totais.trab)], ["Previsto", hmm(totais.prev)], ["Saldo do mês", hmm(totais.saldo)]].map(([rot, val]) => (
          <div key={rot}>
            <div style={{ fontSize: 11, color: C.cinza }}>{rot}</div>
            <div style={{ ...S.display, fontSize: 20, color: rot === "Saldo do mês" ? (totais.saldo >= 0 ? C.verde : C.vermelho) : C.branco }}>{val}</div>
          </div>
        ))}
      </div>
      {onAceitar && <ConfereEspelho comp={comp} aceite={aceite} onAceitar={onAceitar} />}
    </div>
  );
}

/* Aceite mensal do espelho de ponto: prova datada de que o colaborador conferiu as
   proprias marcacoes. Contestar exige descrever a divergencia, que chega ao gestor.
   O aceite e ciencia - nao convalida erro nem impede correcao depois (CLT art. 9º). */
function ConfereEspelho({ comp, aceite, onAceitar }) {
  const [modo, setModo] = useState(null);
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => { setModo(null); setObs(""); setMsg(null); }, [comp]);
  const enviar = async (status) => {
    if (status === "contestado" && obs.trim().length < 10) { setMsg({ ok: false, txt: "Descreva a divergência com pelo menos 10 caracteres — o gestor precisa saber o que corrigir." }); return; }
    setSalvando(true); setMsg(null);
    try {
      await onAceitar("espelho", comp, status, status === "contestado" ? obs.trim() : "");
      setModo(null); setObs("");
      setMsg({ ok: true, txt: status === "aceito" ? "Conferência registrada com data e hora." : "Divergência registrada — ela aparece no painel do gestor." });
    } catch (e) { setMsg({ ok: false, txt: mensagemAmigavel(e, "ao registrar a conferência do espelho") }); }
    finally { setSalvando(false); }
  };
  const jaAceito = aceite && aceite.status === "aceito";
  return (
    <div style={{ ...S.card, marginTop: 14, borderLeft: `4px solid ${aceite ? (jaAceito ? C.verde : C.vermelho) : C.amarelo}` }}>
      <div style={{ ...S.display, fontSize: 15, color: C.branco }}>✔ Conferência do espelho de {rotuloComp(comp)}</div>
      {aceite ? (
        <p style={{ fontSize: 13, color: jaAceito ? C.verde : C.vermelho, margin: "8px 0 0", lineHeight: 1.6 }}>
          {jaAceito ? "Você conferiu e aceitou este espelho" : "Você registrou uma divergência neste espelho"} em {fmtDataHora(aceite.em)}.
          {aceite.obs ? <span style={{ color: C.cinza }}> Divergência apontada: {aceite.obs}</span> : null}
        </p>
      ) : (
        <p style={{ fontSize: 13, color: C.cinza, margin: "8px 0 0", lineHeight: 1.6 }}>Confira as marcações acima. Se estiver tudo certo, registre o aceite; se algo estiver errado, aponte a divergência.</p>
      )}
      {modo === "contestar" && (
        <textarea style={{ ...S.input, marginTop: 10, minHeight: 70, fontSize: 14 }} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: no dia 12 a saída foi lançada pelo sistema; saí às 18h10." />
      )}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
        {modo === "contestar" ? (
          <>
            <button style={{ ...S.btn, padding: "8px 14px", fontSize: 13, opacity: salvando ? 0.6 : 1 }} disabled={salvando} onClick={() => enviar("contestado")}>{salvando ? "⏳…" : "Enviar divergência"}</button>
            <button style={{ ...S.btnGhost, padding: "8px 14px", fontSize: 13 }} onClick={() => { setModo(null); setObs(""); }}>Cancelar</button>
          </>
        ) : (
          <>
            <button style={{ ...S.btn, padding: "8px 14px", fontSize: 13, opacity: salvando ? 0.6 : 1 }} disabled={salvando} onClick={() => enviar("aceito")}>{salvando ? "⏳…" : jaAceito ? "Confirmar de novo" : "Está tudo certo"}</button>
            <button style={{ ...S.btnGhost, padding: "8px 14px", fontSize: 13 }} onClick={() => setModo("contestar")}>Tenho uma divergência</button>
          </>
        )}
      </div>
      {msg && <p style={{ fontSize: 12.5, color: msg.ok ? C.verde : C.vermelho, margin: "8px 0 0" }}>{msg.txt}</p>}
      <Detalhes titulo="O que significa este aceite"><p style={{ margin: 0 }}>O aceite registra apenas a sua ciência das marcações do mês: ele não convalida erro nem impede correção posterior, administrativa ou judicial (CLT art. 9º). O espelho em PDF sai com a data e o resultado desta conferência.</p></Detalhes>
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
        <p style={{ fontSize: 12, color: C.cinza, marginTop: 10 }}>Atestado é dado sensível de saúde (LGPD art. 5º, II): o arquivo fica em armazenamento privado, visível só para você e o gestor.</p>
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
        <Detalhes titulo="Regras de férias"><p style={{ margin: 0 }}>Regras: 12 meses de casa pra liberar (CLT art. 130) + antecedência mínima de <b style={{ color: C.branco }}>5 meses</b> contada dia a dia a partir de hoje (política interna da Renovar Tech — o mínimo legal é 30 dias, CLT art. 135, mas a regra interna é mais restritiva e prevalece). <b style={{ color: C.branco }}>Fracionamento validado pelo sistema</b> (CLT art. 134 §1º): no máximo 3 períodos por ciclo aquisitivo, um deles com 14+ dias corridos e os demais com 5+ dias cada, somando até 30 dias.</p></Detalhes>
      </div>
      {minhas.map(f => (
        <div key={f.id} style={{ ...S.card, marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div><b>{fmtData(f.inicio + "T00:00:00")}</b> · {f.dias} dias</div><Badge st={f.status} />
        </div>
      ))}
    </div>
  );
}

/* Fase do dia a partir das marcações: quem ainda não bateu está chegando,
   quem bateu entrada está em jornada, o resto já encerrou. Mesma regra do
   CartaoMomento — é ela que decide qual dos dois avisos aparece. */
function faseDoDia(doDia) {
  const lista = doDia || [];
  const ult = lista.reduce((m, r) => (!m || new Date(r.ts).getTime() > new Date(m.ts).getTime() ? r : m), null);
  return !ult ? "chegada" : (ult.tipo === "entrada" ? "jornada" : "saida");
}

/* O aviso da reunião. Aparece duas vezes: ao encerrar o expediente, falando
   do próximo dia com reunião, e ao chegar, falando da reunião do dia. Além
   do cartão dispara um aviso do celular, uma única vez por etapa. */
function CartaoReuniao({ user, doDia, onAbrirRoteiro, acoes = [], respostas = [],
  salas = null, presencas = [], presencaNoBanco = false, onEntrarSala = null }) {
  const agora = new Date();
  const fase = faseDoDia(doDia);
  /* O time inteiro ve as salas do banco; sem banco, vale o que este aparelho
     guardou da ultima vez. */
  const salasDoTime = salas && Object.keys(salas).length ? salas : salasLer();
  let alvo = null;
  let etapa = "";
  if (fase === "saida") {
    const amanha = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + 1);
    alvo = proximasReunioes(amanha, 21);
    etapa = "vespera";
  } else {
    const hoje = reunioesDoDia(agora);
    const minAgora = agora.getHours() * 60 + agora.getMinutes();
    const restantes = hoje.filter((r) => minAgora < inicioEmMinutos(r.inicio) + r.duracaoMin);
    if (restantes.length) { alvo = { data: new Date(agora), reunioes: restantes }; etapa = "dia"; }
  }
  const diaIso = alvo ? dataISO(alvo.data) : "";
  const idsAlvo = alvo ? alvo.reunioes.map((r) => r.id).join(",") : "";
  /* Os assuntos que o time ja colocou na mesa. Contagem, nunca o texto: aviso
     de celular aparece na tela de bloqueio, e pedido de ajuda de colega nao e
     assunto para quem estiver olhando o celular por cima do ombro. */
  const pauta = alvo ? alvo.reunioes.map((r) => assuntosDaReuniao(r, respostas, acoes, diaIso)) : [];
  const pautaTxt = pauta.map((p) => p.join("+")).join("|");
  useEffect(() => {
    if (!alvo) return;
    /* Espera as respostas chegarem do banco antes de disparar - avisar sem a
       pauta e pior do que avisar dois segundos depois. */
    const t = setTimeout(() => {
      const rot = rotuloDiaReuniao(alvo.data, new Date());
      alvo.reunioes.forEach((r, i) => {
        if (avisoJaDado(user && user.id, diaIso, r.id, etapa)) return;
        marcarAviso(user && user.id, diaIso, r.id, etapa);
        notificarAparelho("Ponto Renovar · " + r.nome, textoAvisoReuniao(r, rot, pauta[i]), "reuniao-" + r.id + "-" + diaIso + "-" + etapa);
      });
    }, 2500);
    return () => clearTimeout(t);
  }, [diaIso, idsAlvo, etapa, pautaTxt]);
  if (!alvo) return null;
  const rotulo = rotuloDiaReuniao(alvo.data, agora);
  return (
    <div className="pr-relevo" style={{ ...S.card, marginTop: 14, padding: 16, borderLeft: "4px solid " + C.amarelo }}>
      <div style={{ ...S.display, fontSize: 15, color: C.amarelo }}>
        {fase === "saida" ? "📌 Antes de ir: reunião " + rotulo : "📌 Reunião " + rotulo}
      </div>
      {alvo.reunioes.map((r, iR) => (
        <div key={r.id} style={{ marginTop: 12 }}>
          <div style={{ fontSize: 14, color: C.branco }}>
            {r.icone} <b>{r.nome}</b>
            <span style={{ color: C.cinza }}>{" · " + r.inicio + " · " + r.duracaoMin + " min"}</span>
          </div>
          <p style={{ fontSize: 12.5, color: C.cinza, margin: "4px 0 8px", lineHeight: 1.6 }}>{r.resumo}</p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {r.blocos.map((b, i) => (
              <span key={i} style={{ ...S.tag, fontSize: 11 }}>{b.min + " min · " + b.titulo}</span>
            ))}
          </div>
          {(pauta[iR] || []).length ? (
            <div style={{ fontSize: 12.5, color: C.amarelo, marginTop: 8 }}>
              Já na mesa: {(pauta[iR] || []).join(" e ")}.
            </div>
          ) : null}
          {impedimentosDoDia(respostas, diaIso, r.id).length ? (
            <div style={{ fontSize: 12, color: C.cinza, marginTop: 4 }}>
              Pediram ajuda: {impedimentosDoDia(respostas, diaIso, r.id).map((x) => x.autor).join(", ")}.
            </div>
          ) : null}
          {(() => {
            const urlSala = salaDoRitual(salasDoTime, r.id);
            if (!urlSala) return null;
            const naSala = presencaAtiva(presencas, r.id, diaIso, agora.getTime());
            return (
              <div style={{ marginTop: 10 }}>
                <button style={{ ...S.btnGhost, padding: "8px 16px", fontSize: 13 }}
                  onClick={() => (onEntrarSala ? onEntrarSala(r.id, urlSala) : abrirSala(urlSala))}>🎥 Entrar na chamada</button>
                {presencaNoBanco ? (
                  <div style={{ fontSize: 12, color: naSala.length ? C.verde : C.cinza, marginTop: 6 }}>
                    {textoPresenca(naSala, user && user.id)}
                  </div>
                ) : null}
              </div>
            );
          })()}
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
        <button style={{ ...S.btn, padding: "8px 16px", fontSize: 13 }} onClick={onAbrirRoteiro}>Abrir o roteiro</button>
      </div>
    </div>
  );
}

function reuniaoAnterior(base) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - 1);
  for (let i = 0; i < 21; i++) {
    const l = reunioesDoDia(d);
    if (l.length) return { data: new Date(d), reunioes: l };
    d.setDate(d.getDate() - 1);
  }
  return null;
}

function mmss(seg) {
  const s = Math.max(0, Math.floor(seg));
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}

/* Roteiro cronometrado: o app conduz a reunião bloco a bloco para o horário
   não escorregar. Avisa quando faltam 2 minutos e nunca pula sozinho — quem
   decide avançar é quem está conduzindo. */
function Roteiro({ ritual, rodape, children }) {
  const [idx, setIdx] = useState(0);
  const [rodando, setRodando] = useState(false);
  const [restam, setRestam] = useState(ritual.blocos[0].min * 60);
  useEffect(() => { setIdx(0); setRodando(false); setRestam(ritual.blocos[0].min * 60); }, [ritual.id]);
  useEffect(() => {
    if (!rodando) return;
    const tick = setInterval(() => setRestam((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(tick);
  }, [rodando, idx, ritual.id]);
  const bloco = ritual.blocos[idx];
  useEffect(() => {
    if (rodando && restam === 120) notificarAparelho("Faltam 2 minutos", bloco.titulo + " · " + ritual.nome, "roteiro-bloco");
  }, [restam, rodando]);
  const total = bloco.min * 60;
  const pct = total ? Math.max(0, Math.min(100, ((total - restam) / total) * 100)) : 0;
  const estourou = restam === 0;
  function irPara(n) {
    const i = Math.max(0, Math.min(ritual.blocos.length - 1, n));
    setIdx(i);
    setRestam(ritual.blocos[i].min * 60);
  }
  return (
    <div className="pr-relevo" style={{ ...S.card, padding: 16 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {ritual.blocos.map((b, i) => (
          <button key={i} onClick={() => irPara(i)}
            style={{ ...S.tag, fontSize: 11, cursor: "pointer", border: "1px solid " + (i === idx ? C.amarelo : C.borda), color: i === idx ? C.amarelo : C.cinza, background: "transparent" }}>
            {(i + 1) + ". " + b.titulo}
          </button>
        ))}
      </div>
      <div style={{ ...S.display, fontSize: 17, color: C.branco }}>{bloco.titulo}</div>
      <p style={{ fontSize: 13, color: C.cinza, margin: "6px 0 14px", lineHeight: 1.65 }}>{bloco.detalhe}</p>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <div style={{ ...S.display, fontSize: 34, color: estourou ? C.vermelho : C.amarelo, letterSpacing: 1 }}>{mmss(restam)}</div>
        <div style={{ fontSize: 11.5, color: C.cinza }}>{"bloco de " + bloco.min + " min"}</div>
      </div>
      <div style={{ height: 8, borderRadius: 99, background: C.vidro, overflow: "hidden", marginTop: 8 }}>
        <div style={{ height: "100%", width: pct + "%", borderRadius: 99, background: estourou ? C.vermelho : C.amarelo, transition: "width .4s ease" }} />
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
        <button style={{ ...S.btn, padding: "8px 18px", fontSize: 13 }} onClick={() => setRodando(!rodando)}>{rodando ? "⏸ Pausar" : "▶ Iniciar"}</button>
        <button style={{ ...S.btnGhost, padding: "8px 14px", fontSize: 13 }} onClick={() => setRestam((s) => s + 60)}>+1 min</button>
        <button style={{ ...S.btnGhost, padding: "8px 14px", fontSize: 13 }} onClick={() => irPara(idx - 1)} disabled={idx === 0}>Anterior</button>
        <button style={{ ...S.btnGhost, padding: "8px 14px", fontSize: 13 }} onClick={() => irPara(idx + 1)} disabled={idx === ritual.blocos.length - 1}>Próximo bloco</button>
      </div>
      {children ? <div style={{ marginTop: 16, borderTop: "1px solid " + C.borda, paddingTop: 14 }}>{children(bloco)}</div> : null}
      {rodape ? <div style={{ marginTop: 14, borderTop: "1px solid " + C.borda, paddingTop: 14 }}>{rodape(bloco, idx === ritual.blocos.length - 1)}</div> : null}
    </div>
  );
}

/* Check-in de energia. A nota fica só neste aparelho: ninguém do RH lê, e
   ela não entra em prêmio, avaliação nem desligamento. O motivo é opcional. */
function FormEnergia({ user, hojeIso }) {
  const atual = energiaLer(user.id).filter((e) => e.data === hojeIso)[0] || null;
  const [nota, setNota] = useState(atual ? atual.nota : 0);
  const [motivo, setMotivo] = useState(atual ? atual.motivo : "");
  const [ajuda, setAjuda] = useState(atual ? atual.ajuda : "");
  const [salvo, setSalvo] = useState(false);
  return (
    <div>
      <div style={{ fontSize: 13, color: C.branco, marginBottom: 8 }}>Sua nota de ânimo hoje</div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
          <button key={n} onClick={() => { setNota(n); setSalvo(false); }}
            style={{ width: 38, height: 38, borderRadius: 10, cursor: "pointer", fontWeight: 700, border: "1px solid " + (nota === n ? corEnergia(n) : C.borda), color: nota === n ? C.preto : C.cinza, background: nota === n ? corEnergia(n) : "transparent" }}>{n}</button>
        ))}
      </div>
      <textarea style={{ ...S.input, marginTop: 10, minHeight: 60 }} maxLength={280} value={motivo}
        onChange={(e) => { setMotivo(e.target.value); setSalvo(false); }} placeholder="Motivo da nota (opcional)" />
      <textarea style={{ ...S.input, marginTop: 8, minHeight: 60 }} maxLength={280} value={ajuda}
        onChange={(e) => { setAjuda(e.target.value); setSalvo(false); }} placeholder="Como o time pode aliviar sua carga nesta semana? (opcional)" />
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
        <button style={{ ...S.btn, padding: "8px 18px", fontSize: 13 }} disabled={!nota}
          onClick={() => { energiaGravar(user.id, hojeIso, nota, motivo, ajuda); setSalvo(true); }}>Guardar check-in</button>
        {salvo && <span style={{ fontSize: 12, color: C.verde }}>guardado neste aparelho ✔</span>}
      </div>
      <p style={{ fontSize: 11.5, color: C.cinza, margin: "10px 0 0", lineHeight: 1.6 }}>
        Fica só no seu navegador, como a hidratação. O gestor não enxerga sua nota.
      </p>
    </div>
  );
}

/* As três perguntas do planejamento. "O que entreguei" já vem preenchido com
   os combinados que você fechou desde a última reunião. */
function FormPerguntas({ user, usuarios, hojeIso, acoes, ritual, respostas, respostasNoBanco, onResponder }) {
  const ant = reuniaoAnterior(new Date());
  const desde = ant ? dataISO(ant.data) : "";
  const feitas = desde ? acoesConcluidasDesde(acoes, desde) : [];
  const ritualId = (ritual && ritual.id) || "";
  /* O que veio do banco vale mais que o rascunho do aparelho: se a pessoa
     respondeu no celular, o mesmo texto tem que aparecer no computador. */
  const doBanco = respostasDoDia(respostas, hojeIso, ritualId)
    .filter((x) => x.autorId === user.id)[0] || null;
  const [r, setR] = useState(() => doBanco
    ? { entreguei: doBanco.entreguei, foco: doBanco.foco, impedimento: doBanco.impedimento }
    : respostasLer(user.id, hojeIso));
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState("");
  useEffect(() => {
    if (!r.entreguei && feitas.length) setR((o) => ({ ...o, entreguei: feitas.map((a) => "• " + a.texto).join("\n") }));
  }, [feitas.length]);
  async function guardar() {
    setSalvando(true);
    setAviso("");
    try { setAviso(await onResponder(ritualId, r)); }
    catch (e) { setAviso(mensagemAmigavel(e, "ao guardar suas respostas")); }
    setSalvando(false);
  }
  function campo(chave, rotulo, dica) {
    return (
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12.5, color: C.branco }}>{rotulo}</div>
        <textarea style={{ ...S.input, marginTop: 6, minHeight: 66 }} maxLength={500} value={r[chave]}
          onChange={(e) => { setR({ ...r, [chave]: e.target.value }); setAviso(""); }} placeholder={dica} />
      </div>
    );
  }
  return (
    <div>
      {campo("entreguei", "O que eu entreguei desde a última reunião?", "puxado dos seus combinados concluídos")}
      {campo("foco", "No que eu vou focar nesta semana?", "no máximo três frentes")}
      {campo("impedimento", "Tenho algum impedimento ou preciso de ajuda?", "diga cedo, não no fim do prazo")}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
        <button style={{ ...S.btn, padding: "8px 18px", fontSize: 13, opacity: salvando ? 0.6 : 1 }}
          disabled={salvando} onClick={guardar}>{salvando ? "Guardando…" : "Guardar respostas"}</button>
        {aviso ? <span style={{ fontSize: 12, color: C.cinza }}>{aviso}</span> : null}
      </div>
      <RespostasDoTime user={user} usuarios={usuarios} respostas={respostas}
        respostasNoBanco={respostasNoBanco} hojeIso={hojeIso} ritualId={ritualId} />
    </div>
  );
}

/* O bloco de dependencias comeca pelo que ja esta travado. Antes ele abria
   direto o formulario de combinado, o que assumia que alguem lembraria de cabeca
   quem pediu ajuda dez minutos antes. Agora a lista vem do que o time escreveu
   e do que esta vencendo, e o combinado nasce em cima disso. */
function PainelImpedimentos({ respostas, acoes, hojeIso, ritual, onVirarCombinado }) {
  const imp = impedimentosComHistorico(respostas, ritual && ritual.id, hojeIso);
  const venc = combinadosNaPauta(acoes, hojeIso);
  const travados = imp.filter((x) => x.travado);
  if (!imp.length && !venc.length) {
    return (
      <p style={{ fontSize: 12, color: C.cinza, margin: "0 0 14px", lineHeight: 1.6 }}>
        Ninguém marcou impedimento e nada está vencendo hoje. Ainda vale a pergunta em voz alta: o que você precisa de mim para avançar?
      </p>
    );
  }
  return (
    <div style={{ marginBottom: 16 }}>
      {travados.length ? (
        <div style={{ border: "1px solid " + C.vermelho, borderRadius: 12, padding: "10px 14px", marginBottom: 12, background: "rgba(220,80,80,0.07)" }}>
          <div style={{ ...S.display, fontSize: 13, color: C.vermelho }}>Isto já apareceu na reunião passada</div>
          <p style={{ fontSize: 12, color: C.cinza, margin: "6px 0 0", lineHeight: 1.6 }}>
            {travados.length > 1 ? travados.length + " pedidos de ajuda voltaram" : "Um pedido de ajuda voltou"} sem sair do lugar. Pedido que repete quase nunca é falta de esforço de quem pediu: é decisão que ainda não foi tomada, ou prioridade que ninguém trocou. Vale gastar esta reunião nisso antes de falar de qualquer coisa nova.
          </p>
        </div>
      ) : null}
      {imp.length ? (
        <div style={{ marginBottom: venc.length ? 12 : 0 }}>
          <div style={{ ...S.display, fontSize: 13, color: C.branco }}>Pedidos de ajuda desta reunião</div>
          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
            {imp.map((x, i) => (
              <div key={i} style={{ border: "1px solid " + C.borda, borderLeft: "3px solid " + (x.travado ? C.vermelho : C.amarelo), borderRadius: 10, padding: "8px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ fontSize: 12.5, color: C.branco }}>{x.autor}</div>
                  {x.travado ? (
                    <span style={{ fontSize: 10.5, color: C.vermelho, border: "1px solid " + C.vermelho, borderRadius: 20, padding: "1px 8px" }}>
                      já pediu em {fmtData(x.desde)}
                    </span>
                  ) : null}
                </div>
                <div style={{ fontSize: 12.5, color: C.cinza, marginTop: 3, whiteSpace: "pre-wrap" }}>{x.texto}</div>
                {x.travado && x.anterior && x.anterior !== x.texto ? (
                  <div style={{ fontSize: 11.5, color: C.cinza, marginTop: 4, opacity: 0.85, whiteSpace: "pre-wrap" }}>
                    na reunião passada: {x.anterior}
                  </div>
                ) : null}
                {onVirarCombinado ? (
                  <button
                    style={{ ...S.btnGhost, padding: "4px 10px", fontSize: 11.5, marginTop: 8 }}
                    onClick={() => onVirarCombinado(x)}
                  >
                    Virar combinado
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {venc.length ? (
        <div>
          <div style={{ ...S.display, fontSize: 13, color: C.branco }}>Combinados vencendo</div>
          <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
            {venc.slice(0, 8).map((a) => (
              <div key={a.id} style={{ fontSize: 12.5, color: C.cinza }}>
                • {a.texto} <span style={{ color: a.prazo < hojeIso ? C.vermelho : C.amarelo }}>({a.dono || "sem dono"} · {fmtData(a.prazo)})</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <p style={{ fontSize: 12, color: C.cinza, margin: "12px 0 0", lineHeight: 1.6 }}>
        Cada item acima sai daqui como combinado com dono e prazo, ou sai como decidido que não se faz. Ficar na lista sem dono é o jeito mais silencioso de não resolver.
      </p>
    </div>
  );
}

/* As respostas do time lado a lado. Sem isto o ritual das tres perguntas nao
   existe de verdade: cada um lia so a propria folha e a reuniao voltava a ser
   "agora conta o que voce fez", que e a versao chata e inutil da mesma coisa.
   Quem nao respondeu aparece como nao respondeu, sem vermelho e sem cobranca -
   a reuniao e as 09:15, dificilmente todo mundo escreveu antes. */
function RespostasDoTime({ user, usuarios, respostas, respostasNoBanco, hojeIso, ritualId }) {
  const doDia = respostasDoDia(respostas, hojeIso, ritualId);
  const ativos = (usuarios || []).filter((u) => u && u.ativo !== false);
  const linhas = ativos.map((u) => ({
    nome: u.nome,
    eu: u.id === user.id,
    r: doDia.filter((x) => x.autorId === u.id)[0] || null,
  }));
  const responderam = linhas.filter((l) => l.r && !respostaVazia(l.r)).length;
  return (
    <div style={{ marginTop: 18, borderTop: "1px solid " + C.borda, paddingTop: 14 }}>
      <div style={{ ...S.display, fontSize: 13.5, color: C.branco }}>As três perguntas do time hoje</div>
      <p style={{ fontSize: 12, color: C.cinza, margin: "6px 0 12px", lineHeight: 1.6 }}>
        {respostasNoBanco
          ? "Todo mundo do time lê estas respostas — é o que faz a reunião começar já sabendo do que falar."
          : "Guardado só neste aparelho: a tabela respostas ainda não existe no banco, então cada um vê apenas a própria resposta."}
      </p>
      {!respostasNoBanco ? null : (
        <div style={{ fontSize: 12, color: C.cinza, marginBottom: 10 }}>
          {responderam} de {linhas.length} já escreveram.
        </div>
      )}
      <div style={{ display: "grid", gap: 10 }}>
        {linhas.map((l) => (
          <div key={l.nome} style={{ border: "1px solid " + C.borda, borderRadius: 12, padding: "10px 12px" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <b style={{ fontSize: 13, color: C.branco }}>{l.nome}</b>
              {l.eu ? <span style={{ ...S.tag, fontSize: 10.5 }}>você</span> : null}
            </div>
            {!l.r || respostaVazia(l.r) ? (
              <div style={{ fontSize: 12, color: C.cinza, marginTop: 6 }}>ainda não escreveu — dá para responder na hora, em voz alta.</div>
            ) : (
              <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                {l.r.entreguei ? <div style={{ fontSize: 12.5, color: C.cinza, whiteSpace: "pre-wrap" }}><b style={{ color: C.branco }}>Entregou:</b> {l.r.entreguei}</div> : null}
                {l.r.foco ? <div style={{ fontSize: 12.5, color: C.cinza, whiteSpace: "pre-wrap" }}><b style={{ color: C.branco }}>Foco:</b> {l.r.foco}</div> : null}
                {l.r.impedimento ? <div style={{ fontSize: 12.5, color: C.amarelo, whiteSpace: "pre-wrap" }}><b>Precisa de ajuda:</b> {l.r.impedimento}</div> : null}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* Combinado = o que foi acordado na reunião, com dono e prazo. É isto que
   fecha o ciclo: vira lembrete no Bater ponto e volta preenchido na
   pergunta "o que eu entreguei" da reunião seguinte. */
function FormCombinado({ user, usuarios, origem, onCriar, rascunho }) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [texto, setTexto] = useState("");
  const [dono, setDono] = useState(user.nome || "");
  const [prazo, setPrazo] = useState("");
  const [veioDe, setVeioDe] = useState("");
  /* Pedido de ajuda vindo do painel de impedimentos ja entra escrito aqui.
     Reescrever a mao o que o colega acabou de dizer e exatamente a etapa onde
     o combinado costuma morrer. O DONO nao vem preenchido de proposito: quem
     pediu ajuda quase nunca e quem consegue destravar. */
  const rascunhoSeq = rascunho ? rascunho.seq : 0;
  useEffect(() => {
    if (!rascunho || !rascunho.texto) return;
    setTexto(String(rascunho.texto).slice(0, 280));
    setVeioDe(rascunho.autor || "");
    setErro("");
  }, [rascunhoSeq]);
  const nomes = (usuarios || []).filter((u) => u && u.nome && u.ativo !== false).map((u) => u.nome);
  const opcoes = nomes.length ? nomes : [user.nome || "eu"];
  /* Gravar pode ir ao banco agora, entao pode demorar e pode falhar.
     Enquanto nao volta, o botao trava; se falhar, a frase fica na tela
     e o texto do usuario NAO e apagado. */
  async function salvar() {
    if (!texto.trim() || salvando) return;
    setSalvando(true);
    setErro("");
    try {
      await onCriar(acaoNova(texto, dono, prazo, origem));
      setTexto("");
      setPrazo("");
      setVeioDe("");
    } catch (e) {
      setErro(mensagemAmigavel(e, "ao registrar o combinado"));
    } finally {
      setSalvando(false);
    }
  }
  return (
    <div>
      <div style={{ fontSize: 13, color: C.branco, marginBottom: 8 }}>Registrar um combinado desta etapa</div>
      {veioDe && texto.trim() ? (
        <p style={{ fontSize: 11.5, color: C.amarelo, margin: "0 0 6px", lineHeight: 1.5 }}>
          Veio do pedido de ajuda de {veioDe}. Escolha quem destrava e até quando — sem dono e sem data isto volta igual na próxima reunião.
        </p>
      ) : null}
      <textarea style={{ ...S.input, minHeight: 60 }} maxLength={280} value={texto}
        onChange={(e) => setTexto(e.target.value)} placeholder="O que ficou acordado, em uma frase" />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <select style={{ ...S.input, flex: "1 1 150px" }} value={dono} onChange={(e) => setDono(e.target.value)}>
          {opcoes.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <input type="date" style={{ ...S.input, flex: "1 1 150px" }} value={prazo} onChange={(e) => setPrazo(e.target.value)} />
        <button style={{ ...S.btn, padding: "8px 18px", fontSize: 13 }} onClick={salvar} disabled={!texto.trim() || salvando}>{salvando ? "Gravando..." : "Combinar"}</button>
      </div>
      {erro && <p style={{ fontSize: 12, color: C.vermelho, margin: "8px 0 0", lineHeight: 1.5 }}>{erro}</p>}
    </div>
  );
}

function ListaCombinados({ acoes, onAlternar, hojeIso, compacta }) {
  const abertas = acoesAbertas(acoes);
  const atrasadas = acoesAtrasadas(acoes, hojeIso);
  const [ocupado, setOcupado] = useState("");
  async function alternar(id) {
    if (ocupado) return;
    setOcupado(id);
    try { await onAlternar(id); } catch { /* onAlternar ja mostra o aviso; aqui so libera o clique */ }
    finally { setOcupado(""); }
  }
  const mostrar = compacta ? abertas.slice(0, 4) : (acoes || []).slice().sort((a, b) => Number(a.feito) - Number(b.feito) || String(a.prazo || "9").localeCompare(String(b.prazo || "9")));
  if (!mostrar.length) {
    return <p style={{ fontSize: 12.5, color: C.cinza, margin: 0, lineHeight: 1.6 }}>Nenhum combinado por aqui ainda. Eles nascem nas etapas de decisão das reuniões.</p>;
  }
  return (
    <div>
      {!compacta && atrasadas.length > 0 && (
        <p style={{ fontSize: 12.5, color: C.vermelho, margin: "0 0 10px" }}>{atrasadas.length === 1 ? "1 combinado passou do prazo." : atrasadas.length + " combinados passaram do prazo."}</p>
      )}
      {mostrar.map((a) => {
        const atrasado = !a.feito && a.prazo && a.prazo < hojeIso;
        return (
          <div key={a.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "9px 0", borderTop: "1px solid " + C.borda }}>
            <button onClick={() => alternar(a.id)} aria-label={a.feito ? "reabrir" : "concluir"}
              style={{ width: 22, height: 22, marginTop: 2, flex: "0 0 auto", borderRadius: 6, cursor: "pointer", border: "1px solid " + (a.feito ? C.verde : C.bordaForte), background: a.feito ? C.verde : "transparent", color: C.preto, fontSize: 13, lineHeight: 1 }}>{a.feito ? "✓" : ""}</button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: a.feito ? C.cinza : C.branco, textDecoration: a.feito ? "line-through" : "none", lineHeight: 1.5 }}>{a.texto}</div>
              <div style={{ fontSize: 11.5, color: atrasado ? C.vermelho : C.cinza, marginTop: 3 }}>
                {(a.dono ? a.dono : "sem dono") + (a.prazo ? " · até " + a.prazo.split("-").reverse().join("/") : " · sem prazo") + (a.origem ? " · " + a.origem : "")}
              </div>
            </div>
          </div>
        );
      })}
      {compacta && abertas.length > 4 && (
        <p style={{ fontSize: 11.5, color: C.cinza, margin: "8px 0 0" }}>{"e mais " + (abertas.length - 4) + " em Nosso time."}</p>
      )}
    </div>
  );
}

/* Tela Nosso time: o roteiro das reuniões, os combinados e o check-in.
   Nesta primeira versão tudo mora no aparelho — nenhuma tabela nova no
   Supabase, nenhum dado saindo do navegador de quem escreveu. */
function TelaTime({ user, usuarios, acoes, onCriar, onAlternar, acoesNoBanco, salas, onSalvarSalas, semente,
  registros = [], faltas = [], onGerarAta,
  rit = { conquistas: [], elogios: [], motivadores: [], anjo: null, atas: [], respostas: [] },
  onConquista, onElogio, onMotivadores, onSortearAnjo, onResponder }) {
  const agora = new Date();
  const hojeIso = dataISO(agora);
  const [aba, setAba] = useState("roteiro");
  /* Um campo por ritual mais o campo geral, que e a reserva de quem ficou vazio. */
  const [salaTxt, setSalaTxt] = useState(() => ({ geral: (salas && salas.geral) || "", semanal: (salas && salas.semanal) || "", quinzenal: (salas && salas.quinzenal) || "", mensal: (salas && salas.mensal) || "" }));
  const [sementeTxt, setSementeTxt] = useState("");
  const [salvandoSala, setSalvandoSala] = useState(false);
  const [avisoSala, setAvisoSala] = useState("");
  /* Rascunho de combinado nascido de um pedido de ajuda. Fica aqui, e nao
     dentro do formulario, porque quem aperta o botao e o painel de cima. */
  const [rascunhoComb, setRascunhoComb] = useState(null);
  /* O gestor pode abrir a tela antes de os links chegarem do banco. */
  useEffect(() => {
    setSalaTxt({ geral: (salas && salas.geral) || "", semanal: (salas && salas.semanal) || "",
      quinzenal: (salas && salas.quinzenal) || "", mensal: (salas && salas.mensal) || "" });
  }, [salas && salas.geral, salas && salas.semanal, salas && salas.quinzenal, salas && salas.mensal]);
  async function salvarSala() {
    setSalvandoSala(true);
    setAvisoSala("");
    try { setAvisoSala(await onSalvarSalas(salaTxt, sementeTxt || "")); }
    catch (e) { setAvisoSala(mensagemAmigavel(e, "ao salvar os links das salas")); }
    finally { setSalvandoSala(false); }
  }
  /* Preenche so o que estiver vazio: link colado pelo gestor manda mais que
     sugestao do app. A semente e sorteada uma unica vez e vai junto no salvar. */
  function sugerirSalas() {
    const sem = String(semente || sementeTxt || "").trim() || sortearSementeSala();
    setSementeTxt(sem);
    setSalaTxt((v) => {
      const novo = { ...v };
      SALAS_RITUAIS.forEach((k) => { if (!String(novo[k] || "").trim()) novo[k] = enderecoSalaSugerido(sem, k); });
      return novo;
    });
    setAvisoSala("Endereços sugeridos. Confira se a sala abre e depois salve.");
  }
  const [ritualId, setRitualId] = useState(() => {
    const d = reunioesDoDia(new Date());
    if (d.length) return d[0].id;
    const p = proximasReunioes(new Date(), 21);
    return p && p.reunioes[0] ? p.reunioes[0].id : "semanal";
  });
  const ritual = ritualPorId(ritualId) || RITUAIS[0];
  const ehGestor = user.papel === "gestor";
  const prox = proximasReunioes(agora, 21);
  const hist = energiaLer(user.id).slice(-12);
  const abas = [["roteiro", "🗓️ Roteiro"], ["combinados", "✅ Combinados"], ["atas", "📄 Atas"], ["mural", "🏆 Mural"],
    ["motiva", "💡 O que me motiva"], ["anjo", "😇 Anjo"], ["energia", "🔋 Meu check-in"]];
  return (
    <div>
      <h1 style={{ ...S.display, fontSize: 26, margin: 0 }}>Nosso time</h1>
      {rit.anjo && rit.anjo.protegido && (
        <div style={{ fontSize: 12.5, color: C.cinza, marginTop: 8, lineHeight: 1.5 }}>😇 Nesta rodada você é o anjo de <b style={{ color: C.branco }}>{rit.anjo.protegido}</b>.</div>
      )}
      {prox && (
        <div className="pr-relevo" style={{ ...S.card, marginTop: 14, padding: 16, borderLeft: "4px solid " + C.amarelo }}>
          <div style={{ ...S.display, fontSize: 14, color: C.amarelo }}>PRÓXIMA REUNIÃO</div>
          {prox.reunioes.map((r) => (
            <div key={r.id} style={{ fontSize: 14, color: C.branco, marginTop: 6 }}>
              {r.icone} <b>{r.nome}</b>
              <span style={{ color: C.cinza }}>{" · " + rotuloDiaReuniao(prox.data, agora) + " às " + r.inicio + " · " + r.duracaoMin + " min"}</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                {salaDoRitual(salas, r.id)
                  ? <button style={{ ...S.btn, padding: "8px 16px", fontSize: 13 }} onClick={() => abrirSala(salaDoRitual(salas, r.id))}>🎥 Entrar na chamada</button>
                  : <span style={{ fontSize: 12, color: C.cinza }}>Sem sala de vídeo configurada para este ritual.</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "18px 0 14px" }}>
        {abas.map(([k, rot]) => (
          <button key={k} onClick={() => setAba(k)}
            style={{ ...(aba === k ? S.btn : S.btnGhost), padding: "8px 16px", fontSize: 13 }}>{rot}</button>
        ))}
      </div>
      {aba === "roteiro" && (
        <div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {RITUAIS.map((r) => (
              <button key={r.id} onClick={() => setRitualId(r.id)}
                style={{ ...S.tag, cursor: "pointer", fontSize: 12, background: "transparent", border: "1px solid " + (r.id === ritualId ? C.amarelo : C.borda), color: r.id === ritualId ? C.amarelo : C.cinza }}>
                {r.icone + " " + r.nome}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 12.5, color: C.cinza, margin: "0 0 12px", lineHeight: 1.6 }}>{ritual.quando + " · início " + ritual.inicio + " · " + ritual.duracaoMin + " min · " + ritual.resumo}</p>
          <Roteiro ritual={ritual} rodape={(bloco, ultimo) => (
            <EncerrarReuniao user={user} usuarios={usuarios} registros={registros} acoes={acoes}
              ritual={ritual} hojeIso={hojeIso} atas={rit.atas || []} atasNoBanco={!!rit.atasNoBanco}
              ultimo={ultimo} onGerarAta={onGerarAta} />
          )}>
            {(bloco) => (
              bloco.tipo === "energia" ? <FormEnergia user={user} hojeIso={hojeIso} />
                : bloco.tipo === "metas" ? <FormPerguntas user={user} usuarios={usuarios} hojeIso={hojeIso} acoes={acoes}
                    ritual={ritual} respostas={rit.respostas || []} respostasNoBanco={!!rit.respostasNoBanco}
                    onResponder={onResponder} />
                  : bloco.tipo === "numeros" ? <PainelNumerosMes user={user} usuarios={usuarios} registros={registros} faltas={faltas} acoes={acoes} />
                    : bloco.tipo === "elogios" ? <FormElogioReuniao user={user} usuarios={usuarios} origem={ritual.nome} onElogio={onElogio} />
                      : bloco.tipo === "acoes" ? (
                        <>
                          <PainelImpedimentos respostas={rit.respostas || []} acoes={acoes} hojeIso={hojeIso} ritual={ritual}
                            onVirarCombinado={(x) => setRascunhoComb({ texto: x.texto, autor: x.autor, seq: Date.now() })} />
                          <FormCombinado user={user} usuarios={usuarios} origem={ritual.nome} onCriar={onCriar} rascunho={rascunhoComb} />
                        </>
                      )
                      : <FormCombinado user={user} usuarios={usuarios} origem={ritual.nome} onCriar={onCriar} />
            )}
          </Roteiro>
        </div>
      )}
      {aba === "combinados" && (
        <div style={{ ...S.card, padding: 16 }}>
          <div style={{ ...S.display, fontSize: 15, color: C.branco, marginBottom: 12 }}>Combinados do time</div>
          <p style={{ fontSize: 12, color: C.cinza, margin: "-6px 0 12px", lineHeight: 1.6 }}>{acoesNoBanco ? "Todo mundo do time vê e pode acompanhar esta lista." : "Guardado só neste aparelho: a tabela combinados ainda não existe no banco."}</p>
          <FormCombinado user={user} usuarios={usuarios} origem="avulso" onCriar={onCriar} />
          <div style={{ marginTop: 16 }}>
            <ListaCombinados acoes={acoes} onAlternar={onAlternar} hojeIso={hojeIso} />
          </div>
        </div>
      )}
      {aba === "energia" && (
        <div style={{ ...S.card, padding: 16 }}>
          <div style={{ ...S.display, fontSize: 15, color: C.branco }}>Seu ânimo nas últimas semanas</div>
          {hist.length ? (
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 120, marginTop: 16 }}>
              {hist.map((e) => (
                <div key={e.data} style={{ flex: 1, textAlign: "center" }} title={e.motivo || ""}>
                  <div style={{ height: (e.nota * 9) + "px", borderRadius: "6px 6px 0 0", background: corEnergia(e.nota) }} />
                  <div style={{ fontSize: 10, color: C.cinza, marginTop: 5 }}>{e.data.slice(8) + "/" + e.data.slice(5, 7)}</div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 12.5, color: C.cinza, margin: "8px 0 0", lineHeight: 1.6 }}>Nada registrado ainda. O check-in abre no primeiro bloco do planejamento de segunda.</p>
          )}
          <div style={{ marginTop: 18, borderTop: "1px solid " + C.borda, paddingTop: 14 }}>
            <FormEnergia user={user} hojeIso={hojeIso} />
          </div>
        </div>
      )}
      {aba === "atas" && (
        <div style={{ ...S.card, padding: 16 }}>
          <div style={{ ...S.display, fontSize: 15, color: C.branco, marginBottom: 6 }}>Atas das reuniões</div>
          <p style={{ fontSize: 12, color: C.cinza, margin: "0 0 14px", lineHeight: 1.6 }}>
            {rit.atasNoBanco ? "O app monta a ata sozinho quando a reunião é encerrada no roteiro. Todo o time enxerga." : "Guardado só neste aparelho: a tabela atas ainda não existe no banco."}
          </p>
          {(rit.atas || []).length ? (rit.atas || []).map((a) => <CartaoAta key={a.id} ata={a} />)
            : <p style={{ fontSize: 12.5, color: C.cinza, margin: 0, lineHeight: 1.6 }}>Nenhuma ata ainda. Ela nasce quando alguém encerra a reunião no último bloco do roteiro.</p>}
        </div>
      )}
      {aba === "mural" && (
        <AbaMural user={user} usuarios={usuarios} conquistas={rit.conquistas} elogios={rit.elogios}
          onConquista={onConquista} onElogio={onElogio}
          conquistasNoBanco={rit.conquistasNoBanco} elogiosNoBanco={rit.elogiosNoBanco} />
      )}
      {aba === "motiva" && (
        <AbaMotiva user={user} motivadores={rit.motivadores} motivaNoBanco={rit.motivaNoBanco} onSalvar={onMotivadores} />
      )}
      {aba === "anjo" && (
        <AbaAnjo user={user} usuarios={usuarios} anjo={rit.anjo} anjoNoBanco={rit.anjoNoBanco} onSortear={onSortearAnjo} />
      )}
      {ehGestor && (
        <div style={{ ...S.card, padding: 16, marginTop: 14 }}>
          <div style={{ ...S.display, fontSize: 14, color: C.branco }}>🎥 Salas de videochamada</div>
          <p style={{ fontSize: 12, color: C.cinza, margin: "6px 0 10px", lineHeight: 1.6 }}>
            O app não hospeda a chamada: ele guarda o endereço e mostra quem já entrou. Cada ritual pode ter a sua sala; o que ficar em branco usa o link geral. Só aceita endereço https.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[{ id: "geral", nome: "Link geral do time", dica: "vale para o ritual que não tiver sala própria" }]
              .concat(SALAS_RITUAIS.map((k) => {
                const r = ritualPorId(k);
                return { id: k, nome: r ? r.icone + " " + r.nome : k, dica: "opcional" };
              }))
              .map((campo) => (
                <div key={campo.id}>
                  <div style={{ fontSize: 12, color: C.cinza, marginBottom: 4 }}>{campo.nome + " · " + campo.dica}</div>
                  <input style={{ ...S.input, width: "100%" }} value={salaTxt[campo.id] || ""}
                    onChange={(e) => setSalaTxt((v) => ({ ...v, [campo.id]: e.target.value }))}
                    placeholder="https://meet.google.com/xxx-xxxx-xxx" />
                  {salaTxt[campo.id] && !salaValida(salaTxt[campo.id]) && (
                    <p style={{ fontSize: 12, color: C.vermelho, margin: "4px 0 0" }}>Endereço inválido — precisa começar com https://</p>
                  )}
                </div>
              ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <button style={{ ...S.btn, padding: "8px 18px", fontSize: 13 }} onClick={salvarSala} disabled={salvandoSala}>{salvandoSala ? "Salvando..." : "Salvar"}</button>
            <button style={{ ...S.btnGhost, padding: "8px 18px", fontSize: 13 }} onClick={sugerirSalas} disabled={salvandoSala}>Sugerir endereços</button>
          </div>
          <p style={{ fontSize: 11.5, color: C.cinza, margin: "8px 0 0", lineHeight: 1.5 }}>
            Sugerir endereços só preenche o que estiver vazio, com um nome de sala sorteado, difícil de alguém de fora adivinhar. O app não cria nem administra a sala: abra o endereço uma vez para conferir se funciona antes de contar com ele.
          </p>
          {avisoSala && <p style={{ fontSize: 12, color: C.cinza, margin: "8px 0 0", lineHeight: 1.5 }}>{avisoSala}</p>}
        </div>
      )}
    </div>
  );
}

/* ---------- mural, elogios, motivadores e anjo na tela ----------
   Quatro rituais que falam de pessoa, nao de tarefa. Cada bloco diz, antes de
   qualquer campo, onde o que voce escreve vai parar e quem consegue ler. */
function diaCurtoIso(iso) {
  const s = String(iso || "");
  return s.length >= 10 ? s.slice(8, 10) + "/" + s.slice(5, 7) : "";
}

function AbaMural({ user, usuarios, conquistas, elogios, onConquista, onElogio, conquistasNoBanco, elogiosNoBanco }) {
  const [texto, setTexto] = useState("");
  const [tipo, setTipo] = useState("vitoria");
  const [salvandoC, setSalvandoC] = useState(false);
  const [erroC, setErroC] = useState("");
  const [elogio, setElogio] = useState("");
  const [para, setPara] = useState("");
  const [salvandoE, setSalvandoE] = useState(false);
  const [erroE, setErroE] = useState("");
  const colegas = (usuarios || []).filter((u) => u && u.id !== user.id && u.ativo !== false);
  /* A lista de colegas chega do banco depois da primeira pintura da tela:
     sem isto o select ficaria preso no vazio pra sempre. */
  useEffect(() => {
    if (!para && colegas.length) setPara(colegas[0].id);
  }, [usuarios]);
  async function publicar() {
    if (!texto.trim() || salvandoC) return;
    setSalvandoC(true);
    setErroC("");
    try { await onConquista(texto, tipo); setTexto(""); }
    catch (e) { setErroC(mensagemAmigavel(e, "ao publicar no mural")); }
    finally { setSalvandoC(false); }
  }
  async function elogiar() {
    const alvo = colegas.filter((u) => u.id === para)[0];
    if (!elogio.trim() || !alvo || salvandoE) return;
    setSalvandoE(true);
    setErroE("");
    try { await onElogio(alvo, elogio); setElogio(""); }
    catch (e) { setErroE(mensagemAmigavel(e, "ao registrar o elogio")); }
    finally { setSalvandoE(false); }
  }
  return (
    <div>
      <div style={{ ...S.card, padding: 16 }}>
        <div style={{ ...S.display, fontSize: 15, color: C.branco }}>Mural de conquistas</div>
        <p style={{ fontSize: 12, color: C.cinza, margin: "6px 0 12px", lineHeight: 1.6 }}>
          {conquistasNoBanco
            ? "Vitória contada em voz alta vira memória do time. Todo mundo aqui lê o que você publicar."
            : "Guardado só neste aparelho: a tabela conquistas ainda não existe no banco."}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          {[["vitoria", "🏆 Vitória"], ["superacao", "💪 Superação"]].map(([k, rot]) => (
            <button key={k} onClick={() => setTipo(k)}
              style={{ ...(tipo === k ? S.btn : S.btnGhost), padding: "6px 14px", fontSize: 12.5 }}>{rot}</button>
          ))}
        </div>
        <textarea style={{ ...S.input, minHeight: 64 }} maxLength={400} value={texto}
          onChange={(e) => setTexto(e.target.value)} placeholder="O que deu certo, ou o que foi difícil e você superou" />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <button style={{ ...S.btn, padding: "8px 18px", fontSize: 13 }} onClick={publicar} disabled={!texto.trim() || salvandoC}>{salvandoC ? "Publicando..." : "Publicar no mural"}</button>
        </div>
        {erroC && <p style={{ fontSize: 12, color: C.vermelho, margin: "8px 0 0", lineHeight: 1.5 }}>{erroC}</p>}
        <div style={{ marginTop: 16 }}>
          {(conquistas || []).length ? (conquistas || []).map((c) => (
            <div key={c.id} style={{ borderTop: "1px solid " + C.borda, padding: "10px 0" }}>
              <div style={{ fontSize: 13.5, color: C.branco, lineHeight: 1.5 }}>
                <span style={{ marginRight: 6 }}>{c.tipo === "superacao" ? "💪" : "🏆"}</span>{c.texto}
              </div>
              <div style={{ fontSize: 11.5, color: C.cinza, marginTop: 4 }}>{(c.autor || "alguém do time") + (diaCurtoIso(c.criadoEm) ? " · " + diaCurtoIso(c.criadoEm) : "")}</div>
            </div>
          )) : <p style={{ fontSize: 12.5, color: C.cinza, margin: 0, lineHeight: 1.6 }}>O mural está vazio. A primeira conquista pode ser pequena — o que importa é começar a contar.</p>}
        </div>
      </div>

      <div style={{ ...S.card, padding: 16, marginTop: 14 }}>
        <div style={{ ...S.display, fontSize: 15, color: C.branco }}>Gratidão e elogios</div>
        <p style={{ fontSize: 12, color: C.cinza, margin: "6px 0 12px", lineHeight: 1.6 }}>
          {elogiosNoBanco
            ? "Escreva para quem te ajudou ou para quem você admira no dia a dia. O elogio fica visível para o time e assinado por você."
            : "Guardado só neste aparelho: a tabela elogios ainda não existe no banco."}
        </p>
        {colegas.length ? (
          <div>
            <select style={{ ...S.input, marginBottom: 8 }} value={para} onChange={(e) => setPara(e.target.value)}>
              {colegas.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
            <textarea style={{ ...S.input, minHeight: 60 }} maxLength={300} value={elogio}
              onChange={(e) => setElogio(e.target.value)} placeholder="Pelo que você quer agradecer, ou o que essa pessoa faz bem" />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              <button style={{ ...S.btn, padding: "8px 18px", fontSize: 13 }} onClick={elogiar} disabled={!elogio.trim() || salvandoE}>{salvandoE ? "Enviando..." : "Enviar elogio"}</button>
            </div>
          </div>
        ) : <p style={{ fontSize: 12.5, color: C.cinza, margin: 0, lineHeight: 1.6 }}>Ainda não há colegas cadastrados para elogiar.</p>}
        {erroE && <p style={{ fontSize: 12, color: C.vermelho, margin: "8px 0 0", lineHeight: 1.5 }}>{erroE}</p>}
        <div style={{ marginTop: 16 }}>
          {(elogios || []).length ? (elogios || []).map((e) => (
            <div key={e.id} style={{ borderTop: "1px solid " + C.borda, padding: "10px 0" }}>
              <div style={{ fontSize: 13.5, color: C.branco, lineHeight: 1.5 }}>{e.texto}</div>
              <div style={{ fontSize: 11.5, color: C.cinza, marginTop: 4 }}>{(e.de || "alguém") + " → " + (e.para || "time") + (diaCurtoIso(e.criadoEm) ? " · " + diaCurtoIso(e.criadoEm) : "")}</div>
            </div>
          )) : <p style={{ fontSize: 12.5, color: C.cinza, margin: 0, lineHeight: 1.6 }}>Nenhum elogio registrado ainda.</p>}
        </div>
        <p style={{ fontSize: 11.5, color: C.cinza, margin: "14px 0 0", lineHeight: 1.6, borderTop: "1px solid " + C.borda, paddingTop: 12 }}>
          Elogio e conquista não valem ponto no prêmio nem na gamificação, de propósito: reconhecimento que vira nota deixa de ser reconhecimento e vira meta.
        </p>
      </div>
    </div>
  );
}
function AbaMotiva({ user, motivadores, motivaNoBanco, onSalvar }) {
  const [f, setF] = useState(() => motivaLer(user.id));
  const [aviso, setAviso] = useState("");
  const [salvando, setSalvando] = useState(false);
  const ehGestor = user.papel === "gestor";
  const doTime = (motivadores || []).filter((m) => m.fatores && m.fatores.length);
  const trocar = (i, v) => setF((l) => l.map((x, k) => (k === i ? v : x)));
  async function guardar(compartilhar) {
    if (salvando) return;
    setSalvando(true);
    setAviso("");
    try { setAviso(await onSalvar(f, compartilhar)); }
    catch (e) { setAviso(mensagemAmigavel(e, "ao gravar o que te motiva")); }
    finally { setSalvando(false); }
  }
  return (
    <div>
      <div style={{ ...S.card, padding: 16 }}>
        <div style={{ ...S.display, fontSize: 15, color: C.branco }}>O que me motiva</div>
        <p style={{ fontSize: 12, color: C.cinza, margin: "6px 0 12px", lineHeight: 1.6 }}>
          Três coisas que fazem você querer trabalhar. Enquanto ficar guardado no aparelho, ninguém além de você lê. Se você compartilhar, quem tem acesso de gestor passa a ler — e a ideia é justamente essa: virar assunto de conversa.
        </p>
        {[0, 1, 2].map((i) => (
          <input key={i} style={{ ...S.input, marginBottom: 8 }} maxLength={160} value={f[i] || ""}
            onChange={(e) => trocar(i, e.target.value)} placeholder={"Fator " + (i + 1)} />
        ))}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
          <button style={{ ...S.btnGhost, padding: "8px 16px", fontSize: 13 }} onClick={() => guardar(false)} disabled={salvando}>Guardar só neste aparelho</button>
          <button style={{ ...S.btn, padding: "8px 16px", fontSize: 13 }} onClick={() => guardar(true)} disabled={salvando}>{salvando ? "Gravando..." : "Compartilhar com a liderança"}</button>
        </div>
        {aviso && <p style={{ fontSize: 12, color: C.cinza, margin: "10px 0 0", lineHeight: 1.5 }}>{aviso}</p>}
        <p style={{ fontSize: 11.5, color: C.cinza, margin: "12px 0 0", lineHeight: 1.6 }}>
          Para deixar de compartilhar, apague os três campos e compartilhe de novo.
        </p>
      </div>
      {ehGestor && (
        <div style={{ ...S.card, padding: 16, marginTop: 14 }}>
          <div style={{ ...S.display, fontSize: 15, color: C.branco }}>O que motiva o time</div>
          <p style={{ fontSize: 12, color: C.cinza, margin: "6px 0 12px", lineHeight: 1.6 }}>
            {motivaNoBanco
              ? "Aparece só quem escolheu compartilhar. Serve de pauta de conversa, não de avaliação."
              : "A tabela motivadores ainda não existe no banco, então nada do time chega aqui."}
          </p>
          {doTime.length ? doTime.map((m) => (
            <div key={m.userId} style={{ borderTop: "1px solid " + C.borda, padding: "10px 0" }}>
              <div style={{ fontSize: 13, color: C.branco }}>{m.nome || "colaborador"}</div>
              <div style={{ fontSize: 12.5, color: C.cinza, marginTop: 4, lineHeight: 1.6 }}>{m.fatores.join(" · ")}</div>
            </div>
          )) : <p style={{ fontSize: 12.5, color: C.cinza, margin: 0, lineHeight: 1.6 }}>Ninguém compartilhou ainda.</p>}
        </div>
      )}
    </div>
  );
}

function AbaAnjo({ user, usuarios, anjo, anjoNoBanco, onSortear }) {
  const ehGestor = user.papel === "gestor";
  const padrao = anjoPeriodoPadrao(new Date());
  const [inicio, setInicio] = useState(padrao.inicio);
  const [fim, setFim] = useState(padrao.fim);
  const [aviso, setAviso] = useState("");
  const [sorteando, setSorteando] = useState(false);
  const ativos = (usuarios || []).filter((u) => u && u.ativo !== false);
  async function sortear() {
    if (sorteando) return;
    setSorteando(true);
    setAviso("");
    try { setAviso(await onSortear(inicio, fim)); }
    catch (e) { setAviso(mensagemAmigavel(e, "ao sortear os anjos")); }
    finally { setSorteando(false); }
  }
  return (
    <div>
      <div className="pr-relevo" style={{ ...S.card, padding: 16, borderLeft: "4px solid " + C.amarelo }}>
        <div style={{ ...S.display, fontSize: 14, color: C.amarelo }}>DINÂMICA DO ANJO</div>
        {anjo && anjo.protegido ? (
          <div>
            <div style={{ fontSize: 15, color: C.branco, marginTop: 8, lineHeight: 1.5 }}>Nesta rodada você é o anjo de <b>{anjo.protegido}</b>.</div>
            <div style={{ fontSize: 12.5, color: C.cinza, marginTop: 6 }}>{"de " + diaCurtoIso(anjo.inicio) + " até " + diaCurtoIso(anjo.fim)}</div>
          </div>
        ) : anjo ? (
          <div style={{ fontSize: 13.5, color: C.branco, marginTop: 8, lineHeight: 1.5 }}>A rodada está aberta, mas você não entrou neste sorteio.</div>
        ) : (
          <div style={{ fontSize: 13.5, color: C.branco, marginTop: 8, lineHeight: 1.5 }}>Nenhuma rodada aberta no momento.</div>
        )}
        <p style={{ fontSize: 11.5, color: C.cinza, margin: "12px 0 0", lineHeight: 1.6 }}>
          {anjoNoBanco
            ? "Só você enxerga de quem você é anjo: a regra está no banco, não na tela. Quem administra o Supabase sempre consegue olhar — não prometa segredo absoluto."
            : "As tabelas do anjo ainda não existem no banco, então o sorteio fica só neste aparelho e serve apenas para experimentar."}
        </p>
      </div>
      <div style={{ ...S.card, padding: 16, marginTop: 14 }}>
        <div style={{ ...S.display, fontSize: 14, color: C.branco }}>Como funciona</div>
        <ul style={{ fontSize: 12.5, color: C.cinza, lineHeight: 1.7, margin: "8px 0 0", paddingLeft: 18 }}>
          <li>Dura de uma a duas semanas. Mais que isso o time cansa e a brincadeira morre.</li>
          <li>Nada de presente caro. O combinado é sobre gesto, elogio e ajuda — não sobre dinheiro.</li>
          <li>Repare no que o colega precisa: um café num dia pesado vale mais que um embrulho.</li>
          <li>Ninguém tira a si mesmo, e cada pessoa é cuidada por alguém.</li>
        </ul>
      </div>
      {ehGestor && (
        <div style={{ ...S.card, padding: 16, marginTop: 14 }}>
          <div style={{ ...S.display, fontSize: 14, color: C.branco }}>Abrir uma rodada</div>
          <p style={{ fontSize: 12, color: C.cinza, margin: "6px 0 10px", lineHeight: 1.6 }}>
            {"O app sorteia entre as " + ativos.length + " pessoas ativas e grava os pares sem devolver a lista para ninguém — nem para você."}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input type="date" style={{ ...S.input, flex: "1 1 150px" }} value={inicio} onChange={(e) => setInicio(e.target.value)} />
            <input type="date" style={{ ...S.input, flex: "1 1 150px" }} value={fim} onChange={(e) => setFim(e.target.value)} />
            <button style={{ ...S.btn, padding: "8px 18px", fontSize: 13 }} onClick={sortear} disabled={sorteando || ativos.length < 2}>{sorteando ? "Sorteando..." : "Sortear os anjos"}</button>
          </div>
          {aviso && <p style={{ fontSize: 12, color: C.cinza, margin: "10px 0 0", lineHeight: 1.5 }}>{aviso}</p>}
        </div>
      )}
    </div>
  );
}
/* Cartao seco de numero: rotulo em cima, numero grande, uma linha de
   contexto embaixo. Numero sem contexto vira briga na reuniao. */
function CartaoNumero({ rotulo, valor, nota, cor }) {
  return (
    <div className="pr-relevo" style={{ ...S.card, padding: 14, flex: "1 1 148px", minWidth: 148 }}>
      <div style={{ fontSize: 11, color: C.cinza, letterSpacing: 0.7, textTransform: "uppercase" }}>{rotulo}</div>
      <div style={{ ...S.display, fontSize: 26, color: cor || C.branco, marginTop: 6 }}>{valor}</div>
      {nota ? <div style={{ fontSize: 11.5, color: C.cinza, marginTop: 5, lineHeight: 1.5 }}>{nota}</div> : null}
    </div>
  );
}

/* Painel da "analise fria dos numeros". Existe pra retrospectiva nao comecar
   com a tela em branco e virar conversa de sensacao. Tudo aqui e numero do
   time: nao tem nome de quem atrasou, nao tem quem faltou e nao tem ranking.
   Comparar pessoa a pessoa na frente do grupo nao melhora numero nenhum -
   so ensina o time a esconder problema na reuniao seguinte. */
function PainelNumerosMes({ user, usuarios, registros, faltas, acoes }) {
  const [comp, setComp] = useState(() => compAnterior(compDe(new Date())));
  const n = useMemo(() => numerosDoMes(usuarios, registros, faltas, acoes, comp),
    [usuarios, registros, faltas, acoes, comp]);
  const minha = energiaMediaMes(user.id, comp);
  const opcoes = [];
  let passo = compDe(new Date());
  for (let i = 0; i < 12; i++) { opcoes.push(passo); passo = compAnterior(passo); }
  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <span style={{ fontSize: 12.5, color: C.cinza }}>Mês analisado</span>
        <select value={comp} onChange={(e) => setComp(e.target.value)} style={{ ...S.input, width: "auto", padding: "8px 12px", fontSize: 13 }}>
          {opcoes.map((c) => <option key={c} value={c}>{compExtenso(c)}</option>)}
        </select>
      </div>
      {n.vazio ? (
        <p style={{ fontSize: 13, color: C.cinza, lineHeight: 1.6, margin: 0 }}>
          Ainda não há marcação de ponto nem combinado registrado em {compExtenso(comp)}. Melhor abrir a reunião assumindo isso do que discutir número que não existe.
        </p>
      ) : (
        <div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <CartaoNumero rotulo="Pessoas ativas" valor={n.pessoas} nota={n.diasTrab + " dias de expediente somados"} />
            <CartaoNumero rotulo="Horas trabalhadas" valor={hmm(n.trabalhadoMin)} nota="soma do time no mês" />
            <CartaoNumero rotulo="Saldo do banco" valor={hmm(n.saldoMin)} cor={n.saldoMin < 0 ? C.vermelho : C.verde}
              nota={n.saldoMin < 0 ? "o time fechou o mês devendo horas" : "horas a mais que o time entregou"} />
            <CartaoNumero rotulo="Pontualidade" valor={n.pontualidadePct + "%"} cor={n.pontualidadePct >= 90 ? C.verde : n.pontualidadePct >= 75 ? C.amarelo : C.vermelho}
              nota="dias de expediente sem atraso, somando o time" />
            <CartaoNumero rotulo="Combinados fechados" valor={n.combFeitos + " de " + n.combCriados} cor={n.combFechamentoPct >= 70 ? C.verde : C.amarelo}
              nota={n.combCriados > 0 ? n.combFechamentoPct + "% do que foi combinado no mês" : "nada foi combinado neste mês"} />
            <CartaoNumero rotulo="Ainda em aberto" valor={n.combAbertos} nota="combinados sem conclusão até hoje" />
          </div>
          <p style={{ fontSize: 12, color: C.cinza, marginTop: 14, lineHeight: 1.65 }}>
            Estes números são do time inteiro, de propósito. O app não mostra aqui quem atrasou nem quem faltou: retrospectiva com nome no telão vira tribunal, e no mês seguinte ninguém fala a verdade. Caso individual é conversa reservada, não pauta de grupo.
          </p>
          {minha ? (
            <p style={{ fontSize: 12, color: C.cinza, marginTop: 8, lineHeight: 1.65 }}>
              🔋 Sua média de energia em {compExtenso(comp)} foi <b style={{ color: corEnergia(minha.media) }}>{String(minha.media).replace(".", ",")}</b> em {minha.registros} check-in{minha.registros > 1 ? "s" : ""}. Só você vê esta linha.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* Elogio dentro da propria retrospectiva: a metade do tempo que o time
   combinou dedicar a reconhecimento. Cai no mesmo circulo do mural. */
function FormElogioReuniao({ user, usuarios, origem, onElogio }) {
  const [texto, setTexto] = useState("");
  const [para, setPara] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const colegas = (usuarios || []).filter((u) => u && u.id !== user.id && u.ativo !== false);
  useEffect(() => { if (!para && colegas.length) setPara(colegas[0].id); }, [usuarios]);
  async function enviar() {
    if (!texto.trim() || !para || salvando) return;
    setSalvando(true);
    setErro("");
    setOk("");
    try {
      const alvo = colegas.filter((u) => u.id === para)[0];
      await onElogio(texto, alvo, origem);
      setTexto("");
      setOk("Elogio registrado. Ele aparece no mural do time.");
    } catch (e) { setErro(mensagemAmigavel(e, "ao registrar o elogio")); }
    finally { setSalvando(false); }
  }
  if (!colegas.length) return <p style={{ fontSize: 12.5, color: C.cinza, margin: 0 }}>Ainda não há colegas ativos pra elogiar.</p>;
  return (
    <div>
      <div style={{ ...S.display, fontSize: 14, color: C.branco, marginBottom: 8 }}>Reconhecer um colega</div>
      <select value={para} onChange={(e) => setPara(e.target.value)} style={{ ...S.input, marginBottom: 8 }}>
        {colegas.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
      </select>
      <textarea value={texto} onChange={(e) => setTexto(e.target.value.slice(0, 300))} rows={3}
        placeholder="Por algo concreto: resolveu o problema X e salvou o prazo"
        style={{ ...S.input, resize: "vertical", marginBottom: 8 }} />
      <button style={{ ...S.btn, padding: "9px 18px", fontSize: 13 }} onClick={enviar} disabled={salvando || !texto.trim()}>
        {salvando ? "Enviando…" : "Enviar elogio"}
      </button>
      {ok ? <p style={{ fontSize: 12.5, color: C.verde, marginTop: 8 }}>{ok}</p> : null}
      {erro ? <p style={{ fontSize: 12.5, color: C.vermelho, marginTop: 8 }}>{erro}</p> : null}
      <p style={{ fontSize: 11.5, color: C.cinza, marginTop: 10, lineHeight: 1.6 }}>
        Elogio não vale ponto no prêmio nem na gamificação. Reconhecimento que vira nota deixa de ser reconhecimento.
      </p>
    </div>
  );
}

/* Ata: o app monta sozinho ao encerrar o roteiro. Ninguem digita resumo. */
function CartaoAta({ ata }) {
  return (
    <div style={{ ...S.card, padding: 14, marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ ...S.display, fontSize: 14, color: C.branco }}>{ata.ritualNome}</div>
        <div style={{ fontSize: 12, color: C.cinza }}>{fmtData(ata.data)}</div>
      </div>
      {ata.participantes.length ? (
        <div style={{ fontSize: 12, color: C.cinza, marginTop: 6, lineHeight: 1.6 }}>
          Trabalhando no dia: {ata.participantes.join(", ")}
        </div>
      ) : null}
      {ata.combinados.length ? (
        <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 12.5, color: C.branco, lineHeight: 1.7 }}>
          {ata.combinados.map((c, i) => (
            <li key={i}>{c.texto}{c.dono ? " — " + c.dono : ""}{c.prazo ? " · até " + fmtData(c.prazo) : ""}</li>
          ))}
        </ul>
      ) : (
        <div style={{ fontSize: 12, color: C.cinza, marginTop: 8 }}>Nenhum combinado saiu desta reunião.</div>
      )}
      {(ata.respostas || []).length ? (
        <details style={{ marginTop: 10 }}>
          <summary style={{ fontSize: 12, color: C.cinza, cursor: "pointer" }}>O que cada um respondeu</summary>
          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
            {(ata.respostas || []).map((x, i) => (
              <div key={i} style={{ borderLeft: "2px solid " + C.borda, paddingLeft: 10 }}>
                <b style={{ fontSize: 12.5, color: C.branco }}>{x.autor}</b>
                {x.foco ? <div style={{ fontSize: 12, color: C.cinza, marginTop: 3, whiteSpace: "pre-wrap" }}>Foco: {x.foco}</div> : null}
                {x.impedimento ? <div style={{ fontSize: 12, color: x.travado ? C.vermelho : C.cinza, marginTop: 3, whiteSpace: "pre-wrap" }}>Precisava de ajuda: {x.impedimento}{x.travado ? " (já era o mesmo pedido da reunião anterior)" : ""}</div> : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

/* Rodape do roteiro: fecha a reuniao e grava a ata sozinho. So aparece no
   ultimo bloco, porque encerrar no meio e a forma mais comum de perder o
   combinado que ainda ia ser escrito. */
function EncerrarReuniao({ user, usuarios, registros, acoes, ritual, hojeIso, atas, atasNoBanco, ultimo, onGerarAta }) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const jaTem = (atas || []).filter((a) => a && a.data === hojeIso && a.ritualId === ritual.id)[0] || null;
  const daReuniao = combinadosDaReuniao(acoes, ritual.nome, hojeIso);
  const presentes = participantesDoDia(usuarios, registros, hojeIso);
  async function gerar() {
    if (salvando) return;
    setSalvando(true);
    setErro("");
    setOk("");
    try {
      await onGerarAta(ritual, hojeIso);
      setOk("Ata gerada. Ela fica guardada na aba Atas.");
    } catch (e) { setErro(mensagemAmigavel(e, "ao gerar a ata")); }
    finally { setSalvando(false); }
  }
  if (!ultimo) {
    return (
      <p style={{ fontSize: 11.5, color: C.cinza, margin: 0, lineHeight: 1.6 }}>
        No último bloco o app fecha a reunião e monta a ata sozinho, com os combinados que saíram daqui.
      </p>
    );
  }
  return (
    <div>
      <div style={{ ...S.display, fontSize: 14, color: C.branco, marginBottom: 8 }}>Encerrar e gerar a ata</div>
      <p style={{ fontSize: 12.5, color: C.cinza, margin: "0 0 10px", lineHeight: 1.65 }}>
        {atasNoBanco ? "A ata fica visível pro time inteiro." : "Guardado só neste aparelho: a tabela atas ainda não existe no banco."}
      </p>
      <div style={{ fontSize: 12.5, color: C.cinza, lineHeight: 1.7, marginBottom: 10 }}>
        <div>📌 {daReuniao.length ? daReuniao.length + " combinado" + (daReuniao.length > 1 ? "s" : "") + " saiu desta reunião" : "Nenhum combinado saiu desta reunião ainda"}</div>
        <div>👥 {presentes.length ? presentes.join(", ") : "ninguém bateu ponto hoje"}</div>
      </div>
      {jaTem ? (
        <p style={{ fontSize: 12.5, color: C.verde, margin: 0 }}>✅ A ata de hoje já foi gerada.</p>
      ) : (
        <button style={{ ...S.btn, padding: "9px 18px", fontSize: 13 }} onClick={gerar} disabled={salvando}>
          {salvando ? "Gerando…" : "Encerrar e gerar ata"}
        </button>
      )}
      {ok ? <p style={{ fontSize: 12.5, color: C.verde, marginTop: 8 }}>{ok}</p> : null}
      {erro ? <p style={{ fontSize: 12.5, color: C.vermelho, marginTop: 8 }}>{erro}</p> : null}
      <p style={{ fontSize: 11.5, color: C.cinza, marginTop: 10, lineHeight: 1.6 }}>
        A lista de quem estava trabalhando vem da marcação de ponto do dia. Não é chamada de reunião: aqui não existe falta, e nada disso entra em prêmio, avaliação ou desligamento.
      </p>
    </div>
  );
}

/* Combinados abertos aparecem no Bater ponto: o que foi acordado na reunião
   encontra a pessoa no lugar em que ela entra todo dia. */
function CartaoCombinados({ acoes, onAlternar, onAbrirRoteiro }) {
  const hojeIso = dataISO(new Date());
  if (!acoesAbertas(acoes).length) return null;
  return (
    <div className="pr-relevo" style={{ ...S.card, marginTop: 14, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ ...S.display, fontSize: 14, color: C.branco }}>✅ Combinados da reunião</div>
        <button style={{ ...S.btnGhost, padding: "6px 12px", fontSize: 12 }} onClick={onAbrirRoteiro}>Ver todos</button>
      </div>
      <div style={{ marginTop: 8 }}>
        <ListaCombinados acoes={acoes} onAlternar={onAlternar} hojeIso={hojeIso} compacta />
      </div>
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
        </div>
      )}
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
      <Detalhes titulo="Como pontuar">
        <p style={{ margin: 0 }}>
        <b style={{ color: C.branco }}>Como pontuar:</b> entrada dentro da tolerância vale {GAME.ptsDiaPontual} pts/dia; a partir do 3º dia pontual seguido cada dia vale +{GAME.ptsBonusStreak} de bônus; marcos de sequência pagam extra (5 dias +30 · 10 dias +75 · 20 dias +200); mês sem falta injustificada vale +{GAME.ptsMesSemFalta}; e fechar o mês dentro da meta de assiduidade (mesmos critérios do Prêmio Performance) vale +{GAME.ptsMetaAssiduidade}. Atraso ou falta injustificada zera a sequência — mas nunca desconta pontos já ganhos. Faltas justificadas, atestados aceitos e ausências legais não zeram a sequência nem afetam sua pontuação.
        </p>
      </Detalhes>
      <Detalhes titulo="Natureza da gamificação">
        <p style={{ margin: 0 }}>
          <b style={{ color: C.branco }}>🎖 Natureza da gamificação:</b> pontos, níveis, sequências e conquistas são <b style={{ color: C.branco }}>exclusivamente ferramenta motivacional e de reconhecimento interno</b>. Não constituem verba salarial, prêmio, comissão ou benefício de qualquer natureza; não geram direito adquirido, expectativa de remuneração, promoção, cargo ou obrigação contratual; e não são critério de avaliação de desempenho formal. Não confundir com o <b style={{ color: C.branco }}>Prêmio Performance</b> (aba 🏆 Prêmio), que é o benefício financeiro real, regido por regulamento próprio nos termos do art. 457, §4º, da CLT. A empresa pode ajustar ou descontinuar a gamificação a qualquer momento, sem reflexo em salário ou contrato.
        </p>
      </Detalhes>
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
        <p style={{ fontSize: 11, color: C.cinza, marginTop: 8 }}>As horas só são debitadas depois da aprovação do gestor. 1 folga = 9h (seg-sex) ou 5h (sábado). Base legal: CLT art. 59 §§ 5º-6º (acordo individual escrito).</p>
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
      <Detalhes titulo="Regras de elegibilidade">
        {REGRAS_PREMIO.map((r, i) => (
          <div key={r.id} style={{ borderTop: i === 0 ? "none" : "1px solid #1E3450", padding: i === 0 ? "0 0 9px" : "9px 0" }}>
            <b style={{ fontSize: 13, color: C.branco }}>{r.corte ? "🎯" : "➕"} {r.titulo}</b>
            <p style={{ margin: "3px 0 0" }}>{r.desc}</p>
          </div>
        ))}
      </Detalhes>
      <Detalhes titulo="Natureza jurídica do prêmio">
        <p style={{ margin: 0 }}>
        <b style={{ color: C.branco }}>Natureza jurídica do Prêmio Performance:</b> liberalidade concedida pela {EMPRESA.nome} em razão de desempenho superior ao ordinariamente esperado, nos termos do art. 457, §4º, da CLT. Não integra o salário, não constitui comissão contratual e sua não concessão por critério de elegibilidade <b style={{ color: C.branco }}>não é desconto salarial</b> (art. 462). Critérios objetivos, prospectivos e divulgados antecipadamente neste painel. Faltas justificadas, atestados aceitos e ausências legais do art. 473 da CLT não afetam a elegibilidade. Regulamento completo disponível com o RH.
        </p>
      </Detalhes>
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
          <b style={{ color: C.amarelo }}>Câmeras e imagem:</b> a loja tem circuito interno de câmeras para segurança patrimonial e a empresa produz conteúdo para redes sociais. O detalhamento e a autorização de uso da sua imagem (opcional e revogável) ficam na aba 🔐 LGPD.
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

const CODIGO_CONDUTA = [
  { titulo: "Uso obrigatório do uniforme", texto: "O uso do uniforme fornecido pela empresa é obrigatório durante toda a jornada de trabalho, devendo ser mantido limpo, conservado e completo (incluindo crachá de identificação, quando aplicável). O fornecimento do uniforme pela Renovar Tech não integra o salário (CLT art. 458 §2º, II) e sua devolução em bom estado pode ser exigida ao término do contrato." },
  { titulo: "Respeito e boa convivência entre colegas", texto: "É exigido tratamento respeitoso e cordial entre todos os colaboradores, gestores e clientes. Não são tolerados assédio moral ou sexual, discriminação de qualquer natureza (raça, gênero, orientação sexual, religião, idade, deficiência ou origem) nem qualquer forma de violência no ambiente de trabalho (CF art. 5º; CLT art. 483; Lei 14.457/2022 — canal de denúncia). Situações identificadas podem ser reportadas ao gestor ou ao encarregado de dados (DPO), com sigilo garantido." },
  { titulo: "Zelo pelo patrimônio e ferramentas de trabalho", texto: "Equipamentos, ferramentas, peças e demais bens da empresa devem ser utilizados com cuidado e exclusivamente para fins profissionais, evitando danos por mau uso ou negligência." },
  { titulo: "Sigilo de informações", texto: "Dados de clientes, valores, processos internos e informações comerciais da Renovar Tech são confidenciais e não devem ser compartilhados com terceiros, inclusive após o desligamento." },
  { titulo: "Pontualidade e assiduidade", texto: "O cumprimento dos horários contratuais e o registro correto do ponto são deveres de todos os colaboradores, conforme detalhado nas seções de Ponto, Prêmio Performance e Gamificação deste sistema." },
];

/* ---------- Termo de direito de imagem: CFTV da loja + conteudo pra redes sociais ----------
   O CFTV e informado (seguranca patrimonial = legitimo interesse, LGPD art. 7o, IX).
   O uso da imagem em divulgacao depende de autorizacao expressa e revogavel. */
const TERMO_IMAGEM = [
  { titulo: "Monitoramento por câmeras (CFTV) na loja", texto: "A loja opera circuito interno de câmeras nas áreas de atendimento, bancada/oficina, estoque e acessos, com a finalidade de segurança patrimonial, prevenção de perdas e proteção de colaboradores e clientes — tratamento fundado no legítimo interesse do controlador (LGPD art. 7º, IX) e no poder diretivo do empregador. Não existem câmeras em vestiários, banheiros, refeitório ou qualquer área de intimidade, e não há captação de áudio. As imagens têm acesso restrito à gestão, são guardadas por prazo limitado e depois eliminadas, e não servem para fiscalizar produtividade individual nem para constranger ninguém." },
  { titulo: "Uso de imagem e voz em conteúdo de divulgação", texto: "A empresa produz fotos e vídeos na loja (atendimento, bancada, bastidores) e publica em redes sociais, site e materiais institucionais. Esse uso depende da sua autorização expressa (CF art. 5º, X e XXVIII; Código Civil arts. 20 e 21; LGPD art. 7º, I) e fica registrado aqui com data e hora. A autorização é gratuita, por prazo indeterminado enquanto não revogada, restrita a conteúdo institucional e comercial da " + EMPRESA.nome + ", sem cessão, venda ou licenciamento da sua imagem a terceiros e sem uso em contexto ofensivo, discriminatório, político-partidário ou que exponha dado pessoal sensível." },
  { titulo: "Revogação e participação voluntária", texto: "Você pode revogar a autorização a qualquer momento nesta mesma tela, sem justificar e sem nenhum prejuízo. A partir da revogação a empresa não publica conteúdo novo com sua imagem e retira as publicações ativas que estejam sob seu controle em prazo razoável — ressalvado o que já foi compartilhado por terceiros. Participar das gravações é voluntário: recusar não afeta avaliação, prêmio, escala ou qualquer benefício." },
  { titulo: "Sem repercussão salarial e sigilo mantido", texto: "A autorização de imagem não gera remuneração adicional e não integra o salário para nenhum efeito (CLT art. 457). Continua valendo o dever de sigilo: nada de expor dados de clientes, ordens de serviço, notas ou informações internas que apareçam em foto ou vídeo." },
];

function SecaoDireitoImagem({ user, imagem, onSalvar }) {
  const [cftv, setCftv] = useState(!!imagem?.cftvCiente);
  const [autoriza, setAutoriza] = useState(!!imagem?.autorizada);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => { setCftv(!!imagem?.cftvCiente); setAutoriza(!!imagem?.autorizada); }, [imagem]);
  const mudou = cftv !== !!imagem?.cftvCiente || autoriza !== !!imagem?.autorizada;
  const salvar = async () => {
    setSalvando(true); setMsg(null);
    try { await onSalvar(cftv, autoriza); setMsg({ ok: true, txt: "Escolha registrada. Você pode mudar quando quiser." }); }
    catch (e) { setMsg({ ok: false, txt: mensagemAmigavel(e, "ao registrar o termo de imagem") }); }
    finally { setSalvando(false); }
  };
  return (
    <div style={{ ...S.card, marginTop: 14 }}>
      <div style={{ ...S.display, fontSize: 15, color: C.amarelo }}>📸 Termo de imagem e câmeras (CFTV)</div>
      <Detalhes titulo="Ler o termo na íntegra">
        {TERMO_IMAGEM.map((t, i) => (
          <div key={t.titulo} style={{ marginTop: i === 0 ? 0 : 10 }}>
            <b style={{ fontSize: 13, color: C.branco }}>{t.titulo}</b>
            <p style={{ margin: "3px 0 0" }}>{t.texto}</p>
          </div>
        ))}
      </Detalhes>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: 14, fontSize: 13, cursor: "pointer" }}>
        <input type="checkbox" checked={cftv} onChange={(e) => setCftv(e.target.checked)} style={{ width: 18, height: 18, marginTop: 2 }} />
        <span>Estou ciente do monitoramento por câmeras (CFTV) descrito acima.</span>
      </label>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: 8, fontSize: 13, cursor: "pointer" }}>
        <input type="checkbox" checked={autoriza} onChange={(e) => setAutoriza(e.target.checked)} style={{ width: 18, height: 18, marginTop: 2 }} />
        <span><b>Autorizo</b> o uso da minha imagem e voz em conteúdo de divulgação da empresa (redes sociais, site e materiais), nos termos acima.</span>
      </label>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
        <button style={{ ...S.btn, padding: "8px 14px", fontSize: 13, opacity: !mudou || salvando ? 0.6 : 1 }} disabled={!mudou || salvando} onClick={salvar}>{salvando ? "⏳…" : "Salvar minha escolha"}</button>
        <span style={{ fontSize: 11.5, color: C.cinza }}>
          {imagem?.atualizadoEm ? `Registrado em ${fmtDataHora(imagem.atualizadoEm)} · uso de imagem: ${imagem.autorizada ? "autorizado" : "não autorizado"}` : "Ainda sem registro — marque as opções e salve."}
        </span>
      </div>
      {msg && <p style={{ fontSize: 12.5, color: msg.ok ? C.verde : C.vermelho, margin: "8px 0 0" }}>{msg.txt}</p>}
      <p style={{ fontSize: 11, color: C.cinza, margin: "8px 0 0", lineHeight: 1.5 }}>
        A ciência do CFTV é informativa — segurança patrimonial não depende de consentimento (LGPD art. 7º, IX). A autorização de imagem é opcional e revogável a qualquer momento. Dúvidas: dpo@renovartech.com.br.
      </p>
    </div>
  );
}

function SecaoImagens({ usuarios, consImagem = [] }) {
  const cons = (id) => consImagem.find((c) => c.userId === id);
  const equipe = usuarios.filter((u) => u.ativo !== false);
  const sem = equipe.filter((u) => !cons(u.id)?.autorizada);
  return (
    <div style={{ ...S.card, marginTop: 14 }}>
      <div style={{ ...S.display, fontSize: 15, color: C.cinza }}>📸 Autorizações de imagem</div>
      <p style={{ fontSize: 11.5, color: sem.length ? C.amarelo : C.cinza, margin: "6px 0 0", lineHeight: 1.5 }}>
        {sem.length === 0
          ? "Toda a equipe autorizou o uso de imagem em conteúdo de divulgação."
          : `Antes de publicar foto ou vídeo: ${sem.map((u) => u.nome.split(" ")[0]).join(", ")} ${sem.length > 1 ? "não autorizaram" : "não autorizou"} o uso da própria imagem.`}
      </p>
      <div className="rolagem-x" style={{ marginTop: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead><tr style={{ color: C.cinza, textAlign: "left" }}><th style={{ padding: 6 }}>Colaborador</th><th>CFTV</th><th>Uso de imagem</th><th>Registrado em</th></tr></thead>
          <tbody>
            {equipe.map((u) => {
              const c = cons(u.id);
              return (
                <tr key={u.id} style={{ borderTop: "1px solid #1E3450" }}>
                  <td style={{ padding: 6, fontWeight: 700 }}>{u.nome}</td>
                  <td style={{ color: c?.cftvCiente ? C.verde : C.cinza }}>{c?.cftvCiente ? "ciente" : "—"}</td>
                  <td style={{ color: c?.autorizada ? C.verde : C.amarelo, fontWeight: 700 }}>{c?.autorizada ? "autorizado" : "não autorizado"}</td>
                  <td style={{ color: C.cinza }}>{c?.atualizadoEm ? fmtDataHora(c.atualizadoEm) : "sem registro"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 11, color: C.cinza, margin: "8px 0 0", lineHeight: 1.5 }}>
        Cada pessoa registra a própria escolha na aba 🔐 LGPD. Publicar imagem de quem não autorizou (ou de quem revogou) expõe a empresa a indenização por uso indevido (CF art. 5º, X; Código Civil art. 20).
      </p>
    </div>
  );
}

function SecaoCodigoConduta({ aceite, onAceitar }) {
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState(null);
  const emDia = !!aceite && aceite.ref === CONDUTA_VERSAO;
  const aceitar = async () => {
    setSalvando(true); setMsg(null);
    try { await onAceitar("conduta", CONDUTA_VERSAO, "aceito", ""); setMsg({ ok: true, txt: "Aceite registrado com data e hora." }); }
    catch (e) { setMsg({ ok: false, txt: mensagemAmigavel(e, "ao registrar o aceite do código de conduta") }); }
    finally { setSalvando(false); }
  };
  return (
    <div style={{ ...S.card, marginTop: 14 }}>
      <div style={{ ...S.display, fontSize: 15, color: C.amarelo }}>📜 Código de conduta — regras internas <span style={{ fontSize: 11, color: C.cinza }}>· versão {CONDUTA_VERSAO}</span></div>
      <p style={{ fontSize: 12.5, color: C.branco, marginTop: 8, lineHeight: 1.6 }}>Além das políticas de dados acima, todo colaborador da {EMPRESA.nome} deve observar as regras de conduta abaixo. O descumprimento pode configurar falta grave, sujeita às medidas disciplinares previstas na CLT (incluindo art. 482, conforme a gravidade).</p>
      <Detalhes titulo={`Ler as ${CODIGO_CONDUTA.length} regras na íntegra`}>
        {CODIGO_CONDUTA.map((c, i) => (
          <div key={i} style={{ borderTop: i === 0 ? "none" : "1px solid #1E3450", padding: i === 0 ? "0 0 9px" : "9px 0" }}>
            <b style={{ fontSize: 13, color: C.branco }}>{c.titulo}</b>
            <p style={{ margin: "3px 0 0" }}>{c.texto}</p>
          </div>
        ))}
      </Detalhes>
      {onAceitar && (
        <div style={{ borderTop: "1px solid #1E3450", paddingTop: 12, marginTop: 4 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button style={{ ...S.btn, padding: "8px 14px", fontSize: 13, opacity: salvando ? 0.6 : 1 }} disabled={salvando} onClick={aceitar}>{salvando ? "⏳…" : emDia ? "Confirmar de novo" : "Li e aceito estas regras"}</button>
            <span style={{ fontSize: 11.5, color: emDia ? C.verde : C.cinza }}>
              {aceite ? `Aceito em ${fmtDataHora(aceite.em)} (versão ${aceite.ref})${emDia ? "" : " — texto atualizado, precisa de novo aceite"}` : "Ainda sem aceite registrado."}
            </span>
          </div>
          {msg && <p style={{ fontSize: 12.5, color: msg.ok ? C.verde : C.vermelho, margin: "8px 0 0" }}>{msg.txt}</p>}
          <p style={{ fontSize: 11, color: C.cinza, margin: "8px 0 0", lineHeight: 1.6 }}>O aceite guarda data, hora e versão do texto — é a prova de ciência das regras (CLT art. 456, parágrafo único). Não substitui o contrato de trabalho e não impede você de discutir a aplicação de qualquer regra.</p>
        </div>
      )}
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

function TelaLGPD({ user, onConsentir, credenciais = [], onCadastrarBio, onRemoverBio, imagem, onSalvarImagem, aceiteConduta, onAceitar }) {
  const [aceito, setAceito] = useState(user.consentimentoLGPD);
  useEffect(() => setAceito(user.consentimentoLGPD), [user.consentimentoLGPD]);
  return (
    <div>
      <h1 style={{ ...S.display, fontSize: 26, margin: 0 }}>Privacidade e LGPD</h1>
      <div style={{ ...S.card, marginTop: 16, fontSize: 14, lineHeight: 1.8, color: "#C7D2E4" }}>
        <b style={{ color: C.branco }}>Termo de consentimento — tratamento de dados pessoais</b>
        <p>O PONTO RENOVAR coleta, com a finalidade específica de controle de jornada (Portaria MTP 671/2021): <b>confirmação de identidade pela biometria nativa do seu aparelho</b> (Face ID/digital — processada <b>localmente pelo celular</b>; a empresa <b>não recebe nem armazena</b> imagem facial ou impressão digital, apenas o identificador público da credencial e a confirmação da autenticação); <b>geolocalização</b> da marcação; e registros de horários. Os dados são usados exclusivamente pra validação de identidade, apuração de jornada e obrigações legais trabalhistas. Retenção: registros de ponto por no mínimo 5 anos; credenciais biométricas enquanto durar o vínculo ou até você removê-las. Você pode solicitar acesso, correção ou exclusão (quando não houver obrigação legal de guarda) ao encarregado de dados (DPO): dpo@renovartech.com.br.</p>
        <p>Contador de água: fica só no seu aparelho (armazenamento local do navegador). Não vai pro servidor, o gestor não vê e não é orientação médica — quem tem restrição de líquidos segue o próprio médico.</p>
        <label style={{ display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={aceito} onChange={e => { setAceito(e.target.checked); onConsentir(e.target.checked); }} />
          <span>Li e <b style={{ color: C.amarelo }}>consinto</b> com o tratamento descrito acima.</span>
        </label>
      </div>
      <SecaoCodigoConduta aceite={aceiteConduta} onAceitar={onAceitar} />
      <SecaoDireitoImagem user={user} imagem={imagem} onSalvar={onSalvarImagem} />
      {user.papel === "gestor" && (
      <div style={{ ...S.card, marginTop: 16, fontSize: 13, color: C.cinza, borderLeft: `4px solid ${C.amarelo}` }}>
        <div style={{ ...S.display, fontSize: 16, color: C.branco, marginBottom: 6 }}>⚠️ Situação fiscal dos arquivos AFD/AEJ</div>
        <p style={{ margin: 0 }}>Os arquivos do espelho de ponto são gerados no leiaute oficial da Portaria 671/2021 (AFD com marcações tipo 7 e cadeia de hash SHA-256; AEJ delimitado por pipe; ambos em ISO 8859-1 com CR+LF). Dois itens ainda são placeholders que dependem de etapas externas ao sistema: o nº de registro do programa no INPI (campo 7 do cabeçalho do AFD e nrRep do AEJ), hoje zerado, e a assinatura digital, que exige arquivo .p7s gerado com certificado ICP-Brasil. Enquanto esses dois itens não existirem, os arquivos servem para conferência interna, mas não têm valor fiscal perante a fiscalização.</p>
      </div>
      )}
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
      <Detalhes titulo="Sobre desativar e convidar"><p style={{ margin: 0 }}>Desativar bloqueia o login (o app checa ativo=false), mas a conta de autenticação permanece — exclusão definitiva exigiria a service_role key, que jamais vai pro client. Convites expiram em 7 dias e são de uso único (resgate atômico via function no banco).</p></Detalhes>
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
  "aprovacao", "folga_decidida", "local_criado", "local_desativado", "biometria", "batida_sem_localizacao", "rescisao_criada", "rescisao_confirmada", "exame_ocupacional_criado",
  "exame_agendado", "exame_concluido", "candidato_criado", "candidato_etapa", "documento_anexado", "guia_linha_salva"];

const AVISO_FOLHA = "⚠️ Conferência gerencial: cálculo com as tabelas 2026 (INSS Portaria MPS/MF · IRRF Lei 15.270/2025). Não substitui a folha oficial do contador (eSocial, guias e obrigações acessórias).";

function SecaoFolha({ usuarios, folhasPg, adiantamentos, guias, onGerarFolha, onEditarFolha, onFecharFolha, onCriarAdiant, onCancelarAdiant }) {
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
  // Recibo de pagamento em PDF (um por colaborador, no layout que o contador usa).
  const pdfRecibos = (lista) => {
    if (!lista.length) return;
    const paginas = lista.map((f) => pdfReciboFolha(f, usuarios.find((u) => u.id === f.userId), compData));
    baixarPDF(pdfArquivo(paginas), lista.length === 1 ? `recibo-${nome(lista[0].userId).split(" ")[0].toLowerCase()}-${comp}.pdf` : `recibos-folha-${comp}.pdf`);
  };
  // Planilha de conferencia: uma linha por colaborador, com as bases que o contador lanca.
  const csvFolha = () => {
    const num = (v) => String(r2(+v || 0)).replace(".", ",");
    const cab = ["Competencia", "Matricula", "Colaborador", "CPF", "Admissao", "Bruto", "Faltas", "Atrasos", "INSS", "IRRF", "VT", "Adiantamento", "Liquido", "BaseFGTS", "FGTS8", "DiasFaltas", "HorasAtraso", "Status"];
    const linhas = doMes.map((f) => {
      const u = usuarios.find((x) => x.id === f.userId) || {};
      const base = r2(f.salario - f.faltas - f.atrasos);
      return [comp, u.matricula || "", nome(f.userId), u.cpf || "", u.admissao || "", num(f.salario), num(f.faltas), num(f.atrasos), num(f.inss), num(f.irrf), num(f.vt), num(f.adiantamento), num(f.liquido), num(base), num(base * TABELAS_2026.fgtsPatronal), f.diasFaltas || 0, num(f.horasAtraso), f.status].join(";");
    });
    baixarArquivo([cab.join(";"), ...linhas].join("\r\n"), `folha-${comp}.csv`);
  };
  const salvarEdit = () => rodar(async () => {
    await onEditarFolha(editRow.id, { salario: +editRow.salario || 0, faltas: +editRow.faltas || 0, atrasos: +editRow.atrasos || 0, inss: +editRow.inss || 0, irrf: +editRow.irrf || 0, vt: +editRow.vt || 0, adiantamento: +editRow.adiantamento || 0 });
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
        {doMes.length > 0 && <button style={{ ...S.btnGhost, padding: "8px 14px", fontSize: 13 }} onClick={() => pdfRecibos(doMes)}>🖨 Recibos em PDF</button>}
        {doMes.length > 0 && <button style={{ ...S.btnGhost, padding: "8px 14px", fontSize: 13 }} onClick={csvFolha}>⬇ Planilha pro contador</button>}
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
                      {["salario", "faltas", "atrasos", "inss", "irrf", "vt", "adiantamento"].map(k => (
                        <td key={k}><input type="number" step="0.01" style={{ ...S.input, width: 84, padding: 6, fontSize: 12 }} value={editRow[k]} onChange={e => setEditRow({ ...editRow, [k]: e.target.value })} /></td>
                      ))}
                      <td style={{ fontWeight: 700 }}>{brl((+editRow.salario || 0) - ["faltas", "atrasos", "inss", "irrf", "vt", "adiantamento"].reduce((s, k) => s + (+editRow[k] || 0), 0))}</td>
                      <td style={{ whiteSpace: "nowrap" }}><button style={{ ...S.btn, padding: "4px 10px", fontSize: 11 }} onClick={salvarEdit}>Salvar</button> <button style={{ ...S.btnGhost, padding: "4px 8px", fontSize: 11 }} onClick={() => setEditRow(null)}>✕</button></td>
                    </>
                  ) : (
                    <>
                      <td>{brl(f.salario)}</td>
                      <td title={`${f.diasFaltas} dia(s) + DSR`}>{brl(f.faltas)}</td>
                      <td title={`${f.horasAtraso}h além da tolerância`}>{brl(f.atrasos)}</td>
                      <td>{brl(f.inss)}</td><td>{brl(f.irrf)}</td><td>{brl(f.vt)}</td><td>{brl(f.adiantamento)}</td>
                      <td style={{ fontWeight: 700, color: C.verde }}>{brl(f.liquido)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <button title="Recibo em PDF" style={{ ...S.btnGhost, padding: "4px 8px", fontSize: 11 }} onClick={() => pdfRecibos([f])}>🖨</button>{" "}
                        {f.status === "rascunho" && <button title="Editar valores" style={{ ...S.btnGhost, padding: "4px 8px", fontSize: 11 }} onClick={() => setEditRow({ id: f.id, salario: f.salario, faltas: f.faltas, atrasos: f.atrasos, inss: f.inss, irrf: f.irrf, vt: f.vt, adiantamento: f.adiantamento })}>✎</button>}
                      </td>
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
          <p style={{ fontSize: 11.5, color: C.cinza, margin: "4px 0 0" }}>O pagamento é registrado em Contabilidade, com data, valor e comprovante.</p>
          {guiasMes.map(g => (
            <div key={g.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #1E3450", padding: "7px 0", fontSize: 13 }}>
              <span><b>{g.tipo}</b> · {brl(g.valor)} · vence {fmtData(g.vencimento)}</span>
              {g.status === "paga" ? <span style={S.tag("#123B24", C.verde)}>PAGA</span> : <span style={S.tag("#3B2A12", C.amarelo)}>A PAGAR</span>}
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

function SecaoRescisao({ usuarios, rescisoes, onCriarRescisao, onConfirmarRescisao }) { const h = React.createElement; const nome = (id) => usuarios.find(u => u.id === id)?.nome || id; const [form, setForm] = useState({ userId: "", dataDeslig: "", motivo: "dispensa_sem_justa_causa", avisoTipo: "indenizado" }); const [resultado, setResultado] = useState(null); const [msg, setMsg] = useState(null); const [ocupado, setOcupado] = useState(false); const [confirmando, setConfirmando] = useState(null); const motivoInfo = MOTIVOS_RESCISAO[form.motivo]; const calcular = async () => { if (!form.userId || !form.dataDeslig) { setMsg({ ok: false, txt: "Escolha o colaborador e a data de desligamento." }); return; } setOcupado(true); setMsg(null); try { const novo = await onCriarRescisao(form); setResultado(novo); setMsg({ ok: true, txt: "Cálculo gerado como rascunho." }); } catch (e) { setMsg({ ok: false, txt: mensagemAmigavel(e) }); } finally { setOcupado(false); } }; const confirmar = async (id) => { setOcupado(true); try { await onConfirmarRescisao(id); setConfirmando(null); setMsg({ ok: true, txt: "Rescisão confirmada." }); } catch (e) { setMsg({ ok: false, txt: mensagemAmigavel(e) }); } finally { setOcupado(false); } }; return h("div", { style: { ...S.card, marginTop: 14 } }, h("div", { style: { ...S.display, fontSize: 15, color: C.cinza } }, "Rescisão — cálculo de verbas (desligamento)"), h("p", { style: { fontSize: 11, color: C.cinza, margin: "6px 0 0" } }, AVISO_RESCISAO), h("div", { style: { display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap", alignItems: "center" } }, h("select", { style: { ...S.input, width: 200 }, value: form.userId, onChange: e => setForm({ ...form, userId: e.target.value }) }, h("option", { value: "" }, "Colaborador…"), usuarios.filter(u => u.ativo !== false).map(u => h("option", { key: u.id, value: u.id }, u.nome))), h("input", { type: "date", style: { ...S.input, width: 170 }, value: form.dataDeslig, onChange: e => setForm({ ...form, dataDeslig: e.target.value }) }), h("select", { style: { ...S.input, width: 260 }, value: form.motivo, onChange: e => setForm({ ...form, motivo: e.target.value }) }, Object.entries(MOTIVOS_RESCISAO).map(([k, v]) => h("option", { key: k, value: k }, v.label))), motivoInfo.avisoDevido ? h("select", { style: { ...S.input, width: 160 }, value: form.avisoTipo, onChange: e => setForm({ ...form, avisoTipo: e.target.value }) }, h("option", { value: "indenizado" }, "Aviso indenizado"), h("option", { value: "trabalhado" }, "Aviso trabalhado")) : null, h("button", { style: { ...S.btn, opacity: ocupado ? 0.6 : 1 }, disabled: ocupado, onClick: calcular }, ocupado ? "Calculando…" : "Calcular rescisão")), msg ? h("p", { style: { fontSize: 13, color: msg.ok ? C.verde : C.vermelho, marginTop: 8 } }, msg.txt) : null, resultado ? h("div", { style: { background: C.grafite, borderRadius: 10, padding: 14, marginTop: 12 } }, h("div", { style: { ...S.display, fontSize: 14, color: C.amarelo } }, nome(resultado.userId) + " · " + resultado.motivoLabel + " · desligamento " + fmtData(resultado.dataDeslig)), h("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 8 } }, h("tbody", null, [["Saldo de salário", resultado.calculo.verbas.saldoSalario], ["Aviso prévio indenizado", resultado.calculo.verbas.valorAviso], ["13º proporcional", resultado.calculo.verbas.decimoProp], ["Férias proporcionais", resultado.calculo.verbas.feriasProp], ["1/3 de férias proporcionais", resultado.calculo.verbas.tercoFeriasProp], ["Multa FGTS", resultado.calculo.verbas.multaFgts], ["INSS", -resultado.calculo.verbas.inssRescisao], ["IRRF", -resultado.calculo.verbas.irrfRescisao]].filter(([, v]) => v !== 0).map(([l, v]) => h("tr", { key: l, style: { borderTop: "1px solid #1E3450" } }, h("td", { style: { padding: 6 } }, l), h("td", { style: { padding: 6, textAlign: "right", color: v < 0 ? C.vermelho : C.branco } }, brl(v)))), h("tr", { style: { borderTop: "2px solid #2A4568", fontWeight: 700 } }, h("td", { style: { padding: 6 } }, "LÍQUIDO ESTIMADO"), h("td", { style: { padding: 6, textAlign: "right", color: C.verde, fontSize: 16 } }, brl(resultado.liquido))))), h("div", { style: { fontSize: 12, color: C.cinza, marginTop: 8 } }, "FGTS estimado (8% patronal acumulado): " + brl(resultado.calculo.verbas.fgtsEstimado) + " · direito a saque FGTS: " + (resultado.calculo.direitos.saqueFgts ? Math.round(resultado.calculo.direitos.saqueFgtsPct * 100) + "%" : "não") + " · seguro-desemprego: " + (resultado.calculo.direitos.seguroDesemprego ? "sim" : "não")), resultado.status === "rascunho" ? h("button", { style: { ...S.btn, marginTop: 10, padding: "8px 16px", fontSize: 13 }, disabled: ocupado, onClick: () => setConfirmando(resultado.id) }, "Confirmar rescisão e desativar colaborador") : null) : null, confirmando ? h(ModalConfirm, { titulo: "Confirmar rescisão?", texto: "O colaborador será desativado no sistema e a rescisão marcada como confirmada.", rotuloOk: "Confirmar rescisão", ocupado: ocupado, onCancelar: () => setConfirmando(null), onConfirmar: () => confirmar(confirmando) }) : null, rescisoes.length > 0 ? h("div", { style: { marginTop: 14, borderTop: "1px solid #1E3450", paddingTop: 10 } }, h("div", { style: { ...S.display, fontSize: 13, color: C.cinza } }, "Rescisões registradas"), rescisoes.map(r => h("div", { key: r.id, style: { display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #1A2F4A", padding: "7px 0", fontSize: 13, gap: 10 } }, h("span", null, nome(r.userId) + " · " + r.motivoLabel + " · desligamento " + fmtData(r.dataDeslig) + " · líquido " + brl(r.liquido)), h(Badge, { st: r.status === "confirmado" ? "aprovado" : "pendente" })))) : null); }/* Exames ocupacionais (NR-7). Duas coisas diferentes numa tela: AGENDAR o que
   ainda vai acontecer (data prevista, sem resultado) e LANCAR o que ja aconteceu
   com o ASO em anexo. O agendado alimenta a Agenda do RH; o realizado zera o prazo. */
function SecaoExames({ usuarios, exames = [], rescisoes = [], onCriarExame, onAgendar, onConcluir, onAbrir }) {
  const nome = (id) => usuarios.find((u) => u.id === id)?.nome || "colaborador";
  const [modo, setModo] = useState("agendar");
  const [form, setForm] = useState({ userId: "", tipo: "admissional", data: "", resultado: "", clinica: "", observacao: "" });
  const [anexo, setAnexo] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState(null);
  const [concluindo, setConcluindo] = useState(null);
  const [fim2, setFim2] = useState({ data: hojeStr(), resultado: "apto" });
  const [anexoFim, setAnexoFim] = useState(null);
  const limpar = () => { setForm({ userId: "", tipo: "admissional", data: "", resultado: "", clinica: "", observacao: "" }); setAnexo(null); };
  const rodar = async (fn, okTxt) => { setOcupado(true); setMsg(null); try { await fn(); setMsg({ ok: true, txt: okTxt }); } catch (e) { setMsg({ ok: false, txt: mensagemAmigavel(e) }); } finally { setOcupado(false); } };
  const enviar = () => {
    if (!form.userId || !form.data) { setMsg({ ok: false, txt: "Escolha o colaborador e a data." }); return; }
    if (modo === "agendar") return rodar(async () => { await onAgendar({ ...form }); limpar(); }, "Exame agendado. Ele já aparece na Agenda do RH.");
    if (!form.resultado) { setMsg({ ok: false, txt: "Informe o resultado do exame que já foi feito." }); return; }
    return rodar(async () => { await onCriarExame({ ...form, anexo: anexo?.file || null }); limpar(); }, "Exame registrado.");
  };
  const pegarArquivo = (e, set) => { const f = e.target.files?.[0]; if (!f) return; const p = validarArquivo(f); if (p) { setMsg({ ok: false, txt: p }); return; } set({ nome: f.name, file: f }); };
  const pendentes = useMemo(() => examesQueFaltam({ usuarios, exames, rescisoes }), [usuarios, exames, rescisoes]);
  const agendarTudo = () => rodar(async () => {
    for (const p of pendentes) await onAgendar({ userId: p.userId, tipo: p.tipo, data: p.data, clinica: "", observacao: "Agendado automaticamente pela agenda do PCMSO" });
  }, pendentes.length + " exame(s) agendados automaticamente.");
  const agendados = exames.filter((ex) => ex.status === "agendado").sort((a, b) => (a.data < b.data ? -1 : 1));
  const feitos = exames.filter((ex) => ex.status !== "agendado").sort((a, b) => (a.data < b.data ? 1 : -1));
  return (
    <div style={{ ...S.card, marginTop: 14 }}>
      <div style={{ ...S.display, fontSize: 15, color: C.branco }}>🩺 Exames ocupacionais</div>
      <p style={{ fontSize: 12, color: C.cinza, margin: "6px 0 10px", lineHeight: 1.6 }}>
        Admissional antes do primeiro dia, periódico conforme o PCMSO e demissional no desligamento (NR-7). O app já agenda sozinho: ao lançar um ASO clínico ele marca o próximo periódico, e ao calcular uma rescisão ele marca o demissional.
      </p>
      {pendentes.length > 0 && (
        <div style={{ background: "#3B2A12", border: "1px solid " + C.amarelo, borderRadius: 12, padding: "10px 12px", marginBottom: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 12.5, color: C.amarelo, lineHeight: 1.5, flex: 1, minWidth: 220 }}>
            <b>{pendentes.length} exame(s) esperando agendamento.</b>{" "}
            {pendentes.slice(0, 4).map((p) => p.quem + " · " + p.tipoLabel + " · " + fmtData(p.data)).join("  |  ")}{pendentes.length > 4 ? "  …" : ""}
          </div>
          <button style={{ ...S.btn, padding: "8px 14px", fontSize: 13, opacity: ocupado ? 0.6 : 1 }} disabled={ocupado} onClick={agendarTudo}>Agendar automaticamente</button>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        {[["agendar", "Agendar exame"], ["registrar", "Lançar exame já feito"]].map(([k, r]) => (
          <button key={k} style={modo === k ? { ...S.btn, padding: "7px 14px", fontSize: 12.5 } : { ...S.btnGhost, padding: "7px 14px", fontSize: 12.5 }} onClick={() => { setModo(k); setMsg(null); }}>{r}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select style={{ ...S.input, width: 190 }} value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}>
          <option value="">Colaborador…</option>
          {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
        </select>
        <select style={{ ...S.input, width: 180 }} value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
          {Object.entries(TIPOS_EXAME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input type="date" style={{ ...S.input, width: 160 }} value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} />
        {modo === "registrar" && (
          <select style={{ ...S.input, width: 190 }} value={form.resultado} onChange={(e) => setForm({ ...form, resultado: e.target.value })}>
            <option value="">Resultado…</option>
            {Object.entries(RESULTADOS_EXAME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        )}
        <input style={{ ...S.input, width: 180 }} placeholder="Clínica" value={form.clinica} onChange={(e) => setForm({ ...form, clinica: e.target.value })} />
        {modo === "registrar" && (
          <label style={{ ...S.btnGhost, cursor: "pointer", padding: "10px 14px", fontSize: 13 }}>
            {anexo ? "ASO: " + anexo.nome : "Anexar ASO"}
            <input type="file" accept="image/*,.pdf" style={{ display: "none" }} onChange={(e) => pegarArquivo(e, setAnexo)} />
          </label>
        )}
        <input style={{ ...S.input, width: 200 }} placeholder="Observação" value={form.observacao} onChange={(e) => setForm({ ...form, observacao: e.target.value })} />
        <button style={{ ...S.btn, opacity: ocupado ? 0.6 : 1 }} disabled={ocupado} onClick={enviar}>{ocupado ? "Salvando…" : modo === "agendar" ? "Agendar" : "Registrar exame"}</button>
      </div>
      {msg && <p style={{ fontSize: 13, color: msg.ok ? C.verde : C.vermelho, marginTop: 8 }}>{msg.txt}</p>}
      {agendados.length > 0 && (
        <div style={{ marginTop: 14, borderTop: "1px solid #1E3450", paddingTop: 10 }}>
          <div style={{ ...S.display, fontSize: 13, color: C.cinza }}>Agendados</div>
          {agendados.map((ex) => (
            <div key={ex.id} style={{ borderTop: "1px solid #1A2F4A", padding: "7px 0", fontSize: 13 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <span>{nome(ex.userId)} · {ex.tipoLabel} · {fmtData(ex.data)}{ex.clinica ? " · " + ex.clinica : ""}</span>
                <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={S.tag("#3B2A12", C.amarelo)}>AGENDADO</span>
                  <button style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 12 }} onClick={() => { setConcluindo(ex.id); setFim2({ data: hojeStr(), resultado: "apto" }); setAnexoFim(null); setMsg(null); }}>Lançar resultado</button>
                </span>
              </div>
              {concluindo === ex.id && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
                  <input type="date" style={{ ...S.input, width: 155 }} value={fim2.data} onChange={(e) => setFim2({ ...fim2, data: e.target.value })} />
                  <select style={{ ...S.input, width: 190 }} value={fim2.resultado} onChange={(e) => setFim2({ ...fim2, resultado: e.target.value })}>
                    {Object.entries(RESULTADOS_EXAME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <label style={{ ...S.btnGhost, cursor: "pointer", padding: "10px 14px", fontSize: 13 }}>
                    {anexoFim ? "ASO: " + anexoFim.nome : "Anexar ASO"}
                    <input type="file" accept="image/*,.pdf" style={{ display: "none" }} onChange={(e) => pegarArquivo(e, setAnexoFim)} />
                  </label>
                  <button style={{ ...S.btn, padding: "8px 14px", fontSize: 13, opacity: ocupado ? 0.6 : 1 }} disabled={ocupado} onClick={() => rodar(async () => { await onConcluir(ex.id, { ...fim2, anexo: anexoFim?.file || null }); setConcluindo(null); }, "Resultado lançado. O prazo do próximo exame já foi recalculado.")}>Salvar resultado</button>
                  <button style={{ ...S.btnGhost, padding: "8px 14px", fontSize: 13 }} onClick={() => setConcluindo(null)}>Cancelar</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {feitos.length > 0 && (
        <div style={{ marginTop: 14, borderTop: "1px solid #1E3450", paddingTop: 10 }}>
          <div style={{ ...S.display, fontSize: 13, color: C.cinza }}>Realizados</div>
          {feitos.map((ex) => (
            <div key={ex.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #1A2F4A", padding: "7px 0", fontSize: 13, gap: 10, flexWrap: "wrap" }}>
              <span>{nome(ex.userId)} · {ex.tipoLabel} · {fmtData(ex.data)} · {ex.resultadoLabel || "resultado pendente"}{ex.clinica ? " · " + ex.clinica : ""}{ex.observacao ? " · " + ex.observacao : ""}</span>
              {ex.anexo && <button style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 12 }} onClick={() => onAbrir(ex.anexo.path)}>Abrir ASO</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
/* Recrutamento: o curriculo entra aqui, o candidato anda pelas etapas e, quando
   for contratado, o convite ja sai preenchido. O app nunca cria conta por ninguem:
   a pessoa usa o convite e escolhe a propria senha. Curriculo de quem nao foi
   contratado tambem tem prazo de guarda (LGPD art. 15): descarte quando nao servir mais. */
function SecaoRecrutamento({ candidatos = [], onCriar, onMudarStatus, onContratar, onAbrir, demo }) {
  const [form, setForm] = useState({ nome: "", email: "", telefone: "", cargo: "", origem: "", observacao: "" });
  const [curriculo, setCurriculo] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState(null);
  const [filtro, setFiltro] = useState("todos");
  const [contratando, setContratando] = useState(null);
  const [adm, setAdm] = useState({ dataAdmissao: hojeStr(), cargo: "" });
  const [convite, setConvite] = useState(null);
  const rodar = async (fn, okTxt) => { setOcupado(true); setMsg(null); try { await fn(); if (okTxt) setMsg({ ok: true, txt: okTxt }); } catch (e) { setMsg({ ok: false, txt: mensagemAmigavel(e) }); } finally { setOcupado(false); } };
  const lista = filtro === "todos" ? candidatos : candidatos.filter((c) => c.status === filtro);
  return (
    <div style={{ ...S.card, marginTop: 14 }}>
      <div style={{ ...S.display, fontSize: 15, color: C.branco }}>🗂 Recrutamento e currículos</div>
      <p style={{ fontSize: 12, color: C.cinza, margin: "6px 0 10px", lineHeight: 1.6 }}>
        Guarde o currículo, acompanhe a etapa de cada candidato e transforme o aprovado em convite de acesso com um clique. Os arquivos ficam em área privada: só o gestor abre.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input style={{ ...S.input, width: 190 }} placeholder="Nome do candidato" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
        <input style={{ ...S.input, width: 200 }} placeholder="E-mail" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input style={{ ...S.input, width: 150 }} placeholder="Telefone" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} />
        <input style={{ ...S.input, width: 170 }} placeholder="Cargo pretendido" value={form.cargo} onChange={(e) => setForm({ ...form, cargo: e.target.value })} />
        <input style={{ ...S.input, width: 150 }} placeholder="Como chegou" value={form.origem} onChange={(e) => setForm({ ...form, origem: e.target.value })} />
        <label style={{ ...S.btnGhost, cursor: "pointer", padding: "10px 14px", fontSize: 13 }}>
          {curriculo ? "Currículo: " + curriculo.nome : "Anexar currículo"}
          <input type="file" accept="image/*,.pdf" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const p = validarArquivo(f); if (p) { setMsg({ ok: false, txt: p }); return; } setCurriculo({ nome: f.name, file: f }); }} />
        </label>
        <input style={{ ...S.input, width: 200 }} placeholder="Observação" value={form.observacao} onChange={(e) => setForm({ ...form, observacao: e.target.value })} />
        <button style={{ ...S.btn, opacity: ocupado ? 0.6 : 1 }} disabled={ocupado} onClick={() => rodar(async () => {
          await onCriar({ ...form, curriculo: curriculo?.file || null });
          setForm({ nome: "", email: "", telefone: "", cargo: "", origem: "", observacao: "" });
          setCurriculo(null);
        }, "Candidato cadastrado.")}>{ocupado ? "Salvando…" : "Cadastrar candidato"}</button>
      </div>
      {msg && <p style={{ fontSize: 13, color: msg.ok ? C.verde : C.vermelho, marginTop: 8 }}>{msg.txt}</p>}
      {convite && (
        <div style={{ ...S.card, marginTop: 12, background: "#0F2A1C", borderColor: "#1E5B3A" }}>
          <div style={{ fontSize: 13, color: C.verde, fontWeight: 700 }}>Convite criado para {convite.nome}</div>
          <p style={{ fontSize: 12, color: C.cinza, margin: "6px 0 0", lineHeight: 1.6 }}>Ele está na lista de convites, em Equipe. Mande o link pra pessoa: ela escolhe a própria senha ao entrar.</p>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
        {[["todos", "Todos"]].concat(ORDEM_CANDIDATO.map((k) => [k, STATUS_CANDIDATO[k]])).map(([k, r]) => (
          <button key={k} style={filtro === k ? { ...S.btn, padding: "6px 12px", fontSize: 12 } : { ...S.btnGhost, padding: "6px 12px", fontSize: 12 }} onClick={() => setFiltro(k)}>
            {r} {k === "todos" ? candidatos.length : candidatos.filter((c) => c.status === k).length}
          </button>
        ))}
      </div>
      {lista.length === 0 ? (
        <p style={{ fontSize: 12.5, color: C.cinza, marginTop: 12 }}>Nenhum candidato nessa etapa.</p>
      ) : lista.map((c) => (
        <div key={c.id} style={{ borderTop: "1px solid #1E3450", padding: "9px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{c.nome} {c.cargo ? <span style={{ color: C.cinza, fontWeight: 400 }}>· {c.cargo}</span> : null}</div>
              <div style={{ fontSize: 11.5, color: C.cinza, marginTop: 2 }}>
                {[c.email, c.telefone, c.origem ? "veio de " + c.origem : "", "cadastrado em " + fmtData(String(c.criadoEm).slice(0, 10))].filter(Boolean).join(" · ")}
              </div>
              {c.observacao ? <div style={{ fontSize: 11.5, color: C.cinza, marginTop: 2 }}>{c.observacao}</div> : null}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={S.tag(c.status === "contratado" ? "#123B24" : c.status === "reprovado" ? "#3B1220" : "#132A47", c.status === "contratado" ? C.verde : c.status === "reprovado" ? C.vermelho : C.azul)}>{c.statusLabel}</span>
              {c.curriculo && <button style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 12 }} onClick={() => rodar(() => onAbrir(c.curriculo.path))}>Abrir currículo</button>}
              <select style={{ ...S.input, width: 170, padding: "7px 10px", fontSize: 12.5 }} value={c.status} onChange={(e) => rodar(() => onMudarStatus(c.id, e.target.value), "Etapa atualizada.")}>
                {ORDEM_CANDIDATO.map((k) => <option key={k} value={k}>{STATUS_CANDIDATO[k]}</option>)}
              </select>
              {c.status !== "contratado" && (
                <button style={{ ...S.btn, padding: "6px 12px", fontSize: 12 }} onClick={() => { setContratando(c.id); setAdm({ dataAdmissao: hojeStr(), cargo: c.cargo || "" }); setMsg(null); }}>Contratar</button>
              )}
            </div>
          </div>
          {contratando === c.id && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
              <input type="date" style={{ ...S.input, width: 160 }} value={adm.dataAdmissao} onChange={(e) => setAdm({ ...adm, dataAdmissao: e.target.value })} />
              <input style={{ ...S.input, width: 180 }} placeholder="Cargo na admissão" value={adm.cargo} onChange={(e) => setAdm({ ...adm, cargo: e.target.value })} />
              <button style={{ ...S.btn, padding: "8px 14px", fontSize: 13, opacity: ocupado ? 0.6 : 1 }} disabled={ocupado} onClick={() => rodar(async () => {
                const conv = await onContratar(c, adm);
                setConvite({ nome: c.nome });
                setContratando(null);
                return conv;
              }, "Convite criado e candidato marcado como contratado.")}>Criar convite de acesso</button>
              <button style={{ ...S.btnGhost, padding: "8px 14px", fontSize: 13 }} onClick={() => setContratando(null)}>Cancelar</button>
              <span style={{ fontSize: 11.5, color: C.cinza }}>O e-mail usado será {c.email || "o que estiver no cadastro"}.</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* Pasta de documentos de cada pessoa, com o checklist da admissao. O app diz o
   que falta; nao inventa exigencia: a lista e a basica de contratacao no Brasil e
   pode ser ajustada em DOCS_ADMISSAO conforme o que a contabilidade pedir. */
function SecaoDocumentos({ usuarios = [], documentos = [], exames = [], onAnexar, onAbrir }) {
  // No banco o inativo vem com ativo=false; na demonstracao o campo nem existe.
  const equipe = usuarios.filter((u) => u.ativo !== false);
  const [quem, setQuem] = useState("");
  const [tipo, setTipo] = useState("identidade");
  const [arquivo, setArquivo] = useState(null);
  const [obs, setObs] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState(null);
  const alvo = quem || equipe[0]?.id || "";
  const meus = documentos.filter((d) => d.userId === alvo);
  const tem = (t) => meus.some((d) => d.tipo === t);
  const admissional = exames.some((e) => e.userId === alvo && e.tipo === "admissional" && e.status !== "agendado");
  const faltando = DOCS_ADMISSAO.filter((t) => !tem(t));
  const rodar = async (fn, okTxt) => { setOcupado(true); setMsg(null); try { await fn(); setMsg({ ok: true, txt: okTxt }); } catch (e) { setMsg({ ok: false, txt: mensagemAmigavel(e) }); } finally { setOcupado(false); } };
  return (
    <div style={{ ...S.card, marginTop: 14 }}>
      <div style={{ ...S.display, fontSize: 15, color: C.branco }}>📁 Documentos e pasta de admissão</div>
      <p style={{ fontSize: 12, color: C.cinza, margin: "6px 0 10px", lineHeight: 1.6 }}>
        Um lugar só pra guardar documento de contratação, contrato assinado e ASO. Guarde apenas o necessário e por tempo definido (LGPD art. 6º, I e III).
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select style={{ ...S.input, width: 200 }} value={alvo} onChange={(e) => setQuem(e.target.value)}>
          {equipe.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
        </select>
        <select style={{ ...S.input, width: 210 }} value={tipo} onChange={(e) => setTipo(e.target.value)}>
          {Object.entries(TIPOS_DOCUMENTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label style={{ ...S.btnGhost, cursor: "pointer", padding: "10px 14px", fontSize: 13 }}>
          {arquivo ? "Arquivo: " + arquivo.nome : "Escolher arquivo"}
          <input type="file" accept="image/*,.pdf" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const p = validarArquivo(f); if (p) { setMsg({ ok: false, txt: p }); return; } setArquivo({ nome: f.name, file: f }); }} />
        </label>
        <input style={{ ...S.input, width: 190 }} placeholder="Observação" value={obs} onChange={(e) => setObs(e.target.value)} />
        <button style={{ ...S.btn, opacity: ocupado ? 0.6 : 1 }} disabled={ocupado} onClick={() => rodar(async () => {
          await onAnexar({ userId: alvo, tipo, arquivo: arquivo?.file || null, observacao: obs });
          setArquivo(null); setObs("");
        }, "Documento guardado.")}>{ocupado ? "Enviando…" : "Guardar documento"}</button>
      </div>
      {msg && <p style={{ fontSize: 13, color: msg.ok ? C.verde : C.vermelho, marginTop: 8 }}>{msg.txt}</p>}
      <div style={{ marginTop: 14, borderTop: "1px solid #1E3450", paddingTop: 10 }}>
        <div style={{ ...S.display, fontSize: 13, color: C.cinza }}>Checklist da admissão</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          {DOCS_ADMISSAO.map((t) => (
            <span key={t} style={S.tag(tem(t) ? "#123B24" : "#3B2A12", tem(t) ? C.verde : C.amarelo)}>{tem(t) ? "✓ " : "• "}{TIPOS_DOCUMENTO[t]}</span>
          ))}
          <span style={S.tag(admissional ? "#123B24" : "#3B2A12", admissional ? C.verde : C.amarelo)}>{admissional ? "✓ " : "• "}Exame admissional</span>
        </div>
        <p style={{ fontSize: 11.5, color: faltando.length || !admissional ? C.amarelo : C.verde, margin: "8px 0 0", lineHeight: 1.6 }}>
          {faltando.length === 0 && admissional ? "Pasta completa." : "Falta: " + faltando.map((t) => TIPOS_DOCUMENTO[t]).concat(admissional ? [] : ["exame admissional"]).join(", ") + "."}
        </p>
      </div>
      {meus.length > 0 && (
        <div style={{ marginTop: 14, borderTop: "1px solid #1E3450", paddingTop: 10 }}>
          <div style={{ ...S.display, fontSize: 13, color: C.cinza }}>Arquivos guardados</div>
          {meus.map((d) => (
            <div key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #1A2F4A", padding: "7px 0", fontSize: 13, gap: 10, flexWrap: "wrap" }}>
              <span><b>{d.tipoLabel}</b> · {d.arquivo.nome} · {fmtData(String(d.criadoEm).slice(0, 10))}{d.observacao ? " · " + d.observacao : ""}</span>
              <button style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 12 }} onClick={() => rodar(() => onAbrir(d.arquivo.path), "Arquivo aberto em outra aba.")}>Abrir</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
/* Contabilidade: o que a equipe custa de verdade e o que precisa ser recolhido.
   Tres numeros que ninguem enxerga no holerite: encargos por fora do bruto,
   provisao de 13o e ferias (dinheiro que ja e devido, mesmo sem ter saido) e o
   custo total. O regime muda a conta e vem escolhido aqui em cima, porque no
   Simples Nacional a parte patronal do INSS ja esta dentro do DAS.
   Numero de apoio a decisao: a apuracao oficial e a da contabilidade. */
function SecaoContabilidade({ usuarios = [], folhasPg = [], guias = [], onRegistrarPagamento, onSalvarLinha, onAbrir, demo }) {
  const nome = (id) => usuarios.find((u) => u.id === id)?.nome || "colaborador";
  const comps = Array.from(new Set(folhasPg.map((f) => f.competencia).concat(guias.map((g) => g.competencia)))).filter(Boolean).sort().reverse();
  const [comp, setComp] = useState("");
  const [regime, setRegime] = useState("simples");
  const [pagando, setPagando] = useState(null);
  const [pag, setPag] = useState({ pagoEm: hojeStr(), valorPago: "", observacao: "" });
  const [linhaDe, setLinhaDe] = useState(null);
  const [linhaTxt, setLinhaTxt] = useState("");
  const copiarLinha = async (v) => {
    try { await navigator.clipboard.writeText(String(v || "")); setMsg({ ok: true, txt: "Linha digitável copiada — cole no app do banco pra pagar." }); }
    catch (e) { setMsg({ ok: false, txt: "Não deu pra copiar sozinho. Selecione o número na tela e copie na mão." }); }
  };
  const [comprovante, setComprovante] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState(null);
  const alvo = comp || comps[0] || compDe(new Date());
  const folhas = folhasPg.filter((f) => f.competencia === alvo);
  const custo = useMemo(() => custoDaEquipe(folhas, regime), [folhas, regime]);
  const guiasMes = guias.filter((g) => g.competencia === alvo);
  const aPagar = guiasMes.filter((g) => g.status !== "paga");
  const rodar = async (fn, okTxt) => { setOcupado(true); setMsg(null); try { await fn(); setMsg({ ok: true, txt: okTxt }); } catch (e) { setMsg({ ok: false, txt: mensagemAmigavel(e) }); } finally { setOcupado(false); } };
  const csvContador = () => {
    const num = (v) => String(r2(+v || 0)).replace(".", ",");
    const linhas = [["Competencia", rotuloComp(alvo)], ["Regime", custo.regimeLabel], ["Pessoas", custo.pessoas],
      ["Salario bruto", num(custo.bruto)], ["INSS retido do colaborador", num(custo.inssRetido)], ["IRRF retido", num(custo.irrfRetido)],
      ["Liquido pago", num(custo.liquido)], ["FGTS 8%", num(custo.fgts)], ["INSS patronal", num(custo.inssPatronal)],
      ["RAT", num(custo.rat)], ["Terceiros", num(custo.terceiros)], ["Total de encargos", num(custo.encargos)],
      ["Provisao 13o", num(custo.decimo)], ["Provisao ferias", num(custo.ferias)], ["Provisao 1/3 de ferias", num(custo.tercoFerias)],
      ["Encargos sobre provisoes", num(custo.encargosProvisao)], ["Total provisionado", num(custo.provisoes)],
      ["Custo de caixa do mes", num(custo.custoCaixa)], ["Custo total com provisoes", num(custo.custoTotal)]];
    const gs = guiasMes.map((g) => [g.tipo, num(g.valor), g.vencimento || "", g.status, g.pagoEm || "", g.valorPago == null ? "" : num(g.valorPago)]);
    const txt = [["Resumo da folha para a contabilidade"], [], ...linhas, [], ["Guias", "Valor", "Vencimento", "Status", "Pago em", "Valor pago"], ...gs]
      .map((l) => l.join(";")).join("\r\n");
    baixarArquivo(txt, "contabilidade-" + alvo.slice(0, 7) + ".csv");
  };
  const Linha = ({ rot, val, forte, cor }) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, borderTop: "1px solid #1A2F4A", padding: "6px 0", fontSize: 13 }}>
      <span style={{ color: C.cinza }}>{rot}</span>
      <span style={{ fontWeight: forte ? 700 : 400, color: cor || C.branco, fontVariantNumeric: "tabular-nums" }}>{brl(val)}</span>
    </div>
  );
  return (
    <div style={{ ...S.card, marginTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ ...S.display, fontSize: 15, color: C.branco }}>🧾 Contabilidade · custo da equipe</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} className="no-print">
          <select style={{ ...S.input, width: "auto", padding: "9px 12px", fontSize: 13 }} value={alvo} onChange={(e) => setComp(e.target.value)}>
            {(comps.length ? comps : [alvo]).map((c) => <option key={c} value={c}>{rotuloComp(c)}</option>)}
          </select>
          <select style={{ ...S.input, width: "auto", padding: "9px 12px", fontSize: 13 }} value={regime} onChange={(e) => setRegime(e.target.value)}>
            {Object.entries(REGIMES_EMPRESA).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <button style={{ ...S.btnGhost, padding: "9px 14px", fontSize: 13 }} onClick={csvContador}>⬇ Resumo pro contador</button>
        </div>
      </div>
      {folhas.length === 0 ? (
        <p style={{ fontSize: 12.5, color: C.cinza, marginTop: 10, lineHeight: 1.6 }}>Nenhuma folha gerada nesta competência. Gere a folha em Folha de pagamento e o custo aparece aqui.</p>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 12 }}>
            {[["Salário bruto", custo.bruto, C.branco], ["Encargos por fora", custo.encargos, C.amarelo], ["Provisões do mês", custo.provisoes, C.azul], ["Custo total", custo.custoTotal, C.dourado]].map(([rot, val, cor]) => (
              <div key={rot} style={{ background: C.vidro, border: "1px solid " + C.borda, borderRadius: 12, padding: "10px 12px" }}>
                <div style={{ fontSize: 11, color: C.cinza }}>{rot}</div>
                <div style={{ ...S.display, fontSize: 18, color: cor, fontVariantNumeric: "tabular-nums" }}>{brl(val)}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14 }}>
            <div style={{ ...S.display, fontSize: 13, color: C.cinza }}>Como chega nesse número ({custo.pessoas} pessoa(s))</div>
            <Linha rot="Salário bruto da equipe" val={custo.bruto} />
            <Linha rot="INSS descontado do colaborador" val={-custo.inssRetido} />
            <Linha rot="IRRF descontado do colaborador" val={-custo.irrfRetido} />
            <Linha rot="Líquido que entra na conta deles" val={custo.liquido} forte />
            <Linha rot="FGTS 8% (empresa)" val={custo.fgts} />
            {custo.inssPatronal > 0 && <Linha rot="INSS patronal 20%" val={custo.inssPatronal} />}
            {custo.rat > 0 && <Linha rot="RAT" val={custo.rat} />}
            {custo.terceiros > 0 && <Linha rot="Terceiros (Sistema S, Salário-educação)" val={custo.terceiros} />}
            <Linha rot="Provisão de 13º (1/12)" val={custo.decimo} />
            <Linha rot="Provisão de férias (1/12)" val={custo.ferias} />
            <Linha rot="Provisão do 1/3 de férias" val={custo.tercoFerias} />
            <Linha rot="Encargos sobre as provisões" val={custo.encargosProvisao} />
            <Linha rot="Sai do caixa neste mês" val={custo.custoCaixa} forte cor={C.amarelo} />
            <Linha rot="Custo total com as provisões" val={custo.custoTotal} forte cor={C.dourado} />
          </div>
        </>
      )}
      <div style={{ marginTop: 16, borderTop: "1px solid #1E3450", paddingTop: 10 }}>
        <div style={{ ...S.display, fontSize: 13, color: C.cinza }}>Guias de {rotuloComp(alvo)}</div>
        <p style={{ fontSize: 11.5, color: C.cinza, margin: "6px 0 0", lineHeight: 1.6 }}>
          O app não paga guia nem emite código de barras: a guia nasce no eSocial/DCTFWeb/Conectividade Social. Cole aqui a linha digitável, copie no banco pra pagar e volte pra registrar data, valor e comprovante.
        </p>
        {guiasMes.length === 0 ? (
          <p style={{ fontSize: 12.5, color: C.cinza, marginTop: 8 }}>Nenhuma guia gerada. Elas nascem quando a folha da competência é fechada.</p>
        ) : guiasMes.map((g) => (
          <div key={g.id} style={{ borderTop: "1px solid #1A2F4A", padding: "8px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
              <span><b>{g.tipo}</b> · {brl(g.valor)} · vence {fmtData(g.vencimento)}{g.pagoEm ? " · pago em " + fmtData(g.pagoEm) : ""}{g.valorPago != null ? " · valor pago " + brl(g.valorPago) : ""}</span>
              <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {g.status === "paga" ? <span style={S.tag("#123B24", C.verde)}>PAGA</span> : <span style={S.tag("#3B2A12", C.amarelo)}>A PAGAR</span>}
                {g.comprovante && <button style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 12 }} onClick={() => rodar(() => onAbrir(g.comprovante.path), "Comprovante aberto em outra aba.")}>Comprovante</button>}
                {g.status !== "paga" && <button style={{ ...S.btnGhost, borderColor: C.verde, color: C.verde, padding: "5px 12px", fontSize: 12 }} onClick={() => { setPagando(g.id); setPag({ pagoEm: hojeStr(), valorPago: String(g.valor), observacao: "" }); setComprovante(null); setMsg(null); }}>Registrar pagamento</button>}
              </span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 6, fontSize: 12.5 }}>
              {linhaDe === g.id ? (
                <>
                  <input style={{ ...S.input, width: 300, fontVariantNumeric: "tabular-nums" }} placeholder="Linha digitável (47 ou 48 números)" value={linhaTxt} onChange={(e) => setLinhaTxt(e.target.value)} />
                  <button style={{ ...S.btn, padding: "8px 14px", fontSize: 13, opacity: ocupado ? 0.6 : 1 }} disabled={ocupado} onClick={() => rodar(async () => { await onSalvarLinha(g.id, linhaTxt); setLinhaDe(null); }, "Linha digitável guardada.")}>Salvar</button>
                  <button style={{ ...S.btnGhost, padding: "8px 14px", fontSize: 13 }} onClick={() => setLinhaDe(null)}>Cancelar</button>
                </>
              ) : g.linhaDigitavel ? (
                <>
                  <span style={{ color: C.cinza, fontVariantNumeric: "tabular-nums", wordBreak: "break-all" }}>{agruparLinhaDigitavel(g.linhaDigitavel)}</span>
                  <button style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 12 }} onClick={() => copiarLinha(g.linhaDigitavel)}>Copiar</button>
                  <button style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 12 }} onClick={() => { setLinhaDe(g.id); setLinhaTxt(g.linhaDigitavel); setMsg(null); }}>Trocar</button>
                </>
              ) : (
                <button style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 12 }} onClick={() => { setLinhaDe(g.id); setLinhaTxt(""); setMsg(null); }}>+ Guardar a linha digitável pra pagar no banco</button>
              )}
            </div>
            {pagando === g.id && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
                <input type="date" style={{ ...S.input, width: 155 }} value={pag.pagoEm} onChange={(e) => setPag({ ...pag, pagoEm: e.target.value })} />
                <input style={{ ...S.input, width: 140 }} placeholder="Valor pago" value={pag.valorPago} onChange={(e) => setPag({ ...pag, valorPago: e.target.value })} />
                <label style={{ ...S.btnGhost, cursor: "pointer", padding: "10px 14px", fontSize: 13 }}>
                  {comprovante ? "Comprovante: " + comprovante.nome : "Anexar comprovante"}
                  <input type="file" accept="image/*,.pdf" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const p = validarArquivo(f); if (p) { setMsg({ ok: false, txt: p }); return; } setComprovante({ nome: f.name, file: f }); }} />
                </label>
                <input style={{ ...S.input, width: 180 }} placeholder="Observação" value={pag.observacao} onChange={(e) => setPag({ ...pag, observacao: e.target.value })} />
                <button style={{ ...S.btn, padding: "8px 14px", fontSize: 13, opacity: ocupado ? 0.6 : 1 }} disabled={ocupado} onClick={() => rodar(async () => { await onRegistrarPagamento(g.id, { ...pag, comprovante: comprovante?.file || null }); setPagando(null); }, "Pagamento registrado com data e comprovante.")}>Salvar pagamento</button>
                <button style={{ ...S.btnGhost, padding: "8px 14px", fontSize: 13 }} onClick={() => setPagando(null)}>Cancelar</button>
              </div>
            )}
          </div>
        ))}
        {aPagar.length > 0 && (
          <p style={{ fontSize: 12, color: C.amarelo, margin: "10px 0 0", lineHeight: 1.6 }}>
            {aPagar.length} guia(s) sem pagamento registrado, somando {brl(aPagar.reduce((s, g) => s + g.valor, 0))}.
          </p>
        )}
      </div>
      {msg && <p style={{ fontSize: 13, color: msg.ok ? C.verde : C.vermelho, marginTop: 8 }}>{msg.txt}</p>}
      <p style={{ fontSize: 11, color: C.cinza, margin: "12px 0 0", lineHeight: 1.6 }}>
        {AVISO_FOLHA} As provisões seguem a regra geral (1/12 do bruto para o 13º, 1/12 para férias e 1/36 para o terço) e servem pra você saber quanto guardar — o lançamento contábil é feito pela contabilidade.
      </p>
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

/* Painel do gestor: trilha de aceites. Mostra quem aceitou o codigo de conduta na
   versao vigente e quem conferiu (ou contestou) o espelho do mes fechado. As
   divergencias abertas aparecem em destaque porque exigem analise. */
/* ═══════════════════════════════════════════════════════════════
   AGENDA DO RH — só o gestor vê
   Junta num só lugar os prazos que costumam passar batido: exame
   admissional/periódico, férias dentro do período concessivo, aviso de
   férias e o limite do contrato de experiência. É só leitura e cálculo —
   nada é gravado e nada bloqueia o app.
   ═══════════════════════════════════════════════════════════════ */
/* eSocial: e la que a carteira digital e assinada (S-2200) e recebe baixa (S-2299).
   O app nao transmite nada - ele mostra o que esta em aberto, o prazo de cada evento
   e monta o checklist pra mandar pra contabilidade. */
function SecaoESocial({ usuarios = [], rescisoes = [], atestados = [], folhasPg = [] }) {
  const [tudo, setTudo] = useState(false);
  const [msg, setMsg] = useState(null);
  const itens = useMemo(() => eventosESocial({ usuarios, rescisoes, atestados, folhasPg, hoje: new Date() }), [usuarios, rescisoes, atestados, folhasPg]);
  const atrasados = itens.filter((i) => i.atrasado).length;
  const mostrados = tudo ? itens : itens.slice(0, 8);
  const baixar = () => {
    const limpo = (v) => String(v == null ? "" : v).replace(/;/g, ",");
    const linhas = itens.map((i) => [i.codigo, i.nome, i.quem, i.detalhe, fmtData(i.prazo), i.atrasado ? "ATRASADO" : prazoEmPalavras(i.dias)].map(limpo));
    const txt = [["Checklist do eSocial - Ponto Renovar"], [], ["Evento", "O que e", "Quem", "Detalhe", "Prazo", "Situacao"], ...linhas]
      .map((l) => l.join(";")).join("\r\n");
    baixarArquivo(txt, "esocial-checklist.csv");
    setMsg("Checklist baixado. Mande pra contabilidade junto do resumo da folha.");
  };
  return (
    <div style={{ ...S.card, marginTop: 14, borderLeft: "4px solid " + (atrasados ? C.vermelho : C.verde) }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ ...S.display, fontSize: 15, color: C.branco }}>📨 eSocial · carteira assinada e baixa</div>
        <button style={{ ...S.btnGhost, fontSize: 12, padding: "8px 14px" }} onClick={baixar}>⬇ Checklist do eSocial</button>
      </div>
      <p style={{ fontSize: 12, color: C.cinza, margin: "6px 0 10px", lineHeight: 1.6 }}>
        A carteira é assinada quando o evento S-2200 é transmitido, e a baixa acontece com o S-2299. Quem transmite é a contabilidade (ou você, no portal do eSocial) — o app não envia nada, ele só vigia os prazos pra nada vencer.
      </p>
      {itens.length === 0 ? (
        <p style={{ fontSize: 12.5, color: C.cinza }}>Nenhum evento em aberto pelo que está cadastrado: sem admissão recente, sem desligamento e sem folha fechada esperando envio.</p>
      ) : mostrados.map((it, i) => (
        <div key={i} style={{ borderTop: "1px solid #1E3450", padding: "8px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}><span style={S.tag("#12243B", C.azul)}>{it.codigo}</span> {it.quem}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: it.atrasado ? C.vermelho : it.dias <= 10 ? C.amarelo : C.cinza }}>{fmtData(it.prazo)} · {prazoEmPalavras(it.dias)}</div>
          </div>
          <div style={{ fontSize: 12.5, color: C.branco, marginTop: 3, lineHeight: 1.5 }}>{it.nome}</div>
          {it.detalhe && <div style={{ fontSize: 11.5, color: C.cinza, marginTop: 2 }}>{it.detalhe}</div>}
          <div style={{ fontSize: 11, color: C.cinza, marginTop: 2, lineHeight: 1.5 }}>{it.base}</div>
        </div>
      ))}
      {itens.length > 8 && (
        <button style={{ ...S.btnGhost, fontSize: 12, padding: "8px 14px", marginTop: 10 }} onClick={() => setTudo(!tudo)}>
          {tudo ? "Mostrar só os 8 primeiros" : "Ver todos os " + itens.length + " eventos"}
        </button>
      )}
      {msg && <p style={{ fontSize: 12, color: C.verde, margin: "10px 0 0" }}>{msg}</p>}
      <p style={{ fontSize: 11, color: C.cinza, margin: "10px 0 0", lineHeight: 1.6 }}>
        Prazos pela regra geral: S-2200 até o dia anterior ao início do trabalho, S-2299 em até 10 dias corridos do desligamento, S-2230 e S-1200/S-1210 até o dia 15 do mês seguinte. Confirme com a contabilidade — ela é quem transmite e responde pelos eventos.
      </p>
    </div>
  );
}

function SecaoAgendaRH({ usuarios, exames, ferias }) {
  const [tudo, setTudo] = useState(false);
  const itens = useMemo(() => agendaRH({ usuarios, exames, ferias, hoje: new Date() }), [usuarios, exames, ferias]);
  const atrasados = itens.filter((i) => i.atrasado).length;
  const perto = itens.filter((i) => !i.atrasado && i.dias <= 30).length;
  const cor = { atrasado: C.vermelho, perto: C.amarelo, tranquilo: C.cinza };
  const mostrados = tudo ? itens : itens.slice(0, 8);
  return (
    <div style={{ ...S.card, marginTop: 14, borderLeft: "4px solid " + (atrasados ? C.vermelho : perto ? C.amarelo : C.verde) }}>
      <div style={{ ...S.display, fontSize: 15, color: C.branco }}>📅 Agenda do RH · próximos {AGENDA_JANELA_DIAS} dias</div>
      <p style={{ fontSize: 12, color: C.cinza, margin: "6px 0 10px", lineHeight: 1.6 }}>
        {itens.length === 0
          ? "Nada vencendo por aqui: exames, férias e contratos estão em dia pelo que está cadastrado."
          : (atrasados ? atrasados + " item(ns) já no vermelho" : "nada atrasado") + " · " + perto + " vencendo em até 30 dias · " + itens.length + " no total. O cálculo usa o que está cadastrado no app — se um exame ou férias antiga não foi lançada aqui, ela aparece como pendente."}
      </p>
      {mostrados.map((it, i) => (
        <div key={i} style={{ borderTop: "1px solid #1E3450", padding: "8px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{it.quem}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: cor[urgenciaAgenda(it)] }}>{fmtData(it.data)} · {prazoEmPalavras(it.dias)}</div>
          </div>
          <div style={{ fontSize: 12.5, color: C.branco, marginTop: 3, lineHeight: 1.5 }}>{it.titulo}</div>
          {it.detalhe && <div style={{ fontSize: 11.5, color: C.cinza, marginTop: 2 }}>{it.detalhe}</div>}
          <div style={{ fontSize: 11, color: C.cinza, marginTop: 2, lineHeight: 1.5 }}>{it.base}</div>
        </div>
      ))}
      {itens.length > 8 && (
        <button style={{ ...S.btnGhost, fontSize: 12, padding: "8px 14px", marginTop: 10 }} onClick={() => setTudo(!tudo)}>
          {tudo ? "Mostrar só os 8 primeiros" : "Ver todos os " + itens.length + " itens"}
        </button>
      )}
      <p style={{ fontSize: 11, color: C.cinza, margin: "10px 0 0", lineHeight: 1.6 }}>
        Prazos calculados por data: a periodicidade do exame vem do PCMSO da empresa (NR-7) e o contrato de experiência só existe se foi assinado assim. Confira com a contabilidade e com o médico do trabalho antes de agir — o app não substitui esses profissionais.
      </p>
    </div>
  );
}

function SecaoConformidade({ usuarios, registros }) {
  const equipe = usuarios.filter((u) => u.papel !== "gestor");
  const comps = Array.from(new Set(registros.map((r) => compDe(new Date(r.ts))))).sort().reverse().slice(0, 6);
  const [comp, setComp] = useState(comps[0] || compAtual());
  const porUsuario = equipe
    .map((u) => ({ u, itens: alertasConformidade(u.id, registros).filter((a) => mesmaComp(a.data, comp)) }))
    .filter((x) => x.itens.length > 0);
  const total = porUsuario.reduce((s, x) => s + x.itens.length, 0);
  return (
    <div style={{ ...S.card, marginTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ ...S.display, fontSize: 15, color: C.branco }}>⚠ Conformidade da jornada</div>
        <select style={{ ...S.input, width: "auto", padding: "6px 10px", fontSize: 13 }} value={comp} onChange={(e) => setComp(e.target.value)}>
          {(comps.length ? comps : [comp]).map((c) => (<option key={c} value={c}>{rotuloComp(c)}</option>))}
        </select>
      </div>
      <p style={{ fontSize: 12, color: C.cinza, margin: "6px 0 10px", lineHeight: 1.6 }}>
        {total === 0
          ? "Nenhum ponto de atenção nas marcações de " + rotuloComp(comp) + "."
          : total + " ponto(s) de atenção em " + rotuloComp(comp) + ", em " + porUsuario.length + " colaborador(es). Leitura das marcações à luz da CLT: serve pra corrigir escala e acertar o pagamento das extras, não bloqueia nada nem substitui o jurídico."}
      </p>
      {porUsuario.map(({ u, itens }) => (
        <div key={u.id} style={{ borderTop: "1px solid #1E3450", padding: "8px 0" }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{u.nome} · {itens.length} ocorrência(s)</div>
          {itens.map((a, i) => (
            <div key={i} style={{ fontSize: 12, color: a.tipo === "marcacao" ? C.cinza : C.amarelo, marginTop: 4, lineHeight: 1.5 }}>
              {a.dia} — {a.texto} <span style={{ color: C.cinza }}>({a.base})</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
/* ===============================================================
   DIAGNÓSTICO DO SISTEMA — só o gestor vê
   Confere se o app está completo: banco no ar, tabelas opcionais criadas,
   biometria e GPS do aparelho, atalho instalado, modo sem internet e
   batidas ainda na fila. Tudo aqui é LEITURA — nada é alterado por aqui.
   =============================================================== */
const TABELAS_OPCIONAIS = [
  { nome: "consentimentos_imagem", para: "termo de imagem e CFTV" },
  { nome: "aceites", para: "aceite do código de conduta e do espelho" },
  { nome: "candidatos", para: "recrutamento e currículos" },
  { nome: "documentos_rh", para: "documentos do colaborador" },
  { nome: "combinados", para: "combinados das reunioes do time" },
  { nome: "config_time", para: "endereços das salas de videochamada" },
  { nome: "conquistas", para: "mural de conquistas do time" },
  { nome: "elogios", para: "circulo de elogios e gratidao" },
  { nome: "motivadores", para: "o que motiva cada colaborador" },
  { nome: "anjo_rodada", para: "rodadas da dinamica do anjo" },
  { nome: "anjo_par", para: "pares sorteados do anjo" },
  { nome: "atas", para: "atas automaticas das reunioes" },
  { nome: "respostas", para: "as tres perguntas do planejamento" },
  { nome: "presenca_chamada", para: "quem esta na sala da reuniao agora" },
];

/* SQL das tabelas opcionais. O gestor copia daqui e roda no SQL Editor do
   Supabase — o app nunca cria tabela nem política sozinho. */
const SQL_TABELAS_OPCIONAIS = `-- Ponto Renovar · tabelas opcionais (rode uma vez no SQL Editor do Supabase)
-- Sem elas o app funciona, mas termo de imagem e aceites não ficam gravados.

create table if not exists public.consentimentos_imagem (
  usuario_id uuid primary key references public.usuarios (id) on delete cascade,
  cftv_ciente boolean not null default false,
  imagem_autorizada boolean not null default false,
  atualizado_em timestamptz not null default now()
);

create table if not exists public.aceites (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  tipo text not null,
  referencia text not null,
  status text not null,
  observacao text,
  criado_em timestamptz not null default now(),
  unique (usuario_id, tipo, referencia)
);

alter table public.consentimentos_imagem enable row level security;
alter table public.aceites enable row level security;

-- Cada colaborador cuida do que é dele; o gestor apenas lê.
drop policy if exists "imagem: dono cuida" on public.consentimentos_imagem;
create policy "imagem: dono cuida" on public.consentimentos_imagem
  for all to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

drop policy if exists "imagem: gestor le" on public.consentimentos_imagem;
create policy "imagem: gestor le" on public.consentimentos_imagem
  for select to authenticated using (exists (
    select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'gestor'));

drop policy if exists "aceites: dono cuida" on public.aceites;
create policy "aceites: dono cuida" on public.aceites
  for all to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

drop policy if exists "aceites: gestor le" on public.aceites;
create policy "aceites: gestor le" on public.aceites
  for select to authenticated using (exists (
    select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'gestor'));
create table if not exists public.candidatos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  email text,
  telefone text,
  cargo text,
  origem text,
  status text not null default 'recebido',
  curriculo_url text,
  observacao text,
  contratado_usuario_id uuid references public.usuarios (id) on delete set null,
  criado_por uuid references public.usuarios (id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.documentos_rh (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references public.usuarios (id) on delete cascade,
  candidato_id uuid references public.candidatos (id) on delete cascade,
  tipo text not null,
  arquivo_url text not null,
  nome_original text,
  observacao text,
  criado_por uuid references public.usuarios (id) on delete set null,
  criado_em timestamptz not null default now(),
  constraint documentos_rh_tem_dono check (usuario_id is not null or candidato_id is not null)
);

-- Exame agendado (data prevista) x exame realizado (data e resultado).
alter table public.exames_ocupacionais add column if not exists status text not null default 'realizado';
alter table public.exames_ocupacionais add column if not exists data_prevista date;

-- Pagamento da guia: data, valor pago e comprovante guardado.
alter table public.guias_fiscais add column if not exists pago_em date;
alter table public.guias_fiscais add column if not exists valor_pago numeric(12,2);
alter table public.guias_fiscais add column if not exists comprovante_url text;
alter table public.guias_fiscais add column if not exists observacao text;
alter table public.guias_fiscais add column if not exists linha_digitavel text;

alter table public.candidatos enable row level security;
alter table public.documentos_rh enable row level security;

-- Recrutamento e documentos sao do gestor; o colaborador le os proprios documentos.
drop policy if exists "candidatos: gestor cuida" on public.candidatos;
create policy "candidatos: gestor cuida" on public.candidatos
  for all to authenticated
  using (exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'gestor'))
  with check (exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'gestor'));

drop policy if exists "documentos: gestor cuida" on public.documentos_rh;
create policy "documentos: gestor cuida" on public.documentos_rh
  for all to authenticated
  using (exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'gestor'))
  with check (exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'gestor'));

drop policy if exists "documentos: dono le o proprio" on public.documentos_rh;
create policy "documentos: dono le o proprio" on public.documentos_rh
  for select to authenticated using (usuario_id = auth.uid());

-- Combinados das reunioes: o que ficou acordado, com dono e prazo.
-- Sem esta tabela o combinado fica so no aparelho de quem escreveu.
create table if not exists public.combinados (
  id uuid primary key default gen_random_uuid(),
  texto text not null,
  dono_id uuid references public.usuarios (id) on delete set null,
  dono_nome text,
  prazo date,
  origem text,
  feito boolean not null default false,
  feito_em timestamptz,
  criado_por uuid not null references public.usuarios (id) on delete cascade,
  criado_em timestamptz not null default now()
);
create index if not exists combinados_abertos_idx on public.combinados (feito, prazo);
alter table public.combinados enable row level security;

-- Combinado de reuniao e assunto do time inteiro: todos leem, todos registram.
drop policy if exists "combinados: o time le" on public.combinados;
create policy "combinados: o time le" on public.combinados
  for select to authenticated using (true);

drop policy if exists "combinados: o time registra" on public.combinados;
create policy "combinados: o time registra" on public.combinados
  for insert to authenticated with check (criado_por = auth.uid());

-- Concluir e do dono, de quem registrou ou do gestor - nao de qualquer um.
drop policy if exists "combinados: dono conclui" on public.combinados;
create policy "combinados: dono conclui" on public.combinados
  for update to authenticated
  using (dono_id = auth.uid() or criado_por = auth.uid()
    or exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'gestor'))
  with check (dono_id = auth.uid() or criado_por = auth.uid()
    or exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'gestor'));

-- Ajuste do time em chave/valor. Guarda os enderecos das salas de videochamada
-- ('sala_video' e o geral, 'sala_semanal', 'sala_quinzenal' e 'sala_mensal' sao
-- por ritual) e 'sala_semente', usada so para sugerir um endereco dificil de
-- adivinhar. O gestor grava uma vez e o time inteiro passa a enxergar.
create table if not exists public.config_time (
  chave text primary key,
  valor text,
  atualizado_por uuid references public.usuarios (id) on delete set null,
  atualizado_em timestamptz not null default now()
);
alter table public.config_time enable row level security;

drop policy if exists "config: o time le" on public.config_time;
create policy "config: o time le" on public.config_time
  for select to authenticated using (true);

drop policy if exists "config: gestor cuida" on public.config_time;
create policy "config: gestor cuida" on public.config_time
  for all to authenticated
  using (exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'gestor'))
  with check (exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'gestor'));

-- Mural de conquistas: vitoria e superacao contadas em voz alta pro time.
-- Nada daqui vira ponto de premio: reconhecimento com nota vira meta.
create table if not exists public.conquistas (
  id uuid primary key default gen_random_uuid(),
  texto text not null,
  tipo text not null default 'vitoria',
  autor_id uuid not null references public.usuarios (id) on delete cascade,
  autor_nome text,
  criado_em timestamptz not null default now(),
  constraint conquistas_tipo_valido check (tipo in ('vitoria', 'superacao'))
);
create index if not exists conquistas_recentes_idx on public.conquistas (criado_em desc);
alter table public.conquistas enable row level security;

drop policy if exists "conquistas: o time le" on public.conquistas;
create policy "conquistas: o time le" on public.conquistas
  for select to authenticated using (true);

drop policy if exists "conquistas: cada um conta a sua" on public.conquistas;
create policy "conquistas: cada um conta a sua" on public.conquistas
  for insert to authenticated with check (autor_id = auth.uid());

drop policy if exists "conquistas: autor corrige" on public.conquistas;
create policy "conquistas: autor corrige" on public.conquistas
  for update to authenticated using (autor_id = auth.uid()) with check (autor_id = auth.uid());

-- Circulo de elogios: quem agradece assina o que escreveu e ninguem elogia a
-- si mesmo - por isso o check compara de_id com para_id.
create table if not exists public.elogios (
  id uuid primary key default gen_random_uuid(),
  texto text not null,
  de_id uuid not null references public.usuarios (id) on delete cascade,
  de_nome text,
  para_id uuid not null references public.usuarios (id) on delete cascade,
  para_nome text,
  origem text,
  criado_em timestamptz not null default now(),
  constraint elogios_nao_e_pra_si check (de_id <> para_id)
);
create index if not exists elogios_recentes_idx on public.elogios (criado_em desc);
alter table public.elogios enable row level security;

drop policy if exists "elogios: o time le" on public.elogios;
create policy "elogios: o time le" on public.elogios
  for select to authenticated using (true);

drop policy if exists "elogios: quem elogia assina" on public.elogios;
create policy "elogios: quem elogia assina" on public.elogios
  for insert to authenticated with check (de_id = auth.uid() and de_id <> para_id);

-- O que me motiva: tres fatores escritos pela propria pessoa pra conversar com
-- a lideranca. So existe linha aqui se ela apertou compartilhar.
create table if not exists public.motivadores (
  usuario_id uuid primary key references public.usuarios (id) on delete cascade,
  nome text,
  fator_1 text,
  fator_2 text,
  fator_3 text,
  atualizado_em timestamptz not null default now()
);
alter table public.motivadores enable row level security;

drop policy if exists "motivadores: dono cuida" on public.motivadores;
create policy "motivadores: dono cuida" on public.motivadores
  for all to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

drop policy if exists "motivadores: gestor le" on public.motivadores;
create policy "motivadores: gestor le" on public.motivadores
  for select to authenticated using (exists (
    select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'gestor'));

-- Dinamica do anjo: o gestor abre a rodada e o app sorteia os pares.
create table if not exists public.anjo_rodada (
  id uuid primary key default gen_random_uuid(),
  inicio date not null,
  fim date not null,
  criado_por uuid references public.usuarios (id) on delete set null,
  criado_em timestamptz not null default now(),
  constraint anjo_rodada_periodo check (fim >= inicio)
);
alter table public.anjo_rodada enable row level security;

drop policy if exists "anjo rodada: o time le" on public.anjo_rodada;
create policy "anjo rodada: o time le" on public.anjo_rodada
  for select to authenticated using (true);

drop policy if exists "anjo rodada: gestor abre" on public.anjo_rodada;
create policy "anjo rodada: gestor abre" on public.anjo_rodada
  for insert to authenticated with check (exists (
    select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'gestor'));

-- O par so pode ser lido pelo proprio anjo: e o banco que guarda o segredo, e
-- nao a tela. Depois do sorteio nem o gestor consulta o par dos outros.
create table if not exists public.anjo_par (
  id uuid primary key default gen_random_uuid(),
  rodada_id uuid not null references public.anjo_rodada (id) on delete cascade,
  anjo_id uuid not null references public.usuarios (id) on delete cascade,
  protegido_id uuid not null references public.usuarios (id) on delete cascade,
  protegido_nome text,
  criado_em timestamptz not null default now(),
  unique (rodada_id, anjo_id),
  constraint anjo_par_nao_e_de_si check (anjo_id <> protegido_id)
);
alter table public.anjo_par enable row level security;

drop policy if exists "anjo par: so o proprio anjo le" on public.anjo_par;
create policy "anjo par: so o proprio anjo le" on public.anjo_par
  for select to authenticated using (anjo_id = auth.uid());

drop policy if exists "anjo par: gestor sorteia" on public.anjo_par;
create policy "anjo par: gestor sorteia" on public.anjo_par
  for insert to authenticated with check (exists (
    select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'gestor'));

-- Ata automatica da reuniao. O app monta sozinho ao encerrar o roteiro:
-- dia, ritual, quem estava trabalhando e os combinados que nasceram ali.
-- Nao e controle de presenca e nao existe "falta de reuniao" em lugar nenhum.
create table if not exists public.atas (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  ritual_id text not null,
  ritual_nome text,
  participantes jsonb not null default '[]'::jsonb,
  combinados jsonb not null default '[]'::jsonb,
  numeros jsonb,
  autor_id uuid not null references public.usuarios (id) on delete cascade,
  autor_nome text,
  criado_em timestamptz not null default now(),
  unique (data, ritual_id)
);
create index if not exists atas_data_idx on public.atas (data desc);
alter table public.atas enable row level security;

-- Ata e memoria do time inteiro: todos leem.
drop policy if exists "atas: o time le" on public.atas;
create policy "atas: o time le" on public.atas
  for select to authenticated using (true);

-- Quem esta na reuniao encerra e gera a ata.
drop policy if exists "atas: o time registra" on public.atas;
create policy "atas: o time registra" on public.atas
  for insert to authenticated with check (autor_id = auth.uid());

-- Corrigir a ata do dia e de quem gerou ou do gestor.
drop policy if exists "atas: autor ou gestor corrige" on public.atas;
create policy "atas: autor ou gestor corrige" on public.atas
  for update to authenticated
  using (autor_id = auth.uid()
    or exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'gestor'))
  with check (autor_id = auth.uid()
    or exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'gestor'));
-- A ata tambem guarda o que cada um respondeu naquela reuniao. Separado do
-- create acima de proposito: quem ja rodou o bloco antes so precisa desta linha.
alter table public.atas add column if not exists respostas jsonb not null default '[]'::jsonb;

-- As tres perguntas do planejamento: o que entreguei, no que vou focar, onde
-- travei. Uma linha por pessoa por reuniao. Sem isto cada um so ve a propria
-- resposta no proprio aparelho e a reuniao volta a ser "conta o que voce fez".
-- A nota de energia NAO tem tabela e nao vai ter: animo e assunto do circulo.
create table if not exists public.respostas (
  id uuid primary key default gen_random_uuid(),
  autor_id uuid not null references public.usuarios (id) on delete cascade,
  autor_nome text,
  data date not null,
  ritual_id text not null,
  entreguei text,
  foco text,
  impedimento text,
  atualizado_em timestamptz not null default now(),
  unique (autor_id, data, ritual_id)
);
create index if not exists respostas_data_idx on public.respostas (data desc);
alter table public.respostas enable row level security;

-- O time le as respostas: e exatamente para isso que a reuniao existe.
drop policy if exists "respostas: o time le" on public.respostas;
create policy "respostas: o time le" on public.respostas
  for select to authenticated using (true);

-- Cada um responde por si. Ninguem responde no lugar do colega, nem o gestor.
drop policy if exists "respostas: cada um escreve a sua" on public.respostas;
create policy "respostas: cada um escreve a sua" on public.respostas
  for insert to authenticated with check (autor_id = auth.uid());

drop policy if exists "respostas: cada um corrige a sua" on public.respostas;
create policy "respostas: cada um corrige a sua" on public.respostas
  for update to authenticated
  using (autor_id = auth.uid()) with check (autor_id = auth.uid());

-- Quem esta na sala da chamada agora. Uma linha por pessoa por reuniao por dia,
-- reescrita a cada batida enquanto a aba do app fica aberta. Isto NAO e controle
-- de frequencia: linha sem batida recente some da tela sozinha e o app nunca
-- pergunta quem faltou na chamada. Serve so para ninguem cair em sala vazia.
create table if not exists public.presenca_chamada (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  nome text,
  dia date not null,
  ritual_id text not null,
  visto_em timestamptz not null default now(),
  unique (usuario_id, dia, ritual_id)
);
create index if not exists presenca_chamada_dia_idx on public.presenca_chamada (dia desc);
alter table public.presenca_chamada enable row level security;

-- O time inteiro le: a lista so tem utilidade se todo mundo enxergar quem entrou.
drop policy if exists "presenca: o time le" on public.presenca_chamada;
create policy "presenca: o time le" on public.presenca_chamada
  for select to authenticated using (true);

drop policy if exists "presenca: cada um bate a sua" on public.presenca_chamada;
create policy "presenca: cada um bate a sua" on public.presenca_chamada
  for insert to authenticated with check (usuario_id = auth.uid());

drop policy if exists "presenca: cada um atualiza a sua" on public.presenca_chamada;
create policy "presenca: cada um atualiza a sua" on public.presenca_chamada
  for update to authenticated
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

drop policy if exists "presenca: cada um apaga a sua" on public.presenca_chamada;
create policy "presenca: cada um apaga a sua" on public.presenca_chamada
  for delete to authenticated using (usuario_id = auth.uid());
`;

/* 404 do PostgREST = tabela não existe. Resposta vazia ou barrada por RLS já
   prova que a tabela está lá, então não precisa de sessão pra sondar. */
async function sondarTabela(nome) {
  try {
    const r = await fetch(`${SUPA.url}/rest/v1/${nome}?select=*&limit=1`, {
      headers: { apikey: SUPA.anonKey, Authorization: `Bearer ${SUPA.anonKey}` },
    });
    if (r.status === 404) return "faltando";
    if (r.ok || r.status === 401 || r.status === 403) return "ok";
    return "erro";
  } catch { return "sem_rede"; }
}

function SecaoDiagnostico({ demo }) {
  const [itens, setItens] = useState(null);
  const [copiado, setCopiado] = useState("");
  const conferir = async () => {
    setItens(null);
    const l = [];
    const bio = bioDiagnostico();
    const plataforma = bio.ok ? await bioPlataformaDisponivel() : false;
    l.push({ t: "Face ID / digital neste aparelho", ok: bio.ok && plataforma,
      msg: !bio.ok ? bio.msg : plataforma ? "disponível" : "aparelho sem biometria cadastrada" });
    let geo = "o app pergunta ao registrar";
    try {
      const perm = await navigator.permissions?.query({ name: "geolocation" });
      if (perm) geo = perm.state === "granted" ? "liberada" : perm.state === "denied" ? "bloqueada nas configurações do navegador" : geo;
    } catch { /* navegador sem Permissions API: fica no texto padrão */ }
    l.push({ t: "Localização (GPS)", ok: !geo.startsWith("bloqueada"), msg: geo });
    const pwa = (typeof window !== "undefined" && window.__APP_PWA) || {};
    l.push({ t: "Atalho na tela inicial", ok: !!pwa.instalado,
      msg: pwa.instalado ? "instalado" : "ainda pelo navegador — Compartilhar › Adicionar à Tela de Início" });
    l.push({ t: "Abre sem internet", ok: !!pwa.ativo,
      msg: pwa.ativo ? "pronto" : pwa.suportado ? "preparando na próxima abertura" : pwa.suportado === false ? "navegador não suporta" : "não deu pra conferir" });
    const fila = lerFila().length;
    l.push({ t: "Batidas na fila", ok: fila === 0, msg: fila === 0 ? "nenhuma pendente" : `${fila} esperando conexão` });
    if (demo) {
      l.push({ t: "Banco de dados", ok: true, msg: "demonstração — nada é gravado" });
    } else {
      const banco = await sondarTabela("usuarios");
      l.push({ t: "Banco de dados", ok: banco === "ok",
        msg: banco === "ok" ? "respondendo" : banco === "sem_rede" ? "sem resposta — confira a internet" : "erro ao consultar" });
      for (const tb of TABELAS_OPCIONAIS) {
        const e = await sondarTabela(tb.nome);
        l.push({ t: `Tabela ${tb.nome}`, ok: e === "ok", falta: e === "faltando",
          msg: e === "ok" ? `pronta — ${tb.para}` : e === "faltando" ? `não existe ainda: ${tb.para} só aparece na tela` : "não deu pra conferir" });
      }
    }
    setItens(l);
  };
  useEffect(() => { conferir(); }, []);
  const faltaTabela = (itens || []).some((i) => i.falta);
  const copiar = async () => {
    try { await navigator.clipboard.writeText(SQL_TABELAS_OPCIONAIS); setCopiado("ok"); }
    catch { setCopiado("erro"); }
    setTimeout(() => setCopiado(""), 6000);
  };
  const alertas = (itens || []).filter((i) => !i.ok).length;
  return (
    <div style={{ ...S.card, marginTop: 14 }}>
      <div style={{ ...S.display, fontSize: 15, color: C.branco }}>🩺 Diagnóstico do sistema</div>
      <p style={{ fontSize: 12, color: C.cinza, margin: "6px 0 10px", lineHeight: 1.6 }}>
        {!itens ? "Conferindo…" : alertas === 0 ? "Tudo no lugar neste aparelho." : `${alertas} ponto(s) a ajustar.`}
        {(typeof window !== "undefined" && window.__APP_VERSAO) ? ` Versão ${window.__APP_VERSAO}.` : ""}
      </p>
      {(itens || []).map((i, k) => (
        <div key={k} style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", padding: "7px 0", borderTop: k ? "1px solid #1E3450" : "none" }}>
          <span style={{ color: i.ok ? C.verde : C.amarelo, fontSize: 13 }}>{i.ok ? "✔" : "⚠"}</span>
          <span style={{ fontSize: 13, color: C.branco }}>{i.t}</span>
          <span style={{ fontSize: 12, color: C.cinza, flex: "1 1 140px" }}>{i.msg}</span>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <button style={{ ...S.btnGhost, fontSize: 13 }} onClick={conferir}>Conferir de novo</button>
        {faltaTabela && (
          <button style={{ ...S.btn, fontSize: 13, padding: "10px 16px" }} onClick={copiar}>Copiar SQL das tabelas que faltam</button>
        )}
      </div>
      {copiado === "ok" && (
        <p style={{ fontSize: 12, color: C.verde, margin: "10px 0 0", lineHeight: 1.6 }}>
          SQL copiado. Cole no SQL Editor do Supabase, rode e toque em “Conferir de novo”.
        </p>
      )}
      {copiado === "erro" && (
        <p style={{ fontSize: 12, color: C.amarelo, margin: "10px 0 0", lineHeight: 1.6 }}>
          O navegador bloqueou a cópia. O mesmo SQL está no README do repositório.
        </p>
      )}
    </div>
  );
}
/* ===============================================================
   BACKUP DOS DADOS — só o gestor vê
   Um arquivo .json com tudo que o app carregou, pra guardar fora do
   Supabase. Nao entra no arquivo: senha, token de sessao nem credencial
   de biometria (essas nunca saem do aparelho do colaborador).
   =============================================================== */
function limparParaBackup(v) {
  if (Array.isArray(v)) return v.map(limparParaBackup);
  if (v && typeof v === "object") {
    const o = {};
    Object.keys(v).forEach((k) => {
      if (!/senha|password|credencial|token|chave|secret/i.test(k)) o[k] = limparParaBackup(v[k]);
    });
    return o;
  }
  return v;
}
function montarBackup(dados, demo) {
  return {
    gerado_em: iso(new Date()),
    empresa: { nome: EMPRESA.nome, cnpj: EMPRESA.cnpj },
    versao_app: (typeof window !== "undefined" && window.__APP_VERSAO) || null,
    origem: demo ? "demonstracao" : "producao",
    aviso: "Copia de seguranca com dados pessoais de colaboradores: guarde em local restrito e apague quando nao precisar mais (LGPD, art. 46). Nao contem senhas nem credenciais de biometria.",
    dados: limparParaBackup(dados),
  };
}
function baixarJSON(obj, nome) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function SecaoBackup({ dados, demo }) {
  const [feito, setFeito] = useState("");
  const conta = (x) => (Array.isArray(x) ? x.length : 0);
  const linhas = conta(dados.registros);
  const papeis = conta(dados.justificativas) + conta(dados.atestados) + conta(dados.ferias) + conta(dados.folgas);
  const baixar = () => {
    const hoje = dataISO(new Date());
    baixarJSON(montarBackup(dados, demo), `ponto-renovar-backup-${hoje}.json`);
    setFeito(hoje);
  };
  return (
    <div style={{ ...S.card, marginTop: 14 }}>
      <div style={{ ...S.display, fontSize: 15, color: C.branco }}>💾 Backup dos dados</div>
      <p style={{ fontSize: 12, color: C.cinza, margin: "6px 0 10px", lineHeight: 1.6 }}>
        {conta(dados.usuarios)} pessoa(s), {linhas} marcação(ões) e {papeis} pedido(s) na tela agora.
        {demo ? " Em demonstração o arquivo sai com dados fictícios." : " Baixe uma cópia no fim de cada mês e guarde fora do celular."}
      </p>
      <button style={{ ...S.btnGhost, fontSize: 13 }} onClick={baixar}>Baixar backup (JSON)</button>
      {feito && (
        <p style={{ fontSize: 12, color: C.verde, margin: "10px 0 0", lineHeight: 1.6 }}>
          Arquivo gerado. Ele tem dados pessoais: guarde em local restrito (LGPD, art. 46).
        </p>
      )}
      <p style={{ fontSize: 11, color: C.cinza, margin: "10px 0 0", lineHeight: 1.6 }}>
        O backup não substitui a guarda oficial das marcações por 5 anos (CLT art. 74 e Portaria MTP 671/2021) — ele é a sua cópia de segurança.
      </p>
    </div>
  );
}
function SecaoAceites({ usuarios, aceites = [] }) {
  const equipe = usuarios.filter((u) => u.papel !== "gestor");
  const comp = compAtual();
  const nomeDe = (id) => (usuarios.find((u) => u.id === id) || {}).nome || id;
  const contestados = aceites.filter((a) => a.tipo === "espelho" && a.status === "contestado").sort((a, b) => (a.em < b.em ? 1 : -1));
  const pendConduta = equipe.filter((u) => !aceites.some((a) => a.userId === u.id && a.tipo === "conduta" && a.ref === CONDUTA_VERSAO)).length;
  return (
    <div style={{ ...S.card, marginTop: 14 }}>
      <div style={{ ...S.display, fontSize: 15, color: C.branco }}>✔ Aceites e conferências</div>
      <p style={{ fontSize: 12, color: C.cinza, margin: "6px 0 10px", lineHeight: 1.6 }}>
        Código de conduta na versão {CONDUTA_VERSAO}: {pendConduta === 0 ? "toda a equipe aceitou" : `${pendConduta} pendente(s)`} · espelho de {rotuloComp(comp)}: conferência do próprio colaborador.
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead><tr style={{ color: C.cinza, textAlign: "left" }}><th style={{ padding: 6 }}>Colaborador</th><th>Código de conduta</th><th>Espelho {rotuloComp(comp)}</th></tr></thead>
        <tbody>
          {equipe.map((u) => {
            const ac = aceites.find((a) => a.userId === u.id && a.tipo === "conduta");
            const es = aceites.find((a) => a.userId === u.id && a.tipo === "espelho" && a.ref === comp);
            const acOk = ac && ac.ref === CONDUTA_VERSAO;
            return (
              <tr key={u.id} style={{ borderTop: "1px solid #1E3450" }}>
                <td style={{ padding: 6, fontWeight: 700 }}>{u.nome}</td>
                <td style={{ color: acOk ? C.verde : C.amarelo }}>{ac ? `${acOk ? "aceito" : "versão " + ac.ref + " (desatualizada)"} · ${fmtData(ac.em)}` : "pendente"}</td>
                <td style={{ color: !es ? C.cinza : es.status === "aceito" ? C.verde : C.vermelho }}>{es ? `${es.status === "aceito" ? "conferido" : "contestado"} · ${fmtData(es.em)}` : "sem conferência"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {contestados.length > 0 && (
        <div style={{ marginTop: 12, borderTop: "1px solid #1E3450", paddingTop: 10 }}>
          <div style={{ ...S.display, fontSize: 13, color: C.vermelho }}>⚠ Divergências apontadas</div>
          {contestados.map((a, i) => (
            <p key={i} style={{ fontSize: 12.5, color: "#C7D2E4", margin: "6px 0 0", lineHeight: 1.6 }}>
              <b>{nomeDe(a.userId)}</b> · espelho de {rotuloComp(a.ref)} · {fmtDataHora(a.em)}<br />{a.obs || "sem descrição"}
            </p>
          ))}
        </div>
      )}
      <p style={{ fontSize: 11, color: C.cinza, margin: "10px 0 0", lineHeight: 1.6 }}>A conferência do colaborador é prova de ciência das marcações, não de quitação: divergência procedente deve ser corrigida no espelho com justificativa — a correção fica registrada na auditoria, com autor e data. A guarda das marcações originais segue obrigatória por 5 anos.</p>
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
      <p style={{ fontSize: 11, color: C.cinza, marginTop: 8 }}>{locais.filter(l => l.ativo).length === 0 ? "Sem nenhum local ativo, as batidas ficam liberadas sem verificação de raio. " : ""}Cadastre estando dentro do local — 50 m cobre a maioria dos casos urbanos.</p>
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

function TelaGestor({ acoes = [], respostas = [], atas = [], usuarios, registros, faltas, justificativas, atestados, ferias, logs, decidir, locais, onCriarLocal, onDesativarLocal, convites, onCriarConvite, onSalvarUsuario, gestorId, folgas, onDecidirFolga, folhasPg, adiantamentos, guias, onGerarFolha, onEditarFolha, onFecharFolha, onCriarAdiant, onCancelarAdiant, rescisoes, examesOcupacionais, onCriarRescisao, onConfirmarRescisao, onCriarExame, onAgendarExame, onConcluirExame, candidatos, documentosRH, onCriarCandidato, onMudarStatusCandidato, onContratarCandidato, onAnexarDocumento, onAbrirArquivo, onRegistrarPagamentoGuia, onSalvarLinhaGuia, consImagem, aceites, demo }) {
  const equipe = usuarios.filter(u => u.papel !== "gestor").map(u => ({ u, a: analisarAssiduidade(u.id, registros, faltas) }));
  const ranking = usuarios
    .filter(u => u.papel !== "gestor")
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
            <div style={{ ...S.display, fontSize: 14, color: C.vermelho }}>📌 Revisão necessária: jornada e intervalo corrigidos</div>
            <p style={{ fontSize: 12.5, color: C.branco, margin: "8px 0 0", lineHeight: 1.6 }}>
              Até {fmtData(MUDANCA_INTERVALO.data)} o sistema usava intervalo de <b>2 horas</b> e jornada de <b>8 horas</b>. Os valores reais da empresa são
              <b> 1 hora de intervalo e 9 horas de jornada</b> (8h às 18h). O banco de horas é recalculado ao vivo, então os saldos <b>já estão corretos</b> —
              mas quem registrava a saída e a volta do almoço vinha acumulando <b>1 hora de crédito indevida por dia</b>, que deixou de existir.
              Confira se alguma folga aprovada ou hora extra paga com base no saldo antigo precisa ser acertada.
            </p>
            <div style={{ marginTop: 10 }}>
              {afetados.map(({ u, imp }) => (
                <div key={u.id} style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #1E3450", padding: "6px 0", fontSize: 13, gap: 10, flexWrap: "wrap" }}>
                  <span><b>{u.nome}</b> <span style={{ color: C.cinza, fontSize: 12 }}>· {imp.diasAfetados} dia(s) afetado(s)</span></span>
                  <span style={{ color: imp.minutosDiferenca < 0 ? C.vermelho : C.verde, fontWeight: 700 }}>
                    {imp.minutosDiferenca < 0 ? "−" : "+"}{hmm(Math.abs(imp.minutosDiferenca))} no saldo
                  </span>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 11, color: C.cinza, marginTop: 10, lineHeight: 1.5 }}>
              Só entram nesta conta os dias em que o colaborador registrou <b>saída e volta do almoço</b> (4 marcações). Em dias com um único par de marcações o resultado é o mesmo nas duas regras — a correção do intervalo e a da jornada se anulam.
            </p>
          </div>
        );
      })()}
      {(() => {
        /* Resumo da semana. Fica antes do painel de combinados porque serve
           de porta de entrada: uma frase dizendo por onde comecar, e so
           depois os numeros. Sem nota de energia aqui, de proposito. */
        const hojeR = dataISO(new Date());
        const rs = resumoDaSemana(acoes, respostas, atas, usuarios, hojeR);
        const corBorda = !rs.prioridade ? C.verde
          : (rs.prioridade.chave === "travado" || rs.prioridade.chave === "atrasado") ? C.vermelho
          : rs.prioridade.chave === "sem-encontro" ? C.borda : C.amarelo;
        return (
          <div style={{ ...S.card, marginTop: 14, padding: 16, borderLeft: "4px solid " + corBorda }}>
            <div style={{ ...S.display, fontSize: 15, color: C.branco }}>🗒️ Resumo da semana</div>
            <p style={{ fontSize: 12, color: C.cinza, margin: "6px 0 12px", lineHeight: 1.6 }}>
              Os últimos {rs.dias} dias do time num lugar só, para você não precisar abrir quatro telas. A nota do check-in de energia não entra aqui: quem responde recebeu a promessa de que você não lê, e time de três pessoas não tem média anônima.
            </p>
            {rs.prioridade ? (
              <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid " + C.borda, borderRadius: 12, padding: 12, marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: C.branco, fontWeight: 700 }}>{rs.prioridade.titulo}</div>
                <div style={{ fontSize: 12.5, color: C.cinza, marginTop: 4, lineHeight: 1.6 }}>{rs.prioridade.texto}</div>
              </div>
            ) : (
              <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid " + C.borda, borderRadius: 12, padding: 12, marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: C.branco, fontWeight: 700 }}>Nada pedindo sua atenção nesta janela</div>
                <div style={{ fontSize: 12.5, color: C.cinza, marginTop: 4, lineHeight: 1.6 }}>Os rituais aconteceram, ficaram registrados e os combinados estão dentro do prazo. Semana assim também merece ser dita em voz alta na próxima reunião.</div>
              </div>
            )}
            {rs.encontros === 0 ? (
              <p style={{ fontSize: 12.5, color: C.cinza, margin: 0, lineHeight: 1.6 }}>
                Nenhum ritual estava previsto nos últimos {rs.dias} dias úteis. O calendário volta sozinho na próxima segunda.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {rs.rituais.map((r) => (
                  <div key={r.id + r.data} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", borderTop: "1px solid " + C.borda, paddingTop: 8 }}>
                    <span style={{ fontSize: 15 }}>{r.icone}</span>
                    <span style={{ fontSize: 13, color: C.branco }}>{r.nome}</span>
                    <span style={{ fontSize: 12, color: C.cinza }}>{fmtData(r.data)}</span>
                    <span style={S.tag(r.semRegistro ? C.amarelo : C.verde, "#101822")}>
                      {r.semRegistro ? "ninguém escreveu" : r.responderam + " de " + r.time + " escreveram"}
                    </span>
                    {!r.semRegistro && r.semAta ? <span style={S.tag(C.cinza, "#101822")}>sem ata</span> : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}
      {(() => {
        /* Acompanhamento dos combinados. De propósito sem nome, sem ranking e
           sem contagem por pessoa: placar de tarefa atrasada é o caminho mais
           curto para o time parar de pedir ajuda em voz alta. */
        const hojeIsoG = dataISO(new Date());
        const ac = acompanhamentoCombinados(acoes, respostas, hojeIsoG);
        return (
          <div style={{ ...S.card, marginTop: 14, padding: 16, borderLeft: "4px solid " + (ac.travados || ac.atrasados ? C.amarelo : C.borda) }}>
            <div style={{ ...S.display, fontSize: 15, color: C.branco }}>🤝 Acompanhamento dos combinados</div>
            <p style={{ fontSize: 12, color: C.cinza, margin: "6px 0 12px", lineHeight: 1.6 }}>
              Números do time inteiro. Aqui não existe nome, nem ranking, nem contagem por pessoa: isto serve para você perceber se o time aceitou trabalho demais, não para cobrar alguém. Quem ficou com o quê aparece no roteiro, onde o próprio time olha junto.
            </p>
            {ac.vazio ? (
              <p style={{ fontSize: 12.5, color: C.cinza, margin: 0, lineHeight: 1.6 }}>
                Nenhum combinado em aberto e nada repetido da reunião passada. Se o time se reuniu e nada saiu escrito, o problema não está neste painel: está na reunião terminar sem ninguém ficar com nada.
              </p>
            ) : (
              <>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <CartaoNumero rotulo="Em aberto" valor={ac.abertos} nota="combinados que ainda não fecharam" />
                  <CartaoNumero rotulo="Vencem hoje" valor={ac.vencemHoje} cor={ac.vencemHoje ? C.amarelo : C.branco} nota="dá para perguntar hoje, não depois" />
                  <CartaoNumero rotulo="Já venceram" valor={ac.atrasados} cor={ac.atrasados ? C.vermelho : C.branco}
                    nota={ac.atrasados ? "o mais antigo estourou há " + ac.atrasoMaiorDias + (ac.atrasoMaiorDias === 1 ? " dia" : " dias") : "nenhum prazo estourado"} />
                  <CartaoNumero rotulo="Sem dono ou sem prazo" valor={ac.semDono + ac.semPrazo} cor={ac.semDono + ac.semPrazo ? C.amarelo : C.branco} nota="combinado sem dono e sem data é intenção, não combinado" />
                  <CartaoNumero rotulo="Repetidos" valor={ac.travados} cor={ac.travados ? C.vermelho : C.branco} nota="pedidos de ajuda que voltaram na reunião seguinte" />
                </div>
                {ac.travados ? (
                  <p style={{ fontSize: 12.5, color: C.branco, margin: "12px 0 0", lineHeight: 1.6 }}>
                    <b>Leia o número de repetidos antes dos outros.</b> Alguém pediu a mesma ajuda em duas reuniões seguidas e nada mudou. Isso raramente é falta de esforço de quem pediu: costuma ser decisão que só você pode tomar, prioridade que ninguém trocou ou acesso que ninguém liberou. O texto do pedido fica no roteiro do time, não aqui.
                  </p>
                ) : null}
                {ac.atrasados && !ac.travados ? (
                  <p style={{ fontSize: 12.5, color: C.cinza, margin: "12px 0 0", lineHeight: 1.6 }}>
                    Prazo estourado em série quase nunca se resolve cobrando mais rápido. Vale olhar quanto trabalho novo entrou desde a última reunião antes de pedir explicação a alguém.
                  </p>
                ) : null}
              </>
            )}
          </div>
        );
      })()}
      <Detalhes titulo="⚠️ Limites e transparência do sistema">
        <ul style={{ fontSize: 12.5, color: C.branco, margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
          <li><b>Jornada de 9h/dia</b> (8h às 18h com 1h de intervalo) + sábado de 5h = 50h semanais. <b>Atenção jurídica:</b> a Constituição (art. 7º XIII) fixa 44h — as 6h excedentes precisam de acordo de compensação/banco de horas ou pagamento como extraordinárias. Confirme o enquadramento com o advogado trabalhista.</li>
          <li><b>Lembretes de batida</b> viram aviso do celular quando você autoriza (no iPhone é preciso adicionar o app à tela de início) e chegam por push de servidor (Supabase + chaves VAPID), valendo também com o app fechado.</li>
          <li><b>Saída automática (18h/13h)</b> depende de rotina agendada no banco (Supabase/pg_cron). Confirme com quem administra o banco se o agendamento das 23h está ativo.</li>
          <li><b>Biometria (WebAuthn)</b> comprova que quem bateu está com o aparelho cadastrado e passou pelo Face ID/digital <b>daquele aparelho</b>. Não é reconhecimento facial contra foto de referência da empresa: qualquer rosto ou digital cadastrado naquele celular consegue bater o ponto.</li>
          <li><b>Assinatura validada no servidor</b> antes de gravar a marcação — desafio de uso único, conferência de origem, flag de verificação biométrica, assinatura contra a chave pública e contador do autenticador.</li>
        </ul>
        <p style={{ fontSize: 11.5, color: C.cinza, margin: "8px 0 0", lineHeight: 1.5 }}>
          Mitigação: cerca geográfica (ativa) + regra no regulamento interno proibindo cadastrar terceiros no aparelho usado pro ponto. Batidas sem verificação ficam sinalizadas (⚠) no espelho e na trilha de auditoria.
        </p>
      </Detalhes>
      <div style={{ ...S.card, marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
          <div style={{ ...S.display, fontSize: 15, color: C.cinza }}>🎮 Ranking de gamificação</div>
          <div style={{ fontSize: 11, color: C.cinza }}>🎖 somente leitura · sem impacto salarial</div>
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
      <SecaoFolha {...{ usuarios, folhasPg, adiantamentos, guias, onGerarFolha, onEditarFolha, onFecharFolha, onCriarAdiant, onCancelarAdiant }} />
       <SecaoRescisao usuarios={usuarios} rescisoes={rescisoes} onCriarRescisao={onCriarRescisao} onConfirmarRescisao={onConfirmarRescisao} />
        <CartaoDespedida usuarios={usuarios} rescisoes={rescisoes} />
       <SecaoExames usuarios={usuarios} exames={examesOcupacionais} rescisoes={rescisoes} onCriarExame={onCriarExame} onAgendar={onAgendarExame} onConcluir={onConcluirExame} onAbrir={onAbrirArquivo} />
       <SecaoRecrutamento candidatos={candidatos} onCriar={onCriarCandidato} onMudarStatus={onMudarStatusCandidato} onContratar={onContratarCandidato} onAbrir={onAbrirArquivo} demo={demo} />
       <SecaoDocumentos usuarios={usuarios} documentos={documentosRH} exames={examesOcupacionais} onAnexar={onAnexarDocumento} onAbrir={onAbrirArquivo} />
       <SecaoContabilidade usuarios={usuarios} folhasPg={folhasPg} guias={guias} onRegistrarPagamento={onRegistrarPagamentoGuia} onSalvarLinha={onSalvarLinhaGuia} onAbrir={onAbrirArquivo} demo={demo} />
      <SecaoESocial usuarios={usuarios} rescisoes={rescisoes} atestados={atestados} folhasPg={folhasPg} />
      <SecaoLocais locais={locais} onCriar={onCriarLocal} onDesativar={onDesativarLocal} />
      <SecaoImagens usuarios={usuarios} consImagem={consImagem} />
      <SecaoAgendaRH usuarios={usuarios} exames={examesOcupacionais} ferias={ferias} />
      <SecaoConformidade usuarios={usuarios} registros={registros} />
      <SecaoAceites usuarios={usuarios} aceites={aceites} />
      <SecaoDiagnostico demo={demo} />
      <SecaoBackup demo={demo} dados={{ usuarios, registros, faltas, justificativas, atestados, ferias, folgas, folhasPg, adiantamentos, guias, rescisoes, exames: examesOcupacionais, candidatos, documentos: documentosRH, consImagem, aceites, locais, logs }} />
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
