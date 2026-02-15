export const dynamic = "force-dynamic";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#fbfbfd]">
      <nav className="sticky top-0 z-50 border-b border-gray-200/60 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex h-12 max-w-[1200px] items-center px-6">
          <a href="/" className="flex items-center gap-2">
            <span className="text-sm font-bold tracking-tight text-gray-900">
              Open<span className="text-violet-500">Funderse</span>
            </span>
          </a>
          <span className="mx-2.5 text-gray-300">/</span>
          <span className="text-sm font-medium text-gray-500">Dashboard</span>
        </div>
      </nav>
      <main className="mx-auto max-w-[1200px] px-6 py-8">{children}</main>
    </div>
  );
}

