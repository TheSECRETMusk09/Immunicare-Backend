const fs = require('fs');
const path = require('path');

function setupDigitalPapersMock() {
  try {
    console.log('🚀 Setting up Digital Papers System (Mock Mode)...');

    // Create documents directory
    const documentsDir = path.join(__dirname, 'documents');

    if (!fs.existsSync(documentsDir)) {
      fs.mkdirSync(documentsDir, { recursive: true });
      console.log('✓ Documents directory created');
    }

    // Create mock data files for development
    const mockTemplates = [
      {
        id: 1,
        name: 'Vaccine Schedule Booklet',
        description: 'WHO-standard vaccination schedule for infants',
        template_type: 'VACCINE_SCHEDULE',
        fields: [
          {
            field: 'infant_name',
            label: 'Child Name',
            source: 'infants.full_name',
            required: true
          },
          { field: 'dob', label: 'Date of Birth', source: 'infants.dob', required: true },
          {
            field: 'vaccines',
            label: 'Vaccination Schedule',
            source: 'vaccination_schedules',
            required: true
          }
        ],
        validation_rules: { required_fields: ['infant_name', 'dob', 'vaccines'] },
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      {
        id: 2,
        name: 'Immunization Record Booklet',
        description: 'Complete immunization record for tracking vaccinations',
        template_type: 'IMMUNIZATION_RECORD',
        fields: [
          { field: 'infant_info', label: 'Infant Information', source: 'infants', required: true },
          {
            field: 'vaccination_history',
            label: 'Vaccination History',
            source: 'vaccination_records',
            required: true
          },
          {
            field: 'guardian_info',
            label: 'Guardian Information',
            source: 'guardians',
            required: true
          }
        ],
        validation_rules: {
          required_fields: ['infant_info', 'vaccination_history', 'guardian_info']
        },
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      {
        id: 3,
        name: 'Vaccine Inventory Logbook',
        description: 'Stock monitoring logbook for vaccines',
        template_type: 'INVENTORY_LOGBOOK',
        fields: [
          {
            field: 'inventory_data',
            label: 'Inventory Data',
            source: 'inventory_items',
            required: true
          },
          {
            field: 'transactions',
            label: 'Stock Transactions',
            source: 'inventory_transactions',
            required: true
          },
          { field: 'alerts', label: 'Stock Alerts', source: 'stock_alerts', required: false }
        ],
        validation_rules: { required_fields: ['inventory_data', 'transactions'] },
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      {
        id: 4,
        name: 'Growth Chart',
        description: 'Infant growth monitoring chart',
        template_type: 'GROWTH_CHART',
        fields: [
          {
            field: 'growth_records',
            label: 'Growth Records',
            source: 'growth_records',
            required: true
          },
          {
            field: 'percentiles',
            label: 'Growth Percentiles',
            source: 'calculated_percentiles',
            required: true
          },
          { field: 'alerts', label: 'Growth Alerts', source: 'growth_alerts', required: false }
        ],
        validation_rules: { required_fields: ['growth_records', 'percentiles'] },
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    ];

    // Save mock templates to JSON file
    fs.writeFileSync(
      path.join(documentsDir, 'templates.json'),
      JSON.stringify(mockTemplates, null, 2)
    );
    console.log('✓ Mock templates created successfully');

    // Create mock document generation logs
    const mockLogs = [
      {
        id: 1,
        template_id: 1,
        generation_type: 'MANUAL',
        generation_date: new Date().toISOString(),
        status: 'SUCCESS',
        generated_files: ['vaccine_schedule_1.pdf'],
        processing_time: 1500
      }
    ];

    fs.writeFileSync(
      path.join(documentsDir, 'generation_logs.json'),
      JSON.stringify(mockLogs, null, 2)
    );
    console.log('✓ Mock generation logs created successfully');

    // Create mock document downloads
    const mockDownloads = [
      {
        id: 1,
        user_id: 1,
        infant_id: 1,
        template_id: 1,
        download_type: 'PDF',
        download_date: new Date().toISOString(),
        file_path: 'documents/vaccine_schedule_1.pdf',
        download_status: 'COMPLETED',
        download_reason: 'USER_REQUEST',
        file_size: 102400
      }
    ];

    fs.writeFileSync(
      path.join(documentsDir, 'downloads.json'),
      JSON.stringify(mockDownloads, null, 2)
    );
    console.log('✓ Mock downloads created successfully');

    // Create mock completion status
    const mockCompletionStatus = [
      {
        id: 1,
        infant_id: 1,
        template_id: 1,
        completion_status: 'COMPLETED',
        last_updated: new Date().toISOString(),
        completed_by: 1,
        required_fields_count: 3,
        completed_fields_count: 3,
        completion_percentage: 100
      }
    ];

    fs.writeFileSync(
      path.join(documentsDir, 'completion_status.json'),
      JSON.stringify(mockCompletionStatus, null, 2)
    );
    console.log('✓ Mock completion status created successfully');

    console.log('\n🎉 Digital Papers System (Mock Mode) setup completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Restart your backend server');
    console.log('2. Access the new Digital Papers section in the admin dashboard');
    console.log('3. Configure document templates as needed');
    console.log('4. Test document generation and download functionality');
    console.log('\n💡 Note: This is a mock implementation for development.');
    console.log('   Database integration will be enabled when proper credentials are configured.');
  } catch (error) {
    console.error('❌ Error setting up Digital Papers System (Mock Mode):', error);
    process.exit(1);
  }
}

// Run setup if called directly
if (require.main === module) {
  setupDigitalPapersMock();
}

module.exports = { setupDigitalPapersMock };
