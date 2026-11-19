import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch {} }
  const { action, table, data, order, limit, orderField } = body || req.query;

  try {
    if (req.method === 'GET' || action === 'select') {
      // Leitura pública só da tabela de terapeutas, e apenas colunas seguras
      // (nunca password/password_hash/username/email/crp) — nem dados de pacientes.
      if (table !== 'terapeutas') return res.status(403).json({ data: null, error: 'Leitura nao permitida' });
      const t = sanitizeTable(table);
      const lim = parseInt(limit) || 1000;
      const ord = orderField === 'nome' ? '"nome"' : '"created_at"';
      const asc = order === 'asc' ? 'ASC' : 'DESC';
      const rows = await sql(`SELECT ${await publicTerapeutaCols()} FROM ${t} ORDER BY ${ord} ${asc} LIMIT ${lim}`);
      return res.json({ data: rows, error: null });
    }
    if (action === 'therapistLoad') {
      // Retorna apenas a CONTAGEM de pacientes ativos por terapeuta.
      // Nunca expõe dados de pacientes (nome, contato, etc.) — só números.
      const rows = await sql(`
        SELECT "therapistId", SUM(cnt)::int AS cnt FROM (
          SELECT "therapistId", COUNT(*) AS cnt FROM public."fichas_triagem"
            WHERE "therapistId" IS NOT NULL AND status NOT IN ('finalizado','inativo')
            GROUP BY "therapistId"
          UNION ALL
          SELECT "therapistId", COUNT(*) AS cnt FROM public."fichas_casal"
            WHERE "therapistId" IS NOT NULL AND status NOT IN ('finalizado','inativo')
            GROUP BY "therapistId"
        ) combined
        GROUP BY "therapistId"
      `);
      return res.json({ data: rows, error: null });
    }
    if (action === 'insert') {
      const t = sanitizeTable(table);
      const insertRow = async (row) => {
        const keys = Object.keys(row);
        const cols = keys.map(k => `"${k}"`).join(', ');
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
        return sql(`INSERT INTO ${t} (${cols}) VALUES (${placeholders}) RETURNING *`, Object.values(row));
      };
      let rows;
      try {
        rows = await insertRow(data);
      } catch (e) {
        // Se a coluna "estado" ainda não existe neste banco, grava junto da cidade ("Cidade - UF")
        if (table === 'fichas_triagem' && 'estado' in data && /column "estado"/i.test(e.message)) {
          const { estado, ...resto } = data;
          resto.cidade = [data.cidade, estado].filter(Boolean).join(' - ');
          rows = await insertRow(resto);
        } else if (table === 'fichas_casal' && /column "(estado|cidade)"/i.test(e.message)) {
          // Colunas de local ainda ausentes neste banco: preserva a informação no texto da motivação
          const { estado, cidade, ...resto } = data;
          const local = [cidade, estado].filter(Boolean).join(' - ');
          if (local) resto.motivacao = (resto.motivacao || '') + '\n[Local: ' + local + ']';
          rows = await insertRow(resto);
        } else throw e;
      }
      return res.json({ data: rows[0], error: null });
    }
    return res.status(400).json({ error: 'Acao invalida' });
  } catch (e) {
    return res.status(500).json({ data: null, error: e.message });
  }
}

const PUBLIC_TERAPEUTA_COLS_LIST = [
  'id','nome','nomeExibicao','esp','nivel','foto','bio','experiencia','modalidade','formacao','pos',
  'especialidades','customEspecialidades','categorias','subcategorias','bloqueado',
  'disponibilidade','disp_hora_inicio','disp_hora_fim','disp_obs','corCard','corCard2','iconeAbordagem',
  'whatsapp', // exibido ao paciente depois que ele escolhe o terapeuta (botão "Entrar em contato")
];
// Só seleciona colunas que existem de fato (ex.: "whatsapp" só passa a existir quando
// algum terapeuta salva o perfil pela primeira vez). Evita erro 500 na lista de terapeutas.
let _colsCache = { t: 0, cols: null };
async function publicTerapeutaCols() {
  const now = Date.now();
  let cols = _colsCache.cols && now - _colsCache.t < 60000 ? _colsCache.cols : null;
  if (!cols) {
    try {
      const r = await sql(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'terapeutas'`);
      const existentes = new Set(r.map(x => x.column_name));
      cols = PUBLIC_TERAPEUTA_COLS_LIST.filter(c => existentes.has(c));
    } catch (e) { cols = null; }
    if (!cols || !cols.length) cols = PUBLIC_TERAPEUTA_COLS_LIST.filter(c => c !== 'whatsapp');
    _colsCache = { t: now, cols };
  }
  return cols.map(c => `"${c}"`).join(', ');
}
const ALLOWED_TABLES = ['fichas_triagem', 'fichas_casal', 'terapeutas'];
function sanitizeTable(t) {
  if (!ALLOWED_TABLES.includes(t)) throw new Error('Tabela nao permitida: ' + t);
  return `public."${t}"`;
}
