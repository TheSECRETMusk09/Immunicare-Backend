const fs = require('fs');
const path = require('path');

function analyzeBackendCodeStructure() {
  const report = {
    timestamp: new Date().toISOString(),
    healthCenter: 'San Nicolas Health Center (ID: 1)',
    location: 'Pasig City',
    codeAnalysis: {}
  };

  console.log('=== ANALYZING BACKEND CODE STRUCTURE ===\n');

  // 1. Map all routes
  console.log('1. MAPPING ALL ROUTES...');
  const routesDir = path.join(__dirname, 'routes');
  const routeFiles = fs.readdirSync(routesDir).filter(f => f.endsWith('.js'));
  
  const routeMap = {};
  routeFiles.forEach(file => {
    const content = fs.readFileSync(path.join(routesDir, file), 'utf8');
    
    // Extract route definitions
    const routeMatches = content.match(/router\.(get|post|put|patch|delete)\s*\(['"`]([^'"`]+)['"`]/g) || [];
    const routes = routeMatches.map(match => {
      const [, method, path] = match.match(/router\.(\w+)\s*\(['"`]([^'"`]+)['"`]/) || [];
      return { method: method?.toUpperCase(), path };
    });
    
    // Check for clinic_id/facility_id filtering
    const hasClinicFilter = content.includes('clinic_id') || content.includes('req.user.clinic_id');
    const hasFacilityFilter = content.includes('facility_id') || content.includes('req.user.facility_id');
    const hasRBAC = content.includes('requirePermission') || content.includes('requireSystemAdmin');
    
    routeMap[file] = {
      routes: routes.length,
      routeDetails: routes,
      hasClinicFilter,
      hasFacilityFilter,
      hasRBAC,
      size: fs.statSync(path.join(routesDir, file)).size
    };
  });
  
  console.log(`✓ Analyzed ${routeFiles.length} route files`);
  console.log('\nRoute files with clinic/facility filtering:');
  Object.entries(routeMap).forEach(([file, info]) => {
    if (info.hasClinicFilter || info.hasFacilityFilter) {
      console.log(`  - ${file}: ${info.routes} routes, clinic_id: ${info.hasClinicFilter}, facility_id: ${info.hasFacilityFilter}, RBAC: ${info.hasRBAC}`);
    }
  });
  report.codeAnalysis.routes = routeMap;

  // 2. Analyze controllers
  console.log('\n2. ANALYZING CONTROLLERS...');
  const controllersDir = path.join(__dirname, 'controllers');
  const controllerFiles = fs.readdirSync(controllersDir).filter(f => f.endsWith('.js'));
  
  const controllerMap = {};
  controllerFiles.forEach(file => {
    const content = fs.readFileSync(path.join(controllersDir, file), 'utf8');
    
    // Extract function exports
    const functionMatches = content.match(/(?:exports\.|const\s+)(\w+)\s*=\s*(?:async\s*)?\(/g) || [];
    const functions = functionMatches.map(match => {
      const [, name] = match.match(/(?:exports\.|const\s+)(\w+)/) || [];
      return name;
    });
    
    const hasClinicFilter = content.includes('clinic_id') || content.includes('clinicId');
    const hasFacilityFilter = content.includes('facility_id') || content.includes('facilityId');
    
    controllerMap[file] = {
      functions: functions.length,
      functionNames: functions,
      hasClinicFilter,
      hasFacilityFilter,
      size: fs.statSync(path.join(controllersDir, file)).size
    };
  });
  
  console.log(`✓ Analyzed ${controllerFiles.length} controller files`);
  console.table(controllerMap);
  report.codeAnalysis.controllers = controllerMap;

  // 3. Analyze services
  console.log('\n3. ANALYZING SERVICES...');
  const servicesDir = path.join(__dirname, 'services');
  const serviceFiles = fs.readdirSync(servicesDir).filter(f => f.endsWith('.js'));
  
  const serviceMap = {};
  serviceFiles.forEach(file => {
    const content = fs.readFileSync(path.join(servicesDir, file), 'utf8');
    
    const hasClinicFilter = content.includes('clinic_id') || content.includes('clinicId');
    const hasFacilityFilter = content.includes('facility_id') || content.includes('facilityId');
    const hasPoolQuery = content.includes('pool.query');
    const hasEmailService = content.includes('emailService') || content.includes('sendEmail');
    const hasSMSService = content.includes('smsService') || content.includes('sendSMS');
    
    serviceMap[file] = {
      hasClinicFilter,
      hasFacilityFilter,
      hasPoolQuery,
      hasEmailService,
      hasSMSService,
      size: fs.statSync(path.join(servicesDir, file)).size
    };
  });
  
  console.log(`✓ Analyzed ${serviceFiles.length} service files`);
  console.log('\nServices with clinic/facility filtering:');
  Object.entries(serviceMap).forEach(([file, info]) => {
    if (info.hasClinicFilter || info.hasFacilityFilter) {
      console.log(`  - ${file}: clinic_id: ${info.hasClinicFilter}, facility_id: ${info.hasFacilityFilter}`);
    }
  });
  report.codeAnalysis.services = serviceMap;

  // 4. Analyze middleware
  console.log('\n4. ANALYZING MIDDLEWARE...');
  const middlewareDir = path.join(__dirname, 'middleware');
  if (fs.existsSync(middlewareDir)) {
    const middlewareFiles = fs.readdirSync(middlewareDir).filter(f => f.endsWith('.js'));
    
    const middlewareMap = {};
    middlewareFiles.forEach(file => {
      const content = fs.readFileSync(path.join(middlewareDir, file), 'utf8');
      
      middlewareMap[file] = {
        hasAuth: content.includes('jwt') || content.includes('token'),
        hasRBAC: content.includes('role') || content.includes('permission'),
        hasClinicFilter: content.includes('clinic_id') || content.includes('clinicId'),
        size: fs.statSync(path.join(middlewareDir, file)).size
      };
    });
    
    console.log(`✓ Analyzed ${middlewareFiles.length} middleware files`);
    console.table(middlewareMap);
    report.codeAnalysis.middleware = middlewareMap;
  }

  // 5. Check for RBAC implementation
  console.log('\n5. CHECKING RBAC IMPLEMENTATION...');
  const rbacFile = path.join(__dirname, 'middleware', 'rbac.js');
  if (fs.existsSync(rbacFile)) {
    const rbacContent = fs.readFileSync(rbacFile, 'utf8');
    
    const roles = rbacContent.match(/['"`](\w+)['"`]\s*:/g) || [];
    const permissions = rbacContent.match(/requirePermission\s*\(\s*['"`]([^'"`]+)['"`]/g) || [];
    
    console.log('✓ RBAC file found');
    console.log(`  - Roles defined: ${roles.length}`);
    console.log(`  - Permission checks: ${permissions.length}`);
    
    report.codeAnalysis.rbac = {
      exists: true,
      rolesCount: roles.length,
      permissionsCount: permissions.length
    };
  } else {
    console.log('⚠️  No RBAC middleware found');
    report.codeAnalysis.rbac = { exists: false };
  }

  // 6. Analyze authentication
  console.log('\n6. ANALYZING AUTHENTICATION...');
  const authFile = path.join(__dirname, 'routes', 'auth.js');
  if (fs.existsSync(authFile)) {
    const authContent = fs.readFileSync(authFile, 'utf8');
    
    const hasJWT = authContent.includes('jwt') || authContent.includes('jsonwebtoken');
    const hasPasswordHash = authContent.includes('bcrypt') || authContent.includes('hash');
    const hasRefreshToken = authContent.includes('refreshToken') || authContent.includes('refresh_token');
    const hasClinicAssignment = authContent.includes('clinic_id') || authContent.includes('clinicId');
    
    console.log('✓ Authentication analysis:');
    console.log(`  - JWT: ${hasJWT}`);
    console.log(`  - Password hashing: ${hasPasswordHash}`);
    console.log(`  - Refresh tokens: ${hasRefreshToken}`);
    console.log(`  - Clinic assignment: ${hasClinicAssignment}`);
    
    report.codeAnalysis.authentication = {
      hasJWT,
      hasPasswordHash,
      hasRefreshToken,
      hasClinicAssignment
    };
  }

  // 7. Check for data isolation patterns
  console.log('\n7. ANALYZING DATA ISOLATION PATTERNS...');
  const isolationPatterns = {
    whereClinicId: 0,
    whereFacilityId: 0,
    reqUserClinicId: 0,
    reqUserFacilityId: 0,
    joinClinicId: 0
  };
  
  routeFiles.forEach(file => {
    const content = fs.readFileSync(path.join(routesDir, file), 'utf8');
    isolationPatterns.whereClinicId += (content.match(/WHERE.*clinic_id\s*=/gi) || []).length;
    isolationPatterns.whereFacilityId += (content.match(/WHERE.*facility_id\s*=/gi) || []).length;
    isolationPatterns.reqUserClinicId += (content.match(/req\.user\.clinic_id/gi) || []).length;
    isolationPatterns.reqUserFacilityId += (content.match(/req\.user\.facility_id/gi) || []).length;
    isolationPatterns.joinClinicId += (content.match(/JOIN.*ON.*clinic_id/gi) || []).length;
  });
  
  console.log('✓ Data isolation patterns found:');
  console.table(isolationPatterns);
  report.codeAnalysis.isolationPatterns = isolationPatterns;

  // Write report
  const reportPath = 'SAN_NICOLAS_BACKEND_CODE_ANALYSIS.json';
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n✅ Code analysis complete! Report saved to: ${reportPath}`);
  
  return report;
}

analyzeBackendCodeStructure();
