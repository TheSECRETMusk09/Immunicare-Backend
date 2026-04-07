const {
  buildGuardianUsernameBase,
  isSeedStyleGuardianEmail,
  isSeedStyleGuardianUsername,
  resolveGuardianEmailDomain,
  resolveUniqueGuardianAccountIdentity,
  resolveUniqueGuardianUsername,
} = require('../utils/guardianAccountNaming');

describe('guardianAccountNaming', () => {
  test('builds dotted usernames from the guardian full name', () => {
    expect(
      buildGuardianUsernameBase({ fullName: 'David Rivera Bernardo' }),
    ).toBe('david.rivera.bernardo');

    expect(
      buildGuardianUsernameBase({ fullName: 'Elena Sofia Flores-Bautista' }),
    ).toBe('elena.sofia.flores.bautista');
  });

  test('detects known seed-style guardian usernames and emails', () => {
    expect(isSeedStyleGuardianUsername('exp95000.guardian.094952')).toBe(true);
    expect(isSeedStyleGuardianUsername('demo.guardian.0001')).toBe(true);
    expect(isSeedStyleGuardianUsername('guardian_639182345678')).toBe(true);
    expect(isSeedStyleGuardianUsername('david.rivera.bernardo')).toBe(false);

    expect(isSeedStyleGuardianEmail('exp95000.guardian.094952@immunicare.test')).toBe(true);
    expect(isSeedStyleGuardianEmail('guardian_639182345678@immunicare.local')).toBe(true);
    expect(isSeedStyleGuardianEmail('david.rivera.bernardo@immunicareph.site')).toBe(false);
  });

  test('resolves the guardian email domain from configured sender addresses', () => {
    expect(
      resolveGuardianEmailDomain({
        MAIL_FROM_EMAIL: 'notifications@immunicareph.site',
      }),
    ).toBe('immunicareph.site');

    expect(
      resolveGuardianEmailDomain({
        EMAIL_FROM: 'Immunicare <noreply@immunicare.local>',
      }),
    ).toBe('immunicare.local');
  });

  test('allocates dotted numeric username suffixes for duplicate guardian names', async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ username: 'isabel.fernandez.mercado' }],
        }),
    };

    await expect(
      resolveUniqueGuardianUsername(client, {
        fullName: 'Isabel Fernandez Mercado',
      }),
    ).resolves.toBe('isabel.fernandez.mercado.2');
  });

  test('allocates username and email together with matching dotted suffixes', async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            { username: 'isabel.fernandez.mercado' },
            { username: 'isabel.fernandez.mercado.2' },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { email: 'isabel.fernandez.mercado@immunicareph.site' },
            { email: 'isabel.fernandez.mercado.2@immunicareph.site' },
          ],
        }),
    };

    await expect(
      resolveUniqueGuardianAccountIdentity(client, {
        fullName: 'Isabel Fernandez Mercado',
        emailDomain: 'immunicareph.site',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        username: 'isabel.fernandez.mercado.3',
        email: 'isabel.fernandez.mercado.3@immunicareph.site',
      }),
    );
  });
});
