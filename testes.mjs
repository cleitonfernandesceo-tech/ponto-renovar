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
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
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
  nomeArquivoSeguro, fmtData, dataLocal, addMeses, GEO_MOTIVOS, codigoGeoParaMotivo };`;
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
m.setFeriadosGlobal([{ data: "2026-07-09", nome: "Feriado" }, { data: "2026-08-15", nome: "Assunção (BH)" }, { data: "2026-12-08", nome: "Imaculada (BH)" }]);
t("seg-sex: jornada 8h", m.expedienteDoDia(new Date("2026-07-01T10:00:00")).jornadaMin === 480);
t("intervalo de 1 hora", m.expedienteDoDia(new Date("2026-07-01T10:00:00")).intervaloMin === 60, `${m.EXPEDIENTE.intervaloMin} min`);
t("sábado: 5h, sem intervalo", m.expedienteDoDia(new Date("2026-07-04T10:00:00")).jornadaMin === 300 && m.expedienteDoDia(new Date("2026-07-04T10:00:00")).intervaloMin === 0);
t("domingo fechado", m.expedienteDoDia(new Date("2026-07-05T10:00:00")).jornadaMin === 0);
t("feriado nacional fechado", m.expedienteDoDia(new Date("2026-07-09T10:00:00")).jornadaMin === 0);
t("feriado municipal BH 15/08 fechado", m.expedienteDoDia(new Date("2026-08-15T10:00:00")).jornadaMin === 0);
t("feriado municipal BH 08/12 fechado", m.expedienteDoDia(new Date("2026-12-08T10:00:00")).jornadaMin === 0);

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
secao("Banco de horas com intervalo de 1 hora");
t("dia 8-18 com par único: +60 min", m.analisarAssiduidade("u", dia(1, 8, 0, 18, 0), []).saldoMin === 60);
t("dia 8-12/13-18 (almoço batido): +60 min", m.analisarAssiduidade("u", comAlmoco, []).saldoMin === 60);
t("os dois padrões de batida convergem", m.analisarAssiduidade("u", dia(1, 8, 0, 18, 0), []).saldoMin === m.analisarAssiduidade("u", comAlmoco, []).saldoMin);
t("sábado 8-13 fecha em zero", m.analisarAssiduidade("u", dia(4, 8, 0, 13, 0), []).saldoMin === 0);
t("trabalho em feriado vira crédito integral", m.analisarAssiduidade("u", dia(9, 9, 0, 15, 0), []).saldoMin === 360);

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
t("impacto da mudança de intervalo é quantificado", m.impactoMudancaIntervalo("u", dia(1, 8, 0, 18, 0)).minutosDiferenca >= 0);

console.warn = origWarn;
console.log(`\n${"═".repeat(62)}`);
console.log(falhas.length === 0
  ? `✅ TUDO CERTO — ${ok} testes passaram. Pode publicar.`
  : `❌ ${falhas.length} FALHA(S) de ${ok + falhas.length} testes — NÃO publique:\n   - ${falhas.join("\n   - ")}`);
console.log("═".repeat(62));
process.exit(falhas.length ? 1 : 0);
