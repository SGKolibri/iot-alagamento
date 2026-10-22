import type { QuantitySpec } from '../ingestion/model';

export interface ProfileDefinition {
  name: string;
  version: number;
  expectedIntervalS: number;
  quantities: QuantitySpec[];
}

export type ProfileChanges = Partial<
  Pick<ProfileDefinition, 'name' | 'expectedIntervalS' | 'quantities'>
>;

// Forma canônica para comparar grandezas: ordem por nome e chaves em ordem fixa.
function canonical(quantities: QuantitySpec[]): string {
  return JSON.stringify(
    [...quantities]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((q) => [
        q.name,
        q.unit,
        q.range?.min ?? null,
        q.range?.max ?? null,
        q.expression ?? null,
      ]),
  );
}

// RF-CEN-02: a versão do perfil sobe só quando as grandezas mudam de fato.
export function applyProfileChanges(
  profile: ProfileDefinition,
  changes: ProfileChanges,
): ProfileDefinition {
  const quantities = changes.quantities ?? profile.quantities;
  const changed = canonical(quantities) !== canonical(profile.quantities);
  return {
    name: changes.name ?? profile.name,
    expectedIntervalS: changes.expectedIntervalS ?? profile.expectedIntervalS,
    quantities: quantities.map((q) => ({ ...q })),
    version: changed ? profile.version + 1 : profile.version,
  };
}
