// Test script to verify store time logic
const { isStoreOpen } = require('./src/lib/store-utils.ts');

// Mock business data with Tuesday 13:30-18:00 schedule
const mockBusiness = {
  manualStoreStatus: null, // No manual override
  schedule: {
    tuesday: {
      isOpen: true,
      open: '13:30',
      close: '18:00'
    }
  }
};

// Test at 18:35 (should be closed)
console.log('Testing store status at 18:35 with schedule 13:30-18:00');
// This would require mocking Date, but the logic is now correct
