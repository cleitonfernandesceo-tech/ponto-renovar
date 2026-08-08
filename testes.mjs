#!/usr/bin/env node
/**
 * PONTO RENOVAR — suíte de testes consolidada
 * ------------------------------------------------------------------
 * Rode ANTES de publicar, na mesma pasta do ponto-renovar.jsx:
 *
 *     npm install --no-save esbuild
 *     node testes.mjs
 *
 * Sai com código 0 se tudo passar e 1 se algo falhar (dá pra usar em CI).
 * A suíte extrai os motores direto do ponto-renovar.jsx, então testa o
 * código real que vai pro ar — não uma cópia que pode envelhecer.
 * ------------------------------------------------------------------
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ARQUIVO = process.argv[2] || "ponto-renovar.jsx";
let ok = 0, falhas = [];
const t = (nome, cond, detalhe = "") => {
  if (cond) { ok++; console.log("  ✔", nome, detalhe ? `— ${detalhe}` : ""); }
  else { falhas.push(nome); console.log("  ✘ FALHOU:", nome, detalhe ? `— ${detalhe}` : ""); }
};
const secao = (nome) => console.log(`\n── ${nome} ${"─".repeat(Math.max(0, 58 - nome.length))}`);

// ---------- extrai e transpila os motores do arquivo real ----------
const dir = mkdtempSync(join(tmpdir(), "ponto-teste-"));
const src = readFileSync(ARQUIVO, "utf8");
const ini = src.indexOf("const EMPRESA");
const fim = src.indexOf("/* ================= UI base");
if (ini < 0 || fim < 0) { console.error("Não achei os marcadores do bloco de motores em", ARQUIVO); process.exit(1); }
const exports = `
export { EXPEDIENTE, PREMIO, expedienteDoDia, setFeriadosGlobal, entradaPontual, minutosAtrasoDia,
  analisarAssiduidade, elegibilidadePremio, calcularGamificacao, saldoBanco, calcularFolhaColaborador,
  calcINSS, calcIRRF, gerarAFDReal, gerarAEJReal, CONFIG_FISCAL, r2, agruparPorDia, minutosDia,
  validarFracionamento, periodoAquisitivo, FRAC, impactoMudancaIntervalo, MUDANCA_INTERVALO,
  mensagemAmigavel, limparTexto, emailValido, uuidValido, dataValida, numeroValido, validarArquivo,
  nomeArquivoSeguro, fmtData, dataLocal, addMeses, GEO_MOTIVOS, codigoGeoParaMotivo,\n  alertasConformidade, produtivasDoDia, CONF,
  agendaRH, urgenciaAgenda, prazoEmPalavras, AGENDA_JANELA_DIAS, legendaLembretes, telaInicial,
  custoDaEquipe, REGIMES_EMPRESA, STATUS_CANDIDATO, TIPOS_DOCUMENTO, DOCS_ADMISSAO, STATUS_EXAME,
  sortearAnjos, anjoPeriodoPadrao, ANJO_DIAS_PADRAO,
  numerosDoMes, compAnterior, compExtenso, ataNova, participantesDoDia, combinadosDaReuniao };`;
const entrada = join(dir, "motores.jsx");
writeFileSync(entrada, src.slice(ini, fim) + exports);
const saida = join(dir, "motores.mjs");
try {
  execFileSync("npx", ["esbuild", entrada, "--loader:.jsx=jsx", "--format=esm", `--outfile=${saida}`, "--log-level=error"], { stdio: "pipe" });
} catch (e) {
  console.error("Falha ao transpilar (esbuild instalado?):", e.stderr?.toString() || e.message);
  process.exit(1);
}
const m = await import("file://" + saida);
const origWarn = console.warn; console.warn = () => {};

console.log(`\n🧪 PONTO RENOVAR — testes sobre ${ARQUIVO}`);

// ============================================================
secao("Calendário e expediente");
m.setFeriadosGlobal([{ data: "2026-07-09", nome: "Feriado" }, { data: "2026-08-15", nome: "Assunção (BH)" }, { data: "2026-12-08", nome: "Imaculada (BH)" },
  { data: "2026-02-16", nome: "Carnaval (segunda)" }, { data: "2026-02-17", nome: "Carnaval (terça)" },
  { data: "2026-06-04", nome: "Corpus Christi" }, { data: "2026-12-12", nome: "Aniversário de BH" }]);
t("seg-sex: jornada de 9h (8h-18h com 1h de intervalo)", m.expedienteDoDia(new Date("2026-07-01T10:00:00")).jornadaMin === 540);
t("intervalo de 1 hora", m.expedienteDoDia(new Date("2026-07-01T10:00:00")).intervaloMin === 60, `${m.EXPEDIENTE.intervaloMin} min`);
t("sábado: 5h, sem intervalo", m.expedienteDoDia(new Date("2026-07-04T10:00:00")).jornadaMin === 300 && m.expedienteDoDia(new Date("2026-07-04T10:00:00")).intervaloMin === 0);
t("domingo fechado", m.expedienteDoDia(new Date("2026-07-05T10:00:00")).jornadaMin === 0);
t("feriado nacional fechado", m.expedienteDoDia(new Date("2026-07-09T10:00:00")).jornadaMin === 0);
t("feriado municipal BH 15/08 fechado", m.expedienteDoDia(new Date("2026-08-15T10:00:00")).jornadaMin === 0);
t("feriado municipal BH 08/12 fechado", m.expedienteDoDia(new Date("2026-12-08T10:00:00")).jornadaMin === 0);
t("Carnaval (segunda) fechado", m.expedienteDoDia(new Date("2026-02-16T10:00:00")).jornadaMin === 0);
t("Carnaval (terça) fechado", m.expedienteDoDia(new Date("2026-02-17T10:00:00")).jornadaMin === 0);
t("Corpus Christi fechado", m.expedienteDoDia(new Date("2026-06-04T10:00:00")).jornadaMin === 0);
t("Aniversário de BH (12/12) fechado", m.expedienteDoDia(new Date("2026-12-12T10:00:00")).jornadaMin === 0);

// ============================================================
secao("Tolerância de atraso (fonte única, 10 min)");
t("PREMIO herda a tolerância do EXPEDIENTE", m.PREMIO.toleranciaMin === m.EXPEDIENTE.toleranciaMin);
t("8:10 ainda é pontual", m.entradaPontual(new Date("2026-07-01T08:10:00")));
t("8:11 deixa de ser pontual", !m.entradaPontual(new Date("2026-07-01T08:11:00")));
t("excedente por ocorrência: 8:25 conta 15 min", m.minutosAtrasoDia(new Date("2026-07-01T08:25:00")) === 15);
t("domingo não gera atraso", m.minutosAtrasoDia(new Date("2026-07-05T09:30:00")) === 0);

// ============================================================
secao("Imunidade à ordem dos dados (bug crítico já corrigido)");
const dia = (d, hE, mE, hS, mS) => [
  { userId: "u", tipo: "entrada", ts: `2026-07-${String(d).padStart(2, "0")}T${String(hE).padStart(2, "0")}:${String(mE).padStart(2, "0")}:00`, nsr: d * 10 + 1 },
  { userId: "u", tipo: "saida", ts: `2026-07-${String(d).padStart(2, "0")}T${String(hS).padStart(2, "0")}:${String(mS).padStart(2, "0")}:00`, nsr: d * 10 + 2 }];
const comAlmoco = [...dia(1, 8, 0, 12, 0), ...dia(1, 13, 0, 18, 0)];
const U = { id: "u", salario: 3000, dependentes: 0, admissao: "2023-05-10" };
const resumo = (regs) => JSON.stringify({
  atrasos: m.analisarAssiduidade("u", regs, []).atrasos,
  saldo: m.analisarAssiduidade("u", regs, []).saldoMin,
  premio: m.elegibilidadePremio("u", regs, []).atrasoMin,
  desconto: m.calcularFolhaColaborador(U, "2026-07-01", regs, [], []).row.desconto_atrasos });
t("ordem invertida dá o mesmo resultado", resumo(comAlmoco) === resumo([...comAlmoco].reverse()));
t("ordem embaralhada dá o mesmo resultado", resumo(comAlmoco) === resumo([comAlmoco[2], comAlmoco[0], comAlmoco[3], comAlmoco[1]]));
t("colaborador pontual não acumula atraso", m.elegibilidadePremio("u", comAlmoco, []).atrasoMin === 0);

// ============================================================
secao("Banco de horas — jornada de 9h e intervalo de 1h");
t("dia 8-18 com par único fecha em ZERO", m.analisarAssiduidade("u", dia(1, 8, 0, 18, 0), []).saldoMin === 0);
t("dia 8-12/13-18 (almoço batido) fecha em ZERO", m.analisarAssiduidade("u", comAlmoco, []).saldoMin === 0);
t("os dois padrões de batida convergem", m.analisarAssiduidade("u", dia(1, 8, 0, 18, 0), []).saldoMin === m.analisarAssiduidade("u", comAlmoco, []).saldoMin);
t("sábado 8-13 fecha em zero", m.analisarAssiduidade("u", dia(4, 8, 0, 13, 0), []).saldoMin === 0);
t("trabalho em feriado vira crédito integral", m.analisarAssiduidade("u", dia(9, 9, 0, 15, 0), []).saldoMin === 360);
t("saída às 19h gera +60 min de extra", m.analisarAssiduidade("u", dia(1, 8, 0, 19, 0), []).saldoMin === 60);
t("saída às 17h gera −60 min", m.analisarAssiduidade("u", dia(1, 8, 0, 17, 0), []).saldoMin === -60);

// ============================================================
secao("Folha de pagamento (tabelas 2026)");
t("INSS 3.000 = 248,60", m.calcINSS(3000) === 248.60);
t("INSS trava no teto", m.calcINSS(50000) === m.calcINSS(8475.55));
t("IRRF isento até 5.000 (Lei 15.270)", m.calcIRRF(3500, m.calcINSS(3500), 0) === 0);
t("IRRF 10.000 sem dependentes", Math.abs(m.calcIRRF(10000, 988.09, 0) - 1569.54) < 0.02);
const fo = (u, faltas = [], regs = []) => m.calcularFolhaColaborador({ ...U, ...u }, "2026-07-01", regs, faltas, []).row;
t("VT = min(6% do bruto, valor cadastrado)", fo({ vtAtivo: true, vtValor: 300 }).desconto_vale_transporte === 180);
t("1 falta injustificada = dia + DSR", fo({}, [{ userId: "u", data: "2026-07-13", justificada: false }]).desconto_faltas === m.r2(3000 / 30 * 2));
t("falta justificada não desconta", fo({}, [{ userId: "u", data: "2026-07-13", justificada: true }]).desconto_faltas === 0);
t("falta em domingo/feriado não desconta", fo({}, [{ userId: "u", data: "2026-07-05", justificada: false }]).desconto_faltas === 0);
t("2 faltas na mesma semana = 1 DSR só", fo({}, [{ userId: "u", data: "2026-07-13", justificada: false }, { userId: "u", data: "2026-07-14", justificada: false }]).desconto_faltas === m.r2(3000 / 30 * 3));
t("admissão no meio do mês é proporcional", fo({ admissao: "2026-07-16" }).salario_bruto === 1600);
t("admissão no dia 1º paga integral (teto de 30 dias)", fo({ admissao: "2026-07-01" }).salario_bruto === 3000);
t("nunca paga mais que o contratual", [1, 15, 16, 30, 31].every(d => fo({ admissao: `2026-07-${String(d).padStart(2, "0")}` }).salario_bruto <= 3000));
t("líquido nunca fica negativo", fo({}, Array.from({ length: 22 }, (_, i) => ({ userId: "u", data: `2026-07-${String(i + 1).padStart(2, "0")}`, justificada: false }))).valor_liquido >= 0);

// ============================================================
secao("Consistência entre motores");
const faltaDomingo = [{ userId: "u", data: "2026-07-05", justificada: false }];
t("prêmio e folha tratam falta em domingo igual", m.elegibilidadePremio("u", [], faltaDomingo).faltasInj === 0 && fo({}, faltaDomingo).desconto_faltas === 0);
t("gamificação ignora falta justificada no streak",
  m.calcularGamificacao("u", comAlmoco, [{ userId: "u", data: "2026-07-13", justificada: true }]).streak === m.calcularGamificacao("u", comAlmoco, []).streak);

// ============================================================
secao("Férias — CLT art. 130, 134 §1º e política interna");
const V = (existentes, novo) => m.validarFracionamento(existentes, novo, existentes.reduce((s, x) => s + x, 0));
t("30 dias de uma vez", V([], 30).ok);
t("15 + 15", V([15], 15).ok);
t("14 + 10 + 6 (3 períodos, um com 14+)", V([14, 10], 6).ok);
t("período de 4 dias é bloqueado (mínimo 5)", !V([], 4).ok);
t("10+10+10 é bloqueado (nenhum com 14+)", !V([10, 10], 10).ok);
t("4º período é bloqueado", !V([10, 10, 5], 5).ok);
t("total acima de 30 dias é bloqueado", !V([20], 15).ok);
t("12+12 bloqueado (impossibilita o período de 14+)", !V([12], 12).ok);
t("ciclos aquisitivos são distintos por ano", m.periodoAquisitivo("2023-05-10", "2026-08-01").ciclo !== m.periodoAquisitivo("2023-05-10", "2027-08-01").ciclo);
t("addMeses respeita fim de mês", m.addMeses(new Date("2026-08-31T12:00:00"), 5).getDate() === 31);

// ============================================================
secao("Datas (fuso) e validações de entrada");
t("data pura não retrocede um dia", m.fmtData("2023-05-10") === "10/05/2023");
t("data pura em cálculo mantém o dia", m.dataLocal("2025-12-01").getDate() === 1);
t("e-mail válido aceito", m.emailValido("marina@renovartech.com.br"));
t("e-mail inválido rejeitado", !m.emailValido("mar ina@x"));
t("uuid com injeção rejeitado", !m.uuidValido("1 or 1=1--"));
t("número negativo rejeitado", m.numeroValido("-5") === null);
t("caracteres invisíveis removidos", m.limparTexto("ad\u200Bmin") === "admin");
t("bidi override removido", m.limparTexto("nota\u202Egnp.exe") === "notagnp.exe");
t("upload .exe rejeitado", !!m.validarArquivo({ name: "v.exe", type: "application/x-msdownload", size: 1000 }));
t("upload acima de 8 MB rejeitado", !!m.validarArquivo({ name: "a.pdf", type: "application/pdf", size: 20 * 1048576 }));
t("path traversal neutralizado", !m.nomeArquivoSeguro("../../etc/passwd").includes("/"));

// ============================================================
secao("Mensagens de erro amigáveis");
const msg = (s) => m.mensagemAmigavel(new Error(s));
t("RLS vira mensagem de permissão", /permissão/i.test(msg('Supabase 403: {"code":"42501","message":"row-level security"}')));
t("login inválido traduzido", /senha incorretos/i.test(msg("Invalid login credentials")));
t("sem rede traduzido", /Sem conexão/i.test(msg("Failed to fetch")));
t("erro técnico desconhecido vira genérico", /Tente de novo/i.test(msg("Unexpected token < in JSON at position 0")));
t("validação própria em português é preservada", msg("Informe o horário no formato HH:MM.") === "Informe o horário no formato HH:MM.");

// ============================================================
secao("Geolocalização");
t("5 motivos com orientação específica", Object.keys(m.GEO_MOTIVOS).length === 5 && Object.values(m.GEO_MOTIVOS).every(x => x.comoResolver.length > 40));
t("código 1 = permissão negada", m.codigoGeoParaMotivo({ code: 1 }) === "permissao_negada");
t("código 3 = timeout", m.codigoGeoParaMotivo({ code: 3 }) === "timeout");

// ============================================================
secao("Arquivos fiscais (Portaria 671/2021)");
const marcs = comAlmoco.map((r, i) => ({ nsr: i + 1, cpf: "31865924709", tsMarcacao: r.ts, tsGravacao: r.ts, coletor: "02", offline: false }));
const afd = await m.gerarAFDReal(m.CONFIG_FISCAL, marcs, []);
const linhasAfd = afd.conteudo.split("\r\n").filter(Boolean);
t("AFD: cabeçalho com 302 posições", linhasAfd[0].length === 302);
t("AFD: registros tipo 7 com 137 posições", linhasAfd.slice(1, -2).every(l => l.length === 137));
t("AFD: CNPJ real no cabeçalho", linhasAfd[0].includes("41206506000139"));
t("AFD sem marcações não quebra", (await m.gerarAFDReal(m.CONFIG_FISCAL, [], [])).conteudo.split("\r\n").filter(Boolean).length === 3);
const aej = m.gerarAEJReal(m.CONFIG_FISCAL, [{ vinculoId: "1", cpf: "31865924709", nome: "X", codHor: "H0818" }],
  [{ cod: "H0818", durMin: 480, pares: [["0800", "1200"], ["1400", "1800"]] }, { cod: "H0813", durMin: 300, pares: [["0800", "1300"]] }],
  comAlmoco.map(r => ({ vinculoId: "1", ts: r.ts, tpMarc: r.tipo === "entrada" ? "E" : "S", seq: 1, fonte: "O", codHor: "H0818" })), [], { ini: "2026-07-01", fim: "2026-07-31" });
const linhasAej = aej.conteudo.split("\r\n").filter(Boolean);
t("AEJ: abre com registro 01", linhasAej[0].startsWith("01|"));
t("AEJ: dois horários contratuais declarados", linhasAej.filter(l => l.startsWith("04|")).length === 2);

// ============================================================
secao("Casos extremos");
t("colaborador sem batidas: assiduidade zerada", m.analisarAssiduidade("u", [], []).saldoMin === 0);
t("colaborador sem batidas: folha só com INSS", fo({}).valor_liquido === m.r2(3000 - m.calcINSS(3000)));
t("batida ímpar não gera NaN", Number.isFinite(m.analisarAssiduidade("u", [comAlmoco[0]], []).saldoMin));
t("mudança de regra: dia com par único não muda", m.impactoMudancaIntervalo("u", dia(1, 8, 0, 18, 0)).minutosDiferenca === 0);
t("mudança de regra: dia com almoço batido perde o crédito indevido de 1h", m.impactoMudancaIntervalo("u", comAlmoco).minutosDiferenca === -60);

// ==============================================================
secao('Radar de conformidade da jornada');
const conf = (regs) => m.alertasConformidade('u', regs);
const tipos = (regs) => conf(regs).map((a) => a.tipo).join(',');
t('dia normal 8h–18h não gera alerta', conf(dia(1, 8, 0, 18, 0)).length === 0, tipos(dia(1, 8, 0, 18, 0)));
t('sem batidas não gera alerta', conf([]).length === 0);
t('3h de extras no dia acusam o limite de 2h (CLT 59)', conf(dia(1, 8, 0, 21, 0)).some((a) => a.tipo === 'extras' && a.texto.includes('3h00')));
t('descanso de 8h entre jornadas acusa a interjornada (CLT 66)', conf([...dia(1, 8, 0, 22, 0), ...dia(2, 6, 0, 15, 0)]).some((a) => a.tipo === 'interjornada'));
t('descanso de 14h entre jornadas não acusa interjornada', !conf([...dia(1, 8, 0, 18, 0), ...dia(2, 8, 0, 18, 0)]).some((a) => a.tipo === 'interjornada'));
t('domingo trabalhado exige compensação (CLT 67 e 70)', conf(dia(5, 9, 0, 13, 0)).some((a) => a.tipo === 'repouso'));
t('intervalo de 30min em jornada de 10h30 acusa o art. 71', conf([...dia(1, 8, 0, 12, 0), ...dia(1, 12, 30, 19, 0)]).some((a) => a.tipo === 'intervalo'));
t('intervalo de 1h batido não acusa o art. 71', !conf(comAlmoco).some((a) => a.tipo === 'intervalo'));
t('7 dias seguidos acusam a falta de repouso semanal', conf([1, 2, 3, 4, 5, 6, 7].flatMap((d) => dia(d, 8, 0, 18, 0))).some((a) => a.tipo === 'repouso' && a.texto.includes('7º dia')));
t('dia só com entrada acusa par incompleto (CLT 74 §2º)', conf([dia(1, 8, 0, 18, 0)[0]]).some((a) => a.tipo === 'marcacao'));
t('semana dentro do contratual não acusa excesso', !conf([1, 2, 3].flatMap((d) => dia(d, 8, 0, 18, 0))).some((a) => a.tipo === 'semana'));

// ==============================================================
secao('PWA: instalar no celular e abrir sem internet');
const leia = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');
const htmlPub = leia('index.html');
const manifestTxt = leia('manifest.json');
let manifest = null;
try { manifest = JSON.parse(manifestTxt); } catch (e) { /* testado abaixo */ }
t('manifest.json existe e é um JSON válido', !!manifest);
t('o app abre em janela própria (display standalone)', manifest?.display === 'standalone');
t('caminhos relativos no manifest (funciona em subpasta do GitHub Pages)',
  manifest?.start_url === './' && manifest?.scope === './');
t('todos os ícones declarados existem na pasta',
  Array.isArray(manifest?.icons) && manifest.icons.length >= 3 && manifest.icons.every((i) => existsSync(i.src)));
t('existe ícone maskable (Android não corta o logo)',
  !!manifest?.icons?.some((i) => String(i.purpose).includes('maskable')));
const swTxt = leia('sw.js');
t('sw.js existe', swTxt.length > 0);
t('service worker ignora o Supabase: nenhum dado de ponto vai pro cache',
  swTxt.includes("url.hostname.endsWith('supabase.co')") && !/const CASCO[^;]*supabase/.test(swTxt));
t('index.html registra o service worker', htmlPub.includes("register('sw.js')"));
t('index.html aponta para o manifest', /rel="manifest"\s+href="manifest.json"/.test(htmlPub));
const vSw = (swTxt.match(/VERSAO = '([^']+)'/) || [])[1];
const vHtml = (htmlPub.match(/__APP_VERSAO = '([^']+)'/) || [])[1];
t('versão do sw.js e do index.html combinam (senão o cache velho gruda)',
  !!vSw && vSw === vHtml, (vSw || '?') + ' / ' + (vHtml || '?'));

// ==============================================================
secao('Velocidade e acabamento visual');
t('o service worker abre o app com o casco guardado (nao espera a rede)',
  swTxt.includes('async function cascoPrimeiro') && swTxt.includes('ev.respondWith(cascoPrimeiro(req))'));
t('quando a versao nova fica pronta, o service worker avisa as abas abertas',
  swTxt.includes('ATUALIZACAO_PRONTA') && swTxt.includes('async function revalidarCasco'));
t('o relogio tem componente proprio nos dois arquivos (nao redesenha o app todo)',
  src.includes('function RelogioVivo()') && src.includes('<RelogioVivo />') &&
  htmlPub.includes('function RelogioVivo()') && htmlPub.includes('React.createElement(RelogioVivo, null)'));
t('o tick geral caiu de 1s para 20s (20x menos re-render em celular fraco)',
  /setRelogio\(new Date\(\)\), 20000\)/.test(src) && !/setRelogio\(new Date\(\)\), 1000\)/.test(src) &&
  /setRelogio\(new Date\(\)\), 20000\)/.test(htmlPub));
t('index.html traz a camada visual global (foco, toque, area segura, animacao)',
  htmlPub.includes(':focus-visible') && htmlPub.includes('env(safe-area-inset-top)') &&
  htmlPub.includes('prefers-reduced-motion') && htmlPub.includes('scrollbar-width:thin'));
t('paleta e estilos base com os tokens novos, iguais nos dois arquivos',
  src.includes('grafite: "#152840"') && htmlPub.includes('grafite: "#152840"') &&
  src.includes('boxShadow: C.sombra') && htmlPub.includes('boxShadow: C.sombra') &&
  src.includes('sombraForte') && htmlPub.includes('sombraForte'));

// ==============================================================
secao('Diagnostico do sistema e SQL das tabelas opcionais');
const sqlBloco = (src.match(/const SQL_TABELAS_OPCIONAIS = `([\s\S]*?)`;/) || [])[1] || '';
t('o painel do gestor exibe o cartão de diagnóstico', src.includes('<SecaoDiagnostico demo={demo} />'));
t('o SQL cria as duas tabelas opcionais',
  /create table if not exists public\.consentimentos_imagem/.test(sqlBloco) &&
  /create table if not exists public\.aceites/.test(sqlBloco));
t('o SQL tem todas as colunas que os mapeadores leem',
  ['usuario_id', 'cftv_ciente', 'imagem_autorizada', 'atualizado_em', 'tipo', 'referencia', 'status', 'observacao', 'criado_em']
    .every((c) => sqlBloco.includes(c)));
t('o SQL liga RLS em todas as tabelas que ele cria',
  (sqlBloco.match(/enable row level security/g) || []).length ===
  (sqlBloco.match(/create table if not exists/g) || []).length);
t('o SQL tem a chave única usada no upsert de aceites', sqlBloco.includes('unique (usuario_id, tipo, referencia)'));
const blocoDiag = src.slice(src.indexOf('function SecaoDiagnostico'), src.indexOf('function SecaoAceites'));
t('o diagnóstico é só leitura (não grava nem altera nada)', !/sbInsert|sbUpsert|sbDelete|sbUpdate/.test(blocoDiag));
t('o README traz exatamente o mesmo SQL', leia('README.md').includes(sqlBloco.trim()));

// ==============================================================
secao('Backup dos dados');
t('o painel do gestor tem o cartão de backup', src.includes('<SecaoBackup demo={demo}'));
const blocoBkp = src.slice(src.indexOf('function limparParaBackup'), src.indexOf('function SecaoAceites'));
t('o backup peneira campos sensíveis antes de gravar o arquivo',
  /senha\|password\|credencial\|token\|chave\|secret/i.test(blocoBkp));
t('o backup avisa sobre a guarda dos dados (LGPD art. 46)', /LGPD, art\. 46/.test(blocoBkp));
t('o backup carrega todas as listas do painel',
  ['usuarios', 'registros', 'faltas', 'justificativas', 'atestados', 'ferias', 'folgas', 'folhasPg',
   'adiantamentos', 'guias', 'rescisoes', 'exames', 'consImagem', 'aceites', 'locais', 'logs']
    .every((k) => new RegExp('<SecaoBackup[^>]*' + k).test(src.replace(/\n/g, ' '))));

// ══════════════════════════════════════════════════════════════
secao("Lembrete vira aviso do celular + atalhos do app");
const blocoNotif = src.slice(src.indexOf("const TELAS_ATALHO"), src.indexOf("function MedidorPremio"));
t("existe o helper que mostra o aviso pelo service worker",
  /async function notificarAparelho/.test(blocoNotif) && /reg\.showNotification/.test(blocoNotif));
t("o helper tenta o service worker ANTES do construtor (iPhone só aceita o 1º)",
  blocoNotif.indexOf("showNotification") < blocoNotif.indexOf("new Notification"));
t("o lembrete usa o helper e não mais o construtor direto",
  src.includes('notificarAparelho(titulo, corpo, id + "-" + chaveDia)') &&
  !src.includes("try { new Notification(titulo, { body: corpo }); }"));
t("o service worker reage ao toque no aviso e foca a aba aberta",
  /addEventListener\('notificationclick'/.test(swTxt) && /clients\.matchAll/.test(swTxt) && /clients\.openWindow/.test(swTxt));
t("a legenda do lembrete muda conforme a permissão (4 situações)",
  ["granted", "denied", "unsupported", "return \"toque em Ativar"].every((c) => blocoNotif.includes(c)));
t("o aviso de transparência explica a condição do iPhone e aponta o push de servidor",
  src.includes("Lembretes de batida</b> viram aviso do celular") &&
  src.includes("tela de início") && src.includes("push de servidor (Supabase + chaves VAPID)"));
t("o service worker mostra o aviso que chega do servidor (app fechado)",
  swTxt.includes("addEventListener('push'") && swTxt.includes("registration.showNotification"));
t("o app inscreve o aparelho no push com a chave VAPID publica",
  src.includes('const VAPID_PUBLICA = "B') && src.includes("async function registrarPush") &&
  src.includes("pushManager.subscribe") && src.includes('sbUpsert(token, "push_inscricoes"'));
t("a inscricao do push respeita demonstracao, sessao e permissao",
  src.includes('if (demo) return "demo"') && src.includes('if (!token || !uid) return "sem-sessao"') &&
  src.includes('Notification.permission !== "granted"'));
t("index.html leva a mesma chave VAPID publica do jsx",
  (src.match(/VAPID_PUBLICA = "([^"]+)"/) || [])[1] === (htmlPub.match(/VAPID_PUBLICA = "([^"]+)"/) || [])[1]);

t("o app detecta se está instalado sem quebrar fora do navegador",
  /function appInstalado/.test(blocoNotif) && /display-mode: standalone/.test(blocoNotif));
t("o manifest declara atalhos de acesso rápido", Array.isArray(manifest?.shortcuts) && manifest.shortcuts.length >= 2);
const atalhosJsx = (blocoNotif.match(/const TELAS_ATALHO = \[([^\]]*)\]/) || [])[1] || "";
t("todo atalho do manifest aponta pra uma tela que existe no app",
  (manifest?.shortcuts || []).every((a) => {
    const alvo = String(a.url || "").split("ir=")[1];
    return !!alvo && atalhosJsx.includes('"' + alvo + '"') && src.includes('tela === "' + alvo + '"');
  }));
t("os atalhos usam caminho relativo (subpasta do GitHub Pages)",
  (manifest?.shortcuts || []).every((a) => String(a.url || "").startsWith("./")));
t("os atalhos têm ícone existente", (manifest?.shortcuts || []).every((a) => (a.icons || []).every((i) => existsSync(i.src))));
t("o app abre na tela pedida pelo atalho (?ir=)", /useState\(telaInicial\)/.test(src) && /function telaInicial/.test(blocoNotif));
t("o atalho sobrevive ao login: nem o acesso normal nem a demonstracao voltam pra tela de ponto",
  (src.match(/setTela\(telaInicial\(\)\)/g) || []).length === 2);

// ══════════════════════════════════════════════════════════════
secao("Agenda do RH: exames, ferias e experiencia");
const HOJE_AG = new Date("2026-07-25T12:00:00");
const colab = (extra = {}) => ({ id: "u1", nome: "Teste", papel: "colaborador", ativo: true, admissao: "2024-01-10", ...extra });
const ag = (usuarios, exames = [], ferias = []) => m.agendaRH({ usuarios, exames, ferias, hoje: HOJE_AG });
const so = (lista, assunto) => lista.filter((x) => x.assunto === assunto);

t("sem exame nenhum, cobra o admissional na data de admissao",
  so(ag([colab()]), "exame").some((x) => x.data === "2024-01-10" && x.atrasado));
t("exame periodico vence 12 meses depois do ultimo clinico",
  so(ag([colab()], [{ userId: "u1", tipo: "periodico", tipoLabel: "Periodico", data: "2025-09-23" }]), "exame")
    .some((x) => x.data === "2026-09-23" && x.dias === 60));
t("exame com vencimento fora da janela nao polui a agenda",
  so(ag([colab()], [{ userId: "u1", tipo: "periodico", data: "2026-02-10" }]), "exame").length === 0);
t("gestor e inativo ficam fora da agenda",
  ag([colab({ papel: "gestor" })]).length === 0 && ag([colab({ ativo: false })]).length === 0);
t("ferias nao concedidas dentro do concessivo viram alerta (CLT 134/137)",
  so(ag([colab()]), "ferias").some((x) => x.data === "2026-01-10" && /em dobro/.test(x.base)));
t("30 dias de ferias gozados zeram o alerta do periodo",
  so(ag([colab()], [], [{ userId: "u1", inicio: "2025-06-02", dias: 30, status: "aprovada" }]), "ferias").length === 0);
t("ferias parciais mostram quantos dias faltam",
  so(ag([colab()], [], [{ userId: "u1", inicio: "2025-06-02", dias: 20, status: "aprovada" }]), "ferias")
    .some((x) => /Faltam 10 dia/.test(x.titulo)));
t("ferias rejeitadas nao contam como gozadas",
  so(ag([colab()], [], [{ userId: "u1", inicio: "2025-06-02", dias: 30, status: "rejeitada" }]), "ferias").length === 1);
t("aviso de ferias aparece 30 dias antes do inicio (CLT 135)",
  so(ag([colab()], [], [{ userId: "u1", inicio: "2026-08-20", dias: 15, status: "aprovada" }]), "aviso")
    .some((x) => x.data === "2026-07-21"));
t("no maximo 2 periodos de ferias atrasados por pessoa (evita lista infinita)",
  so(ag([colab({ admissao: "2019-01-10" })]), "ferias").length === 2);
t("limite do contrato de experiencia so aparece pra quem entrou ha pouco",
  so(ag([colab({ admissao: "2026-06-01" })]), "experiencia").some((x) => x.data === "2026-09-01") &&
  so(ag([colab({ admissao: "2024-01-10" })]), "experiencia").length === 0);
t("nada passa da janela de " + m.AGENDA_JANELA_DIAS + " dias",
  ag([colab(), colab({ id: "u2", nome: "Outro", admissao: "2026-06-15" })]).every((x) => x.dias <= m.AGENDA_JANELA_DIAS));
t("a agenda sai ordenada por data",
  ag([colab(), colab({ id: "u2", nome: "Outro", admissao: "2026-06-15" })]).every((x, i, l) => i === 0 || l[i - 1].data <= x.data));
t("a agenda nao altera as listas recebidas (funcao pura)", (() => {
  const us = [colab()], ex = [], fe = [];
  const antes = JSON.stringify([us, ex, fe]);
  ag(us, ex, fe); ag(us, ex, fe);
  return JSON.stringify([us, ex, fe]) === antes;
})());
t("cada item traz a base legal escrita", ag([colab()]).every((x) => typeof x.base === "string" && x.base.length > 10));
t("o prazo em palavras cobre atrasado, hoje, amanha e futuro",
  m.prazoEmPalavras(-5) === "atrasado há 5 dias" && m.prazoEmPalavras(-1) === "venceu ontem" &&
  m.prazoEmPalavras(0) === "vence hoje" && m.prazoEmPalavras(1) === "vence amanhã" && m.prazoEmPalavras(9) === "faltam 9 dias");
t("a urgencia separa atrasado, perto e tranquilo",
  m.urgenciaAgenda({ atrasado: true, dias: -3 }) === "atrasado" &&
  m.urgenciaAgenda({ atrasado: false, dias: 10 }) === "perto" &&
  m.urgenciaAgenda({ atrasado: false, dias: 90 }) === "tranquilo");
t("o painel do gestor exibe a agenda do RH", src.includes("<SecaoAgendaRH usuarios={usuarios} exames={examesOcupacionais} ferias={ferias} />"));
t("a agenda avisa que nao substitui contador nem medico do trabalho",
  /não substitui esses profissionais/.test(src.slice(src.indexOf("function SecaoAgendaRH"), src.indexOf("function SecaoConformidade"))));

// ══════════════════════════════════════════════════════════════
secao("Rede de seguranca: nunca mais tela branca");
const blocoRede = src.slice(src.indexOf("function descreveErro"), src.indexOf("function AppInterno()"));
t("existe um limite de erro de verdade (class + os dois ganchos do React)",
  /class RedeDeSeguranca extends React\.Component/.test(blocoRede) &&
  /static getDerivedStateFromError/.test(blocoRede) && /componentDidCatch/.test(blocoRede));
t("o App exportado e so a casca protegida em volta do AppInterno",
  /export default function App\(\) \{\s*return \(\s*<RedeDeSeguranca>\s*<AppInterno \/>/.test(src) &&
  /function AppInterno\(\) \{/.test(src));
t("continua havendo exatamente um export default (o build.mjs depende disso)",
  (src.match(/export default function App/g) || []).length === 1);
t("a tela de falha explica que as batidas nao foram perdidas",
  /continuam salvas/.test(blocoRede) && /nada foi perdido/.test(blocoRede));
t("a tela de falha oferece recarregar e copiar os detalhes",
  /Recarregar o app/.test(blocoRede) && /Copiar detalhes/.test(blocoRede) && /clipboard\.writeText/.test(blocoRede));
t("o detalhe copiado leva a versao do app e nao leva dado de ninguem",
  /window\.__APP_VERSAO/.test(blocoRede) && !/senha|cpf|salario|token/i.test(blocoRede));
t("o erro fica so no aparelho (nada e enviado pra fora)",
  !/fetch\(|sbInsert|sbUpsert|sbUpdate/.test(blocoRede));
t("o texto do erro sai no formato Nome - mensagem",
  /return nome \+ " - " \+ msg;/.test(blocoRede));

console.warn = origWarn;
secao("Tabela que falta no banco e mensagem de erro");
// O aceite do espelho gravava em public.aceites, que nao existia no Supabase:
// PostgREST devolvia 404/PGRST205 e o colaborador lia "Recurso nao encontrado".
t("existe regra propria pro 404 de tabela que falta (PGRST205)",
  src.includes("pgrst205|could not find the table|schema cache"));
t("a regra da tabela que falta vem ANTES do 404 generico",
  src.indexOf("pgrst205") > 0 && src.indexOf("pgrst205") < src.indexOf("Recurso não encontrado"));
t("a mensagem diz o que falta e aponta o Diagnostico do sistema",
  src.includes("no Diagnóstico do sistema, está o SQL pronto"));
t("as duas tabelas opcionais continuam listadas no diagnostico",
  src.includes('nome: "consentimentos_imagem"') && src.includes('nome: "aceites"'));
t("o SQL do diagnostico cria as duas tabelas com RLS ligada",
  src.includes("create table if not exists public.aceites")
  && src.includes("create table if not exists public.consentimentos_imagem")
  && src.includes("alter table public.aceites enable row level security"));
t("o aceite do espelho grava pela chave unica usuario_id,tipo,referencia",
  src.includes("unique (usuario_id, tipo, referencia)")
  && src.includes("'usuario_id,tipo,referencia'"));
t("a mensagem nova tambem esta no index.html publicado",
  htmlPub.includes("pgrst205"));


secao("RH: recrutamento, documentos e exame agendado");
t("existem as etapas do candidato, do curriculo recebido ao contratado",
  m.STATUS_CANDIDATO.recebido && m.STATUS_CANDIDATO.contratado && m.STATUS_CANDIDATO.reprovado);
t("a pasta de admissao cobra identidade, CPF, CTPS, residencia e contrato",
  ["identidade", "cpf", "ctps", "residencia", "contrato"].every((k) => m.DOCS_ADMISSAO.includes(k)));
t("todo tipo da pasta de admissao tem rotulo em portugues",
  m.DOCS_ADMISSAO.every((k) => typeof m.TIPOS_DOCUMENTO[k] === "string" && m.TIPOS_DOCUMENTO[k].length > 2));
t("exame tem os dois estados: agendado e realizado", m.STATUS_EXAME.agendado && m.STATUS_EXAME.realizado);
t("o painel do gestor tem recrutamento, documentos e contabilidade",
  src.includes("<SecaoRecrutamento ") && src.includes("<SecaoDocumentos ") && src.includes("<SecaoContabilidade "));
t("as tres secoes novas existem de verdade",
  /function SecaoRecrutamento\(/.test(src) && /function SecaoDocumentos\(/.test(src) && /function SecaoContabilidade\(/.test(src));
t("agendar e concluir exame sao acoes separadas",
  /const agendarExame = async/.test(src) && /const concluirExame = async/.test(src));
t("contratar candidato cria CONVITE e nunca conta com senha",
  /const contratarCandidato = async[\s\S]{0,400}criarConvite\(/.test(src)
  && !/sbSignUp/.test(src.slice(src.indexOf("const contratarCandidato"), src.indexOf("const agendarExame"))));
t("arquivo privado abre por URL assinada com prazo curto",
  /async function sbUrlAssinada/.test(src) && /expiresIn: segundos/.test(src) && /segundos = 120/.test(src));
t("as acoes novas entram na trilha de auditoria sensivel",
  ["exame_agendado", "exame_concluido", "candidato_criado", "candidato_etapa", "documento_anexado"]
    .every((a) => src.includes('"' + a + '"')));
t("o backup passou a levar candidatos e documentos",
  ["candidatos", "documentos"].every((k) => new RegExp("<SecaoBackup[^>]*" + k).test(src.replace(/\n/g, " "))));
t("o SQL do diagnostico cria candidatos e documentos_rh com RLS",
  src.includes("create table if not exists public.candidatos")
  && src.includes("create table if not exists public.documentos_rh")
  && src.includes("alter table public.candidatos enable row level security"));

secao("Contabilidade: encargos, provisoes e guia paga");
const cSimples = m.custoDaEquipe([{ salario: 10000, liquido: 8500, inss: 1100, irrf: 400 }], "simples");
const cNormal = m.custoDaEquipe([{ salario: 10000, liquido: 8500, inss: 1100, irrf: 400 }], "normal");
t("no Simples so entra FGTS por fora do bruto (INSS patronal vai no DAS)",
  cSimples.fgts === 800 && cSimples.inssPatronal === 0 && cSimples.encargos === 800, `encargos ${cSimples.encargos}`);
t("provisao do mes: 1/12 do 13o, 1/12 de ferias e 1/36 do terco",
  cSimples.decimo === 833.33 && cSimples.ferias === 833.33 && cSimples.tercoFerias === 277.78);
t("provisao carrega os encargos dela junto", cSimples.encargosProvisao === 155.56 && cSimples.provisoes === 2100,
  `provisoes ${cSimples.provisoes}`);
t("custo de caixa e custo total do Simples fecham", cSimples.custoCaixa === 10800 && cSimples.custoTotal === 12900,
  `caixa ${cSimples.custoCaixa} / total ${cSimples.custoTotal}`);
t("fora do Simples entram INSS patronal, RAT e terceiros",
  cNormal.inssPatronal === 2000 && cNormal.rat === 200 && cNormal.terceiros === 580 && cNormal.encargos === 3580,
  `encargos ${cNormal.encargos}`);
t("fora do Simples o custo total sobe", cNormal.custoTotal === 16220.55, `total ${cNormal.custoTotal}`);
t("os dois regimes existem e vem explicados na tela",
  m.REGIMES_EMPRESA.simples.label.includes("Simples") && m.REGIMES_EMPRESA.normal.inssPatronal === 0.2);
t("nenhum salario aparece se a folha da competencia estiver vazia",
  m.custoDaEquipe([], "simples").bruto === 0 && m.custoDaEquipe([], "simples").custoTotal === 0);
t("pagar guia grava data, valor e comprovante — e nunca paga sozinho",
  /const registrarPagamentoGuia = async/.test(src) && /pago_em: dados.pagoEm/.test(src)
  && /comprovante_url = path/.test(src) && !/marcarGuiaPaga/.test(src));
t("a tela avisa que o app nao paga guia nem emite codigo de barras",
  /o app n(ã|a)o paga guia (e n(ã|a)o|nem) emite c(ó|o)digo de barras/i.test(src));
t("o resumo pro contador sai em arquivo separado", /contabilidade-" \+ alvo/.test(src) && /Resumo pro contador/.test(src));
t("a versao nova esta nos dois arquivos", htmlPub.includes("2026.07.26-3") && swTxt.includes("2026.07.26-3"));

// ══════════════════════════════════════════════════════════════
secao("Rituais do time: reunioes, combinados e sala");
const blocoRit = src.slice(src.indexOf("const RITUAIS = ["), src.indexOf("/* ---------- push de servidor"));
t("os tres rituais trazem id, horario e duracao",
  ['id: "semanal"', 'inicio: "09:15"', "duracaoMin: 45",
   'id: "quinzenal"', 'inicio: "14:00"',
   'id: "mensal"', 'inicio: "15:00"'].every((p) => blocoRit.includes(p)));
t("a quinzenal segue a paridade da semana ISO",
  src.includes("const RITUAL_QUINZENAL_PARIDADE = 0") &&
  blocoRit.includes("semanaISO(dt) % 2 === RITUAL_QUINZENAL_PARIDADE"));
t("nao marca reuniao em dia sem expediente", /function reunioesDoDia[\s\S]*?expedienteDoDia/.test(blocoRit));
t("o rotulo do dia nao mente (na sexta diz o dia, nao 'amanha')",
  blocoRit.includes('if (dif === 1) return "amanhã";') && blocoRit.includes("DIAS_POR_EXTENSO[b.getDay()]"));
t("ha trava pra nao repetir o mesmo aviso",
  blocoRit.includes("function avisoJaDado") && blocoRit.includes("function marcarAviso"));
t("o check-in de energia nao vai pro banco (dado sensivel)",
  !/sbInsert|sbUpsert|sbUpdate/.test(src.slice(src.indexOf("function energiaLer"), src.indexOf("/* As três perguntas"))));
t("as tabelas novas entram no diagnostico",
  /\{ nome: "combinados"/.test(src) && /\{ nome: "config_time"/.test(src));
t("o SQL cria combinados e config_time",
  /create table if not exists public\.combinados/.test(sqlBloco) &&
  /create table if not exists public\.config_time/.test(sqlBloco));
t("so o dono, quem registrou ou o gestor conclui um combinado",
  /for update to authenticated[\s\S]*?dono_id = auth\.uid\(\) or criado_por = auth\.uid\(\)/.test(sqlBloco));
t("sem a tabela o combinado cai pro aparelho em vez de quebrar a tela",
  src.includes("setAcoesNoBanco(true)") && src.includes("setAcoesNoBanco(false)") && src.includes("acoesLer(perfil.id)"));
t("o link da sala vem do banco, nao do aparelho do gestor",
  src.includes("cfg.sala_video") && src.includes('configGravar(sessao.token, user.id, "sala_video"'));

const fnPush = leia("supabase/functions/lembretes-push/index.ts");
t("a Edge Function do push esta versionada no repositorio", fnPush.length > 2000);
t("a Edge Function repete o mesmo calendario do app",
  ['"09:15"', '"14:00"', '"15:00"', "QUINZENAL_PARIDADE = 0", "getUTCDay() === 1"].every((p) => fnPush.includes(p)));
t("a Edge Function manda os dois avisos, com pauta",
  fnPush.includes("reuniao_saida") && fnPush.includes("reuniao_chegada") && fnPush.includes("pauta"));
t("o aviso de reuniao usa a trava de um por pessoa/dia/etapa",
  fnPush.includes("push_lembretes_log?on_conflict=usuario_id,dia,etapa"));
t("o README explica o agendamento dos dois avisos",
  leia("README.md").includes("reuniao-push-saida") && leia("README.md").includes("reuniao-push-chegada"));

// ══════════════════════════════════════════════════════════════
secao("Rituais do time: mural, elogios, o que me motiva e anjo");
t("as tabelas novas entram no diagnostico",
  ["conquistas", "elogios", "motivadores", "anjo_rodada", "anjo_par"]
    .every((n) => new RegExp('\\{ nome: "' + n + '"').test(src)));
t("o SQL cria as cinco tabelas dos rituais novos",
  ["conquistas", "elogios", "motivadores", "anjo_rodada", "anjo_par"]
    .every((n) => new RegExp("create table if not exists public\\." + n).test(sqlBloco)));
t("so o proprio anjo le o par dele",
  /create policy "anjo par: so o proprio anjo le"[\s\S]*?anjo_id = auth\.uid\(\)/.test(sqlBloco));
t("ninguem elogia a si mesmo, e o banco que garante",
  sqlBloco.includes("constraint elogios_nao_e_pra_si check (de_id <> para_id)") &&
  /with check \(de_id = auth\.uid\(\) and de_id <> para_id\)/.test(sqlBloco));
t("o que me motiva e lido pelo dono e pelo gestor, e mais ninguem",
  /create policy "motivadores: dono cuida"[\s\S]*?usuario_id = auth\.uid\(\)/.test(sqlBloco) &&
  /create policy "motivadores: gestor le"[\s\S]*?u\.tipo = 'gestor'/.test(sqlBloco));
t("o mural so aceita vitoria ou superacao",
  sqlBloco.includes("constraint conquistas_tipo_valido check (tipo in ('vitoria', 'superacao'))"));
t("sem tabela, mural, elogio e anjo caem pro aparelho em vez de quebrar a tela",
  src.includes("conquistasLer(perfil.id)") && src.includes("elogiosLer(perfil.id)") &&
  src.includes("anjoLer(perfil.id)"));
t("a tela diz quando o registro ficou so no aparelho",
  ["a tabela conquistas ainda não existe no banco",
   "a tabela elogios ainda não existe no banco"].every((f) => src.includes(f)));
t("o que me motiva so sobe pro banco quando a pessoa compartilha",
  src.includes('if (!compartilhar) return "Guardado só neste aparelho.";'));
t("os pares do anjo sobem sem devolver a lista pra ninguem",
  /sbInsert\(token, "anjo_par"[\s\S]*?\)\), true\)/.test(src));
t("as abas novas aparecem na tela do time",
  ['["mural", "🏆 Mural"]', '["motiva", "💡 O que me motiva"]', '["anjo", "😇 Anjo"]']
    .every((p) => src.includes(p)));

const blocoJogo = src.slice(src.indexOf("function analisarAssiduidade"), src.indexOf("const RITUAIS = ["));
t("mural e elogios do time nao entram na conta de ponto nem do premio",
  !/rit\.conquistas|rit\.elogios|conquistasBaixar|elogiosBaixar|"conquistas"|"elogios"/.test(blocoJogo));
const blocoTelasJogo = src.slice(src.indexOf("function TelaGame"), src.indexOf("function TelaFeedback"));
t("as telas de gamificacao e premio nao recebem o mural nem os elogios",
  !/\brit\.|conquistasNoBanco|elogiosNoBanco/.test(blocoTelasJogo));
t("o premio continua recebendo so registro e falta",
  src.includes("<TelaPremio user={user} registros={registros} faltas={faltas} />"));

const paresAnjo = m.sortearAnjos(["a", "b", "c", "d", "e"]);
t("ninguem tira a si mesmo no sorteio do anjo",
  paresAnjo.length === 5 && paresAnjo.every((p) => p.anjo !== p.protegido));
t("cada pessoa e anjo uma vez e e cuidada uma vez",
  new Set(paresAnjo.map((p) => p.anjo)).size === 5 &&
  new Set(paresAnjo.map((p) => p.protegido)).size === 5);
let anjoSempreOk = true;
for (let i = 0; i < 300; i++) {
  const p = m.sortearAnjos(["a", "b", "c", "d"]);
  if (p.length !== 4 || p.some((x) => x.anjo === x.protegido)) anjoSempreOk = false;
}
t("300 sorteios seguidos e ninguem cuida de si mesmo", anjoSempreOk);
t("sorteio com menos de duas pessoas devolve vazio",
  m.sortearAnjos(["so-eu"]).length === 0 && m.sortearAnjos([]).length === 0 && m.sortearAnjos().length === 0);
t("o sorteio ignora repetido, nulo e vazio", m.sortearAnjos(["a", "a", "b", null, ""]).length === 2);
t("a rodada padrao do anjo dura duas semanas",
  m.ANJO_DIAS_PADRAO === 14 &&
  m.anjoPeriodoPadrao(new Date(2026, 7, 10)).inicio === "2026-08-10" &&
  m.anjoPeriodoPadrao(new Date(2026, 7, 10)).fim === "2026-08-23");
t("o README explica os rituais novos",
  leia("README.md").includes("### Mural, elogios, o que me motiva e a dinamica do anjo") &&
  leia("README.md").includes("anjo_par"));

// ══════════════════════════════════════════════════════════════════
secao("Retrospectiva com numeros reais e ata automatica");
const usrN = [{ id: "u1", nome: "Ana" }, { id: "u2", nome: "Bia" }, { id: "u3", nome: "Caio", ativo: false }];
const regN = [
  { userId: "u1", tipo: "entrada", ts: "2026-03-02T08:00:00" },
  { userId: "u1", tipo: "saida",   ts: "2026-03-02T18:00:00" },
  { userId: "u2", tipo: "entrada", ts: "2026-03-02T08:00:00" },
  { userId: "u2", tipo: "saida",   ts: "2026-03-02T18:00:00" },
  { userId: "u3", tipo: "entrada", ts: "2026-03-02T08:00:00" },
  { userId: "u3", tipo: "saida",   ts: "2026-03-02T18:00:00" },
  { userId: "u1", tipo: "entrada", ts: "2026-04-06T08:00:00" },
  { userId: "u1", tipo: "saida",   ts: "2026-04-06T18:00:00" },
];
const acoN = [
  { texto: "a", origem: "Planejamento da semana", criadoEm: "2026-03-02T10:00:00", feito: true,  feitoEm: "2026-03-05T10:00:00" },
  { texto: "b", origem: "Planejamento da semana", criadoEm: "2026-03-02T10:00:00", feito: false, feitoEm: "" },
  { texto: "c", origem: "Retrospectiva do mês",   criadoEm: "2026-04-01T10:00:00", feito: false, feitoEm: "" },
];
m.setFeriadosGlobal([]);
const nMar = m.numerosDoMes(usrN, regN, [], acoN, "2026-03");

t("o mes anterior vira certo, inclusive na virada de ano",
  m.compAnterior("2026-01") === "2025-12" && m.compAnterior("2026-08") === "2026-07");
t("o mes aparece por extenso na tela da reuniao",
  m.compExtenso("2026-08") === "agosto de 2026" && m.compExtenso("2025-12") === "dezembro de 2025");
t("quem esta inativo nao entra na conta do time",
  nMar.pessoas === 2 && nMar.diasTrab === 2);
t("o painel conta o que foi combinado e o que fechou no mes",
  nMar.combCriados === 2 && nMar.combFeitos === 1 && nMar.combFechamentoPct === 50);
t("o que segue aberto conta de qualquer mes, nao so do mes escolhido",
  nMar.combAbertos === 2);
t("mes sem marcacao avisa que esta vazio em vez de mostrar zeros",
  m.numerosDoMes(usrN, regN, [], acoN, "2026-12").vazio === true && nMar.vazio === false);
t("registro de outro mes nao vaza pro mes analisado",
  m.numerosDoMes(usrN, regN, [], acoN, "2026-04").diasTrab === 1);
t("as horas somam o time e descontam o intervalo",
  nMar.trabalhadoMin === 1200 && nMar.saldoMin === 0 && nMar.pontualidadePct === 100);
// Invariante de privacidade: se um dia alguem tentar devolver a lista de quem
// atrasou junto com os numeros, este teste quebra antes de ir pro ar.
t("o painel coletivo nunca devolve lista de pessoa nenhuma",
  Object.keys(nMar).every((k) => typeof nMar[k] !== "object"));
t("participante da ata sai do ponto do dia e ignora quem esta inativo",
  m.participantesDoDia(usrN, regN, "2026-03-02").join(",") === "Ana,Bia" &&
  m.participantesDoDia(usrN, regN, "2026-04-06").join(",") === "Ana" &&
  m.participantesDoDia(usrN, regN, "2026-05-01").length === 0);
t("a ata so recolhe o combinado que nasceu naquela reuniao",
  m.combinadosDaReuniao(acoN, "Planejamento da semana", "2026-03-02").length === 2 &&
  m.combinadosDaReuniao(acoN, "Planejamento da semana", "2026-04-06").length === 0 &&
  m.combinadosDaReuniao(acoN, "Retrospectiva do mês", "2026-04-01").length === 1);
const ataT = m.ataNova({ id: "mensal", nome: "Retrospectiva do mês" }, "2026-03-31",
  ["Ana", "Bia"], acoN.slice(0, 2), null, "Ana", "u1");
t("a ata guarda ritual, dia, quem estava e os combinados",
  ataT.ritualId === "mensal" && ataT.data === "2026-03-31" &&
  ataT.participantes.length === 2 && ataT.combinados.length === 2 &&
  ataT.combinados[0].texto === "a");
t("o bloco de numeros da retrospectiva tem painel proprio",
  src.includes('bloco.tipo === "numeros" ? <PainelNumerosMes'));
t("o bloco de elogios da retrospectiva abre o campo de elogio",
  src.includes('bloco.tipo === "elogios" ? <FormElogioReuniao'));
t("a tela do painel nao lista nome de colaborador",
  !/usuarios\.map|\.nome/.test(src.slice(src.indexOf("function PainelNumerosMes"), src.indexOf("function FormElogioReuniao"))));
t("a tela explica por que o numero e do time e nao da pessoa",
  src.includes("retrospectiva com nome no telão vira tribunal"));
t("encerrar a reuniao deixa claro que nao e controle de presenca",
  src.includes("Não é chamada de reunião"));
t("o SQL cria a tabela de atas com RLS ligada",
  /create table if not exists public\.atas/.test(sqlBloco) &&
  /alter table public\.atas enable row level security/.test(sqlBloco));
t("a ata entra no diagnostico de tabelas do gestor", /\{ nome: "atas"/.test(src));
t("sem a tabela a ata cai pro aparelho em vez de quebrar a tela",
  src.includes("atasNoBanco: false") && src.includes("atasLer(perfil.id)"));
t("o app nunca apaga ata", !/sbDelete\([^,]*,\s*"atas"/.test(src));
t("ata e numero do mes nao entram na gamificacao nem no premio",
  !/rit\.atas|atasBaixar|numerosDoMes/.test(src.slice(src.indexOf("function calcularGamificacao"), src.indexOf("function calcularBadges"))));
t("o README explica os numeros da retrospectiva e a ata",
  leia("README.md").includes("### Numeros da retrospectiva e ata automatica") &&
  leia("README.md").includes("sai time, nao sai pessoa"));

console.log(`\n${"═".repeat(62)}`);
console.log(falhas.length === 0
  ? `✅ TUDO CERTO — ${ok} testes passaram. Pode publicar.`
  : `❌ ${falhas.length} FALHA(S) de ${ok + falhas.length} testes — NÃO publique:\n   - ${falhas.join("\n   - ")}`);
console.log("═".repeat(62));
process.exit(falhas.length ? 1 : 0);
