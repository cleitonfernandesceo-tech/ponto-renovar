/* =========================================================================
   Ponto Renovar - service worker
   Objetivo: o app abrir na hora e ainda funcionar quando a internet da loja
   cai, alem de permitir instalar o atalho no celular (PWA).

   O QUE ENTRA NO CACHE: somente o casco do app - index.html, o React vindo
   do unpkg, o manifest.json e os icones.

   O QUE NUNCA ENTRA NO CACHE: qualquer chamada ao Supabase (login, biometria,
   batidas, folha, atestados). Nenhum dado de colaborador fica guardado aqui;
   a fila offline de batidas continua sendo responsabilidade do proprio app.

   index.html usa CASCO PRIMEIRO (stale-while-revalidate): abre na hora com o
   que ja esta no aparelho e busca a versao nova em segundo plano. Isso tira o
   tempo de espera do carregamento em rede de loja/celular. Quando a copia nova
   fica pronta, o service worker avisa as abas abertas (ATUALIZACAO_PRONTA) e
   quem decide o momento de recarregar e o app - nunca no meio de uma batida.
   ========================================================================= */

const VERSAO = '2026.07.26-3';
const CACHE = 'ponto-renovar-' + VERSAO;
const CASCO = [
  './', './index.html', './manifest.json',
  './icon-192.png', './icon-512.png', './icon-maskable-512.png',
  // React vem do unpkg: sem isso o app nao abre offline na primeira vez
  'https://unpkg.com/react@18/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js'
];

const SEM_REDE =
  '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
  '<title>Ponto Renovar - sem conexao</title></head>' +
  '<body style="margin:0;background:#0D1B2A;color:#F5F7FA;font:16px/1.5 system-ui;padding:32px 24px">' +
  '<h1 style="font-size:20px;color:#FF7A1A">Sem conexao</h1>' +
  '<p>O Ponto Renovar ainda nao foi guardado neste aparelho. Conecte a internet' +
  ' uma vez para que o app passe a abrir tambem offline.</p>' +
  '<p><a href="./" style="color:#FF7A1A">Tentar de novo</a></p></body></html>';

self.addEventListener('install', (ev) => {
  ev.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(CASCO.map((u) => {
      var req;
      try { req = new Request(u, { cache: 'reload' }); } catch (e) { req = new Request(u); }
      return cache.add(req).catch(() => {});
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(
      nomes.filter((n) => n.startsWith('ponto-renovar-') && n !== CACHE).map((n) => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (ev) => {
  if (ev.data === 'ATUALIZAR_AGORA') self.skipWaiting();
  if (ev.data === 'VERSAO' && ev.source) ev.source.postMessage({ tipo: 'VERSAO', versao: VERSAO });
});

/* Aviso de lembrete: o app pede pro service worker mostrar (unico jeito no
   iPhone). Ao tocar no aviso, focamos a aba aberta ou abrimos o app. */
self.addEventListener('notificationclick', (ev) => {
  ev.notification.close();
  const alvo = new URL((ev.notification.data && ev.notification.data.url) || './', self.registration.scope).href;
  ev.waitUntil((async () => {
    const abas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const aba of abas) {
      if (aba.url.indexOf(self.registration.scope) === 0) { try { await aba.focus(); return; } catch (e) {} }
    }
    try { await self.clients.openWindow(alvo); } catch (e) {}
  })());
});

/* Push de servidor (Edge Function lembretes-push, no Supabase): e o unico
   caminho para o aviso chegar com o app FECHADO. O payload vem em JSON:
   { titulo, corpo, etapa, url }. Todo push assinado precisa gerar aviso
   visivel, entao ha texto de reserva se o payload vier vazio. */
self.addEventListener('push', (ev) => {
  var d = {};
  try { d = ev.data ? ev.data.json() : {}; } catch (e) { d = {}; }
  const dia = new Date().toISOString().slice(0, 10);
  ev.waitUntil(self.registration.showNotification(d.titulo || 'Ponto Renovar', {
    body: d.corpo || 'Abra o Ponto Renovar para ver o lembrete.',
    tag: (d.etapa || 'lembrete') + '-' + dia, // 1 aviso por etapa/dia em cada aparelho
    lang: 'pt-BR',
    icon: './icon-192.png',
    badge: './icon-192.png',
    data: { url: (d && d.url) || './' }
  }));
});

function guardar(cache, req, resp) {
  try {
    if (resp && resp.ok && resp.type !== 'opaque') cache.put(req, resp.clone());
  } catch (e) { /* cache cheio ou resposta nao cacheavel: segue sem guardar */ }
  return resp;
}

async function redePrimeiro(req) {
  const cache = await caches.open(CACHE);
  const daRede = fetch(req).then((r) => guardar(cache, req, r)).catch(() => null);
  const paciencia = new Promise((ok) => setTimeout(() => ok(null), 5000));
  const resp = await Promise.race([daRede, paciencia]);
  if (resp) return resp;
  const salvo = (await cache.match('./index.html')) || (await cache.match('./')) || (await cache.match(req));
  if (salvo) return salvo;
  const tardia = await daRede;
  if (tardia) return tardia;
  return new Response(SEM_REDE, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

/* Casco primeiro: responde com o index.html guardado e revalida por tras.
   Sem cache ainda (primeiro acesso do aparelho) cai no redePrimeiro. */
async function cascoPrimeiro(req) {
  const cache = await caches.open(CACHE);
  const salvo = (await cache.match('./index.html')) || (await cache.match('./'));
  if (!salvo) return redePrimeiro(req);
  revalidarCasco(req, salvo);
  return salvo;
}

/* Assinatura da resposta do GitHub Pages: se etag/data/tamanho nao mudaram,
   o casco continua igual e nao ha motivo pra avisar ninguem. */
function marcaDaResposta(r) {
  if (!r || !r.headers) return '';
  return (r.headers.get('etag') || '') + '|' + (r.headers.get('last-modified') || '') + '|' + (r.headers.get('content-length') || '');
}

async function revalidarCasco(req, salvo) {
  try {
    const nova = await fetch(new Request(req.url, { cache: 'reload', credentials: 'same-origin' }));
    if (!nova || !nova.ok) return;
    const cache = await caches.open(CACHE);
    await cache.put('./index.html', nova.clone());
    if (marcaDaResposta(nova) === marcaDaResposta(salvo)) return;
    const abas = await self.clients.matchAll({ type: 'window' });
    for (const aba of abas) {
      try { aba.postMessage({ tipo: 'ATUALIZACAO_PRONTA', versao: VERSAO }); } catch (e) { /* aba fechando */ }
    }
  } catch (e) { /* sem rede: segue com o casco guardado */ }
}

async function cachePrimeiro(req) {
  const cache = await caches.open(CACHE);
  const salvo = await cache.match(req);
  if (salvo) {
    fetch(req).then((r) => guardar(cache, req, r)).catch(() => {});
    return salvo;
  }
  const resp = await fetch(req);
  return guardar(cache, req, resp);
}

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
  if (url.hostname.endsWith('supabase.co')) return; // dados e autenticacao: sempre rede
  if (req.mode === 'navigate' || req.destination === 'document') {
    ev.respondWith(cascoPrimeiro(req));
    return;
  }
  if (url.origin === self.location.origin || url.hostname === 'unpkg.com') {
    ev.respondWith(cachePrimeiro(req));
  }
});
