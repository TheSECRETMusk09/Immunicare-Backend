const normalizePaperTemplateFields = (rawFields) => {
  if (Array.isArray(rawFields)) {
    return rawFields;
  }

  if (!rawFields) {
    return [];
  }

  if (typeof rawFields === 'string') {
    const trimmed = rawFields.trim();
    if (!trimmed) {
      return [];
    }

    try {
      return normalizePaperTemplateFields(JSON.parse(trimmed));
    } catch (_error) {
      return [];
    }
  }

  if (typeof rawFields === 'object') {
    if (Array.isArray(rawFields.fields)) {
      return rawFields.fields;
    }

    if (Array.isArray(rawFields.data)) {
      return rawFields.data;
    }

    if (Array.isArray(rawFields.items)) {
      return rawFields.items;
    }

    if (
      Object.prototype.hasOwnProperty.call(rawFields, 'field') ||
      Object.prototype.hasOwnProperty.call(rawFields, 'label') ||
      Object.prototype.hasOwnProperty.call(rawFields, 'source') ||
      Object.prototype.hasOwnProperty.call(rawFields, 'required')
    ) {
      return [rawFields];
    }
  }

  return [];
};

const normalizePaperTemplateRecord = (template = {}) => {
  if (!template || typeof template !== 'object') {
    return template;
  }

  return {
    ...template,
    fields: normalizePaperTemplateFields(template.fields),
  };
};

module.exports = {
  normalizePaperTemplateFields,
  normalizePaperTemplateRecord,
};
