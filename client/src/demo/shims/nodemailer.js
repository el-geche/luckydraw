// The browser demo stores mail in the in-app outbox table only (MAIL_TRANSPORT=none); nothing is sent.
export default {
  createTransport: () => ({ sendMail: async () => ({ messageId: `<demo-${Date.now()}@browser.luckydraw.demo>`, message: '' }) }),
};
