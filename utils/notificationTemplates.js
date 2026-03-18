/**
 * Notification Templates
 * Template system for generating standardized notifications
 */

// Template structure for different notification types
const NOTIFICATION_TEMPLATES = {
  transfer_in_submitted: {
    title: 'Transfer-In Submitted',
    body: 'Your child\'s previous vaccines were recorded. We\'re processing the information.',
    type: 'info',
    priority: 'normal',
  },
  next_vaccine_computed: {
    title: 'Next Vaccine Computed',
    body: 'The next vaccine due is {{vaccineName}}.',
    type: 'info',
    priority: 'normal',
  },
  appointment_suggested: {
    title: 'Appointment Suggested',
    body: 'Your next visit is suggested for {{date}} at {{time}}.',
    type: 'info',
    priority: 'normal',
  },
  vaccine_overdue: {
    title: 'Vaccine Overdue Warning',
    body: 'Your child\'s {{vaccineName}} vaccine is overdue by {{daysOverdue}} days.',
    type: 'warning',
    priority: 'high',
  },
  missed_appointment: {
    title: 'Missed Appointment',
    body: 'Your child missed a scheduled appointment on {{date}}.',
    type: 'warning',
    priority: 'high',
  },
  stock_unavailable: {
    title: 'Stock Unavailable',
    body: 'The {{vaccineName}} vaccine is currently unavailable. We\'ll notify you when it\'s back in stock.',
    type: 'error',
    priority: 'high',
  },
};

/**
 * Render a notification template with variable substitution
 * @param {string} templateKey - Key of the template to use
 * @param {Object} variables - Variables to substitute in the template
 * @returns {Object} Rendered notification
 */
function renderNotification(templateKey, variables = {}) {
  const template = NOTIFICATION_TEMPLATES[templateKey];

  if (!template) {
    console.warn(`Notification template not found: ${templateKey}`);
    return {
      title: 'Notification',
      body: 'Notification content not available.',
      type: 'info',
      priority: 'normal',
    };
  }

  // Simple variable substitution
  const renderTemplate = (text, vars) => {
    return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return vars[key] !== undefined ? vars[key] : match;
    });
  };

  return {
    title: renderTemplate(template.title, variables),
    body: renderTemplate(template.body, variables),
    type: template.type,
    priority: template.priority,
  };
}

/**
 * Get all available notification templates
 * @returns {Object} All notification templates
 */
function getNotificationTemplates() {
  return { ...NOTIFICATION_TEMPLATES };
}

module.exports = {
  renderNotification,
  getNotificationTemplates,
};
