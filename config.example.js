// Copy to config.js. This untracked file is preserved during updates.
export default {
  appName: 'CosmicCRM', host: '0.0.0.0', port: 3015,
  publicUrl: 'https://crm.example.com', trustProxy: 1, secureCookies: true,
  sessionSecret: 'REPLACE_WITH_AT_LEAST_48_RANDOM_CHARACTERS',
  database: { host: 'mysql.example.com', port: 3306, user: 'cosmiccrm', password: '', database: 'cosmiccrm', connectionLimit: 10 },
  currency: 'USD', update: { enabled: true, branch: 'main' }
};
