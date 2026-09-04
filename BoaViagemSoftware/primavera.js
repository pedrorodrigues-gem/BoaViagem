/**
 * Cliente para a Cegid Primavera WebAPI (gateway assíncrono por tarefas).
 *
 * Cada escola configura a sua própria ligação (baseUrl, empresa, clientId,
 * apiKey) em "Dados da Escola > Faturação", pelo que este módulo nunca lê
 * credenciais de variáveis de ambiente — recebe sempre a configuração (cfg)
 * explicitamente, para que os dados de uma escola nunca se possam misturar
 * com os de outra.
 */

const POLL_INTERVALO_MS = 3000;
const POLL_MAX = 20;

function headersFor(cfg) {
  return {
    'X-Client-ID': cfg.clientId || '',
    'X-API-Key': cfg.apiKey || '',
    'Content-Type': 'application/json'
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function polling(cfg, taskId) {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/v1/task/${taskId}/result`;
  for (let i = 1; i <= POLL_MAX; i++) {
    try {
      const r = await fetch(url, { headers: headersFor(cfg) });
      if (r.status !== 200) {
        return { state: 'POLL_ERROR', result: null, detalhe: `HTTP ${r.status}` };
      }
      const data = await r.json();
      const state = data.state || 'UNKNOWN';
      if (state === 'SUCCESS' || state === 'FAILURE') return data;
      await sleep(POLL_INTERVALO_MS);
    } catch (ex) {
      return { state: 'POLL_ERROR', result: null, detalhe: String(ex.message || ex) };
    }
  }
  return { state: 'TIMEOUT', result: null, detalhe: `Timeout após ${POLL_MAX * POLL_INTERVALO_MS / 1000}s` };
}

/**
 * Envia um documento ao gateway Primavera e aguarda o resultado.
 * Devolve { sucesso: true, doc_numero, doc_serie, doc_tipo, doc_empresa, recibo_numero, transmissao, avisos }
 * ou { sucesso: false, erro }.
 */
async function enviarDocumento(cfg, payload, log = '') {
  if (!cfg || !cfg.baseUrl || !cfg.empresa || !cfg.clientId || !cfg.apiKey) {
    return { sucesso: false, erro: 'A integração com a Cegid Primavera ainda não está configurada para esta escola.' };
  }

  const isRecibo = String(payload.Tipodoc || payload.TipoDocumento || '').toUpperCase() === 'RE';
  const docsUrl = `${cfg.baseUrl.replace(/\/+$/, '')}/v1/${cfg.empresa}/documents`;

  let res;
  try {
    res = await fetch(docsUrl, {
      method: 'POST',
      headers: headersFor(cfg),
      body: JSON.stringify(payload)
    });
  } catch (ex) {
    return { sucesso: false, erro: `Falha de ligação ao gateway Primavera: ${ex.message || ex}` };
  }

  if (res.status >= 400) {
    let detalhe;
    try { detalhe = (await res.json()).detail; } catch (e) { detalhe = await res.text().catch(() => res.statusText); }
    return { sucesso: false, erro: `Gateway rejeitou o documento (HTTP ${res.status}): ${detalhe}` };
  }

  const body = await res.json();
  const taskId = body.tracking_id || body.task_id;
  if (!taskId) {
    return { sucesso: false, erro: 'Resposta do gateway sem tracking_id.' };
  }

  const poll = await polling(cfg, taskId);
  const state = poll.state || 'UNKNOWN';
  const result = poll.result || {};

  if (state === 'SUCCESS' && result.status === 'sucesso') {
    const docNum = result.DocumentoNumero;
    const reciboNum = result.ReciboNumero || docNum;
    const numeroDisplay = isRecibo ? reciboNum : docNum;
    return {
      sucesso: true,
      doc_numero: numeroDisplay,
      doc_serie: result.Serie,
      doc_tipo: result.TipoDocumento,
      doc_empresa: result.EmpresaId,
      recibo_numero: isRecibo ? reciboNum : null,
      transmissao: result.Transmissao || '',
      avisos: result.Avisos || ''
    };
  }

  const detalhe = result.detalhe || poll.detalhe || state;
  return { sucesso: false, erro: `Falha na emissão do documento (${state}): ${detalhe}` };
}

module.exports = { enviarDocumento };