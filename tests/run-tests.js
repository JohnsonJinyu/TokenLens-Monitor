const assert = require('assert');

const { mapDeepSeekBalanceResponse } = require('../out/providers/deepseek');
const { mapKimiBalanceResponse } = require('../out/providers/kimi');
const {
  isEntitlementPollingEnabled,
  resolveProviderApiKey,
} = require('../out/monitors/apiMonitorPolicy');

function testDeepSeekBalanceMapping() {
  const balance = mapDeepSeekBalanceResponse({
    is_available: true,
    balance_infos: [{
      currency: 'CNY',
      total_balance: '14.21',
      granted_balance: '1.20',
      topped_up_balance: '13.01',
    }],
  }, 123);

  assert.strictEqual(balance.displayValue, '¥14.21');
  assert.strictEqual(balance.primaryLabel, '可用余额');
  assert.deepStrictEqual(balance.items.map((item) => item.label), ['充值余额', '赠送余额']);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(balance, 'totalUsed'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(balance, 'totalCharged'), false);
}

function testKimiBalanceMapping() {
  const balance = mapKimiBalanceResponse({
    data: {
      available_balance: '8.50',
      cash_balance: '6.00',
      voucher_balance: '2.50',
    },
  }, 456);

  assert.strictEqual(balance.displayValue, '¥8.50');
  assert.strictEqual(balance.primaryLabel, '可用余额');
  assert.deepStrictEqual(balance.items.map((item) => item.label), ['现金余额', '代金券余额']);
  assert.strictEqual(balance.balance, 8.5);
  assert.strictEqual(balance.giftBalance, 2.5);
}

function testCapabilityPolicy() {
  assert.strictEqual(isEntitlementPollingEnabled({ capabilities: { entitlement: false } }), false);
  assert.strictEqual(isEntitlementPollingEnabled({ capabilities: { entitlement: true } }), true);
  assert.strictEqual(isEntitlementPollingEnabled({ capabilities: {} }), true);
}

function testApiKeyPolicy() {
  assert.strictEqual(resolveProviderApiKey({ name: 'DeepSeek' }, 'sk-global'), 'sk-global');
  assert.strictEqual(resolveProviderApiKey({ name: 'Kimi' }, 'sk-global'), '');
  assert.strictEqual(resolveProviderApiKey({ name: 'Kimi', apiKey: ' sk-kimi ' }, 'sk-global'), 'sk-kimi');
}

testDeepSeekBalanceMapping();
testKimiBalanceMapping();
testCapabilityPolicy();
testApiKeyPolicy();

console.log('TokenLens unit tests passed');
