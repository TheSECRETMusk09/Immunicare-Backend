const express = require('express');
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
const socketService = require('../services/socketService');

const router = express.Router();

// Middleware to authenticate all message routes
router.use(authenticateToken);

const isMissingMessagesSchemaError = (error) => {
  const code = error?.code;
  const message = String(error?.message || '').toLowerCase();
  // 42P01 = undefined_table, 42703 = undefined_column
  return code === '42P01' || code === '42703' || message.includes('does not exist');
};

const respondSchemaFallback = (res, payload) => {
  res.json({
    success: true,
    ...payload,
    _warning: 'messages_schema_unavailable',
  });
};

// Root messages endpoint - returns API info
router.get('/', async (req, res) => {
  res.json({
    success: true,
    message: 'Messages API is running',
    endpoints: [
      'GET /conversations - Get all conversations',
      'GET /conversation/:conversationId - Get messages for a conversation',
      'GET /user/:userId - Get messages with a specific user',
      'GET /unread-count - Get unread message count',
      'POST / - Send a new message',
      'PUT /conversation/:conversationId/read - Mark conversation as read',
      'PUT /:messageId/read - Mark a message as read',
    ],
  });
});

// Get all conversations for current user
router.get('/conversations', async (req, res) => {
  try {
    const userId = req.user.id;

    // Get conversations with other user info and last message
    const result = await pool.query(
      `
      WITH latest_messages AS (
        SELECT DISTINCT ON (c.id)
          c.id as conversation_id,
          m.id as last_message_id,
          m.subject as last_message_subject,
          m.content as last_message_content,
          m.priority as last_message_priority,
          m.created_at as last_message_at,
          m.sender_id
        FROM conversations c
        JOIN conversation_participants cp ON c.id = cp.conversation_id
        JOIN messages m ON c.id = m.conversation_id
        WHERE cp.admin_id = $1
        ORDER BY c.id, m.created_at DESC
      ),
      unread_counts AS (
        SELECT
          c.id as conversation_id,
          COUNT(m.id) as unread_count
        FROM conversations c
        JOIN conversation_participants cp ON c.id = cp.conversation_id
        LEFT JOIN messages m ON c.id = m.conversation_id
          AND m.sender_id != $1
          AND m.read_at IS NULL
        WHERE cp.admin_id = $1
        GROUP BY c.id
      ),
      other_users AS (
        SELECT DISTINCT ON (c.id)
          c.id as conversation_id,
          a.id as other_user_id,
          a.username as other_user_name,
          a.username as other_user_full_name,
          null as other_user_avatar
        FROM conversations c
        JOIN conversation_participants cp ON c.id = cp.conversation_id
        JOIN admin a ON cp.admin_id = a.id
        WHERE cp.admin_id != $1
        ORDER BY c.id, cp.admin_id
      )
      SELECT
        lm.conversation_id,
        ou.other_user_id,
        ou.other_user_name,
        ou.other_user_full_name,
        ou.other_user_avatar,
        lm.last_message_subject,
        lm.last_message_content,
        lm.last_message_priority,
        lm.last_message_at,
        COALESCE(uc.unread_count, 0) as unread_count
      FROM latest_messages lm
      JOIN other_users ou ON lm.conversation_id = ou.conversation_id
      LEFT JOIN unread_counts uc ON lm.conversation_id = uc.conversation_id
      ORDER BY lm.last_message_at DESC
      `,
      [userId],
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    if (isMissingMessagesSchemaError(error)) {
      return respondSchemaFallback(res, { data: [] });
    }
    res.status(500).json({
      success: false,
      error: 'Failed to fetch conversations',
    });
  }
});

// Get messages for a conversation
router.get('/conversation/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;

    // Verify user is a participant in this conversation
    const participantCheck = await pool.query(
      'SELECT id FROM conversation_participants WHERE conversation_id = $1 AND admin_id = $2',
      [conversationId, userId],
    );

    if (participantCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this conversation',
      });
    }

    // Get messages
    const result = await pool.query(
      `
       SELECT m.*,
              a.username as sender_username,
              a.username as sender_name,
              null as sender_avatar
       FROM messages m
       JOIN admin a ON m.sender_id = a.id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC
      `,
      [conversationId],
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    if (isMissingMessagesSchemaError(error)) {
      return respondSchemaFallback(res, { data: [] });
    }
    res.status(500).json({
      success: false,
      error: 'Failed to fetch messages',
    });
  }
});

// Mark conversation as read
router.put('/conversation/:conversationId/read', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;

    // Verify user is a participant
    const participantCheck = await pool.query(
      'SELECT id FROM conversation_participants WHERE conversation_id = $1 AND admin_id = $2',
      [conversationId, userId],
    );

    if (participantCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    // Mark all unread messages as read
    await pool.query(
      `
      UPDATE messages
      SET read_at = CURRENT_TIMESTAMP
      WHERE conversation_id = $1
        AND sender_id != $2
        AND read_at IS NULL
      `,
      [conversationId, userId],
    );

    socketService.sendToUser(userId, 'conversation_read', { conversationId });
    res.json({
      success: true,
      message: 'Messages marked as read',
    });
  } catch (error) {
    console.error('Error marking messages as read:', error);
    if (isMissingMessagesSchemaError(error)) {
      return respondSchemaFallback(res, { message: 'Messages marked as read' });
    }
    res.status(500).json({
      success: false,
      error: 'Failed to mark messages as read',
    });
  }
});

// Send a new message
router.post('/', async (req, res) => {
  try {
    const {
      recipient_id,
      subject,
      content,
      priority = 'normal',
      conversation_id,
    } = req.body;
    const senderId = req.user.id;

    let conversationId = conversation_id;

    // If no existing conversation, create a new one
    if (!conversationId) {
      // Check if a conversation already exists between these users
      const existingConv = await pool.query(
        `
        SELECT c.id FROM conversations c
        JOIN conversation_participants cp1 ON c.id = cp1.conversation_id
        JOIN conversation_participants cp2 ON c.id = cp2.conversation_id
        WHERE cp1.admin_id = $1 AND cp2.admin_id = $2
        LIMIT 1
        `,
        [senderId, recipient_id],
      );

      if (existingConv.rows.length > 0) {
        conversationId = existingConv.rows[0].id;
      } else {
        // Create new conversation
        const newConv = await pool.query('INSERT INTO conversations DEFAULT VALUES RETURNING id');
        conversationId = newConv.rows[0].id;

        // Add participants
        await pool.query(
          'INSERT INTO conversation_participants (conversation_id, admin_id) VALUES ($1, $2), ($1, $3)',
          [conversationId, senderId, recipient_id],
        );
      }
    }

    // Create the message
    const result = await pool.query(
      `
      INSERT INTO messages (conversation_id, sender_id, subject, content, priority)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [conversationId, senderId, subject, content, priority],
    );

    const message = result.rows[0];

    // Add sender info
    const senderResult = await pool.query(
      'SELECT username FROM admin WHERE id = $1',
      [senderId],
    );
    const sender = senderResult.rows[0];
    message.sender_username = sender.username;
    message.sender_name = sender.username;
    message.sender_avatar = null;

    // Notify recipient and sender (for multi-device sync)
    socketService.sendToUser(recipient_id, 'new_message', message);
    socketService.sendToUser(senderId, 'message_sent', message);

    res.status(201).json({
      success: true,
      data: message,
      conversation_id: conversationId,
    });
  } catch (error) {
    console.error('Error sending message:', error);
    if (isMissingMessagesSchemaError(error)) {
      return res.status(503).json({
        success: false,
        error: 'Messaging is currently unavailable',
        code: 'MESSAGING_SCHEMA_UNAVAILABLE',
      });
    }
    res.status(500).json({
      success: false,
      error: 'Failed to send message',
    });
  }
});

// Get messages by user (legacy endpoint)
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.id;

    // This endpoint returns conversations with the specified user
    const result = await pool.query(
      `
      WITH conversation AS (
        SELECT c.id
        FROM conversations c
        JOIN conversation_participants cp1 ON c.id = cp1.conversation_id
        JOIN conversation_participants cp2 ON c.id = cp2.conversation_id
        WHERE cp1.admin_id = $1 AND cp2.admin_id = $2
        LIMIT 1
      )
      SELECT
        m.*,
        a.username as sender_username,
        a.username as sender_name,
        null as sender_avatar
      FROM messages m
      JOIN admin a ON m.sender_id = a.id
      WHERE m.conversation_id = (SELECT id FROM conversation)
      ORDER BY m.created_at ASC
      `,
      [currentUserId, userId],
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('Error fetching user messages:', error);
    if (isMissingMessagesSchemaError(error)) {
      return respondSchemaFallback(res, { data: [] });
    }
    res.status(500).json({
      success: false,
      error: 'Failed to fetch messages',
    });
  }
});

// Mark a single message as read
router.put('/:messageId/read', async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;

    // Verify user is participant in the conversation
    const messageCheck = await pool.query(
      `SELECT m.id FROM messages m
       JOIN conversation_participants cp ON m.conversation_id = cp.conversation_id
       WHERE m.id = $1 AND cp.admin_id = $2`,
      [messageId, userId],
    );

    if (messageCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    await pool.query('UPDATE messages SET read_at = CURRENT_TIMESTAMP WHERE id = $1', [messageId]);

    socketService.sendToUser(userId, 'message_read', { messageId });
    res.json({
      success: true,
      message: 'Message marked as read',
    });
  } catch (error) {
    console.error('Error marking message as read:', error);
    if (isMissingMessagesSchemaError(error)) {
      return respondSchemaFallback(res, { message: 'Message marked as read' });
    }
    res.status(500).json({
      success: false,
      error: 'Failed to mark message as read',
    });
  }
});

// Get unread message count
router.get('/unread-count', async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `
      SELECT COUNT(m.id) as unread_count
      FROM messages m
      JOIN conversation_participants cp ON m.conversation_id = cp.conversation_id
      WHERE cp.admin_id = $1 AND m.sender_id != $1 AND m.read_at IS NULL
      `,
      [userId],
    );

    res.json({
      success: true,
      data: {
        unreadCount: parseInt(result.rows[0].unread_count),
      },
    });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    if (isMissingMessagesSchemaError(error)) {
      return respondSchemaFallback(res, { data: { unreadCount: 0 } });
    }
    res.status(500).json({
      success: false,
      error: 'Failed to fetch unread count',
    });
  }
});

module.exports = router;
