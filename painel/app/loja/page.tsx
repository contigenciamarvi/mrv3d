"use client";
import { useEffect, useState } from "react";
import { Upload, MessageCircle, Send, X, Package } from "lucide-react";
import { sb, rpc } from "@/lib/supabase";
import { brl, erroMsg, linkWhats, numOuNull } from "@/lib/utils";
import { Button, Field, Input, Select, Textarea, Loading, ErrorBox, Aviso } from "@/components/ui";

type Loja = { empresa_id: string; nome: string; cidade: string | null; uf: string | null; whatsapp: string | null; titulo: string; descricao: string | null; prazo_texto: string | null;
  aceitar_arquivos: boolean; mostrar_precos: boolean; mensagem_sucesso: string | null; logo_path: string | null; cores: string[];
  materiais: { id: string; nome: string; cor: string | null; material: string | null }[];
  produtos: { id: string; nome: string; descricao: string | null; categoria: string | null; cor: string | null; preco: number | null; foto_path: string | null; personalizavel: boolean; pronta_entrega: boolean }[] };
const EXT = ["stl", "3mf", "obj", "step", "stp"];
const MAX = 50 * 1048576;

/** Página pública da loja (portal do comprador): /loja/?s=endereco */
export default function LojaPublica() {
  const [slug, setSlug] = useState<string | null>(null);
  const [l, setL] = useState<Loja | null>(null);
  const [fotos, setFotos] = useState<Record<string, string>>({});
  const [falha, setFalha] = useState("");
  const [f, setF] = useState({ produto: "", material: "", cor: "", quantidade: "1", observacoes: "", nome: "", email: "", telefone: "", cidade: "" });
  const [arqs, setArqs] = useState<File[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erroForm, setErroForm] = useState("");

  useEffect(() => {
    const s = new URLSearchParams(location.search).get("s");
    setSlug(s);
    if (!s) { setFalha("Endereço da loja incompleto"); return; }
    rpc<Loja>("portal_publico", { p_slug: s }).then(async (d) => {
      setL(d); document.title = d.titulo;
      const paths = [d.logo_path, ...d.produtos.map((p) => p.foto_path)].filter(Boolean) as string[];
      if (paths.length) {
        const { data } = await sb().storage.from("empresa").createSignedUrls(paths, 3600);
        setFotos(Object.fromEntries((data || []).filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl])));
      }
    }).catch((e) => setFalha(erroMsg(e)));
  }, []);

  const escolherArquivos = (lista: FileList | null) => {
    if (!lista) return;
    const novos = Array.from(lista).filter((a) => {
      const ext = a.name.split(".").pop()?.toLowerCase() || "";
      if (!EXT.includes(ext)) { setErroForm(`"${a.name}": envie STL, 3MF, OBJ ou STEP`); return false; }
      if (a.size > MAX) { setErroForm(`"${a.name}" passa de 50 MB`); return false; }
      return true;
    });
    setArqs((x) => [...x, ...novos].slice(0, 5));
  };

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault(); if (!l || !slug) return; setErroForm(""); setEnviando(true);
    try {
      const pasta = crypto.randomUUID();
      const paths: string[] = [];
      for (const a of arqs) {
        const nome = a.name.normalize("NFD").replace(/[^\w.\-]+/g, "_").slice(-100);
        const path = `${l.empresa_id}/portal/${pasta}/${nome}`;
        const { error } = await sb().storage.from("empresa").upload(path, a, { upsert: false, contentType: "application/octet-stream" });
        if (error) throw new Error(/row-level|policy|security/i.test(error.message) ? "A loja não conseguiu receber o arquivo agora (limite atingido). Tente mais tarde ou fale pelo WhatsApp." : error.message);
        paths.push(path);
      }
      const token = await rpc<string>("portal_solicitar", { p_slug: slug, p_dados: { produto_id: f.produto || null, material_id: f.material || null, cor: f.cor || null,
        quantidade: numOuNull(f.quantidade) || 1, observacoes: f.observacoes, nome: f.nome, email: f.email, telefone: f.telefone, cidade: f.cidade, arquivos: paths } });
      location.href = `/acompanhar/?t=${token}&novo=1`;
    } catch (e2) { setErroForm(erroMsg(e2)); setEnviando(false); }
  };

  if (falha) return <div className="mx-auto max-w-lg p-6"><ErrorBox erro={falha} /></div>;
  if (!l) return <Loading />;
  const whats = linkWhats(l.whatsapp, `Olá! Vim pela loja online da ${l.nome}.`);
  const produto = l.produtos.find((p) => p.id === f.produto);
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-5">
          {l.logo_path && fotos[l.logo_path] && <img src={fotos[l.logo_path]} alt="" className="h-14 w-14 rounded-lg object-contain" />}
          <div className="flex-1"><h1 className="text-xl font-semibold">{l.titulo}</h1>{(l.cidade || l.uf) && <p className="text-sm text-slate-500">{[l.cidade, l.uf].filter(Boolean).join(" / ")}</p>}</div>
          {whats && <a href={whats} target="_blank" rel="noreferrer"><Button variant="secondary"><MessageCircle className="h-4 w-4" /> WhatsApp</Button></a>}
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-8 px-4 py-8">
        {(l.descricao || l.prazo_texto) && <section className="space-y-2">{l.descricao && <p className="whitespace-pre-line text-slate-700">{l.descricao}</p>}{l.prazo_texto && <p className="text-sm font-medium text-brand-700">{l.prazo_texto}</p>}</section>}

        {l.produtos.length > 0 && <section>
          <h2 className="mb-3 text-lg font-semibold">Produtos</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">{l.produtos.map((p) => (
            <div key={p.id} className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex aspect-square items-center justify-center bg-slate-100">{p.foto_path && fotos[p.foto_path] ? <img src={fotos[p.foto_path]} alt={p.nome} className="h-full w-full object-cover" /> : <Package className="h-10 w-10 text-slate-300" />}</div>
              <div className="flex flex-1 flex-col p-3">
                <div className="font-medium">{p.nome}</div>
                {p.descricao && <p className="mt-1 line-clamp-3 text-xs text-slate-500">{p.descricao}</p>}
                <div className="mt-auto flex items-center justify-between pt-2">
                  <span className="text-sm font-semibold">{p.preco != null && p.preco > 0 ? brl(p.preco) : ""}</span>
                  {p.pronta_entrega && <span className="text-xs text-emerald-700">Pronta entrega</span>}
                </div>
                <Button size="sm" variant="secondary" className="mt-2" onClick={() => { setF({ ...f, produto: p.id, cor: p.cor || f.cor }); document.getElementById("pedido")?.scrollIntoView({ behavior: "smooth" }); }}>Quero este</Button>
              </div>
            </div>))}</div>
        </section>}

        <section id="pedido" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Pedir orçamento</h2>
          <p className="mb-4 text-sm text-slate-500">{l.aceitar_arquivos ? "Escolha um produto ou envie seu arquivo 3D. " : "Escolha um produto ou descreva o que precisa. "}A loja responde com a proposta e você acompanha tudo por um link.</p>
          <form onSubmit={enviar} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Produto"><Select value={f.produto} onChange={(e) => setF({ ...f, produto: e.target.value })}><option value="">{l.aceitar_arquivos ? "Peça personalizada (meu arquivo / descrição)" : "Peça personalizada (descrever abaixo)"}</option>
                {l.produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}{p.preco ? ` · ${brl(p.preco)}` : ""}</option>)}</Select></Field>
              <Field label="Quantidade"><Input required inputMode="numeric" value={f.quantidade} onChange={(e) => setF({ ...f, quantidade: e.target.value })} /></Field>
              {l.materiais.length > 0 && <Field label="Material"><Select value={f.material} onChange={(e) => setF({ ...f, material: e.target.value })}><option value="">Deixo a loja sugerir</option>
                {l.materiais.map((m) => <option key={m.id} value={m.id}>{m.nome}{m.cor ? ` · ${m.cor}` : ""}</option>)}</Select></Field>}
              <Field label="Cor">{l.cores.length ? <Select value={f.cor} onChange={(e) => setF({ ...f, cor: e.target.value })}><option value="">Tanto faz</option>{l.cores.map((c) => <option key={c}>{c}</option>)}{produto?.cor && !l.cores.includes(produto.cor) && <option>{produto.cor}</option>}</Select>
                : <Input value={f.cor} onChange={(e) => setF({ ...f, cor: e.target.value })} />}</Field>
            </div>
            {l.aceitar_arquivos && !f.produto && <div>
              <label className="flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 hover:bg-slate-50"
                onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); escolherArquivos(e.dataTransfer.files); }}>
                <Upload className="h-6 w-6" /> <span><b className="text-brand-700">Clique</b> ou arraste seus arquivos</span><span className="text-xs">STL, 3MF, OBJ ou STEP · até 5 arquivos de 50 MB</span>
                <input type="file" multiple accept=".stl,.3mf,.obj,.step,.stp" className="hidden" onChange={(e) => { escolherArquivos(e.target.files); e.target.value = ""; }} />
              </label>
              {arqs.length > 0 && <ul className="mt-2 space-y-1 text-sm">{arqs.map((a, i) => <li key={i} className="flex items-center justify-between rounded bg-slate-50 px-2 py-1">
                <span className="truncate">{a.name} <span className="text-xs text-slate-500">({(a.size / 1048576).toFixed(1)} MB)</span></span>
                <button type="button" aria-label="Remover" onClick={() => setArqs(arqs.filter((_, k) => k !== i))}><X className="h-4 w-4 text-slate-400" /></button></li>)}</ul>}
            </div>}
            <Field label="Observações" hint={f.produto ? "Personalização, nome, tamanho…" : "Medidas, uso da peça, acabamento, prazo desejado…"}><Textarea value={f.observacoes} onChange={(e) => setF({ ...f, observacoes: e.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Seu nome"><Input required autoComplete="name" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></Field>
              <Field label="WhatsApp / telefone"><Input type="tel" autoComplete="tel" value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })} /></Field>
              <Field label="E-mail"><Input type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
              <Field label="Cidade"><Input autoComplete="address-level2" value={f.cidade} onChange={(e) => setF({ ...f, cidade: e.target.value })} /></Field>
            </div>
            {erroForm && <ErrorBox erro={erroForm} />}
            <Aviso>Seus dados são usados só por {l.nome} para responder este pedido.</Aviso>
            <Button type="submit" loading={enviando} className="w-full sm:w-auto"><Send className="h-4 w-4" /> {enviando && arqs.length ? "Enviando arquivos…" : "Enviar pedido de orçamento"}</Button>
          </form>
        </section>
      </main>
      <footer className="py-6 text-center text-xs text-slate-400">Loja de {l.nome} · feito com MRV3D</footer>
    </div>
  );
}
