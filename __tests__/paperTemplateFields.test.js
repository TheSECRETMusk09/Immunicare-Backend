const {
  normalizePaperTemplateFields,
  normalizePaperTemplateRecord,
} = require('../utils/paperTemplateFields');

describe('paper template field normalization', () => {
  test('parses serialized field arrays safely', () => {
    const fields = normalizePaperTemplateFields(
      '[{"field":"child_name","label":"Child Name","source":"patients.full_name","required":true}]',
    );

    expect(fields).toHaveLength(1);
    expect(fields[0]).toEqual(
      expect.objectContaining({
        field: 'child_name',
        label: 'Child Name',
      }),
    );
  });

  test('wraps a single field object and normalizes template records', () => {
    const normalized = normalizePaperTemplateRecord({
      id: 7,
      name: 'Sample Template',
      fields: {
        field: 'child_name',
        label: 'Child Name',
        source: 'patients.full_name',
        required: true,
      },
    });

    expect(normalized.fields).toHaveLength(1);
    expect(normalized.fields[0]).toEqual(
      expect.objectContaining({
        field: 'child_name',
        label: 'Child Name',
        source: 'patients.full_name',
        required: true,
      }),
    );
  });
});
