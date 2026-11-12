#!/usr/bin/env node
/**
 * Assina o AFD ou o AEJ (Portaria MTP 671/2021) com o certificado e-CNPJ A1 (.pfx), gerando o arquivo .p7s
 * (assinatura CMS/CAdES "separada", em DER) ao lado do arquivo original.
 *
 * Uso:   node tools/assinar-afd-aej.mjs <AFD....txt|AEJ....txt> [--pfx caminho.pfx] [--verificar-so]
 * Padrão do .pfx:   C:\renovar\cofre\ecnpj.pfx      (ou a variável PONTO_PFX)
 * Senha do .pfx:    variável PFX_SENHA, ou o arquivo C:\renovar\cofre\ecnpj-senha.txt (uma linha, sem espaços).
 * Nunca grava a senha nem a chave em log; a chave privada vai só para um arquivo temporário que é apagado no fim.
 * Precisa do OpenSSL 3 no PATH (vem com o Git para Windows).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const alvo = args.find((a) => !a.startsWith("--"));
const opc = (nome) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : null; };
const soVerificar = args.includes("--verificar-so");
if (!alvo) { console.error("Uso: node tools/assinar-afd-aej.mjs <arquivo AFD/AEJ> [--pfx caminho.pfx] [--verificar-so]"); process.exit(2); }
const arquivo = resolve(alvo);
if (!existsSync(arquivo)) { console.error("Arquivo não encontrado:", arquivo); process.exit(2); }
const p7s = arquivo + ".p7s";

function openssl(a, extraEnv = {}) {
  return spawnSync("openssl", a, { encoding: "utf8", env: { ...process.env, ...extraEnv }, windowsHide: true });
}

if (soVerificar) {
  const r = openssl(["cms", "-verify", "-binary", "-inform", "DER", "-in", p7s, "-content", arquivo, "-noverify", "-out", process.platform === "win32" ? "NUL" : "/dev/null"]);
  console.log(r.status === 0 ? "✅ Assinatura confere com o arquivo." : "❌ Assinatura NÃO confere: " + (r.stderr || "").trim().split("\n").pop());
  process.exit(r.status === 0 ? 0 : 1);
}

const pfx = resolve(opc("--pfx") || process.env.PONTO_PFX || "C:\renovar\cofre\ecnpj.pfx");
if (!existsSync(pfx)) {
  console.error("Certificado não encontrado em " + pfx + "\nColoque o arquivo .pfx do e-CNPJ A1 nessa pasta (ou use --pfx) e rode de novo.");
  process.exit(3);
}
let senha = process.env.PFX_SENHA;
if (!senha) {
  const arqSenha = "C:\renovar\cofre\ecnpj-senha.txt";
  if (existsSync(arqSenha)) senha = readFileSync(arqSenha, "utf8").replace(/\r?\n/g, "").trim();
}
if (!senha) { console.error("Falta a senha do .pfx: defina PFX_SENHA ou grave C:\renovar\cofre\ecnpj-senha.txt"); process.exit(3); }

const tmp = mkdtempSync(join(tmpdir(), "assina-"));
try {
  const pem = join(tmp, "k.pem");
  // OpenSSL 3 recusa alguns .pfx antigos (RC2/3DES) sem -legacy: tenta normal e depois com -legacy.
  let r = openssl(["pkcs12", "-in", pfx, "-nodes", "-passin", "env:PFX_SENHA", "-out", pem], { PFX_SENHA: senha });
  if (r.status !== 0) r = openssl(["pkcs12", "-legacy", "-in", pfx, "-nodes", "-passin", "env:PFX_SENHA", "-out", pem], { PFX_SENHA: senha });
  if (r.status !== 0) { console.error("Não consegui abrir o .pfx (senha errada ou arquivo inválido)."); process.exit(4); }
  r = openssl(["cms", "-sign", "-binary", "-md", "sha256", "-cades", "-in", arquivo, "-signer", pem, "-outform", "DER", "-out", p7s]);
  if (r.status !== 0) {
    // versões sem -cades: assinatura CMS comum (também aceita como .p7s)
    r = openssl(["cms", "-sign", "-binary", "-md", "sha256", "-in", arquivo, "-signer", pem, "-outform", "DER", "-out", p7s]);
  }
  if (r.status !== 0) { console.error("Falha ao assinar: " + (r.stderr || "").trim().split("\n").pop()); process.exit(5); }
} finally {
  try { writeFileSync(join(tmp, "k.pem"), "apagado"); } catch {}
  rmSync(tmp, { recursive: true, force: true });
}
const v = openssl(["cms", "-verify", "-binary", "-inform", "DER", "-in", p7s, "-content", arquivo, "-noverify", "-out", process.platform === "win32" ? "NUL" : "/dev/null"]);
if (v.status !== 0) { console.error("❌ Assinou, mas a conferência falhou."); process.exit(6); }
console.log("✅ Assinado e conferido: " + p7s);
console.log("Envie o arquivo original e o .p7s juntos (a fiscalização confere um contra o outro).");
