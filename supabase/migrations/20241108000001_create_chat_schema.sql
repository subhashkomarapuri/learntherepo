-- Create chat sessions table to track user sessions and repository associations
CREATE TABLE IF NOT EXISTS chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Create index for fast session lookups by repository
CREATE INDEX IF NOT EXISTS idx_chat_sessions_repository_id 
    ON chat_sessions(repository_id);

-- Create index for sorting sessions by creation date
CREATE INDEX IF NOT EXISTS idx_chat_sessions_created_at 
    ON chat_sessions(created_at DESC);

-- Create chat messages table to store conversation history
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    sources JSONB,  -- Store RAG sources with citations
    metadata JSONB DEFAULT '{}'::jsonb,  -- For RAG config, model used, etc.
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for fast message retrieval by session
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id 
    ON chat_messages(session_id, created_at);

-- Create index for filtering by role
CREATE INDEX IF NOT EXISTS idx_chat_messages_role 
    ON chat_messages(role);

-- Create repository summaries table to cache generated summaries
CREATE TABLE IF NOT EXISTS repository_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    summary_json JSONB NOT NULL,
    model_used TEXT NOT NULL,
    generation_params JSONB DEFAULT '{}'::jsonb,  -- Temperature, max_tokens, etc.
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(repository_id)
);

-- Create index for fast summary lookups
CREATE INDEX IF NOT EXISTS idx_repository_summaries_repository_id 
    ON repository_summaries(repository_id);

-- Create trigger to update updated_at on chat_sessions
CREATE TRIGGER update_chat_sessions_updated_at
    BEFORE UPDATE ON chat_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create trigger to update updated_at on repository_summaries
CREATE TRIGGER update_repository_summaries_updated_at
    BEFORE UPDATE ON repository_summaries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to get chat session with repository info
CREATE OR REPLACE FUNCTION get_chat_session_info(
    session_id_param UUID
)
RETURNS TABLE (
    session_id UUID,
    repository_id UUID,
    repository_owner TEXT,
    repository_name TEXT,
    repository_ref TEXT,
    session_created_at TIMESTAMPTZ,
    message_count BIGINT,
    has_summary BOOLEAN
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        cs.id as session_id,
        r.id as repository_id,
        r.owner as repository_owner,
        r.repo as repository_name,
        r.ref as repository_ref,
        cs.created_at as session_created_at,
        COUNT(DISTINCT cm.id) as message_count,
        EXISTS(SELECT 1 FROM repository_summaries rs WHERE rs.repository_id = r.id) as has_summary
    FROM chat_sessions cs
    JOIN repositories r ON r.id = cs.repository_id
    LEFT JOIN chat_messages cm ON cm.session_id = cs.id
    WHERE cs.id = session_id_param
    GROUP BY cs.id, r.id, r.owner, r.repo, r.ref, cs.created_at;
END;
$$;

-- Function to get message count for a session
CREATE OR REPLACE FUNCTION get_session_message_count(
    session_id_param UUID
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    msg_count BIGINT;
BEGIN
    SELECT COUNT(*) INTO msg_count
    FROM chat_messages
    WHERE session_id = session_id_param;
    
    RETURN msg_count;
END;
$$;

-- Function to delete old sessions (cleanup utility)
CREATE OR REPLACE FUNCTION delete_old_chat_sessions(
    days_old INTEGER DEFAULT 30
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    WITH deleted AS (
        DELETE FROM chat_sessions
        WHERE created_at < NOW() - (days_old || ' days')::INTERVAL
        RETURNING id
    )
    SELECT COUNT(*) INTO deleted_count FROM deleted;
    
    RETURN deleted_count;
END;
$$;

-- Grant necessary permissions (adjust based on your RLS policies)
-- GRANT SELECT, INSERT, UPDATE ON chat_sessions, chat_messages, repository_summaries TO authenticated;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON chat_sessions, chat_messages, repository_summaries TO service_role;
