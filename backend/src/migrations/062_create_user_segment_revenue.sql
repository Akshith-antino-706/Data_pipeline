CREATE TABLE IF NOT EXISTS user_segment_revenue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    segments_title VARCHAR(255) NOT NULL,

    revenue DECIMAL(15, 2) NOT NULL DEFAULT 0.00,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);