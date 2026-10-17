// Must be imported before helpers.js: enable drand + a mock anchor provider (no network).
process.env.ENTROPY_PROVIDER = 'drand';
process.env.ANCHOR_PROVIDERS = 'mock';
process.env.ANCHOR_RETRY_MS = '1000';
