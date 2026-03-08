-- PostgreSQL-based Cache Table
-- This table replaces Redis for caching functionality

CREATE TABLE IF NOT EXISTS cache (
    id SERIAL PRIMARY KEY,
    cache_key VARCHAR(255) UNIQUE NOT NULL,
    cache_value TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_cache_key ON cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_cache_expires_at ON cache(expires_at);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_cache_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER trigger_update_cache_updated_at
    BEFORE UPDATE ON cache
    FOR EACH ROW
    EXECUTE FUNCTION update_cache_updated_at();

-- Create function to clean up expired cache entries
CREATE OR REPLACE FUNCTION cleanup_expired_cache()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM cache WHERE expires_at < CURRENT_TIMESTAMP;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Create function to get cache value
CREATE OR REPLACE FUNCTION get_cache_value(p_key VARCHAR)
RETURNS TEXT AS $$
DECLARE
    result TEXT;
BEGIN
    SELECT cache_value INTO result
    FROM cache
    WHERE cache_key = p_key
      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP);
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Create function to set cache value
CREATE OR REPLACE FUNCTION set_cache_value(p_key VARCHAR, p_value TEXT, p_ttl_seconds INTEGER DEFAULT NULL)
RETURNS BOOLEAN AS $$
DECLARE
    expires_at TIMESTAMP WITH TIME ZONE;
BEGIN
    IF p_ttl_seconds IS NOT NULL THEN
        expires_at := CURRENT_TIMESTAMP + (p_ttl_seconds || ' seconds')::INTERVAL;
    END IF;
    
    INSERT INTO cache (cache_key, cache_value, expires_at)
    VALUES (p_key, p_value, expires_at)
    ON CONFLICT (cache_key)
    DO UPDATE SET
        cache_value = EXCLUDED.cache_value,
        expires_at = EXCLUDED.expires_at,
        updated_at = CURRENT_TIMESTAMP;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Create function to delete cache value
CREATE OR REPLACE FUNCTION delete_cache_value(p_key VARCHAR)
RETURNS BOOLEAN AS $$
BEGIN
    DELETE FROM cache WHERE cache_key = p_key;
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Create function to get all cache keys matching pattern
CREATE OR REPLACE FUNCTION get_cache_keys(p_pattern VARCHAR DEFAULT '%')
RETURNS TABLE(cache_key VARCHAR) AS $$
BEGIN
    RETURN QUERY
    SELECT cache_key
    FROM cache
    WHERE cache_key LIKE p_pattern
      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP);
END;
$$ LANGUAGE plpgsql;

-- Create function to clear all cache
CREATE OR REPLACE FUNCTION clear_all_cache()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM cache;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions (adjust as needed for your setup)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON cache TO immunicare_user;
-- GRANT USAGE, SELECT ON SEQUENCE cache_id_seq TO immunicare_user;
-- GRANT EXECUTE ON FUNCTION get_cache_value(VARCHAR) TO immunicare_user;
-- GRANT EXECUTE ON FUNCTION set_cache_value(VARCHAR, TEXT, INTEGER) TO immunicare_user;
-- GRANT EXECUTE ON FUNCTION delete_cache_value(VARCHAR) TO immunicare_user;
-- GRANT EXECUTE ON FUNCTION get_cache_keys(VARCHAR) TO immunicare_user;
-- GRANT EXECUTE ON FUNCTION clear_all_cache() TO immunicare_user;
-- GRANT EXECUTE ON FUNCTION cleanup_expired_cache() TO immunicare_user;

COMMENT ON TABLE cache IS 'PostgreSQL-based cache table replacing Redis functionality';
COMMENT ON COLUMN cache.cache_key IS 'Unique key for cache entry';
COMMENT ON COLUMN cache.cache_value IS 'Cached value (stored as TEXT, can be JSON string)';
COMMENT ON COLUMN cache.expires_at IS 'Expiration timestamp (NULL means no expiration)';
COMMENT ON COLUMN cache.created_at IS 'Timestamp when cache entry was created';
COMMENT ON COLUMN cache.updated_at IS 'Timestamp when cache entry was last updated';
