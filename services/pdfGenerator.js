const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs').promises;

class PDFGenerator {
  constructor() {
    this.templates = {
      VACCINE_SCHEDULE: this.generateVaccineSchedule,
      IMMUNIZATION_RECORD: this.generateImmunizationRecord,
      INVENTORY_LOGBOOK: this.generateInventoryLogbook,
      GROWTH_CHART: this.generateGrowthChart
    };
  }

  async generatePDF(templateType, data, options = {}) {
    try {
      if (!this.templates[templateType]) {
        throw new Error(`Template type ${templateType} not supported`);
      }

      const html = await this.templates[templateType](data);
      const pdfBuffer = await this.htmlToPDF(html, options);

      return {
        success: true,
        buffer: pdfBuffer,
        filename: this.generateFilename(templateType, data)
      };
    } catch (error) {
      console.error('PDF generation error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async htmlToPDF(html, options = {}) {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
      const page = await browser.newPage();

      // Set viewport and content
      await page.setViewport({ width: 800, height: 600 });
      await page.setContent(html, { waitUntil: 'networkidle0' });

      // Generate PDF
      const pdfBuffer = await page.pdf({
        format: options.format || 'A4',
        printBackground: true,
        margin: {
          top: '20px',
          bottom: '20px',
          left: '20px',
          right: '20px'
        }
      });

      return pdfBuffer;
    } finally {
      await browser.close();
    }
  }

  async generateVaccineSchedule(data) {
    const { infant, vaccinations, schedule } = data;

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Vaccine Schedule</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
        .header { text-align: center; margin-bottom: 30px; }
        .title { font-size: 24px; font-weight: bold; margin-bottom: 10px; }
        .subtitle { font-size: 16px; color: #666; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 30px; }
        .info-card { background: #f8f9fa; padding: 15px; border-radius: 8px; }
        .info-label { font-weight: bold; color: #333; }
        .info-value { margin-top: 5px; color: #666; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
        th { background-color: #f2f2f2; font-weight: bold; }
        .footer { margin-top: 30px; font-size: 12px; color: #666; text-align: center; }
    </style>
</head>
<body>
    <div class="header">
        <div class="title">VACCINE SCHEDULE</div>
        <div class="subtitle">Immunization Schedule for ${infant.first_name} ${
  infant.last_name
}</div>
    </div>

    <div class="info-grid">
        <div class="info-card">
            <div class="info-label">Infant Name:</div>
            <div class="info-value">${infant.first_name} ${
  infant.last_name
}</div>
        </div>
        <div class="info-card">
            <div class="info-label">Date of Birth:</div>
            <div class="info-value">${new Date(
    infant.dob
  ).toLocaleDateString()}</div>
        </div>
        <div class="info-card">
            <div class="info-label">Age:</div>
            <div class="info-value">${this.calculateAge(
    infant.dob
  )} months</div>
        </div>
        <div class="info-card">
            <div class="info-label">Generated:</div>
            <div class="info-value">${new Date().toLocaleDateString()}</div>
        </div>
    </div>

    <table>
        <thead>
            <tr>
                <th>Age</th>
                <th>Vaccine</th>
                <th>Dose</th>
                <th>Status</th>
                <th>Date Administered</th>
                <th>Next Due</th>
            </tr>
        </thead>
        <tbody>
            ${this.generateVaccineScheduleRows(schedule, vaccinations)}
        </tbody>
    </table>

    <div class="footer">
        This schedule is based on the Philippine Department of Health immunization guidelines.
        Please consult with your healthcare provider for any questions or concerns.
    </div>
</body>
</html>
    `;
  }

  async generateImmunizationRecord(data) {
    const { infant, vaccinations, guardian } = data;

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Immunization Record</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
        .header { text-align: center; margin-bottom: 30px; }
        .title { font-size: 24px; font-weight: bold; margin-bottom: 10px; }
        .subtitle { font-size: 16px; color: #666; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 30px; }
        .info-card { background: #f8f9fa; padding: 15px; border-radius: 8px; }
        .info-label { font-weight: bold; color: #333; }
        .info-value { margin-top: 5px; color: #666; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
        th { background-color: #f2f2f2; font-weight: bold; }
        .footer { margin-top: 30px; font-size: 12px; color: #666; text-align: center; }
        .signature { margin-top: 40px; display: flex; justify-content: space-between; }
        .signature-line { width: 40%; border-top: 1px solid #000; padding-top: 5px; text-align: center; }
    </style>
</head>
<body>
    <div class="header">
        <div class="title">IMMUNIZATION RECORD</div>
        <div class="subtitle">Complete Vaccination History for ${
  infant.first_name
} ${infant.last_name}</div>
    </div>

    <div class="info-grid">
        <div class="info-card">
            <div class="info-label">Infant Name:</div>
            <div class="info-value">${infant.first_name} ${
  infant.last_name
}</div>
        </div>
        <div class="info-card">
            <div class="info-label">Date of Birth:</div>
            <div class="info-value">${new Date(
    infant.dob
  ).toLocaleDateString()}</div>
        </div>
        <div class="info-card">
            <div class="info-label">Sex:</div>
            <div class="info-value">${
  infant.sex === 'M' ? 'Male' : 'Female'
}</div>
        </div>
        <div class="info-card">
            <div class="info-label">Guardian:</div>
            <div class="info-value">${guardian ? guardian.name : 'N/A'}</div>
        </div>
    </div>

    <table>
        <thead>
            <tr>
                <th>Date</th>
                <th>Vaccine</th>
                <th>Dose</th>
                <th>Lot Number</th>
                <th>Administered By</th>
                <th>Notes</th>
            </tr>
        </thead>
        <tbody>
            ${this.generateImmunizationRecordRows(vaccinations)}
        </tbody>
    </table>

    <div class="signature">
        <div class="signature-line">
            Guardian Signature<br>
            Date: ___________
        </div>
        <div class="signature-line">
            Healthcare Provider Signature<br>
            Date: ___________
        </div>
    </div>

    <div class="footer">
        This record is an official document of the immunization history.
        Keep this record safe and bring it to all healthcare visits.
    </div>
</body>
</html>
    `;
  }

  async generateInventoryLogbook(data) {
    const { inventory, transactions, clinic } = data;

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Inventory Logbook</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
        .header { text-align: center; margin-bottom: 30px; }
        .title { font-size: 24px; font-weight: bold; margin-bottom: 10px; }
        .subtitle { font-size: 16px; color: #666; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 30px; }
        .info-card { background: #f8f9fa; padding: 15px; border-radius: 8px; }
        .info-label { font-weight: bold; color: #333; }
        .info-value { margin-top: 5px; color: #666; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
        th { background-color: #f2f2f2; font-weight: bold; }
        .footer { margin-top: 30px; font-size: 12px; color: #666; text-align: center; }
    </style>
</head>
<body>
    <div class="header">
        <div class="title">VACCINE INVENTORY LOGBOOK</div>
        <div class="subtitle">${
  clinic ? clinic.name : 'Health Center'
} - ${new Date().toLocaleDateString()}</div>
    </div>

    <div class="info-grid">
        <div class="info-card">
            <div class="info-label">Period:</div>
            <div class="info-value">${data.period || 'Current Month'}</div>
        </div>
        <div class="info-card">
            <div class="info-label">Generated:</div>
            <div class="info-value">${new Date().toLocaleDateString()}</div>
        </div>
    </div>

    <h3>Current Inventory</h3>
    <table>
        <thead>
            <tr>
                <th>Vaccine</th>
                <th>Beginning Balance</th>
                <th>Received</th>
                <th>Issued</th>
                <th>Stock on Hand</th>
                <th>Status</th>
            </tr>
        </thead>
        <tbody>
            ${this.generateInventoryRows(inventory)}
        </tbody>
    </table>

    <h3>Transaction History</h3>
    <table>
        <thead>
            <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Vaccine</th>
                <th>Quantity</th>
                <th>Lot Number</th>
                <th>Performed By</th>
                <th>Notes</th>
            </tr>
        </thead>
        <tbody>
            ${this.generateTransactionRows(transactions)}
        </tbody>
    </table>

    <div class="footer">
        This logbook tracks all vaccine inventory movements for compliance and audit purposes.
    </div>
</body>
</html>
    `;
  }

  async generateGrowthChart(data) {
    const { infant, growthRecords } = data;

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Growth Chart</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
        .header { text-align: center; margin-bottom: 30px; }
        .title { font-size: 24px; font-weight: bold; margin-bottom: 10px; }
        .subtitle { font-size: 16px; color: #666; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 30px; }
        .info-card { background: #f8f9fa; padding: 15px; border-radius: 8px; }
        .info-label { font-weight: bold; color: #333; }
        .info-value { margin-top: 5px; color: #666; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
        th { background-color: #f2f2f2; font-weight: bold; }
        .footer { margin-top: 30px; font-size: 12px; color: #666; text-align: center; }
    </style>
</head>
<body>
    <div class="header">
        <div class="title">GROWTH CHART</div>
        <div class="subtitle">Growth Monitoring for ${infant.first_name} ${
  infant.last_name
}</div>
    </div>

    <div class="info-grid">
        <div class="info-card">
            <div class="info-label">Infant Name:</div>
            <div class="info-value">${infant.first_name} ${
  infant.last_name
}</div>
        </div>
        <div class="info-card">
            <div class="info-label">Date of Birth:</div>
            <div class="info-value">${new Date(
    infant.dob
  ).toLocaleDateString()}</div>
        </div>
        <div class="info-card">
            <div class="info-label">Sex:</div>
            <div class="info-value">${
  infant.sex === 'M' ? 'Male' : 'Female'
}</div>
        </div>
        <div class="info-card">
            <div class="info-label">Generated:</div>
            <div class="info-value">${new Date().toLocaleDateString()}</div>
        </div>
    </div>

    <table>
        <thead>
            <tr>
                <th>Date</th>
                <th>Age (Months)</th>
                <th>Weight (kg)</th>
                <th>Height (cm)</th>
                <th>Head Circumference (cm)</th>
                <th>Temperature (°C)</th>
                <th>Health Status</th>
            </tr>
        </thead>
        <tbody>
            ${this.generateGrowthRows(growthRecords)}
        </tbody>
    </table>

    <div class="footer">
        Regular growth monitoring helps ensure healthy development.
        Consult your healthcare provider for any concerns about growth patterns.
    </div>
</body>
</html>
    `;
  }

  // Helper methods
  calculateAge(dob) {
    const birthDate = new Date(dob);
    const today = new Date();
    const ageInMonths =
      (today.getFullYear() - birthDate.getFullYear()) * 12 +
      (today.getMonth() - birthDate.getMonth());
    return ageInMonths;
  }

  generateVaccineScheduleRows(schedule, vaccinations) {
    if (!schedule || schedule.length === 0) {
      return '<tr><td colspan="6">No schedule data available</td></tr>';
    }

    return schedule
      .map((item) => {
        const administered = vaccinations.find(
          (v) =>
            v.vaccine_name === item.vaccine_name &&
            v.dose_no === item.dose_number
        );

        return `
        <tr>
          <td>${item.target_age_months} months</td>
          <td>${item.vaccine_name}</td>
          <td>${item.dose_number}</td>
          <td>${administered ? '✓ Administered' : '○ Pending'}</td>
          <td>${
  administered
    ? new Date(administered.admin_date).toLocaleDateString()
    : '-'
}</td>
          <td>${item.next_due_date || '-'}</td>
        </tr>
      `;
      })
      .join('');
  }

  generateImmunizationRecordRows(vaccinations) {
    if (!vaccinations || vaccinations.length === 0) {
      return '<tr><td colspan="6">No vaccination records available</td></tr>';
    }

    return vaccinations
      .map(
        (v) => `
      <tr>
        <td>${new Date(v.admin_date).toLocaleDateString()}</td>
        <td>${v.vaccine_name || v.vaccine_code}</td>
        <td>${v.dose_no}</td>
        <td>${v.batch_number || '-'}</td>
        <td>${v.administered_by || 'Healthcare Worker'}</td>
        <td>${v.notes || '-'}</td>
      </tr>
    `
      )
      .join('');
  }

  generateInventoryRows(inventory) {
    if (!inventory || inventory.length === 0) {
      return '<tr><td colspan="6">No inventory data available</td></tr>';
    }

    return inventory
      .map(
        (item) => `
      <tr>
        <td>${item.vaccine_name}</td>
        <td>${item.beginning_balance}</td>
        <td>${item.received_during_period}</td>
        <td>${item.issued}</td>
        <td>${item.stock_on_hand}</td>
        <td>${
  item.is_low_stock
    ? '⚠ Low Stock'
    : item.is_critical_stock
      ? '🚨 Critical'
      : '✓ OK'
}</td>
      </tr>
    `
      )
      .join('');
  }

  generateTransactionRows(transactions) {
    if (!transactions || transactions.length === 0) {
      return '<tr><td colspan="7">No transaction data available</td></tr>';
    }

    return transactions
      .map(
        (t) => `
      <tr>
        <td>${new Date(t.created_at).toLocaleDateString()}</td>
        <td>${t.transaction_type}</td>
        <td>${t.vaccine_name}</td>
        <td>${t.quantity}</td>
        <td>${t.lot_number || '-'}</td>
        <td>${t.performed_by_name || 'Staff'}</td>
        <td>${t.notes || '-'}</td>
      </tr>
    `
      )
      .join('');
  }

  generateGrowthRows(growthRecords) {
    if (!growthRecords || growthRecords.length === 0) {
      return '<tr><td colspan="7">No growth records available</td></tr>';
    }

    return growthRecords
      .map(
        (g) => `
      <tr>
        <td>${new Date(g.measurement_date).toLocaleDateString()}</td>
        <td>${Math.floor(g.age_in_days / 30)}</td>
        <td>${g.weight_kg}</td>
        <td>${g.length_cm}</td>
        <td>${g.head_circumference_cm || '-'}</td>
        <td>${g.temperature_celsius || '-'}</td>
        <td>${g.health_status}</td>
      </tr>
    `
      )
      .join('');
  }

  generateFilename(templateType, data) {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const infantName = data.infant
      ? `${data.infant.first_name}_${data.infant.last_name}`
      : 'document';

    const filenameMap = {
      VACCINE_SCHEDULE: `vaccine_schedule_${infantName}_${timestamp}.pdf`,
      IMMUNIZATION_RECORD: `immunization_record_${infantName}_${timestamp}.pdf`,
      INVENTORY_LOGBOOK: `inventory_logbook_${timestamp}.pdf`,
      GROWTH_CHART: `growth_chart_${infantName}_${timestamp}.pdf`
    };

    return filenameMap[templateType] || `document_${timestamp}.pdf`;
  }
}

module.exports = PDFGenerator;
