const pool = require('./db');
const { Notification, Alert } = require('./models/Notification');
const User = require('./models/User');

async function testDatabaseConnection() {
  console.log('🔄 Testing database connection...');
  try {
    const result = await pool.query('SELECT NOW() as current_time');
    console.log(
      '✅ Database connection successful:',
      result.rows[0].current_time
    );
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    return false;
  }
}

async function testNotificationModel() {
  console.log('\n🔄 Testing Notification model...');
  try {
    // Test create
    const testNotification = await Notification.create({
      title: 'Test Notification',
      message: 'This is a test notification',
      type: 'info',
      category: 'system',
      userId: 1,
      priority: 2
    });
    console.log('✅ Notification created:', testNotification.id);

    // Test findById
    const foundNotification = await Notification.findById(testNotification.id);
    if (foundNotification) {
      console.log('✅ Notification found by ID:', foundNotification.title);
    } else {
      console.error('❌ Notification not found by ID');
      return false;
    }

    // Test findAll
    const allNotifications = await Notification.findAll(10);
    console.log('✅ Found all notifications:', allNotifications.length);

    // Test markAsRead
    const updatedNotification = await foundNotification.markAsRead();
    console.log('✅ Notification marked as read:', updatedNotification.isRead);

    // Test findUnreadByUserId
    const unreadNotifications = await Notification.findUnreadByUserId(1);
    console.log(
      '✅ Found unread notifications for user 1:',
      unreadNotifications.length
    );

    // Test getStats
    const stats = await Notification.getStats(1);
    console.log('✅ Notification stats:', stats);

    return true;
  } catch (error) {
    console.error('❌ Notification model test failed:', error.message);
    return false;
  }
}

async function testAlertModel() {
  console.log('\n🔄 Testing Alert model...');
  try {
    // Test create
    const testAlert = await Alert.create({
      title: 'Test Alert',
      message: 'This is a test alert',
      severity: 'medium',
      category: 'system',
      healthCenterId: 1
    });
    console.log('✅ Alert created:', testAlert.id);

    // Test findById
    const foundAlert = await Alert.findById(testAlert.id);
    if (foundAlert) {
      console.log('✅ Alert found by ID:', foundAlert.title);
    } else {
      console.error('❌ Alert not found by ID');
      return false;
    }

    // Test findActive
    const activeAlerts = await Alert.findActive();
    console.log('✅ Found active alerts:', activeAlerts.length);

    // Test acknowledge
    const acknowledgedAlert = await foundAlert.acknowledge(1);
    console.log('✅ Alert acknowledged:', acknowledgedAlert.isAcknowledged);

    // Test resolve
    const resolvedAlert = await foundAlert.resolve(1, 'Test resolution');
    console.log('✅ Alert resolved:', resolvedAlert.resolved);

    return true;
  } catch (error) {
    console.error('❌ Alert model test failed:', error.message);
    return false;
  }
}

async function testUserModel() {
  console.log('\n🔄 Testing User model...');
  try {
    // Test findById
    const user = await User.findById(1);
    if (user) {
      console.log('✅ User found by ID:', user.username);
    } else {
      console.log(
        'ℹ️  No user with ID 1 found (this is okay for initial test)'
      );
    }

    // Test getUserRole
    if (user) {
      const role = await User.getUserRole(1);
      console.log('✅ User role:', role?.role_name);
    }

    return true;
  } catch (error) {
    console.error('❌ User model test failed:', error.message);
    return false;
  }
}

async function testDatabaseSchema() {
  console.log('\n🔄 Testing database schema compatibility...');
  try {
    // Check if notifications table exists
    const notificationsTable = await pool.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'notifications'
      )`
    );
    console.log(
      '✅ Notifications table exists:',
      notificationsTable.rows[0].exists
    );

    // Check if alerts table exists
    const alertsTable = await pool.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'alerts'
      )`
    );
    console.log('✅ Alerts table exists:', alertsTable.rows[0].exists);

    // Check if users table exists
    const usersTable = await pool.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'users'
      )`
    );
    console.log('✅ Users table exists:', usersTable.rows[0].exists);

    return true;
  } catch (error) {
    console.error('❌ Database schema test failed:', error.message);
    return false;
  }
}

async function runAllTests() {
  console.log('🚀 Starting PostgreSQL Notification System Tests...\n');

  const results = {
    databaseConnection: await testDatabaseConnection(),
    databaseSchema: await testDatabaseSchema(),
    notificationModel: await testNotificationModel(),
    alertModel: await testAlertModel(),
    userModel: await testUserModel()
  };

  console.log('\n📊 Test Results Summary:');
  console.log('======================');
  Object.entries(results).forEach(([testName, passed]) => {
    const status = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} ${testName}`);
  });

  const allPassed = Object.values(results).every((result) => result === true);

  if (allPassed) {
    console.log(
      '\n🎉 All tests passed! PostgreSQL notification system is working correctly.'
    );
  } else {
    console.log(
      '\n⚠️  Some tests failed. Please check the error messages above.'
    );
  }

  return allPassed;
}

// Run tests and handle exit
runAllTests()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error('💥 Unexpected error during testing:', error);
    process.exit(1);
  });
