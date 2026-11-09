// Teste do serviço de integrações contra o banco local de testes (rodar depois de db/teste/rodar.sh).
// O Mercado Livre é SIMULADO (respostas fixas); o banco é o real (psql como service_role).
//   node deploy/integra/teste.mjs
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { criarServico } from "./servidor.mjs";

const TIPOS = { p_conta: "uuid", p_pedido: "jsonb", p_envio: "jsonb", p_itens: "jsonb", p_limite: "int", p_id: "bigint", p_erro: "text", p_anuncio: "uuid",
  p_qtd: "int", p_mkt_pedido: "uuid", p_codigo: "text", p_estado: "text", p_empresa: "uuid", p_user: "uuid", p_ml_user: "bigint", p_apelido: "text",
  p_access: "text", p_refresh: "text", p_expira_s: "int", p_topico: "text", p_recurso: "text", p_msg: "text", p_perdeu_acesso: "boolean" };
const TABELA = new Set(["svc_ml_contas_renovar", "svc_ml_tarefas", "svc_ml_estoques_pendentes", "svc_ml_rastreios_pendentes"]);

function sql(texto, comoServico = false) {
  const pre = comoServico ? "set role service_role; select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false);\n" : "";
  return execFileSync("psql", ["-h", "/tmp/pg", "-p", "5499", "-U", "postgres", "-d", "t", "-tAq", "-v", "ON_ERROR_STOP=1"], { input: pre + texto, encoding: "utf8" })
    .split("\n").filter((l) => l.trim() && l.trim() !== "SET").pop();
}
const q = (v) => `$v$${v}$v$`;

async function rpc(nome, args = {}) {
  const lista = Object.entries(args).map(([k, v]) => `${k} => ${v === null || v === undefined ? "null" : q(typeof v === "object" ? JSON.stringify(v) : String(v))}::${TIPOS[k]}`).join(", ");
  const corpo = TABELA.has(nome) ? `select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.${nome}(${lista}) t;` : `select to_json(public.${nome}(${lista}));`;
  try { const out = sql(corpo, true); return out ? JSON.parse(out) : null; }
  catch (e) { throw new Error(String(e.stderr || e.message).split("\n").find((l) => l.includes("ERROR")) || e.message); }
}

// ---------- Mercado Livre simulado ----------
const chamadas = [];
let estoqueAnuncio = 7;
const resposta = (status, corpo) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
const PEDIDO = { id: 9100001, status: "paid", date_created: new Date().toISOString(), seller: { id: 555077 }, pack_id: null,
  buyer: { id: 8801, nickname: "CLIENTE_TESTE", first_name: "João", last_name: "Lima" }, shipping: { id: 9200001 },
  order_items: [{ item: { id: "MLB7001", title: "Luminária Lua 3D", variation_id: null }, quantity: 1, unit_price: 89.9, sale_fee: 12.5 }] };
async function fetchFalso(url, opts = {}) {
  const u = new URL(url), m = opts.method || "GET";
  chamadas.push({ m, caminho: u.pathname + u.search, corpo: opts.body });
  if (u.pathname === "/oauth/token") {
    const f = new URLSearchParams(opts.body);
    assert.equal(f.get("client_secret"), "segredo-teste");
    if (f.get("grant_type") === "authorization_code") {
      assert.equal(f.get("redirect_uri"), "https://mrv3dsolutions.tech/integra/ml/callback");
      return resposta(200, { access_token: "APP_USR-novo-acesso-123", refresh_token: "TG-novo-refresh-123", expires_in: 21600, user_id: 555077 });
    }
    return resposta(200, { access_token: "APP_USR-renovado-456", refresh_token: "TG-renovado-456", expires_in: 21600 });
  }
  const auth = opts.headers?.Authorization || "";
  if (!auth.startsWith("Bearer APP_USR-")) return resposta(401, { message: "invalid_token" });
  if (u.pathname === "/users/me") return resposta(200, { id: 555077, nickname: "LOJA_TESTE" });
  if (u.pathname === "/users/555077/items/search") return resposta(200, { results: ["MLB7001"], paging: { total: 1 } });
  if (u.pathname === "/items" && u.searchParams.get("ids")) return resposta(200, [{ code: 200, body: { id: "MLB7001", title: "Luminária Lua 3D", status: "active", price: 89.9,
    available_quantity: estoqueAnuncio, permalink: "https://produto.mercadolivre.com.br/MLB-7001", seller_custom_field: "LUA-01", shipping: { logistic_type: "default" } } }]);
  if (u.pathname === "/items/MLB7001" && m === "PUT") { estoqueAnuncio = JSON.parse(opts.body).available_quantity; return resposta(200, { id: "MLB7001" }); }
  if (u.pathname === "/orders/search") return resposta(200, { results: [], paging: { total: 0 } });
  if (u.pathname === "/orders/9100001") return resposta(200, PEDIDO);
  if (u.pathname === "/shipments/9200001" && m === "GET") return resposta(200, { id: 9200001, mode: "me1", status: "ready_to_ship", receiver_id: 8801, order_id: 9100001,
    receiver_address: { street_name: "Av. Júlio de Castilhos", street_number: "500", zip_code: "95010000", city: { name: "Caxias do Sul" }, state: { id: "BR-RS" }, neighborhood: { name: "Centro" } } });
  if (u.pathname === "/shipments/9200001/seller_notifications" && m === "POST") return resposta(200, { ok: true });
  return resposta(404, { message: "not_found" });
}

const cfg = { supabaseUrl: "x", serviceKey: "x", mlClientId: "1234567890", mlClientSecret: "segredo-teste", mlRedirectUri: "https://mrv3dsolutions.tech/integra/ml/callback", painelUrl: "https://mrv3dsolutions.tech" };
const s = criarServico(cfg, { rpc, fetch: fetchFalso, log: (n, m) => process.env.DEBUG && console.log(n, m), espera: async () => {} });
await new Promise((ok) => s.servidor.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${s.servidor.address().port}`;
const real = globalThis.fetch;

try {
  // preparo: aplicativo ativo, produto com estoque na Loja A
  sql(`update public.configuracao_plataforma set ml_app_id = '1234567890', ml_redirect_uri = 'https://mrv3dsolutions.tech/integra/ml/callback';
       set role authenticated; select set_config('request.jwt.claims', '{"role":"authenticated"}', false); set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
       insert into public.produtos(empresa_id, nome, codigo, controla_estoque, preco_venda) select id, 'Luminária Lua', 'LUA-01', true, 89.9 from public.empresas where nome = 'Loja A';
       select public.movimentar_produto((select id from public.produtos where codigo = 'LUA-01'), null, 'entrada', 4, null);`);

  // 1) conexão: a loja gera o link, o ML devolve no callback
  const url = sql(`set role authenticated; select set_config('request.jwt.claims', '{"role":"authenticated"}', false); set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
    select public.ml_iniciar_conexao((select id from public.empresas where nome = 'Loja A'))->>'url';`);
  assert.match(url, /^https:\/\/mrv3dsolutions\.tech\/integra\/ml\/iniciar\?estado=[0-9a-f]{48}$/);
  const estado = new URL(url).searchParams.get("estado");
  let r = await real(`${base}/integra/ml/iniciar?estado=${estado}`, { redirect: "manual" });
  const ida = new URL(r.headers.get("location"));
  assert.equal(ida.origin + ida.pathname, "https://auth.mercadolivre.com.br/authorization");
  assert.equal(ida.searchParams.get("client_id"), "1234567890"); assert.equal(ida.searchParams.get("state"), estado);
  assert.ok(!r.headers.get("location").includes("segredo"), "a chave secreta não vai na URL");
  const biscoito = r.headers.get("set-cookie").split(";")[0];
  assert.match(r.headers.get("set-cookie"), /HttpOnly; Secure; SameSite=Lax/);
  // retorno sem o cookie (link de autorização enviado por outra pessoa) é recusado
  r = await real(`${base}/integra/ml/callback?code=TG-codigo-abc&state=${estado}`, { redirect: "manual" });
  assert.match(r.headers.get("location"), /erro=sessao/);
  r = await real(`${base}/integra/ml/callback?code=TG-codigo-abc&state=${estado}`, { redirect: "manual", headers: { Cookie: biscoito } });
  assert.equal(r.status, 302); assert.match(r.headers.get("location"), /conectado=1/);
  r = await real(`${base}/integra/ml/callback?code=TG-codigo-abc&state=${estado}`, { redirect: "manual", headers: { Cookie: biscoito } });
  assert.match(r.headers.get("location"), /erro=expirado/, "estado não pode ser reutilizado");
  r = await real(`${base}/integra/ml/callback?code=x';drop&state=zz`, { redirect: "manual" });
  assert.match(r.headers.get("location"), /erro=invalido/);
  const conta = sql(`select id from public.marketplace_contas where conta_externa_id = 555077 and status = 'conectada'`);
  assert.ok(conta, "conta conectada");
  console.log("ok conexão OAuth (estado de uso único, preso ao navegador, parâmetros validados)");

  // 2) ciclo: importa anúncios (vínculo pelo SKU) e envia o estoque do sistema
  await s.ciclo();
  assert.equal(sql(`select produto_id is not null from public.marketplace_anuncios where item_id = 'MLB7001'`), "t");
  sql(`set role authenticated; select set_config('request.jwt.claims', '{"role":"authenticated"}', false); set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
       select public.marketplace_vincular_anuncio((select id from public.marketplace_anuncios where item_id = 'MLB7001'), (select id from public.produtos where codigo = 'LUA-01'), null, true);`);
  await s.ciclo();
  assert.equal(estoqueAnuncio, 4, "estoque do anúncio = estoque do sistema");
  console.log("ok anúncios importados, vínculo por SKU e estoque enviado");

  // 3) aviso do ML: pedido novo → importado pela API oficial
  r = await real(`${base}/integra/ml/notificacoes`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resource: "/orders/9100001", user_id: 555077, topic: "orders_v2", application_id: 999 }) });
  assert.equal(r.status, 200);
  assert.equal(sql(`select count(*) from private.marketplace_fila where recurso = '9100001'`), "0", "aviso de outro aplicativo ignorado");
  r = await real(`${base}/integra/ml/notificacoes`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resource: "/orders/9100001", user_id: 555077, topic: "orders_v2", application_id: 1234567890, attempts: 1 }) });
  assert.equal(r.status, 200);
  await s.ciclo();
  assert.equal(sql(`select p.valor_total || '|' || p.valor_pago || '|' || c.cidade from public.marketplace_pedidos mp join public.pedidos p on p.id = mp.pedido_id join public.clientes c on c.id = p.cliente_id where mp.pedido_externo_id = 9100001`),
    "89.9|89.90|Caxias do Sul");
  assert.equal(sql(`select estoque_qtd::int from public.produtos where codigo = 'LUA-01'`), "3");
  await s.ciclo();
  assert.equal(estoqueAnuncio, 3, "estoque novo enviado ao ML depois da venda");
  console.log("ok venda importada (cliente, pagamento, baixa de estoque) e estoque reenviado");

  // 4) rastreio: expedição do sistema com código → informado ao ML (ME1)
  sql(`select set_config('app.ped_interno', '1', false); update public.pedidos set status_producao = 'nao_aplica' where id = (select pedido_id from public.marketplace_pedidos where pedido_externo_id = 9100001);
       select set_config('app.ped_interno', '0', false);
       set role authenticated; select set_config('request.jwt.claims', '{"role":"authenticated"}', false); set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
       select public.criar_envio((select pedido_id from public.marketplace_pedidos where pedido_externo_id = 9100001), 'correios');
       reset role; select set_config('app.envio_interno', '1', false);
       update public.envios set codigo_rastreio = 'QB000111222BR', status = 'enviado' where pedido_id = (select pedido_id from public.marketplace_pedidos where pedido_externo_id = 9100001);`);
  await s.ciclo();
  const env = chamadas.find((c) => c.caminho === "/shipments/9200001/seller_notifications");
  assert.ok(env, "rastreio enviado");
  const corpo = JSON.parse(env.corpo);
  assert.equal(corpo.tracking_number, "QB000111222BR"); assert.equal(corpo.payload.service_id, 11); assert.equal(corpo.status, "shipped");
  assert.equal(sql(`select rastreio_enviado from public.marketplace_pedidos where pedido_externo_id = 9100001`), "QB000111222BR");
  console.log("ok rastreio do sistema informado ao Mercado Livre (ME1)");

  // 5) acesso vencido → renovação com a chave secreta
  sql(`update private.marketplace_tokens set expira_em = now() where conta_id = '${conta}'`);
  await s.ciclo();
  assert.ok(chamadas.some((c) => c.caminho === "/oauth/token" && new URLSearchParams(c.corpo).get("grant_type") === "refresh_token"));
  assert.equal(sql(`select public.svc_ml_token('${conta}')->>'access'`, true), "APP_USR-renovado-456");
  console.log("ok acesso renovado antes de vencer");

  // 6) nenhum segredo nas respostas do servidor
  r = await real(`${base}/integra/saude`); const saude = await r.text();
  assert.ok(!saude.includes("segredo") && !saude.includes("APP_USR"));
  console.log("SERVIÇO DE INTEGRAÇÕES OK (Mercado Livre simulado)");
} finally {
  s.servidor.close();
}
