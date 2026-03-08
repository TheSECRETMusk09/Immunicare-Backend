-- ============================================================================
-- DEPRECATED MIGRATION FILE
-- ============================================================================
-- Status: DEPRECATED as of 2026-02-04
-- Reason: These tables are already included in backend/schema.sql
-- Canonical Source: backend/schema.sql
-- ============================================================================
-- 
-- Messages Conversation System Tables
-- These tables support the conversation-based messaging system
-- 
-- NOTE: This migration is deprecated. The conversations and conversation_participants
-- tables are already defined in backend/schema.sql.
-- 
-- DO NOT RUN THIS FILE. Use backend/schema.sql instead.
-- ============================================================================

-- Create conversations table
CREATE TABLE IF NOT EXISTS conversations (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create conversation participants table
CREATE TABLE IF NOT EXISTS conversation_participants (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON UPDATE CASCADE ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
    joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    left_at TIMESTAMP,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE(conversation_id, user_id)
);

-- Update messages table to support conversations
-- First, check if conversation_id column exists
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'messages' AND column_name = 'conversation_id'
    ) THEN
        ALTER TABLE messages ADD COLUMN conversation_id INTEGER REFERENCES conversations(id) ON UPDATE CASCADE ON DELETE CASCADE;
    END IF;
END $$;

-- Add index for faster message lookups by conversation
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

-- Create index for conversation participants
CREATE INDEX IF NOT EXISTS idx_conversation_participants_user ON conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_participants_conversation ON conversation_participants(conversation_id);

-- Add foreign key for sender_id to users if not already exists
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name LIKE 'fk_sender' AND table_name = 'messages'
    ) THEN
        ALTER TABLE messages 
        ADD CONSTRAINT fk_messages_sender 
        FOREIGN KEY (sender_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE;
    END IF;
END $$;

-- ============================================================================
-- END OF DEPRECATED MIGRATION
-- ============================================================================
