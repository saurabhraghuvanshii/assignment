import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { prisma } from '@/lib/prisma';

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: 'jwt' },
  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    async jwt({ token, user, profile }) {
      // On first sign-in, create or update the app user row,
      // then store the app user id inside the JWT.
      if (user || profile) {
        const googleSub =
          (user as { id?: string })?.id ||
          (profile as { sub?: string })?.sub;
        if (typeof googleSub === 'string' && googleSub.length > 0) {
          const name =
            (user as { name?: string }).name ||
            (profile as { name?: string; given_name?: string }).name ||
            (profile as { given_name?: string }).given_name ||
            'User';

          const dbUser = await prisma.user.upsert({
            where: { googleSub },
            update: { name },
            create: {
              googleSub,
              name,
              homeAddress: 'Unknown (connect Zomato to auto-fill)',
              homeLat: 0,
              homeLng: 0,
              workAddress: 'Unknown',
              workLat: 0,
              workLng: 0,
            },
          });

          (token as { userId?: string }).userId = dbUser.id;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && (token as { userId?: string }).userId) {
        session.user.id = (token as { userId: string }).userId;
      }
      return session;
    },
  },
});
