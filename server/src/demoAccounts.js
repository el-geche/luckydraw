// Seeded demo accounts. Passwords are intentionally public — this is a demo.
export const DEMO_ACCOUNTS = [
  { email: 'admin@luckydraw.demo', password: 'admin123', name: 'Morgan Hale', role: 'admin', referralCode: 'MORGAN-ADMIN' },
  { email: 'ava@luckydraw.demo', password: 'demo123', name: 'Ava Mensah', role: 'member', referralCode: 'AVA-7K2Q' },
  { email: 'ben@luckydraw.demo', password: 'demo123', name: 'Ben Okafor', role: 'member', referralCode: 'BEN-4M8D', referredBy: 'ava@luckydraw.demo' },
  { email: 'chloe@luckydraw.demo', password: 'demo123', name: 'Chloe Wanjiru', role: 'member', referralCode: 'CHLOE-9P3X', referredBy: 'ava@luckydraw.demo' },
  { email: 'daniel@luckydraw.demo', password: 'demo123', name: 'Daniel Kim', role: 'member', referralCode: 'DANIEL-2H6T', referredBy: 'ben@luckydraw.demo' },
  { email: 'ella@luckydraw.demo', password: 'demo123', name: 'Ella Novak', role: 'member', referralCode: 'ELLA-5R1W' },
  { email: 'finn@luckydraw.demo', password: 'demo123', name: 'Finn Larsen', role: 'member', referralCode: 'FINN-8C4N', referredBy: 'ella@luckydraw.demo' },
  { email: 'grace@luckydraw.demo', password: 'demo123', name: 'Grace Achieng', role: 'member', referralCode: 'GRACE-3J7V' },
  { email: 'hugo@luckydraw.demo', password: 'demo123', name: 'Hugo Moreau', role: 'member', referralCode: 'HUGO-6L9B' },
];
export const REFERRER_BONUS_CENTS = 500;
export const REFEREE_BONUS_CENTS = 1000;
export const WELCOME_BONUS_CENTS = 5000;
