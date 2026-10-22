import { TOPIC, nextId, setup, telemetry } from './support';

// O integrador lê estes textos no 400 e na DLQ: caminho, regra e mensagem legível.
describe('mensagens de recusa', () => {
  async function refusedBy(
    request: Parameters<ReturnType<typeof setup>['pipeline']['ingestMessage']>[0],
  ) {
    return (await setup().pipeline.ingestMessage(request)).issues;
  }

  it('credencial ausente', async () => {
    const outcome = await setup().pipeline.ingestMessage({ source: 'http', body: telemetry() });
    expect(outcome).toEqual({
      status: 'unauthorized',
      issues: [{ path: '', rule: 'credencial', message: 'credencial ausente ou inválida' }],
      measurements: [],
    });
  });

  it('dispositivo não cadastrado', async () => {
    expect(
      await refusedBy({
        source: 'mqtt',
        topic: { ...TOPIC, device: 'x' },
        body: telemetry({ dispositivo: 'x' }),
      }),
    ).toEqual([
      {
        path: '/dispositivo',
        rule: 'cadastro',
        message: 'dispositivo x não cadastrado no inquilino inquilino-a',
      },
    ]);
  });

  it('tópico com site ou domínio fora do cadastro', async () => {
    expect(
      await refusedBy({ source: 'mqtt', topic: { ...TOPIC, domain: 'd2' }, body: telemetry() }),
    ).toEqual([
      {
        path: '',
        rule: 'topico',
        message:
          'o tópico indica site site-a e domínio d2, mas o dispositivo está cadastrado em site-a e dominio-a',
      },
    ]);
  });

  it('dispositivo e tipo do corpo divergentes do tópico', async () => {
    expect(
      await refusedBy({
        source: 'mqtt',
        topic: { ...TOPIC, kind: 'estado' },
        body: telemetry({ dispositivo: 'outro' }),
      }),
    ).toEqual([
      {
        path: '/dispositivo',
        rule: 'topico',
        message: 'o dispositivo do corpo (outro) diverge do tópico (nivel-01)',
      },
      {
        path: '/tipo',
        rule: 'topico',
        message: 'o tipo do corpo (telemetria) diverge do tópico (estado)',
      },
    ]);
  });

  it('credencial de um dispositivo com corpo de outro', async () => {
    expect(
      await refusedBy({
        source: 'http',
        credential: 'token-nivel-01',
        body: telemetry({ dispositivo: 'outro' }),
      }),
    ).toEqual([
      {
        path: '/dispositivo',
        rule: 'credencial',
        message: 'a credencial é do dispositivo nivel-01, mas a mensagem é de outro',
      },
    ]);
  });

  it('grandeza fora do perfil e unidade sem conversão', async () => {
    expect(
      await refusedBy({
        source: 'mqtt',
        topic: TOPIC,
        body: telemetry({
          medidas: [
            { grandeza: 'pressao', valor: 1, unidade: 'Pa' },
            { grandeza: 'bateria', valor: 1, unidade: 'cm' },
          ],
        }),
      }),
    ).toEqual([
      {
        path: '/medidas/0/grandeza',
        rule: 'perfil',
        message: 'a grandeza pressao não existe no perfil do dispositivo',
      },
      {
        path: '/medidas/1/unidade',
        rule: 'unidade',
        message: 'a unidade cm não converte para mV (grandeza bateria)',
      },
    ]);
  });

  it('comando na ingestão', async () => {
    expect(
      await refusedBy({
        source: 'mqtt',
        topic: { ...TOPIC, kind: 'comando' },
        body: telemetry({ tipo: 'comando', comando: { nome: 'x' } }),
      }),
    ).toEqual([
      {
        path: '/tipo',
        rule: 'sentido',
        message: 'comando vai da plataforma para o dispositivo e não entra pela ingestão',
      },
    ]);
  });

  it('mensagem de lote de borda sem dispositivo identificável', async () => {
    const outcome = await setup().pipeline.ingestBatch({
      credential: 'token-borda',
      body: { id_lote: nextId(), mensagens: [{ versao: '1.0', id_mensagem: nextId() }] },
    });
    if (outcome.status !== 'processed') throw new Error(outcome.status);
    expect(outcome.results[0]!.issues).toEqual([
      { path: '/dispositivo', rule: 'cadastro', message: 'dispositivo não identificado' },
    ]);
  });

  it('mensagem recusada não sai marcada como atrasada', async () => {
    const outcome = await setup().pipeline.ingestMessage({
      source: 'mqtt',
      topic: TOPIC,
      body: telemetry({ versao: undefined }),
    });
    expect(outcome.late).toBe(false);
  });
});
