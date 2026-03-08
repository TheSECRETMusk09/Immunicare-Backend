-- Create vaccine inventory table based on the Excel sheet structure
CREATE TABLE IF NOT EXISTS vaccine_inventory (
    id SERIAL PRIMARY KEY,
    vaccine_name VARCHAR(255) NOT NULL,
    beginning_balance INTEGER NOT NULL DEFAULT 0,
    received_during_period INTEGER NOT NULL DEFAULT 0,
    lot_batch_number VARCHAR(100),
    transferred_in INTEGER NOT NULL DEFAULT 0,
    transferred_out INTEGER NOT NULL DEFAULT 0,
    expired_wasted INTEGER NOT NULL DEFAULT 0,
    total_available INTEGER GENERATED ALWAYS AS (beginning_balance + received_during_period) STORED,
    issuance INTEGER NOT NULL DEFAULT 0,
    stock_on_hand INTEGER GENERATED ALWAYS AS (beginning_balance + received_during_period + transferred_in - transferred_out - expired_wasted - issuance) STORED,
    clinic_id INTEGER REFERENCES clinics(id),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER REFERENCES users(id),
    updated_by INTEGER REFERENCES users(id)
);

-- Create vaccine inventory transactions table
CREATE TABLE IF NOT EXISTS vaccine_inventory_transactions (
    id SERIAL PRIMARY KEY,
    vaccine_inventory_id INTEGER REFERENCES vaccine_inventory(id) ON DELETE CASCADE,
    transaction_type VARCHAR(50) NOT NULL, -- RECEIVE, TRANSFER_IN, TRANSFER_OUT, ISSUE, EXPIRE, WASTE
    quantity INTEGER NOT NULL,
    lot_number VARCHAR(100),
    batch_number VARCHAR(100),
    expiry_date DATE,
    supplier_name VARCHAR(255),
    reference_number VARCHAR(100),
    notes TEXT,
    performed_by INTEGER REFERENCES users(id),
    approved_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create vaccine stock alerts table
CREATE TABLE IF NOT EXISTS vaccine_stock_alerts (
    id SERIAL PRIMARY KEY,
    vaccine_inventory_id INTEGER REFERENCES vaccine_inventory(id) ON DELETE CASCADE,
    alert_type VARCHAR(50) NOT NULL, -- LOW_STOCK, CRITICAL_STOCK, EXPIRING
    current_stock INTEGER NOT NULL,
    threshold_value INTEGER NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, ACKNOWLEDGED, RESOLVED
    message TEXT NOT NULL,
    priority VARCHAR(20) NOT NULL DEFAULT 'HIGH', -- LOW, MEDIUM, HIGH, URGENT
    acknowledged_by INTEGER REFERENCES users(id),
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    resolved_by INTEGER REFERENCES users(id),
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolution_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_vaccine_inventory_clinic ON vaccine_inventory(clinic_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_inventory_period ON vaccine_inventory(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_vaccine_inventory_transactions ON vaccine_inventory_transactions(vaccine_inventory_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_stock_alerts ON vaccine_stock_alerts(vaccine_inventory_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_stock_alerts_status ON vaccine_stock_alerts(status);

-- Insert sample vaccine inventory data
INSERT INTO vaccine_inventory (
    vaccine_name, beginning_balance, received_during_period, lot_batch_number, 
    transferred_in, transferred_out, expired_wasted, issuance, clinic_id, 
    period_start, period_end, created_by
) VALUES
('BCG', 100, 50, 'BCG202401', 0, 20, 5, 60, 1, '2024-01-01', '2024-01-31', 1),
('BCG, Diluent', 50, 25, 'BCG-D202401', 0, 10, 2, 30, 1, '2024-01-01', '2024-01-31', 1),
('Hepa B', 200, 100, 'HEP202402', 10, 50, 3, 130, 1, '2024-01-01', '2024-01-31', 1),
('Penta Valent', 150, 75, 'PENTA202401', 5, 40, 4, 100, 1, '2024-01-01', '2024-01-31', 1),
('OPV 20-doses', 300, 150, 'OPV202403', 0, 100, 6, 200, 1, '2024-01-01', '2024-01-31', 1),
('PCV 13 / PCV 10', 120, 60, 'PCV202401', 8, 30, 2, 85, 1, '2024-01-01', '2024-01-31', 1),
('Measles & Rubella (MR)', 80, 40, 'MR202402', 0, 25, 1, 50, 1, '2024-01-01', '2024-01-31', 1),
('MMR', 60, 30, 'MMR202401', 5, 15, 0, 45, 1, '2024-01-01', '2024-01-31', 1),
('MMR, Diluent 5ml', 40, 20, 'MMR-D202401', 0, 10, 1, 25, 1, '2024-01-01', '2024-01-31', 1),
('IPV multi dose', 90, 45, 'IPV202402', 3, 20, 2, 60, 1, '2024-01-01', '2024-01-31', 1);

-- Create trigger function to update updated_at column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for vaccine_inventory and vaccine_stock_alerts tables
CREATE TRIGGER update_vaccine_inventory_updated_at
    BEFORE UPDATE ON vaccine_inventory
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vaccine_stock_alerts_updated_at
    BEFORE UPDATE ON vaccine_stock_alerts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
