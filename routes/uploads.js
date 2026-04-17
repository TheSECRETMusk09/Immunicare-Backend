const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { authenticateToken } = require('../middleware/auth');
const { resolveStorageRoot } = require('../utils/runtimeStorage');

// Ensure upload directory exists
const uploadDir = resolveStorageRoot('uploads');
const ensureUploadDirectory = async () => {
  try {
    await fs.access(uploadDir);
  } catch (error) {
    try {
      await fs.mkdir(uploadDir, { recursive: true });
    } catch (_mkdirError) {
      // Ignore directory bootstrap failures in read-only/serverless runtimes.
    }
  }
};
ensureUploadDirectory();

const METADATA_SUFFIX = '.metadata.json';
const STAFF_UPLOAD_ROLES = new Set([
  'admin',
  'administrator',
  'system_admin',
  'super_admin',
  'clinic_manager',
  'doctor',
  'nurse',
  'staff',
]);

const getSafeFilename = (filename = '') => path.basename(String(filename || ''));

const isMetadataFilename = (filename = '') => String(filename || '').endsWith(METADATA_SUFFIX);

const getUserRole = (req) =>
  String(req.user?.role_name || req.user?.role || req.user?.type || '')
    .trim()
    .toLowerCase();

const isStaffUploadRole = (req) => STAFF_UPLOAD_ROLES.has(getUserRole(req));

const getUploadMetadataPath = (filename) => path.join(uploadDir, `${filename}${METADATA_SUFFIX}`);

const writeUploadMetadata = async (req, file) => {
  const metadata = {
    filename: file.filename,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    user_id: req.user?.id || null,
    guardian_id: req.user?.guardian_id || null,
    role: getUserRole(req) || null,
    uploaded_at: new Date().toISOString(),
  };

  await fs.writeFile(getUploadMetadataPath(file.filename), JSON.stringify(metadata, null, 2));
  return metadata;
};

const readUploadMetadata = async (filename) => {
  try {
    const rawMetadata = await fs.readFile(getUploadMetadataPath(filename), 'utf8');
    return JSON.parse(rawMetadata);
  } catch (_error) {
    return null;
  }
};

const canAccessUpload = (req, metadata) => {
  if (isStaffUploadRole(req)) {
    return true;
  }

  if (!metadata) {
    return false;
  }

  const requestUserId = req.user?.id !== undefined && req.user?.id !== null
    ? String(req.user.id)
    : null;
  const requestGuardianId =
    req.user?.guardian_id !== undefined && req.user?.guardian_id !== null
      ? String(req.user.guardian_id)
      : null;

  return (
    (requestUserId && metadata.user_id !== undefined && String(metadata.user_id) === requestUserId) ||
    (requestGuardianId &&
      metadata.guardian_id !== undefined &&
      String(metadata.guardian_id) === requestGuardianId)
  );
};

const respondForbiddenUpload = (res) =>
  res.status(403).json({
    success: false,
    message: 'You do not have access to this file',
  });

// Multer configuration for file storage
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    await ensureUploadDirectory();
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename with timestamp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    const filename = `${path.basename(file.originalname, ext)}_${uniqueSuffix}${ext}`;
    cb(null, filename);
  }
});

// File validation
const fileFilter = (req, file, cb) => {
  // Allow common file types
  const allowedTypes = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Allowed types: PDF, JPEG, PNG, DOC, DOCX, XLS, XLSX'), false);
  }
};

// Multer instance
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Upload single file
router.post('/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    await writeUploadMetadata(req, req.file);

    res.json({
      success: true,
      message: 'File uploaded successfully',
      data: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype,
        path: req.file.path,
        downloadUrl: `/api/uploads/download/${req.file.filename}`
      }
    });
  } catch (error) {
    console.error('File upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload file',
      error: error.message
    });
  }
});

// Upload multiple files
router.post('/upload-multiple', authenticateToken, upload.array('files', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded'
      });
    }

    await Promise.all(req.files.map((file) => writeUploadMetadata(req, file)));

    const files = req.files.map((file) => ({
      filename: file.filename,
      originalName: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
      path: file.path,
      downloadUrl: `/api/uploads/download/${file.filename}`
    }));

    res.json({
      success: true,
      message: `${req.files.length} files uploaded successfully`,
      data: files
    });
  } catch (error) {
    console.error('Multiple file upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload files',
      error: error.message
    });
  }
});

// Download file
router.get('/download/:filename', authenticateToken, async (req, res) => {
  try {
    const filename = getSafeFilename(req.params.filename);
    if (!filename || isMetadataFilename(filename)) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    const filePath = path.join(uploadDir, filename);

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    const metadata = await readUploadMetadata(filename);
    if (!canAccessUpload(req, metadata)) {
      return respondForbiddenUpload(res);
    }

    // Get file stats
    const stats = await fs.stat(filePath);
    const fileBuffer = await fs.readFile(filePath);

    // Set appropriate headers
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    res.send(fileBuffer);
  } catch (error) {
    console.error('File download error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download file',
      error: error.message
    });
  }
});

// Get file info
router.get('/info/:filename', authenticateToken, async (req, res) => {
  try {
    const filename = getSafeFilename(req.params.filename);
    if (!filename || isMetadataFilename(filename)) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    const filePath = path.join(uploadDir, filename);

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    const metadata = await readUploadMetadata(filename);
    if (!canAccessUpload(req, metadata)) {
      return respondForbiddenUpload(res);
    }

    // Get file stats
    const stats = await fs.stat(filePath);

    res.json({
      success: true,
      data: {
        filename: filename,
        size: stats.size,
        createdAt: stats.birthtime.toISOString(),
        modifiedAt: stats.mtime.toISOString(),
        downloadUrl: `/api/uploads/download/${filename}`
      }
    });
  } catch (error) {
    console.error('File info error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get file info',
      error: error.message
    });
  }
});

// List all uploaded files
router.get('/list', authenticateToken, async (req, res) => {
  try {
    const files = await fs.readdir(uploadDir);
    const fileInfos = [];

    for (const filename of files) {
      if (isMetadataFilename(filename)) {
        continue;
      }

      const metadata = await readUploadMetadata(filename);
      if (!canAccessUpload(req, metadata)) {
        continue;
      }

      const filePath = path.join(uploadDir, filename);
      const stats = await fs.stat(filePath);
      fileInfos.push({
        filename: filename,
        size: stats.size,
        createdAt: stats.birthtime.toISOString(),
        modifiedAt: stats.mtime.toISOString(),
        downloadUrl: `/api/uploads/download/${filename}`
      });
    }

    res.json({
      success: true,
      data: fileInfos
    });
  } catch (error) {
    console.error('List files error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to list files',
      error: error.message
    });
  }
});

// Delete file
router.delete('/delete/:filename', authenticateToken, async (req, res) => {
  try {
    const filename = getSafeFilename(req.params.filename);
    if (!filename || isMetadataFilename(filename)) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    const filePath = path.join(uploadDir, filename);

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    const metadata = await readUploadMetadata(filename);
    if (!canAccessUpload(req, metadata)) {
      return respondForbiddenUpload(res);
    }

    await fs.unlink(filePath);
    await fs.unlink(getUploadMetadataPath(filename)).catch(() => {});

    res.json({
      success: true,
      message: 'File deleted successfully'
    });
  } catch (error) {
    console.error('File delete error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete file',
      error: error.message
    });
  }
});

// Handle multer errors
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File size exceeds 10MB limit'
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        message: 'Too many files uploaded'
      });
    }
  }
  next(error);
});

module.exports = router;
