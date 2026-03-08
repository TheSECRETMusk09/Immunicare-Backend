-- ============================================================================
-- IMMUNICARE COMPREHENSIVE INVENTORY MANAGEMENT DATABASE SCHEMA
-- ============================================================================
-- Version: 1.0
-- Date: 2026-02-06
-- Description: Complete database schema for inventory management, stock alerts,
--              stock transactions, suppliers, reports, and announcements modules
-- ============================================================================

-- ============================================================================
-- SECTION 1: INVENTORY MANAGEMENT TABLES
-- ============================================================================

-- Table: inventory_categories
-- Purpose: Organize inventory items into hierarchical categories
-- ============================================================================
CREATE TABLE IF NOT EXISTS inventory_categories (
    category_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_code VARCHAR(20) NOT NULL UNIQUE,
    category_name VARCHAR(100) NOT NULL,
    parent_category_id UUID REFERENCES inventory_categories(category_id) ON DELETE SET NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inventory_categories_parent 
    ON inventory_categories(parent_category_id);
CREATE INDEX IF NOT EXISTS idx_inventory_categories_code 
    ON inventory_categories(category_code);
CREATE INDEX IF NOT EXISTS idx_inventory_categories_active 
    ON inventory_categories(is_active);

-- Table: inventory_items
-- Purpose: Core inventory item definitions
-- ============================================================================
CREATE TABLE IF NOT EXISTS inventory_items (
    item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku VARCHAR(50) NOT NULL UNIQUE,
    barcode VARCHAR(100),
    product_name VARCHAR(200) NOT NULL,
    description TEXT,
    category_id UUID NOT NULL REFERENCES inventory_categories(category_id) ON DELETE RESTRICT,
    subcategory_id UUID REFERENCES inventory_categories(category_id) ON DELETE SET NULL,
    
    -- Stock tracking fields
    current_stock_level DECIMAL(12, 4) DEFAULT 0,
    minimum_stock_level DECIMAL(12, 4) DEFAULT 0,
    reorder_point DECIMAL(12, 4) DEFAULT 0,
    maximum_stock_level DECIMAL(12, 4) DEFAULT 0,
    safety_stock_level DECIMAL(12, 4) DEFAULT 0,
    
    -- Unit and measurement
    unit_of_measure VARCHAR(30) NOT NULL DEFAULT 'units',
    pack_size INTEGER DEFAULT 1,
    
    -- Cost and valuation
    unit_cost DECIMAL(12, 4) DEFAULT 0,
    average_cost DECIMAL(12, 4) DEFAULT 0,
    last_purchase_price DECIMAL(12, 4) DEFAULT 0,
    currency_code VARCHAR(3) DEFAULT 'PHP',
    valuation_method VARCHAR(20) DEFAULT 'FIFO', -- FIFO, LIFO, Average, Standard
    
    -- Location data
    warehouse_location_id UUID,
    bin_location VARCHAR(50),
    aisle VARCHAR(10),
    rack VARCHAR(10),
    shelf VARCHAR(10),
    
    -- Supplier information
    primary_supplier_id UUID,
    secondary_supplier_id UUID,
    
    -- Item characteristics
    batch_tracking_enabled BOOLEAN DEFAULT false,
    serial_number_tracking BOOLEAN DEFAULT false,
    expiration_tracking BOOLEAN DEFAULT false,
    temperature_sensitive BOOLEAN DEFAULT false,
    storage_temperature DECIMAL(5, 2),
    storage_requirements TEXT,
    
    -- Status and flags
    is_active BOOLEAN DEFAULT true,
    is_discontinued BOOLEAN DEFAULT false,
    discontinued_at TIMESTAMP WITH TIME ZONE,
    
    -- Audit fields
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_stock_count_at TIMESTAMP WITH TIME ZONE,
    last_issue_at TIMESTAMP WITH TIME ZONE,
    last_receipt_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_sku 
    ON inventory_items(sku);
CREATE INDEX IF NOT EXISTS idx_inventory_items_barcode 
    ON inventory_items(barcode);
CREATE INDEX IF NOT EXISTS idx_inventory_items_category 
    ON inventory_items(category_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_supplier 
    ON inventory_items(primary_supplier_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_stock_level 
    ON inventory_items(current_stock_level);
CREATE INDEX IF NOT EXISTS idx_inventory_items_reorder_point 
    ON inventory_items(reorder_point);
CREATE INDEX IF NOT EXISTS idx_inventory_items_active 
    ON inventory_items(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_inventory_items_warehouse 
    ON inventory_items(warehouse_location_id, bin_location);

-- Table: inventory_warehouses
-- Purpose: Define warehouse/location storage facilities
-- ============================================================================
CREATE TABLE IF NOT EXISTS inventory_warehouses (
    warehouse_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_code VARCHAR(20) NOT NULL UNIQUE,
    warehouse_name VARCHAR(100) NOT NULL,
    warehouse_type VARCHAR(30) DEFAULT 'main', -- main, satellite, cold_storage
    address_line1 VARCHAR(200),
    address_line2 VARCHAR(200),
    city VARCHAR(100),
    province VARCHAR(100),
    postal_code VARCHAR(20),
    country VARCHAR(100) DEFAULT 'Philippines',
    
    -- Contact information
    phone VARCHAR(30),
    fax VARCHAR(30),
    email VARCHAR(100),
    contact_person VARCHAR(100),
    
    -- Capacity information
    total_capacity DECIMAL(12, 2),
    used_capacity DECIMAL(12, 2) DEFAULT 0,
    capacity_unit VARCHAR(20) DEFAULT 'sqm',
    
    -- Operating hours
    operating_hours_weekday VARCHAR(50),
    operating_hours_saturday VARCHAR(50),
    operating_hours_sunday VARCHAR(50),
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    is_primary BOOLEAN DEFAULT false,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inventory_warehouses_code 
    ON inventory_warehouses(warehouse_code);
CREATE INDEX IF NOT EXISTS idx_inventory_warehouses_active 
    ON inventory_warehouses(is_active);

-- Table: inventory_locations
-- Purpose: Detailed bin locations within warehouses
-- ============================================================================
CREATE TABLE IF NOT EXISTS inventory_locations (
    location_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES inventory_warehouses(warehouse_id) ON DELETE CASCADE,
    location_code VARCHAR(30) NOT NULL,
    location_name VARCHAR(100),
    location_type VARCHAR(30) DEFAULT 'bin', -- aisle, rack, shelf, bin, zone
    parent_location_id UUID REFERENCES inventory_locations(location_id) ON DELETE CASCADE,
    
    -- Physical attributes
    max_capacity DECIMAL(12, 4),
    current_utilization DECIMAL(5, 2) DEFAULT 0,
    temperature_zone VARCHAR(20), -- frozen, refrigerated, ambient, controlled
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    is_available BOOLEAN DEFAULT true,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(warehouse_id, location_code)
);

CREATE INDEX IF NOT EXISTS idx_inventory_locations_warehouse 
    ON inventory_locations(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventory_locations_type 
    ON inventory_locations(location_type);

-- Table: inventory_stock_history
-- Purpose: Historical tracking of stock level changes
-- ============================================================================
CREATE TABLE IF NOT EXISTS inventory_stock_history (
    history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES inventory_items(item_id) ON DELETE CASCADE,
    warehouse_id UUID REFERENCES inventory_warehouses(warehouse_id),
    location_id UUID REFERENCES inventory_locations(location_id),
    
    -- Snapshot data
    stock_before DECIMAL(12, 4) DEFAULT 0,
    stock_after DECIMAL(12, 4) DEFAULT 0,
    change_quantity DECIMAL(12, 4) DEFAULT 0,
    
    -- Cost tracking
    unit_cost DECIMAL(12, 4) DEFAULT 0,
    total_value DECIMAL(14, 4) DEFAULT 0,
    
    -- Reference information
    transaction_id UUID,
    transaction_type VARCHAR(30),
    reference_number VARCHAR(100),
    notes TEXT,
    
    -- Timestamp
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inventory_stock_history_item 
    ON inventory_stock_history(item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_stock_history_date 
    ON inventory_stock_history(recorded_at);
CREATE INDEX IF NOT EXISTS idx_inventory_stock_history_transaction 
    ON inventory_stock_history(transaction_id);
CREATE INDEX IF NOT EXISTS idx_inventory_stock_history_warehouse 
    ON inventory_stock_history(warehouse_id, recorded_at);

-- Table: inventory_valuation
-- Purpose: Track item valuation over time for financial reporting
-- ============================================================================
CREATE TABLE IF NOT EXISTS inventory_valuation (
    valuation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES inventory_items(item_id) ON DELETE CASCADE,
    valuation_date DATE NOT NULL,
    
    -- Valuation metrics
    quantity_on_hand DECIMAL(12, 4) DEFAULT 0,
    unit_cost DECIMAL(12, 4) DEFAULT 0,
    total_value DECIMAL(14, 4) DEFAULT 0,
    average_cost DECIMAL(12, 4) DEFAULT 0,
    
    -- Cost breakdown
    material_cost DECIMAL(12, 4) DEFAULT 0,
    labor_cost DECIMAL(12, 4) DEFAULT 0,
    overhead_cost DECIMAL(12, 4) DEFAULT 0,
    
    -- Valuation method used
    valuation_method VARCHAR(20) DEFAULT 'FIFO',
    currency_code VARCHAR(3) DEFAULT 'PHP',
    
    -- Period information
    fiscal_year INTEGER,
    fiscal_period INTEGER,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inventory_valuation_item 
    ON inventory_valuation(item_id, valuation_date);
CREATE INDEX IF NOT EXISTS idx_inventory_valuation_period 
    ON inventory_valuation(fiscal_year, fiscal_period);

-- ============================================================================
-- SECTION 2: STOCK ALERTS TABLES
-- ============================================================================

-- Table: stock_alerts
-- Purpose: Track inventory-related alerts and notifications
-- ============================================================================
CREATE TABLE IF NOT EXISTS stock_alerts (
    alert_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_code VARCHAR(30) NOT NULL UNIQUE,
    alert_type VARCHAR(30) NOT NULL, -- low_stock, overstock, expiring, reorder_deadline, stockout, quality_issue
    severity_level VARCHAR(20) NOT NULL, -- critical, high, medium, low, info
    priority_score INTEGER DEFAULT 0,
    
    -- Alert details
    item_id UUID NOT NULL REFERENCES inventory_items(item_id) ON DELETE CASCADE,
    warehouse_id UUID REFERENCES inventory_warehouses(warehouse_id),
    
    -- Trigger conditions
    threshold_value DECIMAL(12, 4),
    current_value DECIMAL(12, 4),
    trigger_formula TEXT,
    
    -- Message and description
    alert_title VARCHAR(200) NOT NULL,
    alert_message TEXT NOT NULL,
    recommended_action TEXT,
    
    -- Status tracking
    alert_status VARCHAR(20) DEFAULT 'active', -- active, acknowledged, resolved, dismissed
    acknowledged_by UUID,
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    resolved_by UUID,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolution_notes TEXT,
    
    -- Expiration
    expires_at TIMESTAMP WITH TIME ZONE,
    auto_expire_days INTEGER,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stock_alerts_item 
    ON stock_alerts(item_id);
CREATE INDEX IF NOT EXISTS idx_stock_alerts_type 
    ON stock_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_stock_alerts_severity 
    ON stock_alerts(severity_level);
CREATE INDEX IF NOT EXISTS idx_stock_alerts_status 
    ON stock_alerts(alert_status);
CREATE INDEX IF NOT EXISTS idx_stock_alerts_created 
    ON stock_alerts(created_at);
CREATE INDEX IF NOT EXISTS idx_stock_alerts_active 
    ON stock_alerts(alert_status, severity_level) 
    WHERE alert_status IN ('active', 'acknowledged');

-- Table: alert_notification_recipients
-- Purpose: Define who receives alert notifications
-- ============================================================================
CREATE TABLE IF NOT EXISTS alert_notification_recipients (
    recipient_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id UUID NOT NULL REFERENCES stock_alerts(alert_id) ON DELETE CASCADE,
    recipient_type VARCHAR(20) NOT NULL, -- user, role, group, email
    recipient_id_value UUID, -- user_id or role_id
    recipient_name VARCHAR(100),
    recipient_email VARCHAR(100),
    recipient_phone VARCHAR(30),
    
    -- Notification preferences
    notify_email BOOLEAN DEFAULT true,
    notify_sms BOOLEAN DEFAULT false,
    notify_in_app BOOLEAN DEFAULT true,
    notify_push BOOLEAN DEFAULT DEFAULT false,
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_alert_recipients_alert 
    ON alert_notification_recipients(alert_id);
CREATE INDEX IF NOT EXISTS idx_alert_recipients_user 
    ON alert_notification_recipients(recipient_id_value);

-- Table: alert_notification_log
-- Purpose: Log of all alert notifications sent
-- ============================================================================
CREATE TABLE IF NOT EXISTS alert_notification_log (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id UUID NOT NULL REFERENCES stock_alerts(alert_id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL REFERENCES alert_notification_recipients(recipient_id),
    
    notification_type VARCHAR(20) NOT NULL, -- email, sms, in_app, push
    notification_channel VARCHAR(50),
    
    -- Content
    subject VARCHAR(200),
    message TEXT,
    
    -- Status
    status VARCHAR(20) NOT NULL, -- pending, sent, delivered, failed, read
    sent_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    read_at TIMESTAMP WITH TIME ZONE,
    failure_reason TEXT,
    retry_count INTEGER DEFAULT 0,
    
    -- Metadata
    external_message_id VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_alert_log_alert 
    ON alert_notification_log(alert_id);
CREATE INDEX IF NOT EXISTS idx_alert_log_status 
    ON alert_notification_log(status);
CREATE INDEX IF NOT EXISTS idx_alert_log_sent 
    ON alert_notification_log(sent_at);

-- Table: alert_rules
-- Purpose: Define automated alert rules
-- ============================================================================
CREATE TABLE IF NOT EXISTS alert_rules (
    rule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_code VARCHAR(30) NOT NULL UNIQUE,
    rule_name VARCHAR(100) NOT NULL,
    rule_description TEXT,
    alert_type VARCHAR(30) NOT NULL,
    severity_level VARCHAR(20) NOT NULL DEFAULT 'medium',
    
    -- Conditions
    condition_expression TEXT NOT NULL,
    condition_item_category UUID REFERENCES inventory_categories(category_id),
    condition_item_ids UUID[],
    condition_warehouse_ids UUID[],
    
    -- Thresholds
    threshold_type VARCHAR(20), -- percentage, absolute, days
    threshold_value DECIMAL(12, 4),
    threshold_comparison VARCHAR(10), -- lt, gt, lte, gte, eq
    
    -- Timing
    check_frequency_minutes INTEGER DEFAULT 60,
    quiet_hours_start TIME,
    quiet_hours_end TIME,
    
    -- Status
    is_enabled BOOLEAN DEFAULT true,
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled 
    ON alert_rules(is_enabled);
CREATE INDEX IF NOT EXISTS idx_alert_rules_type 
    ON alert_rules(alert_type);

-- ============================================================================
-- SECTION 3: STOCK TRANSACTIONS TABLES
-- ============================================================================

-- Table: stock_transactions
-- Purpose: Complete audit trail of all inventory movements
-- ============================================================================
CREATE TABLE IF NOT EXISTS stock_transactions (
    transaction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_number VARCHAR(50) NOT NULL UNIQUE,
    transaction_type VARCHAR(30) NOT NULL, -- receipt, issue, transfer, adjustment, return, writeoff, cycle_count
    transaction_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Item information
    item_id UUID NOT NULL REFERENCES inventory_items(item_id) ON DELETE RESTRICT,
    unit_of_measure VARCHAR(30) NOT NULL DEFAULT 'units',
    quantity DECIMAL(12, 4) NOT NULL,
    
    -- Location data
    source_warehouse_id UUID REFERENCES inventory_warehouses(warehouse_id),
    source_location_id UUID REFERENCES inventory_locations(location_id),
    destination_warehouse_id UUID REFERENCES inventory_warehouses(warehouse_id),
    destination_location_id UUID REFERENCES inventory_locations(location_id),
    
    -- Cost tracking
    unit_cost DECIMAL(12, 4) DEFAULT 0,
    total_cost DECIMAL(14, 4) DEFAULT 0,
    currency_code VARCHAR(3) DEFAULT 'PHP',
    
    -- Reference documents
    reference_type VARCHAR(50), -- purchase_order, sales_order, transfer_request, adjustment_note
    reference_number VARCHAR(100),
    reference_document_id UUID,
    
    -- Batch and serial tracking
    batch_number VARCHAR(50),
    expiration_date DATE,
    serial_numbers TEXT[], -- Array of serial numbers
    
    -- Authorization
    authorized_by UUID,
    authorized_at TIMESTAMP WITH TIME ZONE,
    authorization_status VARCHAR(20) DEFAULT 'approved', -- pending, approved, rejected
    authorization_notes TEXT,
    
    -- User information
    created_by UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Status
    transaction_status VARCHAR(20) DEFAULT 'completed', -- pending, in_progress, completed, cancelled
    completed_at TIMESTAMP WITH TIME ZONE,
    cancellation_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_stock_transactions_number 
    ON stock_transactions(transaction_number);
CREATE INDEX IF NOT EXISTS idx_stock_transactions_type 
    ON stock_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_stock_transactions_date 
    ON stock_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_stock_transactions_item 
    ON stock_transactions(item_id);
CREATE INDEX IF NOT EXISTS idx_stock_transactions_warehouse 
    ON stock_transactions(source_warehouse_id, destination_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_transactions_reference 
    ON stock_transactions(reference_type, reference_number);
CREATE INDEX IF NOT EXISTS idx_stock_transactions_status 
    ON stock_transactions(transaction_status);
CREATE INDEX IF NOT EXISTS idx_stock_transactions_created_by 
    ON stock_transactions(created_by, transaction_date);

-- Table: transaction_line_items
-- Purpose: Support for multi-item transactions
-- ============================================================================
CREATE TABLE IF NOT EXISTS transaction_line_items (
    line_item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES stock_transactions(transaction_id) ON DELETE CASCADE,
    line_number INTEGER NOT NULL,
    
    item_id UUID NOT NULL REFERENCES inventory_items(item_id) ON DELETE RESTRICT,
    description VARCHAR(200),
    
    quantity DECIMAL(12, 4) NOT NULL,
    unit_of_measure VARCHAR(30) NOT NULL DEFAULT 'units',
    unit_cost DECIMAL(12, 4) DEFAULT 0,
    total_cost DECIMAL(14, 4) DEFAULT 0,
    
    -- Location for this line item
    source_location_id UUID REFERENCES inventory_locations(location_id),
    destination_location_id UUID REFERENCES inventory_locations(location_id),
    
    -- Batch tracking
    batch_number VARCHAR(50),
    expiration_date DATE,
    
    -- Status
    line_status VARCHAR(20) DEFAULT 'pending',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_transaction_lines_transaction 
    ON transaction_line_items(transaction_id);
CREATE INDEX IF NOT EXISTS idx_transaction_lines_item 
    ON transaction_line_items(item_id);

-- Table: transaction_documents
-- Purpose: Attach documents to transactions
-- ============================================================================
CREATE TABLE IF NOT EXISTS transaction_documents (
    document_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES stock_transactions(transaction_id) ON DELETE CASCADE,
    document_type VARCHAR(30) NOT NULL, -- invoice, delivery_note, inspection_report, photo
    document_name VARCHAR(200) NOT NULL,
    file_path VARCHAR(500),
    file_size_bytes BIGINT,
    mime_type VARCHAR(100),
    uploaded_by UUID,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_transaction_documents_transaction 
    ON transaction_documents(transaction_id);

-- Table: transfer_requests
-- Purpose: Track inventory transfer requests between locations
-- ============================================================================
CREATE TABLE IF NOT EXISTS transfer_requests (
    transfer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_number VARCHAR(50) NOT NULL UNIQUE,
    request_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Transfer details
    source_warehouse_id UUID NOT NULL REFERENCES inventory_warehouses(warehouse_id),
    source_location_id UUID REFERENCES inventory_locations(location_id),
    destination_warehouse_id UUID NOT NULL REFERENCES inventory_warehouses(warehouse_id),
    destination_location_id UUID REFERENCES inventory_locations(location_id),
    
    -- Status
    transfer_status VARCHAR(20) DEFAULT 'pending', -- pending, approved, in_transit, received, completed, cancelled
    priority VARCHAR(20) DEFAULT 'normal', -- urgent, high, normal, low
    
    -- Authorization
    requested_by UUID NOT NULL,
    approved_by UUID,
    approved_at TIMESTAMP WITH TIME ZONE,
    received_by UUID,
    received_at TIMESTAMP WITH TIME ZONE,
    
    -- Transfer tracking
    expected_ship_date DATE,
    actual_ship_date DATE,
    expected_delivery_date DATE,
    actual_delivery_date DATE,
    
    -- Cost
    transportation_cost DECIMAL(12, 2) DEFAULT 0,
    currency_code VARCHAR(3) DEFAULT 'PHP',
    
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_transfer_requests_status 
    ON transfer_requests(transfer_status);
CREATE INDEX IF NOT EXISTS idx_transfer_requests_warehouses 
    ON transfer_requests(source_warehouse_id, destination_warehouse_id);

-- Table: transfer_line_items
-- Purpose: Items in a transfer request
-- ============================================================================
CREATE TABLE IF NOT EXISTS transfer_line_items (
    line_item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id UUID NOT NULL REFERENCES transfer_requests(transfer_id) ON DELETE CASCADE,
    line_number INTEGER NOT NULL,
    
    item_id UUID NOT NULL REFERENCES inventory_items(item_id) ON DELETE RESTRICT,
    requested_quantity DECIMAL(12, 4) NOT NULL,
    approved_quantity DECIMAL(12, 4),
    shipped_quantity DECIMAL(12, 4),
    received_quantity DECIMAL(12, 4),
    
    unit_of_measure VARCHAR(30) NOT NULL DEFAULT 'units',
    
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_transfer_lines_transfer 
    ON transfer_line_items(transfer_id);
CREATE INDEX IF NOT EXISTS idx_transfer_lines_item 
    ON transfer_line_items(item_id);

-- ============================================================================
-- SECTION 4: SUPPLIER MANAGEMENT TABLES
-- ============================================================================

-- Table: suppliers
-- Purpose: Core supplier/vendor information
-- ============================================================================
CREATE TABLE IF NOT EXISTS suppliers (
    supplier_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_code VARCHAR(20) NOT NULL UNIQUE,
    supplier_name VARCHAR(200) NOT NULL,
    legal_name VARCHAR(200),
    tax_identification_number VARCHAR(50),
    
    -- Contact information
    contact_person VARCHAR(100),
    contact_title VARCHAR(50),
    email VARCHAR(100),
    phone VARCHAR(30),
    mobile_phone VARCHAR(30),
    fax VARCHAR(30),
    website VARCHAR(200),
    
    -- Address
    address_line1 VARCHAR(200),
    address_line2 VARCHAR(200),
    city VARCHAR(100),
    province VARCHAR(100),
    postal_code VARCHAR(20),
    country VARCHAR(100) DEFAULT 'Philippines',
    
    -- Business details
    business_type VARCHAR(50), -- manufacturer, distributor, wholesaler, importer
    year_established INTEGER,
    number_of_employees INTEGER,
    annual_revenue DECIMAL(15, 2),
    
    -- Banking information
    bank_name VARCHAR(100),
    bank_account_number VARCHAR(50),
    bank_account_name VARCHAR(200),
    bank_branch VARCHAR(100),
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    is_approved BOOLEAN DEFAULT false,
    approved_by UUID,
    approved_at TIMESTAMP WITH TIME ZONE,
    
    -- Audit fields
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_suppliers_code 
    ON suppliers(supplier_code);
CREATE INDEX IF NOT EXISTS idx_suppliers_name 
    ON suppliers(supplier_name);
CREATE INDEX IF NOT EXISTS idx_suppliers_active 
    ON suppliers(is_active);

-- Table: supplier_contacts
-- Purpose: Multiple contact persons per supplier
-- ============================================================================
CREATE TABLE IF NOT EXISTS supplier_contacts (
    contact_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID NOT NULL REFERENCES suppliers(supplier_id) ON DELETE CASCADE,
    contact_type VARCHAR(30) NOT NULL, -- primary, sales, technical, billing, shipping
    contact_name VARCHAR(100) NOT NULL,
    contact_title VARCHAR(50),
    department VARCHAR(50),
    
    email VARCHAR(100),
    phone VARCHAR(30),
    mobile_phone VARCHAR(30),
    fax VARCHAR(30),
    
    is_primary BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_supplier_contacts_supplier 
    ON supplier_contacts(supplier_id);

-- Table: supplier_addresses
-- Purpose: Multiple addresses per supplier
-- ============================================================================
CREATE TABLE IF NOT EXISTS supplier_addresses (
    address_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID NOT NULL REFERENCES suppliers(supplier_id) ON DELETE CASCADE,
    address_type VARCHAR(30) NOT NULL, -- headquarters, billing, shipping, warehouse
    address_line1 VARCHAR(200),
    address_line2 VARCHAR(200),
    city VARCHAR(100),
    province VARCHAR(100),
    postal_code VARCHAR(20),
    country VARCHAR(100) DEFAULT 'Philippines',
    
    is_primary BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_supplier_addresses_supplier 
    ON supplier_addresses(supplier_id);

-- Table: supplier_performance_metrics
-- Purpose: Track supplier performance over time
-- ============================================================================
CREATE TABLE IF NOT EXISTS supplier_performance_metrics (
    metric_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID NOT NULL REFERENCES suppliers(supplier_id) ON DELETE CASCADE,
    metric_date DATE NOT NULL,
    fiscal_year INTEGER,
    fiscal_period INTEGER,
    
    -- Quality metrics
    quality_score DECIMAL(5, 2), -- 0-100
    defect_rate DECIMAL(8, 4),
    compliance_score DECIMAL(5, 2),
    
    -- Delivery metrics
    on_time_delivery_rate DECIMAL(5, 2), -- percentage
    average_delivery_days DECIMAL(8, 2),
    late_deliveries INTEGER DEFAULT 0,
    early_deliveries INTEGER DEFAULT 0,
    perfect_deliveries INTEGER DEFAULT 0,
    
    -- Cost metrics
    price_competitiveness DECIMAL(5, 2), -- vs market average
    cost_savings_achieved DECIMAL(14, 4),
    
    -- Service metrics
    responsiveness_score DECIMAL(5, 2),
    communication_quality DECIMAL(5, 2),
    complaint_resolution_rate DECIMAL(5, 2),
    
    -- Overall
    overall_score DECIMAL(5, 2),
    performance_rating VARCHAR(10), -- A, B, C, D, F
    
    evaluation_notes TEXT,
    evaluated_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_supplier_metrics_supplier 
    ON supplier_performance_metrics(supplier_id, metric_date);
CREATE INDEX IF NOT EXISTS idx_supplier_metrics_period 
    ON supplier_performance_metrics(fiscal_year, fiscal_period);

-- Table: supplier_pricing_agreements
-- Purpose: Track pricing agreements with suppliers
-- ============================================================================
CREATE TABLE IF NOT EXISTS supplier_pricing_agreements (
    agreement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID NOT NULL REFERENCES suppliers(supplier_id) ON DELETE CASCADE,
    agreement_code VARCHAR(30) NOT NULL UNIQUE,
    agreement_name VARCHAR(200) NOT NULL,
    agreement_type VARCHAR(30) NOT NULL, -- fixed_price, volume_discount, tiered_pricing, contract
    item_category_id UUID REFERENCES inventory_categories(category_id),
    
    -- Validity
    effective_date DATE NOT NULL,
    expiration_date DATE,
    is_active BOOLEAN DEFAULT true,
    
    -- Terms
    currency_code VARCHAR(3) DEFAULT 'PHP',
    payment_terms VARCHAR(50),
    minimum_order_value DECIMAL(12, 2) DEFAULT 0,
    minimum_order_quantity DECIMAL(12, 4) DEFAULT 0,
    
    -- Discount structure
    discount_type VARCHAR(20), -- percentage, fixed_amount
    discount_value DECIMAL(8, 4),
    
    -- Volume tiers
    volume_tier_1_min DECIMAL(12, 4),
    volume_tier_1_discount DECIMAL(8, 4),
    volume_tier_2_min DECIMAL(12, 4),
    volume_tier_2_discount DECIMAL(8, 4),
    volume_tier_3_min DECIMAL(12, 4),
    volume_tier_3_discount DECIMAL(8, 4),
    
    -- Status
    approved_by UUID,
    approved_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_supplier_agreements_supplier 
    ON supplier_pricing_agreements(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_agreements_dates 
    ON supplier_pricing_agreements(effective_date, expiration_date);

-- Table: supplier_delivery_schedules
-- Purpose: Track delivery schedules with suppliers
-- ============================================================================
CREATE TABLE IF NOT EXISTS supplier_delivery_schedules (
    schedule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID NOT NULL REFERENCES suppliers(supplier_id) ON DELETE CASCADE,
    schedule_code VARCHAR(30) NOT NULL UNIQUE,
    schedule_name VARCHAR(200) NOT NULL,
    schedule_type VARCHAR(30) NOT NULL, -- recurring, on_demand, scheduled
    
    -- Validity
    effective_date DATE NOT NULL,
    expiration_date DATE,
    is_active BOOLEAN DEFAULT true,
    
    -- Delivery details
    delivery_day_of_week INTEGER[], -- 0=Sunday, 1=Monday, etc.
    delivery_day_of_month INTEGER[],
    preferred_delivery_time_start TIME,
    preferred_delivery_time_end TIME,
    lead_time_days INTEGER DEFAULT 0,
    
    -- Location
    warehouse_id UUID REFERENCES inventory_warehouses(warehouse_id),
    delivery_address_id UUID,
    
    -- Status
    approved_by UUID,
    approved_at TIMESTAMP WITH TIME ZONE,
    
    notes TEXT,
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_supplier_schedules_supplier 
    ON supplier_delivery_schedules(supplier_id);

-- Table: supplier_quality_ratings
-- Purpose: Track quality ratings for supplier items
-- ============================================================================
CREATE TABLE IF NOT EXISTS supplier_quality_ratings (
    rating_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID NOT NULL REFERENCES suppliers(supplier_id) ON DELETE CASCADE,
    item_id UUID REFERENCES inventory_items(item_id) ON DELETE SET NULL,
    rating_date DATE NOT NULL,
    
    -- Quality scores
    quality_score DECIMAL(5, 2) NOT NULL, -- 0-100
    safety_score DECIMAL(5, 2),
    efficacy_score DECIMAL(5, 2),
    appearance_score DECIMAL(5, 2),
    packaging_score DECIMAL(5, 2),
    
    -- Test results
    test_report_number VARCHAR(50),
    test_performed_date DATE,
    next_test_due_date DATE,
    test_results_summary TEXT,
    
    -- Batch tracking
    batch_number VARCHAR(50),
    lot_number VARCHAR(50),
    manufacturing_date DATE,
    expiration_date DATE DATE,
    
    -- Certification
    certification_type VARCHAR(50),
    certification_expiry DATE,
    certificate_number VARCHAR(100),
    
    -- Status
    rating_status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected
    approved_by UUID,
    approved_at TIMESTAMP WITH TIME ZONE,
    
    notes TEXT,
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_supplier_quality_supplier 
    ON supplier_quality_ratings(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_quality_item 
    ON supplier_quality_ratings(item_id);

-- Table: supplier_payment_terms
-- Purpose: Track payment terms with suppliers
-- ============================================================================
CREATE TABLE IF NOT EXISTS supplier_payment_terms (
    terms_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID NOT NULL REFERENCES suppliers(supplier_id) ON DELETE CASCADE,
    terms_code VARCHAR(30) NOT NULL UNIQUE,
    terms_name VARCHAR(100) NOT NULL,
    terms_description TEXT,
    
    -- Payment terms
    payment_type VARCHAR(30) NOT NULL, -- net, eom, cod, prepaid, installments
    net_days INTEGER DEFAULT 30,
    discount_days INTEGER,
    discount_percentage DECIMAL(5, 2),
    penalty_rate DECIMAL(5, 2),
    
    -- Early payment incentives
    early_payment_days INTEGER,
    early_payment_discount DECIMAL(5, 2),
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    effective_date DATE,
    expiration_date DATE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_supplier_payment_terms_supplier 
    ON supplier_payment_terms(supplier_id);

-- ============================================================================
-- SECTION 5: REPORTS MODULE TABLES
-- ============================================================================

-- Table: report_definitions
-- Purpose: Define available reports in the system
-- ============================================================================
CREATE TABLE IF NOT EXISTS report_definitions (
    report_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_code VARCHAR(50) NOT NULL UNIQUE,
    report_name VARCHAR(200) NOT NULL,
    report_description TEXT,
    report_category VARCHAR(50) NOT NULL, -- inventory, stock, financial, suppliers, kpi
    
    -- Report configuration
    report_type VARCHAR(30) NOT NULL, -- standard, parameterized, analytical, dashboard
    data_source VARCHAR(100) NOT NULL,
    query_template TEXT,
    
    -- UI configuration
    icon VARCHAR(50),
    color VARCHAR(20),
    display_order INTEGER DEFAULT 0,
    
    -- Access control
    required_role VARCHAR(50),
    required_permission VARCHAR(100),
    
    -- Parameters
    parameter_definitions JSONB,
    default_parameters JSONB,
    
    -- Scheduling
    is_schedulable BOOLEAN DEFAULT false,
    schedule_frequency VARCHAR(20),
    schedule_config JSONB,
    
    -- Export options
    export_formats VARCHAR(50)[], -- pdf, excel, csv, html
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    is_featured BOOLEAN DEFAULT false,
    
    -- Audit fields
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_report_definitions_category 
    ON report_definitions(report_category);
CREATE INDEX IF NOT EXISTS idx_report_definitions_active 
    ON report_definitions(is_active);

-- Table: report_schedules
-- Purpose: Schedule automated report generation
-- ============================================================================
CREATE TABLE IF NOT EXISTS report_schedules (
    schedule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES report_definitions(report_id) ON DELETE CASCADE,
    schedule_name VARCHAR(100) NOT NULL,
    
    -- Schedule configuration
    schedule_type VARCHAR(20) NOT NULL, -- daily, weekly, monthly, quarterly, annually
    cron_expression VARCHAR(100),
    
    -- Timing
    start_time TIME,
    timezone VARCHAR(50) DEFAULT 'Asia/Manila',
    
    -- Date range
    default_date_range_type VARCHAR(20), -- current_month, previous_month, custom
    default_date_range JSONB,
    
    -- Recipients
    recipients JSONB NOT NULL, -- { emails: [], users: [] }
    
    -- Export and delivery
    export_format VARCHAR(20) NOT NULL DEFAULT 'pdf',
    delivery_method VARCHAR(20) NOT NULL DEFAULT 'email', -- email, download, cloud
    cloud_storage_path VARCHAR(500),
    
    -- Status
    is_enabled BOOLEAN DEFAULT true,
    last_run_at TIMESTAMP WITH TIME ZONE,
    next_run_at TIMESTAMP WITH TIME ZONE,
    last_run_status VARCHAR(20),
    last_run_error TEXT,
    
    -- Audit fields
    created_by UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_report_schedules_enabled 
    ON report_schedules(is_enabled);
CREATE INDEX IF NOT EXISTS idx_report_schedules_next_run 
    ON report_schedules(next_run_at) WHERE is_enabled = true;

-- Table: report_execution_log
-- Purpose: Log of all report executions
-- ============================================================================
CREATE TABLE IF NOT EXISTS report_execution_log (
    execution_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES report_definitions(report_id) ON DELETE CASCADE,
    schedule_id UUID REFERENCES report_schedules(schedule_id),
    
    -- Execution details
    execution_type VARCHAR(20) NOT NULL, -- manual, scheduled, api
    executed_by UUID,
    
    -- Parameters used
    parameters JSONB,
    
    -- Timing
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    duration_ms INTEGER,
    
    -- Status
    execution_status VARCHAR(20) NOT DEFAULT 'running', -- running, completed, failed, cancelled
    error_message TEXT,
    error_details JSONB,
    
    -- Output
    output_file_path VARCHAR(500),
    output_file_size_bytes BIGINT,
    record_count INTEGER,
    
    -- Delivery
    delivery_status VARCHAR(20),
    delivered_at TIMESTAMP WITH TIME ZONE,
    recipients_notified JSONB
);

CREATE INDEX IF NOT EXISTS idx_report_execution_report 
    ON report_execution_log(report_id);
CREATE INDEX IF NOT EXISTS idx_report_execution_status 
    ON report_execution_log(execution_status);
CREATE INDEX IF NOT EXISTS idx_report_execution_date 
    ON report_execution_log(started_at);

-- Table: report_favorites
-- Purpose: User's favorite reports
-- ============================================================================
CREATE TABLE IF NOT EXISTS report_favorites (
    favorite_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    report_id UUID NOT NULL REFERENCES report_definitions(report_id) ON DELETE CASCADE,
    
    -- Customization
    custom_name VARCHAR(100),
    custom_parameters JSONB,
    default_view VARCHAR(50),
    display_order INTEGER DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, report_id)
);

CREATE INDEX IF NOT EXISTS idx_report_favorites_user 
    ON report_favorites(user_id);

-- Table: report_templates
-- Purpose: Custom report templates created by users
-- ============================================================================
CREATE TABLE IF NOT EXISTS report_templates (
    template_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_code VARCHAR(50) NOT NULL UNIQUE,
    template_name VARCHAR(200) NOT NULL,
    template_description TEXT,
    template_category VARCHAR(50) NOT NULL,
    
    -- Template content
    template_type VARCHAR(30) NOT NULL, -- custom, derived
    base_report_id UUID REFERENCES report_definitions(report_id),
    template_definition JSONB NOT NULL,
    
    -- Layout configuration
    layout_config JSONB,
    style_config JSONB,
    
    -- Access control
    is_public BOOLEAN DEFAULT false,
    allowed_roles VARCHAR(50)[],
    
    -- Audit fields
    created_by UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- SECTION 6: ANNOUNCEMENTS MODULE TABLES
-- ============================================================================

-- Table: announcements
-- Purpose: System-wide announcements and notifications
-- ============================================================================
CREATE TABLE IF NOT EXISTS announcements (
    announcement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    announcement_code VARCHAR(30) NOT NULL UNIQUE,
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    content_type VARCHAR(30) NOT NULL DEFAULT 'general', -- general, urgent, maintenance, policy, update, alert
    priority VARCHAR(20) DEFAULT 'normal', -- low, normal, high, urgent, critical
    
    -- Categorization
    category VARCHAR(50) NOT NULL, -- system, inventory, vaccination, policy, event, training
    tags VARCHAR(200),
    
    -- Targeting
    target_audience_type VARCHAR(30) NOT NULL, -- all, role, department, location, user
    target_roles VARCHAR(50)[],
    target_departments UUID[],
    target_locations UUID[],
    target_users UUID[],
    
    -- Scheduling
    publish_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expiration_date TIMESTAMP WITH TIME ZONE,
    display_until DATE,
    
    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'draft', -- draft, scheduled, published, archived, expired
    published_by UUID,
    published_at TIMESTAMP WITH TIME ZONE,
    
    -- Features
    requires_acknowledgment BOOLEAN DEFAULT false,
    acknowledgment_deadline TIMESTAMP WITH TIME ZONE,
    allow_comments BOOLEAN DEFAULT true,
    allow_attachments BOOLEAN DEFAULT true,
    
    -- Audit fields
    created_by UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_announcements_status 
    ON announcements(status);
CREATE INDEX IF NOT EXISTS idx_announcements_category 
    ON announcements(category);
CREATE INDEX IF NOT EXISTS idx_announcements_publish_date 
    ON announcements(publish_date);
CREATE INDEX IF NOT EXISTS idx_announcements_target 
    ON announcements(target_audience_type);
CREATE INDEX IF NOT EXISTS idx_announcements_active 
    ON announcements(status, publish_date, expiration_date) 
    WHERE status = 'published';

-- Table: announcement_attachments
-- Purpose: Attachments for announcements
-- ============================================================================
CREATE TABLE IF NOT EXISTS announcement_attachments (
    attachment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    announcement_id UUID NOT NULL REFERENCES announcements(announcement_id) ON DELETE CASCADE,
    file_name VARCHAR(200) NOT NULL,
    file_path VARCHAR(500),
    file_size_bytes BIGINT,
    mime_type VARCHAR(100),
    description TEXT,
    
    uploaded_by UUID,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_announcement_attachments_announcement 
    ON announcement_attachments(announcement_id);

-- Table: announcement_read_receipts
-- Purpose: Track who read announcements
-- ============================================================================
CREATE TABLE IF NOT EXISTS announcement_read_receipts (
    receipt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    announcement_id UUID NOT NULL REFERENCES announcements(announcement_id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    
    read_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    read_device VARCHAR(100),
    read_ip_address INET,
    
    UNIQUE(announcement_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_announcement_reads_announcement 
    ON announcement_read_receipts(announcement_id);
CREATE INDEX IF NOT EXISTS idx_announcement_reads_user 
    ON announcement_read_receipts(user_id);

-- Table: announcement_acknowledgments
-- Purpose: Track acknowledgment of important announcements
-- ============================================================================
CREATE TABLE IF NOT EXISTS announcement_acknowledgments (
    acknowledgment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    announcement_id UUID NOT NULL REFERENCES announcements(announcement_id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    
    acknowledged_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    acknowledgment_type VARCHAR(20) NOT NULL DEFAULT 'read', -- read, accept, agree
    acknowledgment_note TEXT,
    
    -- Digital signature if required
    digital_signature BYTEA,
    signature_timestamp TIMESTAMP WITH TIME ZONE,
    
    UNIQUE(announcement_id, user_id, acknowledgment_type)
);

CREATE INDEX IF NOT EXISTS idx_announcement_acks_announcement 
    ON announcement_acknowledgments(announcement_id);
CREATE INDEX IF NOT EXISTS idx_announcement_acks_user 
    ON announcement_acknowledgments(user_id);

-- Table: announcement_comments
-- Purpose: Comments on announcements
-- ============================================================================
CREATE TABLE IF NOT EXISTS announcement_comments (
    comment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    announcement_id UUID NOT NULL REFERENCES announcements(announcement_id) ON DELETE CASCADE,
    parent_comment_id UUID REFERENCES announcement_comments(comment_id) ON DELETE CASCADE,
    
    user_id UUID NOT NULL,
    user_name VARCHAR(100),
    
    comment_text TEXT NOT NULL,
    comment_type VARCHAR(20) DEFAULT 'comment', -- comment, question, suggestion
    is_internal BOOLEAN DEFAULT false, -- Only visible to admins
    
    -- Moderation
    is_approved BOOLEAN DEFAULT true,
    approved_by UUID,
    approved_at TIMESTAMP WITH TIME ZONE,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_announcement_comments_announcement 
    ON announcement_comments(announcement_id);
CREATE INDEX IF NOT EXISTS idx_announcement_comments_user 
    ON announcement_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_announcement_comments_parent 
    ON announcement_comments(parent_comment_id);

-- Table: announcement_notifications
-- Purpose: Push notifications for announcements
-- ============================================================================
CREATE TABLE IF NOT EXISTS announcement_notifications (
    notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    announcement_id UUID NOT NULL REFERENCES announcements(announcement_id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    
    -- Notification details
    notification_type VARCHAR(20) NOT NULL DEFAULT 'announcement',
    title VARCHAR(200),
    message TEXT,
    
    -- Delivery status
    channel VARCHAR(20) NOT NULL, -- email, sms, push, in_app
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, sent, delivered, read, failed
    sent_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    read_at TIMESTAMP WITH TIME ZONE,
    
    -- Failure tracking
    failure_reason TEXT,
    retry_count INTEGER DEFAULT 0,
    
    -- User preferences
    respect_user_preferences BOOLEAN DEFAULT true,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(announcement_id, user_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_announcement_notifications_user 
    ON announcement_notifications(user_id, status);
CREATE INDEX IF NOT EXISTS idx_announcement_notifications_announcement 
    ON announcement_notifications(announcement_id);

-- ============================================================================
-- SECTION 7: COMMON UTILITY TABLES
-- ============================================================================

-- Table: data_change_logs
-- Purpose: Generic audit trail for all data changes
-- ============================================================================
CREATE TABLE IF NOT EXISTS data_change_logs (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name VARCHAR(100) NOT NULL,
    record_id UUID NOT NULL,
    operation_type VARCHAR(20) NOT NULL, -- INSERT, UPDATE, DELETE
    changed_fields JSONB,
    old_values JSONB,
    new_values JSONB,
    
    -- User context
    user_id UUID,
    user_ip_address INET,
    user_agent TEXT,
    
    -- Timestamp
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_data_change_logs_table 
    ON data_change_logs(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_data_change_logs_date 
    ON data_change_logs(changed_at);
CREATE INDEX IF NOT EXISTS idx_data_change_logs_user 
    ON data_change_logs(user_id);

-- Table: system_parameters
-- Purpose: System-wide configuration parameters
-- ============================================================================
CREATE TABLE IF NOT EXISTS system_parameters (
    parameter_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parameter_key VARCHAR(100) NOT NULL UNIQUE,
    parameter_value TEXT NOT NULL,
    parameter_type VARCHAR(20) DEFAULT 'string', -- string, number, boolean, json
    parameter_group VARCHAR(50),
    description TEXT,
    
    -- Validation
    validation_rule TEXT,
    default_value TEXT,
    
    -- Status
    is_editable BOOLEAN DEFAULT true,
    is_encrypted BOOLEAN DEFAULT false,
    
    -- Audit fields
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- SECTION 8: TRIGGERS AND FUNCTIONS
-- ============================================================================

-- Function: Update timestamp on record update
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply timestamp triggers to all tables with updated_at
DO $$
DECLARE
    t text;
BEGIN
    FOR t IN 
        SELECT table_name 
        FROM information_schema.columns 
        WHERE column_name = 'updated_at'
        AND table_schema = 'public'
    LOOP
        EXECUTE format('
            CREATE TRIGGER update_%I_updated_at
            BEFORE UPDATE ON %I
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column()
        ', t, t);
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Function: Generate transaction number
-- ============================================================================
CREATE OR REPLACE FUNCTION generate_transaction_number(p_transaction_type VARCHAR)
RETURNS VARCHAR AS $$
DECLARE
    v_sequence_number INTEGER;
    v_year VARCHAR(4);
    v_month VARCHAR(2);
    v_transaction_number VARCHAR(50);
BEGIN
    SELECT INTO v_year EXTRACT(YEAR FROM CURRENT_DATE)::VARCHAR;
    SELECT INTO v_month LPAD(EXTRACT(MONTH FROM CURRENT_DATE)::VARCHAR, 2, '0');
    
    SELECT COALESCE(MAX(CAST(SUBSTRING(transaction_number FROM 7) AS INTEGER)), 0) + 1
    INTO v_sequence_number
    FROM stock_transactions
    WHERE transaction_type = p_transaction_type
    AND transaction_number LIKE v_year || v_month || '%';
    
    v_transaction_number := v_year || v_month || '-' || p_transaction_type || '-' || LPAD(v_sequence_number::VARCHAR, 6, '0');
    
    RETURN v_transaction_number;
END;
$$ LANGUAGE plpgsql;

-- Function: Calculate inventory value
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_inventory_value(p_item_id UUID, p_valuation_date DATE)
RETURNS DECIMAL(14, 4) AS $$
DECLARE
    v_total_value DECIMAL(14, 4) := 0;
    v_quantity DECIMAL(12, 4) := 0;
    v_unit_cost DECIMAL(12, 4) := 0;
BEGIN
    -- Get current stock level
    SELECT current_stock_level, average_cost
    INTO v_quantity, v_unit_cost
    FROM inventory_items
    WHERE item_id = p_item_id;
    
    v_total_value := v_quantity * v_unit_cost;
    
    RETURN v_total_value;
END;
$$ LANGUAGE plpgsql;

-- Function: Check stock alert thresholds
-- ============================================================================
CREATE OR REPLACE FUNCTION check_stock_thresholds(p_item_id UUID)
RETURNS void AS $$
DECLARE
    v_item RECORD;
    v_alert_count INTEGER;
    v_alert_id UUID;
BEGIN
    SELECT * INTO v_item FROM inventory_items WHERE item_id = p_item_id;
    
    -- Check for low stock
    IF v_item.current_stock_level <= v_item.reorder_point THEN
        SELECT COUNT(*) INTO v_alert_count
        FROM stock_alerts
        WHERE item_id = p_item_id
        AND alert_type = 'low_stock'
        AND alert_status IN ('active', 'acknowledged');
        
        IF v_alert_count = 0 THEN
            INSERT INTO stock_alerts (
                alert_code, alert_type, severity_level, item_id,
                alert_title, alert_message, alert_status
            ) VALUES (
                'LOW-STOCK-' || p_item_id::VARCHAR, 'low_stock', 
                CASE 
                    WHEN v_item.current_stock_level <= v_item.safety_stock_level THEN 'critical'
                    WHEN v_item.current_stock_level <= v_item.minimum_stock_level THEN 'high'
                    ELSE 'medium'
                END,
                p_item_id,
                'Low Stock Alert: ' || v_item.product_name,
                'Current stock level (' || v_item.current_stock_level || ' ' || v_item.unit_of_measure || 
                ') is at or below reorder point (' || v_item.reorder_point || ')',
                'active'
            );
        END IF;
    END IF;
    
    -- Check for overstock
    IF v_item.current_stock_level >= v_item.maximum_stock_level THEN
        SELECT COUNT(*) INTO v_alert_count
        FROM stock_alerts
        WHERE item_id = p_item_id
        AND alert_type = 'overstock'
        AND alert_status IN ('active', 'acknowledged');
        
        IF v_alert_count = 0 THEN
            INSERT INTO stock_alerts (
                alert_code, alert_type, severity_level, item_id,
                alert_title, alert_message, alert_status
            ) VALUES (
                'OVERSTOCK-' || p_item_id::VARCHAR, 'overstock', 'medium',
                p_item_id,
                'Overstock Alert: ' || v_item.product_name,
                'Current stock level (' || v_item.current_stock_level || ' ' || v_item.unit_of_measure || 
                ') exceeds maximum level (' || v_item.maximum_stock_level || ')',
                'active'
            );
        END IF;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- SECTION 9: VIEWS FOR COMMON QUERIES
-- ============================================================================

-- View: Current inventory status summary
-- ============================================================================
CREATE OR REPLACE VIEW v_inventory_status AS
SELECT 
    i.item_id,
    i.sku,
    i.product_name,
    i.category_id,
    c.category_name,
    i.current_stock_level,
    i.unit_of_measure,
    i.reorder_point,
    i.minimum_stock_level,
    i.maximum_stock_level,
    i.average_cost,
    (i.current_stock_level * i.average_cost) AS total_value,
    i.warehouse_location_id,
    w.warehouse_name,
    i.bin_location,
    s.supplier_name AS primary_supplier,
    CASE 
        WHEN i.current_stock_level <= i.safety_stock_level THEN 'critical'
        WHEN i.current_stock_level <= i.minimum_stock_level THEN 'low'
        WHEN i.current_stock_level <= i.reorder_point THEN 'reorder'
        ELSE 'adequate'
    END AS stock_status,
    CASE 
        WHEN i.current_stock_level <= i.reorder_point THEN true
        ELSE false
    END AS needs_reorder,
    i.updated_at
FROM inventory_items i
LEFT JOIN inventory_categories c ON i.category_id = c.category_id
LEFT JOIN inventory_warehouses w ON i.warehouse_location_id = w.warehouse_id
LEFT JOIN suppliers s ON i.primary_supplier_id = s.supplier_id
WHERE i.is_active = true;

-- View: Active stock alerts summary
-- ============================================================================
CREATE OR REPLACE VIEW v_active_alerts AS
SELECT 
    a.alert_id,
    a.alert_code,
    a.alert_type,
    a.severity_level,
    a.alert_title,
    a.alert_message,
    a.alert_status,
    i.item_id,
    i.sku,
    i.product_name,
    a.created_at,
    a.acknowledged_at,
    a.resolved_at,
    CASE a.severity_level
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
        ELSE 5
    END AS severity_order
FROM stock_alerts a
JOIN inventory_items i ON a.item_id = i.item_id
WHERE a.alert_status IN ('active', 'acknowledged')
ORDER BY severity_order, a.created_at DESC;

-- View: Supplier performance summary
-- ============================================================================
CREATE OR REPLACE VIEW v_supplier_performance AS
SELECT 
    s.supplier_id,
    s.supplier_code,
    s.supplier_name,
    s.is_active,
    s.is_approved,
    COUNT(DISTINCT spm.metric_id) AS total_evaluations,
    COALESCE(AVG(spm.on_time_delivery_rate), 0) AS avg_on_time_delivery,
    COALESCE(AVG(spm.quality_score), 0) AS avg_quality_score,
    COALESCE(AVG(spm.overall_score), 0) AS avg_overall_score,
    COALESCE(AVG(spm.responsiveness_score), 0) AS avg_responsiveness,
    COUNT(DISTINCT spa.agreement_id) AS active_agreements,
    COUNT(DISTINCT sds.schedule_id) AS delivery_schedules
FROM suppliers s
LEFT JOIN supplier_performance_metrics spm ON s.supplier_id = spm.supplier_id
LEFT JOIN supplier_pricing_agreements spa ON s.supplier_id = spa.supplier_id 
    AND spa.is_active = true
LEFT JOIN supplier_delivery_schedules sds ON s.supplier_id = sds.supplier_id 
    AND sds.is_active = true
GROUP BY s.supplier_id, s.supplier_code, s.supplier_name, s.is_active, s.is_approved;

-- View: Transaction summary by type
-- ============================================================================
CREATE OR REPLACE VIEW v_transaction_summary AS
SELECT 
    DATE_TRUNC('day', transaction_date)::DATE AS transaction_date,
    transaction_type,
    COUNT(*) AS transaction_count,
    SUM(quantity) AS total_quantity,
    SUM(total_cost) AS total_value
FROM stock_transactions
WHERE transaction_status = 'completed'
GROUP BY DATE_TRUNC('day', transaction_date)::DATE, transaction_type
ORDER BY transaction_date DESC;

-- ============================================================================
-- SECTION 10: SAMPLE DATA
-- ============================================================================

-- Sample inventory categories
-- ============================================================================
INSERT INTO inventory_categories (category_code, category_name, description, display_order) VALUES
('VACC', 'Vaccines', 'All types of vaccines and immunizations', 1),
('MEDS', 'Medicines', 'Pharmaceutical medications', 2),
('SUPPL', 'Supplies', 'Medical supplies and consumables', 3),
('EQUIP', 'Equipment', 'Medical equipment and devices', 4),
('LAB', 'Laboratory', 'Laboratory reagents and supplies', 5),
('SANIT', 'Sanitation', 'Sanitation and hygiene products', 6);

-- Sample inventory warehouses
-- ============================================================================
INSERT INTO inventory_warehouses (warehouse_code, warehouse_name, warehouse_type, city, is_primary) VALUES
('WH-MAIN', 'Main Warehouse', 'main', 'Manila', true),
('WH-COLD', 'Cold Storage Facility', 'cold_storage', 'Manila', false),
('WH-SUB', 'Satellite Warehouse - South', 'satellite', 'Cebu', false);

-- Sample inventory items
-- ============================================================================
INSERT INTO inventory_items (
    sku, product_name, description, category_id, current_stock_level, 
    reorder_point, unit_cost, warehouse_location_id, unit_of_measure,
    expiration_tracking, temperature_sensitive, storage_temperature
) VALUES
(
    'VAC-001', 'Pfizer-BioNTech COVID-19 Vaccine', 
    'COVID-19 mRNA vaccine, 30mcg dose', 
    (SELECT category_id FROM inventory_categories WHERE category_code = 'VACC'),
    500, 100, 15.50, 
    (SELECT warehouse_id FROM inventory_warehouses WHERE warehouse_code = 'WH-COLD'),
    'doses', true, true, -70
),
(
    'VAC-002', 'Influenza Vaccine (Quadrivalent)', 
    'Seasonal flu vaccine, 2024-2025 strain',
    (SELECT category_id FROM inventory_categories WHERE category_code = 'VACC'),
    200, 50, 12.00,
    (SELECT warehouse_id FROM inventory_warehouses WHERE warehouse_code = 'WH-COLD'),
    'doses', true, true, 2
),
(
    'MED-001', 'Paracetamol 500mg', 
    'Analgesic and antipyretic tablets',
    (SELECT category_id FROM inventory_categories WHERE category_code = 'MEDS'),
    5000, 1000, 0.25,
    (SELECT warehouse_id FROM inventory_warehouses WHERE warehouse_code = 'WH-MAIN'),
    'tablets', true, false, 25
),
(
    'SUP-001', 'Surgical Face Masks', 
    '3-ply disposable surgical masks',
    (SELECT category_id FROM inventory_categories WHERE category_code = 'SUPPL'),
    10000, 2000, 0.15,
    (SELECT warehouse_id FROM inventory_warehouses WHERE warehouse_code = 'WH-MAIN'),
    'pieces', false, false, 25
);

-- Sample suppliers
-- ============================================================================
INSERT INTO suppliers (
    supplier_code, supplier_name, email, phone, business_type,
    is_active, is_approved
) VALUES
('SUP-001', 'PharmaCare Distributors Inc.', 'sales@pharmacare.com', '+632-8123-4567', 'distributor', true, true),
('SUP-002', 'Medical Supplies Co.', 'orders@medsupplies.com', '+632-8234-5678', 'wholesaler', true, true),
('SUP-003', 'Vaccine Direct Philippines', 'contact@vaccinedirect.ph', '+632-8345-6789', 'manufacturer', true, true);

-- Sample alert rule
-- ============================================================================
INSERT INTO alert_rules (
    rule_code, rule_name, rule_description, alert_type, severity_level,
    condition_expression, threshold_type, threshold_value, threshold_comparison,
    check_frequency_minutes, is_enabled
) VALUES
('LOW-STOCK-RULE', 'Low Stock Alert', 'Trigger alert when stock falls below reorder point', 
    'low_stock', 'medium',
    'current_stock_level <= reorder_point',
    'absolute', 0, 'lte', 60, true);

-- Sample announcement
-- ============================================================================
INSERT INTO announcements (
    announcement_code, title, content, content_type, category,
    status, target_audience_type, requires_acknowledgment,
    created_by
) VALUES
('ANN-001', 'System Maintenance Scheduled', 
    'The inventory management system will undergo scheduled maintenance on February 15, 2024, from 10:00 PM to 2:00 AM. During this time, the system may be temporarily unavailable.',
    'maintenance', 'system', 'published', 'all', true,
    (SELECT user_id FROM users WHERE email = 'admin@immunicare.com' LIMIT 1)
);

-- ============================================================================
-- END OF SCHEMA
-- ============================================================================
