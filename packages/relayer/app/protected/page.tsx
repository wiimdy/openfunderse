import { auth } from 'app/auth';

export default async function ProtectedPage() {
  let session = await auth();

  return (
    <div className="flex h-screen bg-black">
      <div className="w-screen h-screen flex flex-col space-y-5 justify-center items-center text-white">
        You are logged in as {session?.user?.name ?? session?.user?.email}
        <a href="/api/auth/signout?callbackUrl=/" className="underline">
          Sign out
        </a>
      </div>
    </div>
  );
}
