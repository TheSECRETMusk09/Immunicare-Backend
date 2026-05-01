const patientService = require('../services/patientService');

describe('patientService search helpers', () => {
  test('tokenizes multi-part name searches into AND-linked predicates', () => {
    const condition = patientService.buildTokenizedSearchCondition({
      searchValue: 'Samorin Christian',
      expressions: patientService.buildPatientNameSearchExpressions('p'),
      startingParamIndex: 3,
    });

    expect(condition.params).toEqual(['%Samorin%', '%Christian%']);
    expect(condition.clause).toContain('ILIKE $3');
    expect(condition.clause).toContain('ILIKE $4');
    expect(condition.clause).toContain(' AND ');
  });

  test('includes middle-name and middle-initial patient name variants', () => {
    const expressions = patientService.buildPatientNameSearchExpressions('p');

    expect(
      expressions.some((expression) => expression.includes('p.middle_name')),
    ).toBe(true);
    expect(
      expressions.some((expression) => expression.includes('LEFT(BTRIM(p.middle_name), 1)')),
    ).toBe(true);
    expect(
      expressions.some(
        (expression) =>
          expression.includes('p.last_name') && expression.includes('p.first_name'),
      ),
    ).toBe(true);
  });
});
