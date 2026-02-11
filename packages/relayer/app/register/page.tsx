import Link from 'next/link';

export default function RegisterDisabledPage() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-gray-50">
      <div className="z-10 w-full max-w-md overflow-hidden rounded-2xl border border-gray-100 shadow-xl">
        <div className="flex flex-col items-center justify-center space-y-3 border-b border-gray-200 bg-white px-4 py-6 pt-8 text-center sm:px-16">
          <h3 className="text-xl font-semibold">Registration Disabled</h3>
          <p className="text-sm text-gray-500">
            This relayer uses a single admin account from environment variables.
          </p>
        </div>
        <div className="space-y-3 px-6 py-6 text-sm text-gray-700">
          <p>Set <code>ADMIN_LOGIN_ID</code> and password env vars, then use Login.</p>
          <p>
            <Link href="/login" className="font-semibold text-gray-800 underline">
              Go to Login
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
