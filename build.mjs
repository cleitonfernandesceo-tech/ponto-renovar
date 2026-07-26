#!/usr/bin/env node
// PONTO RENOVAR - gera o index.html a partir do ponto-renovar.jsx
// ---------------------------------------------------------------------------
// O repositorio guarda o mesmo app em dois arquivos:
//
//   ponto-renovar.jsx  fonte legivel em JSX - a unica fonte de verdade
//   index.html         arquivo realmente servido pelo GitHub Pages (JS compilado)
//
// Editar os dois na mao e arriscado: se um ficar para tras, o site publicado
// deixa de refletir o codigo. Este script resolve isso - ele compila o .jsx e
// troca APENAS o trecho do index.html entre os marcadores __APP_INICIO__ e
// __APP_FIM__. Cabecalho, CSS, o <script> do Supabase, o <noscript> e o
// bootstrap do fim do arquivo continuam intactos.
//
// Uso:
//   npm install --no-save @babel/core@7.24.7 @babel/preset-react@7.24.7
//   node build.mjs           reescreve o index.html a partir do .jsx
//   node build.mjs --check    nao escreve nada; sai com codigo 1 se estiver fora de sincronia
//
// O --check e o que roda no GitHub Actions (.github/workflows/verificar.yml).

import { readFileSync, writeFileSync } from 'node:fs';
import { transformSync } from '@babel/core';
import presetReact from '@babel/preset-react';

const FONTE = 'ponto-renovar.jsx';
const ALVO = 'index.html';
const M_INI = '/* __APP_INICIO__ */';
const M_FIM = '/* __APP_FIM__ */';
const IMPORT_JSX = 'import React, { useState, useEffect, useRef, useMemo } from "react";';
const IMPORT_HTML = 'const { useState, useEffect, useRef, useMemo } = React;';
const EXPORT_JSX = 'export default function App';
const EXPORT_HTML = 'function App';

const checar = process.argv.includes('--check');
const conta = (txt, agulha) => txt.split(agulha).length - 1;
const morre = (msg) => { console.error('x ' + msg); process.exit(1); };
const semEspacos = (s) => s.replace(/\s+/g, ' ').trim();
const primeiraDif = (a, b) => {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return n;
};

// 1) fonte JSX -> JavaScript de navegador (sem import/export de modulo)
let src = readFileSync(FONTE, 'utf8');
if (conta(src, IMPORT_JSX) !== 1) morre('esperava exatamente 1 import do React em ' + FONTE);
if (conta(src, EXPORT_JSX) !== 1) morre('esperava exatamente 1 \'' + EXPORT_JSX + '\' em ' + FONTE);
src = src.replace(IMPORT_JSX, IMPORT_HTML).replace(EXPORT_JSX, EXPORT_HTML);

let compilado;
try {
  compilado = transformSync(src, {
    presets: [[presetReact, { runtime: 'classic' }]],
    filename: FONTE,
    babelrc: false,
    configFile: false,
    compact: false,
    comments: true
  }).code;
} catch (e) {
  morre('o Babel nao conseguiu compilar o JSX: ' + e.message);
}

// 2) troca somente o trecho gerado dentro do index.html
const html = readFileSync(ALVO, 'utf8');
if (conta(html, M_INI) !== 1 || conta(html, M_FIM) !== 1) {
  morre('marcadores __APP_INICIO__ / __APP_FIM__ ausentes ou duplicados em ' + ALVO);
}
const ini = html.indexOf(M_INI) + M_INI.length;
const fim = html.indexOf(M_FIM);
if (fim < ini) morre('marcadores na ordem errada em ' + ALVO);
const novo = html.slice(0, ini) + '\n' + compilado + '\n' + html.slice(fim);

// 3) conferir (CI) ou gravar
if (checar) {
  if (novo === html) {
    console.log('ok - index.html esta em sincronia com ' + FONTE + ' (' + html.length + ' caracteres)');
    process.exit(0);
  }
  if (semEspacos(novo) === semEspacos(html)) {
    console.log('aviso - o codigo publicado e o mesmo; muda so a formatacao gerada');
    console.log('        (versao do Babel diferente da usada na ultima publicacao). Nada a corrigir.');
    process.exit(0);
  }
  const i = primeiraDif(novo, html);
  console.error('x index.html esta DESATUALIZADO em relacao ao ' + FONTE + '.');
  console.error('  Rode "node build.mjs" e faca commit do index.html gerado.');
  console.error('  1a diferenca no caractere ' + i);
  console.error('  deveria ser: ' + JSON.stringify(novo.slice(i, i + 140)));
  console.error('  esta como:   ' + JSON.stringify(html.slice(i, i + 140)));
  process.exit(1);
}

const mudou = novo !== html;
writeFileSync(ALVO, novo);
console.log('ok - ' + ALVO + ' gerado a partir do ' + FONTE + (mudou ? '' : ' (nada mudou)'));
console.log('     ' + compilado.length + ' caracteres de JS compilado, ' + novo.length + ' no arquivo final');
