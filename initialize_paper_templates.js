const { Pool } = require('pg');
require('dotenv').config();

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'immunicare_dev',
  user: process.env.DB_USER || 'immunicare_dev',
  password: process.env.DB_PASSWORD || 'ImmunicareDev2024!',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

async function initializePaperTemplates() {
  try {
    console.log('📋 Initializing Paper Templates...');

    // Get admin user ID
    const adminResult = await pool.query(
      'SELECT id FROM users WHERE username = \'admin\' LIMIT 1'
    );

    if (adminResult.rows.length === 0) {
      throw new Error('Admin user not found. Please run setup_admin.js first.');
    }

    const adminId = adminResult.rows[0].id;

    // Define standard healthcare document templates
    const templates = [
      {
        name: 'Vaccination Schedule Booklet',
        description:
          'Official vaccination schedule for infants showing required vaccines by age',
        template_type: 'VACCINE_SCHEDULE',
        fields: [
          {
            name: 'child_name',
            label: 'Child\'s Name',
            type: 'text',
            required: true
          },
          {
            name: 'date_of_birth',
            label: 'Date of Birth',
            type: 'date',
            required: true
          },
          {
            name: 'guardian_name',
            label: 'Guardian Name',
            type: 'text',
            required: true
          },
          {
            name: 'health_center',
            label: 'Health Center',
            type: 'text',
            required: true
          },
          {
            name: 'vaccines',
            label: 'Vaccination Schedule',
            type: 'object',
            required: true
          }
        ],
        validation_rules: {
          child_name: { minLength: 2, maxLength: 100 },
          guardian_name: { minLength: 2, maxLength: 100 }
        }
      },
      {
        name: 'Immunization Record Certificate',
        description:
          'Official immunization record showing all administered vaccines',
        template_type: 'IMMUNIZATION_RECORD',
        fields: [
          {
            name: 'child_name',
            label: 'Child\'s Name',
            type: 'text',
            required: true
          },
          {
            name: 'date_of_birth',
            label: 'Date of Birth',
            type: 'date',
            required: true
          },
          {
            name: 'gender',
            label: 'Gender',
            type: 'select',
            options: ['Male', 'Female'],
            required: true
          },
          {
            name: 'guardian_name',
            label: 'Guardian Name',
            type: 'text',
            required: true
          },
          {
            name: 'guardian_contact',
            label: 'Guardian Contact',
            type: 'text',
            required: true
          },
          {
            name: 'vaccinations',
            label: 'Vaccination Records',
            type: 'array',
            required: true
          }
        ],
        validation_rules: {
          child_name: { minLength: 2, maxLength: 100 },
          guardian_contact: { pattern: '^[+]?[0-9\\s\\-\\(\\)]{10,}$' }
        }
      },
      {
        name: 'Digital Vaccination Card',
        description:
          'Digital vaccination card for easy access and verification',
        template_type: 'DIGITAL_VACCINATION_CARD',
        fields: [
          {
            name: 'child_name',
            label: 'Child\'s Name',
            type: 'text',
            required: true
          },
          {
            name: 'date_of_birth',
            label: 'Date of Birth',
            type: 'date',
            required: true
          },
          {
            name: 'qr_code_data',
            label: 'QR Code Data',
            type: 'text',
            required: true
          },
          {
            name: 'verification_hash',
            label: 'Verification Hash',
            type: 'text',
            required: true
          },
          {
            name: 'valid_until',
            label: 'Valid Until',
            type: 'date',
            required: true
          }
        ],
        validation_rules: {
          child_name: { minLength: 2, maxLength: 100 },
          qr_code_data: { minLength: 10 }
        }
      },
      {
        name: 'Growth Chart Record',
        description:
          'Growth tracking chart showing weight, height, and development milestones',
        template_type: 'GROWTH_CHART',
        fields: [
          {
            name: 'child_name',
            label: 'Child\'s Name',
            type: 'text',
            required: true
          },
          {
            name: 'date_of_birth',
            label: 'Date of Birth',
            type: 'date',
            required: true
          },
          {
            name: 'measurements',
            label: 'Growth Measurements',
            type: 'array',
            required: true
          },
          {
            name: 'milestones',
            label: 'Development Milestones',
            type: 'array',
            required: false
          }
        ],
        validation_rules: {
          child_name: { minLength: 2, maxLength: 100 }
        }
      },
      {
        name: 'Health Information Summary',
        description: 'Comprehensive health information summary for the child',
        template_type: 'HEALTH_SUMMARY',
        fields: [
          {
            name: 'child_name',
            label: 'Child\'s Name',
            type: 'text',
            required: true
          },
          {
            name: 'date_of_birth',
            label: 'Date of Birth',
            type: 'date',
            required: true
          },
          {
            name: 'blood_type',
            label: 'Blood Type',
            type: 'select',
            options: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
            required: false
          },
          {
            name: 'allergies',
            label: 'Known Allergies',
            type: 'array',
            required: false
          },
          {
            name: 'medical_conditions',
            label: 'Medical Conditions',
            type: 'array',
            required: false
          },
          {
            name: 'emergency_contact',
            label: 'Emergency Contact',
            type: 'object',
            required: true
          }
        ],
        validation_rules: {
          child_name: { minLength: 2, maxLength: 100 }
        }
      },
      {
        name: 'Appointment Confirmation Letter',
        description:
          'Official appointment confirmation letter with date, time, and location',
        template_type: 'APPOINTMENT_LETTER',
        fields: [
          {
            name: 'child_name',
            label: 'Child\'s Name',
            type: 'text',
            required: true
          },
          {
            name: 'guardian_name',
            label: 'Guardian Name',
            type: 'text',
            required: true
          },
          {
            name: 'appointment_date',
            label: 'Appointment Date',
            type: 'datetime',
            required: true
          },
          {
            name: 'appointment_type',
            label: 'Appointment Type',
            type: 'text',
            required: true
          },
          { name: 'location', label: 'Location', type: 'text', required: true },
          {
            name: 'doctor_name',
            label: 'Doctor Name',
            type: 'text',
            required: true
          }
        ],
        validation_rules: {
          child_name: { minLength: 2, maxLength: 100 },
          guardian_name: { minLength: 2, maxLength: 100 }
        }
      }
    ];

    // Insert templates
    let createdCount = 0;
    for (const template of templates) {
      try {
        const result = await pool.query(
          `INSERT INTO paper_templates (
            name, description, template_type, fields, validation_rules, 
            created_by, is_active
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT DO NOTHING
          RETURNING id`,
          [
            template.name,
            template.description,
            template.template_type,
            JSON.stringify(template.fields),
            JSON.stringify(template.validation_rules),
            adminId,
            true
          ]
        );

        if (result.rows.length > 0) {
          console.log(`   ✅ Created template: ${template.name}`);
          createdCount++;
        } else {
          console.log(`   ⚠️  Template already exists: ${template.name}`);
        }
      } catch (error) {
        console.log(
          `   ❌ Error creating template ${template.name}:`,
          error.message
        );
      }
    }

    console.log('\n🎉 Paper templates initialization completed!');
    console.log(`   • ${createdCount} new templates created`);
    console.log(`   • ${templates.length} total templates available`);

    // Display summary
    const allTemplates = await pool.query(
      'SELECT name, template_type, is_active FROM paper_templates ORDER BY template_type, name'
    );

    console.log('\n📊 Available Templates:');
    allTemplates.rows.forEach((template) => {
      const status = template.is_active ? '✅' : '❌';
      console.log(`   ${status} ${template.name} (${template.template_type})`);
    });
  } catch (error) {
    console.error('❌ Error initializing paper templates:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the initialization
if (require.main === module) {
  initializePaperTemplates().catch(console.error);
}

module.exports = { initializePaperTemplates };
