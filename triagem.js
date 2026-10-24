/* triagem.js — ranqueia terapeutas para um paciente (JS puro, navegador e Node)
 *
 * Usa os campos reais da tabela `terapeutas`:
 *   nome, nivel ("1"|"2"|"3"), bio, experiencia (anos, texto), bloqueado,
 *   categorias (JSON em texto), subcategorias (JSON em texto), especialidades (jsonb, legado)
 *
 * Uso:
 *   const r = Triagem.rankTherapists(ficha, listaDeTerapeutas);
 *   r.gravidade.nivel  -> 'normal' | 'grave' | 'critico'
 *   r.ranking          -> [{ terapeuta, score, motivos }, ...] (melhor primeiro)
 *   r.avisos           -> mensagens para a equipe (ex.: nenhum nível 3 disponível)
 *
 * ficha = { queixa, motivacao, expectativas, historico, outroConflito,
 *           sintomas: [..], conflitos: [..], categoria: 'Atendimento de mulheres' (opcional) }
 */

// Tema -> radicais que aparecem na fala do paciente e nos textos do terapeuta
const TEMAS = {
  ansiedade:  ['ansied', 'panico', 'nervos', 'preocupa', 'angusti'],
  depressao:  ['depress', 'tristez', 'desanimo', 'vazio'],
  luto:       ['luto', 'perda', 'faleceu', 'morte', 'falecimento'],
  trauma:     ['trauma', 'flashback'],
  relacionamento: ['relacionament', 'casament', 'separac', 'divorc', 'ciume', 'traicao', 'conjug', 'conflito'],
  autoestima: ['autoestima', 'inseguranc', 'autoconfianca'],
  dependencia: ['dependenc', 'vicio', 'alcool', 'drogas', 'pornografia'],
  familia:    ['familia', 'filhos', 'maternidade', 'paternidade'],
  identidade: ['identidade', 'proposito', 'autoconhecimento'],
  infantil:   ['crianca', 'infantil', 'escola', 'birra', 'tdah', 'autismo'],
};

// Só procurados no TEXTO LIVRE escrito pelo paciente (não nos checkboxes,
// senão "Agressividade" marcado em ficha infantil viraria caso grave).
const GRAVES = {
  grave: ['abuso', 'abusad', 'estupr', 'violencia sexual', 'violentad', 'assedio', 'molest',
          'incesto', 'violencia domestica', 'agressao', 'agredid', 'espanc', 'maus-tratos', 'maus tratos'],
  critico: ['suicid', 'me matar', 'tirar minha vida', 'acabar com tudo', 'automutil', 'me cortar',
            'nao quero viver', 'quero morrer'],
};

// Radicais que, nas áreas/bio do terapeuta, indicam preparo para casos graves
const ESPECIALISTA_GRAVE = { abus: 15, violenc: 12, estupr: 12, trauma: 8 };

const PESOS = {
  tema_sub: 5,
  tema_bio: 3,
  nivel: 1,              // bônus leve por nível em qualquer caso
  exp_max_anos: 10,      // experiência conta até 10 anos
  exp_normal: 0.2,       // por ano, caso normal
  exp_grave: 1,          // por ano, caso grave
  nivel3_grave: 40,
  nivel2_grave: 10,
  categoria: 4,
};

// ---------- utilitários ----------
const norm = (s) => String(s == null ? '' : s)
  .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');

const esc = (r) => r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// casa o radical no INÍCIO de uma palavra
const tem = (texto, radical) => new RegExp('(^|[^a-z])' + esc(radical)).test(texto);

function paraLista(v) {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string' && v.trim()) {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p.map(String) : [v]; }
    catch { return [v]; }
  }
  return [];   // null, {} etc.
}

// Normaliza uma linha da tabela `terapeutas`
function prepararTerapeuta(t) {
  const subs = paraLista(t.subcategorias);
  const esp = paraLista(t.especialidades);
  const cats = paraLista(t.categorias);
  const bio = String(t.bio || '');
  const exp = Math.min(parseFloat(String(t.experiencia || '').replace(',', '.')) || 0, PESOS.exp_max_anos);
  return {
    bruto: t,
    nivel: parseInt(t.nivel, 10) || 1,
    exp,
    bio: norm(bio),
    areas: norm([...subs, ...esp].join(' | ')),
    cats: cats.map(norm),
    // perfil mínimo: evita priorizar contas vazias/de teste só por serem nível 3
    perfilCompleto: bio.trim().length >= 50 || subs.length + esp.length >= 2,
    bloqueado: t.bloqueado === true,
  };
}

function textos(ficha) {
  const livre = norm([ficha.queixa, ficha.motivacao, ficha.expectativas, ficha.historico, ficha.outroConflito].join(' '));
  const tudo = norm([livre, ...(ficha.sintomas || []), ...(ficha.conflitos || [])].join(' '));
  return { livre, tudo };
}

function detectarGravidade(textoLivre) {
  const crit = GRAVES.critico.filter((p) => tem(textoLivre, p));
  const grave = GRAVES.grave.filter((p) => tem(textoLivre, p));
  return { nivel: crit.length ? 'critico' : grave.length ? 'grave' : 'normal', termos: [...crit, ...grave] };
}

const detectarTemas = (texto) =>
  Object.entries(TEMAS).filter(([, rs]) => rs.some((r) => tem(texto, r))).map(([t]) => t);

// ---------- ranking ----------
function rankTherapists(ficha, terapeutas) {
  const { livre, tudo } = textos(ficha);
  const gravidade = detectarGravidade(livre);
  const temas = detectarTemas(tudo);
  const grave = gravidade.nivel !== 'normal';
  const avisos = [];

  const elegiveis = terapeutas.map(prepararTerapeuta).filter((p) => !p.bloqueado);

  if (grave && !elegiveis.some((p) => p.nivel >= 3 && p.perfilCompleto)) {
    avisos.push('Caso grave, mas não há terapeuta nível 3 com perfil completo disponível: priorizado nível 2 com especialidade em abuso/trauma.');
  }
  if (gravidade.nivel === 'critico') {
    avisos.push('Risco crítico (ideação suicida/automutilação): avisar a equipe imediatamente e exibir o CVV (188) ao paciente.');
  }

  const ranking = elegiveis.map((p) => {
    let score = 0;
    const motivos = [];

    for (const tema of temas) {
      const rs = TEMAS[tema];
      if (rs.some((r) => tem(p.areas, r))) { score += PESOS.tema_sub; motivos.push(`área: ${tema}`); }
      if (rs.some((r) => tem(p.bio, r)))   { score += PESOS.tema_bio; motivos.push(`bio: ${tema}`); }
    }

    if (ficha.categoria && p.cats.includes(norm(ficha.categoria))) {
      score += PESOS.categoria; motivos.push('categoria compatível');
    }

    score += p.nivel * PESOS.nivel;
    score += p.exp * (grave ? PESOS.exp_grave : PESOS.exp_normal);

    if (grave) {
      for (const [radical, peso] of Object.entries(ESPECIALISTA_GRAVE)) {
        if (tem(p.areas, radical) || tem(p.bio, radical)) { score += peso; motivos.push(`preparo p/ caso grave: ${radical}`); break; }
      }
      if (p.perfilCompleto) {
        if (p.nivel >= 3) { score += PESOS.nivel3_grave; motivos.push('nível 3 (caso grave)'); }
        else if (p.nivel === 2) score += PESOS.nivel2_grave;
      }
    }

    if (!p.perfilCompleto) { score -= 5; motivos.push('perfil incompleto'); }
    return { terapeuta: p.bruto, score: Math.round(score * 10) / 10, motivos };
  });

  ranking.sort((a, b) => b.score - a.score);
  return { gravidade, temas, avisos, ranking };
}

if (typeof module !== 'undefined') module.exports = { rankTherapists, detectarGravidade, detectarTemas, prepararTerapeuta };
if (typeof window !== 'undefined') window.Triagem = { rankTherapists, detectarGravidade, detectarTemas, prepararTerapeuta };
