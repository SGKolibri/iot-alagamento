import {
  evaluateAbsence,
  evaluatePoint,
  initialPairState,
  linearSlopePerMinute,
  type Condition,
  type PairState,
  type RulePoint,
} from '../../src';

const T0 = Date.UTC(2026, 9, 25, 12, 0, 0);
const at = (seconds: number) => T0 + seconds * 1000;
const point = (seconds: number, value: number, late = false): RulePoint => ({
  t: at(seconds),
  v: value,
  late,
});

// Aplica uma sequência de pontos e devolve os efeitos em ordem, como o consumidor faria.
function run(condition: Condition, points: RulePoint[], state: PairState = initialPairState()) {
  const effects: { type: string; t: number }[] = [];
  for (const p of points) {
    const result = evaluatePoint(condition, state, p);
    state = result.state;
    if (result.effect) effects.push({ type: result.effect.type, t: result.effect.occurredAt });
  }
  return { state, effects };
}

describe('1. limite com duração', () => {
  const condition: Condition = {
    quantity: 'level',
    operator: '>=',
    threshold: 100,
    duration: { readings: 3 },
  };

  it('só abre depois de N leituras consecutivas acima do limite', () => {
    const { effects } = run(condition, [point(0, 101), point(60, 102), point(120, 103)]);
    expect(effects).toEqual([{ type: 'open', t: at(120) }]);
  });

  it('uma leitura abaixo no meio zera a contagem', () => {
    const { effects } = run(condition, [
      point(0, 101),
      point(60, 102),
      point(120, 99),
      point(180, 101),
      point(240, 101),
    ]);
    expect(effects).toEqual([]);
    expect(
      run(condition, [
        point(0, 101),
        point(60, 102),
        point(120, 99),
        point(180, 101),
        point(240, 101),
        point(300, 101),
      ]).effects,
    ).toEqual([{ type: 'open', t: at(300) }]);
  });

  it('duração por tempo conta do primeiro ponto da sequência; com leituras e tempo, valem os dois', () => {
    const byTime: Condition = {
      quantity: 'level',
      operator: '>',
      threshold: 10,
      duration: { seconds: 120 },
    };
    expect(run(byTime, [point(0, 11), point(60, 11), point(119, 11)]).effects).toEqual([]);
    expect(run(byTime, [point(0, 11), point(60, 11), point(120, 11)]).effects).toEqual([
      { type: 'open', t: at(120) },
    ]);
    const both: Condition = {
      quantity: 'level',
      operator: '>',
      threshold: 10,
      duration: { readings: 4, seconds: 60 },
    };
    expect(run(both, [point(0, 11), point(30, 11), point(60, 11)]).effects).toEqual([]);
    expect(run(both, [point(0, 11), point(10, 11), point(20, 11), point(30, 11)]).effects).toEqual(
      [],
    );
    expect(run(both, [point(0, 11), point(30, 11), point(60, 11), point(61, 11)]).effects).toEqual([
      { type: 'open', t: at(61) },
    ]);
  });

  it('sem duração, a primeira leitura que cruza abre', () => {
    expect(
      run({ quantity: 'level', operator: '<', threshold: 5 }, [point(0, 6), point(1, 4)]).effects,
    ).toEqual([{ type: 'open', t: at(1) }]);
  });

  it.each([
    ['>', 10, 10, false],
    ['>=', 10, 10, true],
    ['<', 10, 9.9, true],
    ['<=', 10, 10, true],
    ['==', 10, 10, true],
    ['!=', 10, 10, false],
    ['!=', 10, 11, true],
  ] as const)(
    'operador %s com limite %s e valor %s: abre=%s',
    (operator, threshold, value, opens) => {
      expect(
        run({ quantity: 'level', operator, threshold }, [point(0, value)]).effects.length > 0,
      ).toBe(opens);
    },
  );
});

describe('2. taxa por regressão linear', () => {
  it('a inclinação bate com um cálculo independente', () => {
    const points = [
      { t: at(0), v: 10 },
      { t: at(60), v: 11.4 },
      { t: at(120), v: 13.1 },
      { t: at(180), v: 14.2 },
    ];
    // Cálculo independente: mínimos quadrados com x em minutos.
    const xs = points.map((p) => (p.t - points[0]!.t) / 60_000);
    const ys = points.map((p) => p.v);
    const mx = xs.reduce((a, b) => a + b) / xs.length;
    const my = ys.reduce((a, b) => a + b) / ys.length;
    const slope =
      xs.reduce((s, x, i) => s + (x - mx) * (ys[i]! - my), 0) /
      xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    expect(linearSlopePerMinute(points)).toBeCloseTo(slope, 12);
    expect(linearSlopePerMinute([{ t: at(0), v: 1 }])).toBe(0);
    expect(
      linearSlopePerMinute([
        { t: at(0), v: 1 },
        { t: at(0), v: 2 },
      ]),
    ).toBe(0);
  });

  const rising: Condition = {
    quantity: 'level',
    rate: { operator: '>=', threshold: 1.5, windowS: 180, minPoints: 3 },
  };

  it('dispara quando a taxa na janela passa do limite', () => {
    expect(run(rising, [point(0, 10), point(60, 11.6), point(120, 13.2)]).effects).toEqual([
      { type: 'open', t: at(120) },
    ]);
  });

  it('menos pontos que o mínimo não dispara, e pontos fora da janela saem do cálculo', () => {
    expect(run(rising, [point(0, 10), point(60, 20)]).effects).toEqual([]);
    // O ponto de 0 s sai da janela de 180 s quando chega o de 300 s.
    const { effects, state } = run(rising, [
      point(0, 0),
      point(200, 50),
      point(260, 50),
      point(300, 50),
    ]);
    expect(effects).toEqual([]);
    expect(state.window.map((p) => p.t)).toEqual([at(200), at(260), at(300)]);
  });

  it('taxa combinada com limite exige os dois', () => {
    const both: Condition = { ...rising, operator: '>=', threshold: 100 };
    expect(run(both, [point(0, 10), point(60, 11.6), point(120, 13.2)]).effects).toEqual([]);
    expect(run(both, [point(0, 100), point(60, 101.6), point(120, 103.2)]).effects).toEqual([
      { type: 'open', t: at(120) },
    ]);
  });
});

describe('3. ausência', () => {
  const minute = 60;
  it('dispara depois de N intervalos sem medida e não antes', () => {
    const lastContact = new Date(at(0));
    const before = evaluateAbsence(
      { intervals: 3 },
      { notifiedFor: null },
      lastContact,
      minute,
      new Date(at(180)),
    );
    expect(before.effect).toBeNull();
    const after = evaluateAbsence(
      { intervals: 3 },
      before.state,
      lastContact,
      minute,
      new Date(at(181)),
    );
    expect(after.effect).toEqual({ type: 'absent', lastContactAt: lastContact.getTime() });
  });

  it('avisa uma vez por período de ausência e de novo depois de um contato novo', () => {
    const contact = new Date(at(0));
    const first = evaluateAbsence(
      { intervals: 1 },
      { notifiedFor: null },
      contact,
      minute,
      new Date(at(120)),
    );
    const again = evaluateAbsence(
      { intervals: 1 },
      first.state,
      contact,
      minute,
      new Date(at(600)),
    );
    expect(again.effect).toBeNull();
    const newContact = new Date(at(700));
    const later = evaluateAbsence(
      { intervals: 1 },
      again.state,
      newContact,
      minute,
      new Date(at(800)),
    );
    expect(later.effect).toEqual({ type: 'absent', lastContactAt: newContact.getTime() });
  });

  it('dispositivo que nunca enviou não dispara', () => {
    expect(
      evaluateAbsence({ intervals: 1 }, { notifiedFor: null }, null, minute, new Date(at(9999)))
        .effect,
    ).toBeNull();
  });
});

describe('4. histerese', () => {
  const condition: Condition = {
    quantity: 'level',
    operator: '>=',
    threshold: 100,
    exit: { operator: '<', threshold: 98, duration: { seconds: 600 } },
  };

  it('resolve só quando fica abaixo do limiar de saída pela duração de saída', () => {
    const { effects } = run(condition, [
      point(0, 100),
      point(60, 97),
      point(300, 97),
      point(659, 97),
      point(660, 97),
    ]);
    expect(effects).toEqual([
      { type: 'open', t: at(0) },
      { type: 'resolve', t: at(660) },
    ]);
  });

  it('oscilar em torno do limiar não abre e fecha repetidamente', () => {
    const values = [100, 99, 100.5, 99.5, 101, 98.5, 100, 99];
    const { effects } = run(
      condition,
      values.map((v, i) => point(i * 60, v)),
    );
    expect(effects).toEqual([{ type: 'open', t: at(0) }]);
  });

  it('voltar acima do limiar de saída zera a contagem de saída', () => {
    const { effects } = run(condition, [
      point(0, 100),
      point(60, 97),
      point(400, 99),
      point(700, 97),
      point(1299, 97),
    ]);
    expect(effects).toEqual([{ type: 'open', t: at(0) }]);
  });

  it('sem saída configurada, resolve na primeira leitura fora da condição de entrada', () => {
    const plain: Condition = { quantity: 'level', operator: '>=', threshold: 100 };
    expect(run(plain, [point(0, 100), point(60, 100), point(120, 99.9)]).effects).toEqual([
      { type: 'open', t: at(0) },
      { type: 'resolve', t: at(120) },
    ]);
  });

  it('saída por leituras', () => {
    const byReadings: Condition = {
      ...condition,
      exit: { operator: '<', threshold: 98, duration: { readings: 2 } },
    };
    expect(run(byReadings, [point(0, 100), point(60, 97), point(120, 97)]).effects).toEqual([
      { type: 'open', t: at(0) },
      { type: 'resolve', t: at(120) },
    ]);
  });
});

describe('5. ponto fora de ordem, repetido ou atrasado', () => {
  const condition: Condition = {
    quantity: 'level',
    operator: '>=',
    threshold: 100,
    duration: { readings: 2 },
  };

  it('não mudam o estado', () => {
    const { state } = run(condition, [point(60, 101)]);
    for (const p of [point(60, 101), point(30, 150), point(120, 150, true)]) {
      const result = evaluatePoint(condition, state, p);
      expect(result.state).toBe(state);
      expect(result.effect).toBeNull();
    }
  });

  it('o atrasado também não abre nem fecha', () => {
    const { effects } = run(condition, [point(0, 101), point(60, 101, true), point(120, 101)]);
    expect(effects).toEqual([{ type: 'open', t: at(120) }]);
  });
});
