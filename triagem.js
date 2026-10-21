/* triagem.js — ranqueia terapeutas para um paciente (JS puro, funciona no navegador e no Node)
 *
 * Campos esperados em cada terapeuta (ajuste em CAMPOS se o seu banco usa outros nomes):
 *   { id, nome, biografia, nivel (1-3), subcategorias: [..], categorias: [..] }
 */

const CAMPOS = { bio: 'biografia', nivel: 'nivel', subs: 'subcategorias' };

// Tema -> radicais que aparecem na fala do paciente (e na bio do terapeuta)
const TEMAS = {
  ansiedade: ['ansied', 'panico', 'nervos', 'preocupa', 'angusti'],
  depressao: ['depress', 'tristez', 'desanimo', 'vazio', 'sem vontade'],
  luto:      ['luto', 'perda', 'faleceu', 'morte', 'falecimento'],
  trauma:    ['trauma', 'pos-trauma', 'estresse pos', 'flashback'],
  relacionamento: ['relacionament', 'casament', 'separac', 'divorc', 'ciume', 'traicao', 'conjug'],
  autoestima: ['autoestima', 'inseguranc', 'autoconfianca', 'me sinto inferior'],
  dependencia: ['dependenc', 'vicio', 'alcool', 'drogas', 'pornografia', 'jogo'],
  sono:      ['insoni', 'sono', 'dormir'],
  fobias:    ['fobia', 'medo'],
  familia:   ['familia', 'filhos', 'maternidade', 'paternidade', 'luto familiar'],
  infantil:  ['crianca', 'infantil', 'escola', 'birra', 'agressiv', 'atencao', 'tdah', 'autismo'],
};

// Palavras de gravidade. "grave" -> prioriza nível 3. "critico" -> além disso, alerta urgente à equipe.
const GRAVES = {
  grave: ['abuso', 'abusad', 'estupr', 'violencia sexual', 'violentad', 'assedio',
          'violencia domestica', 'agress', 'espanca', 'incesto', 'molest', 'maus-tratos', 'maus tratos'],
  critico: ['suicid', 'me matar', 'tirar minha vida', 'acabar com tudo', 'automutil', 'me cortar',
            'nao quero viver', 'quero morrer'],
};

const PESOS = {
  tema_bio: 3,        // tema da queixa aparece na biografia
  tema_sub: 5,        // tema bate com subcategoria cadastrada pelo terapeuta
  sintoma_bio: 1,     // sintoma marcado no checkbox aparece na bio
  nivel_base: 1,      // bônus por nível (nivel * peso) — desempate normal
  nivel3_grave: 40,   // caso grave: nível 3 passa na frente
  nivel2_grave: 10,
  preferencia_genero: 2,
};

// ---------- utilitários ----------
const norm = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ');

// casa o radical no início de uma palavra (evita "sono" casar com "personalidade")
const tem = (texto, radical) => new RegExp('(^|[^a-z])' + radical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(texto);

function textoDoPaciente(ficha) {
  return norm([
    ficha.queixa, ficha.motivacao, ficha.expectativas, ficha.historico,
    ...(ficha.sintomas || []), ...(ficha.conflitos || []), ficha.outroConflito,
  ].join(' '));
}

function detectarGravidade(texto) {
  const crit = GRAVES.critico.filter((p) => tem(texto, p));
  const grave = GRAVES.grave.filter((p) => tem(texto, p));
  return {
    nivel: crit.length ? 'critico' : grave.length ? 'grave' : 'normal',
    termos: [...crit, ...grave],
  };
}

function detectarTemas(texto) {
  return Object.entries(TEMAS)
    .filter(([, radicais]) => radicais.some((r) => tem(texto, r)))
    .map(([tema]) => tema);
}

// ---------- ranking ----------
function rankTherapists(ficha, terapeutas) {
  const texto = textoDoPaciente(ficha);
  const gravidade = detectarGravidade(texto);
  const temas = detectarTemas(texto);
  const sintomas = (ficha.sintomas || []).map(norm);

  const resultado = terapeutas.map((t) => {
    const bio = norm(t[CAMPOS.bio]);
    const subs = (t[CAMPOS.subs] || []).map(norm);
    const nivel = Number(t[CAMPOS.nivel]) || 1;
    let score = 0;
    const motivos = [];

    for (const tema of temas) {
      const radicais = TEMAS[tema];
      if (subs.some((s) => radicais.some((r) => tem(s, r)))) {
        score += PESOS.tema_sub; motivos.push(`subcategoria: ${tema}`);
      }
      if (radicais.some((r) => tem(bio, r))) {
        score += PESOS.tema_bio; motivos.push(`biografia: ${tema}`);
      }
    }
    for (const s of sintomas) {
      if (tem(bio, s.slice(0, 6))) score += PESOS.sintoma_bio;
    }
    // termos graves também contam se a bio do terapeuta menciona experiência no assunto
    if (gravidade.nivel !== 'normal' && gravidade.termos.some((p) => tem(bio, p.slice(0, 6)))) {
      score += PESOS.tema_bio; motivos.push('experiência com caso grave');
    }

    score += nivel * PESOS.nivel_base;

    if (gravidade.nivel !== 'normal') {
      if (nivel >= 3) { score += PESOS.nivel3_grave; motivos.push('nível 3 (caso grave)'); }
      else if (nivel === 2) score += PESOS.nivel2_grave;
    }

    if (ficha.preferenciaGenero && ficha.preferenciaGenero !== 'sem' && t.genero === ficha.preferenciaGenero) {
      score += PESOS.preferencia_genero; motivos.push('preferência de gênero');
    }

    return { terapeuta: t, score, motivos };
  });

  resultado.sort((a, b) => b.score - a.score || (b.terapeuta[CAMPOS.nivel] || 0) - (a.terapeuta[CAMPOS.nivel] || 0));

  return { gravidade, temas, ranking: resultado };
}

if (typeof module !== 'undefined') module.exports = { rankTherapists, detectarGravidade, detectarTemas };
if (typeof window !== 'undefined') window.Triagem = { rankTherapists, detectarGravidade, detectarTemas };

/* ---------- exemplo de uso ----------
const ficha = {
  queixa: 'Sofri abuso na infância e hoje tenho muita ansiedade',
  sintomas: ['Ansiedade', 'Trauma'],
  preferenciaGenero: 'sem',
};
const { gravidade, ranking } = rankTherapists(ficha, listaDeTerapeutas);
// gravidade.nivel === 'grave'  -> mostrar nível 3 primeiro
// gravidade.nivel === 'critico' -> além disso, avisar a equipe imediatamente
// ranking.slice(0, 3) -> "Recomendados para você"
*/
