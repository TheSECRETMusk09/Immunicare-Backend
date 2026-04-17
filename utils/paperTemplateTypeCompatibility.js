const normalizePaperTemplateType = (value) => {
  if (value === null || value === undefined) {
    return "";
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return "";
  }

  return normalized
    .replace(/[\s-]+/g, "_")
    .replace(/__+/g, "_")
    .toUpperCase();
};

const getPaperTemplateTypeDisplayName = (value) => {
  const normalized = normalizePaperTemplateType(value);
  if (!normalized) {
    return "Document";
  }

  return normalized
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const getPaperTemplateTypeSlug = (value) =>
  normalizePaperTemplateType(value).toLowerCase();

module.exports = {
  getPaperTemplateTypeDisplayName,
  getPaperTemplateTypeSlug,
  normalizePaperTemplateType,
};
