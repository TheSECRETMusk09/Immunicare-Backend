const sanitization = require('../middleware/sanitization');
const enhancedRbac = require('../middleware/enhanced-rbac');

/**
 * Middleware Unit Tests
 * Tests for sanitization, RBAC, and security middleware
 */

describe('Middleware Tests', () => {
  describe('Sanitization Middleware', () => {
    let mockReq;
    let mockRes;
    let nextFunction;

    beforeEach(() => {
      mockReq = {
        body: {},
        query: {},
        params: {}
      };
      mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        setHeader: jest.fn()
      };
      nextFunction = jest.fn();
    });

    describe('sanitizeRequest', () => {
      it('should sanitize XSS patterns from body', () => {
        mockReq.body = {
          name: '<script>alert(\'xss\')</script>',
          description: '<img src=x onerror=alert(\'xss\')>'
        };

        const middleware = sanitization.sanitizeRequest();
        middleware(mockReq, mockRes, nextFunction);

        expect(mockReq.body.name).not.toContain('<script>');
        expect(mockReq.body.description).not.toContain('onerror');
        expect(nextFunction).toHaveBeenCalled();
      });

      it('should sanitize SQL injection patterns', () => {
        mockReq.body = {
          search: '\'; DROP TABLE users; --',
          id: '1 OR 1=1'
        };

        const middleware = sanitization.sanitizeRequest();
        middleware(mockReq, mockRes, nextFunction);

        expect(mockReq.body.search).not.toContain('DROP TABLE');
        expect(mockReq.body.id).not.toContain('OR 1=1');
      });

      it('should sanitize query parameters', () => {
        mockReq.query = {
          search: '<script>alert(1)</script>',
          page: '1'
        };

        const middleware = sanitization.sanitizeRequest();
        middleware(mockReq, mockRes, nextFunction);

        expect(mockReq.query.search).not.toContain('<script>');
        expect(mockReq.query.page).toBe('1');
      });

      it('should sanitize URL parameters', () => {
        mockReq.params = {
          id: '1<script>'
        };

        const middleware = sanitization.sanitizeRequest();
        middleware(mockReq, mockRes, nextFunction);

        expect(mockReq.params.id).not.toContain('<script>');
      });

      it('should handle nested objects', () => {
        mockReq.body = {
          user: {
            name: '<script>alert(1)</script>',
            email: 'test@example.com'
          }
        };

        const middleware = sanitization.sanitizeRequest();
        middleware(mockReq, mockRes, nextFunction);

        expect(mockReq.body.user.name).not.toContain('<script>');
        expect(mockReq.body.user.email).toBe('test@example.com');
      });

      it('should handle arrays', () => {
        mockReq.body = {
          items: ['<script>alert(1)</script>', 'safe value']
        };

        const middleware = sanitization.sanitizeRequest();
        middleware(mockReq, mockRes, nextFunction);

        expect(mockReq.body.items[0]).not.toContain('<script>');
        expect(mockReq.body.items[1]).toBe('safe value');
      });

      it('should exclude specified fields', () => {
        mockReq.body = {
          name: '<script>alert(1)</script>',
          htmlContent: '<p>Safe HTML</p>'
        };

        const middleware = sanitization.sanitizeRequest({
          excludeFields: ['htmlContent']
        });
        middleware(mockReq, mockRes, nextFunction);

        expect(mockReq.body.name).not.toContain('<script>');
        expect(mockReq.body.htmlContent).toBe('<p>Safe HTML</p>');
      });

      it('should sanitize only specified fields', () => {
        mockReq.body = {
          name: '<script>alert(1)</script>',
          description: '<script>alert(2)</script>'
        };

        const middleware = sanitization.sanitizeRequest({
          fields: ['name']
        });
        middleware(mockReq, mockRes, nextFunction);

        expect(mockReq.body.name).not.toContain('<script>');
        expect(mockReq.body.description).toContain('<script>');
      });
    });

    describe('sanitizeField', () => {
      it('should sanitize email fields', () => {
        mockReq.body = {
          email: '  Test@Example.COM  '
        };

        const middleware = sanitization.sanitizeField('email', 'email');
        middleware(mockReq, mockRes, nextFunction);

        expect(mockReq.body.email).toBe('test@example.com');
      });

      it('should sanitize phone fields', () => {
        mockReq.body = {
          phone: '+1 (555) 123-4567<script>'
        };

        const middleware = sanitization.sanitizeField('phone', 'phone');
        middleware(mockReq, mockRes, nextFunction);

        expect(mockReq.body.phone).toBe('+1 (555) 123-4567');
        expect(mockReq.body.phone).not.toContain('<script>');
      });
    });

    describe('deepSanitize', () => {
      it('should deeply sanitize nested objects', () => {
        const input = {
          level1: {
            level2: {
              level3: '<script>alert(1)</script>'
            }
          }
        };

        const result = sanitization.deepSanitize(input);

        expect(result.level1.level2.level3).not.toContain('<script>');
      });

      it('should handle null values', () => {
        const input = {
          value: null,
          text: '<script>alert(1)</script>'
        };

        const result = sanitization.deepSanitize(input);

        expect(result.value).toBeNull();
        expect(result.text).not.toContain('<script>');
      });

      it('should handle numbers', () => {
        const input = {
          count: 42,
          text: '<script>alert(1)</script>'
        };

        const result = sanitization.deepSanitize(input);

        expect(result.count).toBe(42);
        expect(result.text).not.toContain('<script>');
      });
    });

    describe('sanitizeFilename', () => {
      it('should sanitize special characters', () => {
        const filename = 'file@name#with$special%chars.txt';
        const result = sanitization.sanitizeFilename(filename);

        expect(result).toBe('file_name_with_special_chars.txt');
      });

      it('should lowercase filename', () => {
        const filename = 'UPPERCASE.TXT';
        const result = sanitization.sanitizeFilename(filename);

        expect(result).toBe('uppercase.txt');
      });

      it('should limit length', () => {
        const filename = 'a'.repeat(300) + '.txt';
        const result = sanitization.sanitizeFilename(filename);

        expect(result.length).toBeLessThanOrEqual(255);
      });
    });

    describe('contentSecurityPolicy', () => {
      it('should set CSP headers', () => {
        const middleware = sanitization.contentSecurityPolicy;
        middleware(mockReq, mockRes, nextFunction);

        expect(mockRes.setHeader).toHaveBeenCalledWith(
          'Content-Security-Policy',
          expect.stringContaining('default-src \'self\'')
        );
        expect(nextFunction).toHaveBeenCalled();
      });
    });

    describe('preventPrototypePollution', () => {
      it('should remove __proto__ keys', () => {
        mockReq.body = {
          normal: 'value',
          '__proto__.isAdmin': true
        };

        const middleware = sanitization.preventPrototypePollution;
        middleware(mockReq, mockRes, nextFunction);

        expect(mockReq.body['__proto__.isAdmin']).toBeUndefined();
        expect(mockReq.body.normal).toBe('value');
      });

      it('should remove constructor keys', () => {
        mockReq.body = {
          normal: 'value',
          'constructor.prototype.isAdmin': true
        };

        const middleware = sanitization.preventPrototypePollution;
        middleware(mockReq, mockRes, nextFunction);

        expect(mockReq.body['constructor.prototype.isAdmin']).toBeUndefined();
      });
    });
  });

  describe('Enhanced RBAC Middleware', () => {
    let mockReq;
    let mockRes;
    let nextFunction;

    beforeEach(() => {
      mockReq = {
        user: {
          id: 1,
          role: 'health_worker',
          health_center_id: 1
        },
        params: {},
        body: {},
        path: '/api/test',
        method: 'GET',
        ip: '127.0.0.1',
        get: jest.fn().mockReturnValue('test-agent')
      };
      mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis()
      };
      nextFunction = jest.fn();
    });

    describe('hasPermission', () => {
      it('should return true for valid permission', () => {
        const result = enhancedRbac.hasPermission('admin', enhancedRbac.PERMISSIONS.PATIENT_VIEW);
        expect(result).toBe(true);
      });

      it('should return false for invalid permission', () => {
        const result = enhancedRbac.hasPermission(
          'guardian',
          enhancedRbac.PERMISSIONS.INVENTORY_DELETE
        );
        expect(result).toBe(false);
      });

      it('should allow super_admin all permissions', () => {
        const result = enhancedRbac.hasPermission('super_admin', 'any:permission');
        expect(result).toBe(true);
      });
    });

    describe('hasAnyPermission', () => {
      it('should return true if any permission exists', () => {
        const result = enhancedRbac.hasAnyPermission('health_worker', [
          enhancedRbac.PERMISSIONS.PATIENT_VIEW,
          enhancedRbac.PERMISSIONS.SYSTEM_SETTINGS
        ]);
        expect(result).toBe(true);
      });

      it('should return false if no permissions exist', () => {
        const result = enhancedRbac.hasAnyPermission('guardian', [
          enhancedRbac.PERMISSIONS.INVENTORY_VIEW,
          enhancedRbac.PERMISSIONS.USER_MANAGE_ROLES
        ]);
        expect(result).toBe(false);
      });
    });

    describe('hasAllPermissions', () => {
      it('should return true if all permissions exist', () => {
        const result = enhancedRbac.hasAllPermissions('admin', [
          enhancedRbac.PERMISSIONS.PATIENT_VIEW,
          enhancedRbac.PERMISSIONS.PATIENT_CREATE
        ]);
        expect(result).toBe(true);
      });

      it('should return false if not all permissions exist', () => {
        const result = enhancedRbac.hasAllPermissions('nurse', [
          enhancedRbac.PERMISSIONS.PATIENT_VIEW,
          enhancedRbac.PERMISSIONS.PATIENT_CREATE
        ]);
        expect(result).toBe(false);
      });
    });

    describe('hasRoleLevel', () => {
      it('should return true for higher role', () => {
        const result = enhancedRbac.hasRoleLevel('admin', 'health_worker');
        expect(result).toBe(true);
      });

      it('should return false for lower role', () => {
        const result = enhancedRbac.hasRoleLevel('nurse', 'admin');
        expect(result).toBe(false);
      });
    });

    describe('requirePermission', () => {
      it('should call next for authorized user', async () => {
        mockReq.user.role = 'admin';

        const middleware = enhancedRbac.requirePermission(enhancedRbac.PERMISSIONS.PATIENT_VIEW);
        await middleware(mockReq, mockRes, nextFunction);

        expect(nextFunction).toHaveBeenCalled();
      });

      it('should return 401 for unauthenticated user', async () => {
        mockReq.user = null;

        const middleware = enhancedRbac.requirePermission(enhancedRbac.PERMISSIONS.PATIENT_VIEW);
        await middleware(mockReq, mockRes, nextFunction);

        expect(mockRes.status).toHaveBeenCalledWith(401);
        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'Authentication required'
          })
        );
      });

      it('should return 403 for unauthorized user', async () => {
        mockReq.user.role = 'guardian';

        const middleware = enhancedRbac.requirePermission(enhancedRbac.PERMISSIONS.INVENTORY_VIEW);
        await middleware(mockReq, mockRes, nextFunction);

        expect(mockRes.status).toHaveBeenCalledWith(403);
        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'Insufficient permissions'
          })
        );
      });
    });

    describe('getUserPermissions', () => {
      it('should return permissions for valid role', () => {
        const permissions = enhancedRbac.getUserPermissions('admin');
        expect(permissions).toContain(enhancedRbac.PERMISSIONS.PATIENT_VIEW);
        expect(permissions.length).toBeGreaterThan(0);
      });

      it('should return empty array for invalid role', () => {
        const permissions = enhancedRbac.getUserPermissions('invalid_role');
        expect(permissions).toEqual([]);
      });
    });

    describe('getAllRoles', () => {
      it('should return all roles with descriptions', () => {
        const roles = enhancedRbac.getAllRoles();
        expect(roles.length).toBeGreaterThan(0);
        expect(roles[0]).toHaveProperty('name');
        expect(roles[0]).toHaveProperty('permissions');
        expect(roles[0]).toHaveProperty('description');
        expect(roles[0]).toHaveProperty('level');
      });
    });

    describe('roleExists', () => {
      it('should return true for existing role', () => {
        expect(enhancedRbac.roleExists('admin')).toBe(true);
        expect(enhancedRbac.roleExists('health_worker')).toBe(true);
      });

      it('should return false for non-existing role', () => {
        expect(enhancedRbac.roleExists('invalid_role')).toBe(false);
      });
    });
  });
});
