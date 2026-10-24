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
      const rows = await sql(`SELECT ${PUBLIC_TERAPEUTA_COLS} FROM ${t} ORDER BY ${ord} ${asc} LIMIT ${lim}`);
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
      const keys = Object.keys(data);
      const vals = Object.values(data);
      const cols = keys.map(k => `"${k}"`).join(', ');
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
      const rows = await sql(`INSERT INTO ${t} (${cols}) VALUES (${placeholders}) RETURNING *`, vals);
      return res.json({ data: rows[0], error: null });
    }
    return res.status(400).json({ error: 'Acao invalida' });
  } catch (e) {
    return res.status(500).json({ data: null, error: e.message });
  }
}

const PUBLIC_TERAPEUTA_COLS = [
  'id','nome','nomeExibicao','esp','nivel','foto','bio','experiencia','modalidade','formacao','pos',
  'especialidades','customEspecialidades','categorias','subcategorias','bloqueado',
  'disponibilidade','disp_hora_inicio','disp_hora_fim','disp_obs','corCard','corCard2','iconeAbordagem',
].map(c => `"${c}"`).join(', ');
const ALLOWED_TABLES = ['fichas_triagem', 'fichas_casal', 'terapeutas'];
function sanitizeTable(t) {
  if (!ALLOWED_TABLES.includes(t)) throw new Error('Tabela nao permitida: ' + t);
  return `public."${t}"`;
}
