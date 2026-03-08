# Immunicare Inventory Management System - Implementation Guide

## Table of Contents

1. [System Overview](#system-overview)
2. [Database Schema Architecture](#database-schema-architecture)
3. [Module Specifications](#module-specifications)
4. [Data Relationships](#data-relationships)
5. [Indexing Strategy](#indexing-strategy)
6. [Constraint Definitions](#constraint-definitions)
7. [API Integration Guide](#api-integration-guide)
8. [UI Component Architecture](#ui-component-architecture)
9. [Best Practices](#best-practices)
10. [Data Integrity Guidelines](#data-integrity-guidelines)

---

## System Overview

The Immunicare Inventory Management System provides a comprehensive solution for managing:

- **Inventory Items**: Complete tracking of medical supplies, vaccines, and equipment
- **Stock Alerts**: Proactive notifications for low stock, overstock, and expiring items
- **Stock Transactions**: Full audit trail of all inventory movements
- **Supplier Management**: Vendor performance tracking and relationship management
- **Reports Module**: Flexible reporting with scheduling and export capabilities
- **Announcements Module**: Communication system for system-wide notifications

---

## Database Schema Architecture

### 1. Inventory Management Tables

#### `inventory_items` - Core Item Table

```sql
-- Primary Key: item_id (UUID)
-- Critical Indexes: sku, barcode, category_id, supplier_id, stock_level

CREATE TABLE inventory_items (
    item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku VARCHAR(50) NOT NULL UNIQUE,           -- Stock Keeping Unit
    barcode VARCHAR(100),                       -- Barcode/Scannable code
    product_name VARCHAR(200) NOT NULL,
    description TEXT,
    category_id UUID NOT NULL REFERENCES inventory_categories(category_id),

    -- Stock tracking
    current_stock_level DECIMAL(12, 4) DEFAULT 0,
    minimum_stock_level DECIMAL(12, 4) DEFAULT 0,
    reorder_point DECIMAL(12, 4) DEFAULT 0,
    maximum_stock_level DECIMAL(12, 4) DEFAULT 0,
    safety_stock_level DECIMAL(12, 4) DEFAULT 0,

    -- Cost and valuation
    unit_cost DECIMAL(12, 4) DEFAULT 0,
    average_cost DECIMAL(12, 4) DEFAULT 0,
    valuation_method VARCHAR(20) DEFAULT 'FIFO',

    -- Location
    warehouse_location_id UUID REFERENCES inventory_warehouses(warehouse_id),
    bin_location VARCHAR(50),

    -- Supplier
    primary_supplier_id UUID REFERENCES suppliers(supplier_id),

    -- Tracking flags
    batch_tracking_enabled BOOLEAN DEFAULT false,
    expiration_tracking BOOLEAN DEFAULT false,
    temperature_sensitive BOOLEAN DEFAULT false,

    -- Status
    is_active BOOLEAN DEFAULT true,

    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

#### `inventory_categories` - Hierarchical Categories

```sql
CREATE TABLE inventory_categories (
    category_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_code VARCHAR(20) NOT NULL UNIQUE,
    category_name VARCHAR(100) NOT NULL,
    parent_category_id UUID REFERENCES inventory_categories(category_id),
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0
);
```

#### `inventory_warehouses` - Storage Facilities

```sql
CREATE TABLE inventory_warehouses (
    warehouse_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_code VARCHAR(20) NOT NULL UNIQUE,
    warehouse_name VARCHAR(100) NOT NULL,
    warehouse_type VARCHAR(30) DEFAULT 'main',
    address_line1 VARCHAR(200),
    city VARCHAR(100),
    country VARCHAR(100) DEFAULT 'Philippines',
    is_active BOOLEAN DEFAULT true,
    is_primary BOOLEAN DEFAULT false
);
```

#### `inventory_locations` - Bin Locations

```sql
CREATE TABLE inventory_locations (
    location_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES inventory_warehouses(warehouse_id),
    location_code VARCHAR(30) NOT NULL,
    location_type VARCHAR(30) DEFAULT 'bin',
    max_capacity DECIMAL(12, 4),
    temperature_zone VARCHAR(20),
    is_active BOOLEAN DEFAULT true,
    UNIQUE(warehouse_id, location_code)
);
```

#### `inventory_stock_history` - Historical Tracking

```sql
CREATE TABLE inventory_stock_history (
    history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES inventory_items(item_id),
    warehouse_id UUID REFERENCES inventory_warehouses(warehouse_id),
    stock_before DECIMAL(12, 4) DEFAULT 0,
    stock_after DECIMAL(12, 4) DEFAULT 0,
    change_quantity DECIMAL(12, 4) DEFAULT 0,
    transaction_id UUID,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

---

### 2. Stock Alerts Tables

#### `stock_alerts` - Alert Definitions

```sql
CREATE TABLE stock_alerts (
    alert_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_code VARCHAR(30) NOT NULL UNIQUE,
    alert_type VARCHAR(30) NOT NULL,        -- low_stock, overstock, expiring, reorder_deadline
    severity_level VARCHAR(20) NOT NULL,    -- critical, high, medium, low, info
    priority_score INTEGER DEFAULT 0,

    item_id UUID NOT NULL REFERENCES inventory_items(item_id),
    threshold_value DECIMAL(12, 4),
    current_value DECIMAL(12, 4),

    alert_title VARCHAR(200) NOT NULL,
    alert_message TEXT NOT NULL,
    recommended_action TEXT,

    alert_status VARCHAR(20) DEFAULT 'active',  -- active, acknowledged, resolved, dismissed
    acknowledged_by UUID,
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    resolved_by UUID,
    resolved_at TIMESTAMP WITH TIME ZONE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

#### `alert_rules` - Automated Alert Rules

```sql
CREATE TABLE alert_rules (
    rule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_code VARCHAR(30) NOT NULL UNIQUE,
    rule_name VARCHAR(100) NOT NULL,
    alert_type VARCHAR(30) NOT NULL,
    severity_level VARCHAR(20) DEFAULT 'medium',

    condition_expression TEXT NOT NULL,
    condition_item_category UUID,
    condition_warehouse_ids UUID[],

    threshold_type VARCHAR(20),
    threshold_value DECIMAL(12, 4),
    threshold_comparison VARCHAR(10),

    check_frequency_minutes INTEGER DEFAULT 60,
    is_enabled BOOLEAN DEFAULT true
);
```

---

### 3. Stock Transactions Tables

#### `stock_transactions` - Transaction Audit Trail

```sql
CREATE TABLE stock_transactions (
    transaction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_number VARCHAR(50) NOT NULL UNIQUE,
    transaction_type VARCHAR(30) NOT NULL,  -- receipt, issue, transfer, adjustment, return
    transaction_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    item_id UUID NOT NULL REFERENCES inventory_items(item_id),
    quantity DECIMAL(12, 4) NOT NULL,
    unit_of_measure VARCHAR(30) DEFAULT 'units',

    source_warehouse_id UUID REFERENCES inventory_warehouses(warehouse_id),
    destination_warehouse_id UUID REFERENCES inventory_warehouses(warehouse_id),

    unit_cost DECIMAL(12, 4) DEFAULT 0,
    total_cost DECIMAL(14, 4) DEFAULT 0,

    reference_type VARCHAR(50),
    reference_number VARCHAR(100),

    batch_number VARCHAR(50),
    expiration_date DATE,

    authorization_status VARCHAR(20) DEFAULT 'approved',
    authorized_by UUID,

    created_by UUID NOT NULL,
    transaction_status VARCHAR(20) DEFAULT 'completed'
);
```

#### `transfer_requests` - Inter-Warehouse Transfers

```sql
CREATE TABLE transfer_requests (
    transfer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_number VARCHAR(50) NOT NULL UNIQUE,
    source_warehouse_id UUID NOT NULL REFERENCES inventory_warehouses(warehouse_id),
    destination_warehouse_id UUID NOT NULL REFERENCES inventory_warehouses(warehouse_id),

    transfer_status VARCHAR(20) DEFAULT 'pending',
    priority VARCHAR(20) DEFAULT 'normal',

    requested_by UUID NOT NULL,
    approved_by UUID,
    approved_at TIMESTAMP WITH TIME ZONE,

    expected_delivery_date DATE,
    actual_delivery_date DATE
);
```

---

### 4. Supplier Management Tables

#### `suppliers` - Vendor Information

```sql
CREATE TABLE suppliers (
    supplier_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_code VARCHAR(20) NOT NULL UNIQUE,
    supplier_name VARCHAR(200) NOT NULL,
    legal_name VARCHAR(200),
    tax_identification_number VARCHAR(50),

    contact_person VARCHAR(100),
    email VARCHAR(100),
    phone VARCHAR(30),

    address_line1 VARCHAR(200),
    city VARCHAR(100),
    country VARCHAR(100) DEFAULT 'Philippines',

    business_type VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    is_approved BOOLEAN DEFAULT false,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

#### `supplier_performance_metrics` - Performance Tracking

```sql
CREATE TABLE supplier_performance_metrics (
    metric_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID NOT NULL REFERENCES suppliers(supplier_id),
    metric_date DATE NOT NULL,

    quality_score DECIMAL(5, 2),
    on_time_delivery_rate DECIMAL(5, 2),
    responsiveness_score DECIMAL(5, 2),
    overall_score DECIMAL(5, 2),
    performance_rating VARCHAR(10),

    evaluated_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

#### `supplier_pricing_agreements` - Pricing Contracts

```sql
CREATE TABLE supplier_pricing_agreements (
    agreement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID NOT NULL REFERENCES suppliers(supplier_id),
    agreement_code VARCHAR(30) NOT NULL UNIQUE,
    agreement_type VARCHAR(30) NOT NULL,

    effective_date DATE NOT NULL,
    expiration_date DATE,
    is_active BOOLEAN DEFAULT true,

    currency_code VARCHAR(3) DEFAULT 'PHP',
    payment_terms VARCHAR(50),

    discount_type VARCHAR(20),
    discount_value DECIMAL(8, 4),

    volume_tier_1_min DECIMAL(12, 4),
    volume_tier_1_discount DECIMAL(8, 4),
    -- Additional tiers...

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

---

### 5. Reports Module Tables

#### `report_definitions` - Report Configuration

```sql
CREATE TABLE report_definitions (
    report_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_code VARCHAR(50) NOT NULL UNIQUE,
    report_name VARCHAR(200) NOT NULL,
    report_category VARCHAR(50) NOT NULL,
    report_type VARCHAR(30) NOT NULL,

    icon VARCHAR(50),
    color VARCHAR(20),
    display_order INTEGER DEFAULT 0,

    required_role VARCHAR(50),
    parameter_definitions JSONB,
    export_formats VARCHAR(50)[],

    is_active BOOLEAN DEFAULT true,
    is_schedulable BOOLEAN DEFAULT false
);
```

#### `report_schedules` - Automated Scheduling

```sql
CREATE TABLE report_schedules (
    schedule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES report_definitions(report_id),
    schedule_name VARCHAR(100) NOT NULL,

    schedule_type VARCHAR(20) NOT NULL,
    cron_expression VARCHAR(100),

    recipients JSONB NOT NULL,
    export_format VARCHAR(20) DEFAULT 'pdf',

    is_enabled BOOLEAN DEFAULT true,
    next_run_at TIMESTAMP WITH TIME ZONE
);
```

---

### 6. Announcements Module Tables

#### `announcements` - Announcement Content

```sql
CREATE TABLE announcements (
    announcement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    announcement_code VARCHAR(30) NOT NULL UNIQUE,
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    content_type VARCHAR(30) DEFAULT 'general',
    priority VARCHAR(20) DEFAULT 'normal',

    category VARCHAR(50) NOT NULL,
    tags VARCHAR(200),

    target_audience_type VARCHAR(30) NOT NULL,
    target_roles VARCHAR(50)[],
    target_users UUID[],

    publish_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expiration_date TIMESTAMP WITH TIME ZONE,

    status VARCHAR(20) DEFAULT 'draft',
    requires_acknowledgment BOOLEAN DEFAULT false,
    acknowledgment_deadline TIMESTAMP WITH TIME ZONE,

    created_by UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

#### `announcement_read_receipts` - Read Tracking

```sql
CREATE TABLE announcement_read_receipts (
    receipt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    announcement_id UUID NOT NULL REFERENCES announcements(announcement_id),
    user_id UUID NOT NULL,
    read_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(announcement_id, user_id)
);
```

#### `announcement_acknowledgments` - Acknowledgment Tracking

```sql
CREATE TABLE announcement_acknowledgments (
    acknowledgment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    announcement_id UUID NOT NULL REFERENCES announcements(announcement_id),
    user_id UUID NOT NULL,
    acknowledgment_type VARCHAR(20) DEFAULT 'read',
    acknowledged_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(announcement_id, user_id, acknowledgment_type)
);
```

---

## Data Relationships

### Entity Relationship Diagram (ERD)

```
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│   inventory_    │       │  inventory_     │       │   inventory_    │
│   categories    │◄──────│     items       │──────►│   warehouses    │
│                 │       │                 │       │                 │
└─────────────────┘       └─────────────────┘       └─────────────────┘
                                │
                                │◄─────────────────┐
                                ▼                  │
                        ┌─────────────────┐       │
                        │  stock_alerts    │       │
                        │                 │       │
                        └─────────────────┘       │
                                                  │
                        ┌─────────────────┐       │
                        │ stock_transactions│◄─────┤
                        │                 │       │
                        └─────────────────┘       │
                                                  │
                        ┌─────────────────┐       │
                        │     suppliers   │◄──────┘
                        │                 │
                        └─────────────────┘
                                │
                                ▼
                        ┌─────────────────┐
                        │ supplier_perform│
                        │    ance_metrics │
                        └─────────────────┘

┌─────────────────┐       ┌─────────────────┐
│     report_     │       │   announcement  │
│   definitions   │       │     s           │
│                 │       │                 │
└─────────────────┘       └─────────────────┘
```

### Key Relationships

| Parent Table           | Child Table                    | Foreign Key             | Relationship |
| ---------------------- | ------------------------------ | ----------------------- | ------------ |
| `inventory_categories` | `inventory_items`              | `category_id`           | One-to-Many  |
| `inventory_warehouses` | `inventory_items`              | `warehouse_location_id` | One-to-Many  |
| `inventory_warehouses` | `inventory_locations`          | `warehouse_id`          | One-to-Many  |
| `suppliers`            | `inventory_items`              | `primary_supplier_id`   | One-to-Many  |
| `suppliers`            | `supplier_performance_metrics` | `supplier_id`           | One-to-Many  |
| `inventory_items`      | `stock_alerts`                 | `item_id`               | One-to-Many  |
| `inventory_items`      | `stock_transactions`           | `item_id`               | One-to-Many  |
| `stock_transactions`   | `stock_stock_history`          | `transaction_id`        | One-to-Many  |
| `announcements`        | `announcement_read_receipts`   | `announcement_id`       | One-to-Many  |
| `report_definitions`   | `report_schedules`             | `report_id`             | One-to-Many  |

---

## Indexing Strategy

### Primary Indexes (Primary Keys)

All primary keys are automatically indexed by PostgreSQL.

### Critical Query Indexes

```sql
-- Inventory Items
CREATE INDEX idx_inventory_items_sku ON inventory_items(sku);
CREATE INDEX idx_inventory_items_barcode ON inventory_items(barcode);
CREATE INDEX idx_inventory_items_category ON inventory_items(category_id);
CREATE INDEX idx_inventory_items_supplier ON inventory_items(primary_supplier_id);
CREATE INDEX idx_inventory_items_stock_level ON inventory_items(current_stock_level);
CREATE INDEX idx_inventory_items_reorder_point ON inventory_items(reorder_point);
CREATE INDEX idx_inventory_items_active ON inventory_items(is_active) WHERE is_active = true;

-- Stock Alerts
CREATE INDEX idx_stock_alerts_type ON stock_alerts(alert_type);
CREATE INDEX idx_stock_alerts_severity ON stock_alerts(severity_level);
CREATE INDEX idx_stock_alerts_status ON stock_alerts(alert_status);
CREATE INDEX idx_stock_alerts_active ON stock_alerts(alert_status, severity_level)
    WHERE alert_status IN ('active', 'acknowledged');

-- Stock Transactions
CREATE INDEX idx_stock_transactions_number ON stock_transactions(transaction_number);
CREATE INDEX idx_stock_transactions_type ON stock_transactions(transaction_type);
CREATE INDEX idx_stock_transactions_date ON stock_transactions(transaction_date);
CREATE INDEX idx_stock_transactions_item ON stock_transactions(item_id);
CREATE INDEX idx_stock_transactions_reference ON stock_transactions(reference_type, reference_number);

-- Suppliers
CREATE INDEX idx_suppliers_code ON suppliers(supplier_code);
CREATE INDEX idx_suppliers_name ON suppliers(supplier_name);
CREATE INDEX idx_suppliers_active ON suppliers(is_active);

-- Announcements
CREATE INDEX idx_announcements_status ON announcements(status);
CREATE INDEX idx_announcements_publish_date ON announcements(publish_date);
CREATE INDEX idx_announcements_active ON announcements(status, publish_date, expiration_date)
    WHERE status = 'published';

-- Historical Data
CREATE INDEX idx_inventory_stock_history_date ON inventory_stock_history(recorded_at);
CREATE INDEX idx_inventory_valuation_period ON inventory_valuation(fiscal_year, fiscal_period);
```

### Composite Indexes for Common Queries

```sql
-- Inventory by category and stock status
CREATE INDEX idx_inventory_category_status ON inventory_items(category_id, current_stock_level)
    WHERE is_active = true;

-- Transactions by date and type
CREATE INDEX idx_transactions_date_type ON stock_transactions(transaction_date, transaction_type)
    WHERE transaction_status = 'completed';

-- Alerts by item and status
CREATE INDEX idx_alerts_item_status ON stock_alerts(item_id, alert_status);
```

### Partial Indexes for Performance

```sql
-- Only active items
CREATE INDEX idx_active_inventory ON inventory_items(item_id, sku, product_name)
    WHERE is_active = true;

-- Pending alerts only
CREATE INDEX idx_pending_alerts ON stock_alerts(alert_id, alert_type, severity_level)
    WHERE alert_status IN ('active', 'acknowledged');

-- Completed transactions for this year
CREATE INDEX idx_current_year_transactions ON stock_transactions(transaction_id, transaction_type)
    WHERE transaction_status = 'completed'
    AND transaction_date >= '2024-01-01';
```

---

## Constraint Definitions

### NOT NULL Constraints

```sql
-- Inventory Items
ALTER TABLE inventory_items
ALTER COLUMN sku SET NOT NULL,
ALTER COLUMN product_name SET NOT NULL,
ALTER COLUMN category_id SET NOT NULL,
ALTER COLUMN unit_of_measure SET NOT NULL,
ALTER COLUMN current_stock_level SET NOT NULL DEFAULT 0;
```

### CHECK Constraints

```sql
-- Stock levels must be non-negative
ALTER TABLE inventory_items
ADD CONSTRAINT chk_positive_stock_levels
CHECK (current_stock_level >= 0 AND minimum_stock_level >= 0
       AND reorder_point >= 0 AND maximum_stock_level >= 0);

-- Quantity must be positive in transactions
ALTER TABLE stock_transactions
ADD CONSTRAINT chk_transaction_quantity
CHECK (quantity != 0);

-- Severity levels must be valid
ALTER TABLE stock_alerts
ADD CONSTRAINT chk_severity_level
CHECK (severity_level IN ('critical', 'high', 'medium', 'low', 'info'));
```

### UNIQUE Constraints

```sql
ALTER TABLE inventory_items ADD CONSTRAINT uq_sku UNIQUE (sku);
ALTER TABLE inventory_items ADD CONSTRAINT uq_barcode UNIQUE (barcode);
ALTER TABLE inventory_categories ADD CONSTRAINT uq_category_code UNIQUE (category_code);
ALTER TABLE inventory_warehouses ADD CONSTRAINT uq_warehouse_code UNIQUE (warehouse_code);
ALTER TABLE suppliers ADD CONSTRAINT uq_supplier_code UNIQUE (supplier_code);
```

### Foreign Key Constraints

```sql
-- Inventory Items
ALTER TABLE inventory_items
ADD CONSTRAINT fk_item_category
FOREIGN KEY (category_id) REFERENCES inventory_categories(category_id)
ON DELETE RESTRICT;

ALTER TABLE inventory_items
ADD CONSTRAINT fk_item_warehouse
FOREIGN KEY (warehouse_location_id) REFERENCES inventory_warehouses(warehouse_id)
ON DELETE SET NULL;

ALTER TABLE inventory_items
ADD CONSTRAINT fk_item_supplier
FOREIGN KEY (primary_supplier_id) REFERENCES suppliers(supplier_id)
ON DELETE SET NULL;

-- Stock Transactions
ALTER TABLE stock_transactions
ADD CONSTRAINT fk_transaction_item
FOREIGN KEY (item_id) REFERENCES inventory_items(item_id)
ON DELETE RESTRICT;

ALTER TABLE stock_transactions
ADD CONSTRAINT fk_transaction_source_warehouse
FOREIGN KEY (source_warehouse_id) REFERENCES inventory_warehouses(warehouse_id)
ON DELETE SET NULL;
```

---

## API Integration Guide

### API Endpoints

#### Inventory Items

```javascript
// GET /api/inventory/items
// Query Parameters: category_id, warehouse_id, supplier_id, stock_status
const getInventoryItems = async (params) => {
  return apiClient.get('/inventory/items', { params });
};

// GET /api/inventory/items/:id
const getInventoryItem = async (itemId) => {
  return apiClient.get(`/inventory/items/${itemId}`);
};

// POST /api/inventory/items
const createInventoryItem = async (data) => {
  return apiClient.post('/inventory/items', data);
};

// PUT /api/inventory/items/:id
const updateInventoryItem = async (itemId, data) => {
  return apiClient.put(`/inventory/items/${itemId}`, data);
};

// DELETE /api/inventory/items/:id
const deleteInventoryItem = async (itemId) => {
  return apiClient.delete(`/inventory/items/${itemId}`);
};
```

#### Stock Alerts

```javascript
// GET /api/stock-alerts
// Query Parameters: status, severity, type, item_id
const getStockAlerts = async (params) => {
  return apiClient.get('/stock-alerts', { params });
};

// PUT /api/stock-alerts/:id/acknowledge
const acknowledgeAlert = async (alertId) => {
  return apiClient.put(`/stock-alerts/${alertId}/acknowledge`);
};

// PUT /api/stock-alerts/:id/resolve
const resolveAlert = async (alertId, resolution) => {
  return apiClient.put(`/stock-alerts/${alertId}/resolve`, resolution);
};
```

#### Stock Transactions

```javascript
// GET /api/stock-transactions
// Query Parameters: type, date_from, date_to, item_id
const getStockTransactions = async (params) => {
  return apiClient.get('/stock-transactions', { params });
};

// POST /api/stock-transactions/receipt
const createReceipt = async (data) => {
  return apiClient.post('/stock-transactions/receipt', data);
};

// POST /api/stock-transactions/issue
const createIssue = async (data) => {
  return apiClient.post('/stock-transactions/issue', data);
};

// POST /api/stock-transactions/transfer
const createTransfer = async (data) => {
  return apiClient.post('/stock-transactions/transfer', data);
};
```

#### Suppliers

```javascript
// GET /api/suppliers
const getSuppliers = async (params) => {
  return apiClient.get('/suppliers', { params });
};

// GET /api/suppliers/:id
const getSupplier = async (supplierId) => {
  return apiClient.get(`/suppliers/${supplierId}`);
};

// GET /api/suppliers/:id/performance
const getSupplierPerformance = async (supplierId, params) => {
  return apiClient.get(`/suppliers/${supplierId}/performance`, { params });
};

// POST /api/suppliers/:id/rating
const rateSupplier = async (supplierId, data) => {
  return apiClient.post(`/suppliers/${supplierId}/rating`, data);
};
```

#### Reports

```javascript
// GET /api/reports
const getReports = async () => {
  return apiClient.get('/reports');
};

// GET /api/reports/:id/generate
const generateReport = async (reportId, params) => {
  return apiClient.get(`/reports/${reportId}/generate`, { params });
};

// POST /api/reports/:id/export
const exportReport = async (reportId, data) => {
  return apiClient.post(`/reports/${reportId}/export`, data, {
    responseType: 'blob',
  });
};

// GET /api/reports/schedules
const getReportSchedules = async () => {
  return apiClient.get('/reports/schedules');
};
```

#### Announcements

```javascript
// GET /api/announcements
const getAnnouncements = async (params) => {
  return apiClient.get('/announcements', { params });
};

// GET /api/announcements/my
const getMyAnnouncements = async () => {
  return apiClient.get('/announcements/my');
};

// POST /api/announcements
const createAnnouncement = async (data) => {
  return apiClient.post('/announcements', data);
};

// PUT /api/announcements/:id/publish
const publishAnnouncement = async (announcementId) => {
  return apiClient.put(`/announcements/${announcementId}/publish`);
};

// POST /api/announcements/:id/acknowledge
const acknowledgeAnnouncement = async (announcementId, data) => {
  return apiClient.post(`/announcements/${announcementId}/acknowledge`, data);
};
```

---

## UI Component Architecture

### Inventory Reports Component

```
InventoryReports/
├── Header
│   ├── Title
│   ├── Export Button
│   └── Refresh Button
├── Stats Cards
│   ├── Total Items
│   ├── Total Value
│   ├── Critical Stock
│   └── Active Alerts
├── Filters
│   ├── Category Select
│   ├── Warehouse Select
│   ├── Stock Status Select
│   └── Date Range Picker
├── Tabs
│   ├── Inventory Items Table
│   │   ├── SKU Column
│   │   ├── Product Name Column
│   │   ├── Stock Level Column
│   │   ├── Value Column
│   │   ├── Location Column
│   │   └── Status Badge
│   ├── Stock Alerts Table
│   │   ├── Severity Badge
│   │   ├── Alert Type
│   │   └── Status
│   ├── Transactions Table
│   │   ├── Transaction Number
│   │   ├── Type Badge
│   │   └── Quantity
│   └── Suppliers Table
│       ├── Performance Score
│       └── Contact Info
└── Modals
    ├── Export Modal
    ├── Item Details Modal
    └── Transaction Modal
```

### Announcements Component

```
Announcements/
├── Header
│   ├── Title
│   ├── Filter Button
│   └── Create Button
├── Stats Cards
│   ├── Total Announcements
│   ├── Published
│   ├── Pending Acknowledgment
│   └── Unread
├── Search Bar
├── Tabs
│   ├── All Announcements Table
│   │   ├── Status Badge
│   │   ├── Title
│   │   ├── Type Badge
│   │   └── Priority
│   └── My Announcements List
│       ├── Content Preview
│       └── Actions
└── Modals
    ├── Create Announcement Modal
    │   ├── Title Input
    │   ├── Content Editor
    │   ├── Type Select
    │   ├── Priority Select
    │   ├── Target Audience
    │   └── Scheduling
    ├── View Announcement Modal
    │   ├── Full Content
    │   ├── Acknowledgment Section
    │   └── Attachments
    └── Filter Modal
```

---

## Best Practices

### 1. Data Entry Guidelines

#### Inventory Items

- Always generate a unique SKU before saving
- Set appropriate reorder points based on consumption patterns
- Enable batch tracking for items with expiration dates
- Record temperature requirements for sensitive items
- Keep unit costs updated for accurate valuation

#### Stock Transactions

- Always reference source documents (PO, SO, etc.)
- Use negative quantities for issues, positive for receipts
- Include batch numbers when tracking batches
- Get proper authorization for high-value transactions
- Record transactions immediately upon completion

#### Supplier Management

- Maintain complete contact information
- Update performance metrics regularly
- Keep pricing agreements current
- Document quality issues promptly
- Review supplier ratings quarterly

### 2. Query Optimization

#### Avoid N+1 Queries

```javascript
// Instead of this
const items = await getInventoryItems();
for (const item of items) {
  const alerts = await getAlertsForItem(item.id); // N+1 query!
}

// Use this
const items = await getInventoryItems({ include_alerts: true });
```

#### Use Pagination

```javascript
const getInventoryItems = async (params) => {
  return apiClient.get('/inventory/items', {
    params: {
      ...params,
      page: params.page || 1,
      limit: params.limit || 50,
    },
  });
};
```

#### Select Only Required Fields

```javascript
// Instead of fetching all fields
const items = await apiClient.getInventoryItems();

// Fetch only needed fields
const items = await apiClient.getInventoryItems({
  fields: 'item_id,sku,product_name,current_stock_level',
});
```

### 3. Data Validation

#### Frontend Validation

- Validate SKU format before submission
- Check stock levels don't go negative
- Verify date ranges are logical
- Confirm quantities are reasonable
- Validate required fields

#### Backend Validation

```javascript
const validateInventoryItem = (data) => {
  const errors = [];

  if (!data.sku || data.sku.length < 3) {
    errors.push('SKU must be at least 3 characters');
  }

  if (data.current_stock_level < 0) {
    errors.push('Stock level cannot be negative');
  }

  if (data.reorder_point > data.maximum_stock_level) {
    errors.push('Reorder point cannot exceed maximum stock level');
  }

  return errors;
};
```

### 4. Error Handling

#### API Error Handling

```javascript
const fetchData = async () => {
  try {
    const response = await apiClient.getInventoryItems();
    return response.data;
  } catch (error) {
    if (error.response) {
      // Server responded with error
      console.error('Server error:', error.response.data);
      showNotification('Failed to load data', 'error');
    } else if (error.request) {
      // Request made but no response
      console.error('No response:', error.request);
      showNotification('Server unavailable', 'error');
    }
    throw error;
  }
};
```

---

## Data Integrity Guidelines

### 1. Transaction Management

#### Use Database Transactions for Related Operations

```javascript
const processReceipt = async (data) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Create transaction record
    const transaction = await createTransaction(client, data);

    // Update stock level
    await updateStockLevel(client, {
      item_id: data.item_id,
      quantity: data.quantity,
      warehouse_id: data.warehouse_id,
    });

    // Create history record
    await createStockHistory(client, {
      transaction_id: transaction.id,
      ...data,
    });

    await client.query('COMMIT');
    return transaction;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
```

### 2. Audit Logging

#### Track All Data Changes

```sql
CREATE TABLE data_change_logs (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name VARCHAR(100) NOT NULL,
    record_id UUID NOT NULL,
    operation_type VARCHAR(20) NOT NULL,
    old_values JSONB,
    new_values JSONB,
    user_id UUID,
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Trigger for automatic logging
CREATE OR REPLACE FUNCTION log_data_changes()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO data_change_logs (
        table_name, record_id, operation_type, old_values, new_values, user_id
    ) VALUES (
        TG_TABLE_NAME,
        COALESCE(NEW.item_id, OLD.item_id),
        TG_OP,
        CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE NULL END,
        CASE WHEN TG_OP != 'DELETE' THEN to_jsonb(NEW) ELSE NULL END,
        current_setting('app.current_user_id', true)::UUID
    );
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
```

### 3. Data Consistency Checks

#### Regular Integrity Checks

```sql
-- Check for orphaned foreign keys
SELECT 'inventory_items' AS table_name, COUNT(*) AS orphan_count
FROM inventory_items i
LEFT JOIN inventory_categories c ON i.category_id = c.category_id
WHERE i.category_id IS NOT NULL AND c.category_id IS NULL;

-- Check for negative stock levels
SELECT COUNT(*) AS negative_stock_count
FROM inventory_items
WHERE current_stock_level < 0;

-- Check for expired alerts
SELECT COUNT(*) AS expired_alerts
FROM stock_alerts
WHERE expires_at < CURRENT_TIMESTAMP AND alert_status = 'active';
```

### 4. Backup and Recovery

#### Regular Backup Strategy

```bash
# Daily full backup at 2 AM
0 2 * * * pg_dump -h localhost -U postgres -Fc -f /backup/immunicare_$(date +\%Y\%m\%d).dump immunicare

# Continuous archiving for point-in-time recovery
wal_level = replica
archive_mode = on
archive_command = 'cp %p /archive/%f'
```

---

## Implementation Checklist

### Database Setup

- [ ] Create all tables from schema
- [ ] Add foreign key constraints
- [ ] Create indexes for performance
- [ ] Add CHECK constraints for data validation
- [ ] Set up audit logging triggers
- [ ] Create views for common queries
- [ ] Seed initial data (categories, warehouses)

### API Development

- [ ] Implement CRUD endpoints for inventory items
- [ ] Implement stock transaction endpoints
- [ ] Implement alert management endpoints
- [ ] Implement supplier management endpoints
- [ ] Implement reports endpoints
- [ ] Implement announcements endpoints
- [ ] Add authentication and authorization
- [ ] Implement input validation
- [ ] Add rate limiting

### Frontend Development

- [ ] Create InventoryReports component
- [ ] Create Announcements component
- [ ] Implement data tables with sorting/filtering
- [ ] Add export functionality (CSV, PDF, Excel)
- [ ] Implement form validation
- [ ] Add loading states and error handling
- [ ] Implement real-time updates (optional)

### Testing

- [ ] Unit tests for API endpoints
- [ ] Integration tests for database operations
- [ ] Frontend component tests
- [ ] Load testing for high-volume scenarios
- [ ] Security testing
- [ ] Data integrity tests

---

## Version History

| Version | Date       | Changes                |
| ------- | ---------- | ---------------------- |
| 1.0     | 2024-02-06 | Initial implementation |

---

## Support

For questions or issues, please contact the development team or refer to the system documentation.
