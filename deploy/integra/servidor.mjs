// MRV 3D Solutions · serviço de integrações (Mercado Livre)
// Roda na VPS (container node:22-alpine, só módulos nativos). Escuta em 127.0.0.1; o nginx publica /integra/.
//  - GET  /integra/ml/callback       retorno da autorização OAuth do Mercado Livre
//  - POST /integra/ml/notificacoes   avisos (webhook) do Mercado Livre: só enfileira; os dados vêm sempre da API oficial
//  - GET  /integra/saude             verificação simples
// A cada 15 s: renova acessos, processa a fila (pedidos, envios, anúncios), envia estoque e rastreio.
// Segredos (chave secreta do aplicativo e service_role) vêm do ambiente e nunca aparecem em log.

import http from "node:http";
import { pathToFileURL } from "node:url";

const ML_API = "https://api.mercadolibre.com";
const SERVICE_ID_ME1_BR = 11; // código do ME1 no Brasil (MLB) para informar rastreio
const TOPICOS = new Set(["orders_v2", "items", "shipments"]);

export function criarServico(cfg, deps = {}) {
  const fetchF = deps.fetch || globalThis.fetch;
  const log = deps.log || ((nivel, msg) => console.log(new Date().toISOString(), nivel, msg));
  const espera = deps.espera || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const tokens = new Map(); // conta → { access, ate }

  // ---------- banco (PostgREST com a service_role) ----------
  const rpc = deps.rpc || (async (nome, args = {}) => {
    const r = await fetchF(`${cfg.supabaseUrl}/rest/v1/rpc/${nome}`, {
      method: "POST", signal: AbortSignal.timeout(20000),
      headers: { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    const txt = await r.text();
    const dados = txt ? JSON.parse(txt) : null;
    if (!r.ok) throw new Error(dados?.message || `banco ${r.status}`);
    return dados;
  });

  // ---------- API do Mercado Livre ----------
  async function oauth(form) {
    const r = await fetchF(`${ML_API}/oauth/token`, {
      method: "POST", signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: cfg.mlClientId, client_secret: cfg.mlClientSecret, ...form }).toString(),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.access_token) { const e = new Error(d.error || `oauth ${r.status}`); e.codigo = d.error; e.status = r.status; throw e; }
    return d;
  }

  async function renovar(conta, refresh) {
    try {
      const d = await oauth({ grant_type: "refresh_token", refresh_token: refresh });
      await rpc("svc_ml_salvar_tokens", { p_conta: conta, p_access: d.access_token, p_refresh: d.refresh_token || null, p_expira_s: d.expires_in || 21600 });
      tokens.set(conta, { access: d.access_token, ate: Date.now() + Math.max((d.expires_in || 21600) - 600, 60) * 1000 });
      return d.access_token;
    } catch (e) {
      const perdeu = e.codigo === "invalid_grant" || e.status === 400;
      await rpc("svc_ml_erro_conta", { p_conta: conta, p_msg: perdeu ? "O acesso ao Mercado Livre expirou ou foi revogado. Conecte a conta de novo." : "Não consegui renovar o acesso ao Mercado Livre (tentando de novo).", p_perdeu_acesso: perdeu });
      tokens.delete(conta);
      throw e;
    }
  }

  async function token(conta, forcar = false) {
    const t = tokens.get(conta);
    if (t && !forcar && t.ate > Date.now()) return t.access;
    const d = await rpc("svc_ml_token", { p_conta: conta });
    if (!d?.access) throw new Error("conta sem acesso");
    tokens.set(conta, { access: d.access, ate: Date.now() + 5 * 60 * 1000 });
    return d.access;
  }

  async function ml(conta, metodo, caminho, corpo) {
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const r = await fetchF(`${ML_API}${caminho}`, {
        method: metodo, signal: AbortSignal.timeout(20000),
        headers: { Authorization: `Bearer ${await token(conta, tentativa > 0)}`, Accept: "application/json", ...(corpo ? { "Content-Type": "application/json" } : {}) },
        body: corpo ? JSON.stringify(corpo) : undefined,
      });
      if (r.status === 401 && tentativa === 0) { tokens.delete(conta); continue; }
      const d = await r.json().catch(() => null);
      if (!r.ok) { const e = new Error(`ML ${r.status}: ${(d?.message || d?.error || "").toString().slice(0, 200)}`); e.status = r.status; throw e; }
      return d;
    }
    throw new Error("ML 401: acesso recusado");
  }

  // ---------- tarefas ----------
  async function importarPedido(conta, pedidoId) {
    const pedido = await ml(conta, "GET", `/orders/${pedidoId}`);
    let envio = null;
    if (pedido?.shipping?.id) envio = await ml(conta, "GET", `/shipments/${pedido.shipping.id}`).catch(() => null);
    return rpc("svc_ml_importar_pedido", { p_conta: conta, p_pedido: pedido, p_envio: envio });
  }

  function linhasDoItem(it) {
    const base = { item_id: it.id, titulo: it.title, status: it.status, logistica: it.shipping?.logistic_type || null, link: it.permalink || null };
    const sku = (o) => o.seller_custom_field || (o.attributes || []).find((a) => a.id === "SELLER_SKU")?.value_name || null;
    if (Array.isArray(it.variations) && it.variations.length) {
      return it.variations.map((v) => ({ ...base, variacao_id: String(v.id), preco: v.price ?? it.price, estoque: v.available_quantity,
        variacao_nome: (v.attribute_combinations || []).map((a) => a.value_name).filter(Boolean).join(" / ") || null, sku: sku(v) }));
    }
    return [{ ...base, preco: it.price, estoque: it.available_quantity, sku: sku(it) }];
  }

  async function salvarItens(conta, ids) {
    let n = 0;
    for (let i = 0; i < ids.length; i += 20) {
      const lote = await ml(conta, "GET", `/items?ids=${ids.slice(i, i + 20).join(",")}`);
      const linhas = (lote || []).filter((x) => x.code === 200 && x.body).flatMap((x) => linhasDoItem(x.body));
      if (linhas.length) n += await rpc("svc_ml_salvar_anuncios", { p_conta: conta, p_itens: linhas });
    }
    return n;
  }

  const usuarioMl = async (conta) => { const d = await rpc("svc_ml_token", { p_conta: conta }); if (!d?.ml_user) throw new Error("conta sem acesso"); return d.ml_user; };

  async function importarAnuncios(conta) {
    const usuario = await usuarioMl(conta);
    const ids = [];
    for (let offset = 0; offset < 1000; offset += 50) {
      const r = await ml(conta, "GET", `/users/${usuario}/items/search?status=active&limit=50&offset=${offset}`);
      ids.push(...(r?.results || []));
      if (!r?.results?.length || offset + 50 >= (r?.paging?.total || 0)) break;
    }
    return salvarItens(conta, ids);
  }

  async function buscarPedidos(conta) {
    const usuario = await usuarioMl(conta);
    const desde = new Date(Date.now() - 2 * 86400000).toISOString().replace("Z", "-00:00");
    let n = 0;
    for (let offset = 0; offset < 200; offset += 50) {
      const r = await ml(conta, "GET", `/orders/search?seller=${usuario}&order.date_last_updated.from=${encodeURIComponent(desde)}&sort=date_desc&limit=50&offset=${offset}`);
      for (const p of r?.results || []) {
        let envio = null;
        if (p?.shipping?.id) envio = await ml(conta, "GET", `/shipments/${p.shipping.id}`).catch(() => null);
        await rpc("svc_ml_importar_pedido", { p_conta: conta, p_pedido: p, p_envio: envio });
        n++;
      }
      if (!r?.results?.length || offset + 50 >= (r?.paging?.total || 0)) break;
    }
    return n;
  }

  async function executar(t) {
    if (t.tipo === "pedido") return importarPedido(t.conta_id, t.recurso);
    if (t.tipo === "envio") {
      const envio = await ml(t.conta_id, "GET", `/shipments/${t.recurso}`);
      if (envio?.order_id) return importarPedido(t.conta_id, envio.order_id);
      return null;
    }
    if (t.tipo === "anuncio") return salvarItens(t.conta_id, [t.recurso]);
    if (t.tipo === "importar_anuncios") return importarAnuncios(t.conta_id);
    if (t.tipo === "buscar_pedidos") return buscarPedidos(t.conta_id);
    return null;
  }

  async function enviarEstoque(a) {
    const corpo = a.variacao_id ? { variations: [{ id: Number(a.variacao_id), available_quantity: a.quantidade }] } : { available_quantity: a.quantidade };
    try {
      await ml(a.conta_id, "PUT", `/items/${a.item_id}`, corpo);
      await rpc("svc_ml_estoque_resultado", { p_anuncio: a.anuncio_id, p_qtd: a.quantidade, p_erro: null });
    } catch (e) {
      const msg = /warehouse|multi.?origin|selling_address|user.?product/i.test(e.message)
        ? "Conta com estoque por depósito (multiorigem): atualize o estoque pelo Mercado Livre" : e.message;
      await rpc("svc_ml_estoque_resultado", { p_anuncio: a.anuncio_id, p_qtd: a.quantidade, p_erro: msg.slice(0, 300) });
    }
  }

  async function enviarRastreio(r) {
    try {
      if (r.envio_modo === "me1") {
        await ml(r.conta_id, "POST", `/shipments/${r.envio_id}/seller_notifications`, {
          payload: { service_id: SERVICE_ID_ME1_BR, comment: `Despachado${r.transportadora ? " via " + r.transportadora : ""}`, date: new Date().toISOString() },
          tracking_number: r.codigo, status: "shipped", substatus: null,
        });
      } else {
        const envio = await ml(r.conta_id, "GET", `/shipments/${r.envio_id}`);
        await ml(r.conta_id, "PUT", `/shipments/${r.envio_id}`, { tracking_number: r.codigo, status: "shipped", receiver_id: envio?.receiver_id });
      }
      await rpc("svc_ml_rastreio_resultado", { p_mkt_pedido: r.mkt_pedido_id, p_codigo: r.codigo, p_erro: null });
    } catch (e) {
      await rpc("svc_ml_rastreio_resultado", { p_mkt_pedido: r.mkt_pedido_id, p_codigo: r.codigo, p_erro: e.message.slice(0, 300) });
    }
  }

  let atual = null, ultimaLimpeza = 0;
  // um ciclo por vez; quem chama durante um ciclo espera o que está em andamento
  function ciclo() {
    if (!atual) atual = rodarCiclo().finally(() => { atual = null; });
    return atual;
  }
  async function rodarCiclo() {
    try {
      for (const c of (await rpc("svc_ml_contas_renovar")) || []) await renovar(c.conta_id, c.refresh).catch(() => {});
      for (const t of (await rpc("svc_ml_tarefas", { p_limite: 20 })) || []) {
        try { await executar(t); await rpc("svc_ml_tarefa_fim", { p_id: t.id, p_erro: null }); }
        catch (e) {
          await rpc("svc_ml_tarefa_fim", { p_id: t.id, p_erro: e.message.slice(0, 400) }).catch(() => {});
          if (e.status === 429) { await espera(30000); break; } // limite de chamadas do ML: espera
        }
      }
      for (const a of (await rpc("svc_ml_estoques_pendentes", { p_limite: 20 })) || []) await enviarEstoque(a);
      for (const r of (await rpc("svc_ml_rastreios_pendentes", { p_limite: 10 })) || []) await enviarRastreio(r);
      if (Date.now() - ultimaLimpeza > 6 * 3600000) { ultimaLimpeza = Date.now(); await rpc("svc_ml_limpeza").catch(() => {}); }
    } catch (e) {
      log("erro", `ciclo: ${e.message}`);
    }
  }

  // ---------- HTTP ----------
  const porIp = new Map();
  const limitar = (ip) => { const m = Math.floor(Date.now() / 60000); const k = `${ip}:${m}`; const n = (porIp.get(k) || 0) + 1; porIp.set(k, n); if (porIp.size > 5000) porIp.clear(); return n > 600; };
  const voltar = (res, q) => { res.writeHead(302, { Location: `${cfg.painelUrl}/integracoes/marketplaces/?${q}`, "Cache-Control": "no-store" }); res.end(); };

  // 1º passo: prende o estado a este navegador e segue para a autorização oficial do Mercado Livre
  function iniciar(url, res) {
    const estado = url.searchParams.get("estado") || "";
    if (!/^[0-9a-f]{48}$/.test(estado)) return voltar(res, "erro=invalido");
    const destino = "https://auth.mercadolivre.com.br/authorization?" + new URLSearchParams({ response_type: "code", client_id: cfg.mlClientId, redirect_uri: cfg.mlRedirectUri, state: estado }).toString();
    res.writeHead(302, { Location: destino, "Cache-Control": "no-store",
      "Set-Cookie": `mrv3d_ml=${estado}; Path=/integra/ml; Max-Age=900; HttpOnly; Secure; SameSite=Lax` });
    res.end();
  }
  const cookie = (req, nome) => (String(req.headers.cookie || "").split(/; */).find((c) => c.startsWith(nome + "=")) || "").slice(nome.length + 1);

  async function callback(url, req, res) {
    const code = url.searchParams.get("code") || "", estado = url.searchParams.get("state") || "";
    if (url.searchParams.get("error")) return voltar(res, "erro=negado");
    if (!/^[A-Za-z0-9_-]{5,300}$/.test(code) || !/^[0-9a-f]{48}$/.test(estado)) return voltar(res, "erro=invalido");
    // o retorno tem que chegar ao mesmo navegador que iniciou a conexão
    if (cookie(req, "mrv3d_ml") !== estado) return voltar(res, "erro=sessao");
    const est = await rpc("svc_ml_consumir_estado", { p_estado: estado });
    if (!est?.empresa_id) return voltar(res, "erro=expirado");
    try {
      const d = await oauth({ grant_type: "authorization_code", code, redirect_uri: cfg.mlRedirectUri });
      let apelido = null;
      try {
        const u = await fetchF(`${ML_API}/users/me`, { headers: { Authorization: `Bearer ${d.access_token}` }, signal: AbortSignal.timeout(15000) }).then((r) => r.json());
        apelido = u?.nickname || null;
      } catch { /* sem apelido */ }
      await rpc("svc_ml_salvar_conta", { p_empresa: est.empresa_id, p_user: est.user_id || null, p_ml_user: Number(d.user_id), p_apelido: apelido,
        p_access: d.access_token, p_refresh: d.refresh_token, p_expira_s: d.expires_in || 21600 });
      setTimeout(ciclo, 500);
      return voltar(res, "conectado=1");
    } catch (e) {
      log("erro", `callback: ${e.message}`);
      return voltar(res, /conta_em_outra_empresa/.test(e.message) ? "erro=outra_empresa" : "erro=falha");
    }
  }

  function lerCorpo(req, max) {
    return new Promise((ok, falha) => {
      let n = 0; const partes = [];
      req.on("data", (c) => { n += c.length; if (n > max) { falha(new Error("grande")); req.destroy(); } else partes.push(c); });
      req.on("end", () => ok(Buffer.concat(partes).toString("utf8")));
      req.on("error", falha);
    });
  }

  async function notificacao(req, res) {
    let corpo;
    try { corpo = JSON.parse(await lerCorpo(req, 16384)); } catch { res.writeHead(400).end(); return; }
    // responde logo (o ML reenvia se demorar); o conteúdo só serve para saber o que buscar na API
    res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
    if (String(corpo?.application_id) !== String(cfg.mlClientId)) return;
    if (!TOPICOS.has(corpo?.topic) || !/^[0-9]{1,20}$/.test(String(corpo?.user_id)) || typeof corpo?.resource !== "string") return;
    try { if (await rpc("svc_ml_enfileirar", { p_ml_user: Number(corpo.user_id), p_topico: corpo.topic, p_recurso: corpo.resource.slice(0, 120) })) setTimeout(ciclo, 1000); }
    catch (e) { log("erro", `notificação: ${e.message}`); }
  }

  const servidor = http.createServer(async (req, res) => {
    const ip = String(req.headers["x-real-ip"] || req.socket.remoteAddress || "");
    if (limitar(ip)) { res.writeHead(429).end(); return; }
    let url;
    try { url = new URL(req.url || "/", "http://local"); } catch { res.writeHead(400).end(); return; }
    try {
      if (req.method === "GET" && url.pathname === "/integra/saude") { res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, mercado_livre: !!cfg.mlClientId })); return; }
      if (req.method === "GET" && url.pathname === "/integra/ml/iniciar") return iniciar(url, res);
      if (req.method === "GET" && url.pathname === "/integra/ml/callback") return await callback(url, req, res);
      if (req.method === "POST" && url.pathname === "/integra/ml/notificacoes") return await notificacao(req, res);
      res.writeHead(404).end();
    } catch (e) {
      log("erro", `${url.pathname}: ${e.message}`);
      if (!res.headersSent) res.writeHead(500).end();
    }
  });

  return { servidor, ciclo, linhasDoItem, _interno: { importarPedido, enviarEstoque, enviarRastreio, renovar } };
}

function lerConfig() {
  const e = process.env;
  const cfg = { supabaseUrl: e.SUPABASE_URL, serviceKey: e.SERVICE_ROLE_KEY, mlClientId: e.ML_CLIENT_ID, mlClientSecret: e.ML_CLIENT_SECRET,
    mlRedirectUri: e.ML_REDIRECT_URI, painelUrl: (e.PAINEL_URL || "").replace(/\/$/, ""), porta: Number(e.PORTA || 8790) };
  const faltando = Object.entries({ SUPABASE_URL: cfg.supabaseUrl, SERVICE_ROLE_KEY: cfg.serviceKey, ML_CLIENT_ID: cfg.mlClientId, ML_CLIENT_SECRET: cfg.mlClientSecret, ML_REDIRECT_URI: cfg.mlRedirectUri, PAINEL_URL: cfg.painelUrl })
    .filter(([, v]) => !v).map(([k]) => k);
  if (faltando.length) { console.error(`Faltando no ambiente: ${faltando.join(", ")}`); process.exit(1); }
  if (!/^[0-9]{5,25}$/.test(cfg.mlClientId)) { console.error("ML_CLIENT_ID inválido"); process.exit(1); }
  return cfg;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const cfg = lerConfig();
  const s = criarServico(cfg);
  s.servidor.listen(cfg.porta, "127.0.0.1", () => console.log(`integrações ouvindo em 127.0.0.1:${cfg.porta}`));
  setInterval(s.ciclo, 15000);
  setTimeout(s.ciclo, 3000);
  process.on("SIGTERM", () => { s.servidor.close(); process.exit(0); });
}
