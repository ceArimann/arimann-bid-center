import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';

const allowedDomains = (process.env.ALLOWED_DOMAINS || 'arimann.com').split(',').map(d => d.trim());

const handler = NextAuth({
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      // Restrict to @arimann.com (or configured domains)
      const email = user.email || '';
      const domain = email.split('@')[1];
      if (allowedDomains.includes(domain)) {
        return true;
      }
      return false; // Reject non-arimann emails
    },
    async session({ session, token }) {
      // Pass user info to client
      if (session.user) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
});

export { handler as GET, handler as POST };
