/* Gera o noticias.json que a página LegaNews lê.
   Roda na GitHub Action (a cada 15 min) — o navegador não consegue ler os feeds
   direto (CORS) e o rss2json passou a bloquear com checagem anti-bot.
   Uso: node scripts/gerar-noticias.mjs [arquivo-de-saida]   (padrão: noticias.json) */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import Parser from "rss-parser";

const FONTES = [
  { url: "https://portalpopline.com.br/feed/", tipo: "br" },
  { url: "https://rollingstone.uol.com.br/feed/", tipo: "br" },
  { url: "https://www.vagalume.com.br/news/index.xml", tipo: "br" },
  { url: "https://pitchfork.com/rss/news/", tipo: "int" },
  { url: "https://www.rollingstone.com/music/music-news/feed/", tipo: "int" },
  { url: "https://www.nme.com/news/music/feed", tipo: "int" }
];
const MAX_POR_FONTE = 25;
const saida = process.argv[2] || "noticias.json";

const parser = new Parser({
  customFields: {
    item: [
      ["media:content", "mediaContent", { keepArray: true }],
      ["media:thumbnail", "mediaThumbnail"],
      ["content:encoded", "contentEncoded"]
    ]
  }
});

function primeiraImagemHtml(html) {
  const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html || "");
  return m ? m[1] : "";
}

// media:content também traz vídeo (ex.: embed do YouTube no Popline) — só vale se for imagem.
function ehImagem(url, tipo, medium) {
  return medium === "image" || /^image\//i.test(tipo || "") || /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(url || "");
}

// Preferência: imagem declarada no feed > foto principal da matéria > miniatura (costuma ser de vídeo).
function thumbnail(item) {
  const mc = (item.mediaContent || []).find(m => m?.$?.url && ehImagem(m.$.url, m.$.type, m.$.medium));
  if (mc) return mc.$.url;
  if (item.enclosure?.url && ehImagem(item.enclosure.url, item.enclosure.type)) return item.enclosure.url;
  return primeiraImagemHtml(item.contentEncoded) || primeiraImagemHtml(item.content)
    || item.mediaThumbnail?.$?.url || "";
}

async function lerFonte(f) {
  const r = await fetch(f.url, {
    headers: { "User-Agent": "Mozilla/5.0 (LegaNews; +https://github.com/guischw/LegaNews)" },
    signal: AbortSignal.timeout(20000)
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const feed = await parser.parseString(await r.text());
  return feed.items.slice(0, MAX_POR_FONTE).map(i => ({
    title: i.title || "",
    description: i.contentSnippet || i.content || "",
    link: i.link || "",
    pubDate: i.isoDate || i.pubDate || "",
    thumbnail: thumbnail(i),
    _tipo: f.tipo
  }));
}

const relatorio = [];
const itens = [];
for (const f of FONTES) {
  try {
    const l = await lerFonte(f);
    itens.push(...l);
    relatorio.push({ url: f.url, tipo: f.tipo, ok: true, itens: l.length });
    console.log(`ok   ${l.length.toString().padStart(3)}  ${f.url}`);
  } catch (e) {
    relatorio.push({ url: f.url, tipo: f.tipo, ok: false, erro: String(e.message || e) });
    console.log(`ERRO      ${f.url}  ${e.message || e}`);
  }
}

// Sem nenhuma notícia, falha o job em vez de publicar um arquivo vazio:
// a página continua com a última versão boa.
if (!itens.length) {
  console.error("Nenhuma fonte respondeu — noticias.json não foi gerado.");
  process.exit(1);
}

await mkdir(dirname(saida), { recursive: true });
await writeFile(saida, JSON.stringify({ geradoEm: new Date().toISOString(), fontes: relatorio, itens }, null, 1));
console.log(`${itens.length} notícias gravadas em ${saida}`);
