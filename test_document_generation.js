const axios = require('axios');
require('dotenv').config();

// API base URL
const BASE_URL = process.env.API_BASE_URL || 'http://localhost:5000/api';

let authToken = '';

async function authenticate() {
  try {
    console.log('🔐 Authenticating...');
    const response = await axios.post(`${BASE_URL}/auth/login`, {
      email: 'admin',
      password: 'Admin2024!'
    });

    authToken = response.data.token;
    console.log('   ✅ Authentication successful');
    return true;
  } catch (error) {
    console.log('   ❌ Authentication failed:', error.message);
    return false;
  }
}

async function testDocumentGeneration() {
  try {
    console.log('\n🧪 Testing Document Generation API...');

    const headers = { Authorization: `Bearer ${authToken}` };

    // Test 1: Get available templates
    console.log('\n1. Testing paper templates endpoint...');
    try {
      const response = await axios.get(`${BASE_URL}/paper-templates`, {
        headers
      });
      console.log(`   ✅ GET /paper-templates - Status: ${response.status}`);
      console.log(
        `   📋 Templates available: ${response.data.data?.length || 0}`
      );

      if (response.data.data && response.data.data.length > 0) {
        const template = response.data.data[0];
        console.log(
          `   📄 Sample template: ${template.name} (${template.template_type})`
        );

        // Test 2: Generate a document using the first template
        console.log('\n2. Testing document generation...');
        const documentData = {
          template_id: template.id,
          data: {
            title: `Test ${template.name}`,
            child_name: 'Juan Dela Cruz',
            date_of_birth: '2023-01-15',
            guardian_name: 'Maria Dela Cruz',
            guardian_contact: '+63 912 345 6789',
            health_center: 'Main Health Center',
            test_field: 'This is test data for document generation'
          }
        };

        const generateResponse = await axios.post(
          `${BASE_URL}/documents/generate`,
          documentData,
          { headers }
        );
        console.log(
          `   ✅ POST /documents/generate - Status: ${generateResponse.status}`
        );
        console.log(
          `   📄 Generated document ID: ${generateResponse.data.document_generation.id}`
        );

        // Test 3: Get document details
        console.log('\n3. Testing document retrieval...');
        const docId = generateResponse.data.document_generation.id;

        const docResponse = await axios.get(
          `${BASE_URL}/documents/generation/${docId}`,
          { headers }
        );
        console.log(
          `   ✅ GET /documents/generation/${docId} - Status: ${docResponse.status}`
        );
        console.log(`   📋 Document title: ${docResponse.data.template_name}`);

        // Test 4: Download document
        console.log('\n4. Testing document download...');
        const downloadResponse = await axios.get(
          `${BASE_URL}/documents/download/${docId}`,
          { headers }
        );
        console.log(
          `   ✅ GET /documents/download/${docId} - Status: ${downloadResponse.status}`
        );
        console.log('   📥 Document ready for download');

        // Test 5: Get user's documents
        console.log('\n5. Testing user documents list...');
        const myDocsResponse = await axios.get(
          `${BASE_URL}/documents/my-documents`,
          { headers }
        );
        console.log(
          `   ✅ GET /documents/my-documents - Status: ${myDocsResponse.status}`
        );
        console.log(`   📚 User has ${myDocsResponse.data.length} documents`);

        // Test 6: Get document statistics
        console.log('\n6. Testing document statistics...');
        const statsResponse = await axios.get(`${BASE_URL}/documents/stats`, {
          headers
        });
        console.log(
          `   ✅ GET /documents/stats - Status: ${statsResponse.status}`
        );
        console.log('   📊 Stats:', statsResponse.data);
      }
    } catch (error) {
      console.log(
        `   ❌ Paper templates test failed: ${
          error.response?.status || 'Unknown'
        } - ${error.response?.data?.error || error.message}`
      );
    }
  } catch (error) {
    console.error('❌ Document generation test failed:', error.message);
  }
}

async function testPaperTemplatesCRUD() {
  try {
    console.log('\n🧪 Testing Paper Templates CRUD...');

    const headers = { Authorization: `Bearer ${authToken}` };

    // Test creating a new template
    console.log('\n1. Testing template creation...');
    try {
      const newTemplate = {
        name: 'Custom Test Template',
        description: 'A test template created via API',
        template_type: 'CUSTOM_TEST',
        fields: [
          {
            name: 'test_field',
            label: 'Test Field',
            type: 'text',
            required: true
          }
        ],
        validation_rules: {
          test_field: { minLength: 3 }
        }
      };

      const response = await axios.post(
        `${BASE_URL}/paper-templates`,
        newTemplate,
        { headers }
      );
      console.log(`   ✅ POST /paper-templates - Status: ${response.status}`);
      console.log(`   📄 Created template ID: ${response.data.data.id}`);

      // Test updating the template
      console.log('\n2. Testing template update...');
      const templateId = response.data.data.id;
      const updateData = {
        description: 'Updated test template description'
      };

      const updateResponse = await axios.put(
        `${BASE_URL}/paper-templates/${templateId}`,
        updateData,
        { headers }
      );
      console.log(
        `   ✅ PUT /paper-templates/${templateId} - Status: ${updateResponse.status}`
      );

      // Test getting template fields
      console.log('\n3. Testing template fields retrieval...');
      const fieldsResponse = await axios.get(
        `${BASE_URL}/paper-templates/${templateId}/fields`,
        { headers }
      );
      console.log(
        `   ✅ GET /paper-templates/${templateId}/fields - Status: ${fieldsResponse.status}`
      );
      console.log(`   📋 Fields: ${fieldsResponse.data.data?.length || 0}`);
    } catch (error) {
      console.log(
        `   ❌ Template CRUD test failed: ${
          error.response?.status || 'Unknown'
        } - ${error.response?.data?.error || error.message}`
      );
    }
  } catch (error) {
    console.error('❌ Template CRUD test failed:', error.message);
  }
}

async function runTests() {
  console.log('🚀 Starting Digital Papers System Tests\n');

  const authenticated = await authenticate();
  if (!authenticated) {
    console.log('❌ Cannot proceed without authentication');
    return;
  }

  await testDocumentGeneration();
  await testPaperTemplatesCRUD();

  console.log('\n✅ Digital papers system testing completed!');
}

// Run the tests
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { testDocumentGeneration, testPaperTemplatesCRUD };
