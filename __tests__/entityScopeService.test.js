const {
  mergeScopeIds,
  resolveEffectiveScope,
  resolveUserScopeIds,
} = require('../services/entityScopeService');

describe('entityScopeService scope aliases', () => {
  it('expands linked clinic and facility aliases for users', () => {
    expect(resolveUserScopeIds({ clinic_id: 1 })).toEqual([1, 203]);
    expect(resolveUserScopeIds({ facility_id: 203 })).toEqual([203, 1]);
  });

  it('deduplicates linked scope aliases when both ids are present', () => {
    expect(mergeScopeIds(1, 203, 1)).toEqual([1, 203]);
  });

  it('expands requested clinic aliases in effective scope resolution', () => {
    const effectiveScope = resolveEffectiveScope({
      query: { clinic_id: 1 },
      user: { clinic_id: 1 },
      canonicalRole: 'STAFF',
    });

    expect(effectiveScope.useScope).toBe(true);
    expect(effectiveScope.scopeIds).toEqual([1, 203]);
  });
});
