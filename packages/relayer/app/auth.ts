import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { compare } from 'bcrypt-ts';
import { authConfig } from 'app/auth.config';

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      async authorize({ id, password }: any) {
        const adminId = process.env.ADMIN_LOGIN_ID?.trim();
        const adminPassword = process.env.ADMIN_LOGIN_PASSWORD;
        const adminPasswordHash = process.env.ADMIN_LOGIN_PASSWORD_HASH;

        if (!adminId || (!adminPassword && !adminPasswordHash)) {
          return null;
        }

        const inputId = String(id ?? '').trim();
        const inputPassword = String(password ?? '');
        if (!inputId || !inputPassword) return null;
        if (inputId !== adminId) return null;

        let passwordOk = false;
        if (adminPasswordHash) {
          passwordOk = await compare(inputPassword, adminPasswordHash);
        } else if (adminPassword) {
          passwordOk = inputPassword === adminPassword;
        }

        if (!passwordOk) return null;

        return {
          id: adminId,
          name: adminId
        } as any;
      },
    }),
  ],
});
