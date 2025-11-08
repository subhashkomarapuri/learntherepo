-- Enable pgvector extension for vector similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Create repositories table to track GitHub repos
CREATE TABLE IF NOT EXISTS repositories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner TEXT NOT NULL,
    repo TEXT NOT NULL,
    ref TEXT NOT NULL DEFAULT 'main',
    url TEXT NOT NULL,
    last_processed_at TIMESTAMPTZ DEFAULT NOW(),
    total_documents INTEGER DEFAULT 0,
    total_chunks INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(owner, repo, ref)
);

-- Create index for fast repo lookups
CREATE INDEX IF NOT EXISTS idx_repositories_owner_repo_ref 
    ON repositories(owner, repo, ref);

-- Create documents table to store raw markdown content
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    anchor_text TEXT,
    content TEXT NOT NULL,
    content_length INTEGER,
    source_type TEXT NOT NULL CHECK (source_type IN ('readme', 'documentation')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(repository_id, url)
);

-- Create index for fast document lookups by repository
CREATE INDEX IF NOT EXISTS idx_documents_repository_id 
    ON documents(repository_id);

-- Create index for document source type filtering
CREATE INDEX IF NOT EXISTS idx_documents_source_type 
    ON documents(source_type);

-- Create document_chunks table to store text chunks
CREATE TABLE IF NOT EXISTS document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    chunk_text TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    chunk_length INTEGER,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(document_id, chunk_index)
);

-- Create indexes for fast chunk lookups
CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id 
    ON document_chunks(document_id);

CREATE INDEX IF NOT EXISTS idx_document_chunks_repository_id 
    ON document_chunks(repository_id);

-- Create embeddings table to store vector embeddings
-- Using 1536 dimensions for OpenAI text-embedding-3-small and ada-002
CREATE TABLE IF NOT EXISTS embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chunk_id UUID NOT NULL REFERENCES document_chunks(id) ON DELETE CASCADE,
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    embedding vector(1536) NOT NULL,
    model TEXT NOT NULL DEFAULT 'text-embedding-3-small',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(chunk_id)
);

-- Create index for fast embedding lookups by chunk
CREATE INDEX IF NOT EXISTS idx_embeddings_chunk_id 
    ON embeddings(chunk_id);

-- Create index for fast embedding lookups by repository
CREATE INDEX IF NOT EXISTS idx_embeddings_repository_id 
    ON embeddings(repository_id);

-- Create HNSW index for fast vector similarity search
-- Using cosine distance (best for normalized embeddings)
CREATE INDEX IF NOT EXISTS idx_embeddings_vector_cosine 
    ON embeddings USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers to auto-update updated_at
CREATE TRIGGER update_repositories_updated_at
    BEFORE UPDATE ON repositories
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_documents_updated_at
    BEFORE UPDATE ON documents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to perform similarity search
-- Returns chunks similar to the query embedding
CREATE OR REPLACE FUNCTION match_documents(
    query_embedding vector(1536),
    repo_owner TEXT DEFAULT NULL,
    repo_name TEXT DEFAULT NULL,
    repo_ref TEXT DEFAULT 'main',
    match_threshold FLOAT DEFAULT 0.7,
    match_count INT DEFAULT 10
)
RETURNS TABLE (
    chunk_id UUID,
    chunk_text TEXT,
    document_url TEXT,
    similarity FLOAT,
    repository_owner TEXT,
    repository_name TEXT,
    repository_ref TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        dc.id as chunk_id,
        dc.chunk_text,
        d.url as document_url,
        1 - (e.embedding <=> query_embedding) as similarity,
        r.owner as repository_owner,
        r.repo as repository_name,
        r.ref as repository_ref
    FROM embeddings e
    JOIN document_chunks dc ON dc.id = e.chunk_id
    JOIN documents d ON d.id = dc.document_id
    JOIN repositories r ON r.id = e.repository_id
    WHERE 
        (repo_owner IS NULL OR r.owner = repo_owner)
        AND (repo_name IS NULL OR r.repo = repo_name)
        AND (repo_ref IS NULL OR r.ref = repo_ref)
        AND 1 - (e.embedding <=> query_embedding) > match_threshold
    ORDER BY e.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- Function to get repository statistics
CREATE OR REPLACE FUNCTION get_repository_stats(
    repo_owner TEXT,
    repo_name TEXT,
    repo_ref TEXT DEFAULT 'main'
)
RETURNS TABLE (
    repository_id UUID,
    owner TEXT,
    repo TEXT,
    ref TEXT,
    document_count BIGINT,
    chunk_count BIGINT,
    embedding_count BIGINT,
    last_processed TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        r.id as repository_id,
        r.owner,
        r.repo,
        r.ref,
        COUNT(DISTINCT d.id) as document_count,
        COUNT(DISTINCT dc.id) as chunk_count,
        COUNT(DISTINCT e.id) as embedding_count,
        r.last_processed_at as last_processed
    FROM repositories r
    LEFT JOIN documents d ON d.repository_id = r.id
    LEFT JOIN document_chunks dc ON dc.repository_id = r.id
    LEFT JOIN embeddings e ON e.repository_id = r.id
    WHERE
        r.owner = repo_owner
        AND r.repo = repo_name
        AND r.ref = repo_ref
    GROUP BY r.id, r.owner, r.repo, r.ref, r.last_processed_at;
END;
$$;

-- Create RLS policies (optional, for production use)
-- ALTER TABLE repositories ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE embeddings ENABLE ROW LEVEL SECURITY;

-- Grant necessary permissions to authenticated users
-- GRANT SELECT ON repositories, documents, document_chunks, embeddings TO authenticated;
-- GRANT INSERT, UPDATE, DELETE ON repositories, documents, document_chunks, embeddings TO service_role;
